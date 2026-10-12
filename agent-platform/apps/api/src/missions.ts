import { z } from "zod";
import type { Db } from "./db.js";
import { postMessage } from "./messages.js";
import { type Q } from "./queue.js";

export type MissionOptions = { review: boolean; max_tasks: number; max_depth: number; max_fanout: number; max_messages: number; max_revisions: number; max_tool_steps: number };
export const DEFAULT_OPTIONS: MissionOptions = { review: false, max_tasks: 12, max_depth: 2, max_fanout: 6, max_messages: 80, max_revisions: 1, max_tool_steps: 8 };

export type RosterAgent = { id: string; name: string; role: string; kind: string; status: string };

export class PlanError extends Error {}

const taskSpec = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/i, "key must be 1-40 chars of letters, digits, _ or -"),
  title: z.string().min(1).max(200),
  assignee: z.string().min(1),
  input: z.string().min(1).max(8000),
  depends_on: z.array(z.string()).default([]),
});
export const planSchema = z.object({ tasks: z.array(taskSpec).min(1) });
export type TaskSpec = z.infer<typeof taskSpec> & { assignee_id: string };

/** Lenient: model may wrap JSON in prose or code fences. Used for plans/verdicts where JSON is the contract. */
export function extractJson(text: string): unknown | undefined {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return undefined;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return undefined; }
}

/** Strict: only treat output as a control message if the *whole* reply is a JSON object (so results that merely contain JSON are not misread). */
export function parseControl(text: string): Record<string, any> | undefined {
  const t = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return undefined;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch { return undefined; }
}

export function validatePlan(raw: unknown, roster: RosterAgent[], limit: { maxTasks: number; existing: number; maxFanout?: number }): TaskSpec[] {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) throw new PlanError(`plan JSON invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const tasks = parsed.data.tasks;
  if (limit.maxFanout !== undefined && tasks.length > limit.maxFanout) throw new PlanError(`at most ${limit.maxFanout} subtasks allowed, got ${tasks.length}`);
  if (limit.existing + tasks.length > limit.maxTasks) throw new PlanError(`plan would exceed the mission task limit of ${limit.maxTasks}`);
  const keys = new Set<string>();
  for (const t of tasks) {
    if (t.key.toLowerCase() === "plan" || t.key.toLowerCase() === "synthesize") throw new PlanError(`key "${t.key}" is reserved`);
    if (keys.has(t.key)) throw new PlanError(`duplicate task key "${t.key}"`);
    keys.add(t.key);
  }
  const byName = new Map(roster.filter((a) => a.status === "active").map((a) => [a.name.toLowerCase(), a]));
  const specs = tasks.map((t) => {
    const a = byName.get(t.assignee.toLowerCase());
    if (!a) throw new PlanError(`assignee "${t.assignee}" is not an active member of this team (members: ${[...byName.values()].map((x) => x.name).join(", ")})`);
    for (const d of t.depends_on) {
      if (!keys.has(d)) throw new PlanError(`task "${t.key}" depends on unknown key "${d}"`);
      if (d === t.key) throw new PlanError(`task "${t.key}" depends on itself`);
    }
    return { ...t, assignee_id: a.id };
  });
  // acyclic: Kahn's algorithm
  const indeg = new Map(specs.map((s) => [s.key, s.depends_on.length]));
  const queue = specs.filter((s) => s.depends_on.length === 0).map((s) => s.key);
  let seen = 0;
  while (queue.length) {
    const k = queue.pop()!;
    seen++;
    for (const s of specs) if (s.depends_on.includes(k)) { indeg.set(s.key, indeg.get(s.key)! - 1); if (indeg.get(s.key) === 0) queue.push(s.key); }
  }
  if (seen !== specs.length) throw new PlanError("plan has a dependency cycle");
  return specs;
}

export async function rosterFor(q: Q, teamId: string): Promise<RosterAgent[]> {
  const { rows } = await q.query(
    `SELECT a.id, a.name, a.role, a.kind, a.status FROM team_members tm JOIN agents a ON a.id = tm.agent_id WHERE tm.team_id = $1 ORDER BY a.name`,
    [teamId],
  );
  return rows;
}

type MissionRef = { id: string; orchestrator_id: string };
type ParentRef = { id: string; key: string; assignee_id: string; depth: number } | null;

/**
 * Insert planned tasks. `ON CONFLICT DO NOTHING` on (mission_id,key) makes this idempotent: replaying an expansion
 * (e.g. after a crash between steps) can never create duplicate tasks.
 * Child keys of a delegating task are prefixed with the parent's key so they cannot collide with the top-level plan.
 */
export async function expandTasks(q: Q, mission: MissionRef, parent: ParentRef, specs: TaskSpec[], assignerId: string): Promise<string[]> {
  const prefix = parent ? `${parent.key}.` : "";
  const depth = parent ? parent.depth + 1 : 1;
  const keys: string[] = [];
  for (const s of specs) {
    const key = prefix + s.key;
    const deps = s.depends_on.map((d) => prefix + d);
    const ins = await q.query(
      `INSERT INTO tasks(mission_id, parent_task_id, key, kind, title, input, assignee_id, assigner_id, depends_on, status, depth)
       VALUES ($1,$2,$3,'work',$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (mission_id, key) DO NOTHING RETURNING id`,
      [mission.id, parent?.id ?? null, key, s.title, s.input, s.assignee_id, assignerId, deps, deps.length ? "waiting" : "queued", depth],
    );
    keys.push(key);
    if (ins.rowCount) {
      await postMessage(q, { missionId: mission.id, taskId: ins.rows[0].id, from: { kind: "agent", id: assignerId }, to: { kind: "agent", id: s.assignee_id }, type: "task.assign", body: { task_key: key, title: s.title } });
    }
  }
  return keys;
}

export async function addSynthesizeTask(q: Q, mission: MissionRef & { goal?: string }, workKeys: string[], goal: string) {
  await q.query(
    `INSERT INTO tasks(mission_id, key, kind, title, input, assignee_id, depends_on, status, depth)
     VALUES ($1,'synthesize','synthesize','Synthesize final deliverable',$2,$3,$4,'waiting',0) ON CONFLICT (mission_id, key) DO NOTHING`,
    [mission.id, goal, mission.orchestrator_id, workKeys],
  );
}

export type NewMission = {
  title: string; goal: string; teamId: string; orchestratorId?: string;
  options?: Partial<MissionOptions>; maxCostUsd?: number;
  /** A human-authored task graph. When present the orchestrator's planning call is skipped. */
  plan?: unknown; createdBy?: string | null;
  scheduleId?: string; scheduledFor?: Date;
};

export class MissionConfigError extends Error {}

/** Everything createMission checks, without writing: used to vet schedule/workflow templates up front. */
export async function validateMissionTemplate(db: Db, m: Pick<NewMission, "teamId" | "orchestratorId" | "options" | "plan">): Promise<void> {
  await prepare(db, m as NewMission);
}

async function prepare(db: Db, m: NewMission) {
  const roster = await rosterFor(db, m.teamId);
  if (roster.length === 0) throw new MissionConfigError("team has no members");
  const orch = m.orchestratorId
    ? roster.find((a) => a.id === m.orchestratorId)
    : roster.find((a) => a.kind === "orchestrator" && a.status === "active");
  if (!orch) throw new MissionConfigError(m.orchestratorId ? "orchestrator must be a member of the team" : "team has no active orchestrator agent; pick one explicitly");
  if (orch.status !== "active") throw new MissionConfigError("orchestrator is not active");
  const options: MissionOptions = { ...DEFAULT_OPTIONS, ...m.options };
  if (options.review && !roster.some((a) => a.kind === "qa" && a.status === "active")) throw new MissionConfigError("review requires an active QA agent on the team");
  const specs = m.plan !== undefined ? validatePlan(m.plan, roster, { maxTasks: options.max_tasks - 1, existing: 0 }) : null;
  return { orch, options, specs };
}

export async function createMission(db: Db, m: NewMission): Promise<string> {
  const { orch, options, specs } = await prepare(db, m);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO missions(title, goal, team_id, orchestrator_id, options, max_cost_usd, created_by, schedule_id, scheduled_for) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [m.title, m.goal, m.teamId, orch.id, JSON.stringify(options), m.maxCostUsd ?? 2, m.createdBy ?? null, m.scheduleId ?? null, m.scheduledFor ?? null],
    );
    const mission = { id: rows[0].id as string, orchestrator_id: orch.id };
    if (specs) {
      const keys = await expandTasks(client, mission, null, specs, orch.id);
      await addSynthesizeTask(client, mission, keys, m.goal);
    } else {
      await client.query(
        `INSERT INTO tasks(mission_id, key, kind, title, input, assignee_id, status, depth) VALUES ($1,'plan','plan','Plan the mission',$2,$3,'queued',0)`,
        [mission.id, m.goal, orch.id],
      );
    }
    await client.query("COMMIT");
    return mission.id;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelMission(db: Db, missionId: string): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`UPDATE missions SET status='cancelled', finished_at=now() WHERE id=$1 AND status IN ('running','needs_human') RETURNING id`, [missionId]);
    if (r.rowCount) {
      await client.query(`UPDATE tasks SET status='cancelled', finished_at=now(), locked_by=NULL WHERE mission_id=$1 AND status IN ('waiting','queued','running','blocked','in_review','awaiting_approval','failed','escalated')`, [missionId]);
      await client.query(`UPDATE approval_requests SET status='expired', decided_at=now(), decision_note='mission cancelled' WHERE mission_id=$1 AND status='pending'`, [missionId]);
    }
    await client.query("COMMIT");
    return (r.rowCount ?? 0) > 0;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Human decision after an escalation: retry the stuck tasks and let the mission continue. False if there is nothing to retry. */
export async function resumeMission(db: Db, missionId: string): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const m = await client.query(`SELECT 1 FROM missions WHERE id=$1 AND status='needs_human' FOR UPDATE`, [missionId]);
    const t = m.rowCount
      ? await client.query(
          `UPDATE tasks SET status='queued', attempt=0, error=NULL, finished_at=NULL, run_after=now(), locked_by=NULL, lease_expires_at=NULL WHERE mission_id=$1 AND status IN ('failed','escalated') RETURNING id`,
          [missionId],
        )
      : null;
    if (!t || !t.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(`UPDATE missions SET status='running', escalation_reason=NULL, error=NULL WHERE id=$1`, [missionId]);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Human accepts the result of a mission that stopped on reported conflicts (its synthesis already ran). */
export async function acceptMission(db: Db, missionId: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE missions SET status='succeeded', finished_at=now(), escalation_reason=NULL
      WHERE id=$1 AND status='needs_human' AND output IS NOT NULL
        AND EXISTS (SELECT 1 FROM tasks WHERE mission_id=$1 AND key='synthesize' AND status='done') RETURNING id`,
    [missionId],
  );
  return (r.rowCount ?? 0) > 0;
}
