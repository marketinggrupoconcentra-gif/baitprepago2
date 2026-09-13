/**
 * src/components/admin/AnalyticsClient.tsx
 *
 * Analítica de adquisición — vista `/admin/analytics`.
 * Diseño: "Analítica de adquisición.dc.html" (Claude Design).
 *
 * Todo se alimenta de /api/admin/analytics/acquisition (datos reales de
 * app.analytics_events / app.leads / app.lead_attribution / app.delivery_outbox).
 * Las secciones que dependen de integraciones no conectadas (Google Ads,
 * Meta Ads, Search Console, jerarquía de grupos/anuncios) muestran un estado
 * "no conectado" — nunca estimaciones.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const INK = '#16160F';
const MUTED = '#6E6E64';
const LINE = '#E6E5E0';
const CARD = '#FFFFFF';
const BG = '#F5F5F3';
const AMBER = '#FFC72C';
const AMBER_SOFT = '#FFF6DC';
const AMBER_BD = '#F0DFAB';
const GREEN = '#1B7F4B';
const GREEN_FG = '#136B3E';
const RED_FG = '#96271B';

const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SANS = "'Manrope', system-ui, -apple-system, sans-serif";

// ── Metadatos de canal ────────────────────────────────────────────────────────
type ChannelId =
  | 'google_ads'
  | 'meta_ads'
  | 'paid_other'
  | 'organic'
  | 'referral'
  | 'direct'
  | 'other';

const CHANNELS: Record<ChannelId, { label: string; group: string; color: string }> = {
  google_ads: { label: 'Google Ads', group: 'Pagado', color: '#16160F' },
  meta_ads: { label: 'Meta Ads', group: 'Pagado', color: '#4A4A42' },
  paid_other: { label: 'Otros pagados', group: 'Pagado', color: '#6E6E64' },
  organic: { label: 'Orgánico', group: 'Orgánico', color: '#9A9A8F' },
  referral: { label: 'Referral', group: 'Referral', color: '#C8C7BA' },
  direct: { label: 'Directo', group: 'Directo', color: '#DAD9CD' },
  other: { label: 'Otro', group: 'Otro', color: '#DEDDD1' },
};

const FUNNEL_LABELS: Record<string, string> = {
  sessions: 'Sesiones',
  formStart: 'Inicio del formulario',
  step2: 'Paso 2 · datos',
  step3: 'Paso 3 · confirmación',
  submitted: 'Formulario enviado',
  lead: 'Lead exitoso',
};
const FUNNEL_ORDER = ['sessions', 'formStart', 'step2', 'step3', 'submitted', 'lead'];

const GROUP_META: Record<string, { label: string; color: string }> = {
  google: { label: 'Google Ads', color: '#16160F' },
  meta: { label: 'Meta Ads', color: '#4A4A42' },
  organic: { label: 'Orgánico', color: '#9A9A8F' },
  direct: { label: 'Directo', color: '#DAD9CD' },
};

const STATE_NAMES: Record<string, string> = {
  AG: 'Aguascalientes', BC: 'Baja California', BS: 'Baja California Sur',
  CM: 'Campeche', CS: 'Chiapas', CH: 'Chihuahua', CO: 'Coahuila', CL: 'Colima',
  DF: 'Ciudad de México', DG: 'Durango', GT: 'Guanajuato', GR: 'Guerrero',
  HG: 'Hidalgo', JC: 'Jalisco', MC: 'Estado de México', MN: 'Michoacán',
  MS: 'Morelos', NT: 'Nayarit', NL: 'Nuevo León', OA: 'Oaxaca', PU: 'Puebla',
  QT: 'Querétaro', QR: 'Quintana Roo', SL: 'San Luis Potosí', SI: 'Sinaloa',
  SO: 'Sonora', TB: 'Tabasco', TM: 'Tamaulipas', TL: 'Tlaxcala', VZ: 'Veracruz',
  YN: 'Yucatán', ZS: 'Zacatecas',
};

const SECTION_NAMES: Record<string, string> = {
  inicio: 'Hero / inicio', beneficios: 'Beneficios', pasos: 'Pasos', preguntas: 'Preguntas',
  walmart_feature: 'Walmart beneficios', site_footer: 'Footer', hero: 'Hero', formulario: 'Formulario',
};

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// ── Tipos de la respuesta del API ─────────────────────────────────────────────
interface ChannelRow {
  id: string;
  sessions: number;
  formStart: number;
  step2: number;
  step3: number;
  submitted: number;
  leads: number;
  prev: { sessions: number; formStart: number; leads: number };
}
interface TrendPoint { bucket: string; sessions: number; formStart: number; leads: number }
interface HeatCell { dow: number; hour: number; sessions: number; leads: number }
interface Campaign {
  campaign: string; source: string; medium: string; channel: string;
  sessions: number; formStart: number; leads: number;
}
interface Acquisition {
  range: { from: string; to: string };
  compare: { mode: string; from?: string; to?: string };
  granularity: string;
  channelFilter: string | null;
  channels: ChannelRow[];
  funnel: { totals: Record<string, number>; byGroup: Array<Record<string, number> & { group: string }> };
  trend: TrendPoint[];
  trendCompare: TrendPoint[];
  spark: { sessions: number[]; formStart: number[]; leads: number[] };
  heatmap: HeatCell[];
  landing: {
    sessions: number; scroll50: number; scroll90: number; cta: number; formStart: number;
    sections: { id: string; sessions: number }[];
  };
  geo: { code: string; leads: number }[];
  delivery: { delivered: number; failed: number; duplicate: number; pending: number; total: number };
  health: { sessions: number; attributed: number; noUtm: number; lastEventAt: string | null };
  campaigns: Campaign[];
  utm: { dim: string; val: string; sessions: number; leads: number }[];
  sourceMedium: { source: string; medium: string; sessions: number; leads: number }[];
  devices: { device: string; sessions: number; formStart: number; leads: number }[];
  integrations: { 
    googleAds: false | {
      connected: boolean;
      impressions: number;
      clicks: number;
      costMicros: number;
      conversions: number;
      campaigns: { id: string; name: string; impressions: number; clicks: number; costMicros: number; conversions: number }[];
    };
    metaAds: boolean; 
    searchConsole: boolean; 
  };
}

type ChannelDerived = ChannelRow & {
  meta: { label: string; group: string; color: string };
  cvr: number;
};
interface Derived {
  T: Record<string, number>;
  sessions: number;
  formStart: number;
  leads: number;
  cvr: number;
  fsr: number;
  prevSum: { sessions: number; formStart: number; leads: number };
  prevCvr: number;
  prevFsr: number;
  channels: ChannelDerived[];
  groups: { g: string; s: number; l: number; cvr: number; color: string }[];
  avgCvr: number;
}

// ── Formateo ──────────────────────────────────────────────────────────────────
const NF = new Intl.NumberFormat('es-MX');
const nf = (n: number) => NF.format(Math.round(n || 0));
const cf = (n: number) => {
  const v = Math.round(n || 0);
  if (v >= 10000) return (v / 1000).toFixed(0) + 'k';
  if (v >= 1000) return (v / 1000).toFixed(1).replace('.', ',') + 'k';
  return nf(v);
};
const pf = (n: number, d = 1) => (isFinite(n) ? (n * 100).toFixed(d) : '0.' + '0'.repeat(d)) + '%';

function delta(cur: number, prev: number | null | undefined) {
  if (prev == null || prev === 0) return { pct: '—', arrow: '', color: MUTED, bg: '#F0EFEA', up: null as boolean | null };
  const r = (cur - prev) / prev;
  const up = r >= 0;
  return {
    pct: Math.abs(r * 100).toFixed(1) + '%',
    arrow: up ? '↑' : '↓',
    color: up ? GREEN_FG : RED_FG,
    bg: up ? '#EAF6EF' : '#FDF0EE',
    up,
  };
}

function cvrColor(v: number, avg: number) {
  if (!avg) return '#4B4B44';
  if (v >= avg * 1.18) return GREEN_FG;
  if (v <= avg * 0.72) return RED_FG;
  return '#4B4B44';
}

/** Path SVG para una serie (viewBox W×H, y=0 arriba). */
function seriesPath(vals: number[], w: number, h: number, close: boolean, maxOverride?: number) {
  const n = vals.length;
  if (!n) return '';
  const mx = maxOverride ?? Math.max(...vals, 1);
  const span = mx || 1;
  const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => h - (v / span) * (h - 6) - 3;
  let d = '';
  vals.forEach((v, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); });
  if (close) d += `L${w} ${h}L0 ${h}Z`;
  return d;
}

const fmtDay = (d: Date) =>
  d.getUTCDate() + ' ' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getUTCMonth()];

// ── UI atoms ──────────────────────────────────────────────────────────────────
function Card({ children, style, dark }: { children: React.ReactNode; style?: React.CSSProperties; dark?: boolean }) {
  return (
    <section style={{
      background: dark ? INK : CARD,
      border: `1px solid ${dark ? INK : LINE}`,
      borderRadius: 16,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      minWidth: 0,
      ...style,
    }}>
      {children}
    </section>
  );
}

function CardHead({ title, sub, right, dark }: { title: string; sub?: string; right?: React.ReactNode; dark?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em', color: dark ? '#fff' : INK }}>{title}</h2>
        {sub && <span style={{ font: `500 12px ${SANS}`, color: dark ? '#8B8A80' : MUTED }}>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { id: T; label: string; disabled?: boolean }[];
}) {
  return (
    <div style={{ display: 'flex', gap: 3, background: BG, border: `1px solid #EDECE6`, borderRadius: 10, padding: 3 }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            disabled={o.disabled}
            onClick={() => !o.disabled && onChange(o.id)}
            style={{
              border: 'none', borderRadius: 7, padding: '6px 10px', whiteSpace: 'nowrap',
              font: `700 12px ${SANS}`, cursor: o.disabled ? 'not-allowed' : 'pointer',
              background: active ? INK : 'transparent',
              color: active ? '#fff' : MUTED,
              opacity: o.disabled ? 0.35 : 1,
              boxShadow: active ? '0 1px 2px rgba(22,22,15,0.18)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function NotConnected({ title, body, chips, cta }: { title: string; body: string; chips?: string[]; cta?: string }) {
  return (
    <div style={{
      border: `1px dashed #DEDDD5`, background: '#FBFBF9', borderRadius: 12, padding: '24px 22px',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '52ch' }}>
        <div style={{ font: `800 14.5px ${SANS}`, color: INK }}>{title}</div>
        <div style={{ font: `500 12.5px ${SANS}`, color: MUTED, textWrap: 'pretty' } as React.CSSProperties}>{body}</div>
        {chips && chips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {chips.map((c) => (
              <span key={c} style={{ font: `600 11px ${MONO}`, color: MUTED, background: '#F2F1EC', borderRadius: 6, padding: '4px 8px' }}>{c}</span>
            ))}
          </div>
        )}
      </div>
      {cta && (
        <span style={{ font: `700 12px ${SANS}`, color: MUTED, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 13px', whiteSpace: 'nowrap' }}>
          {cta}
        </span>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
type RangeId = '7d' | '30d' | '90d' | 'custom';
type TrendMetric = 'sessions' | 'formStart' | 'leads' | 'cvr';
type HeatMetric = 'sessions' | 'leads' | 'cvr';
type UtmDim = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term';
const DEVICE_LABELS: Record<string, string> = {
  mobile: 'Mobile', desktop: 'Desktop', tablet: 'Tablet', desconocido: 'Desconocido',
};

const fmtLocalDay = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const dayOffset = (isoDay: string, days: number) =>
  fmtLocalDay(new Date(new Date(isoDay + 'T12:00:00').getTime() + days * 86400000));

export default function AnalyticsClient() {
  const [nowMs] = useState(() => Date.now());
  const today = fmtLocalDay(new Date(nowMs));

  const [rangeId, setRangeId] = useState<RangeId>('30d');
  const [dateFrom, setDateFrom] = useState(() => fmtLocalDay(new Date(Date.now() - 30 * 86400000)));
  const [dateTo, setDateTo] = useState(today);
  const [compare, setCompare] = useState<'prev' | 'none'>('prev');
  const [channel, setChannel] = useState<string | null>(null);
  const [gran, setGran] = useState<'dia' | 'semana'>('dia');
  const [advOpen, setAdvOpen] = useState(false);

  const [trendMetric, setTrendMetric] = useState<TrendMetric>('sessions');
  const [heatMetric, setHeatMetric] = useState<HeatMetric>('sessions');
  const [chMetric, setChMetric] = useState<TrendMetric>('sessions');
  const [utmDim, setUtmDim] = useState<UtmDim>('utm_source');
  const [device, setDevice] = useState<string | null>(null);
  const toggleDevice = (id: string) => setDevice((v) => (v === id ? null : id));
  const [campSort, setCampSort] = useState<{ k: string; d: number }>({ k: 'leads', d: -1 });
  const [campQuery, setCampQuery] = useState('');
  const [campPage, setCampPage] = useState(0);
  const [drill, setDrill] = useState<Campaign | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const [data, setData] = useState<Acquisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const fetchAcq = useCallback(
    async (from: string, to: string, opts: { compare: string; channel: string | null; gran: string }, id: number) => {
      const q = new URLSearchParams({
        dateFrom: from, dateTo: to, compare: opts.compare, granularity: opts.gran,
      });
      if (opts.channel) q.set('channel', opts.channel);
      const res = await fetch(`/api/admin/analytics/acquisition?${q.toString()}`);
      const json = await res.json();
      if (id !== reqId.current) return;
      if (json.error) { setError(String(json.error)); return; }
      setData(json as Acquisition);
    },
    [],
  );

  const load = useCallback(
    (from: string, to: string, opts: { compare: string; channel: string | null; gran: string }) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      fetchAcq(from, to, opts, id)
        .catch((e) => { if (id === reqId.current) setError(e instanceof Error ? e.message : 'Error al cargar la analítica'); })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    },
    [fetchAcq],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrill(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const id = ++reqId.current;
    fetchAcq(dateFrom, dateTo, { compare, channel, gran }, id)
      .catch(() => { if (id === reqId.current) setError('Error al cargar la analítica'); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = (over?: Partial<{ from: string; to: string; compare: string; channel: string | null; gran: string }>) => {
    load(
      over?.from ?? dateFrom,
      over?.to ?? dateTo,
      { compare: over?.compare ?? compare, channel: over?.channel !== undefined ? over.channel : channel, gran: over?.gran ?? gran },
    );
  };

  const setPreset = (id: RangeId, days: number) => {
    setRangeId(id);
    const f = dayOffset(today, -days);
    setDateFrom(f);
    setDateTo(today);
    setGran(days > 45 ? 'semana' : 'dia');
    refresh({ from: f, to: today, gran: days > 45 ? 'semana' : 'dia' });
  };

  const toggleChannel = (id: string) => {
    const next = channel === id ? null : id;
    setChannel(next);
    setCampPage(0);
    refresh({ channel: next });
  };

  const clearFilters = () => {
    setChannel(null);
    setCampPage(0);
    refresh({ channel: null });
  };

  // ── Derivados ──────────────────────────────────────────────────────────────
  const derived = useMemo(() => {
    if (!data) return null;
    const T = data.funnel.totals;
    const sessions = T.sessions || 0;
    const formStart = T.formStart || 0;
    const leads = T.lead || 0;
    const cvr = sessions ? leads / sessions : 0;
    const fsr = sessions ? formStart / sessions : 0;

    const prevSum = data.channels.reduce(
      (a, c) => ({
        sessions: a.sessions + c.prev.sessions,
        formStart: a.formStart + c.prev.formStart,
        leads: a.leads + c.prev.leads,
      }),
      { sessions: 0, formStart: 0, leads: 0 },
    );
    const prevCvr = prevSum.sessions ? prevSum.leads / prevSum.sessions : 0;
    const prevFsr = prevSum.sessions ? prevSum.formStart / prevSum.sessions : 0;

    const channels = data.channels
      .map((c) => ({
        ...c,
        meta: CHANNELS[(c.id as ChannelId)] ?? { label: c.id, group: 'Otro', color: '#DEDDD1' },
        cvr: c.sessions ? c.leads / c.sessions : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions || b.leads - a.leads);

    const groups = ['Pagado', 'Orgánico', 'Referral', 'Directo'].map((g) => {
      const rs = channels.filter((c) => c.meta.group === g);
      const s = rs.reduce((a, c) => a + c.sessions, 0);
      const l = rs.reduce((a, c) => a + c.leads, 0);
      return { g, s, l, cvr: s ? l / s : 0, color: rs[0]?.meta.color ?? '#DAD9CD' };
    }).filter((g) => g.s > 0 || g.l > 0);

    return { T, sessions, formStart, leads, cvr, fsr, prevSum, prevCvr, prevFsr, channels, groups, avgCvr: cvr };
  }, [data]);

  const rangeLabel =
    rangeId === '7d' ? 'Últimos 7 días' : rangeId === '30d' ? 'Últimos 30 días' : rangeId === '90d' ? 'Últimos 90 días' : 'Personalizado';

  const isEmpty = !loading && !error && data && (data.funnel.totals.sessions || 0) === 0 && data.channels.length === 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, font: `400 14px ${SANS}`, color: INK }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .aq-shim { background: linear-gradient(90deg,#EFEEE9 0%,#F7F6F3 40%,#EFEEE9 80%); background-size: 420px 100%; animation: aqshim 1.2s linear infinite; border-radius: 6px; }
        @keyframes aqshim { 0% { background-position: -420px 0; } 100% { background-position: 420px 0; } }
        .aq-scr::-webkit-scrollbar { height: 8px; }
        .aq-scr::-webkit-scrollbar-thumb { background: #DDDCD5; border-radius: 8px; }
      `}</style>

      {/* Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ font: `700 11px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>BAIT PREPAGO · PORTABILIDAD</span>
          <h1 style={{ margin: 0, font: `800 28px ${SANS}`, letterSpacing: '-0.028em', lineHeight: 1.1 }}>Analítica de adquisición</h1>
          <p style={{ margin: 0, font: `500 13.5px ${SANS}`, color: MUTED, maxWidth: '62ch' }}>
            De dónde llega el tráfico de la landing y qué fuentes generan más leads.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: CARD, border: `1px solid ${LINE}`, borderRadius: 20, padding: '6px 12px' }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: GREEN, boxShadow: `0 0 0 3px rgba(27,127,75,0.14)` }} />
            <span style={{ font: `600 12px ${SANS}`, color: '#4B4B44' }}>
              {data?.health.lastEventAt
                ? `Último evento ${new Date(data.health.lastEventAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : 'Sin eventos recientes'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => exportCsv(data?.campaigns ?? [])}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: INK, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 15px', font: `700 12.5px ${SANS}`, cursor: 'pointer' }}
          >
            Exportar CSV
          </button>
        </div>
      </header>

      {/* Filtros (sticky) */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 11, position: 'sticky', top: 0, zIndex: 30 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <div className="aq-scr" style={{ display: 'flex', gap: 4, background: BG, border: `1px solid #EDECE6`, borderRadius: 11, padding: 3, overflowX: 'auto' }}>
            {([['7d', 'Últimos 7 días', 7], ['30d', 'Últimos 30 días', 30], ['90d', 'Últimos 90 días', 90]] as const).map(([id, label, days]) => {
              const active = rangeId === id;
              return (
                <button key={id} type="button" onClick={() => setPreset(id, days)}
                  style={{ whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', borderRadius: 8, padding: '7px 11px', font: `700 12.5px ${SANS}`, background: active ? INK : 'transparent', color: active ? '#fff' : MUTED }}>
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={dateFrom} max={dateTo}
              onChange={(e) => { setDateFrom(e.target.value); setRangeId('custom'); }}
              style={inputStyle} />
            <span style={{ color: MUTED, font: `600 12px ${SANS}` }}>–</span>
            <input type="date" value={dateTo} min={dateFrom} max={today}
              onChange={(e) => { setDateTo(e.target.value); setRangeId('custom'); }}
              style={inputStyle} />
            <button type="button" onClick={() => { setGran('dia'); refresh({ gran: 'dia' }); }}
              style={{ border: 'none', background: INK, color: '#fff', borderRadius: 8, padding: '7px 13px', font: `700 12px ${SANS}`, cursor: 'pointer' }}>
              Aplicar
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ font: `600 12px ${SANS}`, color: MUTED }}>Comparar</span>
            <Seg value={compare} onChange={(v) => { setCompare(v); refresh({ compare: v }); }}
              options={[{ id: 'prev', label: 'Período anterior' }, { id: 'none', label: 'Ninguno' }]} />
          </div>

          <div style={{ flex: '1 1 20px' }} />

          <button type="button" onClick={() => setAdvOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              border: `1px solid ${channel ? AMBER_BD : LINE}`, background: channel ? AMBER_SOFT : CARD, color: '#4B4B44',
              borderRadius: 10, padding: '8px 13px', font: `700 12.5px ${SANS}`,
            }}>
            Filtros
            <span style={{ font: `700 10.5px ${SANS}`, background: channel ? AMBER : '#F0EFEA', color: channel ? INK : MUTED, borderRadius: 20, minWidth: 17, padding: '1px 5px', textAlign: 'center' }}>
              {channel ? 1 : 0}
            </span>
          </button>
        </div>

        {channel && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTop: `1px dashed #EAE9E3`, paddingTop: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `700 11.5px ${SANS}`, color: '#8C6A00' }}>
              <span style={{ width: 5, height: 5, borderRadius: 5, background: '#E0A800' }} />
              Vista filtrada · no muestra todo el tráfico
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, background: AMBER_SOFT, border: `1px solid ${AMBER_BD}`, borderRadius: 20, padding: '4px 6px 4px 11px', font: `700 11.5px ${SANS}`, color: INK }}>
              <span style={{ color: '#8C6A00', fontWeight: 600 }}>Canal</span>
              {CHANNELS[channel as ChannelId]?.label ?? channel}
              <button type="button" onClick={clearFilters} aria-label="Quitar filtro"
                style={{ border: 'none', background: '#F0DFAB', color: '#6B5200', width: 16, height: 16, borderRadius: 16, cursor: 'pointer', font: `700 11px ${SANS}`, lineHeight: 1 }}>
                ×
              </button>
            </span>
          </div>
        )}

        {advOpen && (
          <div style={{ borderTop: `1px solid #EFEEE9`, paddingTop: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ font: `700 11px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>CANAL</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {(Object.keys(CHANNELS) as ChannelId[]).map((id) => {
                const active = channel === id;
                return (
                  <button key={id} type="button" onClick={() => toggleChannel(id)}
                    style={{
                      cursor: 'pointer', borderRadius: 8, padding: '5px 9px', font: `600 12px ${SANS}`,
                      border: `1px solid ${active ? AMBER_BD : LINE}`,
                      background: active ? AMBER_SOFT : CARD, color: active ? INK : MUTED,
                    }}>
                    {CHANNELS[id].label}
                  </button>
                );
              })}
            </div>
            <div style={{ font: `500 11px ${SANS}`, color: MUTED, marginTop: 4 }}>
              Zona horaria: CDMX · los rangos de fecha usan America/Mexico_City.
            </div>
          </div>
        )}
      </section>

      {error && (
        <div style={{ padding: '14px 18px', background: '#FDF0EE', border: `1px solid #F6D5D1`, borderRadius: 12, color: RED_FG, font: `600 13px ${SANS}` }}>
          {error}
        </div>
      )}

      {loading && !data && <Skeleton rangeLabel={rangeLabel} />}

      {isEmpty && (
        <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '72px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: BG, border: `1px solid ${LINE}` }} />
          <div style={{ font: `800 17px ${SANS}` }}>Sin tráfico en el período seleccionado</div>
          <div style={{ font: `500 13.5px ${SANS}`, color: MUTED, maxWidth: '44ch' }}>
            No se registraron sesiones en la landing entre las fechas elegidas. Amplía el rango o revisa la salud del tracking.
          </div>
          <button type="button" onClick={() => setPreset('30d', 30)}
            style={{ border: 'none', background: INK, color: '#fff', borderRadius: 10, padding: '9px 15px', font: `700 12.5px ${SANS}`, cursor: 'pointer', marginTop: 6 }}>
            Ver últimos 30 días
          </button>
        </div>
      )}

      {data && derived && !isEmpty && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
          <KpiRow d={derived} data={data} />
          <PaidMedia data={data} />
          <TrendAndSplit
            data={data} d={derived}
            metric={trendMetric} setMetric={setTrendMetric}
            gran={gran} setGran={(g) => { setGran(g); refresh({ gran: g }); }}
            hover={hover} setHover={setHover}
            compareLabel={compare === 'prev' ? 'Período anterior' : ''}
          />
          <ChannelAndFunnel
            d={derived} data={data} channel={channel} onPickChannel={toggleChannel}
            chMetric={chMetric} setChMetric={setChMetric}
          />
          <FunnelBySource data={data} avgCvr={derived.avgCvr} />
          <CampaignTable
            data={data} d={derived}
            sort={campSort} setSort={setCampSort}
            query={campQuery} setQuery={setCampQuery}
            page={campPage} setPage={setCampPage}
            onDrill={setDrill}
          />
          <UtmMatrixDevice
            data={data} d={derived}
            utmDim={utmDim} setUtmDim={setUtmDim}
            device={device} onPickDevice={toggleDevice}
          />
          <Heatmap heatmap={data.heatmap} metric={heatMetric} setMetric={setHeatMetric} />
          <LandingAndOrganic data={data} d={derived} />
          <HealthRow data={data} d={derived} nowMs={nowMs} />
          <Observations data={data} d={derived} rangeLabel={rangeLabel} channel={channel} />
          <footer style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px' }}>
            <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>
              Zona horaria: CDMX · las métricas de landing son propias; medios y Search Console requieren conexión con cada plataforma.
            </span>
            <span style={{ font: `500 11.5px ${MONO}`, color: MUTED }}>bait · analítica de adquisición</span>
          </footer>
        </div>
      )}

      {drill && <DrillPanel campaign={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#FBFBF9', border: `1px solid ${LINE}`, borderRadius: 8, color: INK,
  font: `500 12px ${MONO}`, padding: '6px 9px', outline: 'none', colorScheme: 'light',
};

// ── KPI row ───────────────────────────────────────────────────────────────────
function KpiRow({ d, data }: { d: Derived; data: Acquisition }) {
  const spark = data.spark;
  const kpis = [
    { label: 'Sesiones', val: nf(d.sessions), cur: d.sessions, prev: d.prevSum.sessions, s: spark.sessions, big: false },
    { label: 'Inicios de formulario', val: nf(d.formStart), cur: d.formStart, prev: d.prevSum.formStart, s: spark.formStart, big: false },
    { label: 'Leads', val: nf(d.leads), cur: d.leads, prev: d.prevSum.leads, s: spark.leads, big: true },
    { label: 'Tasa de conversión', val: pf(d.cvr, 2), cur: d.cvr, prev: d.prevCvr, s: spark.leads, big: true },
    { label: 'Tasa de inicio', val: pf(d.fsr, 1), cur: d.fsr, prev: d.prevFsr, s: spark.formStart, big: false },
  ];
  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
      {kpis.map((k) => {
        const dl = delta(k.cur, k.prev);
        return (
          <div key={k.label} style={{
            background: CARD, border: `1px solid ${k.big ? '#DEDCD2' : LINE}`, borderRadius: 16,
            padding: '16px 17px 15px', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0,
            boxShadow: k.big ? '0 1px 3px rgba(22,22,15,0.05)' : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ font: `700 12px ${SANS}`, color: MUTED }}>{k.label}</span>
              <span style={{ font: `600 9.5px ${MONO}`, color: MUTED }}>Landing</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ font: `800 ${k.big ? 28 : 24}px ${SANS}`, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{k.val}</div>
              <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: 64, height: 26, flex: '0 0 64px', overflow: 'visible' }} aria-hidden>
                <path d={seriesPath(k.s.length ? k.s : [0, 0], 100, 30, false)} fill="none" stroke={k.big ? '#E0A800' : '#C9C8C0'} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, font: `700 12px ${SANS}`, color: dl.color, background: dl.bg, borderRadius: 6, padding: '2px 6px' }}>
                {dl.arrow} {dl.pct}
              </span>
              <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>vs período anterior</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ── Paid media ───────────────────────────────────────────────────────────────
function PaidMedia({ data }: { data: Acquisition }) {
  const gAds = data.integrations.googleAds;

  if (!gAds) {
    return (
      <Card>
        <CardHead title="Medios pagados" sub="inversión, CPC, CPL e impresiones · métricas de plataforma" />
        <NotConnected
          title="Google Ads y Meta Ads no están conectados o no hay datos recientes"
          body="Conecta las cuentas de medios para ver inversión, clics, CPC, CPM y CPL junto a los leads que ya registra la landing. Mientras no exista conexión, esta sección no muestra estimaciones."
          chips={['inversión', 'impresiones', 'clics', 'ctr', 'cpc', 'cpm', 'cpl']}
          cta="Conectar en Configuración"
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHead title="Medios pagados" sub="inversión, CPC, CPL e impresiones · métricas de plataforma" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, padding: '0 20px 20px' }}>
        <div style={{ background: '#fafafa', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
          <div style={{ font: `600 12px ${SANS}`, color: MUTED }}>Inversión</div>
          <div style={{ font: `700 20px ${SANS}`, marginTop: 4 }}>{cf(gAds.costMicros / 1000000)}</div>
        </div>
        <div style={{ background: '#fafafa', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
          <div style={{ font: `600 12px ${SANS}`, color: MUTED }}>Impresiones</div>
          <div style={{ font: `700 20px ${SANS}`, marginTop: 4 }}>{nf(gAds.impressions)}</div>
        </div>
        <div style={{ background: '#fafafa', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
          <div style={{ font: `600 12px ${SANS}`, color: MUTED }}>Clics</div>
          <div style={{ font: `700 20px ${SANS}`, marginTop: 4 }}>{nf(gAds.clicks)}</div>
        </div>
        <div style={{ background: '#fafafa', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
          <div style={{ font: `600 12px ${SANS}`, color: MUTED }}>Conversiones (Ads)</div>
          <div style={{ font: `700 20px ${SANS}`, marginTop: 4 }}>{nf(gAds.conversions)}</div>
        </div>
      </div>
      
      <div style={{ padding: '0 20px 20px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 0', font: `600 12px ${SANS}`, color: MUTED, borderBottom: `1px solid ${LINE}` }}>Campaña (Google Ads)</th>
              <th style={{ padding: '8px 0', font: `600 12px ${SANS}`, color: MUTED, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>Inversión</th>
              <th style={{ padding: '8px 0', font: `600 12px ${SANS}`, color: MUTED, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>Impresiones</th>
              <th style={{ padding: '8px 0', font: `600 12px ${SANS}`, color: MUTED, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>Clics</th>
              <th style={{ padding: '8px 0', font: `600 12px ${SANS}`, color: MUTED, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>Conversiones</th>
            </tr>
          </thead>
          <tbody>
            {gAds.campaigns.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '20px 0', textAlign: 'center', color: MUTED, font: `500 13px ${SANS}` }}>No hay campañas activas en este período</td>
              </tr>
            ) : gAds.campaigns.map(c => (
              <tr key={c.id}>
                <td style={{ padding: '10px 0', font: `500 13px ${SANS}`, borderBottom: `1px solid ${LINE}` }}>{c.name}</td>
                <td style={{ padding: '10px 0', font: `500 13px ${SANS}`, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{cf(c.costMicros / 1000000)}</td>
                <td style={{ padding: '10px 0', font: `500 13px ${SANS}`, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{nf(c.impressions)}</td>
                <td style={{ padding: '10px 0', font: `500 13px ${SANS}`, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{nf(c.clicks)}</td>
                <td style={{ padding: '10px 0', font: `500 13px ${SANS}`, borderBottom: `1px solid ${LINE}`, textAlign: 'right' }}>{nf(c.conversions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Trend + Paid vs Organic ───────────────────────────────────────────────────
function TrendAndSplit({
  data, d, metric, setMetric, gran, setGran, hover, setHover, compareLabel,
}: {
  data: Acquisition; d: Derived;
  metric: TrendMetric; setMetric: (m: TrendMetric) => void;
  gran: 'dia' | 'semana'; setGran: (g: 'dia' | 'semana') => void;
  hover: number | null; setHover: (i: number | null) => void;
  compareLabel: string;
}) {
  const metricVal = (p: TrendPoint) => metric === 'leads' ? p.leads : metric === 'formStart' ? p.formStart : metric === 'cvr' ? (p.sessions ? p.leads / p.sessions : 0) : p.sessions;
  const isPct = metric === 'cvr';
  const vals = data.trend.map(metricVal);
  const cvals = compareLabel ? data.trendCompare.map(metricVal) : [];
  const peak = Math.max(...vals, ...(cvals.length ? cvals : [0]), isPct ? 0.001 : 1);
  const fmtV = (v: number) => (isPct ? pf(v, 2) : nf(v));
  const W = 1000, H = 246;

  const ylabels = Array.from({ length: 5 }, (_, i) => ({
    t: isPct ? pf((peak * (4 - i)) / 4, 1) : cf((peak * (4 - i)) / 4),
    c: i === 4 ? LINE : '#F2F1EC',
  }));
  const step = Math.max(1, Math.ceil(data.trend.length / 7));
  const xlabels = data.trend.filter((_, i) => i % step === 0).map((p) => shortBucket(p.bucket, gran));

  const metricLabel = { sessions: 'Sesiones', formStart: 'Inicios de formulario', leads: 'Leads', cvr: 'Tasa de conversión' }[metric];
  const total = isPct ? pf(d.cvr, 2) : nf(vals.reduce((a, b) => a + b, 0));

  const hoverPoint = hover != null && data.trend[hover] ? data.trend[hover] : null;
  const hx = hover != null && data.trend.length > 1 ? (hover / (data.trend.length - 1)) * 100 : 50;

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14, alignItems: 'start' }}>
      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px 30px', gridColumn: 'span 2', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Tráfico y conversiones</h2>
            <span style={{ font: `500 12px ${SANS}`, color: MUTED }}>
              {rangeSub(data)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Seg value={metric} onChange={setMetric} options={[
              { id: 'sessions', label: 'Sesiones' }, { id: 'formStart', label: 'Inicios' },
              { id: 'leads', label: 'Leads' }, { id: 'cvr', label: 'CVR' },
            ]} />
            <Seg value={gran} onChange={setGran} options={[
              { id: 'dia', label: 'Día' }, { id: 'semana', label: 'Semana', disabled: data.trend.length < 10 },
            ]} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `600 12px ${SANS}`, color: '#4B4B44' }}>
            <span style={{ width: 14, height: 3, borderRadius: 3, background: INK }} />{metricLabel}
          </span>
          {compareLabel && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `600 12px ${SANS}`, color: MUTED }}>
              <span style={{ width: 14, height: 0, borderTop: `2px dashed #B4B3AA` }} />{compareLabel}
            </span>
          )}
          <span style={{ font: `600 12px ${SANS}`, color: '#4B4B44', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            Total <strong style={{ fontWeight: 800 }}>{total}</strong> · pico {fmtV(Math.max(...vals, 0))}
          </span>
        </div>

        <div style={{ position: 'relative', height: H, width: '100%' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            {ylabels.map((y, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, height: 0 }}>
                <span style={{ font: `500 10.5px ${MONO}`, color: MUTED, width: 44, textAlign: 'right', flex: '0 0 44px', transform: 'translateY(-1px)' }}>{y.t}</span>
                <span style={{ flex: 1, borderTop: `1px solid ${y.c}` }} />
              </div>
            ))}
          </div>
          <div style={{ position: 'absolute', left: 53, right: 0, top: 0, bottom: 0 }}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }} role="img" aria-label={`${metricLabel} por ${gran}`}>
              <defs>
                <linearGradient id="aqtgrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={AMBER} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={AMBER} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <path d={seriesPath(vals, W, H, true, peak)} fill="url(#aqtgrad)" stroke="none" />
              {cvals.length > 0 && (
                <path d={seriesPath(cvals, W, H, false, peak)} fill="none" stroke="#B4B3AA" strokeWidth={1.6} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
              )}
              <path d={seriesPath(vals, W, H, false, peak)} fill="none" stroke={INK} strokeWidth={2.1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {hoverPoint && (
              <>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${hx}%`, width: 1, background: INK, opacity: 0.18 }} />
                <div style={{
                  position: 'absolute', left: `${hx}%`, top: 8, transform: `translateX(${hx > 72 ? '-102%' : '10px'})`,
                  background: INK, color: '#fff', borderRadius: 10, padding: '9px 11px', pointerEvents: 'none', minWidth: 140, boxShadow: '0 6px 20px rgba(22,22,15,0.22)',
                }}>
                  <div style={{ font: `700 11px ${SANS}`, color: '#FFD873', marginBottom: 5 }}>{shortBucket(hoverPoint.bucket, gran)}</div>
                  {[['Sesiones', nf(hoverPoint.sessions)], ['Inicios', nf(hoverPoint.formStart)], ['Leads', nf(hoverPoint.leads)], ['CVR', pf(hoverPoint.sessions ? hoverPoint.leads / hoverPoint.sessions : 0, 2)]].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, font: `600 11.5px ${SANS}`, padding: '1.5px 0', fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: '#B9B8B0' }}>{k}</span><span>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                setHover(Math.round(p * (data.trend.length - 1)));
              }}
              onMouseLeave={() => setHover(null)}
              style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
            />
          </div>
          <div style={{ position: 'absolute', left: 53, right: 0, bottom: -22, display: 'flex', justifyContent: 'space-between' }}>
            {xlabels.map((x, i) => <span key={i} style={{ font: `500 10.5px ${MONO}`, color: MUTED, whiteSpace: 'nowrap' }}>{x}</span>)}
          </div>
        </div>
      </div>

      {/* Pagado vs orgánico */}
      <Card>
        <CardHead title="Pagado vs orgánico" sub="participación de sesiones y de leads" />
        {(['Sesiones', 'Leads'] as const).map((kind) => {
          const key = kind === 'Sesiones' ? 's' : 'l';
          const total = d.groups.reduce((a, g) => a + (g as never as Record<string, number>)[key], 0) || 1;
          return (
            <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', font: `600 11.5px ${SANS}`, color: MUTED }}>
                <span>{kind}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{nf(total)}</span>
              </div>
              <div style={{ display: 'flex', height: 26, borderRadius: 7, overflow: 'hidden', gap: 2 }}>
                {d.groups.map((g) => {
                  const v = (g as never as Record<string, number>)[key];
                  const pct = v / total;
                  return (
                    <div key={g.g} title={`${g.g}: ${nf(v)} (${pf(pct, 1)})`} style={{ width: `${pct * 100}%`, background: g.color, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 2 }}>
                      <span style={{ font: `800 10.5px ${SANS}`, color: g.g === 'Pagado' || g.g === 'Orgánico' ? '#fff' : '#4B4B44', opacity: pct > 0.09 ? 1 : 0 }}>{pf(pct, 0)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#EFEEE9', border: `1px solid #EFEEE9`, borderRadius: 10, overflow: 'hidden' }}>
          {d.groups.map((g) => (
            <div key={g.g} style={{ background: CARD, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color, flex: '0 0 8px' }} />
              <span style={{ font: `700 12.5px ${SANS}`, flex: 1, minWidth: 0 }}>{g.g}</span>
              <span style={{ font: `600 11.5px ${SANS}`, color: MUTED, width: 66, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pf(g.s / (d.sessions || 1), 0)} tráf.</span>
              <span style={{ font: `800 12.5px ${SANS}`, width: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: cvrColor(g.cvr, d.avgCvr) }}>{pf(g.cvr, 1)}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

// ── Channel table + funnel ────────────────────────────────────────────────────
function ChannelAndFunnel({
  d, data, channel, onPickChannel, chMetric, setChMetric,
}: {
  d: Derived; data: Acquisition; channel: string | null;
  onPickChannel: (id: string) => void; chMetric: TrendMetric; setChMetric: (m: TrendMetric) => void;
}) {
  const cmVal = (c: (typeof d.channels)[number]) =>
    chMetric === 'leads' ? c.leads : chMetric === 'formStart' ? c.formStart : chMetric === 'cvr' ? c.cvr : c.sessions;
  const cmMax = Math.max(...d.channels.map(cmVal), 0.0001);

  // funnel
  const T = data.funnel.totals;
  const stages = FUNNEL_ORDER.map((k) => ({ key: k, label: FUNNEL_LABELS[k], v: T[k] || 0 }));
  let worst = 1, worstDrop = 0;
  for (let i = 1; i < stages.length; i++) {
    const drop = stages[i - 1].v ? 1 - stages[i].v / stages[i - 1].v : 0;
    if (drop > worstDrop) { worstDrop = drop; worst = i; }
  }
  const entryDrop = stages[0].v ? 1 - stages[1].v / stages[0].v : 0;
  const base1 = stages[1].v || 1;

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 14, alignItems: 'start' }}>
      <Card>
        <CardHead title="Rendimiento por canal" sub="clic en un canal para filtrar todo el tablero"
          right={<Seg value={chMetric} onChange={setChMetric} options={[
            { id: 'sessions', label: 'Sesiones' }, { id: 'formStart', label: 'Inicios' }, { id: 'leads', label: 'Leads' }, { id: 'cvr', label: 'CVR' },
          ]} />} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 6px' }}>
            <span style={{ flex: 1, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>CANAL</span>
            {['SESIONES', 'INICIOS', 'LEADS', 'CVR'].map((h, i) => (
              <span key={h} style={{ width: [74, 60, 52, 50][i], textAlign: 'right', font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>{h}</span>
            ))}
          </div>
          {d.channels.map((c) => {
            const sel = channel === c.id;
            return (
              <div key={c.id} role="button" tabIndex={0} onClick={() => onPickChannel(c.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onPickChannel(c.id); }}
                style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 8px', borderRadius: 9, cursor: 'pointer', background: sel ? AMBER_SOFT : 'transparent', boxShadow: sel ? `inset 0 0 0 1px ${AMBER_BD}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c.meta.color, flex: '0 0 8px' }} />
                  <span style={{ flex: 1, minWidth: 0, font: `700 13px ${SANS}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.meta.label}</span>
                  <span style={{ width: 74, textAlign: 'right', font: `600 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(c.sessions)}</span>
                  <span style={{ width: 60, textAlign: 'right', font: `600 12.5px ${SANS}`, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{nf(c.formStart)}</span>
                  <span style={{ width: 52, textAlign: 'right', font: `800 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(c.leads)}</span>
                  <span style={{ width: 50, textAlign: 'right', font: `700 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums', color: cvrColor(c.cvr, d.avgCvr) }}>{pf(c.cvr, 1)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 6, background: '#F2F1EC', overflow: 'hidden' }}>
                  <div style={{ height: 6, width: `${(cmVal(c) / cmMax) * 100}%`, background: sel ? AMBER : c.meta.color, borderRadius: 6 }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHead title="Embudo de conversión" sub={`sesión → lead · ${channel ? CHANNELS[channel as ChannelId]?.label ?? channel : 'todo el tráfico'}`}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#FFF1F0', border: `1px solid #F6D5D1`, borderRadius: 9, padding: '6px 11px' }}>
              <span style={{ width: 6, height: 6, borderRadius: 6, background: '#C0392B' }} />
              <span style={{ font: `700 12px ${SANS}`, color: RED_FG }}>Mayor fuga: {stages[worst].label} · -{(worstDrop * 100).toFixed(0)}%</span>
            </div>
          } />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {stages.map((s, i) => {
            const prev = i ? stages[i - 1].v : s.v;
            const drop = i && prev ? 1 - s.v / prev : 0;
            const w = i === 0 ? (stages[0].v ? Math.min(100, s.v / stages[0].v * 100) : 0) : Math.min(100, s.v / base1 * 100);
            return (
              <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 9px', borderRadius: 9, background: i === worst ? '#FFFBEF' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ font: `700 12.5px ${SANS}`, flex: 1, minWidth: 0 }}>{s.label}</span>
                  <span style={{ font: `800 14px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(s.v)}</span>
                  <span style={{ width: 52, textAlign: 'right', font: `600 11.5px ${SANS}`, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{pf(stages[0].v ? s.v / stages[0].v : 0, 1)}</span>
                </div>
                <div style={{ height: 22, borderRadius: 6, background: '#F2F1EC', overflow: 'hidden' }}>
                  <div style={{ height: 22, width: `${w}%`, background: i === worst ? AMBER : i === stages.length - 1 ? GREEN : INK, borderRadius: 6 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ font: `600 11px ${SANS}`, color: MUTED }}>{i ? `${pf(prev ? s.v / prev : 0, 1)} del paso anterior` : 'punto de entrada'}</span>
                  {i > 0 && <span style={{ font: `700 11px ${SANS}`, color: i === worst ? RED_FG : MUTED }}>−{nf(prev - s.v)} ({pf(drop, 0)})</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ font: `500 11px ${SANS}`, color: MUTED, borderTop: `1px solid #F4F3EE`, paddingTop: 10 }}>
          Solo {pf(1 - entryDrop, 1)} de las sesiones abre el formulario. Las barras 2–6 se escalan sobre los inicios de formulario para poder compararse; los porcentajes de la derecha siguen siendo sobre sesiones.
        </div>
      </Card>
    </section>
  );
}

// ── Funnel by source ──────────────────────────────────────────────────────────
function FunnelBySource({ data, avgCvr }: { data: Acquisition; avgCvr: number }) {
  const byKey = new Map(data.funnel.byGroup.map((g) => [g.group, g]));
  const groups = (['google', 'meta', 'organic', 'direct'] as const).map(
    (key) => byKey.get(key) ?? ({ group: key } as Record<string, number> & { group: string }),
  );
  const anyData = data.funnel.byGroup.some((g) => (g.sessions || 0) > 0);
  return (
    <Card>
      <CardHead title="Embudo por fuente" sub="distingue un problema de adquisición de uno de conversión en la landing" />
      {!anyData && (
        <div style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>
          Sin sesiones atribuidas a Google Ads, Meta Ads, orgánico o directo en el período. El tráfico llega sin <code style={{ font: `500 11px ${MONO}` }}>source_category</code>.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 }}>
        {groups.map((g) => {
          const meta = GROUP_META[g.group] ?? { label: g.group, color: '#9A9A8F' };
          const s = g.sessions || 0;
          const cvr = s ? (g.lead || 0) / s : 0;
          return (
            <div key={g.group} style={{ border: `1px solid #EFEEE9`, borderRadius: 12, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color }} />
                <span style={{ font: `700 13px ${SANS}`, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {FUNNEL_ORDER.map((k) => {
                  const v = (g as Record<string, number>)[k] || 0;
                  const pct = s ? v / s : 0;
                  return (
                    <div key={k} title={`${FUNNEL_LABELS[k]}: ${nf(v)} (${pf(pct, 1)})`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 78, flex: '0 0 78px', font: `500 10.5px ${SANS}`, color: MUTED }}>{FUNNEL_LABELS[k].split(' · ')[0]}</span>
                      <span style={{ flex: 1, height: 10, borderRadius: 3, background: '#F2F1EC', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: 10, width: `${Math.min(100, pct * 100)}%`, background: meta.color, borderRadius: 3 }} />
                      </span>
                      <span style={{ width: 40, textAlign: 'right', font: `600 10.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{pf(pct, 0)}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid #F4F3EE`, paddingTop: 8, font: `700 11.5px ${SANS}` }}>
                <span style={{ color: MUTED }}>{cf(s)} → {nf(g.lead || 0)}</span>
                <span style={{ color: cvrColor(cvr, avgCvr) }}>{pf(cvr, 1)} CVR</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function Heatmap({ heatmap, metric, setMetric }: { heatmap: HeatCell[]; metric: HeatMetric; setMetric: (m: HeatMetric) => void }) {
  const grid: Record<number, Record<number, HeatCell>> = {};
  heatmap.forEach((c) => { (grid[c.dow] ??= {})[c.hour] = c; });
  const val = (c?: HeatCell) => !c ? 0 : metric === 'leads' ? c.leads : metric === 'cvr' ? (c.sessions ? c.leads / c.sessions : 0) : c.sessions;
  let max = 0, best = { v: -1, d: 0, h: 0 };
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const v = val(grid[d]?.[h]);
    if (v > max) max = v;
    if (v > best.v) best = { v, d, h };
  }
  const ramp = ['#F7F6F2', '#FDF0CE', '#FBE39B', '#F9CF5A', '#F0B400', '#D19400'];
  const order = Array.from({ length: 7 }, (_, k) => (k + 1) % 7); // Lun..Dom

  return (
    <Card>
      <CardHead title="Actividad por hora y día (CDMX)" sub="promedio del período"
        right={<Seg value={metric} onChange={setMetric} options={[
          { id: 'sessions', label: 'Sesiones' }, { id: 'leads', label: 'Leads' }, { id: 'cvr', label: 'CVR' },
        ]} />} />
      <div className="aq-scr" style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ minWidth: 660, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', gap: 3, paddingLeft: 34 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ flex: 1, textAlign: 'center', font: `500 9.5px ${MONO}`, color: MUTED }}>{String(h).padStart(2, '0')}</span>
            ))}
          </div>
          {order.map((d) => (
            <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 34, flex: '0 0 34px', font: `700 10.5px ${SANS}`, color: MUTED }}>{DAY_NAMES[d]}</span>
              {Array.from({ length: 24 }, (_, h) => {
                const c = grid[d]?.[h];
                const v = val(c);
                const t = max ? v / max : 0;
                const bi = t === 0 ? 0 : Math.min(5, 1 + Math.floor(t * 4.999));
                return (
                  <span key={h}
                    title={`${DAY_NAMES[d]} ${String(h).padStart(2, '0')}:00 — ${nf(c?.sessions ?? 0)} sesiones · ${nf(c?.leads ?? 0)} leads`}
                    style={{ flex: 1, height: 24, borderRadius: 3, background: ramp[bi], boxShadow: d === best.d && h === best.h ? `inset 0 0 0 1.5px ${INK}` : 'none' }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ font: `500 12px ${SANS}`, color: MUTED }}>
        {best.v > 0
          ? `Mejor franja: ${DAY_NAMES[best.d]} ${String(best.h).padStart(2, '0')}:00 — ${metric === 'cvr' ? pf(best.v, 1) + ' CVR' : nf(best.v) + (metric === 'leads' ? ' leads' : ' sesiones')}.`
          : 'Sin actividad suficiente para calcular la mejor franja.'}
      </div>
    </Card>
  );
}

// ── Landing behavior + organic + geo ──────────────────────────────────────────
function LandingAndOrganic({ data, d }: { data: Acquisition; d: Derived }) {
  const L = data.landing;
  const s = L.sessions || 1;
  const orgChannels = d.channels.filter((c) => c.meta.group === 'Orgánico' || c.meta.group === 'Referral');
  const oS = orgChannels.reduce((a, c) => a + c.sessions, 0);
  const oL = orgChannels.reduce((a, c) => a + c.leads, 0);
  const secMax = Math.max(...L.sections.map((x) => x.sessions), 1);

  const geoMax = data.geo[0]?.leads || 1;

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14, alignItems: 'start' }}>
      <Card>
        <CardHead title="Comportamiento en la landing" sub="eventos de scroll, CTA y secciones vistas" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 1, background: '#EFEEE9', border: `1px solid #EFEEE9`, borderRadius: 10, overflow: 'hidden' }}>
          {[
            ['Scroll ≥ 50%', L.scroll50 / s],
            ['Scroll ≥ 90%', L.scroll90 / s],
            ['Clic en CTA', L.cta / s],
            ['Inicio de formulario', L.formStart / s],
          ].map(([label, v]) => (
            <div key={label as string} style={{ background: CARD, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ font: `600 11px ${SANS}`, color: MUTED }}>{label}</span>
              <span style={{ font: `800 19px ${SANS}`, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums' }}>{pf(v as number, 0)}</span>
            </div>
          ))}
        </div>
        {L.sections.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {L.sections.map((x) => (
              <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 88, flex: '0 0 88px', font: `600 12px ${SANS}`, color: '#4B4B44' }}>{SECTION_NAMES[x.id] ?? x.id}</span>
                <span style={{ flex: 1, height: 14, borderRadius: 4, background: '#F2F1EC', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: 14, width: `${(x.sessions / secMax) * 100}%`, background: INK, borderRadius: 4 }} />
                </span>
                <span style={{ width: 44, textAlign: 'right', font: `700 11.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{pf(x.sessions / s, 0)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>Aún no se registran eventos de sección (`section_id`) en el período.</div>
        )}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <Card style={{ gap: 13 }}>
          <CardHead title="Tráfico orgánico" sub="orgánico + referral registrado por la landing" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))', gap: 1, background: '#EFEEE9', border: `1px solid #EFEEE9`, borderRadius: 10, overflow: 'hidden' }}>
            {[['Sesiones', nf(oS)], ['Leads', nf(oL)], ['CVR', pf(oS ? oL / oS : 0, 1)]].map(([l, v]) => (
              <div key={l} style={{ background: CARD, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ font: `600 11px ${SANS}`, color: MUTED }}>{l}</span>
                <span style={{ font: `800 19px ${SANS}`, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
          </div>
          <NotConnected
            title="Search Console no conectado"
            body="Clics, impresiones, CTR, posición media y consultas principales requieren conexión con Google Search Console."
          />
        </Card>

        <Card style={{ gap: 13 }}>
          <CardHead title="Leads por estado" sub="estado declarado por el lead en el formulario" />
          {data.geo.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.geo.map((r, i) => (
                <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 120, flex: '0 0 120px', font: `600 12px ${SANS}`, color: '#4B4B44', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{STATE_NAMES[r.code] ?? r.code}</span>
                  <span style={{ flex: 1, height: 12, borderRadius: 4, background: '#F2F1EC', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: 12, width: `${(r.leads / geoMax) * 100}%`, background: i < 2 ? INK : '#B4B3A6', borderRadius: 4 }} />
                  </span>
                  <span style={{ width: 40, textAlign: 'right', font: `700 11.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.leads)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>Sin leads en el período.</div>
          )}
        </Card>
      </div>
    </section>
  );
}

// ── Health / quality / delivery row ──────────────────────────────────────────
function HealthRow({ data, d, nowMs }: { data: Acquisition; d: Derived; nowMs: number }) {
  const H = data.health;
  const cov = H.sessions ? H.attributed / H.sessions : 0;
  const noUtm = H.sessions ? H.noUtm / H.sessions : 0;
  const lastMs = H.lastEventAt ? nowMs - new Date(H.lastEventAt).getTime() : null;
  const stale = lastMs != null && lastMs > 3 * 3600 * 1000;
  const bad = cov < 0.6 || stale;

  const D = data.delivery;
  const deliveryRows = [
    ['Lead exitoso', D.total, '100%', INK],
    ['Entregado a CRM', D.delivered, D.total ? pf(D.delivered / D.total, 1) : '—', GREEN],
    ['Fallido en entrega', D.failed, D.total ? pf(D.failed / D.total, 1) : '—', '#C0392B'],
    ['Duplicado', D.duplicate, D.total ? pf(D.duplicate / D.total, 1) : '—', '#D9B45A'],
    ['Pendiente', D.pending, D.total ? pf(D.pending / D.total, 1) : '—', MUTED],
  ] as const;

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14, alignItems: 'start' }}>
      <Card style={{ gap: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: 7, background: bad ? '#D98E00' : GREEN, boxShadow: `0 0 0 3px ${bad ? 'rgba(217,142,0,0.16)' : 'rgba(27,127,75,0.14)'}` }} />
          <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Salud del tracking</h2>
          <span style={{ marginLeft: 'auto', font: `700 12px ${SANS}`, color: bad ? '#8C5A00' : GREEN_FG, background: bad ? '#FFF6E6' : '#EAF6EF', border: `1px solid ${bad ? '#F2DFB8' : '#C9E6D5'}`, padding: '3px 9px', borderRadius: 20 }}>
            {bad ? 'Atención' : 'Saludable'}
          </span>
        </div>
        <div style={{ font: `500 12.5px ${SANS}`, color: MUTED }}>
          {stale
            ? 'No se reciben eventos hace más de 3 horas. Revisa el tracking de la landing.'
            : `Cobertura de atribución de ${pf(cov, 1)} sobre ${nf(H.sessions)} sesiones del período.`}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#EFEEE9', border: `1px solid #EFEEE9`, borderRadius: 10, overflow: 'hidden' }}>
          {[
            ['Ingesta de eventos', stale ? 'sin datos recientes' : 'operativa', stale ? '#C0392B' : GREEN],
            ['Cobertura de atribución', pf(cov, 1), cov > 0.6 ? GREEN : '#D98E00'],
            ['Sesiones sin UTM', pf(noUtm, 0), '#D9B45A'],
            ['Sesiones atribuidas', nf(H.attributed), MUTED],
            ['Último evento recibido', H.lastEventAt ? relTime(new Date(H.lastEventAt), nowMs) : '—', stale ? '#C0392B' : GREEN],
          ].map(([label, val, c]) => (
            <div key={label as string} style={{ background: CARD, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: 6, background: c as string, flex: '0 0 6px' }} />
              <span style={{ flex: 1, minWidth: 0, font: `600 12px ${SANS}`, color: '#4B4B44' }}>{label}</span>
              <span style={{ font: `700 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ gap: 13 }}>
        <CardHead title="Calidad del tráfico" sub="agregados de protección · excluidos de los KPI" />
        <div style={{ border: `1px dashed #DEDDD5`, background: '#FBFBF9', borderRadius: 10, padding: '14px 15px', font: `500 12px ${SANS}`, color: MUTED, textWrap: 'pretty' } as React.CSSProperties}>
          El tráfico sospechoso, los intentos de formulario bloqueados y las solicitudes con límite de tasa se registran en el panel de <strong style={{ color: INK }}>Seguridad</strong>, no en analítica de adquisición. Aquí solo se cuentan sesiones aceptadas.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#EFEEE9', border: `1px solid #EFEEE9`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ background: CARD, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, font: `600 12px ${SANS}`, color: '#4B4B44' }}>Sesiones aceptadas (contabilizadas)</span>
            <span style={{ font: `700 12.5px ${SANS}`, color: GREEN_FG, fontVariantNumeric: 'tabular-nums' }}>{nf(d.sessions)}</span>
          </div>
        </div>
      </Card>

      <Card style={{ gap: 13 }}>
        <CardHead title="Entrega de leads" sub="¿el sistema procesó lo que generó marketing?" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#EFEEE9', border: `1px solid #EFEEE9`, borderRadius: 10, overflow: 'hidden' }}>
          {deliveryRows.map(([label, val, pct, c]) => (
            <div key={label} style={{ background: CARD, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: c, flex: '0 0 6px' }} />
              <span style={{ flex: 1, minWidth: 0, font: `600 12px ${SANS}`, color: '#4B4B44' }}>{label}</span>
              <span style={{ font: `600 11.5px ${SANS}`, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{pct}</span>
              <span style={{ font: `700 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums', width: 52, textAlign: 'right' }}>{nf(val)}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

// ── Observations ──────────────────────────────────────────────────────────────
function Observations({ data, d, rangeLabel, channel }: {
  data: Acquisition; d: Derived; rangeLabel: string; channel: string | null;
}) {
  const T = data.funnel.totals;
  const stages = FUNNEL_ORDER.map((k) => T[k] || 0);
  let worst = 1, worstDrop = 0;
  for (let i = 1; i < stages.length; i++) {
    const drop = stages[i - 1] ? 1 - stages[i] / stages[i - 1] : 0;
    if (drop > worstDrop) { worstDrop = drop; worst = i; }
  }
  const topCh = d.channels.slice().sort((a, b) => b.leads - a.leads)[0];
  const paidS = d.groups.find((g) => g.g === 'Pagado')?.s ?? 0;
  const orgS = d.groups.find((g) => g.g === 'Orgánico')?.s ?? 0;
  const H = data.health;
  const cov = H.sessions ? H.attributed / H.sessions : 0;

  const insights: { tag: string; tagC: string; text: string }[] = [];
  if (topCh && d.leads) insights.push({ tag: 'CONCENTRACIÓN', tagC: '#8B8A80', text: `${topCh.meta.label} concentra ${pf(topCh.leads / d.leads, 0)} de los leads del período.` });
  if (worstDrop > 0) insights.push({ tag: 'EMBUDO', tagC: AMBER, text: `La mayor fuga ocurre en "${FUNNEL_LABELS[FUNNEL_ORDER[worst]]}": se pierde ${pf(worstDrop, 0)} respecto al paso anterior.` });
  if (paidS + orgS > 0) insights.push({ tag: 'MEZCLA', tagC: '#8B8A80', text: `El tráfico pagado representa ${pf(paidS / (d.sessions || 1), 0)} de las sesiones y el orgánico ${pf(orgS / (d.sessions || 1), 0)}.` });
  insights.push({ tag: 'ETIQUETADO', tagC: AMBER, text: `${pf(1 - cov, 0)} de las sesiones llegan sin fuente atribuible (source_category = other / sin UTM).` });
  const dl = delta(d.leads, d.prevSum.leads);
  if (dl.up != null) insights.push({ tag: 'TENDENCIA', tagC: '#8B8A80', text: `Los leads ${dl.up ? 'subieron' : 'bajaron'} ${dl.pct} frente al período anterior.` });

  return (
    <Card dark style={{ background: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 6, height: 6, borderRadius: 6, background: AMBER }} />
        <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, color: '#fff', letterSpacing: '-0.015em' }}>Observaciones del período</h2>
        <span style={{ font: `500 11.5px ${SANS}`, color: '#8B8A80', marginLeft: 'auto' }}>
          {rangeLabel.toLowerCase()}{channel ? ` · ${CHANNELS[channel as ChannelId]?.label}` : ''}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 1, background: '#2B2B22', borderRadius: 12, overflow: 'hidden' }}>
        {insights.map((i, idx) => (
          <div key={idx} style={{ background: '#1C1C14', padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
            <span style={{ font: `700 10px ${SANS}`, letterSpacing: '0.09em', color: i.tagC }}>{i.tag}</span>
            <span style={{ font: `600 13px ${SANS}`, color: '#F2F1EC', lineHeight: 1.45, textWrap: 'pretty' } as React.CSSProperties}>{i.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Campaign table + drill ────────────────────────────────────────────────────
function CampaignTable({
  data, d, sort, setSort, query, setQuery, page, setPage, onDrill,
}: {
  data: Acquisition; d: Derived;
  sort: { k: string; d: number }; setSort: (s: { k: string; d: number }) => void;
  query: string; setQuery: (q: string) => void;
  page: number; setPage: (n: number) => void;
  onDrill: (c: Campaign) => void;
}) {
  const per = 8;
  let rows = data.campaigns.map((c) => ({
    ...c,
    cvr: c.sessions ? c.leads / c.sessions : 0,
    meta: CHANNELS[(c.channel as ChannelId)] ?? { label: 'Otro', group: 'Otro', color: '#DEDDD1' },
  }));
  const q = query.trim().toLowerCase();
  if (q) rows = rows.filter((r) => (r.campaign + ' ' + r.source + ' ' + r.medium).toLowerCase().includes(q));

  // badges (sobre el conjunto filtrado, antes de paginar)
  const totS = d.sessions || 1;
  const eligible = rows.filter((r) => r.sessions >= Math.max(20, totS * 0.02));
  const bestCvr = eligible.slice().sort((a, b) => b.cvr - a.cvr)[0];
  const topLeads = rows.slice().sort((a, b) => b.leads - a.leads)[0];
  const attn = rows.filter((r) => r.sessions >= totS * 0.05 && r.cvr < d.avgCvr * 0.6).sort((a, b) => b.sessions - a.sessions)[0];

  rows.sort((a, b) => {
    const k = sort.k as keyof typeof a;
    const va = a[k], vb = b[k];
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * sort.d;
    return ((Number(va) || 0) - (Number(vb) || 0)) * sort.d;
  });
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const pg = Math.min(page, pages - 1);
  const view = rows.slice(pg * per, (pg + 1) * per);
  const arrow = (k: string) => (sort.k === k ? (sort.d < 0 ? ' ↓' : ' ↑') : '');
  const toggle = (k: string) => setSort({ k, d: sort.k === k ? -sort.d : -1 });

  const cols: [string, string, 'left' | 'right'][] = [
    ['campaign', 'CAMPAÑA', 'left'], ['channel', 'PLATAFORMA', 'left'], ['source', 'SOURCE / MEDIUM', 'left'],
    ['sessions', 'SESIONES', 'right'], ['formStart', 'INICIOS', 'right'], ['leads', 'LEADS', 'right'],
    ['cvr', 'CVR', 'right'], ['spend', 'INVERSIÓN', 'right'], ['cpl', 'CPL', 'right'],
  ];

  return (
    <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
      <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid #EFEEE9`, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Rendimiento por campaña</h2>
          <span style={{ font: `500 12px ${SANS}`, color: MUTED }}>{data.campaigns.length} campañas · clic en una fila para el desglose · inversión y CPL requieren conexión de medios</span>
        </div>
        <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Buscar campaña, fuente o medio"
          style={{ ...inputStyle, font: `500 12.5px ${SANS}`, width: 238, maxWidth: '100%' }} />
      </div>

      {data.campaigns.length === 0 ? (
        <div style={{ padding: '20px', font: `500 12px ${SANS}`, color: MUTED }}>
          Aún no llegan sesiones con <code style={{ font: `500 11.5px ${MONO}` }}>utm_campaign</code>. Cuando las campañas etiqueten sus enlaces, aparecerán aquí con sesiones, inicios y leads.
        </div>
      ) : (
        <>
          <div className="aq-scr" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#FBFBF9' }}>
                  {cols.map(([k, label, al]) => (
                    <th key={k} onClick={() => toggle(k)}
                      style={{ textAlign: al, padding: '10px 14px', font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: sort.k === k ? INK : MUTED, cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: `1px solid #EFEEE9` }}>
                      {label}{arrow(k)}
                    </th>
                  ))}
                  <th style={{ width: 40, borderBottom: `1px solid #EFEEE9` }} />
                </tr>
              </thead>
              <tbody>
                {view.map((r) => {
                  const badges: { label: string; bg: string; fg: string; bd: string }[] = [];
                  if (bestCvr && r === bestCvr) badges.push({ label: 'MEJOR CVR', bg: '#EAF6EF', fg: GREEN_FG, bd: '#C9E6D5' });
                  if (topLeads && r === topLeads && r.leads > 0) badges.push({ label: 'MAYOR VOLUMEN', bg: AMBER_SOFT, fg: '#8C6A00', bd: AMBER_BD });
                  if (attn && r === attn) badges.push({ label: 'REQUIERE ATENCIÓN', bg: '#FDF0EE', fg: RED_FG, bd: '#F6D5D1' });
                  const hot = r.cvr >= d.avgCvr * 1.18, cold = r.cvr <= d.avgCvr * 0.72 && r.sessions > 0;
                  return (
                    <tr key={r.campaign + r.source + r.medium} onClick={() => onDrill(r)} tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') onDrill(r); }}
                      style={{ cursor: 'pointer', borderBottom: `1px solid #F4F3EE`, background: badges.length ? '#FFFDF7' : CARD }}>
                      <td style={{ padding: '11px 14px', maxWidth: 300 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                          <span style={{ font: `700 13px ${SANS}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.campaign}</span>
                          {badges.length > 0 && (
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                              {badges.map((b) => (
                                <span key={b.label} style={{ font: `700 9.5px ${SANS}`, letterSpacing: '0.03em', background: b.bg, color: b.fg, border: `1px solid ${b.bd}`, padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap' }}>{b.label}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `600 12px ${SANS}`, color: '#4B4B44', whiteSpace: 'nowrap' }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: r.meta.color }} />{r.meta.label}
                        </span>
                      </td>
                      <td style={{ padding: '11px 14px', font: `500 11.5px ${MONO}`, color: MUTED, whiteSpace: 'nowrap' }}>{r.source} / {r.medium}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', font: `600 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.sessions)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', font: `600 12.5px ${SANS}`, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{nf(r.formStart)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', font: `800 13px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.leads)}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                        <span style={{ font: `700 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums', color: hot ? GREEN_FG : cold ? RED_FG : '#4B4B44', background: hot ? '#EAF6EF' : cold ? '#FDF0EE' : 'transparent', padding: '3px 7px', borderRadius: 6 }}>{pf(r.cvr, 1)}</span>
                      </td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', font: `600 12.5px ${SANS}`, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>—</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', font: `600 12.5px ${SANS}`, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>—</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', font: `700 13px ${SANS}`, color: MUTED }}>›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#FBFBF9', borderTop: `1px solid #EFEEE9` }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[[GREEN_FG, 'CVR sobre el promedio'], [RED_FG, 'CVR bajo el promedio'], [MUTED, '— sin datos de plataforma']].map(([c, l]) => (
                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, font: `500 11.5px ${SANS}`, color: MUTED }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: c }} />{l}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>{pg * per + 1}–{Math.min(rows.length, (pg + 1) * per)} de {rows.length}</span>
              <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)} style={pageBtn(pg === 0)}>‹</button>
              <button type="button" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} style={pageBtn(pg >= pages - 1)}>›</button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Atribución UTM + Matriz fuente/medio + Dispositivo ───────────────────────
function UtmMatrixDevice({
  data, d, utmDim, setUtmDim, device, onPickDevice,
}: {
  data: Acquisition; d: Derived;
  utmDim: UtmDim; setUtmDim: (v: UtmDim) => void;
  device: string | null; onPickDevice: (id: string) => void;
}) {
  const utmRows = data.utm
    .filter((r) => r.dim === utmDim)
    .map((r) => ({ ...r, cvr: r.sessions ? r.leads / r.sessions : 0, warn: r.val === '(sin valor)' }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 7);
  const utmMax = Math.max(...utmRows.map((r) => r.sessions), 1);

  const sm = data.sourceMedium.map((r) => ({ ...r, cvr: r.sessions ? r.leads / r.sessions : 0 }));

  const devTotalS = data.devices.reduce((a, x) => a + x.sessions, 0) || 1;
  const devMax = Math.max(...data.devices.map((x) => x.sessions), 1);
  const devices = data.devices
    .map((x) => ({
      ...x,
      cvr: x.sessions ? x.leads / x.sessions : 0,
      compl: x.formStart ? x.leads / x.formStart : 0,
      label: DEVICE_LABELS[x.device] ?? x.device,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 14, alignItems: 'start' }}>
      {/* Atribución · UTM */}
      <Card>
        <CardHead title="Atribución · UTM" sub="participación por parámetro · incluye tráfico sin etiquetar"
          right={
            <div className="aq-scr" style={{ display: 'flex', gap: 3, background: BG, border: `1px solid #EDECE6`, borderRadius: 10, padding: 3, overflowX: 'auto', maxWidth: '100%' }}>
              {(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as UtmDim[]).map((dim) => {
                const active = dim === utmDim;
                return (
                  <button key={dim} type="button" onClick={() => setUtmDim(dim)}
                    style={{ cursor: 'pointer', border: 'none', borderRadius: 7, padding: '5px 9px', font: `500 11px ${MONO}`, whiteSpace: 'nowrap', background: active ? INK : 'transparent', color: active ? '#fff' : MUTED }}>
                    {dim}
                  </button>
                );
              })}
            </div>
          } />
        {utmRows.length === 0 ? (
          <div style={{ font: `500 12px ${SANS}`, color: MUTED }}>Sin sesiones en el período para esta dimensión.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 2px 6px' }}>
              <span style={{ flex: 1, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>VALOR</span>
              {['SESIONES', 'LEADS', 'CVR'].map((h, i) => (
                <span key={h} style={{ width: [70, 48, 48][i], textAlign: 'right', font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>{h}</span>
              ))}
            </div>
            {utmRows.map((r) => (
              <div key={r.val} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 2px', borderTop: `1px solid #F4F3EE` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ font: `500 12px ${MONO}`, color: r.warn ? RED_FG : INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.val}</span>
                    {r.warn && <span style={{ font: `700 9.5px ${SANS}`, background: '#FFF1F0', color: RED_FG, border: `1px solid #F6D5D1`, padding: '2px 5px', borderRadius: 5, whiteSpace: 'nowrap' }}>diagnóstico</span>}
                  </span>
                  <span style={{ width: 70, textAlign: 'right', font: `600 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.sessions)}</span>
                  <span style={{ width: 48, textAlign: 'right', font: `800 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.leads)}</span>
                  <span style={{ width: 48, textAlign: 'right', font: `700 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums', color: cvrColor(r.cvr, d.avgCvr) }}>{pf(r.cvr, 1)}</span>
                </div>
                <div style={{ height: 5, borderRadius: 5, background: '#F2F1EC', overflow: 'hidden' }}>
                  <div style={{ height: 5, width: `${(r.sessions / utmMax) * 100}%`, background: r.warn ? '#D9B45A' : INK, borderRadius: 5 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Matriz fuente / medio */}
        <Card style={{ gap: 13 }}>
          <CardHead title="Matriz fuente / medio" sub="más útil que un pie de fuentes" />
          {sm.length === 0 ? (
            <div style={{ font: `500 12px ${SANS}`, color: MUTED }}>Sin tráfico en el período.</div>
          ) : (
            <div className="aq-scr" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 340, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {[['FUENTE / MEDIO', 'left'], ['SESIONES', 'right'], ['LEADS', 'right'], ['CVR', 'right']].map(([h, al]) => (
                      <th key={h} style={{ textAlign: al as 'left' | 'right', padding: '0 10px 8px', font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sm.map((r) => (
                    <tr key={r.source + '/' + r.medium} style={{ borderTop: `1px solid #F4F3EE` }}>
                      <td style={{ padding: '9px 10px', font: `500 11.5px ${MONO}`, color: '#4B4B44', whiteSpace: 'nowrap' }}>{r.source} / {r.medium}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', font: `600 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.sessions)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', font: `800 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.leads)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', font: `700 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums', color: cvrColor(r.cvr, d.avgCvr) }}>{pf(r.cvr, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Rendimiento por dispositivo */}
        <Card style={{ gap: 13 }}>
          <CardHead title="Rendimiento por dispositivo" sub="¿la UX móvil necesita trabajo?" />
          {devices.length === 0 ? (
            <div style={{ font: `500 12px ${SANS}`, color: MUTED }}>Sin datos de dispositivo en el período.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 2px 4px' }}>
                <span style={{ flex: 1, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>DISPOSITIVO</span>
                {['SESIONES', 'LEADS', 'CVR', 'COMPL.'].map((h, i) => (
                  <span key={h} style={{ width: [66, 46, 46, 54][i], textAlign: 'right', font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>{h}</span>
                ))}
              </div>
              {devices.map((r) => {
                const sel = device === r.device;
                return (
                  <div key={r.device} role="button" tabIndex={0} onClick={() => onPickDevice(r.device)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onPickDevice(r.device); }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 6px', borderRadius: 9, cursor: 'pointer', background: sel ? AMBER_SOFT : 'transparent', boxShadow: sel ? `inset 0 0 0 1px ${AMBER_BD}` : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, font: `700 13px ${SANS}` }}>{r.label}</span>
                      <span style={{ width: 66, textAlign: 'right', font: `600 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.sessions)}</span>
                      <span style={{ width: 46, textAlign: 'right', font: `800 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(r.leads)}</span>
                      <span style={{ width: 46, textAlign: 'right', font: `700 12.5px ${SANS}`, fontVariantNumeric: 'tabular-nums', color: cvrColor(r.cvr, d.avgCvr) }}>{pf(r.cvr, 1)}</span>
                      <span style={{ width: 54, textAlign: 'right', font: `600 12.5px ${SANS}`, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{pf(r.compl, 0)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, height: 6, borderRadius: 6, background: '#F2F1EC', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: 6, width: `${(r.sessions / devMax) * 100}%`, background: sel ? AMBER : r.device === 'mobile' ? INK : '#63625A', borderRadius: 6 }} />
                      </span>
                      <span style={{ font: `500 10.5px ${MONO}`, color: MUTED, width: 38, textAlign: 'right' }}>{pf(r.sessions / devTotalS, 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

const pageBtn = (dis: boolean): React.CSSProperties => ({
  border: `1px solid ${LINE}`, background: CARD, borderRadius: 8, padding: '6px 12px',
  font: `700 12px ${SANS}`, color: dis ? '#C9C8C0' : INK, cursor: dis ? 'not-allowed' : 'pointer',
});

function DrillPanel({ campaign, onClose }: {
  campaign: Campaign; onClose: () => void;
}) {
  const cvr = campaign.sessions ? campaign.leads / campaign.sessions : 0;
  const meta = CHANNELS[(campaign.channel as ChannelId)] ?? { label: campaign.channel, color: '#9A9A8F', group: 'Otro' };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,15,0.34)', zIndex: 60 }} />
      <aside className="aq-scr" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(520px,100%)', background: CARD,
        borderLeft: `1px solid ${LINE}`, zIndex: 61, overflowY: 'auto', boxShadow: '-14px 0 40px rgba(22,22,15,0.16)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 22px 16px', borderBottom: `1px solid #EFEEE9`, display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', top: 0, background: CARD, zIndex: 3 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `600 11.5px ${SANS}`, color: MUTED }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: meta.color }} />{meta.label} · {campaign.source} / {campaign.medium}
              </span>
              <h2 style={{ margin: 0, font: `800 19px ${SANS}`, letterSpacing: '-0.025em', textWrap: 'pretty' } as React.CSSProperties}>{campaign.campaign}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar"
              style={{ border: `1px solid ${LINE}`, background: CARD, width: 30, height: 30, borderRadius: 9, cursor: 'pointer', font: `700 15px ${SANS}`, color: MUTED, flex: '0 0 30px' }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(78px,1fr))', gap: 1, background: '#EFEEE9', border: `1px solid #EFEEE9`, borderRadius: 10, overflow: 'hidden' }}>
            {[['Sesiones', nf(campaign.sessions)], ['Inicios', nf(campaign.formStart)], ['Leads', nf(campaign.leads)], ['CVR', pf(cvr, 1)]].map(([l, v]) => (
              <div key={l} style={{ background: CARD, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ font: `600 10.5px ${SANS}`, color: MUTED, whiteSpace: 'nowrap' }}>{l}</span>
                <span style={{ font: `800 16px ${SANS}`, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '18px 22px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ font: `700 12.5px ${SANS}` }}>Embudo de la campaña</div>
            {[['Sesiones', campaign.sessions], ['Inicio del formulario', campaign.formStart], ['Lead exitoso', campaign.leads]].map(([n, v], i, arr) => {
              const prev = i ? (arr[i - 1][1] as number) : (v as number);
              const drop = i && prev ? 1 - (v as number) / prev : 0;
              return (
                <div key={n as string} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 130, flex: '0 0 130px', font: `600 11.5px ${SANS}`, color: '#4B4B44' }}>{n}</span>
                  <span style={{ flex: 1, height: 14, borderRadius: 4, background: '#F2F1EC', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: 14, width: `${campaign.sessions ? Math.min(100, (v as number) / campaign.sessions * 100) : 0}%`, background: i === 2 ? GREEN : INK, borderRadius: 4 }} />
                  </span>
                  <span style={{ width: 48, textAlign: 'right', font: `700 11.5px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{nf(v as number)}</span>
                  <span style={{ width: 44, textAlign: 'right', font: `600 11px ${SANS}`, color: drop > 0.3 ? RED_FG : MUTED, fontVariantNumeric: 'tabular-nums' }}>{i ? '−' + pf(drop, 0) : ''}</span>
                </div>
              );
            })}
          </div>
          <div style={{ border: `1px dashed #DEDDD5`, background: '#FBFBF9', borderRadius: 11, padding: '14px 15px', font: `500 12px ${SANS}`, color: MUTED, textWrap: 'pretty' } as React.CSSProperties}>
            El desglose por grupo de anuncios y creativo, junto con inversión, clics y CPL, requiere conexión con {meta.label === 'Google Ads' ? 'Google Ads' : meta.label === 'Meta Ads' ? 'Meta Ads' : 'la plataforma de medios'}. Sesiones, inicios y leads salen de la landing BAIT Prepago.
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ rangeLabel }: { rangeLabel: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 12 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div className="aq-shim" style={{ height: 11, width: '58%' }} />
            <div className="aq-shim" style={{ height: 26, width: '74%' }} />
            <div className="aq-shim" style={{ height: 9, width: '42%' }} />
          </div>
        ))}
      </div>
      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 280 }}>
        <div className="aq-shim" style={{ height: 13, width: '32%' }} />
        <div className="aq-shim" style={{ flex: 1, borderRadius: 10 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'center', padding: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: 6, background: AMBER }} />
        <span style={{ font: `600 12px ${SANS}`, color: MUTED }}>Consultando eventos de la landing · {rangeLabel.toLowerCase()}</span>
      </div>
    </div>
  );
}

// ── helpers usados por sub-componentes ────────────────────────────────────────
function shortBucket(bucket: string, gran: 'dia' | 'semana') {
  const d = new Date(bucket.length <= 10 ? bucket + 'T00:00:00Z' : bucket + ':00Z');
  if (Number.isNaN(d.getTime())) return bucket;
  return gran === 'semana' ? 'sem ' + fmtDay(d) : fmtDay(d);
}
function rangeSub(data: Acquisition) {
  const f = new Date(data.range.from), t = new Date(new Date(data.range.to).getTime() - 86400000);
  return `${fmtDay(f)} – ${fmtDay(t)}${data.channelFilter ? ' · ' + (CHANNELS[data.channelFilter as ChannelId]?.label ?? data.channelFilter) : ''}`;
}
function relTime(d: Date, nowMs: number) {
  const ms = nowMs - d.getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'hace segundos';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
function exportCsv(campaigns: Campaign[]) {
  const head = ['campaña', 'source', 'medium', 'canal', 'sesiones', 'inicios', 'leads', 'cvr'];
  const body = campaigns.map((c) => [
    `"${c.campaign.replace(/"/g, '""')}"`, c.source, c.medium, c.channel,
    c.sessions, c.formStart, c.leads, (c.sessions ? (c.leads / c.sessions) * 100 : 0).toFixed(2),
  ].join(','));
  const csv = [head.join(','), ...body].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'bait-analitica-campanas.csv';
  a.click();
}
