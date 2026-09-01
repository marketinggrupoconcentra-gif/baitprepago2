/**
 * api/admin/leads/facets.js
 * GET /api/admin/leads/facets
 * 
 * Retorna las opciones disponibles (source, medium, campaign) limitadas a 100.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';

export default async function handler(req, res) {
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
    
    const [sourcesRes, mediumsRes, campaignsRes] = await Promise.all([
      sql`SELECT utm_source as value, COUNT(*) as count FROM leads WHERE utm_source IS NOT NULL AND utm_source != '' GROUP BY utm_source ORDER BY count DESC LIMIT 100`,
      sql`SELECT utm_medium as value, COUNT(*) as count FROM leads WHERE utm_medium IS NOT NULL AND utm_medium != '' GROUP BY utm_medium ORDER BY count DESC LIMIT 100`,
      sql`SELECT utm_campaign as value, COUNT(*) as count FROM leads WHERE utm_campaign IS NOT NULL AND utm_campaign != '' GROUP BY utm_campaign ORDER BY count DESC LIMIT 100`
    ]);

    return res.status(200).json({
      sources: sourcesRes,
      mediums: mediumsRes,
      campaigns: campaignsRes
    });

  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
