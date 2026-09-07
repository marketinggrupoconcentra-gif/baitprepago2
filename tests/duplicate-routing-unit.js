import test from 'node:test';
import assert from 'node:assert';

// Set dummy env vars for the DB and CAPTCHA
process.env.DATABASE_URL = 'postgresql://fake:fake@ep-fake.us-east-2.aws.neon.tech/neondb';
process.env.DUPLICATES_DATABASE_URL = 'postgresql://fake:fake@ep-fake.us-east-2.aws.neon.tech/duplicates';
process.env.CAPTCHA_PEPPER = 'test_pepper';

import crypto from 'node:crypto';
function hashCaptchaAnswer(pepper, challengeId, answer) {
  return crypto.createHmac('sha256', pepper).update(`${challengeId}:${answer}`).digest('hex');
}

// Override global.fetch to mock Neon Serverless HTTP API
const originalFetch = global.fetch;
let mockNeonResponses = [];
let fetchCalls = [];

global.fetch = async (url, options) => {
  if (url.toString().includes('.neon.tech/sql')) {
    fetchCalls.push({ url, options });
    const responseBody = mockNeonResponses.shift() || { rows: [{}] };
    return {
      ok: true,
      status: 200,
      json: async () => responseBody
    };
  }
  return originalFetch(url, options);
};

// We can now import the handler. Because DB singleton might be created, we must ensure it uses the fake URL.
import handler from '../api/leads.js';

test('Duplicate Lead Routing - Neon HTTP Mock', async (t) => {

  const createReq = (body) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body
  });

  const createRes = () => {
    const res = {
      statusCode: 200,
      jsonData: null,
      setHeader(k, v) { return this; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.jsonData = data; return this; }
    };
    return res;
  };

  t.beforeEach(() => {
    fetchCalls = [];
    mockNeonResponses = [];
  });

  const generateCaptchaMock = (challengeId, answer) => {
    const hash = hashCaptchaAnswer('test_pepper', challengeId, answer);
    const expiresAt = new Date(Date.now() + 10000).toISOString();
    return [
      {
        fields: [{name: 'id', dataTypeID: 25}, {name: 'answer_hash', dataTypeID: 25}, {name: 'expires_at', dataTypeID: 25}, {name: 'used_at', dataTypeID: 25}],
        rows: [[challengeId, hash, expiresAt, null]]
      },
      {
        fields: [{name: 'id', dataTypeID: 25}],
        rows: [[challengeId]]
      }
    ];
  };

  await t.test('1. Valid payload - New lead (201)', async () => {
    // CAPTCHA verification response
    mockNeonResponses.push(...generateCaptchaMock('abc', '123456'));
    
    // Rate limit check
    mockNeonResponses.push({ fields: [{name: 'count', dataTypeID: 20}], rows: [['0']] });
    
    // Pre-check for duplicate
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [] });
    
    // Insert new lead
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [['100']] });
    
    const req = createReq({
      phone: '5511223344',
      nip: '1234',
      email: 'test@test.com',
      consent: true,
      captcha_challenge_id: 'abc',
      captcha_answer: '123456'
    });
    const res = createRes();
    
    await handler(req, res);
    
    if (res.statusCode === 422) console.log(res.jsonData.details);
    
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.jsonData.ok, true);
    assert.strictEqual(res.jsonData.saved, true);
  });

  await t.test('2. Duplicate payload - Existing lead triggers 409', async () => {
    // CAPTCHA verification response
    mockNeonResponses.push(...generateCaptchaMock('abc', '123456'));
    
    // Rate limit check
    mockNeonResponses.push({ fields: [{name: 'count', dataTypeID: 20}], rows: [['0']] });
    
    // Pre-check for duplicate (Finds it!)
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [['100']] });
    
    // Insert into duplicates DB
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [['999']] });
    
    const req = createReq({
      phone: '5511223344',
      nip: '1234',
      email: 'test@test.com',
      consent: true,
      captcha_challenge_id: 'abc',
      captcha_answer: '123456'
    });
    const res = createRes();
    
    await handler(req, res);
    
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.jsonData.ok, false);
    assert.strictEqual(res.jsonData.error, 'duplicate_lead');
    assert.strictEqual(res.jsonData.code, 'PHONE_ALREADY_REGISTERED');
  });

  await t.test('3. Concurrent Request - Duplicate during INSERT', async () => {
    // CAPTCHA verification response
    mockNeonResponses.push(...generateCaptchaMock('abc', '123456'));
    
    // Rate limit check
    mockNeonResponses.push({ fields: [{name: 'count', dataTypeID: 20}], rows: [['0']] });
    
    // Pre-check for duplicate (Does NOT find it)
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [] });
    
    // Insert into leads (Returns empty array due to DO NOTHING)
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [] }); 

    // Concurrent existing lookup
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [['100']] });

    // Insert into duplicates DB
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [['999']] }); 
    
    const req = createReq({
      phone: '5511223344',
      nip: '1234',
      email: 'test@test.com',
      consent: true,
      captcha_challenge_id: 'abc',
      captcha_answer: '123456'
    });
    const res = createRes();
    
    await handler(req, res);
    
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.jsonData.ok, false);
    assert.strictEqual(res.jsonData.error, 'duplicate_lead');
  });
  
  await t.test('4. Secondary DB Failure - Fail closed (503)', async () => {
    // CAPTCHA verification response
    mockNeonResponses.push(...generateCaptchaMock('abc', '123456'));
    
    // Rate limit check
    mockNeonResponses.push({ fields: [{name: 'count', dataTypeID: 20}], rows: [['0']] });
    
    // Pre-check for duplicate (Finds it!)
    mockNeonResponses.push({ fields: [{name: 'id', dataTypeID: 20}], rows: [['100']] });
    
    // Simulate Duplicate DB failure
    global.fetch = async (url, options) => {
      if (options.body && options.body.includes('duplicate_leads')) {
        throw new Error('Connection refused');
      }
      if (url.toString().includes('.neon.tech/sql')) {
        const responseBody = mockNeonResponses.shift() || { fields: [], rows: [] };
        return { ok: true, status: 200, json: async () => responseBody };
      }
      return originalFetch(url, options);
    };
    
    const req = createReq({
      phone: '5511223344',
      nip: '1234',
      email: 'test@test.com',
      consent: true,
      captcha_challenge_id: 'abc',
      captcha_answer: '123456'
    });
    const res = createRes();
    
    await handler(req, res);
    
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.jsonData.error, 'Service temporarily unavailable');
    
    // Restore fetch
    global.fetch = async (url, options) => {
      if (url.toString().includes('.neon.tech/sql')) {
        fetchCalls.push({ url, options });
        const responseBody = mockNeonResponses.shift() || { result: [{}] };
        return { ok: true, status: 200, json: async () => responseBody };
      }
      return originalFetch(url, options);
    };
  });
});
