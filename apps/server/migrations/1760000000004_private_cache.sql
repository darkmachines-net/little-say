-- Binds private JSON cache metadata to its account for durable deletion without affecting approved shared content.
-- Up Migration
ALTER TABLE service_records ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
CREATE INDEX service_records_owner ON service_records(account_id) WHERE account_id IS NOT NULL;
