/**
 * src/app/api/auth/[...all]/route.ts
 *
 * Proxy oficial de Neon Auth. Reenvía todos los endpoints de auth al servidor
 * administrado de Neon (NEON_AUTH_BASE_URL) y gestiona las cookies de sesión:
 *   POST /api/auth/sign-in/email
 *   POST /api/auth/sign-out
 *   GET  /api/auth/get-session
 *   POST /api/auth/request-password-reset
 *   POST /api/auth/reset-password
 *   POST /api/auth/admin/create-user
 *   GET  /api/auth/admin/list-users
 *   ...
 */
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST } = auth.handler();
