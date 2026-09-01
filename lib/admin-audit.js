/**
 * lib/admin-audit.js
 * Helpers for logging administrative actions in the admin_audit_log table.
 */

import { getDb } from './db.js';
import { hashIdentity } from './admin-auth.js';

/**
 * Registers an administrative action.
 * @param {object} user - The authenticated admin user { id, sessionId }
 * @param {string} action - The predefined action code (e.g. 'LEAD_PHONE_SEARCH', 'LEAD_PHONE_REVEAL', 'LOGIN_SUCCESS')
 * @param {object} metadata - The JSON metadata to store.
 * @returns {Promise<boolean>} - True if successful, throws otherwise.
 */
export async function logAdminAction(user, action, metadata = {}) {
  // Enforce PII policy: fail closed if forbidden keys are detected.
  const forbiddenKeys = ['phone', 'ip', 'user_agent', 'ip_address'];
  for (const key of forbiddenKeys) {
    if (key in metadata) {
      throw new Error(`Audit metadata forbidden key detected: ${key}`);
    }
  }

  const sql = getDb();
  const actorHash = hashIdentity(`session:${user.sessionId}`);

  try {
    await sql`
      INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
      VALUES (${user.id}, ${action}, ${actorHash}, ${JSON.stringify(metadata)})
    `;
    return true;
  } catch (err) {
    console.error('Failed to write to admin_audit_log:', err.message);
    throw new Error('Audit logging failed. Secure fail-closed.');
  }
}
