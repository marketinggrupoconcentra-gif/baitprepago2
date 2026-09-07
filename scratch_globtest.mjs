import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newContext({ extraHTTPHeaders: { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } }).then(c=>c.newPage());
await p.goto(process.env.VERCEL_PREVIEW_URL.replace(/\/$/,'') + '/admin/');
console.log('url after goto:', p.url());
for (const pat of ['**/admin','**/admin/','**/admin/**','**/admin*']) {
  try { await p.waitForURL(pat, { timeout: 2500 }); console.log('MATCH   ', pat); }
  catch { console.log('no match', pat); }
}
await b.close();
