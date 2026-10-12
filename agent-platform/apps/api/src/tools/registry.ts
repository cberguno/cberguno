import { createHash } from "node:crypto";
import type { Db } from "../db.js";
import type { ToolSpec } from "../providers/index.js";

export type ToolRow = {
  id: string; name: string; description: string; input_schema: Record<string, any>;
  kind: "http" | "mcp" | "builtin"; config: Record<string, any>; mcp_server_id: string | null; remote_name: string | null;
  credential_id: string | null; risk: "read" | "write" | "irreversible"; approval: "never" | "required";
  rate_limit_per_min: number; timeout_ms: number; provenance_kind: "live" | "cached" | "estimate";
  enabled: boolean; needs_review: boolean;
};

/** Grants are exact tool names or a prefix ending in `*` (e.g. `kiwi__*`). Default is deny. */
export function grantMatches(name: string, grants: readonly string[]): boolean {
  return grants.some((g) => (g.endsWith("*") ? name.startsWith(g.slice(0, -1)) : g === name));
}
export const GRANT_PATTERN = /^[a-z][a-z0-9_]*\*?$/;

export const schemaHash = (description: string, schema: unknown) => createHash("sha256").update(JSON.stringify({ description, schema })).digest("hex").slice(0, 32);

/** Tools an agent may use *right now*, read fresh from the DB (an admin may revoke a grant mid-mission). */
export async function grantedTools(db: Db, agentId: string): Promise<ToolRow[]> {
  const a = await db.query("SELECT permissions FROM agents WHERE id=$1", [agentId]);
  const grants: string[] = a.rows[0]?.permissions?.tools ?? [];
  if (!grants.length) return [];
  const { rows } = await db.query("SELECT * FROM tools WHERE enabled AND NOT needs_review ORDER BY name");
  return (rows as ToolRow[]).filter((t) => grantMatches(t.name, grants));
}

export const toToolSpec = (t: ToolRow): ToolSpec => ({ name: t.name, description: t.description.slice(0, 1000), parameters: sanitizeSchema(t.input_schema) });

/** Top-level must be an object schema for every provider; drop meta keys some APIs reject. */
export function sanitizeSchema(s: Record<string, any>): Record<string, unknown> {
  const { $schema: _a, ...rest } = s ?? {};
  return rest.type === "object" ? rest : { ...rest, type: "object", properties: rest.properties ?? {} };
}

/** If an agent has many granted tools, offer the most relevant ones (keyword overlap with the task) rather than all. */
export function selectTools(tools: ToolRow[], text: string, max = 40): ToolRow[] {
  if (tools.length <= max) return tools;
  const words = new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const score = (t: ToolRow) => (`${t.name} ${t.description}`.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => words.has(w)).length;
  return [...tools].sort((a, b) => score(b) - score(a)).slice(0, max);
}

export const BUILTINS: { name: string; description: string; input_schema: object; risk: "read" | "write"; approval: "never" | "required"; rate_limit_per_min: number; timeout_ms: number }[] = [
  {
    name: "web_fetch", risk: "read", approval: "never", rate_limit_per_min: 30, timeout_ms: 20000,
    description: "Fetch a public web page or JSON/text URL and return its readable text. Only public internet addresses are reachable.",
    input_schema: { type: "object", properties: { url: { type: "string", description: "http(s) URL" }, max_chars: { type: "integer", minimum: 500, maximum: 20000, description: "Truncate output (default 8000)" } }, required: ["url"] },
  },
  {
    name: "browser_read", risk: "read", approval: "never", rate_limit_per_min: 10, timeout_ms: 45000,
    description: "Open a public web page in a real browser (runs JavaScript, so it works on dynamic sites) and return its visible text. Read-only: it cannot click, type or log in. Slower than web_fetch; use web_fetch first for plain pages.",
    input_schema: { type: "object", properties: { url: { type: "string", description: "http(s) URL" }, max_chars: { type: "integer", minimum: 500, maximum: 20000 }, wait_ms: { type: "integer", minimum: 0, maximum: 10000, description: "Extra time for scripts to render (default 1500)" } }, required: ["url"] },
  },
  {
    name: "memory_search", risk: "read", approval: "never", rate_limit_per_min: 60, timeout_ms: 20000,
    description: "Search your own long-term memory (and team/organisation memory you are permitted to read) for relevant notes, lessons and facts.",
    input_schema: { type: "object", properties: { query: { type: "string" }, k: { type: "integer", minimum: 1, maximum: 10 } }, required: ["query"] },
  },
  {
    name: "memory_write", risk: "write", approval: "never", rate_limit_per_min: 20, timeout_ms: 20000,
    description: "Save a durable note to memory (a fact you verified or a lesson for next time). Scope is limited by your permissions.",
    input_schema: { type: "object", properties: { content: { type: "string", maxLength: 2000 }, kind: { type: "string", enum: ["semantic", "lesson"] }, scope: { type: "string", enum: ["agent", "team", "org"] } }, required: ["content"] },
  },
];

/** Idempotent. Code owns description/schema; admins own risk/approval/enabled/limits (never overwritten). */
export async function ensureBuiltinTools(db: Db): Promise<void> {
  for (const b of BUILTINS) {
    await db.query(
      `INSERT INTO tools(name, description, input_schema, kind, risk, approval, rate_limit_per_min, timeout_ms)
       VALUES ($1,$2,$3,'builtin',$4,$5,$6,$7)
       ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description, input_schema=EXCLUDED.input_schema WHERE tools.kind='builtin'`,
      [b.name, b.description, JSON.stringify(b.input_schema), b.risk, b.approval, b.rate_limit_per_min, b.timeout_ms],
    );
  }
}
