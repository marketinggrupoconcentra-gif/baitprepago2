import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { logError, logInfo } from '@/lib/log';
import { claimOutboxBatch, markDelivered, markFailed } from '@/lib/outbox/claim';
import { maskIntelixPayload } from '@/lib/outbox/intelix-log';
import { getIntelixConfig } from '@/lib/integrations/config';

// ── Cron: entrega de leads a Intelix (outbox con reintentos) ─────────────────
// Contrato Intelix (POST {intelix_api_url}):
//   { chat_id, dn, compania, nombre, apellidos, nip, capturista }
// FLW-003: la query elegible filtra estados terminales ANTES del LIMIT.
// FLW-004: claim atómico con FOR UPDATE SKIP LOCKED + lease → dos workers
//          concurrentes nunca procesan la misma fila; un crash se recupera al
//          expirar el lease. La BDD es SOURCE OF TRUTH.
// NIP: vive cifrado en app.lead_secrets SOLO hasta que Intelix acepta el
//      registro (se borra en markDelivered) o hasta NIP_RETENTION_HOURS (cron
//      nip-purge). Nunca en claro, nunca en logs (maskIntelixPayload).

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

  const intelix = await getIntelixConfig();
  if (!intelix) {
    logInfo(route, 'skip', { reason: 'intelix_not_configured' });
    return NextResponse.json({ ok: true, processed: 0, reason: 'intelix_not_configured' });
  }

  const db = getDb();
  const claimed = await claimOutboxBatch({ destination: 'intelix' });

  let processed = 0;
  let failed = 0;

  const { decryptPII } = await import('@/lib/crypto');

  for (const entry of claimed) {
    const attempt = entry.attempts + 1;
    let sentPayload: Record<string, unknown> | undefined;
    let intelixHttpStatus: number | undefined;
    let intelixData: unknown;

    try {
      const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, entry.lead_id)).limit(1);
      if (!lead) {
        await markFailed(entry.id, entry.lead_id, 5, 'lead_missing');
        failed++;
        continue;
      }

      const [secret] = await db.select().from(schema.leadSecrets).where(eq(schema.leadSecrets.leadId, entry.lead_id)).limit(1);
      if (!secret) {
        // El NIP ya se purgó (retención vencida): no se puede entregar; marcar como muerto.
        await markFailed(entry.id, entry.lead_id, 99, 'nip_expired');
        failed++;
        continue;
      }

      const requestBody = {
        chat_id: intelix.chatId,
        dn: decryptPII(lead.phoneEnc),
        compania: intelix.compania,
        nombre: decryptPII(lead.firstNameEnc),
        apellidos: decryptPII(lead.lastNameEnc),
        nip: decryptPII(secret.nipEnc),
        capturista: intelix.capturista,
      };

      // NUNCA guardar el payload con PII/NIP en claro — se enmascara antes de persistir.
      sentPayload = maskIntelixPayload(requestBody);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), intelix.timeoutMs);
      const response = await fetch(intelix.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(intelix.apiKey ? { Authorization: `Bearer ${intelix.apiKey}` } : {}) },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      intelixHttpStatus = response.status;
      intelixData = await response.json().catch(() => null);

      if (!response.ok) {
        const d = (intelixData ?? {}) as { errores?: { codigo?: string; descripcion?: string }[]; message?: string; error?: string };
        const intelixCode = d.errores?.[0]?.codigo;
        const errorMsg = d.errores?.[0]?.descripcion || d.message || d.error || '';
        const isDup = typeof errorMsg === 'string' && /ya tenemos un registro|duplicad/i.test(errorMsg);
        throw new Error(intelixCode ? String(intelixCode) : (isDup ? 'http_409_duplicado' : `http_${response.status}`));
      }

      await markDelivered(entry.id, entry.lead_id, attempt);
      processed++;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const errCode = isTimeout ? 'timeout' : (err instanceof Error ? err.message.slice(0, 40).replace(/[^a-zA-Z0-9_]/g, '') : 'unknown');
      // Debug: lo enviado (enmascarado) + respuesta cruda de Intelix (sin PII: Intelix no la devuelve).
      const debugPayload = sentPayload
        ? { sent: sentPayload, httpStatus: intelixHttpStatus ?? null, response: intelixData ?? null }
        : null;
      await markFailed(entry.id, entry.lead_id, attempt, errCode, debugPayload);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, processed, failed, checkedAt: new Date().toISOString() });
}
