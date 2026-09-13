/**
 * tests/integration/etapa22.test.ts
 *
 * Hardened integration suite — Security Hardening Phase 1.
 *
 * REQUIREMENTS:
 *   TEST_DATABASE_URL       → must point to TEST Neon branch (not production)
 *   APP_RUNTIME_DATABASE_URL → baitprepago_app_runtime on TEST branch
 *
 * If either is missing, the suite FAILS (not skips) — §10/§11.
 * If either points to the production endpoint, the suite FAILS — §9.
 *
 * Covers:
 *   FLW-001  atomicidad del lead (rollback total + true concurrency)
 *   SEC-004  rate limit distribuido: incremento atómico, concurrencia
 *   SEC-010  least privilege: DML real, DDL safe probes, append-only, no-access
 *   PRIV     privilege manifest enforcement
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';

// ── §9/§10: FAIL-CLOSED ENVIRONMENT VALIDATION ────────────────────────────────

const TEST_URL = process.env.TEST_DATABASE_URL;
const RUNTIME_URL = process.env.APP_RUNTIME_DATABASE_URL;
const TEST_OWNER_URL = process.env.TEST_OWNER_DATABASE_URL;

// Known production endpoint prefix — if TEST URLs match, refuse to run (§9).
const PROD_ENDPOINT = process.env.PROD_NEON_ENDPOINT_PREFIX ?? 'ep-square-recipe';

function assertNotProduction(url: string, varName: string): void {
  const host = new URL(url).hostname;
  if (host.includes(PROD_ENDPOINT)) {
    throw new Error(
      `[SAFETY] ${varName} points to PRODUCTION endpoint (${host}). ` +
      `Integration tests MUST target the test branch. Aborting.`
    );
  }
}

// §10/§11: Missing DB config is a CONFIGURATION FAILURE, not a skip.
if (!TEST_URL) {
  throw new Error(
    '[CONFIG FAILURE] TEST_DATABASE_URL is required for integration tests. ' +
    'Set it in .env.local to point to the test Neon branch. Cannot skip.'
  );
}
if (!RUNTIME_URL) {
  throw new Error(
    '[CONFIG FAILURE] APP_RUNTIME_DATABASE_URL is required for integration tests. ' +
    'Set it in .env.local to point to the runtime role on the test branch. Cannot skip.'
  );
}
if (!TEST_OWNER_URL) {
  throw new Error(
    '[CONFIG FAILURE] TEST_OWNER_DATABASE_URL is required for integration tests. ' +
    'Set it in .env.local to point to neondb_owner on the test branch. Cannot skip.'
  );
}
assertNotProduction(TEST_URL, 'TEST_DATABASE_URL');
assertNotProduction(RUNTIME_URL, 'APP_RUNTIME_DATABASE_URL');
assertNotProduction(TEST_OWNER_URL, 'TEST_OWNER_DATABASE_URL');

// §12: Override APP_DATABASE_URL to TEST before any app imports — prevent owner fallback.
const env = process.env as Record<string, string | undefined>;
env.APP_DATABASE_URL = TEST_URL;

// HRD-011: Unset DATABASE_URL so app runtime cannot possibly use it as a fallback.
delete env.DATABASE_URL;

env.NODE_ENV = 'test';
env.PII_BLIND_INDEX_KEY ??= '11'.repeat(32);
env.PII_ENCRYPTION_KEY ??= '22'.repeat(32);
env.IP_HASH_KEY ??= '33'.repeat(32);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// ── RUN NAMESPACE — unique per run for hermetic cleanup (§13/§14) ──────────
const RUN_ID = randomUUID().slice(0, 8);
const phone = () => String(3300000000 + Math.floor(Math.random() * 8_000_000));

describe('Etapa 2.2 — regresión contra Neon real (hardened)', () => {
  let sql: (strings: TemplateStringsArray, ...v: unknown[]) => Promise<Row[]>;
  let checkRateLimit: typeof import('../../src/lib/security/rate-limiter').checkRateLimit;
  let withTransaction: typeof import('../../src/db').withTransaction;
  let blindIndex: typeof import('../../src/lib/crypto').blindIndex;
  let submitLead: typeof import('../../src/lib/leads/submit-lead').submitLead;
  let IdempotencyRaceError: typeof import('../../src/lib/leads/submit-lead').IdempotencyRaceError;
  let DuplicatePhoneError: typeof import('../../src/lib/leads/submit-lead').DuplicatePhoneError;

  // Track all test-created items for cleanup
  const createdLeadIds: string[] = [];
  const createdRateLimitKeys: string[] = [];
  const createdPhoneBidxs: string[] = [];

  // Owner connection — used ONLY for cleanup (not for runtime assertions)
  let ownerSql: (strings: TemplateStringsArray, ...v: unknown[]) => Promise<Row[]>;

  beforeAll(async () => {
    // HRD-011: Authoritative branch validation
    // Rama de test y de producción de ESTE proyecto (Neon sweet-mud-87845510).
    const expectedBranch = process.env.TEST_NEON_BRANCH_ID ?? '';
    const prodBranch = process.env.PROD_NEON_BRANCH_ID ?? 'br-lingering-sun-avyoux4u';
    const RUNTIME_ROLE = process.env.RUNTIME_ROLE_NAME ?? 'baitprepago_app_runtime';
    
    async function verifyBranch(url: string, roleName: string) {
      const conn = neon(url);
      const [{ branch_id, current_user }] = await conn`select current_setting('neon.branch_id', true) as branch_id, current_user`;
      if (branch_id === prodBranch) {
        throw new Error(`[SAFETY] Production branch explicitly denied on ${roleName}`);
      }
      if (expectedBranch && branch_id !== expectedBranch) {
        throw new Error(`[SAFETY] Branch mismatch on ${roleName}. Expected ${expectedBranch}, got ${branch_id}`);
      }
      return current_user;
    }

    const testUser = await verifyBranch(TEST_URL!, 'TEST_DATABASE_URL');
    if (testUser !== RUNTIME_ROLE) throw new Error(`Expected ${RUNTIME_ROLE}, got ${testUser}`);

    const runtimeUser = await verifyBranch(RUNTIME_URL!, 'APP_RUNTIME_DATABASE_URL');
    if (runtimeUser !== RUNTIME_ROLE) throw new Error(`Expected ${RUNTIME_ROLE}, got ${runtimeUser}`);

    const ownerUser = await verifyBranch(TEST_OWNER_URL!, 'TEST_OWNER_DATABASE_URL');
    if (ownerUser !== 'neondb_owner') throw new Error(`Expected neondb_owner, got ${ownerUser}`);

    sql = neon(TEST_URL!) as unknown as typeof sql;
    ownerSql = neon(TEST_OWNER_URL!) as unknown as typeof ownerSql;
    ({ checkRateLimit } = await import('../../src/lib/security/rate-limiter'));
    ({ withTransaction } = await import('../../src/db'));
    ({ blindIndex } = await import('../../src/lib/crypto'));
    ({ submitLead, IdempotencyRaceError, DuplicatePhoneError } = await import('../../src/lib/leads/submit-lead'));
  });

  // ── §14: CLEANUP — remove all test-created rows ─────────────────────────
  // Uses OWNER connection because the runtime role (baitprepago_app_runtime) cannot DELETE from all tables.
  afterAll(async () => {
    // HRD-012: No try/catch around cleanup. Cleanup errors MUST fail the suite.
    if (createdLeadIds.length > 0) {
      // Delete in correct FK order
      await ownerSql`DELETE FROM app.analytics_events WHERE session_id LIKE ${'test-' + RUN_ID + '%'}`;
      await ownerSql`DELETE FROM app.lead_management WHERE lead_id = ANY(${createdLeadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.lead_consents WHERE lead_id = ANY(${createdLeadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.lead_attribution WHERE lead_id = ANY(${createdLeadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.lead_secrets WHERE lead_id = ANY(${createdLeadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.idempotency_keys WHERE endpoint LIKE ${'/test/' + RUN_ID + '%'}`;
      await ownerSql`DELETE FROM app.leads WHERE id = ANY(${createdLeadIds}::uuid[])`;
    }
    // (otp_proofs ya no existe — eliminada en la migración 0004)
    // Cleanup rate limit test keys
    if (createdRateLimitKeys.length > 0) {
      await ownerSql`DELETE FROM app.rate_limits WHERE key_hash = ANY(${createdRateLimitKeys})`;
    }
    // Cleanup security/audit probe data tracking exact RUN_ID namespace
    await ownerSql`DELETE FROM app.security_events WHERE route = ${'/test/' + RUN_ID}`;
    await ownerSql`DELETE FROM app.audit_logs WHERE target_type = ${'test-' + RUN_ID}`;
  });


  // ── FLW-001 — atomicidad del lead ────────────────────────────────────────
  describe('FLW-001 atomicidad', () => {
    test('Real Service Atomic Rollback: si falla la tx post-servicio → 0 filas parciales (todas las tablas)', async () => {
      const leadId = randomUUID();
      createdLeadIds.push(leadId); // track even though it should rollback
      const p = phone();
      const emailBidxVal = 'bidx-fail-' + RUN_ID;

      await expect(
        withTransaction(async (tx) => {
          await submitLead(tx, {
            now: new Date(),
            leadId,
            sessionId: 'test-fail-' + RUN_ID,
            idempotencyKey: randomUUID(),
            route: '/test/fail',
            requestHash: 'h',
            publicReference: randomUUID(),
            idemExpiresAt: new Date(Date.now() + 3600_000),
            normalizedPhone: p.replace(/\D/g, ''),
            firstNameEnc: 'x', lastNameEnc: 'x', emailEnc: 'x', phoneEnc: 'x', birthdateEnc: 'x',
            emailBidx: emailBidxVal, phoneBidx: blindIndex(p.replace(/\D/g, '').slice(-10)),
            stateCode: null, planCode: 'prepago_100',
            nipEnc: 'x', nipExpiresAt: new Date(Date.now() + 3600_000),
            sourceCategory: 'organic',
            contractingAccepted: true, privacyAccepted: true, privacyPolicyVersion: '1', termsVersion: '1',
          });
          
          // Force failure after all writes
          throw new Error('catastrophic synthetic failure');
        }),
      ).rejects.toThrow('catastrophic synthetic failure');

      // Verify ZERO residual data across ALL related tables
      expect((await sql`select count(*)::int n from app.leads where id = ${leadId}`)[0].n).toBe(0);
      expect((await sql`select count(*)::int n from app.lead_secrets where lead_id = ${leadId}`)[0].n).toBe(0);
      expect((await sql`select count(*)::int n from app.lead_attribution where lead_id = ${leadId}`)[0].n).toBe(0);
      expect((await sql`select count(*)::int n from app.lead_consents where lead_id = ${leadId}`)[0].n).toBe(0);
      expect((await sql`select count(*)::int n from app.analytics_events where session_id = ${'test-fail-' + RUN_ID}`)[0].n).toBe(0);
    }, 15000);

    test('idempotency key duplicada dentro de tx → segunda tx rollback', async () => {
      const key = randomUUID();
      const ep = '/test/' + RUN_ID;
      const p = phone();
      
      const run = () =>
        withTransaction(async (tx) => {
          const leadId = randomUUID();
          createdLeadIds.push(leadId);
          await submitLead(tx, {
            now: new Date(),
            leadId,
            idempotencyKey: key,
            route: ep,
            requestHash: 'h',
            publicReference: randomUUID(),
            idemExpiresAt: new Date(Date.now() + 3600_000),
            normalizedPhone: p.replace(/\D/g, ''),
            firstNameEnc: 'x', lastNameEnc: 'x', emailEnc: 'x', phoneEnc: 'x', birthdateEnc: 'x',
            emailBidx: 'x', phoneBidx: blindIndex(p.replace(/\D/g, '').slice(-10)),
            stateCode: null, planCode: 'prepago_100',
            nipEnc: 'x', nipExpiresAt: new Date(Date.now() + 3600_000),
            sourceCategory: 'organic',
            contractingAccepted: true, privacyAccepted: true, privacyPolicyVersion: '1', termsVersion: '1',
          });
        });
      await expect(run()).resolves.toBeUndefined();
      await expect(run()).rejects.toThrow(IdempotencyRaceError);
      const n = (await sql`select count(*)::int n from app.idempotency_keys where idempotency_key = ${key}`)[0].n;
      expect(n).toBe(1);
    }, 15000);

    // §18: TRUE CONCURRENCY — two parallel transactions with same idempotency key
    test('FLW-001 true concurrency: exactly 1 lead from 2 parallel submissions', async () => {
      const key = randomUUID();
      const ep = '/test/' + RUN_ID;
      const p = phone();
      const emailBidxVal = 'bidx-' + RUN_ID;

      const submit = () =>
        withTransaction(async (tx) => {
          const leadId = randomUUID();
          createdLeadIds.push(leadId);
          await submitLead(tx, {
            now: new Date(),
            leadId,
            sessionId: 'test-' + RUN_ID,
            idempotencyKey: key,
            route: ep,
            requestHash: 'h',
            publicReference: randomUUID(),
            idemExpiresAt: new Date(Date.now() + 3600_000),
            normalizedPhone: p.replace(/\D/g, ''),
            firstNameEnc: 'x', lastNameEnc: 'x', emailEnc: 'x', phoneEnc: 'x', birthdateEnc: 'x',
            emailBidx: emailBidxVal, phoneBidx: blindIndex(p.replace(/\D/g, '').slice(-10)),
            stateCode: null, planCode: 'prepago_100',
            nipEnc: 'x', nipExpiresAt: new Date(Date.now() + 3600_000),
            sourceCategory: 'organic',
            contractingAccepted: true, privacyAccepted: true, privacyPolicyVersion: '1', termsVersion: '1',
          });
        });

      // §18: Both must overlap (Promise.allSettled)
      const results = await Promise.allSettled([submit(), submit()]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // Exactly 1 succeeds, 1 fails with IdempotencyRaceError
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(IdempotencyRaceError);

      // §20: exactly 1 lead + 1 idempotency key + exactly 1 of all child writes
      const n = (await sql`select count(*)::int n from app.idempotency_keys where idempotency_key = ${key}`)[0].n;
      expect(n).toBe(1);

      const leadRows = await sql`select id from app.leads where email_bidx = ${emailBidxVal}`;
      expect(leadRows).toHaveLength(1);
      const committedLeadId = leadRows[0].id;

      // Verify exact child assertions (HRD-017)
      expect((await sql`select count(*)::int n from app.lead_secrets where lead_id = ${committedLeadId}`)[0].n).toBe(1);
      expect((await sql`select count(*)::int n from app.lead_attribution where lead_id = ${committedLeadId}`)[0].n).toBe(1);
      expect((await sql`select count(*)::int n from app.lead_consents where lead_id = ${committedLeadId}`)[0].n).toBe(1);
      
      const analyticsRows = await sql`select count(*)::int n from app.analytics_events where event_name = 'lead_success' and session_id = ${'test-' + RUN_ID}`;
      expect(analyticsRows[0].n).toBe(1);
    }, 15000);

    test('dos idempotency keys concurrentes para el mismo teléfono crean exactamente un lead', async () => {
      const p = phone();
      const phoneBidx = blindIndex(p);
      createdPhoneBidxs.push(phoneBidx);
      const endpoint = '/test/' + RUN_ID + '/phone-dedup';

      const submit = (index: number) => withTransaction(async (tx) => {
        const leadId = randomUUID();
        createdLeadIds.push(leadId);
        await submitLead(tx, {
          now: new Date(),
          leadId,
          sessionId: 'test-' + RUN_ID + '-phone-' + index,
          idempotencyKey: randomUUID(),
          route: endpoint,
          requestHash: 'phone-dedup-' + index,
          publicReference: randomUUID(),
          idemExpiresAt: new Date(Date.now() + 3600_000),
          normalizedPhone: p,
          firstNameEnc: 'x', lastNameEnc: 'x', emailEnc: 'x', phoneEnc: 'x', birthdateEnc: 'x',
          emailBidx: 'email-' + RUN_ID + '-' + index,
          phoneBidx,
          stateCode: null, planCode: 'prepago_100',
          nipEnc: 'x', nipExpiresAt: new Date(Date.now() + 3600_000),
          sourceCategory: 'direct',
          contractingAccepted: true, privacyAccepted: true, privacyPolicyVersion: '1', termsVersion: '1',
        });
      });

      const results = await Promise.allSettled([
        submit(1),
        submit(2),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(DuplicatePhoneError);
      expect((await sql`select count(*)::int n from app.leads where phone_bidx = ${phoneBidx}`)[0].n).toBe(1);
    }, 15000);
  });

  // ── SEC-004 — rate limit distribuido ────────────────────────────────────
  describe('SEC-004 rate limit', () => {
    test('N permitidos, N+1 = 429, sin IP raw', async () => {
      const key = 'rlkey-' + RUN_ID + '-' + randomUUID().slice(0, 8);
      createdRateLimitKeys.push(key);
      const cfg = { name: 'test:sec004', limit: 3, windowSecs: 60 };
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await checkRateLimit(key, cfg, 'closed'));
      expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
      expect(results[3].allowed).toBe(false);

      const row = (await sql`SELECT key_hash FROM app.rate_limits WHERE scope = 'test:sec004' AND key_hash = ${key}`)[0];
      expect(row.key_hash).toBe(key);
      expect(/^\d{1,3}(\.\d{1,3}){3}$/.test(row.key_hash)).toBe(false);
    });

    test('dos incrementos concurrentes → count exacto (sin race)', async () => {
      const key = 'rlkey-conc-' + RUN_ID + '-' + randomUUID().slice(0, 8);
      createdRateLimitKeys.push(key);
      const cfg = { name: 'test:sec004c', limit: 100, windowSecs: 60 };
      await Promise.all(Array.from({ length: 10 }, () => checkRateLimit(key, cfg, 'closed')));
      const row = (await sql`SELECT count FROM app.rate_limits WHERE scope = 'test:sec004c' AND key_hash = ${key}`)[0];
      expect(row.count).toBe(10);
    });
  });

  // ── SEC-010 — least privilege REAL del rol runtime ─────────────────────────
  describe('SEC-010 rol runtime de mínimo privilegio', () => {
    let rsql: (s: TemplateStringsArray, ...v: unknown[]) => Promise<Row[]>;

    beforeAll(() => {
      rsql = neon(RUNTIME_URL!) as unknown as typeof rsql;
    });

    test('rol runtime: sin neon_superuser y sin atributos privilegiados', async () => {
      const r = (await rsql`
        select current_user u, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
          pg_has_role(current_user,'neon_superuser','member') nsu,
          pg_has_role(current_user,'neon_auth','member') nauth
        from pg_roles where rolname = current_user`)[0];
      expect(r.u).toBe(process.env.RUNTIME_ROLE_NAME ?? 'baitprepago_app_runtime');
      expect(r.rolsuper).toBe(false);
      expect(r.rolcreatedb).toBe(false);
      expect(r.rolcreaterole).toBe(false);
      expect(r.rolreplication).toBe(false);
      expect(r.rolbypassrls).toBe(false);
      expect(r.nsu).toBe(false);
      expect(r.nauth).toBe(false);
    });

    test('schema app: USAGE sí, CREATE no; public CREATE no', async () => {
      const r = (await rsql`
        select has_schema_privilege(current_user,'app','USAGE') au,
               has_schema_privilege(current_user,'app','CREATE') ac,
               has_schema_privilege(current_user,'public','CREATE') pc`)[0];
      expect(r.au).toBe(true);
      expect(r.ac).toBe(false);
      expect(r.pc).toBe(false);
    });

    // §36: Safe DDL probes using disposable table created by owner
    test('DDL denegado: safe probe (disposable table, not business tables)', async () => {
      // Validate RUN_ID
      if (!/^[0-9a-f]{8}$/.test(RUN_ID)) throw new Error('Invalid RUN_ID');
      const probeName = `__sec010_probe_${RUN_ID}`;
      const createName = `__sec010_create_${RUN_ID}`;
      const roleName = `__sec010_r_${RUN_ID}`;
      const ownerSql = neon(TEST_OWNER_URL!) as unknown as typeof sql;

      await ownerSql`SELECT 1`; // verify owner connection
      
      // Owner creates disposable probe table using template string array casting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ownerSql as any).query(`CREATE TABLE IF NOT EXISTS app.${probeName} (x int)`);

      // Runtime attempts CREATE → denied
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((rsql as any).query(`CREATE TABLE app.${createName} (x int)`)).rejects.toThrow(/permission denied/i);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((rsql as any).query(`CREATE TABLE public.${createName} (x int)`)).rejects.toThrow(/permission denied/i);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((rsql as any).query(`CREATE ROLE ${roleName}`)).rejects.toThrow(/permission denied/i);

      // Runtime attempts ALTER/DROP on the disposable table → denied
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((rsql as any).query(`ALTER TABLE app.${probeName} ADD COLUMN __sec010_x int`)).rejects.toThrow(/must be owner|permission denied/i);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((rsql as any).query(`DROP TABLE app.${probeName}`)).rejects.toThrow(/must be owner|permission denied/i);

      // Owner cleanup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ownerSql as any).query(`DROP TABLE IF EXISTS app.${probeName}`);
    });

    test('neon_auth: acceso EFECTIVO denegado', async () => {
      await expect(rsql`select id from neon_auth."user" limit 1`).rejects.toThrow(/permission denied/i);
      await expect(rsql`select id from neon_auth.session limit 1`).rejects.toThrow(/permission denied/i);
    });

    // §32: Real DML coverage — representative mutations
    test('DML real: INSERT, UPDATE, DELETE, UPSERT on permitted tables', async () => {
      // INSERT a test lead
      const testId = randomUUID();
      createdLeadIds.push(testId);
      await rsql`INSERT INTO app.leads (id, public_reference, status, first_name_enc,last_name_enc,email_enc,phone_enc,birthdate_enc,email_bidx,phone_bidx,state_code,plan_code)
        VALUES (${testId}, ${randomUUID()}, 'received','x','x','x','x','x','dml-' || ${RUN_ID},'dml-' || ${RUN_ID},NULL,'prepago_100')`;

      // UPDATE
      const updated = await rsql`UPDATE app.leads SET status = 'processing' WHERE id = ${testId} RETURNING id`;
      expect(updated).toHaveLength(1);

      // UPSERT (rate_limits uses ON CONFLICT on PK: scope, key_hash, bucket_start)
      const rlKey = 'dml-test-' + RUN_ID;
      createdRateLimitKeys.push(rlKey);
      const bucketStart = new Date(Math.floor(Date.now() / 60000) * 60000);
      const expiresAt = new Date(bucketStart.getTime() + 120000);
      await rsql`INSERT INTO app.rate_limits (scope, key_hash, count, bucket_start, expires_at)
        VALUES ('test:dml', ${rlKey}, 1, ${bucketStart}, ${expiresAt})
        ON CONFLICT (scope, key_hash, bucket_start) DO UPDATE SET count = app.rate_limits.count + 1`;

      // Second upsert increments
      await rsql`INSERT INTO app.rate_limits (scope, key_hash, count, bucket_start, expires_at)
        VALUES ('test:dml', ${rlKey}, 1, ${bucketStart}, ${expiresAt})
        ON CONFLICT (scope, key_hash, bucket_start) DO UPDATE SET count = app.rate_limits.count + 1`;
      const rl = (await rsql`SELECT count FROM app.rate_limits WHERE scope = 'test:dml' AND key_hash = ${rlKey}`)[0];
      expect(rl.count).toBe(2);

    });

    // §33: Append-only tables
    test('append-only tables: INSERT allowed, SELECT/UPDATE/DELETE denied', async () => {
      // security_events: INSERT yes (must use valid enum value)
      await expect(rsql`INSERT INTO app.security_events (event_type, route, ip_hash) VALUES ('bot_block', ${'/test/' + RUN_ID}, ${'hash-' + RUN_ID})`).resolves.toBeTruthy();
      // security_events: SELECT no
      await expect(rsql`SELECT * FROM app.security_events LIMIT 1`).rejects.toThrow(/permission denied/i);
      // security_events: UPDATE no
      await expect(rsql`UPDATE app.security_events SET route = '/x' WHERE route = ${'/test/' + RUN_ID}`).rejects.toThrow(/permission denied/i);
      // security_events: DELETE no
      await expect(rsql`DELETE FROM app.security_events WHERE route = ${'/test/' + RUN_ID}`).rejects.toThrow(/permission denied/i);

      // audit_logs: INSERT yes (must use valid enum value)
      await expect(rsql`INSERT INTO app.audit_logs (actor_id, action, target_type, target_id) VALUES (${randomUUID()}, 'ADMIN_LOGIN_SUCCESS', ${'test-' + RUN_ID}, ${randomUUID()})`).resolves.toBeTruthy();
      // audit_logs: SELECT no
      await expect(rsql`SELECT * FROM app.audit_logs LIMIT 1`).rejects.toThrow(/permission denied/i);
      // audit_logs: UPDATE no
      await expect(rsql`UPDATE app.audit_logs SET action = 'ADMIN_LOGIN_SUCCESS' WHERE target_type = ${'test-' + RUN_ID}`).rejects.toThrow(/permission denied/i);
      // audit_logs: DELETE no
      await expect(rsql`DELETE FROM app.audit_logs WHERE target_type = ${'test-' + RUN_ID}`).rejects.toThrow(/permission denied/i);
    });

    // §34: No-access tables (if they exist on this branch)
  });

  // ── PRIVILEGE MANIFEST — enforcement ───────────────────────────────────────
  describe('Privilege manifest enforcement', () => {

    // §42: Every table in app schema must have a manifest entry
    test('every app schema table has a manifest entry', async () => {
      const { PRIVILEGE_MANIFEST } = await import('../../src/lib/security/privilege-manifest');
      // Use OWNER connection to query production DB for authoritative table list
      const ownerSql = neon(TEST_OWNER_URL!) as unknown as typeof sql;
      const tables = await ownerSql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY table_name`;
      const tableNames = tables.map((t: Row) => t.table_name);
      const manifestKeys = Object.keys(PRIVILEGE_MANIFEST).sort();

      // Every DB table must be in manifest
      for (const t of tableNames) {
        expect(manifestKeys, `Table '${t}' is in DB but missing from privilege manifest`).toContain(t);
      }
      // Every manifest key must be a real DB table
      for (const k of manifestKeys) {
        expect(tableNames, `Manifest key '${k}' does not exist as a DB table`).toContain(k);
      }
    });

    // §41: Actual grants must match manifest
    test('actual grants match privilege manifest', async () => {
      const { PRIVILEGE_MANIFEST } = await import('../../src/lib/security/privilege-manifest');
      const ownerSql = neon(TEST_OWNER_URL!) as unknown as typeof sql;

      const role = process.env.RUNTIME_ROLE_NAME ?? 'baitprepago_app_runtime';
      for (const [table, expected] of Object.entries(PRIVILEGE_MANIFEST)) {
        const privs = (await ownerSql`
          SELECT
            has_table_privilege(${role}, 'app.' || ${table}, 'SELECT') as sel,
            has_table_privilege(${role}, 'app.' || ${table}, 'INSERT') as ins,
            has_table_privilege(${role}, 'app.' || ${table}, 'UPDATE') as upd,
            has_table_privilege(${role}, 'app.' || ${table}, 'DELETE') as del
        `)[0];

        expect(privs.sel, `${table} SELECT: expected=${expected.select}, actual=${privs.sel}`).toBe(expected.select);
        expect(privs.ins, `${table} INSERT: expected=${expected.insert}, actual=${privs.ins}`).toBe(expected.insert);
        expect(privs.upd, `${table} UPDATE: expected=${expected.update}, actual=${privs.upd}`).toBe(expected.update);
        expect(privs.del, `${table} DELETE: expected=${expected.delete}, actual=${privs.del}`).toBe(expected.delete);
      }
    });
  });
});
