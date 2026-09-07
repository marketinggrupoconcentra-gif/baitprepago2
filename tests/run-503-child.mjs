import handler from '../api/leads.js';

function createReq(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body
  };
}

function createRes(processSend) {
  const res = {
    statusCode: 200,
    jsonData: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { 
      this.jsonData = data; 
      processSend({ statusCode: this.statusCode, jsonData: this.jsonData });
      return this; 
    },
    setHeader(key, value) { return this; }
  };
  return res;
}

process.on('message', async (payload) => {
  let req = createReq(payload);
  let res = createRes(process.send.bind(process));
  try {
    await handler(req, res);
  } catch (err) {
    process.send({ error: err.message });
  }
});
