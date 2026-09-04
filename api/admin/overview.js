/**
 * api/admin/overview.js
 *
 * GET /api/admin/overview?range=7|14|30
 *
 * READ ONLY. AUTHENTICATED. NO PII. NO MUTATIONS. NO DDL.
 *
 * Returns aggregated lead metrics for the BAIT Prepago admin dashboard.
 * All response fields are explicitly whitelisted — no full-row passthrough.
 * Calendar ranges are evaluated in America/Mexico_City.
 */

import { getDb } from '../../lib/db.js';
import { requireAdminSession } from '../../lib/admin-session.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

// Strict whitelist — convert user input to an internal constant
const ALLOWED_RANGES = { 7: 7, 14: 14, 30: 30 };
const DEFAULT_RANGE = 14;
const BUSINESS_TIME_ZONE = 'America/Mexico_City';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth gate
  const user = await requireAdminSession(req, res);
  if (!user) return;

  // Range validation — whitelist only
  const rawRange = req.query?.range ?? String(DEFAULT_RANGE);
  const parsedRange = parseInt(rawRange, 10);
  const range = ALLOWED_RANGES[parsedRange];

  if (range === undefined) {
    return res.status(400).json({
      error: 'Invalid range. Must be 7, 14, or 30.'
    });
  }

  const sql = getDb();

  try {
    // Run all independent reads in parallel
    const [
      totalsResult,
      trendResult,
      sourcesResult,
      campaignsResult,
      recentResult
    ] = await Promise.all([

      // ── KPIs: total, last 24h, last 7d, attribution rate ────────────────
      // These are intentionally rolling intervals, not calendar-day metrics.
      sql`
        SELECT
          COUNT(*)                                                      AS total,
          COUNT(*) FILTER (
            WHERE created_at >= NOW() - INTERVAL '24 hours'
          )                                                             AS last_24h,
          COUNT(*) FILTER (
            WHERE created_at >= NOW() - INTERVAL '7 days'
          )                                                             AS last_7d,
          COUNT(*) FILTER (
            WHERE utm_source IS NOT NULL AND TRIM(utm_source) <> ''
          )                                                             AS attributed
        FROM leads
      `,

      // ── Daily trend for the selected range ───────────────────────────────
      // Uses CDMX civil-day boundaries and zero-fills missing days.
      sql`
        WITH bounds AS (
          SELECT (NOW() AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS today
        ),
        days AS (
          SELECT generate_series(
            (SELECT today FROM bounds) - (${range}::int - 1),
            (SELECT today FROM bounds),
            INTERVAL '1 day'
          )::date AS day
        ),
        counts AS (
          SELECT
            (created_at AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS day,
            COUNT(*)                                             AS cnt
          FROM leads
          CROSS JOIN bounds
          WHERE created_at >= (
            (bounds.today - (${range}::int - 1))::timestamp
            AT TIME ZONE ${BUSINESS_TIME_ZONE}
          )
            AND created_at < (
              (bounds.today + 1)::timestamp
              AT TIME ZONE ${BUSINESS_TIME_ZONE}
            )
          GROUP BY day
        )
        SELECT
          TO_CHAR(days.day, 'YYYY-MM-DD') AS date,
          COALESCE(counts.cnt, 0)         AS leads
        FROM days
        LEFT JOIN counts ON counts.day = days.day
        ORDER BY days.day ASC
      `,

      // ── Top 5 sources over the same selected CDMX calendar range ────────
      sql`
        WITH bounds AS (
          SELECT (NOW() AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS today
        )
        SELECT
          CASE
            WHEN utm_source IS NULL OR TRIM(utm_source) = ''
            THEN 'Sin atribución'
            ELSE TRIM(utm_source)
          END                                                           AS source,
          COUNT(*)                                                      AS cnt
        FROM leads
        CROSS JOIN bounds
        WHERE created_at >= (
          (bounds.today - (${range}::int - 1))::timestamp
          AT TIME ZONE ${BUSINESS_TIME_ZONE}
        )
          AND created_at < (
            (bounds.today + 1)::timestamp
            AT TIME ZONE ${BUSINESS_TIME_ZONE}
          )
        GROUP BY source
        ORDER BY cnt DESC
        LIMIT 6
      `,

      // ── Top 5 campaigns over the same selected CDMX calendar range ─────
      sql`
        WITH bounds AS (
          SELECT (NOW() AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS today
        )
        SELECT
          TRIM(utm_campaign)                                            AS campaign,
          COUNT(*)                                                      AS cnt
        FROM leads
        CROSS JOIN bounds
        WHERE created_at >= (
          (bounds.today - (${range}::int - 1))::timestamp
          AT TIME ZONE ${BUSINESS_TIME_ZONE}
        )
          AND created_at < (
            (bounds.today + 1)::timestamp
            AT TIME ZONE ${BUSINESS_TIME_ZONE}
          )
          AND utm_campaign IS NOT NULL
          AND TRIM(utm_campaign) <> ''
        GROUP BY campaign
        ORDER BY cnt DESC
        LIMIT 5
      `,

      // ── Last 10 activity (NO PII) ────────────────────────────────────────
      // Transport as instants; the admin UI renders them explicitly in CDMX.
      sql`
        SELECT
          created_at                                                    AS created_at,
          CASE
            WHEN utm_source IS NULL OR TRIM(utm_source) = ''
            THEN 'Sin atribución'
            ELSE TRIM(utm_source)
          END                                                           AS source,
          CASE
            WHEN utm_campaign IS NULL OR TRIM(utm_campaign) = ''
            THEN NULL
            ELSE TRIM(utm_campaign)
          END                                                           AS campaign,
          CASE
            WHEN utm_medium IS NULL OR TRIM(utm_medium) = ''
            THEN NULL
            ELSE TRIM(utm_medium)
          END                                                           AS medium
        FROM leads
        ORDER BY created_at DESC
        LIMIT 10
      `
    ]);

    // ── Process KPIs ─────────────────────────────────────────────────────
    const kpiRow = totalsResult[0];
    const total = Number(kpiRow.total);
    const attributed = Number(kpiRow.attributed);
    const attributionRate = total > 0
      ? Math.round((attributed / total) * 100 * 10) / 10
      : 0;

    // ── Process trend ─────────────────────────────────────────────────────
    // SQL already returns a timezone-neutral YYYY-MM-DD calendar label.
    const trend = trendResult.map(row => ({
      date: String(row.date),
      leads: Number(row.leads)
    }));

    // ── Process sources — cap at top 5, rest → "Otros" ───────────────────
    let sources = sourcesResult.map(row => ({
      source: String(row.source),
      count: Number(row.cnt)
    }));
    if (sources.length > 5) {
      const top5 = sources.slice(0, 5);
      const othersCount = sources.slice(5).reduce((acc, s) => acc + s.count, 0);
      if (othersCount > 0) {
        top5.push({ source: 'Otros', count: othersCount });
      }
      sources = top5;
    }
    const sourceTotal = sources.reduce((acc, s) => acc + s.count, 0);
    const sourcesWithPct = sources.map(s => ({
      source: s.source,
      count: s.count,
      percentage: sourceTotal > 0 ? Math.round((s.count / sourceTotal) * 100 * 10) / 10 : 0
    }));

    // ── Process campaigns ─────────────────────────────────────────────────
    const campaigns = campaignsResult.map(row => ({
      campaign: String(row.campaign),
      count: Number(row.cnt)
    }));

    // ── Process recent activity (explicit allowlist — NO PII) ─────────────
    const recentActivity = recentResult.map(row => ({
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
      source: String(row.source),
      campaign: row.campaign ?? null,
      medium: row.medium ?? null
    }));

    // ── Build response (explicit allowlist) ───────────────────────────────
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      range,
      kpis: {
        total,
        last24Hours: Number(kpiRow.last_24h),
        last7Days: Number(kpiRow.last_7d),
        attributionRate
      },
      trend,
      sources: sourcesWithPct,
      campaigns,
      recentActivity
    });

  } catch (err) {
    console.error('Overview error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
