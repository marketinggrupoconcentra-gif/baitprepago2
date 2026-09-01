import assert from 'assert';
import crypto from 'crypto';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  hashIdentity,
  serializeSessionCookie,
  clearSessionCookie,
  assertSameOrigin
} from '../lib/admin-auth.js';

// Setup Mock Env for testing
process.env.ADMIN_AUTH_PEPPER = 'test_pepper_123';
process.env.VERCEL_ENV = 'preview';

async function runTests() {
  console.log('Running Admin Auth Unit Tests...');
  let passCount = 0;
  let failCount = 0;

  function runTest(name, fn) {
    try {
      fn();
      console.log(`✅ PASS: ${name}`);
      passCount++;
    } catch (e) {
      console.error(`❌ FAIL: ${name}`, e);
      failCount++;
    }
  }

  async function runAsyncTest(name, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passCount++;
    } catch (e) {
      console.error(`❌ FAIL: ${name}`, e);
      failCount++;
    }
  }

  await runAsyncTest('hashPassword and verifyPassword success', async () => {
    const password = 'A very strong password 123!';
    const hash = await hashPassword(password);
    assert(hash.startsWith('scrypt$'), 'Hash should start with scrypt$');
    const isValid = await verifyPassword(password, hash);
    assert(isValid === true, 'Password should be valid');
  });

  await runAsyncTest('verifyPassword failure', async () => {
    const hash = await hashPassword('password123');
    const isValid = await verifyPassword('wrongpassword', hash);
    assert(isValid === false, 'Password should be invalid');
  });

  await runAsyncTest('invalid hash format', async () => {
    const isValid1 = await verifyPassword('password', 'invalid_format');
    assert(isValid1 === false);
    const isValid2 = await verifyPassword('password', 'scrypt$32768$8$3$salt');
    assert(isValid2 === false);
  });

  await runAsyncTest('invalid/excessive scrypt parameters', async () => {
    // Manually construct a malicious hash with massive N
    // N=1048576, r=8, p=1 (Would consume too much memory)
    const maliciousHash = 'scrypt$1048576$8$1$salt$hash';
    const isValid = await verifyPassword('password', maliciousHash);
    assert(isValid === false, 'Malicious parameters should be rejected gracefully without exhausting resources');
  });

  runTest('session token generation', () => {
    const token = generateSessionToken();
    assert(typeof token === 'string');
    assert(token.length === 64); // 32 bytes hex = 64 chars
  });

  runTest('session token hashing', () => {
    const token = 'my_test_token';
    const hash = hashSessionToken(token);
    assert(hash === crypto.createHash('sha256').update('my_test_token').digest('hex'));
  });

  runTest('cookie serialization', () => {
    const cookie = serializeSessionCookie('token123');
    assert(cookie.includes('bait_admin_session=token123'));
    assert(cookie.includes('HttpOnly'));
    assert(cookie.includes('Secure'));
    assert(cookie.includes('SameSite=Strict'));
    assert(cookie.includes('Path=/'));
  });

  runTest('cookie clearing', () => {
    const cookie = clearSessionCookie();
    assert(cookie.includes('bait_admin_session=;'));
    assert(cookie.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT'));
  });

  runTest('identity HMAC', () => {
    const hash = hashIdentity('ip:127.0.0.1');
    assert(hash === crypto.createHmac('sha256', 'test_pepper_123').update('ip:127.0.0.1').digest('hex'));
  });

  runTest('same-origin valid', () => {
    const req = {
      headers: {
        origin: 'https://example.com',
        'x-forwarded-host': 'example.com'
      }
    };
    assert.doesNotThrow(() => assertSameOrigin(req));
  });

  runTest('same-origin invalid', () => {
    const req = {
      headers: {
        origin: 'https://attacker.com',
        'x-forwarded-host': 'example.com'
      }
    };
    assert.throws(() => assertSameOrigin(req), /Same-origin violation/);
  });

  runTest('email normalization', () => {
    const email = '  Test.USER@Domain.com   ';
    const normalizedEmail = email.toLowerCase().trim();
    assert(normalizedEmail === 'test.user@domain.com');
  });

  console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

runTests();
