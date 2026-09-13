/**
 * GET  /api/admin/reports/schedules — Listar programaciones de reportes
 * POST /api/admin/reports/schedules — Crear nueva programación
 *
 * GET requiere: reports.view
 * POST requiere: reports.create
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ScheduleCreateSchema = z.object({
  name: z.string().min(1).max(100),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  timezone: z.string().default('America/Mexico_City'),
  localHour: z.number().int().min(0).max(23),
  localMinute: z.number().int().refine(m => [0, 15, 30, 45].includes(m), 'Minuto inválido (solo 0, 15, 30, 45)').default(0),
  dayOfWeek: z.number().int().min(0).max(6).optional(),    // 0=Lunes
  dayOfMonth: z.number().int().min(1).max(28).optional(),  // 1-28
  recipients: z.array(z.string().regex(EMAIL_RE)).min(1).max(20),
  includeCsv: z.boolean().default(false),
  includeSensitiveFields: z.boolean().default(false),
});

export async function GET(_: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('reports.view');
  } catch (res) {
    return res as NextResponse;
  }
  void session;

  try {
    const db = getDb();
    const schedules = await db
      .select()
      .from(schema.reportSchedules)
      .orderBy(desc(schema.reportSchedules.createdAt));

    // Ocultar recipients completos — solo mostrar conteo y dominios
    const masked = schedules.map(s => {
      const recipients = JSON.parse(s.recipients) as string[];
      return {
        ...s,
        recipientCount: recipients.length,
        recipientDomains: [...new Set(recipients.map(e => e.split('@')[1]))].slice(0, 3),
        recipients: undefined, // NO exponer lista completa por defecto
      };
    });

    return NextResponse.json({ data: masked });
  } catch (err) {
    logError('/api/admin/reports/schedules', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('reports.create');
  } catch (res) {
    return res as NextResponse;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const parsed = ScheduleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const data = parsed.data;

  // Validar campos específicos por frecuencia
  if (data.frequency === 'WEEKLY' && data.dayOfWeek === undefined) {
    return NextResponse.json({ error: 'dayOfWeek requerido para WEEKLY' }, { status: 400 });
  }
  if (data.frequency === 'MONTHLY' && data.dayOfMonth === undefined) {
    return NextResponse.json({ error: 'dayOfMonth requerido para MONTHLY' }, { status: 400 });
  }

  // Solo Administrador puede crear reportes con datos sensibles
  if (data.includeSensitiveFields && session.role !== 'Administrador') {
    return NextResponse.json(
      { error: 'Solo Administrador puede configurar reportes con datos sensibles' },
      { status: 403 },
    );
  }

  try {
    const db = getDb();
    const [schedule] = await db
      .insert(schema.reportSchedules)
      .values({
        name: data.name,
        frequency: data.frequency,
        timezone: data.timezone,
        localHour: data.localHour,
        localMinute: data.localMinute,
        dayOfWeek: data.dayOfWeek ?? null,
        dayOfMonth: data.dayOfMonth ?? null,
        recipients: JSON.stringify(data.recipients),
        includeCsv: data.includeCsv,
        includeSensitiveFields: data.includeSensitiveFields,
        isActive: true,
        createdByAuthUserId: session.userId,
      })
      .returning({ id: schema.reportSchedules.id });

    await writeAuditLog({
      session,
      action: 'REPORT_CREATED',
      targetType: 'report_schedule',
      targetId: schedule.id,
      safeMetadata: {
        frequency: data.frequency,
        recipientCount: data.recipients.length,
        includeCsv: data.includeCsv,
      },
    });

    return NextResponse.json({ ok: true, id: schedule.id }, { status: 201 });

  } catch (err) {
    logError('/api/admin/reports/schedules', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
