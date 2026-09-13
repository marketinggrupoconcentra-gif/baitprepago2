import { describe, test, expect } from 'vitest';
import { encryptPII, decryptPII, blindIndex, hashPayload } from '@/lib/crypto';

// ── Setup de claves de prueba ─────────────────────────────────────────────────
// En producción, estas claves vienen de env vars reales.
process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
process.env.PII_BLIND_INDEX_KEY = 'b'.repeat(64);
process.env.IP_HASH_KEY = 'c'.repeat(64);

describe('encryptPII / decryptPII', () => {
  test('debe cifrar y descifrar correctamente', () => {
    const plaintext = 'test@example.com';
    const encrypted = encryptPII(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptPII(encrypted)).toBe(plaintext);
  });

  test('el ciphertext debe tener formato v1:iv:tag:data', () => {
    const encrypted = encryptPII('hola mundo');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    // iv: 12 bytes → 16 chars base64
    expect(Buffer.from(parts[1], 'base64').length).toBe(12);
    // tag: 16 bytes → 24 chars base64
    expect(Buffer.from(parts[2], 'base64').length).toBe(16);
  });

  test('misma entrada → IV diferente (cada cifrado es único)', () => {
    const enc1 = encryptPII('test');
    const enc2 = encryptPII('test');
    // El IV es aleatorio, así que los ciphertexts DEBEN ser diferentes
    expect(enc1).not.toBe(enc2);
    // Pero ambos se descifran al mismo valor
    expect(decryptPII(enc1)).toBe('test');
    expect(decryptPII(enc2)).toBe('test');
  });

  test('puede descifrar formato legacy (3 partes)', async () => {
    const iv = Buffer.from('123456789012'); // 12 bytes
    const key = Buffer.from(process.env.PII_ENCRYPTION_KEY as string, 'hex');
    const { createCipheriv } = await import('crypto');
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update('legacy_test', 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    const legacyCiphertext = [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64')
    ].join(':');

    expect(decryptPII(legacyCiphertext)).toBe('legacy_test');
  });

  test('debe lanzar error con ciphertext malformado', () => {
    expect(() => decryptPII('invalid:format')).toThrow();
    expect(() => decryptPII('v1:invalid:format')).toThrow();
  });

  test('debe lanzar error si la clave no es hexadecimal de 64 chars', () => {
    const original = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_ENCRYPTION_KEY = 'z'.repeat(64); // no hex
    expect(() => encryptPII('test')).toThrow('exactamente 64 caracteres hexadecimales');
    
    process.env.PII_ENCRYPTION_KEY = 'a'.repeat(63); // 63 chars
    expect(() => encryptPII('test')).toThrow('exactamente 64 caracteres hexadecimales');
    process.env.PII_ENCRYPTION_KEY = original;
  });

  test('debe lanzar error si el Base64 de la parte es inválido o tamaño incorrecto', () => {
    const valid = encryptPII('test');
    const parts = valid.split(':');
    
    // Test base64 con caracter inválido
    const badBase64 = [...parts];
    badBase64[1] = 'invalid_iv_base64!';
    expect(() => decryptPII(badBase64.join(':'))).toThrow('IV no es Base64 válido');

    // Test IV de longitud incorrecta (11 bytes = 16 chars truncado)
    const badLenIv = [...parts];
    badLenIv[1] = 'SGVsbG9Xb3JsZCE='; // 11 bytes "HelloWorld!"
    expect(() => decryptPII(badLenIv.join(':'))).toThrow('debe tener exactamente 12 bytes');
  });
});

describe('blindIndex', () => {
  test('misma entrada → mismo hash', () => {
    expect(blindIndex('test@example.com')).toBe(blindIndex('test@example.com'));
  });

  test('normaliza a lowercase antes de indexar', () => {
    expect(blindIndex('Test@Example.COM')).toBe(blindIndex('test@example.com'));
  });

  test('entrada diferente → hash diferente', () => {
    expect(blindIndex('a@a.com')).not.toBe(blindIndex('b@b.com'));
  });

  test('el hash es un string hex de 64 chars (SHA-256)', () => {
    const h = blindIndex('test');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashPayload', () => {
  test('mismo objeto → mismo hash', () => {
    const obj = { a: 1, b: 'hello' };
    expect(hashPayload(obj)).toBe(hashPayload(obj));
  });

  test('diferente objeto → diferente hash', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});
