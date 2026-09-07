import { isValidDateOnly, isWithinNipValidityWindow } from './cdmx-date.js';

// Trunca strings para evitar inyecciones muy largas en el campo
export function truncate(str, max) {
  if (!str || typeof str !== 'string') return null;
  return str.slice(0, max || 255);
}

const EMAIL_MAX_LENGTH = 254;
// No internal whitespace, one @, a local part and a domain with a dot.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(rawEmail) {
  if (typeof rawEmail !== 'string') return null;
  const trimmed = rawEmail.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null; // no internal spaces allowed
  if (trimmed.length > EMAIL_MAX_LENGTH) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function validateLeadPayload(body, now = new Date()) {
  // Validaciones básicas del lado del servidor
  const phone = (body.phone || '').toString().replace(/\D/g, '').slice(0, 10);
  const nip = (body.nip || '').toString().replace(/\D/g, '').slice(0, 4);
  const consent = body.consent === true; // or however we pass it, but usually standard is string/boolean

  const errors = [];
  if (!/^\d{10}$/.test(phone)) errors.push('phone_invalid');
  if (!/^\d{4}$/.test(nip)) errors.push('nip_invalid'); // Even if we don't save it, we validate its presence and format to block spam

  // ── NIP conditional validity window ────────────────────────────────
  // If the NIP equals the phone's last 4 digits, a nip_valid_until date
  // (YYYY-MM-DD, CDMX civil day, today..today+5 inclusive) is required.
  // NIP is deliberately validated but never persisted (see lib/cdmx-date.js).
  const phoneLast4 = /^\d{10}$/.test(phone) ? phone.slice(-4) : null;
  const nipMatchesPhone = /^\d{4}$/.test(nip) && phoneLast4 !== null && nip === phoneLast4;

  if (nipMatchesPhone) {
    const rawNipValidUntil = body.nip_valid_until;
    if (rawNipValidUntil === undefined || rawNipValidUntil === null || rawNipValidUntil === '') {
      errors.push('nip_valid_until_required');
    } else if (!isValidDateOnly(String(rawNipValidUntil))) {
      errors.push('nip_valid_until_invalid');
    } else if (!isWithinNipValidityWindow(String(rawNipValidUntil), now)) {
      errors.push('nip_valid_until_out_of_range');
    }
  }

  // ── Email ────────────────────────────────────────────────────────────
  const email = normalizeEmail(body.email);
  if (!email) errors.push('email_invalid');

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      phone,
      email
      // NIP and nip_valid_until are deliberately omitted here so they are
      // never passed to the DB layer.
    }
  };
}
