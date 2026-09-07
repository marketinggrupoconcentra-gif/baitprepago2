const { validateLeadPayload } = require('../lib/validation.js');

console.log('Running email-unit tests...');
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

function basePayload(email) {
  return {
    phone: '5512345678',
    nip: '1234', // does not match last4 (5678), so no vigencia required
    email,
    consent: true
  };
}

{
  const result = validateLeadPayload(basePayload('user@example.com'));
  assert(result.valid && result.data.email === 'user@example.com', 'Correo válido → PASS y persiste tal cual');
}

{
  const result = validateLeadPayload(basePayload('USER@EXAMPLE.COM'));
  assert(result.valid && result.data.email === 'user@example.com', 'Correo en mayúsculas se normaliza a lowercase');
}

{
  const result = validateLeadPayload(basePayload('   user@example.com   '));
  assert(result.valid && result.data.email === 'user@example.com', 'Espacios extremos se recortan (trim)');
}

{
  const result = validateLeadPayload(basePayload('not-an-email'));
  assert(!result.valid && result.errors.includes('email_invalid'), 'Correo sin @ ni dominio → FAIL (email_invalid)');
}

{
  const result = validateLeadPayload(basePayload(''));
  assert(!result.valid && result.errors.includes('email_invalid'), 'Correo vacío → FAIL (email_invalid)');
}

{
  const result = validateLeadPayload(basePayload(undefined));
  assert(!result.valid && result.errors.includes('email_invalid'), 'Correo ausente → FAIL (email_invalid)');
}

{
  const longLocal = 'a'.repeat(250);
  const result = validateLeadPayload(basePayload(`${longLocal}@example.com`));
  assert(!result.valid && result.errors.includes('email_invalid'), 'Correo > 254 caracteres → FAIL (email_invalid)');
}

{
  const result = validateLeadPayload(basePayload('user name@example.com'));
  assert(!result.valid && result.errors.includes('email_invalid'), 'Correo con espacio interno → FAIL (email_invalid)');
}

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
