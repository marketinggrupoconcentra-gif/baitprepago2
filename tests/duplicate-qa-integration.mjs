import { neon } from '@neondatabase/serverless';
import handler from '../api/leads.js';
import crypto from 'crypto';

function hashCaptchaAnswer(pepper, challengeId, answer) {
  return crypto.createHmac('sha256', pepper).update(challengeId + ':' + answer).digest('hex');
}

function createReq(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body
  };
}

function createRes() {
  const res = {
    statusCode: 200,
    jsonData: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.jsonData = data; return this; },
    setHeader(key, value) { return this; }
  };
  return res;
}

const sql = neon(process.env.DATABASE_URL);
const dupSql = neon(process.env.DUPLICATES_DATABASE_URL);

async function main() {
  const phone = '55' + Math.floor(10000000 + Math.random() * 90000000).toString();
  const captchaId = crypto.randomUUID();
  const captchaAnswer = '123456';
  const hash = hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, captchaId, captchaAnswer);
  
  // Insert valid captcha into DB so it passes validation
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${captchaId}, ${hash}, ${expiresAt})`;

  const payload = {
    phone,
    nip: phone.slice(-4),
    nip_valid_until: new Date().toISOString().split('T')[0],
    email: 'test' + Date.now() + '@integration.test',
    consent: true,
    captcha_challenge_id: captchaId,
    captcha_answer: captchaAnswer
  };
  
  console.log('\\nA. NEW LEAD: Sending first request...', phone);
  let req1 = createReq(payload);
  let res1 = createRes();
  await handler(req1, res1);
  console.log('Res 1:', res1.statusCode, res1.jsonData);

  let primaryCount = await sql`SELECT count(*) FROM leads WHERE phone = ${phone}`;
  let secondaryCount = await dupSql`SELECT count(*) FROM duplicate_leads WHERE phone = ${phone}`;
  console.log(`DB Primary: ${primaryCount[0].count}, DB Secondary: ${secondaryCount[0].count}`);

  // Re-insert valid captcha because it was consumed
  const captchaId2 = crypto.randomUUID();
  const hash2 = hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, captchaId2, captchaAnswer);
  await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${captchaId2}, ${hash2}, ${expiresAt})`;
  payload.captcha_challenge_id = captchaId2;

  console.log('\\nB. DUPLICATE: Sending second request...', phone);
  let req2 = createReq(payload);
  let res2 = createRes();
  await handler(req2, res2);
  console.log('Res 2:', res2.statusCode, res2.jsonData);

  primaryCount = await sql`SELECT count(*) FROM leads WHERE phone = ${phone}`;
  secondaryCount = await dupSql`SELECT count(*) FROM duplicate_leads WHERE phone = ${phone}`;
  console.log(`DB Primary: ${primaryCount[0].count}, DB Secondary: ${secondaryCount[0].count}`);

  // Re-insert valid captcha again
  const captchaId3 = crypto.randomUUID();
  const hash3 = hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, captchaId3, captchaAnswer);
  await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${captchaId3}, ${hash3}, ${expiresAt})`;
  payload.captcha_challenge_id = captchaId3;

  console.log('\\nC. THIRD ATTEMPT: Sending third request...', phone);
  let req3 = createReq(payload);
  let res3 = createRes();
  await handler(req3, res3);
  console.log('Res 3:', res3.statusCode, res3.jsonData);

  primaryCount = await sql`SELECT count(*) FROM leads WHERE phone = ${phone}`;
  secondaryCount = await dupSql`SELECT count(*) FROM duplicate_leads WHERE phone = ${phone}`;
  console.log(`DB Primary: ${primaryCount[0].count}, DB Secondary: ${secondaryCount[0].count}`);
  
  // D. DUPLICATE DB UNAVAILABLE
  console.log('\\nD. DUPLICATE DB UNAVAILABLE:');
  const backupEnv = process.env.DUPLICATES_DATABASE_URL;
  process.env.DUPLICATES_DATABASE_URL = 'postgresql://wrong:wrong@ep-wrong.aws.neon.tech/wrong';
  
  // Re-insert valid captcha again
  const captchaId4 = crypto.randomUUID();
  const hash4 = hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, captchaId4, captchaAnswer);
  await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${captchaId4}, ${hash4}, ${expiresAt})`;
  payload.captcha_challenge_id = captchaId4;
  
  let req4 = createReq(payload);
  let res4 = createRes();
  await handler(req4, res4);
  console.log('Res 4:', res4.statusCode, res4.jsonData);
  process.env.DUPLICATES_DATABASE_URL = backupEnv;
}

main().catch(console.error);
