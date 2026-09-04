/**
 * api/admin/analytics/export.js
 * GET /api/admin/analytics/export
 * 
 * Exporta un CSV de los leads según los filtros especificados.
 * SIN PII (no phone, no ip, no user_agent).
 * Neutralización activa de XSS en CSV.
 * Sólo para SUPER_ADMIN y ADMIN.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
import { logAdminAction } from '../../../lib/admin-audit.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Previene inyección de fórmulas en CSV.
 */
function neutralizeCsv(value) {
  if (value == null) return '';
  let str = String(value);
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  // Escapar comillas dobles
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await requireAdminSession(req, res);
    if (!user) return; // 401 already sent

    // Sólo SUPER_ADMIN y ADMIN pueden exportar
    if (!hasRole(user.role, [ROLES.SUPER_ADMIN, ROLES.ADMIN])) {
      return res.status(403).json({ error: 'Forbidden. Requiere permisos de Admin.' });
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
    let queryStr = `
      SELECT 
        id, 
        created_at, 
        status, 
        status_reason, 
        utm_source, 
        utm_medium, 
        utm_campaign
      FROM leads
      WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
    `;
    const params = [dateFrom.toISOString(), dateTo.toISOString()];

    if (source) {
      params.push(source);
      queryStr += ` AND utm_source = $${params.length}`;
    }
    if (medium) {
      params.push(medium);
      queryStr += ` AND utm_medium = $${params.length}`;
    }
    if (campaign) {
      params.push(campaign);
      queryStr += ` AND utm_campaign = $${params.length}`;
    }
    if (statusFilter) {
      params.push(statusFilter);
      queryStr += ` AND status = $${params.length}`;
    }

    queryStr += ` ORDER BY created_at DESC LIMIT 50000`; // Límite de seguridad

    const result = await sql.query(queryStr, params);
    const rows = result.rows || result;

    // Log action
    await logAdminAction(user, 'ANALYTICS_EXPORT', {
      rangeFrom: dateFrom.toISOString(),
      rangeTo: dateTo.toISOString(),
      recordCount: rows.length
    });

    // Build CSV
    const headers = ['ID', 'Fecha', 'Estado', 'Motivo', 'Source', 'Medium', 'Campaign'];
    
    let csvStr = headers.join(',') + '\n';
    
    for (const row of rows) {
      const line = [
        row.id,
        row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        neutralizeCsv(row.status),
        neutralizeCsv(row.status_reason),
        neutralizeCsv(row.utm_source),
        neutralizeCsv(row.utm_medium),
        neutralizeCsv(row.utm_campaign)
      ];
      csvStr += line.join(',') + '\n';
    }

    const filename = `analytics_export_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvStr);

  } catch (err) {
    console.error('Analytics export error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
