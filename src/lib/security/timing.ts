import 'server-only';

// ── Minimum Form Fill Time ────────────────────────────────────────────────────
// Un humano real no puede llenar el formulario en menos de N segundos.
// Si el tiempo es sospechosamente corto → posible bot o script automatizado.

export interface TimingResult {
  passed: boolean;
  reason?: string;
}

/**
 * Verifica que el tiempo de llenado del formulario sea humanamente plausible.
 * @param formStartedAt - Timestamp (epoch ms) de cuando el form fue abierto (enviado por el cliente)
 * @param minMs - Tiempo mínimo en ms (desde SECURITY_MIN_FORM_FILL_MS env)
 */
export function checkFormTiming(
  formStartedAt: number | undefined | null,
  submittedAt: number = Date.now()
): TimingResult {
  const minMs = Number(process.env.SECURITY_MIN_FORM_FILL_MS ?? 4000);

  // Si no hay timestamp de inicio → sospechoso (llamada directa a la API)
  if (!formStartedAt || typeof formStartedAt !== 'number') {
    return { passed: false, reason: 'missing_form_start_time' };
  }

  // Si el timestamp es del futuro → manipulado
  if (formStartedAt > submittedAt) {
    return { passed: false, reason: 'invalid_form_start_time' };
  }

  const elapsed = submittedAt - formStartedAt;

  if (elapsed < minMs) {
    return { passed: false, reason: 'form_filled_too_fast' };
  }

  // Máximo razonable: 2 horas. Evita sesiones zombi muy antiguas.
  const maxMs = 2 * 60 * 60 * 1000;
  if (elapsed > maxMs) {
    return { passed: false, reason: 'form_session_expired' };
  }

  return { passed: true };
}
