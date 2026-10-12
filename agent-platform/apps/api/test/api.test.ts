import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signAgentToken } from "../src/auth.js";
import { appWithAdmin, freshDb, mockServer, openaiOk } from "./helpers.js";

let fx: Awaited<ReturnType<typeof freshDb>>;
let t: Awaited<ReturnType<typeof appWithAdmin>>;
let admin: ReturnType<typeof t.as>, operator: ReturnType<typeof t.as>, viewer: ReturnType<typeof t.as>;

beforeAll(async () => {
  fx = await freshDb();
  t = await appWithAdmin(fx.db, fx.url);
  admin = t.as(t.adminToken);
  operator = t.as(await t.mkUser("operator"));
  viewer = t.as(await t.mkUser("viewer"));
});
afterAll(async () => { await t.app.close(); await fx.drop(); });

describe("auth and RBAC", () => {
  it("rejects missing/invalid tokens and bad logins", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/agents" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: "/api/agents", headers: { authorization: "Bearer junk" } })).statusCode).toBe(401);
    const bad = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.com", password: "nope" } });
    expect(bad.statusCode).toBe(401);
  });
  it("throttles repeated failed logins", async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "victim@example.com", password: "x" } })).statusCode;
    expect(last).toBe(429);
  });
  it("viewer reads but cannot mutate; operator cannot touch admin routes", async () => {
    expect((await viewer.get("/api/agents")).statusCode).toBe(200);
    expect((await viewer.post("/api/agents", { name: "x", role: "y" })).statusCode).toBe(403);
    expect((await operator.post("/api/providers", { name: "p", kind: "openai_compat", base_url: "http://x" })).statusCode).toBe(403);
    expect((await operator.get("/api/audit")).statusCode).toBe(403);
    expect((await operator.post("/api/users", { email: "z@example.com", password: "long-enough-pw-1", role: "admin" })).statusCode).toBe(403);
  });
});

describe("agent actors can never gain privilege", () => {
  it("an agent token is rejected by every mutating route, even though it authenticates", async () => {
    const agentTok = await signAgentToken(t.cfg.JWT_SECRET, "00000000-0000-0000-0000-000000000001");
    const a = t.as(agentTok);
    expect((await a.get("/api/auth/me")).json()).toMatchObject({ kind: "agent", role: "agent" });
    for (const [m, u, p] of [
      ["post", "/api/agents", { name: "evil", role: "r", daily_budget_usd: 99999 }],
      ["patch", "/api/agents/00000000-0000-0000-0000-000000000001", { permissions: { tools: ["web_fetch"], memory_scope: "org" } }],
      ["post", "/api/providers", { name: "p", kind: "openai_compat", base_url: "http://x" }],
      ["post", "/api/users", { email: "e@example.com", password: "long-enough-pw-1", role: "admin" }],
    ] as const) {
      expect((await (a as any)[m](u, p)).statusCode, `${m} ${u}`).toBe(403);
    }
  });
});

describe("credential vault via API", () => {
  it("never returns the secret and stores it sealed", async () => {
    const r = await admin.post("/api/providers", { name: "vault-test", kind: "openai_compat", base_url: "http://127.0.0.1:1/v1", api_key: "sk-SUPERSECRET-9999" });
    expect(r.statusCode).toBe(201);
    expect(r.body).not.toContain("SUPERSECRET");
    const list = await admin.get("/api/providers");
    expect(list.body).not.toContain("SUPERSECRET");
    expect(list.json().find((p: any) => p.name === "vault-test")).toMatchObject({ has_key: true, key_hint: "9999" });
    const raw = await fx.db.query("SELECT sealed FROM credentials");
    expect(raw.rows.some((x) => String(x.sealed).includes("SUPERSECRET"))).toBe(false);
    const aud = await fx.db.query("SELECT detail FROM audit_log WHERE action='provider.create'");
    expect(JSON.stringify(aud.rows)).not.toContain("SUPERSECRET");
  });
  it("rotating a key destroys the old credential row", async () => {
    const p = (await admin.post("/api/providers", { name: "rot", kind: "openai_compat", base_url: "http://127.0.0.1:1/v1", api_key: "sk-old-0001" })).json();
    const before = (await fx.db.query("SELECT count(*)::int n FROM credentials")).rows[0].n;
    await admin.patch(`/api/providers/${p.id}`, { api_key: "sk-new-0002" });
    expect((await fx.db.query("SELECT count(*)::int n FROM credentials")).rows[0].n).toBe(before);
    expect((await admin.get("/api/providers")).json().find((x: any) => x.name === "rot").key_hint).toBe("0002");
  });
});

describe("agent builder", () => {
  it("creates, versions, and updates agents; operator cannot set privileged fields", async () => {
    const c = await operator.post("/api/agents", { name: "Researcher", role: "Finds facts", goal: "g", instructions: "i" });
    expect(c.statusCode).toBe(201);
    const a = c.json();
    expect(a).toMatchObject({ version: 1, status: "active", daily_budget_usd: 5 });

    const denied = await operator.patch(`/api/agents/${a.id}`, { daily_budget_usd: 9999 });
    expect(denied.statusCode).toBe(403);
    expect((await operator.post("/api/agents", { name: "Sneaky", role: "r", permissions: { tools: ["web_fetch"], memory_scope: "org" } })).statusCode).toBe(403);
    // a blanket "grant everything" wildcard is not a valid grant, even for an admin
    expect((await admin.post("/api/agents", { name: "Wild", role: "r", permissions: { tools: ["*"], memory_scope: "agent" } })).statusCode).toBe(400);

    const ok = await operator.patch(`/api/agents/${a.id}`, { instructions: "new" });
    expect(ok.json()).toMatchObject({ version: 2, instructions: "new" });
    const priv = await admin.patch(`/api/agents/${a.id}`, { daily_budget_usd: 20, permissions: { tools: ["web_fetch"], memory_scope: "team" } });
    expect(priv.json()).toMatchObject({ version: 3, daily_budget_usd: 20 });

    const detail = (await admin.get(`/api/agents/${a.id}`)).json();
    expect(detail.versions.map((v: any) => v.version)).toEqual([3, 2, 1]);
    const denial = await fx.db.query("SELECT 1 FROM audit_log WHERE action='agent.privilege_change_denied'");
    expect(denial.rowCount).toBe(1);
  });
  it("validates input and handles duplicates / bad ids", async () => {
    expect((await operator.post("/api/agents", { name: "", role: "r" })).statusCode).toBe(400);
    expect((await operator.post("/api/agents", { name: "Researcher", role: "dup" })).statusCode).toBe(409);
    expect((await admin.get("/api/agents/not-a-uuid")).statusCode).toBe(400);
    expect((await admin.get("/api/agents/00000000-0000-0000-0000-00000000dead")).statusCode).toBe(404);
  });
  it("terminated agents are final", async () => {
    const a = (await operator.post("/api/agents", { name: "Doomed", role: "r" })).json();
    expect((await operator.post(`/api/agents/${a.id}/status`, { status: "terminated" })).statusCode).toBe(200);
    expect((await operator.post(`/api/agents/${a.id}/status`, { status: "active" })).statusCode).toBe(404);
    expect((await operator.patch(`/api/agents/${a.id}`, { role: "x" })).statusCode).toBe(404);
  });
});

describe("teams and org chart", () => {
  it("stores a reporting tree and rejects cycles / foreign managers", async () => {
    const mk = async (n: string) => (await operator.post("/api/agents", { name: n, role: n })).json().id as string;
    const [ceo, a, b] = [await mk("T-Director"), await mk("T-Flights"), await mk("T-Hotels")];
    const team = (await operator.post("/api/teams", { name: "Travel" })).json();
    const ok = await operator.put(`/api/teams/${team.id}/members`, { members: [{ agent_id: ceo, reports_to: null }, { agent_id: a, reports_to: ceo }, { agent_id: b, reports_to: ceo }] });
    expect(ok.statusCode).toBe(200);
    const listed = (await admin.get("/api/teams")).json().find((x: any) => x.id === team.id);
    expect(listed.members).toHaveLength(3);
    expect(listed.members.find((m: any) => m.agent_id === a).reports_to).toBe(ceo);

    const cycle = await operator.put(`/api/teams/${team.id}/members`, { members: [{ agent_id: a, reports_to: b }, { agent_id: b, reports_to: a }] });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json().error).toMatch(/cycle/);
    const foreign = await operator.put(`/api/teams/${team.id}/members`, { members: [{ agent_id: a, reports_to: ceo }] });
    expect(foreign.statusCode).toBe(400);
    expect((await admin.get("/api/teams")).json().find((x: any) => x.id === team.id).members).toHaveLength(3); // failed replace left state intact
  });
});

describe("audit log integrity", () => {
  it("is append-only at the database level", async () => {
    await expect(fx.db.query("UPDATE audit_log SET action='x'")).rejects.toThrow(/append-only/);
    await expect(fx.db.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
    await expect(fx.db.query("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
    const rows = (await admin.get("/api/audit")).json();
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.some((r: any) => r.action === "agent.create")).toBe(true);
  });
});

// ---------- end-to-end runs through the real runtime, router and HTTP adapter ----------
async function waitRun(id: string, timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    const r = (await admin.get(`/api/runs/${id}`)).json();
    if (r.status !== "running") return r;
    if (Date.now() - t0 > timeoutMs) throw new Error("run did not finish");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("agent runs", () => {
  const servers: { close: () => Promise<void> }[] = [];
  afterAll(async () => { await Promise.all(servers.map((s) => s.close())); });

  async function setup(name: string, handler: Parameters<typeof mockServer>[0], model: Record<string, unknown> = {}, agent: Record<string, unknown> = {}) {
    const s = await mockServer(handler);
    servers.push(s);
    const p = (await admin.post("/api/providers", { name: `prov-${name}`, kind: "openai_compat", base_url: s.url + "/v1", api_key: `sk-${name}-1234` })).json();
    const m = (await admin.post("/api/models", { provider_id: p.id, model_name: `m-${name}`, display_name: `M ${name}`, tier: "standard", usd_per_mtok_in: 1, usd_per_mtok_out: 2, ...model })).json();
    const a = (await admin.post("/api/agents", { name: `Agent ${name}`, role: "tester", instructions: "Be terse.", goal: "Test", model_id: m.id, ...agent })).json();
    return { s, p, m, a };
  }

  it("runs an agent end to end: prompt built from config, key sent, usage + cost recorded, events persisted", async () => {
    const { s, a, m } = await setup("e2e", () => openaiOk("the answer", 1000, 500));
    const start = await operator.post(`/api/agents/${a.id}/runs`, { input: "question?" });
    expect(start.statusCode).toBe(202);
    const run = await waitRun(start.json().id);
    expect(run).toMatchObject({ status: "succeeded", output: "the answer", tokens_in: 1000, tokens_out: 500, model_id: m.id });
    expect(run.cost_usd).toBeCloseTo((1000 * 1 + 500 * 2) / 1e6, 8);
    expect(run.events.map((e: any) => e.type)).toEqual(["run.started", "route.selected", "model.response", "run.finished"]);
    const req = s.seen[0]!;
    expect(req.headers.authorization).toBe("Bearer sk-e2e-1234");
    expect(req.body.messages[0].content).toContain("Agent e2e");
    expect(req.body.messages[0].content).toContain("Be terse.");
    expect(req.body.messages[1]).toEqual({ role: "user", content: "question?" });
    // the vendor key must not appear anywhere the user can read: run record, events, prompt
    expect(JSON.stringify(run)).not.toContain("sk-e2e");
    expect(req.body.messages.map((x: any) => x.content).join()).not.toContain("sk-e2e");
    const usage = (await admin.get("/api/usage/summary?days=1")).json();
    expect(usage.totals.calls).toBeGreaterThanOrEqual(1);
    expect(usage.byAgent.find((x: any) => x.name === "Agent e2e").cost_usd).toBeCloseTo(run.cost_usd, 8);
    expect((await fx.db.query("SELECT avg_latency_ms FROM models WHERE id=$1", [m.id])).rows[0].avg_latency_ms).not.toBeNull();
  });

  it("routes by policy and falls back to the next model on a retryable failure", async () => {
    const bad = await mockServer(() => ({ status: 503, body: { error: "overloaded" } }));
    const good = await mockServer(() => openaiOk("from fallback"));
    servers.push(bad, good);
    const pb = (await admin.post("/api/providers", { name: "fb-bad", kind: "openai_compat", base_url: bad.url + "/v1" })).json();
    const pg = (await admin.post("/api/providers", { name: "fb-good", kind: "openai_compat", base_url: good.url + "/v1" })).json();
    // 'cheap' is preferred (cheapest within standard tier) but broken
    await admin.post("/api/models", { provider_id: pb.id, model_name: "cheap", display_name: "cheap", tier: "standard", usd_per_mtok_in: 0.01, usd_per_mtok_out: 0.01 });
    await admin.post("/api/models", { provider_id: pg.id, model_name: "dear", display_name: "dear", tier: "standard", usd_per_mtok_in: 0.5, usd_per_mtok_out: 0.5 });
    const a = (await admin.post("/api/agents", { name: "Router agent", role: "r", routing: { strategy: "cheapest", complexity: "medium", maxUsdPerMtokOut: 0.6 } })).json();
    const run = await waitRun((await operator.post(`/api/agents/${a.id}/runs`, { input: "hi" })).json().id);
    expect(run.status).toBe("succeeded");
    expect(run.output).toBe("from fallback");
    const types = run.events.map((e: any) => e.type);
    expect(types).toContain("route.fallback");
    expect(bad.seen.length).toBe(1);
  });

  it("fails clearly when no model is eligible", async () => {
    const a = (await admin.post("/api/agents", { name: "Lonely", role: "r", routing: { strategy: "cheapest", complexity: "low", needsVision: true } })).json();
    const run = await waitRun((await operator.post(`/api/agents/${a.id}/runs`, { input: "hi" })).json().id);
    expect(run).toMatchObject({ status: "failed" });
    expect(run.error).toMatch(/no eligible model/);
  });

  it("refuses calls that could exceed the per-run cost cap (no vendor request is made)", async () => {
    const { s, a } = await setup("capped", () => openaiOk(), { usd_per_mtok_in: 1000, usd_per_mtok_out: 1000 }, { max_cost_usd_per_run: 0.001 });
    const run = await waitRun((await operator.post(`/api/agents/${a.id}/runs`, { input: "hi" })).json().id);
    expect(run.status).toBe("budget_exceeded");
    expect(s.seen).toHaveLength(0);
  });

  it("enforces the daily budget across runs", async () => {
    // worst case per call ≈ 2048 out tokens * $2/Mtok ≈ $0.0041; budget allows exactly one real spend then blocks
    const { a } = await setup("daily", () => openaiOk("ok", 100_000, 100_000), { usd_per_mtok_in: 1, usd_per_mtok_out: 1 }, { daily_budget_usd: 0.25, max_cost_usd_per_run: 1 });
    const r1 = await waitRun((await operator.post(`/api/agents/${a.id}/runs`, { input: "one" })).json().id);
    expect(r1.status).toBe("succeeded"); // cost $0.20
    const r2 = await waitRun((await operator.post(`/api/agents/${a.id}/runs`, { input: "two" })).json().id);
    expect(r2.status).toBe("succeeded"); // spent 0.20 + worst-case (~0.002) < 0.25, so still allowed; cost brings total to 0.40
    const r3 = await waitRun((await operator.post(`/api/agents/${a.id}/runs`, { input: "three" })).json().id);
    expect(r3.status).toBe("budget_exceeded");
  });

  it("times out slow providers and honours operator cancel", async () => {
    const { a } = await setup("slow", () => ({ ...openaiOk(), delayMs: 3000 }), {}, { run_timeout_ms: 1000 });
    const run = await waitRun((await operator.post(`/api/agents/${a.id}/runs`, { input: "hi" })).json().id);
    expect(run.status).toBe("timed_out");

    const { a: a2 } = await setup("cancel", () => ({ ...openaiOk(), delayMs: 3000 }));
    const id = (await operator.post(`/api/agents/${a2.id}/runs`, { input: "hi" })).json().id;
    await new Promise((r) => setTimeout(r, 100));
    expect((await operator.post(`/api/runs/${id}/cancel`)).statusCode).toBe(200);
    expect((await waitRun(id)).status).toBe("cancelled");
  });

  it("paused agents cannot run; viewers cannot start runs", async () => {
    const { a } = await setup("paused", () => openaiOk());
    await operator.post(`/api/agents/${a.id}/status`, { status: "paused" });
    expect((await operator.post(`/api/agents/${a.id}/runs`, { input: "hi" })).statusCode).toBe(409);
    await operator.post(`/api/agents/${a.id}/status`, { status: "active" });
    expect((await viewer.post(`/api/agents/${a.id}/runs`, { input: "hi" })).statusCode).toBe(403);
  });

  it("pausing or terminating an agent cancels its in-flight runs", async () => {
    const { a } = await setup("stopme", () => ({ ...openaiOk(), delayMs: 3000 }));
    const id = (await operator.post(`/api/agents/${a.id}/runs`, { input: "hi" })).json().id;
    await new Promise((r) => setTimeout(r, 100));
    const st = await operator.post(`/api/agents/${a.id}/status`, { status: "terminated" });
    expect(st.json().cancelled_runs).toBe(1);
    expect((await waitRun(id)).status).toBe("cancelled");
  });

  it("accepts ?access_token= only on the SSE route", async () => {
    const r = await t.app.inject({ method: "GET", url: `/api/agents?access_token=${t.adminToken}` });
    expect(r.statusCode).toBe(401);
  });

  it("streams run events over SSE, replaying history and ending on finish", async () => {
    const { a } = await setup("sse", () => ({ ...openaiOk("streamed"), delayMs: 150 }));
    const id = (await operator.post(`/api/agents/${a.id}/runs`, { input: "hi" })).json().id;
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (t.app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${id}/events?access_token=${t.adminToken}`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text(); // server closes the stream after run.finished
    const events = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    expect(events).toEqual(["run.started", "route.selected", "model.response", "run.finished"]);
    // a late subscriber still gets the full history
    const late = await (await fetch(`http://127.0.0.1:${port}/api/runs/${id}/events?access_token=${t.adminToken}`)).text();
    expect([...late.matchAll(/^event: (.+)$/gm)].length).toBe(4);
    expect((await fetch(`http://127.0.0.1:${port}/api/runs/${id}/events`)).status).toBe(401);
  });
});
