import { CronExpressionParser } from "cron-parser";
import type { Db } from "./db.js";
import { createMission, type NewMission } from "./missions.js";

export class ScheduleError extends Error {}

/** Next fire time strictly after `from`, in the schedule's timezone (DST-aware). Throws ScheduleError on a bad cron/timezone. */
export function nextRun(cron: string, timezone: string, from: Date): Date {
  try {
    if (cron.trim().split(/\s+/).length !== 5) throw new Error("expected 5 fields: minute hour day-of-month month day-of-week");
    return CronExpressionParser.parse(cron, { currentDate: from, tz: timezone }).next().toDate();
  } catch (e) {
    throw new ScheduleError(`invalid schedule: ${(e as Error).message}`);
  }
}

export type MissionTemplate = {
  title: string; goal: string; team_id: string; orchestrator_id?: string; options?: NewMission["options"]; max_cost_usd?: number; plan?: unknown;
};

const toNewMission = (t: MissionTemplate, createdBy: string | null, title: string): NewMission => ({
  title, goal: t.goal, teamId: t.team_id, orchestratorId: t.orchestrator_id, options: t.options, maxCostUsd: t.max_cost_usd, plan: t.plan, createdBy,
});

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * Start missions for schedules that are due. Safe to run from every worker at once:
 *  - rows are claimed with FOR UPDATE SKIP LOCKED;
 *  - a unique index on (schedule_id, scheduled_for) means even a double fire creates one mission;
 *  - after downtime only ONE catch-up mission is started (no flood), then the schedule resumes from now.
 */
export async function fireDueSchedules(db: Db, now = new Date()): Promise<number> {
  const client = await db.connect();
  let fired = 0;
  try {
    await client.query("BEGIN");
    const due = (await client.query("SELECT * FROM schedules WHERE enabled AND next_run_at <= $1 ORDER BY next_run_at LIMIT 20 FOR NO KEY UPDATE SKIP LOCKED", [now])).rows;
    for (const s of due) {
      const slot = new Date(s.next_run_at);
      let note: string | null = null;
      try {
        const active = s.overlap === "skip"
          ? (await client.query("SELECT 1 FROM missions WHERE schedule_id=$1 AND status IN ('running','needs_human') LIMIT 1", [s.id])).rowCount
          : 0;
        if (active) note = `skipped ${stamp(slot)}: previous run still active`;
        else {
          await createMission(db, { ...toNewMission(s.mission, s.created_by, `${s.mission.title} — ${stamp(slot)}`), scheduleId: s.id, scheduledFor: slot });
          fired++;
        }
      } catch (e) {
        if ((e as { code?: string }).code === "23505") note = null; // another worker already fired this exact slot
        else note = `failed ${stamp(slot)}: ${(e as Error).message}`.slice(0, 500);
      }
      await client.query("UPDATE schedules SET last_run_at=$2, last_error=$3, next_run_at=$4 WHERE id=$1", [s.id, note?.startsWith("skipped") ? s.last_run_at : now, note, nextRun(s.cron, s.timezone, now)]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return fired;
}

/** Fire one schedule now, regardless of its timetable (does not move next_run_at). */
export async function runScheduleNow(db: Db, id: string, by: string | null): Promise<string> {
  const s = (await db.query("SELECT * FROM schedules WHERE id=$1", [id])).rows[0];
  if (!s) throw new ScheduleError("not found");
  const slot = new Date();
  return createMission(db, { ...toNewMission(s.mission, by ?? s.created_by, `${s.mission.title} — manual ${stamp(slot)}`), scheduleId: s.id, scheduledFor: slot });
}
