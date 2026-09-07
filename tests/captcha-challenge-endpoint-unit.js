/**
 * tests/captcha-challenge-endpoint-unit.js
 * Verifies api/captcha/challenge.js enforces same-origin using the
 * project's canonical assertSameOrigin() helper, and does so BEFORE
 * touching the database (so these tests need no DB connection).
 */

console.log('Running captcha-challenge-endpoint-unit tests...');
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

function makeReq({ headers = {}, method = 'POST' } = {}) {
  return {
    method,
    headers: Object.assign({ 'content-type': 'application/json' }, headers)
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  return res;
}

async function run() {
  const previousVercelEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'preview'; // simulate a real Vercel deployment

  const { default: handler } = await import('../api/captcha/challenge.js?t=' + Date.now());

  try {
    // ── Missing Origin in Vercel environment → 403 ──
    {
      const req = makeReq({ headers: { host: 'baitprepago2.vercel.app' } });
      const res = makeRes();
      await handler(req, res);
      assert(res.statusCode === 403, 'Origin ausente en entorno Vercel → 403');
    }

    // ── Malicious / mismatched Origin → 403 ──
    {
      const req = makeReq({
        headers: {
          origin: 'https://attacker.example.com',
          host: 'baitprepago2.vercel.app'
        }
      });
      const res = makeRes();
      await handler(req, res);
      assert(res.statusCode === 403, 'Origin distinto al host (ataque) → 403');
    }

    // ── Malformed Origin → 403 ──
    {
      const req = makeReq({
        headers: {
          origin: 'not-a-valid-url',
          host: 'baitprepago2.vercel.app'
        }
      });
      const res = makeRes();
      await handler(req, res);
      assert(res.statusCode === 403, 'Origin malformado → 403');
    }

    // ── No internal details leaked on 403 ──
    {
      const req = makeReq({ headers: { host: 'baitprepago2.vercel.app' } });
      const res = makeRes();
      await handler(req, res);
      const bodyStr = JSON.stringify(res.body || {});
      assert(!/Same-origin violation/i.test(bodyStr), '403 no revela el mensaje interno de assertSameOrigin');
      assert(res.body && res.body.error === 'Forbidden', '403 responde con un error genérico ("Forbidden")');
    }

    // ── Correct same-origin passes the check and proceeds past it ──
    // (it will fail later at getDb()/DB access since no DATABASE_URL is
    // configured in this unit test, but that failure must be a 500 from
    // the DB layer, never a 403 — proving same-origin was NOT what stopped it.)
    {
      const req = makeReq({
        headers: {
          origin: 'https://baitprepago2.vercel.app',
          host: 'baitprepago2.vercel.app'
        }
      });
      const res = makeRes();
      await handler(req, res);
      assert(res.statusCode !== 403, 'Same-origin correcto: la petición pasa el check (no 403)');
    }

    // ── Non-Vercel (local dev) with no Origin header is allowed through same-origin ──
    {
      delete process.env.VERCEL_ENV;
      const req = makeReq({ headers: { host: 'localhost:3000' } });
      const res = makeRes();
      await handler(req, res);
      assert(res.statusCode !== 403, 'Entorno local sin Origin no es bloqueado por same-origin');
    }
  } finally {
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  }

  console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal error in tests', err);
  process.exit(1);
});
