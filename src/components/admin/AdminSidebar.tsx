/**
 * src/components/admin/AdminSidebar.tsx
 *
 * Sidebar del admin console. Diseño: "Sidebar.dc.html" (Claude Design).
 *
 * - Colapsa a un riel de 76 px cuando la ventana baja de `breakpoint` (1024 px);
 *   sobre el umbral vuelve a 236 px.
 * - En riel, el cursor la abre en capa (overlay) tras 90 ms y la cierra al salir.
 * - El botón fija el estado (abierto / colapsado) e ignora el umbral hasta
 *   "Volver a automático".
 * - < 768 px: barra superior con hamburguesa + panel deslizante con backdrop.
 * - Insignias (Leads / Logs) con datos reales de /api/admin/nav/counts.
 *
 * Client Component (navegación + logout). Recibe `session` del layout server.
 * Logo oficial: /assets/brand/bait.svg (ya en el repo).
 */
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { hasPermission } from '@/lib/rbac';
import type { AdminSession } from '@/lib/session';
import type { Permission } from '@/lib/rbac';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const PANEL = '#FFFFFF';
const BORDER = '#E6E5E0';
const INK = '#16160F';
const MUTED = '#6E6E64';
const IDLE_FG = '#5C5C54';
const ACTIVE_BG = '#FFF6DC';
const HOVER_BG = '#F5F5F3';

const RAIL_W = 76;
const PANEL_W = 236;
const BREAKPOINT = 1024;
const MOBILE = 768;

type BadgeKind = 'leads' | 'logs';

interface NavItem {
  href: string;
  label: string;
  permission: Permission;
  icon: React.ReactNode;
  badge?: BadgeKind;
}

const ICON = {
  resumen: (
    <>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.6" /><rect x="11.5" y="2.5" width="6" height="6" rx="1.6" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.6" /><rect x="11.5" y="11.5" width="6" height="6" rx="1.6" />
    </>
  ),
  leads: (
    <>
      <path d="M4 3.5h9.5L16.5 6.5v10H4z" /><path d="M6.8 8.5h6.4M6.8 11.5h6.4M6.8 14h4" />
    </>
  ),
  analitica: (
    <>
      <path d="M3 16.5h14" /><path d="M5.5 16.5V9M9.5 16.5V4.5M13.5 16.5v-5" />
    </>
  ),
  logs: (
    <>
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8" /><circle cx="15.5" cy="14.5" r="2" />
    </>
  ),
  marketing: (
    <>
      <path d="M3 12.5 7.5 8l3.5 3.5L17 5" /><path d="M13 5h4v4" />
      <path d="M3 16.5h14" />
    </>
  ),
  usuarios: (
    <>
      <circle cx="8" cy="7" r="2.8" /><path d="M3 16.5c0-2.6 2.2-4.3 5-4.3s5 1.7 5 4.3" />
      <path d="M13.4 4.6a2.6 2.6 0 0 1 0 4.9M15 12.6c1.5.6 2.5 1.9 2.5 3.9" />
    </>
  ),
  config: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.6v2M10 15.4v2M3.4 10h2M14.6 10h2M5.3 5.3l1.4 1.4M13.3 13.3l1.4 1.4M14.7 5.3l-1.4 1.4M6.7 13.3l-1.4 1.4" />
    </>
  ),
};

function svg(children: React.ReactNode) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 18px' }} aria-hidden>
      {children}
    </svg>
  );
}

const NAV_PRINCIPAL: NavItem[] = [
  { href: '/admin/dashboard', label: 'Resumen', permission: 'dashboard.view', icon: svg(ICON.resumen) },
  { href: '/admin/leads', label: 'Leads', permission: 'leads.view', icon: svg(ICON.leads), badge: 'leads' },
  { href: '/admin/analytics', label: 'Analítica', permission: 'analytics.view', icon: svg(ICON.analitica) },
  { href: '/admin/logs', label: 'Logs', permission: 'logs.view', icon: svg(ICON.logs), badge: 'logs' },
  { href: '/admin/marketing', label: 'Marketing', permission: 'marketing.view', icon: svg(ICON.marketing) },
];
const NAV_ADMIN: NavItem[] = [
  { href: '/admin/users', label: 'Usuarios', permission: 'users.view', icon: svg(ICON.usuarios) },
  { href: '/admin/settings', label: 'Configuración', permission: 'settings.view', icon: svg(ICON.config) },
];

const BADGE_STYLE: Record<BadgeKind, { bg: string; fg: string; bgActive: string; fgActive: string; dot: string; pulse: boolean }> = {
  leads: { bg: '#F0EFEA', fg: '#54544C', bgActive: '#F0DFAB', fgActive: '#6B5200', dot: '#E0A800', pulse: false },
  logs: { bg: '#F7E0DA', fg: '#7A2718', bgActive: '#F7E0DA', fgActive: '#7A2718', dot: '#A33A2A', pulse: true },
};

export default function AdminSidebar({ session }: { session: AdminSession }) {
  const pathname = usePathname();
  const router = useRouter();

  const [loggingOut, setLoggingOut] = useState(false);
  // w = 0 y manual = null en SSR Y en el primer render del cliente → el sidebar
  // hidrata SIEMPRE en estado "escritorio abierto" (idéntico al server). Los
  // valores reales (ancho de ventana + preferencia en localStorage) se aplican
  // en un efecto post-montaje, evitando el mismatch de hidratación.
  const [w, setW] = useState(0);
  const [manual, setManual] = useState<null | 'open' | 'closed'>(null);
  const [hover, setHover] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [counts, setCounts] = useState<{ leadsPending: number | null; logsFailed: number | null }>({ leadsPending: null, logsFailed: null });

  const hoverT = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Post-montaje: leer ancho real + preferencia guardada (setState solo tras await).
  useEffect(() => {
    let alive = true;
    const onResize = () => { if (alive) setW(window.innerWidth); };
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      setW(window.innerWidth);
      try {
        const v = localStorage.getItem('bait.sidebar.manual');
        if (v === 'open' || v === 'closed') setManual(v);
      } catch { /* modo privado */ }
    })();
    window.addEventListener('resize', onResize);
    return () => { alive = false; window.removeEventListener('resize', onResize); };
  }, []);

  // Contadores reales de las insignias (tras await → cumple set-state-in-effect)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/nav/counts');
        const json = await res.json();
        if (alive && res.ok) setCounts({ leadsPending: json.leadsPending ?? null, logsFailed: json.logsFailed ?? null });
      } catch { /* silencioso — la navegación no depende de esto */ }
    })();
    return () => { alive = false; };
  }, [pathname]);

  useEffect(() => () => { if (hoverT.current) clearTimeout(hoverT.current); }, []);

  const isMobile = w > 0 && w < MOBILE;
  const autoClosed = w > 0 && w < BREAKPOINT && !isMobile;
  const closed = manual === null ? autoClosed : manual === 'closed';
  const open = isMobile ? true : !closed || hover;

  const onEnter = () => {
    if (isMobile || !closed) return;
    if (hoverT.current) clearTimeout(hoverT.current);
    hoverT.current = setTimeout(() => setHover(true), 90);
  };
  const onLeave = () => {
    if (hoverT.current) clearTimeout(hoverT.current);
    setHover(false);
  };
  const persist = (v: null | 'open' | 'closed') => {
    try {
      if (v === null) localStorage.removeItem('bait.sidebar.manual');
      else localStorage.setItem('bait.sidebar.manual', v);
    } catch { /* noop */ }
  };
  const onToggle = () =>
    setManual((m) => {
      const next: 'open' | 'closed' = (m === null ? !autoClosed : m === 'open') ? 'closed' : 'open';
      persist(next);
      return next;
    });
  const onAuto = () => { setManual(null); persist(null); setHover(false); };

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await authClient.signOut();
    } finally {
      router.push('/admin/login');
      router.refresh();
    }
  }, [router]);

  const principal = NAV_PRINCIPAL.filter((i) => hasPermission(session.role, i.permission));
  const admin = NAV_ADMIN.filter((i) => hasPermission(session.role, i.permission));

  const railW = isMobile ? PANEL_W : closed ? RAIL_W : PANEL_W;
  const panelW = open ? PANEL_W : RAIL_W;
  const overlay = !isMobile && closed && hover;

  const labelStyle: React.CSSProperties = {
    opacity: open ? 1 : 0,
    transform: open ? 'translateX(0)' : 'translateX(-8px)',
    transition: 'opacity .2s ease .04s, transform .2s cubic-bezier(.4,0,.2,1) .04s, max-width .24s cubic-bezier(.4,0,.2,1)',
    whiteSpace: 'nowrap',
    maxWidth: open ? 200 : 0,
    overflow: 'hidden',
  };

  const modeNote =
    manual === null
      ? closed ? 'automático · colapsado' : 'automático · abierto'
      : closed ? 'fijado colapsado' : 'fijado abierto';

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(item.href + '/');
    const badgeCount = item.badge === 'leads' ? counts.leadsPending : item.badge === 'logs' ? counts.logsFailed : null;
    const bs = item.badge ? BADGE_STYLE[item.badge] : null;
    const showBadge = bs != null && typeof badgeCount === 'number' && badgeCount > 0;

    return (
      <a
        key={item.href}
        href={item.href}
        title={closed && !hover ? item.label : undefined}
        onClick={() => setMobileOpen(false)}
        className="dc-nav"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '9px 8px',
          borderRadius: 10,
          background: active ? ACTIVE_BG : 'transparent',
          color: active ? INK : IDLE_FG,
          boxShadow: active ? 'inset 2px 0 0 #FFC72C' : 'none',
          transition: 'background .16s ease, color .16s ease, box-shadow .18s ease',
        }}
      >
        {item.icon}
        <span style={{ ...labelStyle, font: `${active ? 700 : 600} 13.5px ${SANS}` }}>{item.label}</span>
        {showBadge && (
          <span
            style={{
              marginLeft: 'auto',
              font: `700 10.5px ${SANS}`,
              background: active ? bs!.bgActive : bs!.bg,
              color: active ? bs!.fgActive : bs!.fg,
              borderRadius: 6,
              padding: '2px 6px',
              opacity: open ? 1 : 0,
              transition: 'opacity .18s ease',
              whiteSpace: 'nowrap',
              ...(bs!.pulse ? { animation: 'dc-badge-pulse 2.6s ease-in-out infinite' } : {}),
            }}
          >
            {badgeCount}
          </span>
        )}
        {showBadge && (
          <span
            style={{
              position: 'absolute',
              top: 7,
              right: 7,
              width: 6,
              height: 6,
              borderRadius: 6,
              background: bs!.dot,
              opacity: open ? 0 : 1,
              transition: 'opacity .18s ease',
            }}
          />
        )}
      </a>
    );
  };

  const chevron = (dir: 'left' | 'right') => (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="#54544C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === 'left' ? <path d="M10 3.5 5.5 8l4.5 4.5" /> : <path d="M6 3.5 10.5 8 6 12.5" />}
    </svg>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
        @keyframes dc-spin { to { transform: rotate(360deg); } }
        @keyframes dc-badge-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(224,168,0,0); } 50% { box-shadow: 0 0 0 4px rgba(224,168,0,0.18); } }
        .dc-nav { text-decoration: none !important; }
        .dc-nav:hover { background: ${HOVER_BG} !important; color: ${INK} !important; }
        .dc-iconbtn { display: flex; align-items: center; justify-content: center; border: 1px solid #EFEEE9; background: #FFFFFF; border-radius: 8px; cursor: pointer; transition: background .15s ease; }
        .dc-iconbtn:hover { background: ${HOVER_BG}; }
        .dc-mobilebar { display: none; }
        @media (max-width: ${MOBILE - 1}px) {
          .dc-mobilebar { display: flex !important; }
        }
      `}</style>

      {loggingOut && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(247,247,245,0.9)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, padding: '32px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, boxShadow: '0 24px 48px -20px rgba(22,22,15,0.25)' }}>
            <span style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid #DDDCD5', borderTopColor: INK, display: 'inline-block', animation: 'dc-spin .7s linear infinite' }} />
            <div style={{ font: `700 14px ${SANS}`, color: INK }}>Cerrando sesión…</div>
          </div>
        </div>
      )}

      {/* Barra superior móvil */}
      <div className="dc-mobilebar" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 54, padding: '0 14px', background: PANEL, borderBottom: `1px solid ${BORDER}`, zIndex: 90, alignItems: 'center', gap: 12 }}>
        <button onClick={() => setMobileOpen((v) => !v)} aria-label="Menú" className="dc-iconbtn" style={{ width: 34, height: 30 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#54544C" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/bait-logo.svg" alt="Bait" style={{ height: 18, width: 'auto', display: 'block' }} />
        <span style={{ font: `700 12px ${SANS}`, color: MUTED }}>admin</span>
      </div>

      {/* Backdrop móvil */}
      {isMobile && mobileOpen && (
        <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,15,0.32)', zIndex: 95 }} />
      )}

      <aside
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        suppressHydrationWarning
        style={{
          width: isMobile ? 0 : railW,
          flex: isMobile ? '0 0 0px' : `0 0 ${railW}px`,
          position: isMobile ? 'fixed' : 'sticky',
          top: 0,
          left: 0,
          height: '100vh',
          zIndex: isMobile ? 100 : 30,
          transition: 'width .24s cubic-bezier(.4,0,.2,1), flex-basis .24s cubic-bezier(.4,0,.2,1)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: isMobile ? PANEL_W : panelW,
            maxWidth: '86vw',
            background: PANEL,
            borderRight: `1px solid ${BORDER}`,
            boxShadow: overlay ? '10px 0 34px rgba(22,22,15,0.14)' : isMobile ? '10px 0 34px rgba(22,22,15,0.14)' : 'none',
            padding: '18px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            overflow: 'hidden',
            transition: 'width .24s cubic-bezier(.4,0,.2,1), box-shadow .24s ease, transform .24s cubic-bezier(.4,0,.2,1)',
            transform: isMobile ? `translateX(${mobileOpen ? '0' : '-100%'})` : 'none',
            fontFamily: SANS,
          }}
        >
          {/* Header: logo oficial */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px', minHeight: 30 }}>
            <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .24s cubic-bezier(.4,0,.2,1)', transform: open ? 'scale(1)' : 'scale(1.02)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/bait-logo.svg" alt="Bait" style={{ height: 19, width: 'auto', display: 'block' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, ...labelStyle }}>
              <span style={{ font: `700 12px ${SANS}`, letterSpacing: '-0.01em', color: INK }}>admin</span>
              <span style={{ font: `500 9.5px ${MONO}`, color: MUTED }}>portabilidad</span>
            </div>
            {open && !isMobile && (
              <button onClick={onToggle} title={closed ? 'Fijar abierto' : 'Colapsar'} aria-label={closed ? 'Fijar abierto' : 'Colapsar'} className="dc-iconbtn" style={{ marginLeft: 'auto', flex: '0 0 26px', width: 26, height: 26 }}>
                {chevron('left')}
              </button>
            )}
          </div>

          {/* Botón para expandir cuando está en riel */}
          {!open && !isMobile && (
            <button onClick={onToggle} title="Fijar abierto" aria-label="Fijar abierto" className="dc-iconbtn" style={{ alignSelf: 'center', width: 34, height: 30, background: '#FBFBF9' }}>
              {chevron('right')}
            </button>
          )}

          {/* Navegación */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ font: `700 10px ${SANS}`, letterSpacing: '0.12em', color: MUTED, padding: '0 8px 5px', height: 14, opacity: open ? 1 : 0, transition: 'opacity .18s ease', whiteSpace: 'nowrap' }}>PANEL</div>
            {principal.map(renderItem)}
            {admin.length > 0 && (
              <>
                <div style={{ height: 1, background: '#F0EFEA', margin: '8px 6px' }} />
                {admin.map(renderItem)}
              </>
            )}
          </nav>

          {/* Footer: usuario + modo */}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderRadius: 12, background: '#FBFBF9', border: '1px solid #EFEEE9' }}>
              <span style={{ width: 28, height: 28, flex: '0 0 28px', borderRadius: 9, background: ACTIVE_BG, color: '#6B5200', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `800 11.5px ${SANS}` }}>
                {(session.name || session.email || '?').trim()[0]?.toUpperCase() ?? '?'}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, ...labelStyle }}>
                <span style={{ font: `700 12px ${SANS}`, color: INK, overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.name || session.email}</span>
                <span style={{ font: `500 10.5px ${MONO}`, color: MUTED }}>{session.role.toLowerCase()}</span>
              </span>
              <button onClick={handleLogout} title="Cerrar sesión" style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: MUTED, font: `700 11px ${SANS}`, padding: 4, opacity: open ? 1 : 0, transition: 'opacity .18s ease' }}>
                Salir
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 8px', minHeight: 16, flexWrap: 'wrap' }}>
              <span style={{ width: 6, height: 6, flex: '0 0 6px', borderRadius: 6, background: '#1B7F4B', boxShadow: '0 0 0 3px rgba(27,127,75,0.14)' }} />
              <span style={{ font: `500 10.5px ${MONO}`, color: MUTED, whiteSpace: 'nowrap', opacity: open ? 1 : 0, transition: 'opacity .18s ease' }}>{modeNote}</span>
              {manual !== null && open && (
                <button onClick={onAuto} style={{ border: 'none', background: 'none', cursor: 'pointer', font: `700 10px ${SANS}`, color: '#8C6A00', textDecoration: 'underline', textUnderlineOffset: 2, padding: 0 }}>
                  automático
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
