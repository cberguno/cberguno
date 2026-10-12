import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { authHook, requireRole } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { acceptMission, cancelMission, createMission, MissionConfigError, PlanError, resumeMission } from "../missions.js";
import { parse, pgToHttp } from "./util.js";

const options = z.object({
  review: z.boolean(), max_tasks: z.number().int().min(2).max(50), max_depth: z.number().int().min(1).max(4),
  max_fanout: z.number().int().min(1).max(20), max_messages: z.number().int().min(3).max(1000), max_revisions: z.number().int().min(0).max(5),
}).partial();

export function missionRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const authed = { preHandler: [authHook(cfg.JWT_SECRET)] };
  const operator = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("operator")] };
  const bad = (e: unknown) => pgToHttp(e);

  app.post("/api/missions", operator, async (req, reply) => {
    const b = parse(z.object({
      title: z.string().min(1).max(200), goal: z.string().min(1).max(20000), team_id: z.string().uuid(),
      orchestrator_id: z.string().uuid().optional(), options: options.optional(), max_cost_usd: z.number().positive().max(10000).optional(),
      plan: z.unknown().optional(),
    }), req.body, reply);
    if (!b) return;
    try {
      const id = await createMission(db, { title: b.title, goal: b.goal, teamId: b.team_id, orchestratorId: b.orchestrator_id, options: b.options, maxCostUsd: b.max_cost_usd, plan: b.plan, createdBy: req.actor!.id });
      await audit(db, req.actor!, "mission.create", { type: "mission", id }, { title: b.title, team_id: b.team_id, max_cost_usd: b.max_cost_usd, has_plan: b.plan !== undefined });
      return reply.code(201).send({ id });
    } catch (e) {
      if (e instanceof MissionConfigError || e instanceof PlanError) return reply.code(400).send({ error: (e as Error).message });
      const h = bad(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    }
  });

  app.get("/api/missions", authed, async () => {
    const { rows } = await db.query(
      `SELECT m.id, m.title, m.status, m.team_id, t.name AS team_name, m.max_cost_usd, m.escalation_reason, m.created_at, m.finished_at,
              COALESCE((SELECT sum(cost_usd) FROM usage_events u WHERE u.mission_id=m.id),0) AS cost_usd,
              (SELECT count(*)::int FROM tasks k WHERE k.mission_id=m.id) AS tasks_total,
              (SELECT count(*)::int FROM tasks k WHERE k.mission_id=m.id AND k.status='done') AS tasks_done
         FROM missions m JOIN teams t ON t.id=m.team_id ORDER BY m.created_at DESC LIMIT 100`,
    );
    return rows;
  });

  app.get("/api/missions/:id", authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const m = (await db.query(
        `SELECT m.*, t.name AS team_name, a.name AS orchestrator_name, COALESCE((SELECT sum(cost_usd) FROM usage_events u WHERE u.mission_id=m.id),0) AS cost_usd
           FROM missions m JOIN teams t ON t.id=m.team_id JOIN agents a ON a.id=m.orchestrator_id WHERE m.id=$1`, [id])).rows[0];
      if (!m) return reply.code(404).send({ error: "not found" });
      const tasks = (await db.query(
        `SELECT k.id, k.parent_task_id, k.key, k.kind, k.title, k.status, k.depends_on, k.attempt, k.max_attempts, k.revision, k.depth, k.output, k.error, k.assignee_id, a.name AS assignee_name,
                k.started_at, k.finished_at, COALESCE((SELECT sum(cost_usd) FROM usage_events u WHERE u.task_id=k.id),0) AS cost_usd
           FROM tasks k JOIN agents a ON a.id=k.assignee_id WHERE k.mission_id=$1 ORDER BY k.created_at`, [id])).rows;
      const messages = (await db.query(
        `SELECT ms.id, ms.type, ms.channel, ms.from_kind, ms.from_id, fa.name AS from_name, ms.to_kind, ms.to_id, ta.name AS to_name, ms.body, ms.refs, ms.created_at
           FROM messages ms LEFT JOIN agents fa ON fa.id=ms.from_id LEFT JOIN agents ta ON ta.id=ms.to_id WHERE ms.mission_id=$1 ORDER BY ms.created_at, ms.id`, [id])).rows;
      return { ...m, tasks, messages };
    } catch (e) {
      const h = bad(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    }
  });

  const act = (name: string, fn: (db: Db, id: string) => Promise<boolean>, missing: string) =>
    app.post(`/api/missions/:id/${name}`, operator, async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        if (!(await fn(db, id))) return reply.code(409).send({ error: missing });
      } catch (e) {
        const h = bad(e);
        if (h) return reply.code(h.code).send({ error: h.error });
        throw e;
      }
      await audit(db, req.actor!, `mission.${name}`, { type: "mission", id });
      return { ok: true };
    });
  act("cancel", cancelMission, "mission is not running or waiting for a human");
  act("resume", resumeMission, "nothing to retry: mission is not waiting for a human, or has no failed tasks");
  act("accept", acceptMission, "mission has no completed synthesis awaiting acceptance");
}
