const {
  getCaptchaPepper,
  hashCaptchaAnswer,
  createCaptchaChallenge,
  consumeCaptchaChallenge,
  checkCaptchaChallengeRateLimit,
  hashClientIdentifier,
  CAPTCHA_ERRORS,
  CAPTCHA_CHALLENGE_RATE_LIMIT_MAX
} = require('../lib/captcha.js');

console.log('Running captcha-unit tests...');
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

const TEST_ENV = { CAPTCHA_PEPPER: 'test-pepper-do-not-use-in-prod' };

/**
 * Minimal fake `sql` tagged-template/query client backed by an in-memory
 * Map, mimicking the subset of @neondatabase/serverless behavior this
 * module relies on (tagged template returns an array of rows).
 */
function makeFakeSql() {
  const store = new Map();

  function sql(strings, ...values) {
    const text = strings.join('?');

    if (text.includes('INSERT INTO captcha_challenges')) {
      const [id, answerHash, expiresAt, clientHash] = values;
      store.set(id, {
        id, answer_hash: answerHash, expires_at: expiresAt, used_at: null,
        client_hash: clientHash ?? null, created_at: new Date()
      });
      return Promise.resolve([]);
    }

    if (text.includes('SELECT id, answer_hash, expires_at, used_at')) {
      const [id] = values;
      const row = store.get(id);
      return Promise.resolve(row ? [{ ...row }] : []);
    }

    if (text.includes('SELECT count(*)::int AS count') && text.includes('client_hash')) {
      const [clientHash, windowMinutes] = values;
      const cutoff = Date.now() - windowMinutes * 60 * 1000;
      let count = 0;
      for (const row of store.values()) {
        if (row.client_hash === clientHash && new Date(row.created_at).getTime() > cutoff) count++;
      }
      return Promise.resolve([{ count }]);
    }

    if (text.includes('UPDATE captcha_challenges')) {
      const [id] = values;
      const row = store.get(id);
      if (!row || row.used_at) return Promise.resolve([]);
      row.used_at = new Date().toISOString();
      return Promise.resolve([{ id }]);
    }

    throw new Error(`Unexpected query in fake sql: ${text}`);
  }

  return { sql, store };
}

async function run() {
  /* ── Fail closed when secret is missing ── */
  {
    let threw = false;
    try {
      getCaptchaPepper({});
    } catch (err) {
      threw = true;
    }
    assert(threw, 'getCaptchaPepper lanza si CAPTCHA_PEPPER falta (fail closed)');
  }

  {
    const { sql } = makeFakeSql();
    let threw = false;
    try {
      await createCaptchaChallenge(sql, {});
    } catch (err) {
      threw = true;
    }
    assert(threw, 'createCaptchaChallenge falla cerrado sin CAPTCHA_PEPPER (no crea challenge)');
  }

  {
    const { sql } = makeFakeSql();
    const result = await consumeCaptchaChallenge(sql, 'whatever', '123456', {});
    assert(!result.ok, 'consumeCaptchaChallenge falla cerrado sin CAPTCHA_PEPPER');
  }

  /* ── Hash never stores plaintext, correct answer validates ── */
  {
    const { sql, store } = makeFakeSql();
    const challenge = await createCaptchaChallenge(sql, TEST_ENV);
    assert(typeof challenge.challengeId === 'string' && challenge.challengeId.length > 0, 'challenge trae challengeId');
    assert(typeof challenge.image === 'string' && challenge.image.startsWith('data:image/svg+xml;base64,'), 'challenge trae imagen SVG data-uri');
    assert(challenge.answer === undefined, 'challenge response nunca expone "answer"');

    const stored = store.get(challenge.challengeId);
    assert(stored && /^[0-9a-f]{64}$/.test(stored.answer_hash), 'answer_hash almacenado es un hash hex, no texto plano');
  }

  /* ── Correct answer path (using a manually crafted challenge+hash) ── */
  {
    const { sql, store } = makeFakeSql();
    const id = 'chal-1';
    const answer = '654321';
    const hash = hashCaptchaAnswer(TEST_ENV.CAPTCHA_PEPPER, id, answer);
    store.set(id, { id, answer_hash: hash, expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null });

    const result = await consumeCaptchaChallenge(sql, id, answer, TEST_ENV);
    assert(result.ok === true, 'Respuesta correcta y challenge vigente → ok:true');

    const after = store.get(id);
    assert(!!after.used_at, 'Challenge queda marcado como usado tras validación exitosa');
  }

  /* ── Wrong answer ── */
  {
    const { sql, store } = makeFakeSql();
    const id = 'chal-2';
    const hash = hashCaptchaAnswer(TEST_ENV.CAPTCHA_PEPPER, id, '111111');
    store.set(id, { id, answer_hash: hash, expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null });

    const result = await consumeCaptchaChallenge(sql, id, '999999', TEST_ENV);
    assert(!result.ok && result.error === CAPTCHA_ERRORS.INVALID, 'Respuesta incorrecta → captcha_invalid');
  }

  /* ── Expired ── */
  {
    const { sql, store } = makeFakeSql();
    const id = 'chal-3';
    const hash = hashCaptchaAnswer(TEST_ENV.CAPTCHA_PEPPER, id, '222222');
    store.set(id, { id, answer_hash: hash, expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null });

    const result = await consumeCaptchaChallenge(sql, id, '222222', TEST_ENV);
    assert(!result.ok && result.error === CAPTCHA_ERRORS.EXPIRED, 'Challenge expirado → captcha_expired');
  }

  /* ── Already used / replay ── */
  {
    const { sql, store } = makeFakeSql();
    const id = 'chal-4';
    const answer = '333333';
    const hash = hashCaptchaAnswer(TEST_ENV.CAPTCHA_PEPPER, id, answer);
    store.set(id, { id, answer_hash: hash, expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null });

    const first = await consumeCaptchaChallenge(sql, id, answer, TEST_ENV);
    assert(first.ok === true, 'Primer intento con challenge válido → ok:true');

    const replay = await consumeCaptchaChallenge(sql, id, answer, TEST_ENV);
    assert(!replay.ok && replay.error === CAPTCHA_ERRORS.USED, 'Segundo intento (replay) con el mismo challenge → captcha_used');
  }

  /* ── Nonexistent challenge ── */
  {
    const { sql } = makeFakeSql();
    const result = await consumeCaptchaChallenge(sql, 'does-not-exist', '123456', TEST_ENV);
    assert(!result.ok && result.error === CAPTCHA_ERRORS.INVALID, 'Challenge inexistente → captcha_invalid');
  }

  /* ── Invalid format ── */
  {
    const { sql } = makeFakeSql();
    const result = await consumeCaptchaChallenge(sql, 'chal-x', 'abc', TEST_ENV);
    assert(!result.ok && result.error === CAPTCHA_ERRORS.INVALID, 'Respuesta con formato inválido (no 6 dígitos) → captcha_invalid');
  }

  {
    const { sql } = makeFakeSql();
    const result = await consumeCaptchaChallenge(sql, '', '123456', TEST_ENV);
    assert(!result.ok && result.error === CAPTCHA_ERRORS.REQUIRED, 'challengeId ausente → captcha_required');
  }

  /* ── Challenge-creation rate limiting (abuse control) ── */
  {
    const hashA = hashClientIdentifier(TEST_ENV.CAPTCHA_PEPPER, '203.0.113.10');
    const hashB = hashClientIdentifier(TEST_ENV.CAPTCHA_PEPPER, '203.0.113.99');
    assert(hashA !== hashB, 'IPs distintas producen client_hash distintos');
    assert(/^[0-9a-f]{64}$/.test(hashA), 'client_hash es un hash hex, no la IP en texto plano');
  }

  {
    // Fail closed: without CAPTCHA_PEPPER the rate limiter must not allow through.
    const { sql } = makeFakeSql();
    const result = await checkCaptchaChallengeRateLimit(sql, '203.0.113.10', {});
    assert(result.allowed === false, 'checkCaptchaChallengeRateLimit falla cerrado sin CAPTCHA_PEPPER');
  }

  {
    const { sql } = makeFakeSql();
    const ip = '198.51.100.20';

    // A human refreshing a handful of times must stay within the limit.
    for (let i = 0; i < 3; i++) {
      const check = await checkCaptchaChallengeRateLimit(sql, ip, TEST_ENV);
      assert(check.allowed === true, `Intento humano #${i + 1} dentro del límite → permitido`);
      await createCaptchaChallenge(sql, TEST_ENV, check.clientHash);
    }

    // Drive it up to the limit with scripted bursts and confirm it blocks.
    let blocked = false;
    for (let i = 3; i < CAPTCHA_CHALLENGE_RATE_LIMIT_MAX + 5; i++) {
      const check = await checkCaptchaChallengeRateLimit(sql, ip, TEST_ENV);
      if (!check.allowed) { blocked = true; break; }
      await createCaptchaChallenge(sql, TEST_ENV, check.clientHash);
    }
    assert(blocked, `Ráfaga automatizada por encima de ${CAPTCHA_CHALLENGE_RATE_LIMIT_MAX} challenges → bloqueada`);
  }

  {
    // A different client (different IP → different hash) is unaffected by
    // another client's burst.
    const { sql } = makeFakeSql();
    const abusiveIp = '198.51.100.30';
    for (let i = 0; i < CAPTCHA_CHALLENGE_RATE_LIMIT_MAX + 2; i++) {
      const check = await checkCaptchaChallengeRateLimit(sql, abusiveIp, TEST_ENV);
      if (!check.allowed) break;
      await createCaptchaChallenge(sql, TEST_ENV, check.clientHash);
    }
    const otherClient = await checkCaptchaChallengeRateLimit(sql, '198.51.100.31', TEST_ENV);
    assert(otherClient.allowed === true, 'El rate limit de un cliente no afecta a un cliente distinto');
  }

  console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal error in tests', err);
  process.exit(1);
});
