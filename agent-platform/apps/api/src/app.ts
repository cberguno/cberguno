import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import { audit } from "./audit.js";
import { RunBus } from "./bus.js";
import type { Config } from "./config.js";
import { hashPassword } from "./crypto.js";
import type { Db } from "./db.js";
import { agentRoutes } from "./routes/agents.js";
import { coreRoutes } from "./routes/core.js";
import { memoryRoutes } from "./routes/memory.js";
import { missionRoutes } from "./routes/missions.js";
import { runRoutes } from "./routes/runs.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { toolRoutes } from "./routes/tools.js";
import { ensureBuiltinTools } from "./tools/registry.js";
import { pgToHttp } from "./routes/util.js";
import { RunController, type RuntimeDeps } from "./runtime.js";
import type { ModelProvider, ProviderKind } from "./providers/index.js";

export async function buildApp(db: Db, cfg: Config, opts: { adapters?: Record<ProviderKind, ModelProvider>; logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1_000_000 });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff").header("x-frame-options", "DENY").header("referrer-policy", "no-referrer");
  });
  if (cfg.CORS_ORIGIN) await app.register(cors, { origin: cfg.CORS_ORIGIN.split(","), credentials: false });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const h = pgToHttp(err);
    if (h) return reply.code(h.code).send({ error: h.error });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal error" }); // never leak internals / stack traces
  });

  const bus = new RunBus(db);
  const ctl = new RunController();
  const deps: RuntimeDeps = { db, bus, masterKey: cfg.PLATFORM_MASTER_KEY, adapters: opts.adapters };

  coreRoutes(app, db, cfg);
  agentRoutes(app, db, cfg, ctl);
  runRoutes(app, db, cfg, deps, ctl, bus);
  missionRoutes(app, db, cfg);
  const llm = { db, masterKey: cfg.PLATFORM_MASTER_KEY, adapters: opts.adapters, allowPrivateHosts: cfg.TOOL_ALLOW_PRIVATE_HOSTS };
  memoryRoutes(app, db, cfg, llm);
  toolRoutes(app, db, cfg, llm);
  scheduleRoutes(app, db, cfg);

  // Serve the built dashboard (SPA fallback) when present.
  const webDist = cfg.WEB_DIST;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: path.resolve(webDist) });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"),
    );
  }

  await ensureBuiltinTools(db);
  await bootstrapAdmin(db, cfg);
  return app;
}

async function bootstrapAdmin(db: Db, cfg: Config) {
  if (!cfg.BOOTSTRAP_ADMIN_EMAIL || !cfg.BOOTSTRAP_ADMIN_PASSWORD) return;
  const { rows } = await db.query("SELECT count(*)::int AS n FROM users");
  if (rows[0].n > 0) return;
  const r = await db.query("INSERT INTO users(email, password_hash, role) VALUES ($1,$2,'admin') RETURNING id", [
    cfg.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
    await hashPassword(cfg.BOOTSTRAP_ADMIN_PASSWORD),
  ]);
  await audit(db, { kind: "system", id: null, role: "system" }, "user.bootstrap_admin", { type: "user", id: r.rows[0].id });
}
