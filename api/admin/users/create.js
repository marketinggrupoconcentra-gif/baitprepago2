/**
 * api/admin/users/create.js
 * POST /api/admin/users/create
 * 
 * Crea un nuevo usuario administrador.
 * Sólo para SUPER_ADMIN.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
import { hashPassword } from '../../../lib/admin-auth.js';
import { logAdminAction } from '../../../lib/admin-audit.js';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await requireAdminSession(req, res);
    if (!user) return;

    if (!hasRole(user.role, [ROLES.SUPER_ADMIN])) {
      return res.status(403).json({ error: 'Forbidden. Requiere permisos de SUPER_ADMIN.' });
    }

    const { email, role, password } = req.body;

    if (!email || !role || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Role enum check
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Hash the password securely
    const hashedPassword = await hashPassword(password);
    
    const sql = getDb();
    
    // Check if email already exists
    const existing = await sql.query(`SELECT id FROM admin_users WHERE email = $1`, [email]);
    const existingRows = existing.rows || existing;
    if (existingRows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Insert new user
    const result = await sql.query(`
      INSERT INTO admin_users (email, role, password_hash, active)
      VALUES ($1, $2, $3, true)
      RETURNING id, email, role, active, created_at
    `, [email, role, hashedPassword]);

    const rows = result.rows || result;
    const newUser = rows[0];

    // Audit log
    await logAdminAction(user, 'USER_CREATE', { targetEmail: email, assignedRole: role });

    return res.status(201).json({ user: newUser });
  } catch (err) {
    console.error('User create error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
