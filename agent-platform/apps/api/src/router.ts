import type { Db } from "./db.js";

export type Tier = "fast" | "standard" | "frontier";
export type Complexity = "low" | "medium" | "high";
export type Strategy = "cheapest" | "fastest" | "quality";

export type Candidate = {
  modelId: string;
  providerId: string;
  providerName: string;
  modelName: string;
  tier: Tier;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  usdPerMtokIn: number;
  usdPerMtokOut: number;
  avgLatencyMs: number | null;
};

export type RoutingSpec = {
  strategy: Strategy;
  complexity: Complexity;
  minContext?: number;
  needsTools?: boolean;
  needsVision?: boolean;
  maxLatencyMs?: number;
  maxUsdPerMtokOut?: number;
};

const PREFERRED_TIER: Record<Complexity, Tier[]> = {
  low: ["fast", "standard", "frontier"],
  medium: ["standard", "fast", "frontier"],
  high: ["frontier", "standard", "fast"],
};

/**
 * Pure ranking. Hard constraints filter; then candidates are ordered by the complexity's preferred
 * tier sequence, and within a tier by the strategy. Higher tiers in the sequence are *fallbacks*,
 * so a failing preferred model degrades gracefully instead of the run dying.
 */
export function rank(cands: Candidate[], spec: RoutingSpec): Candidate[] {
  const ok = cands.filter(
    (c) =>
      (spec.minContext === undefined || c.contextWindow >= spec.minContext) &&
      (!spec.needsTools || c.supportsTools) &&
      (!spec.needsVision || c.supportsVision) &&
      (spec.maxLatencyMs === undefined || c.avgLatencyMs === null || c.avgLatencyMs <= spec.maxLatencyMs) &&
      (spec.maxUsdPerMtokOut === undefined || c.usdPerMtokOut <= spec.maxUsdPerMtokOut),
  );
  const tierOrder = PREFERRED_TIER[spec.complexity];
  const blended = (c: Candidate) => c.usdPerMtokIn + c.usdPerMtokOut;
  const within = (a: Candidate, b: Candidate): number => {
    switch (spec.strategy) {
      case "cheapest":
        return blended(a) - blended(b);
      case "fastest":
        {
          // unknown latency sorts last, ties broken by cost
          const la = a.avgLatencyMs ?? Infinity;
          const lb = b.avgLatencyMs ?? Infinity;
          return la === lb ? blended(a) - blended(b) : la < lb ? -1 : 1;
        }
      case "quality":
        // bigger context window as a weak proxy for capability within a tier, then cheaper
        return b.contextWindow - a.contextWindow || blended(a) - blended(b);
    }
  };
  return [...ok].sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier) || within(a, b));
}

export async function loadCandidates(db: Db): Promise<Candidate[]> {
  const { rows } = await db.query(
    `SELECT m.id AS model_id, m.provider_id, p.name AS provider_name, m.model_name, m.tier, m.context_window,
            m.supports_tools, m.supports_vision, m.usd_per_mtok_in, m.usd_per_mtok_out, m.avg_latency_ms
       FROM models m JOIN providers p ON p.id = m.provider_id
      WHERE m.enabled AND p.enabled AND m.kind = 'chat'`,
  );
  return rows.map((r) => ({
    modelId: r.model_id,
    providerId: r.provider_id,
    providerName: r.provider_name,
    modelName: r.model_name,
    tier: r.tier,
    contextWindow: r.context_window,
    supportsTools: r.supports_tools,
    supportsVision: r.supports_vision,
    usdPerMtokIn: r.usd_per_mtok_in,
    usdPerMtokOut: r.usd_per_mtok_out,
    avgLatencyMs: r.avg_latency_ms,
  }));
}

export function costUsd(c: Pick<Candidate, "usdPerMtokIn" | "usdPerMtokOut">, tokensIn: number, tokensOut: number) {
  return (tokensIn * c.usdPerMtokIn + tokensOut * c.usdPerMtokOut) / 1_000_000;
}

/** Worst-case cost of one call, used to refuse calls that could exceed a budget. */
export function maxCallCostUsd(c: Candidate, estTokensIn: number, maxTokensOut: number) {
  return costUsd(c, estTokensIn, maxTokensOut);
}
