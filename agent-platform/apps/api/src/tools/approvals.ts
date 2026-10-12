import type { Db } from "../db.js";

export type Decision = "approved" | "rejected";
export class ApprovalError extends Error {}

/** Wake a parked task once every approval it was waiting on has been decided. */
async function requeueIfSettled(q: { query: Db["query"] }, taskId: string) {
  const left = await q.query("SELECT 1 FROM approval_requests WHERE task_id=$1 AND status='pending' LIMIT 1", [taskId]);
  if (!left.rowCount) await q.query("UPDATE tasks SET status='queued', run_after=now() WHERE id=$1 AND status='awaiting_approval'", [taskId]);
}

/** Human decision. `isAdmin` gates irreversible actions (payments, bookings, cancellations). */
export async function decideApproval(db: Db, id: string, decision: Decision, user: { id: string; isAdmin: boolean }, note: string | null) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const a = (await client.query("SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!a) throw new ApprovalError("not found");
    if (a.status !== "pending") throw new ApprovalError(`already ${a.status}`);
    if (a.risk === "irreversible" && !user.isAdmin) throw new ApprovalError("irreversible actions require an admin to approve");
    await client.query("UPDATE approval_requests SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1", [id, decision, user.id, note]);
    if (a.task_id) await requeueIfSettled(client, a.task_id);
    await client.query("COMMIT");
    return a;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Housekeeping: unanswered requests expire (treated as a rejection) so a parked task is never stuck forever. */
export async function expireApprovals(db: Db): Promise<number> {
  const r = await db.query("UPDATE approval_requests SET status='expired', decided_at=now(), decision_note='no response before expiry' WHERE status='pending' AND expires_at < now() RETURNING task_id");
  for (const t of new Set(r.rows.map((x) => x.task_id).filter(Boolean))) await requeueIfSettled(db, t as string);
  return r.rowCount ?? 0;
}
