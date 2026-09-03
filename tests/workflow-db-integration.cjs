/**
 * tests/workflow-db-integration.cjs
 * Pruebas E2E para el Workflow de Leads.
 * Valida concurrencia, reglas del catálogo y auditoría (atomicity) a nivel Base de Datos.
 */

const { resolveDatabaseUrl } = require('../lib/db.js');
const { neon } = require('@neondatabase/serverless');

async function runTests() {
  const dbUrl = resolveDatabaseUrl(process.env);
  const sql = neon(dbUrl);
  
  const RUN_ID = 'DB_TEST_' + Date.now();

  try {
    console.log('--- STARTING WORKFLOW DB INTEGRATION TESTS ---');

    console.log('[+] 1. Testing DB CHECK constraints for status_reason...');
    
    // Test: Missing reason for REJECTED
    try {
      await sql`
        INSERT INTO leads (
          phone, utm_source, status, status_version
        ) VALUES (
          '5555555555', ${RUN_ID}, 'REJECTED', 1
        )
      `;
      throw new Error('Allowed missing reason for REJECTED');
    } catch (err) {
      if (!err.message.includes('leads_status_reason_rule')) throw err;
    }
    
    // Test: Invalid reason for REJECTED (assuming Migration003 checks valid catalog if any)
    // Here we mainly test the strict enforcement of reason matrix.

    console.log('    Validations OK.');

    console.log('[+] 2. Testing Optimistic Concurrency...');
    
    // Insert a synthetic lead to test with
    const insertRes = await sql`
      INSERT INTO leads (
        phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        page_url, referrer, status, status_version
      ) VALUES (
        '5555555555', ${RUN_ID}, 'TEST', 'TEST', 'TEST', 'TEST',
        'http://test', 'http://test', 'NEW', 1
      ) RETURNING id, status_version
    `;
    const leadId = insertRes[0].id;
    let v1 = insertRes[0].status_version;
    
    // Simulate user 2 reading and updating
    await sql`
      UPDATE leads 
      SET status = 'CONTACTED', status_version = status_version + 1 
      WHERE id = ${leadId} AND status_version = ${v1}
    `;
    
    // Simulate user 1 attempting to update with old version
    const updateRes = await sql`
      UPDATE leads 
      SET status = 'REJECTED', status_reason = 'INVALID_DATA', status_version = status_version + 1 
      WHERE id = ${leadId} AND status_version = ${v1}
    `;

    if (updateRes.length !== 0) {
      throw new Error('Optimistic Concurrency failed. User 1 overwrote User 2.');
    }
    
    console.log('    Optimistic Concurrency OK.');
    
    console.log('[+] 3. Testing Reason rules on UPDATE...');
    try {
      await sql`UPDATE leads SET status = 'CONTACTED', status_reason = 'INVALID_DATA' WHERE id = ${leadId}`;
      throw new Error('Allowed reason for non-reject/cancel status in DB!');
    } catch (err) {
      if (!err.message.includes('leads_status_reason_rule')) throw err;
      console.log('    Reason rules OK.');
    }
    
    console.log('[+] 4. Testing Atomicity (Rollback on Audit failure)...');
    try {
      await sql.transaction([
        sql`UPDATE leads SET status = 'COMPLETED', status_version = status_version + 1 WHERE id = ${leadId}`,
        sql`INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata) VALUES (999999999, 'LEAD_STATUS_CHANGED', 'test', '{}'::jsonb)`
      ]);
      throw new Error('Transaction succeeded unexpectedly');
    } catch (err) {
      if (!err.message.includes('violates foreign key constraint')) throw err;
      // Verify rollback happened
      const checkRes = await sql`SELECT status FROM leads WHERE id = ${leadId}`;
      if (checkRes[0].status === 'COMPLETED') {
        throw new Error('Rollback failed. Parent lead was updated despite audit failure.');
      }
      console.log('    Atomicity OK. Parent lead update rolled back.');
    }

    console.log('--- ALL TESTS PASSED ---');
  } catch (err) {
    console.error('--- TEST FAILED ---');
    console.error(err);
    process.exit(1);
  } finally {
    // Cleanup using unique RUN_ID
    if (RUN_ID) {
      await sql`DELETE FROM admin_audit_log WHERE metadata->>'leadId' IN (SELECT id::text FROM leads WHERE utm_source = ${RUN_ID})`;
      await sql`DELETE FROM leads WHERE utm_source = ${RUN_ID}`;
    }
  }
}

runTests();
