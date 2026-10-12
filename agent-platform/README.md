# Agent Platform

An industry-independent platform for building, running and supervising teams of AI agents. First application: an AI travel agency (Phase 4).

**Status: Phases 1–2 of 5 are built and tested.** Read [docs/PHASES.md](docs/PHASES.md) for exactly what exists versus what is only designed. In short:

| Works now | Not built yet |
|---|---|
| Auth + RBAC, append-only audit log, encrypted credential vault | Tools, MCP, browser automation, scheduling, approvals, visual workflow builder (Phase 3) |
| Provider/model registry; OpenAI-compatible, Anthropic and Gemini adapters; cost/latency/complexity-aware router with fallback | The travel team and customer experience (Phase 4) |
| Agent builder (versioned), pause/resume/terminate, per-run + daily budgets, timeouts | Evaluation/promotion pipeline, load tests, backup drills (Phase 5) |
| **Missions:** orchestrator plans → specialists work in parallel → synthesis, with QA review, questions, delegation, escalation to humans; durable across crashes (Postgres queue, leases, fencing) | Redis (deliberately omitted; see docs/ARCHITECTURE.md §9) |
| **Memory:** pgvector semantic search (keyword fallback), episodic/semantic/lesson × agent/team/org scopes, consolidation, automatic retrieval into prompts | Agents originating free-form messages (by design only structured flows exist) |
| Teams + org chart, run console with live event stream, usage/cost dashboard, mission task graph + agent-message diagram, memory browser | |

A team of agents can already plan, divide, execute, review and synthesize a mission, remember what they learned, and survive a worker crash mid-mission. They cannot yet use tools (search, browse, book) — every agent is a model call plus memory — so this is **not yet** an agency that can act on the outside world, and nothing in the UI pretends otherwise.

Adapters are verified against local protocol-faithful HTTP servers. **They have not been run against the live vendor APIs** (no keys in the build sandbox); after adding a provider, use *Test* on the Models page.

## Layout

```
apps/api   Fastify + PostgreSQL API, runtime, router, provider adapters, SQL migrations, tests
apps/web   React dashboard (Vite)
docs/      ARCHITECTURE.md  PHASES.md  DEPLOYMENT.md
scripts/   test-pg.sh (throwaway Postgres), smoke.mjs (browser end-to-end test)
```

## Quick start (development)

Requires Node 22, pnpm 10, PostgreSQL 14+ **with the `pgvector` extension** (use the `pgvector/pgvector:pg16` image, or `apt install postgresql-16-pgvector`).

```bash
pnpm install
cp .env.example .env            # fill PLATFORM_MASTER_KEY, JWT_SECRET, bootstrap admin
export DATABASE_URL=postgres://user:pass@localhost:5432/agent
set -a; . ./.env; set +a
pnpm dev:api                    # :8080, runs migrations on boot
pnpm dev:web                    # :5173, proxies /api -> :8080
```

Sign in with the bootstrap admin, then: **Models & providers** → add a provider (preset + API key) → add a chat model with its id and prices → **Agents** → create an *orchestrator* and some specialists → **Teams** → put them in a team (orchestrator on top) → **Missions** → *Start mission*. Optional: add an *embedding* model and select it on the **Memory** page for semantic recall; add a QA agent to the team and tick *QA review* for reviewed missions.

Missions run in the API process by default. To scale out: `docker compose --profile scale up -d --scale worker=3` or run `node dist/worker-main.js` elsewhere against the same database.

## Tests

```bash
scripts/test-pg.sh start                # local throwaway Postgres on :54329 (needs pgvector installed) or set TEST_DATABASE_URL
pnpm typecheck && pnpm --filter @ap/api test
pnpm build && node scripts/smoke.mjs    # real browser: login → provider → agent → run → org chart → audit
```

The API tests run against a real PostgreSQL (one temp database per file) and a local HTTP server that plays the model vendor, so the whole path — router, credential decryption, HTTP adapter, cost accounting, SSE — is exercised, not mocked out.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `PLATFORM_MASTER_KEY` | yes | 32 bytes base64; encrypts stored provider keys (AES-256-GCM). **Back it up; losing it loses the stored keys.** |
| `JWT_SECRET` | yes | ≥32 chars; signs session tokens |
| `BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` | first boot | Creates the first admin if no users exist (password ≥12 chars) |
| `PORT`, `HOST` | no | default `8080`, `0.0.0.0` |
| `WORKER_EMBEDDED`, `WORKER_CONCURRENCY`, `WORKER_LEASE_MS`, `WORKER_POLL_MS` | no | Mission worker: embedded in the API (default `true`), parallel tasks (4), lease before a dead worker's task is retried (60000), poll interval (500) |
| `WEB_DIST` | no | Directory of the built dashboard to serve (the Docker image sets it) |
| `CORS_ORIGIN` | no | Comma-separated origins, only if the UI is on another origin |

## Roles

| | viewer | operator | admin |
|---|---|---|---|
| View everything except audit | ✅ | ✅ | ✅ |
| Create/edit agents (name, role, goal, instructions, model, routing), teams, start/cancel runs, start/cancel/resume missions, add/delete memories, pause/terminate | | ✅ | ✅ |
| Set agent **permissions (incl. memory reach), budgets, timeouts**; manage providers, models, keys, users, embedding model; write org-wide memory; run consolidation; read audit | | | ✅ |

Agent identities (`role: agent` tokens) satisfy none of these checks, so an agent cannot raise its own privileges. This is tested.

Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
