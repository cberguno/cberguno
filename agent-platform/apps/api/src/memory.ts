import type { Db } from "./db.js";
import { getEmbedder, toVectorLiteral } from "./embeddings.js";
import type { LlmDeps } from "./llm.js";

export type Scope = "agent" | "team" | "org";
export type MemoryKind = "episodic" | "semantic" | "lesson";
const SCOPE_RANK: Record<Scope, number> = { agent: 1, team: 2, org: 3 };

/**
 * Who is touching memory and how far they may reach. For agents, `maxScope` comes from agent.permissions.memory_scope,
 * which only an admin can change — so an agent cannot widen its own reach.
 */
export type MemoryActor = { agentId: string; maxScope: Scope; teamIds: string[] };

export async function actorForAgent(db: Db, agentId: string, maxScope?: Scope): Promise<MemoryActor> {
  let scope = maxScope;
  if (!scope) {
    const a = await db.query("SELECT permissions FROM agents WHERE id=$1", [agentId]);
    scope = (a.rows[0]?.permissions?.memory_scope as Scope) ?? "agent";
  }
  const t = await db.query("SELECT team_id FROM team_members WHERE agent_id=$1", [agentId]);
  return { agentId, maxScope: scope, teamIds: t.rows.map((r) => r.team_id) };
}

export class MemoryAccessError extends Error {}

export type NewMemory = {
  kind: MemoryKind; scope: Scope; agentId?: string | null; teamId?: string | null;
  content: string; salience?: number; source?: Record<string, unknown>;
};

/** Agent-initiated writes are clamped by the actor's reach. Human/system writes pass actor=undefined. */
export async function writeMemory(deps: LlmDeps, m: NewMemory, actor?: MemoryActor): Promise<string> {
  if (actor) {
    if (SCOPE_RANK[m.scope] > SCOPE_RANK[actor.maxScope]) throw new MemoryAccessError(`agent may not write ${m.scope}-scope memory`);
    if (m.scope === "team" && !(m.teamId && actor.teamIds.includes(m.teamId))) throw new MemoryAccessError("agent is not a member of that team");
    if (m.scope === "agent" && m.agentId && m.agentId !== actor.agentId) throw new MemoryAccessError("agent may only write its own memory");
  }
  const content = m.content.trim().slice(0, 4000);
  if (!content) throw new Error("empty memory");
  let embedding: string | null = null;
  let model: string | null = null;
  try {
    const emb = await getEmbedder(deps);
    if (emb) {
      const [v] = await emb.embed([content]);
      if (v) { embedding = toVectorLiteral(v); model = emb.modelName; }
    }
  } catch { /* stored without an embedding; consolidation backfills it. Keyword search still finds it. */ }
  const { rows } = await deps.db.query(
    `INSERT INTO memories(kind, scope, agent_id, team_id, content, embedding, embedding_model, salience, source)
     VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8,$9) RETURNING id`,
    [m.kind, m.scope, m.agentId ?? null, m.scope === "team" ? m.teamId : null, content, embedding, model, m.salience ?? 0.5, JSON.stringify(m.source ?? {})],
  );
  return rows[0].id;
}

export type ScoredMemory = {
  id: string; kind: MemoryKind; scope: Scope; agent_id: string | null; content: string; salience: number;
  similarity: number; score: number; created_at: string; method: "vector" | "keyword";
};

const VISIBLE = `m.consolidated_into IS NULL AND (
  (m.scope = 'agent' AND m.agent_id = $1)
  OR (m.scope = 'team' AND $2::int >= 2 AND m.team_id = ANY($3::uuid[]))
  OR (m.scope = 'org' AND $2::int >= 3))`;

const HALF_LIFE_DAYS = 30;
/** score = similarity × (0.5 + 0.5·salience) × (0.5 + 0.5·e^(−idleDays/30)). Similarity dominates; salience/recency re-rank. */
export function relevanceScore(similarity: number, salience: number, idleDays: number): number {
  return similarity * (0.5 + 0.5 * salience) * (0.5 + 0.5 * Math.exp(-idleDays / HALF_LIFE_DAYS));
}

function orQuery(text: string): string | null {
  const words = [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 24);
  return words.length ? words.join(" | ") : null;
}

export async function searchMemories(
  deps: LlmDeps, actor: MemoryActor, query: string,
  opts: { k?: number; kinds?: MemoryKind[]; minSimilarity?: number; reinforce?: boolean } = {},
): Promise<ScoredMemory[]> {
  const k = opts.k ?? 5;
  const kindFilter = opts.kinds?.length ? "AND m.kind = ANY($4::text[])" : "";
  const base = [actor.agentId, SCOPE_RANK[actor.maxScope], actor.teamIds, ...(opts.kinds?.length ? [opts.kinds] : [])];
  const found = new Map<string, ScoredMemory>();
  const idle = (d: Date) => Math.max(0, (Date.now() - d.getTime()) / 86_400_000);
  const emb = await getEmbedder(deps).catch(() => null);

  let embeddedModel: string | null = null;
  if (emb) {
    try {
      const [qv] = await emb.embed([query]);
      if (qv) {
        embeddedModel = emb.modelName;
        const n = base.length;
        const { rows } = await deps.db.query(
          `SELECT m.id, m.kind, m.scope, m.agent_id, m.content, m.salience, m.created_at, m.last_accessed_at,
                  1 - (m.embedding <=> $${n + 1}::vector) AS sim
             FROM memories m
            WHERE ${VISIBLE} ${kindFilter} AND m.embedding IS NOT NULL AND m.embedding_model = $${n + 2} AND vector_dims(m.embedding) = $${n + 3}
            ORDER BY m.embedding <=> $${n + 1}::vector LIMIT 50`,
          [...base, toVectorLiteral(qv), emb.modelName, qv.length],
        );
        for (const r of rows) {
          found.set(r.id, { id: r.id, kind: r.kind, scope: r.scope, agent_id: r.agent_id, content: r.content, salience: r.salience, similarity: r.sim, score: relevanceScore(r.sim, r.salience, idle(r.last_accessed_at)), created_at: r.created_at, method: "vector" });
        }
      }
    } catch { /* embedding provider down: fall through to keyword search rather than failing the task */ }
  }

  // Keyword search covers rows with no usable embedding (no embedder configured, backfill pending, or a different model).
  const tsq = orQuery(query);
  if (tsq) {
    const n = base.length;
    const { rows } = await deps.db.query(
      `SELECT m.id, m.kind, m.scope, m.agent_id, m.content, m.salience, m.created_at, m.last_accessed_at,
              ts_rank_cd(m.content_tsv, to_tsquery('english', $${n + 1}), 32) AS sim
         FROM memories m
        WHERE ${VISIBLE} ${kindFilter} AND m.content_tsv @@ to_tsquery('english', $${n + 1})
          ${embeddedModel ? `AND (m.embedding IS NULL OR m.embedding_model IS DISTINCT FROM $${n + 2})` : ""}
        ORDER BY sim DESC LIMIT 50`,
      embeddedModel ? [...base, tsq, embeddedModel] : [...base, tsq],
    );
    for (const r of rows) {
      if (found.has(r.id)) continue;
      found.set(r.id, { id: r.id, kind: r.kind, scope: r.scope, agent_id: r.agent_id, content: r.content, salience: r.salience, similarity: r.sim, score: relevanceScore(r.sim, r.salience, idle(r.last_accessed_at)), created_at: r.created_at, method: "keyword" });
    }
  }

  const out = [...found.values()]
    // the threshold applies to vector cosine similarity only; keyword rank (ts_rank_cd) is on a different, much smaller scale
    .filter((m) => m.method === "keyword" || m.similarity >= (opts.minSimilarity ?? 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  if (opts.reinforce !== false && out.length) {
    // Using a memory makes it more durable: bump access stats and salience (capped).
    await deps.db.query(
      "UPDATE memories SET access_count = access_count + 1, last_accessed_at = now(), salience = LEAST(1, salience + 0.02) WHERE id = ANY($1::uuid[])",
      [out.map((m) => m.id)],
    );
  }
  return out;
}

export type ConsolidationReport = { backfilled: number; merged: number; pruned: number };

/**
 * Housekeeping: (1) embed rows that lack an embedding, (2) merge exact and near duplicates within the same owner/scope/kind
 * (keeper's salience rises, duplicate is flagged consolidated_into), (3) prune stale never-used episodic memories and old merged rows.
 * Lessons and semantic facts are never auto-pruned.
 */
export async function consolidateMemories(deps: LlmDeps, opts: { similarity?: number } = {}): Promise<ConsolidationReport> {
  const { db } = deps;
  const report: ConsolidationReport = { backfilled: 0, merged: 0, pruned: 0 };

  const emb = await getEmbedder(deps).catch(() => null);
  if (emb) {
    const { rows } = await db.query("SELECT id, content FROM memories WHERE embedding IS NULL AND consolidated_into IS NULL ORDER BY created_at LIMIT 200");
    if (rows.length) {
      try {
        const vecs = await emb.embed(rows.map((r) => r.content));
        for (let i = 0; i < rows.length; i++) {
          await db.query("UPDATE memories SET embedding=$2::vector, embedding_model=$3 WHERE id=$1", [rows[i].id, toVectorLiteral(vecs[i]!), emb.modelName]);
          report.backfilled++;
        }
      } catch { /* try again next pass */ }
    }
  }

  // The keeper is the more salient memory, then the older one (never an arbitrary id ordering).
  type Pair = { a: string; b: string; a_sal: number; b_sal: number; a_at: Date; b_at: Date };
  const pick = (p: Pair): [string, string] => (p.a_sal > p.b_sal || (p.a_sal === p.b_sal && p.a_at <= p.b_at) ? [p.a, p.b] : [p.b, p.a]);
  const merge = async (keep: string, drop: string) => {
    const r = await db.query(
      `WITH d AS (UPDATE memories SET consolidated_into = $1 WHERE id = $2 AND consolidated_into IS NULL RETURNING salience, access_count)
       UPDATE memories k SET salience = LEAST(1, GREATEST(k.salience, d.salience) + 0.1), access_count = k.access_count + d.access_count
         FROM d WHERE k.id = $1 AND k.consolidated_into IS NULL RETURNING k.id`,
      [keep, drop],
    );
    if (r.rowCount) report.merged++;
  };

  // exact duplicates (case/whitespace-insensitive), no embedding needed
  const exact = await db.query(
    `SELECT a.id AS a, b.id AS b, a.salience AS a_sal, b.salience AS b_sal, a.created_at AS a_at, b.created_at AS b_at FROM memories a JOIN memories b
       ON a.id < b.id AND a.scope = b.scope AND a.kind = b.kind
      AND a.agent_id IS NOT DISTINCT FROM b.agent_id AND a.team_id IS NOT DISTINCT FROM b.team_id
      AND lower(regexp_replace(a.content, '\\s+', ' ', 'g')) = lower(regexp_replace(b.content, '\\s+', ' ', 'g'))
    WHERE a.consolidated_into IS NULL AND b.consolidated_into IS NULL LIMIT 500`,
  );
  for (const p of exact.rows as Pair[]) await merge(...pick(p));

  const thr = opts.similarity ?? 0.95;
  const near = await db.query(
    `SELECT a.id AS a, b.id AS b, a.salience AS a_sal, b.salience AS b_sal, a.created_at AS a_at, b.created_at AS b_at FROM memories a JOIN memories b
       ON a.id < b.id AND a.scope = b.scope AND a.kind = b.kind
      AND a.agent_id IS NOT DISTINCT FROM b.agent_id AND a.team_id IS NOT DISTINCT FROM b.team_id
      AND a.embedding_model = b.embedding_model AND vector_dims(a.embedding) = vector_dims(b.embedding)
      AND 1 - (a.embedding <=> b.embedding) >= $1
    WHERE a.consolidated_into IS NULL AND b.consolidated_into IS NULL AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL LIMIT 500`,
    [thr],
  );
  for (const p of near.rows as Pair[]) await merge(...pick(p)); // `merge` no-ops if a chain already consumed `drop`

  const pr = await db.query(
    `DELETE FROM memories
      WHERE (kind = 'episodic' AND access_count = 0 AND salience <= 0.3 AND created_at < now() - interval '60 days')
         OR (consolidated_into IS NOT NULL AND created_at < now() - interval '30 days')`,
  );
  report.pruned = pr.rowCount ?? 0;
  return report;
}
