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
    let user = ""; try { user = JSON.parse(b).messages?.at(-1)?.content ?? ""; } catch {}
    res.writeHead(200, { "content-type": "application/json" });
    const content = user.includes("You are the orchestrator")
      ? JSON.stringify({ tasks: [{ key: "flights", title: "Find flights", assignee: "Flight Specialist", input: "Find flights to Lisbon" }, { key: "hotels", title: "Find hotels", assignee: "Hotel Specialist", input: "Find hotels in Lisbon", depends_on: ["flights"] }] })
      : "Lisbon in 3 days: Alfama, Belém, Sintra.";
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 40 } }));
  });
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const modelUrl = `http://127.0.0.1:${model.address().port}/v1`;

const PORT = 18080;
const dbUrl = new URL(adminUrl); dbUrl.pathname = `/${dbName}`;
const api = spawn("node_modules/.bin/tsx", ["src/index.ts"], {
  cwd: "apps/api",
  env: { ...process.env, DATABASE_URL: dbUrl.toString(), PLATFORM_MASTER_KEY: randomBytes(32).toString("base64"), JWT_SECRET: "s".repeat(40), PORT: String(PORT), WEB_DIST: "../web/dist", BOOTSTRAP_ADMIN_EMAIL: "admin@example.com", BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery" },
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
  await browser.close(); model.close(); api.kill(); await new Promise((r) => api.once('exit', r));
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await admin.end();
}
process.exit(failed ? 1 : 0);
