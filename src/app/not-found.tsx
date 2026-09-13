import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: { absolute: 'Página no encontrada · BAIT Prepago' },
  robots: { index: false, follow: true },
};

/**
 * 404 global. Next.js responde con HTTP 404 real para este componente.
 * Ofrece dos salidas: volver a la home y saltar directo al formulario de
 * portabilidad (#formulario en la landing estática).
 */
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: '48px 20px',
        textAlign: 'center',
        background: '#080808',
        color: '#fff',
        fontFamily: "'Manrope', system-ui, -apple-system, sans-serif",
      }}
    >
      <span style={{ font: '700 13px monospace', letterSpacing: '0.14em', color: '#ffd400' }}>ERROR 404</span>
      <h1 style={{ margin: 0, fontSize: 'clamp(26px, 6vw, 40px)', fontWeight: 800, letterSpacing: '-0.03em' }}>
        Esta página no existe
      </h1>
      <p style={{ margin: 0, maxWidth: '46ch', color: '#9a9a9a', fontSize: 15, lineHeight: 1.5 }}>
        El enlace puede estar roto o la página se movió. Puedes volver al inicio o comenzar tu portabilidad a BAIT
        ahora mismo.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 8 }}>
        <Link
          href="/"
          style={{
            background: '#ffd400',
            color: '#080808',
            fontWeight: 700,
            fontSize: 14,
            padding: '12px 22px',
            borderRadius: 10,
            textDecoration: 'none',
          }}
        >
          Volver al inicio
        </Link>
        <Link
          href="/#portability-form-wrapper"
          style={{
            border: '1px solid rgba(255,255,255,0.18)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
            padding: '12px 22px',
            borderRadius: 10,
            textDecoration: 'none',
          }}
        >
          Iniciar portabilidad
        </Link>
      </div>
    </main>
  );
}
