/**
 * src/lib/security/bot-signatures.ts
 *
 * Firmas de bots / scrapers / herramientas de ataque. Módulo PURO:
 *   - sin dependencias de Node ni de `server-only`
 *   - seguro de importar tanto desde el edge (`proxy.ts`) como desde route handlers
 *
 * Estas listas NO son un control de seguridad definitivo (un User-Agent se
 * falsifica trivialmente). Son una capa barata que corta el ruido evidente:
 * crawlers de IA, scanners ofensivos y clientes de scripting.
 */

export type UaClass =
  | 'ai-crawler'      // crawlers de IA / entrenamiento de modelos  → política: bloquear
  | 'malicious-tool'  // scanners ofensivos (sqlmap, nikto, …)       → bloquear
  | 'automation'      // clientes de scripting (curl, scrapy, …)     → throttle agresivo
  | 'search-bot'      // buscadores / unfurlers legítimos            → permitir (SEO)
  | 'unknown';        // navegador real o UA no catalogado

/** Crawlers de IA / scraping para entrenamiento. Se bloquean por política. */
const AI_CRAWLERS = [
  'gptbot', 'oai-searchbot', 'chatgpt-user', 'ccbot', 'claudebot', 'claude-web',
  'anthropic-ai', 'google-extended', 'perplexitybot', 'perplexity-user', 'amazonbot',
  'bytespider', 'youbot', 'diffbot', 'imagesiftbot', 'omgili', 'omgilibot',
  'facebookbot', 'meta-externalagent', 'meta-externalfetcher', 'applebot-extended',
  'cohere-ai', 'timpibot', 'webzio-extended', 'petalbot', 'ai2bot', 'scrapy',
  'dataforseobot', 'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot', 'brightbot',
];

/** Herramientas ofensivas de reconocimiento / explotación. */
const MALICIOUS_TOOLS = [
  'sqlmap', 'nikto', 'nmap', 'masscan', 'zgrab', 'nuclei', 'dirbuster', 'gobuster',
  'feroxbuster', 'wpscan', 'acunetix', 'nessus', 'metasploit', 'hydra', 'havij',
  'arachni', 'openvas', 'w3af', 'skipfish', 'wapiti', 'commix', 'xsser',
];

/** Clientes HTTP de scripting / navegadores headless de scraping. */
const AUTOMATION = [
  'curl/', 'curl ', 'wget/', 'wget ', 'python-requests', 'python-urllib', 'python-httpx',
  'aiohttp', 'httpx/', 'go-http-client', 'okhttp', 'java/', 'apache-httpclient',
  'axios/', 'node-fetch', 'undici', 'got/', 'libwww-perl', 'lwp::simple', 'httpie/',
  'restsharp', 'httpclient', 'winhttp', 'phantomjs', 'headlesschrome', 'headless',
  'puppeteer', 'playwright', 'selenium', 'httrack', 'wget', 'mechanize', 'guzzlehttp',
  'postmanruntime', 'insomnia', 'colly', 'jsdom',
];

/** Buscadores y unfurlers de mensajería legítimos. Se permiten (SEO / previews). */
const SEARCH_BOTS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot',
  'applebot', 'facebookexternalhit', 'twitterbot', 'linkedinbot', 'slackbot',
  'whatsapp', 'telegrambot', 'discordbot', 'pinterestbot', 'redditbot',
  'google-inspectiontool', 'google-site-verification', 'chrome-lighthouse',
];

/**
 * Clasifica un User-Agent. El orden importa:
 *   ai-crawler > malicious-tool > search-bot > automation
 * (p.ej. `applebot-extended` es IA aunque contenga `applebot`).
 */
export function classifyUserAgent(uaRaw: string | null | undefined): UaClass {
  const ua = (uaRaw ?? '').toLowerCase();
  if (!ua) return 'unknown';
  if (AI_CRAWLERS.some((s) => ua.includes(s))) return 'ai-crawler';
  if (MALICIOUS_TOOLS.some((s) => ua.includes(s))) return 'malicious-tool';
  if (SEARCH_BOTS.some((s) => ua.includes(s))) return 'search-bot';
  if (AUTOMATION.some((s) => ua.includes(s))) return 'automation';
  return 'unknown';
}

// ── Sondas de explotación / rutas de secretos ───────────────────────────────
// Rutas que NO tienen ningún uso legítimo en esta app. Coincidir → 404.
// NB: nunca aplicar bajo `/api/auth` (Neon Auth usa `.well-known/*`).
const EXPLOIT_PATH_RE = new RegExp(
  [
    '(^|/)\\.(env|git|svn|hg|aws|ssh|htpasswd|htaccess|ds_store)([./]|$)',
    '(^|/)(wp-admin|wp-login\\.php|wp-content|wp-includes|xmlrpc\\.php)(/|$)',
    '(^|/)(phpmyadmin|pma|adminer|adminer\\.php|dbadmin|mysql)(/|$)',
    '(^|/)(cgi-bin|boaform|owa|autodiscover\\.xml)(/|$)',
    '(^|/)vendor/(phpunit|composer)',
    '(^|/)(eval-stdin\\.php|shell\\.php|c99\\.php|wso\\.php)(/|$)',
    '(^|/)(id_rsa|credentials|secrets?\\.ya?ml|\\.npmrc|\\.dockercfg)(/|$)',
    '\\.(bak|old|sql|sql\\.gz|swp|tar\\.gz|zip|7z|rdb)$',
  ].join('|'),
  'i',
);

export function isExploitProbe(pathname: string): boolean {
  return EXPLOIT_PATH_RE.test(pathname);
}

// ── Recursos estáticos ──────────────────────────────────────────────────────
// Una sola vista carga decenas de assets. Detectarlos para NO consumir cuota
// de rate-limit por cada archivo.
const STATIC_EXT_RE =
  /\.(?:css|js|mjs|cjs|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|ogg|txt|xml|json|webmanifest|pdf)$/i;

export function looksStatic(pathname: string): boolean {
  return STATIC_EXT_RE.test(pathname);
}

// ── Heurística de cabeceras ─────────────────────────────────────────────────
/**
 * `true` si las cabeceras parecen de una herramienta automatizada
 * (sin UA, sin Accept-Language, Accept no-browser). Sólo como desempate
 * para tráfico contra `/api`.
 */
export function hasBotishHeaders(h: Headers): boolean {
  const ua = h.get('user-agent');
  const accept = h.get('accept') ?? '';
  const lang = h.get('accept-language');

  let score = 0;
  if (!ua) score += 2;
  if (!lang) score += 1;
  if (!accept || (!accept.includes('text/html') && !accept.includes('*/*') && !accept.includes('application/json'))) {
    score += 1;
  }
  return score >= 3;
}
