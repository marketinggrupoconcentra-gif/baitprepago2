import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-auth.js';
import { logAdminAction } from '../../../lib/admin-audit.js';
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

  // Same-Origin Check (simple fetch metadata check)
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && secFetchSite !== 'same-origin') {
    return res.status(403).json({ error: 'Forbidden cross-origin request' });
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

    // Begin transaction for optimistic locking and audit
    try {
      // NOTE: With Neon serverless, standard `sql.begin` is not always stable for transactions.
      // We will use standard single statements if transaction fails, but we can do a PostgreSQL transaction block if we use array of statements
      // Or we can just use `sql.transaction` from neondatabase/serverless.
      // The prompt says: "Usar la transaction API compatible con @neondatabase/serverless ^1.1.0 ... No: sql.begin"
      
      const result = await sql.transaction(async (tx) => {
        // Read current lead
        const currentLeadRows = await tx`
          SELECT id, status, status_version 
          FROM leads 
          WHERE id = ${id}
        `;
        
        if (currentLeadRows.length === 0) {
          throw { status: 404, error: 'Lead not found' };
        }
        
        const currentLead = currentLeadRows[0];
        
        // Concurrency Check
        if (currentLead.status_version !== expectedVersion) {
          throw { 
            status: 409, 
            error: 'Conflict', 
            currentStatus: currentLead.status, 
            currentVersion: currentLead.status_version 
          };
        }

        // Same Status Check
        if (currentLead.status === status) {
          return {
            changed: false,
            lead: {
              id: currentLead.id,
              status: currentLead.status,
              statusReason: currentLead.status_reason || null,
              statusUpdatedAt: currentLead.status_updated_at || new Date().toISOString(),
              statusVersion: currentLead.status_version
            }
          };
        }

        // Perform the Update
        const nextVersion = currentLead.status_version + 1;
        const normalizedReason = reason || null;
        
        const updateRows = await tx`
          UPDATE leads
          SET 
            status = ${status},
            status_reason = ${normalizedReason},
            status_updated_at = NOW(),
            status_version = ${nextVersion}
          WHERE id = ${id} AND status_version = ${expectedVersion}
          RETURNING id, status, status_reason, status_updated_at, status_version
        `;

        if (updateRows.length === 0) {
          // This would only happen if another transaction snuck in between read and update
          throw { 
            status: 409, 
            error: 'Conflict'
          };
        }

        const updatedLead = updateRows[0];

        // Perform Audit in the same transaction
        await logAdminAction(user, 'LEAD_STATUS_CHANGED', {
          leadId: id,
          fromStatus: currentLead.status,
          toStatus: status,
          reasonCode: normalizedReason,
          fromVersion: currentLead.status_version,
          toVersion: nextVersion
        }, tx);

        return {
          changed: true,
          lead: {
            id: updatedLead.id,
            status: updatedLead.status,
            statusReason: updatedLead.status_reason,
            statusUpdatedAt: updatedLead.status_updated_at,
            statusVersion: updatedLead.status_version
          }
        };
      });

      return res.status(200).json(result);

    } catch (txError) {
      if (txError.status) {
        return res.status(txError.status).json(txError);
      }
      throw txError;
    }

  } catch (err) {
    console.error('Status Update API Error:', err);
    // Explicitly catching audit failures or other errors. 
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
