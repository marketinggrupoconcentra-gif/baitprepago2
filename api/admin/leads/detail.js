/**
 * api/admin/leads/detail.js
 * GET /api/admin/leads/detail?id=X
 * 
 * Retorna el detalle de un lead. Sanitiza URLs, enmascara el teléfono y omite IP.
 */

const { neon } = require('@neondatabase/serverless');
const { getAdminSession } = require('../../../lib/admin-auth');
const { hasRole, ROLES } = require('../../../lib/admin-rbac');
const { maskPhone, sanitizeAdminUrl } = require('../../../lib/leads-utils');

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

    const url = new URL(req.url);
    const id = parseInt(url.searchParams.get('id'));

    if (!id || isNaN(id)) {
      return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });
    }

    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) throw new Error('DB Config Error');

    const sql = neon(dbUrl);

    // Omitimos IP y fbclid por defecto, y teléfono crudo para luego enmascarar
    const results = await sql`
      SELECT 
        id, phone, utm_source, utm_medium, utm_campaign, utm_term, utm_content, 
        user_agent, referrer, page_url, created_at
      FROM leads
      WHERE id = ${id}
      LIMIT 1
    `;

    if (results.length === 0) {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    }

    const lead = results[0];
    
    // Mapeo Seguro PII
    const safeLead = {
      id: lead.id,
      phone: maskPhone(lead.phone),
      utm_source: lead.utm_source,
      utm_medium: lead.utm_medium,
      utm_campaign: lead.utm_campaign,
      utm_term: lead.utm_term,
      utm_content: lead.utm_content,
      user_agent: lead.user_agent,
      referrer: sanitizeAdminUrl(lead.referrer),
      page_url: sanitizeAdminUrl(lead.page_url),
      created_at: lead.created_at
    };

    return new Response(JSON.stringify({ data: safeLead }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    console.error('API /admin/leads/detail Error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}
