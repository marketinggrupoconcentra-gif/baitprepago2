/**
 * api/admin/leads/reveal-phone.js
 * POST /api/admin/leads/reveal-phone
 * 
 * Obtiene el teléfono crudo por ID de lead. Solo SUPER_ADMIN. 
 * Audita LEAD_PHONE_REVEAL. Caché no-store. Fail-closed si falla auditoría.
 */

const { neon } = require('@neondatabase/serverless');
const { getAdminSession, assertSameOrigin } = require('../../../lib/admin-auth');
const { hasRole, ROLES } = require('../../../lib/admin-rbac');
const { logAdminAction } = require('../../../lib/admin-audit');

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
    const { id } = body;
    const parsedId = parseInt(id);

    if (!parsedId || isNaN(parsedId)) {
      return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });
    }

    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) throw new Error('DB Config Error');

    // Registrar auditoría ANTES de devolver la información
    const ip = req.headers.get('x-forwarded-for') || '';
    const ua = req.headers.get('user-agent') || '';
    await logAdminAction(session.email, 'LEAD_PHONE_REVEAL', parsedId.toString(), ip, ua);

    const sql = neon(dbUrl);

    // Obtener el teléfono crudo
    const results = await sql`
      SELECT phone
      FROM leads
      WHERE id = ${parsedId}
      LIMIT 1
    `;

    if (results.length === 0) {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    }

    const phoneRaw = results[0].phone;

    return new Response(JSON.stringify({ phone: phoneRaw }), { 
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      } 
    });

  } catch (err) {
    console.error('API /admin/leads/reveal-phone Error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}
