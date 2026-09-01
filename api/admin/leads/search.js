/**
 * api/admin/leads/search.js
 * POST /api/admin/leads/search
 * 
 * Búsqueda exacta de teléfono (10 dígitos). Solo SUPER_ADMIN. 
 * Audita LEAD_PHONE_SEARCH. Retorna resultado ENMASCARADO.
 */

const { neon } = require('@neondatabase/serverless');
const { getAdminSession, assertSameOrigin } = require('../../../lib/admin-auth');
const { hasRole, ROLES } = require('../../../lib/admin-rbac');
const { logAdminAction } = require('../../../lib/admin-audit');
const { maskPhone } = require('../../../lib/leads-utils');

export const config = {
  runtime: 'edge'
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    if (!assertSameOrigin(req)) {
      return new Response(JSON.stringify({ error: 'Forbidden Origin' }), { status: 403 });
    }

    const session = await getAdminSession(req);
    if (!session) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // ONLY SUPER_ADMIN
    if (!hasRole(session.role, [ROLES.SUPER_ADMIN])) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { phone } = body;

    if (!phone || typeof phone !== 'string' || !/^\d{10}$/.test(phone)) {
      return new Response(JSON.stringify({ error: 'Invalid phone format (must be 10 digits)' }), { status: 400 });
    }

    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) throw new Error('DB Config Error');

    // Registrar auditoría ANTES de la búsqueda real
    const ip = req.headers.get('x-forwarded-for') || '';
    const ua = req.headers.get('user-agent') || '';
    await logAdminAction(session.email, 'LEAD_PHONE_SEARCH', phone, ip, ua);

    const sql = neon(dbUrl);

    // Search
    const results = await sql`
      SELECT id, phone, utm_source, utm_campaign, created_at
      FROM leads
      WHERE phone = ${phone}
      ORDER BY created_at DESC
    `;

    // Mapeo seguro
    const leads = results.map(row => ({
      id: row.id,
      phone: maskPhone(row.phone), // Retornamos enmascarado!
      utm_source: row.utm_source,
      utm_campaign: row.utm_campaign,
      created_at: row.created_at
    }));

    return new Response(JSON.stringify({ data: leads }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    console.error('API /admin/leads/search Error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}
