import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { assertSameOrigin, hashIdentity } from '../../../lib/admin-auth.js';
import { validateTransitionPayload } from '../../../lib/lead-workflow.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2kb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported Media Type' });
  }

  // Same-Origin Check (certified helper)
  try {
    assertSameOrigin(req);
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const user = await requireAdminSession(req, res);
    if (!user) return; // Response is already handled

    if (user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden. SUPER_ADMIN role required.' });
    }

    const { id, status, reason, expectedVersion } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
      return res.status(400).json({ error: 'Invalid expectedVersion' });
    }

    const validation = validateTransitionPayload(status, reason || null);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const sql = getDb();
    const normalizedReason = reason || null;
    const actorHash = hashIdentity(`session:${user.sessionId}`);

    // SINGLE STATEMENT ATOMIC CAS
    const queryResult = await sql`
      WITH current_lead AS (
        SELECT id, status, status_reason, status_updated_at, status_version
        FROM leads
        WHERE id = ${id}
      ),
      update_action AS (
        UPDATE leads
        SET 
          status = ${status},
          status_reason = ${normalizedReason},
          status_updated_at = NOW(),
          status_version = leads.status_version + 1
        FROM current_lead
        WHERE leads.id = current_lead.id
          AND leads.status_version = ${expectedVersion}
          -- Ensure it's not a true NOOP
          AND (
            leads.status IS DISTINCT FROM ${status}
            OR leads.status_reason IS DISTINCT FROM ${normalizedReason}
          )
        RETURNING leads.id, leads.status, leads.status_reason, leads.status_updated_at, leads.status_version
      ),
      audit_action AS (
        INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
        SELECT 
          ${user.id}, 
          'LEAD_STATUS_CHANGED', 
          ${actorHash}, 
          json_build_object(
            'leadId', current_lead.id,
            'fromStatus', current_lead.status,
            'toStatus', update_action.status,
            'reasonCode', update_action.status_reason,
            'fromVersion', current_lead.status_version,
            'toVersion', update_action.status_version
          )::jsonb
        FROM update_action
        JOIN current_lead ON current_lead.id = update_action.id
        RETURNING 1
      )
      SELECT 
        (SELECT COUNT(*) FROM current_lead) AS found,
        (SELECT status_version FROM current_lead) AS current_version,
        (SELECT status FROM current_lead) AS current_status,
        (SELECT status_reason FROM current_lead) AS current_reason,
        (SELECT status_updated_at FROM current_lead) AS current_updated_at,
        (SELECT json_build_object(
            'id', id,
            'status', status,
            'statusReason', status_reason,
            'statusUpdatedAt', status_updated_at,
            'statusVersion', status_version
        ) FROM update_action) AS updated_lead
    `;

    const row = queryResult[0];

    // NOT FOUND
    if (!row || row.found === 0n || row.found === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // CHECK IF IT WAS A NOOP BASED ON SNAPSHOT
    const isNoop = row.current_version === expectedVersion && 
                   row.current_status === status && 
                   row.current_reason === normalizedReason;

    // CONFLICT OR LOST UPDATE
    if (!row.updated_lead && !isNoop) {
      // It's a CAS loss! The target row changed since we loaded expectedVersion,
      // or someone else modified it before the UPDATE executed.
      // We must fetch the actual current state safely.
      const freshResult = await sql`
        SELECT id, status, status_reason, status_updated_at, status_version
        FROM leads
        WHERE id = ${id}
      `;
      const fresh = freshResult[0];
      return res.status(409).json({
        error: 'Conflict',
        currentStatus: fresh ? fresh.status : row.current_status,
        currentVersion: fresh ? fresh.status_version : row.current_version
      });
    }

    // NOOP
    if (isNoop) {
      return res.status(200).json({
        changed: false,
        lead: {
          id,
          status: row.current_status,
          statusReason: row.current_reason,
          statusUpdatedAt: row.current_updated_at,
          statusVersion: row.current_version
        }
      });
    }

    // SUCCESS
    return res.status(200).json({
      changed: true,
      lead: row.updated_lead
    });

  } catch (err) {
    console.error('LEAD_STATUS_UPDATE_FAILED');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
