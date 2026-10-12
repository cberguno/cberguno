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

Railway's stock Postgres does not include `pgvector`; Phase 2 will need Railway's pgvector template or an external Postgres. Phase 1 does not use it.

## Scaling notes (current limits)

* Phase 1 run execution and the live event stream are **in-process**. Run a single API replica until Phase 2 moves events to Redis and execution to workers.
* A restart marks any in-flight runs `failed: interrupted by server restart` (no silent loss). Resumable missions arrive in Phase 2.
* Login throttling is per-process memory; a distributed limiter is Phase 5.
