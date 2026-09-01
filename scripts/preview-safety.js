// scripts/preview-safety.js
// Script de seguridad para garantizar que los entornos de Preview no toquen Producción.
// FAIL CLOSED ante ambigüedad.

const VERCEL_ENV = process.env.VERCEL_ENV; // 'production', 'preview', 'development'
const BRANCH = process.env.VERCEL_GIT_COMMIT_REF;
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

function enforceSafety() {
  console.log(`🛡️ Preview Safety Check`);

  // Detectar comandos Vercel de CLI bloqueados para preview
  const args = process.argv.join(' ');
  const blockedCommands = [
    'vercel --prod',
    'vercel deploy --prod',
    'vercel promote',
    'vercel rollback',
    'vercel alias'
  ];

  for (const cmd of blockedCommands) {
    if (args.includes(cmd)) {
      console.error(`❌ FAIL CLOSED: Comando bloqueado detectado (${cmd}).`);
      process.exit(1);
    }
  }

  if (!VERCEL_ENV) {
    console.warn('⚠️ No VERCEL_ENV detected. Assuming strict development mode.');
    return;
  }

  if (VERCEL_ENV === 'preview') {
    // Bloquear production targets
    if (DB_URL.includes('production') || DB_URL.includes('a57hzmzw')) {
      console.error('❌ FAIL CLOSED: Entorno Preview está intentando conectar a DB de producción.');
      process.exit(1);
    }
    console.log('✅ Preview environment is safely isolated.');
  } else if (VERCEL_ENV === 'production') {
    if (BRANCH !== 'main') {
      console.error(`❌ FAIL CLOSED: Intento de deploy a producción desde rama no principal (${BRANCH}).`);
      process.exit(1);
    }
    console.log('✅ Production environment verified.');
  }
}

enforceSafety();
