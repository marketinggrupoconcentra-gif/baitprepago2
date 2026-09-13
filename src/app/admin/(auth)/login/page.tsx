/**
 * src/app/admin/(auth)/login/page.tsx
 *
 * Login del Admin Console. Referencia visual: "Iniciar Sesión Bait Dark.dc.html"
 * (split-screen: panel oscuro editorial + panel claro con formulario).
 * Auth: Neon Auth managed vía authClient.signIn.email.
 */
'use client';

import { useState, useSyncExternalStore } from 'react';
import { authClient } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const noopSubscribe = () => () => {};
/** true sólo tras hidratar en cliente — evita submit nativo pre-hidratación. */
function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const ACCENT = 'oklch(84% 0.19 97)';

export default function AdminLoginPage() {
  const router = useRouter();
  const mounted = useHydrated();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [spot, setSpot] = useState({ x: 50, y: 50 });
  const [hover, setHover] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
      if (result.error) {
        setError('Credenciales incorrectas. Verifica tu correo y contraseña.');
        return;
      }
      const next = new URLSearchParams(window.location.search).get('next');
      const dest = next && next.startsWith('/admin') ? next : '/admin/dashboard';
      router.push(dest);
      router.refresh();
    } catch {
      setError('Credenciales incorrectas. Verifica tu correo y contraseña.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap', background: '#0a0a0a' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        @keyframes lineGrow { from { width:0; } to { width:64px; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes gridPan { 0% { background-position:0 0; } 100% { background-position:64px 64px; } }
        @keyframes spin { to { transform:rotate(360deg); } }
        .login-underline { width:100%; padding:8px 0; border:none; border-bottom:1.5px solid oklch(75% 0 0); border-radius:0; font-size:15px; color:#0a0a0a; background:transparent; outline:none; transition:border-color .2s ease; font-family:inherit; }
        .login-underline::placeholder { color:oklch(60% 0 0); }
        .login-underline:focus { border-bottom-color:#0a0a0a; }
        .login-forgot { font-size:12px; color:#0a0a0a; }
        .login-forgot:hover { color:oklch(50% 0.19 97); }
      `}</style>

      {/* ── Panel izquierdo (editorial, oscuro) ── */}
      <div
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setSpot({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        style={{
          flex: '1 1 480px', minHeight: 480, position: 'relative', overflow: 'hidden',
          padding: '56px 56px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          background: '#0a0a0a', fontFamily: "'Manrope', system-ui, sans-serif",
        }}
      >
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.6,
          backgroundImage:
            'linear-gradient(oklch(18% 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(18% 0 0) 1px, transparent 1px)',
          backgroundSize: '64px 64px', animation: 'gridPan 12s linear infinite',
        }} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', transition: 'background .15s ease-out',
          background: `radial-gradient(600px circle at ${spot.x}% ${spot.y}%, oklch(84% 0.19 97 / 0.16), transparent 60%)`,
        }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/bait-logo.svg"
          alt=""
          style={{
            position: 'absolute', right: '-8%', bottom: '-12%', width: '56%', minWidth: 320,
            filter: 'brightness(0) invert(1)', opacity: 0.16, transform: 'rotate(-6deg)',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 440 }}>
          <span style={{
            display: 'block', width: 64, height: 3, background: ACCENT, marginBottom: 22,
            animation: 'lineGrow 1s cubic-bezier(.16,1,.3,1) .2s both',
          }} />
          <h1 style={{
            fontSize: 'clamp(28px,4vw,40px)', lineHeight: 1.15, fontWeight: 900, color: '#fff',
            margin: '0 0 18px', letterSpacing: '-0.02em',
            animation: 'fadeUp .7s cubic-bezier(.16,1,.3,1) .1s both',
          }}>
            Cada visita a tu landing, convertida en oportunidad.
          </h1>
          <p style={{
            fontSize: 14.5, lineHeight: 1.6, color: 'oklch(62% 0 0)', margin: 0, maxWidth: 360,
            animation: 'fadeUp .7s cubic-bezier(.16,1,.3,1) .25s both',
          }}>
            El panel donde llegan, se filtran y se da seguimiento a los leads de BAIT Prepago.
          </p>
        </div>
        <div style={{
          position: 'relative', zIndex: 1, fontSize: 11.5, color: 'oklch(45% 0 0)',
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          Bait · Panel de leads
        </div>
      </div>

      {/* ── Panel derecho (formulario, claro) ── */}
      <div style={{
        flex: '1 1 380px', minHeight: 480, background: '#f7f5f0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px 40px',
        fontFamily: "'Manrope', system-ui, sans-serif",
      }}>
        <div style={{ width: '100%', maxWidth: 340 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/bait-logo.svg" alt="Bait" style={{ height: 44, width: 'auto', marginBottom: 28, display: 'block' }} />
          <h2 style={{ fontSize: 26, fontWeight: 900, color: '#0a0a0a', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
            Iniciar sesión
          </h2>
          <p style={{ fontSize: 13.5, color: 'oklch(42% 0 0)', margin: '0 0 34px' }}>
            Escribe tus credenciales para continuar
          </p>

          <form onSubmit={handleSubmit} noValidate>
            <div style={{ marginBottom: 26 }}>
              <label htmlFor="admin-email" style={labelStyle}>Correo</label>
              <input
                id="admin-email" type="email" className="login-underline"
                placeholder="tu@empresa.com" value={email} autoComplete="email" autoFocus
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="admin-password" style={labelStyle}>Contraseña</label>
              <input
                id="admin-password" type="password" className="login-underline"
                placeholder="••••••••" value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div style={{ textAlign: 'right', marginBottom: 26 }}>
              <Link href="/admin/forgot-password" className="login-forgot">¿Olvidaste tu contraseña?</Link>
            </div>

            {error && (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'oklch(50% 0.19 25)', marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button
              id="admin-login-btn"
              type="submit"
              disabled={!mounted || loading}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              style={{
                width: '100%', padding: 14, borderRadius: 0, border: 'none',
                background: loading ? 'oklch(45% 0 0)' : hover ? ACCENT : '#0a0a0a',
                color: loading ? '#fff' : hover ? '#0a0a0a' : '#fff',
                fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em',
                cursor: loading || !mounted ? 'default' : 'pointer', transition: 'background .2s, color .2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: 'inherit',
              }}
            >
              {loading && (
                <span style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff',
                  display: 'inline-block', animation: 'spin .7s linear infinite',
                }} />
              )}
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'oklch(35% 0 0)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em',
};
