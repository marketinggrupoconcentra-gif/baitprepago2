import 'server-only';

// ── Honeypot ──────────────────────────────────────────────────────────────────
// Campo trampa invisible para bots.
// Si el campo tiene algún valor, la request es de un bot (o un atacante).
// El nombre del campo debe ser semánticamente atractivo para bots.

export const HONEYPOT_FIELD = 'website'; // "atractivo" para scrapers/bots

export interface HoneypotResult {
  isBot: boolean;
  reason?: string;
}

/**
 * Evalúa si la request activó el honeypot.
 * @param body - El body parseado de la request (ya validado como objeto)
 */
export function checkHoneypot(body: Record<string, unknown>): HoneypotResult {
  const val = body[HONEYPOT_FIELD];

  // Si el campo existe y tiene valor → bot
  if (val !== undefined && val !== null && val !== '') {
    return { isBot: true, reason: 'honeypot_triggered' };
  }

  return { isBot: false };
}
