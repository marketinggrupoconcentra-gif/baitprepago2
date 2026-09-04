/**
 * api/admin/users/update.js
 * POST /api/admin/users/update
 * 
 * Actualiza el rol o estado (activo/inactivo) de un usuario administrador.
 * Sólo para SUPER_ADMIN.
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
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

    const { id, role, active } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Missing user id' });
    }
    
    // Prevent self-modification for safety to avoid locking out the only super admin
    if (id === user.id) {
      return res.status(403).json({ error: 'Cannot modify your own user account from this interface.' });
    }

    const sql = getDb();

    // Verify user exists
    const existing = await sql.query(`SELECT email FROM admin_users WHERE id = $1`, [id]);
    const existingRows = existing.rows || existing;
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const targetEmail = existingRows[0].email;

    let updateFields = [];
    let params = [];
    let paramIndex = 1;

    if (role) {
      if (!Object.values(ROLES).includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      updateFields.push(`role = $${paramIndex++}`);
      params.push(role);
    }

    if (typeof active === 'boolean') {
      updateFields.push(`active = $${paramIndex++}`);
      params.push(active);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

    params.push(id);
    
    const result = await sql.query(`
      UPDATE admin_users
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, role, active, updated_at
    `, params);

    const rows = result.rows || result;
    const updatedUser = rows[0];

    // If disabled, kill their sessions
    if (active === false) {
      await sql.query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [id]);
    }

    // Audit log
    await logAdminAction(user, 'USER_UPDATE', { targetId: id, targetEmail, updatedRole: role, updatedActive: active });

    return res.status(200).json({ user: updatedUser });
  } catch (err) {
    console.error('User update error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
