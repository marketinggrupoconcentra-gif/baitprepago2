/**
 * schema-real.test.ts
 *
 * Integration test que verifica el schema real en Neon contra el schema declarado.
 * Requiere DATABASE_URL en el ambiente (solo corre si está disponible).
 * Sirve como contrato entre el código TypeScript y el estado real de la DB.
 */
import { describe, test, expect, beforeAll } from 'vitest';
// neon() return type (compatible with @neondatabase/serverless v1.x)
import { neon as createNeon } from '@neondatabase/serverless';

// Este test solo corre si hay una URL disponible. Prefiere la rama de TEST (owner)
// para no depender del estado de producción antes de migrarla.
const SCHEMA_DB_URL = process.env.TEST_OWNER_DATABASE_URL || process.env.DATABASE_URL;
const hasDb = Boolean(SCHEMA_DB_URL);

const EXPECTED_TABLES = [
  // Etapa 1
  'analytics_events',
  'delivery_outbox',
  'idempotency_keys',
  'lead_attribution',
  'lead_consents',
  'lead_secrets',
  'leads',
  'security_events',
  // Etapa 2 (migration 0001)
  'admin_profiles',
  'audit_logs',
  'integration_deliveries',
  'lead_management',
  'report_runs',
  'report_schedules',
  // Etapa 2.2 (migration 0002)
  'rate_limits',
  // 0006 / 0007 / 0008 (Scale + BAIT Prepago)
  'settings',
  'ads_metrics',
  'captcha_challenges',
];

const EXPECTED_ENUM_TYPES = [
  'lead_status',
  'outbox_status',
  'security_event_type',
  'source_category',
];

const PII_COLUMNS = ['first_name_enc', 'last_name_enc', 'email_enc', 'phone_enc', 'birthdate_enc'];
const BLIND_INDEX_COLUMNS = ['email_bidx', 'phone_bidx'];
const PLAINTEXT_PII_FORBIDDEN = ['first_name', 'last_name', 'email', 'phone', 'birthdate', 'nombre', 'apellido', 'telefono'];

// Helper de tipo para rows de información de schema
type SchemaRow = Record<string, string | number | boolean | null>;

describe.skipIf(!hasDb)('schema-real: verificacion contra Neon DB', () => {
   
  let sql: ReturnType<typeof createNeon>;

  beforeAll(async () => {
    const { neon } = await import('@neondatabase/serverless');
    sql = neon(SCHEMA_DB_URL!);
  });

  test('schema app existe', async () => {
    const result = (await sql`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'app'
    `) as SchemaRow[];
    expect(result).toHaveLength(1);
    expect(result[0].schema_name).toBe('app');
  });

  test('todas las tablas esperadas existen en schema app', async () => {
    const result = (await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'app' 
      ORDER BY table_name
    `) as SchemaRow[];
    const actualTables = result.map(r => r.table_name as string);
    for (const expectedTable of EXPECTED_TABLES) {
      expect(actualTables, `tabla "${expectedTable}" no encontrada en schema app`).toContain(expectedTable);
    }
    expect(actualTables).toHaveLength(EXPECTED_TABLES.length);
  });

  test('leads: columnas PII usan cifrado (_enc)', async () => {
    const result = (await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'app' AND table_name = 'leads'
    `) as SchemaRow[];
    const cols = result.map(r => r.column_name as string);
    for (const enc of PII_COLUMNS) {
      expect(cols, `columna cifrada "${enc}" no encontrada`).toContain(enc);
    }
  });

  test('leads: blind indexes existen (_bidx)', async () => {
    const result = (await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'app' AND table_name = 'leads'
    `) as SchemaRow[];
    const cols = result.map(r => r.column_name as string);
    for (const bidx of BLIND_INDEX_COLUMNS) {
      expect(cols, `columna blind index "${bidx}" no encontrada`).toContain(bidx);
    }
  });

  test('leads: SIN columnas PII en plaintext', async () => {
    const result = (await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'app' AND table_name = 'leads'
    `) as SchemaRow[];
    const cols = result.map(r => r.column_name as string);
    for (const forbidden of PLAINTEXT_PII_FORBIDDEN) {
      expect(cols, `ALERTA: columna PII en plaintext "${forbidden}" encontrada!`).not.toContain(forbidden);
    }
  });

  test('todos los timestamps son WITH TIME ZONE (TIMESTAMPTZ)', async () => {
    const result = (await sql`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'app'
        AND column_name LIKE '%_at'
        AND data_type != 'timestamp with time zone'
    `) as SchemaRow[];
    expect(result, `Columnas timestamp SIN timezone: ${JSON.stringify(result)}`).toHaveLength(0);
  });

  test('ENUM types existen en schema app', async () => {
    const result = (await sql`
      SELECT DISTINCT t.typname
      FROM pg_type t 
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'app' AND t.typtype = 'e'
      ORDER BY t.typname
    `) as SchemaRow[];
    const enumNames = result.map(r => r.typname as string);
    for (const expectedEnum of EXPECTED_ENUM_TYPES) {
      expect(enumNames, `ENUM "${expectedEnum}" no encontrado`).toContain(expectedEnum);
    }
  });

  test('neon_auth schema intacto — no modificado', async () => {
    const result = (await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'neon_auth'
      ORDER BY table_name
    `) as SchemaRow[];
    const tables = result.map(r => r.table_name as string);
    expect(tables.length).toBeGreaterThan(0);
    for (const appTable of EXPECTED_TABLES) {
      expect(tables).not.toContain(appTable);
    }
  });

  test('FK constraints existen entre tablas dependientes', async () => {
    const result = (await sql`
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'app'
    `) as SchemaRow[];
    expect(result.length).toBeGreaterThanOrEqual(4);
    const outboxFk = result.find(r => r.table_name === 'delivery_outbox' && r.foreign_table === 'leads');
    expect(outboxFk, 'FK delivery_outbox -> leads no encontrada').toBeDefined();
  });
});

describe.skipIf(hasDb)('schema-real: DB no disponible (skip en CI sin DB)', () => {
  test('skip porque DATABASE_URL no está configurada', () => {
    expect(SCHEMA_DB_URL).toBeUndefined();
  });
});
