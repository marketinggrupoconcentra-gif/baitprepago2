/**
 * tests/integration/outbox-intelix.test.ts — Entrega a Intelix vía outbox (rama Neon de test)
 *
 * Levanta un mock HTTP de Intelix, encola un lead real con submitLead (NIP cifrado en
 * lead_secrets) y ejecuta el cron /api/cron/outbox. Verifica:
 *  - contrato del payload { chat_id, dn, compania, nombre, apellidos, nip, capturista }
 *  - delivered → lead.status = delivered y el NIP se BORRA de lead_secrets
 *  - error de validación de Intelix → dead (sin reintento), payload guardado ENMASCARADO
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import http from 'http';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';

const TEST_URL = process.env.TEST_DATABASE_URL;
const OWNER_URL = process.env.TEST_OWNER_DATABASE_URL;
if (!TEST_URL || !OWNER_URL) throw new Error('[CONFIG FAILURE] TEST_DATABASE_URL y TEST_OWNER_DATABASE_URL requeridas (rama Neon de test)');
process.env.APP_DATABASE_URL = TEST_URL;
delete process.env.DATABASE_URL;

const RUN_ID = crypto.randomUUID().slice(0, 8);
const CRON_SECRET = 'test-cron-' + RUN_ID;
const ownerSql = neon(OWNER_URL);

type Call = Record<string, unknown>;
const calls: Call[] = [];
let server: http.Server;
let port = 0;

async function seedLead(phone: string, nip: string) {
  const { withTransaction } = await import('@/db');
  const { submitLead } = await import('@/lib/leads/submit-lead');
  const { encryptPII, blindIndex } = await import('@/lib/crypto');
  const leadId = crypto.randomUUID();
  await withTransaction(async (tx) => {
    await submitLead(tx, {
      now: new Date(), leadId, idempotencyKey: crypto.randomUUID(), route: '/test/' + RUN_ID,
      requestHash: 'h', publicReference: crypto.randomUUID(), idemExpiresAt: new Date(Date.now() + 3600_000),
      normalizedPhone: phone,
      firstNameEnc: encryptPII('Ana'), lastNameEnc: encryptPII('Prueba'), emailEnc: encryptPII(`ana-${RUN_ID}@example.com`),
      phoneEnc: encryptPII(phone), birthdateEnc: null,
      emailBidx: blindIndex(`ana-${RUN_ID}@example.com`), phoneBidx: blindIndex(phone),
      stateCode: null, planCode: 'prepago_100',
      nipEnc: encryptPII(nip), nipExpiresAt: new Date(Date.now() + 72 * 3600_000),
      outboxDestination: 'intelix',
      sessionId: 'test-' + RUN_ID, sourceCategory: 'direct',
      contractingAccepted: true, privacyAccepted: true, privacyPolicyVersion: '1.0.0', termsVersion: '1.0.0',
    });
  });
  return leadId;
}

async function runCron() {
  const { GET } = await import('@/app/api/cron/outbox/route');
  const res = await GET(new NextRequest('http://localhost/api/cron/outbox', { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
  return res.json() as Promise<{ ok: boolean; claimed: number; processed: number; failed: number }>;
}

describe('Outbox → Intelix (contrato real)', () => {
  const leadIds: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body || '{}') as Call;
        calls.push({ url: req.url, ...json });
        if (json.dn === '5500000000') {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ errores: [{ codigo: 'NIP_INVALIDO', descripcion: 'NIP inválido' }] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, folio: 'INT-' + RUN_ID }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
    await ownerSql`INSERT INTO app.settings (key, value, updated_at) VALUES ('intelix_api_url', ${`http://127.0.0.1:${port}/api/botmaker/store/portability`}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  });

  afterAll(async () => {
    await ownerSql`DELETE FROM app.settings WHERE key = 'intelix_api_url'`;
    if (leadIds.length) {
      await ownerSql`DELETE FROM app.conversion_deliveries WHERE lead_id = ANY(${leadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.delivery_outbox WHERE lead_id = ANY(${leadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.lead_secrets WHERE lead_id = ANY(${leadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.lead_attribution WHERE lead_id = ANY(${leadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.lead_consents WHERE lead_id = ANY(${leadIds}::uuid[])`;
      await ownerSql`DELETE FROM app.analytics_events WHERE session_id = ${'test-' + RUN_ID}`;
      await ownerSql`DELETE FROM app.idempotency_keys WHERE endpoint = ${'/test/' + RUN_ID}`;
      await ownerSql`DELETE FROM app.leads WHERE id = ANY(${leadIds}::uuid[])`;
    }
    vi.unstubAllEnvs();
    await new Promise<void>((r) => server.close(() => r()));
  });

  test('cron sin bearer → 401', async () => {
    const { GET } = await import('@/app/api/cron/outbox/route');
    const res = await GET(new NextRequest('http://localhost/api/cron/outbox'));
    expect(res.status).toBe(401);
  });

  test('lead aceptado: payload con el contrato, lead delivered y NIP borrado', async () => {
    const phone = '55' + String(Date.now()).slice(-8);
    const leadId = await seedLead(phone, '2468');
    leadIds.push(leadId);

    const before = await ownerSql`SELECT count(*)::int n FROM app.lead_secrets WHERE lead_id = ${leadId}`;
    expect(before[0].n).toBe(1);

    const out = await runCron();
    expect(out.ok).toBe(true);
    expect(out.processed).toBeGreaterThanOrEqual(1);

    const call = calls.find((c) => c.dn === phone);
    expect(call).toBeDefined();
    expect(call).toMatchObject({ chat_id: 1, dn: phone, compania: 'telcel', nombre: 'Ana', apellidos: 'Prueba', nip: '2468', capturista: '99977' });
    expect(Object.keys(call!).sort()).toEqual(['apellidos', 'capturista', 'chat_id', 'compania', 'dn', 'nip', 'nombre', 'url']);

    const [row] = await ownerSql`SELECT o.status, o.delivered_at, l.status AS lead_status FROM app.delivery_outbox o JOIN app.leads l ON l.id = o.lead_id WHERE o.lead_id = ${leadId}`;
    expect(row.status).toBe('delivered');
    expect(row.delivered_at).not.toBeNull();
    expect(row.lead_status).toBe('delivered');

    const after = await ownerSql`SELECT count(*)::int n FROM app.lead_secrets WHERE lead_id = ${leadId}`;
    expect(after[0].n).toBe(0);
  }, 30000);

  test('Intelix rechaza por validación: dead sin reintento y payload enmascarado', async () => {
    const leadId = await seedLead('5500000000', '1357');
    leadIds.push(leadId);

    const out = await runCron();
    expect(out.failed).toBeGreaterThanOrEqual(1);

    const [row] = await ownerSql`SELECT o.status, o.last_error_code, o.last_error_payload, o.attempts, l.status AS lead_status FROM app.delivery_outbox o JOIN app.leads l ON l.id = o.lead_id WHERE o.lead_id = ${leadId}`;
    expect(row.status).toBe('dead');
    expect(row.last_error_code).toBe('NIP_INVALIDO');
    expect(row.lead_status).toBe('failed');
    const payload = row.last_error_payload as { sent: Record<string, unknown>; httpStatus: number; response: unknown };
    expect(payload.httpStatus).toBe(422);
    expect(payload.sent.nip).toBe('[REDACTED]');
    expect(String(payload.sent.dn)).not.toContain('55000000');
    expect(JSON.stringify(payload)).not.toContain('1357');
  }, 30000);
});
