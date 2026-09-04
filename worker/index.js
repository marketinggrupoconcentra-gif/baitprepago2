function assetRequest(request, pathname) {
  var url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url.toString(), request);
}

function withSecurityHeaders(response, hostname) {
  var safeResponse = new Response(response.body, response);
  safeResponse.headers.set('X-Content-Type-Options', 'nosniff');
  safeResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  safeResponse.headers.set('X-Frame-Options', 'SAMEORIGIN');
  if (hostname === 'baitprepago2.vercel.app') {
    safeResponse.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return safeResponse;
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var pathname = url.pathname;
    var assetPath = pathname;

    if (pathname === '/') assetPath = '/index.html';
    if (pathname === '/walmart-beneficios' || pathname === '/walmart-beneficios/') {
      assetPath = '/walmart-beneficios/index.html';
    }

    var response = await env.ASSETS.fetch(assetRequest(request, assetPath));
    return withSecurityHeaders(response, url.hostname);
  }
};
