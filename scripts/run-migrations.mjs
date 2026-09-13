/**
 * Aplica las migraciones de Drizzle a la base de datos Neon.
 * Usa el driver de postgres nativo en lugar del WebSocket adapter.
 */
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, '../src/db/migrations');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no está definida');
  process.exit(1);
}

console.log('🔗 Conectando a Neon...');
const sql = neon(DATABASE_URL);
const db = drizzle(sql);

console.log('📂 Migraciones en:', migrationsFolder);
const files = readdirSync(migrationsFolder).filter(f => f.endsWith('.sql')).sort();
console.log(`📋 ${files.length} archivos SQL encontrados:`, files);

try {
  await migrate(db, { migrationsFolder });
  console.log('✅ Migraciones aplicadas exitosamente');
} catch (err) {
  console.error('❌ Error al aplicar migraciones:', err.message);
  process.exit(1);
}
