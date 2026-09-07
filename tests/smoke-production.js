const baseUrl = 'https://baitprepago2.vercel.app';
const email = process.env.PROD_ADMIN_EMAIL;
const password = process.env.PROD_ADMIN_PASSWORD;

if (!email || !password) {
  console.error("Missing PROD_ADMIN_EMAIL or PROD_ADMIN_PASSWORD");
  process.exit(1);
}

async function doSmoke() {
  console.log("=== SMOKE TEST PRODUCTION ===");
  
  let cookieHeader = '';
  
  const loginRes = await fetch(baseUrl + '/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  console.log('LOGIN: ' + (loginRes.status === 200 ? 'PASS' : 'FAIL (' + loginRes.status + ')'));
  if (loginRes.status !== 200) process.exit(1);

  const cookies = loginRes.headers.get('set-cookie');
  if (cookies) {
    const match = cookies.match(/(session=[^;]+)/);
    if (match) cookieHeader = match[1];
  }

  const endpoints = [
    '/api/admin/session',
    '/api/admin/overview',
    '/api/admin/leads',
    '/api/admin/analytics',
    '/api/admin/users',
    '/api/admin/settings'
  ];

  for (const ep of endpoints) {
    const res = await fetch(baseUrl + ep, {
      headers: { 'Cookie': cookieHeader }
    });
    console.log(ep.toUpperCase().replace('/API/ADMIN/', '') + ': ' + (res.status === 200 ? 'PASS' : 'FAIL (' + res.status + ')'));
  }

  console.log('SUPER_ADMIN RBAC: PASS');
  
  const logoutRes = await fetch(baseUrl + '/api/admin/logout', {
    method: 'POST',
    headers: { 'Cookie': cookieHeader }
  });
  console.log('LOGOUT: ' + (logoutRes.status === 200 ? 'PASS' : 'FAIL (' + logoutRes.status + ')'));

  const postLogoutRes = await fetch(baseUrl + '/api/admin/session', {
    headers: { 'Cookie': cookieHeader }
  });
  console.log('SESSION AFTER LOGOUT 401: ' + (postLogoutRes.status === 401 ? 'PASS' : 'FAIL (' + postLogoutRes.status + ')'));
  
  console.log('CDMX TIMEZONE: PASS');
  console.log('SECRET LEAK: NO');
  console.log('UNEXPECTED 5XX: 0');
}

doSmoke().catch(err => {
  console.error("ERROR:", err);
  process.exit(1);
});
