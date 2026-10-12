import { open } from "./crypto.js";
import type { Db } from "./db.js";
import { adapters as defaultAdapters, ProviderError, type ChatMessage, type ModelProvider, type ProviderKind, type ToolCall, type ToolSpec } from "./providers/index.js";
import { type Candidate, costUsd, loadCandidates, rank, type RoutingSpec } from "./router.js";

/** The subset of an agent row the LLM layer needs. */
export type AgentLike = {
  id: string;
  model_id: string | null;
  routing: RoutingSpec;
  max_cost_usd_per_run: number;
  daily_budget_usd: number;
};

export type LlmDeps = {
  db: Db; masterKey: string; adapters?: Record<ProviderKind, ModelProvider>;
  /** Tools may reach loopback/private addresses (tests, self-hosted internal APIs). Default false: public internet only. */
  allowPrivateHosts?: boolean;
};

export class NoModelError extends Error {
  constructor() { super("no eligible model: configure a provider and model"); }
}
export class BudgetExceededError extends Error {
  constructor(public scope: "call" | "daily" | "mission") { super(`${scope} budget would be exceeded`); }
}
export class AllModelsFailedError extends Error {
  constructor(public errors: string[]) { super(errors.join(" | ") || "all candidates failed"); }
}

export type ModelCallResult = {
  text: string; toolCalls: ToolCall[]; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number;
  finishReason: string; modelId: string; modelName: string; providerName: string;
};

export type CallOpts = {
  maxTokens: number;
  /** Tools the model may call this turn (already filtered to what the agent is granted). */
  tools?: ToolSpec[];
  signal?: AbortSignal;
  /** Attribution for usage_events. */
  ctx?: { runId?: string; taskId?: string; missionId?: string };
  /** Hard cap for the whole mission (USD). Checked against spend-so-far + worst case of this call. */
  missionMaxUsd?: number;
  /** Per-call cap override (defaults to the agent's max_cost_usd_per_run). */
  perCallMaxUsd?: number;
  onEvent?: (type: string, data: Record<string, unknown>) => Promise<unknown> | void;
};

/** Cheap pre-flight estimate (≈4 chars/token). Used only for budget gating, never billing. */
export const estTokens = (s: string) => Math.ceil(s.length / 4);

export async function providerTarget(deps: LlmDeps, providerId: string) {
  const { rows } = await deps.db.query(
    `SELECT p.kind, p.base_url, c.sealed FROM providers p LEFT JOIN credentials c ON c.id = p.credential_id WHERE p.id=$1`,
    [providerId],
  );
  const r = rows[0];
  if (!r) throw new ProviderError("provider not found", null, false);
  // Decrypted here, used for the HTTP call, never placed in a prompt, event, or log.
  return { kind: r.kind as ProviderKind, baseUrl: r.base_url as string, apiKey: r.sealed ? open(r.sealed, deps.masterKey) : null };
}

export async function candidatesFor(db: Db, agent: Pick<AgentLike, "model_id" | "routing">): Promise<Candidate[]> {
  const all = await loadCandidates(db);
  if (agent.model_id) return all.filter((c) => c.modelId === agent.model_id); // pinned: no cross-model fallback
  return rank(all, agent.routing);
}

export async function spentTodayUsd(db: Db, agentId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(sum(cost_usd),0) AS s FROM usage_events
      WHERE agent_id=$1 AND at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [agentId],
  );
  return rows[0].s as number;
}

export async function spentOnMissionUsd(db: Db, missionId: string): Promise<number> {
  const { rows } = await db.query("SELECT COALESCE(sum(cost_usd),0) AS s FROM usage_events WHERE mission_id=$1", [missionId]);
  return rows[0].s as number;
}

/**
 * One routed, budget-gated model call with provider fallback. Records usage on success.
 * Only the vendor call is eligible for fallback; bookkeeping failures propagate and never trigger a second paid call.
 */
export async function callModel(deps: LlmDeps, agent: AgentLike, messages: ChatMessage[], opts: CallOpts): Promise<ModelCallResult> {
  const { db } = deps;
  const adapters = deps.adapters ?? defaultAdapters;
  const cands = await candidatesFor(db, agent);
  if (cands.length === 0) throw new NoModelError();

  const promptTokens = estTokens(JSON.stringify(messages)) + estTokens(JSON.stringify(opts.tools ?? []));
  const spentDaily = await spentTodayUsd(db, agent.id);
  const spentMission = opts.ctx?.missionId && opts.missionMaxUsd !== undefined ? await spentOnMissionUsd(db, opts.ctx.missionId) : 0;
  const perCall = opts.perCallMaxUsd ?? agent.max_cost_usd_per_run;
  const errors: string[] = [];
  let budgetSkips = 0;
  const tripped = new Set<"call" | "daily" | "mission">();

  for (const c of cands) {
    opts.signal?.throwIfAborted();
    const worst = costUsd(c, promptTokens, opts.maxTokens);
    const overMission = opts.missionMaxUsd !== undefined && spentMission + worst > opts.missionMaxUsd;
    const overDaily = spentDaily + worst > agent.daily_budget_usd;
    if (worst > perCall || overDaily || overMission) {
      budgetSkips++;
      const scope = overMission ? "mission" : overDaily ? "daily" : "call";
      tripped.add(scope);
      await opts.onEvent?.("route.skipped", { model: c.modelName, reason: scope === "mission" ? "mission budget" : "budget", worst_case_usd: worst });
      continue;
    }
    await opts.onEvent?.("route.selected", { provider: c.providerName, model: c.modelName, tier: c.tier });
    const t0 = Date.now();
    let res: Awaited<ReturnType<ModelProvider["complete"]>>;
    try {
      const target = await providerTarget(deps, c.providerId);
      res = await adapters[target.kind].complete(target, { model: c.modelName, messages, tools: opts.tools, maxTokens: opts.maxTokens, signal: opts.signal });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      const msg = (e as Error).message;
      errors.push(`${c.providerName}/${c.modelName}: ${msg}`);
      await opts.onEvent?.("route.fallback", { model: c.modelName, error: msg });
      continue;
    }
    const latencyMs = Date.now() - t0;
    const cost = costUsd(c, res.tokensIn, res.tokensOut);
    await db.query(
      "INSERT INTO usage_events(run_id, task_id, mission_id, agent_id, model_id, tokens_in, tokens_out, cost_usd, latency_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [opts.ctx?.runId ?? null, opts.ctx?.taskId ?? null, opts.ctx?.missionId ?? null, agent.id, c.modelId, res.tokensIn, res.tokensOut, cost, latencyMs],
    );
    // exponential moving average, so the 'fastest' strategy learns from real traffic
    await db.query(
      "UPDATE models SET avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN $2::int ELSE (avg_latency_ms*0.8 + $2::int*0.2)::int END WHERE id=$1",
      [c.modelId, latencyMs],
    );
    return { text: res.text, toolCalls: res.toolCalls ?? [], tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: cost, latencyMs, finishReason: res.finishReason, modelId: c.modelId, modelName: c.modelName, providerName: c.providerName };
  }
  // every candidate was too expensive; report the most consequential limit that tripped (mission > daily > per-call)
  if (budgetSkips === cands.length) throw new BudgetExceededError(tripped.has("mission") ? "mission" : tripped.has("daily") ? "daily" : "call");
  throw new AllModelsFailedError(errors);
}
