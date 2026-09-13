import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from 'crypto';

// ── Claves de cifrado ─────────────────────────────────────────────────────────
// Estas claves se cargan desde variables de entorno en tiempo de ejecución.
// NUNCA se deben hardcodear ni loggear.

function getKey(envVar: string, label: string): Buffer {
  const raw = process.env[envVar];
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[crypto] Variable ${envVar} es requerida en producción.`);
    }
    // En desarrollo, advertir pero no detener
    console.warn(`[crypto] WARN: ${envVar} no está definida. Usando clave de prueba insegura.`);
    return Buffer.from('00'.repeat(32), 'hex'); // 256-bit fallback solo dev
  }
  
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`[crypto] ${label}: se esperan exactamente 64 caracteres hexadecimales.`);
  }

  return Buffer.from(raw, 'hex');
}

// ── AES-256-GCM: cifrado de PII ───────────────────────────────────────────────
// Formato de salida (v1): v1:base64(iv):base64(authTag):base64(ciphertext)
// Formato legacy: base64(iv):base64(authTag):base64(ciphertext)
// IV: 12 bytes aleatorios por cifrado (nunca reutilizar IV con la misma clave)

export function encryptPII(plaintext: string): string {
  const key = getKey('PII_ENCRYPTION_KEY', 'PII_ENCRYPTION_KEY');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

function assertValidBase64(str: string, label: string, expectedBytes?: number) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str) || str.length % 4 !== 0) {
    throw new Error(`[crypto] ${label} no es Base64 válido`);
  }
  if (expectedBytes !== undefined) {
    // Length in bytes of base64 string = (len * 3) / 4 - padding
    const padding = (str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0);
    const bytes = (str.length * 3) / 4 - padding;
    if (bytes !== expectedBytes) {
      throw new Error(`[crypto] ${label} debe tener exactamente ${expectedBytes} bytes (recibido: ${bytes})`);
    }
  }
}

export function decryptPII(ciphertext: string): string {
  const key = getKey('PII_ENCRYPTION_KEY', 'PII_ENCRYPTION_KEY');
  const parts = ciphertext.split(':');
  
  let ivB64: string, tagB64: string, dataB64: string;

  if (parts.length === 4 && parts[0] === 'v1') {
    [, ivB64, tagB64, dataB64] = parts;
  } else if (parts.length === 3) {
    // Legacy format
    [ivB64, tagB64, dataB64] = parts;
  } else {
    throw new Error('[crypto] Formato de ciphertext inválido o versión no soportada.');
  }

  assertValidBase64(ivB64, 'IV', 12);
  assertValidBase64(tagB64, 'AuthTag', 16);
  assertValidBase64(dataB64, 'Ciphertext');

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString('utf8');
}

// ── HMAC-SHA256: blind index para búsqueda exacta ────────────────────────────
// Permite buscar por email o teléfono sin descifrar los datos.
// La llave es DISTINTA a PII_ENCRYPTION_KEY — nunca reutilizar.

export function blindIndex(value: string): string {
  const key = getKey('PII_BLIND_INDEX_KEY', 'PII_BLIND_INDEX_KEY');
  // Normalizar antes del índice: trim + lowercase
  const normalized = value.trim().toLowerCase();
  return createHmac('sha256', key)
    .update(normalized, 'utf8')
    .digest('hex');
}

// ── HMAC-SHA256: hash de IP para security_events ────────────────────────────
// Nunca almacenar IP completa. Solo el hash con IP_HASH_KEY.

export function hashIp(ip: string): string {
  const key = getKey('IP_HASH_KEY', 'IP_HASH_KEY');
  return createHmac('sha256', key)
    .update(ip, 'utf8')
    .digest('hex');
}

// ── Hash de payload para idempotencia ────────────────────────────────────────
// SHA-256 del body canonicalizado para detectar payloads distintos con la misma key.

export function hashPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ── HMAC-SHA256 genérico ──────────────────────────────────────────────────────
// Usado para audit logs y otros casos donde la clave no es un Buffer de 32 bytes.

export async function hashHmac(value: string, key: string): Promise<string> {
  return createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(value, 'utf8')
    .digest('hex');
}
