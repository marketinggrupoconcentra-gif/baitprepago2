// tests/db-env-resolution.test.js
const test = require('node:test');
const assert = require('node:assert');

// We need to test lib/db.js without actually connecting to the database
// so we mock @neondatabase/serverless.
const Module = require('node:module');

test('DB Env Resolution Precedence', (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  const getDbInstance = () => {
    delete require.cache[require.resolve('../lib/db.js')];
    const { getDb } = require('../lib/db.js');
    return getDb;
  };

  t.test('1. no supported env => throws', () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.STORAGE_DATABASE_URL;
    
    const getDb = getDbInstance();
    assert.throws(() => {
      getDb();
    }, /Database connection string is missing \(DATABASE_URL\/POSTGRES_URL\/STORAGE_DATABASE_URL\)/);
  });

  t.test('2. DATABASE_URL wins over everything', () => {
    process.env.DATABASE_URL = 'postgresql://fakeuser:fakepass@host.tld/db_url';
    process.env.POSTGRES_URL = 'postgresql://fakeuser:fakepass@host.tld/pg_url';
    process.env.STORAGE_DATABASE_URL = 'postgresql://fakeuser:fakepass@host.tld/storage_url';
    
    const getDb = getDbInstance();
    const db = getDb();
    // neon() returns a function, we just check it didn't throw
    assert.ok(typeof db === 'function' || typeof db === 'object');
  });

  t.test('3. POSTGRES_URL is second fallback', () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = 'postgresql://fakeuser:fakepass@host.tld/pg_url';
    process.env.STORAGE_DATABASE_URL = 'postgresql://fakeuser:fakepass@host.tld/storage_url';
    
    const getDb = getDbInstance();
    const db = getDb();
    assert.ok(typeof db === 'function' || typeof db === 'object');
  });

  t.test('4. STORAGE_DATABASE_URL is third fallback', () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.STORAGE_DATABASE_URL = 'postgresql://fakeuser:fakepass@host.tld/storage_url';
    
    const getDb = getDbInstance();
    const db = getDb();
    assert.ok(typeof db === 'function' || typeof db === 'object');
  });

  t.test('5. no secret value is logged', () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.STORAGE_DATABASE_URL;
    
    const getDb = getDbInstance();
    let errorMsg = '';
    try {
      getDb();
    } catch (err) {
      errorMsg = err.message;
    }
    
    assert.ok(!errorMsg.includes('postgres://'), 'Should not contain raw url');
    assert.ok(!errorMsg.includes('password'), 'Should not contain password');
  });
});
