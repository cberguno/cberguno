import { z } from "zod";
import { open } from "../crypto.js";
import type { LlmDeps } from "../llm.js";
import { actorForAgent, searchMemories, writeMemory, MemoryAccessError } from "../memory.js";
import type { ToolRow } from "./registry.js";
import { assertPublicHost, safeFetch } from "./ssrf.js";

export class ToolExecError extends Error {}
export type ExecCtx = { agentId: string; signal?: AbortSignal };

const MAX_RESULT_CHARS = 12_000;
const MAX_BODY_BYTES = 2_000_000;
export const clip = (s: string, n = MAX_RESULT_CHARS) => (s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s);

export const httpConfig = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
  auth: z.object({ type: z.enum(["bearer", "header", "query"]), name: z.string().regex(/^[A-Za-z0-9_-]+$/).optional() }).optional(),
  response_max_chars: z.number().int().min(200).max(50_000).optional(),
});

async function secretFor(deps: LlmDeps, credentialId: string | null): Promise<string | null> {
  if (!credentialId) return null;
  const { rows } = await deps.db.query("SELECT sealed FROM credentials WHERE id=$1", [credentialId]);
  return rows[0] ? open(rows[0].sealed, deps.masterKey) : null; // decrypted only here; never enters a prompt
}

/** Defence in depth: a credential must not reach the model even if a remote echoes it back. */
export const scrub = (text: string, secrets: (string | null)[]) => secrets.reduce<string>((t, s) => (s && s.length >= 6 ? t.split(s).join("[redacted]") : t), text);

const prim = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

export function buildHttpRequest(cfg: z.infer<typeof httpConfig>, args: Record<string, unknown>, secret: string | null) {
  const used = new Set<string>();
  // Only path placeholders are substituted, URL-encoded: an argument can never change scheme, host or port.
  const url = new URL(cfg.url.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, k: string) => {
    const v = args[k];
    if (!prim(v)) throw new ToolExecError(`missing or non-scalar argument "${k}" for URL template`);
    // "." / ".." survive encodeURIComponent and the URL parser would collapse them, climbing out of the admin's path prefix
    if (/^\.{1,2}$/.test(String(v))) throw new ToolExecError(`argument "${k}" is not allowed in a URL path`);
    used.add(k);
    return encodeURIComponent(String(v));
  }));
  const rest = Object.fromEntries(Object.entries(args).filter(([k]) => !used.has(k)));
  const headers: Record<string, string> = { accept: "application/json, text/plain;q=0.9, */*;q=0.5", ...cfg.headers };
  let body: string | undefined;
  if (cfg.method === "GET" || cfg.method === "DELETE") {
    for (const [k, v] of Object.entries(rest)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
      else if (v !== undefined && v !== null) url.searchParams.set(k, prim(v) ? String(v) : JSON.stringify(v));
    }
  } else {
    body = JSON.stringify(rest);
    headers["content-type"] = "application/json";
  }
  if (cfg.auth && secret) {
    if (cfg.auth.type === "bearer") headers.authorization = `Bearer ${secret}`;
    else if (cfg.auth.type === "header") headers[cfg.auth.name ?? "x-api-key"] = secret;
    else url.searchParams.set(cfg.auth.name ?? "api_key", secret);
  }
  return { url: url.toString(), headers, body };
}

async function readCapped(res: { body: any; text(): Promise<string> }): Promise<string> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "", n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.byteLength;
    out += dec.decode(value, { stream: true });
    if (n > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); out += "\n…[response too large; truncated]"; break; }
  }
  return out;
}

async function execHttp(deps: LlmDeps, tool: ToolRow, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const cfg = httpConfig.parse(tool.config);
  const secret = await secretFor(deps, tool.credential_id);
  const req = buildHttpRequest(cfg, args, secret);
  if (!deps.allowPrivateHosts) await assertPublicHost(new URL(req.url).hostname);
  const res = await safeFetch(req.url, { method: cfg.method, headers: req.headers, body: req.body, signal }, { allowPrivate: deps.allowPrivateHosts });
  const text = await readCapped(res as any);
  if (res.status >= 300 && res.status < 400) throw new ToolExecError(`HTTP ${res.status}: redirects are not followed`);
  if (res.status >= 400) throw new ToolExecError(scrub(`HTTP ${res.status}: ${clip(text, 500)}`, [secret]));
  return scrub(clip(text, cfg.response_max_chars ?? MAX_RESULT_CHARS), [secret]);
}

// ---------- MCP ----------
export type McpServerRow = { id: string; name: string; url: string; credential_id: string | null; auth_header: string; auth_scheme: "bearer" | "raw" };

export async function withMcp<T>(deps: LlmDeps, server: McpServerRow, signal: AbortSignal | undefined, fn: (c: import("@modelcontextprotocol/sdk/client/index.js").Client) => Promise<T>): Promise<T> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
  const secret = await secretFor(deps, server.credential_id);
  const headers: Record<string, string> = secret ? { [server.auth_header]: server.auth_scheme === "bearer" ? `Bearer ${secret}` : secret } : {};
  if (!deps.allowPrivateHosts) await assertPublicHost(new URL(server.url).hostname);
  const connect = async (mk: () => any) => {
    const client = new Client({ name: "agent-platform", version: "0.3.0" }, { capabilities: {} });
    await client.connect(mk(), signal ? { signal } : undefined);
    return client;
  };
  let client;
  try {
    client = await connect(() => new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
  } catch (e1) {
    if (signal?.aborted) throw e1;
    try {
      client = await connect(() => new SSEClientTransport(new URL(server.url), { requestInit: { headers } }));
    } catch {
      throw new ToolExecError(scrub(`cannot connect to MCP server "${server.name}": ${(e1 as Error).message}`, [secret]));
    }
  }
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function execMcp(deps: LlmDeps, tool: ToolRow, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { rows } = await deps.db.query("SELECT * FROM mcp_servers WHERE id=$1 AND enabled", [tool.mcp_server_id]);
  const server = rows[0] as McpServerRow | undefined;
  if (!server) throw new ToolExecError("MCP server is disabled or missing");
  const secret = await secretFor(deps, server.credential_id);
  return withMcp(deps, server, signal, async (c) => {
    const r: any = await c.callTool({ name: tool.remote_name!, arguments: args }, undefined, { signal, timeout: tool.timeout_ms });
    const text = (r.content ?? []).map((b: any) => (b.type === "text" ? b.text : b.type === "resource" ? JSON.stringify(b.resource) : `[${b.type} content omitted]`)).join("\n")
      || (r.structuredContent ? JSON.stringify(r.structuredContent) : "");
    if (r.isError) throw new ToolExecError(scrub(clip(text || "tool reported an error", 1000), [secret]));
    return scrub(clip(text), [secret]);
  });
}

// ---------- builtins ----------
function htmlToText(html: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  const body = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return (title ? `Title: ${title}\n\n` : "") + body;
}

async function webFetch(deps: LlmDeps, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  let url = String(args.url ?? "");
  const max = Math.min(Number(args.max_chars) || 8000, 20_000);
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new ToolExecError("only http(s) URLs are allowed");
    if (!deps.allowPrivateHosts) await assertPublicHost(u.hostname);
    const res: any = await safeFetch(url, { headers: { "user-agent": "AgentPlatform/0.3 (+web_fetch)", accept: "text/html,application/json,text/plain" }, signal }, { allowPrivate: deps.allowPrivateHosts });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url).toString(); continue; } // each hop is re-validated
    const type = String(res.headers.get("content-type") ?? "");
    if (!/^(text\/|application\/(json|xml|xhtml))/.test(type)) throw new ToolExecError(`unsupported content type ${type || "unknown"}`);
    const raw = await readCapped(res);
    if (res.status >= 400) throw new ToolExecError(`HTTP ${res.status}`);
    return clip(type.includes("html") ? htmlToText(raw) : raw, max);
  }
  throw new ToolExecError("too many redirects");
}

/**
 * Read-only browser rendering. Hardening: fresh incognito context per call (no cookies/profile), downloads and service workers off,
 * http(s) only, images/media/fonts not loaded, and EVERY request (redirects and sub-resources included) is checked against the SSRF guard.
 * Limitation: Chromium resolves DNS itself after our check, so a rebinding attacker can still race it. Run browser-capable workers
 * with egress filtering (no route to private ranges / cloud metadata) as the real boundary.
 */
async function browserRead(deps: LlmDeps, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const exe = process.env.BROWSER_EXECUTABLE_PATH;
  if (!exe) throw new ToolExecError("browser_read is not available: set BROWSER_EXECUTABLE_PATH to a Chromium binary on the worker (see docs/DEPLOYMENT.md)");
  const start = new URL(String(args.url ?? ""));
  if (start.protocol !== "http:" && start.protocol !== "https:") throw new ToolExecError("only http(s) URLs are allowed");
  if (!deps.allowPrivateHosts) await assertPublicHost(start.hostname);
  const max = Math.min(Number(args.max_chars) || 8000, 20_000);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: exe, args: process.env.BROWSER_NO_SANDBOX === "true" ? ["--no-sandbox"] : [] });
  const kill = () => void browser.close().catch(() => {});
  signal.addEventListener("abort", kill, { once: true });
  try {
    const ctx = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true, userAgent: "Mozilla/5.0 (compatible; AgentPlatform/0.3; +browser_read)" });
    const blocked: string[] = [];
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      try {
        const u = new URL(req.url());
        if (u.protocol !== "http:" && u.protocol !== "https:") return await route.abort();
        if (["image", "media", "font"].includes(req.resourceType())) return await route.abort();
        if (!deps.allowPrivateHosts) await assertPublicHost(u.hostname);
        return await route.continue();
      } catch (e) {
        blocked.push(req.url());
        return route.abort();
      }
    });
    const page = await ctx.newPage();
    const resp = await page.goto(start.toString(), { waitUntil: "load", timeout: 30_000 });
    await page.waitForTimeout(Math.min(Number(args.wait_ms ?? 1500), 10_000));
    if (resp && resp.status() >= 400) throw new ToolExecError(`HTTP ${resp.status()}`);
    const title = await page.title();
    const text = await page.evaluate(() => (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim());
    return clip((title ? `Title: ${title}\n\n` : "") + text + (blocked.length ? `\n\n[${blocked.length} request(s) to non-public addresses were blocked]` : ""), max);
  } finally {
    signal.removeEventListener("abort", kill);
    await browser.close().catch(() => {});
  }
}

async function execBuiltin(deps: LlmDeps, tool: ToolRow, args: Record<string, unknown>, ctx: ExecCtx, signal: AbortSignal): Promise<string> {
  if (tool.name === "web_fetch") return webFetch(deps, args, signal);
  if (tool.name === "browser_read") return browserRead(deps, args, signal);
  const actor = await actorForAgent(deps.db, ctx.agentId);
  if (tool.name === "memory_search") {
    const hits = await searchMemories(deps, actor, String(args.query), { k: Math.min(Number(args.k) || 5, 10) });
    return hits.length ? hits.map((h) => `- [${h.kind}/${h.scope}] ${h.content}`).join("\n") : "No relevant memories.";
  }
  if (tool.name === "memory_write") {
    const scope = (args.scope as "agent" | "team" | "org") ?? "agent";
    try {
      const teamId = scope === "team" ? actor.teamIds[0] : undefined;
      if (scope === "team" && !teamId) throw new MemoryAccessError("agent is not a member of any team");
      await writeMemory(deps, { kind: (args.kind as "semantic" | "lesson") ?? "semantic", scope, agentId: ctx.agentId, teamId, content: String(args.content), salience: 0.6, source: { by_agent: ctx.agentId } }, actor);
      return "Saved.";
    } catch (e) {
      throw new ToolExecError(e instanceof MemoryAccessError ? e.message : "could not save memory");
    }
  }
  throw new ToolExecError(`unknown builtin ${tool.name}`);
}

export async function executeTool(deps: LlmDeps, tool: ToolRow, args: Record<string, unknown>, ctx: ExecCtx): Promise<string> {
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(tool.timeout_ms)]) : AbortSignal.timeout(tool.timeout_ms);
  try {
    if (tool.kind === "http") return await execHttp(deps, tool, args, signal);
    if (tool.kind === "mcp") return await execMcp(deps, tool, args, signal);
    return await execBuiltin(deps, tool, args, ctx, signal);
  } catch (e) {
    if (e instanceof ToolExecError) throw e;
    if (signal.aborted) throw new ToolExecError(`timed out after ${tool.timeout_ms}ms`);
    throw new ToolExecError((e as Error).message);
  }
}
