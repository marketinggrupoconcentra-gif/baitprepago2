import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

const who = await sql`select current_database() db, inet_server_addr()::text addr, version()`;
console.log('db:', who[0].db, '| pg:', who[0].version.split(' ')[1]);

const cols = await sql`select column_name from information_schema.columns where table_name='leads' order by ordinal_position`;
const names = cols.map(c => c.column_name);
console.log('leads columns:', names.join(', '));

for (const forbidden of ['nip','NIP','phoneConfirm','phone_confirm']) {
  console.log(`  forbidden "${forbidden}" absent:`, !names.includes(forbidden));
}
const wf = ['status','status_reason','workflow_version','status_updated_at'].filter(c => names.includes(c));
console.log('workflow columns present:', wf.join(', ') || '(none)');

const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
console.log('tables:', tables.map(t => t.table_name).join(', '));

const cnt = await sql`select count(*)::int n from leads`;
console.log('leads total rows:', cnt[0].n);
const qa = await sql`select count(*)::int n from leads where utm_source='QA_R4_DB_TARGET'`;
console.log('QA_R4_DB_TARGET rows (baseline):', qa[0].n);
