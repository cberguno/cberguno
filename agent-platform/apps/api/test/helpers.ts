import { randomBytes } from "node:crypto";
import http from "node:http";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, migrate, type Db } from "../src/db.js";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";

/** Each test file gets its own throwaway database against a real Postgres. */
export async function freshDb() {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  const db = createDb(u.toString());
  await migrate(db);
  return {
    db,
    url: u.toString(),
    async drop() {
      await db.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

export const MASTER_KEY = randomBytes(32).toString("base64");

export function testConfig(url: string) {
  return loadConfig({
    DATABASE_URL: url,
    PLATFORM_MASTER_KEY: MASTER_KEY,
    JWT_SECRET: "j".repeat(40),
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery",
  } as NodeJS.ProcessEnv);
}

export async function appWithAdmin(db: Db, url: string) {
  const cfg = testConfig(url);
  const app = await buildApp(db, cfg);
  const login = async (email: string, password: string) =>
    (await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } })).json().token as string;
  const adminToken = await login("admin@example.com", "correct-horse-battery");
  const mkUser = async (role: string) => {
    const email = `${role}-${randomBytes(3).toString("hex")}@example.com`;
    const r = await app.inject({ method: "POST", url: "/api/users", headers: { authorization: `Bearer ${adminToken}` }, payload: { email, password: "a-long-password-1", role } });
    if (r.statusCode !== 201) throw new Error(`mkUser failed: ${r.body}`);
    return login(email, "a-long-password-1");
  };
  const as = (token: string) => ({
    get: (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } }),
    post: (url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload: payload as object }),
    patch: (url: string, payload: unknown) => app.inject({ method: "PATCH", url, headers: { authorization: `Bearer ${token}` }, payload: payload as object }),
    put: (url: string, payload: unknown) => app.inject({ method: "PUT", url, headers: { authorization: `Bearer ${token}` }, payload: payload as object }),
    del: (url: string) => app.inject({ method: "DELETE", url, headers: { authorization: `Bearer ${token}` } }),
  });
  return { app, cfg, adminToken, mkUser, as };
}

export type MockHandler = (req: { url: string; headers: http.IncomingHttpHeaders; body: any }) => { status: number; body: unknown; delayMs?: number };

/** Real HTTP server standing in for a model vendor. Records every request it receives. */
export async function mockServer(handler: MockHandler) {
  const seen: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const r = { url: req.url ?? "", headers: req.headers, body: data ? JSON.parse(data) : null };
      seen.push(r);
      const out = handler(r);
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.body));
      }, out.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

export const openaiOk = (text = "hello", tin = 100, tout = 50) => ({
  status: 200,
  body: { choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: tin, completion_tokens: tout } },
});
