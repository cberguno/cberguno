-- Phase 3: tool registry + gateway audit, approvals, MCP servers, schedules, workflows.

ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN
  ('waiting','queued','running','blocked','in_review','awaiting_approval','done','failed','escalated','cancelled'));
-- Full model conversation of a task that is parked waiting for a human (tool-use loop state).
ALTER TABLE tasks ADD COLUMN transcript jsonb;

-- `name` has no underscores so that "<server>__<tool>" is unambiguous.
CREATE TABLE mcp_servers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE CHECK (name ~ '^[a-z][a-z0-9]{0,23}$'),
  url           text NOT NULL,
  credential_id uuid REFERENCES credentials(id) ON DELETE SET NULL,
  auth_header   text NOT NULL DEFAULT 'Authorization',
  auth_scheme   text NOT NULL DEFAULT 'bearer' CHECK (auth_scheme IN ('bearer','raw')),
  enabled       boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tools (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE CHECK (name ~ '^[a-z][a-z0-9_]{0,62}$'),
  description   text NOT NULL,
  input_schema  jsonb NOT NULL DEFAULT '{"type":"object","properties":{}}',
  kind          text NOT NULL CHECK (kind IN ('http','mcp','builtin')),
  config        jsonb NOT NULL DEFAULT '{}',
  mcp_server_id uuid REFERENCES mcp_servers(id) ON DELETE CASCADE,
  remote_name   text,
  credential_id uuid REFERENCES credentials(id) ON DELETE SET NULL,
  risk          text NOT NULL DEFAULT 'write' CHECK (risk IN ('read','write','irreversible')),
  approval      text NOT NULL DEFAULT 'required' CHECK (approval IN ('never','required')),
  rate_limit_per_min integer NOT NULL DEFAULT 30 CHECK (rate_limit_per_min > 0),
  timeout_ms    integer NOT NULL DEFAULT 20000 CHECK (timeout_ms BETWEEN 500 AND 300000),
  provenance_kind text NOT NULL DEFAULT 'live' CHECK (provenance_kind IN ('live','cached','estimate')),
  enabled       boolean NOT NULL DEFAULT true,
  needs_review  boolean NOT NULL DEFAULT false,   -- set when a synced MCP tool's schema/description changed
  review_reason text,
  schema_hash   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- irreversible actions (payments, bookings, cancellations) can never be configured to run without a human
  CHECK (risk <> 'irreversible' OR approval = 'required')
);

CREATE TABLE approval_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid REFERENCES missions(id) ON DELETE CASCADE,
  task_id     uuid REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL,
  tool_id     uuid REFERENCES tools(id) ON DELETE SET NULL,
  tool_name   text NOT NULL,
  call_id     text NOT NULL,            -- the model's tool-call id, so the result can be returned to the right call
  args        jsonb NOT NULL,           -- EXACTLY what a human approves; this, not a regenerated call, is what runs
  args_hash   text NOT NULL,
  risk        text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '3 days',
  decided_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  decision_note text,
  executed_at timestamptz               -- set atomically on first execution: an approval is single-use
);
CREATE INDEX approvals_pending ON approval_requests (status, requested_at) WHERE status = 'pending';
CREATE INDEX approvals_task ON approval_requests (task_id);

CREATE TABLE tool_calls (
  id          bigserial PRIMARY KEY,
  mission_id  uuid REFERENCES missions(id) ON DELETE CASCADE,
  task_id     uuid REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL,
  tool_id     uuid REFERENCES tools(id) ON DELETE SET NULL,
  tool_name   text NOT NULL,
  args        jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL CHECK (status IN ('ok','error','denied','rate_limited','pending_approval','rejected')),
  result_preview text,
  error       text,
  provenance  jsonb,
  approval_id uuid REFERENCES approval_requests(id) ON DELETE SET NULL,
  duration_ms integer,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_calls_rate ON tool_calls (tool_id, at DESC);
CREATE INDEX tool_calls_task ON tool_calls (task_id, id);

CREATE TABLE workflows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  definition  jsonb NOT NULL,           -- {team_id?, goal?, tasks:[{key,title,assignee,input,depends_on,x,y}]}
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  cron        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'UTC',
  mission     jsonb NOT NULL,          -- {title, goal, team_id, orchestrator_id?, options?, max_cost_usd?, plan?}
  overlap     text NOT NULL DEFAULT 'skip' CHECK (overlap IN ('skip','allow')),  -- skip: don't start a run while the previous one is still active
  enabled     boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error  text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedules_due ON schedules (next_run_at) WHERE enabled;

ALTER TABLE missions ADD COLUMN schedule_id uuid REFERENCES schedules(id) ON DELETE SET NULL;
ALTER TABLE missions ADD COLUMN scheduled_for timestamptz;
-- one mission per schedule slot: two workers firing the same slot cannot both create it
CREATE UNIQUE INDEX missions_schedule_slot ON missions (schedule_id, scheduled_for) WHERE schedule_id IS NOT NULL;
