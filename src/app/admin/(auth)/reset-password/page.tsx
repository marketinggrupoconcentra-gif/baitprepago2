/**
 * src/app/admin/(auth)/reset-password/page.tsx
 *
 * Establece una nueva contraseña con el token del correo de Neon Auth.
 * El token viaja en el query string (?token=...). NO se persiste nada local.
 */
'use client';

import { Suspense, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pw.length < 12) return setError('La contraseña debe tener al menos 12 caracteres.');
    if (pw !== pw2) return setError('Las contraseñas no coinciden.');
    if (!token) return setError('Enlace inválido o expirado. Solicita uno nuevo.');

    setLoading(true);
    try {
      const res = await authClient.resetPassword({ newPassword: pw, token });
      if (res.error) {
        setError(res.error.message ?? 'No se pudo restablecer la contraseña.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/admin/login'), 1800);
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={shell}>
      <style>{css}</style>
      <div className="login-card" style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={h1}>Nueva contraseña</h1>
          <p style={sub}>BAIT Prepago — Panel Interno</p>
        </div>
        <div style={cardBox}>
          {done ? (
            <p style={{ color: 'oklch(80% 0.1 155)', fontSize: 14 }}>
              Contraseña actualizada. Redirigiendo al inicio de sesión…
            </p>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              {error && <div style={errBox}>⚠ {error}</div>}
              <label style={label}>Nueva contraseña</label>
              <input type="password" className="login-input" value={pw}
                onChange={(e) => setPw(e.target.value)} required autoComplete="new-password"
                placeholder="••••••••••••" style={{ marginBottom: 16 }} />
              <label style={label}>Repetir contraseña</label>
              <input type="password" className="login-input" value={pw2}
                onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password"
                placeholder="••••••••••••" style={{ marginBottom: 24 }} />
              <button type="submit" className="login-btn" disabled={loading || !pw || !pw2}>
                {loading ? 'Guardando…' : 'Establecer contraseña'}
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

export default function AdminResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

const shell: React.CSSProperties = {
  minHeight: '100vh', background: 'oklch(14% 0 0)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 24,
  fontFamily: "'Manrope', system-ui, -apple-system, sans-serif", WebkitFontSmoothing: 'antialiased',
};
const cardBox: React.CSSProperties = {
  background: 'oklch(18% 0 0)', border: '1px solid oklch(26% 0 0)', borderRadius: 20, padding: 36,
};
const h1: React.CSSProperties = { margin: '0 0 6px', fontSize: 24, fontWeight: 800, color: 'oklch(95% 0 0)' };
const sub: React.CSSProperties = { margin: 0, fontSize: 14, color: 'oklch(55% 0 0)' };
const label: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 700, color: 'oklch(70% 0 0)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em',
};
const errBox: React.CSSProperties = {
  background: 'oklch(28% 0.08 25)', border: '1px solid oklch(40% 0.12 25)', borderRadius: 10,
  padding: '12px 16px', marginBottom: 20, fontSize: 14, color: 'oklch(80% 0.1 25)',
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
