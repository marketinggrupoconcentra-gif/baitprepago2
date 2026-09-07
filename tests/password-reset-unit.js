import { test } from 'node:test';
import assert from 'node:assert';
import requestHandler from '../api/admin/password-reset/request.js';
import confirmHandler from '../api/admin/password-reset/confirm.js';

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    }
  };
  return res;
}

test('Password Reset Request - Rejects missing email', async () => {
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'host': 'localhost',
      'origin': 'http://localhost'
    },
    body: {}
  };
  const res = createMockRes();

  await requestHandler(req, res);
  assert.strictEqual(res.statusCode, 400);
});

test('Password Reset Confirm - Rejects missing password', async () => {
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'host': 'localhost',
      'origin': 'http://localhost'
    },
    body: { token: 'abc' }
  };
  const res = createMockRes();

  await confirmHandler(req, res);
  assert.strictEqual(res.statusCode, 400);
});

test('Password Reset Confirm - Enforces 8 char minimum', async () => {
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'host': 'localhost',
      'origin': 'http://localhost'
    },
    body: { token: 'abc', password: 'short' }
  };
  const res = createMockRes();

  await confirmHandler(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.data.error.includes('8 caracteres'));
});
