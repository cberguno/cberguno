import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { authHook, requireRole } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import type { RunController } from "../runtime.js";
import { parse, pgToHttp } from "./util.js";

const routing = z.object({
  strategy: z.enum(["cheapest", "fastest", "quality"]).default("cheapest"),
  complexity: z.enum(["low", "medium", "high"]).default("medium"),
  minContext: z.number().int().positive().optional(),
  needsTools: z.boolean().optional(),
  needsVision: z.boolean().optional(),
  maxLatencyMs: z.number().int().positive().optional(),
  maxUsdPerMtokOut: z.number().positive().optional(),
});

/** Fields an operator may edit. */
const behaviour = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["orchestrator", "specialist", "research", "execution", "qa"]),
  role: z.string().min(1).max(200),
  goal: z.string().max(4000),
  instructions: z.string().max(20000),
  model_id: z.string().uuid().nullable(),
  routing,
});

/** Privilege-bearing fields: admin only. These bound what an agent can do or spend. */
const privileged = z.object({
  permissions: z
    .object({ tools: z.array(z.string().regex(/^[a-z][a-z0-9_]*\*?$/, "tool grants are exact names or a prefix ending in *")).max(200), memory_scope: z.enum(["agent", "team", "org"]) })
    .strict(),
  max_cost_usd_per_run: z.number().min(0).max(1000),
  daily_budget_usd: z.number().min(0).max(100000),
  run_timeout_ms: z.number().int().min(1000).max(3_600_000),
});

const PRIV_KEYS = Object.keys(privileged.shape);
const COLS = [...Object.keys(behaviour.shape), ...PRIV_KEYS];

export function agentRoutes(app: FastifyInstance, db: Db, cfg: Config, ctl: RunController) {
  const authed = { preHandler: [authHook(cfg.JWT_SECRET)] };
  const operator = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("operator")] };

  app.get("/api/agents", authed, async () => {
    const { rows } = await db.query(
      `SELECT a.*, m.display_name AS model_name,
              COALESCE((SELECT sum(cost_usd) FROM usage_events u WHERE u.agent_id=a.id AND u.at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0) AS spent_today_usd
         FROM agents a LEFT JOIN models m ON m.id=a.model_id ORDER BY a.name`,
    );
    return rows;
  });

  app.get("/api/agents/:id", authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const { rows } = await db.query("SELECT * FROM agents WHERE id=$1", [id]);
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      const versions = await db.query("SELECT version, changed_by, created_at FROM agent_versions WHERE agent_id=$1 ORDER BY version DESC", [id]);
      return { ...rows[0], versions: versions.rows };
    } catch (e) {
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    }
  });

  const createBody = behaviour.partial({ kind: true, goal: true, instructions: true, model_id: true, routing: true }).merge(privileged.partial());

  app.post("/api/agents", operator, async (req, reply) => {
    const b = parse(createBody, req.body, reply);
    if (!b) return;
    const touchesPriv = PRIV_KEYS.some((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (touchesPriv && req.actor!.role !== "admin") return reply.code(403).send({ error: "only an admin may set permissions, budgets or timeouts" });
    const v = {
      kind: "specialist", goal: "", instructions: "", model_id: null, routing: { strategy: "cheapest", complexity: "medium" },
      permissions: { tools: [], memory_scope: "agent" }, max_cost_usd_per_run: 0.5, daily_budget_usd: 5, run_timeout_ms: 120000,
      ...b,
    } as Record<string, unknown>;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cols = COLS.filter((c) => v[c] !== undefined);
      const { rows } = await client.query(
        `INSERT INTO agents(${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
        cols.map((c) => (typeof v[c] === "object" && v[c] !== null ? JSON.stringify(v[c]) : v[c])),
      );
      await client.query("INSERT INTO agent_versions(agent_id, version, snapshot, changed_by) VALUES ($1,1,$2,$3)", [
        rows[0].id, JSON.stringify(rows[0]), req.actor!.id,
      ]);
      await client.query("COMMIT");
      await audit(db, req.actor!, "agent.create", { type: "agent", id: rows[0].id }, b);
      return reply.code(201).send(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch("/api/agents/:id", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(behaviour.partial().merge(privileged.partial()), req.body, reply);
    if (!b) return;
    const entries = Object.entries(b).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return reply.code(400).send({ error: "nothing to update" });
    if (entries.some(([k]) => PRIV_KEYS.includes(k)) && req.actor!.role !== "admin") {
      await audit(db, req.actor!, "agent.privilege_change_denied", { type: "agent", id }, { fields: entries.map(([k]) => k) });
      return reply.code(403).send({ error: "only an admin may set permissions, budgets or timeouts" });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const set = entries.map(([k], i) => `${k}=$${i + 2}`).join(", "); // keys are from the zod schema, not the request
      const { rows } = await client.query(
        `UPDATE agents SET ${set}, version=version+1, updated_at=now() WHERE id=$1 AND status<>'terminated' RETURNING *`,
        [id, ...entries.map(([, v]) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v))],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "not found or terminated" });
      }
      await client.query("INSERT INTO agent_versions(agent_id, version, snapshot, changed_by) VALUES ($1,$2,$3,$4)", [
        id, rows[0].version, JSON.stringify(rows[0]), req.actor!.id,
      ]);
      await client.query("COMMIT");
      await audit(db, req.actor!, "agent.update", { type: "agent", id }, b);
      return rows[0];
    } catch (e) {
      await client.query("ROLLBACK");
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    } finally {
      client.release();
    }
  });

  // pause / resume / terminate. Terminated is final.
  app.post("/api/agents/:id/status", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ status: z.enum(["active", "paused", "terminated"]) }), req.body, reply);
    if (!b) return;
    const { rows } = await db.query("UPDATE agents SET status=$2, updated_at=now() WHERE id=$1 AND status<>'terminated' RETURNING id, status", [id, b.status]);
    if (!rows[0]) return reply.code(404).send({ error: "not found or already terminated" });
    // Pausing or terminating must actually stop work, not just block new runs.
    let cancelled = 0;
    if (b.status !== "active") {
      const running = await db.query("SELECT id FROM runs WHERE agent_id=$1 AND status='running'", [id]);
      for (const r of running.rows) if (ctl.cancel(r.id)) cancelled++;
    }
    await audit(db, req.actor!, `agent.${b.status}`, { type: "agent", id }, { cancelled_runs: cancelled });
    return { ...rows[0], cancelled_runs: cancelled };
  });

  // ---- teams ----
  app.get("/api/teams", authed, async () => {
    const teams = await db.query("SELECT * FROM teams ORDER BY name");
    const members = await db.query(
      `SELECT tm.team_id, tm.agent_id, tm.reports_to, a.name, a.role, a.kind, a.status FROM team_members tm JOIN agents a ON a.id=tm.agent_id`,
    );
    return teams.rows.map((t) => ({ ...t, members: members.rows.filter((m) => m.team_id === t.id) }));
  });

  app.post("/api/teams", operator, async (req, reply) => {
    const b = parse(z.object({ name: z.string().min(1).max(80), description: z.string().max(2000).default("") }), req.body, reply);
    if (!b) return;
    try {
      const { rows } = await db.query("INSERT INTO teams(name, description) VALUES ($1,$2) RETURNING *", [b.name, b.description]);
      await audit(db, req.actor!, "team.create", { type: "team", id: rows[0].id }, b);
      return reply.code(201).send(rows[0]);
    } catch (e) {
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    }
  });

  app.delete("/api/teams/:id", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("DELETE FROM teams WHERE id=$1", [id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not found" });
    await audit(db, req.actor!, "team.delete", { type: "team", id });
    return reply.code(204).send();
  });

  // Replace the whole membership/org-chart of a team atomically.
  app.put("/api/teams/:id/members", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(
      z.object({ members: z.array(z.object({ agent_id: z.string().uuid(), reports_to: z.string().uuid().nullable() })) }),
      req.body,
      reply,
    );
    if (!b) return;
    const ids = new Set(b.members.map((m) => m.agent_id));
    if (ids.size !== b.members.length) return reply.code(400).send({ error: "duplicate agent in members" });
    for (const m of b.members) {
      if (m.reports_to && !ids.has(m.reports_to)) return reply.code(400).send({ error: "reports_to must be a member of the same team" });
      if (m.reports_to === m.agent_id) return reply.code(400).send({ error: "an agent cannot report to itself" });
    }
    // cycle check: walk up from every node; a path longer than n means a cycle
    const parent = new Map(b.members.map((m) => [m.agent_id, m.reports_to]));
    for (const start of ids) {
      let cur: string | null | undefined = start;
      for (let hops = 0; cur; hops++) {
        if (hops > ids.size) return reply.code(400).send({ error: "reporting lines contain a cycle" });
        cur = parent.get(cur) ?? null;
      }
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const t = await client.query("SELECT 1 FROM teams WHERE id=$1 FOR UPDATE", [id]);
      if (!t.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "not found" });
      }
      await client.query("DELETE FROM team_members WHERE team_id=$1", [id]);
      for (const m of b.members) {
        await client.query("INSERT INTO team_members(team_id, agent_id, reports_to) VALUES ($1,$2,$3)", [id, m.agent_id, m.reports_to]);
      }
      await client.query("COMMIT");
      await audit(db, req.actor!, "team.set_members", { type: "team", id }, b);
      return { ok: true, count: b.members.length };
    } catch (e) {
      await client.query("ROLLBACK");
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    } finally {
      client.release();
    }
  });
}
