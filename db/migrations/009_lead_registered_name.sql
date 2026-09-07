-- BAIT Prepago 2 - Migration 009
-- Stores the name originally submitted with a valid lead so duplicate UX can
-- show the existing process metadata. Legacy rows remain nullable.
-- Business timezone policy must already be America/Mexico_City.

DO $$
BEGIN
  IF current_setting('TimeZone') <> 'America/Mexico_City' THEN
    RAISE EXCEPTION 'Migration 009 requires TimeZone America/Mexico_City, got %', current_setting('TimeZone');
  END IF;
END $$;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(160);

COMMENT ON COLUMN leads.first_name IS 'Nombre(s) registrado(s) por el titular de la solicitud';
COMMENT ON COLUMN leads.last_name IS 'Apellido(s) registrado(s) por el titular de la solicitud';
