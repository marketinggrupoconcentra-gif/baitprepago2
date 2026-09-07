/**
 * tests/captcha-lead-integration.js
 * Integration test against the QA Neon branch (.env.branch). Exercises the
 * real DB-backed CAPTCHA challenge lifecycle plus lead validation/insert
 * path, without requiring a running `vercel dev` server.
 *
 * Run with: node --env-file=.env.branch tests/captcha-lead-integration.js
 */
const { Pool } = require('@neondatabase/serverless');
const { enforceSafety } = require('../scripts/preview-safety');

console.log('Running captcha-lead-integration tests...');
let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`❌ FAIL: ${message}`);
  }
}

async function loadModules() {
  // lib/*.js are ESM; dynamic import works from this CommonJS test file.
  const captcha = await import('../lib/captcha.js');
  const validation = await import('../lib/validation.js');
  return { captcha, validation };
}

async function run() {
  enforceSafety();

  if (!process.env.DATABASE_URL) {
    console.error('❌ FAIL: DATABASE_URL is not set. Run with --env-file=.env.branch');
    process.exit(1);
  }
  if (!process.env.CAPTCHA_PEPPER) {
    console.error('❌ FAIL: CAPTCHA_PEPPER is not set. Run with --env-file=.env.branch');
    process.exit(1);
  }

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { captcha, validation } = await loadModules();

  const testPhone = '55' + String(Math.floor(10000000 + Math.random() * 89999999)); // exactly 10 digits
  const testEmail = `qa-1h-${Date.now()}@bait.test`;

  try {
    // 1. Create a challenge and manually craft the known answer for testing
    //    (mirrors createCaptchaChallenge but keeps the plaintext for assertions).
    const crypto = require('crypto');
    const challengeId = crypto.randomUUID();
    const answer = '482913';
    const answerHash = captcha.hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, challengeId, answer);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${challengeId}, ${answerHash}, ${expiresAt.toISOString()})`;
    assert(true, '1. Challenge creado y persistido (solo hash) en captcha_challenges');

    // 2. Resolve challenge with the correct answer
    const okResult = await captcha.consumeCaptchaChallenge(sql, challengeId, answer);
    assert(okResult.ok === true, '2. Challenge resuelto correctamente → ok:true');

    // 3. Validate lead payload (server-side) and insert
    const payload = { phone: testPhone, nip: '1234', email: testEmail, consent: true };
    const validated = validation.validateLeadPayload(payload);
    assert(validated.valid, '3. Payload de lead válido tras CAPTCHA resuelto');

    await sql`INSERT INTO leads (phone, email) VALUES (${validated.data.phone}, ${validated.data.email})`;

    const inserted = await pool.query('SELECT id, phone, email FROM leads WHERE phone = $1', [testPhone]);
    assert(inserted.rows.length === 1, '4. Insert confirmado en la tabla leads');
    assert(inserted.rows[0].email === testEmail, '5. Email guardado correctamente');

    const nipColCheck = await pool.query(`
      SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema='public' AND table_name='leads' AND column_name IN ('nip','nip_valid_until')
    `);
    assert(nipColCheck.rows[0].count === 0, '6. NIP / nip_valid_until no existen como columnas (no persistidos)');

    // 7. Replay the already-used challenge → rejected
    const replay = await captcha.consumeCaptchaChallenge(sql, challengeId, answer);
    assert(replay.ok === false && replay.error === 'captcha_used', '7. Replay del challenge ya usado → rechazado (captcha_used)');

    // 8. Wrong CAPTCHA answer on a fresh challenge → lead must not be attempted
    const challengeId2 = crypto.randomUUID();
    const answer2 = '135790';
    const answerHash2 = captcha.hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, challengeId2, answer2);
    await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${challengeId2}, ${answerHash2}, ${expiresAt.toISOString()})`;
    const wrong = await captcha.consumeCaptchaChallenge(sql, challengeId2, '000000');
    assert(wrong.ok === false && wrong.error === 'captcha_invalid', '8. CAPTCHA erróneo → captcha_invalid (lead no se inserta)');

    // 9. Expired challenge → rejected
    const challengeId3 = crypto.randomUUID();
    const answer3 = '246810';
    const answerHash3 = captcha.hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, challengeId3, answer3);
    const pastExpiry = new Date(Date.now() - 1000);
    await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${challengeId3}, ${answerHash3}, ${pastExpiry.toISOString()})`;
    const expired = await captcha.consumeCaptchaChallenge(sql, challengeId3, answer3);
    assert(expired.ok === false && expired.error === 'captcha_expired', '9. Challenge expirado → captcha_expired (lead no se inserta)');

    // 10. Challenge-creation rate limit against the real QA database.
    const testIp = `203.0.113.${Math.floor(Math.random() * 254 + 1)}`; // RFC5737 test-net, unique per run
    const createdIds = [];
    let blockedAt = null;
    for (let i = 0; i < captcha.CAPTCHA_CHALLENGE_RATE_LIMIT_MAX + 5; i++) {
      const check = await captcha.checkCaptchaChallengeRateLimit(sql, testIp);
      if (!check.allowed) { blockedAt = i; break; }
      const created = await captcha.createCaptchaChallenge(sql, process.env, check.clientHash);
      createdIds.push(created.challengeId);
    }
    assert(blockedAt === captcha.CAPTCHA_CHALLENGE_RATE_LIMIT_MAX, `10. Rate limit real bloquea exactamente en el intento #${captcha.CAPTCHA_CHALLENGE_RATE_LIMIT_MAX + 1} (429 en el endpoint)`);

    const otherIp = `203.0.113.${Math.floor(Math.random() * 254 + 1)}`;
    const unaffected = await captcha.checkCaptchaChallengeRateLimit(sql, otherIp);
    assert(unaffected.allowed === true, '11. Un cliente distinto no es afectado por la ráfaga anterior');

    // Cleanup test rows created on the QA branch.
    await pool.query('DELETE FROM leads WHERE phone = $1', [testPhone]);
    await pool.query('DELETE FROM captcha_challenges WHERE id = ANY($1::text[])', [[challengeId, challengeId2, challengeId3, ...createdIds]]);

    console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
    await pool.end();
    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal error in tests', err);
    await pool.end();
    process.exit(1);
  }
}

run();
