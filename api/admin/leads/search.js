/**
 * api/admin/leads/search.js
 * POST /api/admin/leads/search
 * 
 * Búsqueda de teléfono exacta. Solo SUPER_ADMIN.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
import { maskPhone } from '../../../lib/leads-utils.js';
import { logAdminAction } from '../../../lib/admin-audit.js';
import { assertSameOrigin } from '../../../lib/admin-auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require JSON
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported Media Type' });
  }

  // Size limit (2KB)
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength, 10) > 2048) {
    return res.status(413).json({ error: 'Payload Too Large' });
  }

  try {
    assertSameOrigin(req);
  } catch (err) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const user = await requireAdminSession(req, res);
    if (!user) return; // 401 already sent

    if (!hasRole(user.role, [ROLES.SUPER_ADMIN])) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { phone } = req.body || {};
    if (!phone || typeof phone !== 'string' || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone format' });
    }

    const sql = getDb();
    const results = await sql.query(`
      SELECT id, phone, created_at, utm_source, utm_medium, utm_campaign
      FROM leads
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [phone]);
    
    const rows = results.rows || results;

    // Audit the action BEFORE returning, without exposing the raw phone!
    try {
      await logAdminAction(user, 'LEAD_PHONE_SEARCH', { resultCount: rows.length });
    } catch (err) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    const items = rows.map(row => ({
      id: row.id,
      phoneMasked: maskPhone(row.phone),
      source: row.utm_source,
      medium: row.utm_medium,
      campaign: row.utm_campaign,
      createdAt: row.created_at
    }));

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
