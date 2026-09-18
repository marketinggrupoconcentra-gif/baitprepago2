/**
 * src/components/admin/MarketingClient.tsx
 *
 * Tablero de decisión de marketing — vista `/admin/marketing`.
 * Diseño: "Marketing.dc.html" + "Mapa de Leads por Estado.html" (Claude Design),
 * replicados a exactitud.
 *
 * Datos reales de /api/admin/marketing (leads, ventas CRM, Google Ads vía
 * app.ads_metrics, presupuestos de app.settings). El prototipo usaba cifras
 * sintéticas para Search Console, Meta Ads, keywords y creativos; aquí esas
 * secciones muestran un estado "no conectado" honesto — nunca se inventan.
 *
 * El mapa se dibuja con trazos precalculados (src/lib/geo/mexico-states.ts),
 * sin d3 ni GeoJSON remoto (CSP default-src 'self').
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MEXICO_MAP_VIEWBOX, MEXICO_STATES } from '@/lib/geo/mexico-states';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const INK = '#16160F';
const MUTED = '#6E6E64';
const LINE = '#E6E5E0';
const CARD = '#FFFFFF';
const AMBER = '#FFC72C';
const GOOD = '#1B7F4B';
const BAD = '#A33A2A';
const NEUTRAL = '#9C9C90';
const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const RANGES = [
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' },
  { id: 'ytd', label: 'Año' },
];
const TABS = [
  { id: 'exec', label: 'Ejecutivo' },
  { id: 'seo', label: 'SEO' },
  { id: 'sem', label: 'SEM · Keywords' },
  { id: 'google', label: 'Google Ads' },
  { id: 'facebook', label: 'Facebook Ads' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

// ── Tipos del API ─────────────────────────────────────────────────────────────
interface Channel {
  id: string; name: string; color: string;
  leads: number; sales: number; prevLeads: number; prevSales: number;
  spend: number | null; prevSpend: number | null; budget: number | null;
  impressions: number | null; clicks: number | null; conversions: number | null;
}
interface GoogleCampaign {
  id: string; name: string; impressions: number; clicks: number; cost: number; conversions: number; lastDate: string;
  leads: number | null; sales: number | null;
}
export interface Marketing {
  range: { id: string; label: string; days: number; from: string; to: string };
  region: { id: string; label: string };
  regions: { id: string; label: string }[];
  updatedAt: string;
  revenuePerSale: number;
  revenuePerSaleConfigured: boolean;
  integrations: { googleAds: { configured: boolean; hasData: boolean; lastDate: string | null }; metaAds: boolean; searchConsole: boolean };
  channels: Channel[];
  trend: { current: { day: string; leads: number }[]; prior: { day: string; leads: number }[] };
  heatmap: number[][];
  geo: { code: string; leads: number }[];
  googleCampaigns: GoogleCampaign[];
  googleLeadsUnmatched: { campaign: string; leads: number; sales: number }[];
  metaCampaigns: { campaignId: string; utmCampaign: string; leads: number; sales: number }[];
  seoPages: { path: string; leads: number; sales: number }[];
  error?: string;
}
/** Canal con los derivados que usan todas las pestañas. */
type ChannelD = Channel & { revenue: number; prevRevenue: number; cpl: number | null; rate: number; roas: number | null };
export interface Derived {
  ch: ChannelD[];
  t: { leads: number; prevLeads: number; sales: number; prevSales: number; spend: number; prevSpend: number; budget: number };
  revenue: number; prevRevenue: number;
  /** Canales con inversión registrada (hoy: Google Ads). */
  paid: ChannelD[];
  paidLeads: number; paidRevenue: number;
  google: ChannelD; meta: ChannelD; organic: ChannelD;
  rps: number;
}

// ── Formato ───────────────────────────────────────────────────────────────────
const nf = (n: number) => Math.round(n).toLocaleString('es-MX');
const money = (n: number) => '$' + Math.round(n).toLocaleString('es-MX');
const money2 = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number, d = 1) => (n * 100).toFixed(d) + '%';
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
/** Δ porcentual vs. período anterior; null cuando no hay base de comparación. */
const delta = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null);
const deltaTxt = (d: number | null, suffix = '') => (d == null ? 'sin base anterior' : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%${suffix}`);
/** Color de un delta: `up` indica si subir es bueno (leads) o malo (gasto). */
const deltaCol = (d: number | null, up = true) => (d == null ? NEUTRAL : (d >= 0) === up ? GOOD : BAD);
const dayLabel = (day: string) => { const [, m, d] = day.split('-'); return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`; };

// ── Piezas de UI ──────────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, ...style }}>
      {children}
    </div>
  );
}
function CardHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <h3 style={{ margin: 0, font: `700 14.5px ${SANS}`, letterSpacing: '-0.015em' }}>{title}</h3>
        {sub && <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>{sub}</span>}
      </div>
      {right}
    </div>
  );
}
function NotConnected({ title, body, chips }: { title: string; body: string; chips?: string[] }) {
  return (
    <div style={{ border: '1px dashed #DEDDD5', background: '#FBFBF9', borderRadius: 12, padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ font: `800 14px ${SANS}`, color: INK }}>{title}</div>
      <div style={{ font: `500 12.5px ${SANS}`, color: MUTED, maxWidth: '64ch', textWrap: 'pretty' } as React.CSSProperties}>{body}</div>
      {chips && chips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {chips.map((c) => <span key={c} style={{ font: `600 11px ${MONO}`, color: MUTED, background: '#F2F1EC', borderRadius: 6, padding: '4px 8px' }}>{c}</span>)}
        </div>
      )}
    </div>
  );
}
function Kpi({ label, val, delta: d, dCol, wide }: { label: string; val: string; delta: string; dCol: string; wide?: boolean }) {
  return (
    <div className="mk-kpi" style={{ flex: `1 1 ${wide ? 200 : 180}px`, minWidth: 0, background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 7, transition: 'box-shadow .18s ease, transform .18s ease' }}>
      <span style={{ font: `700 12px ${SANS}`, color: MUTED }}>{label}</span>
      <span style={{ font: `800 20px ${SANS}`, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
      <span style={{ font: `700 11.5px ${SANS}`, color: dCol }}>{d}</span>
    </div>
  );
}
function Summary({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, font: `500 13px ${SANS}`, color: '#54544C', maxWidth: '100ch', textWrap: 'pretty' } as React.CSSProperties}>{children}</p>;
}
function Pill({ label, on, onClick, size = 11.5 }: { label: string; on: boolean; onClick: () => void; size?: number }) {
  return (
    <button onClick={onClick} style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', borderRadius: 8, font: `${on ? 700 : 600} ${size}px ${SANS}`, background: on ? CARD : 'transparent', color: on ? INK : MUTED, boxShadow: on ? '0 1px 3px rgba(22,22,15,0.1)' : 'none', transition: 'background .14s ease', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );
}
const Grid = ({ cols, children, head }: { cols: string; children: React.ReactNode; head: string[] }) => (
  <>
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, font: `700 11px ${SANS}`, color: MUTED, padding: '0 4px 8px', borderBottom: '1px solid #F0EFEA' }}>
      {head.map((h) => <span key={h}>{h}</span>)}
    </div>
    {children}
  </>
);
const Row = ({ cols, children }: { cols: string; children: React.ReactNode }) => (
  <div className="mk-row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, padding: '9px 4px', borderBottom: '1px solid #F5F4EF', font: `500 12.5px ${SANS}`, alignItems: 'center', borderRadius: 8, transition: 'background .12s ease' }}>
    {children}
  </div>
);
const Empty = ({ text }: { text: string }) => <span style={{ font: `500 12px ${SANS}`, color: MUTED, padding: '6px 4px' }}>{text}</span>;

// ── Mapa de leads por estado ("Mapa de Leads por Estado.html") ───────────────
const STATE_NAMES = Object.fromEntries(MEXICO_STATES.map((s) => [s.code, s.name]));
/** Interpola #F5F4EF → #7A5600 (igual que d3.interpolateRgb del prototipo). */
function mapColor(t: number): string {
  const a = [0xf5, 0xf4, 0xef], b = [0x7a, 0x56, 0x00];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}
export function LeadsMap({ geo, days }: { geo: { code: string; leads: number }[]; days: number }) {
  const [tip, setTip] = useState<{ x: number; y: number; code: string } | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const counts = useMemo(() => new Map(geo.map((g) => [g.code, g.leads])), [geo]);
  const max = Math.max(1, ...geo.map((g) => g.leads));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: `600 11px ${SANS}`, color: MUTED, padding: '0 4px' }}>
        <span>menos</span>
        <div style={{ display: 'flex', height: 10, borderRadius: 4, overflow: 'hidden', width: 160 }}>
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => <div key={t} style={{ flex: 1, background: mapColor(t) }} />)}
        </div>
        <span>más</span>
      </div>
      <div ref={holder} style={{ position: 'relative', width: '100%', background: '#F5F5F3', borderRadius: 12, padding: 8 }} onMouseLeave={() => setTip(null)}>
        <svg viewBox={MEXICO_MAP_VIEWBOX} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Mapa de concentración de leads por estado">
          {MEXICO_STATES.map((s) => {
            const v = counts.get(s.code);
            return (
              <path
                key={s.code}
                d={s.d}
                className="mk-state"
                fill={v ? mapColor(v / max) : '#EFEEE9'}
                stroke="#FFFFFF"
                strokeWidth={1}
                onMouseMove={(e) => {
                  const r = holder.current?.getBoundingClientRect();
                  if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, code: s.code });
                }}
              />
            );
          })}
        </svg>
        {tip && (
          <div style={{ position: 'absolute', left: tip.x, top: tip.y, pointerEvents: 'none', background: INK, color: '#fff', font: `600 12px ${SANS}`, padding: '7px 10px', borderRadius: 8, whiteSpace: 'nowrap', transform: 'translate(-50%,-110%)', zIndex: 10 }}>
            {STATE_NAMES[tip.code]}<br />
            <span style={{ opacity: 0.7, fontWeight: 500 }}>{nf(counts.get(tip.code) ?? 0)} leads ({days} días)</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Derivados compartidos por todas las pestañas (puro: facilita pruebas con datos reales). */
export function deriveMarketing(data: Marketing): Derived {
  const rps = data.revenuePerSale;
  const ch: ChannelD[] = data.channels.map((c) => ({
    ...c,
    revenue: c.sales * rps,
    prevRevenue: c.prevSales * rps,
    cpl: c.spend != null && c.leads > 0 ? c.spend / c.leads : null,
    rate: ratio(c.sales, c.leads),
    roas: c.spend != null && c.spend > 0 ? (c.sales * rps) / c.spend : null,
  }));
  const t = {
    leads: ch.reduce((a, c) => a + c.leads, 0),
    prevLeads: ch.reduce((a, c) => a + c.prevLeads, 0),
    sales: ch.reduce((a, c) => a + c.sales, 0),
    prevSales: ch.reduce((a, c) => a + c.prevSales, 0),
    spend: ch.reduce((a, c) => a + (c.spend ?? 0), 0),
    prevSpend: ch.reduce((a, c) => a + (c.prevSpend ?? 0), 0),
    budget: ch.reduce((a, c) => a + (c.budget ?? 0), 0),
  };
  const revenue = t.sales * rps, prevRevenue = t.prevSales * rps;
  const paid = ch.filter((c) => c.spend != null); // canales con inversión registrada (hoy: Google Ads)
  const paidLeads = paid.reduce((a, c) => a + c.leads, 0);
  const paidRevenue = paid.reduce((a, c) => a + c.revenue, 0);
  const google = ch.find((c) => c.id === 'google_ads')!;
  const meta = ch.find((c) => c.id === 'meta_ads')!;
  const organic = ch.find((c) => c.id === 'organic')!;
  return { ch, t, revenue, prevRevenue, paid, paidLeads, paidRevenue, google, meta, organic, rps };
}

// ── Contenedor: carga /api/admin/marketing y delega en la vista pura ──────────
export default function MarketingClient() {
  const [tab, setTab] = useState<TabId>('exec');
  const [range, setRange] = useState('30d');
  const [region, setRegion] = useState('todas');
  const [data, setData] = useState<Marketing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  // Carga — setState sólo tras await (react-hooks/set-state-in-effect)
  useEffect(() => {
    const id = ++reqId.current;
    let alive = true;
    (async () => {
      await Promise.resolve();
      if (!alive || id !== reqId.current) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/marketing?range=${encodeURIComponent(range)}&region=${encodeURIComponent(region)}`);
        const json = (await res.json()) as Marketing;
        if (!alive || id !== reqId.current) return;
        if (!res.ok || json.error) setError(json.error || `Error ${res.status}`);
        else { setError(null); setData(json); }
      } catch {
        if (alive && id === reqId.current) setError('No se pudo cargar el tablero');
      } finally {
        if (alive && id === reqId.current) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [range, region]);

  return <MarketingView data={data} tab={tab} range={range} region={region} loading={loading} error={error} onTab={setTab} onRange={setRange} onRegion={setRegion} />;
}

export interface MarketingViewProps {
  data: Marketing | null;
  tab: TabId;
  range: string;
  region: string;
  loading: boolean;
  error: string | null;
  onTab: (id: TabId) => void;
  onRange: (id: string) => void;
  onRegion: (id: string) => void;
}

/** Vista pura (sin fetch): la usa el contenedor y las pruebas de render con datos reales. */
export function MarketingView({ data, tab, range, region, loading, error, onTab, onRange, onRegion }: MarketingViewProps) {

  const D = useMemo<Derived | null>(() => (data ? deriveMarketing(data) : null), [data]);

  const gads = data?.integrations.googleAds;
  const hasAds = !!gads?.hasData;
  const days = data?.range.days ?? 30;
  const regionLabel = data ? (data.region.id === 'todas' ? 'todas las regiones' : data.region.label) : '';
  const dim: React.CSSProperties = loading ? { opacity: 0.55, transition: 'opacity .2s' } : { transition: 'opacity .2s' };

  // ── Header: estado de APIs ────────────────────────────────────────────────
  const apiOk = !!gads?.configured;
  const apiText = !data ? 'Cargando…' : apiOk ? 'Google Ads conectado' : 'Google Ads sin conectar';
  const lastSync = !data ? '' : gads?.lastDate ? `datos hasta ${dayLabel(gads.lastDate)}` : apiOk ? 'sin métricas sincronizadas aún' : 'faltan credenciales · Configuración → Integraciones';

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, font: `400 14px ${SANS}`, color: INK, maxWidth: 1440, margin: '0 auto' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .mk-row:hover { background: #FBFBF9; }
        .mk-kpi:hover { box-shadow: 0 6px 18px rgba(22,22,15,0.08); transform: translateY(-2px); }
        .mk-state { cursor: pointer; transition: opacity .15s ease; }
        .mk-state:hover { opacity: 0.75; }
        .mk-tabs::-webkit-scrollbar { display: none; }
        .mk-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; }
        .mk-three { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
        .mk-map { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 14px; }
        @media (max-width: 960px) { .mk-map { grid-template-columns: minmax(0, 1fr); } }
        .mk-table { overflow-x: auto; overflow-y: hidden; }
        .mk-table > div { min-width: 760px; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ font: `700 11px ${SANS}`, letterSpacing: '0.09em', color: MUTED }}>INTELIX · MARKETING Y ADQUISICIÓN</span>
          <h1 style={{ margin: 0, font: `800 27px ${SANS}`, letterSpacing: '-0.03em', lineHeight: 1.08 }}>Tablero de decisión</h1>
          <p style={{ margin: 0, font: `500 13px ${SANS}`, color: MUTED, maxWidth: '76ch', textWrap: 'pretty' } as React.CSSProperties}>
            Leads y ventas cerradas del CRM cruzados con la inversión de Google Ads. Meta Ads y Search Console se muestran cuando estén conectados. Todo el tablero responde a los filtros de período y región.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: CARD, border: `1px solid ${LINE}`, borderRadius: 11, padding: '8px 13px' }}>
            <span style={{ width: 7, height: 7, borderRadius: 7, background: apiOk ? GOOD : BAD, boxShadow: `0 0 0 3px ${apiOk ? 'rgba(27,127,75,0.14)' : 'rgba(163,58,42,0.14)'}`, flex: '0 0 auto' }} />
            <span style={{ font: `600 11.5px ${SANS}`, whiteSpace: 'nowrap' }}>{apiText}</span>
            <span style={{ font: `500 11px ${MONO}`, color: MUTED, whiteSpace: 'nowrap' }}>{lastSync}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 3, background: '#EFEEE9', borderRadius: 10, padding: 3 }}>
              {RANGES.map((r) => <Pill key={r.id} label={r.label} on={r.id === range} onClick={() => onRange(r.id)} />)}
            </div>
            <div style={{ display: 'flex', gap: 3, background: '#EFEEE9', borderRadius: 10, padding: 3, overflowX: 'auto' }}>
              {(data?.regions ?? [{ id: 'todas', label: 'Todas' }]).map((r) => <Pill key={r.id} label={r.label} on={r.id === region} onClick={() => onRegion(r.id)} />)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mk-tabs" style={{ position: 'sticky', top: 0, zIndex: 6, display: 'flex', gap: 4, background: '#EFEEE9', borderRadius: 12, padding: 4, overflowX: 'auto', boxShadow: '0 6px 16px -12px rgba(22,22,15,0.5)' }}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} onClick={() => onTab(t.id)} style={{ cursor: 'pointer', border: 'none', flex: '0 0 auto', whiteSpace: 'nowrap', padding: '9px 14px', borderRadius: 9, font: `${on ? 700 : 600} 12.5px ${SANS}`, background: on ? CARD : 'transparent', color: on ? INK : MUTED, boxShadow: on ? '0 1px 3px rgba(22,22,15,0.1)' : 'none', transition: 'background .15s ease' }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: '13px 16px', background: '#FBEDEA', border: '1px solid #F0D5CE', borderRadius: 12, color: BAD, font: `600 13px ${SANS}` }}>{error}</div>
      )}
      {data && region !== 'todas' && (
        <div style={{ padding: '11px 15px', background: '#FFF6DC', border: '1px solid #F4E2AE', borderRadius: 12, color: '#6B5200', font: `600 12.5px ${SANS}` }}>
          Región {data.region.label}: leads y ventas filtrados por estado del lead. La inversión de Google Ads es nacional (ads_metrics no segmenta por geografía), así que CPL y ROAS de este filtro son aproximados.
        </div>
      )}

      {data && D && (
        <div style={dim}>
          {tab === 'exec' && <ExecTab data={data} D={D} hasAds={hasAds} days={days} regionLabel={regionLabel} />}
          {tab === 'seo' && <SeoTab data={data} D={D} />}
          {tab === 'sem' && <SemTab D={D} hasAds={hasAds} configured={apiOk} />}
          {tab === 'google' && <GoogleTab data={data} D={D} hasAds={hasAds} configured={apiOk} />}
          {tab === 'facebook' && <FacebookTab data={data} D={D} />}
        </div>
      )}
      {!data && !error && (
        <div style={{ padding: 40, textAlign: 'center', font: `600 13px ${SANS}`, color: MUTED }}>Cargando tablero…</div>
      )}
    </div>
  );
}

// ── Pestaña Ejecutivo ─────────────────────────────────────────────────────────
export function ExecTab({ data, D, hasAds, days, regionLabel }: { data: Marketing; D: Derived; hasAds: boolean; days: number; regionLabel: string }) {
  const { ch, t, revenue, prevRevenue, google, rps } = D;

  // Lectura del período — redactada sólo con cifras reales.
  const withLeads = ch.filter((c) => c.leads > 0);
  const bestRate = withLeads.slice().sort((a, b) => b.rate - a.rate)[0];
  const topLeads = withLeads.slice().sort((a, b) => b.leads - a.leads)[0];
  const read = (() => {
    if (t.leads === 0) return `Sin leads registrados en ${regionLabel} durante ${data.range.label.toLowerCase()}.`;
    const parts: string[] = [];
    parts.push(`${topLeads.name} aporta el mayor volumen con ${nf(topLeads.leads)} leads (${pct(ratio(topLeads.leads, t.leads))} del total)`);
    if (t.sales > 0 && bestRate) parts.push(`${bestRate.name} cierra mejor, con ${pct(bestRate.rate)} de tasa de cierre`);
    else parts.push('aún no hay ventas cerradas en el CRM para el período');
    if (hasAds && google.spend != null) {
      parts.push(`Google Ads invirtió ${money(google.spend)}${google.budget != null ? ` contra un presupuesto prorrateado de ${money(google.budget)}` : ''}${google.roas != null ? ` y devuelve ${google.roas.toFixed(1)}x` : ''}`);
    } else parts.push('la inversión de Google Ads no está sincronizada, así que CPL y ROAS no se pueden calcular');
    parts.push(`el ingreso atribuido fue de ${money(revenue)} (${nf(t.sales)} ventas × ${money(rps)} por portabilidad ganada)`);
    return parts.join('. ').replace(/\. ([a-z])/g, (_, c) => `. ${c.toUpperCase()}`) + '.';
  })();

  const kpis = [
    { label: 'INVERSIÓN · GOOGLE ADS', val: hasAds && google.spend != null ? money(google.spend) : '—', delta: hasAds ? deltaTxt(delta(google.spend ?? 0, google.prevSpend ?? 0), ' vs. anterior') : 'sin datos de Google Ads', dCol: hasAds ? deltaCol(delta(google.spend ?? 0, google.prevSpend ?? 0), false) : NEUTRAL },
    { label: 'LEADS', val: nf(t.leads), delta: deltaTxt(delta(t.leads, t.prevLeads)), dCol: deltaCol(delta(t.leads, t.prevLeads)) },
    { label: 'COSTO POR LEAD · GOOGLE ADS', val: google.cpl != null ? money2(google.cpl) : '—', delta: google.cpl != null ? deltaTxt(delta(google.cpl, ratio(google.prevSpend ?? 0, google.prevLeads))) : hasAds ? 'sin leads de Google Ads' : 'sin datos de Google Ads', dCol: google.cpl != null ? deltaCol(delta(google.cpl, ratio(google.prevSpend ?? 0, google.prevLeads)), false) : NEUTRAL },
    { label: 'VENTAS CERRADAS', val: nf(t.sales), delta: deltaTxt(delta(t.sales, t.prevSales)), dCol: deltaCol(delta(t.sales, t.prevSales)) },
    { label: 'INGRESO ATRIBUIDO', val: money(revenue), delta: deltaTxt(delta(revenue, prevRevenue)), dCol: deltaCol(delta(revenue, prevRevenue)) },
    { label: 'ROAS · GOOGLE ADS', val: google.roas != null ? `${google.roas.toFixed(1)}x` : '—', delta: google.roas != null ? deltaTxt(delta(google.roas, ratio(google.prevRevenue, google.prevSpend ?? 0))) : 'requiere inversión y ventas', dCol: google.roas != null ? deltaCol(delta(google.roas, ratio(google.prevRevenue, google.prevSpend ?? 0))) : NEUTRAL },
  ];

  // Proyección lineal: ritmo de los últimos 5 días proyectado a los mismos `days`.
  const cur = data.trend.current.map((p) => p.leads);
  const last5 = cur.slice(-5);
  const pace = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : 0;
  const forecastLeads = pace * days;
  const forecastSpend = hasAds && google.spend != null ? google.spend : null;

  // Tendencia (SVG 720×250, como el diseño)
  const prior = data.trend.prior.map((p) => p.leads);
  const n = Math.max(cur.length, 2);
  // Techo entero del eje (mín. 4) para que las etiquetas no se repitan cuando hay pocos leads.
  const maxY = Math.max(4, Math.ceil(Math.max(0, ...cur, ...prior) * 1.15));
  const px = (i: number) => 46 + (i / (n - 1)) * 670;
  const py = (v: number) => 210 - (v / maxY) * 196;
  const toPts = (a: number[]) => a.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const trendGrid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: 210 - f * 196, label: nf(maxY * f) }));
  const tickIdx = [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor(((n - 1) * 3) / 4), n - 1];
  const trendTicks = Array.from(new Set(tickIdx)).map((i) => ({ left: (px(i) / 720) * 100, label: data.trend.current[i] ? dayLabel(data.trend.current[i].day) : '' }));

  // Inversión contra ingreso (barras 720×285)
  const maxRev = Math.max(1, ...ch.map((c) => Math.max(c.revenue, c.spend ?? 0))) * 1.1;
  const stackBars = ch.map((c, i) => {
    const w = 128, x = 34 + i * 168;
    const revH = (c.revenue / maxRev) * 190, spendH = ((c.spend ?? 0) / maxRev) * 190;
    return { ...c, x, w, left: ((x + w / 2) / 720) * 100, revY: 200 - revH, revH, spendY: 200 - spendH, spendH };
  });

  // Dispersión CPL × tasa de cierre (sólo canales con inversión registrada)
  const scatter = ch.filter((c) => c.cpl != null);
  const cplMax = Math.max(1, ...scatter.map((c) => c.cpl ?? 0)) * 1.25;
  const rateMax = Math.max(0.01, ...scatter.map((c) => c.rate)) * 1.3;
  const spMax = Math.max(1, ...scatter.map((c) => c.spend ?? 0));
  const scatterPts = scatter.map((c) => ({
    name: c.name, color: c.color,
    cx: 52 + ((c.cpl ?? 0) / cplMax) * 654, cy: 248 - (c.rate / rateMax) * 228, r: 12 + Math.sqrt((c.spend ?? 0) / spMax) * 22,
  }));

  // Embudo
  const stages = [
    ...(hasAds ? [
      { label: 'Impresiones · Google Ads', v: google.impressions ?? 0, rate: '—' },
      { label: 'Clics · Google Ads', v: google.clicks ?? 0, rate: `${pct(ratio(google.clicks ?? 0, google.impressions ?? 0), 2)} de impresiones` },
    ] : []),
    { label: 'Leads', v: t.leads, rate: hasAds ? `${pct(ratio(t.leads, google.clicks ?? 0))} de clics (todos los canales)` : '—' },
    { label: 'Ventas', v: t.sales, rate: `${pct(ratio(t.sales, t.leads))} de leads` },
  ];
  const fFills = ['#FFE9B0', AMBER, '#D99A00', INK].slice(4 - stages.length);
  const fTexts = [INK, INK, INK, '#FFFFFF'].slice(4 - stages.length);
  const funnel = stages.map((s, i) => {
    const topW = 380 * Math.pow(0.62, i), botW = 380 * Math.pow(0.62, i + 1);
    const y = 12 + i * 60, h = 48;
    return { ...s, fill: fFills[i], textFill: fTexts[i], top: ((y + 30) / 260) * 100, points: `${210 - topW / 2},${y} ${210 + topW / 2},${y} ${210 + botW / 2},${y + h} ${210 - botW / 2},${y + h}` };
  });

  // Participación por canal
  const shareOf = (key: 'spend' | 'leads' | 'revenue') => {
    const tot = ch.reduce((a, c) => a + (c[key] ?? 0), 0);
    return tot > 0 ? ch.map((c) => ({ w: ((c[key] ?? 0) / tot) * 100, color: c.color, title: `${c.name} · ${pct(ratio(c[key] ?? 0, tot))}` })) : [];
  };
  const shareRows = [
    { label: 'INVERSIÓN', segments: shareOf('spend'), note: hasAds ? 'sólo Google Ads tiene inversión registrada' : 'sin inversión registrada' },
    { label: 'LEADS', segments: shareOf('leads'), note: '' },
    { label: 'INGRESO ATRIBUIDO', segments: shareOf('revenue'), note: '' },
  ];

  // Treemap (slice and dice) del gasto por campaña de Google Ads
  const camp = data.googleCampaigns.filter((c) => c.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 8);
  const treeTotal = camp.reduce((a, c) => a + c.cost, 0);
  const treeColors = [AMBER, '#EAB93C', '#D99A00', '#C08A00', INK, '#3A3A30', '#2F6F5E', '#B9B8AE'];
  const treemap: { x: number; y: number; w: number; h: number; color: string; name: string; value: string; light: boolean }[] = [];
  {
    let tx = 4, ty = 4, tw = 412, th = 242, horiz = true, rem = treeTotal;
    camp.forEach((c, i) => {
      const frac = rem > 0 ? c.cost / rem : 0;
      let w: number, h: number;
      if (i === camp.length - 1) { w = tw; h = th; } else if (horiz) { w = tw * frac; h = th; } else { w = tw; h = th * frac; }
      treemap.push({ x: tx, y: ty, w: Math.max(0, w), h: Math.max(0, h), color: treeColors[i % treeColors.length], name: c.name, value: money(c.cost), light: i < 4 || i === 7 });
      if (horiz) { tx += w; tw -= w; } else { ty += h; th -= h; }
      rem -= c.cost; horiz = !horiz;
    });
  }

  // Heatmap día × franja
  const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const HOURS = ['0-3', '3-6', '6-9', '9-12', '12-15', '15-18', '18-21', '21-24'];
  const heatColors = ['#F5F4EF', '#FFE9B0', AMBER, '#D99A00', '#7A5600'];
  const heatMax = Math.max(1, ...data.heatmap.flat());
  const heatCell = (v: number) => (v === 0 ? heatColors[0] : heatColors[Math.min(4, 1 + Math.floor((v / heatMax) * 4))]);
  const timingNote = (() => {
    if (t.leads === 0) return 'Sin leads en el período para leer horarios.';
    const business = data.heatmap.slice(0, 5).reduce((a, r) => a + r.slice(3, 6).reduce((x, y) => x + y, 0), 0);
    const weekend = data.heatmap.slice(5).reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
    const bShare = ratio(business, t.leads), wShare = ratio(weekend, t.leads);
    return `La franja de 9 a 18 h en días hábiles concentra ${pct(bShare, 0)} de los leads; el fin de semana aporta ${pct(wShare, 0)}. ${wShare < 0.2 ? 'Hay margen para bajar pujas en fin de semana y reinvertir ese presupuesto en horario laboral.' : 'El fin de semana pesa lo suficiente como para mantener pujas parejas toda la semana.'}`;
  })();

  const budgetRows = ch.filter((c) => c.id !== 'other').map((c) => {
    const spend = c.spend, budget = c.budget;
    if (budget == null) return { ...c, pctW: 0, mark: 100, detail: spend != null ? `${money(spend)} gastados` : 'sin fuente de gasto', status: 'Sin presupuesto configurado (Configuración → Presupuesto de marketing)', col: NEUTRAL };
    if (spend == null) return { ...c, pctW: 0, mark: 100, detail: `presupuesto ${money(budget)}`, status: c.id === 'meta_ads' ? 'Gasto no disponible: Meta Marketing API sin conectar' : 'Gasto no disponible para este canal', col: NEUTRAL };
    const r = ratio(spend, budget), over = r > 1;
    return { ...c, pctW: Math.min(100, r * 100), mark: Math.min(99, (1 / Math.max(r, 1)) * 100), detail: `${money(spend)} de ${money(budget)}`, status: over ? `Sobre presupuesto por ${money(spend - budget)} (${pct(r - 1)})` : `Disponible ${money(budget - spend)} (${pct(1 - r)})`, col: over ? BAD : GOOD };
  });

  const cols = '1.5fr .85fr .85fr .85fr .85fr .95fr .95fr .85fr';
  const roasCol = (r: number | null) => (r == null ? MUTED : r >= 8 ? GOOD : r >= 5 ? '#B58900' : BAD);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Lectura del período */}
      <div style={{ background: INK, borderRadius: 18, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <h2 style={{ margin: 0, font: `800 15px ${SANS}`, letterSpacing: '-0.015em', color: '#FFFFFF' }}>Lectura del período · {data.range.label} · {regionLabel}</h2>
          <span style={{ font: `600 11.5px ${SANS}`, color: NEUTRAL }}>vs. período anterior equivalente</span>
        </div>
        <p style={{ margin: 0, font: `500 13.5px ${SANS}`, color: '#E4E3DD', maxWidth: '110ch', lineHeight: 1.55, textWrap: 'pretty' } as React.CSSProperties}>{read}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ flex: '1 1 170px', minWidth: 0, background: '#22221A', border: '1px solid #34342A', borderRadius: 13, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ font: `700 10.5px ${SANS}`, color: NEUTRAL, letterSpacing: '0.05em' }}>{k.label}</span>
              <span style={{ font: `800 21px ${SANS}`, letterSpacing: '-0.025em', color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{k.val}</span>
              <span style={{ font: `700 11px ${SANS}`, color: k.dCol }}>{k.delta}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mk-two">
        {/* Presupuesto contra gasto real */}
        <Card style={{ gap: 13 }}>
          <CardHead title="Presupuesto contra gasto real" sub="La marca vertical señala el presupuesto mensual prorrateado al período." />
          {budgetRows.map((b) => (
            <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <span style={{ font: `700 12px ${SANS}` }}>{b.name}</span>
                <span style={{ font: `500 11.5px ${MONO}`, color: '#54544C' }}>{b.detail}</span>
              </div>
              <div style={{ position: 'relative', height: 12, borderRadius: 7, background: '#F0EFEA', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b.pctW.toFixed(1)}%`, background: b.color, borderRadius: 7 }} />
              </div>
              <div style={{ position: 'relative', height: 9, marginTop: -9 }}>
                {b.budget != null && <div style={{ position: 'absolute', left: `${b.mark.toFixed(1)}%`, top: 0, width: 2, height: 12, background: INK, borderRadius: 2 }} />}
              </div>
              <span style={{ font: `700 11px ${SANS}`, color: b.col }}>{b.status}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #F0EFEA', paddingTop: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: `700 11px ${SANS}`, color: MUTED, letterSpacing: '0.04em' }}>PROYECCIÓN A LOS PRÓXIMOS {days} DÍAS</span>
            <span style={{ font: `800 18px ${SANS}`, letterSpacing: '-0.02em' }}>{nf(forecastLeads)} leads{forecastSpend != null ? ` · ${money(forecastSpend)} de gasto en Google Ads` : ''}</span>
            <span style={{ font: `500 11.5px ${SANS}`, color: '#54544C', textWrap: 'pretty' } as React.CSSProperties}>
              Proyección lineal al ritmo de los últimos 5 días ({pace.toFixed(1)} leads/día){forecastSpend != null && google.budget != null ? `; al ritmo actual Google Ads cerraría ${pct(Math.abs(ratio(forecastSpend, google.budget) - 1))} ${forecastSpend > google.budget ? 'por encima' : 'por debajo'} del presupuesto del período` : ''}.
            </span>
          </div>
        </Card>

        {/* Leads por día */}
        <Card>
          <CardHead title="Leads por día, contra período anterior" right={
            <div style={{ display: 'flex', gap: 13 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 11px ${SANS}`, color: '#54544C' }}><span style={{ width: 14, height: 3, borderRadius: 2, background: AMBER }} />Actual</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 11px ${SANS}`, color: '#54544C' }}><span style={{ width: 14, height: 3, borderRadius: 2, background: '#B9B8AE' }} />Anterior</span>
            </div>
          } />
          <div style={{ position: 'relative' }}>
            <svg viewBox="0 0 720 250" style={{ width: '100%', height: 'auto', display: 'block' }}>
              {trendGrid.map((g) => <line key={g.y} x1="46" y1={g.y} x2="716" y2={g.y} stroke="#F0EFEA" strokeWidth="1" />)}
              {cur.length > 1 && <polygon points={`${toPts(cur)} ${px(cur.length - 1).toFixed(1)},210 ${px(0).toFixed(1)},210`} fill={AMBER} opacity="0.13" />}
              {prior.length > 1 && <polyline points={toPts(prior)} fill="none" stroke="#B9B8AE" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />}
              {cur.length > 1 && <polyline points={toPts(cur)} fill="none" stroke={AMBER} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>
            {trendGrid.map((g) => (
              <span key={g.y} style={{ position: 'absolute', left: 0, top: `${((g.y / 250) * 100).toFixed(1)}%`, transform: 'translateY(-50%)', font: `500 10px ${MONO}`, color: '#8A8A80', whiteSpace: 'nowrap', background: CARD, paddingRight: 2 }}>{g.label}</span>
            ))}
            {trendTicks.map((tk, i) => (
              <span key={i} style={{ position: 'absolute', top: '97%', left: `${tk.left.toFixed(1)}%`, transform: 'translate(-50%,0)', font: `500 10px ${MONO}`, color: '#8A8A80', whiteSpace: 'nowrap' }}>{tk.label}</span>
            ))}
          </div>
        </Card>
      </div>

      <div className="mk-two">
        {/* Inversión contra ingreso */}
        <Card>
          <CardHead title="Inversión contra ingreso atribuido" sub="Barra completa = ingreso (ventas × valor configurado). Segmento oscuro = inversión registrada." />
          {revenue === 0 && t.spend === 0 ? (
            <NotConnected title="Sin ventas ni inversión en el período" body={`${nf(t.leads)} leads registrados, pero el CRM no tiene ventas cerradas (estado comercial Ganado) y Google Ads no tiene gasto sincronizado. La gráfica se llena en cuanto exista cualquiera de los dos.`} />
          ) : (
          <div style={{ position: 'relative' }}>
            <svg viewBox="0 0 720 285" style={{ width: '100%', height: 'auto', display: 'block' }}>
              {stackBars.map((b) => <rect key={b.id + 'r'} x={b.x} y={b.revY} width={b.w} height={b.revH} rx="6" fill={b.color} opacity="0.28" />)}
              {stackBars.map((b) => b.spendH > 0 && <rect key={b.id + 's'} x={b.x} y={b.spendY} width={b.w} height={b.spendH} rx="6" fill={b.color} />)}
            </svg>
            {stackBars.map((b) => (
              <span key={b.id + 'n'} style={{ position: 'absolute', left: `${b.left.toFixed(1)}%`, top: `${((223 / 285) * 100).toFixed(1)}%`, transform: 'translate(-50%,-50%)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', font: `700 11.5px ${SANS}`, whiteSpace: 'nowrap' }}>{b.name}</span>
            ))}
            {stackBars.map((b) => (
              <span key={b.id + 'v'} style={{ position: 'absolute', left: `${b.left.toFixed(1)}%`, top: `${((245 / 285) * 100).toFixed(1)}%`, transform: 'translate(-50%,-50%)', font: `500 10px ${MONO}`, color: '#54544C', whiteSpace: 'nowrap' }}>{money(b.revenue)}</span>
            ))}
            {stackBars.map((b) => (
              <span key={b.id + 'x'} style={{ position: 'absolute', left: `${b.left.toFixed(1)}%`, top: `${((265 / 285) * 100).toFixed(1)}%`, transform: 'translate(-50%,-50%)', font: `700 10.5px ${MONO}`, whiteSpace: 'nowrap' }}>{b.roas != null ? `${b.roas.toFixed(1)}x` : 'sin inversión'}</span>
            ))}
          </div>
          )}
        </Card>

        {/* CPL vs tasa de cierre */}
        <Card>
          <CardHead title="Costo por lead contra tasa de cierre" sub="El tamaño del círculo representa la inversión. Arriba a la izquierda es la zona deseable." />
          {scatterPts.length > 0 ? (
            <div style={{ position: 'relative' }}>
              <svg viewBox="0 0 720 300" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <rect x="52" y="14" width="300" height="130" fill={GOOD} opacity="0.05" />
                {[0, 0.33, 0.66, 1].map((f) => <line key={f} x1="52" y1={248 - f * 228} x2="706" y2={248 - f * 228} stroke="#F0EFEA" strokeWidth="1" />)}
                <line x1="52" y1="248" x2="706" y2="248" stroke={LINE} strokeWidth="1" />
                <text x="379" y="296" textAnchor="middle" fontFamily="Manrope, sans-serif" fontSize="10.5" fontWeight="700" fill={MUTED}>Costo por lead</text>
                {scatterPts.map((p) => <circle key={p.name} cx={p.cx} cy={p.cy} r={p.r} fill={p.color} opacity="0.75" />)}
              </svg>
              {[0, 0.33, 0.66, 1].map((f) => (
                <span key={f} style={{ position: 'absolute', left: 0, top: `${(((248 - f * 228) / 300) * 100).toFixed(1)}%`, transform: 'translateY(-50%)', font: `500 10px ${MONO}`, color: '#8A8A80', background: CARD, paddingRight: 2 }}>{pct(rateMax * f, 0)}</span>
              ))}
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <span key={f} style={{ position: 'absolute', top: '86.5%', left: `${(((52 + f * 654) / 720) * 100).toFixed(1)}%`, transform: 'translate(-50%,0)', font: `500 10px ${MONO}`, color: '#8A8A80' }}>{money(cplMax * f)}</span>
              ))}
              {scatterPts.map((p) => (
                <span key={p.name + 'l'} style={{ position: 'absolute', left: `${((p.cx / 720) * 100).toFixed(1)}%`, top: `${(((p.cy - p.r - 9) / 300) * 100).toFixed(1)}%`, transform: 'translate(-50%,-100%)', font: `700 11px ${SANS}`, whiteSpace: 'nowrap' }}>{p.name}</span>
              ))}
            </div>
          ) : (
            <NotConnected title="Sin inversión registrada en el período" body="El costo por lead se calcula con la inversión de Google Ads (app.ads_metrics). Sincroniza el cron /api/cron/google-ads o revisa las credenciales en Configuración → Integraciones." />
          )}
        </Card>
      </div>

      <div className="mk-three">
        {/* Embudo */}
        <Card>
          <CardHead title="Embudo del período" sub={hasAds ? 'Impresiones y clics de Google Ads; leads y ventas de todos los canales.' : 'Sin impresiones ni clics: Google Ads no tiene datos en el período.'} />
          <div style={{ position: 'relative' }}>
            <svg viewBox="0 0 420 260" style={{ width: '100%', height: 'auto', display: 'block' }}>
              {funnel.map((f) => <polygon key={f.label} points={f.points} fill={f.fill} />)}
            </svg>
            {funnel.map((f) => (
              <span key={f.label + 'c'} style={{ position: 'absolute', left: '50%', top: `${f.top.toFixed(1)}%`, transform: 'translate(-50%,-50%)', font: `800 12.5px ${SANS}`, color: f.textFill, whiteSpace: 'nowrap' }}>{f.label} · {nf(f.v)}</span>
            ))}
            {funnel.map((f) => (
              <span key={f.label + 'r'} style={{ position: 'absolute', left: '97.5%', top: `${f.top.toFixed(1)}%`, transform: 'translate(-100%,-50%)', font: `500 10.5px ${MONO}`, color: MUTED, whiteSpace: 'nowrap' }}>{f.rate}</span>
            ))}
          </div>
        </Card>

        {/* Participación por canal */}
        <Card style={{ gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 style={{ margin: 0, font: `700 14.5px ${SANS}`, letterSpacing: '-0.015em' }}>Participación por canal</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {shareRows.map((s) => (
                <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ font: `700 11px ${SANS}`, color: MUTED, letterSpacing: '0.04em' }}>{s.label}{s.note ? <span style={{ fontWeight: 500, letterSpacing: 0 }}> · {s.note}</span> : null}</span>
                  <div style={{ display: 'flex', height: 22, borderRadius: 7, overflow: 'hidden', background: '#F0EFEA' }}>
                    {s.segments.map((g, i) => <div key={i} title={g.title} style={{ width: `${g.w.toFixed(2)}%`, background: g.color }} />)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, borderTop: '1px solid #F0EFEA', paddingTop: 11 }}>
            {ch.map((c) => (
              <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 11.5px ${SANS}`, color: '#54544C' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c.color }} />{c.name}</span>
            ))}
          </div>
        </Card>

        {/* Reparto del gasto */}
        <Card>
          <CardHead title="Reparto del gasto" sub="Área proporcional a la inversión por campaña de Google Ads." />
          {treemap.length > 0 ? (
            <div style={{ position: 'relative' }}>
              <svg viewBox="0 0 420 250" style={{ width: '100%', height: 'auto', display: 'block' }}>
                {treemap.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="5" fill={r.color} stroke="#FFFFFF" strokeWidth="2" />)}
              </svg>
              {treemap.filter((r) => r.w > 62 && r.h > 26).map((r, i) => (
                <div key={i} style={{ position: 'absolute', left: `${(((r.x + 7) / 420) * 100).toFixed(1)}%`, top: `${(((r.y + 8) / 250) * 100).toFixed(1)}%`, maxWidth: `${(((r.w - 10) / 420) * 100).toFixed(1)}%`, display: 'flex', flexDirection: 'column', gap: 1, color: r.light ? INK : '#FFFFFF' }}>
                  <span style={{ font: `700 ${r.w > 110 ? 11 : 9.5}px ${SANS}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span style={{ font: `500 9.5px ${MONO}`, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <NotConnected title="Sin campañas con gasto en el período" body="El reparto se construye con app.ads_metrics (cron diario de Google Ads). Aparecerá en cuanto haya campañas sincronizadas con costo." />
          )}
        </Card>
      </div>

      <div className="mk-map">
        {/* Mapa */}
        <Card style={{ gap: 10 }}>
          <CardHead title="Concentración de leads por estado" sub="Intensidad proporcional al volumen captado. Pasa el cursor para ver el detalle." />
          <LeadsMap geo={data.geo} days={days} />
          {data.geo.length === 0 && (
            <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>
              {D.t.leads > 0 ? 'Ningún lead del período declaró estado (el formulario prepago no lo pide de forma obligatoria).' : 'Sin leads en el período.'}
            </span>
          )}
        </Card>

        {/* Heatmap */}
        <Card style={{ gap: 11 }}>
          <CardHead title="Cuándo llegan los leads" sub="Día de la semana contra franja horaria (hora de CDMX)." />
          <div style={{ display: 'grid', gridTemplateColumns: '34px repeat(8,1fr)', gap: 4, alignItems: 'center' }}>
            <span />
            {HOURS.map((h) => <span key={h} style={{ font: `600 8.5px ${MONO}`, color: '#9A9A90', textAlign: 'center' }}>{h}</span>)}
            {data.heatmap.map((row, di) => (
              <HeatRow key={DAYS[di]} day={DAYS[di]} cells={row.map((v, bi) => ({ color: heatCell(v), title: `${DAYS[di]} ${HOURS[bi]}h · ${nf(v)} leads` }))} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: `600 11px ${SANS}`, color: MUTED }}>menos</span>
            <div style={{ display: 'flex', gap: 2 }}>{heatColors.map((c) => <div key={c} style={{ width: 16, height: 10, borderRadius: 2, background: c }} />)}</div>
            <span style={{ font: `600 11px ${SANS}`, color: MUTED }}>más</span>
          </div>
          <div style={{ borderTop: '1px solid #F0EFEA', paddingTop: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: `700 11px ${SANS}`, color: MUTED, letterSpacing: '0.04em' }}>DÓNDE AJUSTAR</span>
            <p style={{ margin: 0, font: `500 12.5px ${SANS}`, color: '#3E3E36', lineHeight: 1.5, textWrap: 'pretty' } as React.CSSProperties}>{timingNote}</p>
          </div>
        </Card>
      </div>

      {/* Resumen por canal */}
      <Card style={{ gap: 11 }}>
        <h3 style={{ margin: 0, font: `700 14.5px ${SANS}`, letterSpacing: '-0.015em' }}>Resumen por canal</h3>
        <div className="mk-table"><div>
          <Grid cols={cols} head={['Canal', 'Inversión', 'Leads', 'CPL', 'Ventas', 'Tasa cierre', 'Ingreso', 'ROAS']}>
            {ch.map((c) => (
              <Row key={c.id} cols={cols}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}><span style={{ width: 9, height: 9, borderRadius: 3, flex: '0 0 9px', background: c.color }} />{c.name}</span>
                <span>{c.spend != null ? money(c.spend) : '—'}</span>
                <span>{nf(c.leads)}</span>
                <span>{c.cpl != null ? money2(c.cpl) : '—'}</span>
                <span>{nf(c.sales)}</span>
                <span>{c.leads > 0 ? pct(c.rate) : '—'}</span>
                <span style={{ fontWeight: 700 }}>{money(c.revenue)}</span>
                <span style={{ fontWeight: 800, color: roasCol(c.roas) }}>{c.roas != null ? `${c.roas.toFixed(1)}x` : '—'}</span>
              </Row>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: cols, padding: '10px 4px', font: `700 12.5px ${SANS}`, alignItems: 'center' }}>
              <span>Total</span>
              <span>{hasAds ? money(t.spend) : '—'}</span>
              <span>{nf(t.leads)}</span>
              <span>{hasAds && D.paidLeads > 0 ? money2(t.spend / D.paidLeads) : '—'}</span>
              <span>{nf(t.sales)}</span>
              <span>{t.leads > 0 ? pct(ratio(t.sales, t.leads)) : '—'}</span>
              <span>{money(revenue)}</span>
              <span style={{ fontWeight: 800 }}>{hasAds && t.spend > 0 ? `${(D.paidRevenue / t.spend).toFixed(1)}x` : '—'}</span>
            </div>
          </Grid>
        </div></div>
        <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>
          Ingreso = ventas cerradas × {money(rps)} por portabilidad ganada{data.revenuePerSaleConfigured ? '' : ' (valor por defecto; configúralo en Configuración → Valor de conversión)'}. Inversión, CPL y ROAS sólo para canales con gasto sincronizado (Google Ads). ROAS total = ingreso de esos canales ÷ su inversión.
        </span>
      </Card>
    </div>
  );
}
function HeatRow({ day, cells }: { day: string; cells: { color: string; title: string }[] }) {
  return (
    <>
      <span style={{ font: `700 11px ${SANS}`, color: '#54544C' }}>{day}</span>
      {cells.map((c, i) => <div key={i} title={c.title} style={{ aspectRatio: '1', borderRadius: 4, background: c.color }} />)}
    </>
  );
}

// ── Pestaña SEO ───────────────────────────────────────────────────────────────
export function SeoTab({ data, D }: { data: Marketing; D: Derived }) {
  const o = D.organic;
  const kpis = [
    { label: 'Leads orgánicos', val: nf(o.leads), delta: deltaTxt(delta(o.leads, o.prevLeads)), dCol: deltaCol(delta(o.leads, o.prevLeads)) },
    { label: 'Ventas cerradas', val: nf(o.sales), delta: deltaTxt(delta(o.sales, o.prevSales)), dCol: deltaCol(delta(o.sales, o.prevSales)) },
    { label: 'Tasa de cierre', val: o.leads > 0 ? pct(o.rate) : '—', delta: o.prevLeads > 0 ? `anterior ${pct(ratio(o.prevSales, o.prevLeads))}` : 'sin base anterior', dCol: NEUTRAL },
    { label: 'Ingreso atribuido', val: money(o.revenue), delta: deltaTxt(delta(o.revenue, o.prevRevenue)), dCol: deltaCol(delta(o.revenue, o.prevRevenue)) },
  ];
  const cols = '2.2fr .9fr .9fr .9fr';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Summary>
        {o.leads > 0
          ? `El canal orgánico generó ${nf(o.leads)} leads (${pct(ratio(o.leads, D.t.leads))} del total) y ${nf(o.sales)} ventas en el período. Clics, impresiones, CTR y posición por keyword requieren conectar Google Search Console.`
          : 'Sin leads orgánicos en el período. Clics, impresiones, CTR y posición por keyword requieren conectar Google Search Console.'}
      </Summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{kpis.map((k) => <Kpi key={k.label} {...k} wide />)}</div>
      <Card>
        <CardHead title="Pareto de keywords orgánicas" sub="Barras: clics por keyword. Línea: porcentaje acumulado del tráfico orgánico total." />
        <NotConnected title="Search Console no conectado" body="El Pareto y la tabla de keywords (posición, Δ 30d, clics, impresiones, CTR) salen de la API de Google Search Console. Aún no existe esa integración en el backend; no se muestran cifras estimadas." chips={['searchanalytics.query', 'dimension: query', 'dimension: page']} />
      </Card>
      <Card style={{ gap: 10 }}>
        <CardHead title="Páginas de destino" sub="Ruta de aterrizaje de los leads orgánicos registrada por la landing (lead_attribution.landing_url)." />
        <Grid cols={cols} head={['Página', 'Leads', 'Ventas', 'Tasa cierre']}>
          {data.seoPages.map((p) => (
            <Row key={p.path} cols={cols}>
              <span style={{ font: `500 11.5px ${MONO}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path}</span>
              <span>{nf(p.leads)}</span>
              <span>{nf(p.sales)}</span>
              <span>{pct(ratio(p.sales, p.leads))}</span>
            </Row>
          ))}
          {data.seoPages.length === 0 && <Empty text="Sin leads orgánicos con página de destino en el período." />}
        </Grid>
        <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>Clics, impresiones, CTR e indexación por página se mostrarán al conectar Search Console.</span>
      </Card>
    </div>
  );
}

// ── Pestaña SEM · Keywords ────────────────────────────────────────────────────
export function SemTab({ D, hasAds, configured }: { D: Derived; hasAds: boolean; configured: boolean }) {
  const g = D.google;
  const cpc = hasAds && (g.clicks ?? 0) > 0 ? (g.spend ?? 0) / (g.clicks ?? 1) : null;
  const kpis = [
    { label: 'Gasto', val: hasAds ? money(g.spend ?? 0) : '—', delta: hasAds ? (g.budget != null ? `${deltaTxt(delta(g.spend ?? 0, g.budget))} vs. presupuesto` : deltaTxt(delta(g.spend ?? 0, g.prevSpend ?? 0), ' vs. anterior')) : 'sin datos', dCol: hasAds ? deltaCol(g.budget != null ? delta(g.spend ?? 0, g.budget) : delta(g.spend ?? 0, g.prevSpend ?? 0), false) : NEUTRAL },
    { label: 'Clics', val: hasAds ? nf(g.clicks ?? 0) : '—', delta: hasAds ? `${nf(g.impressions ?? 0)} impresiones` : 'sin datos', dCol: NEUTRAL },
    { label: 'CPC promedio', val: cpc != null ? money2(cpc) : '—', delta: cpc != null ? 'gasto ÷ clics del período' : 'sin clics registrados', dCol: NEUTRAL },
    { label: 'Conversiones', val: hasAds ? nf(g.conversions ?? 0) : '—', delta: hasAds ? `${nf(g.leads)} leads atribuidos en la landing` : 'sin datos', dCol: NEUTRAL },
  ];
  const chips = ['keyword_view', 'search_term_view', 'metrics.quality_score', 'search_impression_share'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Summary>
        {hasAds
          ? `Google Ads registra ${money(g.spend ?? 0)} de gasto y ${nf(g.clicks ?? 0)} clics en el período${cpc != null ? `, a ${money2(cpc)} por clic` : ''}. El detalle por keyword (coincidencia, Quality Score, % de impresiones) y los términos negativos sugeridos requieren sincronizar keyword_view y search_term_view; hoy el cron sólo guarda métricas por campaña.`
          : configured
            ? 'Google Ads está configurado pero no hay métricas sincronizadas en el período (cron /api/cron/google-ads). El detalle por keyword requiere además sincronizar keyword_view y search_term_view.'
            : 'Google Ads no está conectado. Configura las credenciales en Configuración → Integraciones para ver gasto, clics y CPC; el detalle por keyword requiere sincronizar keyword_view y search_term_view.'}
      </Summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{kpis.map((k) => <Kpi key={k.label} {...k} wide />)}</div>
      <Card style={{ gap: 10 }}>
        <CardHead title="Palabras clave pagadas" />
        <NotConnected title="Sin datos por keyword" body="Keyword, tipo de coincidencia, Quality Score, % de impresiones, clics, CPC y costo salen de keyword_view en la API de Google Ads. El cron actual sólo sincroniza campañas (app.ads_metrics)." chips={chips.slice(0, 1).concat(chips.slice(2))} />
      </Card>
      <Card style={{ gap: 10 }}>
        <CardHead title="Términos sugeridos como negativos" sub="Generan clics y gasto sin una sola conversión en el período." />
        <NotConnected title="Sin términos de búsqueda sincronizados" body="La sugerencia de negativos se calcula sobre search_term_view (clics y costo sin conversiones). Requiere ampliar el cron de Google Ads." chips={[chips[1]]} />
      </Card>
    </div>
  );
}

// ── Pestaña Google Ads ────────────────────────────────────────────────────────
export function GoogleTab({ data, D, hasAds, configured }: { data: Marketing; D: Derived; hasAds: boolean; configured: boolean }) {
  const g = D.google;
  const ctr = ratio(g.clicks ?? 0, g.impressions ?? 0);
  const cpa = hasAds && (g.conversions ?? 0) > 0 ? (g.spend ?? 0) / (g.conversions ?? 1) : null;
  const kpis = [
    { label: 'Gasto', val: hasAds ? money(g.spend ?? 0) : '—', delta: hasAds ? deltaTxt(delta(g.spend ?? 0, g.prevSpend ?? 0), ' vs. anterior') : 'sin datos', dCol: hasAds ? deltaCol(delta(g.spend ?? 0, g.prevSpend ?? 0), false) : NEUTRAL },
    { label: 'Impresiones', val: hasAds ? nf(g.impressions ?? 0) : '—', delta: hasAds ? `${nf(g.clicks ?? 0)} clics` : 'sin datos', dCol: NEUTRAL },
    { label: 'CTR', val: hasAds && (g.impressions ?? 0) > 0 ? pct(ctr, 2) : '—', delta: 'clics ÷ impresiones', dCol: NEUTRAL },
    { label: 'CPA promedio', val: cpa != null ? money2(cpa) : '—', delta: cpa != null ? 'gasto ÷ conversiones reportadas por Google' : 'sin conversiones reportadas', dCol: NEUTRAL },
    { label: 'Leads atribuidos', val: nf(g.leads), delta: deltaTxt(delta(g.leads, g.prevLeads)), dCol: deltaCol(delta(g.leads, g.prevLeads)) },
  ];
  const cols = '2.2fr .9fr .9fr .8fr .9fr .9fr .8fr';
  const camps = data.googleCampaigns.slice().sort((a, b) => b.cost - a.cost);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Summary>
        {hasAds
          ? `Google Ads invirtió ${money(g.spend ?? 0)} en ${nf(camps.length)} campañas con datos en el período${cpa != null ? `, a ${money2(cpa)} por conversión` : ''}. La landing atribuye ${nf(g.leads)} leads y el CRM ${nf(g.sales)} ventas a este canal${g.roas != null ? ` (${g.roas.toFixed(1)}x de retorno)` : ''}.`
          : configured
            ? 'Google Ads está configurado pero no hay métricas en el período. El cron /api/cron/google-ads corre a diario (02:30 UTC) y guarda los últimos 30 días.'
            : 'Google Ads no está conectado. Configura developer token, OAuth client, refresh token y Customer ID en Configuración → Integraciones.'}
      </Summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{kpis.map((k) => <Kpi key={k.label} {...k} />)}</div>
      <Card style={{ gap: 10 }}>
        <CardHead title="Campañas" sub="Métricas de app.ads_metrics. Leads = leads de la landing cuyo utm_campaign coincide con el nombre o id de la campaña." />
        <div className="mk-table"><div>
          <Grid cols={cols} head={['Campaña', 'Último dato', 'Clics', 'CTR', 'CPA', 'Gasto', 'Leads']}>
            {camps.map((c) => (
              <Row key={c.id} cols={cols}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${c.name} · id ${c.id}`}>{c.name}</span>
                <span style={{ font: `700 10.5px ${SANS}`, background: '#E1F0E6', color: GOOD, borderRadius: 6, padding: '2px 7px', width: 'fit-content' }}>{c.lastDate ? dayLabel(c.lastDate) : '—'}</span>
                <span>{nf(c.clicks)}</span>
                <span>{c.impressions > 0 ? pct(ratio(c.clicks, c.impressions), 2) : '—'}</span>
                <span>{c.conversions > 0 ? money2(c.cost / c.conversions) : '—'}</span>
                <span>{money(c.cost)}</span>
                <span>{c.leads != null ? nf(c.leads) : <span style={{ color: MUTED }}>sin utm</span>}</span>
              </Row>
            ))}
            {camps.length === 0 && <Empty text={hasAds ? 'Sin campañas en el período.' : 'Sin métricas sincronizadas.'} />}
          </Grid>
        </div></div>
      </Card>
      {data.googleLeadsUnmatched.length > 0 && (
        <Card style={{ gap: 10 }}>
          <CardHead title="Leads por utm_campaign sin métricas de Google Ads" sub="Campañas declaradas en la URL de la landing que no coinciden con ninguna campaña sincronizada en app.ads_metrics (o no hay sincronización)." />
          <Grid cols="2.2fr .9fr .9fr .9fr" head={['utm_campaign', 'Leads', 'Ventas', 'Tasa cierre']}>
            {data.googleLeadsUnmatched.slice().sort((a, b) => b.leads - a.leads).map((u) => (
              <Row key={u.campaign} cols="2.2fr .9fr .9fr .9fr">
                <span style={{ font: `500 11.5px ${MONO}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.campaign}</span>
                <span>{nf(u.leads)}</span>
                <span>{nf(u.sales)}</span>
                <span>{pct(ratio(u.sales, u.leads))}</span>
              </Row>
            ))}
          </Grid>
        </Card>
      )}
      <Card style={{ gap: 10 }}>
        <CardHead title="Anuncios por creativo" />
        <NotConnected title="Sin datos por anuncio" body="Impresiones, CTR, frecuencia, leads y ROAS por creativo salen de ad_group_ad en la API de Google Ads. El cron actual sólo sincroniza campañas." chips={['ad_group_ad', 'metrics.impressions', 'metrics.ctr']} />
      </Card>
    </div>
  );
}

// ── Pestaña Facebook Ads ──────────────────────────────────────────────────────
export function FacebookTab({ data, D }: { data: Marketing; D: Derived }) {
  const m = D.meta;
  const kpis = [
    { label: 'Gasto', val: '—', delta: 'Meta Marketing API sin conectar', dCol: NEUTRAL },
    { label: 'Leads atribuidos', val: nf(m.leads), delta: deltaTxt(delta(m.leads, m.prevLeads)), dCol: deltaCol(delta(m.leads, m.prevLeads)) },
    { label: 'Ventas cerradas', val: nf(m.sales), delta: deltaTxt(delta(m.sales, m.prevSales)), dCol: deltaCol(delta(m.sales, m.prevSales)) },
    { label: 'Tasa de cierre', val: m.leads > 0 ? pct(m.rate) : '—', delta: m.prevLeads > 0 ? `anterior ${pct(ratio(m.prevSales, m.prevLeads))}` : 'sin base anterior', dCol: NEUTRAL },
    { label: 'Ingreso atribuido', val: money(m.revenue), delta: deltaTxt(delta(m.revenue, m.prevRevenue)), dCol: deltaCol(delta(m.revenue, m.prevRevenue)) },
  ];
  const cols = '1.4fr 1.6fr .8fr .8fr .9fr';
  const searchRate = D.google.leads > 0 ? D.google.rate : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Summary>
        {m.leads > 0
          ? `Facebook e Instagram aportan ${nf(m.leads)} leads (${pct(ratio(m.leads, D.t.leads))} del total) con ${pct(m.rate)} de tasa de cierre${searchRate != null ? `, frente a ${pct(searchRate)} de Google Ads` : ''}. Alcance, CPM, frecuencia y gasto requieren conectar la Meta Marketing API (Insights); el Pixel / CAPI configurado sólo envía conversiones, no lee métricas.`
          : 'Sin leads atribuidos a Meta Ads en el período. Alcance, CPM, frecuencia y gasto requieren conectar la Meta Marketing API (Insights); el Pixel / CAPI configurado sólo envía conversiones, no lee métricas.'}
      </Summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{kpis.map((k) => <Kpi key={k.label} {...k} />)}</div>
      <Card style={{ gap: 10 }}>
        <CardHead title="Campañas" sub="Leads de la landing agrupados por fb_campaign_id / utm_campaign (lead_attribution)." />
        <div className="mk-table"><div>
          <Grid cols={cols} head={['Campaign ID', 'utm_campaign', 'Leads', 'Ventas', 'Tasa cierre']}>
            {data.metaCampaigns.map((c, i) => (
              <Row key={i} cols={cols}>
                <span style={{ font: `500 11.5px ${MONO}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.campaignId}</span>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.utmCampaign || <span style={{ color: MUTED, fontWeight: 500 }}>—</span>}</span>
                <span>{nf(c.leads)}</span>
                <span>{nf(c.sales)}</span>
                <span>{pct(ratio(c.sales, c.leads))}</span>
              </Row>
            ))}
            {data.metaCampaigns.length === 0 && <Empty text="Sin leads de Meta Ads en el período." />}
          </Grid>
        </div></div>
        <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>Estado, alcance, CPM y gasto por campaña se mostrarán al conectar la Meta Marketing API.</span>
      </Card>
      <Card style={{ gap: 10 }}>
        <CardHead title="Anuncios por creativo" />
        <NotConnected title="Meta Marketing API no conectada" body="Alcance, CTR, frecuencia, leads y ROAS por anuncio salen del endpoint de Insights (nivel ad). Hoy sólo existe la integración de Pixel + Conversions API, que envía eventos pero no lee rendimiento." chips={['/act_{id}/insights', 'level=ad', 'fields=reach,ctr,frequency,spend']} />
      </Card>
    </div>
  );
}
