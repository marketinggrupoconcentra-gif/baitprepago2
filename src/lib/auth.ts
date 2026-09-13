/**
 * src/lib/auth.ts
 *
 * Cliente SERVER-SIDE de Neon Auth (managed, sobre Better Auth) para el admin de BAIT Prepago.
 *
 * ARQUITECTURA:
 * - Neon Auth ES el servidor de autenticación administrado (owned_by: neon).
 *   Base URL: NEON_AUTH_BASE_URL (.../neondb/auth). JWKS publicado por Neon.
 * - Esta app Next.js es CLIENTE del endpoint administrado, NO el servidor.
 * - NO usamos betterAuth() + drizzleAdapter() + conexión DB para auth.
 *   El schema `neon_auth` (user/session/account/verification/organization/...)
 *   lo gestiona Neon; NUNCA lo tocamos manualmente ni con migraciones.
 * - IDENTIDAD + SESIÓN  -> Neon Auth (este módulo).
 * - AUTORIZACIÓN        -> app.admin_profiles + src/lib/rbac.ts (src/lib/session.ts).
 *
 * El servidor administrado ya trae habilitados los plugins `admin` y `organization`
 * (verificado: neon_auth.user.role/banned, neon_auth.session.impersonatedBy).
 * Por eso `auth.admin.*` está disponible vía el SDK; no registramos plugins locales.
 */
import 'server-only';
import { createNeonAuth, type NeonAuth } from '@neondatabase/auth/next/server';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`[auth] ${name} no está definida. Neon Auth no puede inicializar.`);
  }
  return v;
}

let _auth: NeonAuth | null = null;

/** Singleton perezoso: falla en la primera llamada real (no al importar/compilar). */
function getAuth(): NeonAuth {
  if (!_auth) {
    _auth = createNeonAuth({
      baseUrl: requireEnv('NEON_AUTH_BASE_URL'),
      cookies: {
        // Mínimo 32 caracteres. Estable dentro de un mismo environment.
        secret: requireEnv('NEON_AUTH_COOKIE_SECRET'),
        sessionDataTtl: 300, // 5 min de caché de sesión en cookie firmada
        sameSite: 'lax',
      },
      logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'silent',
    });
  }
  return _auth;
}

/**
 * Instancia unificada de Neon Auth para Server Components, Route Handlers,
 * Server Actions y el proxy. Expone métodos Better Auth server-side
 * (getSession, signIn, signOut, requestPasswordReset, admin.createUser, ...)
 * más `auth.handler()` y `auth.middleware()`.
 *
 * Se accede mediante Proxy para diferir `createNeonAuth()` hasta el primer uso.
 */
export const auth: NeonAuth = new Proxy({} as NeonAuth, {
  get(_target, prop, receiver) {
    const instance = getAuth();
    const value = Reflect.get(instance as object, prop, receiver);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
