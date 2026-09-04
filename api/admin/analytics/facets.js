/**
 * api/admin/analytics/facets.js
 * GET /api/admin/analytics/facets
 * 
 * Retorna las opciones disponibles para los filtros de analítica.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
import { STATUS_CATALOG } from '../../../lib/lead-workflow.js';

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
    if (!user) return;

    if (!hasRole(user.role, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER])) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const sql = getDb();
    
    // Obtenemos los valores únicos (limitado a 100) para poblar los selects de filtro.
    // No filtramos por fecha aquí porque queremos que el filtro muestre opciones históricas.
    const [sourcesRes, mediumsRes, campaignsRes, statusesRes] = await Promise.all([
      sql.query(`SELECT utm_source as value, COUNT(*) as count FROM leads WHERE utm_source IS NOT NULL AND utm_source != '' GROUP BY utm_source ORDER BY count DESC LIMIT 100`),
      sql.query(`SELECT utm_medium as value, COUNT(*) as count FROM leads WHERE utm_medium IS NOT NULL AND utm_medium != '' GROUP BY utm_medium ORDER BY count DESC LIMIT 100`),
      sql.query(`SELECT utm_campaign as value, COUNT(*) as count FROM leads WHERE utm_campaign IS NOT NULL AND utm_campaign != '' GROUP BY utm_campaign ORDER BY count DESC LIMIT 100`),
      sql.query(`SELECT status as value, COUNT(*) as count FROM leads GROUP BY status`)
    ]);

    const statusCounts = (statusesRes.rows || statusesRes).reduce((acc, row) => {
      acc[row.value] = parseInt(row.count, 10);
      return acc;
    }, {});

    const statuses = Object.entries(STATUS_CATALOG).map(([value, label]) => ({
      value,
      label,
      count: statusCounts[value] || 0
    }));

    return res.status(200).json({
      sources: sourcesRes.rows || sourcesRes,
      mediums: mediumsRes.rows || mediumsRes,
      campaigns: campaignsRes.rows || campaignsRes,
      statuses
    });

  } catch (err) {
    console.error('Analytics facets error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
