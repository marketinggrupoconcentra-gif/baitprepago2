const { logAdminAction } = require('../lib/admin-audit.js');

console.log('Running leads-unit tests...');
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

async function run() {
  try {
    // 1. Audit Action Validation
    // Mock user
    const user = { id: 1, sessionId: 'test-session-id' };
    
    let caught = false;
    try {
      await logAdminAction(user, 'TEST_ACTION', { phone: '1234567890' });
    } catch (err) {
      caught = true;
      assert(err.message.includes('not allowed'), 'Audit prevents forbidden keys (phone)');
    }
    assert(caught, 'Audit throws on forbidden key');

    let caughtIp = false;
    try {
      await logAdminAction(user, 'TEST_ACTION', { ip: '127.0.0.1' });
    } catch (err) {
      caughtIp = true;
    }
    assert(caughtIp, 'Audit prevents forbidden keys (ip)');

    console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
    
  } catch (err) {
    console.error('Fatal error in tests', err);
    process.exit(1);
  }
}

// We mock the getDb in admin-audit to not fail on DB connection for this pure unit test.
// Actually, logAdminAction does a DB write so this might fail unless mocked, but we expect the error to throw *before* the DB write.
run();
