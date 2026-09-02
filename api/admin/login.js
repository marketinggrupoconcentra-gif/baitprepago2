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
  DUMMY_PASSWORD_HASH
} from '../../lib/admin-auth.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // 1. Security headers
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  // 2. Method check
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 3. Content-Type check
  if (!req.headers['content-type']?.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  // 4. Same-origin check
  try {
    assertSameOrigin(req);
  } catch (_err) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 5. Read and size-limit payload
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) {
      return res.status(413).json({ error: 'Payload too large' });
    }
  }

  // 6. Parse JSON
  let data;
  try {
    data = JSON.parse(body);
  } catch (_e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { email, password } = data;

  // 7. Validate types
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // 8. Normalize email
  const normalizedEmail = email.toLowerCase().trim();

  // 9. Derive HMAC identity keys — never store raw IP or email
  let ipHash, accountHash;
  try {
    ipHash = hashIdentity(`ip:${getClientIp(req)}`);
    accountHash = hashIdentity(`acc:${normalizedEmail}`);
  } catch (_e) {
    console.error('ADMIN_AUTH_PEPPER missing — cannot process login.');
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  const sql = getDb();
  const ua = sanitizeUserAgent(req);

  try {
    // 10. Check active rate-limit locks for both IP and ACCOUNT keys
    const locks = await sql`
      SELECT kind, locked_until
      FROM admin_login_attempts
      WHERE kind IN ('IP', 'ACCOUNT')
        AND key_hash IN (${ipHash}, ${accountHash})
        AND locked_until > CURRENT_TIMESTAMP
    `;

    if (locks.length > 0) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    // 11. Query admin user (only email — no password in SELECT result set exposure via logs)
    const users = await sql`
      SELECT id, password_hash, active
      FROM admin_users
      WHERE email = ${normalizedEmail}
    `;

    const user = users[0];

    // 12. Password verification — always exactly ONE scrypt operation regardless of user existence
    let isPasswordValid = false;
    if (user) {
      isPasswordValid = await verifyPassword(password, user.password_hash);
    } else {
      // Unknown user: run exactly one dummy scrypt to prevent timing enumeration
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      // isPasswordValid remains false
    }

    // 13. Also treat inactive users as invalid — but still run one scrypt path
    // (user was already verified above if user exists, so no extra cost)

    const isSuccess = user && user.active && isPasswordValid;

    if (!isSuccess) {
      // 14. FAILURE path: upsert rate-limit records + audit (individual DB ops, not transaction)
      const recordAttempt = async (keyHash, kind) => {
        await sql`
          INSERT INTO admin_login_attempts (key_hash, kind, attempts, window_started_at, last_attempt_at)
          VALUES (${keyHash}, ${kind}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (kind, key_hash) DO UPDATE
          SET
            attempts = CASE
              WHEN admin_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
              THEN 1
              ELSE admin_login_attempts.attempts + 1
            END,
            window_started_at = CASE
              WHEN admin_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
              THEN CURRENT_TIMESTAMP
              ELSE admin_login_attempts.window_started_at
            END,
            last_attempt_at = CURRENT_TIMESTAMP,
            locked_until = CASE
              WHEN (CASE
                      WHEN admin_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                      THEN 1
                      ELSE admin_login_attempts.attempts + 1
                    END) >= 5
              THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
              ELSE NULL
            END
        `;
      };

      // Record attempts (non-transactional — we want these even if audit fails)
      await recordAttempt(ipHash, 'IP');
      await recordAttempt(accountHash, 'ACCOUNT');

      // Audit log
      await sql`
        INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
        VALUES (
          ${user ? user.id : null},
          'LOGIN_FAILED',
          ${accountHash},
          ${JSON.stringify({ ua })}
        )
      `;

      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 15. SUCCESS path: create session and clear limits atomically using CTEs
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);

    // 15. SUCCESS path: create session and clear limits atomically using CTEs
    // CTEs avoid BEGIN/COMMIT block issues with the Neon serverless driver
    await sql`
      WITH inserted_session AS (
        INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, CURRENT_TIMESTAMP + INTERVAL '8 hours')
        RETURNING id
      ),
      deleted_attempts AS (
        DELETE FROM admin_login_attempts
        WHERE kind IN ('IP', 'ACCOUNT')
          AND key_hash IN (${ipHash}, ${accountHash})
        RETURNING id
      ),
      inserted_audit AS (
        INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
        VALUES (${user.id}, 'LOGIN_SUCCESS', ${accountHash}, ${JSON.stringify({ ua })})
        RETURNING id
      )
      UPDATE admin_users
      SET last_login_at = CURRENT_TIMESTAMP
      WHERE id = ${user.id}
    `;

    // 16. Set session cookie
    res.setHeader('Set-Cookie', serializeSessionCookie(sessionToken));

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Login handler error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
