export async function checkRateLimitAndIdempotency(sql, ip, phone) {
  // Simple rate limiting: block if the same IP has created > 10 leads in the last hour
  // Simple idempotency: block if the same phone was submitted in the last 15 minutes
  
  const [ipCountRes, phoneCountRes] = await Promise.all([
    sql`SELECT count(*) as count FROM leads WHERE ip = ${ip} AND created_at > NOW() - INTERVAL '1 hour'`,
    sql`SELECT count(*) as count FROM leads WHERE phone = ${phone} AND created_at > NOW() - INTERVAL '15 minutes'`
  ]);

  const ipCount = parseInt(ipCountRes[0].count, 10);
  const phoneCount = parseInt(phoneCountRes[0].count, 10);

  if (ipCount > 10) {
    return { allowed: false, reason: 'rate_limit' };
  }
  
  if (phoneCount > 0) {
    return { allowed: false, reason: 'idempotent' };
  }

  return { allowed: true };
}
