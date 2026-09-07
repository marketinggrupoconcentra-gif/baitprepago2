const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const filesToKeep = ['.env.example', '.env.local', '.env.branch'];
const targetDir = path.join(__dirname, '..');
const allFiles = fs.readdirSync(targetDir);
const envFiles = allFiles.filter(f => f.startsWith('.env') && !filesToKeep.includes(f));

if (envFiles.length === 0) {
  console.log('No redundant .env files found to archive.');
  process.exit(0);
}

const password = crypto.randomBytes(16).toString('hex');
const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(password, 'salt', 32);
const iv = crypto.randomBytes(16);

// We will create a tar-like structure in a buffer
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

const cipher = crypto.createCipheriv(algorithm, key, iv);
const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);

// Prepend IV to the file so it can be decrypted later
const outBuffer = Buffer.concat([iv, encrypted]);
const outPath = path.join(targetDir, 'backup-envs.enc');

fs.writeFileSync(outPath, outBuffer);

console.log('=== SECURE BACKUP CREATED ===');
console.log(`Archived ${envFiles.length} files.`);
console.log(`Backup saved to: ${outPath}`);
console.log(`DECRYPTION PASSWORD: ${password}`);
console.log('KEEP THIS PASSWORD SAFE. IT WILL NOT BE SHOWN AGAIN.');
console.log('=============================');

// Optional: create a decrypt script for the user
const decryptScript = `
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node decrypt-envs.js <password>');
  process.exit(1);
}

const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(password, 'salt', 32);
const encFile = fs.readFileSync('backup-envs.enc');
const iv = encFile.subarray(0, 16);
const encrypted = encFile.subarray(16);

const decipher = crypto.createDecipheriv(algorithm, key, iv);
const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
const uncompressed = zlib.gunzipSync(compressed);

let offset = 0;
while (offset < uncompressed.length) {
  const nameBuffer = uncompressed.subarray(offset, offset + 256);
  const name = nameBuffer.toString().replace(/\\x00/g, '');
  offset += 256;
  const size = uncompressed.readUInt32LE(offset);
  offset += 4;
  const content = uncompressed.subarray(offset, offset + size);
  offset += size;
  fs.writeFileSync('restored_' + name, content);
  console.log('Restored: ' + name);
}
console.log('Done.');
`;

fs.writeFileSync(path.join(targetDir, 'decrypt-envs.js'), decryptScript);
console.log('Generated decrypt-envs.js script for your convenience.');

// Remove the old files
for (const file of envFiles) {
  fs.unlinkSync(path.join(targetDir, file));
}
console.log('Redundant .env files have been securely removed.');
