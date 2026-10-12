import AjvModule from "ajv";
// ajv ships CommonJS; under NodeNext the constructor is on .default
const Ajv = ((AjvModule as any).default ?? AjvModule) as typeof AjvModule.default;
import { createHash } from "node:crypto";
import type { LlmDeps } from "../llm.js";
import { executeTool, ToolExecError, clip } from "./exec.js";
import { grantMatches, sanitizeSchema, type ToolRow } from "./registry.js";

export type Provenance = { source: string; kind: "live" | "cached" | "estimate"; retrieved_at: string };
export type ToolCtx = { missionId: string; taskId: string; agentId: string; signal?: AbortSignal };
export type Outcome =
  | { status: "ok"; content: string; provenance: Provenance }
  | { status: "error" | "denied" | "rate_limited" | "rejected"; content: string }
  | { status: "pending_approval"; content: string; approvalId: string };

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = new Map<string, ReturnType<typeof ajv.compile> | null>();

export function validateArgs(tool: ToolRow, args: Record<string, unknown>): string | null {
  if ("__invalid_arguments" in args) return "arguments were not valid JSON";
  const schema = sanitizeSchema(tool.input_schema);
  const key = tool.id + JSON.stringify(schema);
  if (!validators.has(key)) {
    try { validators.set(key, ajv.compile(schema)); } catch { validators.set(key, null); } // an un-compilable remote schema: the remote validates itself
  }
  const v = validators.get(key);
  if (!v) return null;
  return v(args) ? null : (v.errors ?? []).map((e: { instancePath?: string; message?: string }) => `${e.instancePath || "arguments"} ${e.message}`).join("; ");
}

export const hashArgs = (args: unknown) => createHash("sha256").update(canonical(args)).digest("hex");
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}` : JSON.stringify(v));

async function record(deps: LlmDeps, ctx: ToolCtx, tool: ToolRow | null, name: string, args: unknown, status: string, f: { preview?: string; error?: string; provenance?: Provenance; approvalId?: string; ms?: number } = {}) {
  await deps.db.query(
    `INSERT INTO tool_calls(mission_id, task_id, agent_id, tool_id, tool_name, args, status, result_preview, error, provenance, approval_id, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [ctx.missionId, ctx.taskId, ctx.agentId, tool?.id ?? null, name, JSON.stringify(args ?? {}), status, f.preview?.slice(0, 500) ?? null, f.error?.slice(0, 1000) ?? null, f.provenance ? JSON.stringify(f.provenance) : null, f.approvalId ?? null, f.ms ?? null],
  );
}

/**
 * The single choke point for tool use. Order matters and is the same for every tool kind:
 *   known+enabled → granted (fresh from DB) → args valid → rate limit → approval → execute (single-use) → record.
 * Nothing here trusts the model: a denied call is just text returned to it.
 */
export async function invokeTool(deps: LlmDeps, ctx: ToolCtx, toolName: string, args: Record<string, unknown>, callId: string, approvedId?: string): Promise<Outcome> {
  const { db } = deps;
  const deny = async (status: "denied" | "rate_limited", msg: string, tool: ToolRow | null) => {
    await record(deps, ctx, tool, toolName, args, status, { error: msg });
    return { status, content: msg } as Outcome;
  };

  const tool = ((await db.query("SELECT * FROM tools WHERE name=$1", [toolName])).rows[0] as ToolRow | undefined) ?? null;
  if (!tool || !tool.enabled || tool.needs_review) return deny("denied", `Tool "${toolName}" is not available.`, tool);

  const grants: string[] = (await db.query("SELECT permissions FROM agents WHERE id=$1", [ctx.agentId])).rows[0]?.permissions?.tools ?? [];
  if (!grantMatches(tool.name, grants)) return deny("denied", `Tool "${toolName}" is not permitted for you.`, tool);

  // An approved call runs the *stored, human-reviewed* arguments, never a regenerated call.
  let approval: { id: string; args: Record<string, unknown> } | null = null;
  if (approvedId) {
    const a = (await db.query("SELECT id, args, tool_name, status, executed_at FROM approval_requests WHERE id=$1", [approvedId])).rows[0];
    if (!a || a.tool_name !== toolName || a.status !== "approved") return deny("denied", "Approval is not valid for this call (expired or mismatched).", tool);
    if (a.executed_at) {
      // Approved actions run at most once. If we get here the process died (or the model repeated itself) after execution started.
      const done = (await db.query("SELECT result_preview, provenance FROM tool_calls WHERE approval_id=$1 AND status='ok' ORDER BY id DESC LIMIT 1", [a.id])).rows[0];
      return done
        ? { status: "ok", content: `This approved action already ran (not repeated). Its result: ${done.result_preview}`, provenance: done.provenance ?? { source: tool.name, kind: tool.provenance_kind, retrieved_at: new Date().toISOString() } }
        : { status: "error", content: "This approved action was started but its outcome is unknown. It was NOT retried. Verify its effect through a read-only tool before taking further action." };
    }
    approval = { id: a.id, args: a.args };
    args = a.args;
  }

  const bad = validateArgs(tool, args);
  if (bad) return deny("denied", `Invalid arguments for "${toolName}": ${bad}`, tool);

  const used = (await db.query("SELECT count(*)::int n FROM tool_calls WHERE tool_id=$1 AND status IN ('ok','error') AND at > now() - interval '1 minute'", [tool.id])).rows[0].n;
  if (used >= tool.rate_limit_per_min) return deny("rate_limited", `Tool "${toolName}" is rate limited (${tool.rate_limit_per_min}/min). Try again later or use another approach.`, tool);

  if (tool.approval === "required" && !approval) {
    // Idempotency: never ask a human to approve (and never run) the exact same action twice within one task.
    const prior = (await db.query(
      `SELECT ar.id, tc.result_preview, tc.provenance FROM approval_requests ar LEFT JOIN tool_calls tc ON tc.approval_id = ar.id AND tc.status='ok'
        WHERE ar.task_id=$1 AND ar.tool_name=$2 AND ar.args_hash=$3 AND ar.executed_at IS NOT NULL ORDER BY ar.executed_at DESC LIMIT 1`,
      [ctx.taskId, tool.name, hashArgs(args)])).rows[0];
    if (prior) return { status: "ok", content: `This exact action was already performed earlier in this task and was not repeated. Earlier result: ${prior.result_preview ?? "(unknown)"}`, provenance: prior.provenance ?? { source: tool.name, kind: tool.provenance_kind, retrieved_at: new Date().toISOString() } };
    const ins = await db.query(
      `INSERT INTO approval_requests(mission_id, task_id, agent_id, tool_id, tool_name, call_id, args, args_hash, risk) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [ctx.missionId, ctx.taskId, ctx.agentId, tool.id, tool.name, callId, JSON.stringify(args), hashArgs(args), tool.risk],
    );
    await record(deps, ctx, tool, toolName, args, "pending_approval", { approvalId: ins.rows[0].id });
    return { status: "pending_approval", approvalId: ins.rows[0].id, content: "Awaiting human approval." };
  }

  if (approval) {
    // single-use: the first caller to flip executed_at wins; a crash after this point is NOT retried (at-most-once for approved actions)
    const claimed = await db.query("UPDATE approval_requests SET executed_at=now() WHERE id=$1 AND status='approved' AND executed_at IS NULL RETURNING id", [approval.id]);
    if (!claimed.rowCount) return deny("denied", "Approval was already used.", tool);
  }

  const t0 = Date.now();
  try {
    const raw = await executeTool(deps, tool, args, { agentId: ctx.agentId, signal: ctx.signal });
    const provenance: Provenance = { source: tool.name, kind: tool.provenance_kind, retrieved_at: new Date().toISOString() };
    await record(deps, ctx, tool, toolName, args, "ok", { preview: raw, provenance, approvalId: approval?.id, ms: Date.now() - t0 });
    return { status: "ok", content: raw, provenance };
  } catch (e) {
    const msg = e instanceof ToolExecError ? e.message : (e as Error).message;
    await record(deps, ctx, tool, toolName, args, "error", { error: msg, approvalId: approval?.id, ms: Date.now() - t0 });
    return { status: "error", content: `Tool "${toolName}" failed: ${clip(msg, 500)}` };
  }
}

/** What the model sees. Remote content is fenced and labelled untrusted; the closing tag cannot be forged from inside. */
export function wrapResult(name: string, o: Outcome): string {
  if (o.status === "ok") {
    const body = o.content.replace(/<\/tool_result>/gi, "<\\/tool_result>");
    return `<tool_result name="${name}" status="ok" provenance="${o.provenance.kind}" retrieved_at="${o.provenance.retrieved_at}" untrusted="true">\n${body}\n</tool_result>`;
  }
  return `<tool_result name="${name}" status="${o.status}">\n${o.content}\n</tool_result>`;
}
