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

| Item | Status | Acceptance test / limitation |
|---|---|---|
| Tool registry (HTTP, MCP, builtin) with default-deny grants | ✅ | An agent sees and can call only tools an **admin** granted (exact name or `prefix*`; a bare `*` is rejected). Grants are re-read at execution time: revoking after an approval still blocks the call |
| Tool gateway | ✅ | One choke point, fixed order: known+enabled → granted → schema-valid → rate limit → approval → single-use execution → audit row (`tool_calls`). Denials are returned to the model as text and recorded; nothing executes |
| Native tool calling in the model adapters | 🟡 | OpenAI-compatible, Anthropic and Gemini wire formats (incl. merged tool results, Gemini thought-signature echo, schema cleaning) tested against local servers. **Not yet run against the live vendors.** |
| Human approval for irreversible/unlisted actions | ✅ | Task parks with its full conversation saved; **nothing runs** until a human decides; the **exact stored arguments** run (never a regenerated call); approvals are **single-use** and **at-most-once** (a crash after execution starts is reported as "outcome unknown", never retried); irreversible tools can only be approved by an **admin** and cannot be configured to skip approval (API **and** DB constraint); unanswered requests expire after 3 days and count as rejection; parked tasks survive worker restarts; cancelling a mission expires its approvals; the same approved action is never re-requested within a task |
| Secrets never reach prompts | ✅ | Automated scan of every captured model request: tool keys and provider keys absent; credentials are decrypted only inside the executor and **scrubbed** from results/errors even if an API echoes them back |
| Prompt-injection defences | ✅ / 🟡 | Tool results are fenced as untrusted data with provenance (forged closing tags neutralised) and the agent is told not to obey them. That fencing is advisory to the model — the **hard guarantees** are structural and tested: an injected "call book_flight" is denied if ungranted and only creates a pending human approval if granted |
| MCP client (streamable HTTP, SSE fallback) | ✅ | Tested against a **real MCP server built with the official SDK** (sync, bearer auth, read-only vs write classification, `isError`, secret scrubbing). **Manually verified against the live public Kiwi.com and Trivago MCP servers** (sync + real flight and hotel searches through the platform, SSRF guard on) — not part of CI |
| MCP safety | ✅ | Not declared read-only ⇒ `write` + approval required. On a re-sync, changed descriptions/schemas and newly appearing tools arrive **disabled and flagged** until an admin approves, so a wildcard grant cannot silently expose them (tool-description "rug pull") |
| MCP over stdio | ⬜ **Not supported, by design** | Running admin-configured commands needs real sandboxing; only network MCP servers are supported |
| REST connector | ✅ | Admin-defined HTTP tools: URL template (only path params, URL-encoded: arguments cannot change scheme/host), GET query / JSON body mapping, bearer / header / query-param keys from the vault, redirects not followed, size caps, timeouts |
| GraphQL | 🟡 | No dedicated connector: model a GraphQL endpoint as an HTTP POST tool |
| OAuth | ⬜ **Not built** | API keys/bearer tokens only. OAuth flows (consent, token refresh) and the email / calendar / payments connectors named in the brief are not built. n8n and Composio expose HTTP/MCP endpoints and can be attached through those paths (unverified) |
| SSRF protection | ✅ / 🟡 | HTTP tools and `web_fetch` validate the address at **connect time** (DNS-rebinding safe) and re-validate every redirect hop; private, loopback, link-local/metadata, CGNAT, ULA and mapped addresses are refused. MCP server URLs and the browser are checked **before** use only (their libraries resolve DNS themselves) — keep them on egress-filtered hosts. `TOOL_ALLOW_PRIVATE_HOSTS` turns the guard off |
| Builtin tools | ✅ | `web_fetch` (readable text, content-type checks), `memory_search` / `memory_write` (act as the agent, clamped by its memory permission) |
| Browser | 🟡 | `browser_read`: read-only rendering of JavaScript pages in a fresh Chromium context (no cookies/profile, downloads/service workers off, http(s) only, every request checked). **Tested with real Chromium.** **Interactive automation (click/type/log in/forms) is NOT built.** Needs `BROWSER_EXECUTABLE_PATH`; the optional `BROWSER=chromium` image is built in CI but not run in production |
| Scheduling / monitors | ✅ | Cron with time zones (DST-correct), run-now, pause, overlap `skip`/`allow`, one catch-up run after downtime (no flood), exactly-one mission per slot with several workers racing, bad templates record an error instead of hot-looping. A "monitor" is a scheduled mission (agents keep what they saw in memory); there is no separate change-detection engine |
| Visual workflow builder | ✅ | Draw tasks, drag, connect, edit, tidy, check, save, run — a real browser test draws two tasks, connects them by dragging, saves and runs the workflow; loop prevention and layout are unit-tested. The API validates assignees, cycles and limits |
| Dashboard: Tools & MCP, Approvals queue (nav badge), Schedules, tool calls on missions, tool-grant picker | ✅ | Browser test drives an approval end to end (one booking, correct credential, exact arguments shown) |
| Limits to know | | Tools are used in mission **`work`** tasks only (not direct runs, planning, review or synthesis). Rate limits are per tool, not per agent. Result text is truncated at 12 000 characters, so very large API responses lose their tail |

## Phase 4 — Travel agency team
The ten agents from the brief as seed data; flight/hotel/destination research via real providers (candidates already connected in some environments: Kiwi.com, Trivago, Tripadvisor, lastminute.com MCP servers; alternatives: Amadeus/Duffel APIs); provenance enforcement; customer-facing intake/chat; booking *preparation* only until payment integration is explicitly authorised.
**Acceptance:** every quoted price carries `provenance.kind`; QA blocks unlabeled estimates; no booking can reach `confirmed` without an approval row.

## Phase 5 — Evaluation, hardening, production
Eval suites and A/B experiments with a promotion gate (statistical threshold + cost ceiling); load tests; backup/restore drill (`pg_dump` + WAL, tested restore); rate limiting, CSP, dependency audit, secret rotation procedure; metrics + health dashboards.
**Acceptance:** a config change is promoted only if the experiment shows improvement on the declared metric without regressing others; restore drill recreates a working system from backup.
