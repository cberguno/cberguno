# Agent Platform

An industry-independent platform for building, running and supervising teams of AI agents. First application: an AI travel agency (Phase 4).

**Status: Phase 1 of 5 is built and tested.** Read [docs/PHASES.md](docs/PHASES.md) for exactly what exists versus what is only designed. In short:

| Works now | Not built yet |
|---|---|
| Auth + RBAC, append-only audit log, encrypted credential vault | Agent-to-agent messaging, delegation, durable multi-step missions (Phase 2) |
| Provider/model registry; OpenAI-compatible, Anthropic and Gemini adapters | pgvector memory / RAG (Phase 2) |
| Cost/latency/complexity-aware model router with fallback | Tools, MCP, browser automation, scheduling, approvals (Phase 3) |
| Agent builder (versioned), pause/resume/terminate, per-run + daily budgets, timeouts | The travel team and customer experience (Phase 4) |
| Teams + org chart, run console with live event stream, usage/cost dashboard | Evaluation/promotion pipeline, load tests, backup drills (Phase 5) |

A single agent can already be created, pointed at a real model, run, watched and costed. It cannot yet use tools or talk to other agents — so it is **not yet** an autonomous workforce, and nothing in the UI pretends otherwise.

Adapters are verified against local protocol-faithful HTTP servers. **They have not been run against the live vendor APIs** (no keys in the build sandbox); after adding a provider, use *Test* on the Models page.

## Layout

```
apps/api   Fastify + PostgreSQL API, runtime, router, provider adapters, SQL migrations, tests
apps/web   React dashboard (Vite)
docs/      ARCHITECTURE.md  PHASES.md  DEPLOYMENT.md
scripts/   test-pg.sh (throwaway Postgres), smoke.mjs (browser end-to-end test)
```

## Quick start (development)

Requires Node 22, pnpm 10, PostgreSQL 14+.

```bash
pnpm install
cp .env.example .env            # fill PLATFORM_MASTER_KEY, JWT_SECRET, bootstrap admin
export DATABASE_URL=postgres://user:pass@localhost:5432/agent
set -a; . ./.env; set +a
pnpm dev:api                    # :8080, runs migrations on boot
pnpm dev:web                    # :5173, proxies /api -> :8080
```

Sign in with the bootstrap admin, then: **Models & providers** → add a provider (preset + API key) → add a model with its id and prices → **Agents** → *New agent* → **Run console**.

## Tests

```bash
scripts/test-pg.sh start                # local throwaway Postgres on :54329 (or set TEST_DATABASE_URL)
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
| `WEB_DIST` | no | Directory of the built dashboard to serve (the Docker image sets it) |
| `CORS_ORIGIN` | no | Comma-separated origins, only if the UI is on another origin |

## Roles

| | viewer | operator | admin |
|---|---|---|---|
| View everything except audit | ✅ | ✅ | ✅ |
| Create/edit agents (name, role, goal, instructions, model, routing), teams, start/cancel runs, pause/terminate | | ✅ | ✅ |
| Set agent **permissions, budgets, timeouts**; manage providers, models, keys, users; read audit | | | ✅ |

Agent identities (`role: agent` tokens) satisfy none of these checks, so an agent cannot raise its own privileges. This is tested.

Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
