/**
 * GET /api/admin/marketing — Tablero de decisión de marketing y adquisición
 *
 * Alimenta `/admin/marketing` (diseño "Marketing.dc.html"). Requiere: marketing.view
 *
 * Todo sale de tablas reales:
 *   - leads / ventas por canal, tendencia diaria, mapa por estado, heatmap
 *     día×franja: app.leads ⨝ app.lead_attribution ⨝ app.lead_management
 *     (venta = commercial_status = 'WON').
 *   - inversión, impresiones, clics y campañas de Google Ads: app.ads_metrics
 *     (sincronizado por /api/cron/google-ads).
 *   - presupuesto por canal y valor por venta: app.settings
 *     (marketing_budget_*, conversion_won_value).
 *
 * Lo que NO tiene fuente en el backend NO se estima: gasto de Meta Ads,
 * Search Console (keywords, CTR, posición), keyword_view / search_term_view
 * de Google Ads y creativos. El cliente muestra "no conectado".
 *
 * Filtro de región: aplica a leads/ventas (app.leads.state_code). La inversión
 * de Google Ads es nacional (ads_metrics no segmenta por geografía) → el
 * cliente lo avisa cuando la región ≠ todas.
 *
 * Timezone de negocio: America/Mexico_City.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, BUSINESS_TIMEZONE } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { sql } from 'drizzle-orm';
import { logError } from '@/lib/log';
import { getSetting } from '@/lib/settings';
import { getGoogleAdsConfig, getWonConversionValue } from '@/lib/integrations/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = BUSINESS_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = {
  '7d': { label: 'Últimos 7 días', days: 7 },
  '30d': { label: 'Últimos 30 días', days: 30 },
  '90d': { label: 'Últimos 90 días', days: 90 },
  ytd: { label: 'Año en curso', days: 0 }, // se calcula desde el 1 de enero (CDMX)
} as const;
type RangeId = keyof typeof RANGES;

/** Regiones comerciales → claves INEGI (app.leads.state_code). */
const REGIONS: Record<string, { label: string; states: string[] | null }> = {
  todas: { label: 'Todas', states: null },
  cdmx: { label: 'CDMX', states: ['DF'] },
  jalisco: { label: 'Jalisco', states: ['JC'] },
  nl: { label: 'Nuevo León', states: ['NL'] },
  bajio: { label: 'Bajío', states: ['GT', 'QT', 'AG', 'SL'] },
  norte: { label: 'Norte', states: ['BC', 'BS', 'CH', 'CO', 'SO', 'SI', 'DG', 'TM', 'ZS', 'NT'] },
  centro: { label: 'Centro', states: ['MC', 'PU', 'HG', 'MS', 'TL', 'MN', 'CL'] },
  sureste: { label: 'Sureste', states: ['VZ', 'TB', 'CS', 'OA', 'CM', 'YN', 'QR', 'GR'] },
};

/** Inicio del día CDMX (UTC-6, sin DST). */
function startOfDayMx(d: Date): Date {
  const shifted = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + 6 * 60 * 60 * 1000);
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Presupuesto mensual (MXN) leído de settings; null si no está configurado. */
async function monthlyBudget(key: string, envKey: string): Promise<number | null> {
  const raw = await getSetting(key, process.env[envKey]);
  const n = Number((raw ?? '').trim());
  return raw && Number.isFinite(n) && n >= 0 ? n : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminSession('marketing.view');
  } catch (res) {
    return res as NextResponse;
  }

  const now = new Date();
  const sp = req.nextUrl.searchParams;
  const rangeParam = sp.get('range') ?? '30d';
  const range: RangeId = Object.hasOwn(RANGES, rangeParam) ? (rangeParam as RangeId) : '30d';
  const regionParam = sp.get('region') ?? 'todas';
  const regionId = Object.hasOwn(REGIONS, regionParam) ? regionParam : 'todas';
  const region = REGIONS[regionId];

  // Período actual: [from, to) hasta el cierre de hoy; anterior: mismo nº de días justo antes.
  const todayStart = startOfDayMx(now);
  const to = new Date(todayStart.getTime() + DAY_MS);
  let from: Date;
  if (range === 'ytd') {
    const y = new Date(now.getTime() - 6 * 60 * 60 * 1000).getUTCFullYear();
    from = new Date(Date.UTC(y, 0, 1, 6, 0, 0)); // 1 ene 00:00 CDMX
  } else {
    from = new Date(todayStart.getTime() - (RANGES[range].days - 1) * DAY_MS);
  }
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const prevTo = from;
  const prevFrom = new Date(from.getTime() - days * DAY_MS);

  try {
    const db = getDb();

    const regionFilter = region.states
      ? sql`AND l.state_code IN (${sql.join(region.states.map((s) => sql`${s}`), sql`, `)})`
      : sql``;

    // Leads + ventas (WON) por canal de atribución.
    const byChannel = (a: Date, b: Date) => sql`
      SELECT coalesce(la.source_category::text, 'other') AS ch,
        count(*)::int AS leads,
        count(*) FILTER (WHERE lm.commercial_status = 'WON')::int AS sales
      FROM app.leads l
      LEFT JOIN app.lead_attribution la ON la.lead_id = l.id
      LEFT JOIN app.lead_management lm ON lm.lead_id = l.id
      WHERE l.created_at >= ${a} AND l.created_at < ${b} ${regionFilter}
      GROUP BY 1
    `;
    const byDay = (a: Date, b: Date) => sql`
      SELECT to_char(date_trunc('day', l.created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day, count(*)::int AS leads
      FROM app.leads l
      WHERE l.created_at >= ${a} AND l.created_at < ${b} ${regionFilter}
      GROUP BY 1 ORDER BY 1
    `;
    const adsTotals = (a: Date, b: Date) => sql`
      SELECT coalesce(sum(impressions), 0)::bigint AS impressions, coalesce(sum(clicks), 0)::bigint AS clicks,
        coalesce(sum(cost_micros), 0)::bigint AS cost_micros, coalesce(sum(conversions), 0)::numeric AS conversions,
        count(*)::int AS rows
      FROM app.ads_metrics WHERE date >= ${ymd(a)} AND date < ${ymd(b)}
    `;

    const [
      chCur, chPrev, dayCur, dayPrev, heatRows, geoRows,
      adsCur, adsPrev, adsCampaignRows, gadsLeadRows, fbCampaignRows, seoPageRows,
      budgetGoogle, budgetMeta, budgetSeo, wonValue, wonRaw, gadsCfg,
    ] = await Promise.all([
      db.execute(byChannel(from, to)),
      db.execute(byChannel(prevFrom, prevTo)),
      db.execute(byDay(from, to)),
      db.execute(byDay(prevFrom, prevTo)),
      // día de la semana (1 = lunes) × franja de 3 h
      db.execute(sql`
        SELECT EXTRACT(ISODOW FROM l.created_at AT TIME ZONE ${TZ})::int AS dow,
          (EXTRACT(HOUR FROM l.created_at AT TIME ZONE ${TZ})::int / 3) AS block,
          count(*)::int AS leads
        FROM app.leads l
        WHERE l.created_at >= ${from} AND l.created_at < ${to} ${regionFilter}
        GROUP BY 1, 2
      `),
      db.execute(sql`
        SELECT l.state_code AS code, count(*)::int AS leads
        FROM app.leads l
        WHERE l.created_at >= ${from} AND l.created_at < ${to} AND l.state_code IS NOT NULL ${regionFilter}
        GROUP BY 1 ORDER BY 2 DESC
      `),
      db.execute(adsTotals(from, to)),
      db.execute(adsTotals(prevFrom, prevTo)),
      db.execute(sql`
        SELECT campaign_id AS id, max(campaign_name) AS name,
          sum(impressions)::bigint AS impressions, sum(clicks)::bigint AS clicks,
          sum(cost_micros)::bigint AS cost_micros, sum(conversions)::numeric AS conversions,
          max(date) AS last_date
        FROM app.ads_metrics WHERE date >= ${ymd(from)} AND date < ${ymd(to)}
        GROUP BY 1 ORDER BY 5 DESC
      `),
      // leads de Google Ads por campaña declarada en la URL (utm_campaign) — se
      // cruza en el cliente con el nombre/id de campaña de ads_metrics
      db.execute(sql`
        SELECT lower(coalesce(la.first_utm_campaign, '')) AS campaign, count(*)::int AS leads,
          count(*) FILTER (WHERE lm.commercial_status = 'WON')::int AS sales
        FROM app.leads l
        JOIN app.lead_attribution la ON la.lead_id = l.id
        LEFT JOIN app.lead_management lm ON lm.lead_id = l.id
        WHERE l.created_at >= ${from} AND l.created_at < ${to} AND la.source_category = 'google_ads' ${regionFilter}
        GROUP BY 1
      `),
      // leads de Meta por campaña (fb_campaign_id que manda la landing)
      db.execute(sql`
        SELECT coalesce(nullif(la.fb_campaign_id, ''), '—') AS campaign_id,
          coalesce(nullif(la.first_utm_campaign, ''), '') AS utm_campaign,
          count(*)::int AS leads,
          count(*) FILTER (WHERE lm.commercial_status = 'WON')::int AS sales
        FROM app.leads l
        JOIN app.lead_attribution la ON la.lead_id = l.id
        LEFT JOIN app.lead_management lm ON lm.lead_id = l.id
        WHERE l.created_at >= ${from} AND l.created_at < ${to} AND la.source_category = 'meta_ads' ${regionFilter}
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12
      `),
      // páginas de destino de leads orgánicos (ruta de landing_url, sin query string)
      db.execute(sql`
        SELECT coalesce(nullif(regexp_replace(regexp_replace(la.landing_url, '^https?://[^/]+', ''), '[?#].*$', ''), ''), '/') AS path,
          count(*)::int AS leads,
          count(*) FILTER (WHERE lm.commercial_status = 'WON')::int AS sales
        FROM app.leads l
        JOIN app.lead_attribution la ON la.lead_id = l.id
        LEFT JOIN app.lead_management lm ON lm.lead_id = l.id
        WHERE l.created_at >= ${from} AND l.created_at < ${to} AND la.source_category = 'organic' ${regionFilter}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8
      `),
      monthlyBudget('marketing_budget_google_ads', 'MARKETING_BUDGET_GOOGLE_ADS'),
      monthlyBudget('marketing_budget_meta_ads', 'MARKETING_BUDGET_META_ADS'),
      monthlyBudget('marketing_budget_seo', 'MARKETING_BUDGET_SEO'),
      getWonConversionValue(),
      getSetting('conversion_won_value', process.env.CONVERSION_WON_VALUE),
      getGoogleAdsConfig(),
    ]);

    const rows = (r: unknown): Record<string, unknown>[] =>
      ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];
    const one = (r: unknown) => rows(r)[0] ?? {};
    const num = (v: unknown) => Number(v) || 0;

    // ── Canales ──────────────────────────────────────────────────────────────
    const chMap = (r: unknown) => new Map(rows(r).map((x) => [String(x.ch), { leads: num(x.leads), sales: num(x.sales) }]));
    const cur = chMap(chCur), prev = chMap(chPrev);
    const pick = (m: Map<string, { leads: number; sales: number }>, ids: string[]) =>
      ids.reduce((a, id) => { const v = m.get(id); return { leads: a.leads + (v?.leads ?? 0), sales: a.sales + (v?.sales ?? 0) }; }, { leads: 0, sales: 0 });

    const ac = one(adsCur), ap = one(adsPrev);
    const gadsHasData = num(ac.rows) > 0;
    const spendGoogle = gadsHasData ? num(ac.cost_micros) / 1e6 : null;
    const spendGooglePrev = num(ap.rows) > 0 ? num(ap.cost_micros) / 1e6 : null;
    const prorate = (monthly: number | null) => (monthly == null ? null : (monthly * days) / 30.4375);

    const channels = [
      { id: 'google_ads', name: 'Google Ads', color: '#FFC72C', sources: ['google_ads'], spend: spendGoogle, prevSpend: spendGooglePrev, budget: prorate(budgetGoogle),
        impressions: gadsHasData ? num(ac.impressions) : null, clicks: gadsHasData ? num(ac.clicks) : null, conversions: gadsHasData ? num(ac.conversions) : null },
      { id: 'meta_ads', name: 'Facebook Ads', color: '#16160F', sources: ['meta_ads'], spend: null, prevSpend: null, budget: prorate(budgetMeta), impressions: null, clicks: null, conversions: null },
      { id: 'organic', name: 'SEO orgánico', color: '#2F6F5E', sources: ['organic'], spend: null, prevSpend: null, budget: prorate(budgetSeo), impressions: null, clicks: null, conversions: null },
      { id: 'other', name: 'Otros canales', color: '#B9B8AE', sources: ['paid_other', 'referral', 'direct', 'other'], spend: null, prevSpend: null, budget: null, impressions: null, clicks: null, conversions: null },
    ].map((c) => {
      const k = pick(cur, c.sources), p = pick(prev, c.sources);
      return { id: c.id, name: c.name, color: c.color, leads: k.leads, sales: k.sales, prevLeads: p.leads, prevSales: p.sales,
        spend: c.spend, prevSpend: c.prevSpend, budget: c.budget, impressions: c.impressions, clicks: c.clicks, conversions: c.conversions };
    });

    // ── Tendencia diaria (rellena días sin leads con 0) ───────────────────────
    const fill = (r: unknown, start: Date) => {
      const m = new Map(rows(r).map((x) => [String(x.day), num(x.leads)]));
      return Array.from({ length: days }, (_, i) => {
        // clave del día en CDMX: desplazamos 6 h para que la fecha UTC coincida
        const day = new Date(start.getTime() + i * DAY_MS - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
        return { day, leads: m.get(day) ?? 0 };
      });
    };

    // ── Heatmap 7 × 8 ─────────────────────────────────────────────────────────
    const heat = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => 0));
    for (const r of rows(heatRows)) heat[num(r.dow) - 1][num(r.block)] = num(r.leads);

    // ── Google Ads: campañas + leads por utm_campaign ────────────────────────
    const gadsLeads = rows(gadsLeadRows).map((r) => ({ campaign: String(r.campaign), leads: num(r.leads), sales: num(r.sales) }));
    const googleCampaigns = rows(adsCampaignRows).map((r) => {
      const name = String(r.name ?? ''), id = String(r.id ?? '');
      const match = gadsLeads.find((g) => g.campaign && (g.campaign === name.toLowerCase() || g.campaign === id.toLowerCase()));
      return {
        id, name,
        impressions: num(r.impressions), clicks: num(r.clicks), cost: num(r.cost_micros) / 1e6, conversions: num(r.conversions),
        lastDate: String(r.last_date ?? ''),
        leads: match ? match.leads : null, sales: match ? match.sales : null,
      };
    });

    return NextResponse.json({
      range: { id: range, label: RANGES[range].label, days, from: from.toISOString(), to: to.toISOString() },
      region: { id: regionId, label: region.label },
      regions: Object.entries(REGIONS).map(([id, r]) => ({ id, label: r.label })),
      updatedAt: now.toISOString(),
      revenuePerSale: wonValue,
      // false → se usa el default (100 MXN) porque conversion_won_value no está configurado
      revenuePerSaleConfigured: Boolean((wonRaw ?? '').trim()),
      integrations: {
        googleAds: { configured: gadsCfg != null, hasData: gadsHasData, lastDate: googleCampaigns.reduce((a, c) => (c.lastDate > a ? c.lastDate : a), '') || null },
        metaAds: false,
        searchConsole: false,
      },
      channels,
      trend: { current: fill(dayCur, from), prior: fill(dayPrev, prevFrom) },
      heatmap: heat,
      geo: rows(geoRows).map((r) => ({ code: String(r.code), leads: num(r.leads) })),
      googleCampaigns,
      googleLeadsUnmatched: gadsLeads.filter((g) => !googleCampaigns.some((c) => g.campaign === c.name.toLowerCase() || g.campaign === c.id.toLowerCase()))
        .map((g) => ({ campaign: g.campaign || '(sin utm_campaign)', leads: g.leads, sales: g.sales })),
      metaCampaigns: rows(fbCampaignRows).map((r) => ({ campaignId: String(r.campaign_id), utmCampaign: String(r.utm_campaign), leads: num(r.leads), sales: num(r.sales) })),
      seoPages: rows(seoPageRows).map((r) => ({ path: String(r.path), leads: num(r.leads), sales: num(r.sales) })),
    });
  } catch (err) {
    logError('/api/admin/marketing', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
