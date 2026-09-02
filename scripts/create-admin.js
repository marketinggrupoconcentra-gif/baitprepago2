/**
 * scripts/create-admin.js
 * 
 * Securely creates a SUPER_ADMIN user in the Preview Admin database.
 * 
 * FAIL CLOSED:
 *   - Aborts if DATABASE_URL does not match the expected preview endpoint
 *   - Password entered interactively (masked) — never logged, never passed as arg
 *   - Email normalized to lowercase
 * 
 * Run with:
 *   node --env-file=.env.branch scripts/create-admin.js
 */

const { enforceSafety } = require('./preview-safety.js');
enforceSafety();

const { createInterface } = require('readline');

async function createAdmin() {
  console.log('=== Create QA Super Admin ===');
  
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set. Aborting.');
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (q) => new Promise(resolve => rl.question(q, resolve));

  const email = await question('Email (press Enter for qa-admin@bait.invalid): ');
  const normalizedEmail = (email.trim() || 'qa-admin@bait.invalid').toLowerCase();

  // Read password with masking
  const password = await new Promise(resolve => {
    process.stdout.write('Password (14-128 chars, hidden): ');
    
    let pwd = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    const onData = (char) => {
      if (char === '\r' || char === '\n' || char === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        console.log(''); // newline
        resolve(pwd);
      } else if (char === '\u0003') {
        console.log('\nAborted.');
        process.exit(0);
      } else if (char === '\u007f' || char === '\b') {
        if (pwd.length > 0) {
          pwd = pwd.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        pwd += char;
        process.stdout.write('*');
      }
    };
    
    process.stdin.on('data', onData);
  });

  rl.close();

  if (!password || password.length < 14 || password.length > 128) {
    console.error('❌ Password must be between 14 and 128 characters.');
    process.exit(1);
  }

  console.log(`\nCreating admin user: ${normalizedEmail}`);
  console.log('Hashing password with scrypt (N=32768, r=8, p=3)...');

  // Dynamically import ESM module
  const { hashPassword } = await import('../lib/admin-auth.js');
  const { neon } = await import('@neondatabase/serverless');

  const passwordHash = await hashPassword(password);

  // Verify format
  if (!passwordHash.startsWith('scrypt$32768$8$3$')) {
    console.error('❌ Password hash format unexpected. Aborting.');
    process.exit(1);
  }

  const parts = passwordHash.split('$');
  if (parts[4].length !== 32) {
    console.error('❌ Salt length unexpected. Aborting.');
    process.exit(1);
  }
  if (parts[5].length !== 128) {
    console.error('❌ Hash length unexpected. Aborting.');
    process.exit(1);
  }

  console.log('✅ Hash format verified (salt=32 hex, key=128 hex)');

  const sql = neon(dbUrl);

  try {
    await sql`
      INSERT INTO admin_users (email, password_hash, role, active)
      VALUES (${normalizedEmail}, ${passwordHash}, 'SUPER_ADMIN', true)
    `;
    console.log(`✅ Admin user created: ${normalizedEmail} (role=SUPER_ADMIN, active=true)`);
  } catch (err) {
    if (err.message.includes('duplicate') || err.message.includes('unique')) {
      console.error(`❌ User ${normalizedEmail} already exists.`);
    } else {
      console.error('❌ Insert failed:', err.message);
    }
    process.exit(1);
  }

  // Verify without revealing hash
  const users = await sql`
    SELECT email, role, active, 
           starts_with(password_hash, 'scrypt$') as hash_valid,
           last_login_at
    FROM admin_users 
    WHERE email = ${normalizedEmail}
  `;
  
  const u = users[0];
  if (!u) { console.error('❌ User not found after insert.'); process.exit(1); }
  
  console.log('\nVerification:');
  console.log(`  email:        ${u.email}`);
  console.log(`  role:         ${u.role}`);
  console.log(`  active:       ${u.active}`);
  console.log(`  hash valid:   ${u.hash_valid}`);
  console.log(`  plaintext:    NOT STORED`);
  console.log(`  last_login:   ${u.last_login_at || 'null (never)'}`);

  if (!u.hash_valid) {
    console.error('❌ Password hash does not start with scrypt$. Something went wrong.');
    process.exit(1);
  }
  
  console.log('\n✅ QA Admin created and verified successfully.');
  process.exit(0);
}

createAdmin().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
