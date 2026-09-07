-- ─────────────────────────────────────────────────────────────────
-- BAIT Prepago 2 — Migration 005
-- Stage 1H: lead email capture + server-side CAPTCHA
--
-- IMPORTANT:
-- - Idempotent (IF NOT EXISTS everywhere).
-- - Does not rewrite historical rows or timestamps.
-- - `leads.email` is nullable: historical leads keep NULL, new leads are
--   required to provide one at the API validation layer (not enforced by
--   a NOT NULL constraint here, to avoid breaking existing data).
-- - `captcha_challenges` never stores the plaintext answer, only an
--   HMAC-SHA256 hash computed with the CAPTCHA_PEPPER secret.
-- - NIP and nip_valid_until are intentionally NOT persisted anywhere in
--   this migration — they are discarded at the validation layer.
-- ─────────────────────────────────────────────────────────────────

SET TIME ZONE 'America/Mexico_City';

-- Fail closed: abort unless the effective business timezone is CDMX.
DO $$
BEGIN
  IF current_setting('TimeZone') <> 'America/Mexico_City' THEN
    RAISE EXCEPTION
      'Migration 005 aborted: effective TimeZone is %, expected America/Mexico_City',
      current_setting('TimeZone');
  END IF;
END
$$;

-- 1. Email capture for future coupon delivery (Stage 1I, deferred).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (email);

-- 2. Server-side CAPTCHA challenges.
CREATE TABLE IF NOT EXISTS captcha_challenges (
  id            TEXT          PRIMARY KEY,
  answer_hash   TEXT          NOT NULL,
  expires_at    TIMESTAMPTZ   NOT NULL,
  used_at       TIMESTAMPTZ   NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS captcha_challenges_expires_at_idx ON captcha_challenges (expires_at);

-- Guardrail: this migration must never introduce naive timestamps.
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

-- Guardrail: NIP must never be persisted.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads'
      AND column_name IN ('nip', 'nip_valid_until')
  ) THEN
    RAISE EXCEPTION 'Security policy violation: nip/nip_valid_until columns must not exist on leads';
  END IF;
END
$$;
