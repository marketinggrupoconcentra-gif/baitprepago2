const fs = require('fs');
const path = require('path');

// Cargar .env.local para obtener DATABASE_URL en entorno local (fuera de Vercel)
(function loadDevVars() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
})();

const { neon } = require('@neondatabase/serverless');

async function migrate() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL o POSTGRES_URL no está definida.');
    process.exit(1);
  }

  console.log('Conectando a Neon...');
  const sql = neon(dbUrl);

  console.log('Aplicando esquema de Vercel (Etapa 0B)...');
  
  // 1. Crear tabla leads (si no existe, aunque ya existe en este punto)
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id              SERIAL          PRIMARY KEY,
      created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
      phone           VARCHAR(10)     NOT NULL,
      utm_source      VARCHAR(255),
      utm_medium      VARCHAR(255),
      utm_campaign    VARCHAR(255),
      utm_content     VARCHAR(255),
      utm_term        VARCHAR(255),
      fbclid          VARCHAR(512),
      fb_ad_id        VARCHAR(255),
      fb_adset_id     VARCHAR(255),
      fb_campaign_id  VARCHAR(255),
      ip              VARCHAR(45),
      user_agent      TEXT,
      referrer        TEXT,
      page_url        TEXT
    )
  `;
  console.log('✓ Tabla leads validada');

  // 2. MIGRACIÓN INCREMENTAL: Eliminar PII (NIP) si existe
  try {
    await sql`ALTER TABLE leads DROP COLUMN IF EXISTS nip`;
    console.log('✓ PII purgando: Columna nip eliminada (si existía)');
  } catch (err) {
    console.warn('⚠️ No se pudo verificar purga de nip:', err.message);
  }

  // 3. Crear índices (incluyendo el nuevo de IP para rate limiting)
  await sql`CREATE INDEX IF NOT EXISTS leads_created_at_idx  ON leads (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS leads_phone_idx        ON leads (phone)`;
  await sql`CREATE INDEX IF NOT EXISTS leads_ip_idx           ON leads (ip)`;
  await sql`CREATE INDEX IF NOT EXISTS leads_utm_source_idx   ON leads (utm_source)`;
  await sql`CREATE INDEX IF NOT EXISTS leads_utm_campaign_idx ON leads (utm_campaign)`;
  await sql`CREATE INDEX IF NOT EXISTS leads_fbclid_idx       ON leads (fbclid)`;
  console.log('✓ Índices validados/creados');

  console.log('\n✅ Migración de Etapa 0B completada exitosamente.');
}

migrate().catch(err => {
  console.error('❌ Error en migración:', err.message);
  process.exit(1);
});
