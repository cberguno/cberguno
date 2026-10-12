import type { Db } from "./db.js";

export type Actor = { kind: "user" | "agent" | "system"; id: string | null; role: "admin" | "operator" | "viewer" | "agent" | "system" };

const SENSITIVE_KEYS = /^(api_?key|secret|password|token|authorization|sealed)$/i;

/** Redact obvious secret-bearing keys before anything goes in the audit trail. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, SENSITIVE_KEYS.test(k) ? "[redacted]" : redact(val)]),
    );
  }
  return v;
}

export async function audit(
  db: Db,
  actor: Actor,
  action: string,
  target?: { type: string; id: string },
  detail: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_log(actor_kind, actor_id, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5,$6)",
    [actor.kind, actor.id, action, target?.type ?? null, target?.id ?? null, JSON.stringify(redact(detail))],
  );
}
