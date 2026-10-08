-- Stores Firebase-backed private backups, browser sessions, and durable deletion work.
-- Up Migration
CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  firebase_project text NOT NULL,
  firebase_uid text NOT NULL,
  email text,
  display_name text,
  email_verified boolean NOT NULL DEFAULT false,
  providers jsonb NOT NULL DEFAULT '[]',
  deleting boolean NOT NULL DEFAULT false,
  UNIQUE(firebase_project, firebase_uid)
);
CREATE TABLE account_snapshots (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  boards jsonb NOT NULL DEFAULT '[]',
  assets jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE account_assets (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hash text NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 10485760),
  PRIMARY KEY(account_id, hash)
);
CREATE TABLE revoked_browser_sessions (hash text PRIMARY KEY, expires timestamptz NOT NULL);
CREATE INDEX revoked_browser_expiry ON revoked_browser_sessions(expires);
CREATE TABLE browser_sessions (
  hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires timestamptz NOT NULL
);
CREATE INDEX browser_session_expiry ON browser_sessions(expires);
CREATE TABLE account_deletions (
  firebase_project text NOT NULL,
  firebase_uid text NOT NULL,
  account_id uuid NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  apple_pending boolean NOT NULL DEFAULT false,
  retry_after timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(firebase_project, firebase_uid)
);
