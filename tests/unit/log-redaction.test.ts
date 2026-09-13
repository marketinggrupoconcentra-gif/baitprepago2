/**
 * tests/unit/log-redaction.test.ts — SEC-006
 *
 * safeError() reduce cualquier error a un código corto de allowlist sin filtrar
 * SQL, bind params, connection strings, tokens ni PII.
 * Además: gate estático — las rutas sensibles no loggean `(err as Error).message`.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { safeError } from '../../src/lib/log';

describe('SEC-006 — safeError', () => {
  test('no propaga el mensaje de un error de SQL / driver', () => {
    const e = Object.assign(new Error('insert into app.leads (phone_enc) values ($1) -- 5512345678'), { name: 'NeonDbError' });
    const s = safeError(e);
    expect(JSON.stringify(s)).not.toMatch(/insert into|phone_enc|5512345678|\$1/i);
    expect(s.class).toBe('NeonDbError');
  });

  test('no propaga connection string ni secretos aunque estén en code', () => {
    const e = Object.assign(new Error('x'), { code: 'postgres://user:pass@ep-xxx/db sslmode=require' });
    const s = safeError(e);
    expect(s.code).toBe('unspecified');
    expect(JSON.stringify(s)).not.toMatch(/postgres:\/\/|pass@|sslmode/);
  });

  test('usa un SQLSTATE corto como code cuando es seguro', () => {
    const e = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(safeError(e).code).toBe('23505');
  });

  test('clase fuera de allowlist → "Error"', () => {
    class WeirdSecretError extends Error {}
    expect(safeError(new WeirdSecretError('boom')).class).toBe('Error');
  });
});

describe('SEC-006 — gate estático de logging en rutas', () => {
  const ROOT = path.resolve(__dirname, '../..');
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (e.endsWith('.ts')) out.push(full);
    }
    return out;
  }
  const routeFiles = walk(path.join(ROOT, 'src/app/api'));

  test('ninguna ruta API loggea `(err as Error).message` / `err.message`', () => {
    const offenders: string[] = [];
    for (const f of routeFiles) {
      const s = readFileSync(f, 'utf-8');
      if (/console\.(log|warn|error)\([^)]*\berr(or)?\b[^)]*\.message/.test(s)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('el flujo de lead / bootstrap no loggea PII directa', () => {
    const sensitive = [
      'src/app/api/v1/leads/route.ts',
      'src/app/api/admin/bootstrap/route.ts',
    ];
    for (const rel of sensitive) {
      const s = readFileSync(path.join(ROOT, rel), 'utf-8');
      expect(s, rel).not.toMatch(/console\.(log|warn|error)\([^)]*(phone|email|nip|first_name|last_name|password|session\.user\.email|verification_proof)/i);
    }
  });
});
