-- Phase 1 schema. All ids are uuid (gen_random_uuid from pgcrypto, built into PG13+ as core).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin','operator','viewer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Sealed secrets. `sealed` = base64(nonce || ciphertext || tag). Never selected by list/get routes.
CREATE TABLE credentials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  sealed     text NOT NULL,
  last4      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('openai_compat','anthropic','gemini')),
  base_url      text NOT NULL,
  credential_id uuid REFERENCES credentials(id) ON DELETE SET NULL,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE models (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_name      text NOT NULL,            -- id sent on the wire
  display_name    text NOT NULL,
  tier            text NOT NULL CHECK (tier IN ('fast','standard','frontier')),
  context_window  integer NOT NULL DEFAULT 8192,
  supports_tools  boolean NOT NULL DEFAULT false,
  supports_vision boolean NOT NULL DEFAULT false,
  usd_per_mtok_in  numeric(12,6) NOT NULL DEFAULT 0,
  usd_per_mtok_out numeric(12,6) NOT NULL DEFAULT 0,
  avg_latency_ms  integer,                   -- updated from observed usage
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_name)
);

CREATE TABLE agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  kind          text NOT NULL DEFAULT 'specialist'
                CHECK (kind IN ('orchestrator','specialist','research','execution','qa')),
  role          text NOT NULL,
  goal          text NOT NULL DEFAULT '',
  instructions  text NOT NULL DEFAULT '',
  -- model selection: pin a model OR route by policy
  model_id      uuid REFERENCES models(id) ON DELETE SET NULL,
  routing       jsonb NOT NULL DEFAULT '{"strategy":"cheapest","complexity":"medium"}',
  -- privilege-bearing fields: writable by human admins only (enforced in routes)
  permissions   jsonb NOT NULL DEFAULT '{"tools":[],"memory_scope":"agent"}',
  max_cost_usd_per_run   numeric(12,4) NOT NULL DEFAULT 0.50,
  daily_budget_usd       numeric(12,4) NOT NULL DEFAULT 5.00,
  run_timeout_ms         integer NOT NULL DEFAULT 120000,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','terminated')),
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_versions (
  agent_id   uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version    integer NOT NULL,
  snapshot   jsonb NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, version)
);

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id   uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  reports_to uuid REFERENCES agents(id) ON DELETE SET NULL,  -- org chart edge
  PRIMARY KEY (team_id, agent_id),
  CHECK (reports_to IS NULL OR reports_to <> agent_id)
);

CREATE TABLE runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_version integer NOT NULL,
  input        text NOT NULL,
  output       text,
  status       text NOT NULL DEFAULT 'running'
               CHECK (status IN ('running','succeeded','failed','cancelled','timed_out','budget_exceeded')),
  error        text,
  model_id     uuid REFERENCES models(id) ON DELETE SET NULL,
  tokens_in    integer NOT NULL DEFAULT 0,
  tokens_out   integer NOT NULL DEFAULT 0,
  cost_usd     numeric(14,6) NOT NULL DEFAULT 0,
  started_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX runs_agent_started ON runs (agent_id, started_at DESC);

-- Ordered event log per run: what the dashboard replays and streams.
CREATE TABLE run_events (
  id      bigserial PRIMARY KEY,
  run_id  uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type    text NOT NULL,       -- run.started | route.selected | route.fallback | model.response | run.finished | run.error
  data    jsonb NOT NULL DEFAULT '{}',
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_events_run ON run_events (run_id, id);

CREATE TABLE usage_events (
  id         bigserial PRIMARY KEY,
  run_id     uuid REFERENCES runs(id) ON DELETE SET NULL,
  agent_id   uuid REFERENCES agents(id) ON DELETE SET NULL,
  model_id   uuid REFERENCES models(id) ON DELETE SET NULL,
  tokens_in  integer NOT NULL,
  tokens_out integer NOT NULL,
  cost_usd   numeric(14,6) NOT NULL,
  latency_ms integer NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_agent_at ON usage_events (agent_id, at DESC);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_kind  text NOT NULL,
  actor_id    uuid,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  detail      jsonb NOT NULL DEFAULT '{}',
  at          timestamptz NOT NULL DEFAULT now()
);

-- Append-only: block UPDATE/DELETE/TRUNCATE.
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
