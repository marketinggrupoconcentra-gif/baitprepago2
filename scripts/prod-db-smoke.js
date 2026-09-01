import { getDb } from '../lib/db.js';

async function run() {
  const sql = getDb();
  try {
    const leads = await sql`
      SELECT * FROM leads
      WHERE utm_source = 'release-smoke' 
        AND utm_medium = 'internal' 
        AND utm_campaign = 'stage-0d'
    `;
    console.log('Production leads found:', leads.length);
    console.log(leads);
    
    if (leads.length > 0) {
      await sql`
        DELETE FROM leads 
        WHERE utm_source = 'release-smoke' 
          AND utm_medium = 'internal' 
          AND utm_campaign = 'stage-0d'
      `;
      console.log('Synthetic lead deleted successfully.');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error in DB smoke/cleanup:', err);
    process.exit(1);
  }
}
run();
