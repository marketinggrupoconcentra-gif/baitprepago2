import { isValidDateOnly, isWithinNipValidityWindow } from './cdmx-date.js';

// Trunca strings para evitar inyecciones muy largas en el campo
export function truncate(str, max) {
  if (!str || typeof str !== 'string') return null;
  return str.slice(0, max || 255);
}

const EMAIL_MAX_LENGTH = 254;
const FIRST_NAME_MAX_LENGTH = 120;
const LAST_NAME_MAX_LENGTH = 160;
// No internal whitespace, one @, a local part and a domain with a dot.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(rawEmail) {
  if (typeof rawEmail !== 'string') return null;
  const trimmed = rawEmail.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null;
  if (trimmed.length > EMAIL_MAX_LENGTH) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function normalizePersonName(rawValue, maxLength) {
  if (typeof rawValue !== 'string') return null;
  const normalized = rawValue.replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

export function validateLeadPayload(body, now = new Date()) {
  const phone = (body.phone || '').toString().replace(/\D/g, '').slice(0, 10);
  const nip = (body.nip || '').toString().replace(/\D/g, '').slice(0, 4);
  const consent = body.consent === true;

  const errors = [];
  if (!/^\d{10}$/.test(phone)) errors.push('phone_invalid');
  if (!/^\d{4}$/.test(nip)) errors.push('nip_invalid');
  if (!consent) errors.push('consent_required');

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

  const email = normalizeEmail(body.email);
  if (!email) errors.push('email_invalid');

  const firstName = normalizePersonName(body.nombre, FIRST_NAME_MAX_LENGTH);
  const lastName = normalizePersonName(body.apellido, LAST_NAME_MAX_LENGTH);
  if (!firstName) errors.push('first_name_invalid');
  if (!lastName) errors.push('last_name_invalid');

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      phone,
      email,
      firstName,
      lastName
      // NIP and nip_valid_until are deliberately omitted so they are never
      // passed to the persistence layer.
    }
  };
}
