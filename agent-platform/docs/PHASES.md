# Phases and acceptance tests

Legend: ✅ built and tested · 🟡 built, verified only against a local mock/in-sandbox · ⬜ not started

## Phase 1 — Core platform, agent builder, model routing, dashboard

| Item | Status | Acceptance test |
|---|---|---|
| Auth, RBAC, audit log (append-only) | ✅ | Viewer cannot mutate; audit rows written; UPDATE/DELETE on `audit_log` fails |
| Credential vault (AES-256-GCM) | ✅ | Roundtrip; tamper detection; API never returns secret |
| Provider/model registry | ✅ | CRUD; secret never in responses |
| `openai_compat`, `anthropic`, `gemini` adapters | 🟡 | Wire-format tests against local HTTP mocks. **Not yet run against the live vendors** — needs your API keys; use `POST /api/providers/:id/test` |
| Model router w/ fallback | ✅ | Cheapest/fastest/quality ranking; constraint filtering; falls through on 5xx/429 |
| Agent builder (CRUD, versions) | ✅ | Create/update bumps version + snapshots; agent actor rejected on privilege fields |
| Agent run loop (single agent, no tools) | ✅ | Run persists events, usage, cost; honours timeout, per-run cost cap, daily budget; pause/terminate cancels in-flight runs; a bookkeeping failure never triggers a second paid model call |
| Teams + org chart data | ✅ | `reports_to` forms a tree; cycles rejected |
| Dashboard: agents, providers/models, teams/org chart, run console (SSE), usage, audit | ✅ | Built; smoke-tested with a headless browser |
| Visual workflow builder | ⬜ | Deferred to Phase 2 (needs the mission/task model to be meaningful) |

## Phase 2 — Memory, communication, delegation, durable missions
Postgres task queue with leases + reaper; Redis pub/sub bus; message envelope validation; pgvector memory (working/episodic/semantic/lesson), consolidation job, relevance scoring (recency × salience × similarity), scope-based access control; orchestrator delegation with depth/fan-out limits; conflict detection; escalation. 
**Acceptance:** kill the worker mid-mission → mission completes after restart with no duplicated side effects; memory recall precision measured on a fixture set; runaway-conversation test hits the message budget and escalates.

## Phase 3 — Tools, MCP, browser, scheduling
Tool registry + grants; MCP client (stdio + streamable HTTP); REST/GraphQL/OAuth connectors; Playwright worker container; schedules/monitors; approval queue UI. 
**Acceptance:** an ungranted tool call is denied and audited; `approval=required` tool parks the task until a human approves; secrets absent from every captured prompt (automated scan); injected instructions in a fetched page cannot trigger a privileged tool.

## Phase 4 — Travel agency team
The ten agents from the brief as seed data; flight/hotel/destination research via real providers (candidates already connected in some environments: Kiwi.com, Trivago, Tripadvisor, lastminute.com MCP servers; alternatives: Amadeus/Duffel APIs); provenance enforcement; customer-facing intake/chat; booking *preparation* only until payment integration is explicitly authorised. 
**Acceptance:** every quoted price carries `provenance.kind`; QA blocks unlabeled estimates; no booking can reach `confirmed` without an approval row.

## Phase 5 — Evaluation, hardening, production
Eval suites and A/B experiments with a promotion gate (statistical threshold + cost ceiling); load tests; backup/restore drill (`pg_dump` + WAL, tested restore); rate limiting, CSP, dependency audit, secret rotation procedure; metrics + health dashboards.
**Acceptance:** a config change is promoted only if the experiment shows improvement on the declared metric without regressing others; restore drill recreates a working system from backup.
