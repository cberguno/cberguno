# Phases and acceptance tests

Legend: ✅ built and tested · 🟡 built, verified only against a local stand-in or with a stated limitation · ⬜ not started / deliberately deferred

## Phase 1 — Core platform, agent builder, model routing, dashboard

| Item | Status | Acceptance test |
|---|---|---|
| Auth, RBAC, audit log (append-only) | ✅ | Viewer cannot mutate; audit rows written; UPDATE/DELETE on `audit_log` fails |
| Credential vault (AES-256-GCM) | ✅ | Roundtrip; tamper detection; API never returns secret |
| Provider/model registry | ✅ | CRUD; secret never in responses |
| `openai_compat`, `anthropic`, `gemini` adapters | 🟡 | Wire-format tests against local HTTP servers. **Not yet run against the live vendors** — needs your API keys; use `POST /api/providers/:id/test` |
| Model router w/ fallback | ✅ | Cheapest/fastest/quality ranking; constraint filtering; falls through on 5xx/429 |
| Agent builder (CRUD, versions) | ✅ | Create/update bumps version + snapshots; agent actor rejected on privilege fields |
| Agent run loop (single agent, no tools) | ✅ | Run persists events, usage, cost; honours timeout, per-run cost cap, daily budget; pause/terminate cancels in-flight runs; a bookkeeping failure never triggers a second paid model call |
| Teams + org chart data | ✅ | `reports_to` forms a tree; cycles rejected |
| Dashboard: agents, providers/models, teams/org chart, run console (SSE), usage, audit | ✅ | Built; smoke-tested with a headless browser |

## Phase 2 — Memory, communication, delegation, durable missions

| Item | Status | Acceptance test / limitation |
|---|---|---|
| Persistent task queue (Postgres): leases, heartbeats, reaper, bounded retries with backoff | ✅ | A worker **process SIGKILLed mid-mission** → a second worker finishes it; tasks that had completed are executed exactly once; the interrupted one is retried; a task whose worker dies on every attempt escalates instead of looping |
| No duplicated side effects | ✅ | Lease **fencing**: a worker that lost its lease cannot commit results (tested); completion + child creation + messages are one transaction; plan expansion is idempotent on `(mission_id, key)`; 20 simultaneous completions across 4 workers never strand a dependent task (this test found and fixed a real race) |
| Parallel task execution | ✅ | Independent tasks overlap in time (peak concurrency ≥ 2 at the model server); N tasks × M workers → each executed exactly once |
| Redis pub/sub bus | ⬜ **Deliberately not built** | Postgres is queue, lock service and source of truth, so Redis would be a second service with no capability gain at this scale. The dashboard polls missions every 2 s. Direct (single-agent) run SSE is still in-process. Revisit if you need sub-second fan-out across replicas. |
| Structured message passing | ✅ | Typed, zod-validated bodies (`task.assign`, `task.result`, `question`, `answer`, `review.request`, `review.verdict`, `escalation`, `note`); stored per mission; agents pass task *keys/refs*, not transcripts |
| Direct agent-to-agent messaging / shared channels | 🟡 | Messages are addressed agent→agent and live on the mission channel, but **agents cannot yet originate arbitrary messages**: they only communicate through the structured flows above (assign, result, ask-your-manager, review, escalate). Free-form agent chat is intentionally excluded (token cost, runaway risk). |
| Delegation | ✅ | Orchestrator plans (JSON validated: team members only, no cycles, size limits, error fed back for retry); a specialist can split work once per task (depth and fan-out limits); human-authored plans via API skip the planning call |
| Collaboration: questions | ✅ | A blocked specialist asks its manager; answer is injected on resume; max 2 questions per task |
| QA review loop | ✅ | QA agent accepts or requests changes; bounded revisions with feedback; rejection writes a lesson; exhaustion escalates; a human resume re-reviews correctly (test found a review-key collision, fixed) |
| Conflict detection | 🟡 | The synthesis step can report contradictions → mission stops for a human. This is **LLM-reported, not independently verified**; QA review is the independent check. |
| Escalation | ✅ | Failed-after-retries, lost-worker, QA-exhausted, budget, no model, conflicts, and message-budget breaches all stop the mission in `needs_human` with a reason and an escalation message; operators can retry, accept or cancel |
| Runaway-conversation guard | ✅ | Per-mission message budget stops and escalates (nothing keeps running afterwards); questions, revisions and delegation are each capped |
| Mission cost cap | ✅ | Worst-case gate before each call; mission → `budget_exceeded`, remaining tasks cancelled; agents' own per-task and daily budgets escalate rather than overspend. **Soft cap:** the gate compares against spend recorded so far, so calls already in flight in parallel can overshoot it by their combined cost (bounded by `WORKER_CONCURRENCY` × worst-case call) |
| Memory: pgvector semantic search | ✅ / 🟡 | Real pgvector 0.6 in tests: ranking, per-model/dimension isolation, usage metering. **Embedding adapters are verified against a local server; quality with real embedding models is unmeasured.** |
| Memory kinds, scopes, access control | ✅ | episodic / semantic / lesson × agent / team / org. An agent's reach is its **admin-set** `memory_scope`; reads and writes are clamped; teammates cannot read each other's private memory; non-members cannot read team memory |
| Working memory | ✅ | Not persisted: it is the per-call task context (task, dependency outputs by reference, clarifications, feedback, retrieved memories) |
| Automatic retrieval (RAG) | ✅ | Top-k relevant memories are injected into each task prompt inside a `<memory>` block framed as untrusted reference data; other agents' private memories never appear |
| Learning from experience | ✅ / 🟡 | Episodic memory on task/mission completion; lessons from QA rejections; salience reinforced on use. **That this improves outcomes is not yet measured** — that is the Phase 5 evaluation harness. |
| Relevance scoring | ✅ | `similarity × (0.5+0.5·salience) × (0.5+0.5·e^(−idle/30d))` (unit-tested) |
| Consolidation | ✅ | Exact + near-duplicate merge (keeper = more salient, then older), embedding backfill, pruning of stale never-used episodic memory; lessons/facts never auto-pruned. LLM summarisation of episodes into facts is ⬜. |
| Resilience | ✅ | Embedding provider down → writes succeed unembedded, search falls back to keyword, backfill repairs it |
| Dashboard: missions, task graph, agent-message sequence diagram, memory browser/recall tester, embedding settings | ✅ | Headless-browser smoke test runs a mission end to end |
| **Visual workflow builder** | ⬜ **Not built** | The task graph is a read-only viewer. The API already accepts a human-authored task graph (`plan`) — the backend a drag-and-drop builder would use. Moved to Phase 3 alongside tools, where there is something meaningful to wire together. |

## Phase 3 — Tools, MCP, browser, scheduling
Tool registry + grants; MCP client (stdio + streamable HTTP); REST/GraphQL/OAuth connectors; Playwright worker container; schedules/monitors; approval queue UI; visual workflow builder.
**Acceptance:** an ungranted tool call is denied and audited; `approval=required` tool parks the task until a human approves; secrets absent from every captured prompt (automated scan); injected instructions in a fetched page cannot trigger a privileged tool.

## Phase 4 — Travel agency team
The ten agents from the brief as seed data; flight/hotel/destination research via real providers (candidates already connected in some environments: Kiwi.com, Trivago, Tripadvisor, lastminute.com MCP servers; alternatives: Amadeus/Duffel APIs); provenance enforcement; customer-facing intake/chat; booking *preparation* only until payment integration is explicitly authorised.
**Acceptance:** every quoted price carries `provenance.kind`; QA blocks unlabeled estimates; no booking can reach `confirmed` without an approval row.

## Phase 5 — Evaluation, hardening, production
Eval suites and A/B experiments with a promotion gate (statistical threshold + cost ceiling); load tests; backup/restore drill (`pg_dump` + WAL, tested restore); rate limiting, CSP, dependency audit, secret rotation procedure; metrics + health dashboards.
**Acceptance:** a config change is promoted only if the experiment shows improvement on the declared metric without regressing others; restore drill recreates a working system from backup.
