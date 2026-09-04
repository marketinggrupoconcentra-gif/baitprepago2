/**
 * api/admin/users/index.js
 * GET /api/admin/users
 * 
 * Lista todos los usuarios administrativos.
 * Sólo para SUPER_ADMIN y ADMIN.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';

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

    if (!hasRole(user.role, [ROLES.SUPER_ADMIN, ROLES.ADMIN])) {
      return res.status(403).json({ error: 'Forbidden. Requiere permisos de administrador.' });
    }

    const sql = getDb();
    
    // Select users without exposing password hashes
    const result = await sql.query(`
      SELECT 
        id, 
        email, 
        role, 
        active, 
        created_at, 
        last_login_at 
      FROM admin_users 
      ORDER BY id ASC
    `);

    return res.status(200).json({ users: result.rows || result });
  } catch (err) {
    console.error('Users list error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
