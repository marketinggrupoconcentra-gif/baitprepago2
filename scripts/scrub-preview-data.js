/**
 * scripts/scrub-preview-data.js
 * Elimina toda la información productiva clonada en el entorno de Preview.
 * Este script limpia admin_sessions, admin_login_attempts, admin_audit_log, admin_users, y leads.
 * Ejecuta preview-safety.js internamente para garantizar FAIL CLOSED.
 */


const { enforceSafety } = require('./preview-safety');
const { neon } = require('@neondatabase/serverless');

async function scrub() {
  console.log('=== PREVIEW SCRUB ===');
  
  // FAIL CLOSED si las variables de entorno o la rama apuntan a algo prohibido
  enforceSafety();
  
  const DB_URL = process.env.DATABASE_URL;
  if (!DB_URL) {
    console.error('❌ FAIL CLOSED: DATABASE_URL not provided.');
    process.exit(1);
  }

  const sql = neon(DB_URL);
  
  try {
    console.log('Iniciando limpieza de base de datos...');
    
    // El orden importa por llaves foráneas si las hubiera (en este schema no hay foreign keys rígidas, pero mantenemos buen orden)
    await sql`DELETE FROM admin_sessions`;
    console.log('✅ admin_sessions cleared');
    
    await sql`DELETE FROM admin_login_attempts`;
    console.log('✅ admin_login_attempts cleared');
    
    await sql`DELETE FROM admin_audit_log`;
    console.log('✅ admin_audit_log cleared');
    
    await sql`DELETE FROM admin_users`;
    console.log('✅ admin_users cleared');
    
    await sql`DELETE FROM leads`;
    console.log('✅ leads cleared');
    
    console.log('=== SCRUB COMPLETADO ===');
    console.log('El entorno Preview ha sido saneado de datos de producción.');
  } catch (err) {
    console.error('❌ ERROR durante el scrub:', err);
    process.exit(1);
  }
}

scrub();
