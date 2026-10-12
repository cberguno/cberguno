// End-to-end browser smoke test: real API + real Postgres + built dashboard + a local model server.
// Usage: node scripts/smoke.mjs   (needs: scripts/test-pg.sh start, pnpm build, apps/web/dist present)
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import http from "node:http";
import { randomBytes } from "node:crypto";
import pg from "../apps/api/node_modules/pg/lib/index.js";

const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const adminUrl = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const dbName = `smoke_${randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`CREATE DATABASE ${dbName}`);

const model = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    let user = "", body = {}; try { body = JSON.parse(b); user = body.messages?.at(-1)?.content ?? ""; } catch {}
    res.writeHead(200, { "content-type": "application/json" });
    const sys = body.messages?.[0]?.content ?? "";
    if (body.tools?.length && sys.startsWith("You are Flight Specialist") && body.messages.at(-1).role !== "tool") {
      return res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "book_flight", arguments: JSON.stringify({ flight: "TAP123", passengers: 2 }) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 150, completion_tokens: 20 } }));
    }
    if (body.messages?.at(-1)?.role === "tool") return res.end(JSON.stringify({ choices: [{ message: { content: "Flight booked: " + /PNR-\w+/.exec(user)?.[0] }, finish_reason: "stop" }], usage: { prompt_tokens: 200, completion_tokens: 20 } }));
    const content = user.includes("You are the orchestrator")
      ? JSON.stringify({ tasks: [{ key: "flights", title: "Find flights", assignee: "Flight Specialist", input: "Find flights to Lisbon" }, { key: "hotels", title: "Find hotels", assignee: "Hotel Specialist", input: "Find hotels in Lisbon", depends_on: ["flights"] }] })
      : "Lisbon in 3 days: Alfama, Belém, Sintra.";
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 40 } }));
  });
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const modelUrl = `http://127.0.0.1:${model.address().port}/v1`;

// a "booking API": counts how many times the irreversible action actually reached the outside world
const bookings = [];
const booking = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { bookings.push({ url: req.url, auth: req.headers.authorization, body: b }); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ confirmation: "PNR-9X2K" })); }); });
await new Promise((r) => booking.listen(0, "127.0.0.1", r));
const bookingUrl = `http://127.0.0.1:${booking.address().port}`;

const PORT = 18080;
const dbUrl = new URL(adminUrl); dbUrl.pathname = `/${dbName}`;
const api = spawn("node_modules/.bin/tsx", ["src/index.ts"], {
  cwd: "apps/api",
  env: { ...process.env, DATABASE_URL: dbUrl.toString(), PLATFORM_MASTER_KEY: randomBytes(32).toString("base64"), JWT_SECRET: "s".repeat(40), PORT: String(PORT), WEB_DIST: "../web/dist", TOOL_ALLOW_PRIVATE_HOSTS: "true", BOOTSTRAP_ADMIN_EMAIL: "admin@example.com", BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery" },
  stdio: ["ignore", "inherit", "inherit"],
});
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

let failed = null;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
try {
  await page.goto(base);
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Agents" }).waitFor();

  // provider + model
  await page.getByRole("link", { name: "Models & providers" }).click();
  await page.getByLabel("Name", { exact: true }).first().fill("local-mock");
  await page.getByLabel("Base URL").fill(modelUrl);
  await page.getByRole("button", { name: "Add provider" }).click();
  await page.getByRole("cell", { name: "local-mock" }).waitFor();
  await page.getByLabel("Provider").selectOption({ label: "local-mock" });
  await page.getByLabel("Model id (as sent to the API)").fill("mock-1");
  await page.getByLabel("$ / Mtok input").fill("1");
  await page.getByLabel("$ / Mtok output").fill("2");
  await page.getByRole("button", { name: "Add model" }).click();
  await page.getByText("mock-1").first().waitFor();
  await page.screenshot({ path: `${SHOTS}/models.png` });

  // agents
  for (const [n, r, k] of [["Travel Director", "Coordinates requests", "orchestrator"], ["Flight Specialist", "Finds flights", "specialist"], ["Hotel Specialist", "Compares hotels", "specialist"]]) {
    await page.getByRole("link", { name: "Agents", exact: true }).click();
    await page.getByRole("button", { name: "New agent" }).click();
    await page.getByLabel("Name", { exact: true }).fill(n);
    await page.getByLabel("Kind").selectOption(k);
    await page.getByLabel("Role (one line)").fill(r);
    await page.getByLabel("Instructions").fill("Be concise.");
    await page.getByRole("button", { name: "Create agent" }).click();
    await page.getByRole("cell", { name: n }).first().waitFor();
  }
  await page.screenshot({ path: `${SHOTS}/agents.png` });

  // run
  await page.getByRole("row", { name: /Travel Director/ }).getByRole("link", { name: "Run" }).click();
  await page.getByLabel("Task / message").fill("Plan a 3 day Lisbon trip");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("Lisbon in 3 days").waitFor({ timeout: 10000 });
  await page.getByText("run.finished").waitFor();
  await page.screenshot({ path: `${SHOTS}/run.png` });

  // team + org chart
  await page.getByRole("link", { name: "Teams & org chart" }).click();
  await page.getByPlaceholder("New team name").fill("Travel Agency");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("heading", { name: /Org chart/ }).waitFor();
  for (const n of ["Travel Director", "Flight Specialist", "Hotel Specialist"]) await page.getByLabel(`Include ${n}`).check();
  for (const n of ["Flight Specialist", "Hotel Specialist"]) await page.getByLabel(`Manager of ${n}`).selectOption({ label: "Travel Director" });
  await page.getByRole("button", { name: "Save team" }).click();
  await page.locator("svg[aria-label='Organisation chart'] .node").nth(2).waitFor();
  const nodes = await page.locator("svg[aria-label='Organisation chart'] .node").count();
  if (nodes !== 3) throw new Error(`expected 3 org nodes, got ${nodes}`);
  await page.screenshot({ path: `${SHOTS}/teams.png` });

  // mission: orchestrator plans, specialists execute, synthesis; graph + message diagram render
  await page.getByRole("link", { name: "Missions" }).click();
  await page.getByLabel("Title").fill("Lisbon trip");
  await page.getByLabel("Team").selectOption({ label: "Travel Agency (3)" });
  await page.getByLabel("Goal").fill("Plan a 3 day Lisbon trip");
  await page.getByRole("button", { name: "Start mission" }).click();
  await page.getByRole("heading", { name: "Lisbon trip" }).waitFor();
  await page.locator(".badge.succeeded").first().waitFor({ timeout: 20000 });
  await page.getByText("Lisbon in 3 days").first().waitFor();
  const tnodes = await page.locator("svg[aria-label='Task graph'] .tnode").count();
  if (tnodes !== 4) throw new Error(`expected 4 task nodes (plan, 2 work, synthesize), got ${tnodes}`);
  const msgs = await page.locator("svg[aria-label='Agent message sequence'] .msg").count();
  if (msgs < 4) throw new Error(`expected >=4 agent messages, got ${msgs}`);
  await page.screenshot({ path: `${SHOTS}/mission.png`, fullPage: true });

  // memory: finished tasks left episodic memories; agent-scoped recall works
  await page.getByRole("link", { name: "Memory" }).click();
  await page.getByLabel("Agent").first().selectOption({ label: "Flight Specialist (reach: agent)" });
  await page.getByRole("cell", { name: /Completed task "Find flights"/ }).first().waitFor();
  await page.getByPlaceholder(/Test recall/).fill("find flights to Lisbon");
  await page.getByRole("button", { name: "Search as agent" }).click();
  await page.getByRole("cell", { name: /Completed task/ }).first().waitFor();
  await page.screenshot({ path: `${SHOTS}/memory.png`, fullPage: true });

  // ---- Phase 3: tools + human approval ----
  const login = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", password: "correct-horse-battery" }) })).json();
  const api = async (m, p, body) => (await fetch(`${base}${p}`, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` }, body: body ? JSON.stringify(body) : undefined })).json();
  const tool = await api("POST", "/api/tools", { name: "book_flight", description: "Book a flight (irreversible)", risk: "irreversible", input_schema: { type: "object", properties: { flight: { type: "string" }, passengers: { type: "integer" } }, required: ["flight"] }, config: { method: "POST", url: `${bookingUrl}/book`, auth: { type: "bearer" } }, api_key: "booking-secret-0042" });
  if (!tool.id) throw new Error("tool create failed: " + JSON.stringify(tool));
  const flightAgent = (await api("GET", "/api/agents")).find((a) => a.name === "Flight Specialist");
  await api("PATCH", `/api/agents/${flightAgent.id}`, { permissions: { tools: ["book_flight"], memory_scope: "agent" } });

  await page.getByRole("link", { name: "Missions" }).click();
  await page.getByLabel("Title").fill("Book Lisbon flights");
  await page.getByLabel("Team").selectOption({ label: "Travel Agency (3)" });
  await page.getByLabel("Goal").fill("Book flights to Lisbon for two");
  await page.getByRole("button", { name: "Start mission" }).click();
  await page.locator("nav .count").waitFor({ timeout: 20000 }); // the nav badge appears when something needs a human
  if (bookings.length !== 0) throw new Error("booking happened BEFORE approval");
  await page.getByRole("link", { name: /^Approvals/ }).click();
  await page.getByText("Waiting for your decision (1)").waitFor();
  const shown = await page.getByLabel("Exactly what will be sent").innerText();
  if (!shown.includes("TAP123") || !shown.includes('"passengers": 2')) throw new Error("approval did not show the exact arguments: " + shown);
  await page.screenshot({ path: `${SHOTS}/approvals.png`, fullPage: true });
  await page.getByLabel("Decision note").fill("Customer confirmed by phone");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByText("Waiting for your decision (0)").waitFor({ timeout: 10000 });
  await page.getByRole("link", { name: "Missions" }).click();
  await page.getByRole("row", { name: /Book Lisbon flights/ }).locator(".badge.succeeded").waitFor({ timeout: 25000 });
  if (bookings.length !== 1) throw new Error(`expected exactly 1 booking, got ${bookings.length}`);
  if (bookings[0].auth !== "Bearer booking-secret-0042" || !bookings[0].body.includes("TAP123")) throw new Error("booking request wrong: " + JSON.stringify(bookings[0]));
  await page.getByRole("row", { name: /Book Lisbon flights/ }).click();
  await page.getByRole("row", { name: /Flight Specialist/ }).getByRole("button", { name: "Output" }).first().click();
  await page.locator("table.inner").getByText("book_flight").first().waitFor(); // two rows: the pending request, then the executed call
  await page.locator("table.inner .badge.ok").waitFor();
  await page.locator("pre.output", { hasText: "Flight booked: PNR-9X2K" }).waitFor();

  // ---- visual workflow builder: draw two tasks, connect them by dragging, save, run ----
  await page.getByRole("link", { name: "Workflow builder" }).click();
  await page.getByLabel("Workflow name").fill("Two step trip");
  for (const title of ["Research flights", "Research hotels"]) {
    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Instructions").fill(title + " for Lisbon");
  }
  const out = await page.locator("g.wnode[data-key=t1] circle.port.out").boundingBox();
  const target = await page.locator("g.wnode[data-key=t2] rect").boundingBox();
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.locator("svg[aria-label='Workflow canvas'] .wedge").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByText(/Valid: every task has an active team member/).waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.").waitFor();
  await page.screenshot({ path: `${SHOTS}/workflow.png`, fullPage: true });
  await page.getByLabel("Goal for this run").fill("Lisbon research");
  await page.getByRole("button", { name: "Run this workflow" }).click();
  await page.getByRole("heading", { name: "Two step trip" }).waitFor();
  await page.locator(".badge.succeeded").first().waitFor({ timeout: 25000 });
  const wfNodes = await page.locator("svg[aria-label='Task graph'] .tnode").count();
  if (wfNodes !== 3) throw new Error(`expected 3 nodes (2 drawn + synthesis), got ${wfNodes}`);

  // schedules + tools pages render
  await page.getByRole("link", { name: "Schedules" }).click();
  await page.getByText("Schedules and monitors").waitFor();
  await page.getByRole("link", { name: "Tools & MCP" }).click();
  await page.getByRole("cell", { name: /book_flight/ }).first().waitFor();
  await page.screenshot({ path: `${SHOTS}/tools.png`, fullPage: true });

  // usage + audit
  await page.getByRole("link", { name: "Cost & usage" }).click();
  await page.getByText("model calls").waitFor();
  await page.getByRole("link", { name: "Audit log" }).click();
  await page.getByRole("cell", { name: "agent.create" }).first().waitFor();
  await page.screenshot({ path: `${SHOTS}/audit.png` });
  if (errors.length) throw new Error("browser errors: " + errors.join(" | "));
  console.log("SMOKE OK");
} catch (e) {
  failed = e;
  await page.screenshot({ path: `${SHOTS}/smoke-failure.png` }).catch(() => {});
  console.error("SMOKE FAILED:", e.message);
} finally {
  await browser.close(); model.close(); booking.close(); api.kill(); await new Promise((r) => api.once('exit', r));
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await admin.end();
}
process.exit(failed ? 1 : 0);
