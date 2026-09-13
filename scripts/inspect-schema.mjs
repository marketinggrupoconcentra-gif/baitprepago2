import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const userCols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'neon_auth' AND table_name = 'user' ORDER BY ordinal_position`;
console.log('User columns:', JSON.stringify(userCols, null, 2));

const accountCols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'neon_auth' AND table_name = 'account' ORDER BY ordinal_position`;
console.log('\nAccount columns:', JSON.stringify(accountCols, null, 2));

// Check existing users
const users = await sql`SELECT id, email, name, role FROM neon_auth."user" LIMIT 5`;
console.log('\nExisting users:', JSON.stringify(users, null, 2));
