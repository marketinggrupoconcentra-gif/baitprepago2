import { getDb } from '../../lib/db.js';
import { 
  parseCookies, 
  hashSessionToken,
  clearSessionCookie,
  assertSameOrigin,
  hashIdentity,
  getClientIp,
  sanitizeUserAgent
} from '../../lib/admin-auth.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    assertSameOrigin(req);
  } catch (err) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const cookies = parseCookies(req);
  const token = cookies['bait_admin_session'];

  // Clear cookie always
  res.setHeader('Set-Cookie', clearSessionCookie());

  if (!token) {
    return res.status(200).json({ ok: true });
  }

  const tokenHash = hashSessionToken(token);
  const sql = getDb();

  try {
    const sessions = await sql`
      DELETE FROM admin_sessions
      WHERE token_hash = ${tokenHash}
      RETURNING admin_user_id
    `;

    const session = sessions[0];
    
    if (session) {
      const accountHash = hashIdentity(`ip:${getClientIp(req)}`); // Using IP hash since we don't have email. Or we can just use the user ID.
      const ua = sanitizeUserAgent(req);
      await sql`
        INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
        VALUES (${session.admin_user_id}, 'LOGOUT', ${accountHash}, ${JSON.stringify({ ua })})
      `;
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
