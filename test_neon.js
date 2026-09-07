const { neon } = require('@neondatabase/serverless');
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rowCount: 1, fields: [], rows: [{id: 1}] }) });
const sql = neon('postgresql://a:a@ep-a.us-east-2.aws.neon.tech/b');
sql`SELECT 1`.then(console.log).catch(e => console.error(e.stack));
