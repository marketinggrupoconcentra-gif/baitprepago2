/**
 * auth-architecture.test.ts
 *
 * Gate CI de arquitectura de autenticación.
 *
 * Neon Auth (managed, owned_by: neon) ES el servidor de auth. Esta app es
 * CLIENTE del endpoint administrado. Estos tests impiden regresar al patrón
 * self-hosted (betterAuth() + drizzleAdapter() + conexión DB propia) y aseguran
 * que el contrato de env de Neon Auth esté documentado.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const srcFiles = walk(path.join(ROOT, 'src'));
const readSrc = (f: string) => readFileSync(f, 'utf-8');

/** Quita comentarios de línea y de bloque para no matchear menciones en docs. */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('auth architecture: Neon Auth managed (no self-hosted Better Auth)', () => {
  test('ningún archivo de src/ hace betterAuth({ database: drizzleAdapter(...) })', () => {
    const offenders = srcFiles.filter((f) => {
      const s = stripComments(readSrc(f));
      return /\bbetterAuth\s*\(/.test(s) || /\bdrizzleAdapter\s*\(/.test(s);
    });
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      'Se detectó configuración self-hosted de Better Auth. Usar @neondatabase/auth (managed).',
    ).toEqual([]);
  });

  test('no se importa "better-auth" directamente en src/ (usar @neondatabase/auth)', () => {
    const offenders = srcFiles.filter((f) =>
      /from\s+['"]better-auth(\/[^'"]*)?['"]/.test(stripComments(readSrc(f))),
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  test('src/lib/auth.ts usa createNeonAuth de @neondatabase/auth', () => {
    const s = readSrc(path.join(ROOT, 'src/lib/auth.ts'));
    expect(s).toMatch(/@neondatabase\/auth\/next\/server/);
    expect(s).toMatch(/createNeonAuth/);
  });

  test('src/lib/auth-client.ts usa createAuthClient de @neondatabase/auth/next', () => {
    const s = readSrc(path.join(ROOT, 'src/lib/auth-client.ts'));
    expect(s).toMatch(/@neondatabase\/auth\/next/);
    expect(s).not.toMatch(/better-auth\/react/);
  });

  test('la ruta /api/auth/[...path] delega en auth.handler() (proxy Neon Auth)', () => {
    const routePath = path.join(ROOT, 'src/app/api/auth/[...path]/route.ts');
    const content = stripComments(readSrc(routePath));
    expect(content).toMatch(/auth\.handler\(\)/);
  });
});

describe('auth architecture: contrato de env de Neon Auth', () => {
  const envExample = readFileSync(path.join(ROOT, '.env.example'), 'utf-8');

  test('.env.example documenta NEON_AUTH_BASE_URL', () => {
    expect(/^NEON_AUTH_BASE_URL=/m.test(envExample)).toBe(true);
  });

  test('.env.example documenta NEON_AUTH_COOKIE_SECRET (sin valor real)', () => {
    const m = envExample.match(/^NEON_AUTH_COOKIE_SECRET=(.*)$/m);
    expect(m).not.toBeNull();
    expect((m?.[1] ?? '').trim()).toBe('');
  });

  test('.env.example documenta ADMIN_BOOTSTRAP_EMAIL', () => {
    expect(/^ADMIN_BOOTSTRAP_EMAIL=/m.test(envExample)).toBe(true);
  });

  test('ya no se referencia BETTER_AUTH_SECRET / BETTER_AUTH_URL', () => {
    expect(envExample).not.toMatch(/BETTER_AUTH_(SECRET|URL)/);
  });
});
