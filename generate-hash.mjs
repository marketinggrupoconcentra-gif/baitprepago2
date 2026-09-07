import { hashPassword } from './lib/admin-auth.js';
const pwd = "Control10*2026#";
const hash = await hashPassword(pwd);
console.log(hash);
