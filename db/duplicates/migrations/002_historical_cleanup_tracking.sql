-- ⚡
-- BAIT Prepago 2 - Duplicates Migration 002
-- Base de datos: baitprepago_duplicates (Secundaria de QA)
--
-- Agrega source_lead_id a la tabla leads para rastrear el ID del registro
-- original movido durante la limpieza histórica QA.
-- ⚡

ALTER TABLE duplicate_leads 
ADD COLUMN source_lead_id BIGINT;

-- Crea un índice único parcial que evita copiar dos veces
-- el mismo source_lead_id por la limpieza histórica.
CREATE UNIQUE INDEX duplicate_leads_source_lead_id_historical_qa_idx
ON duplicate_leads (source_lead_id)
WHERE reason = 'HISTORICAL_QA_CLEANUP' AND source_lead_id IS NOT NULL;
