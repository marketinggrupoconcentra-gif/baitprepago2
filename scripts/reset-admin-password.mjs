/**
 * scripts/reset-admin-password.mjs
 *
 * Resetea la contraseña del admin usando la API HTTP de Neon Auth (Better Auth).
 * El servidor gestiona el hashing — no requiere dependencias extras.
 *
 * Uso:
 *   node --env-file=.env.local scripts/reset-admin-password.mjs
 */

const NEON_AUTH_BASE_URL = process.env.NEON_AUTH_BASE_URL;
const DATABASE_URL       = process.env.DATABASE_URL;
const EMAIL              = process.env.ADMIN_BOOTSTRAP_EMAIL;
const NEW_PASSWORD       = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!NEON_AUTH_BASE_URL || !DATABASE_URL || !EMAIL || !NEW_PASSWORD) {
  console.error('✗ Faltan variables: NEON_AUTH_BASE_URL, DATABASE_URL, ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD');
  process.exit(1);
}

import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(DATABASE_URL);

  // 1. Obtener el userId del usuario en la BD
  const [user] = await sql`
    SELECT id FROM neon_auth."user" WHERE email = ${EMAIL} LIMIT 1
  `;
  if (!user) {
    console.error(`✗ No existe usuario con email: ${EMAIL}`);
    process.exit(1);
  }
  console.log(`✓ Usuario encontrado. ID: ${user.id}`);

  // 2. Usar la API admin de Better Auth para actualizar la contraseña
  //    Endpoint: POST /admin/set-password o similar — intentamos varios
  const endpoints = [
    { path: '/admin/set-password',    body: { userId: user.id, newPassword: NEW_PASSWORD } },
    { path: '/admin/update-user',     body: { userId: user.id, password: NEW_PASSWORD } },
    { path: `/admin/users/${user.id}`,body: { password: NEW_PASSWORD }, method: 'PATCH' },
  ];

  let success = false;
  for (const ep of endpoints) {
    const url = `${NEON_AUTH_BASE_URL}${ep.path}`;
    console.log(`→ Intentando ${ep.method ?? 'POST'} ${url}`);
    const res = await fetch(url, {
      method: ep.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ep.body),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`✓ Contraseña actualizada vía ${ep.path}:`, JSON.stringify(body));
      success = true;
      break;
    }
    console.log(`  ✗ ${res.status}: ${JSON.stringify(body).substring(0, 120)}`);
  }

  if (!success) {
    // 3. Fallback: actualizar el hash directamente usando scrypt Node nativo
    //    con los parámetros exactos que usa Better Auth
    console.log('\n→ Fallback: actualizando hash directamente en neon_auth.account...');
    const { scrypt: _scrypt, randomBytes } = await import('crypto');
    const { promisify } = await import('util');
    const scryptAsync = promisify(_scrypt);

    const salt = randomBytes(16).toString('hex');
    // Better Auth default scrypt params: N=16384, r=16, p=2, keyLen=64
    const maxmem = 128 * 16384 * 16 * 2 * 2;
    const derivedKey = await scryptAsync(NEW_PASSWORD, salt, 64, { N: 16384, r: 16, p: 2, maxmem });
    const hash = `${salt}:${derivedKey.toString('hex')}`;

    await sql`
      UPDATE neon_auth.account
         SET password = ${hash}, "updatedAt" = NOW()
       WHERE "userId" = ${user.id} AND "providerId" = 'credential'
    `;
    console.log('✓ Hash actualizado directamente en la BD.');
  }

  console.log(`\n✅ Contraseña reseteada para: ${EMAIL}`);
  console.log('   Intenta iniciar sesión en /admin/login\n');
}

main().catch(err => {
  console.error('✗ Error:', err?.message ?? err);
  process.exit(1);
});
