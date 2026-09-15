import 'server-only';
import { logError } from '@/lib/log';

/**
 * src/lib/email/sender.ts
 *
 * Envío de emails transaccionales con Brevo (BAIT Prepago).
 * Falla graciosamente: si BREVO_API_KEY o BREVO_FROM_EMAIL no están
 * configurados, sólo loguea un warning — nunca lanza ni revierte leads.
 */

export interface LeadConfirmationOpts {
  to: string;          // email del lead (descifrado)
  firstName: string;   // nombre del lead (descifrado)
  reference: string;   // public_reference del lead
}

/** Llama a Brevo. Retorna true si se envió, false si se omitió o falló. */
export async function sendLeadConfirmationEmail(
  opts: LeadConfirmationOpts,
): Promise<boolean> {
  const apiKey   = process.env.BREVO_API_KEY;
  const from     = process.env.BREVO_FROM_EMAIL;
  const fromName = process.env.BREVO_FROM_NAME ?? 'BAIT Prepago';

  if (!apiKey || !from) {
    console.warn(
      '[email] BREVO_API_KEY / BREVO_FROM_EMAIL no configurados — email omitido.',
    );
    return false;
  }

  try {
    const { BrevoClient } = await import('@getbrevo/brevo');
    const brevo = new BrevoClient({ apiKey });

    const { buildCouponHtml } = await import('./coupon-template');
    const html = buildCouponHtml({
      firstName: opts.firstName,
      reference: opts.reference,
    });

    await brevo.transactionalEmails.sendTransacEmail({
      sender:      { name: fromName, email: from },
      to:          [{ email: opts.to, name: opts.firstName }],
      subject:     `Tu cupón BAIT Prepago está aquí, ${opts.firstName} 🎉`,
      htmlContent: html,
    });

    return true;
  } catch (err) {
    logError('email/sender', 'brevo', err);
    return false;
  }
}
