/**
 * api/admin/analytics.js
 * GET /api/admin/analytics
 * 
 * Retorna métricas agregadas para el módulo de Analítica.
 * Filtros aceptados: dateFrom, dateTo, source, medium, campaign, status.
 */

import { getDb } from '../../lib/db.js';
import { requireAdminSession } from '../../lib/admin-session.js';
import { ROLES, hasRole } from '../../lib/admin-rbac.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await requireAdminSession(req, res);
    if (!user) return; // 401 already sent

    if (!hasRole(user.role, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER])) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const source = url.searchParams.get('source');
    const medium = url.searchParams.get('medium');
    const campaign = url.searchParams.get('campaign');
    const statusFilter = url.searchParams.get('status');
    const rawFrom = url.searchParams.get('from');
    const rawTo = url.searchParams.get('to');

    // Filters validation (max 255 chars)
    if (source && source.length > 255) return res.status(400).json({ error: 'Filter too long' });
    if (medium && medium.length > 255) return res.status(400).json({ error: 'Filter too long' });
    if (campaign && campaign.length > 255) return res.status(400).json({ error: 'Filter too long' });
    if (statusFilter && statusFilter.length > 32) return res.status(400).json({ error: 'Invalid status' });

    // Rango por defecto: 30 días
    let dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let dateTo = new Date();

    if (rawFrom) {
      const fromParsed = Date.parse(rawFrom);
      if (isNaN(fromParsed)) return res.status(400).json({ error: 'Invalid from date' });
      dateFrom = new Date(fromParsed);
    }
    if (rawTo) {
      const toParsed = Date.parse(rawTo);
      if (isNaN(toParsed)) return res.status(400).json({ error: 'Invalid to date' });
      // Si mandan un YYYY-MM-DD, asumimos final del día
      dateTo = rawTo.includes('T') ? new Date(toParsed) : new Date(rawTo + 'T23:59:59.999Z');
    }

    if (dateFrom > dateTo) {
      return res.status(400).json({ error: 'Date from must be <= date to' });
    }
    const days = (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24);
    if (days > 366) {
      return res.status(400).json({ error: 'Date range cannot exceed 366 days' });
    }

    const sql = getDb();

    // Construcción de condiciones WHERE dinámicas compartidas
    let whereClause = `created_at >= $1::timestamptz AND created_at <= $2::timestamptz`;
    const params = [dateFrom.toISOString(), dateTo.toISOString()];

    if (source) {
      params.push(source);
      whereClause += ` AND utm_source = $${params.length}`;
    }
    if (medium) {
      params.push(medium);
      whereClause += ` AND utm_medium = $${params.length}`;
    }
    if (campaign) {
      params.push(campaign);
      whereClause += ` AND utm_campaign = $${params.length}`;
    }
    if (statusFilter) {
      params.push(statusFilter);
      whereClause += ` AND status = $${params.length}`;
    }

    // Consultas individuales en paralelo
    const totalsQuery = `
      SELECT
        COUNT(*) AS total_leads,
        COUNT(*) FILTER (WHERE utm_source IS NOT NULL AND TRIM(utm_source) <> '') AS attributed,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE status IN ('REJECTED', 'CANCELLED', 'COMPLETED')) AS terminal
      FROM leads
      WHERE ${whereClause}
    `;

    const funnelQuery = `
      SELECT status, COUNT(*) AS count
      FROM leads
      WHERE ${whereClause}
      GROUP BY status
      ORDER BY count DESC
    `;

    const sourcesQuery = `
      SELECT 
        CASE 
          WHEN utm_source IS NULL OR TRIM(utm_source) = '' THEN 'Sin atribución'
          ELSE TRIM(utm_source)
        END AS source,
        COUNT(*) AS count
      FROM leads
      WHERE ${whereClause}
      GROUP BY source
      ORDER BY count DESC
      LIMIT 10
    `;

    const campaignsQuery = `
      SELECT 
        TRIM(utm_campaign) AS campaign,
        COUNT(*) AS count
      FROM leads
      WHERE ${whereClause} 
        AND utm_campaign IS NOT NULL 
        AND TRIM(utm_campaign) <> ''
      GROUP BY campaign
      ORDER BY count DESC
      LIMIT 10
    `;

    const trendQuery = `
      SELECT
        gs.day::date AS date,
        COALESCE(SUM(CASE WHEN l.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed,
        COUNT(l.id) AS created
      FROM generate_series($1::timestamptz, $2::timestamptz, INTERVAL '1 day') AS gs(day)
      LEFT JOIN (
        SELECT id, DATE(created_at AT TIME ZONE 'America/Mexico_City') AS d, status
        FROM leads
        WHERE ${whereClause}
      ) l ON DATE(gs.day AT TIME ZONE 'America/Mexico_City') = l.d
      GROUP BY gs.day
      ORDER BY gs.day ASC
    `;

    const [
      totalsRes,
      funnelRes,
      sourcesRes,
      campaignsRes,
      trendRes
    ] = await Promise.all([
      sql.query(totalsQuery, params),
      sql.query(funnelQuery, params),
      sql.query(sourcesQuery, params),
      sql.query(campaignsQuery, params),
      sql.query(trendQuery, params)
    ]);

    const totalsRow = (totalsRes.rows || totalsRes)[0];
    const totalLeads = parseInt(totalsRow.total_leads || 0, 10);

    const funnel = (funnelRes.rows || funnelRes).map(r => {
      const c = parseInt(r.count, 10);
      return {
        status: r.status,
        count: c,
        percentage: totalLeads > 0 ? Math.round((c / totalLeads) * 100 * 10) / 10 : 0
      };
    });

    const sources = (sourcesRes.rows || sourcesRes).map(r => ({
      source: String(r.source),
      count: parseInt(r.count, 10)
    }));

    const campaigns = (campaignsRes.rows || campaignsRes).map(r => ({
      campaign: String(r.campaign),
      count: parseInt(r.count, 10)
    }));

    const trend = (trendRes.rows || trendRes).map(r => ({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date).split('T')[0],
      created: parseInt(r.created, 10),
      completed: parseInt(r.completed, 10)
    }));

    return res.status(200).json({
      totals: {
        leads: totalLeads,
        attributed: parseInt(totalsRow.attributed || 0, 10),
        completed: parseInt(totalsRow.completed || 0, 10),
        terminal: parseInt(totalsRow.terminal || 0, 10)
      },
      trend,
      funnel,
      sources,
      campaigns
    });

  } catch (err) {
    console.error('Analytics error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
