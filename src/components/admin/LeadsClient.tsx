/**
 * src/components/admin/LeadsClient.tsx
 *
 * Leads de portabilidad — vista `/admin/leads`.
 * Diseño: "Leads.dc.html" (Claude Design), replicado a exactitud.
 *
 * Datos reales de /api/admin/leads (PII descifrada solo con permiso
 * `leads.detail.view`). El detalle abre un drawer lateral (LeadDrawer).
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hasPermission } from '@/lib/rbac';
import type { AdminSession } from '@/lib/session';
import LeadDrawer from './LeadDrawer';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const INK = '#16160F';
const MUTED = '#6E6E64';
const LINE = '#E6E5E0';
const CARD = '#FFFFFF';
const BG = '#F5F5F3';
const CHIP_BG = '#F5F5F3';
const CHIP_BD = '#EDECE6';
const AMBER = '#FFC72C';
const AMBER_SOFT = '#FFF6DC';

const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const CHANNELS: Record<string, { label: string; chip: string; color: string }> = {
  google_ads: { label: 'Google Ads', chip: 'Google Ads', color: '#16160F' },
  meta_ads: { label: 'Meta Ads', chip: 'Meta Ads', color: '#4A4A42' },
  paid_other: { label: 'Otros pagados', chip: 'Otros pagados', color: '#6E6E64' },
  organic: { label: 'Búsqueda orgánica', chip: 'Orgánico', color: '#9A9A8F' },
  referral: { label: 'Referral', chip: 'Referral', color: '#E0DFD2' },
  direct: { label: 'Directo', chip: 'Directo', color: '#C0BFB3' },
  other: { label: 'Sin atribuir', chip: 'Sin atribuir', color: '#D2D1C4' },
};

const STATE_NAMES: Record<string, string> = {
  AG: 'Aguascalientes', BC: 'Baja California', BS: 'Baja California Sur', CM: 'Campeche',
  CS: 'Chiapas', CH: 'Chihuahua', CO: 'Coahuila', CL: 'Colima', DF: 'Ciudad de México',
  DG: 'Durango', GT: 'Guanajuato', GR: 'Guerrero', HG: 'Hidalgo', JC: 'Jalisco',
  MC: 'Estado de México', MN: 'Michoacán', MS: 'Morelos', NT: 'Nayarit', NL: 'Nuevo León',
  OA: 'Oaxaca', PU: 'Puebla', QT: 'Querétaro', QR: 'Quintana Roo', SL: 'San Luis Potosí',
  SI: 'Sinaloa', SO: 'Sonora', TB: 'Tabasco', TM: 'Tamaulipas', TL: 'Tlaxcala',
  VZ: 'Veracruz', YN: 'Yucatán', ZS: 'Zacatecas',
};

/** status técnico → pill del diseño */
const STATUS_PILL: Record<string, { label: string; fg: string; bg: string; bd: string }> = {
  delivered: { label: 'Entregado', fg: '#1B6B44', bg: '#EAF5EE', bd: '#CBE5D6' },
  received: { label: 'En validación', fg: '#8C6A00', bg: '#FFF6DC', bd: '#F4E2AE' },
  processing: { label: 'En validación', fg: '#8C6A00', bg: '#FFF6DC', bd: '#F4E2AE' },
  duplicate: { label: 'Duplicado', fg: '#54544C', bg: '#F3F2ED', bd: '#E6E5E0' },
  failed: { label: 'Fallido', fg: '#A33A2A', bg: '#FBEDEA', bd: '#F0D5CE' },
};

type TabId = 'todos' | 'entregado' | 'validacion' | 'duplicado' | 'fallido';
const TAB_STATUS: Record<TabId, string> = {
  todos: '', entregado: 'delivered', validacion: 'received,processing', duplicado: 'duplicate', fallido: 'failed',
};
const TAB_DEFS: { id: TabId; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'entregado', label: 'Entregados' },
  { id: 'validacion', label: 'En validación' },
  { id: 'duplicado', label: 'Duplicados' },
  { id: 'fallido', label: 'Fallidos' },
];

const CH_CHIPS: { id: string; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'google_ads', label: 'Google Ads' },
  { id: 'meta_ads', label: 'Meta Ads' },
  { id: 'organic', label: 'Orgánico' },
];

const PER_PAGE = 15;
const GRID = '34px 0.85fr 1.5fr 1.5fr 1fr 1fr 1fr 62px';

interface Lead {
  id: string;
  publicReference: string;
  status: string;
  stateCode: string | null;
  planCode: string;
  sourceCategory: string | null;
  utmCampaign: string | null;
  createdAt: string;
  pii?: { fullName: string; phone: string; birthdate: string; age: number | null };
}
interface ApiResponse {
  data: Lead[];
  counts: Record<string, number>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

// ── Formato ───────────────────────────────────────────────────────────────────
const fmtPhone = (p: string) => {
  const d = (p || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}` : p;
};

function fmtWhen(iso: string, nowMs: number) {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' });
  const dayKey = (t: number) => {
    const x = new Date(t - 6 * 3600 * 1000);
    return `${x.getUTCFullYear()}-${x.getUTCMonth()}-${x.getUTCDate()}`;
  };
  const today = dayKey(nowMs), yest = dayKey(nowMs - 86400000), row = dayKey(d.getTime());
  const fecha = row === today ? 'hoy' : row === yest ? 'ayer'
    : `${new Date(d.getTime() - 6 * 3600 * 1000).getUTCDate()} ${MONTHS[new Date(d.getTime() - 6 * 3600 * 1000).getUTCMonth()]}`;
  return { hora, fecha };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function LeadsClient({ session }: { session: AdminSession }) {
  const canExport = hasPermission(session.role, 'leads.export');

  const [nowMs] = useState(() => Date.now());
  const [tab, setTab] = useState<TabId>('todos');
  const [ch, setCh] = useState('all');
  const [q, setQ] = useState('');
  const [sortK, setSortK] = useState<'folio' | 't'>('t');
  const [sortD, setSortD] = useState(-1);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [bulkNote, setBulkNote] = useState('');

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const qDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLeads = useCallback(
    async (opts: { tab: TabId; ch: string; q: string; sortK: 'folio' | 't'; sortD: number; page: number }, id: number) => {
      const params = new URLSearchParams({
        page: String(opts.page), pageSize: String(PER_PAGE),
        sort: opts.sortK === 'folio' ? 'folio' : 'recibido',
        dir: opts.sortD < 0 ? 'desc' : 'asc',
      });
      const st = TAB_STATUS[opts.tab];
      if (st) params.set('status', st);
      if (opts.ch !== 'all') params.set('sourceCategory', opts.ch);
      if (opts.q.trim()) params.set('q', opts.q.trim());
      const res = await fetch(`/api/admin/leads?${params.toString()}`);
      const json = await res.json();
      if (id !== reqId.current) return;
      if (json.error) { setError(String(json.error)); return; }
      setData(json as ApiResponse);
    },
    [],
  );

  const load = useCallback(
    (opts: { tab: TabId; ch: string; q: string; sortK: 'folio' | 't'; sortD: number; page: number }) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      fetchLeads(opts, id)
        .catch(() => { if (id === reqId.current) setError('No se pudieron cargar los leads'); })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    },
    [fetchLeads],
  );

  useEffect(() => {
    const id = ++reqId.current;
    fetchLeads({ tab: 'todos', ch: 'all', q: '', sortK: 't', sortD: -1, page: 1 }, id)
      .catch(() => { if (id === reqId.current) setError('No se pudieron cargar los leads'); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = (over: Partial<{ tab: TabId; ch: string; q: string; sortK: 'folio' | 't'; sortD: number; page: number }>) => {
    load({ tab, ch, q, sortK, sortD, page, ...over });
  };

  const pickTab = (t: TabId) => { setTab(t); setPage(1); reload({ tab: t, page: 1 }); };
  const pickCh = (c: string) => { const next = c; setCh(next); setPage(1); reload({ ch: next, page: 1 }); };
  const onSearch = (v: string) => {
    setQ(v); setPage(1);
    if (qDebounce.current) clearTimeout(qDebounce.current);
    qDebounce.current = setTimeout(() => reload({ q: v, page: 1 }), 350);
  };
  const toggleSort = (k: 'folio' | 't') => {
    const nd = sortK === k ? -sortD : -1;
    setSortK(k); setSortD(nd); reload({ sortK: k, sortD: nd });
  };
  const goPage = (delta: number) => {
    const next = Math.max(1, Math.min(data?.pagination.totalPages ?? 1, page + delta));
    if (next === page) return;
    setPage(next); reload({ page: next });
  };
  const clearFilters = () => {
    setTab('todos'); setCh('all'); setQ(''); setPage(1);
    reload({ tab: 'todos', ch: 'all', q: '', page: 1 });
  };

  const counts = data?.counts ?? { received: 0, processing: 0, delivered: 0, failed: 0, duplicate: 0 };
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabCount = (id: TabId) =>
    id === 'todos' ? totalAll
      : id === 'entregado' ? counts.delivered
        : id === 'validacion' ? counts.received + counts.processing
          : id === 'duplicado' ? counts.duplicate
            : counts.failed;

  const rows = useMemo(() => {
    if (!data) return [];
    return data.data.map((r) => {
      const meta = CHANNELS[r.sourceCategory ?? 'other'] ?? CHANNELS.other;
      const pill = STATUS_PILL[r.status] ?? { label: r.status, fg: MUTED, bg: '#F3F2ED', bd: LINE };
      const when = fmtWhen(r.createdAt, nowMs);
      return {
        id: r.id,
        folio: r.publicReference.slice(0, 8),
        nombre: r.pii?.fullName ?? 'Sin acceso a datos',
        tel: r.pii ? fmtPhone(r.pii.phone) : '— — —',
        canal: meta.label, camp: r.utmCampaign || '(sin campaña)', col: meta.color,
        ciudad: r.stateCode ? (STATE_NAMES[r.stateCode] ?? r.stateCode) : '—',
        hora: when.hora, fecha: when.fecha,
        estado: pill.label, fg: pill.fg, bg: pill.bg, bd: pill.bd,
      };
    });
  }, [data, nowMs]);

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;
  const isEmpty = !loading && !error && total === 0;
  const pageNote = total ? `${(page - 1) * PER_PAGE + 1}–${Math.min(total, page * PER_PAGE)} de ${total}` : '0 resultados';

  const pageIds = rows.map((r) => r.id);
  const allSel = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const toggleAll = () => setSel((s) => {
    const next = new Set(s);
    if (allSel) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    return next;
  });
  const toggleRow = (id: string) => setSel((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const bulk = (kind: 'crm' | 'dup' | 'none') => {
    if (kind === 'none') { setSel(new Set()); setBulkNote(''); return; }
    setBulkNote(kind === 'crm' ? 'El reenvío por lote al CRM estará disponible próximamente.' : 'El marcado por lote de duplicados estará disponible próximamente.');
    setSel(new Set());
  };

  const sortArrow = (k: 'folio' | 't') => (sortK === k ? (sortD < 0 ? '↓' : '↑') : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, font: `400 14px ${SANS}`, color: INK, maxWidth: 1440, margin: '0 auto', position: 'relative' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .lc-scr::-webkit-scrollbar { height: 8px; width: 8px; }
        .lc-scr::-webkit-scrollbar-thumb { background: #DDDCD5; border-radius: 8px; }
        .lc-row:hover { background: #FBFBF9 !important; }
      `}</style>

      {/* Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <span style={{ font: `700 11px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>BAIT PREPAGO · PORTABILIDAD</span>
          <h1 style={{ margin: 0, font: `800 28px ${SANS}`, letterSpacing: '-0.028em', lineHeight: 1.1 }}>Leads</h1>
          <p style={{ margin: 0, font: `500 13.5px ${SANS}`, color: MUTED, maxWidth: '62ch' }}>
            Formularios de portabilidad recibidos en la landing, con su estado de validación y envío al CRM.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: CARD, border: `1px solid ${LINE}`, borderRadius: 20, padding: '6px 12px' }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: '#1B7F4B', boxShadow: '0 0 0 3px rgba(27,127,75,0.14)' }} />
            <span style={{ font: `600 12px ${SANS}`, color: '#4B4B44' }}>{n(total)} en la vista actual</span>
          </div>
          {canExport ? (
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- descarga de archivo CSV (route handler), no una página
            <a href="/api/admin/leads/export" style={{ display: 'inline-block', background: INK, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 15px', font: `700 12.5px ${SANS}`, cursor: 'pointer', textDecoration: 'none' }}>
              Exportar CSV
            </a>
          ) : (
            <span title="Requiere permiso de exportación" style={{ background: '#EFEEE9', color: MUTED, borderRadius: 10, padding: '9px 15px', font: `700 12.5px ${SANS}` }}>
              Exportar CSV
            </span>
          )}
        </div>
      </header>

      {/* Filtros (sticky) */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '12px 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 20, boxShadow: '0 1px 0 rgba(22,22,15,0.03)' }}>
        <div className="lc-scr" style={{ display: 'flex', alignItems: 'center', gap: 4, background: CHIP_BG, border: `1px solid ${CHIP_BD}`, borderRadius: 11, padding: 3, overflowX: 'auto' }}>
          {TAB_DEFS.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} type="button" onClick={() => pickTab(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '7px 11px', font: `700 12.5px ${SANS}`, background: active ? INK : 'transparent', color: active ? '#fff' : '#5C5C54' }}>
                {t.label}
                <span style={{ font: `700 10.5px ${SANS}`, background: active ? '#3A3A31' : '#EAE9E3', color: active ? '#fff' : '#54544C', borderRadius: 20, padding: '1px 6px' }}>{n(tabCount(t.id))}</span>
              </button>
            );
          })}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: CHIP_BG, border: `1px solid ${CHIP_BD}`, borderRadius: 10, padding: '8px 11px', flex: '1 1 200px', minWidth: 180, maxWidth: 320 }}>
          <span style={{ width: 11, height: 11, border: '1.5px solid #9A9A8F', borderRadius: 11, flex: '0 0 11px' }} />
          <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Folio o teléfono (10 dígitos)"
            style={{ border: 'none', background: 'transparent', outline: 'none', font: `500 12.5px ${SANS}`, color: INK, width: '100%' }} />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: CHIP_BG, border: `1px solid ${CHIP_BD}`, borderRadius: 10, padding: '6px 10px' }}>
          <span style={{ font: `600 11.5px ${SANS}`, color: MUTED }}>Canal</span>
          {CH_CHIPS.map((c) => {
            const active = ch === c.id;
            return (
              <button key={c.id} type="button" onClick={() => pickCh(c.id)}
                style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '4px 9px', font: `700 12px ${SANS}`, whiteSpace: 'nowrap', background: active ? AMBER_SOFT : 'transparent', color: active ? INK : MUTED }}>
                {c.label}
              </button>
            );
          })}
        </div>

        <div style={{ flex: '1 1 20px' }} />
        <span style={{ font: `500 12px ${SANS}`, color: MUTED, whiteSpace: 'nowrap' }}>{n(total)} de {n(totalAll)} leads</span>
      </section>

      {bulkNote && (
        <div style={{ padding: '10px 15px', background: AMBER_SOFT, border: `1px solid #F4E2AE`, borderRadius: 12, color: '#8C6A00', font: `600 12.5px ${SANS}` }}>{bulkNote}</div>
      )}
      {error && (
        <div style={{ padding: '12px 15px', background: '#FBEDEA', border: `1px solid #F0D5CE`, borderRadius: 12, color: '#A33A2A', font: `600 12.5px ${SANS}` }}>{error}</div>
      )}

      {/* Barra de selección */}
      {sel.size > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, background: INK, borderRadius: 14, padding: '11px 15px' }}>
          <span style={{ font: `700 12.5px ${SANS}`, color: '#fff' }}>{sel.size} seleccionado{sel.size === 1 ? '' : 's'}</span>
          <div style={{ flex: '1 1 20px' }} />
          <button type="button" onClick={() => bulk('crm')} style={{ border: 'none', cursor: 'pointer', background: AMBER, color: INK, borderRadius: 9, padding: '7px 13px', font: `700 12px ${SANS}` }}>Reenviar al CRM</button>
          <button type="button" onClick={() => bulk('dup')} style={{ cursor: 'pointer', background: 'transparent', color: '#fff', border: `1px solid #4A4A42`, borderRadius: 9, padding: '7px 13px', font: `700 12px ${SANS}` }}>Marcar duplicado</button>
          <button type="button" onClick={() => bulk('none')} style={{ border: 'none', cursor: 'pointer', background: 'transparent', color: '#C9C8C0', font: `700 12px ${SANS}`, textDecoration: 'underline', textUnderlineOffset: 3, padding: '7px 4px' }}>Quitar selección</button>
        </div>
      )}

      {/* Tabla */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="lc-scr" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '12px 16px', background: '#FBFBF9', borderBottom: `1px solid #EFEEE9`, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>
              <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Seleccionar todo" style={{ width: 15, height: 15, accentColor: INK, cursor: 'pointer' }} />
              <button type="button" onClick={() => toggleSort('folio')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textAlign: 'left', padding: 0 }}>FOLIO {sortArrow('folio')}</button>
              <span>LEAD</span>
              <span>CANAL / CAMPAÑA</span>
              <span>CIUDAD</span>
              <button type="button" onClick={() => toggleSort('t')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textAlign: 'left', padding: 0 }}>RECIBIDO {sortArrow('t')}</button>
              <span>ESTADO</span>
              <span />
            </div>

            {loading && !data ? (
              [0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: `1px solid #F5F4EF` }}>
                  <span />
                  {[58, 120, 130, 90, 70, 80, 0].map((w, j) => (
                    <span key={j} style={{ height: 12, width: w || undefined, background: '#EFEEE9', borderRadius: 6 }} />
                  ))}
                </div>
              ))
            ) : rows.map((r) => (
              <div key={r.id} className="lc-row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: `1px solid #F5F4EF`, background: sel.has(r.id) ? '#FFFDF4' : CARD }}>
                <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleRow(r.id)} aria-label="Seleccionar lead" style={{ width: 15, height: 15, accentColor: INK, cursor: 'pointer' }} />
                <span style={{ font: `500 12.5px ${MONO}` }}>{r.folio}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ font: `700 13px ${SANS}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.nombre}</span>
                  <span style={{ font: `500 11.5px ${MONO}`, color: MUTED }}>{r.tel}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `600 12.5px ${SANS}` }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: r.col, flex: '0 0 7px' }} />{r.canal}
                  </span>
                  <span style={{ font: `500 11px ${MONO}`, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.camp}</span>
                </span>
                <span style={{ font: `500 12.5px ${SANS}`, color: '#4B4B44', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ciudad}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: `500 12.5px ${MONO}` }}>{r.hora}</span>
                  <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>{r.fecha}</span>
                </span>
                <span style={{ font: `700 11px ${SANS}`, color: r.fg, background: r.bg, border: `1px solid ${r.bd}`, borderRadius: 20, padding: '3px 9px', justifySelf: 'start', whiteSpace: 'nowrap' }}>{r.estado}</span>
                <button type="button" onClick={() => setOpen(r.id)} style={{ border: `1px solid ${LINE}`, background: CARD, cursor: 'pointer', borderRadius: 8, padding: '5px 10px', font: `700 11.5px ${SANS}`, color: INK }}>Ver</button>
              </div>
            ))}
          </div>
        </div>

        {isEmpty && (
          <div style={{ padding: '56px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: BG, border: `1px solid ${LINE}` }} />
            <div style={{ font: `800 16px ${SANS}` }}>Ningún lead coincide</div>
            <div style={{ font: `500 13px ${SANS}`, color: MUTED, maxWidth: '42ch' }}>Prueba con otro folio o quita los filtros de estado y canal.</div>
            <button type="button" onClick={clearFilters} style={{ marginTop: 6, border: 'none', background: INK, color: '#fff', borderRadius: 10, padding: '9px 15px', font: `700 12.5px ${SANS}`, cursor: 'pointer' }}>Limpiar filtros</button>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: '#FBFBF9' }}>
          <span style={{ font: `500 12px ${SANS}`, color: MUTED }}>{pageNote}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" onClick={() => goPage(-1)} disabled={page <= 1}
              style={{ cursor: page <= 1 ? 'default' : 'pointer', border: `1px solid ${LINE}`, background: CARD, borderRadius: 8, padding: '6px 11px', font: `700 12px ${SANS}`, color: page <= 1 ? '#B4B3A6' : INK }}>Anterior</button>
            <button type="button" onClick={() => goPage(1)} disabled={page >= totalPages}
              style={{ cursor: page >= totalPages ? 'default' : 'pointer', border: `1px solid ${LINE}`, background: CARD, borderRadius: 8, padding: '6px 11px', font: `700 12px ${SANS}`, color: page >= totalPages ? '#B4B3A6' : INK }}>Siguiente</button>
          </div>
        </div>
      </section>

      {open && <LeadDrawer id={open} session={session} onClose={() => setOpen(null)} />}
    </div>
  );
}

const NF = new Intl.NumberFormat('es-MX');
const n = (v: number) => NF.format(Math.round(v || 0));
