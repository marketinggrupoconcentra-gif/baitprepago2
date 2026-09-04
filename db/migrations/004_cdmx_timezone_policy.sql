-- ─────────────────────────────────────────────────────────────────
-- BAIT Prepago 2 — Migration 004
-- Canonical business timezone: America/Mexico_City
--
-- IMPORTANT:
-- - This migration does NOT rewrite historical timestamps.
-- - Business instants remain TIMESTAMPTZ.
-- - The database/role defaults are made explicit and idempotent.
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET TimeZone TO %L',
    current_database(),
    'America/Mexico_City'
  );

  EXECUTE format(
    'ALTER ROLE %I SET TimeZone TO %L',
    current_user,
    'America/Mexico_City'
  );

  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I SET TimeZone TO %L',
    current_user,
    current_database(),
    'America/Mexico_City'
  );
END
$$;

-- Apply the policy to the current migration session too.
SET TIME ZONE 'America/Mexico_City';

-- Guardrail: business instants in public schema must not use naive timestamps.
DO $$
DECLARE
  bad_columns TEXT;
BEGIN
  SELECT string_agg(
    format('%I.%I.%I', table_schema, table_name, column_name),
    ', '
    ORDER BY table_name, ordinal_position
  )
  INTO bad_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND data_type = 'timestamp without time zone';

  IF bad_columns IS NOT NULL THEN
    RAISE EXCEPTION
      'CDMX timezone policy violation: timestamp without time zone found in: %',
      bad_columns;
  END IF;
END
$$;

-- Postcondition for this session.
DO $$
BEGIN
  IF current_setting('TimeZone') <> 'America/Mexico_City' THEN
    RAISE EXCEPTION
      'CDMX timezone policy violation: effective TimeZone is %',
      current_setting('TimeZone');
  END IF;
END
$$;
