const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateTransitionPayload } = require('../lib/lead-workflow.js');

function runTests() {
  console.log('--- STARTING WORKFLOW UNIT TESTS ---');

  // Payload Validations
  let res = validateTransitionPayload('NEW', null);
  assert(res.valid === true, 'NEW with null reason should be valid');

  res = validateTransitionPayload('ACTIVATED', null);
  assert(res.valid === true, 'ACTIVATED with null reason should be valid');

  res = validateTransitionPayload('CONTACTED', null);
  assert(res.valid === true, 'CONTACTED with null reason should be valid');

  res = validateTransitionPayload('INVALID', null);
  assert(res.valid === false, 'INVALID status should fail');

  res = validateTransitionPayload('NEW', 'INVALID_DATA');
  assert(res.valid === false, 'NEW with reason should fail');

  res = validateTransitionPayload('REJECTED', null);
  assert(res.valid === false, 'REJECTED without reason should fail');

  res = validateTransitionPayload('REJECTED', 'INVALID_DATA');
  assert(res.valid === true, 'REJECTED with valid reason should pass');

  res = validateTransitionPayload('CANCELLED', 'CUSTOMER_DECLINED');
  assert(res.valid === true, 'CANCELLED with valid reason should pass');

  res = validateTransitionPayload('REJECTED', 'UNKNOWN_REASON');
  assert(res.valid === false, 'REJECTED with unknown reason should fail');

  console.log('[+] Payload Validations OK.');

  // Static checks on status.js
  const statusJsPath = path.join(__dirname, '../api/admin/leads/status.js');
  const code = fs.readFileSync(statusJsPath, 'utf8');

  // assertSameOrigin static check
  assert(code.includes('assertSameOrigin(req)'), 'Must enforce assertSameOrigin');

  // canonical session guard
  assert(code.includes('await requireAdminSession(req, res)'), 'Must enforce requireAdminSession');

  // target row CAS predicate
  assert(code.includes('leads.status_version = ${expectedVersion}'), 'Must use true CAS on target row (leads.status_version)');

  // no sql.transaction
  assert(!code.includes('sql.transaction('), 'Must NOT use sql.transaction');
  
  // no sql.begin
  assert(!code.includes('sql.begin('), 'Must NOT use sql.begin');

  // no raw error logging
  assert(code.includes("console.error('LEAD_STATUS_UPDATE_FAILED')"), 'Must use generic error logging');

  // audit metadata keys
  assert(code.includes("'fromStatus'"), 'Must track fromStatus');
  assert(code.includes("'toStatus'"), 'Must track toStatus');
  assert(code.includes("'reasonCode'"), 'Must track reasonCode');
  assert(code.includes("'fromVersion'"), 'Must track fromVersion');
  assert(code.includes("'toVersion'"), 'Must track toVersion');

  console.log('[+] Static source checks OK.');
  console.log('--- WORKFLOW UNIT TESTS PASSED ---');
}

runTests();
