import type { Db } from "./db.js";
import type { RunBus } from "./bus.js";
import {
  AllModelsFailedError, BudgetExceededError, callModel, NoModelError,
  type LlmDeps,
} from "./llm.js";
import type { ChatMessage, ModelProvider, ProviderKind } from "./providers/index.js";
import type { RoutingSpec } from "./router.js";

export type AgentRow = {
  id: string;
  name: string;
  kind?: string;
  role: string;
  goal: string;
  instructions: string;
  model_id: string | null;
  routing: RoutingSpec;
  permissions?: { tools: string[]; memory_scope: "agent" | "team" | "org" };
  max_cost_usd_per_run: number;
  daily_budget_usd: number;
  run_timeout_ms: number;
  status: "active" | "paused" | "terminated";
  version: number;
};

export type RuntimeDeps = {
  db: Db;
  bus: RunBus;
  masterKey: string;
  adapters?: Record<ProviderKind, ModelProvider>;
};

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const HARD_MAX_OUTPUT_TOKENS = 8192;

export function buildSystemPrompt(a: Pick<AgentRow, "name" | "role" | "goal" | "instructions">): string {
  return [
    `You are ${a.name}. Role: ${a.role}.`,
    a.goal && `Goal: ${a.goal}`,
    a.instructions && `Instructions:\n${a.instructions}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export class RunController {
  private controllers = new Map<string, AbortController>();
  cancel(runId: string): boolean {
    const c = this.controllers.get(runId);
    if (!c) return false;
    c.abort(new Error("cancelled"));
    return true;
  }
  register(runId: string, c: AbortController) {
    this.controllers.set(runId, c);
  }
  unregister(runId: string) {
    this.controllers.delete(runId);
  }
}

/** Anything that was `running` when the process died cannot resume in Phase 1; mark it honestly. (Missions DO resume: see queue.ts.) */
export async function recoverInterruptedRuns(db: Db): Promise<number> {
  const r = await db.query(
    `UPDATE runs SET status='failed', error='interrupted by server restart', finished_at=now() WHERE status='running'`,
  );
  return r.rowCount ?? 0;
}

/** Create the run row and execute in the background. Resolves with the run id once persisted. */
export async function startRun(
  deps: RuntimeDeps,
  ctl: RunController,
  agent: AgentRow,
  input: string,
  startedBy: string | null,
  opts: { maxOutputTokens?: number } = {},
): Promise<string> {
  const { rows } = await deps.db.query(
    "INSERT INTO runs(agent_id, agent_version, input, started_by) VALUES ($1,$2,$3,$4) RETURNING id",
    [agent.id, agent.version, input, startedBy],
  );
  const runId = rows[0].id as string;
  const abort = new AbortController();
  ctl.register(runId, abort);
  void execute(deps, agent, runId, input, abort, opts.maxOutputTokens)
    .catch(async (e) => {
      // execute() handles its own failures; this is the last-resort guard against an unhandled rejection.
      await finish(deps, runId, "failed", { error: `internal: ${(e as Error).message}` }).catch(() => {});
    })
    .finally(() => ctl.unregister(runId));
  return runId;
}

async function finish(
  deps: RuntimeDeps,
  runId: string,
  status: "succeeded" | "failed" | "cancelled" | "timed_out" | "budget_exceeded",
  f: { output?: string; error?: string; modelId?: string; tokensIn?: number; tokensOut?: number; cost?: number },
) {
  await deps.db.query(
    `UPDATE runs SET status=$2, output=$3, error=$4, model_id=$5, tokens_in=$6, tokens_out=$7, cost_usd=$8, finished_at=now()
      WHERE id=$1 AND status='running'`,
    [runId, status, f.output ?? null, f.error ?? null, f.modelId ?? null, f.tokensIn ?? 0, f.tokensOut ?? 0, f.cost ?? 0],
  );
  await deps.bus.emit(runId, "run.finished", { status, error: f.error ?? null, cost_usd: f.cost ?? 0 });
}

async function execute(
  deps: RuntimeDeps,
  agent: AgentRow,
  runId: string,
  input: string,
  cancel: AbortController,
  maxOutputOverride?: number,
) {
  const { bus } = deps;
  const llm: LlmDeps = { db: deps.db, masterKey: deps.masterKey, adapters: deps.adapters };
  const maxTokens = Math.min(maxOutputOverride ?? DEFAULT_MAX_OUTPUT_TOKENS, HARD_MAX_OUTPUT_TOKENS);
  await bus.emit(runId, "run.started", { agent: agent.name, agent_version: agent.version });

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(agent) },
    { role: "user", content: input },
  ];
  const timeout = AbortSignal.timeout(agent.run_timeout_ms);
  const signal = AbortSignal.any([cancel.signal, timeout]);

  try {
    const res = await callModel(llm, agent, messages, {
      maxTokens, signal, ctx: { runId },
      onEvent: (type, data) => bus.emit(runId, type, data),
    });
    await bus.emit(runId, "model.response", { model: res.modelName, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.latencyMs, finish_reason: res.finishReason });
    return finish(deps, runId, "succeeded", { output: res.text, modelId: res.modelId, tokensIn: res.tokensIn, tokensOut: res.tokensOut, cost: res.costUsd });
  } catch (e) {
    if (cancel.signal.aborted) return finish(deps, runId, "cancelled", { error: "cancelled by operator" });
    if (timeout.aborted) return finish(deps, runId, "timed_out", { error: `exceeded ${agent.run_timeout_ms}ms` });
    if (e instanceof NoModelError) return finish(deps, runId, "failed", { error: e.message });
    if (e instanceof BudgetExceededError) return finish(deps, runId, "budget_exceeded", { error: "every candidate model would exceed the run or daily budget" });
    if (e instanceof AllModelsFailedError) return finish(deps, runId, "failed", { error: e.message });
    throw e; // bookkeeping/DB failure after a paid call: surface as internal error, never retry on another model
  }
}
