const { neon } = require('@neondatabase/serverless');
const { requireAdminSession } = require('../../lib/admin-session.js');
const { enqueueEmail } = require('../../lib/email');
const { renderInvitationEmail } = require('../../lib/email-templates');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  // Use centralized guard (validates cookie, origin, RBAC via requireAdminSession)
  const admin = await requireAdminSession(req, res);
  if (!admin) return;

  // Additional RBAC
  if (!['SUPER_ADMIN', 'ADMIN'].includes(admin.role)) {
    return res.status(403).json({ error: 'No tienes permisos suficientes' });
  }

  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    // List pending invitations
    const invites = await sql`
      SELECT id, email, role, status, created_at, expires_at 
      FROM admin_invitations 
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ invitations: invites });
  }

  if (req.method === 'POST') {
    // Create new invitation
    const { email, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ error: 'Faltan campos (email, role)' });
    }
    
    if (admin.role !== 'SUPER_ADMIN' && role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Solo los SUPER_ADMIN pueden crear otros SUPER_ADMIN' });
    }

    // Check if user already exists
    const existingUser = await sql`SELECT id FROM admin_users WHERE email = ${email}`;
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const publicUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;
    const inviteUrl = `${publicUrl}/admin/accept-invite.html#token=${token}`;
    
    const emailData = renderInvitationEmail(inviteUrl, role);

    // Persist and queue email atomically
    const idempotencyKey = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const { encryptPayload } = require('../../lib/email');
    const encHtml = encryptPayload(emailData.html);
    const encText = encryptPayload(emailData.text);

    try {
      await sql`
        WITH new_invitation AS (
          INSERT INTO admin_invitations (token_hash, email, role, created_by, expires_at)
          VALUES (${tokenHash}, ${email}, ${role}, ${admin.id}, NOW() + INTERVAL '24 hours')
          ON CONFLICT (email, role, status) DO UPDATE 
            SET token_hash = ${tokenHash}, expires_at = NOW() + INTERVAL '24 hours'
          RETURNING id
        )
        INSERT INTO email_outbox (
          idempotency_key, recipient, subject, html_body, text_body, template_type, status
        ) VALUES (
          ${idempotencyKey}, ${email}, ${emailData.subject}, ${encHtml}, 
          ${encText}, ${emailData.type}, 'QUEUED'
        )
      `;
    } catch (err) {
      console.error('Error in invitation transaction:', err);
      return res.status(500).json({ error: 'Error al procesar la invitación' });
    }

    return res.status(201).json({ success: true, message: 'Invitación creada y encolada' });
  }

  if (req.method === 'DELETE') {
    // Revoke invitation
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID requerido' });
    
    await sql`
      UPDATE admin_invitations 
      SET status = 'REVOKED' 
      WHERE id = ${id} AND status = 'PENDING'
    `;
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
};
