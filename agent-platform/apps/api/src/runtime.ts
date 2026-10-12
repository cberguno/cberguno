import type { Db } from "./db.js";
import { open } from "./crypto.js";
import { adapters as defaultAdapters, ProviderError, type ChatMessage, type ModelProvider, type ProviderKind } from "./providers/index.js";
import { type Candidate, costUsd, loadCandidates, rank, type RoutingSpec } from "./router.js";
import type { RunBus } from "./bus.js";

export type AgentRow = {
  id: string;
  name: string;
  role: string;
  goal: string;
  instructions: string;
  model_id: string | null;
  routing: RoutingSpec;
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
/** Cheap pre-flight estimate (≈4 chars/token). Used only for budget gating, never billing. */
const estTokens = (s: string) => Math.ceil(s.length / 4);

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

/** Anything that was `running` when the process died cannot resume in Phase 1; mark it honestly. */
export async function recoverInterruptedRuns(db: Db): Promise<number> {
  const r = await db.query(
    `UPDATE runs SET status='failed', error='interrupted by server restart', finished_at=now() WHERE status='running'`,
  );
  return r.rowCount ?? 0;
}

async function spentTodayUsd(db: Db, agentId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(sum(cost_usd),0) AS s FROM usage_events
      WHERE agent_id=$1 AND at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [agentId],
  );
  return rows[0].s as number;
}

async function providerTarget(deps: RuntimeDeps, providerId: string) {
  const { rows } = await deps.db.query(
    `SELECT p.kind, p.base_url, c.sealed FROM providers p LEFT JOIN credentials c ON c.id = p.credential_id WHERE p.id=$1`,
    [providerId],
  );
  const r = rows[0];
  if (!r) throw new ProviderError("provider not found", null, false);
  // The secret is decrypted here, used for the HTTP call, and never placed in a prompt, event, or log.
  return { kind: r.kind as ProviderKind, baseUrl: r.base_url as string, apiKey: r.sealed ? open(r.sealed, deps.masterKey) : null };
}

export async function candidatesFor(db: Db, agent: AgentRow): Promise<Candidate[]> {
  const all = await loadCandidates(db);
  if (agent.model_id) return all.filter((c) => c.modelId === agent.model_id); // pinned: no cross-model fallback
  return rank(all, agent.routing);
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
  const { db, bus } = deps;
  const adapters = deps.adapters ?? defaultAdapters;
  const maxTokens = Math.min(maxOutputOverride ?? DEFAULT_MAX_OUTPUT_TOKENS, HARD_MAX_OUTPUT_TOKENS);
  await bus.emit(runId, "run.started", { agent: agent.name, agent_version: agent.version });

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(agent) },
    { role: "user", content: input },
  ];
  const promptTokens = estTokens(messages.map((m) => m.content).join("\n"));

  const timeout = AbortSignal.timeout(agent.run_timeout_ms);
  const signal = AbortSignal.any([cancel.signal, timeout]);

  const cands = await candidatesFor(db, agent);
  if (cands.length === 0) return finish(deps, runId, "failed", { error: "no eligible model: configure a provider and model" });

  const spentBefore = await spentTodayUsd(db, agent.id);
  const errors: string[] = [];
  let budgetSkips = 0;

  for (const c of cands) {
    if (signal.aborted) break;
    const worst = costUsd(c, promptTokens, maxTokens);
    if (worst > agent.max_cost_usd_per_run || spentBefore + worst > agent.daily_budget_usd) {
      budgetSkips++;
      await bus.emit(runId, "route.skipped", { model: c.modelName, reason: "budget", worst_case_usd: worst });
      continue;
    }
    await bus.emit(runId, "route.selected", { provider: c.providerName, model: c.modelName, tier: c.tier });
    const t0 = Date.now();
    let res: Awaited<ReturnType<ModelProvider["complete"]>>;
    // Only the vendor call is eligible for fallback. Bookkeeping failures below must NOT trigger a second paid call.
    try {
      const target = await providerTarget(deps, c.providerId);
      res = await adapters[target.kind].complete(target, { model: c.modelName, messages, maxTokens, signal });
    } catch (e) {
      if (signal.aborted) break;
      const msg = (e as Error).message;
      errors.push(`${c.providerName}/${c.modelName}: ${msg}`);
      await bus.emit(runId, "route.fallback", { model: c.modelName, error: msg });
      continue;
    }
    const latency = Date.now() - t0;
    const cost = costUsd(c, res.tokensIn, res.tokensOut);
    await db.query(
      "INSERT INTO usage_events(run_id, agent_id, model_id, tokens_in, tokens_out, cost_usd, latency_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [runId, agent.id, c.modelId, res.tokensIn, res.tokensOut, cost, latency],
    );
    // exponential moving average, so the 'fastest' strategy learns from real traffic
    await db.query(
      "UPDATE models SET avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN $2::int ELSE (avg_latency_ms*0.8 + $2::int*0.2)::int END WHERE id=$1",
      [c.modelId, latency],
    );
    await bus.emit(runId, "model.response", { model: c.modelName, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: latency, finish_reason: res.finishReason });
    return finish(deps, runId, "succeeded", { output: res.text, modelId: c.modelId, tokensIn: res.tokensIn, tokensOut: res.tokensOut, cost });
  }

  if (cancel.signal.aborted) return finish(deps, runId, "cancelled", { error: "cancelled by operator" });
  if (timeout.aborted) return finish(deps, runId, "timed_out", { error: `exceeded ${agent.run_timeout_ms}ms` });
  if (budgetSkips === cands.length) return finish(deps, runId, "budget_exceeded", { error: "every candidate model would exceed the run or daily budget" });
  return finish(deps, runId, "failed", { error: errors.join(" | ") || "all candidates failed" });
}
