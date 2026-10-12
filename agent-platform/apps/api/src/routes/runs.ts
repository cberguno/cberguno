import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { authHook, requireRole } from "../auth.js";
import type { RunBus, RunEvent } from "../bus.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { type AgentRow, type RunController, type RuntimeDeps, startRun } from "../runtime.js";
import { parse, pgToHttp } from "./util.js";

export function runRoutes(app: FastifyInstance, db: Db, cfg: Config, deps: RuntimeDeps, ctl: RunController, bus: RunBus) {
  const authed = { preHandler: [authHook(cfg.JWT_SECRET)] };
  const operator = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("operator")] };

  app.post("/api/agents/:id/runs", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ input: z.string().min(1).max(50000), max_output_tokens: z.number().int().min(1).max(8192).optional() }), req.body, reply);
    if (!b) return;
    let agent: AgentRow | undefined;
    try {
      agent = (await db.query("SELECT * FROM agents WHERE id=$1", [id])).rows[0];
    } catch (e) {
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    }
    if (!agent) return reply.code(404).send({ error: "not found" });
    if (agent.status !== "active") return reply.code(409).send({ error: `agent is ${agent.status}` });
    const runId = await startRun(deps, ctl, agent, b.input, req.actor!.id, { maxOutputTokens: b.max_output_tokens });
    await audit(db, req.actor!, "run.start", { type: "run", id: runId }, { agent_id: id });
    return reply.code(202).send({ id: runId });
  });

  app.get("/api/runs", authed, async (req) => {
    const q = req.query as { agent_id?: string; limit?: string };
    const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 200);
    const { rows } = await db.query(
      `SELECT r.id, r.agent_id, a.name AS agent_name, r.status, r.input, r.cost_usd, r.tokens_in, r.tokens_out, r.started_at, r.finished_at
         FROM runs r JOIN agents a ON a.id=r.agent_id
        WHERE ($1::uuid IS NULL OR r.agent_id=$1) ORDER BY r.started_at DESC LIMIT $2`,
      [q.agent_id ?? null, limit],
    );
    return rows;
  });

  app.get("/api/runs/:id", authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const r = (await db.query("SELECT * FROM runs WHERE id=$1", [id])).rows[0];
      if (!r) return reply.code(404).send({ error: "not found" });
      const events = (await db.query("SELECT id, type, data, at FROM run_events WHERE run_id=$1 ORDER BY id", [id])).rows;
      return { ...r, events };
    } catch (e) {
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    }
  });

  app.post("/api/runs/:id/cancel", operator, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = ctl.cancel(id);
    if (!ok) return reply.code(409).send({ error: "run is not running on this node" });
    await audit(db, req.actor!, "run.cancel", { type: "run", id });
    return { ok: true };
  });

  // Server-sent events: replay persisted events, then stream live ones until the run finishes.
  app.get("/api/runs/:id/events", authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    let status: string | undefined;
    try {
      status = (await db.query("SELECT status FROM runs WHERE id=$1", [id])).rows[0]?.status;
    } catch (e) {
      const h = pgToHttp(e);
      if (h) return reply.code(h.code).send({ error: h.error });
      throw e;
    }
    if (!status) return reply.code(404).send({ error: "not found" });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    let lastId = 0;
    let closed = false;
    const queue: RunEvent[] = [];
    let replaying = true;
    const send = (e: RunEvent) => {
      if (e.id <= lastId) return; // dedupe the replay/live overlap
      lastId = e.id;
      res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      if (e.type === "run.finished") end();
    };
    const end = () => {
      if (closed) return;
      closed = true;
      unsub();
      clearInterval(ping);
      res.end();
    };
    const unsub = bus.subscribe(id, (e) => (replaying ? queue.push(e) : send(e))); // subscribe BEFORE replay: no gap
    const ping = setInterval(() => !closed && res.write(": ping\n\n"), 15000);
    req.raw.on("close", end);

    const past = (await db.query("SELECT id, run_id, type, data, at FROM run_events WHERE run_id=$1 ORDER BY id", [id])).rows as RunEvent[];
    for (const e of past) send(e);
    replaying = false;
    for (const e of queue) send(e);
    // Run already over (e.g. finished before we subscribed and the finish event was in `past`) is handled by send(); this covers a crash-recovered run.
    if (!closed && status !== "running") {
      const fin = (await db.query("SELECT status FROM runs WHERE id=$1", [id])).rows[0]?.status;
      if (fin !== "running") end();
    }
  });
}
