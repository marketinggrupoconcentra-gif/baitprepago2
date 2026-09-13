import { describe, test, expect, beforeEach } from 'vitest';
import { evaluateEdge, edgeClientIp } from '../../src/lib/security/edge-guard';
import { __resetEdgeRateLimit, edgeRateLimit } from '../../src/lib/security/edge-rate-limit';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function browserHeaders(ua = CHROME): Headers {
  return new Headers({
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'es-MX',
  });
}

beforeEach(() => __resetEdgeRateLimit());

describe('evaluateEdge — bloqueos', () => {
  test('crawler de IA → block 403 en cualquier ruta', () => {
    const d = evaluateEdge({
      pathname: '/',
      method: 'GET',
      headers: browserHeaders('Mozilla/5.0 (compatible; GPTBot/1.1)'),
      ip: '1.1.1.1',
    });
    expect(d).toEqual({ type: 'block', status: 403, code: 'ai_crawler_blocked' });
  });

  test('herramienta ofensiva → block 403', () => {
    const d = evaluateEdge({
      pathname: '/api/v1/leads',
      method: 'POST',
      headers: browserHeaders('sqlmap/1.7'),
      ip: '1.1.1.2',
    });
    expect(d.type).toBe('block');
    if (d.type === 'block') expect(d.status).toBe(403);
  });

  test('sonda de exploit → block 404', () => {
    const d = evaluateEdge({
      pathname: '/.env',
      method: 'GET',
      headers: browserHeaders(),
      ip: '1.1.1.3',
    });
    expect(d).toEqual({ type: 'block', status: 404, code: 'exploit_probe' });
  });

  test('sonda bajo /api/auth NO se bloquea como probe', () => {
    const d = evaluateEdge({
      pathname: '/api/auth/.well-known/openid-configuration',
      method: 'GET',
      headers: browserHeaders(),
      ip: '1.1.1.4',
    });
    expect(d.type).toBe('allow');
  });
});

describe('evaluateEdge — tráfico legítimo', () => {
  test('navegador en la landing → allow', () => {
    const d = evaluateEdge({ pathname: '/', method: 'GET', headers: browserHeaders(), ip: '2.0.0.1' });
    expect(d).toEqual({ type: 'allow' });
  });

  test('asset estático → allow sin consumir cuota', () => {
    for (let i = 0; i < 500; i++) {
      const d = evaluateEdge({
        pathname: '/assets/brand/logo.svg',
        method: 'GET',
        headers: browserHeaders(),
        ip: '2.0.0.2',
      });
      expect(d.type).toBe('allow');
    }
  });

  test('Googlebot → allow (no throttle agresivo)', () => {
    const d = evaluateEdge({
      pathname: '/',
      method: 'GET',
      headers: browserHeaders('Mozilla/5.0 (compatible; Googlebot/2.1)'),
      ip: '2.0.0.3',
    });
    expect(d.type).toBe('allow');
  });
});

describe('evaluateEdge — throttling', () => {
  test('cliente automatizado (curl) contra /api → throttle tras pocas requests', () => {
    const headers = new Headers({ 'user-agent': 'curl/8.4.0', accept: '*/*' });
    let throttledAt = -1;
    for (let i = 1; i <= 30; i++) {
      const d = evaluateEdge({ pathname: '/api/v1/leads', method: 'POST', headers, ip: '3.0.0.1' });
      if (d.type === 'throttle') {
        throttledAt = i;
        expect(d.code).toBe('suspicious_client_throttled');
        expect(d.retryAfter).toBeGreaterThan(0);
        break;
      }
    }
    expect(throttledAt).toBeGreaterThan(0);
    expect(throttledAt).toBeLessThanOrEqual(13); // EDGE_RL_STRICT default = 12
  });

  test('navegador normal contra /api aguanta más que el bucket strict', () => {
    const headers = browserHeaders();
    for (let i = 0; i < 20; i++) {
      const d = evaluateEdge({ pathname: '/api/v1/leads', method: 'POST', headers, ip: '3.0.0.2' });
      expect(d.type).toBe('allow');
    }
  });

  test('ráfaga de páginas desde una IP → 429 al superar el techo', () => {
    let blocked = false;
    for (let i = 0; i < 300; i++) {
      const d = evaluateEdge({ pathname: '/', method: 'GET', headers: browserHeaders(), ip: '3.0.0.3' });
      if (d.type === 'throttle') {
        blocked = true;
        expect(d.code).toBe('edge_rate_limit');
        break;
      }
    }
    expect(blocked).toBe(true);
  });
});

describe('edgeClientIp', () => {
  test('toma la primera IP de x-forwarded-for', () => {
    expect(edgeClientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }))).toBe('9.9.9.9');
  });
  test('fallback a x-real-ip', () => {
    expect(edgeClientIp(new Headers({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8');
  });
  test('sin cabeceras → unknown', () => {
    expect(edgeClientIp(new Headers())).toBe('unknown');
  });
});

describe('edgeRateLimit', () => {
  test('permite hasta el límite y luego niega', () => {
    for (let i = 1; i <= 3; i++) expect(edgeRateLimit('k', 3, 60).allowed).toBe(true);
    const denied = edgeRateLimit('k', 3, 60);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });
});
