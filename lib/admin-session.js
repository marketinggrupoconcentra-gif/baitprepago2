/**
 * lib/admin-session.js
 *
 * Centralized session guard for admin API routes.
 *
 * Usage:
 *   const user = await requireAdminSession(req, res);
 *   if (!user) return; // 401 already sent
 *
 * Returns: { id, email, role, sessionId }
 *
 * On failure: writes 401 and returns null.
 * Never exposes DB errors, tokens, or password hashes.
 */

import { getDb } from './db.js';
import { parseCookies, hashSessionToken, clearSessionCookie } from './admin-auth.js';

/**
 * Validates the session cookie from req.
 * On success returns the authenticated user object.
 * On failure sends 401 and returns null.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<{id: number, email: string, role: string, sessionId: number}|null>}
 */
export async function requireAdminSession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies['bait_admin_session'];

  if (!token) {
    res.status(401).json({ authenticated: false });
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const sql = getDb();

  try {
    const rows = await sql`
      SELECT
        s.id          AS session_id,
        s.expires_at,
        u.id          AS user_id,
        u.email,
        u.role,
        u.active
      FROM admin_sessions s
      JOIN admin_users u ON s.admin_user_id = u.id
      WHERE s.token_hash = ${tokenHash}
    `;

    const session = rows[0];

    if (!session) {
      res.setHeader('Set-Cookie', clearSessionCookie());
      res.status(401).json({ authenticated: false });
      return null;
    }

    if (new Date(session.expires_at) < new Date()) {
      await sql`DELETE FROM admin_sessions WHERE id = ${session.session_id}`;
      res.setHeader('Set-Cookie', clearSessionCookie());
      res.status(401).json({ authenticated: false });
      return null;
    }

    if (!session.active) {
      await sql`DELETE FROM admin_sessions WHERE id = ${session.session_id}`;
      res.setHeader('Set-Cookie', clearSessionCookie());
      res.status(401).json({ authenticated: false });
      return null;
    }

    // Update last_seen_at (non-blocking — do not await to keep latency low)
    sql`
      UPDATE admin_sessions
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ${session.session_id}
    `.catch(() => {}); // swallow — non-critical

    return {
      id: session.user_id,
      email: session.email,
      role: session.role,
      sessionId: session.session_id
    };

  } catch (err) {
    console.error('Session guard error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
    return null;
  }
}
