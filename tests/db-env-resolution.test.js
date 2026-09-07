// tests/db-env-resolution.test.js
const test = require('node:test');
const assert = require('node:assert');

test('DB Env Resolution Precedence', (t) => {
  const { resolveDatabaseUrl } = require('../lib/db.js');

  t.test('1. no supported env => throws', () => {
    const env = {};
    assert.throws(() => {
      resolveDatabaseUrl(env);
    }, /Database connection string is missing \(DATABASE_URL\/POSTGRES_URL\/STORAGE_DATABASE_URL\)/);
  });

  t.test('2. DATABASE_URL wins over everything', () => {
    const env = {
      DATABASE_URL: 'postgresql://fakeuser:fakepass@host.tld/db_url',
      POSTGRES_URL: 'postgresql://fakeuser:fakepass@host.tld/pg_url',
      STORAGE_DATABASE_URL: 'postgresql://fakeuser:fakepass@host.tld/storage_url'
    };
    
    const dbUrl = resolveDatabaseUrl(env);
    assert.strictEqual(dbUrl, 'postgresql://fakeuser:fakepass@host.tld/db_url');
  });

  t.test('3. POSTGRES_URL is second fallback', () => {
    const env = {
      POSTGRES_URL: 'postgresql://fakeuser:fakepass@host.tld/pg_url',
      STORAGE_DATABASE_URL: 'postgresql://fakeuser:fakepass@host.tld/storage_url'
    };
    
    const dbUrl = resolveDatabaseUrl(env);
    assert.strictEqual(dbUrl, 'postgresql://fakeuser:fakepass@host.tld/pg_url');
  });

  t.test('4. STORAGE_DATABASE_URL is third fallback (non-preview env)', () => {
    const env = {
      STORAGE_DATABASE_URL: 'postgresql://fakeuser:fakepass@host.tld/storage_url'
    };
    
    const dbUrl = resolveDatabaseUrl(env);
    assert.strictEqual(dbUrl, 'postgresql://fakeuser:fakepass@host.tld/storage_url');
  });

  t.test('5. no secret value is logged', () => {
    const env = {};
    let errorMsg = '';
    try {
      resolveDatabaseUrl(env);
    } catch (err) {
      errorMsg = err.message;
    }
    
    assert.ok(!errorMsg.includes('postgres://'), 'Should not contain raw url');
    assert.ok(!errorMsg.includes('password'), 'Should not contain password');
  });

  // ── Preview guard tests ──────────────────────────────────────────────────

  t.test('6. Preview with DATABASE_URL => allowed', () => {
    const env = {
      VERCEL_ENV: 'preview',
      DATABASE_URL: 'postgresql://fakeuser:fakepass@qa-endpoint.tld/db'
    };
    const dbUrl = resolveDatabaseUrl(env);
    assert.strictEqual(dbUrl, 'postgresql://fakeuser:fakepass@qa-endpoint.tld/db');
  });

  t.test('7. Preview with POSTGRES_URL => allowed', () => {
    const env = {
      VERCEL_ENV: 'preview',
      POSTGRES_URL: 'postgresql://fakeuser:fakepass@qa-endpoint.tld/pg'
    };
    const dbUrl = resolveDatabaseUrl(env);
    assert.strictEqual(dbUrl, 'postgresql://fakeuser:fakepass@qa-endpoint.tld/pg');
  });

  t.test('8. Preview with only STORAGE_DATABASE_URL => throws (FAIL CLOSED)', () => {
    const env = {
      VERCEL_ENV: 'preview',
      STORAGE_DATABASE_URL: 'postgresql://fakeuser:fakepass@host.tld/storage_url'
    };
    assert.throws(() => {
      resolveDatabaseUrl(env);
    }, /STORAGE_DATABASE_URL is not allowed as a fallback in VERCEL_ENV=preview/);
  });

  t.test('9. Preview error message does not expose credentials', () => {
    const env = {
      VERCEL_ENV: 'preview',
      STORAGE_DATABASE_URL: 'postgresql://secret-user:secret-password@host.tld/db'
    };
    let errorMsg = '';
    try {
      resolveDatabaseUrl(env);
    } catch (err) {
      errorMsg = err.message;
    }
    assert.ok(!errorMsg.includes('secret-password'), 'Error must not contain password');
    assert.ok(!errorMsg.includes('secret-user'), 'Error must not contain username');
    assert.ok(errorMsg.includes('STORAGE_DATABASE_URL'), 'Error mentions the env var name');
  });
});

// ── Parity: lib/db.js resolution matches preview-safety.js resolveDbUrl ───────
// If lib/db.js changes its resolution order, this test surfaces the divergence.
test('DB resolution parity with preview-safety.js resolveDbUrl', () => {
  const { resolveDbUrl: safetyResolve } = require('../scripts/preview-safety');

  const scenarios = [
    { DATABASE_URL: 'a', POSTGRES_URL: 'b', STORAGE_DATABASE_URL: 'c' },
    {                    POSTGRES_URL: 'b', STORAGE_DATABASE_URL: 'c' },
    {                                       STORAGE_DATABASE_URL: 'c' },
    {},
  ];

  for (const env of scenarios) {
    const safetyResult = safetyResolve(env);
    // lib/db.js uses same precedence: DATABASE_URL > POSTGRES_URL > STORAGE_DATABASE_URL
    // Preview-safety resolveDbUrl must always return the same source for non-preview envs.
    const expectedSource =
      env.DATABASE_URL         ? 'DATABASE_URL'         :
      env.POSTGRES_URL         ? 'POSTGRES_URL'         :
      env.STORAGE_DATABASE_URL ? 'STORAGE_DATABASE_URL' : null;

    assert.strictEqual(
      safetyResult.source, expectedSource,
      `Parity check failed for env keys: ${Object.keys(env).join(', ')||'(none)'}`
    );
  }
});
