/**
 * GET /api/admin/analytics/funnel — Datos de embudo de conversión
 *
 * Requiere: analytics.view permission
 * Basado en app.analytics_events — primero-party analytics server-side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { sql, and, gte, lt } from 'drizzle-orm';
import { BUSINESS_TIMEZONE } from '@/db/index';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('analytics.view');
  } catch (res) {
    return res as NextResponse;
  }
  void session;

  const url = req.nextUrl;
  const now = new Date();
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  
  const from = dateFrom 
    ? new Date(`${dateFrom}T00:00:00.000-06:00`) 
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
  const to = dateTo 
    ? new Date(new Date(`${dateTo}T00:00:00.000-06:00`).getTime() + 24 * 60 * 60 * 1000)
    : now;

  try {
    const db = getDb();
    const period = and(
      gte(schema.analyticsEvents.createdAt, from),
      lt(schema.analyticsEvents.createdAt, to),
    );

    const [funnelResult, deviceResult, heatmapResult] = await Promise.all([
      // Funnel: conteo por evento
      db
        .select({
          eventName: schema.analyticsEvents.eventName,
          count: sql<number>`count(*)::int`,
          uniqueSessions: sql<number>`count(distinct ${schema.analyticsEvents.sessionId})::int`,
        })
        .from(schema.analyticsEvents)
        .where(period)
        .groupBy(schema.analyticsEvents.eventName)
        .orderBy(sql`count(*) desc`),

      // Por dispositivo
      db
        .select({
          deviceCategory: schema.analyticsEvents.deviceCategory,
          count: sql<number>`count(distinct ${schema.analyticsEvents.sessionId})::int`,
        })
        .from(schema.analyticsEvents)
        .where(period)
        .groupBy(schema.analyticsEvents.deviceCategory),

      // Heatmap hora x día-semana en CDMX
      db.execute(
        sql`
          SELECT
            EXTRACT(DOW FROM ${schema.analyticsEvents.createdAt} AT TIME ZONE ${BUSINESS_TIMEZONE})::int AS dow,
            EXTRACT(HOUR FROM ${schema.analyticsEvents.createdAt} AT TIME ZONE ${BUSINESS_TIMEZONE})::int AS hour,
            count(*)::int AS count
          FROM app.analytics_events
          WHERE ${schema.analyticsEvents.createdAt} >= ${from}
            AND ${schema.analyticsEvents.createdAt} < ${to}
          GROUP BY 1, 2
          ORDER BY 1, 2
        `
      ),
    ]);

    // Extraer eventos clave para el funnel visual
    const eventOrder = [
      'page_view',
      'form_step_1_start',
      'form_step_2_start',
      'form_step_3_start',
      'form_submitted',
      'lead_success',
    ];

    const funnelMap = new Map(funnelResult.map(r => [r.eventName, r]));
    const funnelOrdered = eventOrder.map(name => ({
      eventName: name,
      count: funnelMap.get(name)?.count ?? 0,
      uniqueSessions: funnelMap.get(name)?.uniqueSessions ?? 0,
    }));

    return NextResponse.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      funnel: funnelOrdered,
      allEvents: funnelResult,
      devices: deviceResult,
      heatmap: heatmapResult.rows ?? heatmapResult,
    });

  } catch (err) {
    logError('/api/admin/analytics/funnel', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
