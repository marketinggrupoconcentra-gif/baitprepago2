const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
// We import bcrypt from admin-auth or directly, but wait...
// admin-auth handles bcrypt. Let's see how it generates hashes.
// Or we just use standard bcrypt since it should be installed.
const bcrypt = require('bcryptjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Faltan token o contraseña' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Verify invitation
  const invites = await sql`
    SELECT id, email, role, expires_at 
    FROM admin_invitations
    WHERE token_hash = ${tokenHash} AND status = 'PENDING'
  `;

  if (invites.length === 0) {
    return res.status(400).json({ error: 'Invitación inválida o expirada' });
  }

  const invite = invites[0];
  if (new Date(invite.expires_at) < new Date()) {
    await sql`UPDATE admin_invitations SET status = 'REVOKED' WHERE id = ${invite.id}`;
    return res.status(400).json({ error: 'La invitación ha expirado' });
  }

  // Create user
  const passwordHash = await bcrypt.hash(password, 10);
  
  try {
    const newUsers = await sql`
      INSERT INTO admin_users (email, password_hash, role, active)
      VALUES (${invite.email}, ${passwordHash}, ${invite.role}, true)
      RETURNING id
    `;
    
    // Mark as accepted
    await sql`
      UPDATE admin_invitations 
      SET status = 'ACCEPTED', accepted_by = ${newUsers[0].id}
      WHERE id = ${invite.id}
    `;

    return res.status(200).json({ success: true, message: 'Cuenta creada exitosamente. Ya puedes iniciar sesión.' });
  } catch (err) {
    if (err.code === '23505') {
      // Unique violation
      return res.status(400).json({ error: 'El correo ya está registrado en el sistema' });
    }
    console.error('Error accepting invite:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
};
