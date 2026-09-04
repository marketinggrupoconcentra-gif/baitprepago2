/**
 * api/admin/settings/password.js
 * POST /api/admin/settings/password
 * 
 * Cambia la contraseña del usuario autenticado.
 * Requiere la contraseña actual para verificar.
 * Invalida todas las sesiones activas (requiere re-login).
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { verifyPassword, hashPassword, clearSessionCookie } from '../../../lib/admin-auth.js';
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

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    const sql = getDb();

    // Get current hash
    const userRow = await sql.query(`SELECT password_hash FROM admin_users WHERE id = $1`, [user.id]);
    const rows = userRow.rows || userRow;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password_hash } = rows[0];

    // Verify current password
    const isMatch = await verifyPassword(currentPassword, password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }

    // Hash new password
    const newHash = await hashPassword(newPassword);

    // Update DB
    await sql.query(`
      UPDATE admin_users 
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $2
    `, [newHash, user.id]);

    // Invalidate ALL sessions for this user, forcing re-login
    await sql.query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [user.id]);

    // Audit log
    await logAdminAction(user, 'PASSWORD_CHANGE', { userId: user.id });

    // Clear current cookie
    res.setHeader('Set-Cookie', clearSessionCookie());

    return res.status(200).json({ message: 'Contraseña actualizada exitosamente' });
  } catch (err) {
    console.error('Password change error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
