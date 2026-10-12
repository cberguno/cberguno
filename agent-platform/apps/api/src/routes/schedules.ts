import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { authHook, requireRole } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { createMission, MissionConfigError, PlanError, validateMissionTemplate } from "../missions.js";
import { nextRun, runScheduleNow, ScheduleError } from "../schedules.js";
import { parse, pgToHttp } from "./util.js";

const options = z.object({
  review: z.boolean(), max_tasks: z.number().int().min(2).max(50), max_depth: z.number().int().min(1).max(4), max_fanout: z.number().int().min(1).max(20),
  max_messages: z.number().int().min(3).max(1000), max_revisions: z.number().int().min(0).max(5), max_tool_steps: z.number().int().min(1).max(20),
}).partial();
const template = z.object({
  title: z.string().min(1).max(200), goal: z.string().min(1).max(20000), team_id: z.string().uuid(), orchestrator_id: z.string().uuid().optional(),
  options: options.optional(), max_cost_usd: z.number().positive().max(10000).optional(), plan: z.unknown().optional(),
});
const tz = z.string().refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "unknown timezone");

/** Workflow definition = the graph a human draws; `x`/`y` are canvas positions only. */
const workflowDef = z.object({
  tasks: z.array(z.object({
    key: z.string().regex(/^[a-z0-9_-]{1,40}$/i), title: z.string().min(1).max(200), assignee: z.string().min(1), input: z.string().min(1).max(8000),
    depends_on: z.array(z.string()).default([]), x: z.number().optional(), y: z.number().optional(),
  })).min(1).max(40),
});
const toPlan = (def: z.infer<typeof workflowDef>) => ({ tasks: def.tasks.map(({ x: _x, y: _y, ...t }) => t) });

export function scheduleRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const authed = { preHandler: [authHook(cfg.JWT_SECRET)] };
  const operator = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("operator")] };
  const fail = (reply: any, e: unknown) => {
    if (e instanceof ScheduleError || e instanceof MissionConfigError || e instanceof PlanError) return reply.code(e.message === "not found" ? 404 : 400).send({ error: e.message });
    const h = pgToHttp(e);
    if (h) return reply.code(h.code).send({ error: h.error });
    throw e;
  };

  // ---------- schedules ----------
  app.get("/api/schedules", authed, async () => (await db.query(
    `SELECT s.*, t.name AS team_name, (SELECT status FROM missions m WHERE m.schedule_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS last_mission_status,
            (SELECT id FROM missions m WHERE m.schedule_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS last_mission_id
       FROM schedules s LEFT JOIN teams t ON t.id = (s.mission->>'team_id')::uuid ORDER BY s.name`)).rows);

  app.post("/api/schedules", operator, async (req, reply) => {
    const b = parse(z.object({ name: z.string().min(1).max(100), cron: z.string().min(9).max(100), timezone: tz.default("UTC"), mission: template, overlap: z.enum(["skip", "allow"]).default("skip"), enabled: z.boolean().default(true) }), req.body, reply);
    if (!b) return;
    try {
      const next = nextRun(b.cron, b.timezone, new Date());
      await validateMissionTemplate(db, { teamId: b.mission.team_id, orchestratorId: b.mission.orchestrator_id, options: b.mission.options, plan: b.mission.plan });
      const { rows } = await db.query(
        "INSERT INTO schedules(name, cron, timezone, mission, overlap, enabled, next_run_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, next_run_at",
        [b.name, b.cron, b.timezone, JSON.stringify(b.mission), b.overlap, b.enabled, next, req.actor!.id],
      );
      await audit(db, req.actor!, "schedule.create", { type: "schedule", id: rows[0].id }, { name: b.name, cron: b.cron, timezone: b.timezone, team_id: b.mission.team_id, max_cost_usd: b.mission.max_cost_usd });
      return reply.code(201).send(rows[0]);
    } catch (e) { return fail(reply, e); }
  });

  app.patch("/api/schedules/:id", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ name: z.string().min(1).max(100), cron: z.string().min(9).max(100), timezone: tz, mission: template, overlap: z.enum(["skip", "allow"]), enabled: z.boolean() }).partial(), req.body, reply);
    if (!b) return;
    try {
      const cur = (await db.query("SELECT * FROM schedules WHERE id=$1", [id])).rows[0];
      if (!cur) return reply.code(404).send({ error: "not found" });
      const cron = b.cron ?? cur.cron, zone = b.timezone ?? cur.timezone, mission = b.mission ?? cur.mission;
      const next = nextRun(cron, zone, new Date());
      if (b.mission) await validateMissionTemplate(db, { teamId: mission.team_id, orchestratorId: mission.orchestrator_id, options: mission.options, plan: mission.plan });
      const { rows } = await db.query(
        `UPDATE schedules SET name=$2, cron=$3, timezone=$4, mission=$5, overlap=$6, enabled=$7, next_run_at=$8, last_error=NULL WHERE id=$1 RETURNING id, name, enabled, next_run_at`,
        [id, b.name ?? cur.name, cron, zone, JSON.stringify(mission), b.overlap ?? cur.overlap, b.enabled ?? cur.enabled, next],
      );
      await audit(db, req.actor!, "schedule.update", { type: "schedule", id }, { ...b });
      return rows[0];
    } catch (e) { return fail(reply, e); }
  });

  app.delete("/api/schedules/:id", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("DELETE FROM schedules WHERE id=$1", [id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not found" });
    await audit(db, req.actor!, "schedule.delete", { type: "schedule", id });
    return reply.code(204).send();
  });

  app.post("/api/schedules/:id/run-now", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const missionId = await runScheduleNow(db, id, req.actor!.id);
      await audit(db, req.actor!, "schedule.run_now", { type: "schedule", id }, { mission_id: missionId });
      return reply.code(201).send({ id: missionId });
    } catch (e) { return fail(reply, e); }
  });

  // ---------- workflows (the visual builder's storage) ----------
  app.get("/api/workflows", authed, async () => (await db.query("SELECT id, name, description, definition, updated_at FROM workflows ORDER BY name")).rows);

  app.post("/api/workflows", operator, async (req, reply) => {
    const b = parse(z.object({ name: z.string().min(1).max(100), description: z.string().max(2000).default(""), definition: workflowDef }), req.body, reply);
    if (!b) return;
    try {
      const { rows } = await db.query("INSERT INTO workflows(name, description, definition, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name", [b.name, b.description, JSON.stringify(b.definition), req.actor!.id]);
      await audit(db, req.actor!, "workflow.create", { type: "workflow", id: rows[0].id }, { name: b.name, tasks: b.definition.tasks.length });
      return reply.code(201).send(rows[0]);
    } catch (e) { return fail(reply, e); }
  });

  app.put("/api/workflows/:id", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ name: z.string().min(1).max(100), description: z.string().max(2000).default(""), definition: workflowDef }), req.body, reply);
    if (!b) return;
    try {
      const r = await db.query("UPDATE workflows SET name=$2, description=$3, definition=$4, updated_at=now() WHERE id=$1 RETURNING id, name", [id, b.name, b.description, JSON.stringify(b.definition)]);
      if (!r.rowCount) return reply.code(404).send({ error: "not found" });
      await audit(db, req.actor!, "workflow.update", { type: "workflow", id }, { name: b.name, tasks: b.definition.tasks.length });
      return r.rows[0];
    } catch (e) { return fail(reply, e); }
  });

  app.delete("/api/workflows/:id", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("DELETE FROM workflows WHERE id=$1", [id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not found" });
    await audit(db, req.actor!, "workflow.delete", { type: "workflow", id });
    return reply.code(204).send();
  });

  /** Check a drawn graph against a team without running it: unknown assignees, cycles, limits. */
  app.post("/api/workflows/validate", operator, async (req, reply) => {
    const b = parse(z.object({ team_id: z.string().uuid(), definition: workflowDef }), req.body, reply);
    if (!b) return;
    try {
      await validateMissionTemplate(db, { teamId: b.team_id, plan: toPlan(b.definition) });
      return { ok: true };
    } catch (e) {
      if (e instanceof PlanError || e instanceof MissionConfigError) return { ok: false, error: e.message };
      return fail(reply, e);
    }
  });

  app.post("/api/workflows/:id/run", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ team_id: z.string().uuid(), title: z.string().min(1).max(200).optional(), goal: z.string().min(1).max(20000), max_cost_usd: z.number().positive().max(10000).optional(), options: options.optional() }), req.body, reply);
    if (!b) return;
    const wf = (await db.query("SELECT name, definition FROM workflows WHERE id=$1", [id])).rows[0];
    if (!wf) return reply.code(404).send({ error: "not found" });
    try {
      const missionId = await createMission(db, { title: b.title ?? wf.name, goal: b.goal, teamId: b.team_id, plan: toPlan(wf.definition), maxCostUsd: b.max_cost_usd, options: b.options, createdBy: req.actor!.id });
      await audit(db, req.actor!, "workflow.run", { type: "workflow", id }, { mission_id: missionId });
      return reply.code(201).send({ id: missionId });
    } catch (e) { return fail(reply, e); }
  });
}
