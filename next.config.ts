import type { NextConfig } from "next";

const CANONICAL_HOST = 'baitprepago.com';

// Páginas estáticas de la landing (zona protegida) servidas desde public/legacy/<dir>/index.html.
// Usan rutas relativas (./x.css, ../assets/...), por eso la URL canónica lleva "/" final.
const STATIC_DIRS = ['gracias', 'duplicado', 'aviso-de-privacidad', 'walmart-beneficios'];

const nextConfig: NextConfig = {
  // Sin esto Next normaliza "/gracias/" → "/gracias" y rompen las rutas relativas del HTML estático.
  skipTrailingSlashRedirect: true,

  // SEO: un solo host canónico. www → apex (301). El redirect http→https lo
  // resuelve Vercel automáticamente. /legacy/* es la copia estática servida en
  // la raíz vía rewrite — cualquier acceso directo se colapsa a la URL limpia.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: `www.${CANONICAL_HOST}` }],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: true,
      },
      { source: '/legacy/index.html', destination: '/', permanent: true },
      // "/gracias" → "/gracias/" vive en src/proxy.ts (aquí el matcher ignora la barra final y haría bucle).
      ...STATIC_DIRS.map((dir) => ({ source: `/legacy/${dir}/index.html`, destination: `/${dir}/`, permanent: true })),
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/legacy/index.html' },
      ],
      afterFiles: STATIC_DIRS.flatMap((dir) => [
        { source: `/${dir}/`, destination: `/legacy/${dir}/index.html` },
        { source: `/${dir}/:path*`, destination: `/legacy/${dir}/:path*` },
      ]),
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: '/assets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // El controlador del formulario se versiona por query (?v=) en index.html
        source: '/assets/site.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
