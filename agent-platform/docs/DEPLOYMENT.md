# Deployment

> The Dockerfile and compose file were written but **not built or run in the development sandbox** (no Docker daemon there). The `pnpm deploy` packaging step, the API, and the dashboard build were each verified directly. CI (`.github/workflows/agent-platform.yml`) runs `docker build`; run it and `docker compose up` once before trusting this in production.

## Secrets

```bash
cp .env.example .env
openssl rand -base64 32   # -> PLATFORM_MASTER_KEY
openssl rand -base64 48   # -> JWT_SECRET
```
Store `PLATFORM_MASTER_KEY` somewhere other than the database backup. Rotating it requires re-entering provider keys (a re-seal tool is a Phase 5 item).

## OVHcloud VPS (or any Docker host)

1. Install Docker + the compose plugin. Open only 22/80/443.
2. Clone the repo, `cd agent-platform`, create `.env` (above) with a strong `POSTGRES_PASSWORD`.
3. `docker compose up -d --build` — API listens on `127.0.0.1:8080`; Postgres is not exposed.
4. Put TLS in front. Caddy example (`/etc/caddy/Caddyfile`):
   ```
   agents.example.com {
     reverse_proxy 127.0.0.1:8080
   }
   ```
   SSE needs no special config in Caddy; with nginx set `proxy_buffering off;` on `/api/runs/`.
5. Sign in with the bootstrap admin; remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env` afterwards.

**Backups (minimum viable, until Phase 5 automates and drill-tests it):**
```bash
docker compose exec -T db pg_dump -U agent -Fc agent > backup-$(date +%F).dump
# restore into an empty DB:  pg_restore -U agent -d agent --clean --if-exists backup.dump
```
Run nightly from cron, copy off-box, and **test a restore** before relying on it.

## Railway

1. New project → *Deploy from GitHub repo*, set the **root directory** to `agent-platform` (it contains `railway.json` + `Dockerfile`).
2. Add the **PostgreSQL** plugin. Reference its URL as `DATABASE_URL` (`${{Postgres.DATABASE_URL}}`).
3. Set `PLATFORM_MASTER_KEY`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` as service variables.
4. Deploy; health check is `/api/health`. Generate a public domain in the service settings.

**pgvector is required from Phase 2** (migration `002` runs `CREATE EXTENSION vector` and fails clearly without it). Railway's stock Postgres plugin does not include it: use Railway's pgvector template, or any Postgres that offers it (the compose file's `pgvector/pgvector:pg16` image does).

## Tools, MCP and the network

* **Default is safe:** tools and MCP servers may only reach the **public internet** (private, loopback and cloud-metadata addresses are refused). Set `TOOL_ALLOW_PRIVATE_HOSTS=true` only if you deliberately attach internal APIs.
* **Egress filtering is the real boundary for MCP and the browser.** Their libraries resolve DNS themselves after our check, so on production hosts also block outbound traffic to private ranges and `169.254.169.254` at the firewall/VPC level, and run browser-capable workers on a host with no route to anything internal.
* **Secrets:** tool and MCP credentials are stored encrypted (same vault and `PLATFORM_MASTER_KEY` as provider keys), shown once, and never placed in prompts.
* **MCP servers you attach are third-party code.** The platform treats anything not declared read-only as needing approval and quarantines changed tools on re-sync, but you decide which servers to trust and which tools to grant.
* **Browser tool:** `docker build --build-arg BROWSER=chromium .` (or `docker compose --profile browser up -d --build worker-browser`). Without it `browser_read` explains that no browser is configured; `web_fetch` still works. Interactive automation is not provided.
* **Approvals** wait up to 3 days, then expire (counted as a rejection). Someone needs to watch the Approvals page (the nav shows a badge); there is no email/push notification yet.
* **Schedules** fire from every worker; keep at least one worker running or nothing is started.

## Scaling and durability

* **Missions are durable.** Their state is in Postgres; restart or kill the API/workers at any time. A task whose worker died is retried when its lease (`WORKER_LEASE_MS`, default 60 s) expires. Choose a lease longer than your slowest single model call.
* **Scale workers** with `docker compose --profile scale up -d --scale worker=N` (or any process running `node dist/worker-main.js` with the same env). Embedded and standalone workers coexist safely.
* **Still single-node:** direct single-agent runs (Run console) execute in the API process and their live event stream is in-process; a restart marks in-flight direct runs `failed: interrupted by server restart` (no silent loss). Mission progress is read from the database, so it works across replicas.
* **Backups now include memory and mission history;** `pg_dump` covers pgvector columns. Restoring needs the extension installed on the target.
* Login throttling is per-process memory; a distributed limiter is Phase 5.
