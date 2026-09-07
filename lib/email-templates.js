/**
 * Email templates generation
 */

function layout(content) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f7f9fa; margin: 0; padding: 0; color: #1a1f36; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .header { background-color: #f9d800; padding: 24px; text-align: center; } /* BAIT yellow approx */
    .header h1 { margin: 0; font-size: 24px; color: #1a1f36; letter-spacing: -0.5px; }
    .content { padding: 32px; font-size: 16px; line-height: 1.6; }
    .footer { padding: 24px; text-align: center; font-size: 12px; color: #8792a2; background: #f7f9fa; border-top: 1px solid #e3e8ee; }
    .btn { display: inline-block; background-color: #0047fa; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: 600; margin-top: 16px; }
    .btn:hover { background-color: #0036d0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BAIT Prepago</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      Este es un correo automático de la plataforma BAIT Prepago.<br>
      © ${new Date().getFullYear()} Wal-Mart Innovación, S. de R.L. de C.V.
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * @param {string} inviteUrl 
 * @param {string} role 
 */
function renderInvitationEmail(inviteUrl, role) {
  const html = layout(`
    <h2>Invitación para administrar BAIT Prepago</h2>
    <p>Has sido invitado para unirte al panel de administración de BAIT Prepago con el rol de <strong>${role}</strong>.</p>
    <p>Haz clic en el siguiente botón para aceptar la invitación y configurar tu contraseña. Este enlace expirará en 24 horas.</p>
    <div style="text-align: center;">
      <a href="${inviteUrl}" class="btn" style="color: #ffffff;">Aceptar Invitación</a>
    </div>
    <p style="margin-top: 32px; font-size: 14px; color: #555;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
    <p style="font-size: 14px; word-break: break-all;"><a href="${inviteUrl}">${inviteUrl}</a></p>
  `);

  const text = `
Has sido invitado para administrar BAIT Prepago con el rol de ${role}.

Para aceptar la invitación, visita el siguiente enlace (expira en 24 horas):
${inviteUrl}
  `.trim();

  return { subject: 'Invitación a BAIT Prepago', html, text, type: 'INVITATION' };
}

/**
 * @param {Object} data 
 * @param {string} period 
 */
function renderReportEmail(data, period) {
  const html = layout(`
    <h2>Reporte de Captación de Leads</h2>
    <p>A continuación se presenta el resumen de captación para el periodo: <strong>${period}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 24px;">
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;"><strong>Leads Totales</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${data.totalLeads}</td>
      </tr>
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;"><strong>Desde Orgánico</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${data.organicLeads}</td>
      </tr>
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;"><strong>Desde Pagado</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${data.paidLeads}</td>
      </tr>
    </table>
    <div style="text-align: center;">
      <a href="${process.env.PUBLIC_URL || 'https://baitprepago.com'}/admin/" class="btn" style="color: #ffffff;">Ver detalles en el panel</a>
    </div>
  `);

  const text = `
Reporte de Captación BAIT Prepago - ${period}

Leads Totales: ${data.totalLeads}
Orgánico: ${data.organicLeads}
Pagado: ${data.paidLeads}
  `.trim();

  return { subject: `Reporte BAIT Prepago: ${period}`, html, text, type: 'REPORT' };
}

/**
 * @param {string} resetUrl 
 */
function renderPasswordResetEmail(resetUrl) {
  const html = layout(`
    <h2>Restablecer contraseña</h2>
    <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de administración en BAIT Prepago.</p>
    <p>Haz clic en el siguiente botón para configurar tu nueva contraseña. Este enlace expirará en 30 minutos.</p>
    <div style="text-align: center;">
      <a href="${resetUrl}" class="btn" style="color: #ffffff;">Restablecer contraseña</a>
    </div>
    <p style="margin-top: 32px; font-size: 14px; color: #555;">Si no solicitaste este cambio, puedes ignorar este correo de forma segura. Tu cuenta permanece protegida.</p>
  `);

  const text = `
Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de administración en BAIT Prepago.

Para configurar tu nueva contraseña, visita el siguiente enlace (expira en 30 minutos):
${resetUrl}

Si no solicitaste este cambio, puedes ignorar este correo de forma segura.
  `.trim();

  return { subject: 'Restablece tu contraseña — BAIT Prepago', html, text, type: 'SECURITY' };
}

/**
 * @param {string} dateString 
 */
function renderPasswordChangedEmail(dateString) {
  const html = layout(`
    <h2>Contraseña actualizada exitosamente</h2>
    <p>Te confirmamos que la contraseña de tu cuenta de administración en BAIT Prepago ha sido actualizada.</p>
    <p><strong>Fecha y hora del cambio:</strong> ${dateString}</p>
    <p>Si realizaste este cambio, no es necesario hacer nada más.</p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="${process.env.PUBLIC_URL || 'https://baitprepago.com'}/admin/" class="btn" style="color: #ffffff;">Iniciar sesión</a>
    </div>
    <p style="margin-top: 32px; font-size: 14px; color: #555; background: #fff3cd; padding: 12px; border-left: 4px solid #ffc107;">
      <strong>Advertencia de seguridad:</strong> Si NO realizaste este cambio, contacta inmediatamente a tu administrador, ya que tu cuenta podría estar comprometida.
    </p>
  `);

  const text = `
Te confirmamos que la contraseña de tu cuenta de administración en BAIT Prepago ha sido actualizada.

Fecha y hora del cambio: ${dateString}

Si NO realizaste este cambio, contacta inmediatamente a tu administrador.
  `.trim();

  return { subject: 'Tu contraseña fue actualizada — BAIT Prepago', html, text, type: 'SECURITY' };
}

module.exports = {
  renderInvitationEmail,
  renderReportEmail,
  renderPasswordResetEmail,
  renderPasswordChangedEmail
};
