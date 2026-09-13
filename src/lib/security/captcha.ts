import 'server-only';
import crypto from 'crypto';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { getDb, schema } from '@/db';

/**
 * src/lib/security/captcha.ts — CAPTCHA propio de la landing BAIT Prepago.
 *
 * Portado del backend vanilla original (lib/captcha.js) al motor Scale:
 *   - Solo se persiste HMAC-SHA256(CAPTCHA_PEPPER, challengeId:answer); la
 *     respuesta en claro nunca se guarda, se loggea ni se devuelve.
 *   - Single-use atómico (UPDATE ... WHERE used_at IS NULL RETURNING).
 *   - FAIL CLOSED: sin CAPTCHA_PEPPER no se emite ni valida nada.
 *   - La IP del cliente solo se guarda como HMAC (client_hash).
 * Contrato con public/assets/site.js: POST /api/captcha/challenge →
 * { challengeId, image (data URI SVG), expiresAt }; errores `captcha_*`.
 */

export const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const CODE_LENGTH = 6;
const CODE_CHARS = '0123456789';

export const CAPTCHA_ERRORS = {
  REQUIRED: 'captcha_required',
  INVALID: 'captcha_invalid',
  EXPIRED: 'captcha_expired',
  USED: 'captcha_used',
  RATE_LIMITED: 'captcha_rate_limited',
} as const;

export function getCaptchaPepper(env: NodeJS.ProcessEnv = process.env): string {
  const pepper = env.CAPTCHA_PEPPER;
  if (!pepper) throw new Error('CAPTCHA_PEPPER is missing (fail closed)');
  return pepper;
}

export function hashCaptchaAnswer(pepper: string, challengeId: string, answer: string): string {
  return crypto.createHmac('sha256', pepper).update(`${challengeId}:${answer}`).digest('hex');
}

export function hashClientIdentifier(pepper: string, ip: string): string {
  return crypto.createHmac('sha256', pepper).update(`captcha-rl:${ip || 'unknown'}`).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
  return code;
}

// ── Render SVG (glifos de 7 segmentos con jitter + ruido; sin <text>) ─────────
const SEGMENT_MAP: Record<string, number[]> = {
  '0': [1, 1, 1, 0, 1, 1, 1], '1': [0, 0, 1, 0, 0, 1, 0], '2': [1, 0, 1, 1, 1, 0, 1],
  '3': [1, 0, 1, 1, 0, 1, 1], '4': [0, 1, 1, 1, 0, 1, 0], '5': [1, 1, 0, 1, 0, 1, 1],
  '6': [1, 1, 0, 1, 1, 1, 1], '7': [1, 0, 1, 0, 0, 1, 0], '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
};

function segmentPaths(w: number, h: number): number[][] {
  return [
    [0, 0, w, 0], [0, 0, 0, h / 2], [w, 0, w, h / 2], [0, h / 2, w, h / 2],
    [0, h / 2, 0, h], [w, h / 2, w, h], [0, h, w, h],
  ];
}

export function renderCaptchaSvg(code: string): string {
  const width = 220, height = 70, glyphW = 22, glyphH = 40;
  const strokeColors = ['#1a237e', '#880e4f', '#1b5e20', '#e65100', '#4a148c', '#006064'];
  const rnd = () => crypto.randomInt(0, 10000) / 10000;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="captcha">`;
  svg += `<rect width="${width}" height="${height}" fill="#f8f8f4"/>`;
  for (let i = 0; i < 6; i++) {
    const gray = Math.floor(rnd() * 160);
    svg += `<line x1="${(rnd() * width).toFixed(1)}" y1="${(rnd() * height).toFixed(1)}" x2="${(rnd() * width).toFixed(1)}" y2="${(rnd() * height).toFixed(1)}" stroke="rgba(${gray},${gray},${gray},0.35)" stroke-width="1.2"/>`;
  }
  const step = (width - 20) / code.length;
  const segs = segmentPaths(glyphW, glyphH);
  for (let i = 0; i < code.length; i++) {
    const on = SEGMENT_MAP[code[i]] ?? SEGMENT_MAP['0'];
    const color = strokeColors[i % strokeColors.length];
    const baseX = 12 + step * i + (rnd() * 6 - 3);
    const baseY = 12 + (rnd() * 6 - 3);
    const rotation = (rnd() * 16 - 8).toFixed(1);
    svg += `<g transform="translate(${baseX.toFixed(1)},${baseY.toFixed(1)}) rotate(${rotation} ${(glyphW / 2).toFixed(1)} ${(glyphH / 2).toFixed(1)})">`;
    on.forEach((isOn, idx) => {
      if (!isOn) return;
      const [x1, y1, x2, y2] = segs[idx];
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3.4" stroke-linecap="round"/>`;
    });
    svg += '</g>';
  }
  for (let i = 0; i < 30; i++) {
    svg += `<circle cx="${(rnd() * width).toFixed(1)}" cy="${(rnd() * height).toFixed(1)}" r="1" fill="rgba(0,0,0,0.18)"/>`;
  }
  return svg + '</svg>';
}

export function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/** Emite un reto: persiste solo el hash y devuelve id + imagen + expiración. */
export async function createCaptchaChallenge(clientHash: string | null, env: NodeJS.ProcessEnv = process.env) {
  const pepper = getCaptchaPepper(env);
  const challengeId = crypto.randomUUID();
  const answer = generateCode();
  const expiresAt = new Date(Date.now() + CAPTCHA_TTL_MS);

  await getDb().insert(schema.captchaChallenges).values({
    id: challengeId,
    answerHash: hashCaptchaAnswer(pepper, challengeId, answer),
    clientHash,
    expiresAt,
  });

  return { challengeId, image: toDataUri(renderCaptchaSvg(answer)), expiresAt: expiresAt.toISOString() };
}

export type CaptchaResult = { ok: true } | { ok: false; error: (typeof CAPTCHA_ERRORS)[keyof typeof CAPTCHA_ERRORS] };

/** Valida y consume atómicamente un reto. Nunca revela la respuesta correcta. */
export async function consumeCaptchaChallenge(
  challengeId: unknown,
  rawAnswer: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CaptchaResult> {
  if (!challengeId || typeof challengeId !== 'string' || !rawAnswer) return { ok: false, error: CAPTCHA_ERRORS.REQUIRED };
  const answer = String(rawAnswer).trim();
  if (!/^\d{6}$/.test(answer)) return { ok: false, error: CAPTCHA_ERRORS.INVALID };
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return { ok: false, error: CAPTCHA_ERRORS.INVALID };

  let pepper: string;
  try { pepper = getCaptchaPepper(env); } catch { return { ok: false, error: CAPTCHA_ERRORS.INVALID }; }

  const db = getDb();
  const [row] = await db.select().from(schema.captchaChallenges).where(eq(schema.captchaChallenges.id, challengeId)).limit(1);
  if (!row) return { ok: false, error: CAPTCHA_ERRORS.INVALID };
  if (row.usedAt) return { ok: false, error: CAPTCHA_ERRORS.USED };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, error: CAPTCHA_ERRORS.EXPIRED };

  const matches = timingSafeEqualHex(hashCaptchaAnswer(pepper, challengeId, answer), row.answerHash);

  // Se marca usado pase lo que pase — garantiza single-use bajo replay concurrente.
  const updated = await db.update(schema.captchaChallenges)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.captchaChallenges.id, challengeId), isNull(schema.captchaChallenges.usedAt)))
    .returning({ id: schema.captchaChallenges.id });
  if (updated.length === 0) return { ok: false, error: CAPTCHA_ERRORS.USED };
  if (!matches) return { ok: false, error: CAPTCHA_ERRORS.INVALID };
  return { ok: true };
}

/** Purga retos vencidos (llamar desde el cron de limpieza). */
export async function purgeExpiredCaptchaChallenges(): Promise<number> {
  const rows = await getDb().delete(schema.captchaChallenges)
    .where(lt(schema.captchaChallenges.expiresAt, new Date()))
    .returning({ id: schema.captchaChallenges.id });
  return rows.length;
}
