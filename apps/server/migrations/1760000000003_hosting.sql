-- Adds durable execution, shared cache metadata, private media grants, and opaque browser sessions.
-- Up Migration
CREATE TABLE service_records (
  namespace text NOT NULL, key text NOT NULL, value jsonb NOT NULL,
  PRIMARY KEY(namespace,key)
);
CREATE TABLE media_objects (
  namespace text NOT NULL, key text NOT NULL, public boolean NOT NULL DEFAULT false,
  PRIMARY KEY(namespace,key)
);
CREATE TABLE media_grants (
  namespace text NOT NULL, key text NOT NULL, account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY(namespace,key,account_id),
  FOREIGN KEY(namespace,key) REFERENCES media_objects(namespace,key) ON DELETE CASCADE
);
CREATE TABLE web_sessions (
  hash text PRIMARY KEY, csrf text NOT NULL, token text,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);
CREATE INDEX web_sessions_expiry ON web_sessions(expires);
CREATE TABLE ai_jobs (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL, fingerprint text NOT NULL, input jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','working','complete','error','cancelled','interrupted')),
  result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(),
  heartbeat timestamptz, claim uuid, dispatched_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false
);
CREATE INDEX ai_jobs_queue ON ai_jobs(created_at) WHERE state='queued';
CREATE INDEX ai_jobs_owner ON ai_jobs(account_id,created_at);
CREATE TABLE ai_cancellations (
  id uuid NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY(id,account_id)
);
CREATE TABLE worker_heartbeats (id text PRIMARY KEY, seen_at timestamptz NOT NULL DEFAULT now());
