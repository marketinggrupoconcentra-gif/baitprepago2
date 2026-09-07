const { validateLeadPayload } = require('../lib/validation.js');
const { todayCDMX, addCivilDays, isWithinNipValidityWindow, isValidDateOnly } = require('../lib/cdmx-date.js');

console.log('Running nip-conditional-unit tests...');
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

const VALID_EMAIL = 'user@example.com';
const NOW = new Date('2026-09-07T18:00:00.000Z'); // 2026-09-07 in CDMX

function basePayload(overrides) {
  return Object.assign({
    phone: '5512345678',
    nip: '1234', // last4 of phone is 5678, so this does NOT match by default
    email: VALID_EMAIL,
    consent: true
  }, overrides);
}

/* ── NIP different from phone last4 ── */
{
  const result = validateLeadPayload(basePayload({ nip: '1234' }), NOW);
  assert(result.valid, 'NIP != last4: phone válido + NIP diferente → PASS');
}

{
  // last4 = 5678 but nip is a different 4-digit value, no date supplied
  const result = validateLeadPayload(basePayload({ nip: '0000' }), NOW);
  assert(result.valid, 'NIP != last4: no requiere fecha de vigencia');
}

/* ── NIP equals phone last4 ── */
const MATCHING_NIP = { phone: '5512345678', nip: '5678' };

{
  const result = validateLeadPayload(basePayload(MATCHING_NIP), NOW); // no date
  assert(!result.valid && result.errors.includes('nip_valid_until_required'),
    'NIP == last4 sin fecha → FAIL (nip_valid_until_required)');
}

{
  const today = todayCDMX(NOW);
  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: today }, MATCHING_NIP)), NOW);
  assert(result.valid, 'NIP == last4 con fecha = hoy CDMX → PASS');
}

{
  const today = todayCDMX(NOW);
  const plus1 = addCivilDays(today, 1);
  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: plus1 }, MATCHING_NIP)), NOW);
  assert(result.valid, 'NIP == last4 con fecha = hoy+1 → PASS');
}

{
  const today = todayCDMX(NOW);
  const plus5 = addCivilDays(today, 5);
  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: plus5 }, MATCHING_NIP)), NOW);
  assert(result.valid, 'NIP == last4 con fecha = hoy+5 → PASS');
}

{
  const today = todayCDMX(NOW);
  const plus6 = addCivilDays(today, 6);
  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: plus6 }, MATCHING_NIP)), NOW);
  assert(!result.valid && result.errors.includes('nip_valid_until_out_of_range'),
    'NIP == last4 con fecha = hoy+6 → FAIL (out_of_range)');
}

{
  const today = todayCDMX(NOW);
  const yesterday = addCivilDays(today, -1);
  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: yesterday }, MATCHING_NIP)), NOW);
  assert(!result.valid && result.errors.includes('nip_valid_until_out_of_range'),
    'NIP == last4 con fecha = ayer → FAIL (out_of_range)');
}

{
  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: 'not-a-date' }, MATCHING_NIP)), NOW);
  assert(!result.valid && result.errors.includes('nip_valid_until_invalid'),
    'NIP == last4 con formato inválido → FAIL (invalid)');
}

{
  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: '2026-13-40' }, MATCHING_NIP)), NOW);
  assert(!result.valid && result.errors.includes('nip_valid_until_invalid'),
    'Fecha mal formada (mes/día inválido) → FAIL (invalid)');
}

/* ── Timezone edge: UTC already next day, CDMX still previous day ── */
{
  // 2026-09-08T04:30:00Z is 2026-09-07 22:30 CDMX (UTC-6) -> still Sep 7 in CDMX.
  const utcEdge = new Date('2026-09-08T04:30:00.000Z');
  const today = todayCDMX(utcEdge);
  assert(today === '2026-09-07', 'CDMX civil day stays previous day near UTC midnight boundary');

  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: today }, MATCHING_NIP)), utcEdge);
  assert(result.valid, 'Vigencia calculada usa día civil CDMX, no UTC');
}

{
  assert(isValidDateOnly('2026-09-07') === true, 'isValidDateOnly acepta fecha bien formada');
  assert(isValidDateOnly('2026-9-7') === false, 'isValidDateOnly rechaza formato no estricto');
  assert(isWithinNipValidityWindow('', NOW) === false, 'isWithinNipValidityWindow rechaza vacío');
}

/* ── Privacy: NIP and nip_valid_until must never survive into validation.data ── */
{
  const today = todayCDMX(NOW);
  const result = validateLeadPayload(basePayload(Object.assign({ nip_valid_until: today }, MATCHING_NIP)), NOW);
  assert(result.valid, 'Precondition: payload válido para revisar purga de NIP');
  assert(result.data.nip === undefined, 'validation.data.nip === undefined');
  assert(result.data.nip_valid_until === undefined, 'validation.data.nip_valid_until === undefined');
}

{
  const fs = require('fs');
  const schema = fs.readFileSync(require('path').join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  // Match an actual column declaration (name followed by a SQL type), not prose mentions of "NIP".
  assert(!/^\s*nip\s+(VARCHAR|TEXT|CHAR|INTEGER|DATE)/im.test(schema), 'schema.sql no declara columna nip');
  assert(!/^\s*nip_valid_until\s+/im.test(schema), 'schema.sql no declara columna nip_valid_until');
}

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
