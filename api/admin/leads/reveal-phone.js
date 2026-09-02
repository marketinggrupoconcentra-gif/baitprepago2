/**
 * api/admin/leads/reveal-phone.js
 * POST /api/admin/leads/reveal-phone
 * 
 * Muestra temporalmente el teléfono real de un lead,
 * registrando estrictamente la acción en auditoría.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
import { logAdminAction } from '../../../lib/admin-audit.js';
import { assertSameOrigin } from '../../../lib/admin-auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported Media Type' });
  }

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

    const { id } = req.body || {};
    if (!id || typeof id !== 'number' || id <= 0) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const sql = getDb();
    
    // Verify lead exists and get phone
    const results = await sql.query(`
      SELECT id, phone FROM leads WHERE id = $1
    `, [id]);
    
    const rows = results.rows || results;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = rows[0];

    // Write Audit. Fail closed if this throws.
    try {
      await logAdminAction(user, 'LEAD_PHONE_REVEAL', { leadId: lead.id });
    } catch (err) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    return res.status(200).json({
      id: lead.id,
      phone: lead.phone,
      expiresInSeconds: 60
    });

  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
