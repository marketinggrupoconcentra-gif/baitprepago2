/**
 * src/lib/email/coupon-template.ts
 *
 * Email de confirmación de solicitud de portabilidad BAIT Prepago.
 * Solo se envía si LEAD_CONFIRMATION_EMAIL=on y Brevo está configurado.
 *
 * Diseño: inline CSS para compatibilidad máxima con Gmail, Outlook, Apple Mail.
 * NUNCA incluir: NIP, contraseñas, datos sensibles, tokens de sesión.
 */

interface CouponOpts {
  firstName: string;
  reference: string;
}

const BRAND = process.env.BREVO_FROM_NAME ?? 'BAIT Prepago';
const SITE = (process.env.APP_URL ?? 'https://www.portabilidadbait.com').replace(/\/$/, '');
const YELLOW = '#ffd400';

export function buildCouponHtml({ firstName, reference }: CouponOpts): string {
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu cupón ${escapeHtml(BRAND)}</title>
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
                A continuación encontrarás tu cupón de reemplazo de SIM. Preséntalo en cualquier tienda
                <strong style="color:#fff;">Bodega Aurrera</strong> o <strong style="color:#fff;">Walmart</strong>
                para completar tu proceso de activación.
              </p>
            </td>
          </tr>

          <!-- ══ REFERENCIA ══ -->
          <tr>
            <td style="background:#101010;padding:0 32px 12px;border-left:1px solid #222;border-right:1px solid #222;text-align:center;">
              <p style="margin:0;font-size:12px;color:#666;">
                Referencia de solicitud:
                <span style="color:${YELLOW};font-weight:700;font-family:monospace;">${escapeHtml(reference)}</span>
              </p>
            </td>
          </tr>

          <!-- ══ CUPÓN IMAGEN ══ -->
          <tr>
            <td style="background:#ffd400;padding:0;border-left:1px solid #222;border-right:1px solid #222;text-align:center;">
              <img
                src="${SITE}/assets/images/cupon-sim-bait.jpg"
                alt="Cupón de reemplazo de SIM BAIT — Proceso de reemplazo de SIM. Acude a Bodega Aurrera o Walmart y sigue las instrucciones."
                width="600"
                style="display:block;width:100%;max-width:600px;height:auto;border:0;"
              >
            </td>
          </tr>

          <!-- ══ CTA WHATSAPP ══ -->
          <tr>
            <td style="background:#101010;padding:24px 32px 28px;border-left:1px solid #222;border-right:1px solid #222;text-align:center;">
              <p style="margin:0 0 16px;color:#aaa;font-size:13px;line-height:1.6;">
                ¿Tienes dudas o necesitas ayuda con tu proceso? Contáctanos por WhatsApp.
              </p>
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
