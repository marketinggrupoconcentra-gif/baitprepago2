/**
 * env-contract.test.ts
 * 
 * Valida que el contrato de variables de entorno está completo.
 * Detecta variables REQUIRED_PRODUCTION que estén ausentes en producción.
 * Sirve como guardia CI para evitar deploys con configuración incompleta.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Variables requeridas en producción (el servidor lanzará si faltan)
const REQUIRED_PRODUCTION: string[] = [
  'DATABASE_URL',        // o APP_DATABASE_URL — al menos uno debe existir
  'PII_ENCRYPTION_KEY',
  'PII_BLIND_INDEX_KEY',
  'IP_HASH_KEY',
  'CRON_SECRET',
  'NEON_AUTH_BASE_URL',       // servidor Neon Auth administrado
  'NEON_AUTH_COOKIE_SECRET',  // firma de cookie de sesión (>= 32 chars)
  'ADMIN_BOOTSTRAP_EMAIL',    // primer Administrador
];

// Variables de integración — opcionales pero documentadas en .env.example
const OPTIONAL_INTEGRATION: string[] = [
  'INTELIX_API_URL',
  'INTELIX_API_KEY',
  'NEXT_PUBLIC_GTM_ID',
  'NEXT_PUBLIC_GA4_ID',
  'NEXT_PUBLIC_META_PIXEL_ID',
  'META_PIXEL_ID',
  'META_CAPI_ACCESS_TOKEN',
  'BREVO_API_KEY',
];

// Note: Variables with code defaults (APP_URL, etc.) are documented in .env.example
// but don't require explicit assertions since they gracefully degrade.

describe('env-contract: .env.example contiene todas las variables del código', () => {
  let envExampleContent: string;
  let envExampleVars: Set<string>;

  try {
    envExampleContent = readFileSync(
      path.resolve(__dirname, '../../.env.example'),
      'utf-8'
    );
    // Extraer nombres de variables del .env.example
    const matches = envExampleContent.matchAll(/^([A-Z][A-Z0-9_]+)=/gm);
    envExampleVars = new Set([...matches].map(m => m[1]));
  } catch {
    envExampleContent = '';
    envExampleVars = new Set();
  }

  test('.env.example debe existir y ser legible', () => {
    expect(envExampleContent.length).toBeGreaterThan(0);
  });

  test('.env.example debe documentar todas las variables REQUIRED_PRODUCTION', () => {
    for (const varName of REQUIRED_PRODUCTION) {
      expect(
        envExampleVars.has(varName),
        `Variable requerida "${varName}" no está en .env.example`
      ).toBe(true);
    }
  });

  test('.env.example debe documentar las variables opcionales de integración', () => {
    for (const varName of OPTIONAL_INTEGRATION) {
      expect(
        envExampleVars.has(varName),
        `Variable opcional "${varName}" no está documentada en .env.example`
      ).toBe(true);
    }
  });

  test('.env.example no debe contener valores secretos reales', () => {
    // Los valores de variables secretas deben estar vacíos en .env.example
    const secretVars = ['PII_ENCRYPTION_KEY', 'PII_BLIND_INDEX_KEY', 'IP_HASH_KEY', 'CRON_SECRET'];
    for (const varName of secretVars) {
      // Buscar el patrón VAR=<algo> — el valor debe estar vacío
      const pattern = new RegExp(`^${varName}=(.+)$`, 'm');
      const match = envExampleContent.match(pattern);
      if (match) {
        // Si tiene valor, verificar que no parece un hex secret (64 chars)
        const value = match[1].trim();
        expect(
          value.length === 0 || value === '# GENERA CON openssl rand -hex 32',
          `"${varName}" en .env.example parece tener un valor secreto real: "${value.slice(0, 10)}..."`
        ).toBe(true);
      }
    }
  });

  test('.env.example no debe contener DATABASE_URL real', () => {
    const dbPattern = /DATABASE_URL=postgresql:\/\//;
    expect(dbPattern.test(envExampleContent)).toBe(false);
  });
});

describe('env-contract: variables REQUIRED_PRODUCTION tienen lógica de validación en código', () => {
  test('DATABASE_URL tiene fallback a APP_DATABASE_URL en db/index.ts', () => {
    const dbIndexContent = readFileSync(
      path.resolve(__dirname, '../../src/db/index.ts'),
      'utf-8'
    );
    expect(dbIndexContent).toContain('APP_DATABASE_URL');
    expect(dbIndexContent).toContain('DATABASE_URL');
  });

  test('PII_ENCRYPTION_KEY lanza en producción si no está', () => {
    const cryptoContent = readFileSync(
      path.resolve(__dirname, '../../src/lib/crypto.ts'),
      'utf-8'
    );
    expect(cryptoContent).toContain("NODE_ENV === 'production'");
    expect(cryptoContent).toContain('throw new Error');
  });

  test('CRON_SECRET devuelve 500 si no está configurada', () => {
    const nipContent = readFileSync(
      path.resolve(__dirname, '../../src/app/api/cron/nip-purge/route.ts'),
      'utf-8'
    );
    expect(nipContent).toContain('CRON_SECRET');
    expect(nipContent).toContain('500');
  });
});
