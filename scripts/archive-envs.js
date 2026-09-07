const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// AES-256-GCM settings
const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

const filesToKeep = ['.env.example', '.env.local', '.env.branch'];
const targetDir = path.join(__dirname, '..');
const outDir = path.join(targetDir, '..', 'baitprepago2_backups');
const outPath = path.join(outDir, `envs-backup-${Date.now()}.enc`);

const args = process.argv.slice(2);
const force = args.includes('--force');

if (!fs.existsSync(outDir)) {
  if (force) {
    fs.mkdirSync(outDir, { recursive: true });
  } else {
    console.log(`[DRY-RUN] Would create directory: ${outDir}`);
  }
}

const allFiles = fs.readdirSync(targetDir);
const envFiles = allFiles.filter(f => f.startsWith('.env') && !filesToKeep.includes(f));

if (envFiles.length === 0) {
  console.log('No redundant .env files found to archive.');
  process.exit(0);
}

if (!force) {
  console.log('=== [DRY-RUN] SECURE ARCHIVER ===');
  console.log(`Found ${envFiles.length} files to archive:`);
  envFiles.forEach(f => console.log(`  - ${f}`));
  console.log(`Would archive to: ${outPath}`);
  console.log('Run with --force to execute.');
  process.exit(0);
}

const password = process.env.ARCHIVE_PASSWORD;
if (!password) {
  console.error('ERROR: ARCHIVE_PASSWORD environment variable is required when using --force.');
  process.exit(1);
}

const salt = crypto.randomBytes(SALT_LEN);
const key = crypto.scryptSync(password, salt, KEY_LEN);
const iv = crypto.randomBytes(IV_LEN);

let bufferList = [];
for (const file of envFiles) {
  const content = fs.readFileSync(path.join(targetDir, file));
  const nameBuffer = Buffer.alloc(256);
  nameBuffer.write(file);
  const sizeBuffer = Buffer.alloc(4);
  sizeBuffer.writeUInt32LE(content.length);
  bufferList.push(nameBuffer, sizeBuffer, content);
}

const uncompressed = Buffer.concat(bufferList);
const compressed = zlib.gzipSync(uncompressed);

const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
const authTag = cipher.getAuthTag(); // 16 bytes

// Format: SALT(16) + IV(12) + AUTH_TAG(16) + ENCRYPTED_DATA
const outBuffer = Buffer.concat([salt, iv, authTag, encrypted]);

fs.writeFileSync(outPath, outBuffer);

console.log('=== SECURE BACKUP CREATED ===');
console.log(`Archived ${envFiles.length} files.`);
console.log(`Backup saved to: ${outPath}`);
console.log('Original files were NOT deleted automatically. Please verify the backup before deleting them.');
console.log('=============================');
