import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { logError, logInfo } from '@/lib/log';
import { claimOutboxBatch, markDelivered, markFailed } from '@/lib/outbox/claim';
// Mapa INEGI (2 letras) → id de estado en Intelix. Solo aplica si CRM_PROVIDER=intelix.
const STATE_TO_INTELIX_ID: Record<string, string> = {
  AG: '1', BC: '2', BS: '3', CM: '4', CO: '5', CL: '6', CS: '7', CH: '8', MC: '9', DG: '10', GT: '11', GR: '12',
  HG: '13', JC: '14', DF: '15', MN: '16', MS: '17', NT: '18', NL: '19', OA: '20', PU: '21', QT: '22', QR: '23',
  SL: '24', SI: '25', SO: '26', TB: '27', TM: '28', TL: '29', VZ: '30', YN: '31', ZS: '32',
};
import { maskIntelixPayload } from '@/lib/outbox/intelix-log';

// ── Cron: Outbox Retry (Intelix) ─────────────────────────────────────────────
// FLW-003: la query elegible filtra estados terminales ANTES del LIMIT.
// FLW-004: claim atómico con FOR UPDATE SKIP LOCKED + lease → dos workers
//          concurrentes nunca procesan la misma fila; un crash se recupera al
//          expirar el lease.
// La BDD es SOURCE OF TRUTH.
// Claim/success/retry/dead logic is in src/lib/outbox/claim.ts (single source).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const route = '/api/cron/outbox';

  // ── FLW-005: cron fail-closed ──────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logError(route, 'config', new Error('CRON_SECRET missing'));
    return NextResponse.json({ error: 'Configuración incompleta.' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const { getSetting } = await import('@/lib/settings');
  const intelixUrl = await getSetting('intelix_api_url', process.env.INTELIX_API_URL);
  const intelixKey = await getSetting('intelix_api_key', process.env.INTELIX_API_KEY);
  const capturista = process.env.INTELIX_CAPTURISTA ?? '';
  const timeoutMs = Number(process.env.DOWNSTREAM_TIMEOUT_MS ?? 10_000);

  if (!intelixUrl) {
    logInfo(route, 'skip', { reason: 'no_intelix_url' });
    return NextResponse.json({ ok: true, processed: 0, reason: 'no_intelix_url' });
  }

  const db = getDb();

  // ── Claim atómico (delegated to shared module) ────────────────────────────
  const claimed = await claimOutboxBatch();

  let processed = 0;
  let failed = 0;

  const { decryptPII } = await import('@/lib/crypto');

  for (const entry of claimed) {
    const attempt = entry.attempts + 1;

    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, entry.lead_id)).limit(1);
    if (!lead) {
      await markFailed(entry.id, entry.lead_id, 5, 'lead_missing');
      continue;
    }
    const [attr] = await db.select().from(schema.leadAttribution).where(eq(schema.leadAttribution.leadId, entry.lead_id)).limit(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let intelixData: any;
    let intelixHttpStatus: number | undefined;
    let sentPayload: Record<string, unknown> | undefined;
    try {
      const [secret] = await db.select().from(schema.leadSecrets).where(eq(schema.leadSecrets.leadId, entry.lead_id)).limit(1);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const requestBody = {
        chat_id: 1,
        email: decryptPII(lead.emailEnc),
        dn: decryptPII(lead.phoneEnc),
        compania: 'Movistar', // estático
        imei: '861965050128463', // estático
        nombre: decryptPII(lead.firstNameEnc),
        apellidos: decryptPII(lead.lastNameEnc),
        plan_migracion: '1', // estático
        genero: 'N/A',
        estado_nacimiento: lead.stateCode ? (STATE_TO_INTELIX_ID[lead.stateCode] || lead.stateCode) : '',
        nip: secret ? decryptPII(secret.nipEnc) : '',
        fecha_nacimiento: lead.birthdateEnc ? decryptPII(lead.birthdateEnc) : '',
        curp: 'N/A',
        rfc: 'N/A',
        capturista
      };
      // NUNCA guardar el payload con PII/NIP en claro (política de privacidad
      // Etapa 2.2) — para el log de debug se enmascara antes de persistir.
      sentPayload = maskIntelixPayload(requestBody);

      const response = await fetch(intelixUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(intelixKey ? { Authorization: `Bearer ${intelixKey}` } : {}) },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      intelixHttpStatus = response.status;

      if (!response.ok) {
        intelixData = await response.json().catch(() => ({}));
        const intelixCode = intelixData?.errores?.[0]?.codigo;
        const errorMsg = intelixData?.errores?.[0]?.descripcion || intelixData?.message || intelixData?.error || '';
        const isDup = typeof errorMsg === 'string' && errorMsg.includes('Ya tenemos un registro');
        const errCodeStr = intelixCode ? intelixCode : (isDup ? 'http_409_duplicado' : `http_${response.status}`);
        throw new Error(errCodeStr);
      }

      await markDelivered(entry.id, entry.lead_id, attempt);
      processed++;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const errCode = isTimeout ? 'timeout' : (err instanceof Error ? err.message.slice(0, 40).replace(/[^a-zA-Z0-9_]/g, '') : 'unknown');
      // Debug log: lo que se envió (enmascarado) + la respuesta cruda de
      // Intelix (o null si nunca llegó a responder, p. ej. timeout/red).
      const debugPayload = sentPayload
        ? { sent: sentPayload, httpStatus: intelixHttpStatus ?? null, response: intelixData ?? null }
        : null;
      await markFailed(entry.id, entry.lead_id, attempt, errCode, debugPayload);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, processed, failed, checkedAt: new Date().toISOString() });
}
