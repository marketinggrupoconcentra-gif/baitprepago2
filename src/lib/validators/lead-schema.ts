import { z } from 'zod';

// ── Estados de México (allowlist oficial — 32 entidades) ──────────────────────
// El formulario BAIT Prepago NO pide estado; se conserva el catálogo por si la
// landing lo incorpora (leads.state_code es opcional).
export const MEXICO_STATES = [
  'AG', 'BC', 'BS', 'CM', 'CS', 'CH', 'CO', 'CL', 'DF', 'DG',
  'GT', 'GR', 'HG', 'JC', 'MC', 'MN', 'MS', 'NT', 'NL', 'OA',
  'PU', 'QT', 'QR', 'SL', 'SI', 'SO', 'TB', 'TM', 'TL', 'VZ',
  'YN', 'ZS',
] as const;

export type MexicoStateCode = typeof MEXICO_STATES[number];

// ── Ventana de vigencia del NIP (regla de negocio de portabilidad prepago) ────
// Si el NIP coincide con los últimos 4 dígitos del teléfono, la landing exige
// una fecha de vigencia entre hoy (CDMX) y hoy + 5 días naturales.
export const NIP_VALIDITY_MAX_DAYS = 5;
const BUSINESS_TZ = 'America/Mexico_City';

export function todayBusinessDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const v: Record<string, string> = {};
  for (const p of parts) v[p.type] = p.value;
  return `${v.year}-${v.month}-${v.day}`;
}

function addCivilDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function isWithinNipValidityWindow(dateOnly: string, now: Date = new Date()): boolean {
  const today = todayBusinessDate(now);
  return dateOnly >= today && dateOnly <= addCivilDays(today, NIP_VALIDITY_MAX_DAYS);
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_RE = /^[\p{L}\p{M}'\-.\s]+$/u;
const cleanName = (max: number) =>
  z.string()
    .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(1).max(max).regex(NAME_RE, 'Caracteres no válidos.'));

const nullableText = (max: number) =>
  z.string().max(max).nullable().optional().transform((v) => (v ? v : undefined));

// ── Zod Schema estricto para POST /api/leads (formulario BAIT Prepago) ────────
// schema.strict() → rechaza campos desconocidos (previene mass assignment).
// La validación aquí es la autoridad; el cliente solo valida para UX.
export const LeadInputSchema = z.object({
  // ── Portabilidad ────────────────────────────────────────────────────────
  phone: z.string().trim().regex(/^\d{10}$/, 'El número debe tener exactamente 10 dígitos.'),

  /** NIP de portabilidad: se valida y NUNCA se persiste (regla del proyecto). */
  nip: z.string().trim().regex(/^\d{4}$/, 'El NIP debe tener exactamente 4 dígitos.'),

  /** Obligatorio solo si nip == últimos 4 dígitos del teléfono (ver superRefine). */
  nip_valid_until: z.string().regex(DATE_ONLY_RE, 'Fecha inválida (YYYY-MM-DD).').nullable().optional(),

  // ── Datos personales (nombres de campo del formulario existente) ─────────
  nombre: cleanName(120),
  apellido: cleanName(160),
  email: z.string().trim().toLowerCase().min(1).max(254).email('Ingresa un email válido.'),

  // ── Consentimiento ──────────────────────────────────────────────────────────
  consent: z.literal(true, { error: 'Debes aceptar el Aviso de Privacidad.' }),

  // ── CAPTCHA propio (se consume en el handler, single-use) ────────────────
  captcha_challenge_id: z.string().uuid().nullable().optional(),
  captcha_answer: z.string().max(12).nullable().optional(),

  // ── Seguridad / Anti-bot (los añade el wiring de site.js) ────────────────
  /** Honeypot — debe estar vacío */
  website: z.literal('').optional(),
  /** Timestamp epoch ms de cuando se abrió el formulario */
  form_started_at: z.number().int().positive().optional(),
  /** Idempotency key UUID generado por el browser (uno por intento) */
  idempotency_key: z.string().uuid('Idempotency key inválida.').optional(),
  /** session_id de bait-analytics.js */
  session_id: z.string().uuid().optional(),

  // ── Atribución (la landing captura UTMs/click ids en sessionStorage) ─────
  utm_source: nullableText(255),
  utm_medium: nullableText(255),
  utm_campaign: nullableText(255),
  utm_content: nullableText(255),
  utm_term: nullableText(255),
  gclid: nullableText(512),
  fbclid: nullableText(512),
  fb_ad_id: nullableText(255),
  fb_adset_id: nullableText(255),
  fb_campaign_id: nullableText(255),
  referrer: nullableText(2048),
  page_url: nullableText(2048),
  landing_url: z.string().url().max(2048).optional(),
}).strict().superRefine((data, ctx) => {
  if (data.nip === data.phone.slice(-4)) {
    if (!data.nip_valid_until) {
      ctx.addIssue({ code: 'custom', path: ['nip_valid_until'], message: 'nip_valid_until_required' });
    } else if (!isWithinNipValidityWindow(data.nip_valid_until)) {
      ctx.addIssue({ code: 'custom', path: ['nip_valid_until'], message: 'nip_valid_until_out_of_range' });
    }
  }
});

export type LeadInput = z.infer<typeof LeadInputSchema>;

/**
 * Códigos de error compatibles con el contrato de la landing
 * (`details: ['phone_invalid', ...]`, ver public/assets/site.js).
 */
export function leadErrorCodes(fieldErrors: Record<string, string[] | undefined>): string[] {
  const map: Record<string, string> = {
    phone: 'phone_invalid', nip: 'nip_invalid', email: 'email_invalid',
    nombre: 'first_name_invalid', apellido: 'last_name_invalid', consent: 'consent_required',
  };
  const out: string[] = [];
  for (const [field, msgs] of Object.entries(fieldErrors)) {
    if (!msgs?.length) continue;
    if (field === 'nip_valid_until') out.push(msgs[0].startsWith('nip_valid_until_') ? msgs[0] : 'nip_valid_until_invalid');
    else out.push(map[field] ?? `${field}_invalid`);
  }
  return [...new Set(out)];
}
