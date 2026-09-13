import 'server-only';

/**
 * src/lib/security/csv.ts — Generación segura de CSV (SEC-003)
 *
 * csvCell():
 *  1. Neutraliza formula injection: si el primer carácter significativo es
 *     =, +, -, @ (Excel/Sheets ignoran espacios/tab iniciales) o el valor
 *     empieza con TAB/CR/LF, se antepone `'`.
 *  2. SIEMPRE aplica escaping estructural RFC4180 al valor resultante:
 *     si contiene `"`, coma, CR o LF (o fue neutralizado) se envuelve en
 *     comillas dobles y cada `"` interna se duplica.
 *
 * No hay early-return antes del quoting: la neutralización de fórmula NUNCA
 * sustituye al escaping CSV.
 */
export function csvCell(val: unknown): string {
  let s = val == null ? '' : String(val);

  const lead = s.replace(/^[ \t]+/, '');
  const isFormulaChar = lead.length > 0 && '=+-@'.includes(lead.charAt(0));
  const hasControlLead = /^[\t\r\n]/.test(s);

  let neutralized = false;
  if (isFormulaChar || hasControlLead) {
    s = `'${s}`;
    neutralized = true;
  }

  if (neutralized || /["\r\n,]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCSVRow(fields: unknown[]): string {
  return fields.map(csvCell).join(',');
}

/** Une filas con CRLF (RFC4180). */
export function toCSV(rows: unknown[][]): string {
  return rows.map(toCSVRow).join('\r\n');
}
