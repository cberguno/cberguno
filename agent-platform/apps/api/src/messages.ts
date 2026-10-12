import { z } from "zod";
import type { Q } from "./queue.js";

/** Typed message bodies. Agents exchange structured payloads and *references* (task keys), not free-form transcripts. */
export const BODIES = {
  "task.assign": z.object({ task_key: z.string(), title: z.string() }),
  "task.result": z.object({ task_key: z.string(), summary: z.string() }),
  "question": z.object({ task_key: z.string(), question: z.string() }),
  "answer": z.object({ task_key: z.string(), answer: z.string() }),
  "review.request": z.object({ task_key: z.string(), review_key: z.string() }),
  "review.verdict": z.object({ task_key: z.string(), verdict: z.enum(["accept", "request_changes"]), feedback: z.string() }),
  "escalation": z.object({ reason: z.string(), task_key: z.string().optional() }),
  "note": z.object({ text: z.string() }),
} as const;
export type MessageType = keyof typeof BODIES;

export type Party = { kind: "agent" | "user" | "system"; id?: string | null };
export type Dest = { kind: "agent" | "user" | "channel"; id?: string | null };

export class MessageBudgetError extends Error {
  constructor(public missionId: string, public max: number) { super(`message budget of ${max} exceeded`); }
}

export async function postMessage<T extends MessageType>(
  q: Q,
  m: { missionId: string; taskId?: string | null; channel?: string; from: Party; to: Dest; type: T; body: z.infer<(typeof BODIES)[T]>; refs?: string[]; force?: boolean },
): Promise<void> {
  const body = BODIES[m.type].parse(m.body);
  if (!m.force) {
    const { rows } = await q.query(
      `SELECT (SELECT count(*)::int FROM messages WHERE mission_id = $1) AS n, COALESCE((options->>'max_messages')::int, 80) AS max FROM missions WHERE id = $1`,
      [m.missionId],
    );
    if (rows[0] && rows[0].n >= rows[0].max) throw new MessageBudgetError(m.missionId, rows[0].max);
  }
  await q.query(
    `INSERT INTO messages(mission_id, task_id, channel, from_kind, from_id, to_kind, to_id, type, body, refs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [m.missionId, m.taskId ?? null, m.channel ?? "mission", m.from.kind, m.from.id ?? null, m.to.kind, m.to.id ?? null, m.type, JSON.stringify(body), JSON.stringify(m.refs ?? [])],
  );
}
