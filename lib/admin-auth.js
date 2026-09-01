/**
 * lib/admin-auth.js
 * 
 * Security primitives for BAIT Admin Authentication.
 * Uses only Node.js built-in 'crypto'. No external auth libraries.
 * 
 * DUMMY_PASSWORD_HASH is a fixed scrypt hash of a known dummy string.
 * It is NOT a secret — its only purpose is constant-time dummy verification
 * for unknown users so timing does not reveal account existence.
 * 
 * Generated once via:
 *   crypto.scryptSync('__dummy_bait_prepago_sentinel__', 'aabbccddeeff00112233445566778899', 64,
 *     { N: 32768, r: 8, p: 3, maxmem: 128 * 1024 * 1024 }).toString('hex')
 */
import crypto from 'crypto';

// Known scrypt profile we accept — reject anything outside this set
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_SALT_HEX_LEN = 32;  // 16 bytes → 32 hex chars
const SCRYPT_HASH_HEX_LEN = 128; // 64 bytes → 128 hex chars

// Pre-computed dummy hash for unknown/inactive users (not a secret)
// salt: aabbccddeeff00112233445566778899 (16 bytes)
// input: __dummy_bait_prepago_sentinel__
export const DUMMY_PASSWORD_HASH = (() => {
  const dummyKey = crypto.scryptSync(
    '__dummy_bait_prepago_sentinel__',
    'aabbccddeeff00112233445566778899',
    64,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * 1024 * 1024 }
  ).toString('hex');
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$aabbccddeeff00112233445566778899$${dummyKey}`;
})();

/**
 * Validates scrypt parameters are within the known safe profile.
 * Accepts only exact N=32768, r=8, p=3.
 */
function validateScryptParams(N, r, p) {
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    throw new Error('Scrypt params contain non-integer values.');
  }
  if (N <= 0 || r <= 0 || p <= 0) {
    throw new Error('Scrypt params must be positive.');
  }
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    throw new Error(`Unexpected scrypt profile: N=${N} r=${r} p=${p}. Expected N=${SCRYPT_N} r=${SCRYPT_R} p=${SCRYPT_P}.`);
  }
}

/**
 * Validates salt and hash hex strings for expected lengths.
 */
function validateSaltAndHash(salt, hashHex) {
  if (typeof salt !== 'string' || salt.length !== SCRYPT_SALT_HEX_LEN) {
    throw new Error(`Invalid salt: expected ${SCRYPT_SALT_HEX_LEN} hex chars, got ${typeof salt === 'string' ? salt.length : typeof salt}.`);
  }
  if (!/^[0-9a-f]+$/.test(salt)) {
    throw new Error('Salt contains non-hex characters.');
  }
  if (typeof hashHex !== 'string' || hashHex.length !== SCRYPT_HASH_HEX_LEN) {
    throw new Error(`Invalid hash: expected ${SCRYPT_HASH_HEX_LEN} hex chars, got ${typeof hashHex === 'string' ? hashHex.length : typeof hashHex}.`);
  }
  if (!/^[0-9a-f]+$/.test(hashHex)) {
    throw new Error('Hash contains non-hex characters.');
  }
}

export async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex'); // 16 bytes = 32 hex chars
    crypto.scrypt(
      password,
      salt,
      64, // 64 bytes = 128 hex chars
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * 1024 * 1024 },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(`scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString('hex')}`);
      }
    );
  });
}

export async function verifyPassword(password, hashString) {
  return new Promise((resolve) => {
    if (!hashString || typeof hashString !== 'string' || !hashString.startsWith('scrypt$')) {
      resolve(false);
      return;
    }
    const parts = hashString.split('$');
    if (parts.length !== 6) {
      resolve(false);
      return;
    }
    const [, Nstr, rstr, pstr, salt, hashHex] = parts;
    const N = parseInt(Nstr, 10);
    const r = parseInt(rstr, 10);
    const p = parseInt(pstr, 10);

    try {
      validateScryptParams(N, r, p);
      validateSaltAndHash(salt, hashHex);
    } catch (e) {
      resolve(false);
      return;
    }

    const hashBuffer = Buffer.from(hashHex, 'hex');

    crypto.scrypt(
      password,
      salt,
      hashBuffer.length,
      { N, r, p, maxmem: 128 * 1024 * 1024 },
      (err, derivedKey) => {
        if (err) {
          resolve(false);
          return;
        }
        try {
          resolve(crypto.timingSafeEqual(hashBuffer, derivedKey));
        } catch (_e) {
          resolve(false);
        }
      }
    );
  });
}

export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashIdentity(value) {
  const pepper = process.env.ADMIN_AUTH_PEPPER;
  if (!pepper) {
    throw new Error('ADMIN_AUTH_PEPPER is missing.');
  }
  return crypto.createHmac('sha256', pepper).update(value).digest('hex');
}

export function serializeSessionCookie(token) {
  const isProdOrPreview = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  const secureFlag = isProdOrPreview ? ' Secure;' : '';
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString();
  return `bait_admin_session=${token}; HttpOnly;${secureFlag} SameSite=Strict; Path=/; Expires=${expires}`;
}

export function clearSessionCookie() {
  const isProdOrPreview = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  const secureFlag = isProdOrPreview ? ' Secure;' : '';
  return `bait_admin_session=; HttpOnly;${secureFlag} SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const key = parts.shift().trim();
      const val = parts.join('=').trim();
      if (key) list[key] = decodeURIComponent(val);
    });
  }
  return list;
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return 'unknown';
}

export function sanitizeUserAgent(req) {
  const ua = req.headers['user-agent'] || 'unknown';
  return ua.substring(0, 255);
}

export function isVercelEnvironment() {
  return !!process.env.VERCEL_ENV;
}

export function assertSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  if (isVercelEnvironment()) {
    if (!origin) {
      throw new Error('Same-origin violation: Origin header missing in Vercel environment.');
    }
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch (_e) {
      throw new Error('Same-origin violation: malformed Origin header.');
    }
    if (originHost !== host) {
      throw new Error('Same-origin violation.');
    }
  } else if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch (_e) {
      throw new Error('Same-origin violation: malformed Origin header.');
    }
    if (originHost !== host) {
      throw new Error('Same-origin violation.');
    }
  }
}
