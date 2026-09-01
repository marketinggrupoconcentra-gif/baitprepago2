/**
 * api/admin/leads/facets.js
 * GET /api/admin/leads/facets
 * 
 * Retorna las opciones únicas para source, medium y campaign para alimentar los dropdowns.
 */

const { neon } = require('@neondatabase/serverless');
const { getAdminSession } = require('../../../lib/admin-auth');
const { hasRole, ROLES } = require('../../../lib/admin-rbac');

export const config = {
  runtime: 'edge'
};

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const session = await getAdminSession(req);
    if (!session) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (!hasRole(session.role, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.VIEWER])) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) throw new Error('DB Config Error');

    const sql = neon(dbUrl);

    // Obtener valores únicos (limitado para no reventar memoria si hay miles)
    // En una base masiva usaríamos tablas de dimensiones, pero aquí un GROUP BY con límite es suficiente.
    const [sources, mediums, campaigns] = await Promise.all([
      sql`SELECT utm_source as value FROM leads WHERE utm_source IS NOT NULL GROUP BY utm_source ORDER BY count(*) DESC LIMIT 50`,
      sql`SELECT utm_medium as value FROM leads WHERE utm_medium IS NOT NULL GROUP BY utm_medium ORDER BY count(*) DESC LIMIT 50`,
      sql`SELECT utm_campaign as value FROM leads WHERE utm_campaign IS NOT NULL GROUP BY utm_campaign ORDER BY count(*) DESC LIMIT 100`
    ]);

    return new Response(JSON.stringify({
      sources: sources.map(r => r.value),
      mediums: mediums.map(r => r.value),
      campaigns: campaigns.map(r => r.value)
    }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    console.error('API /admin/leads/facets Error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}
