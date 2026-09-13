/**
 * GET /api/admin/dashboard/summary — Resumen de la operación de portabilidad
 *
 * Alimenta `/admin/dashboard` (diseño "Resumen"). Requiere: dashboard.view
 * Todo sale de tablas reales (app.leads, app.analytics_events, app.lead_attribution,
 * app.lead_management, app.delivery_outbox). Timezone de negocio: America/Mexico_City.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { sql } from 'drizzle-orm';
import { BUSINESS_TIMEZONE } from '@/db/index';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = BUSINESS_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;

type RangeId = 'hoy' | '7d' | '30d';

/** Inicio del día CDMX (UTC-6, sin DST) que contiene `d`. */
function startOfDayMx(d: Date): Date {
  const shifted = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + 6 * 60 * 60 * 1000);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminSession('dashboard.view');
  } catch (res) {
    return res as NextResponse;
  }

  const now = new Date();
  const rangeParam = (req.nextUrl.searchParams.get('range') ?? '30d') as RangeId;
  const range: RangeId = ['hoy', '7d', '30d'].includes(rangeParam) ? rangeParam : '30d';
  const nDays = range === 'hoy' ? 1 : range === '7d' ? 7 : 30;

  const todayStart = startOfDayMx(now);
  const to = range === 'hoy' ? now : todayStart.getTime() + DAY_MS <= now.getTime() ? new Date(todayStart.getTime() + DAY_MS) : now;
  const from = range === 'hoy' ? todayStart : new Date(startOfDayMx(now).getTime() - (nDays - 1) * DAY_MS);
  const prevTo = from;
  const prevFrom = new Date(from.getTime() - nDays * DAY_MS);
  const spark0 = new Date(startOfDayMx(now).getTime() - 13 * DAY_MS);

  try {
    const db = getDb();

    const leadTotals = (a: Date, b: Date) => sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'duplicate')::int AS duplicate
      FROM app.leads WHERE created_at >= ${a} AND created_at < ${b}
    `;
    const eventTotals = (a: Date, b: Date) => sql`
      SELECT
        count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
        count(DISTINCT session_id) FILTER (WHERE event_name = 'form_step_1_start')::int AS form_start,
        count(DISTINCT session_id) FILTER (WHERE event_name = 'form_submitted')::int AS submitted,
        count(DISTINCT session_id) FILTER (WHERE event_name = 'lead_success')::int AS leads
      FROM app.analytics_events WHERE created_at >= ${a} AND created_at < ${b}
    `;

    const [
      leadCur, leadPrev, evCur, evPrev, wonRow,
      barRows, sparkRows, channelSessionRows, channelLeadRows,
      recentRows, deliveryRow, healthRow, outboxErrorRow,
    ] = await Promise.all([
      db.execute(leadTotals(from, to)),
      db.execute(leadTotals(prevFrom, prevTo)),
      db.execute(eventTotals(from, to)),
      db.execute(eventTotals(prevFrom, prevTo)),
      // leads marcados como ganados (CRM) en el período
      db.execute(sql`
        SELECT count(*)::int AS won
        FROM app.leads l
        JOIN app.lead_management lm ON lm.lead_id = l.id
        WHERE l.created_at >= ${from} AND l.created_at < ${to}
          AND lm.commercial_status = 'WON'
      `),
      // barras: por hora (hoy) o por día
      range === 'hoy'
        ? db.execute(sql`
            SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE ${TZ})::int AS bucket,
              count(*)::int AS leads
            FROM app.analytics_events
            WHERE event_name = 'lead_success' AND created_at >= ${from} AND created_at < ${to}
            GROUP BY 1 ORDER BY 1
          `)
        : db.execute(sql`
            SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS bucket,
              count(*)::int AS leads
            FROM app.leads
            WHERE created_at >= ${from} AND created_at < ${to}
            GROUP BY 1 ORDER BY 1
          `),
      // sparklines: últimos 14 días (leads de la tabla + sesiones/inicios de eventos)
      db.execute(sql`
        SELECT day,
          sum(leads)::int AS leads,
          sum(sessions)::int AS sessions,
          sum(form_start)::int AS form_start
        FROM (
          SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
            count(*)::int AS leads, 0 AS sessions, 0 AS form_start
          FROM app.leads WHERE created_at >= ${spark0} GROUP BY 1
          UNION ALL
          SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
            0 AS leads,
            count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
            count(DISTINCT session_id) FILTER (WHERE event_name = 'form_step_1_start')::int AS form_start
          FROM app.analytics_events WHERE created_at >= ${spark0} GROUP BY 1
        ) s
        GROUP BY day ORDER BY day
      `),
      // canales: sesiones e inicios desde eventos
      db.execute(sql`
        SELECT COALESCE(source_category::text, 'other') AS ch,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${to}
        GROUP BY 1
      `),
      // canales: leads desde lead_attribution
      db.execute(sql`
        SELECT COALESCE(la.source_category::text, 'other') AS ch, count(*)::int AS leads
        FROM app.leads l
        JOIN app.lead_attribution la ON la.lead_id = l.id
        WHERE l.created_at >= ${from} AND l.created_at < ${to}
        GROUP BY 1
      `),
      // últimos leads
      db.execute(sql`
        SELECT l.public_reference AS ref, l.created_at AS at, l.state_code AS state, l.status AS status,
          COALESCE(la.source_category::text, 'other') AS ch
        FROM app.leads l
        LEFT JOIN app.lead_attribution la ON la.lead_id = l.id
        ORDER BY l.created_at DESC LIMIT 7
      `),
      // entrega CRM (delivery_outbox)
      db.execute(sql`
        SELECT
          max(delivered_at) AS last_delivered,
          count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending,
          count(*) FILTER (WHERE status IN ('failed', 'dead'))::int AS failed
        FROM app.delivery_outbox
      `),
      // salud del tracking
      db.execute(sql`
        SELECT
          count(DISTINCT session_id)::int AS sessions,
          count(DISTINCT session_id) FILTER (WHERE utm_source IS NULL)::int AS no_utm,
          max(created_at) AS last_event
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${to} AND event_name = 'page_view'
      `),
      // outbox errors breakdown
      db.execute(sql`
        SELECT last_error_code AS code, count(*)::int AS count
        FROM app.delivery_outbox
        WHERE status = 'failed' AND updated_at >= ${from} AND updated_at < ${to}
        GROUP BY 1
        ORDER BY count DESC
      `),
    ]);

    const rows = (r: unknown): Record<string, unknown>[] =>
      ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];
    const one = (r: unknown) => rows(r)[0] ?? {};
    const num = (v: unknown) => Number(v) || 0;

    const lc = one(leadCur), lp = one(leadPrev), ec = one(evCur), ep = one(evPrev);
    const del = one(deliveryRow), health = one(healthRow);

    const channelSessions = new Map(channelSessionRows && rows(channelSessionRows).map((r) => [String(r.ch), num(r.sessions)]));
    const channelLeads = new Map(rows(channelLeadRows).map((r) => [String(r.ch), num(r.leads)]));
    const channelIds = new Set<string>([...channelSessions.keys(), ...channelLeads.keys()]);
    const channels = [...channelIds].map((id) => ({
      id,
      sessions: channelSessions.get(id) ?? 0,
      leads: channelLeads.get(id) ?? 0,
    }));

    return NextResponse.json({
      range,
      period: { from: from.toISOString(), to: to.toISOString() },
      updatedAt: now.toISOString(),
      kpis: {
        leads: { cur: num(lc.total), prev: num(lp.total) },
        sessions: { cur: num(ec.sessions), prev: num(ep.sessions) },
        formStart: { cur: num(ec.form_start), prev: num(ep.form_start) },
        submitted: { cur: num(ec.submitted), prev: num(ep.submitted) },
        validated: { cur: num(lc.delivered), prev: num(lp.delivered) },
        won: { cur: num(one(wonRow).won) },
        failed: { cur: num(lc.failed) },
        duplicate: { cur: num(lc.duplicate) },
      },
      bars: rows(barRows).map((r) => ({ bucket: String(r.bucket), leads: num(r.leads) })),
      spark: rows(sparkRows).map((r) => ({
        day: String(r.day), leads: num(r.leads), sessions: num(r.sessions), formStart: num(r.form_start),
      })),
      channels,
      recent: rows(recentRows).map((r) => ({
        ref: String(r.ref),
        at: new Date(r.at as string).toISOString(),
        channel: String(r.ch),
        state: String(r.state),
        status: String(r.status),
      })),
      health: {
        sessions: num(health.sessions),
        noUtm: num(health.no_utm),
        lastEventAt: health.last_event ? new Date(health.last_event as string).toISOString() : null,
      },
      delivery: {
        lastDeliveredAt: del.last_delivered ? new Date(del.last_delivered as string).toISOString() : null,
        pending: num(del.pending),
        failed: num(del.failed),
        errorsBreakdown: rows(outboxErrorRow).map((r) => ({
          code: String(r.code || 'Desconocido'),
          count: num(r.count),
        })),
      },
      integrations: { googleAds: false, metaAds: false },
    });
  } catch (err) {
    logError('/api/admin/dashboard/summary', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
