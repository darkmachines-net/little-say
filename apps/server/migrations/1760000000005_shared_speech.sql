-- Retains synthesized speech for service-wide reuse while keeping downloads authenticated by account grants.
-- Up Migration
ALTER TABLE media_objects ADD COLUMN service_owned boolean NOT NULL DEFAULT false;
UPDATE media_objects SET service_owned=true WHERE namespace='speech';

-- Keep legacy owner pointers readable during rolling deployments. Prefer an existing shared take;
-- otherwise select one deterministic take for each exact text/language/model/voice cache key.
INSERT INTO service_records(namespace,key,value,account_id)
SELECT DISTINCT ON (r.key) 'speech',r.key,r.value,NULL
FROM service_records r
JOIN media_objects m ON m.namespace='speech' AND m.key=(r.value->>'id') || '.wav'
WHERE r.namespace LIKE 'speech/owner-%'
  AND r.key ~ '^[a-f0-9]{64}\.json$'
  AND r.value->>'id' ~ '^[a-f0-9]{64}$'
ORDER BY r.key,r.namespace
ON CONFLICT(namespace,key) DO NOTHING;
UPDATE service_records SET account_id=NULL WHERE namespace='speech';

CREATE INDEX ai_jobs_working_speech ON ai_jobs ((input->>'text'),(input->>'language'))
WHERE kind='speech' AND state='working';
