import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { authHook, requireRole } from "../auth.js";
import type { Config } from "../config.js";
import { seal } from "../crypto.js";
import type { Db } from "../db.js";
import type { LlmDeps } from "../llm.js";
import { ApprovalError, decideApproval } from "../tools/approvals.js";
import { clip, executeTool, httpConfig, type McpServerRow } from "../tools/exec.js";
import { syncMcpServer } from "../tools/mcp.js";
import type { ToolRow } from "../tools/registry.js";
import { validateArgs } from "../tools/gateway.js";
import { parse, pgToHttp } from "./util.js";

const risk = z.enum(["read", "write", "irreversible"]);
const approval = z.enum(["never", "required"]);

export function toolRoutes(app: FastifyInstance, db: Db, cfg: Config, deps: LlmDeps) {
  const authed = { preHandler: [authHook(cfg.JWT_SECRET)] };
  const operator = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("operator")] };
  const admin = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("admin")] };
  const fail = (reply: any, e: unknown) => {
    const h = pgToHttp(e);
    if (h) return reply.code(h.code).send({ error: h.error });
    throw e;
  };
  const newCred = async (label: string, key: string) =>
    (await db.query("INSERT INTO credentials(label, sealed, last4) VALUES ($1,$2,$3) RETURNING id", [label, seal(key, cfg.PLATFORM_MASTER_KEY), key.slice(-4)])).rows[0].id as string;

  // ---------- tools ----------
  app.get("/api/tools", authed, async () => {
    const tools = (await db.query(
      `SELECT t.id, t.name, t.description, t.input_schema, t.kind, t.config, t.risk, t.approval, t.rate_limit_per_min, t.timeout_ms, t.provenance_kind, t.enabled, t.needs_review, t.review_reason,
              s.name AS server_name, (t.credential_id IS NOT NULL) AS has_key
         FROM tools t LEFT JOIN mcp_servers s ON s.id = t.mcp_server_id ORDER BY t.kind, t.name`)).rows;
    const agents = (await db.query("SELECT name, permissions FROM agents WHERE status <> 'terminated'")).rows;
    const { grantMatches } = await import("../tools/registry.js");
    return tools.map((t) => ({ ...t, granted_to: agents.filter((a) => grantMatches(t.name, a.permissions?.tools ?? [])).map((a) => a.name) }));
  });

  const httpToolBody = z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).refine((n) => !n.includes("__"), "'__' is reserved for MCP tool namespacing"),
    description: z.string().min(1).max(2000),
    input_schema: z.record(z.unknown()).default({ type: "object", properties: {} }),
    config: httpConfig,
    api_key: z.string().min(1).optional(),
    risk: risk.default("write"), approval: approval.default("required"),
    rate_limit_per_min: z.number().int().min(1).max(10000).default(30), timeout_ms: z.number().int().min(500).max(300000).default(20000),
    provenance_kind: z.enum(["live", "cached", "estimate"]).default("live"),
  });

  app.post("/api/tools", admin, async (req, reply) => {
    const b = parse(httpToolBody, req.body, reply);
    if (!b) return;
    if (b.risk === "irreversible" && b.approval !== "required") return reply.code(400).send({ error: "irreversible tools must require approval" });
    try {
      const credId = b.api_key ? await newCred(`tool:${b.name}`, b.api_key) : null;
      if (b.config.auth && !credId) return reply.code(400).send({ error: "config.auth is set but no api_key was provided" });
      const { rows } = await db.query(
        `INSERT INTO tools(name, description, input_schema, kind, config, credential_id, risk, approval, rate_limit_per_min, timeout_ms, provenance_kind)
         VALUES ($1,$2,$3,'http',$4,$5,$6,$7,$8,$9,$10) RETURNING id, name`,
        [b.name, b.description, JSON.stringify(b.input_schema), JSON.stringify(b.config), credId, b.risk, b.approval, b.rate_limit_per_min, b.timeout_ms, b.provenance_kind],
      );
      await audit(db, req.actor!, "tool.create", { type: "tool", id: rows[0].id }, { ...b });
      return reply.code(201).send(rows[0]);
    } catch (e) { return fail(reply, e); }
  });

  app.patch("/api/tools/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({
      enabled: z.boolean(), approval, risk, rate_limit_per_min: z.number().int().min(1).max(10000), timeout_ms: z.number().int().min(500).max(300000),
      provenance_kind: z.enum(["live", "cached", "estimate"]), description: z.string().min(1).max(2000), input_schema: z.record(z.unknown()), config: httpConfig,
      api_key: z.string().min(1), acknowledge_review: z.literal(true),
    }).partial(), req.body, reply);
    if (!b) return;
    try {
      const cur = (await db.query("SELECT * FROM tools WHERE id=$1", [id])).rows[0] as ToolRow | undefined;
      if (!cur) return reply.code(404).send({ error: "not found" });
      if ((b.description || b.input_schema || b.config || b.api_key) && cur.kind !== "http") return reply.code(400).send({ error: "only HTTP tools can be edited this way; MCP/builtin definitions come from their source" });
      const nextRisk = b.risk ?? cur.risk, nextApproval = b.approval ?? cur.approval;
      if (nextRisk === "irreversible" && nextApproval !== "required") return reply.code(400).send({ error: "irreversible tools must require approval" });
      let credId = cur.credential_id;
      if (b.api_key) { credId = await newCred(`tool:${cur.name}`, b.api_key); if (cur.credential_id) await db.query("DELETE FROM credentials WHERE id=$1", [cur.credential_id]); }
      const { rows } = await db.query(
        `UPDATE tools SET enabled=COALESCE($2,enabled), approval=COALESCE($3,approval), risk=COALESCE($4,risk), rate_limit_per_min=COALESCE($5,rate_limit_per_min),
                timeout_ms=COALESCE($6,timeout_ms), provenance_kind=COALESCE($7,provenance_kind), description=COALESCE($8,description), input_schema=COALESCE($9,input_schema),
                config=COALESCE($10,config), credential_id=$11,
                needs_review = CASE WHEN $12 THEN false ELSE needs_review END, review_reason = CASE WHEN $12 THEN NULL ELSE review_reason END, updated_at=now()
          WHERE id=$1 RETURNING id, name, enabled, approval, risk, needs_review`,
        [id, b.enabled ?? null, b.approval ?? null, b.risk ?? null, b.rate_limit_per_min ?? null, b.timeout_ms ?? null, b.provenance_kind ?? null, b.description ?? null,
         b.input_schema ? JSON.stringify(b.input_schema) : null, b.config ? JSON.stringify(b.config) : null, credId, b.acknowledge_review === true],
      );
      await audit(db, req.actor!, "tool.update", { type: "tool", id }, { ...b });
      return rows[0];
    } catch (e) { return fail(reply, e); }
  });

  app.delete("/api/tools/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("DELETE FROM tools WHERE id=$1 AND kind='http' RETURNING credential_id", [id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not found, or not an HTTP tool (MCP tools are removed with their server; builtins cannot be deleted)" });
    if (r.rows[0].credential_id) await db.query("DELETE FROM credentials WHERE id=$1", [r.rows[0].credential_id]);
    await audit(db, req.actor!, "tool.delete", { type: "tool", id });
    return reply.code(204).send();
  });

  // Test-run a READ-ONLY tool with sample arguments. Write/irreversible tools can only run inside a mission, behind approval.
  app.post("/api/tools/:id/test", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const args = (req.body as { args?: Record<string, unknown> })?.args ?? {};
    const tool = (await db.query("SELECT * FROM tools WHERE id=$1", [id])).rows[0] as ToolRow | undefined;
    if (!tool) return reply.code(404).send({ error: "not found" });
    if (tool.risk !== "read") return reply.code(400).send({ error: "only read-only tools can be test-run directly" });
    if (tool.name.startsWith("memory_")) return reply.code(400).send({ error: "memory tools act on an agent's memory and cannot be test-run" });
    const bad = validateArgs(tool, args);
    if (bad) return reply.code(400).send({ error: `invalid arguments: ${bad}` });
    const t0 = Date.now();
    try {
      const out = await executeTool(deps, tool, args, { agentId: "" });
      await audit(db, req.actor!, "tool.test", { type: "tool", id }, { args });
      return { ok: true, ms: Date.now() - t0, result: clip(out, 4000) };
    } catch (e) {
      return reply.code(502).send({ ok: false, error: (e as Error).message });
    }
  });

  app.get("/api/tool-calls", authed, async (req) => {
    const q = req.query as { mission_id?: string; limit?: string };
    const { rows } = await db.query(
      `SELECT c.id, c.mission_id, c.task_id, a.name AS agent_name, c.tool_name, c.status, c.args, c.result_preview, c.error, c.provenance, c.duration_ms, c.at
         FROM tool_calls c LEFT JOIN agents a ON a.id = c.agent_id WHERE ($1::uuid IS NULL OR c.mission_id = $1) ORDER BY c.id DESC LIMIT $2`,
      [q.mission_id ?? null, Math.min(parseInt(q.limit ?? "100", 10) || 100, 500)],
    );
    return rows;
  });

  // ---------- MCP servers ----------
  const serverBody = z.object({
    name: z.string().regex(/^[a-z][a-z0-9]{0,23}$/, "lowercase letters and digits only, starting with a letter"),
    url: z.string().url(), api_key: z.string().min(1).optional(),
    auth_header: z.string().regex(/^[A-Za-z0-9-]+$/).default("Authorization"), auth_scheme: z.enum(["bearer", "raw"]).default("bearer"), enabled: z.boolean().default(true),
  });

  app.get("/api/mcp-servers", authed, async () => (await db.query(
    `SELECT s.id, s.name, s.url, s.auth_header, s.auth_scheme, s.enabled, s.last_synced_at, s.last_error, (s.credential_id IS NOT NULL) AS has_key, c.last4 AS key_hint,
            (SELECT count(*)::int FROM tools t WHERE t.mcp_server_id = s.id) AS tool_count
       FROM mcp_servers s LEFT JOIN credentials c ON c.id = s.credential_id ORDER BY s.name`)).rows);

  app.post("/api/mcp-servers", admin, async (req, reply) => {
    const b = parse(serverBody, req.body, reply);
    if (!b) return;
    try {
      const credId = b.api_key ? await newCred(`mcp:${b.name}`, b.api_key) : null;
      const { rows } = await db.query("INSERT INTO mcp_servers(name, url, credential_id, auth_header, auth_scheme, enabled) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, url", [b.name, b.url, credId, b.auth_header, b.auth_scheme, b.enabled]);
      await audit(db, req.actor!, "mcp.create", { type: "mcp_server", id: rows[0].id }, { ...b });
      return reply.code(201).send(rows[0]);
    } catch (e) { return fail(reply, e); }
  });

  app.patch("/api/mcp-servers/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(serverBody.partial(), req.body, reply);
    if (!b) return;
    try {
      const cur = (await db.query("SELECT credential_id FROM mcp_servers WHERE id=$1", [id])).rows[0];
      if (!cur) return reply.code(404).send({ error: "not found" });
      let credId = cur.credential_id as string | null;
      if (b.api_key) { const n = await newCred(`mcp:${b.name ?? id}`, b.api_key); if (credId) await db.query("DELETE FROM credentials WHERE id=$1", [credId]); credId = n; }
      const { rows } = await db.query(
        `UPDATE mcp_servers SET name=COALESCE($2,name), url=COALESCE($3,url), auth_header=COALESCE($4,auth_header), auth_scheme=COALESCE($5,auth_scheme), enabled=COALESCE($6,enabled), credential_id=$7 WHERE id=$1 RETURNING id, name, url, enabled`,
        [id, b.name ?? null, b.url ?? null, b.auth_header ?? null, b.auth_scheme ?? null, b.enabled ?? null, credId],
      );
      await audit(db, req.actor!, "mcp.update", { type: "mcp_server", id }, { ...b });
      return rows[0];
    } catch (e) { return fail(reply, e); }
  });

  app.delete("/api/mcp-servers/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("DELETE FROM mcp_servers WHERE id=$1 RETURNING credential_id", [id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not found" });
    if (r.rows[0].credential_id) await db.query("DELETE FROM credentials WHERE id=$1", [r.rows[0].credential_id]);
    await audit(db, req.actor!, "mcp.delete", { type: "mcp_server", id });
    return reply.code(204).send();
  });

  app.post("/api/mcp-servers/:id/sync", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = (await db.query("SELECT * FROM mcp_servers WHERE id=$1", [id])).rows[0] as McpServerRow | undefined;
    if (!s) return reply.code(404).send({ error: "not found" });
    try {
      const report = await syncMcpServer(deps, s, AbortSignal.timeout(30_000));
      await audit(db, req.actor!, "mcp.sync", { type: "mcp_server", id }, report);
      return report;
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ---------- approvals ----------
  app.get("/api/approvals", authed, async (req) => {
    const status = (req.query as { status?: string }).status;
    const { rows } = await db.query(
      `SELECT ar.id, ar.tool_name, ar.args, ar.risk, ar.status, ar.requested_at, ar.expires_at, ar.decided_at, ar.decision_note, ar.mission_id, m.title AS mission_title,
              ar.task_id, t.title AS task_title, a.name AS agent_name, u.email AS decided_by_email
         FROM approval_requests ar LEFT JOIN missions m ON m.id = ar.mission_id LEFT JOIN tasks t ON t.id = ar.task_id
         LEFT JOIN agents a ON a.id = ar.agent_id LEFT JOIN users u ON u.id = ar.decided_by
        WHERE ($1::text IS NULL OR ar.status = $1) ORDER BY (ar.status='pending') DESC, ar.requested_at DESC LIMIT 200`,
      [status ?? null],
    );
    return rows;
  });

  for (const decision of ["approved", "rejected"] as const) {
    app.post(`/api/approvals/:id/${decision === "approved" ? "approve" : "reject"}`, operator, async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = parse(z.object({ note: z.string().max(1000).optional() }), req.body ?? {}, reply);
      if (!b) return;
      try {
        const a = await decideApproval(db, id, decision, { id: req.actor!.id!, isAdmin: req.actor!.role === "admin" }, b.note ?? null);
        await audit(db, req.actor!, `approval.${decision}`, { type: "approval", id }, { tool: a.tool_name, args: a.args, note: b.note });
        return { ok: true };
      } catch (e) {
        if (e instanceof ApprovalError) return reply.code(e.message === "not found" ? 404 : e.message.includes("admin") ? 403 : 409).send({ error: e.message });
        return fail(reply, e);
      }
    });
  }
}
