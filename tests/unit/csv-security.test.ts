/**
 * tests/unit/csv-security.test.ts — SEC-003
 *
 * Verifica el generador CSV real (src/lib/security/csv.ts):
 *  - neutraliza formula injection (=, +, -, @, control chars, precedidos de espacio/tab)
 *  - SIEMPRE aplica escaping estructural RFC4180 (nunca early-return)
 *  - el resultado es parseable y no añade columnas/filas
 */
import { describe, it, expect } from 'vitest';

// server-only shim vía alias de vitest.config.ts
import { csvCell, toCSVRow, toCSV } from '../../src/lib/security/csv';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

describe('SEC-003 — CSV formula injection + RFC4180', () => {
  const FORMULAS = ['=1+1', '+1+1', '-1+1', '@SUM(A1:A2)', '=bad,data', '=bad"data', '=cmd|"/c calc"'];

  for (const f of FORMULAS) {
    it(`neutraliza fórmula: ${JSON.stringify(f)}`, () => {
      const cell = csvCell(f);
      // El valor efectivo (des-quoted) no empieza por un carácter de fórmula.
      const row = parseCsvLine(cell);
      expect(row).toHaveLength(1); // una sola columna — no rompió la estructura
      expect('=+-@'.includes(row[0].charAt(0))).toBe(false);
      expect(row[0].startsWith("'")).toBe(true); // prefijo neutralizador
    });
  }

  it('fórmula precedida de espacios / tab también se neutraliza', () => {
    for (const v of ['   =1+1', '\t=1+1', ' \t @x']) {
      const parsed = parseCsvLine(csvCell(v));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].trimStart().startsWith("'")).toBe(true);
    }
  });

  it('valor con coma se envuelve en comillas (RFC4180) sin romper columnas', () => {
    const cell = csvCell('Guadalajara, Jalisco');
    expect(cell).toBe('"Guadalajara, Jalisco"');
    expect(parseCsvLine(cell)).toEqual(['Guadalajara, Jalisco']);
  });

  it('valor con comillas dobles: se duplican y se envuelve', () => {
    expect(parseCsvLine(csvCell('dice "hola"'))).toEqual(['dice "hola"']);
  });

  it('fórmula con newline / CR: neutralizada Y quoted (una sola fila lógica)', () => {
    for (const v of ['=1+1\n=2+2', '=1+1\r\nDROP', '=x\rY']) {
      const cell = csvCell(v);
      expect(cell.startsWith('"') && cell.endsWith('"')).toBe(true);
      // sin comillas de cierre huérfanas: nº de " es par
      expect((cell.match(/"/g) ?? []).length % 2).toBe(0);
    }
  });

  it('valor normal no se modifica', () => {
    expect(csvCell('Guadalajara')).toBe('Guadalajara');
    expect(csvCell('2026-09-08T00:00:00.000Z')).toBe('2026-09-08T00:00:00.000Z');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('una fila con fórmula produce exactamente el mismo nº de columnas', () => {
    const headers = ['a', 'b', 'c'];
    const row = ['=cmd', 'x,y', 'z"w'];
    const csv = toCSV([headers, row]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(parseCsvLine(lines[0])).toHaveLength(3);
    expect(parseCsvLine(lines[1])).toHaveLength(3);
  });

  it('toCSVRow neutraliza cada celda de forma independiente', () => {
    const r = toCSVRow(['ok', '=evil', '-also']);
    const cells = parseCsvLine(r);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toBe('ok');
    expect(cells[1].startsWith("'")).toBe(true);
    expect(cells[2].startsWith("'")).toBe(true);
  });
});
