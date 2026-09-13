/**
 * src/lib/outbox/errors.ts
 *
 * Traduce el `last_error_code` saneado que guarda el outbox de Intelix
 * (src/app/api/cron/outbox/route.ts y src/lib/leads/submit-lead.ts) a una
 * etiqueta legible + una clasificación "¿se resuelve reintentando?".
 *
 * El código es un string corto y saneado (`[a-z0-9_]`, ≤40) — NUNCA la
 * respuesta cruda del proveedor. Este módulo NO inventa detalle que no exista:
 * para un código desconocido devuelve el propio código.
 */

export interface OutboxErrorInfo {
  label: string;
  detail: string;
  /** true → un reintento tiene sentido (timeouts, 5xx, red). false → error permanente. */
  retryable: boolean;
  /** Campo del payload enviado a Intelix que causó el rechazo (cuando se conoce). */
  field?: string;
}

interface Rule {
  test: (code: string) => boolean;
  label: string;
  detail: string;
  retryable: boolean;
}

/**
 * Catálogo de códigos de validación de Intelix (`errores[0].codigo` en su
 * respuesta 4xx). Mensaje tal cual lo documenta Intelix + el campo del
 * payload (ver src/app/api/cron/outbox/route.ts) al que corresponde.
 * Son errores de captura/formato del lead — reintentar no los resuelve
 * nunca, el dato sigue siendo inválido.
 */
export const INTELIX_VALIDATION_ERRORS: Record<string, { field: string; message: string }> = {
  '3001': { field: 'email', message: 'El campo email es obligatorio.' },
  '3002': { field: 'email', message: 'El formato del email no es válido.' },
  '3003': { field: 'dn', message: 'El número telefónico es obligatorio.' },
  '3004': { field: 'dn', message: 'El número telefónico debe tener exactamente 10 dígitos.' },
  '3005': { field: 'imei', message: 'El campo IMEI es obligatorio.' },
  '3006': { field: 'imei', message: 'El campo IMEI solo puede contener números.' },
  '3007': { field: 'nombre', message: 'El nombre es obligatorio.' },
  '3008': { field: 'apellidos', message: 'Los apellidos son obligatorios.' },
  '3009': { field: 'apellidos', message: 'Los apellidos solo pueden contener letras y espacios.' },
  '3010': { field: 'nombre', message: 'El nombre solo puede contener letras y espacios.' },
  '3011': { field: 'plan_migracion', message: 'El plan de migración es obligatorio.' },
  '3013': { field: 'estado_nacimiento', message: 'El estado de nacimiento es obligatorio.' },
  '3014': { field: 'estado_nacimiento', message: 'El estado de nacimiento no es válido.' },
  '3015': { field: 'nip', message: 'El NIP es obligatorio.' },
  '3016': { field: 'nip', message: 'El NIP debe tener exactamente 4 dígitos.' },
  '3017': { field: 'fecha_nacimiento', message: 'La fecha de nacimiento es obligatoria.' },
  '3018': { field: 'fecha_nacimiento', message: 'El formato de fecha de nacimiento debe ser DD/MM/YYYY (ejemplo: 03/03/1993).' },
  '3019': { field: 'curp', message: 'El CURP es obligatorio.' },
  '3020': { field: 'curp', message: 'El formato del CURP no es válido.' },
  '3021': { field: 'rfc', message: 'El RFC es obligatorio.' },
  '3022': { field: 'rfc', message: 'El formato del RFC no es válido.' },
  '3023': { field: 'dn', message: 'Ya tenemos un registro en proceso con este número telefónico.' },
  '3024': { field: 'plan_migracion', message: 'El plan de migración no es válido.' },
};

const RULES: Rule[] = [
  {
    test: (c) => c in INTELIX_VALIDATION_ERRORS,
    label: 'Datos rechazados por validación (Intelix)',
    detail: 'Intelix rechazó el lead por un dato de captura inválido (email, teléfono, IMEI, nombre, NIP, CURP/RFC, plan o registro duplicado). No se reintenta: corrige el lead o captúralo manualmente.',
    retryable: false,
  },
  {
    // REGLA: solo se reintenta lo que puede resolverse solo — timeout, 5xx/429
    // de Intelix, o no poder alcanzar el webhook por red. Todo lo demás (auth,
    // validación, duplicado, elegibilidad) es un error permanente.
    test: (c) => c === 'timeout' || c.includes('timeout') || c.includes('aborterror') || c.includes('etimedout'),
    label: 'Tiempo de espera agotado',
    detail: 'La conexión con Intelix tardó más de lo permitido. Se reintenta automáticamente.',
    retryable: true,
  },
  {
    test: (c) => /^http_5\d\d$/.test(c) || c === 'http_429',
    label: 'Intelix respondió con un error temporal',
    detail: 'Error del lado de Intelix (5xx / 429). El cron lo reintenta con backoff.',
    retryable: true,
  },
  {
    test: (c) =>
      c.includes('fetchfailed') || c.includes('network') || c.includes('econn') ||
      c.includes('enotfound') || c.includes('socket') || c.includes('dns'),
    label: 'No se pudo conectar con Intelix',
    detail: 'Fallo de red al alcanzar el webhook de portabilidad. Se reintenta automáticamente.',
    retryable: true,
  },
  {
    test: (c) => c === 'http_401' || c === 'http_403' || c.includes('auth') || c.includes('token') || c.includes('unauthorized'),
    label: 'Credenciales rechazadas',
    detail: 'Intelix rechazó la autenticación del servicio. No se reintenta: revisa la API key de Intelix en Configuración › Integraciones y libera el lead manualmente.',
    retryable: false,
  },
  {
    test: (c) =>
      c === 'http_409' || c.includes('dup') || c.includes('duplicad') || c.includes('duplicate') ||
      c.includes('ya tenemos') || c.includes('en proceso') || c.includes('ya existe'),
    label: 'Registro duplicado en Intelix',
    detail: 'Ya existe un trámite en curso para este número. No se reintenta: espera a que concluya.',
    retryable: false,
  },
  {
    test: (c) => c === 'http_422' || c === 'http_400' || c.includes('validation') || c.includes('validac') || c.includes('nip') || c.includes('invalid'),
    label: 'Datos rechazados por validación',
    detail: 'Intelix rechazó los datos del lead (p. ej. NIP o número). No se reintenta: corrige el lead o captura manual.',
    retryable: false,
  },
  {
    test: (c) => c.includes('carrier') || c.includes('compania') || c.includes('elegible'),
    label: 'Compañía no elegible',
    detail: 'La compañía de origen no participa en portabilidad automatizada. Requiere captura manual.',
    retryable: false,
  },
  {
    test: (c) => c === 'nip_expired',
    label: 'NIP ya purgado',
    detail: 'Venció la retención del NIP (NIP_RETENTION_HOURS) antes de que Intelix aceptara el registro. No se puede reenviar: captura manual.',
    retryable: false,
  },
  {
    test: (c) => c === 'lead_missing',
    label: 'Lead no encontrado',
    detail: 'El worker no pudo leer el lead asociado al encolar el envío. Registro cerrado como definitivo.',
    retryable: false,
  },
];

export function classifyOutboxError(rawCode: string): OutboxErrorInfo {
  const code = String(rawCode || '').trim().toLowerCase();
  if (!code) {
    return { label: 'Sin código de error', detail: 'El registro no tiene un código de error asociado.', retryable: false };
  }
  // Códigos de validación de Intelix (números tal cual, sin lowercase): mensaje
  // y campo exactos del catálogo, no la descripción genérica de la regla.
  const raw = String(rawCode || '').trim();
  const validation = INTELIX_VALIDATION_ERRORS[raw];
  if (validation) {
    return { label: 'Datos rechazados por validación (Intelix)', detail: validation.message, retryable: false, field: validation.field };
  }
  for (const r of RULES) {
    if (r.test(code)) return { label: r.label, detail: r.detail, retryable: r.retryable };
  }
  // Desconocido: no inventamos — mostramos el código tal cual. Por regla,
  // SOLO se reintenta timeout / 5xx / 429 / fallo de red al webhook (ver
  // RULES arriba); cualquier código no catalogado se trata como permanente
  // para no reintentar indefinidamente algo que probablemente es un error
  // de validación nuevo de Intelix. Revisar manualmente en Logs › Intelix.
  return {
    label: `Error de Intelix (${rawCode})`,
    detail: 'Código de error no catalogado. No se reintenta automáticamente: revisa con el equipo de integración de Intelix y libera el lead manualmente si aplica.',
    retryable: false,
  };
}

/** Etiqueta corta para el desplegable de filtro. */
export function outboxErrorLabel(rawCode: string): string {
  return classifyOutboxError(rawCode).label;
}
