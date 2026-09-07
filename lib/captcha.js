/**
 * lib/captcha.js
 * Server-side CAPTCHA: challenge generation, storage-ready hashing and
 * single-use validation. The plaintext answer is never persisted; only
 * HMAC-SHA256(CAPTCHA_PEPPER, challengeId + ':' + answer) is stored.
 *
 * FAIL CLOSED: if CAPTCHA_PEPPER is missing, challenge issuance and
 * validation both refuse to proceed.
 */

import crypto from 'node:crypto';

export const CAPTCHA_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CODE_LENGTH = 6;
const CODE_CHARS = '0123456789';

export function getCaptchaPepper(env = process.env) {
  const pepper = env.CAPTCHA_PEPPER;
  if (!pepper) {
    throw new Error('CAPTCHA_PEPPER is missing (fail closed)');
  }
  return pepper;
}

export function hashCaptchaAnswer(pepper, challengeId, answer) {
  return crypto
    .createHmac('sha256', pepper)
    .update(`${challengeId}:${answer}`)
    .digest('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
  }
  return code;
}

/**
 * Renders the code as a noisy SVG so the digits are not present as plain
 * <text> nodes an attacker could trivially parse back out. Each digit is
 * drawn as a set of short line segments (a seven-segment style glyph) with
 * randomized jitter, plus background noise lines/dots.
 */
const SEGMENT_MAP = {
  '0': [1, 1, 1, 0, 1, 1, 1],
  '1': [0, 0, 1, 0, 0, 1, 0],
  '2': [1, 0, 1, 1, 1, 0, 1],
  '3': [1, 0, 1, 1, 0, 1, 1],
  '4': [0, 1, 1, 1, 0, 1, 0],
  '5': [1, 1, 0, 1, 0, 1, 1],
  '6': [1, 1, 0, 1, 1, 1, 1],
  '7': [1, 0, 1, 0, 0, 1, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1]
};

// Segment coordinate templates within a unit glyph box (x0,y0,x1,y1).
function segmentPaths(w, h) {
  return [
    [0, 0, w, 0],       // top
    [0, 0, 0, h / 2],   // top-left
    [w, 0, w, h / 2],   // top-right
    [0, h / 2, w, h / 2], // middle
    [0, h / 2, 0, h],   // bottom-left
    [w, h / 2, w, h],   // bottom-right
    [0, h, w, h]        // bottom
  ];
}

function renderCaptchaSvg(code) {
  const width = 220;
  const height = 70;
  const glyphW = 22;
  const glyphH = 40;
  const strokeColors = ['#1a237e', '#880e4f', '#1b5e20', '#e65100', '#4a148c', '#006064'];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="captcha">`;
  svg += `<rect width="${width}" height="${height}" fill="#f8f8f4"/>`;

  // Noise lines (behind glyphs)
  for (let i = 0; i < 6; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    const gray = Math.floor(Math.random() * 160);
    svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(${gray},${gray},${gray},0.35)" stroke-width="1.2"/>`;
  }

  const step = (width - 20) / code.length;
  const segs = segmentPaths(glyphW, glyphH);

  for (let i = 0; i < code.length; i++) {
    const digit = code[i];
    const on = SEGMENT_MAP[digit] || SEGMENT_MAP['0'];
    const color = strokeColors[i % strokeColors.length];
    const baseX = 12 + step * i + (Math.random() * 6 - 3);
    const baseY = 12 + (Math.random() * 6 - 3);
    const rotation = (Math.random() * 16 - 8).toFixed(1);
    const cx = baseX + glyphW / 2;
    const cy = baseY + glyphH / 2;

    svg += `<g transform="translate(${baseX.toFixed(1)},${baseY.toFixed(1)}) rotate(${rotation} ${(glyphW / 2).toFixed(1)} ${(glyphH / 2).toFixed(1)})">`;
    on.forEach((isOn, segIdx) => {
      if (!isOn) return;
      const [x1, y1, x2, y2] = segs[segIdx];
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3.4" stroke-linecap="round"/>`;
    });
    svg += `</g>`;
    void cx; void cy;
  }

  // Noise dots (in front, light)
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1" fill="rgba(0,0,0,0.18)"/>`;
  }

  svg += `</svg>`;
  return svg;
}

export function toDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * Creates a new challenge, persists only its answer hash, and returns the
 * data the client needs (id, image, expiry) — never the plaintext answer.
 */
export async function createCaptchaChallenge(sql, env = process.env) {
  const pepper = getCaptchaPepper(env); // fail closed if missing
  const challengeId = crypto.randomUUID();
  const answer = generateCode();
  const answerHash = hashCaptchaAnswer(pepper, challengeId, answer);
  const expiresAt = new Date(Date.now() + CAPTCHA_TTL_MS);

  await sql`
    INSERT INTO captcha_challenges (id, answer_hash, expires_at)
    VALUES (${challengeId}, ${answerHash}, ${expiresAt.toISOString()})
  `;

  const svg = renderCaptchaSvg(answer);

  return {
    challengeId,
    image: toDataUri(svg),
    expiresAt: expiresAt.toISOString()
  };
}

export const CAPTCHA_ERRORS = {
  REQUIRED: 'captcha_required',
  INVALID: 'captcha_invalid',
  EXPIRED: 'captcha_expired',
  USED: 'captcha_used'
};

/**
 * Validates and atomically consumes a challenge. Returns { ok: true } or
 * { ok: false, error }. Never reveals what the correct answer was.
 */
export async function consumeCaptchaChallenge(sql, challengeId, rawAnswer, env = process.env) {
  if (!challengeId || typeof challengeId !== 'string' || !rawAnswer) {
    return { ok: false, error: CAPTCHA_ERRORS.REQUIRED };
  }

  const answer = String(rawAnswer).trim();
  if (!/^\d{6}$/.test(answer)) {
    return { ok: false, error: CAPTCHA_ERRORS.INVALID };
  }

  let pepper;
  try {
    pepper = getCaptchaPepper(env);
  } catch {
    return { ok: false, error: CAPTCHA_ERRORS.INVALID }; // fail closed
  }

  const rows = await sql`
    SELECT id, answer_hash, expires_at, used_at
    FROM captcha_challenges
    WHERE id = ${challengeId}
  `;

  if (!rows || rows.length === 0) {
    return { ok: false, error: CAPTCHA_ERRORS.INVALID };
  }

  const row = rows[0];

  if (row.used_at) {
    return { ok: false, error: CAPTCHA_ERRORS.USED };
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: CAPTCHA_ERRORS.EXPIRED };
  }

  const expectedHash = hashCaptchaAnswer(pepper, challengeId, answer);
  const matches = timingSafeEqualHex(expectedHash, row.answer_hash);

  // Mark as used regardless of outcome, atomically, only if still unused —
  // this guarantees single-use even under concurrent replay attempts.
  const updateRes = await sql`
    UPDATE captcha_challenges
    SET used_at = NOW()
    WHERE id = ${challengeId} AND used_at IS NULL
    RETURNING id
  `;

  if (!updateRes || updateRes.length === 0) {
    // Someone else consumed it in a race between our SELECT and UPDATE.
    return { ok: false, error: CAPTCHA_ERRORS.USED };
  }

  if (!matches) {
    return { ok: false, error: CAPTCHA_ERRORS.INVALID };
  }

  return { ok: true };
}
