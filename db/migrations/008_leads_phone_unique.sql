-- ⚡
-- BAIT Prepago 2 - Migration 008
-- Base de datos: Neon PostgreSQL (Conectada vía Vercel)
-- Zona horaria de negocio: America/Mexico_City
--
-- Añade restricción UNIQUE sobre phone para prevenir duplicados.
-- Falla cerrada si existen duplicados históricos.
-- ⚡

SET TIME ZONE 'America/Mexico_City';

DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    -- Verificar si existen teléfonos duplicados en la base de datos
    SELECT COUNT(*)
    INTO duplicate_count
    FROM (
        SELECT phone
        FROM leads
        GROUP BY phone
        HAVING COUNT(*) > 1
    ) AS duplicates;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION 'Cannot apply UNIQUE constraint on phone. Found % duplicate groups. Please run duplicate cleanup first.', duplicate_count;
    END IF;
END $$;

-- Si no hubo excepción, aplicar la restricción UNIQUE
ALTER TABLE leads ADD CONSTRAINT leads_phone_unique UNIQUE (phone);
