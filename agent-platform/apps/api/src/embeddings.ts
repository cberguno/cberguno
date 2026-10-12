import { type LlmDeps, providerTarget } from "./llm.js";
import { embedWith } from "./providers/embeddings.js";

export type Embedder = { modelId: string; modelName: string; embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]> };

/** The configured embedding model (settings.embedding_model_id), or null if memory runs keyword-only. */
export async function getEmbedder(deps: LlmDeps): Promise<Embedder | null> {
  const { rows } = await deps.db.query(
    `SELECT m.id, m.model_name, m.provider_id, m.usd_per_mtok_in
       FROM settings s JOIN models m ON m.id = (s.value->>'model_id')::uuid
       JOIN providers p ON p.id = m.provider_id
      WHERE s.key = 'embedding_model_id' AND m.enabled AND p.enabled AND m.kind = 'embedding'`,
  );
  const m = rows[0];
  if (!m) return null;
  return {
    modelId: m.id,
    modelName: m.model_name,
    embed: async (texts, signal) => {
      const target = await providerTarget(deps, m.provider_id);
      const BATCH = 64;
      const out: number[][] = [];
      let tokens = 0;
      for (let i = 0; i < texts.length; i += BATCH) {
        const r = await embedWith(target, m.model_name, texts.slice(i, i + BATCH), signal);
        out.push(...r.vectors);
        tokens += r.tokens;
      }
      if (tokens > 0) {
        await deps.db.query(
          "INSERT INTO usage_events(model_id, tokens_in, tokens_out, cost_usd, latency_ms) VALUES ($1,$2,0,$3,0)",
          [m.id, tokens, (tokens * m.usd_per_mtok_in) / 1_000_000],
        );
      }
      return out;
    },
  };
}

export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;
