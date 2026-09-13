/**
 * src/app/admin/(console)/layout.tsx
 *
 * Layout del console admin — sidebar + contenido.
 * Server Component: verifica sesión antes de renderizar.
 * Redirige a /admin/login si no autenticado.
 */
import { requireAdminSessionOrRedirect } from '@/lib/session';
import AdminSidebar from '@/components/admin/AdminSidebar';

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdminSessionOrRedirect();

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: '#F5F5F3',
      color: '#16160F',
      fontFamily: "'Manrope', system-ui, -apple-system, sans-serif",
      WebkitFontSmoothing: 'antialiased',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        @keyframes fadeInUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulseDot { 0% { transform:scale(1); opacity:0.7; } 70% { transform:scale(2.4); opacity:0; } 100% { opacity:0; } }
        .fade-in-up { animation: fadeInUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .admin-card { background: #fff; border: 1px solid oklch(90% 0 0); border-radius: 16px; transition: box-shadow 0.25s, transform 0.25s; }
        .admin-card:hover { box-shadow: 0 16px 32px -14px oklch(30% 0 0 / 0.3); transform: translateY(-3px); }
        .admin-btn-primary { background: oklch(20% 0 0); color: #fff; border: none; border-radius: 10px; padding: 10px 18px; font-family: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: opacity 0.15s; }
        .admin-btn-primary:hover { opacity: 0.85; }
        .admin-btn-secondary { background: transparent; color: oklch(30% 0 0); border: 1.5px solid oklch(86% 0 0); border-radius: 10px; padding: 9px 16px; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
        .admin-btn-secondary:hover { background: oklch(95% 0 0); border-color: oklch(78% 0 0); }
        .admin-table-row:hover td { background: oklch(97.5% 0 0); }
        .admin-input { padding: 9px 13px; border: 1.5px solid oklch(86% 0 0); border-radius: 9px; font-family: inherit; font-size: 13.5px; color: oklch(20% 0 0); background: #fff; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
        .admin-input:focus { border-color: oklch(84% 0.19 97); box-shadow: 0 0 0 3px oklch(84% 0.19 97 / 0.15); }
        .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 100px; }
        .badge-green { background: oklch(93% 0.08 155); color: oklch(35% 0.12 155); }
        .badge-red { background: oklch(95% 0.05 25); color: oklch(40% 0.12 25); }
        .badge-yellow { background: oklch(95% 0.08 97); color: oklch(38% 0.12 97); }
        .badge-gray { background: oklch(93% 0 0); color: oklch(42% 0 0); }
        .badge-blue { background: oklch(93% 0.06 240); color: oklch(38% 0.12 240); }
        .admin-main { flex: 1; min-width: 0; padding: 32px 40px 64px; overflow-x: hidden; }
        @media (max-width: 1024px) {
          .admin-main { padding: 26px clamp(14px, 2.2vw, 28px) 56px; }
        }
        @media (max-width: 767px) {
          .admin-main { padding: 70px 16px 48px; }
        }
      `}</style>

      <AdminSidebar session={session} />

      <main className="admin-main">
        {children}
      </main>
    </div>
  );
}
