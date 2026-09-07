-- ⚡
-- BAIT Prepago 2 - Migration 008
-- Base de datos: Neon PostgreSQL (Conectada vía Vercel)
-- Zona horaria de negocio: America/Mexico_City
--
-- Añade restricción UNIQUE sobre phone para prevenir duplicados.
-- Falla cerrada si existen duplicados históricos o timezone incorrecto.
-- ⚡

DO $$
DECLARE
    duplicate_count INTEGER;
    constraint_exists BOOLEAN;
    constraint_def TEXT;
    current_tz TEXT;
BEGIN
    -- 1. Validar TimeZone canónico
    SELECT current_setting('TimeZone') INTO current_tz;
    IF current_tz <> 'America/Mexico_City' THEN
        RAISE EXCEPTION 'MIGRATION ABORTED: TimeZone is %, expected America/Mexico_City', current_tz;
    END IF;

    -- 2. Verificar duplicados
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

    -- 3. Comprobar si leads_phone_unique ya existe y qué definición tiene
    SELECT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'leads_phone_unique' 
          AND conrelid = 'leads'::regclass
    ) INTO constraint_exists;

    IF constraint_exists THEN
        SELECT pg_get_constraintdef(oid) 
        INTO constraint_def
        FROM pg_constraint 
        WHERE conname = 'leads_phone_unique' 
          AND conrelid = 'leads'::regclass;

        IF constraint_def = 'UNIQUE (phone)' THEN
            RAISE NOTICE 'Constraint leads_phone_unique already exists with the correct definition. Skipping.';
            RETURN;
        ELSE
            RAISE EXCEPTION 'Constraint leads_phone_unique already exists but has an unexpected definition: %. MIGRATION ABORTED.', constraint_def;
        END IF;
    END IF;

    -- 4. Crear UNIQUE(phone) si no existe
    EXECUTE 'ALTER TABLE leads ADD CONSTRAINT leads_phone_unique UNIQUE (phone)';
    RAISE NOTICE 'Successfully added UNIQUE(phone) constraint.';
END $$;
