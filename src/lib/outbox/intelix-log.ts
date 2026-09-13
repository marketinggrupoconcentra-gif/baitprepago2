/**
 * src/lib/outbox/intelix-log.ts
 *
 * Enmascara el payload que se envía a Intelix antes de guardarlo en
 * `delivery_outbox.last_error_payload` (jsonb, para debug en Logs).
 *
 * REGLA (política de privacidad Etapa 2.2): jamás persistir PII/NIP en claro
 * fuera de las columnas *_enc cifradas con AES-256-GCM. `last_error_payload`
 * se lee sin filtro de permiso `leads.detail.view` (ver
 * src/app/api/admin/logs/[id]/route.ts), así que este enmascarado es la única
 * protección — no debe revertirse "para depurar más fácil".
 */
import 'server-only';

const KEEP_PREFIX = 1; // caracteres visibles al inicio de un campo enmascarado

function mask(value: unknown, keepStart = KEEP_PREFIX, keepEnd = 0): string {
  const s = String(value ?? '');
  if (!s) return '';
  if (s.length <= keepStart + keepEnd) return '*'.repeat(s.length);
  return s.slice(0, keepStart) + '*'.repeat(s.length - keepStart - keepEnd) + (keepEnd ? s.slice(-keepEnd) : '');
}

function maskEmail(value: unknown): string {
  const s = String(value ?? '');
  const at = s.indexOf('@');
  if (at <= 0) return mask(s);
  return mask(s.slice(0, at)) + s.slice(at); // dominio visible, local part enmascarado
}

function maskPhone(value: unknown): string {
  return mask(value, 0, 2); // solo últimos 2 dígitos, como en el resto del admin
}

function maskBirthdate(value: unknown): string {
  // Solo se conserva el año — día/mes son suficientes junto al nombre para
  // reidentificar, y no aportan al diagnóstico de un error de formato/código.
  const s = String(value ?? '');
  const year = s.match(/\d{4}/)?.[0];
  return year ? `**/**/${year}` : mask(s);
}

/** Campos del payload de Intelix (src/app/api/cron/outbox/route.ts) y cómo enmascararlos. */
const MASKERS: Record<string, (v: unknown) => string> = {
  email: maskEmail,
  dn: maskPhone,
  nombre: (v) => mask(v),
  apellidos: (v) => mask(v),
  fecha_nacimiento: maskBirthdate,
  nip: () => '[REDACTED]', // secreto de verificación — nunca se expone, ni parcial
};

/**
 * Devuelve una copia del payload enviado a Intelix con los campos de PII
 * enmascarados. Los campos no-PII (compania, imei, plan_migracion, estado,
 * curp/rfc estáticos, capturista) se conservan tal cual: no identifican a
 * nadie por sí solos y son necesarios para depurar errores de validación.
 */
export function maskIntelixPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = MASKERS[key] ? MASKERS[key](value) : value;
  }
  return out;
}
