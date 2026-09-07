export async function checkRateLimit(sql, ip) {
  // Simple rate limiting: block if the same IP has created > 10 leads in the last hour
  
  const ipCountRes = await sql`SELECT count(*) as count FROM leads WHERE ip = ${ip} AND created_at > NOW() - INTERVAL '1 hour'`;

  const ipCount = parseInt(ipCountRes[0].count, 10);

  if (ipCount > 10) {
    return { allowed: false, reason: 'rate_limit' };
  }

  return { allowed: true };
}
