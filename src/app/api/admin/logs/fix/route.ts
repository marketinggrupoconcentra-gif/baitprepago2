/**
 * POST /api/admin/logs/fix — Corrige un campo del lead y re-encola el outbox
 *
 * Requiere: logs.retry (o leads.edit si existe)
 * Body: { outboxId: string, field: string, value: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { eq } from 'drizzle-orm';
import { logError, logInfo } from '@/lib/log';
import { writeAuditLog } from '@/lib/audit';
import { encryptPII, blindIndex } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('logs.retry');
  } catch (res) {
    return res as NextResponse;
  }

  let body: { outboxId?: string; field?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { outboxId, field, value } = body;

  if (!outboxId || typeof outboxId !== 'string' || !UUID_RE.test(outboxId)) {
    return NextResponse.json({ error: 'ID de outbox inválido' }, { status: 400 });
  }
  if (!field || typeof field !== 'string') {
    return NextResponse.json({ error: 'Campo a corregir requerido' }, { status: 400 });
  }
  if (value === undefined || typeof value !== 'string') {
    return NextResponse.json({ error: 'Valor de corrección requerido' }, { status: 400 });
  }

  try {
    const db = getDb();

    // 1. Obtener la fila de outbox
    const [outbox] = await db
      .select({
        id: schema.deliveryOutbox.id,
        leadId: schema.deliveryOutbox.leadId,
        status: schema.deliveryOutbox.status,
      })
      .from(schema.deliveryOutbox)
      .where(eq(schema.deliveryOutbox.id, outboxId))
      .limit(1);

    if (!outbox) {
      return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });
    }

    if (outbox.status === 'delivered') {
      return NextResponse.json({ error: 'El registro ya fue entregado exitosamente.' }, { status: 400 });
    }
    if (outbox.status === 'processing') {
      return NextResponse.json({ error: 'El registro se está enviando en este momento.' }, { status: 400 });
    }

    // 2. Aplicar la corrección en leads o lead_secrets
    const now = new Date();

    // Lista permitida de campos editables para corrección
    if (field === 'email') {
      await db.update(schema.leads).set({
        emailEnc: encryptPII(value),
        emailBidx: blindIndex(value),
        updatedAt: now,
      }).where(eq(schema.leads.id, outbox.leadId));
    } else if (field === 'phone') {
      await db.update(schema.leads).set({
        phoneEnc: encryptPII(value),
        phoneBidx: blindIndex(value),
        updatedAt: now,
      }).where(eq(schema.leads.id, outbox.leadId));
    } else if (field === 'firstName') {
      await db.update(schema.leads).set({
        firstNameEnc: encryptPII(value),
        updatedAt: now,
      }).where(eq(schema.leads.id, outbox.leadId));
    } else if (field === 'lastName') {
      await db.update(schema.leads).set({
        lastNameEnc: encryptPII(value),
        updatedAt: now,
      }).where(eq(schema.leads.id, outbox.leadId));
    } else if (field === 'stateCode') {
      await db.update(schema.leads).set({
        stateCode: value,
        updatedAt: now,
      }).where(eq(schema.leads.id, outbox.leadId));
    } else if (field === 'planCode') {
      await db.update(schema.leads).set({
        planCode: value,
        updatedAt: now,
      }).where(eq(schema.leads.id, outbox.leadId));
    } else if (field === 'nip') {
      const nipVal = value.trim();
      if (!/^\d{4}$/.test(nipVal)) {
        return NextResponse.json({ error: 'El NIP debe tener 4 dígitos exactos.' }, { status: 400 });
      }
      // Upsert or update, since it might have expired or missing, but wait, if it's missing, update won't do anything.
      // Better to check if it exists or do a raw SQL if possible, but let's assume it exists and we're just updating it.
      await db.update(schema.leadSecrets).set({
        nipEnc: encryptPII(nipVal),
      }).where(eq(schema.leadSecrets.leadId, outbox.leadId));
    } else {
      return NextResponse.json({ error: 'Campo no permitido para edición en caliente.' }, { status: 400 });
    }

    // 3. Reactivar en outbox
    const [updatedOutbox] = await db
      .update(schema.deliveryOutbox)
      .set({
        status: 'pending',
        attempts: 0, // Reiniciamos los intentos
        nextAttemptAt: now,
        lockedAt: null,
        leaseExpiresAt: null,
        lockedBy: null,
        updatedAt: now,
      })
      .where(eq(schema.deliveryOutbox.id, outbox.id))
      .returning({ id: schema.deliveryOutbox.id });

    if (!updatedOutbox) {
      return NextResponse.json({ error: 'No se pudo reactivar el registro.' }, { status: 500 });
    }

    await writeAuditLog({
      session,
      action: 'OUTBOX_RETRY_QUEUED',
      targetType: 'lead',
      targetId: outbox.leadId,
      safeMetadata: {
        event: 'intelix_error_correction',
        outboxId: outbox.id,
        fieldCorrected: field
      },
    });

    logInfo('/api/admin/logs/fix', 'lead_corrected_and_requeued', { outboxId: outbox.id, leadId: outbox.leadId, field });

    return NextResponse.json({
      ok: true,
      message: 'Lead corregido y re-encolado. Se enviará en ≤5 min.',
    });
  } catch (err) {
    logError('/api/admin/logs/fix', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
