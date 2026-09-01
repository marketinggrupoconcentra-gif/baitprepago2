import { getDb } from '../../lib/db.js';
import { 
  parseCookies, 
  hashSessionToken,
  clearSessionCookie
} from '../../lib/admin-auth.js';

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

  const cookies = parseCookies(req);
  const token = cookies['bait_admin_session'];

  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  const tokenHash = hashSessionToken(token);
  const sql = getDb();

  try {
    const sessions = await sql`
      SELECT s.id as session_id, s.expires_at, u.id as user_id, u.email, u.role, u.active
      FROM admin_sessions s
      JOIN admin_users u ON s.admin_user_id = u.id
      WHERE s.token_hash = ${tokenHash}
    `;

    const session = sessions[0];

    if (!session) {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(401).json({ authenticated: false });
    }

    if (new Date(session.expires_at) < new Date()) {
      await sql`DELETE FROM admin_sessions WHERE id = ${session.session_id}`;
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(401).json({ authenticated: false });
    }

    if (!session.active) {
      await sql`DELETE FROM admin_sessions WHERE id = ${session.session_id}`;
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(401).json({ authenticated: false });
    }

    // Update last seen
    await sql`UPDATE admin_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ${session.session_id}`;

    return res.status(200).json({
      authenticated: true,
      user: {
        email: session.email,
        role: session.role
      }
    });

  } catch (err) {
    console.error('Session error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
