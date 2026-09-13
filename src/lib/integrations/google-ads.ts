/**
 * src/lib/integrations/google-ads.ts — Cliente de Google Ads (API v24 vía google-ads-api)
 *
 * Usado por:
 *  - /api/cron/google-ads     → métricas de campañas (app.ads_metrics)
 *  - /api/cron/conversions    → importación de conversiones offline (ClickConversion)
 *
 * Credenciales: app.settings con fallback a env (src/lib/integrations/config.ts).
 */
import 'server-only';
import { createHash } from 'crypto';
import { GoogleAdsApi, type Customer } from 'google-ads-api';
import type { GoogleAdsConfig } from './config';

export function createGoogleAdsCustomer(cfg: GoogleAdsConfig): Customer {
  const client = new GoogleAdsApi({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    developer_token: cfg.developerToken,
  });
  return client.Customer({
    customer_id: cfg.customerId,
    refresh_token: cfg.refreshToken,
    ...(cfg.loginCustomerId ? { login_customer_id: cfg.loginCustomerId } : {}),
  });
}

/** Formato exigido por Google Ads: "yyyy-mm-dd hh:mm:ss+hh:mm" (usamos UTC). */
export function toGoogleAdsDateTime(d: Date): string {
  const iso = d.toISOString(); // 2026-09-13T15:44:32.123Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Normalización que exige Google para Enhanced Conversions for Leads. */
export function hashedEmailForGoogle(email: string): string {
  return sha256(email.trim().toLowerCase());
}
/** Teléfono en E.164 (+52 para 10 dígitos mexicanos) y luego SHA-256. */
export function hashedPhoneForGoogle(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const e164 = digits.length === 10 ? `+52${digits}` : `+${digits}`;
  return sha256(e164);
}

export interface ClickConversionInput {
  conversionActionId: string;
  occurredAt: Date;
  orderId: string;
  value?: number;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  /** Enhanced Conversions for Leads cuando no hay click id. */
  email?: string;
  phone?: string;
}

export interface ClickConversionResult {
  ok: boolean;
  /** Código corto para conversion_deliveries.last_error (sin PII). */
  error?: string;
  retryable?: boolean;
}

/**
 * Sube una conversión. Devuelve ok=false con un código corto si Google la rechaza.
 * Errores de red/credenciales se lanzan (el cron decide el reintento).
 */
export async function uploadClickConversion(cfg: GoogleAdsConfig, input: ClickConversionInput): Promise<ClickConversionResult> {
  const customer = createGoogleAdsCustomer(cfg);

  const identifiers: Array<Record<string, unknown>> = [];
  if (!input.gclid && !input.gbraid && !input.wbraid) {
    if (input.email) identifiers.push({ hashed_email: hashedEmailForGoogle(input.email) });
    if (input.phone) identifiers.push({ hashed_phone_number: hashedPhoneForGoogle(input.phone) });
    if (identifiers.length === 0) return { ok: false, error: 'no_click_id_or_identifiers', retryable: false };
  }

  const conversion: Record<string, unknown> = {
    conversion_action: `customers/${cfg.customerId}/conversionActions/${input.conversionActionId}`,
    conversion_date_time: toGoogleAdsDateTime(input.occurredAt),
    currency_code: 'MXN',
    order_id: input.orderId,
    ...(input.value != null ? { conversion_value: input.value } : {}),
    ...(input.gclid ? { gclid: input.gclid } : {}),
    ...(input.gbraid ? { gbraid: input.gbraid } : {}),
    ...(input.wbraid ? { wbraid: input.wbraid } : {}),
    ...(identifiers.length ? { user_identifiers: identifiers } : {}),
  };

  const res = await customer.conversionUploads.uploadClickConversions({
    customer_id: cfg.customerId,
    conversions: [conversion],
    partial_failure: true,
  } as never);

  const partial = (res as { partial_failure_error?: { message?: string } | null }).partial_failure_error;
  if (partial) {
    const msg = (partial.message ?? 'partial_failure').slice(0, 200);
    // Conversiones ya subidas o click ids inválidos no se reintentan.
    const permanent = /already|duplicate|invalid|not found|too old|expired|CLICK_NOT_FOUND|CONVERSION_PRECEDES_CLICK/i.test(msg);
    return { ok: false, error: msg, retryable: !permanent };
  }
  return { ok: true };
}
