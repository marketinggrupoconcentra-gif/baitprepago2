import 'server-only';
import { neon, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool } from 'drizzle-orm/neon-serverless';
import * as schema from './schema/app';

// ── Runtime DB — least privilege (SEC-010) ────────────────────────────────────
// En PRODUCCIÓN el runtime EXIGE APP_DATABASE_URL (rol `baitprepago_app_runtime`: creado
// vía SQL, NO vía Neon Console/CLI/API → sin membresía neon_superuser; sólo DML
// mínimo sobre schema `app`, sin DDL, sin acceso a neon_auth).
// NUNCA cae a DATABASE_URL (rol de migración/owner).
// DATABASE_URL queda exclusivamente para migraciones y tooling administrativo.

function getRuntimeUrl(): string {
  const appUrl = process.env.APP_DATABASE_URL;
  if (process.env.NODE_ENV === 'production') {
    if (!appUrl) {
      throw new Error('[db] APP_DATABASE_URL es obligatoria en producción (rol de mínimo privilegio). Fail-closed.');
    }
    return appUrl;
  }
  // Dev/test: preferir APP_DATABASE_URL, tolerar DATABASE_URL como fallback local.
  const url = appUrl ?? process.env.DATABASE_URL;
  if (!url) {
    console.warn('[db] WARN: sin APP_DATABASE_URL ni DATABASE_URL. Las queries de DB fallarán.');
    return '';
  }
  return url;
}

// ── Cliente HTTP (queries simples/rápidas, sin transacción interactiva) ───────
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const url = getRuntimeUrl();
    if (!url) throw new Error('[db] Sin URL de base de datos.');
    _db = drizzle(neon(url), { schema });
  }
  return _db;
}

// ── Cliente transaccional (Pool WebSocket) para transacciones interactivas ────
// Neon HTTP no soporta rollback condicional entre reads/writes; para FLW-001 y
// el consumo atómico de OTP proof se usa un Pool efímero por invocación.
// El caller DEBE cerrar el pool: `await result.pool.end()` en un finally.
export function getPooledDb() {
  const url = getRuntimeUrl();
  if (!url) throw new Error('[db] Sin URL de base de datos.');
  const pool = new Pool({ connectionString: url });
  const db = drizzlePool(pool, { schema });
  return { db, pool };
}

export type PooledDb = ReturnType<typeof getPooledDb>['db'];
/** Tipo del objeto `tx` dentro de `db.transaction(async (tx) => ...)`. */
export type PooledTx = Parameters<Parameters<PooledDb['transaction']>[0]>[0];

/**
 * Ejecuta `fn` dentro de una transacción interactiva Postgres real y cierra el
 * pool al terminar (éxito o error). Si `fn` lanza, la transacción hace ROLLBACK.
 */
export type TransactionClient = Parameters<Parameters<PooledDb['transaction']>[0]>[0];

export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  const { db, pool } = getPooledDb();
  try {
    return await db.transaction(fn);
  } finally {
    await pool.end().catch(() => {});
  }
}

export const BUSINESS_TIMEZONE = 'America/Mexico_City';

export { schema };

// Re-export tipos útiles
export type Lead = typeof schema.leads.$inferSelect;
export type NewLead = typeof schema.leads.$inferInsert;
export type LeadAttribution = typeof schema.leadAttribution.$inferSelect;
export type NewLeadAttribution = typeof schema.leadAttribution.$inferInsert;
export type DeliveryOutbox = typeof schema.deliveryOutbox.$inferSelect;
export type SecurityEvent = typeof schema.securityEvents.$inferSelect;

// Etapa 2 types
export type AdminProfile = typeof schema.adminProfiles.$inferSelect;
export type NewAdminProfile = typeof schema.adminProfiles.$inferInsert;
export type AuditLog = typeof schema.auditLogs.$inferSelect;
export type LeadManagement = typeof schema.leadManagement.$inferSelect;
export type ReportSchedule = typeof schema.reportSchedules.$inferSelect;
export type ReportRun = typeof schema.reportRuns.$inferSelect;
export type IntegrationDelivery = typeof schema.integrationDeliveries.$inferSelect;
export type AdsMetric = typeof schema.adsMetrics.$inferSelect;
