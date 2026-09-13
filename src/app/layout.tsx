import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { TrackingProvider } from '@/components/TrackingProvider';

// El proxy publica un nonce CSP por request. Leerlo aquí fuerza render dinámico
// y permite que Next.js firme sus scripts inline con ese nonce (CSP sin unsafe-inline).
export const dynamic = 'force-dynamic';

// La landing pública ("/" y "/gracias") se sirve como HTML estático
// (public/legacy/*) vía rewrite y trae sus PROPIOS metadatos SEO. TODO lo que
// Next.js renderiza bajo este layout es /admin y /api → noindex por defecto.
// El proxy también fija `X-Robots-Tag: noindex` (defensa en profundidad).
export const metadata: Metadata = {
  title: { default: 'Panel administrativo', template: '%s · BAIT Prepago' },
  description: 'Panel interno de BAIT Prepago.',
  metadataBase: new URL(process.env.APP_URL ?? 'https://baitprepago.com'),
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="es-MX">
      <head>
        <meta name="theme-color" content="#ffd400" />
        <link rel="icon" href="/assets/images/logo-bait-user.png" type="image/png" />
        {/*
          Analítica / píxeles: NO van aquí como <script> crudo — en RSC no se
          ejecutan al navegar en cliente y React 19 lanza error de consola.
          · La landing pública ("/" y "/gracias") es HTML estático y carga
            GTM/GA4/Meta ella sola vía public/assets/js/bait-analytics.js +
            GET /api/analytics/config (leído de NEXT_PUBLIC_GTM_ID / _GA4_ID / …).
          · Las rutas React (este layout = solo /admin y /api) las gestiona
            <TrackingProvider>, que inyecta los scripts client-side con nonce.
          Marketing fija NEXT_PUBLIC_GTM_ID / NEXT_PUBLIC_GA4_ID y los píxeles
          en Vercel o en /admin/settings (app.settings).
        */}
      </head>
      <body>
        <TrackingProvider nonce={nonce}>
          {children}
        </TrackingProvider>
      </body>
    </html>
  );
}
