import { describe, test, expect } from 'vitest';
import {
  classifyUserAgent,
  isExploitProbe,
  looksStatic,
  hasBotishHeaders,
} from '../../src/lib/security/bot-signatures';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

describe('classifyUserAgent', () => {
  test.each([
    ['Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)', 'ai-crawler'],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ai-crawler'],
    ['CCBot/2.0 (https://commoncrawl.org/faq/)', 'ai-crawler'],
    ['Mozilla/5.0 (compatible; PerplexityBot/1.0)', 'ai-crawler'],
    ['Mozilla/5.0 (compatible; Applebot-Extended/0.1)', 'ai-crawler'],
    ['sqlmap/1.7#stable (https://sqlmap.org)', 'malicious-tool'],
    ['Nikto/2.5.0', 'malicious-tool'],
    ['curl/8.4.0', 'automation'],
    ['python-requests/2.31.0', 'automation'],
    ['Scrapy/2.11 (+https://scrapy.org)', 'ai-crawler'], // scrapy listado como scraper
    ['Go-http-client/1.1', 'automation'],
    ['node-fetch/1.0 (+https://github.com/bitinn/node-fetch)', 'automation'],
    ['Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/124.0', 'automation'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'search-bot'],
    ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'search-bot'],
    ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'search-bot'],
    [CHROME, 'unknown'],
    [SAFARI_IOS, 'unknown'],
    ['', 'unknown'],
    [null, 'unknown'],
  ])('%s → %s', (ua, expected) => {
    expect(classifyUserAgent(ua as string | null)).toBe(expected);
  });

  test('applebot (sin -extended) NO es ai-crawler', () => {
    expect(classifyUserAgent('Mozilla/5.0 (compatible; Applebot/0.1)')).toBe('search-bot');
  });
});

describe('isExploitProbe', () => {
  test.each([
    '/.env',
    '/.env.local',
    '/wp-login.php',
    '/wp-admin/',
    '/xmlrpc.php',
    '/phpmyadmin/index.php',
    '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
    '/.git/config',
    '/backup.sql',
    '/app.tar.gz',
    '/.aws/credentials',
  ])('%s → probe', (p) => {
    expect(isExploitProbe(p)).toBe(true);
  });

  test.each([
    '/',
    '/admin/login',
    '/api/v1/leads',
    '/api/auth/.well-known/jwks.json',
    '/gracias',
    '/assets/brand/logo.svg',
    '/environment', // no debe confundir con .env
  ])('%s → no probe', (p) => {
    expect(isExploitProbe(p)).toBe(false);
  });
});

describe('looksStatic', () => {
  test.each(['/assets/x.svg', '/a/b/c.PNG', '/main.js', '/style.css', '/f.woff2', '/robots.txt'])(
    '%s → static',
    (p) => expect(looksStatic(p)).toBe(true),
  );
  test.each(['/', '/admin', '/api/v1/leads', '/gracias'])('%s → not static', (p) =>
    expect(looksStatic(p)).toBe(false),
  );
});

describe('hasBotishHeaders', () => {
  test('navegador real → false', () => {
    const h = new Headers({
      'user-agent': CHROME,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'es-MX,es;q=0.9',
    });
    expect(hasBotishHeaders(h)).toBe(false);
  });

  test('sin UA ni accept-language → true', () => {
    expect(hasBotishHeaders(new Headers({ accept: 'application/json' }))).toBe(true);
  });

  test('cliente JSON con UA y lang → false', () => {
    const h = new Headers({
      'user-agent': 'MiApp/1.0',
      accept: 'application/json',
      'accept-language': 'es',
    });
    expect(hasBotishHeaders(h)).toBe(false);
  });
});
