import { getDb } from '../../lib/db.js';
import { 
  hashIdentity, 
  verifyPassword, 
  generateSessionToken, 
  hashSessionToken, 
  serializeSessionCookie, 
  assertSameOrigin,
  getClientIp,
  sanitizeUserAgent,
  hashPassword // For dummy verification
} from '../../lib/admin-auth.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // 1. no-store headers
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  // 2. method check
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 3. content-type
  if (!req.headers['content-type']?.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  // 5. same-origin
  try {
    assertSameOrigin(req);
  } catch (err) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 4. payload size & read
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) {
      return res.status(413).json({ error: 'Payload too large' });
    }
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { email, password } = data;

  // 6. validate email/password
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // 7. normalize email
  const normalizedEmail = email.toLowerCase().trim();

  // 8. derive HMAC identity keys
  let ipHash, accountHash;
  try {
    ipHash = hashIdentity(`ip:${getClientIp(req)}`);
    accountHash = hashIdentity(`acc:${normalizedEmail}`);
  } catch (e) {
    console.error('Configuration error:', e.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  const sql = getDb();

  try {
    // 9. check rate-limit locks
    const locks = await sql`
      SELECT kind, locked_until 
      FROM admin_login_attempts 
      WHERE key_hash IN (${ipHash}, ${accountHash}) 
        AND locked_until > CURRENT_TIMESTAMP
    `;
    if (locks.length > 0) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    // 10. query admin user
    const users = await sql`
      SELECT id, password_hash, active 
      FROM admin_users 
      WHERE email = ${normalizedEmail}
    `;

    const user = users[0];

    // 11. real/dummy password verify (Defense against timing enumeration)
    let isPasswordValid = false;
    if (user) {
      isPasswordValid = await verifyPassword(password, user.password_hash);
    } else {
      // dummy verification to mitigate timing attacks
      const dummyHash = await hashPassword('dummy_password_for_timing');
      await verifyPassword(password, dummyHash);
    }

    const ua = sanitizeUserAgent(req);

    if (!user || !user.active || !isPasswordValid) {
      // 12. failure -> increment attempts + audit
      
      const recordAttempt = async (keyHash, kind) => {
        await sql`
          INSERT INTO admin_login_attempts (key_hash, kind, attempts, window_started_at, last_attempt_at)
          VALUES (${keyHash}, ${kind}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (key_hash) DO UPDATE
          SET 
            attempts = CASE 
              WHEN admin_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 1
              ELSE admin_login_attempts.attempts + 1
            END,
            window_started_at = CASE 
              WHEN admin_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN CURRENT_TIMESTAMP
              ELSE admin_login_attempts.window_started_at
            END,
            last_attempt_at = CURRENT_TIMESTAMP,
            locked_until = CASE 
              WHEN (CASE 
                      WHEN admin_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 1
                      ELSE admin_login_attempts.attempts + 1
                    END) >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
              ELSE NULL
            END
        `;
      };

      // We don't want a transaction here because we want attempts recorded even if audit fails
      await recordAttempt(ipHash, 'IP');
      await recordAttempt(accountHash, 'ACCOUNT');
      
      await sql`
        INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
        VALUES (
          ${user ? user.id : null}, 
          'LOGIN_FAILED', 
          ${accountHash}, 
          ${JSON.stringify({ reason: 'invalid_credentials', ua })}
        )
      `;

      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 13. success -> transaction
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);

    await sql.begin(async (tx) => {
      // crear session
      await tx`
        INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, CURRENT_TIMESTAMP + INTERVAL '8 hours')
      `;
      // limpiar login attempts
      await tx`
        DELETE FROM admin_login_attempts 
        WHERE key_hash IN (${ipHash}, ${accountHash})
      `;
      // registrar LOGIN_SUCCESS
      await tx`
        INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
        VALUES (${user.id}, 'LOGIN_SUCCESS', ${accountHash}, ${JSON.stringify({ ua })})
      `;
      // actualizar last_login_at
      await tx`
        UPDATE admin_users 
        SET last_login_at = CURRENT_TIMESTAMP 
        WHERE id = ${user.id}
      `;
    });

    // 15. Set-Cookie
    res.setHeader('Set-Cookie', serializeSessionCookie(sessionToken));

    // 16. minimal JSON response
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
