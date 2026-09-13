/**
 * src/components/admin/LogsClient.tsx
 *
 * Logs de entrega a Intelix — vista `/admin/logs`.
 * Diseño: "Logs.dc.html" (Claude Design), replicado a exactitud.
 *
 * Datos reales de /api/admin/logs (app.delivery_outbox ⨝ app.leads ⨝
 * app.lead_attribution). El prototipo original usaba datos sintéticos (PRNG);
 * esta implementación usa SÓLO datos reales. Lo que el backend no guarda
 * (respuesta cruda del proveedor, log por-intento) se muestra con un estado
 * honesto, nunca inventado.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const INK = '#16160F';
const MUTED = '#6E6E64';
const LINE = '#E6E5E0';
const CARD = '#FFFFFF';
const AMBER = '#FFC72C';
const AMBER_SOFT = '#FFF6DC';
const AMBER_BD = '#F4E2AE';
const GOLD = '#8C6A00';
const RED_FG = '#A33A2A';
const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type StateId = 'delivered' | 'pending' | 'processing' | 'failed' | 'dead';

const ST: Record<StateId, { label: string; tab: string; dot: string; fg: string; bg: string; bd: string }> = {
  delivered: { label: 'Entregado', tab: 'Entregados', dot: '#1B7F4B', fg: '#1B6B44', bg: '#EAF5EE', bd: '#CBE5D6' },
  pending: { label: 'En cola', tab: 'En cola', dot: '#E0A800', fg: GOLD, bg: AMBER_SOFT, bd: AMBER_BD },
  processing: { label: 'Procesando', tab: 'Procesando', dot: '#C9A227', fg: '#6B5200', bg: '#FFFDF4', bd: '#F0DFAB' },
  failed: { label: 'Falló', tab: 'Fallidos', dot: RED_FG, fg: RED_FG, bg: '#FBEDEA', bd: '#F0D5CE' },
  dead: { label: 'Definitivo', tab: 'Definitivos', dot: '#5C1F14', fg: '#7A2718', bg: '#F7E0DA', bd: '#E3B5AB' },
};
const ORDER: StateId[] = ['delivered', 'pending', 'processing', 'failed', 'dead'];

const RANGES = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'all', label: 'Todo' },
];

const STATE_NAMES: Record<string, string> = {
  AG: 'Aguascalientes', BC: 'Baja California', BS: 'Baja California Sur', CM: 'Campeche',
  CS: 'Chiapas', CH: 'Chihuahua', CO: 'Coahuila', CL: 'Colima', DF: 'Ciudad de México',
  DG: 'Durango', GT: 'Guanajuato', GR: 'Guerrero', HG: 'Hidalgo', JC: 'Jalisco',
  MC: 'Estado de México', MN: 'Michoacán', MS: 'Morelos', NT: 'Nayarit', NL: 'Nuevo León',
  OA: 'Oaxaca', PU: 'Puebla', QT: 'Querétaro', QR: 'Quintana Roo', SL: 'San Luis Potosí',
  SI: 'Sinaloa', SO: 'Sonora', TB: 'Tabasco', TM: 'Tamaulipas', TL: 'Tlaxcala',
  VZ: 'Veracruz', YN: 'Yucatán', ZS: 'Zacatecas',
};

// ── Catálogo de validación de Intelix (espejo de INTELIX_VALIDATION_ERRORS
// en src/lib/outbox/errors.ts) ─────────────────────────────────────────────
const INTELIX_VALIDATION_ERRORS: Record<string, { field: string; message: string }> = {
  '3001': { field: 'email', message: 'El campo email es obligatorio.' },
  '3002': { field: 'email', message: 'El formato del email no es válido.' },
  '3003': { field: 'dn', message: 'El número telefónico es obligatorio.' },
  '3004': { field: 'dn', message: 'El número telefónico debe tener exactamente 10 dígitos.' },
  '3005': { field: 'imei', message: 'El campo IMEI es obligatorio.' },
  '3006': { field: 'imei', message: 'El campo IMEI solo puede contener números.' },
  '3007': { field: 'nombre', message: 'El nombre es obligatorio.' },
  '3008': { field: 'apellidos', message: 'Los apellidos son obligatorios.' },
  '3009': { field: 'apellidos', message: 'Los apellidos solo pueden contener letras y espacios.' },
  '3010': { field: 'nombre', message: 'El nombre solo puede contener letras y espacios.' },
  '3011': { field: 'plan_migracion', message: 'El plan de migración es obligatorio.' },
  '3013': { field: 'estado_nacimiento', message: 'El estado de nacimiento es obligatorio.' },
  '3014': { field: 'estado_nacimiento', message: 'El estado de nacimiento no es válido.' },
  '3015': { field: 'nip', message: 'El NIP es obligatorio.' },
  '3016': { field: 'nip', message: 'El NIP debe tener exactamente 4 dígitos.' },
  '3017': { field: 'fecha_nacimiento', message: 'La fecha de nacimiento es obligatoria.' },
  '3018': { field: 'fecha_nacimiento', message: 'El formato de fecha de nacimiento debe ser DD/MM/YYYY (ejemplo: 03/03/1993).' },
  '3019': { field: 'curp', message: 'El CURP es obligatorio.' },
  '3020': { field: 'curp', message: 'El formato del CURP no es válido.' },
  '3021': { field: 'rfc', message: 'El RFC es obligatorio.' },
  '3022': { field: 'rfc', message: 'El formato del RFC no es válido.' },
  '3023': { field: 'dn', message: 'Ya tenemos un registro en proceso con este número telefónico.' },
  '3024': { field: 'plan_migracion', message: 'El plan de migración no es válido.' },
};

// ── Traducción de códigos de error (espejo de src/lib/outbox/errors.ts) ───────
// REGLA: solo se reintenta timeout / 5xx / 429 / fallo de red al webhook.
// Todo lo demás (validación, auth, duplicado, elegibilidad, desconocido) es
// permanente — un reintento no lo resuelve.
function errorLabel(code: string): { label: string; retryable: boolean } {
  const raw = String(code || '').trim();
  if (raw in INTELIX_VALIDATION_ERRORS) return { label: 'Datos rechazados por validación (Intelix)', retryable: false };
  const c = raw.toLowerCase();
  if (!c) return { label: 'Sin código', retryable: false };
  if (c === 'timeout' || c.includes('timeout') || c.includes('aborterror') || c.includes('etimedout'))
    return { label: 'Tiempo de espera agotado', retryable: true };
  if (/^http_5\d\d$/.test(c) || c === 'http_429') return { label: 'Error temporal de Intelix', retryable: true };
  if (c.includes('fetchfailed') || c.includes('network') || c.includes('econn') || c.includes('enotfound') || c.includes('socket') || c.includes('dns'))
    return { label: 'No se pudo conectar con Intelix', retryable: true };
  if (c === 'http_401' || c === 'http_403' || c.includes('auth') || c.includes('token') || c.includes('unauthorized'))
    return { label: 'Credenciales rechazadas', retryable: false };
  if (c.includes('http_409') || c.includes('dup') || c.includes('duplicad') || c.includes('duplicate') || c.includes('ya tenemos') || c.includes('en proceso') || c.includes('ya existe'))
    return { label: 'Registro duplicado en Intelix', retryable: false };
  if (c === 'http_422' || c === 'http_400' || c.includes('validation') || c.includes('validac') || c.includes('nip') || c.includes('invalid'))
    return { label: 'Datos rechazados por validación', retryable: false };
  if (c.includes('carrier') || c.includes('compania') || c.includes('elegible'))
    return { label: 'Compañía no elegible', retryable: false };
  if (c === 'lead_missing') return { label: 'Lead no encontrado', retryable: false };
  return { label: `Error de Intelix (${code})`, retryable: false };
}

// ── Tipos del API ─────────────────────────────────────────────────────────────
interface Row {
  id: string;
  leadId: string;
  status: StateId;
  attempts: number;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  leaseExpiresAt: string | null;
  folio: string;
  leadStatus: string;
  stateCode: string | null;
  sourceCategory: string | null;
  pii: { fullName: string; phone: string; email: string } | null;
}
interface ApiResp {
  data: Row[];
  counts: Record<StateId, number>;
  scopeTotal: number;
  errorOptions: { code: string; n: number }[];
  stats: { delivered: number; queued: number; failed: number; dead: number; attemptsAvg: number; rangeTotal: number };
  pagination: { page: number; perPage: number; total: number; totalPages: number };
  meta: { maxAttempts: number; canRetry: boolean; canViewPii: boolean; range: string; updatedAt: string };
  error?: string;
}
interface Detail {
  id: string; leadId: string; folio: string; status: StateId; attempts: number; maxAttempts: number;
  nextAttemptAt: string | null; deliveredAt: string | null; lastErrorCode: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastErrorPayload?: any;
  createdAt: string; updatedAt: string; leadCreatedAt: string; leadStatus: string;
  stateCode: string | null; planCode: string;
  attribution: { sourceCategory: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null };
  error: { code: string | null; label: string; detail: string; retryable: boolean; field: string | null } | null;
  rawResponseAvailable: boolean;
  pii: { fullName: string; phone: string; email: string } | null;
  canViewPii: boolean;
  retryable: boolean;
  noRetryNote: string | null;
  log: { t: string; at: string; dot: string }[];
}

// ── Formato ───────────────────────────────────────────────────────────────────
/** yyyy-mm-dd del instante en tz de negocio (CDMX). */
const mxDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
function dateParts(isoStr: string, nowMs: number) {
  if (!isoStr) return { hora: '—', fecha: '' };
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return { hora: '—', fecha: '' };
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' });
  const today = mxDay(nowMs);
  const rowDay = mxDay(d.getTime());
  const diffDays = Math.round((Date.parse(today) - Date.parse(rowDay)) / 86400000);
  let fecha: string;
  if (diffDays <= 0) fecha = 'hoy';
  else if (diffDays === 1) fecha = 'ayer';
  else {
    const [, mm, dd] = rowDay.split('-');
    fecha = `${parseInt(dd, 10)} ${MONTHS[parseInt(mm, 10) - 1]}`;
  }
  return { hora, fecha };
}
const fmtFull = (isoStr: string | null) =>
  isoStr
    ? new Date(isoStr).toLocaleString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        hour12: false, timeZone: 'America/Mexico_City',
      })
    : '—';
const shortFolio = (f: string) => (f || '').slice(0, 8);

// ── Component ─────────────────────────────────────────────────────────────────
export default function LogsClient({
  canRetry,
  canViewPii,
  canExportSensitive,
}: {
  canRetry: boolean;
  canViewPii: boolean;
  canExportSensitive: boolean;
}) {
  const [nowMs] = useState(() => Date.now());

  const [tab, setTab] = useState<'todos' | StateId>('todos');
  const [range, setRange] = useState('7d');
  const [err, setErr] = useState('all');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [sortK, setSortK] = useState<'fecha' | 'attempts'>('fecha');
  const [sortD, setSortD] = useState<-1 | 1>(-1);
  const [page, setPage] = useState(0);
  const [perPage] = useState(10);

  const [resp, setResp] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sel, setSel] = useState<Record<string, true>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [arch, setArch] = useState(true);
  const [toast, setToastState] = useState<{ msg: string; dot: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reqId = useRef(0);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, dot = AMBER) => {
    if (toastT.current) clearTimeout(toastT.current);
    setToastState({ msg, dot });
    toastT.current = setTimeout(() => setToastState(null), 3400);
  }, []);
  useEffect(() => () => { if (toastT.current) clearTimeout(toastT.current); }, []);

  // arch notice: persistencia ligera por navegador (setState sólo tras await)
  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.resolve();
      try {
        if (alive && localStorage.getItem('bait.logs.archHidden') === '1') setArch(false);
      } catch { /* private mode */ }
    })();
    return () => { alive = false; };
  }, []);
  const hideArch = () => {
    setArch(false);
    try { localStorage.setItem('bait.logs.archHidden', '1'); } catch { /* noop */ }
  };

  // debounce búsqueda
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set('tab', tab);
    p.set('range', range);
    p.set('err', err);
    if (qDebounced) p.set('q', qDebounced);
    p.set('sort', sortK);
    p.set('dir', sortD < 0 ? 'desc' : 'asc');
    p.set('page', String(page));
    p.set('perPage', String(perPage));
    return p.toString();
  }, [tab, range, err, qDebounced, sortK, sortD, page, perPage]);

  // Carga de la lista — setState sólo tras await (react-hooks/set-state-in-effect)
  const bump = useCallback(() => ++reqId.current, []);
  useEffect(() => {
    const id = bump();
    let alive = true;
    (async () => {
      await Promise.resolve();
      if (!alive || id !== reqId.current) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/logs?${params}`);
        const json = (await res.json()) as ApiResp;
        if (!alive || id !== reqId.current) return;
        if (!res.ok || json.error) { setError(json.error || `Error ${res.status}`); }
        else { setError(null); setResp(json); }
      } catch {
        if (alive && id === reqId.current) setError('No se pudieron cargar los logs');
      } finally {
        if (alive && id === reqId.current) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [params, bump, reloadTick]);

  const reload = useCallback(() => { setReloadTick((t) => t + 1); }, []);

  // ── Drawer ───────────────────────────────────────────────────────────────
  const closeDrawer = useCallback(() => { setOpenId(null); setDetail(null); }, []);
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      setDetail(null);
      try {
        const res = await fetch(`/api/admin/logs/${openId}`);
        // OJO: en éxito el endpoint devuelve `error` como OBJETO (el error de
        // Intelix clasificado) o null — NO es señal de fallo. Solo el status HTTP
        // lo es; ahí el body trae `{ error: "<string>" }`.
        const json = (await res.json()) as Detail & { error?: unknown };
        if (!alive) return;
        if (!res.ok) {
          const msg = typeof json?.error === 'string' ? json.error : 'No se pudo abrir el detalle';
          showToast(msg, RED_FG);
          setOpenId(null);
          return;
        }
        setDetail(json as Detail);
      } catch {
        if (alive) { showToast('No se pudo abrir el detalle', RED_FG); setOpenId(null); }
      }
    })();
    return () => { alive = false; };
  }, [openId, showToast, reloadTick]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, closeDrawer]);

  // ── Acciones ─────────────────────────────────────────────────────────────
  const doRetry = useCallback(async (ids: string[]) => {
    if (!canRetry || busy || ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/logs/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error || 'No se pudo re-encolar', RED_FG); return; }
      showToast(json.message || 'Reintento encolado', json.requeued ? '#1B7F4B' : '#E0A800');
      setSel({});
      reload();
      if (openId && ids.includes(openId)) closeDrawer();
    } catch {
      showToast('No se pudo re-encolar', RED_FG);
    } finally {
      setBusy(false);
    }
  }, [canRetry, busy, showToast, reload, openId, closeDrawer]);

  const rows = resp?.data ?? [];
  const counts = resp?.counts ?? { delivered: 0, pending: 0, processing: 0, failed: 0, dead: 0 };
  const scopeTotal = resp?.scopeTotal ?? 0;
  const maxAttempts = resp?.meta.maxAttempts ?? 5;
  const stats = resp?.stats;
  const pag = resp?.pagination ?? { page: 0, perPage, total: 0, totalPages: 1 };

  const rowRetryable = (r: Row) =>
    canRetry &&
    r.status === 'failed' &&
    r.attempts < maxAttempts &&
    // No ofrecer reintento en errores permanentes (duplicado, NIP inválido, …).
    (!r.lastErrorCode || errorLabel(r.lastErrorCode).retryable);

  const selIds = Object.keys(sel);
  // Sólo se cuentan/actúan las filas seleccionadas visibles en la página actual.
  const selRetryCount = rows.filter((r) => sel[r.id] && rowRetryable(r)).length;
  const visibleAllSel = rows.length > 0 && rows.every((r) => sel[r.id]);

  const toggleRow = (id: string) =>
    setSel((s) => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const toggleAll = () =>
    setSel((s) => {
      const on = rows.every((r) => s[r.id]);
      const n = { ...s };
      rows.forEach((r) => { if (on) delete n[r.id]; else n[r.id] = true; });
      return n;
    });

  const pick = (fn: () => void) => { fn(); setPage(0); };
  const onSort = (k: 'fecha' | 'attempts') => {
    if (sortK === k) setSortD((d) => (d === -1 ? 1 : -1));
    else { setSortK(k); setSortD(-1); }
    setPage(0);
  };
  const clearFilters = () => { setTab('todos'); setErr('all'); setQ(''); setRange('30d'); setPage(0); };

  const exportHref = `/api/admin/logs/export?${new URLSearchParams({ tab, range, err, ...(qDebounced ? { q: qDebounced } : {}) }).toString()}`;

  const errOpts = [{ code: 'all', label: 'Todos los errores', n: 0 }].concat(
    (resp?.errorOptions ?? []).map((e) => ({ code: e.code, label: `${errorLabel(e.code).label} (${e.n})`, n: e.n })),
  );

  const filtersActive = tab !== 'todos' || err !== 'all' || !!qDebounced || range !== '7d';
  const isEmpty = !loading && rows.length === 0;

  const sortArrow = (k: 'fecha' | 'attempts') => (sortK === k ? (sortD < 0 ? ' ↓' : ' ↑') : '');

  const pageNums = Array.from({ length: Math.min(pag.totalPages, 6) }, (_, i) => i);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, font: `400 14px ${SANS}`, color: INK, maxWidth: 1560, margin: '0 auto' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .lg-scr::-webkit-scrollbar { height: 8px; width: 8px; }
        .lg-scr::-webkit-scrollbar-thumb { background: #DDDCD5; border-radius: 8px; }
        .lg-shim { background: linear-gradient(90deg,#EFEEE9 0%,#F7F6F3 40%,#EFEEE9 80%); background-size: 420px 100%; animation: lgshim 1.2s linear infinite; border-radius: 6px; }
        @keyframes lgshim { 0% { background-position: -420px 0; } 100% { background-position: 420px 0; } }
        .lg-row:hover { background: #FBFBF9 !important; }
      `}</style>

      {/* Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <span style={{ font: `700 11px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>ENTREGA A INTELIX · DELIVERY_OUTBOX</span>
          <h1 style={{ margin: 0, font: `800 28px ${SANS}`, letterSpacing: '-0.028em', lineHeight: 1.1 }}>Logs</h1>
          <p style={{ margin: 0, font: `500 13.5px ${SANS}`, color: MUTED, maxWidth: '66ch' }}>
            Cada intento de envío de una solicitud a Intelix: en qué estado quedó, cuántos intentos lleva y qué respondió Intelix cuando lo rechazó.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: CARD, border: `1px solid ${LINE}`, borderRadius: 20, padding: '6px 12px' }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: '#1B7F4B', boxShadow: '0 0 0 3px rgba(27,127,75,0.14)' }} />
            <span style={{ font: `600 12px ${SANS}`, color: '#4B4B44' }}>
              {resp ? `Actualizado ${new Date(resp.meta.updatedAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Cargando…'}
            </span>
          </div>
          <a href={exportHref} style={{ background: INK, color: '#fff', borderRadius: 10, padding: '9px 15px', font: `700 12.5px ${SANS}`, textDecoration: 'none' }}>Exportar CSV</a>
        </div>
      </header>

      {error && (
        <div style={{ padding: '13px 16px', background: '#FBEDEA', border: '1px solid #F0D5CE', borderRadius: 12, color: RED_FG, font: `600 13px ${SANS}` }}>{error}</div>
      )}

      {/* Stats */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 12 }}>
        {[
          { label: 'Entregados', val: stats ? String(stats.delivered) : '—', note: stats && stats.rangeTotal ? `${((stats.delivered / stats.rangeTotal) * 100).toFixed(1).replace('.', ',')}% del rango` : 'del rango', dot: '#1B7F4B', bd: LINE },
          { label: 'En cola', val: stats ? String(stats.queued) : '—', note: 'pending + processing', dot: '#E0A800', bd: LINE },
          { label: 'Fallidos', val: stats ? String(stats.failed) : '—', note: 'con reintento programado', dot: RED_FG, bd: AMBER_BD },
          { label: 'Definitivos', val: stats ? String(stats.dead) : '—', note: `agotaron ${maxAttempts} intentos o error irrecuperable`, dot: '#5C1F14', bd: AMBER_BD },
          { label: 'Intentos por entrega', val: stats ? stats.attemptsAvg.toFixed(2).replace('.', ',') : '—', note: 'promedio en el rango', dot: '#C9C8C0', bd: LINE },
        ].map((s) => (
          <div key={s.label} style={{ background: CARD, border: `1px solid ${s.bd}`, borderRadius: 16, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `700 12px ${SANS}`, color: MUTED }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: s.dot, flex: '0 0 7px' }} />{s.label}
            </span>
            <span style={{ font: `800 24px ${SANS}`, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.val}</span>
            <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>{s.note}</span>
          </div>
        ))}
      </section>

      {/* Aviso de arquitectura (real) */}
      {arch && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: AMBER_SOFT, border: `1px solid ${AMBER_BD}`, borderRadius: 14, padding: '13px 15px' }}>
          <span style={{ width: 7, height: 7, borderRadius: 7, background: '#E0A800', marginTop: 6, flex: '0 0 7px' }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ font: `700 12.5px ${SANS}`, color: '#6B5200' }}>El envío en tiempo real aún no marca su estado en delivery_outbox</span>
            <span style={{ font: `500 12px ${SANS}`, color: GOLD }}>
              Al enviar el formulario se hace un intento síncrono a Intelix, pero la fila del outbox queda en{' '}
              <span style={{ fontFamily: MONO }}>pending</span> hasta que el cron la procese y la pase a{' '}
              <span style={{ fontFamily: MONO }}>delivered</span> o <span style={{ fontFamily: MONO }}>dead</span>. Un registro puede
              verse en cola aunque Intelix ya lo haya aceptado.
            </span>
          </span>
          <button onClick={hideArch} style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: `700 12px ${SANS}`, color: GOLD, textDecoration: 'underline', textUnderlineOffset: 3, flex: '0 0 auto' }}>Ocultar</button>
        </div>
      )}

      {/* Filtros */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '12px 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 20, boxShadow: '0 1px 0 rgba(22,22,15,0.03)' }}>
        <div className="lg-scr" style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F5F5F3', border: '1px solid #EDECE6', borderRadius: 11, padding: 3, overflowX: 'auto' }}>
          {([
            { id: 'todos' as 'todos' | StateId, label: 'Todos', count: scopeTotal },
            ...ORDER.map((k) => ({ id: k as 'todos' | StateId, label: ST[k].tab, count: counts[k] ?? 0 })),
          ]).map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => pick(() => setTab(t.id))} style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '7px 11px', font: `700 12.5px ${SANS}`, background: active ? INK : 'transparent', color: active ? '#fff' : '#5C5C54' }}>
                {t.label}
                <span style={{ font: `700 10.5px ${SANS}`, background: active ? '#3A3A31' : '#EAE9E3', color: active ? '#fff' : '#54544C', borderRadius: 20, padding: '1px 6px' }}>{t.count}</span>
              </button>
            );
          })}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F5F5F3', border: '1px solid #EDECE6', borderRadius: 10, padding: '8px 11px', flex: '1 1 200px', minWidth: 170, maxWidth: 300 }}>
          <span style={{ width: 11, height: 11, border: '1.5px solid #9A9A8F', borderRadius: 11, flex: '0 0 11px' }} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Teléfono o folio" style={{ border: 'none', background: 'transparent', outline: 'none', font: `500 12.5px ${SANS}`, color: INK, width: '100%' }} />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#F5F5F3', border: '1px solid #EDECE6', borderRadius: 10, padding: '6px 10px' }}>
          <span style={{ font: `600 11.5px ${SANS}`, color: MUTED }}>Rango</span>
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => pick(() => setRange(r.id))} style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '4px 9px', font: `700 12px ${SANS}`, background: range === r.id ? AMBER_SOFT : 'transparent', color: range === r.id ? INK : MUTED, whiteSpace: 'nowrap' }}>{r.label}</button>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F5F5F3', border: '1px solid #EDECE6', borderRadius: 10, padding: '7px 11px' }}>
          <span style={{ font: `600 11.5px ${SANS}`, color: MUTED }}>Error</span>
          <select value={err} onChange={(e) => pick(() => setErr(e.target.value))} style={{ border: 'none', background: 'transparent', outline: 'none', font: `600 12px ${SANS}`, color: INK, cursor: 'pointer', maxWidth: 210 }}>
            {errOpts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </label>

        <div style={{ flex: '1 1 20px' }} />
        <span style={{ font: `500 12px ${SANS}`, color: MUTED, whiteSpace: 'nowrap' }}>{pag.total} de {scopeTotal} registros</span>
      </section>

      {/* Barra de selección */}
      {selIds.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, background: INK, borderRadius: 14, padding: '11px 15px' }}>
          <span style={{ font: `700 12.5px ${SANS}`, color: '#fff' }}>{selIds.length} seleccionados · {selRetryCount} reintentables</span>
          <div style={{ flex: '1 1 20px' }} />
          {canRetry && (
            <button
              onClick={() => doRetry(rows.filter((r) => sel[r.id] && rowRetryable(r)).map((r) => r.id))}
              disabled={selRetryCount === 0 || busy}
              style={{ border: 'none', cursor: selRetryCount && !busy ? 'pointer' : 'not-allowed', background: selRetryCount ? AMBER : '#3A3A31', color: selRetryCount ? INK : '#8A8A80', borderRadius: 9, padding: '7px 13px', font: `700 12px ${SANS}` }}
            >Reintentar envío</button>
          )}
          <a href={exportHref} style={{ cursor: 'pointer', background: 'transparent', color: '#fff', border: '1px solid #4A4A42', borderRadius: 9, padding: '7px 13px', font: `700 12px ${SANS}`, textDecoration: 'none' }}>Exportar filtro</a>
          <button onClick={() => setSel({})} style={{ border: 'none', cursor: 'pointer', background: 'transparent', color: '#C9C8C0', font: `700 12px ${SANS}`, textDecoration: 'underline', textUnderlineOffset: 3, padding: '7px 4px' }}>Quitar selección</button>
        </div>
      )}

      {/* Tabla */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
        <div className="lg-scr" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1080, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '34px 1.05fr 0.95fr 1.35fr 1fr 0.6fr 1.9fr 92px', gap: 12, alignItems: 'center', padding: '12px 16px', background: '#FBFBF9', borderBottom: '1px solid #EFEEE9', font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>
              <input type="checkbox" checked={visibleAllSel} onChange={toggleAll} aria-label="Seleccionar todo" style={{ width: 15, height: 15, accentColor: INK, cursor: 'pointer' }} />
              <button onClick={() => onSort('fecha')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textAlign: 'left', padding: 0 }}>FECHA{sortArrow('fecha')}</button>
              <span>{canViewPii ? 'TELÉFONO' : 'FOLIO'}</span>
              <span>{canViewPii ? 'CLIENTE' : 'LEAD'}</span>
              <span>ESTADO INTELIX</span>
              <button onClick={() => onSort('attempts')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textAlign: 'right', padding: 0 }}>INTENTOS{sortArrow('attempts')}</button>
              <span>MENSAJE DE ERROR</span>
              <span style={{ textAlign: 'right' }}>ACCIONES</span>
            </div>

            {loading && !resp ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 12, padding: '15px 16px', borderBottom: '1px solid #F5F4EF' }}>
                  <div className="lg-shim" style={{ height: 15, width: 15 }} />
                  <div className="lg-shim" style={{ height: 13, width: '70%' }} />
                </div>
              ))
            ) : rows.map((r) => {
              const st = ST[r.status];
              const at = r.attempts;
              const ei = r.lastErrorCode ? errorLabel(r.lastErrorCode) : null;
              const errShort = ei
                ? ei.label
                : r.status === 'delivered' ? 'Aceptado por Intelix'
                : r.status === 'pending' ? 'En cola para envío'
                : r.status === 'processing' ? 'Procesando…'
                : '—';
              const meta =
                r.status === 'delivered' ? (r.deliveredAt ? `${new Date(r.deliveredAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' })}` : 'entregado')
                : r.status === 'failed' ? (r.nextAttemptAt ? `reintento ${new Date(r.nextAttemptAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' })}` : 'reintento pendiente')
                : r.status === 'dead' ? (r.lastErrorCode ?? 'sin reintento')
                : r.status === 'processing' ? 'en curso' : 'sin intentos';
              const dp = dateParts(r.createdAt, nowMs);
              const canR = rowRetryable(r);
              return (
                <div key={r.id} className="lg-row" style={{ display: 'grid', gridTemplateColumns: '34px 1.05fr 0.95fr 1.35fr 1fr 0.6fr 1.9fr 92px', gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid #F5F4EF', background: sel[r.id] ? '#FFFDF4' : CARD }}>
                  <input type="checkbox" checked={!!sel[r.id]} onChange={() => toggleRow(r.id)} aria-label="Seleccionar registro" style={{ width: 15, height: 15, accentColor: INK, cursor: 'pointer' }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ font: `500 12.5px ${MONO}` }}>{dp.hora}</span>
                    <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>{dp.fecha}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ font: `600 12.5px ${MONO}` }}>{canViewPii && r.pii ? r.pii.phone : `BP-${shortFolio(r.folio)}`}</span>
                    <span style={{ font: `500 10.5px ${MONO}`, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{canViewPii && r.pii ? `BP-${shortFolio(r.folio)}` : `outbox ${r.id.slice(0, 8)}`}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ font: `700 12.5px ${SANS}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{canViewPii && r.pii ? r.pii.fullName : (r.stateCode ? (STATE_NAMES[r.stateCode] ?? r.stateCode) : '—')}</span>
                    <span style={{ font: `500 11px ${MONO}`, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{canViewPii && r.pii ? r.pii.email : `lead: ${r.leadStatus}`}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `700 11px ${SANS}`, color: st.fg, background: st.bg, border: `1px solid ${st.bd}`, borderRadius: 20, padding: '3px 9px', justifySelf: 'start', whiteSpace: 'nowrap' }}>
                      <span style={{ width: 6, height: 6, borderRadius: 6, background: st.dot, flex: '0 0 6px' }} />{st.label}
                    </span>
                    <span style={{ font: `500 10.5px ${MONO}`, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ font: `700 13px ${SANS}`, color: at >= maxAttempts ? RED_FG : at >= 3 ? GOLD : INK }}>{at}</span>
                    <span style={{ font: `500 11px ${MONO}`, color: '#9A9A8F' }}>/{maxAttempts}</span>
                  </span>
                  <span style={{ font: `500 12px ${SANS}`, color: ei ? RED_FG : MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.lastErrorCode ?? errShort}>{errShort}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    {canR && (
                      <button onClick={() => doRetry([r.id])} disabled={busy} title="Reintentar envío manual" style={{ border: `1px solid ${AMBER_BD}`, background: AMBER_SOFT, cursor: busy ? 'default' : 'pointer', borderRadius: 8, padding: '5px 9px', font: `700 11.5px ${SANS}`, color: '#6B5200' }}>Reintentar</button>
                    )}
                    <button onClick={() => setOpenId(r.id)} style={{ border: `1px solid ${LINE}`, background: CARD, cursor: 'pointer', borderRadius: 8, padding: '5px 9px', font: `700 11.5px ${SANS}`, color: INK }}>Ver</button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {isEmpty && (
          <div style={{ padding: '56px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: '#F5F5F3', border: `1px solid ${LINE}` }} />
            <div style={{ font: `800 16px ${SANS}` }}>Ningún registro coincide</div>
            <div style={{ font: `500 13px ${SANS}`, color: MUTED, maxWidth: '44ch' }}>
              {scopeTotal === 0 && !filtersActive
                ? 'Aún no hay envíos a Intelix en este rango. Cuando entre un lead, aparecerá aquí su registro de entrega.'
                : 'Prueba con otro teléfono, amplía el rango de fechas o quita el filtro de error.'}
            </div>
            {filtersActive && (
              <button onClick={clearFilters} style={{ marginTop: 6, border: 'none', background: INK, color: '#fff', borderRadius: 10, padding: '9px 15px', font: `700 12.5px ${SANS}`, cursor: 'pointer' }}>Limpiar filtros</button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: '#FBFBF9' }}>
          <span style={{ font: `500 12px ${SANS}`, color: MUTED }}>
            {pag.total ? `${pag.page * pag.perPage + 1}–${Math.min(pag.total, pag.page * pag.perPage + pag.perPage)} de ${pag.total}` : '0 resultados'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={pag.page <= 0} style={{ cursor: pag.page > 0 ? 'pointer' : 'default', border: `1px solid ${LINE}`, background: CARD, borderRadius: 8, padding: '6px 11px', font: `700 12px ${SANS}`, color: pag.page > 0 ? INK : '#B4B3A6' }}>Anterior</button>
            {pageNums.map((i) => (
              <button key={i} onClick={() => setPage(i)} style={{ cursor: 'pointer', border: `1px solid ${i === pag.page ? INK : LINE}`, background: i === pag.page ? INK : CARD, color: i === pag.page ? '#fff' : '#54544C', borderRadius: 8, minWidth: 30, padding: '6px 9px', font: `700 12px ${SANS}` }}>{i + 1}</button>
            ))}
            <button onClick={() => setPage((p) => Math.min(pag.totalPages - 1, p + 1))} disabled={pag.page >= pag.totalPages - 1} style={{ cursor: pag.page < pag.totalPages - 1 ? 'pointer' : 'default', border: `1px solid ${LINE}`, background: CARD, borderRadius: 8, padding: '6px 11px', font: `700 12px ${SANS}`, color: pag.page < pag.totalPages - 1 ? INK : '#B4B3A6' }}>Siguiente</button>
          </div>
        </div>
      </section>

      {/* Drawer */}
      {openId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={closeDrawer} style={{ position: 'absolute', inset: 0, background: 'rgba(22,22,15,0.24)' }} />
          <aside className="lg-scr" style={{ position: 'relative', width: 'min(540px,94vw)', background: CARD, borderLeft: `1px solid ${LINE}`, height: '100%', overflowY: 'auto', padding: '22px 24px 40px', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '-14px 0 40px rgba(22,22,15,0.10)' }}>
            {!detail || detail.id !== openId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="lg-shim" style={{ height: 14, width: '40%' }} />
                <div className="lg-shim" style={{ height: 24, width: '60%' }} />
                <div className="lg-shim" style={{ height: 120, borderRadius: 12 }} />
                <div className="lg-shim" style={{ height: 180, borderRadius: 12 }} />
              </div>
            ) : (
              <DrawerBody 
                detail={detail} 
                onClose={closeDrawer} 
                onRetry={() => doRetry([detail.id])} 
                onFixed={() => { closeDrawer(); reload(); }}
                busy={busy} 
                exportHref={`/api/admin/logs/export?${new URLSearchParams({ range: 'all', q: detail.folio }).toString()}`} 
                exportSensitiveHref={canExportSensitive ? `/api/admin/logs/export?${new URLSearchParams({ range: 'all', q: detail.folio, sensitive: '1' }).toString()}` : null} 
              />
            )}
          </aside>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 11, background: INK, borderRadius: 12, padding: '12px 16px', boxShadow: '0 16px 40px rgba(22,22,15,0.22)' }}>
          <span style={{ width: 7, height: 7, borderRadius: 7, background: toast.dot, flex: '0 0 7px' }} />
          <span style={{ font: `600 12.5px ${SANS}`, color: '#fff' }}>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

// ── Drawer body ───────────────────────────────────────────────────────────────
function DrawerBody({
  detail, onClose, onRetry, onFixed, busy, exportHref, exportSensitiveHref,
}: {
  detail: Detail;
  onClose: () => void;
  onRetry: () => void;
  onFixed: () => void;
  busy: boolean;
  exportHref: string;
  exportSensitiveHref: string | null;
}) {
  const st = ST[detail.status];
  const lead: { k: string; v: string }[] = [
    { k: 'lead_id', v: detail.leadId.slice(0, 18) + '…' },
    { k: 'Folio', v: `BP-${shortFolio(detail.folio)}` },
    ...(detail.pii
      ? [
          { k: 'Nombre', v: detail.pii.fullName },
          { k: 'Correo', v: detail.pii.email },
          { k: 'Teléfono', v: detail.pii.phone },
        ]
      : [{ k: 'Datos del cliente', v: 'requiere permiso leads.detail.view' }]),
    { k: 'Estado del lead', v: detail.leadStatus },
    { k: 'Estado de residencia', v: detail.stateCode ? (STATE_NAMES[detail.stateCode] ?? detail.stateCode) : '—' },
    { k: 'Plan', v: detail.planCode },
    { k: 'Origen', v: detail.attribution.sourceCategory ?? 'sin atribuir' },
    ...(detail.attribution.utmCampaign ? [{ k: 'Campaña (UTM)', v: detail.attribution.utmCampaign }] : []),
    { k: 'Fecha de registro', v: fmtFull(detail.leadCreatedAt) },
  ];
  const outbox: { k: string; v: string; fg?: string }[] = [
    { k: 'status', v: detail.status, fg: st.fg },
    { k: 'attempts', v: `${detail.attempts} de ${detail.maxAttempts}`, fg: detail.attempts >= detail.maxAttempts ? RED_FG : INK },
    { k: 'last_error_code', v: detail.lastErrorCode ?? '—', fg: detail.lastErrorCode ? RED_FG : INK },
    { k: 'delivered_at', v: fmtFull(detail.deliveredAt) },
    { k: 'next_attempt_at', v: fmtFull(detail.nextAttemptAt), fg: detail.nextAttemptAt ? GOLD : INK },
    { k: 'created_at', v: fmtFull(detail.createdAt) },
    { k: 'updated_at', v: fmtFull(detail.updatedAt) },
  ];

  const code = detail.error?.code;
  let fixField = null;
  let fixLabel = '';
  if (code) {
    if (['3001', '3002'].includes(code)) { fixField = 'email'; fixLabel = 'Email'; }
    else if (['3003', '3004', '3023'].includes(code)) { fixField = 'phone'; fixLabel = 'Teléfono (10 dígitos)'; }
    else if (['3007', '3010'].includes(code)) { fixField = 'firstName'; fixLabel = 'Nombre'; }
    else if (['3008', '3009'].includes(code)) { fixField = 'lastName'; fixLabel = 'Apellidos'; }
    else if (['3011', '3024'].includes(code)) { fixField = 'planCode'; fixLabel = 'Plan de Migración'; }
    else if (['3013', '3014'].includes(code)) { fixField = 'stateCode'; fixLabel = 'Estado de Nacimiento'; }
    else if (['3015', '3016'].includes(code)) { fixField = 'nip'; fixLabel = 'NIP (4 dígitos)'; }
  }

  const [fixValue, setFixValue] = useState('');
  const [fixing, setFixing] = useState(false);
  const [fixErr, setFixErr] = useState<string | null>(null);

  const handleFix = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fixField || !fixValue.trim() || fixing) return;
    setFixing(true);
    setFixErr(null);
    try {
      const res = await fetch('/api/admin/logs/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outboxId: detail.id, field: fixField, value: fixValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al corregir');
      onFixed(); // will close and reload
    } catch (err: unknown) {
      setFixErr((err as Error).message);
      setFixing(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <span style={{ font: `500 11.5px ${MONO}`, color: MUTED }}>outbox {detail.id.slice(0, 8)}</span>
          <h2 style={{ margin: 0, font: `800 20px ${SANS}`, letterSpacing: '-0.022em' }}>
            {detail.pii ? detail.pii.phone : `BP-${shortFolio(detail.folio)}`}
          </h2>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `700 11px ${SANS}`, color: st.fg, background: st.bg, border: `1px solid ${st.bd}`, borderRadius: 20, padding: '3px 10px', alignSelf: 'flex-start' }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: st.dot }} />{st.label}
          </span>
        </div>
        <button onClick={onClose} aria-label="Cerrar" style={{ border: `1px solid ${LINE}`, background: CARD, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, font: `700 14px ${SANS}`, color: '#54544C', flex: '0 0 30px' }}>×</button>
      </div>

      {detail.error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, background: '#FBEDEA', border: '1px solid #F0D5CE', borderRadius: 14, padding: '14px 15px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span style={{ font: `700 10.5px ${SANS}`, letterSpacing: '0.08em', color: RED_FG }}>RESPUESTA DE INTELIX</span>
            {detail.error.code && <span style={{ font: `500 10.5px ${MONO}`, color: '#7A3325', background: '#F7E0DA', border: '1px solid #E3B5AB', borderRadius: 20, padding: '2px 7px' }}>{detail.error.code}</span>}
            <span style={{ font: `600 10px ${SANS}`, color: detail.error.retryable ? GOLD : '#7A2718' }}>{detail.error.retryable ? 'reintentable' : 'permanente'}</span>
          </div>
          <p style={{ margin: 0, font: `600 13px ${SANS}`, color: '#7A3325' }}>{detail.error.label}</p>
          <p style={{ margin: 0, font: `500 12px ${SANS}`, color: '#8A4536' }}>{detail.error.detail}</p>
          {detail.error.field && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ font: `700 10px ${SANS}`, letterSpacing: '0.06em', color: '#8A4536' }}>CAMPO CON ERROR</span>
              <span style={{ font: `700 11px ${MONO}`, color: '#7A2718', background: '#F7E0DA', border: '1px solid #E3B5AB', borderRadius: 6, padding: '2px 7px' }}>{detail.error.field}</span>
            </div>
          )}
          {detail.lastErrorPayload ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {detail.lastErrorPayload.sent && (
                <div>
                  <span style={{ font: `700 10px ${SANS}`, letterSpacing: '0.06em', color: '#8A4536' }}>LO QUE SE ENVIÓ A INTELIX</span>
                  <div style={{ background: CARD, border: '1px solid #F0D5CE', borderRadius: 10, padding: '10px 11px', overflowX: 'auto', marginTop: 4 }}>
                    <pre style={{ margin: 0, font: `500 11px ${MONO}`, color: '#8A4536' }}>
                      {JSON.stringify(detail.lastErrorPayload.sent, null, 2)}
                    </pre>
                  </div>
                  <p style={{ margin: '4px 0 0', font: `500 10px ${SANS}`, color: MUTED }}>PII enmascarada (NIP nunca se muestra) — dato completo solo en la ficha del lead.</p>
                </div>
              )}
              <div>
                <span style={{ font: `700 10px ${SANS}`, letterSpacing: '0.06em', color: '#8A4536' }}>
                  RESPUESTA DE INTELIX{typeof detail.lastErrorPayload.httpStatus === 'number' ? ` (HTTP ${detail.lastErrorPayload.httpStatus})` : ''}
                </span>
                <div style={{ background: CARD, border: '1px solid #F0D5CE', borderRadius: 10, padding: '10px 11px', overflowX: 'auto', marginTop: 4 }}>
                  <pre style={{ margin: 0, font: `500 11px ${MONO}`, color: '#8A4536' }}>
                    {detail.lastErrorPayload.response
                      ? JSON.stringify(detail.lastErrorPayload.response, null, 2)
                      : 'Sin respuesta del proveedor (timeout o fallo de red antes de recibirla).'}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ font: `500 11px ${MONO}`, color: '#8A4536', background: CARD, border: '1px solid #F0D5CE', borderRadius: 10, padding: '10px 11px' }}>
              No hay detalle de envío/respuesta guardado para este registro (falló antes de intentar el envío).
            </div>
          )}
          {fixField && (
            <form onSubmit={handleFix} style={{ marginTop: 8, background: '#fff', padding: '12px 14px', borderRadius: 10, border: '1px solid #E3B5AB', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ font: `700 12px ${SANS}`, color: '#7A3325' }}>Corregir {fixLabel}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={fixValue}
                  onChange={(e) => setFixValue(e.target.value)}
                  placeholder={`Nuevo valor para ${fixLabel}...`}
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid #F0D5CE', borderRadius: 8, font: `500 13px ${SANS}` }}
                  disabled={fixing}
                />
                <button
                  type="submit"
                  disabled={fixing || !fixValue.trim()}
                  style={{ background: '#7A3325', color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', font: `700 12px ${SANS}`, cursor: (fixing || !fixValue.trim()) ? 'default' : 'pointer', opacity: (fixing || !fixValue.trim()) ? 0.7 : 1 }}
                >
                  {fixing ? 'Guardando...' : 'Corregir y Reintentar'}
                </button>
              </div>
              {fixErr && <span style={{ font: `500 11.5px ${SANS}`, color: RED_FG }}>{fixErr}</span>}
            </form>
          )}
        </div>
      )}

      <Section title="SOLICITUD (LEADS)">
        {lead.map((f) => (
          <Row2 key={f.k} k={f.k} v={f.v} mono={false} />
        ))}
      </Section>

      <Section title="ENTREGA (DELIVERY_OUTBOX)">
        {outbox.map((f) => (
          <Row2 key={f.k} k={f.k} v={f.v} fg={f.fg} mono />
        ))}
      </Section>

      <Section title="BITÁCORA DE INTENTOS · reconstruida de la fila">
        {detail.log.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid #F5F4EF' }}>
            <span style={{ width: 7, height: 7, borderRadius: 7, background: l.dot, marginTop: 6, flex: '0 0 7px' }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ font: `600 12.5px ${SANS}` }}>{l.t}</span>
              <span style={{ font: `500 11px ${MONO}`, color: MUTED }}>{fmtFull(l.at)}</span>
            </span>
          </div>
        ))}
      </Section>

      <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #EFEEE9', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {detail.retryable ? (
          <>
            <button onClick={onRetry} disabled={busy} style={{ border: 'none', cursor: busy ? 'default' : 'pointer', background: INK, color: '#fff', borderRadius: 10, padding: '11px 15px', font: `700 12.5px ${SANS}` }}>Reintentar envío manual</button>
            <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>Re-encola el registro de inmediato ({'status → pending'}); el cron lo tomará en la siguiente vuelta (≤5 min) sin esperar el intervalo de reintento.</span>
          </>
        ) : detail.noRetryNote ? (
          <div style={{ background: '#FBFBF9', border: '1px solid #EFEEE9', borderRadius: 12, padding: '11px 13px', font: `500 12px ${SANS}`, color: '#5C5C54' }}>{detail.noRetryNote}</div>
        ) : null}
        <a href={exportHref} style={{ cursor: 'pointer', border: `1px solid ${LINE}`, background: CARD, color: INK, borderRadius: 10, padding: '10px 15px', font: `700 12.5px ${SANS}`, textDecoration: 'none', textAlign: 'center' }}>Descargar este log (CSV)</a>
        {exportSensitiveHref && (
          <a href={exportSensitiveHref} style={{ cursor: 'pointer', border: `1px solid ${LINE}`, background: CARD, color: MUTED, borderRadius: 10, padding: '8px 15px', font: `700 11.5px ${SANS}`, textDecoration: 'none', textAlign: 'center' }}>Descargar con datos personales (CSV)</a>
        )}
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: `700 10.5px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>{title}</div>
      {children}
    </div>
  );
}
function Row2({ k, v, fg, mono }: { k: string; v: string; fg?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, padding: '8px 0', borderBottom: '1px solid #F5F4EF' }}>
      <span style={{ font: mono ? `500 11.5px ${MONO}` : `600 12px ${SANS}`, color: MUTED }}>{k}</span>
      <span style={{ font: `500 12.5px ${MONO}`, textAlign: 'right', wordBreak: 'break-word', color: fg ?? INK }}>{v}</span>
    </div>
  );
}
