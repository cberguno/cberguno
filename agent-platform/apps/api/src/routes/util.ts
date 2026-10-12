import type { FastifyReply } from "fastify";
import type { ZodSchema } from "zod";

export function parse<T>(schema: ZodSchema<T>, data: unknown, reply: FastifyReply): T | undefined {
  const r = schema.safeParse(data);
  if (!r.success) {
    reply.code(400).send({ error: "validation", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    return undefined;
  }
  return r.data;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Postgres error → HTTP. Unique violation 23505 → 409, FK 23503 → 409, bad uuid 22P02 → 400. */
export function pgToHttp(e: unknown): { code: number; error: string } | null {
  const c = (e as { code?: string })?.code;
  if (c === "23505") return { code: 409, error: "already exists" };
  if (c === "23503") return { code: 409, error: "referenced object missing or in use" };
  if (c === "22P02") return { code: 400, error: "invalid id" };
  if (c === "23514") return { code: 400, error: "constraint violation" };
  return null;
}
