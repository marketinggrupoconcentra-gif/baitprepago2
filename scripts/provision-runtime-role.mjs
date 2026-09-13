/**
 * scripts/provision-runtime-role.mjs
 *
 * Crea (o actualiza) el rol Postgres de RUNTIME con mínimo privilegio y aplica
 * EXACTAMENTE los grants declarados en src/lib/security/privilege-manifest.ts.
 * Idempotente: se puede ejecutar N veces (REVOKE ALL + GRANT por tabla).
 *
 * Por qué vía SQL y no Neon Console/CLI/MCP: los roles creados por la consola
 * heredan neon_superuser (createdb/createrole/bypassrls + lectura de neon_auth).
 * Ver src/db/RUNTIME_ROLE.md.
 *
 * Uso (con el rol owner/migración en DATABASE_URL):
 *   node --env-file=.env.local scripts/provision-runtime-role.mjs
 *
 * Variables:
 *   DATABASE_URL            [REQUIRED] rol owner (neondb_owner)
 *   RUNTIME_ROLE_NAME       [DEFAULT]  app_runtime  (este proyecto: baitprepago_app_runtime)
 *   RUNTIME_ROLE_PASSWORD   [DEFAULT]  se genera (CSPRNG 32 bytes base64url) y se imprime UNA vez
 *   RUNTIME_DB_NAME         [DEFAULT]  se toma de DATABASE_URL
 *
 * Salida: imprime APP_DATABASE_URL lista para pegar en .env.local / Vercel.
 */
import { neon } from '@neondatabase/serverless';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL (rol owner) es obligatoria.');
  process.exit(1);
}

const ROLE = process.env.RUNTIME_ROLE_NAME ?? 'app_runtime';
if (!/^[a-z_][a-z0-9_]{2,62}$/.test(ROLE)) {
  console.error(`✗ RUNTIME_ROLE_NAME inválido: ${ROLE}`);
  process.exit(1);
}
const generated = !process.env.RUNTIME_ROLE_PASSWORD;
const PASSWORD = process.env.RUNTIME_ROLE_PASSWORD ?? randomBytes(32).toString('base64url');

const url = new URL(DATABASE_URL);
const DB = process.env.RUNTIME_DB_NAME ?? url.pathname.replace(/^\//, '');

// ── Parsear el manifiesto (TS) sin compilar: bloques `nombre: { select: bool, ... }` ──
const manifestSrc = readFileSync(join(__dirname, '../src/lib/security/privilege-manifest.ts'), 'utf8');
const body = manifestSrc.slice(manifestSrc.indexOf('PRIVILEGE_MANIFEST'));
const entryRe = /^\s*([a-z_]+):\s*\{([^}]*)\}/gm;
const manifest = {};
for (const m of body.matchAll(entryRe)) {
  const [, table, inner] = m;
  const flag = (k) => new RegExp(`${k}\\s*:\\s*true`).test(inner);
  manifest[table] = { select: flag('select'), insert: flag('insert'), update: flag('update'), delete: flag('delete') };
}
const tables = Object.keys(manifest);
if (tables.length === 0) {
  console.error('✗ No se pudo leer PRIVILEGE_MANIFEST.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log(`→ Rol runtime: ${ROLE} sobre base ${DB} (${tables.length} tablas en el manifiesto)`);

  // 1. Rol (sin superuser, sin createdb/createrole, sin bypassrls, sin herencia)
  const [exists] = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`;
  const pw = PASSWORD.replace(/'/g, "''");
  if (exists) {
    // Neon: neondb_owner NO puede ALTER ROLE sobre roles ya creados (permission denied).
    // Se conservan atributos/contraseña; para rotar la contraseña usa el API/MCP de Neon
    // (reset_postgres_role_password) o crea el rol con RUNTIME_ROLE_PASSWORD desde el inicio.
    try {
      await sql.query(`ALTER ROLE "${ROLE}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${pw}'`);
      console.log('  rol existente → atributos y contraseña actualizados');
    } catch (e) {
      console.warn(`  ! rol existente: no se pudo ALTER ROLE (${e?.message ?? e}). Se reaplican solo los GRANTs; la contraseña NO cambió.`);
    }
  } else {
    await sql.query(`CREATE ROLE "${ROLE}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${pw}'`);
    console.log('  rol creado');
  }
  // Nunca miembro de neon_superuser
  const [member] = await sql`SELECT pg_has_role(${ROLE}, 'neon_superuser', 'member') AS m`;
  if (member?.m) {
    await sql.query(`REVOKE neon_superuser FROM "${ROLE}"`);
    console.log('  membresía neon_superuser revocada');
  }

  // 2. Conexión + schema (USAGE, nunca CREATE)
  await sql.query(`GRANT CONNECT ON DATABASE "${DB}" TO "${ROLE}"`);
  await sql.query(`GRANT USAGE ON SCHEMA app TO "${ROLE}"`);
  await sql.query(`REVOKE CREATE ON SCHEMA app FROM "${ROLE}"`);
  await sql.query(`REVOKE ALL ON SCHEMA neon_auth FROM "${ROLE}"`).catch(() => {});

  // 3. Grants exactos por tabla
  const real = (await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'app'`).map((r) => r.table_name);
  let applied = 0;
  for (const t of tables) {
    if (!real.includes(t)) { console.warn(`  ! tabla app.${t} está en el manifiesto pero NO existe en la BD (¿migración pendiente o entrada huérfana?)`); continue; }
    const p = manifest[t];
    const privs = [p.select && 'SELECT', p.insert && 'INSERT', p.update && 'UPDATE', p.delete && 'DELETE'].filter(Boolean);
    await sql.query(`REVOKE ALL ON TABLE app."${t}" FROM "${ROLE}"`);
    if (privs.length) await sql.query(`GRANT ${privs.join(', ')} ON TABLE app."${t}" TO "${ROLE}"`);
    applied++;
    console.log(`  app.${t.padEnd(24)} ${privs.join(',') || '(sin privilegios)'}`);
  }
  const orphan = real.filter((t) => !tables.includes(t) && t !== '__drizzle_migrations');
  if (orphan.length) console.warn(`  ! tablas en la BD sin entrada en el manifiesto: ${orphan.join(', ')} → agrégalas a privilege-manifest.ts`);

  // 4. Sin acceso a __drizzle_migrations (schema drizzle) ni a otros schemas
  await sql.query(`REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM "${ROLE}"`).catch(() => {});

  // 5. URL de runtime
  const out = new URL(DATABASE_URL);
  out.username = ROLE;
  out.password = PASSWORD;
  console.log(`\n✅ ${applied} tablas configuradas para ${ROLE}.`);
  if (generated && !exists) console.log('   (contraseña generada — guárdala ahora, no se vuelve a mostrar)');
  if (exists) console.log('   (rol preexistente: la URL de abajo lleva la contraseña indicada/generada SOLO si el ALTER tuvo éxito)');
  console.log(`\nAPP_DATABASE_URL=${out.toString()}\n`);
}

main().catch((err) => {
  console.error('✗ Error:', err?.message ?? err);
  process.exit(1);
});
