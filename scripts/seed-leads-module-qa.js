/**
 * scripts/seed-leads-module-qa.js
 * Crea 30-40 leads sintéticos para QA en el entorno Preview.
 * Incluye un RUN_ID único en los UTMs para facilitar el tracking.
 */


const { enforceSafety } = require('./preview-safety');
const { neon } = require('@neondatabase/serverless');

// Generar un RUN_ID basado en timestamp
const RUN_ID = `run_${Date.now()}`;

const SYNTHETIC_PHONES = [
  '0000000001', '0000000002', '0000000003', '0000000004', '0000000005'
];

const SOURCES = ['facebook', 'google', 'direct', 'tiktok'];
const MEDIUMS = ['cpc', 'organic', 'social'];
const CAMPAIGNS = ['summer_promo', 'brand_awareness', 'retargeting'];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function seed() {
  console.log('=== SEED LEADS QA ===');
  enforceSafety();

  const DB_URL = process.env.DATABASE_URL;
  if (!DB_URL) {
    console.error('❌ FAIL CLOSED: DATABASE_URL not set.');
    process.exit(1);
  }

  const sql = neon(DB_URL);
  const leadsToInsert = [];
  const numLeads = 35; // Entre 30 y 40

  const now = new Date();
  const past30Days = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

  for (let i = 0; i < numLeads; i++) {
    leadsToInsert.push({
      phone: SYNTHETIC_PHONES[i % SYNTHETIC_PHONES.length],
      utm_source: randomElement(SOURCES),
      utm_medium: randomElement(MEDIUMS),
      utm_campaign: `${randomElement(CAMPAIGNS)}_${RUN_ID}`,
      utm_content: 'test_content',
      utm_term: 'test_term',
      fbclid: `test_fbclid_${i}`,
      fb_ad_id: `ad_${i}`,
      fb_adset_id: `adset_${i}`,
      fb_campaign_id: `camp_${i}`,
      ip: '127.0.0.1', // Sintético
      user_agent: 'QA-Bot/1.0',
      referrer: 'https://qa.invalid/referrer',
      page_url: 'https://qa.invalid/landing',
      created_at: randomDate(past30Days, now).toISOString()
    });
  }

  // Ordenar por created_at de más viejo a más nuevo para que los IDs y created_at estén correlacionados lógicamente (aunque el bulk insert de neon a veces inserta en orden de array)
  leadsToInsert.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  console.log(`Generando ${numLeads} leads sintéticos... (RUN_ID: ${RUN_ID})`);

  try {
    for (const lead of leadsToInsert) {
      await sql`
        INSERT INTO leads (
          phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          fbclid, fb_ad_id, fb_adset_id, fb_campaign_id,
          ip, user_agent, referrer, page_url, created_at
        ) VALUES (
          ${lead.phone}, ${lead.utm_source}, ${lead.utm_medium}, ${lead.utm_campaign}, ${lead.utm_content}, ${lead.utm_term},
          ${lead.fbclid}, ${lead.fb_ad_id}, ${lead.fb_adset_id}, ${lead.fb_campaign_id},
          ${lead.ip}, ${lead.user_agent}, ${lead.referrer}, ${lead.page_url}, ${lead.created_at}
        )
      `;
    }
    console.log('✅ Leads sintéticos insertados con éxito.');
  } catch (err) {
    console.error('❌ Error insertando leads:', err);
    process.exit(1);
  }
}

seed();
