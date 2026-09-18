/**
 * POST /api/track — First-party analytics endpoint
 *
 * Recibe eventos del cliente y los persiste en app.analytics_events.
 * 
 * SEGURIDAD:
 * - PROHIBIDO: nombre, teléfono, email, NIP, IP completa, UA completo, valores de campos
 * - lead_success SOLO lo genera el servidor (via /api/v1/lead) — rechazar desde cliente
 * - Rate limit: verificar x-forwarded-for solo para throttling, NO almacenar
 * - session_id: uuid anónimo del cliente, sin PII
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { z } from 'zod';
import { logError } from '@/lib/log';
import { checkOrigin } from '@/lib/security/origin';
import { checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limiter';
import { extractIp, hashIp } from '@/lib/security/ip-hash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lista de eventos permitidos desde el cliente
const CLIENT_ALLOWED_EVENTS = new Set([
  'page_view',
  'landing_view',
  'thank_you_view',
  'engagement_time',
  'session_end',
  'scroll_depth',
  'form_start',
  'form_field_started',
  'form_field_completed',
  'form_step_view',
  'form_step_completed',
  'form_step_back',
  'form_step_1_start',
  'form_step_2_start',
  'form_step_3_start',
  'form_submitted',
  'form_submit_success',
  'form_submit_error',
  'form_abandoned',
  'form_error',
  'cta_click',
  'outbound_click',
  'share',
  'faq_open',
  'scroll_50',
  'scroll_90',
  'section_view',
]);

// Eventos reservados para el servidor
const SERVER_ONLY_EVENTS = new Set(['lead_success', 'lead_duplicate']);

const TrackSchema = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string().uuid(),
  eventName: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  pagePath: z.string().max(500).optional(),
  sectionId: z.string().max(100).optional(),
  ctaId: z.string().max(100).optional(),
  scrollPct: z.number().int().min(0).max(100).optional(),
  errorCode: z.string().max(100).regex(/^[a-z0-9_]+$/).optional(), // código, NUNCA valor
  sourceCategory: z.enum([
    'google_ads',
    'meta_ads',
    'paid_other',
    'organic',
    'referral',
    'direct',
    'other',
  ]).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
  deviceCategory: z.enum(['mobile', 'tablet', 'desktop']).optional(),
}).strict(); // strict: rechazar campos adicionales

const MAX_BATCH_SIZE = 20;
const TrackRequestSchema = z.union([
  TrackSchema,
  z.object({
    events: z.array(TrackSchema).min(1).max(MAX_BATCH_SIZE),
  }).strict(),
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const originCheck = checkOrigin(
    req.headers.get('origin'), 
    req.headers.get('referer'),
    req.headers.get('host') || req.headers.get('x-forwarded-host')
  );
  if (!originCheck.allowed) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  const ipHash = hashIp(extractIp(req.headers));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const parsed = TrackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const events = 'events' in parsed.data ? parsed.data.events : [parsed.data];

  // Rechazar el lote completo si intenta incluir eventos reservados del servidor.
  if (events.some((event) => SERVER_ONLY_EVENTS.has(event.eventName))) {
    return NextResponse.json(
      { error: 'Evento no permitido desde cliente' },
      { status: 403 },
    );
  }

  // Mantener compatibilidad: eventos desconocidos se aceptan sin persistir.
  const acceptedEvents = events.filter((event) => CLIENT_ALLOWED_EVENTS.has(event.eventName));
  if (acceptedEvents.length === 0) {
    // Aceptar silenciosamente pero no persistir — evitar leakage de errores
    return NextResponse.json({ ok: true, accepted: 0 });
  }

  try {
    // Una sola escritura de rate limit por lote, cobrando todas sus unidades.
    const rateCheck = await checkRateLimit(
      ipHash,
      RATE_LIMITS.events,
      'open',
      acceptedEvents.length,
    );
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit excedido' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSecs) } },
      );
    }

    const db = getDb();
    await db.insert(schema.analyticsEvents).values(acceptedEvents.map((event) => ({
      eventId: event.eventId,
      sessionId: event.sessionId,
      eventName: event.eventName,
      pagePath: event.pagePath ?? null,
      sectionId: event.sectionId ?? null,
      ctaId: event.ctaId ?? null,
      scrollPct: event.scrollPct ?? null,
      errorCode: event.errorCode ?? null,
      sourceCategory: event.sourceCategory ?? null,
      utmSource: event.utmSource ?? null,
      utmMedium: event.utmMedium ?? null,
      utmCampaign: event.utmCampaign ?? null,
      utmContent: event.utmContent ?? null,
      utmTerm: event.utmTerm ?? null,
      deviceCategory: event.deviceCategory ?? null,
    }))).onConflictDoNothing({ target: schema.analyticsEvents.eventId });

    return NextResponse.json({ ok: true, accepted: acceptedEvents.length });
  } catch (err) {
    // No exponer errores de DB al cliente
    logError('/api/track', 'handler', err);
    return NextResponse.json({ error: 'Tracking temporalmente no disponible' }, { status: 503 });
  }
}
