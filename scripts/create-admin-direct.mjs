/**
 * scripts/create-admin-direct.mjs
 *
 * Crea un usuario admin insertando directamente en neon_auth.user + neon_auth.account
 * (Better Auth credential provider) y app.admin_profiles.
 *
 * Uso:
 *   node --env-file=.env.local scripts/create-admin-direct.mjs
 */
import { neon } from '@neondatabase/serverless';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';

const EMAIL    = process.env.ADMIN_BOOTSTRAP_EMAIL;
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const NAME     = process.env.ADMIN_BOOTSTRAP_NAME ?? 'Administrador';
if (!EMAIL || !PASSWORD) {
  console.error('✗ Define ADMIN_BOOTSTRAP_EMAIL y ADMIN_BOOTSTRAP_PASSWORD en el entorno (nunca hardcodear credenciales).');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL no está definida.');
  process.exit(1);
}

async function main() {
  const sql = neon(DATABASE_URL);
  const now = new Date().toISOString();

  // ─── 1. Verificar si el usuario ya existe ──────────────────────────────────
  const [existing] = await sql`
    SELECT id FROM neon_auth."user" WHERE email = ${EMAIL} LIMIT 1
  `;

  let userId;
  if (existing) {
    userId = existing.id;
    console.log(`⚠  El usuario ya existe en neon_auth.user (${userId}). Se usará el existente.`);
  } else {
    // ─── 2. Insertar en neon_auth.user ─────────────────────────────────────
    userId = randomUUID();
    await sql`
      INSERT INTO neon_auth."user"
        (id, name, email, "emailVerified", image, "createdAt", "updatedAt", role, banned)
      VALUES
        (${userId}, ${NAME}, ${EMAIL}, true, null, ${now}, ${now}, 'admin', false)
    `;
    console.log(`✓ neon_auth.user creado. ID: ${userId}`);
  }

  // ─── 3. Verificar si ya tiene account de credential ───────────────────────
  const [existingAccount] = await sql`
    SELECT id FROM neon_auth.account
     WHERE "userId" = ${userId} AND "providerId" = 'credential'
     LIMIT 1
  `;

  // ─── 4. Hashear la contraseña (bcrypt, cost 10 — mismo que Better Auth) ───
  const passwordHash = await hash(PASSWORD, 10);

  if (existingAccount) {
    await sql`
      UPDATE neon_auth.account
         SET password = ${passwordHash}, "updatedAt" = ${now}
       WHERE id = ${existingAccount.id}
    `;
    console.log(`⚠  neon_auth.account ya existía. Contraseña actualizada.`);
  } else {
    const accountId = randomUUID();
    await sql`
      INSERT INTO neon_auth.account
        (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      VALUES
        (${accountId}, ${userId}, 'credential', ${userId}, ${passwordHash}, ${now}, ${now})
    `;
    console.log(`✓ neon_auth.account (credential) creado.`);
  }

  // ─── 5. Insertar / actualizar app.admin_profiles ──────────────────────────
  const [existingProfile] = await sql`
    SELECT id FROM app.admin_profiles WHERE auth_user_id = ${userId} LIMIT 1
  `;

  if (existingProfile) {
    await sql`
      UPDATE app.admin_profiles
         SET role = 'Administrador', is_active = true, updated_at = NOW()
       WHERE id = ${existingProfile.id}
    `;
    console.log(`⚠  admin_profiles ya existía (${existingProfile.id}). Actualizado.`);
  } else {
    const [profile] = await sql`
      INSERT INTO app.admin_profiles (auth_user_id, role, is_active)
      VALUES (${userId}, 'Administrador', true)
      RETURNING id
    `;
    console.log(`✓ app.admin_profiles creado. ID: ${profile.id}`);
  }

  console.log('\n✅ Usuario admin listo:');
  console.log(`   Email   : ${EMAIL}`);
  console.log('   Password: (la definida en ADMIN_BOOTSTRAP_PASSWORD)');
  console.log(`   Auth ID : ${userId}\n`);
}

main().catch((err) => {
  console.error('✗ Error fatal:', err?.message ?? err);
  process.exit(1);
});
