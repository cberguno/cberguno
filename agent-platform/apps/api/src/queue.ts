import type { Db } from "./db.js";
import { postMessage } from "./messages.js";

export type Q = { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export type TaskRow = {
  id: string; mission_id: string; parent_task_id: string | null; key: string;
  kind: "plan" | "work" | "review" | "answer" | "synthesize";
  title: string; input: string; assignee_id: string; assigner_id: string | null; depends_on: string[];
  status: string; attempt: number; max_attempts: number; output: string | null; error: string | null;
  structured: any; depth: number; revision: number; meta: Record<string, any>; locked_by: string | null;
};

const OPEN = ["waiting", "queued", "running", "blocked", "in_review"];

/** Atomically take one runnable task under a lease. SKIP LOCKED makes concurrent workers safe. */
export async function claimTask(db: Db, workerId: string, leaseMs: number): Promise<TaskRow | null> {
  const { rows } = await db.query(
    `UPDATE tasks SET status='running', locked_by=$1, lease_expires_at = now() + ($2 || ' milliseconds')::interval,
            attempt = attempt + 1, started_at = COALESCE(started_at, now())
      WHERE id = (SELECT t.id FROM tasks t JOIN missions m ON m.id = t.mission_id
                   WHERE t.status='queued' AND t.run_after <= now() AND m.status='running'
                   ORDER BY t.run_after, t.created_at FOR UPDATE OF t SKIP LOCKED LIMIT 1)
      RETURNING *`,
    [workerId, String(leaseMs)],
  );
  return (rows[0] as TaskRow) ?? null;
}

export async function heartbeat(db: Db, taskId: string, workerId: string, leaseMs: number): Promise<boolean> {
  const r = await db.query(
    `UPDATE tasks SET lease_expires_at = now() + ($3 || ' milliseconds')::interval WHERE id=$1 AND locked_by=$2 AND status='running'`,
    [taskId, workerId, String(leaseMs)],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Put a task claimed by a worker that is shutting down (not crashing) back without charging an attempt. */
export async function releaseTask(db: Db, taskId: string, workerId: string, delayMs = 0): Promise<void> {
  await db.query(
    `UPDATE tasks SET status='queued', locked_by=NULL, lease_expires_at=NULL, attempt=GREATEST(attempt-1,0), run_after = now() + ($3 || ' milliseconds')::interval
      WHERE id=$1 AND locked_by=$2 AND status='running'`,
    [taskId, workerId, String(delayMs)],
  );
}

/**
 * Run `fn` in one transaction, but only if this worker still owns the task (status running AND locked_by me).
 * If the lease was lost and another worker took over, this returns false and writes nothing: no duplicated side effects.
 */
export async function completeWith(db: Db, task: TaskRow, workerId: string, fn: (c: Q) => Promise<void>): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Lock order is always mission -> task. Serialising completions per mission is what makes releaseReady correct:
    // two tasks finishing at once would otherwise each miss the other's uncommitted "done" and never unlock their dependent.
    await client.query("SELECT 1 FROM missions WHERE id=$1 FOR UPDATE", [task.mission_id]);
    const own = await client.query("SELECT 1 FROM tasks WHERE id=$1 AND status='running' AND locked_by=$2 FOR UPDATE", [task.id, workerId]);
    if (!own.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await fn(client);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Unlock waiting tasks whose dependencies are all done. Call inside the transaction that finished a task. */
export async function releaseReady(q: Q, missionId: string): Promise<void> {
  await q.query(
    `UPDATE tasks t SET status='queued', run_after=now()
      WHERE t.mission_id=$1 AND t.status='waiting'
        AND NOT EXISTS (SELECT 1 FROM unnest(t.depends_on) k
                         WHERE NOT EXISTS (SELECT 1 FROM tasks d WHERE d.mission_id=t.mission_id AND d.key=k AND d.status='done'))`,
    [missionId],
  );
}

export async function escalateMission(db: Db | Q, missionId: string, reason: string, taskKey?: string): Promise<void> {
  const r = await db.query(
    `UPDATE missions SET status='needs_human', escalation_reason=$2 WHERE id=$1 AND status='running' RETURNING id, orchestrator_id`,
    [missionId, reason],
  );
  if (!r.rowCount) return;
  // `force`: the message budget is exactly why we may be escalating, so the escalation itself must always be recorded.
  await postMessage(db as Q, { missionId, from: { kind: "system" }, to: { kind: "user" }, type: "escalation", body: { reason, task_key: taskKey }, force: true });
}

export async function budgetStopMission(db: Q, missionId: string): Promise<void> {
  await db.query(`UPDATE missions SET status='budget_exceeded', error='mission cost cap reached', finished_at=now() WHERE id=$1 AND status='running'`, [missionId]);
  await db.query(`UPDATE tasks SET status='cancelled', finished_at=now() WHERE mission_id=$1 AND status = ANY($2::text[])`, [missionId, OPEN.filter((s) => s !== "running")]);
}

/** Failure with bounded retries and exponential backoff; exhausted attempts escalate the mission to a human. */
export async function failTask(db: Db, task: TaskRow, workerId: string, error: string, opts: { backoffBaseMs: number; metaPatch?: Record<string, unknown> }): Promise<void> {
  const exhausted = task.attempt >= task.max_attempts;
  const delay = Math.min(opts.backoffBaseMs * 2 ** (task.attempt - 1), 60_000);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM missions WHERE id=$1 FOR UPDATE", [task.mission_id]); // same lock order as completeWith
    const r = await client.query(
      exhausted
        ? `UPDATE tasks SET status='failed', error=$3, finished_at=now(), locked_by=NULL, lease_expires_at=NULL, meta = meta || $4::jsonb WHERE id=$1 AND locked_by=$2 AND status='running' RETURNING id`
        : `UPDATE tasks SET status='queued', error=$3, locked_by=NULL, lease_expires_at=NULL, run_after = now() + ($5 || ' milliseconds')::interval, meta = meta || $4::jsonb WHERE id=$1 AND locked_by=$2 AND status='running' RETURNING id`,
      exhausted ? [task.id, workerId, error, JSON.stringify(opts.metaPatch ?? {})] : [task.id, workerId, error, JSON.stringify(opts.metaPatch ?? {}), String(delay)],
    );
    if (r.rowCount && exhausted) await escalateMission(client, task.mission_id, `task "${task.title}" failed after ${task.attempt} attempts: ${error.slice(0, 300)}`, task.key);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Recover tasks whose worker died (lease expired). Returns how many were requeued or escalated. */
export async function reapExpired(db: Db): Promise<number> {
  const requeued = await db.query(
    `UPDATE tasks SET status='queued', locked_by=NULL, lease_expires_at=NULL, run_after=now()
      WHERE status='running' AND lease_expires_at < now() AND attempt < max_attempts RETURNING id`,
  );
  const dead = await db.query(
    `UPDATE tasks SET status='failed', error='worker lost; attempts exhausted', finished_at=now(), locked_by=NULL, lease_expires_at=NULL
      WHERE status='running' AND lease_expires_at < now() AND attempt >= max_attempts RETURNING id, mission_id, title, key, attempt`,
  );
  for (const t of dead.rows) await escalateMission(db, t.mission_id, `task "${t.title}" lost its worker ${t.attempt} times`, t.key);
  return (requeued.rowCount ?? 0) + dead.rows.length;
}
