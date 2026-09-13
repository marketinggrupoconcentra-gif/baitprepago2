-- Etapa 2 · /admin/logs — acción de auditoría para el re-encolado manual de un
-- envío del delivery_outbox hacia Intelix (permiso logs.retry).
-- ALTER TYPE ... ADD VALUE es idempotente con IF NOT EXISTS (PG12+).
ALTER TYPE "app"."audit_action" ADD VALUE IF NOT EXISTS 'OUTBOX_RETRY_QUEUED';
