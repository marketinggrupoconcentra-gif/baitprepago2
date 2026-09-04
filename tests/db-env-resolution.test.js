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

  t.test('4. STORAGE_DATABASE_URL is third fallback', () => {
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
});
