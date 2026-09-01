const readline = require('readline');
const { getDb } = require('../lib/db.js');
require('./preview-safety.js');

async function createAdmin() {
  console.log('🛡️ Create QA Admin User');

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!dbUrl.includes('ep-little-darkness')) {
    console.error('❌ FAIL CLOSED: The DATABASE_URL does not match the preview-admin-auth endpoint (ep-little-darkness). QA users should only be created in Preview.');
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise(resolve => rl.question(query, resolve));
  const hiddenQuestion = (query) => new Promise(resolve => {
    const stdin = process.openStdin();
    process.stdout.write(query);
    stdin.on('data', function onData(char) {
      char = char + '';
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.removeListener('data', onData);
          stdin.pause();
          break;
        default:
          process.stdout.write('\x1B[2K\x1B[200D' + query + Array(rl.line.length + 1).join('*'));
          break;
      }
    });
    rl.question('', (value) => {
      rl.history = rl.history.slice(1);
      resolve(value);
    });
  });

  try {
    const email = await question('Email: ');
    if (!email) {
      console.error('Email is required.');
      process.exit(1);
    }
    
    // Fallback to simpler hidden prompt logic if the above doesn't work well in some terminals
    // Actually, Node 17+ supports `rl.question(query, { signal })` and muted output?
    // Let's just use the `hiddenQuestion` logic which is fairly standard.
    
    // Wait, the prompt says "password ingresado de forma interactiva"
    // I will just use `hiddenQuestion`
    const password = await hiddenQuestion('Password (interactive hidden input): ');
    console.log(); // new line

    if (!password || password.length < 14 || password.length > 128) {
      console.error('Password must be between 14 and 128 characters.');
      process.exit(1);
    }

    const role = 'SUPER_ADMIN';
    const normalizedEmail = email.toLowerCase().trim();

    // Dynamically import ES module hashPassword from lib/admin-auth.js
    const authModule = await import('../lib/admin-auth.js');
    const hashPassword = authModule.hashPassword;

    console.log('Hashing password securely...');
    const passwordHash = await hashPassword(password);

    console.log('Inserting into database...');
    const sql = getDb();
    
    await sql`
      INSERT INTO admin_users (email, password_hash, role, active)
      VALUES (${normalizedEmail}, ${passwordHash}, ${role}, true)
    `;

    console.log(`✅ QA Admin user ${normalizedEmail} created successfully with role ${role}.`);
    process.exit(0);
  } catch (err) {
    console.error('Error creating admin:', err);
    process.exit(1);
  } finally {
    rl.close();
  }
}

createAdmin();
