import type { LlmDeps } from "../llm.js";
import { withMcp, type McpServerRow } from "./exec.js";
import { schemaHash } from "./registry.js";

const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "t_$&").slice(0, 52);

export type SyncReport = { added: number; updated: number; flagged: number; total: number };

/**
 * Discover a server's tools and mirror them into the registry.
 * Safety rules (an MCP server is third-party code we do not control):
 *  - anything not declared read-only defaults to risk=write, approval=required;
 *  - re-syncs never overwrite admin-chosen risk/approval/limits;
 *  - on a re-sync, a tool whose description or schema CHANGED is disabled and flagged for review (a changed description is a prompt-injection vector),
 *    and newly appearing tools arrive disabled+flagged, so a glob grant like `server__*` cannot silently expose them.
 */
export async function syncMcpServer(deps: LlmDeps, server: McpServerRow, signal?: AbortSignal): Promise<SyncReport> {
  const { db } = deps;
  try {
    const tools = await withMcp(deps, server, signal, async (c) => {
      const all: any[] = [];
      let cursor: string | undefined;
      do {
        const page: any = await c.listTools(cursor ? { cursor } : undefined, { signal });
        all.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor && all.length < 500);
      return all;
    });
    const existing = (await db.query("SELECT id, remote_name, schema_hash FROM tools WHERE mcp_server_id=$1", [server.id])).rows;
    const byRemote = new Map(existing.map((t) => [t.remote_name as string, t]));
    const firstSync = existing.length === 0;
    const taken = new Set((await db.query("SELECT name FROM tools")).rows.map((r) => r.name as string));
    const report: SyncReport = { added: 0, updated: 0, flagged: 0, total: tools.length };
    for (const t of tools) {
      const description = String(t.description ?? t.title ?? t.name).slice(0, 2000);
      const schema = t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} };
      const hash = schemaHash(description, schema);
      const prev = byRemote.get(t.name);
      if (prev) {
        if (prev.schema_hash === hash) continue;
        await db.query(
          `UPDATE tools SET description=$2, input_schema=$3, schema_hash=$4, enabled=false, needs_review=true, review_reason='description or schema changed on re-sync', updated_at=now() WHERE id=$1`,
          [prev.id, description, JSON.stringify(schema), hash],
        );
        report.updated++; report.flagged++;
        continue;
      }
      let name = `${server.name}__${sanitize(t.name)}`;
      for (let i = 2; taken.has(name); i++) name = `${server.name}__${sanitize(t.name)}`.slice(0, 59) + `_${i}`;
      taken.add(name);
      const readOnly = t.annotations?.readOnlyHint === true;
      await db.query(
        `INSERT INTO tools(name, description, input_schema, kind, mcp_server_id, remote_name, risk, approval, enabled, needs_review, review_reason, schema_hash)
         VALUES ($1,$2,$3,'mcp',$4,$5,$6,$7,$8,$9,$10,$11)`,
        [name, description, JSON.stringify(schema), server.id, t.name, readOnly ? "read" : "write", readOnly ? "never" : "required", firstSync, !firstSync, firstSync ? null : "new tool appeared on re-sync", hash],
      );
      report.added++;
      if (!firstSync) report.flagged++;
    }
    await db.query("UPDATE mcp_servers SET last_synced_at=now(), last_error=NULL WHERE id=$1", [server.id]);
    return report;
  } catch (e) {
    await db.query("UPDATE mcp_servers SET last_error=$2 WHERE id=$1", [server.id, (e as Error).message.slice(0, 500)]);
    throw e;
  }
}
