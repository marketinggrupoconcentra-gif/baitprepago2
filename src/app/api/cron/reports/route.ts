/**
 * GET /api/cron/reports — Cron de reportes periódicos
 *
 * Invocado por Vercel Cron (ver vercel.json).
 * Ejecuta a las 09:00 UTC = 03:00 CDMX (para reportes de fin de día anterior).
 *
 * Lógica:
 * 1. Obtener todos los schedules activos
 * 2. Para cada schedule, verificar si toca enviar hoy/esta semana/este mes
 * 3. Verificar idempotencia via run_key
 * 4. Calcular período del reporte
 * 5. Obtener datos reales de analytics
 * 6. Enviar email via Resend
 * 7. Marcar run como SENT (o FAILED)
 *
 * SEGURIDAD: Requiere CRON_SECRET header.
 * IDEMPOTENCIA: run_key = '{scheduleId}:{YYYY-MM-DD}' — no re-envía si ya existe.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { eq, and, gte, lt, sql } from 'drizzle-orm';
import { BUSINESS_TIMEZONE } from '@/db/index';
import { buildReportHtml, buildReportText } from '@/lib/email/report-template';
import { Resend } from 'resend';
import { logError, logInfo } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type ReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

function shouldRunToday(
  schedule: { frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null },
  nowCDMX: Date,
): boolean {
  const dayOfWeek = nowCDMX.getDay(); // 0=Domingo..6=Sábado  
  // Convertir a 0=Lunes..6=Domingo
  const dayOfWeekMx = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const dayOfMonth = nowCDMX.getDate();

  switch (schedule.frequency) {
    case 'DAILY': return true;
    case 'WEEKLY': return schedule.dayOfWeek === dayOfWeekMx;
    case 'MONTHLY': return schedule.dayOfMonth === dayOfMonth;
    default: return false;
  }
}

function getPeriodBounds(
  frequency: ReportFrequency,
  nowCDMX: Date,
): { periodStart: Date; periodEnd: Date; periodLabel: string } {
  const y = nowCDMX.getFullYear();
  const m = nowCDMX.getMonth();
  const d = nowCDMX.getDate();

  let periodStart: Date;
  let periodEnd: Date;
  let periodLabel: string;

  const fmt = (dt: Date) => dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' });

  if (frequency === 'DAILY') {
    // Ayer CDMX (00:00 - 00:00 del día siguiente, exclusivo)
    periodStart = new Date(Date.UTC(y, m, d - 1, 6, 0, 0));
    periodEnd   = new Date(Date.UTC(y, m, d,     6, 0, 0));
    periodLabel = fmt(new Date(y, m, d - 1));
  } else if (frequency === 'WEEKLY') {
    // Semana anterior Lunes-Domingo CDMX
    const dayOfWeekMx = nowCDMX.getDay() === 0 ? 6 : nowCDMX.getDay() - 1;
    const daysBack = dayOfWeekMx + 7;
    const mondayOffset = d - daysBack;
    periodStart = new Date(Date.UTC(y, m, mondayOffset, 6, 0, 0));
    periodEnd   = new Date(Date.UTC(y, m, mondayOffset + 7, 6, 0, 0));
    periodLabel = `${fmt(new Date(y, m, mondayOffset))} — ${fmt(new Date(y, m, mondayOffset + 6))}`;
  } else {
    // Mes anterior
    const prevMonth = m === 0 ? 11 : m - 1;
    const prevYear = m === 0 ? y - 1 : y;
    periodStart = new Date(Date.UTC(prevYear, prevMonth, 1, 6, 0, 0));
    periodEnd   = new Date(Date.UTC(prevYear, prevMonth + 1, 1, 6, 0, 0));
    periodLabel = new Date(prevYear, prevMonth, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }

  return { periodStart, periodEnd, periodLabel };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── FLW-005: cron fail-closed ──────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logError('/api/cron/reports', 'config', new Error('CRON_SECRET missing'));
    return NextResponse.json({ error: 'Configuración incompleta.' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { getSetting } = await import('@/lib/settings');
  const resendApiKey = await getSetting('resend_api_key', process.env.RESEND_API_KEY);
  
  if (!resendApiKey) {
    logInfo('/api/cron/reports', 'skip', { reason: 'RESEND_NOT_CONFIGURED' });
    return NextResponse.json({ ok: true, skipped: true, reason: 'RESEND_NOT_CONFIGURED' });
  }

  const db = getDb();
  const resend = new Resend(resendApiKey);

  // Obtener hora actual en CDMX (UTC - 6 fijo)
  const nowUtc = new Date();
  const nowCDMX = new Date(nowUtc.getTime() - 6 * 60 * 60 * 1000);
  const todayKey = nowCDMX.toISOString().slice(0, 10); // YYYY-MM-DD is correct since we shifted by 6 hours

  // Obtener schedules activos
  const schedules = await db
    .select()
    .from(schema.reportSchedules)
    .where(eq(schema.reportSchedules.isActive, true));

  const results: Array<{ scheduleId: string; status: string; reason?: string }> = [];

  for (const schedule of schedules) {
    const runKey = `${schedule.id}:${todayKey}`;

    // FLW-010: Reject sensitive fields unequivocally in scheduled reports
    if (schedule.includeSensitiveFields) {
      logError('/api/cron/reports', 'security', new Error('Sensitive fields strictly forbidden in scheduled reports'), { scheduleId: schedule.id });
      results.push({ scheduleId: schedule.id, status: 'SKIPPED_SENSITIVE_REJECTED' });
      continue;
    }

    // Verificar si toca hoy
    if (!shouldRunToday(schedule as { frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null }, nowCDMX)) {
      results.push({ scheduleId: schedule.id, status: 'SKIPPED_NOT_TODAY' });
      continue;
    }

    const { periodStart, periodEnd, periodLabel } = getPeriodBounds(schedule.frequency as ReportFrequency, nowCDMX);

    // FLW-010: Idempotency Claim
    // Insert atomic lock
    let runId: string | null = null;
    
    const [inserted] = await db
      .insert(schema.reportRuns)
      .values({
        scheduleId: schedule.id,
        runKey,
        periodStart,
        periodEnd,
        status: 'RUNNING',
        startedAt: new Date(),
        attemptCount: 1,
      })
      .onConflictDoNothing({ target: schema.reportRuns.runKey })
      .returning({ id: schema.reportRuns.id });
      
    if (inserted) {
      runId = inserted.id;
    } else {
      // It exists. Check if we can retry a failure.
      const [existing] = await db
        .select({ id: schema.reportRuns.id, status: schema.reportRuns.status, attemptCount: schema.reportRuns.attemptCount })
        .from(schema.reportRuns)
        .where(eq(schema.reportRuns.runKey, runKey))
        .limit(1);
        
      if (!existing || existing.status === 'SENT' || existing.status === 'RUNNING') {
        results.push({ scheduleId: schedule.id, status: 'SKIPPED_DUPLICATE' });
        continue;
      }
      if (existing.status === 'FAILED' && existing.attemptCount >= 3) {
        results.push({ scheduleId: schedule.id, status: 'SKIPPED_MAX_ATTEMPTS' });
        continue;
      }
      
      // Try to claim the FAILED run atomically
      const [updated] = await db
        .update(schema.reportRuns)
        .set({
          status: 'RUNNING',
          startedAt: new Date(),
          attemptCount: sql`${schema.reportRuns.attemptCount} + 1`,
        })
        .where(
          and(
            eq(schema.reportRuns.id, existing.id),
            eq(schema.reportRuns.status, 'FAILED'),
            lt(schema.reportRuns.attemptCount, 3)
          )
        )
        .returning({ id: schema.reportRuns.id });
        
      if (!updated) {
        results.push({ scheduleId: schedule.id, status: 'SKIPPED_DUPLICATE' });
        continue;
      }
      runId = updated.id;
    }

    try {
      // Obtener datos del período usando LT para exclusive end (FLW-009)
      const period = and(gte(schema.leads.createdAt, periodStart), lt(schema.leads.createdAt, periodEnd));

      const [totals, byCommercial, bySource] = await Promise.all([
        db.select({ total: sql<number>`count(*)::int` }).from(schema.leads).where(period),
        db.select({
          status: schema.leadManagement.commercialStatus,
          count: sql<number>`count(*)::int`,
        }).from(schema.leads)
          .innerJoin(schema.leadManagement, eq(schema.leads.id, schema.leadManagement.leadId))
          .where(period).groupBy(schema.leadManagement.commercialStatus).orderBy(sql`count(*) desc`),
        db.select({
          sourceCategory: schema.leadAttribution.sourceCategory,
          count: sql<number>`count(*)::int`,
        }).from(schema.leads)
          .innerJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
          .where(period).groupBy(schema.leadAttribution.sourceCategory),
      ]);

      const t = totals[0];
      const freqLabel = { DAILY: 'Diario', WEEKLY: 'Semanal', MONTHLY: 'Mensual' }[schedule.frequency] ?? '';

      const reportData = {
        periodLabel,
        frequency: freqLabel,
        totalLeads: t?.total ?? 0,
        bySource,
        byCommercial,
        generatedAt: nowCDMX.toLocaleString('es-MX', { timeZone: BUSINESS_TIMEZONE }),
      };

      const recipients = JSON.parse(schedule.recipients) as string[];
      const subject = `[BAIT Prepago] Reporte ${freqLabel} — ${periodLabel}`;

      const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'reportes@baitprepago.com';

      // Extraer datos detallados para CSV
      let attachments = undefined;
      if (schedule.includeCsv) {
        const rawLeads = await db.select().from(schema.leads)
          .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
          .where(period).orderBy(schema.leads.createdAt);
        
        const { toCSVRow } = await import('@/lib/security/csv');
        
        const headers = ['ID', 'Reference', 'Status', 'SourceCategory', 'CreatedAt'];
        const rows = [toCSVRow(headers)];

        for (const { leads: l, lead_attribution: attr } of rawLeads) {
          const row = [
            l.id, l.publicReference, l.status,
            attr?.sourceCategory || '', l.createdAt.toISOString()
          ];
          rows.push(toCSVRow(row));
        }

        const csvContent = '\uFEFF' + rows.join('\n');

        attachments = [
          {
            filename: `leads_${todayKey}.csv`,
            content: Buffer.from(csvContent).toString('base64'),
          }
        ];
      }

      const { data: resendData, error: resendError } = await resend.emails.send({
        from: fromEmail,
        to: recipients,
        subject,
        html: buildReportHtml(reportData),
        text: buildReportText(reportData),
        attachments,
      });

      if (resendError) {
        throw new Error(`Resend error: ${resendError.message}`);
      }

      // Marcar como SENT
      await db.update(schema.reportRuns).set({
        status: 'SENT',
        leadCount: t?.total ?? 0,
        providerMessageId: resendData?.id ?? null,
        finishedAt: new Date(),
      }).where(eq(schema.reportRuns.id, runId!));

      results.push({ scheduleId: schedule.id, status: 'SENT' });

    } catch (err) {
      const errorCode = (err as Error).message.slice(0, 100).replace(/[^a-z0-9_:. -]/gi, '');
      await db.update(schema.reportRuns).set({
        status: 'FAILED',
        errorCode,
        finishedAt: new Date(),
      }).where(eq(schema.reportRuns.id, runId!));

      logError('/api/cron/reports', 'schedule', new Error(errorCode), { scheduleId: schedule.id });
      results.push({ scheduleId: schedule.id, status: 'FAILED', reason: errorCode });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
