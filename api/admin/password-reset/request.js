import { getDb } from '../../../lib/db.js';
import {
  assertSameOrigin,
  getClientIp,
  hashIdentity,
  generateSessionToken,
  hashSessionToken,
  DUMMY_PASSWORD_HASH,
  verifyPassword
} from '../../../lib/admin-auth.js';
import { enqueueEmail } from '../../../lib/email.js';
import { renderPasswordResetEmail } from '../../../lib/email-templates.js';

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

  // 5. Read payload
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // 6. Derive HMAC identity keys
  let ipHash, accountHash;
  try {
    ipHash = hashIdentity(`ip:${getClientIp(req)}`);
    accountHash = hashIdentity(`acc:${normalizedEmail}`);
  } catch (_e) {
    console.error('ADMIN_AUTH_PEPPER missing — cannot process password reset request.');
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  const sql = getDb();

  try {
    // 7. Check active rate-limit locks for both IP and ACCOUNT keys
    // Using same 'admin_login_attempts' table but different kind to avoid overlapping limits. Wait,
    // let's just use kind='IP_RESET' and 'ACC_RESET'. We need to record attempts though.
    const locks = await sql`
      SELECT kind, locked_until
      FROM admin_login_attempts
      WHERE kind IN ('IP_RESET', 'ACC_RESET')
        AND key_hash IN (${ipHash}, ${accountHash})
        AND locked_until > CURRENT_TIMESTAMP
    `;

    if (locks.length > 0) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Por favor, intenta más tarde.' });
    }

    // Rate limit recording function
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
                  END) >= 3
            THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
            ELSE NULL
          END
      `;
    };

    await recordAttempt(ipHash, 'IP_RESET');
    await recordAttempt(accountHash, 'ACC_RESET');

    // 8. Query admin user (only email)
    const users = await sql`
      SELECT id, active
      FROM admin_users
      WHERE email = ${normalizedEmail}
    `;

    const user = users[0];

    // Dummy operation to prevent timing enumeration
    // We don't have a password to verify, but we can do a dummy scrypt just in case.
    // Actually for password reset, simple constant time query is usually enough. But let's run the dummy verify.
    if (!user) {
      await verifyPassword('dummy_request', DUMMY_PASSWORD_HASH);
    } else {
      await verifyPassword('dummy_request', DUMMY_PASSWORD_HASH);
    }

    if (user && user.active) {
      // 9. Create recovery token
      const token = generateSessionToken(); // 32 bytes hex
      const tokenHash = hashSessionToken(token); // sha256 hex

      // Insert token
      await sql`
        INSERT INTO admin_password_resets (admin_user_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, CURRENT_TIMESTAMP + INTERVAL '30 minutes')
      `;

      // 10. Queue email
      const publicUrl = process.env.PUBLIC_URL || `https://${req.headers.host}`;
      const resetUrl = `${publicUrl}/admin/reset-password.html#token=${token}`;
      
      const emailData = renderPasswordResetEmail(resetUrl);

      await enqueueEmail({
        recipient: normalizedEmail,
        subject: emailData.subject,
        html_body: emailData.html,
        text_body: emailData.text,
        template_type: emailData.type
      });
    }

    // Always return 200 OK
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('PASSWORD_RESET_REQUEST_FAILED:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
