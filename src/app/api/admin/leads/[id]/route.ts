/**
 * GET /api/admin/leads/[id] — Detalle de un lead con PII descifrada
 *
 * Requiere: leads.detail.view permission
 * Auditado: LEAD_DETAIL_VIEWED — cada acceso queda registrado.
 * Auto-asignación: si el lead no tiene asesor asignado, se asigna al usuario
 *   que abre el detalle por primera vez. Nunca desplaza asignaciones previas.
 * Timestamps: TIMESTAMPTZ (UTC en DB); display en CDMX en el cliente.
 * NO devuelve: NIP, lead_secrets.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { decryptPII } from '@/lib/crypto';
import { writeRequiredAuditLog } from '@/lib/audit';
import { eq } from 'drizzle-orm';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('leads.detail.view');
  } catch (res) {
    return res as NextResponse;
  }

  const { id } = await params;

  // Validar UUID
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  try {
    const db = getDb();

    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, id))
      .limit(1);

    if (!lead) {
      return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 });
    }

    // Obtener datos relacionados en paralelo
    const [attribution, consent, management] = await Promise.all([
      db
        .select()
        .from(schema.leadAttribution)
        .where(eq(schema.leadAttribution.leadId, id))
        .limit(1)
        .then(r => r[0] ?? null),

      db
        .select({
          contractingAccepted: schema.leadConsents.contractingAccepted,
          privacyAccepted: schema.leadConsents.privacyAccepted,
          privacyPolicyVersion: schema.leadConsents.privacyPolicyVersion,
          termsVersion: schema.leadConsents.termsVersion,
          acceptedAt: schema.leadConsents.acceptedAt,
        })
        .from(schema.leadConsents)
        .where(eq(schema.leadConsents.leadId, id))
        .limit(1)
        .then(r => r[0] ?? null),

      db
        .select()
        .from(schema.leadManagement)
        .where(eq(schema.leadManagement.leadId, id))
        .limit(1)
        .then(r => r[0] ?? null),
    ]);

    // ── Auto-asignación ────────────────────────────────────────────────────────
    // Si el lead no tiene asesor asignado, asignarlo al usuario que abrió el detalle.
    // Nunca desplaza una asignación existente.
    // new Date() = UTC → Postgres lo almacena como TIMESTAMPTZ; el cliente muestra CDMX.
    let finalManagement = management;
    let autoAssigned = false;

    if (!management) {
      // Sin fila en lead_management — crear con asignación automática
      const [created] = await db
        .insert(schema.leadManagement)
        .values({
          leadId: id,
          commercialStatus: 'NEW',
          assignedToAuthUserId: session.userId,
          updatedByAuthUserId: session.userId,
        })
        .returning();
      finalManagement = created;
      autoAssigned = true;
    } else if (!management.assignedToAuthUserId) {
      // Fila existente sin asignación — asignar sin tocar commercial_status ni notas
      const [updated] = await db
        .update(schema.leadManagement)
        .set({
          assignedToAuthUserId: session.userId,
          updatedByAuthUserId: session.userId,
          updatedAt: new Date(),
        })
        .where(eq(schema.leadManagement.leadId, id))
        .returning();
      finalManagement = updated;
      autoAssigned = true;
    }

    // Descifrar PII — auditado
    let pii: Record<string, string> = {
      firstName: '[Corrupto]',
      lastName: '[Corrupto]',
      email: '[Corrupto]',
      phone: '[Corrupto]',
      birthdate: '[Corrupto]',
    };
    try {
      pii = {
        firstName: decryptPII(lead.firstNameEnc),
        lastName:  decryptPII(lead.lastNameEnc),
        email:     decryptPII(lead.emailEnc),
        phone:     decryptPII(lead.phoneEnc),
        birthdate: lead.birthdateEnc ? decryptPII(lead.birthdateEnc) : '',
      };
    } catch (e) {
      logError('/api/admin/leads/[id]', 'decrypt_pii', e);
      // Fallback a strings estáticos, no fallar la petición completa 
      // para permitir ver el resto de la data del lead en el admin.
    }

    // Registrar acceso (append-only, no bloquea)
    await writeRequiredAuditLog({
      session,
      action: 'LEAD_DETAIL_VIEWED',
      targetType: 'lead',
      targetId: id,
      safeMetadata: { publicReference: lead.publicReference, autoAssigned },
    });

    return NextResponse.json({
      id: lead.id,
      publicReference: lead.publicReference,
      status: lead.status,
      stateCode: lead.stateCode,
      planCode: lead.planCode,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      // PII descifrada
      pii,
      // Datos relacionados
      attribution: attribution ?? null,
      consent: consent ?? null,
      management: finalManagement ?? null,
    });

  } catch (err: unknown) {
    const error = err as Error;
    logError('/api/admin/leads/[id]', 'handler', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
