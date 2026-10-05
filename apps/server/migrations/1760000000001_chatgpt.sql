-- Adds encrypted visitor grants and one-use browser-bound OAuth transactions, independently of accounts.
-- Up Migration
CREATE TABLE chatgpt_sessions (id text PRIMARY KEY, value text NOT NULL, expires bigint NOT NULL);
CREATE TABLE chatgpt_transactions (binding text PRIMARY KEY, state text NOT NULL, value text NOT NULL, expires bigint NOT NULL);
CREATE INDEX chatgpt_session_expiry ON chatgpt_sessions(expires);
CREATE INDEX chatgpt_transaction_expiry ON chatgpt_transactions(expires);
