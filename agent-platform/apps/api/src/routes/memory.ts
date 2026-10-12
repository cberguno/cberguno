import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { authHook, requireRole } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import type { LlmDeps } from "../llm.js";
import { actorForAgent, consolidateMemories, searchMemories, writeMemory } from "../memory.js";
import { parse, pgToHttp } from "./util.js";

export function memoryRoutes(app: FastifyInstance, db: Db, cfg: Config, llm: LlmDeps) {
  const authed = { preHandler: [authHook(cfg.JWT_SECRET)] };
  const operator = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("operator")] };
  const admin = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("admin")] };

  app.get("/api/memories", authed, async (req) => {
    const q = req.query as { agent_id?: string; scope?: string; kind?: string; limit?: string };
    const { rows } = await db.query(
      `SELECT m.id, m.kind, m.scope, m.agent_id, a.name AS agent_name, m.team_id, m.content, m.salience, m.access_count, m.embedding_model, (m.embedding IS NOT NULL) AS embedded,
              m.consolidated_into, m.source, m.created_at, m.last_accessed_at
         FROM memories m LEFT JOIN agents a ON a.id = m.agent_id
        WHERE ($1::uuid IS NULL OR m.agent_id = $1) AND ($2::text IS NULL OR m.scope = $2) AND ($3::text IS NULL OR m.kind = $3) AND m.consolidated_into IS NULL
        ORDER BY m.created_at DESC LIMIT $4`,
      [q.agent_id ?? null, q.scope ?? null, q.kind ?? null, Math.min(parseInt(q.limit ?? "100", 10) || 100, 500)],
    );
    return rows;
  });

  // "What would this agent recall?" — runs the exact retrieval an agent task would, including its scope limits.
  app.get("/api/memories/search", authed, async (req, reply) => {
    const q = parse(z.object({ agent_id: z.string().uuid(), q: z.string().min(1), k: z.coerce.number().int().min(1).max(20).default(5) }), req.query, reply);
    if (!q) return;
    const actor = await actorForAgent(db, q.agent_id);
    return searchMemories(llm, actor, q.q, { k: q.k, reinforce: false });
  });

  app.post("/api/memories", operator, async (req, reply) => {
    const b = parse(z.object({
      kind: z.enum(["semantic", "lesson", "episodic"]), scope: z.enum(["agent", "team", "org"]),
      agent_id: z.string().uuid().optional(), team_id: z.string().uuid().optional(),
      content: z.string().min(1).max(4000), salience: z.number().min(0).max(1).optional(),
    }), req.body, reply);
    if (!b) return;
    if (b.scope === "org" && req.actor!.role !== "admin") return reply.code(403).send({ error: "only an admin may write organisation-wide memory" });
    if (b.scope === "agent" && !b.agent_id) return reply.code(400).send({ error: "agent_id required for agent scope" });
    if (b.scope === "team" && !b.team_id) return reply.code(400).send({ error: "team_id required for team scope" });
    try {
      const id = await writeMemory(llm, { kind: b.kind, scope: b.scope, agentId: b.agent_id ?? null, teamId: b.team_id ?? null, content: b.content, salience: b.salience, source: { by_user: req.actor!.id } });
      await audit(db, req.actor!, "memory.create", { type: "memory", id }, { scope: b.scope, kind: b.kind });
      return reply.code(201).send({ id });
    } catch (e) {
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    }
  });

  app.delete("/api/memories/:id", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("DELETE FROM memories WHERE id=$1", [id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not found" });
    await audit(db, req.actor!, "memory.delete", { type: "memory", id });
    return reply.code(204).send();
  });

  app.post("/api/memories/consolidate", admin, async (req) => {
    const report = await consolidateMemories(llm);
    await audit(db, req.actor!, "memory.consolidate", undefined, report);
    return report;
  });

  app.get("/api/settings/embedding", authed, async () => {
    const { rows } = await db.query(`SELECT m.id, m.display_name, m.model_name FROM settings s JOIN models m ON m.id = (s.value->>'model_id')::uuid WHERE s.key='embedding_model_id'`);
    return { model: rows[0] ?? null };
  });

  app.put("/api/settings/embedding", admin, async (req, reply) => {
    const b = parse(z.object({ model_id: z.string().uuid().nullable() }), req.body, reply);
    if (!b) return;
    if (b.model_id === null) await db.query("DELETE FROM settings WHERE key='embedding_model_id'");
    else {
      const m = await db.query("SELECT kind FROM models WHERE id=$1", [b.model_id]);
      if (!m.rows[0]) return reply.code(404).send({ error: "model not found" });
      if (m.rows[0].kind !== "embedding") return reply.code(400).send({ error: "model is not an embedding model" });
      await db.query(`INSERT INTO settings(key, value) VALUES ('embedding_model_id', $1) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`, [JSON.stringify({ model_id: b.model_id })]);
    }
    await audit(db, req.actor!, "settings.embedding", undefined, b);
    return { ok: true };
  });
}
