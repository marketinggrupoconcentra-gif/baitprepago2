
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
  const name = nameBuffer.toString().replace(/\x00/g, '');
  offset += 256;
  const size = uncompressed.readUInt32LE(offset);
  offset += 4;
  const content = uncompressed.subarray(offset, offset + size);
  offset += size;
  fs.writeFileSync('restored_' + name, content);
  console.log('Restored: ' + name);
}
console.log('Done.');
