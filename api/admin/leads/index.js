/**
 * api/admin/leads/index.js
 * GET /api/admin/leads
 *
 * Retorna un listado de leads con paginación basada en cursor.
 * Los teléfonos se retornan ENMASCARADOS.
 * Filtros aceptados por querystring (source, medium, campaign, from, to).
 *
 * Política temporal:
 * - Los instantes se almacenan/transportan como TIMESTAMPTZ.
 * - Los filtros de calendario se interpretan siempre en America/Mexico_City.
 * - Nunca se desplazan timestamps históricos para "convertirlos" a hora local.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
import { maskPhone, decodeCursor, encodeCursor } from '../../../lib/leads-utils.js';

const BUSINESS_TIME_ZONE = 'America/Mexico_City';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Valida una fecha de calendario YYYY-MM-DD sin depender de la TZ del runtime.
 * Retorna el epoch UTC del día civil únicamente para comparar/rango; no se usa
 * como instante de negocio.
 */
function parseDateOnly(value) {
  if (!DATE_ONLY_RE.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcMs);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return utcMs;
}

export default async function handler(req, res) {
  // Prevent caching
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await requireAdminSession(req, res);
    if (!user) return; // 401 already sent

    if (!hasRole(user.role, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER])) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const sql = getDb();

    // Parse query params (node req.query or from URL)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const source = url.searchParams.get('source');
    const medium = url.searchParams.get('medium');
    const campaign = url.searchParams.get('campaign');
    const dateFrom = url.searchParams.get('from');
    const dateTo = url.searchParams.get('to');
    const statusFilter = url.searchParams.get('status');

    // Limits
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 25;

    if (![25, 50, 100].includes(limit)) {
      return res.status(400).json({ error: 'Invalid limit. Allowed: 25, 50, 100' });
    }

    // Filters validation (max 255 chars)
    if (source && source.length > 255) return res.status(400).json({ error: 'Filter too long' });
    if (medium && medium.length > 255) return res.status(400).json({ error: 'Filter too long' });
    if (campaign && campaign.length > 255) return res.status(400).json({ error: 'Filter too long' });
    if (statusFilter && statusFilter.length > 32) return res.status(400).json({ error: 'Invalid status' });

    // Calendar-date validation. Avoid Date.parse('YYYY-MM-DD') because its UTC
    // semantics are not the business rule for BAIT Prepago.
    const fromDay = dateFrom ? parseDateOnly(dateFrom) : null;
    const toDay = dateTo ? parseDateOnly(dateTo) : null;

    if (dateFrom && fromDay === null) return res.status(400).json({ error: 'Invalid from date' });
    if (dateTo && toDay === null) return res.status(400).json({ error: 'Invalid to date' });

    if (dateFrom && dateTo) {
      if (fromDay > toDay) {
        return res.status(400).json({ error: 'Date from must be <= date to' });
      }

      const days = (toDay - fromDay) / MS_PER_DAY;
      if (days > 365) {
        return res.status(400).json({ error: 'Date range cannot exceed 365 days' });
      }
    }

    // Cursor
    const cursorRaw = url.searchParams.get('cursor');
    let cursor = null;
    if (cursorRaw) {
      try {
        cursor = decodeCursor(cursorRaw);
      } catch (err) {
        return res.status(400).json({ error: 'Invalid cursor format' });
      }
    }

    // Construct Query dynamically using params
    let queryStr = `
      SELECT id, phone, utm_source, utm_medium, utm_campaign, created_at, status
      FROM leads
      WHERE 1=1
    `;
    let countQueryStr = `
      SELECT COUNT(*) as total
      FROM leads
      WHERE 1=1
    `;

    const params = [];

    if (source) {
      params.push(source);
      queryStr += ` AND utm_source = $${params.length}`;
      countQueryStr += ` AND utm_source = $${params.length}`;
    }
    if (medium) {
      params.push(medium);
      queryStr += ` AND utm_medium = $${params.length}`;
      countQueryStr += ` AND utm_medium = $${params.length}`;
    }
    if (campaign) {
      params.push(campaign);
      queryStr += ` AND utm_campaign = $${params.length}`;
      countQueryStr += ` AND utm_campaign = $${params.length}`;
    }
    if (statusFilter) {
      params.push(statusFilter);
      queryStr += ` AND status = $${params.length}`;
      countQueryStr += ` AND status = $${params.length}`;
    }
    if (dateFrom) {
      params.push(dateFrom);
      const idx = params.length;
      queryStr += ` AND created_at >= ($${idx}::date::timestamp AT TIME ZONE '${BUSINESS_TIME_ZONE}')`;
      countQueryStr += ` AND created_at >= ($${idx}::date::timestamp AT TIME ZONE '${BUSINESS_TIME_ZONE}')`;
    }
    if (dateTo) {
      params.push(dateTo);
      const idx = params.length;
      // Exclusive next-day boundary avoids 23:59:59.999 precision bugs and
      // correctly covers the complete civil day in Mexico City.
      queryStr += ` AND created_at < ((($${idx}::date + 1)::timestamp) AT TIME ZONE '${BUSINESS_TIME_ZONE}')`;
      countQueryStr += ` AND created_at < ((($${idx}::date + 1)::timestamp) AT TIME ZONE '${BUSINESS_TIME_ZONE}')`;
    }

    // Total Count execution
    const countRes = await sql.query(countQueryStr, params);
    const total = parseInt(countRes.rows ? countRes.rows[0].total : countRes[0].total, 10);

    // Pagination via Cursor
    if (cursor) {
      params.push(cursor.createdAt);
      const idxCreated = params.length;
      params.push(cursor.id);
      const idxId = params.length;

      // Sorting is (created_at DESC, id DESC), so this tuple boundary is stable.
      queryStr += ` AND (created_at < $${idxCreated}::timestamptz OR (created_at = $${idxCreated}::timestamptz AND id < $${idxId}))`;
    }

    // Order and Limit
    queryStr += ` ORDER BY created_at DESC, id DESC LIMIT ${limit}`;

    const results = await sql.query(queryStr, params);
    const rows = results.rows || results;

    const items = rows.map(row => ({
      id: row.id,
      phoneMasked: maskPhone(row.phone), // Masked!
      source: row.utm_source,
      medium: row.utm_medium,
      campaign: row.utm_campaign,
      createdAt: row.created_at,
      status: row.status
    }));

    let nextCursor = null;
    let hasMore = false;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
      hasMore = true;
    }

    return res.status(200).json({
      items,
      pagination: {
        limit,
        nextCursor,
        hasMore,
        total
      }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
