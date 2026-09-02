/**
 * scripts/preview-safety.js
 * Script de seguridad para garantizar que los entornos de Preview no toquen Producción.
 * FAIL CLOSED ante ambigüedad.
 */

const FORBIDDEN_PRODUCTION_BRANCH_ID = 'br-aged-recipe-a57hzmzw';
// You can also add FORBIDDEN_PRODUCTION_ENDPOINT_ID if known, e.g., 'ep-tiny-dawn'

function enforceSafety() {
  console.log(`🛡️ Preview Safety Check (Stage 1C Version)`);

  const EXPECTED_NEON_ENDPOINT_ID = process.env.EXPECTED_NEON_ENDPOINT_ID;
  const EXPECTED_NEON_BRANCH_ID = process.env.EXPECTED_NEON_BRANCH_ID;
  const VERCEL_ENV = process.env.VERCEL_ENV; // 'production', 'preview', 'development'
  const DB_URL = process.env.DATABASE_URL || '';

  if (!VERCEL_ENV) {
    console.warn('⚠️ No VERCEL_ENV detected. Assuming development mode.');
    return;
  }

  // Reglas absolutas: Nunca conectar a la rama de producción si estamos verificando seguridad de QA.
  if (DB_URL.includes(FORBIDDEN_PRODUCTION_BRANCH_ID)) {
    console.error(`❌ FAIL CLOSED: DATABASE_URL contiene FORBIDDEN_PRODUCTION_BRANCH_ID (${FORBIDDEN_PRODUCTION_BRANCH_ID}).`);
    process.exit(1);
  }
  
  if (EXPECTED_NEON_BRANCH_ID === FORBIDDEN_PRODUCTION_BRANCH_ID) {
    console.error(`❌ FAIL CLOSED: EXPECTED_NEON_BRANCH_ID es igual a la rama de producción prohibida.`);
    process.exit(1);
  }

  if (VERCEL_ENV === 'production') {
    // Si queremos obligar a que nunca se corran scripts destructivos en prod:
    console.error(`❌ FAIL CLOSED: VERCEL_ENV=production. Este script/verificación está bloqueado para Producción.`);
    process.exit(1);
  }

  if (VERCEL_ENV === 'preview') {
    // Si estamos en preview, se DEBEN proveer los IDs esperados para certificar la conexión
    if (!EXPECTED_NEON_ENDPOINT_ID || !EXPECTED_NEON_BRANCH_ID) {
      console.error(`❌ FAIL CLOSED: En entorno Preview, se requieren EXPECTED_NEON_ENDPOINT_ID y EXPECTED_NEON_BRANCH_ID.`);
      process.exit(1);
    }

    if (!DB_URL.includes(EXPECTED_NEON_ENDPOINT_ID)) {
      console.error(`❌ FAIL CLOSED: DATABASE_URL no coincide con EXPECTED_NEON_ENDPOINT_ID (${EXPECTED_NEON_ENDPOINT_ID}).`);
      process.exit(1);
    }

    console.log(`✅ Preview environment is safely isolated on endpoint ${EXPECTED_NEON_ENDPOINT_ID}.`);
  }
}

// Permitir ser importado o ejecutado directamente
if (require.main === module) {
  enforceSafety();
} else {
  module.exports = { enforceSafety };
}
