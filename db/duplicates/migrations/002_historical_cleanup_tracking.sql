-- BAIT Prepago 2 - Duplicates Migration 002
-- Target database: baitprepago_duplicates
-- Adds durable source-row tracking for idempotent historical QA cleanup.

DO $$
BEGIN
  IF current_database() <> 'baitprepago_duplicates' THEN
    RAISE EXCEPTION 'MIGRATION ABORTED: expected baitprepago_duplicates, got %', current_database();
  END IF;

  IF current_setting('TimeZone') <> 'America/Mexico_City' THEN
    RAISE EXCEPTION 'MIGRATION ABORTED: expected America/Mexico_City, got %', current_setting('TimeZone');
  END IF;
END $$;

ALTER TABLE duplicate_leads
  ADD COLUMN IF NOT EXISTS source_lead_id BIGINT;

DO $$
DECLARE
  source_type TEXT;
BEGIN
  SELECT data_type INTO source_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'duplicate_leads'
    AND column_name = 'source_lead_id';

  IF source_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'MIGRATION ABORTED: source_lead_id type is %, expected bigint', source_type;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS duplicate_leads_source_lead_id_historical_qa_idx
  ON duplicate_leads (source_lead_id)
  WHERE reason = 'HISTORICAL_QA_CLEANUP' AND source_lead_id IS NOT NULL;

DO $$
DECLARE
  index_definition TEXT;
BEGIN
  SELECT indexdef INTO index_definition
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'duplicate_leads'
    AND indexname = 'duplicate_leads_source_lead_id_historical_qa_idx';

  IF index_definition IS NULL
     OR index_definition NOT LIKE 'CREATE UNIQUE INDEX%'
     OR index_definition NOT LIKE '%(source_lead_id)%'
     OR index_definition NOT LIKE '%HISTORICAL_QA_CLEANUP%' THEN
    RAISE EXCEPTION 'MIGRATION ABORTED: cleanup tracking index definition is unexpected';
  END IF;
END $$;
