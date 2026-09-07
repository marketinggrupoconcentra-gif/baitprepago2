/**
 * lib/cdmx-date.js
 * Explicit civil-day helpers for the business timezone (America/Mexico_City).
 * Never derives "today" from the runtime/browser timezone or from UTC.
 */

export const BUSINESS_TIME_ZONE = 'America/Mexico_City';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function partsToDateOnly(parts) {
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/**
 * Returns today's civil date (YYYY-MM-DD) as observed in America/Mexico_City,
 * regardless of the host runtime's timezone.
 */
export function todayCDMX(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  return partsToDateOnly(parts);
}

/**
 * Validates strict YYYY-MM-DD format and that the date is a real calendar date.
 */
export function isValidDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcMs);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Adds N civil days to a YYYY-MM-DD date string. Pure calendar arithmetic
 * (UTC-anchored so it is not affected by DST or the host timezone) — the
 * input/output are civil dates, not instants.
 */
export function addCivilDays(dateOnly, days) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, day) + days * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * True when `dateOnly` (YYYY-MM-DD) is within [today CDMX, today CDMX + 5] inclusive.
 */
export function isWithinNipValidityWindow(dateOnly, now = new Date()) {
  if (!isValidDateOnly(dateOnly)) return false;
  const today = todayCDMX(now);
  const max = addCivilDays(today, 5);
  return dateOnly >= today && dateOnly <= max;
}
