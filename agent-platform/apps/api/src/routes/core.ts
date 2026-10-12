import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { audit } from "../audit.js";
import { authHook, requireRole, signToken } from "../auth.js";
import { hashPassword, open, seal, verifyPassword } from "../crypto.js";
import type { Db } from "../db.js";
import { adapters, PROVIDER_PRESETS, type ProviderKind } from "../providers/index.js";
import { parse } from "./util.js";

export function coreRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const authed = { preHandler: [authHook(cfg.JWT_SECRET)] };
  const operator = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("operator")] };
  const admin = { preHandler: [authHook(cfg.JWT_SECRET), requireRole("admin")] };

  app.get("/api/health", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  // ---- auth ----
  const attempts = new Map<string, { n: number; until: number }>(); // naive per-email throttle; Phase 5 adds IP-aware limiter
  app.post("/api/auth/login", async (req, reply) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body, reply);
    if (!body) return;
    const key = body.email.toLowerCase();
    const a = attempts.get(key);
    if (a && a.n >= 5 && Date.now() < a.until) return reply.code(429).send({ error: "too many attempts, retry later" });
    const { rows } = await db.query("SELECT id, password_hash, role FROM users WHERE email=$1", [key]);
    const u = rows[0];
    const ok = u ? await verifyPassword(body.password, u.password_hash) : (await hashPassword("x"), false); // equalise timing
    if (!ok) {
      attempts.set(key, { n: (a && Date.now() < a.until ? a.n : 0) + 1, until: Date.now() + 5 * 60_000 });
      await audit(db, { kind: "system", id: null, role: "system" }, "auth.login_failed", { type: "user", id: key });
      return reply.code(401).send({ error: "invalid credentials" });
    }
    attempts.delete(key);
    await audit(db, { kind: "user", id: u.id, role: u.role }, "auth.login");
    return { token: await signToken(cfg.JWT_SECRET, u), role: u.role };
  });

  app.get("/api/auth/me", authed, async (req) => req.actor);

  app.post("/api/users", admin, async (req, reply) => {
    const body = parse(
      z.object({ email: z.string().email(), password: z.string().min(12), role: z.enum(["admin", "operator", "viewer"]) }),
      req.body,
      reply,
    );
    if (!body) return;
    const { rows } = await db.query("INSERT INTO users(email, password_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role", [
      body.email.toLowerCase(),
      await hashPassword(body.password),
      body.role,
    ]);
    await audit(db, req.actor!, "user.create", { type: "user", id: rows[0].id }, { email: body.email, role: body.role });
    return reply.code(201).send(rows[0]);
  });

  // ---- providers (credentials are write-only) ----
  app.get("/api/provider-presets", authed, async () => PROVIDER_PRESETS);

  app.get("/api/providers", authed, async () => {
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.kind, p.base_url, p.enabled, c.last4 AS key_hint, (p.credential_id IS NOT NULL) AS has_key
         FROM providers p LEFT JOIN credentials c ON c.id = p.credential_id ORDER BY p.name`,
    );
    return rows;
  });

  const providerBody = z.object({
    name: z.string().min(1).max(60),
    kind: z.enum(["openai_compat", "anthropic", "gemini"]),
    base_url: z.string().url(),
    api_key: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  });

  app.post("/api/providers", admin, async (req, reply) => {
    const b = parse(providerBody, req.body, reply);
    if (!b) return;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      let credId: string | null = null;
      if (b.api_key) {
        const c = await client.query("INSERT INTO credentials(label, sealed, last4) VALUES ($1,$2,$3) RETURNING id", [
          `provider:${b.name}`,
          seal(b.api_key, cfg.PLATFORM_MASTER_KEY),
          b.api_key.slice(-4),
        ]);
        credId = c.rows[0].id;
      }
      const { rows } = await client.query(
        "INSERT INTO providers(name, kind, base_url, credential_id, enabled) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, kind, base_url, enabled",
        [b.name, b.kind, b.base_url, credId, b.enabled ?? true],
      );
      await client.query("COMMIT");
      await audit(db, req.actor!, "provider.create", { type: "provider", id: rows[0].id }, { ...b });
      return reply.code(201).send({ ...rows[0], has_key: !!credId });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch("/api/providers/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(providerBody.partial(), req.body, reply);
    if (!b) return;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query("SELECT credential_id FROM providers WHERE id=$1 FOR UPDATE", [id]);
      if (!cur.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "not found" });
      }
      let credId: string | null = cur.rows[0].credential_id;
      if (b.api_key) {
        const c = await client.query("INSERT INTO credentials(label, sealed, last4) VALUES ($1,$2,$3) RETURNING id", [
          `provider:${b.name ?? id}`,
          seal(b.api_key, cfg.PLATFORM_MASTER_KEY),
          b.api_key.slice(-4),
        ]);
        if (credId) await client.query("DELETE FROM credentials WHERE id=$1", [credId]); // rotate: old secret is destroyed
        credId = c.rows[0].id;
      }
      const { rows } = await client.query(
        `UPDATE providers SET name=COALESCE($2,name), kind=COALESCE($3,kind), base_url=COALESCE($4,base_url),
                enabled=COALESCE($5,enabled), credential_id=$6 WHERE id=$1 RETURNING id, name, kind, base_url, enabled`,
        [id, b.name ?? null, b.kind ?? null, b.base_url ?? null, b.enabled ?? null, credId],
      );
      await client.query("COMMIT");
      await audit(db, req.actor!, "provider.update", { type: "provider", id }, { ...b });
      return { ...rows[0], has_key: !!credId };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

  app.delete("/api/providers/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await db.query("DELETE FROM providers WHERE id=$1 RETURNING credential_id", [id]);
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    if (rows[0].credential_id) await db.query("DELETE FROM credentials WHERE id=$1", [rows[0].credential_id]);
    await audit(db, req.actor!, "provider.delete", { type: "provider", id });
    return reply.code(204).send();
  });

  // Live connectivity check: a 1-token completion using a model of this provider.
  app.post("/api/providers/:id/test", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await db.query(
      `SELECT p.kind, p.base_url, c.sealed, (SELECT model_name FROM models WHERE provider_id=p.id AND enabled ORDER BY created_at LIMIT 1) AS model
         FROM providers p LEFT JOIN credentials c ON c.id=p.credential_id WHERE p.id=$1`,
      [id],
    );
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: "not found" });
    if (!r.model) return reply.code(400).send({ error: "add a model to this provider first" });
    const t0 = Date.now();
    try {
      await adapters[r.kind as ProviderKind].complete(
        { kind: r.kind, baseUrl: r.base_url, apiKey: r.sealed ? open(r.sealed, cfg.PLATFORM_MASTER_KEY) : null },
        { model: r.model, messages: [{ role: "user", content: "ping" }], maxTokens: 1, signal: AbortSignal.timeout(15_000) },
      );
      return { ok: true, model: r.model, latency_ms: Date.now() - t0 };
    } catch (e) {
      return reply.code(502).send({ ok: false, error: (e as Error).message });
    }
  });

  // ---- models ----
  app.get("/api/models", authed, async () => {
    const { rows } = await db.query(
      `SELECT m.*, p.name AS provider_name FROM models m JOIN providers p ON p.id=m.provider_id ORDER BY p.name, m.tier, m.display_name`,
    );
    return rows;
  });

  const modelBody = z.object({
    provider_id: z.string().uuid(),
    model_name: z.string().min(1),
    display_name: z.string().min(1),
    tier: z.enum(["fast", "standard", "frontier"]),
    context_window: z.number().int().positive().default(8192),
    supports_tools: z.boolean().default(false),
    supports_vision: z.boolean().default(false),
    usd_per_mtok_in: z.number().min(0).default(0),
    usd_per_mtok_out: z.number().min(0).default(0),
    enabled: z.boolean().default(true),
  });

  app.post("/api/models", admin, async (req, reply) => {
    const b = parse(modelBody, req.body, reply);
    if (!b) return;
    const { rows } = await db.query(
      `INSERT INTO models(provider_id, model_name, display_name, tier, context_window, supports_tools, supports_vision, usd_per_mtok_in, usd_per_mtok_out, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.provider_id, b.model_name, b.display_name, b.tier, b.context_window, b.supports_tools, b.supports_vision, b.usd_per_mtok_in, b.usd_per_mtok_out, b.enabled],
    );
    await audit(db, req.actor!, "model.create", { type: "model", id: rows[0].id }, b);
    return reply.code(201).send(rows[0]);
  });

  app.patch("/api/models/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = parse(modelBody.omit({ provider_id: true }).partial(), req.body, reply);
    if (!b) return;
    const cols = Object.keys(b);
    if (cols.length === 0) return reply.code(400).send({ error: "nothing to update" });
    // column names come from the zod-validated key set above, never from user input directly
    const set = cols.map((c, i) => `${c}=$${i + 2}`).join(", ");
    const { rows } = await db.query(`UPDATE models SET ${set} WHERE id=$1 RETURNING *`, [id, ...Object.values(b)]);
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    await audit(db, req.actor!, "model.update", { type: "model", id }, b);
    return rows[0];
  });

  app.delete("/api/models/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("DELETE FROM models WHERE id=$1", [id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not found" });
    await audit(db, req.actor!, "model.delete", { type: "model", id });
    return reply.code(204).send();
  });

  // ---- usage + audit ----
  app.get("/api/usage/summary", authed, async (req) => {
    const days = Math.min(Math.max(parseInt((req.query as { days?: string }).days ?? "7", 10) || 7, 1), 90);
    const since = `now() - ($1 || ' days')::interval`;
    const [byAgent, byModel, byDay, totals] = await Promise.all([
      db.query(`SELECT a.id, a.name, count(*)::int AS calls, sum(u.tokens_in)::int AS tokens_in, sum(u.tokens_out)::int AS tokens_out, sum(u.cost_usd) AS cost_usd
                  FROM usage_events u JOIN agents a ON a.id=u.agent_id WHERE u.at > ${since} GROUP BY a.id ORDER BY cost_usd DESC`, [String(days)]),
      db.query(`SELECT m.id, m.display_name, count(*)::int AS calls, sum(u.cost_usd) AS cost_usd, avg(u.latency_ms)::int AS avg_latency_ms
                  FROM usage_events u JOIN models m ON m.id=u.model_id WHERE u.at > ${since} GROUP BY m.id ORDER BY cost_usd DESC`, [String(days)]),
      db.query(`SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, sum(cost_usd) AS cost_usd, sum(tokens_in+tokens_out)::int AS tokens
                  FROM usage_events WHERE at > ${since} GROUP BY 1 ORDER BY 1`, [String(days)]),
      db.query(`SELECT COALESCE(sum(cost_usd),0) AS cost_usd, COALESCE(sum(tokens_in),0)::int AS tokens_in, COALESCE(sum(tokens_out),0)::int AS tokens_out, count(*)::int AS calls
                  FROM usage_events WHERE at > ${since}`, [String(days)]),
    ]);
    return { days, totals: totals.rows[0], byAgent: byAgent.rows, byModel: byModel.rows, byDay: byDay.rows };
  });

  app.get("/api/audit", admin, async (req) => {
    const limit = Math.min(parseInt((req.query as { limit?: string }).limit ?? "100", 10) || 100, 500);
    const { rows } = await db.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT $1", [limit]);
    return rows;
  });
}
