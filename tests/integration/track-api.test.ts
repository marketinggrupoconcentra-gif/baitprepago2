import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, schema } from '@/db/index';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

// Aislamiento test ≠ prod: la ruta usa getDb() → APP_DATABASE_URL. Se fuerza a la
// rama Neon de test ANTES de importar el módulo (falla cerrado si no existe).
const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('[CONFIG FAILURE] TEST_DATABASE_URL required (rama Neon de test)');
process.env.APP_DATABASE_URL = TEST_URL;
delete process.env.DATABASE_URL;

describe('Real API /track Endpoint (FLW-008)', () => {
  let POST: (req: NextRequest) => Promise<Response>;
  
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOWED_ORIGINS', 'https://portabilidadbait.com,https://www.portabilidadbait.com');
    
    const mod = await import('@/app/api/track/route');
    POST = mod.POST;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects request from invalid origin in production', async () => {
    const req = new NextRequest('http://localhost/api/track', {
      method: 'POST',
      headers: {
        'Origin': 'https://malicious-domain.com'
      },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        eventName: 'page_view',
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Origen no permitido');
  });

  it('accepts request from allowed origin', async () => {
    const db = getDb();
    const eventId = crypto.randomUUID();
    const req = new NextRequest('http://localhost/api/track', {
      method: 'POST',
      headers: {
        'Origin': 'https://portabilidadbait.com'
      },
      body: JSON.stringify({
        eventId,
        sessionId: crypto.randomUUID(),
        eventName: 'page_view',
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify it was saved
    const saved = await db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, eventId));
    expect(saved.length).toBe(1);
  });

  it('rejects server-only events (lead_success)', async () => {
    const req = new NextRequest('http://localhost/api/track', {
      method: 'POST',
      headers: {
        'Origin': 'https://portabilidadbait.com'
      },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        eventName: 'lead_success',
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Evento no permitido desde cliente');
  });

  it('deduplicates identical eventIds', async () => {
    const db = getDb();
    const eventId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const payload = JSON.stringify({
      eventId,
      sessionId,
      eventName: 'cta_click',
    });

    const req1 = new NextRequest('http://localhost/api/track', {
      method: 'POST',
      headers: { 'Origin': 'https://portabilidadbait.com' },
      body: payload
    });

    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    const req2 = new NextRequest('http://localhost/api/track', {
      method: 'POST',
      headers: { 'Origin': 'https://portabilidadbait.com' },
      body: payload
    });

    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    
    const saved = await db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, eventId));
    expect(saved.length).toBe(1);
  });
});
