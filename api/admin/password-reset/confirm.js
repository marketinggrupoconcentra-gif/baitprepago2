import { getDb } from '../../../lib/db.js';
import {
  assertSameOrigin,
  hashSessionToken,
  hashPassword,
  getClientIp,
  hashIdentity,
  sanitizeUserAgent
} from '../../../lib/admin-auth.js';
import { enqueueEmail } from '../../../lib/email.js';
import { renderPasswordChangedEmail } from '../../../lib/email-templates.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!req.headers['content-type']?.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  try {
    assertSameOrigin(req);
  } catch (_err) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { token, password } = req.body;
  if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Token and password required' });
  }

  // Basic password policy check (should match frontend)
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }

  const tokenHash = hashSessionToken(token);
  const sql = getDb();

  try {
    // Check if token exists and is valid
    const resets = await sql`
      SELECT pr.id as reset_id, pr.admin_user_id, u.email, u.active
      FROM admin_password_resets pr
      JOIN admin_users u ON u.id = pr.admin_user_id
      WHERE pr.token_hash = ${tokenHash}
        AND pr.used_at IS NULL
        AND pr.expires_at > CURRENT_TIMESTAMP
    `;

    const reset = resets[0];
    if (!reset) {
      return res.status(400).json({ error: 'El enlace de recuperación es inválido o ha expirado.' });
    }

    if (!reset.active) {
      return res.status(400).json({ error: 'La cuenta asociada está inactiva.' });
    }

    const newPasswordHash = await hashPassword(password);
    
    // Derive account hash for audit
    let accountHash = 'unknown';
    const ua = sanitizeUserAgent(req);
    try {
      accountHash = hashIdentity(`acc:${reset.email.toLowerCase().trim()}`);
    } catch (e) {
      // ignore
    }

    // Atomic transaction using CTEs
    await sql`
      WITH updated_reset AS (
        UPDATE admin_password_resets
        SET used_at = CURRENT_TIMESTAMP
        WHERE id = ${reset.reset_id}
        RETURNING id
      ),
      invalidated_others AS (
        UPDATE admin_password_resets
        SET used_at = CURRENT_TIMESTAMP
        WHERE admin_user_id = ${reset.admin_user_id}
          AND id != ${reset.reset_id}
          AND used_at IS NULL
        RETURNING id
      ),
      updated_user AS (
        UPDATE admin_users
        SET password_hash = ${newPasswordHash}
        WHERE id = ${reset.admin_user_id}
        RETURNING id
      ),
      deleted_sessions AS (
        DELETE FROM admin_sessions
        WHERE admin_user_id = ${reset.admin_user_id}
        RETURNING id
      )
      INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
      VALUES (${reset.admin_user_id}, 'PASSWORD_RESET_SUCCESS', ${accountHash}, ${JSON.stringify({ ua })})
    `;

    // Send notification
    const mxDateOptions = { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'long' };
    const dateString = new Intl.DateTimeFormat('es-MX', mxDateOptions).format(new Date());

    const emailData = renderPasswordChangedEmail(dateString);

    await enqueueEmail({
      recipient: reset.email,
      subject: emailData.subject,
      html_body: emailData.html,
      text_body: emailData.text,
      template_type: emailData.type
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('PASSWORD_RESET_CONFIRM_FAILED:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
