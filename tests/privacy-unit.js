const fs = require('fs');
const path = require('path');

console.log('Running privacy-unit tests...');
let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`❌ FAIL: ${message}`);
  }
}

const ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert(
  !/href="#"[^>]*class="pf-link"/.test(indexHtml),
  'El link del Aviso de Privacidad ya no apunta a "#"'
);

assert(
  (indexHtml.match(/href="aviso-de-privacidad\/"/g) || []).length >= 2,
  'index.html enlaza a /aviso-de-privacidad/ (checkbox + footer) al menos 2 veces'
);

const privacyPagePath = path.join(ROOT, 'aviso-de-privacidad', 'index.html');
assert(fs.existsSync(privacyPagePath), 'Existe aviso-de-privacidad/index.html');

const privacyHtml = fs.readFileSync(privacyPagePath, 'utf8');
assert(!/<script/i.test(privacyHtml), 'La página de aviso no depende de JavaScript para leer el texto (sin <script>)');
assert(/Volver al sitio/i.test(privacyHtml), 'La página de aviso tiene enlace de regreso al sitio');
assert(/viewport/i.test(privacyHtml), 'La página de aviso declara viewport (responsive)');

const requiredInputsDoc = path.join(ROOT, 'docs', 'legal', 'privacy-required-inputs.md');
assert(fs.existsSync(requiredInputsDoc), 'Existe docs/legal/privacy-required-inputs.md con los datos legales pendientes');

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
