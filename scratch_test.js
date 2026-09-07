
import handler from './api/admin/login.js';
import crypto from 'crypto';

const req = {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'origin': 'http://localhost',
    'host': 'localhost',
    'x-forwarded-for': '127.0.0.1',
    'user-agent': 'TestRunner/1.0'
  },
  connection: { remoteAddress: '127.0.0.1' },
  // mock async iterator for request body
  [Symbol.asyncIterator]: async function* () {
    yield Buffer.from(JSON.stringify({ email: process.env.QA_ADMIN_EMAIL, password: process.env.QA_ADMIN_PASSWORD }));
  }
};

const res = {
  setHeader: (k, v) => console.log('SET HEADER:', k, v),
  status: (code) => {
    console.log('STATUS:', code);
    return {
      json: (data) => console.log('JSON:', data)
    };
  }
};

handler(req, res).catch(console.error);

