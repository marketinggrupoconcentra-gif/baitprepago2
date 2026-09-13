import 'server-only';
import { logError } from '@/lib/log';

/**
 * src/lib/email/sender.ts
 *
 * Envío de emails transaccionales con Resend (BAIT Prepago).
 * Falla graciosamente: si RESEND_API_KEY o RESEND_FROM_EMAIL no están
 * configurados, sólo loguea un warning — nunca lanza ni revierte leads.
 */

export interface LeadConfirmationOpts {
  to: string;          // email del lead (descifrado)
  firstName: string;   // nombre del lead (descifrado)
  reference: string;   // public_reference del lead
}

/** Llama a Resend. Retorna true si se envió, false si se omitió o falló. */
export async function sendLeadConfirmationEmail(
  opts: LeadConfirmationOpts,
): Promise<boolean> {
  const { getSetting } = await import('@/lib/settings');
  const apiKey  = await getSetting('resend_api_key', process.env.RESEND_API_KEY);
  const from    = process.env.RESEND_FROM_EMAIL;
  const fromName = process.env.RESEND_FROM_NAME ?? 'BAIT Prepago';

  if (!apiKey || !from) {
    console.warn(
      '[email] RESEND_API_KEY / RESEND_FROM_EMAIL no configurados — email omitido.',
    );
    return false;
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);

    const { buildCouponHtml } = await import('./coupon-template');
    const html = buildCouponHtml({ firstName: opts.firstName, reference: opts.reference });

    const { error } = await resend.emails.send({
      from: `${fromName} <${from}>`,
      to:   [opts.to],
      subject: `Recibimos tu solicitud de portabilidad BAIT Prepago, ${opts.firstName}`,
      html,
    });

    if (error) {
      logError('email/sender', 'resend', error);
      return false;
    }

    return true;
  } catch (err) {
    logError('email/sender', 'unexpected', err);
    return false;
  }
}
