-- Phase 2: durable missions/tasks, structured messages, long-term memory (pgvector).
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE models ADD COLUMN kind text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','embedding'));

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE missions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  goal          text NOT NULL,
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  orchestrator_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','needs_human','succeeded','failed','cancelled','budget_exceeded')),
  -- {review, max_tasks, max_depth, max_fanout, max_messages, max_revisions}
  options       jsonb NOT NULL DEFAULT '{}',
  max_cost_usd  numeric(12,4) NOT NULL DEFAULT 2.00,
  output        text,
  error         text,
  escalation_reason text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX missions_status ON missions (status, created_at DESC);

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  key           text NOT NULL,                 -- unique per mission: makes plan expansion idempotent
  kind          text NOT NULL CHECK (kind IN ('plan','work','review','answer','synthesize')),
  title         text NOT NULL,
  input         text NOT NULL,
  assignee_id   uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  assigner_id   uuid REFERENCES agents(id) ON DELETE SET NULL,
  depends_on    text[] NOT NULL DEFAULT '{}',  -- task keys within the mission
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('waiting','queued','running','blocked','in_review','done','failed','escalated','cancelled')),
  attempt       integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,
  run_after     timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  locked_by     text,
  output        text,
  error         text,
  structured    jsonb,                          -- parsed plan / verdict
  depth         integer NOT NULL DEFAULT 0,
  revision      integer NOT NULL DEFAULT 0,
  meta          jsonb NOT NULL DEFAULT '{}',    -- feedback, qa answers, subtask resume flag...
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  UNIQUE (mission_id, key)
);
CREATE INDEX tasks_claim ON tasks (run_after) WHERE status = 'queued';
CREATE INDEX tasks_lease ON tasks (lease_expires_at) WHERE status = 'running';
CREATE INDEX tasks_mission ON tasks (mission_id, created_at);

CREATE TABLE messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  task_id    uuid REFERENCES tasks(id) ON DELETE SET NULL,
  channel    text NOT NULL DEFAULT 'mission',
  from_kind  text NOT NULL CHECK (from_kind IN ('agent','user','system')),
  from_id    uuid,
  to_kind    text NOT NULL CHECK (to_kind IN ('agent','user','channel')),
  to_id      uuid,
  type       text NOT NULL,
  body       jsonb NOT NULL,
  refs       jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_mission ON messages (mission_id, created_at);

ALTER TABLE usage_events ADD COLUMN task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE usage_events ADD COLUMN mission_id uuid REFERENCES missions(id) ON DELETE SET NULL;
CREATE INDEX usage_mission ON usage_events (mission_id);

-- Long-term memory. "Working" memory is not stored: it is the task context assembled per call.
-- `embedding` is an unconstrained vector so the embedding model can change; rows record which model made them
-- and search only compares like with like. (Add an HNSW index per fixed dimension once you commit to a model.)
CREATE TABLE memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('episodic','semantic','lesson')),
  scope       text NOT NULL CHECK (scope IN ('agent','team','org')),
  agent_id    uuid REFERENCES agents(id) ON DELETE CASCADE,   -- author (and owner when scope='agent')
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,    -- required when scope='team'
  content     text NOT NULL,
  embedding   vector,
  embedding_model text,
  salience    real NOT NULL DEFAULT 0.5 CHECK (salience BETWEEN 0 AND 1),
  access_count integer NOT NULL DEFAULT 0,
  source      jsonb NOT NULL DEFAULT '{}',
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  consolidated_into uuid REFERENCES memories(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scope <> 'agent' OR agent_id IS NOT NULL),
  CHECK (scope <> 'team' OR team_id IS NOT NULL)
);
CREATE INDEX memories_owner ON memories (scope, agent_id, team_id) WHERE consolidated_into IS NULL;
CREATE INDEX memories_tsv ON memories USING gin (content_tsv);
