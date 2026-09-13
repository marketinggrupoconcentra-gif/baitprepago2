/**
 * proxy-convention.test.ts
 *
 * Next.js 16 reemplazó `middleware.ts` por `proxy.ts`. El build FALLA con
 * "middleware-to-proxy" si ambos archivos coexisten:
 *
 *   Both middleware file "./src/middleware.ts" and proxy file "./src/proxy.ts"
 *   are detected. Please use "./src/proxy.ts" only.
 *
 * Este test es un gate CI que evita volver a introducir un `middleware.ts`
 * legacy junto al `proxy.ts` oficial (en cualquiera de las ubicaciones que
 * Next.js inspecciona: raíz del repo o `src/`).
 */
import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const MIDDLEWARE_LOCATIONS = [
  'middleware.ts',
  'middleware.js',
  'src/middleware.ts',
  'src/middleware.js',
];

const PROXY_LOCATIONS = [
  'proxy.ts',
  'proxy.js',
  'src/proxy.ts',
  'src/proxy.js',
];

describe('Next.js 16 proxy convention', () => {
  test('debe existir exactamente un archivo proxy', () => {
    const found = PROXY_LOCATIONS.filter((p) => existsSync(path.join(ROOT, p)));
    expect(found, 'No se encontró proxy.ts / src/proxy.ts').toHaveLength(1);
  });

  test('NO debe existir ningún middleware.ts legacy (rompe el build en Next 16)', () => {
    const found = MIDDLEWARE_LOCATIONS.filter((p) => existsSync(path.join(ROOT, p)));
    expect(
      found,
      `middleware legacy detectado: ${found.join(', ')}. ` +
        `Next.js 16 no permite middleware + proxy simultáneamente. ` +
        `Migra la lógica a src/proxy.ts y elimina el/los archivo(s).`,
    ).toHaveLength(0);
  });

  test('script-src de las rutas React (no-estáticas) usa nonce/strict-dynamic, sin \'unsafe-inline\'', () => {
    const proxySrc = readFileSync(path.join(ROOT, 'src/proxy.ts'), 'utf-8');
    // El script-src se arma en la variable `scriptSrc` con un ternario:
    //   staticLanding ? [allowlist clásica]  :  [nonce + strict-dynamic]
    // La rama estática (landing legacy public/legacy/*) SÍ necesita
    // 'unsafe-inline' porque su <script src> no puede llevar nonce por request;
    // la rama React NO debe tenerlo.
    const m = proxySrc.match(/const scriptSrc = staticLanding[\s\S]*?\n\s*:\s*\[([\s\S]*?)\];/);
    expect(m, 'no se encontró la rama ":" (React) del ternario scriptSrc').toBeTruthy();
    const reactBranch = m![1];
    expect(
      reactBranch.includes("'unsafe-inline'"),
      "la rama React de script-src no debe contener 'unsafe-inline'. Usar nonce/strict-dynamic.",
    ).toBe(false);
    expect(reactBranch).toContain("'strict-dynamic'");
    expect(reactBranch).toContain('nonce-');
  });
});
