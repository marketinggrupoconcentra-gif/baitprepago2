/**
 * api/admin/leads/index.js
 * GET /api/admin/leads
 * 
 * Retorna un listado de leads con paginación basada en cursor.
 * Los teléfonos se retornan ENMASCARADOS.
 * Filtros aceptados por querystring (utm_source, utm_medium, utm_campaign, fecha).
 */

const { neon } = require('@neondatabase/serverless');
const { getAdminSession } = require('../../../lib/admin-auth');
const { hasRole, ROLES } = require('../../../lib/admin-rbac');
const { maskPhone, decodeCursor, encodeCursor, sanitizeAdminUrl } = require('../../../lib/leads-utils');

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
    const url = new URL(req.url);

    // Filtros
    const source = url.searchParams.get('source');
    const medium = url.searchParams.get('medium');
    const campaign = url.searchParams.get('campaign');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    
    // Paginación
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const maxLimit = limit > 100 ? 100 : limit;
    const cursorRaw = url.searchParams.get('cursor');

    // Construcción de Query dinámica para Edge/Serverless (usando query tags de neon o arrays)
    // Neon no soporta query builder nativo sin ORMs pesados, así que haremos construcción plana con bind de parámetros
    let queryStr = `
      SELECT id, phone, utm_source, utm_medium, utm_campaign, created_at
      FROM leads
      WHERE 1=1
    `;
    const params = [];

    if (source) {
      params.push(source);
      queryStr += ` AND utm_source = $${params.length}`;
    }
    if (medium) {
      params.push(medium);
      queryStr += ` AND utm_medium = $${params.length}`;
    }
    if (campaign) {
      params.push(campaign);
      queryStr += ` AND utm_campaign = $${params.length}`;
    }
    if (dateFrom) {
      params.push(dateFrom);
      queryStr += ` AND created_at >= $${params.length}::timestamptz`;
    }
    if (dateTo) {
      params.push(dateTo);
      queryStr += ` AND created_at <= $${params.length}::timestamptz`;
    }

    // Lógica de Cursor
    const cursor = decodeCursor(cursorRaw);
    if (cursor && cursor.created_at && cursor.id) {
      params.push(cursor.created_at);
      const idxCreated = params.length;
      params.push(cursor.id);
      const idxId = params.length;
      
      // Orden DESC: buscar registros con created_at menor, o (mismo created_at Y menor id)
      queryStr += ` AND (created_at < $${idxCreated}::timestamptz OR (created_at = $${idxCreated}::timestamptz AND id < $${idxId}))`;
    }

    // Ordenamiento y Limite
    queryStr += ` ORDER BY created_at DESC, id DESC LIMIT ${maxLimit}`;

    // Ejecutar query
    // neon() en modo literal con arreglo (bypass de tag template cuando es dinámico)
    const results = await sql(queryStr, params);

    // Mapeo seguro
    const leads = results.map(row => ({
      id: row.id,
      phone: maskPhone(row.phone), // ENMASCARADO
      utm_source: row.utm_source,
      utm_medium: row.utm_medium,
      utm_campaign: row.utm_campaign,
      created_at: row.created_at
    }));

    // Siguiente cursor
    let nextCursor = null;
    if (leads.length === maxLimit) {
      const last = leads[leads.length - 1];
      nextCursor = encodeCursor({ created_at: last.created_at, id: last.id });
    }

    return new Response(JSON.stringify({ data: leads, nextCursor }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    console.error('API /admin/leads Error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}
