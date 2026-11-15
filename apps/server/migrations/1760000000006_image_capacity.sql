-- Shares image generation slots across workers and gives queued accounts a fair turn.
-- Up Migration
CREATE TABLE ai_image_work (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  claim uuid NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  granted boolean NOT NULL DEFAULT false
);
CREATE INDEX ai_image_work_job ON ai_image_work(job_id);
CREATE INDEX ai_jobs_working_account_kind ON ai_jobs(account_id, kind) WHERE state='working';

-- Down Migration
DROP INDEX ai_jobs_working_account_kind;
DROP TABLE ai_image_work;
