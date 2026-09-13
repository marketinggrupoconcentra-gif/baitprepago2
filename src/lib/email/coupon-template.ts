/**
 * src/lib/email/coupon-template.ts
 *
 * Email de confirmación de solicitud de portabilidad BAIT Prepago.
 * Solo se envía si LEAD_CONFIRMATION_EMAIL=on y Resend está configurado
 * (el backend original de la landing no enviaba correo al lead).
 *
 * Diseño: inline CSS para compatibilidad máxima con Gmail, Outlook, Apple Mail.
 * NUNCA incluir: NIP, contraseñas, datos sensibles, tokens de sesión.
 */

interface CouponOpts {
  firstName: string;
  reference: string;
}

const BRAND = process.env.RESEND_FROM_NAME ?? 'BAIT Prepago';
const SITE = (process.env.APP_URL ?? 'https://baitprepago.com').replace(/\/$/, '');
const YELLOW = '#ffd400';

export function buildCouponHtml({ firstName, reference }: CouponOpts): string {
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu solicitud ${escapeHtml(BRAND)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

          <!-- ══ HEADER ══ -->
          <tr>
            <td style="background:#080808;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
              <img src="${SITE}/assets/images/logo-bait-user.png"
                   alt="BAIT" width="110" style="display:block;margin:0 auto 12px;height:auto;">
              <p style="margin:0;color:${YELLOW};font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">
                ✅ Solicitud recibida
              </p>
            </td>
          </tr>

          <!-- ══ BIENVENIDA ══ -->
          <tr>
            <td style="background:#101010;padding:28px 32px 20px;border-left:1px solid #222;border-right:1px solid #222;">
              <h1 style="margin:0 0 8px;color:#fff;font-size:22px;font-weight:900;line-height:1.2;">
                ¡Hola, ${escapeHtml(firstName)}!
              </h1>
              <p style="margin:0;color:#aaa;font-size:14px;line-height:1.6;">
                Recibimos tu solicitud de portabilidad a <strong style="color:#fff;">${escapeHtml(BRAND)}</strong>.
                Un asesor te contactará por WhatsApp para completar el proceso y activar tu plan.
              </p>
            </td>
          </tr>

          <!-- ══ RESUMEN PLAN ══ -->
          <tr>
            <td style="background:#101010;padding:20px 32px;border-left:1px solid #222;border-right:1px solid #222;">
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:#0d0d0d;border:1px solid #222;border-radius:12px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <p style="margin:0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Plan solicitado</p>
                          <p style="margin:4px 0 0;font-size:16px;font-weight:900;color:#fff;">BAIT Prepago · 36 GB</p>
                          <p style="margin:4px 0 0;font-size:12px;color:#aaa;">Redes sociales ilimitadas · Tu número se queda</p>
                        </td>
                        <td align="right" style="white-space:nowrap;">
                          <p style="margin:0;font-size:24px;font-weight:900;color:#fff;">$100</p>
                          <p style="margin:0;font-size:11px;color:${YELLOW};font-weight:700;">/ mes</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;font-size:12px;color:#666;text-align:center;">
                Referencia de solicitud: <span style="color:${YELLOW};font-weight:700;font-family:monospace;">${escapeHtml(reference)}</span>
              </p>
            </td>
          </tr>

          <!-- ══ CTA WHATSAPP ══ -->
          <tr>
            <td style="background:#101010;padding:16px 32px 28px;border-left:1px solid #222;border-right:1px solid #222;text-align:center;">
              <a href="https://api.whatsapp.com/send/?phone=5215548268533&text=%C2%A1Hola%21+Acabo+de+registrar+mi+solicitud+de+portabilidad+en+la+p%C3%A1gina+y+me+gustar%C3%ADa+darle+seguimiento+inmediato&type=phone_number&app_absent=0"
                 style="display:inline-block;background:#25D366;color:#052e16;font-size:13px;font-weight:900;text-decoration:none;padding:12px 24px;border-radius:10px;text-transform:uppercase;letter-spacing:.4px;">
                💬 Dar seguimiento por WhatsApp
              </a>
            </td>
          </tr>

          <!-- ══ FOOTER ══ -->
          <tr>
            <td style="background:#080808;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;border-top:1px solid #1a1a1a;">
              <p style="margin:0;font-size:11px;color:#555;line-height:1.6;">
                Este correo fue enviado porque registraste una solicitud de portabilidad en ${escapeHtml(BRAND)}.<br>
                <a href="${SITE}/aviso-de-privacidad/" style="color:#777;">Aviso de Privacidad</a> · © ${year} · Todos los derechos reservados
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Escapa caracteres HTML para prevenir XSS en el template. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
