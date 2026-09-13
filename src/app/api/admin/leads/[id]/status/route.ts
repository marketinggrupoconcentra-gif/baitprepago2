/**
 * PATCH /api/admin/leads/[id]/status — Cambiar commercial_status de un lead
 *
 * Requiere: leads.status.change permission
 * Auditado: LEAD_STATUS_CHANGED
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { eq } from 'drizzle-orm';
import { logError } from '@/lib/log';
import { enqueueWonConversions } from '@/lib/conversions/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'WON', 'LOST'] as const;
type CommercialStatus = typeof VALID_STATUSES[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('leads.status.change');
  } catch (res) {
    return res as NextResponse;
  }

  const { id } = await params;

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  let body: { commercialStatus: CommercialStatus; notes?: string; assignedToAuthUserId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  if (!VALID_STATUSES.includes(body.commercialStatus)) {
    return NextResponse.json(
      { error: `Estado inválido. Valores permitidos: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  // Sanear notas — máx. 500 chars, no HTML
  const notes = body.notes !== undefined
    ? body.notes.slice(0, 500).replace(/<[^>]*>/g, '')
    : undefined;

  try {
    const db = getDb();

    // Verificar que el lead existe
    const [lead] = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(eq(schema.leads.id, id))
      .limit(1);

    if (!lead) {
      return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 });
    }

    // Upsert lead_management
    const [existing] = await db
      .select({ 
        id: schema.leadManagement.id, 
        commercialStatus: schema.leadManagement.commercialStatus,
        assignedToAuthUserId: schema.leadManagement.assignedToAuthUserId
      })
      .from(schema.leadManagement)
      .where(eq(schema.leadManagement.leadId, id))
      .limit(1);

    const previousStatus = existing?.commercialStatus ?? null;
    const previousAssignee = existing?.assignedToAuthUserId ?? null;

    if (existing) {
      await db
        .update(schema.leadManagement)
        .set({
          commercialStatus: body.commercialStatus,
          updatedByAuthUserId: session.userId,
          updatedAt: new Date(),
          ...(notes !== undefined ? { notes } : {}),
          ...(body.assignedToAuthUserId !== undefined ? { assignedToAuthUserId: body.assignedToAuthUserId } : {}),
        })
        .where(eq(schema.leadManagement.leadId, id));
    } else {
      await db.insert(schema.leadManagement).values({
        leadId: id,
        commercialStatus: body.commercialStatus,
        updatedByAuthUserId: session.userId,
        ...(notes !== undefined ? { notes } : {}),
        ...(body.assignedToAuthUserId !== undefined ? { assignedToAuthUserId: body.assignedToAuthUserId } : {}),
      });
    }

    // Portabilidad ganada → conversión offline (Google Ads) / Purchase (Meta CAPI).
    if (body.commercialStatus === 'WON' && previousStatus !== 'WON') {
      await enqueueWonConversions(db, { leadId: id, occurredAt: new Date() });
    }

    await writeAuditLog({
      session,
      action: 'LEAD_STATUS_CHANGED',
      targetType: 'lead',
      targetId: id,
      safeMetadata: {
        from: previousStatus,
        to: body.commercialStatus,
        fromAssignee: previousAssignee,
        toAssignee: body.assignedToAuthUserId,
      },
    });

    return NextResponse.json({ ok: true, commercialStatus: body.commercialStatus });

  } catch (err) {
    logError('/api/admin/leads/[id]/status', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
