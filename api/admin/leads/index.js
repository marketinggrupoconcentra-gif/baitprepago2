/**
 * api/admin/leads/index.js
 * GET /api/admin/leads
 * 
 * Retorna un listado de leads con paginación basada en cursor.
 * Los teléfonos se retornan ENMASCARADOS.
 * Filtros aceptados por querystring (source, medium, campaign, from, to).
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
import { maskPhone, decodeCursor, encodeCursor } from '../../../lib/leads-utils.js';

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
    
    // Dates validation
    if (dateFrom && isNaN(Date.parse(dateFrom))) return res.status(400).json({ error: 'Invalid from date' });
    if (dateTo && isNaN(Date.parse(dateTo))) return res.status(400).json({ error: 'Invalid to date' });
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return res.status(400).json({ error: 'Date from must be <= date to' });
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
      SELECT id, phone, utm_source, utm_medium, utm_campaign, created_at
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
    if (dateFrom) {
      params.push(dateFrom);
      queryStr += ` AND created_at >= $${params.length}::timestamptz`;
      countQueryStr += ` AND created_at >= $${params.length}::timestamptz`;
    }
    if (dateTo) {
      params.push(dateTo);
      queryStr += ` AND created_at <= $${params.length}::timestamptz`;
      countQueryStr += ` AND created_at <= $${params.length}::timestamptz`;
    }

    // Total Count execution
    const countRes = await sql(countQueryStr, params);
    const total = parseInt(countRes[0].total, 10);

    // Pagination via Cursor
    if (cursor) {
      params.push(cursor.createdAt);
      const idxCreated = params.length;
      params.push(cursor.id);
      const idxId = params.length;
      queryStr += ` AND (created_at < $${idxCreated}::timestamptz OR (created_at = $${idxCreated}::timestamptz AND id < $${idxId}))`;
    }

    // Order and Limit
    queryStr += ` ORDER BY created_at DESC, id DESC LIMIT ${limit}`;

    const results = await sql(queryStr, params);

    const items = results.map(row => ({
      id: row.id,
      phoneMasked: maskPhone(row.phone), // Masked!
      source: row.utm_source,
      medium: row.utm_medium,
      campaign: row.utm_campaign,
      createdAt: row.created_at
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
