const { neon } = require('@neondatabase/serverless');
const { requireAdminAuth } = require('../../lib/admin-auth');
const { enqueueEmail } = require('../../lib/email');
const { renderInvitationEmail } = require('../../lib/email-templates');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  const admin = await requireAdminAuth(req, res, { roles: ['SUPER_ADMIN', 'ADMIN'] });
  if (!admin) return;

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

    // Persist
    const result = await sql`
      INSERT INTO admin_invitations (token_hash, email, role, created_by, expires_at)
      VALUES (${tokenHash}, ${email}, ${role}, ${admin.id}, NOW() + INTERVAL '24 hours')
      ON CONFLICT (email, role, status) DO UPDATE 
        SET token_hash = ${tokenHash}, expires_at = NOW() + INTERVAL '24 hours'
      RETURNING id, expires_at
    `;

    // Queue email
    const publicUrl = process.env.PUBLIC_URL || `https://${req.headers.host}`;
    const inviteUrl = `${publicUrl}/admin/accept-invite.html?token=${token}`;
    
    const emailData = renderInvitationEmail(inviteUrl, role);

    await enqueueEmail({
      recipient: email,
      subject: emailData.subject,
      html_body: emailData.html,
      text_body: emailData.text,
      template_type: emailData.type
    });

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
