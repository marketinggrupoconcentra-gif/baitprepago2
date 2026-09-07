const postgres = require('postgres');
async function test() {
  const sql = postgres('postgres://postgres:postgres@localhost:5432/postgres');
  await sql`DROP TABLE IF EXISTS test_conflict`;
  await sql`CREATE TABLE test_conflict (id SERIAL PRIMARY KEY, phone VARCHAR(10))`;
  try {
    await sql`INSERT INTO test_conflict (phone) VALUES ('123') ON CONFLICT (phone) DO NOTHING`;
    console.log('SUCCESS');
  } catch (e) {
    console.error('ERROR:', e.message);
  }
  process.exit(0);
}
test();
