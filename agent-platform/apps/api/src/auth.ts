import { jwtVerify, SignJWT } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Actor } from "./audit.js";

export type Role = "admin" | "operator" | "viewer";
const RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

export async function signToken(secret: string, user: { id: string; role: Role }, ttl = "12h"): Promise<string> {
  return new SignJWT({ role: user.role, kind: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}

/**
 * Agent-actor tokens exist so Phase 2 workers can call the API on an agent's behalf.
 * They carry role "agent", which satisfies NO requireRole() check — so an agent can never
 * reach a privilege-mutating route, whatever its prompt says.
 */
export async function signAgentToken(secret: string, agentId: string, ttl = "15m"): Promise<string> {
  return new SignJWT({ role: "agent", kind: "agent" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(agentId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyToken(secret: string, token: string): Promise<Actor | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    const kind = payload.kind === "agent" ? "agent" : "user";
    const role = payload.role as Actor["role"];
    if (!payload.sub || !["admin", "operator", "viewer", "agent"].includes(role)) return null;
    return { kind, id: payload.sub, role };
  } catch {
    return null;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}

export function authHook(secret: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization;
    // Browser EventSource can't set headers, so the SSE route alone accepts ?access_token= (the bundled UI doesn't use it).
    const sseRoute = req.method === "GET" && /^\/api\/runs\/[^/?]+\/events(\?|$)/.test(req.url);
    const q = sseRoute ? (req.query as { access_token?: string })?.access_token : undefined;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : q;
    const actor = token ? await verifyToken(secret, token) : null;
    if (!actor) return reply.code(401).send({ error: "unauthorized" });
    req.actor = actor;
  };
}

/** Human-role gate. Agent actors always fail it. */
export function requireRole(min: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const a = req.actor;
    if (!a || a.kind !== "user" || !(a.role in RANK) || RANK[a.role as Role] < RANK[min]) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
}
