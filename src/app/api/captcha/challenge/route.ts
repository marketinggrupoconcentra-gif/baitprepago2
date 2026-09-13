/**
 * POST /api/captcha/challenge — Emite un reto CAPTCHA para el formulario de la landing
 *
 * Contrato heredado del backend vanilla (public/assets/site.js lo consume tal cual):
 *   201 { challengeId, image, expiresAt } · 403 origen · 415 content-type · 429 rate limit.
 * Solo se persiste el hash de la respuesta; la IP solo como HMAC (client_hash).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/security/origin';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import { extractIp, hashIp } from '@/lib/security/ip-hash';
import { createCaptchaChallenge, getCaptchaPepper, hashClientIdentifier } from '@/lib/security/captcha';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Holgado para un humano que refresca la imagen varias veces; corta ráfagas scripted.
const CAPTCHA_RATE_LIMIT = { name: 'captcha-challenge', limit: 20, windowSecs: 600 };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const noStore = { 'Cache-Control': 'no-store, max-age=0' };

  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415, headers: noStore });
  }
  const origin = checkOrigin(req.headers.get('origin'), req.headers.get('referer'), req.headers.get('host') || req.headers.get('x-forwarded-host'));
  if (!origin.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: noStore });
  }

  const ip = extractIp(req.headers);
  const rl = await checkRateLimit(hashIp(ip), CAPTCHA_RATE_LIMIT, 'closed');
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...noStore, 'Retry-After': String(Math.max(1, rl.retryAfterSecs)) } });
  }

  try {
    const clientHash = hashClientIdentifier(getCaptchaPepper(), ip);
    const challenge = await createCaptchaChallenge(clientHash);
    return NextResponse.json(challenge, { status: 201, headers: noStore });
  } catch (err) {
    // Fail closed (p. ej. CAPTCHA_PEPPER ausente) sin filtrar el motivo.
    logError('/api/captcha/challenge', 'handler', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: noStore });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
