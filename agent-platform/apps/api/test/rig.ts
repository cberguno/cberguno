import http from "node:http";
import { appWithAdmin, freshDb } from "./helpers.js";
import { Worker, type WorkerOpts } from "../src/worker.js";

export type Ctx = { agent: string; system: string; user: string; n: number };
export type Reply = string | { status: number; body?: unknown; delayMs?: number } | Promise<string | { status: number; body?: unknown; delayMs?: number }>;
export type Script = (c: Ctx) => Reply;

export const DIM = 256;
/** Deterministic bag-of-words hashing embedder: lexical overlap => cosine similarity. Stands in for a real embedding API's wire format. */
export function hashEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    v[h % DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

/** A vendor server speaking both /chat/completions and /embeddings, driven by a script. Records calls and peak concurrency. */
export async function vendor(script: Script) {
  const calls: Ctx[] = [];
  const counts = new Map<string, number>();
  let active = 0, maxActive = 0, embedCalls = 0;
  const flags = { failEmbeddings: false };
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", async () => {
      const body = data ? JSON.parse(data) : {};
      if (req.url?.endsWith("/embeddings")) {
        embedCalls++;
        if (flags.failEmbeddings) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"down"}'); }
        const inputs: string[] = body.input;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: inputs.map((t, i) => ({ index: i, embedding: hashEmbed(t) })), usage: { prompt_tokens: inputs.join(" ").length / 4 | 0 } }));
      }
      const system: string = body.messages[0].content;
      const user: string = body.messages[body.messages.length - 1].content;
      const agent = /^You are ([^.]+)\./.exec(system)?.[1] ?? "?";
      const k = `${agent}|${user.slice(0, 200)}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      const ctx = { agent, system, user, n };
      calls.push(ctx);
      active++; maxActive = Math.max(maxActive, active);
      try {
        const r = await script(ctx);
        const out = typeof r === "string" ? { status: 200, body: { choices: [{ message: { content: r }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } } } : { status: r.status, body: r.body ?? { error: "scripted" }, delayMs: r.delayMs };
        const delay = typeof r === "object" && "delayMs" in r ? r.delayMs ?? 0 : 0;
        if (delay) await new Promise((x) => setTimeout(x, delay));
        if (!res.destroyed) { res.writeHead(out.status, { "content-type": "application/json" }); res.end(JSON.stringify(out.body)); }
      } finally { active--; }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/v1`, calls, flags, get maxActive() { return maxActive; }, get embedCalls() { return embedCalls; },
    callsFor: (agent: string) => calls.filter((c) => c.agent === agent),
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export const plan = (tasks: object[]) => JSON.stringify({ tasks });

export async function rig(script: Script, workerOpts: WorkerOpts = {}, opts: { embeddings?: boolean; reviewTeam?: boolean } = {}) {
  const fx = await freshDb();
  const t = await appWithAdmin(fx.db, fx.url);
  const admin = t.as(t.adminToken);
  const v = await vendor(script);
  const p = (await admin.post("/api/providers", { name: "mock", kind: "openai_compat", base_url: v.url, api_key: "sk-mock-0001" })).json();
  const chat = (await admin.post("/api/models", { provider_id: p.id, model_name: "chat-1", display_name: "Chat 1", tier: "standard", usd_per_mtok_in: 1, usd_per_mtok_out: 2 })).json();
  let embed: any = null;
  if (opts.embeddings) {
    embed = (await admin.post("/api/models", { provider_id: p.id, model_name: "embed-1", display_name: "Embed 1", tier: "fast", kind: "embedding", usd_per_mtok_in: 0.1 })).json();
    await admin.put("/api/settings/embedding", { model_id: embed.id });
  }
  const mk = async (name: string, kind: string, role = name, extra: object = {}) =>
    (await admin.post("/api/agents", { name, kind, role, instructions: `Act as ${name}.`, model_id: chat.id, ...extra })).json().id as string;
  const ids = {
    director: await mk("Director", "orchestrator"), flights: await mk("Flights", "specialist", "Finds flights"), hotels: await mk("Hotels", "specialist", "Compares hotels"),
    qa: await mk("QA", "qa", "Checks quality"),
  };
  const team = (await admin.post("/api/teams", { name: "Travel" })).json().id as string;
  const members = [ids.director, ids.flights, ids.hotels, ...(opts.reviewTeam === false ? [] : [ids.qa])].map((agent_id) => ({ agent_id, reports_to: agent_id === ids.director ? null : ids.director }));
  await admin.put(`/api/teams/${team}/members`, { members });
  const deps = { db: fx.db, masterKey: t.cfg.PLATFORM_MASTER_KEY };
  const worker = new Worker(deps, { pollMs: 15, leaseMs: 3000, backoffBaseMs: 20, reapMs: 100, ...workerOpts });
  const create = async (body: object) => {
    const r = await admin.post("/api/missions", { title: "Trip", goal: "Plan a trip to Lisbon", team_id: team, ...body });
    if (r.statusCode !== 201) throw new Error(`createMission ${r.statusCode}: ${r.body}`);
    return r.json().id as string;
  };
  const get = async (id: string) => (await admin.get(`/api/missions/${id}`)).json();
  const waitFor = async (id: string, statuses: string[], ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const m = await get(id);
      if (statuses.includes(m.status)) return m;
      if (Date.now() - t0 > ms) throw new Error(`mission stuck in ${m.status}: ${JSON.stringify(m.tasks.map((k: any) => [k.key, k.status, k.error]))}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  return {
    fx, t, admin, v, p, chat, embed, ids, team, deps, worker, create, get, waitFor, mk,
    op: t.as(await t.mkUser("operator")),
    async stop() { await worker.stop(); await t.app.close(); await v.close(); await fx.drop(); },
  };
}
