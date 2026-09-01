import crypto from 'crypto';

/**
 * Validates scrypt parameters embedded in the hash string to prevent resource exhaustion.
 * @param {number} N 
 * @param {number} r 
 * @param {number} p 
 */
function validateScryptParams(N, r, p) {
  if (N > 32768 || r > 8 || p > 3) {
    throw new Error('Scrypt parameters exceed allowed limits.');
  }
}

export async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const N = 32768;
    const r = 8;
    const p = 3;
    crypto.scrypt(password, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`scrypt$${N}$${r}$${p}$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

export async function verifyPassword(password, hashString) {
  return new Promise((resolve, reject) => {
    if (!hashString || !hashString.startsWith('scrypt$')) {
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
    } catch (e) {
      resolve(false);
      return;
    }

    const hashBuffer = Buffer.from(hashHex, 'hex');

    crypto.scrypt(password, salt, hashBuffer.length, { N, r, p, maxmem: 128 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) {
        resolve(false);
        return;
      }
      try {
        const match = crypto.timingSafeEqual(hashBuffer, derivedKey);
        resolve(match);
      } catch (e) {
        resolve(false);
      }
    });
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
  const secure = isProdOrPreview ? 'Secure;' : '';
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString();
  return `bait_admin_session=${token}; HttpOnly; ${secure} SameSite=Strict; Path=/; Expires=${expires}`;
}

export function clearSessionCookie() {
  const isProdOrPreview = process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  const secure = isProdOrPreview ? 'Secure;' : '';
  return `bait_admin_session=; HttpOnly; ${secure} SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  rc && rc.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}

export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
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
      throw new Error('Origin header is required for mutations in Vercel environment.');
    }
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      throw new Error('Same-origin violation.');
    }
  } else if (origin) {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      throw new Error('Same-origin violation.');
    }
  }
}
