# Agent Platform — Architecture

Status: Phases 1–2 implemented. Phases 3–5 are designed here and **not yet built**; see [PHASES.md](PHASES.md).

## 0. Repository inspection (done before any code)

| Finding | Consequence |
|---|---|
| Repo `cberguno/cberguno` contained only a profile `README.md` (one commit, no code, no CI, no infra). | Greenfield: nothing to reuse. |
| That repo is GitHub's *profile* repo; its `README.md` renders on the profile page. | Everything lives under `agent-platform/`; the profile README is untouched. If you'd rather have this in its own repo, `git subtree split -P agent-platform` moves it with history. |
| Toolchain available: Node 22, pnpm 10, PostgreSQL 16 server, Redis 7, Docker CLI. | TypeScript/pnpm stack. Integration tests run against a real Postgres. |
| `pgvector` is not installed in the dev sandbox; Docker daemon not running there. | pgvector (Phase 2) is tested via the `pgvector/pgvector` image in CI/compose, not in the sandbox. Docker images are written but were **not built** in the sandbox. |

## 1. Principles

1. **Postgres is the source of truth.** Tasks, missions, messages, memory, audit — all durable rows. Redis is a transport/cache; losing Redis loses no state, only in-flight dispatch (recovered from Postgres on restart).
2. **Agents are data, not code.** An agent = row (role, goal, instructions, model policy, tool grants, memory config, budgets). New agents need no deploy.
3. **Privilege is outside the agent's reach.** Permissions, budgets and tool grants are mutable only by authenticated *human* actors with the right role. Agent-actor tokens are rejected by every privilege-mutating route (enforced and tested in Phase 1).
4. **Secrets never enter prompts.** Credentials are sealed with AES-256-GCM, resolved server-side at call time inside the provider/tool adapters. The model only ever sees tool names and schemas.
5. **No simulated integrations.** Each adapter speaks the real wire protocol. Where I could not exercise it against the live service (no keys in the sandbox) it is tested against a local protocol-faithful mock and documented as such in PHASES.md.
6. **Irreversible actions need a human.** Purchases/bookings/payments/cancellations are tool-level `approval: required`, enforced in the tool gateway, not in the prompt.

## 2. Component view

```
 Browser (React dashboard) ──HTTPS──▶ API (Fastify, apps/api)
                                       │  auth/RBAC · audit · SSE
                 ┌─────────────────────┼───────────────────────────┐
                 ▼                     ▼                           ▼
        Model Router + Providers   Agent Runtime            Tool Gateway (P3)
        (openai-compat, anthropic,  (run loop, budgets,     (registry, MCP client,
         gemini; fallback chain)     timeouts, events)       approvals, rate limits)
                 │                     │                           │
                 └──────────┬──────────┴───────────┬───────────────┘
                            ▼                      ▼
                      PostgreSQL (+pgvector P2)   Redis (bus/queues P2)
                                                   ▲
                                      Workers (P2/P3): agent workers, browser workers
```

Phase 1 runs API + runtime in one process. The runtime is written against a `RunStore`/event interface so Phase 2 can move execution into separate workers without changing callers.

## 3. Agent hierarchy (Phase 2+ semantics)

* **Orchestrator** — decomposes a mission into tasks, assigns to specialists, watches progress, resolves conflicts, escalates to a human.
* **Specialist / Research / Execution / QA** — differ by *kind* (`agents.kind`), default tool grants and prompts, not by code path.
* Delegation = creating a `task` row with `parent_task_id`, `assignee_agent_id`, and a typed `input`. Agents may create subtasks only for agents in their team and only within their remaining delegation budget (depth + fan-out limits, enforced server-side).
* QA agents review a task's `output` and either `accept` or `request_changes` (creates a correction task, bounded retries, then escalates).

## 4. Protocols

### 4.1 Message envelope (agent ↔ agent, Phase 2)

```json
{
  "id": "uuid", "mission_id": "uuid", "task_id": "uuid|null",
  "from": {"kind":"agent|user|system","id":"uuid"},
  "to":   {"kind":"agent|channel","id":"uuid|string"},
  "type": "task.assign|task.progress|task.result|task.blocked|question|answer|review.request|review.verdict|escalation",
  "body": { },                       // typed per `type`, validated by zod; no free-form chatter between agents
  "refs": ["artifact:uuid","memory:uuid"], // pointers instead of pasted context (token economy)
  "created_at": "iso8601"
}
```

Token economy rules: agents pass **refs**, not transcripts; each agent receives only (task input + retrieved memory top-k + referenced artifacts); `question` is only valid to the assigner; a hop limit and per-mission message budget stop runaway conversations.

### 4.2 Task lifecycle

`pending → claimed → running → (awaiting_approval | blocked) → in_review → done | failed | escalated | cancelled`

Claiming uses `SELECT … FOR UPDATE SKIP LOCKED` with a lease (`lease_expires_at`); a reaper re-queues expired leases, so a crashed worker never strands a task. Retries use exponential backoff with `attempt`/`max_attempts`; side-effecting tool calls carry an idempotency key so a retry cannot double-execute.

### 4.3 Tool call policy (Phase 3)

`agent → gateway(tool, args)` → check grant → validate args against JSON-schema → rate limit → if `approval=required` write `approval_requests` row and park the task (`awaiting_approval`) → execute with server-held credential → record `tool_calls` row → return result **wrapped as untrusted data** (prompt-injection defense: results are delimited, never concatenated into the system prompt, and may not trigger privileged tools without a fresh grant check).

### 4.4 Live vs. estimated data (travel)

Every tool result carries `provenance: {source, retrieved_at, kind: "live"|"cached"|"estimate"}`. Agent outputs must propagate it; QA rejects any customer-facing price/availability lacking `kind=live` unless labelled as estimate.

## 5. Database schema

Phase 1 tables are real migrations in `apps/api/migrations/`. Later phases (design, not yet migrated):

| Phase | Tables |
|---|---|
| **1 (built)** | `users`, `credentials`, `providers`, `models`, `agents`, `agent_versions`, `teams`, `team_members`, `runs`, `run_events`, `usage_events`, `audit_log` |
| **2 (built)** | `missions`, `tasks` (lease, attempt, depends_on, revision), `messages`, `memories` (`embedding vector`, `kind: episodic/semantic/lesson`, `scope: agent/team/org`, `salience`, `access_count`, `consolidated_into`), `settings`; `models.kind`; `usage_events.task_id/mission_id`. Channels are a column on `messages`; `artifacts` deferred. |
| 3 | `tools`, `tool_grants`, `mcp_servers`, `tool_calls`, `approval_requests`, `schedules`, `monitors` |
| 4 | `customers`, `trips`, `quotes` (with provenance), `bookings` (draft/authorised/confirmed) |
| 5 | `eval_suites`, `eval_cases`, `eval_runs`, `experiments` (config A/B, promote gate), `backups` metadata |

## 6. Model independence

`ModelProvider` interface: `complete({model, messages, tools?, maxTokens, signal}) → {text, toolCalls, usage, finishReason}`.

| Adapter | Covers |
|---|---|
| `openai_compat` | OpenAI, xAI Grok, DeepSeek, Qwen (DashScope compatible mode), OpenRouter, Hugging Face Inference Endpoints/Providers, Ollama / vLLM / llama.cpp servers — differ only by `base_url` + key |
| `anthropic` | Anthropic Messages API |
| `gemini` | Google `generateContent` API |

**Router.** Candidates = enabled models of enabled providers that satisfy hard constraints (context window, tools, vision). Ranked per policy: `cheapest` (default), `fastest`, or `quality` (highest tier first); tier is chosen from task complexity (`low→fast`, `medium→standard`, `high→frontier`, falling back across tiers). On provider error/timeout/429 the router tries the next candidate (bounded). Complexity is currently *declared* by the agent config or caller; automatic classification is a Phase 5 item that must beat the declared baseline in the eval suite before being enabled. No model names or prices are hard-coded: they're rows you manage, because they change faster than releases.

## 7. Security model

* RBAC roles: `admin` > `operator` > `viewer`. Actor kinds: `user`, `agent`. Agent actors cannot call privilege routes (`agents` write, grants, budgets, credentials, approvals).
* Passwords: scrypt. Sessions: signed JWT (HS256, `jose`), short expiry.
* Credentials: AES-256-GCM, random 96-bit nonce, key from `PLATFORM_MASTER_KEY` (32 bytes, base64). Never returned by any API; only a `last4` hint.
* Audit: append-only `audit_log` for every mutating call (actor, action, target, redacted diff). A DB trigger blocks UPDATE/DELETE on it.
* Limits: per-run timeout, per-run cost cap, per-agent daily budget, enforced before every model call.
* Isolation: runs execute inside a per-run `AbortController` budget in Phase 1; Phase 3 browser/tool workers run in separate containers without DB credentials.

## 8. Infrastructure

* One `Dockerfile` (multi-stage) builds API + static dashboard; `docker-compose.yml` = api + `pgvector/pgvector:pg16` + redis. Compatible with OVH VPS (compose behind Caddy/nginx) and Railway (Dockerfile service + Postgres/Redis plugins). Nothing requires AWS/Azure/GCP.
* Horizontal scale: API is stateless (Phase 1 SSE fan-out is in-process, moves to Redis pub/sub in Phase 2 — a documented single-node limitation until then). Workers scale by count; queue claiming is lock-safe.

## 9. Phase 2 as built (decisions and why)

**Postgres only; no Redis.** The brief preferred Redis queues. The queue is `tasks` claimed with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`: durable by construction, transactional with the state it changes (a result, its child tasks and its messages commit together or not at all), and one fewer service to run and back up. Redis becomes worthwhile for sub-second cross-replica fan-out or very high task rates; neither applies yet, and swapping it in later touches `queue.ts`/`bus.ts` only.

**Execution model.** `Worker` (embedded in the API by default, or standalone via `worker-main.ts`) loops: reap expired leases → claim → execute. A claim sets `status=running, locked_by, lease_expires_at, attempt+1`; a heartbeat extends the lease while the model call runs. If the process dies, the lease lapses and the reaper requeues the task (or escalates once `max_attempts` are used). Completion goes through `completeWith`, which re-checks ownership (`status=running AND locked_by=me`) inside the transaction, so a worker that lost its lease cannot write anything (**fencing**). Completions in one mission are serialised by locking the mission row first (fixed lock order mission → task everywhere); without that, two tasks finishing together each miss the other's uncommitted `done` and never unlock the next task.

**Mission lifecycle.** `running → needs_human | succeeded | failed | cancelled | budget_exceeded`. The orchestrator's `plan` task returns JSON; the platform validates it (active team members only, acyclic, size/fan-out limits) before inserting tasks, and feeds the validation error back on retry. A `synthesize` task depends on all top-level work. Tasks: `plan | work | review | answer | synthesize`; statuses `waiting | queued | running | blocked | in_review | done | failed | escalated | cancelled`. Any condition that needs a human parks the mission in `needs_human` (queued tasks stop being claimed; in-flight ones finish) with a reason and an `escalation` message.

**Agent communication.** Messages are typed, validated and stored (`messages`), written in the same transaction as the state change they describe. Agents exchange *references* (task keys) — each task prompt is assembled from its own input, only its declared dependencies' outputs (clipped), retrieved memories, and any feedback/clarifications. Agents do not converse freely; they can only assign, report, ask their manager (≤2 per task), review, and escalate. A per-mission message budget is the backstop against runaway loops.

**Memory.** Rows carry `kind`, `scope` and an optional embedding plus the model that produced it; search compares only rows from the current embedding model and matching dimension, and unembedded rows are found by Postgres full-text search, so changing or losing the embedder never breaks recall. Access is enforced in SQL from the agent's admin-set `memory_scope`. Retrieved memories enter prompts inside a delimited block labelled as reference data (a prompt-injection mitigation, not a guarantee). Untyped `vector` columns trade ANN indexing for flexibility; add an HNSW index per fixed dimension once an embedding model is chosen and the corpus is large.

**Known limits.** Dashboard mission view polls (2 s). Direct-run SSE is in-process. Embedding calls are metered by tokens only when the vendor reports them. Memory quality with real embedding models and the benefit of lessons on outcomes are unmeasured until Phase 5.
