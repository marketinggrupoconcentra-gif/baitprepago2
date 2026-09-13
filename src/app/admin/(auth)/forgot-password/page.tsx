/**
 * src/app/admin/(auth)/forgot-password/page.tsx
 *
 * Solicita el correo de recuperación de contraseña vía Neon Auth.
 * NO gestiona tokens ni contraseñas localmente: sólo dispara el flujo oficial.
 */
'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo: '/admin/reset-password',
      });
    } catch {
      /* respuesta genérica: no revelar si el email existe */
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <div style={shell}>
      <style>{css}</style>
      <div className="login-card" style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={h1}>Recuperar acceso</h1>
          <p style={sub}>BAIT Prepago — Panel Interno</p>
        </div>
        <div style={card}>
          {sent ? (
            <p style={{ color: 'oklch(80% 0 0)', fontSize: 14, lineHeight: 1.6 }}>
              Si el correo corresponde a una cuenta autorizada, recibirás un enlace
              para establecer una nueva contraseña. Revisa tu bandeja de entrada.
            </p>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <label style={label}>Correo electrónico</label>
              <input
                id="admin-email"
                type="email"
                className="login-input"
                placeholder="admin@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                style={{ marginBottom: 24 }}
              />
              <button type="submit" className="login-btn" disabled={loading || !email}>
                {loading ? 'Enviando…' : 'Enviar enlace de recuperación'}
              </button>
            </form>
          )}
        </div>
        <p style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href="/admin/login" style={{ color: 'oklch(60% 0 0)', fontSize: 13 }}>
            ← Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}

const shell: React.CSSProperties = {
  minHeight: '100vh', background: 'oklch(14% 0 0)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 24,
  fontFamily: "'Manrope', system-ui, -apple-system, sans-serif", WebkitFontSmoothing: 'antialiased',
};
const card: React.CSSProperties = {
  background: 'oklch(18% 0 0)', border: '1px solid oklch(26% 0 0)',
  borderRadius: 20, padding: 36,
};
const h1: React.CSSProperties = { margin: '0 0 6px', fontSize: 24, fontWeight: 800, color: 'oklch(95% 0 0)' };
const sub: React.CSSProperties = { margin: 0, fontSize: 14, color: 'oklch(55% 0 0)' };
const label: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 700, color: 'oklch(70% 0 0)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em',
};
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; }
  @keyframes fadeInUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  .login-card { animation: fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
  .login-input { width:100%; padding:13px 16px; background:oklch(20% 0 0); border:1.5px solid oklch(28% 0 0); border-radius:10px; color:oklch(95% 0 0); font-family:inherit; font-size:15px; outline:none; transition:border-color 0.18s, box-shadow 0.18s; }
  .login-input:focus { border-color:oklch(84% 0.19 97); box-shadow:0 0 0 3px oklch(84% 0.19 97 / 0.2); }
  .login-btn { width:100%; padding:14px; background:oklch(84% 0.19 97); color:oklch(20% 0 0); font-family:inherit; font-size:15px; font-weight:800; border:none; border-radius:10px; cursor:pointer; transition:opacity 0.15s; }
  .login-btn:disabled { opacity:0.5; cursor:not-allowed; }
`;
