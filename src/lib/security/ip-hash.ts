import 'server-only';
import { createHmac } from 'crypto';

// ── IP Hash ───────────────────────────────────────────────────────────────────
// Nunca almacenar IP completa en security_events.
// Usar HMAC-SHA256 con IP_HASH_KEY para pseudonimización.
// El hash es reproducible (misma IP → mismo hash en el mismo servicio)
// pero no reversible sin la clave.

export function hashIp(ip: string): string {
  const keyHex = process.env.IP_HASH_KEY;
  if (!keyHex) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[ip-hash] IP_HASH_KEY no definida en producción.');
    }
    // Dev fallback: hash sin clave (inseguro, solo dev)
    return createHmac('sha256', Buffer.alloc(32)).update(ip).digest('hex');
  }
  const key = Buffer.from(keyHex, 'hex');
  return createHmac('sha256', key).update(ip, 'utf8').digest('hex');
}

/**
 * Extrae la IP real del request de Next.js / Vercel.
 * Confía en x-forwarded-for solo si viene del proxy de Vercel.
 */
export function extractIp(headers: Headers): string {
  // Vercel forwarda la IP real aquí
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    // Puede ser lista CSV: tomamos el primero (cliente original)
    return forwarded.split(',')[0].trim();
  }
  // Fallback
  return headers.get('x-real-ip') ?? 'unknown';
}
