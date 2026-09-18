import 'server-only';
import { NextRequest, NextResponse, after } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema, withTransaction } from '@/db';
import { encryptPII, blindIndex, hashPayload, decryptPII } from '@/lib/crypto';
import { checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limiter';
import { checkHoneypot } from '@/lib/security/honeypot';
import { checkFormTiming } from '@/lib/security/timing';
import { checkOrigin } from '@/lib/security/origin';
import { checkBot } from '@/lib/security/bot-id';
import { extractIp, hashIp } from '@/lib/security/ip-hash';
import { checkIdempotency } from '@/lib/security/idempotency';
import { consumeCaptchaChallenge } from '@/lib/security/captcha';
import { submitLead, DuplicatePhoneError, IdempotencyRaceError } from '@/lib/leads/submit-lead';
import { hashClickId } from '@/lib/attribution-server';
import { LeadInputSchema, leadErrorCodes } from '@/lib/validators/lead-schema';
import { resolveSourceCategory, parseUtmParams, parseClickIds, extractReferrerHost } from '@/lib/attribution';
import { logError } from '@/lib/log';
import { sendLeadConfirmationEmail } from '@/lib/email/sender';

/**
 * Handler compartido de POST /api/leads (contrato de la landing BAIT Prepago) y
 * POST /api/v1/leads (alias). Pipeline de 10 capas del motor Scale
 * (36_analytics_data_contract.md §4) + CAPTCHA propio + respuestas con el
 * contrato que espera public/assets/site.js:
 *   201 { ok, saved, status:'received', reference }
 *   409 { ok:false, error:'duplicate_lead', code:'PHONE_ALREADY_REGISTERED', duplicate:{createdAt, registeredName} }
 *   422 { error:'Invalid payload', details:[codes], fields }
 *   429 { error:'Too many requests' }
 */

const MAX_BODY_BYTES = 8_192;

/** _fbc = fb.1.<timestamp>.<fbclid> → recupera el fbclid si la landing no lo traía en la URL. */
function fbclidFromFbc(fbc: string | null | undefined): string | undefined {
  if (!fbc) return undefined;
  const m = /^fb\.1\.\d+\.(.+)$/.exec(fbc);
  return m?.[1] || undefined;
}
const PLAN_CODE = process.env.LEAD_PLAN_CODE ?? 'prepago_100';
// Entrega al CRM Intelix vía outbox (src/app/api/cron/outbox). El NIP se cifra y se
// conserva SOLO hasta que Intelix acepta el registro o vence NIP_RETENTION_HOURS.
const OUTBOX_DESTINATION = 'intelix';
const NIP_RETENTION_HOURS = Number(process.env.NIP_RETENTION_HOURS ?? 72);
// La landing dice "recibirás tu cupón por correo"; el backend original NO enviaba
// nada al lead. Se mantiene apagado salvo LEAD_CONFIRMATION_EMAIL=on.
const LEAD_EMAIL_ENABLED = (process.env.LEAD_CONFIRMATION_EMAIL ?? 'off').toLowerCase() === 'on';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });

type SecurityEventType = typeof schema.securityEvents.$inferInsert['eventType'];

async function logSecurityEvent(eventType: SecurityEventType, route: string, ipHash: string, metadata?: Record<string, unknown>) {
  try {
    await getDb().insert(schema.securityEvents).values({
      eventType, route, ipHash, safeMetadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch { /* nunca propagar errores de logging de seguridad */ }
}

/** "Juan Pérez" → "J*** P***" (mismo enmascarado que el backend original). */
function maskName(firstName: string | null, lastName: string | null): string {
  const part = (v: string | null) => {
    const clean = (v ?? '').trim();
    return clean ? `${Array.from(clean)[0]}***` : null;
  };
  const parts = [part(firstName), part(lastName)].filter(Boolean);
  return parts.length ? parts.join(' ') : 'No disponible';
}

async function duplicateResponse(route: string, ipHash: string, existingId: string, match: string) {
  const [existing] = await getDb()
    .select({ createdAt: schema.leads.createdAt, firstNameEnc: schema.leads.firstNameEnc, lastNameEnc: schema.leads.lastNameEnc })
    .from(schema.leads).where(eq(schema.leads.id, existingId)).limit(1);
  let registeredName = 'No disponible';
  try {
    if (existing) registeredName = maskName(decryptPII(existing.firstNameEnc), decryptPII(existing.lastNameEnc));
  } catch { /* PII corrupta: no bloquear la respuesta */ }
  await logSecurityEvent('duplicate', route, ipHash, { match });
  return json({
    ok: false,
    error: 'duplicate_lead',
    code: 'PHONE_ALREADY_REGISTERED',
    duplicate: { createdAt: existing?.createdAt?.toISOString() ?? null, registeredName },
  }, 409);
}

export async function handleLeadRequest(req: NextRequest, route: string): Promise<NextResponse> {
  const ip = extractIp(req.headers);
  const ipHash = hashIp(ip);

  // ── Content-Type / tamaño ────────────────────────────────────────────────
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    await logSecurityEvent('schema_rejection', route, ipHash, { reason: 'invalid_content_type' });
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    await logSecurityEvent('oversized_body', route, ipHash, { size: contentLength });
    return json({ error: 'Payload demasiado grande.' }, 413);
  }

  // ── Origin / bot / rate limit ────────────────────────────────────────────
  const originCheck = checkOrigin(req.headers.get('origin'), req.headers.get('referer'), req.headers.get('host') || req.headers.get('x-forwarded-host'));
  if (!originCheck.allowed) {
    await logSecurityEvent('invalid_origin', route, ipHash, { reason: originCheck.reason });
    return json({ error: 'Origen no permitido.' }, 403);
  }
  const botCheck = checkBot(req.headers);
  if (botCheck.isBot) {
    await logSecurityEvent('bot_block', route, ipHash, { score: botCheck.score, reason: botCheck.reason, source: botCheck.source });
    return json({ error: 'Request no permitida.' }, 403);
  }
  const rateCheck = await checkRateLimit(ipHash, RATE_LIMITS.leads, 'closed');
  if (!rateCheck.allowed) {
    await logSecurityEvent('rate_limit', route, ipHash, { degraded: rateCheck.degraded ?? false });
    return json({ error: 'Too many requests' }, 429, { 'Retry-After': String(Math.max(1, rateCheck.retryAfterSecs)), 'X-RateLimit-Remaining': '0' });
  }

  // ── Body ─────────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      await logSecurityEvent('oversized_body', route, ipHash, {});
      return json({ error: 'Payload demasiado grande.' }, 413);
    }
    rawBody = JSON.parse(text);
  } catch {
    await logSecurityEvent('schema_rejection', route, ipHash, { reason: 'invalid_json' });
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
    await logSecurityEvent('schema_rejection', route, ipHash, { reason: 'non_object_body' });
    return json({ error: 'Invalid JSON' }, 400);
  }
  const body = rawBody as Record<string, unknown>;

  // ── Honeypot (200 falso positivo silencioso) ─────────────────────────────
  if (checkHoneypot(body).isBot) {
    await logSecurityEvent('honeypot', route, ipHash, {});
    return json({ ok: true, saved: true, status: 'received', reference: 'none' }, 200);
  }

  // ── Timing anti-bot ──────────────────────────────────────────────────────
  const timingCheck = checkFormTiming(body.form_started_at as number, Date.now());
  if (!timingCheck.passed) {
    await logSecurityEvent('bot_block', route, ipHash, { reason: timingCheck.reason });
    return json({ error: 'Request no válida.' }, 400);
  }

  // ── Idempotencia técnica ─────────────────────────────────────────────────
  const idempotencyKey = body.idempotency_key;
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return json({ error: 'Idempotency-Key requerida.' }, 400);
  }
  const idem = await checkIdempotency(idempotencyKey, route, body);
  if (idem.isConflict) {
    await logSecurityEvent('replay', route, ipHash, { reason: 'payload_conflict' });
    return json({ error: 'Key de idempotencia con payload diferente.' }, 409);
  }
  if (idem.isDuplicate && idem.cachedReference) {
    return json({ ok: true, saved: true, status: 'received', reference: idem.cachedReference }, 201);
  }

  // ── Zod (autoridad) ──────────────────────────────────────────────────────
  const parsed = LeadInputSchema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
    await logSecurityEvent('schema_rejection', route, ipHash, { fields: Object.keys(fields) });
    return json({ error: 'Invalid payload', details: leadErrorCodes(fields), fields }, 422);
  }
  const data = parsed.data;

  // ── CAPTCHA propio (single-use) ──────────────────────────────────────────
  const captcha = await consumeCaptchaChallenge(data.captcha_challenge_id, data.captcha_answer);
  if (!captcha.ok) {
    await logSecurityEvent('schema_rejection', route, ipHash, { reason: captcha.error });
    return json({ error: 'Invalid payload', details: [captcha.error] }, 422);
  }

  const normalizedPhone = data.phone;
  const normalizedEmail = data.email;
  const phoneBidx = blindIndex(normalizedPhone);
  const emailBidx = blindIndex(normalizedEmail);

  // ── Deduplicación de negocio (teléfono) ──────────────────────────────────
  const [existingByPhone] = await getDb().select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.phoneBidx, phoneBidx)).limit(1);
  if (existingByPhone) return duplicateResponse(route, ipHash, existingByPhone.id, 'phone_bidx');

  // ── Atribución ───────────────────────────────────────────────────────────
  const landingUrl = data.landing_url ?? data.page_url ?? '';
  const fromUrl = parseUtmParams(landingUrl);
  const urlClickIds = parseClickIds(landingUrl);
  const utm = {
    utmSource: data.utm_source ?? fromUrl.utmSource,
    utmMedium: data.utm_medium ?? fromUrl.utmMedium,
    utmCampaign: data.utm_campaign ?? fromUrl.utmCampaign,
    utmTerm: data.utm_term ?? fromUrl.utmTerm,
    utmContent: data.utm_content ?? fromUrl.utmContent,
  };
  const gclid = data.gclid ?? urlClickIds.gclid;
  const gbraid = data.gbraid ?? urlClickIds.gbraid;
  const wbraid = data.wbraid ?? urlClickIds.wbraid;
  const fbclid = data.fbclid ?? urlClickIds.fbclid ?? fbclidFromFbc(data.fbc);
  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 512) || undefined;
  const referrerHost = extractReferrerHost(data.referrer);
  const sourceCategory = resolveSourceCategory({
    gclidPresent: !!gclid, gbraidPresent: !!gbraid, wbraidPresent: !!wbraid,
    fbclidPresent: !!fbclid, utmSource: utm.utmSource, utmMedium: utm.utmMedium, referrerHost,
  });
  // landing_url sin click ids ni parámetros ajenos (solo utm_*)
  const cleanLandingUrl = (() => {
    try {
      const u = new URL(landingUrl);
      const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
      for (const k of Array.from(u.searchParams.keys())) if (!allowed.includes(k)) u.searchParams.delete(k);
      return u.toString();
    } catch { return landingUrl.split('?')[0]; }
  })();

  const publicReference = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  const requestHash = hashPayload(body);
  const idemExpiresAt = new Date(Date.now() + Number(process.env.LEAD_DEDUPE_WINDOW_HOURS ?? 24) * 60 * 60 * 1000);

  // ── Transacción única (leads + attribution + consents + idempotency + lead_success) ──
  try {
    await withTransaction(async (tx) => {
      await submitLead(tx, {
        now: new Date(),
        leadId,
        idempotencyKey,
        route,
        requestHash,
        publicReference,
        idemExpiresAt,
        normalizedPhone,
        firstNameEnc: encryptPII(data.nombre),
        lastNameEnc: encryptPII(data.apellido),
        emailEnc: encryptPII(normalizedEmail),
        phoneEnc: encryptPII(normalizedPhone),
        birthdateEnc: null,
        emailBidx,
        phoneBidx,
        stateCode: null,
        planCode: PLAN_CODE,
        // NIP: cifrado (AES-256-GCM) en lead_secrets con retención corta; Intelix lo necesita
        // para iniciar la portabilidad. Se borra al entregar. Nunca en claro ni en logs.
        nipEnc: encryptPII(data.nip),
        nipExpiresAt: new Date(Date.now() + NIP_RETENTION_HOURS * 60 * 60 * 1000),
        outboxDestination: OUTBOX_DESTINATION,
        sessionId: data.session_id,
        sourceCategory,
        ...utm,
        gclidHash: gclid ? hashClickId('gclid', gclid) : undefined,
        fbclidHash: fbclid ? hashClickId('fbclid', fbclid) : undefined,
        gclidEnc: gclid ? encryptPII(gclid) : undefined,
        gbraidEnc: gbraid ? encryptPII(gbraid) : undefined,
        wbraidEnc: wbraid ? encryptPII(wbraid) : undefined,
        fbclidEnc: fbclid ? encryptPII(fbclid) : undefined,
        fbpEnc: data.fbp ? encryptPII(data.fbp) : undefined,
        userAgent,
        fbAdId: data.fb_ad_id,
        fbAdsetId: data.fb_adset_id,
        fbCampaignId: data.fb_campaign_id,
        landingUrl: cleanLandingUrl || undefined,
        referrerHost,
        contractingAccepted: true,
        privacyAccepted: data.consent,
        privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION ?? '1.0.0',
        termsVersion: process.env.TERMS_VERSION ?? '1.0.0',
        deviceCategory: (req.headers.get('x-device-category') as 'mobile' | 'tablet' | 'desktop') ?? undefined,
      });
    });
  } catch (err) {
    if (err instanceof DuplicatePhoneError) {
      const [again] = await getDb().select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.phoneBidx, phoneBidx)).limit(1);
      if (again) return duplicateResponse(route, ipHash, again.id, 'phone_bidx_race');
      return json({ ok: false, error: 'duplicate_lead', code: 'PHONE_ALREADY_REGISTERED', duplicate: { createdAt: null, registeredName: 'No disponible' } }, 409);
    }
    if (err instanceof IdempotencyRaceError) {
      const again = await checkIdempotency(idempotencyKey, route, body);
      if (again.isDuplicate && again.cachedReference) return json({ ok: true, saved: true, status: 'received', reference: again.cachedReference }, 201);
      return json({ ok: true, saved: true, status: 'received', reference: 'pending' }, 202);
    }
    logError(route, 'lead-transaction', err);
    return json({ error: 'Internal server error' }, 500);
  }

  // ── Email de confirmación (opcional, fuera de la TX, nunca revierte el lead) ──
  if (LEAD_EMAIL_ENABLED) {
    void sendLeadConfirmationEmail({ to: normalizedEmail, firstName: data.nombre, reference: publicReference });
  }

  // ── Disparo automático a Intelix (en background para no bloquear la respuesta) ──
  if (process.env.CRON_SECRET) {
    const cronUrl = new URL('/api/cron/outbox', req.nextUrl.origin);
    const cronSecret = process.env.CRON_SECRET;
    after(() => {
      fetch(cronUrl, { headers: { authorization: `Bearer ${cronSecret}` } })
        .catch(err => logError(route, 'intelix-trigger', err instanceof Error ? err : new Error(String(err))));
    });
  }

  return json({ ok: true, saved: true, status: 'received', reference: publicReference }, 201);
}

export function methodNotAllowed() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
