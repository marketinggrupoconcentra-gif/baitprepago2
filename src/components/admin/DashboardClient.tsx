/**
 * src/components/admin/DashboardClient.tsx
 *
 * Resumen de la operación de portabilidad — vista `/admin/dashboard`.
 * Diseño: "Resumen.dc.html" (Claude Design), replicado a exactitud.
 *
 * Datos reales de /api/admin/dashboard/summary (app.leads, app.analytics_events,
 * app.lead_attribution, app.lead_management, app.delivery_outbox).
 * PROHIBIDO: KPIs inventados, datos mock. Lo que no hay → estado honesto.
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
const SPARK_C = '#C9A227';
const GREEN_FG = '#1B6B44';
const GREEN_BG = '#EAF5EE';
const GREEN_BD = '#CBE5D6';
const RED_FG = '#A33A2A';
const RED_BG = '#FBEDEA';
const RED_BD = '#F0D5CE';

const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const CHANNELS: Record<string, { label: string; color: string }> = {
  google_ads: { label: 'Google Ads', color: '#16160F' },
  meta_ads: { label: 'Meta Ads', color: '#4A4A42' },
  paid_other: { label: 'Otros pagados', color: '#6E6E64' },
  organic: { label: 'Orgánico', color: '#9A9A8F' },
  referral: { label: 'Referral', color: '#E0DFD2' },
  direct: { label: 'Directo', color: '#C0BFB3' },
  other: { label: 'Sin atribuir', color: '#D2D1C4' },
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

const STATUS_STYLE: Record<string, { label: string; fg: string; bg: string; bd: string }> = {
  delivered: { label: 'entregado', fg: GREEN_FG, bg: GREEN_BG, bd: GREEN_BD },
  received: { label: 'en validación', fg: GOLD, bg: AMBER_SOFT, bd: AMBER_BD },
  processing: { label: 'en proceso', fg: GOLD, bg: AMBER_SOFT, bd: AMBER_BD },
  duplicate: { label: 'duplicado', fg: '#54544C', bg: '#F3F2ED', bd: LINE },
  failed: { label: 'fallido', fg: RED_FG, bg: RED_BG, bd: RED_BD },
};

// ── Tipos del API ─────────────────────────────────────────────────────────────
interface Kpi { cur: number; prev?: number }
interface Summary {
  range: 'hoy' | '7d' | '30d';
  period: { from: string; to: string };
  updatedAt: string;
  kpis: {
    leads: Kpi; sessions: Kpi; formStart: Kpi; submitted: Kpi; validated: Kpi;
    won: Kpi; failed: Kpi; duplicate: Kpi;
  };
  bars: { bucket: string; leads: number }[];
  spark: { day: string; leads: number; sessions: number; formStart: number }[];
  channels: { id: string; sessions: number; leads: number }[];
  recent: { ref: string; at: string; channel: string; state: string; status: string }[];
  health: { sessions: number; noUtm: number; lastEventAt: string | null };
  delivery: { 
    lastDeliveredAt: string | null; 
    pending: number; 
    failed: number; 
    errorsBreakdown?: { code: string; count: number }[] 
  };
  integrations: { googleAds: boolean; metaAds: boolean };
}

// ── Formato (es-MX, coma decimal — como el diseño) ────────────────────────────
const NF = new Intl.NumberFormat('es-MX');
const n = (v: number) => NF.format(Math.round(v || 0));
const pct = (v: number, dec = 1) => (isFinite(v) ? (v * 100).toFixed(dec) : (0).toFixed(dec)).replace('.', ',') + '%';

function delta(cur: number, prev?: number) {
  if (prev == null || prev === 0) return { pct: '—', arrow: '', color: MUTED, bg: '#F0EFEA' };
  const p = (cur - prev) / prev;
  const up = p >= 0;
  return {
    pct: pct(Math.abs(p), 1),
    arrow: up ? '▲' : '▼',
    color: up ? '#1B7F4B' : RED_FG,
    bg: up ? GREEN_BG : RED_BG,
  };
}

/** Path de sparkline: viewBox 100×30, y=27 abajo (como el diseño). */
function sparkPath(arr: number[]) {
  if (!arr.length) return '';
  const mn = Math.min(...arr), mx = Math.max(...arr), span = (mx - mn) || 1;
  const pts = arr.map((v, i) =>
    `${((i / Math.max(1, arr.length - 1)) * 100).toFixed(1)},${(27 - ((v - mn) / span) * 24).toFixed(1)}`,
  );
  return 'M' + pts.join(' L');
}

const fmtDay = (iso: string) => {
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

const RANGE_LABEL: Record<Summary['range'], string> = {
  hoy: 'Hoy', '7d': 'Últimos 7 días', '30d': 'Últimos 30 días',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function DashboardClient() {
  const [nowMs] = useState(() => Date.now());
  const [range, setRange] = useState<Summary['range']>('30d');
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const fetchSummary = useCallback(async (r: string, id: number) => {
    const res = await fetch(`/api/admin/dashboard/summary?range=${r}`);
    const json = await res.json();
    if (id !== reqId.current) return;
    if (json.error) { setError(String(json.error)); return; }
    setData(json as Summary);
  }, []);

  useEffect(() => {
    const id = ++reqId.current;
    fetchSummary('30d', id)
      .catch(() => { if (id === reqId.current) setError('No se pudo cargar el resumen'); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (r: Summary['range']) => {
    setRange(r);
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    fetchSummary(r, id)
      .catch(() => { if (id === reqId.current) setError('No se pudo cargar el resumen'); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  };

  const d = useMemo(() => {
    if (!data) return null;
    const k = data.kpis;
    const sessions = k.sessions.cur, leads = k.leads.cur, formStart = k.formStart.cur;
    const cvr = sessions ? leads / sessions : 0;
    const prevCvr = k.sessions.prev ? (k.leads.prev ?? 0) / k.sessions.prev : 0;

    const sparkLeads = data.spark.map((s) => s.leads);
    const sparkSes = data.spark.map((s) => s.sessions);
    const sparkFs = data.spark.map((s) => s.formStart);

    const kpis = [
      { label: 'Leads', val: n(leads), d: delta(leads, k.leads.prev), src: 'landing', spark: sparkLeads },
      { label: 'Sesiones', val: n(sessions), d: delta(sessions, k.sessions.prev), src: 'landing', spark: sparkSes },
      { label: 'Inicios de formulario', val: n(formStart), d: delta(formStart, k.formStart.prev), src: 'landing', spark: sparkFs },
      { label: 'Tasa de conversión', val: pct(cvr, 2), d: delta(cvr, prevCvr), src: 'calculado', spark: sparkLeads },
      { label: 'Leads entregados a CRM', val: n(k.validated.cur), d: delta(k.validated.cur, k.validated.prev), src: 'CRM', spark: sparkLeads },
    ];

    // Embudo de portabilidad (5 pasos, datos reales)
    const steps: [string, number][] = [
      ['Sesiones en la landing', sessions],
      ['Inicios de formulario', formStart],
      ['Leads enviados', leads],
      ['Entregados a CRM', k.validated.cur],
      ['Portabilidad ganada (CRM)', k.won.cur],
    ];
    const funnel = steps.map(([label, val], i) => {
      const stepPct = i === 0 ? 1 : steps[i - 1][1] ? val / steps[i - 1][1] : 0;
      return {
        label, val: n(val),
        w: (steps[0][1] ? (val / steps[0][1]) * 100 : 0).toFixed(2) + '%',
        step: i === 0 ? '—' : pct(stepPct, 1),
        stepC: i === 0 ? MUTED : stepPct >= 0.8 ? '#1B7F4B' : stepPct >= 0.5 ? GOLD : RED_FG,
        c: ['#16160F', '#4A4A42', GOLD, '#E0A800', AMBER][i],
      };
    });
    const wonPct = sessions ? (k.won.cur / sessions) * 100 : 0;
    const funnelNote = `De cada 100 sesiones, ${(cvr * 100).toFixed(1).replace('.', ',')} envían el formulario y ${wonPct.toFixed(1).replace('.', ',')} completan la portabilidad en el CRM.`;

    // Canales
    const chSorted = data.channels
      .map((c) => ({
        ...c,
        meta: CHANNELS[c.id] ?? { label: c.id, color: '#D2D1C4' },
        cvr: c.sessions ? c.leads / c.sessions : 0,
      }))
      .sort((a, b) => b.leads - a.leads || b.sessions - a.sessions);
    const chMax = chSorted[0]?.leads || 1;
    const channels = chSorted.map((c) => ({
      label: c.meta.label, color: c.meta.color,
      ses: n(c.sessions), leads: n(c.leads), cvr: pct(c.cvr, 2),
      w: (c.leads / chMax * 100).toFixed(1) + '%',
    }));

    // Bars
    const bars = data.bars.map((b) => ({
      bucket: b.bucket, leads: b.leads,
      label: data.range === 'hoy' ? String(b.bucket).padStart(2, '0') + ':00' : fmtDay(b.bucket),
    }));
    const barMax = Math.max(...bars.map((b) => b.leads), 1);

    // Alertas (solo las reales)
    const alerts: { title: string; body: string; bg: string; bd: string; dot: string }[] = [];
    const abandon = Math.max(0, formStart - leads);
    if (formStart > 0 && abandon > 0) {
      alerts.push({
        title: `${n(abandon)} de ${n(formStart)} inicios no llegaron a enviar`,
        body: 'Del total que abrió el formulario, esa proporción abandonó antes de enviar la solicitud de portabilidad.',
        bg: AMBER_SOFT, bd: AMBER_BD, dot: '#E0A800',
      });
    }
    const noUtmPct = data.health.sessions ? data.health.noUtm / data.health.sessions : 0;
    if (noUtmPct >= 0.1) {
      alerts.push({
        title: `${pct(noUtmPct, 0)} del tráfico llega sin UTM`,
        body: 'Ese tráfico se atribuye como "sin atribuir" y no puede asignarse a una campaña. Revisa el etiquetado de los enlaces.',
        bg: '#FBFBF9', bd: LINE, dot: '#9A9A8F',
      });
    }
    if (k.failed.cur > 0) {
      alerts.push({
        title: `${n(k.failed.cur)} lead${k.failed.cur === 1 ? '' : 's'} fallido${k.failed.cur === 1 ? '' : 's'} en la entrega`,
        body: 'No se entregaron al CRM de portabilidad. Revisa el estado del outbox y los datos del lead.',
        bg: RED_BG, bd: RED_BD, dot: RED_FG,
      });
    }
    if (data.delivery.pending > 0) {
      alerts.push({
        title: `${n(data.delivery.pending)} lead${data.delivery.pending === 1 ? '' : 's'} pendiente${data.delivery.pending === 1 ? '' : 's'} de entrega`,
        body: 'Están en cola de envío al CRM. Si no bajan, revisa el worker del outbox.',
        bg: AMBER_SOFT, bd: AMBER_BD, dot: '#E0A800',
      });
    }
    if (alerts.length === 0) {
      alerts.push({
        title: 'Sin alertas en el período',
        body: 'El embudo, la atribución y la entrega al CRM operan dentro de lo esperado.',
        bg: GREEN_BG, bd: GREEN_BD, dot: '#1B7F4B',
      });
    }

    // Integraciones
    const lastEvMs = data.health.lastEventAt ? Date.parse(data.health.lastEventAt) : 0;
    const evStale = !lastEvMs || nowMs - lastEvMs > 3 * 3600 * 1000;
    const lastDel = data.delivery.lastDeliveredAt ? new Date(data.delivery.lastDeliveredAt) : null;
    const integrations = [
      {
        label: 'Landing BAIT Prepago',
        meta: data.health.lastEventAt ? `último evento ${new Date(data.health.lastEventAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'sin eventos recientes',
        ...(evStale ? pill('Sin datos', RED_FG, RED_BG, RED_BD) : pill('Activa', GREEN_FG, GREEN_BG, GREEN_BD)),
      },
      { label: 'Google Ads', meta: 'sin credenciales', ...pill('Pendiente', GOLD, AMBER_SOFT, AMBER_BD) },
      { label: 'Meta Ads', meta: 'sin credenciales', ...pill('Pendiente', GOLD, AMBER_SOFT, AMBER_BD) },
      {
        label: 'CRM portabilidad (outbox)',
        meta: lastDel ? `último envío ${lastDel.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'sin envíos registrados',
        ...(data.delivery.failed > 0
          ? pill('Con fallos', RED_FG, RED_BG, RED_BD)
          : lastDel ? pill('Activa', GREEN_FG, GREEN_BG, GREEN_BD) : pill('Sin datos', MUTED, '#F3F2ED', LINE)),
      },
    ];

    // Últimos leads
    const recent = data.recent.map((r) => {
      const st = STATUS_STYLE[r.status] ?? { label: r.status, fg: MUTED, bg: '#F3F2ED', bd: LINE };
      const dt = new Date(r.at);
      return {
        folio: r.ref.slice(0, 8),
        hora: dt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' }),
        canal: (CHANNELS[r.channel] ?? { label: r.channel }).label,
        ciudad: r.state && r.state !== 'null' ? (STATE_NAMES[r.state] ?? r.state) : '—',
        estado: st.label, fg: st.fg, bg: st.bg, bd: st.bd,
      };
    });

    const intelixErrors = data.delivery.errorsBreakdown?.map((e) => {
      let desc = 'Error en el sistema';
      if (e.code === 'http_409_duplicado') desc = 'Teléfono duplicado';
      else if (e.code.startsWith('http_')) desc = `Fallo de conexión (${e.code})`;
      else desc = `Regla de negocio (${e.code})`;
      
      return {
        code: e.code,
        desc,
        count: n(e.count)
      };
    }) || [];

    return { kpis, funnel, funnelNote, channels, bars, barMax, alerts, integrations, recent, intelixErrors };
  }, [data, nowMs]);

  const cmpLabel = range === 'hoy' ? 'vs ayer' : 'vs período anterior';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, font: `400 14px ${SANS}`, color: INK, maxWidth: 1440, margin: '0 auto' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .db-shim { background: linear-gradient(90deg,#EFEEE9 0%,#F7F6F3 40%,#EFEEE9 80%); background-size: 420px 100%; animation: dbshim 1.2s linear infinite; border-radius: 6px; }
        @keyframes dbshim { 0% { background-position: -420px 0; } 100% { background-position: 420px 0; } }
        .db-scr::-webkit-scrollbar { height: 8px; }
        .db-scr::-webkit-scrollbar-thumb { background: #DDDCD5; border-radius: 8px; }
      `}</style>

      {/* Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <span style={{ font: `700 11px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>BAIT PREPAGO · PORTABILIDAD</span>
          <h1 style={{ margin: 0, font: `800 28px ${SANS}`, letterSpacing: '-0.028em', lineHeight: 1.1 }}>Resumen</h1>
          <p style={{ margin: 0, font: `500 13.5px ${SANS}`, color: MUTED, maxWidth: '62ch' }}>
            Estado de la operación de portabilidad: leads que entran, cómo avanzan y qué requiere atención.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="db-scr" style={{ display: 'flex', alignItems: 'center', gap: 4, background: CARD, border: `1px solid ${LINE}`, borderRadius: 11, padding: 3, overflowX: 'auto' }}>
            {(['hoy', '7d', '30d'] as const).map((r) => {
              const active = range === r;
              return (
                <button key={r} type="button" onClick={() => pick(r)} disabled={loading}
                  style={{ whiteSpace: 'nowrap', border: 'none', cursor: loading ? 'default' : 'pointer', borderRadius: 8, padding: '7px 12px', font: `700 12.5px ${SANS}`, background: active ? INK : 'transparent', color: active ? '#fff' : '#5C5C54' }}>
                  {RANGE_LABEL[r]}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: CARD, border: `1px solid ${LINE}`, borderRadius: 20, padding: '6px 12px' }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: '#1B7F4B', boxShadow: '0 0 0 3px rgba(27,127,75,0.14)' }} />
            <span style={{ font: `600 12px ${SANS}`, color: '#4B4B44' }}>
              {data ? `Actualizado ${new Date(data.updatedAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Cargando…'}
            </span>
          </div>
        </div>
      </header>

      {error && (
        <div style={{ padding: '14px 18px', background: RED_BG, border: `1px solid ${RED_BD}`, borderRadius: 12, color: RED_FG, font: `600 13px ${SANS}` }}>
          {error}
        </div>
      )}

      {loading && !data && <Skeleton />}

      {data && d && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>

          {/* KPIs */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 12 }}>
            {d.kpis.map((k) => (
              <div key={k.label} style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 17px 15px', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0, boxShadow: '0 1px 0 rgba(22,22,15,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ font: `700 12px ${SANS}`, color: MUTED }}>{k.label}</span>
                  <span style={{ font: `600 9.5px ${MONO}`, color: MUTED, whiteSpace: 'nowrap' }}>{k.src}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ font: `800 26px ${SANS}`, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{k.val}</div>
                  <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: 64, height: 26, flex: '0 0 64px', overflow: 'visible' }} aria-hidden>
                    <path d={sparkPath(k.spark.length ? k.spark : [0, 0])} fill="none" stroke={SPARK_C} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ font: `700 12px ${SANS}`, color: k.d.color, background: k.d.bg, borderRadius: 6, padding: '2px 6px' }}>{k.d.arrow} {k.d.pct}</span>
                  <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>{cmpLabel}</span>
                </div>
              </div>
            ))}
          </section>

          {/* Leads por día + Embudo */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
            <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Leads por {data.range === 'hoy' ? 'hora' : 'día'}</h2>
                <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>{data.range === 'hoy' ? 'Hoy · por hora (CDMX)' : RANGE_LABEL[data.range]}</span>
              </div>
              {d.bars.length === 0 ? (
                <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `500 12px ${SANS}`, color: MUTED }}>Sin leads en el período.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: data.range === 'hoy' ? 4 : d.bars.length > 20 ? 3 : 8, height: 190, paddingTop: 6 }}>
                    {d.bars.map((b, i) => (
                      <div key={b.bucket} title={`${b.label} · ${n(b.leads)} leads`} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ height: `${Math.max(2, (b.leads / d.barMax) * 100).toFixed(1)}%`, background: i === d.bars.length - 1 ? AMBER : '#DBDAD0', borderRadius: '4px 4px 2px 2px', minHeight: 2 }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', font: `500 11px ${MONO}`, color: MUTED, borderTop: `1px solid #EFEEE9`, paddingTop: 9 }}>
                    <span>{d.bars[0]?.label}</span><span>{d.bars[d.bars.length - 1]?.label}</span>
                  </div>
                </>
              )}
            </div>

            <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, maxWidth: 520 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Embudo de portabilidad</h2>
                <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>{RANGE_LABEL[data.range]} · % sobre el paso anterior</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {d.funnel.map((f) => (
                  <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ font: `600 12.5px ${SANS}`, color: '#3E3E36' }}>{f.label}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ font: `800 14px ${SANS}`, fontVariantNumeric: 'tabular-nums' }}>{f.val}</span>
                        <span style={{ font: `600 11.5px ${MONO}`, color: f.stepC, minWidth: 52, textAlign: 'right' }}>{f.step}</span>
                      </span>
                    </div>
                    <div style={{ height: 10, background: '#F3F2ED', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: f.w, height: '100%', background: f.c, borderRadius: 6 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: `1px solid #EFEEE9`, paddingTop: 11, font: `500 12px ${SANS}`, color: MUTED }}>{d.funnelNote}</div>
            </div>
          </section>

          {/* Canales + Requiere atención + Integraciones */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
            <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Canales principales</h2>
                <a href="/admin/analytics" style={{ font: `700 12px ${SANS}`, color: GOLD, textDecoration: 'underline', textUnderlineOffset: 3 }}>Ver analítica</a>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.9fr 0.7fr 0.8fr', gap: 10, padding: '0 0 8px', borderBottom: `1px solid #EFEEE9`, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>
                  <span>CANAL</span><span style={{ textAlign: 'right' }}>SESIONES</span><span style={{ textAlign: 'right' }}>LEADS</span><span style={{ textAlign: 'right' }}>CONV.</span>
                </div>
                {d.channels.length === 0 ? (
                  <div style={{ padding: '16px 0', font: `500 12px ${SANS}`, color: MUTED }}>Sin tráfico atribuido en el período.</div>
                ) : d.channels.map((c) => (
                  <div key={c.label} style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.9fr 0.7fr 0.8fr', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: `1px solid #F5F4EF` }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 3, background: c.color, flex: '0 0 8px' }} />
                      <span style={{ font: `600 13px ${SANS}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                    </span>
                    <span style={{ font: `500 12.5px ${MONO}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.ses}</span>
                    <span style={{ font: `700 13px ${SANS}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.leads}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      <span style={{ font: `600 12px ${MONO}`, color: '#4B4B44' }}>{c.cvr}</span>
                      <span style={{ width: '100%', height: 4, background: '#F3F2ED', borderRadius: 4, overflow: 'hidden' }}>
                        <span style={{ display: 'block', width: c.w, height: '100%', background: c.color }} />
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Requiere atención</h2>
                {d.alerts.map((a) => (
                  <div key={a.title} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '11px 12px', background: a.bg, border: `1px solid ${a.bd}`, borderRadius: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 7, background: a.dot, marginTop: 6, flex: '0 0 7px' }} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <span style={{ font: `700 12.5px ${SANS}` }}>{a.title}</span>
                      <span style={{ font: `500 12px ${SANS}`, color: '#5C5C54' }}>{a.body}</span>
                    </span>
                  </div>
                ))}
              </div>

              {d.intelixErrors.length > 0 && (
                <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Errores Intelix (Outbox)</h2>
                  {d.intelixErrors.map((e) => (
                    <div key={e.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: `1px solid #F5F4EF` }}>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ font: `600 13px ${SANS}` }}>{e.desc}</span>
                        <span style={{ font: `500 11px ${MONO}`, color: MUTED }}>Código: {e.code}</span>
                      </span>
                      <span style={{ font: `700 13px ${SANS}` }}>{e.count} <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>casos</span></span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Integraciones</h2>
                {d.integrations.map((i) => (
                  <div key={i.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: `1px solid #F5F4EF` }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ font: `600 13px ${SANS}` }}>{i.label}</span>
                      <span style={{ font: `500 11px ${MONO}`, color: MUTED }}>{i.meta}</span>
                    </span>
                    <span style={{ font: `700 11px ${SANS}`, color: i.fg, background: i.bg, border: `1px solid ${i.bd}`, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>{i.state}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Últimos leads */}
          <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <h2 style={{ margin: 0, font: `700 15.5px ${SANS}`, letterSpacing: '-0.015em' }}>Últimos leads</h2>
              <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>últimos {d.recent.length} registros · hora CDMX</span>
            </div>
            <div className="db-scr" style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 660, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 1.2fr 1.1fr 0.9fr', gap: 12, paddingBottom: 8, borderBottom: `1px solid #EFEEE9`, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>
                  <span>FOLIO</span><span>HORA</span><span>CANAL</span><span>CIUDAD</span><span>ESTADO</span>
                </div>
                {d.recent.length === 0 ? (
                  <div style={{ padding: '18px 0', font: `500 12px ${SANS}`, color: MUTED }}>Aún no hay leads registrados.</div>
                ) : d.recent.map((r) => (
                  <div key={r.folio} style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 1.2fr 1.1fr 0.9fr', gap: 12, alignItems: 'center', padding: '11px 0', borderBottom: `1px solid #F5F4EF` }}>
                    <span style={{ font: `500 12.5px ${MONO}` }}>{r.folio}</span>
                    <span style={{ font: `500 12.5px ${MONO}`, color: '#4B4B44' }}>{r.hora}</span>
                    <span style={{ font: `600 12.5px ${SANS}` }}>{r.canal}</span>
                    <span style={{ font: `500 12.5px ${SANS}`, color: '#4B4B44' }}>{r.ciudad}</span>
                    <span style={{ font: `700 11px ${SANS}`, color: r.fg, background: r.bg, border: `1px solid ${r.bd}`, borderRadius: 20, padding: '3px 9px', justifySelf: 'start', whiteSpace: 'nowrap' }}>{r.estado}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function pill(state: string, fg: string, bg: string, bd: string) {
  return { state, fg, bg, bd };
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))', gap: 12 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="db-shim" style={{ height: 11, width: '58%' }} />
            <div className="db-shim" style={{ height: 24, width: '72%' }} />
            <div className="db-shim" style={{ height: 9, width: '44%' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: 20, minHeight: 260, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="db-shim" style={{ height: 13, width: '38%' }} />
            <div className="db-shim" style={{ flex: 1, borderRadius: 10 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
