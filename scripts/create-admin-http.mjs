/**
 * scripts/create-admin-http.mjs
 *
 * Crea un usuario admin llamando directamente a la API HTTP de Neon Auth (Better Auth),
 * luego inserta su perfil en app.admin_profiles via SQL directo.
 *
 * NO requiere contexto Next.js. Ejecutar con:
 *   node --env-file=.env.local scripts/create-admin-http.mjs
 */
import { neon } from '@neondatabase/serverless';

const NEON_AUTH_BASE_URL = process.env.NEON_AUTH_BASE_URL;
const DATABASE_URL       = process.env.DATABASE_URL;

const EMAIL    = process.env.ADMIN_BOOTSTRAP_EMAIL;
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const NAME     = process.env.ADMIN_BOOTSTRAP_NAME ?? 'Administrador';
if (!EMAIL || !PASSWORD) {
  console.error('✗ Define ADMIN_BOOTSTRAP_EMAIL y ADMIN_BOOTSTRAP_PASSWORD en el entorno (nunca hardcodear credenciales).');
  process.exit(1);
}

if (!NEON_AUTH_BASE_URL) {
  console.error('✗ NEON_AUTH_BASE_URL no está definida.');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL no está definida.');
  process.exit(1);
}

async function main() {
  console.log(`\n→ Creando usuario en Neon Auth: ${EMAIL}`);

  // 1. Crear usuario en Neon Auth via API HTTP
  const url = `${NEON_AUTH_BASE_URL}/admin/create-user`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: NAME,
      email: EMAIL,
      password: PASSWORD,
      role: 'admin',
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`✗ Neon Auth respondió ${res.status}:`, JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const userId = body?.user?.id ?? body?.id;
  if (!userId) {
    console.error('✗ Respuesta inesperada (sin user.id):', JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log(`✓ Usuario Neon Auth creado. ID: ${userId}`);
  console.log(`  Respuesta:`, JSON.stringify(body, null, 2));

  // 2. Insertar fila en app.admin_profiles
  const sql = neon(DATABASE_URL);

  // Comprobar si ya existe
  const [existing] = await sql`
    SELECT id FROM app.admin_profiles WHERE auth_user_id = ${userId} LIMIT 1
  `;

  if (existing) {
    await sql`
      UPDATE app.admin_profiles
         SET role = 'Administrador', is_active = true, updated_at = NOW()
       WHERE id = ${existing.id}
    `;
    console.log(`⚠  admin_profile ya existía (${existing.id}). Actualizado.`);
  } else {
    const [profile] = await sql`
      INSERT INTO app.admin_profiles (auth_user_id, role, is_active)
      VALUES (${userId}, 'Administrador', true)
      RETURNING id
    `;
    console.log(`✓ admin_profile creado. ID: ${profile.id}`);
  }

  console.log('\n✅ Listo. El usuario puede iniciar sesión con:');
  console.log(`   Email   : ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}\n`);
}

main().catch((err) => {
  console.error('✗ Error fatal:', err?.message ?? err);
  process.exit(1);
});
