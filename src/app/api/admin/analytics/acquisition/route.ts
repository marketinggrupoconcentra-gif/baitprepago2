/**
 * GET /api/admin/analytics/acquisition — Analítica de adquisición
 *
 * Alimenta la vista `/admin/analytics` (diseño "Analítica de adquisición").
 * Requiere: analytics.view
 *
 * Todo sale de tablas reales (app.analytics_events, app.leads,
 * app.lead_attribution, app.delivery_outbox). Lo que NO se puede calcular desde
 * la landing (inversión, CPC, CPL, impresiones, Search Console, jerarquía de
 * grupos/anuncios) NO se estima: el cliente muestra estados "no conectado".
 *
 * Timezone de negocio: America/Mexico_City.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { sql, sum, and, gte, lte } from 'drizzle-orm';
import { BUSINESS_TIMEZONE } from '@/db/index';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = BUSINESS_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;

const SOURCE_CATEGORIES = [
  'google_ads',
  'meta_ads',
  'paid_other',
  'organic',
  'referral',
  'direct',
  'other',
] as const;

const GRANULARITIES = { hora: 'hour', dia: 'day', semana: 'week' } as const;
type GranId = keyof typeof GRANULARITIES;

// Etapas del embudo → nombre de evento en app.analytics_events
const FUNNEL_STAGES = [
  { key: 'sessions', event: 'page_view' },
  { key: 'formStart', event: 'form_step_1_start' },
  { key: 'step2', event: 'form_step_2_start' },
  { key: 'step3', event: 'form_step_3_start' },
  { key: 'submitted', event: 'form_submitted' },
  { key: 'lead', event: 'lead_success' },
] as const;

function parseDay(value: string | null, fallback: Date): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00.000-06:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

/** Cuenta de sesiones distintas por evento, en un rango, opcionalmente por canal. */
function eventCountsSql(from: Date, to: Date, channel: string | null) {
  const chFilter = channel
    ? sql`AND source_category = ${channel}`
    : sql``;
  return sql`
    SELECT
      COALESCE(source_category::text, 'other') AS ch,
      ${sql.join(
        FUNNEL_STAGES.map(
          (s) =>
            sql`count(DISTINCT session_id) FILTER (WHERE event_name = ${s.event})::int AS ${sql.raw(`"${s.key}"`)}`,
        ),
        sql`, `,
      )}
    FROM app.analytics_events
    WHERE created_at >= ${from} AND created_at < ${to} ${chFilter}
    GROUP BY 1
  `;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminSession('analytics.view');
  } catch (res) {
    return res as NextResponse;
  }

  const url = req.nextUrl;
  const now = new Date();
  const to = parseDay(url.searchParams.get('dateTo'), now);
  // el "to" que llega es el inicio del último día → sumar 1 día para incluirlo
  const toExclusive =
    url.searchParams.get('dateTo') && !Number.isNaN(to.getTime())
      ? new Date(to.getTime() + DAY_MS)
      : now;
  const from = parseDay(
    url.searchParams.get('dateFrom'),
    new Date(now.getTime() - 30 * DAY_MS),
  );

  const spanMs = Math.max(DAY_MS, toExclusive.getTime() - from.getTime());
  const compareMode = url.searchParams.get('compare') ?? 'prev';
  let prevFrom: Date | null = null;
  let prevTo: Date | null = null;
  if (compareMode === 'prev') {
    prevTo = from;
    prevFrom = new Date(from.getTime() - spanMs);
  } else if (compareMode === 'month') {
    prevTo = new Date(from.getTime() - 30 * DAY_MS + spanMs);
    prevFrom = new Date(from.getTime() - 30 * DAY_MS);
  }

  const channelParam = url.searchParams.get('channel');
  const channel = SOURCE_CATEGORIES.includes(channelParam as never)
    ? (channelParam as string)
    : null;

  const granParam = (url.searchParams.get('granularity') ?? 'dia') as GranId;
  const gran: GranId = granParam in GRANULARITIES ? granParam : 'dia';
  const trunc = GRANULARITIES[gran];

  const chFilter = channel ? sql`AND source_category = ${channel}` : sql``;
  const leadChFilter = channel
    ? sql`AND COALESCE(la.source_category::text, 'other') = ${channel}`
    : sql``;

  try {
    const db = getDb();

    const [
      totalsCur,
      totalsPrev,
      leadsByChannel,
      leadsByChannelPrev,
      trendRows,
      trendPrevRows,
      sparkRows,
      heatRows,
      landingRow,
      sectionRows,
      geoRows,
      deliveryRow,
      healthRow,
      lastEventRow,
      campaignEventRows,
      campaignLeadRows,
      funnelGroupRows,
      utmRows,
      sourceMediumRows,
      deviceRows,
    ] = await Promise.all([
      // 1 — totales por canal (sesiones / etapas) período actual
      db.execute(eventCountsSql(from, toExclusive, channel)),
      // 2 — totales por canal período anterior
      prevFrom && prevTo
        ? db.execute(eventCountsSql(prevFrom, prevTo, channel))
        : Promise.resolve({ rows: [] as unknown[] }),
      // 3 — leads por canal (autoritativo: leads ⨝ lead_attribution)
      db.execute(sql`
        SELECT COALESCE(la.source_category::text, 'other') AS ch, count(*)::int AS leads
        FROM app.leads l
        JOIN app.lead_attribution la ON la.lead_id = l.id
        WHERE l.created_at >= ${from} AND l.created_at < ${toExclusive} ${leadChFilter}
        GROUP BY 1
      `),
      // 4 — leads por canal período anterior
      prevFrom && prevTo
        ? db.execute(sql`
            SELECT COALESCE(la.source_category::text, 'other') AS ch, count(*)::int AS leads
            FROM app.leads l
            JOIN app.lead_attribution la ON la.lead_id = l.id
            WHERE l.created_at >= ${prevFrom} AND l.created_at < ${prevTo} ${leadChFilter}
            GROUP BY 1
          `)
        : Promise.resolve({ rows: [] as unknown[] }),
      // 5 — serie de tendencia (bucket) período actual
      db.execute(sql`
        SELECT
          to_char(date_trunc(${trunc}, created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD"T"HH24:00') AS bucket,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'form_step_1_start')::int AS form_start,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'lead_success')::int AS leads
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive} ${chFilter}
        GROUP BY 1 ORDER BY 1
      `),
      // 6 — serie de tendencia período anterior
      prevFrom && prevTo
        ? db.execute(sql`
            SELECT
              to_char(date_trunc(${trunc}, created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD"T"HH24:00') AS bucket,
              count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
              count(DISTINCT session_id) FILTER (WHERE event_name = 'form_step_1_start')::int AS form_start,
              count(DISTINCT session_id) FILTER (WHERE event_name = 'lead_success')::int AS leads
            FROM app.analytics_events
            WHERE created_at >= ${prevFrom} AND created_at < ${prevTo} ${chFilter}
            GROUP BY 1 ORDER BY 1
          `)
        : Promise.resolve({ rows: [] as unknown[] }),
      // 7 — sparklines (siempre por día) período actual
      db.execute(sql`
        SELECT
          to_char(date_trunc('day', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'form_step_1_start')::int AS form_start,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'lead_success')::int AS leads
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive} ${chFilter}
        GROUP BY 1 ORDER BY 1
      `),
      // 8 — heatmap dow × hora (CDMX)
      db.execute(sql`
        SELECT
          EXTRACT(DOW FROM created_at AT TIME ZONE ${TZ})::int AS dow,
          EXTRACT(HOUR FROM created_at AT TIME ZONE ${TZ})::int AS hour,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'lead_success')::int AS leads
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive} ${chFilter}
        GROUP BY 1, 2
      `),
      // 9 — comportamiento en la landing (scroll / CTA)
      db.execute(sql`
        SELECT
          count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
          count(DISTINCT session_id) FILTER (WHERE scroll_pct >= 50)::int AS scroll50,
          count(DISTINCT session_id) FILTER (WHERE scroll_pct >= 90)::int AS scroll90,
          count(DISTINCT session_id) FILTER (WHERE cta_id IS NOT NULL)::int AS cta,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'form_step_1_start')::int AS form_start
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive} ${chFilter}
      `),
      // 10 — secciones vistas
      db.execute(sql`
        SELECT section_id AS id, count(DISTINCT session_id)::int AS sessions
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive}
          AND section_id IS NOT NULL 
          AND event_name = 'section_view' ${chFilter}
        GROUP BY 1 ORDER BY 2 DESC
      `),
      // 11 — leads por estado
      db.execute(sql`
        SELECT state_code AS code, count(*)::int AS leads
        FROM app.leads
        WHERE created_at >= ${from} AND created_at < ${toExclusive}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12
      `),
      // 12 — entrega de leads (estado técnico)
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          count(*) FILTER (WHERE status = 'duplicate')::int AS duplicate,
          count(*) FILTER (WHERE status IN ('received', 'processing'))::int AS pending,
          count(*)::int AS total
        FROM app.leads
        WHERE created_at >= ${from} AND created_at < ${toExclusive}
      `),
      // 13 — salud del tracking (cobertura de atribución en el período)
      db.execute(sql`
        SELECT
          count(DISTINCT session_id)::int AS sessions,
          count(DISTINCT session_id) FILTER (
            WHERE source_category IS NOT NULL AND source_category::text <> 'other'
          )::int AS attributed,
          count(DISTINCT session_id) FILTER (WHERE utm_source IS NULL)::int AS no_utm
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive}
          AND event_name = 'page_view'
      `),
      // 14 — último evento recibido (global)
      db.execute(sql`SELECT max(created_at) AS last_event FROM app.analytics_events`),
      // 15 — campañas: sesiones / inicios desde eventos
      db.execute(sql`
        SELECT
          COALESCE(utm_campaign, '(sin campaña)') AS campaign,
          COALESCE(utm_source, '—') AS source,
          COALESCE(utm_medium, '—') AS medium,
          COALESCE(source_category::text, 'other') AS ch,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'form_step_1_start')::int AS form_start
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive} ${chFilter}
        GROUP BY 1, 2, 3, 4
        HAVING count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view') > 0
        ORDER BY 5 DESC LIMIT 60
      `),
      // 16 — campañas: leads desde lead_attribution
      db.execute(sql`
        SELECT COALESCE(la.first_utm_campaign, '(sin campaña)') AS campaign, count(*)::int AS leads
        FROM app.leads l
        JOIN app.lead_attribution la ON la.lead_id = l.id
        WHERE l.created_at >= ${from} AND l.created_at < ${toExclusive} ${leadChFilter}
        GROUP BY 1
      `),
      // 17 — embudo por grupo de canal (Google Ads / Meta Ads / Orgánico / Directo)
      db.execute(sql`
        SELECT
          CASE
            WHEN source_category = 'google_ads' THEN 'google'
            WHEN source_category = 'meta_ads' THEN 'meta'
            WHEN source_category IN ('organic', 'referral') THEN 'organic'
            WHEN source_category = 'direct' THEN 'direct'
            ELSE 'other'
          END AS grp,
          ${sql.join(
            FUNNEL_STAGES.map(
              (s) =>
                sql`count(DISTINCT session_id) FILTER (WHERE event_name = ${s.event})::int AS ${sql.raw(`"${s.key}"`)}`,
            ),
            sql`, `,
          )}
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive} ${chFilter}
        GROUP BY 1
      `),
      // 18 — atribución UTM: desglose por cada dimensión utm_*
      db.execute(sql`
        SELECT d.dim,
          COALESCE(NULLIF(d.val, ''), '(sin valor)') AS val,
          count(DISTINCT e.session_id) FILTER (WHERE e.event_name = 'page_view')::int AS sessions,
          count(DISTINCT e.session_id) FILTER (WHERE e.event_name = 'lead_success')::int AS leads
        FROM app.analytics_events e
        CROSS JOIN LATERAL (VALUES
          ('utm_source', e.utm_source),
          ('utm_medium', e.utm_medium),
          ('utm_campaign', e.utm_campaign),
          ('utm_content', e.utm_content),
          ('utm_term', e.utm_term)
        ) AS d(dim, val)
        WHERE e.created_at >= ${from} AND e.created_at < ${toExclusive} ${chFilter}
        GROUP BY 1, 2
      `),
      // 19 — matriz fuente / medio
      db.execute(sql`
        SELECT
          COALESCE(NULLIF(utm_source, ''), source_category::text, '(direct)') AS source,
          COALESCE(NULLIF(utm_medium, ''), '(none)') AS medium,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'lead_success')::int AS leads
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive} ${chFilter}
        GROUP BY 1, 2
        HAVING count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view') > 0
        ORDER BY 3 DESC LIMIT 14
      `),
      // 20 — rendimiento por dispositivo
      db.execute(sql`
        SELECT
          COALESCE(NULLIF(device_category, ''), 'desconocido') AS device,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'page_view')::int AS sessions,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'form_step_1_start')::int AS form_start,
          count(DISTINCT session_id) FILTER (WHERE event_name = 'lead_success')::int AS leads
        FROM app.analytics_events
        WHERE created_at >= ${from} AND created_at < ${toExclusive} ${chFilter}
        GROUP BY 1
      `),
    ]);

    const rows = (r: unknown): Record<string, unknown>[] =>
      ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<
        string,
        unknown
      >[];

    // ── Google Ads ──────────────────────────────────────────────────────
    const adsFilter = [
      gte(schema.adsMetrics.date, from.toISOString().split('T')[0]),
      lte(schema.adsMetrics.date, toExclusive.toISOString().split('T')[0]),
    ];
    
    const [googleAdsStats] = await db
      .select({
        impressions: sum(schema.adsMetrics.impressions),
        clicks: sum(schema.adsMetrics.clicks),
        costMicros: sum(schema.adsMetrics.costMicros),
        conversions: sum(schema.adsMetrics.conversions),
      })
      .from(schema.adsMetrics)
      .where(and(...adsFilter));

    // Desglose por campaña
    const googleAdsCampaigns = await db
      .select({
        id: schema.adsMetrics.campaignId,
        name: schema.adsMetrics.campaignName,
        impressions: sum(schema.adsMetrics.impressions),
        clicks: sum(schema.adsMetrics.clicks),
        costMicros: sum(schema.adsMetrics.costMicros),
        conversions: sum(schema.adsMetrics.conversions),
      })
      .from(schema.adsMetrics)
      .where(and(...adsFilter))
      .groupBy(schema.adsMetrics.campaignId, schema.adsMetrics.campaignName);

    const hasGoogleAds = googleAdsStats && googleAdsStats.impressions !== null;

    // ── Ensamblado de canales ────────────────────────────────────────────────
    const leadMap = new Map(
      rows(leadsByChannel).map((r) => [String(r.ch), Number(r.leads)]),
    );
    const leadMapPrev = new Map(
      rows(leadsByChannelPrev).map((r) => [String(r.ch), Number(r.leads)]),
    );
    const evMapPrev = new Map(
      rows(totalsPrev).map((r) => [String(r.ch), r]),
    );

    const channels = rows(totalsCur).map((r) => {
      const ch = String(r.ch);
      const prev = evMapPrev.get(ch) as Record<string, unknown> | undefined;
      return {
        id: ch,
        sessions: Number(r.sessions) || 0,
        formStart: Number(r.formStart) || 0,
        step2: Number(r.step2) || 0,
        step3: Number(r.step3) || 0,
        submitted: Number(r.submitted) || 0,
        leads: leadMap.get(ch) ?? 0,
        prev: {
          sessions: Number(prev?.sessions) || 0,
          formStart: Number(prev?.formStart) || 0,
          leads: leadMapPrev.get(ch) ?? 0,
        },
      };
    });
    // canales que solo tienen leads (sin eventos)
    for (const [ch, leads] of leadMap) {
      if (!channels.some((c) => c.id === ch)) {
        channels.push({
          id: ch,
          sessions: 0,
          formStart: 0,
          step2: 0,
          step3: 0,
          submitted: 0,
          leads,
          prev: { sessions: 0, formStart: 0, leads: leadMapPrev.get(ch) ?? 0 },
        });
      }
    }

    // ── Embudo global (para el rango + filtro de canal aplicados) ────────────
    const funnelTotals = FUNNEL_STAGES.reduce<Record<string, number>>((acc, s) => {
      acc[s.key] = channels.reduce((sum, c) => {
        const map: Record<string, number> = {
          sessions: c.sessions,
          formStart: c.formStart,
          step2: c.step2,
          step3: c.step3,
          submitted: c.submitted,
          lead: c.leads,
        };
        return sum + (map[s.key] ?? 0);
      }, 0);
      return acc;
    }, {});
    // OJO: sumar sesiones distintas por canal sobreestima si una sesión cambió de
    // fuente. Es aceptable para la vista; el total autoritativo de sesiones sale
    // de healthRow.sessions.
    const healthData = rows(healthRow)[0] ?? {};
    funnelTotals.sessions = Number(healthData.sessions) || funnelTotals.sessions;

    const parseStages = (r: Record<string, unknown>) =>
      Object.fromEntries(
        FUNNEL_STAGES.map((s) => [s.key, Number(r[s.key]) || 0]),
      );

    const funnelByGroup = rows(funnelGroupRows)
      .filter((r) => r.grp !== 'other')
      .map((r) => ({ group: String(r.grp), ...parseStages(r) }));

    // ── Campañas: merge eventos + leads ─────────────────────────────────────
    const campLeads = new Map(
      rows(campaignLeadRows).map((r) => [String(r.campaign), Number(r.leads)]),
    );
    const campaigns = rows(campaignEventRows).map((r) => ({
      campaign: String(r.campaign),
      source: String(r.source),
      medium: String(r.medium),
      channel: String(r.ch),
      sessions: Number(r.sessions) || 0,
      formStart: Number(r.form_start) || 0,
      leads: campLeads.get(String(r.campaign)) ?? 0,
    }));

    const spark = rows(sparkRows);
    const delivery = rows(deliveryRow)[0] ?? {};
    const landing = rows(landingRow)[0] ?? {};
    const lastEvent = rows(lastEventRow)[0]?.last_event ?? null;

    return NextResponse.json({
      range: { from: from.toISOString(), to: toExclusive.toISOString() },
      compare:
        prevFrom && prevTo
          ? { mode: compareMode, from: prevFrom.toISOString(), to: prevTo.toISOString() }
          : { mode: 'none' },
      granularity: gran,
      channelFilter: channel,
      channels,
      funnel: {
        totals: funnelTotals,
        byGroup: funnelByGroup,
      },
      trend: rows(trendRows).map((r) => ({
        bucket: String(r.bucket),
        sessions: Number(r.sessions) || 0,
        formStart: Number(r.form_start) || 0,
        leads: Number(r.leads) || 0,
      })),
      trendCompare: rows(trendPrevRows).map((r) => ({
        bucket: String(r.bucket),
        sessions: Number(r.sessions) || 0,
        formStart: Number(r.form_start) || 0,
        leads: Number(r.leads) || 0,
      })),
      spark: {
        sessions: spark.map((r) => Number(r.sessions) || 0),
        formStart: spark.map((r) => Number(r.form_start) || 0),
        leads: spark.map((r) => Number(r.leads) || 0),
      },
      heatmap: rows(heatRows).map((r) => ({
        dow: Number(r.dow),
        hour: Number(r.hour),
        sessions: Number(r.sessions) || 0,
        leads: Number(r.leads) || 0,
      })),
      landing: {
        sessions: Number(landing.sessions) || 0,
        scroll50: Number(landing.scroll50) || 0,
        scroll90: Number(landing.scroll90) || 0,
        cta: Number(landing.cta) || 0,
        formStart: Number(landing.form_start) || 0,
        sections: rows(sectionRows).map((r) => ({
          id: String(r.id),
          sessions: Number(r.sessions) || 0,
        })),
      },
      geo: rows(geoRows).map((r) => ({
        code: String(r.code),
        leads: Number(r.leads) || 0,
      })),
      delivery: {
        delivered: Number(delivery.delivered) || 0,
        failed: Number(delivery.failed) || 0,
        duplicate: Number(delivery.duplicate) || 0,
        pending: Number(delivery.pending) || 0,
        total: Number(delivery.total) || 0,
      },
      health: {
        sessions: Number(healthData.sessions) || 0,
        attributed: Number(healthData.attributed) || 0,
        noUtm: Number(healthData.no_utm) || 0,
        lastEventAt: lastEvent ? new Date(lastEvent as string).toISOString() : null,
      },
      campaigns,
      utm: rows(utmRows).map((r) => ({
        dim: String(r.dim),
        val: String(r.val),
        sessions: Number(r.sessions) || 0,
        leads: Number(r.leads) || 0,
      })),
      sourceMedium: rows(sourceMediumRows).map((r) => ({
        source: String(r.source),
        medium: String(r.medium),
        sessions: Number(r.sessions) || 0,
        leads: Number(r.leads) || 0,
      })),
      devices: rows(deviceRows).map((r) => ({
        device: String(r.device),
        sessions: Number(r.sessions) || 0,
        formStart: Number(r.form_start) || 0,
        leads: Number(r.leads) || 0,
      })),
      integrations: {
        googleAds: hasGoogleAds ? {
          connected: true,
          impressions: Number(googleAdsStats.impressions || 0),
          clicks: Number(googleAdsStats.clicks || 0),
          costMicros: Number(googleAdsStats.costMicros || 0),
          conversions: Number(googleAdsStats.conversions || 0),
          campaigns: googleAdsCampaigns.map(c => ({
            id: c.id,
            name: c.name,
            impressions: Number(c.impressions || 0),
            clicks: Number(c.clicks || 0),
            costMicros: Number(c.costMicros || 0),
            conversions: Number(c.conversions || 0),
          }))
        } : false,
        metaAds: false,
        searchConsole: false,
      },
    });
  } catch (err) {
    logError('/api/admin/analytics/acquisition', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
