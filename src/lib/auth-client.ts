/**
 * src/lib/auth-client.ts
 *
 * Cliente de Neon Auth para React Client Components.
 * SOLO para: login, logout, leer sesión en cliente (ocultar/mostrar UI).
 * La AUTORIZACIÓN REAL siempre ocurre server-side (src/lib/session.ts + rbac.ts).
 *
 * `createAuthClient()` de @neondatabase/auth/next no recibe URL: habla contra
 * el propio origen a través de la ruta proxy /api/auth/[...all], que a su vez
 * reenvía al endpoint administrado de Neon Auth. Así no exponemos NEON_AUTH_BASE_URL
 * al navegador ni generamos requests cross-site.
 */
import { createAuthClient } from '@neondatabase/auth/next';

export const authClient = createAuthClient();
