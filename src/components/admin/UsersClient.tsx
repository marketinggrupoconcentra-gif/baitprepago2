/**
 * src/components/admin/UsersClient.tsx
 *
 * Usuarios y roles del panel — vista `/admin/users`.
 * Diseño: "Usuarios.dc.html" (Claude Design), réplica exacta.
 *
 * Identidad → Neon Auth. Autorización BAIT → app.admin_profiles (rol + is_active).
 * Historial → app.audit_logs (por actor). Todo real; sin datos de demostración.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPermissions, hasPermission } from '@/lib/rbac';
import type { AdminSession } from '@/lib/session';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const INK = '#16160F';
const MUTED = '#6E6E64';
const LINE = '#E6E5E0';
const ROW_LINE = '#F5F4EF';
const CARD = '#FFFFFF';
const BG = '#F5F5F3';
const CHIP_BD = '#EDECE6';
const AMBER = '#FFC72C';
const AMBER_SOFT = '#FFF6DC';
const GREEN_FG = '#1B6B44';
const RED_FG = '#A33A2A';

const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type RoleId = 'Administrador' | 'Editor' | 'Lector';
const ROLE_DEFS: Record<RoleId, { label: string; plural: string; desc: string; dot: string; bg: string; bd: string; fg: string }> = {
  Administrador: { label: 'Administrador', plural: 'Administradores', desc: 'Acceso total: invita, cambia roles y descarga historiales.', dot: '#E0A800', bg: '#FFF6DC', bd: '#F4E2AE', fg: '#6B5200' },
  Editor: { label: 'Editor', plural: 'Editores', desc: 'Ve leads y analítica, exporta reportes. No administra accesos.', dot: '#4A4A42', bg: '#F3F2ED', bd: '#E6E5E0', fg: '#3E3E36' },
  Lector: { label: 'Lector', plural: 'Lectores', desc: 'Solo lectura de leads, analítica y reportes. Sin exportes ni gestión.', dot: '#9A9A8F', bg: '#FBFBF9', bd: '#E6E5E0', fg: '#54544C' },
};
const ROLE_ORDER: RoleId[] = ['Administrador', 'Editor', 'Lector'];

const ESTADOS = {
  activo: { label: 'Activo', dot: '#1B7F4B', fg: GREEN_FG },
  invitado: { label: 'Invitado', dot: '#E0A800', fg: '#8C6A00' },
  suspendido: { label: 'Suspendido', dot: RED_FG, fg: RED_FG },
} as const;
type EstadoId = keyof typeof ESTADOS;

const AV: [string, string][] = [
  ['#FFF6DC', '#6B5200'], ['#EAF5EE', '#1B6B44'], ['#F3F2ED', '#3E3E36'],
  ['#FBEDEA', '#A33A2A'], ['#EDECE6', '#54544C'],
];

const PERM_ROWS: [string, string][] = [
  ['Ver leads', 'leads.view'],
  ['Ver datos de leads (PII)', 'leads.detail.view'],
  ['Exportar leads', 'leads.export'],
  ['Ver analítica', 'analytics.view'],
  ['Invitar personas', 'users.invite'],
  ['Cambiar roles', 'users.role.change'],
  ['Ver bitácora de auditoría', 'audit.view'],
];

const PER_PAGE = 8;
const GRID = '34px 1.7fr 1.15fr 0.9fr 1fr 0.85fr 150px';

interface ApiUser {
  id: string;
  authUserId: string;
  role: RoleId;
  isActive: boolean;
  name: string;
  email: string;
  createdAt: string;
  eventCount: number;
  lastAccessAt: string | null;
}
interface ActivityEvent { id: string; action: string; label: string; targetType: string | null; targetId: string | null; at: string; ip: string }
interface ActivityResp { user: { name: string; email: string; role: string }; auditAvailable?: boolean; total: number; firstAt: string | null; page: number; pageSize: number; data: ActivityEvent[] }

// ── Helpers ───────────────────────────────────────────────────────────────────
const NF = new Intl.NumberFormat('es-MX');
const n = (v: number) => NF.format(Math.round(v || 0));
const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? '')).toUpperCase();
};
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
function relTime(iso: string | null, nowMs: number) {
  if (!iso) return 'sin acceso';
  const ms = nowMs - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'hace instantes';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const dd = Math.round(h / 24);
  return dd < 30 ? `hace ${dd} día${dd === 1 ? '' : 's'}` : shortDate(iso);
}
const estadoOf = (u: ApiUser): EstadoId =>
  !u.isActive ? 'suspendido' : u.lastAccessAt || u.eventCount > 0 ? 'activo' : 'invitado';
const dtLabel = (iso: string) => new Date(iso).toLocaleString('es-MX', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City',
});

// ── Component ─────────────────────────────────────────────────────────────────
export default function UsersClient({ session }: { session: AdminSession }) {
  const canInvite = hasPermission(session.role, 'users.invite');
  const canChangeRole = hasPermission(session.role, 'users.role.change');
  const canDisable = hasPermission(session.role, 'users.disable');
  const canDownload = hasPermission(session.role, 'audit.view');
  const isAdmin = canInvite && canChangeRole && canDisable;

  const [nowMs] = useState(() => Date.now());
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<string>('todos');
  const [q, setQ] = useState('');
  const [sortK, setSortK] = useState<'nombre' | 'acceso' | 'eventos'>('eventos');
  const [sortD, setSortD] = useState(-1);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ emails: string; name: string; role: RoleId; notify: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null);
  const [toast, setToast] = useState<{ msg: string; dot: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);

  const showToast = useCallback((msg: string, dot = AMBER) => {
    setToast({ msg, dot });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      const json = await res.json();
      if (json.error) { setError(String(json.error)); return; }
      setUsers((json.data ?? []) as ApiUser[]);
      setError(null);
    } catch {
      setError('No se pudieron cargar los usuarios');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => { await load(); if (!cancelled) setLoading(false); })();
    return () => { cancelled = true; };
  }, [load]);

  // ── Derivados (filtro/orden/página, todo client-side como el diseño) ────────
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = users.filter((u) => {
      const est = estadoOf(u);
      const tabOk = tab === 'todos' ? true
        : tab === 'invitado' || tab === 'suspendido' ? est === tab
          : u.role === tab;
      return tabOk && (!term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
    });
    rows.sort((a, b) => {
      if (sortK === 'eventos') return (a.eventCount - b.eventCount) * sortD;
      if (sortK === 'acceso') return ((a.lastAccessAt ? Date.parse(a.lastAccessAt) : 0) - (b.lastAccessAt ? Date.parse(b.lastAccessAt) : 0)) * sortD;
      return a.name.localeCompare(b.name, 'es') * -sortD;
    });
    return rows;
  }, [users, q, tab, sortK, sortD]);

  const maxPage = Math.max(0, Math.ceil(filtered.length / PER_PAGE) - 1);
  const pg = Math.min(page, maxPage);
  const slice = filtered.slice(pg * PER_PAGE, pg * PER_PAGE + PER_PAGE);
  const evMax = Math.max(...users.map((u) => u.eventCount), 1);
  const adminCount = users.filter((u) => u.role === 'Administrador' && u.isActive).length;

  const counts = {
    todos: users.length,
    Administrador: users.filter((u) => u.role === 'Administrador').length,
    Editor: users.filter((u) => u.role === 'Editor').length,
    Lector: users.filter((u) => u.role === 'Lector').length,
    invitado: users.filter((u) => estadoOf(u) === 'invitado').length,
    suspendido: users.filter((u) => estadoOf(u) === 'suspendido').length,
  };
  const stats = [
    { label: 'Con acceso', val: n(users.filter((u) => estadoOf(u) === 'activo').length), note: 'perfiles activos con actividad registrada' },
    { label: 'Invitaciones pendientes', val: n(counts.invitado), note: 'aún no han iniciado sesión' },
    { label: 'Administradores', val: n(counts.Administrador), note: 'pueden invitar, cambiar roles y descargar historiales' },
    { label: 'Eventos registrados', val: n(users.reduce((a, u) => a + u.eventCount, 0)), note: 'bitácora en app.audit_logs' },
  ];

  const TABS: { id: string; label: string; count: number }[] = [
    { id: 'todos', label: 'Todos', count: counts.todos },
    ...ROLE_ORDER.map((r) => ({ id: r, label: ROLE_DEFS[r].plural, count: counts[r] })),
    { id: 'invitado', label: 'Invitados', count: counts.invitado },
    { id: 'suspendido', label: 'Suspendidos', count: counts.suspendido },
  ];

  const selIds = [...sel];
  const selEvents = selIds.reduce((a, id) => a + (users.find((u) => u.id === id)?.eventCount ?? 0), 0);

  // ── Acciones ───────────────────────────────────────────────────────────────
  const pick = (patch: Partial<{ tab: string }>) => { if (patch.tab !== undefined) { setTab(patch.tab); setPage(0); } };
  const toggleSort = (k: 'nombre' | 'acceso' | 'eventos') => {
    if (sortK === k) setSortD((d) => -d); else { setSortK(k); setSortD(-1); }
  };
  const toggleRow = (id: string) => setSel((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const toggleAll = () => setSel((s) => {
    const ids = slice.map((r) => r.id);
    const on = ids.length > 0 && ids.every((i) => s.has(i));
    const x = new Set(s);
    ids.forEach((i) => { if (on) x.delete(i); else x.add(i); });
    return x;
  });

  const downloadCsv = (id: string, extra = '') => {
    if (!canDownload) { showToast('Solo un administrador puede descargar historiales', '#E0A800'); return; }
    const a = document.createElement('a');
    a.href = `/api/admin/users/${id}/activity?format=csv${extra}`;
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  };
  const bulkDownload = () => {
    if (!canDownload) { showToast('Solo un administrador puede descargar historiales', '#E0A800'); return; }
    const withEvents = selIds.filter((id) => (users.find((u) => u.id === id)?.eventCount ?? 0) > 0);
    if (!withEvents.length) { showToast('La selección no tiene actividad registrada', '#E0A800'); return; }
    withEvents.forEach((id, i) => setTimeout(() => downloadCsv(id), i * 250));
    showToast(`${withEvents.length} historial${withEvents.length === 1 ? '' : 'es'} en descarga`, '#1B7F4B');
  };

  const patchUser = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Error');
  };

  const setRole = async (id: string, role: RoleId) => {
    if (!canChangeRole) { showToast('Requiere perfil administrador', '#E0A800'); return; }
    setBusy(true);
    try {
      await patchUser(id, { role });
      await load();
      showToast(`Rol actualizado a ${ROLE_DEFS[role].label}`, AMBER);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo cambiar el rol', RED_FG);
    } finally { setBusy(false); }
  };

  const doRemove = async (ids: string[]) => {
    setConfirm(null);
    setBusy(true);
    let ok = 0; let fail = '';
    for (const id of ids) {
      try { await patchUser(id, { isActive: false }); ok += 1; }
      catch (e) { fail = e instanceof Error ? e.message : 'error'; }
    }
    await load();
    setSel(new Set());
    setOpen((cur) => (cur && ids.includes(cur) ? null : cur));
    setBusy(false);
    if (ok && !fail) showToast(ok === 1 ? 'Rol eliminado y acceso revocado' : `${ok} roles eliminados`, RED_FG);
    else if (ok) showToast(`${ok} revocados · ${fail}`, '#E0A800');
    else showToast(fail || 'No se pudo revocar el acceso', RED_FG);
  };

  const askRemove = (id: string) => {
    if (!canDisable) { showToast('Requiere perfil administrador', '#E0A800'); return; }
    setConfirm({ ids: [id] });
  };

  const sendInvite = async () => {
    if (!invite) return;
    const list = invite.emails.split(/[,;\s]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (!list.length) return;
    setBusy(true);
    let ok = 0; let last = '';
    for (const email of list) {
      const nm = invite.name.trim() || email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name: nm, role: invite.role }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) ok += 1; else last = json.error || 'error';
      } catch { last = 'error de red'; }
    }
    setInvite(null);
    setBusy(false);
    await load();
    if (ok && !last) showToast(ok === 1 ? `Invitación enviada` : `${ok} invitaciones enviadas`, '#1B7F4B');
    else if (ok) showToast(`${ok} enviadas · ${last}`, '#E0A800');
    else showToast(last || 'No se pudo invitar', RED_FG);
  };

  const arrow = (k: 'nombre' | 'acceso' | 'eventos') => (sortK === k ? (sortD < 0 ? '↓' : '↑') : '');
  const isEmpty = !loading && !error && filtered.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, font: `400 14px ${SANS}`, color: INK, maxWidth: 1440, margin: '0 auto', position: 'relative' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .us-scr::-webkit-scrollbar { height: 8px; width: 8px; }
        .us-scr::-webkit-scrollbar-thumb { background: #DDDCD5; border-radius: 8px; }
        .us-row:hover { background: #FBFBF9 !important; }
      `}</style>

      {/* Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <span style={{ font: `700 11px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>BAIT PREPAGO · PORTABILIDAD</span>
          <h1 style={{ margin: 0, font: `800 28px ${SANS}`, letterSpacing: '-0.028em', lineHeight: 1.1 }}>Usuarios</h1>
          <p style={{ margin: 0, font: `500 13.5px ${SANS}`, color: MUTED, maxWidth: '64ch' }}>
            Quién tiene acceso al panel, con qué rol y qué ha hecho. Abre un rol para ver y descargar su historial de actividad.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {isAdmin ? (
            <button type="button" onClick={() => setInvite({ emails: '', name: '', role: 'Lector', notify: true })}
              style={{ background: INK, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', font: `700 12.5px ${SANS}`, cursor: 'pointer' }}>
              Invitar personas
            </button>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, background: AMBER_SOFT, border: `1px solid #F4E2AE`, borderRadius: 20, padding: '7px 13px', font: `600 12px ${SANS}`, color: '#8C6A00', maxWidth: 360 }}>
              Solo lectura · invitar y cambiar roles requiere perfil administrador
            </span>
          )}
        </div>
      </header>

      {/* Stats */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 12 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
            <span style={{ font: `700 12px ${SANS}`, color: MUTED }}>{s.label}</span>
            <span style={{ font: `800 24px ${SANS}`, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.val}</span>
            <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>{s.note}</span>
          </div>
        ))}
      </section>

      {/* Filtros */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '12px 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 20, boxShadow: '0 1px 0 rgba(22,22,15,0.03)' }}>
        <div className="us-scr" style={{ display: 'flex', alignItems: 'center', gap: 4, background: BG, border: `1px solid ${CHIP_BD}`, borderRadius: 11, padding: 3, overflowX: 'auto' }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} type="button" onClick={() => pick({ tab: t.id })}
                style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '7px 11px', font: `700 12.5px ${SANS}`, background: active ? INK : 'transparent', color: active ? '#fff' : '#5C5C54' }}>
                {t.label}
                <span style={{ font: `700 10.5px ${SANS}`, background: active ? '#3A3A31' : '#EAE9E3', color: active ? '#fff' : '#54544C', borderRadius: 20, padding: '1px 6px' }}>{n(t.count)}</span>
              </button>
            );
          })}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: BG, border: `1px solid ${CHIP_BD}`, borderRadius: 10, padding: '8px 11px', flex: '1 1 200px', minWidth: 180, maxWidth: 320 }}>
          <span style={{ width: 11, height: 11, border: '1.5px solid #9A9A8F', borderRadius: 11, flex: '0 0 11px' }} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Nombre o correo"
            style={{ border: 'none', background: 'transparent', outline: 'none', font: `500 12.5px ${SANS}`, color: INK, width: '100%' }} />
        </label>
        <div style={{ flex: '1 1 20px' }} />
        <span style={{ font: `500 12px ${SANS}`, color: MUTED, whiteSpace: 'nowrap' }}>{n(filtered.length)} de {n(users.length)} personas</span>
      </section>

      {error && <div style={{ padding: '12px 15px', background: '#FBEDEA', border: `1px solid #F0D5CE`, borderRadius: 12, color: RED_FG, font: `600 12.5px ${SANS}` }}>{error}</div>}

      {/* Barra de selección */}
      {sel.size > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, background: INK, borderRadius: 14, padding: '11px 15px' }}>
          <span style={{ font: `700 12.5px ${SANS}`, color: '#fff' }}>{sel.size} seleccionado{sel.size === 1 ? '' : 's'} · {n(selEvents)} eventos de historial</span>
          <div style={{ flex: '1 1 20px' }} />
          <button type="button" onClick={bulkDownload} disabled={!canDownload}
            style={{ border: 'none', cursor: canDownload ? 'pointer' : 'not-allowed', background: canDownload ? AMBER : '#3A3A31', color: canDownload ? INK : '#8A8A80', borderRadius: 9, padding: '7px 13px', font: `700 12px ${SANS}` }}>Descargar historial (CSV)</button>
          <button type="button" onClick={() => canDisable ? setConfirm({ ids: selIds }) : showToast('Requiere perfil administrador', '#E0A800')} disabled={!canDisable}
            style={{ cursor: canDisable ? 'pointer' : 'not-allowed', background: 'transparent', color: canDisable ? '#fff' : '#8A8A80', border: `1px solid #4A4A42`, borderRadius: 9, padding: '7px 13px', font: `700 12px ${SANS}` }}>Eliminar roles</button>
          <button type="button" onClick={() => setSel(new Set())}
            style={{ border: 'none', cursor: 'pointer', background: 'transparent', color: '#C9C8C0', font: `700 12px ${SANS}`, textDecoration: 'underline', textUnderlineOffset: 3, padding: '7px 4px' }}>Quitar selección</button>
        </div>
      )}

      {/* Tabla */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="us-scr" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 920, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '12px 16px', background: '#FBFBF9', borderBottom: `1px solid #EFEEE9`, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>
              <input type="checkbox" checked={slice.length > 0 && slice.every((r) => sel.has(r.id))} onChange={toggleAll} aria-label="Seleccionar todo" style={{ width: 15, height: 15, accentColor: INK, cursor: 'pointer' }} />
              <button type="button" onClick={() => toggleSort('nombre')} style={hBtn}>PERSONA {arrow('nombre')}</button>
              <span>ROL</span>
              <span>ESTADO</span>
              <button type="button" onClick={() => toggleSort('acceso')} style={hBtn}>ÚLTIMO ACCESO {arrow('acceso')}</button>
              <button type="button" onClick={() => toggleSort('eventos')} style={{ ...hBtn, textAlign: 'right' }}>HISTORIAL {arrow('eventos')}</button>
              <span style={{ textAlign: 'right' }}>ACCIONES</span>
            </div>

            {loading ? (
              [0, 1, 2, 3, 4].map((i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: `1px solid ${ROW_LINE}` }}>
                  <span />{[130, 90, 80, 90, 40, 0].map((w, j) => <span key={j} style={{ height: 12, width: w || undefined, background: '#EFEEE9', borderRadius: 6 }} />)}
                </div>
              ))
            ) : slice.map((u, i) => {
              const rd = ROLE_DEFS[u.role];
              const est = ESTADOS[estadoOf(u)];
              const you = u.authUserId === session.userId;
              const lastAdmin = u.role === 'Administrador' && adminCount <= 1;
              const av = AV[i % AV.length];
              const rmDisabled = !canDisable || lastAdmin || you;
              return (
                <div key={u.id} className="us-row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: `1px solid ${ROW_LINE}`, background: sel.has(u.id) ? '#FFFDF4' : CARD }}>
                  <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggleRow(u.id)} aria-label="Seleccionar usuario" style={{ width: 15, height: 15, accentColor: INK, cursor: 'pointer' }} />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <span style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 11, background: av[0], color: av[1], display: 'flex', alignItems: 'center', justifyContent: 'center', font: `800 12px ${SANS}` }}>{initials(u.name)}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ font: `700 13px ${SANS}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}{you ? '  · tú' : ''}</span>
                      <span style={{ font: `500 11.5px ${MONO}`, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
                    </span>
                  </span>
                  <button type="button" onClick={() => setOpen(u.id)} title="Ver historial de este rol"
                    style={{ justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: rd.bg, border: `1px solid ${rd.bd}`, borderRadius: 20, padding: '5px 11px', font: `700 12px ${SANS}`, color: rd.fg }}>
                    <span style={{ width: 6, height: 6, borderRadius: 6, background: rd.dot, flex: '0 0 6px' }} />{rd.label}
                  </button>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `600 12px ${SANS}`, color: est.fg }}>
                    <span style={{ width: 6, height: 6, borderRadius: 6, background: est.dot, flex: '0 0 6px' }} />{est.label}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ font: `500 12.5px ${MONO}` }}>{relTime(u.lastAccessAt, nowMs)}</span>
                    <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>alta {shortDate(u.createdAt)}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                    <span style={{ font: `700 13px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{n(u.eventCount)}</span>
                    <span style={{ width: '100%', maxWidth: 70, height: 4, background: '#F3F2ED', borderRadius: 4, overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${(u.eventCount / evMax) * 100}%`, height: '100%', background: '#E0A800' }} />
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => downloadCsv(u.id)} disabled={!canDownload} title={canDownload ? 'Descargar historial en CSV' : 'Requiere perfil administrador'}
                      style={{ border: `1px solid ${LINE}`, background: CARD, cursor: canDownload ? 'pointer' : 'not-allowed', borderRadius: 8, padding: '5px 9px', font: `700 11.5px ${SANS}`, color: canDownload ? INK : '#B4B3A6' }}>CSV</button>
                    <button type="button" onClick={() => setOpen(u.id)} style={{ border: `1px solid ${LINE}`, background: CARD, cursor: 'pointer', borderRadius: 8, padding: '5px 9px', font: `700 11.5px ${SANS}`, color: INK }}>Ver</button>
                    <button type="button" onClick={() => askRemove(u.id)} disabled={rmDisabled} title={you ? 'No puedes modificar tu propio perfil' : lastAdmin ? 'Debe quedar al menos un administrador' : !canDisable ? 'Requiere perfil administrador' : 'Eliminar rol'}
                      style={{ border: `1px solid ${rmDisabled ? LINE : '#F0D5CE'}`, background: CARD, cursor: rmDisabled ? 'not-allowed' : 'pointer', borderRadius: 8, padding: '5px 9px', font: `700 11.5px ${SANS}`, color: rmDisabled ? '#B4B3A6' : RED_FG }}>Rol</button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {isEmpty && (
          <div style={{ padding: '56px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: BG, border: `1px solid ${LINE}` }} />
            <div style={{ font: `800 16px ${SANS}` }}>Nadie coincide con el filtro</div>
            <div style={{ font: `500 13px ${SANS}`, color: MUTED, maxWidth: '42ch' }}>Prueba con otro nombre o vuelve a la pestaña Todos.</div>
            <button type="button" onClick={() => { setTab('todos'); setQ(''); setPage(0); }} style={{ marginTop: 6, border: 'none', background: INK, color: '#fff', borderRadius: 10, padding: '9px 15px', font: `700 12.5px ${SANS}`, cursor: 'pointer' }}>Limpiar filtros</button>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: '#FBFBF9' }}>
          <span style={{ font: `500 12px ${SANS}`, color: MUTED }}>
            {filtered.length ? `${pg * PER_PAGE + 1}–${Math.min(filtered.length, (pg + 1) * PER_PAGE)} de ${filtered.length}` : '0 resultados'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={pg === 0} style={pBtn(pg === 0)}>Anterior</button>
            {Array.from({ length: maxPage + 1 }, (_, i) => (
              <button key={i} type="button" onClick={() => setPage(i)}
                style={{ cursor: 'pointer', border: `1px solid ${i === pg ? INK : LINE}`, background: i === pg ? INK : CARD, color: i === pg ? '#fff' : '#54544C', borderRadius: 8, minWidth: 30, padding: '6px 9px', font: `700 12px ${SANS}` }}>{i + 1}</button>
            ))}
            <button type="button" onClick={() => setPage((p) => Math.min(maxPage, p + 1))} disabled={pg >= maxPage} style={pBtn(pg >= maxPage)}>Siguiente</button>
          </div>
        </div>
      </section>

      {open && (
        <UserDrawer
          user={users.find((u) => u.id === open)!}
          isAdmin={isAdmin} canChangeRole={canChangeRole} canDisable={canDisable} canDownload={canDownload}
          selfId={session.userId} adminCount={adminCount}
          onClose={() => setOpen(null)}
          onSetRole={setRole}
          onAskRemove={(id) => askRemove(id)}
          onDownload={downloadCsv}
          busy={busy}
        />
      )}

      {invite && (
        <InviteModal invite={invite} setInvite={setInvite} onSend={sendInvite} onClose={() => setInvite(null)} busy={busy} />
      )}

      {confirm && (
        <ConfirmModal
          names={confirm.ids.map((id) => users.find((u) => u.id === id)?.name ?? '').filter(Boolean)}
          onCancel={() => setConfirm(null)} onConfirm={() => doRemove(confirm.ids)}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 11, background: INK, borderRadius: 12, padding: '12px 16px', boxShadow: '0 16px 40px rgba(22,22,15,0.22)' }}>
          <span style={{ width: 7, height: 7, borderRadius: 7, background: toast.dot, flex: '0 0 7px' }} />
          <span style={{ font: `600 12.5px ${SANS}`, color: '#fff' }}>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

const hBtn: React.CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textAlign: 'left', padding: 0 };
const pBtn = (dis: boolean): React.CSSProperties => ({
  cursor: dis ? 'default' : 'pointer', border: `1px solid ${LINE}`, background: CARD, borderRadius: 8, padding: '6px 11px', font: `700 12px ${SANS}`, color: dis ? '#B4B3A6' : INK,
});

// ── Drawer ────────────────────────────────────────────────────────────────────
function UserDrawer({
  user, isAdmin, canChangeRole, canDisable, canDownload, selfId, adminCount, onClose, onSetRole, onAskRemove, onDownload, busy,
}: {
  user: ApiUser; isAdmin: boolean; canChangeRole: boolean; canDisable: boolean; canDownload: boolean;
  selfId: string; adminCount: number;
  onClose: () => void; onSetRole: (id: string, r: RoleId) => void; onAskRemove: (id: string) => void; onDownload: (id: string, extra?: string) => void; busy: boolean;
}) {
  const [act, setAct] = useState<ActivityResp | null>(null);
  const [logPage, setLogPage] = useState(0);
  const [logLoading, setLogLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${user.id}/activity?page=${logPage}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled && !j.error) setAct(j as ActivityResp); })
      .finally(() => { if (!cancelled) setLogLoading(false); });
    return () => { cancelled = true; };
  }, [user.id, logPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const rd = ROLE_DEFS[user.role];
  const est = ESTADOS[estadoOf(user)];
  const perms = getPermissions(user.role);
  const you = user.authUserId === selfId;
  const lastAdmin = user.role === 'Administrador' && adminCount <= 1;
  const total = act?.total ?? user.eventCount;
  const maxLogPage = Math.max(0, Math.ceil(total / 8) - 1);
  const av = AV[user.name.length % AV.length];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <style>{`.ud-scr::-webkit-scrollbar{width:8px}.ud-scr::-webkit-scrollbar-thumb{background:#DDDCD5;border-radius:8px}`}</style>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(22,22,15,0.24)' }} />
      <aside className="ud-scr" style={{ position: 'relative', width: 'min(520px,94vw)', background: CARD, borderLeft: `1px solid ${LINE}`, height: '100%', overflowY: 'auto', padding: '22px 24px 40px', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '-14px 0 40px rgba(22,22,15,0.10)', font: `400 14px ${SANS}`, color: INK }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <span style={{ width: 42, height: 42, flex: '0 0 42px', borderRadius: 13, background: av[0], color: av[1], display: 'flex', alignItems: 'center', justifyContent: 'center', font: `800 15px ${SANS}` }}>{initials(user.name)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <h2 style={{ margin: 0, font: `800 19px ${SANS}`, letterSpacing: '-0.022em' }}>{user.name}{you ? ' · tú' : ''}</h2>
              <span style={{ font: `500 11.5px ${MONO}`, color: MUTED, wordBreak: 'break-all' }}>{user.email}</span>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ border: `1px solid ${LINE}`, background: CARD, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, font: `700 14px ${SANS}`, color: '#54544C', flex: '0 0 30px' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, background: rd.bg, border: `1px solid ${rd.bd}`, borderRadius: 20, padding: '5px 11px', font: `700 12px ${SANS}`, color: rd.fg }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: rd.dot }} />{rd.label}
          </span>
          <span style={{ background: '#F3F2ED', border: `1px solid ${LINE}`, borderRadius: 20, padding: '5px 11px', font: `600 12px ${SANS}`, color: '#54544C' }}>{est.label}</span>
          <span style={{ background: '#F3F2ED', border: `1px solid ${LINE}`, borderRadius: 20, padding: '5px 11px', font: `600 12px ${SANS}`, color: '#54544C' }}>Alta {shortDate(user.createdAt)}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ font: `700 10.5px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>PERMISOS DEL ROL</div>
          {PERM_ROWS.map(([label, key]) => {
            const ok = perms.has(key as never);
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '8px 0', borderBottom: `1px solid ${ROW_LINE}` }}>
                <span style={{ font: `600 12.5px ${SANS}`, color: '#3E3E36' }}>{label}</span>
                <span style={{ font: `700 11px ${SANS}`, color: ok ? GREEN_FG : '#54544C', background: ok ? '#EAF5EE' : '#F3F2ED', border: `1px solid ${ok ? '#CBE5D6' : LINE}`, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>{ok ? 'Sí' : 'No'}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ font: `700 10.5px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>HISTORIAL DE ACTIVIDAD</div>
            <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>
              {total ? `${n(total)} eventos${act?.firstAt ? ` · desde ${shortDate(act.firstAt)}` : ''}` : 'sin actividad'}
            </span>
          </div>

          {act && act.auditAvailable === false ? (
            <div style={{ background: AMBER_SOFT, border: `1px solid #F4E2AE`, borderRadius: 12, padding: '11px 13px', font: `500 12px ${SANS}`, color: '#8C6A00' }}>
              El historial de auditoría no está disponible: el rol de base de datos de runtime no tiene lectura sobre <code style={{ font: `500 11px ${MONO}` }}>app.audit_logs</code> (tabla append-only). Requiere una decisión de permisos.
            </div>
          ) : isAdmin && canDownload ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" onClick={() => onDownload(user.id)} style={{ border: 'none', cursor: 'pointer', background: INK, color: '#fff', borderRadius: 9, padding: '8px 13px', font: `700 12px ${SANS}` }}>Descargar historial completo</button>
              <button type="button" onClick={() => onDownload(user.id, `&page=${logPage}`)} style={{ cursor: 'pointer', border: `1px solid ${LINE}`, background: CARD, color: INK, borderRadius: 9, padding: '8px 13px', font: `700 12px ${SANS}` }}>Descargar esta página</button>
            </div>
          ) : (
            <div style={{ background: AMBER_SOFT, border: `1px solid #F4E2AE`, borderRadius: 12, padding: '11px 13px', font: `500 12px ${SANS}`, color: '#8C6A00' }}>
              Tu rol no puede descargar historiales. Pide a un administrador el archivo o el cambio de permisos.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {logLoading && !act ? (
              [0, 1, 2, 3].map((i) => <div key={i} style={{ height: 34, background: '#F3F2ED', borderRadius: 8, margin: '5px 0' }} />)
            ) : (act?.data.length ?? 0) === 0 ? (
              <div style={{ padding: '14px 0', font: `500 12px ${SANS}`, color: MUTED }}>Sin eventos registrados para esta persona.</div>
            ) : act!.data.map((l) => (
              <div key={l.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '10px 0', borderBottom: `1px solid ${ROW_LINE}` }}>
                <span style={{ width: 7, height: 7, borderRadius: 7, background: /Export|Descarg/.test(l.label) ? '#E0A800' : /Inició sesión/.test(l.label) ? '#1B7F4B' : '#C9C8C0', marginTop: 6, flex: '0 0 7px' }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 auto' }}>
                  <span style={{ font: `600 12.5px ${SANS}` }}>{l.label}</span>
                  <span style={{ font: `500 11px ${MONO}`, color: MUTED }}>{dtLabel(l.at)} · {l.ip}</span>
                </span>
                {isAdmin && canDownload && (
                  <button type="button" onClick={() => onDownload(user.id, `&eventId=${l.id}`)} title="Descargar este evento"
                    style={{ border: `1px solid ${LINE}`, background: CARD, cursor: 'pointer', borderRadius: 8, padding: '4px 8px', font: `700 11px ${SANS}`, color: INK, flex: '0 0 auto' }}>CSV</button>
                )}
              </div>
            ))}
          </div>

          {total > 8 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4 }}>
              <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>{`${logPage * 8 + 1}–${Math.min(total, (logPage + 1) * 8)} de ${total}`}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setLogPage((p) => Math.max(0, p - 1))} disabled={logPage === 0} style={pBtn(logPage === 0)}>Anterior</button>
                <button type="button" onClick={() => setLogPage((p) => Math.min(maxLogPage, p + 1))} disabled={logPage >= maxLogPage} style={pBtn(logPage >= maxLogPage)}>Siguiente</button>
              </div>
            </div>
          )}
        </div>

        {isAdmin && (
          <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: `1px solid #EFEEE9`, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ font: `700 10.5px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>ADMINISTRAR ACCESO</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ROLE_ORDER.map((r) => {
                const active = user.role === r;
                const blocked = !canChangeRole || you || (lastAdmin && r !== 'Administrador');
                return (
                  <button key={r} type="button" disabled={blocked || busy} onClick={() => onSetRole(user.id, r)}
                    title={you ? 'No puedes modificar tu propio perfil' : lastAdmin && r !== 'Administrador' ? 'Debe quedar al menos un administrador' : ''}
                    style={{ cursor: blocked ? 'not-allowed' : 'pointer', border: `1px solid ${active ? INK : LINE}`, background: active ? INK : CARD, color: active ? '#fff' : blocked ? '#B4B3A6' : '#3E3E36', borderRadius: 9, padding: '7px 12px', font: `700 12px ${SANS}` }}>
                    {ROLE_DEFS[r].label}
                  </button>
                );
              })}
            </div>
            <button type="button" disabled={!canDisable || you || lastAdmin || busy} onClick={() => onAskRemove(user.id)}
              title={you ? 'No puedes modificar tu propio perfil' : lastAdmin ? 'Debe quedar al menos un administrador' : ''}
              style={{ alignSelf: 'flex-start', cursor: (!canDisable || you || lastAdmin) ? 'not-allowed' : 'pointer', border: `1px solid #F0D5CE`, background: '#FBEDEA', color: (!canDisable || you || lastAdmin) ? '#C9A9A2' : RED_FG, borderRadius: 9, padding: '8px 13px', font: `700 12px ${SANS}` }}>
              Eliminar rol y quitar acceso
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

// ── Invite modal ──────────────────────────────────────────────────────────────
function InviteModal({ invite, setInvite, onSend, onClose, busy }: {
  invite: { emails: string; name: string; role: RoleId; notify: boolean };
  setInvite: (v: { emails: string; name: string; role: RoleId; notify: boolean }) => void;
  onSend: () => void; onClose: () => void; busy: boolean;
}) {
  const list = invite.emails.split(/[,;\s]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(22,22,15,0.30)' }} />
      <div style={{ position: 'relative', width: 'min(560px,100%)', maxHeight: '88vh', overflowY: 'auto', background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 24px 60px rgba(22,22,15,0.18)', font: `400 14px ${SANS}`, color: INK }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <h2 style={{ margin: 0, font: `800 19px ${SANS}`, letterSpacing: '-0.022em' }}>Invitar personas</h2>
            <p style={{ margin: 0, font: `500 12.5px ${SANS}`, color: MUTED, maxWidth: '48ch' }}>Reciben un correo de Neon Auth para definir su contraseña. El enlace vence en 7 días.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ border: `1px solid ${LINE}`, background: CARD, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, font: `700 14px ${SANS}`, color: '#54544C', flex: '0 0 30px' }}>×</button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: `700 11.5px ${SANS}`, color: '#3E3E36' }}>Correos</span>
          <input value={invite.emails} onChange={(e) => setInvite({ ...invite, emails: e.target.value })} placeholder="nombre@empresa.com, otro@empresa.com"
            style={{ border: `1px solid ${LINE}`, background: '#FBFBF9', borderRadius: 10, padding: '11px 13px', font: `500 12.5px ${MONO}`, color: INK, outline: 'none' }} />
          <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>Separa varios con coma. {list.length ? `${list.length} correo(s) válido(s)` : 'Aún no hay correos válidos.'}</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: `700 11.5px ${SANS}`, color: '#3E3E36' }}>Nombre a mostrar <span style={{ color: MUTED, fontWeight: 500 }}>(opcional — se deriva del correo)</span></span>
          <input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} placeholder="Nombre Apellido"
            style={{ border: `1px solid ${LINE}`, background: '#FBFBF9', borderRadius: 10, padding: '11px 13px', font: `500 12.5px ${SANS}`, color: INK, outline: 'none' }} />
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ font: `700 11.5px ${SANS}`, color: '#3E3E36' }}>Rol</span>
          {ROLE_ORDER.map((r) => {
            const active = invite.role === r;
            return (
              <button key={r} type="button" onClick={() => setInvite({ ...invite, role: r })}
                style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 11, alignItems: 'flex-start', border: `1px solid ${active ? '#F4E2AE' : LINE}`, background: active ? '#FFFDF4' : CARD, borderRadius: 12, padding: '12px 13px' }}>
                <span style={{ width: 15, height: 15, flex: '0 0 15px', borderRadius: 15, border: `1.5px solid ${active ? '#E0A800' : '#C9C8C0'}`, background: active ? '#E0A800' : 'transparent', marginTop: 2, boxShadow: active ? 'inset 0 0 0 2px #FFFFFF' : 'none' }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ font: `700 12.5px ${SANS}` }}>{ROLE_DEFS[r].label}</span>
                  <span style={{ font: `500 11.5px ${SANS}`, color: '#5C5C54' }}>{ROLE_DEFS[r].desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#FBFBF9', border: `1px solid #EFEEE9`, borderRadius: 12, padding: '11px 13px' }}>
          <input type="checkbox" checked={invite.notify} onChange={(e) => setInvite({ ...invite, notify: e.target.checked })} style={{ width: 15, height: 15, accentColor: INK, cursor: 'pointer' }} />
          <span style={{ font: `600 12px ${SANS}`, color: '#3E3E36' }}>Avisarme cuando acepten la invitación</span>
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', borderTop: `1px solid #EFEEE9`, paddingTop: 14 }}>
          <button type="button" onClick={onClose} style={{ cursor: 'pointer', border: `1px solid ${LINE}`, background: CARD, color: INK, borderRadius: 10, padding: '10px 15px', font: `700 12.5px ${SANS}` }}>Cancelar</button>
          <button type="button" onClick={onSend} disabled={list.length === 0 || busy}
            style={{ border: 'none', cursor: list.length === 0 || busy ? 'not-allowed' : 'pointer', background: list.length === 0 ? '#EAE9E3' : INK, color: list.length === 0 ? '#9A9A8F' : '#fff', borderRadius: 10, padding: '10px 15px', font: `700 12.5px ${SANS}` }}>
            {busy ? 'Enviando…' : list.length > 1 ? `Enviar ${list.length} invitaciones` : 'Enviar invitación'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function ConfirmModal({ names, onCancel, onConfirm }: { names: string[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(22,22,15,0.30)' }} />
      <div style={{ position: 'relative', width: 'min(430px,100%)', background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 60px rgba(22,22,15,0.18)', font: `400 14px ${SANS}`, color: INK }}>
        <h2 style={{ margin: 0, font: `800 17px ${SANS}`, letterSpacing: '-0.02em' }}>
          {names.length === 1 ? `¿Eliminar el rol de ${names[0].split(' ')[0]}?` : `¿Eliminar ${names.length} roles?`}
        </h2>
        <p style={{ margin: 0, font: `500 12.5px ${SANS}`, color: '#5C5C54' }}>
          {names.length === 1
            ? `${names[0]} perderá el acceso al panel de inmediato. Puedes enviar una nueva invitación después.`
            : `Estas personas perderán el acceso al panel: ${names.join(', ')}.`}
        </p>
        <div style={{ background: '#FBFBF9', border: `1px solid #EFEEE9`, borderRadius: 12, padding: '11px 13px', font: `500 12px ${SANS}`, color: '#5C5C54' }}>
          El historial de actividad se conserva y sigue siendo descargable por un administrador.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 2 }}>
          <button type="button" onClick={onCancel} style={{ cursor: 'pointer', border: `1px solid ${LINE}`, background: CARD, color: INK, borderRadius: 10, padding: '10px 15px', font: `700 12.5px ${SANS}` }}>Cancelar</button>
          <button type="button" onClick={onConfirm} style={{ border: 'none', cursor: 'pointer', background: RED_FG, color: '#fff', borderRadius: 10, padding: '10px 15px', font: `700 12.5px ${SANS}` }}>Eliminar rol</button>
        </div>
      </div>
    </div>
  );
}
