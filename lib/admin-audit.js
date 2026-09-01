/**
 * lib/admin-audit.js
 * Helpers for logging administrative actions in the admin_audit_log table.
 */

const { neon } = require('@neondatabase/serverless');

/**
 * Registers an administrative action.
 * @param {string} adminEmail - Email of the admin performing the action.
 * @param {string} action - The predefined action code (e.g. 'LEAD_PHONE_SEARCH', 'LEAD_PHONE_REVEAL', 'LOGIN_SUCCESS')
 * @param {string} target - The resource being affected (e.g. the lead's ID or phone number)
 * @param {string} ip - IP address of the admin
 * @param {string} userAgent - User agent of the admin
 * @returns {Promise<boolean>} - True if successful, throws otherwise.
 */
async function logAdminAction(adminEmail, action, target, ip = '', userAgent = '') {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }

  const sql = neon(process.env.DATABASE_URL);
  
  try {
    await sql`
      INSERT INTO admin_audit_log (admin_email, action, target, ip_address, user_agent)
      VALUES (${adminEmail}, ${action}, ${target}, ${ip}, ${userAgent})
    `;
    return true;
  } catch (err) {
    console.error('Failed to write to admin_audit_log:', err.message);
    throw new Error('Audit logging failed. Secure fail-closed.');
  }
}

module.exports = {
  logAdminAction
};
