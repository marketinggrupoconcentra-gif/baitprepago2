/**
 * src/lib/integrations/meta-capi.ts — Meta Conversions API (server-side)
 *
 * Envía eventos al Pixel desde el servidor, deduplicados con el Pixel del
 * navegador por `event_id` (el mismo uuid que usa bait-analytics.js).
 * PII: solo hashes SHA-256 normalizados (em, ph) según la guía de Meta.
 */
import 'server-only';
import { createHash } from 'crypto';
import type { MetaCapiConfig } from './config';

const GRAPH_VERSION = 'v21.0';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function hashedEmailForMeta(email: string): string {
  return sha256(email.trim().toLowerCase());
}
/** Meta exige el teléfono con código de país y solo dígitos (52 + 10 dígitos en México). */
export function hashedPhoneForMeta(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return sha256(digits.length === 10 ? `52${digits}` : digits);
}
/** Cookie _fbc sintetizada a partir del fbclid: fb.1.<ms del click>.<fbclid> */
export function fbcFromClickId(fbclid: string, clickedAt: Date): string {
  return `fb.1.${clickedAt.getTime()}.${fbclid}`;
}

export interface MetaEventInput {
  eventName: 'Lead' | 'Purchase';
  eventId: string;
  occurredAt: Date;
  sourceUrl?: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  fbclid?: string;
  fbp?: string;
  userAgent?: string;
  value?: number;
}

export interface MetaEventResult {
  ok: boolean;
  error?: string;
  retryable?: boolean;
}

export async function sendMetaEvent(cfg: MetaCapiConfig, input: MetaEventInput): Promise<MetaEventResult> {
  const userData: Record<string, unknown> = {};
  if (input.email) userData.em = [hashedEmailForMeta(input.email)];
  if (input.phone) userData.ph = [hashedPhoneForMeta(input.phone)];
  if (input.firstName) userData.fn = [sha256(input.firstName.trim().toLowerCase())];
  if (input.lastName) userData.ln = [sha256(input.lastName.trim().toLowerCase())];
  if (input.fbclid) userData.fbc = fbcFromClickId(input.fbclid, input.occurredAt);
  if (input.fbp) userData.fbp = input.fbp;
  if (input.userAgent) userData.client_user_agent = input.userAgent;
  userData.country = [sha256('mx')];

  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: Math.floor(input.occurredAt.getTime() / 1000),
    event_id: input.eventId,
    action_source: 'website',
    ...(input.sourceUrl ? { event_source_url: input.sourceUrl } : {}),
    user_data: userData,
    ...(input.value != null ? { custom_data: { currency: 'MXN', value: input.value } } : {}),
  };

  const body: Record<string, unknown> = { data: [event] };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (res.ok) return { ok: true };

  let code = `http_${res.status}`;
  try {
    const j = (await res.json()) as { error?: { code?: number; message?: string } };
    if (j.error) code = `${j.error.code ?? res.status}: ${(j.error.message ?? '').slice(0, 160)}`;
  } catch { /* cuerpo no JSON */ }
  // 4xx (token inválido, pixel incorrecto, payload rechazado) no se arregla reintentando.
  return { ok: false, error: code, retryable: res.status >= 500 || res.status === 429 };
}
