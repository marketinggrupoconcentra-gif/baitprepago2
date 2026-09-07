import { neon } from '@neondatabase/serverless';
import handler from '../api/leads.js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fork } from 'child_process';
import path from 'path';

// Load variables if running locally, without overriding process.env if already set
dotenv.config({ path: '.env.branch' });

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`✅ ${message}`);
}

const sql = neon(process.env.DATABASE_URL);
const dupSql = neon(process.env.DUPLICATES_DATABASE_URL);

// Fixtures to clean up
const createdPhones = [];
const createdCaptchas = [];

async function insertCaptcha(captchaAnswer) {
  const captchaId = crypto.randomUUID();
  const hash = hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, captchaId, captchaAnswer);
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${captchaId}, ${hash}, ${expiresAt})`;
  createdCaptchas.push(captchaId);
  return captchaId;
}

async function cleanupFixtures() {
  console.log('\n🧹 Cleaning up fixtures...');
  for (const phone of createdPhones) {
    await sql`DELETE FROM leads WHERE phone = ${phone}`;
    await dupSql`DELETE FROM duplicate_leads WHERE phone = ${phone}`;
  }
  for (const captchaId of createdCaptchas) {
    await sql`DELETE FROM captcha_challenges WHERE id = ${captchaId}`;
  }
  console.log('✅ Cleanup complete.');
}

async function runChildProcessFor503(payload) {
  return new Promise((resolve, reject) => {
    // Create a temporary script to test 503
    const child = fork('./tests/run-503-child.mjs', [], {
      env: {
        ...process.env,
        DUPLICATES_DATABASE_URL: 'postgresql://wrong:wrong@ep-jolly-bread-avsqkawa.us-east-2.aws.neon.tech/baitprepago_duplicates'
      }
    });
    
    child.send(payload);
    
    child.on('message', (msg) => {
      resolve(msg);
      child.kill();
    });
    
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error('Child process exited with code ' + code));
    });
  });
}

async function main() {
  const phone = '55' + Math.floor(10000000 + Math.random() * 90000000).toString();
  createdPhones.push(phone);
  
  const captchaAnswer = '123456';
  
  const payload = {
    phone,
    nip: phone.slice(-4),
    nip_valid_until: new Date().toISOString().split('T')[0],
    email: 'test' + Date.now() + '@integration.test',
    consent: true,
    captcha_answer: captchaAnswer
  };

  try {
    // A. First Request (201)
    console.log(`\nA. NEW LEAD: Sending first request... (${phone})`);
    payload.captcha_challenge_id = await insertCaptcha(captchaAnswer);
    let req1 = createReq(payload);
    let res1 = createRes();
    await handler(req1, res1);
    
    assert(res1.statusCode === 201, `Status code is 201 (got ${res1.statusCode})`);
    
    let primaryCount = await sql`SELECT count(*) FROM leads WHERE phone = ${phone}`;
    let secondaryCount = await dupSql`SELECT count(*) FROM duplicate_leads WHERE phone = ${phone}`;
    assert(parseInt(primaryCount[0].count) === 1, `Primary DB count is 1 (got ${primaryCount[0].count})`);
    assert(parseInt(secondaryCount[0].count) === 0, `Secondary DB count is 0 (got ${secondaryCount[0].count})`);

    // B. Second Request (409)
    console.log(`\nB. DUPLICATE: Sending second request... (${phone})`);
    payload.captcha_challenge_id = await insertCaptcha(captchaAnswer);
    let req2 = createReq(payload);
    let res2 = createRes();
    await handler(req2, res2);
    
    assert(res2.statusCode === 409, `Status code is 409 (got ${res2.statusCode})`);
    
    primaryCount = await sql`SELECT count(*) FROM leads WHERE phone = ${phone}`;
    secondaryCount = await dupSql`SELECT count(*) FROM duplicate_leads WHERE phone = ${phone}`;
    assert(parseInt(primaryCount[0].count) === 1, `Primary DB count is 1 (got ${primaryCount[0].count})`);
    assert(parseInt(secondaryCount[0].count) === 1, `Secondary DB count is 1 (got ${secondaryCount[0].count})`);

    // C. Third Request (409 again)
    console.log(`\nC. THIRD ATTEMPT: Sending third request... (${phone})`);
    payload.captcha_challenge_id = await insertCaptcha(captchaAnswer);
    let req3 = createReq(payload);
    let res3 = createRes();
    await handler(req3, res3);
    
    assert(res3.statusCode === 409, `Status code is 409 (got ${res3.statusCode})`);
    
    primaryCount = await sql`SELECT count(*) FROM leads WHERE phone = ${phone}`;
    secondaryCount = await dupSql`SELECT count(*) FROM duplicate_leads WHERE phone = ${phone}`;
    assert(parseInt(primaryCount[0].count) === 1, `Primary DB count is 1 (got ${primaryCount[0].count})`);
    assert(parseInt(secondaryCount[0].count) === 2, `Secondary DB count is 2 (got ${secondaryCount[0].count})`);

    // D. 503 test (invalid URL from the start in child process)
    console.log(`\nD. 503 UNAVAILABLE: Secondary DB offline... (${phone})`);
    payload.captcha_challenge_id = await insertCaptcha(captchaAnswer);
    const result503 = await runChildProcessFor503(payload);
    assert(result503.statusCode === 503, `Status code is 503 (got ${result503.statusCode})`);
    
    console.log('\n🎉 All integration assertions passed!');
    
  } finally {
    await cleanupFixtures();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
