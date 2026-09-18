/**
 * src/components/admin/LogsMetricsClient.tsx
 *
 * Dashboard de entregas a Intelix — vista `/admin/logs/dashboard`.
 * Diseño: "Métricas de Logs.dc.html" (Claude Design), replicado a exactitud.
 *
 * Datos reales de /api/admin/logs/metrics (app.delivery_outbox). El prototipo
 * usaba un PRNG para las series; aquí, si el rango no tiene filas, las
 * gráficas se muestran vacías con un aviso — nunca se rellenan.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { outboxErrorLabel } from '@/lib/outbox/errors';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const INK = '#16160F';
const MUTED = '#6E6E64';
const LINE = '#E6E5E0';
const CARD = '#FFFFFF';
const AMBER_BD = '#F4E2AE';
const GOOD = '#1B7F4B';
const BAD = '#A33A2A';
const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type StateId = 'delivered' | 'pending' | 'processing' | 'failed' | 'dead';
const ST: Record<StateId, { label: string; dot: string }> = {
  delivered: { label: 'Entregado', dot: GOOD },
  pending: { label: 'En cola', dot: '#E0A800' },
  processing: { label: 'Procesando', dot: '#C9A227' },
  failed: { label: 'Falló', dot: BAD },
  dead: { label: 'Definitivo', dot: '#5C1F14' },
};
const ORDER: StateId[] = ['delivered', 'pending', 'processing', 'failed', 'dead'];

const RANGES = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'all', label: 'Todo' },
];

export interface Metrics {
  range: string;
  bucket: 'hour' | 'day' | 'week';
  updatedAt: string;
  maxAttempts: number;
  counts: Record<StateId, number>;
  total: number;
  attemptsAvg: number;
  series: { bucket: string; ok: number; bad: number; total: number }[];
  errors: { code: string; n: number }[];
  attempts: { attempts: number; n: number }[];
  error?: string;
}

const nf = (n: number) => Math.round(n).toLocaleString('es-MX');
const pf = (n: number, d = 1) => (n * 100).toFixed(d) + '%';

/** Etiqueta corta del bucket según la granularidad que devolvió el API. */
function bucketLabel(b: string, kind: Metrics['bucket']): string {
  if (kind === 'hour') return b.slice(11, 16);
  const [, mm, dd] = b.split('-');
  const d = `${parseInt(dd, 10)} ${MONTHS[parseInt(mm, 10) - 1]}`;
  return kind === 'week' ? `sem ${d}` : d;
}

// ── Contenedor: carga /api/admin/logs/metrics y delega en la vista pura ───────
export default function LogsMetricsClient() {
  const [range, setRange] = useState('7d');
  const [data, setData] = useState<Metrics | null>(null);
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
        const res = await fetch(`/api/admin/logs/metrics?range=${encodeURIComponent(range)}`);
        const json = (await res.json()) as Metrics;
        if (!alive || id !== reqId.current) return;
        if (!res.ok || json.error) setError(json.error || `Error ${res.status}`);
        else { setError(null); setData(json); }
      } catch {
        if (alive && id === reqId.current) setError('No se pudieron cargar las métricas');
      } finally {
        if (alive && id === reqId.current) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [range]);

  return <LogsMetricsView data={data} range={range} loading={loading} error={error} onRange={setRange} />;
}

export interface LogsMetricsViewProps {
  data: Metrics | null;
  range: string;
  loading: boolean;
  error: string | null;
  onRange: (id: string) => void;
}

/** Vista pura (sin fetch): la usa el contenedor y las pruebas de render con datos reales. */
export function LogsMetricsView({ data, range, loading, error, onRange }: LogsMetricsViewProps) {

  const counts = data?.counts ?? { delivered: 0, pending: 0, processing: 0, failed: 0, dead: 0 };
  const total = data?.total ?? 0;
  const maxAttempts = data?.maxAttempts ?? 5;

  // ── Serie por bucket ──────────────────────────────────────────────────────
  const CH = 176; // alto útil de la gráfica (px) — igual que el diseño
  const series = data?.series ?? [];
  const maxBucket = Math.max(1, ...series.map((s) => s.total)) * 1.15;
  const bars = series.map((s) => ({
    ...s,
    okH: (s.ok / maxBucket) * CH,
    badH: (s.bad / maxBucket) * CH,
    label: bucketLabel(s.bucket, data?.bucket ?? 'day'),
  }));
  const dense = bars.length > 10;
  const gap = dense ? 4 : 8;
  const grid = [1, 0.5, 0].map((t) => ({ topPct: ((200 - t * CH) / 200) * 100, label: nf(maxBucket * t) }));

  // ── Distribución por estado ───────────────────────────────────────────────
  const statusRows = ORDER.map((k) => ({ id: k, label: ST[k].label, color: ST[k].dot, count: counts[k], pct: total ? counts[k] / total : 0 }));

  // ── Causas de falla ───────────────────────────────────────────────────────
  const errors = useMemo(() => {
    const list = data?.errors ?? [];
    const max = Math.max(1, ...list.map((e) => e.n));
    return list.map((e) => ({
      code: e.code,
      label: e.code === 'sin_codigo' ? 'sin código · Falla sin código registrado' : `${e.code} · ${outboxErrorLabel(e.code)}`,
      n: e.n,
      pct: (e.n / max) * 100,
    }));
  }, [data]);

  // ── Distribución de intentos ──────────────────────────────────────────────
  // Se muestran 0..max(5, último escalón con filas) para no pintar 12 barras vacías.
  const attempts = useMemo(() => {
    const list = data?.attempts ?? [];
    const lastNonZero = list.reduce((acc, a) => (a.n > 0 ? a.attempts : acc), 0);
    const upto = Math.max(5, lastNonZero);
    const shown = list.filter((a) => a.attempts <= upto);
    const max = Math.max(1, ...shown.map((a) => a.n));
    return shown.map((a) => ({
      label: a.attempts === 0 ? 'Sin intento' : a.attempts === 1 ? '1 intento' : `${a.attempts} intentos${a.attempts === maxAttempts ? ' +' : ''}`,
      n: a.n,
      pct: (a.n / max) * 100,
    }));
  }, [data, maxAttempts]);

  const stats = [
    { label: 'Entregados', val: nf(counts.delivered), note: total ? `${pf(counts.delivered / total)} del rango` : 'del rango', dot: ST.delivered.dot, bd: LINE },
    { label: 'En cola', val: nf(counts.pending + counts.processing), note: 'pending + processing', dot: ST.pending.dot, bd: LINE },
    { label: 'Fallidos', val: nf(counts.failed), note: 'con reintento programado', dot: ST.failed.dot, bd: AMBER_BD },
    { label: 'Definitivos', val: nf(counts.dead), note: `agotaron ${maxAttempts} intentos o error irrecuperable`, dot: ST.dead.dot, bd: AMBER_BD },
    { label: 'Intentos promedio', val: data ? data.attemptsAvg.toFixed(2) : '—', note: 'por entrega en el rango', dot: '#C9C8C0', bd: LINE },
    { label: 'Total en rango', val: nf(total), note: 'sin filtros de estado', dot: INK, bd: LINE },
  ];

  const empty = !loading && !error && total === 0;
  const dim = loading ? { opacity: 0.55, transition: 'opacity .2s' } : { transition: 'opacity .2s' };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, font: `400 14px ${SANS}`, color: INK, maxWidth: 1440, margin: '0 auto' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .lm-two { display: grid; grid-template-columns: minmax(0,1.4fr) minmax(0,1fr); gap: 14px; }
        @media (max-width: 900px) { .lm-two { grid-template-columns: minmax(0,1fr); } }
        .lm-seg a:hover { color: ${INK}; }
      `}</style>

      {/* Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ font: `700 11px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>ENTREGA A INTELIX · DELIVERY_OUTBOX</span>
            <span style={{ font: `600 10.5px ${MONO}`, color: '#4B4B44', background: '#F3F2ED', border: `1px solid ${LINE}`, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }}>
              {data ? `actualizado ${new Date(data.updatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' })}` : 'cargando…'}
            </span>
          </div>
          <h1 style={{ margin: 0, font: `800 28px ${SANS}`, letterSpacing: '-0.028em', lineHeight: 1.1 }}>Dashboard de logs</h1>
          <p style={{ margin: 0, font: `500 13.5px ${SANS}`, color: MUTED, maxWidth: '66ch', textWrap: 'pretty' } as React.CSSProperties}>
            Salud del envío de solicitudes a Intelix en el rango seleccionado: volumen entregado, cola, fallas y las causas que más pesan.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div className="lm-seg" style={{ display: 'flex', gap: 3, background: '#EFEEE9', borderRadius: 10, padding: 3 }}>
            <a href="/admin/logs" style={{ cursor: 'pointer', padding: '6px 13px', borderRadius: 8, font: `600 12px ${SANS}`, color: MUTED, textDecoration: 'none' }}>Tabla</a>
            <span style={{ cursor: 'default', padding: '6px 13px', borderRadius: 8, font: `700 12px ${SANS}`, background: CARD, color: INK, boxShadow: '0 1px 3px rgba(22,22,15,0.1)' }}>Dashboard</span>
          </div>
          <div style={{ display: 'flex', gap: 3, background: '#EFEEE9', borderRadius: 10, padding: 3 }}>
            {RANGES.map((r) => {
              const on = r.id === range;
              return (
                <button key={r.id} onClick={() => onRange(r.id)} style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', borderRadius: 8, font: `${on ? 700 : 600} 12px ${SANS}`, background: on ? CARD : 'transparent', color: on ? INK : MUTED, boxShadow: on ? '0 1px 3px rgba(22,22,15,0.1)' : 'none' }}>
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {error && (
        <div style={{ padding: '13px 16px', background: '#FBEDEA', border: '1px solid #F0D5CE', borderRadius: 12, color: BAD, font: `600 13px ${SANS}` }}>{error}</div>
      )}
      {empty && (
        <div style={{ padding: '13px 16px', background: '#FFF6DC', border: `1px solid ${AMBER_BD}`, borderRadius: 12, color: '#6B5200', font: `600 13px ${SANS}` }}>
          Sin entregas a Intelix en el rango seleccionado. Las gráficas se llenan conforme el outbox procese solicitudes.
        </div>
      )}

      {/* Stats */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, ...dim }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: CARD, border: `1px solid ${s.bd}`, borderRadius: 16, padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `700 12px ${SANS}`, color: MUTED }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: s.dot, flex: '0 0 7px' }} />{s.label}
            </span>
            <span style={{ font: `800 22px ${SANS}`, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{data ? s.val : '—'}</span>
            <span style={{ font: `500 11.5px ${SANS}`, color: MUTED, textWrap: 'pretty' } as React.CSSProperties}>{s.note}</span>
          </div>
        ))}
      </section>

      <div className="lm-two" style={dim}>
        {/* Entregas por día */}
        <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <h3 style={{ margin: 0, font: `700 14.5px ${SANS}`, letterSpacing: '-0.015em' }}>
              {data?.bucket === 'hour' ? 'Entregas por hora' : data?.bucket === 'week' ? 'Entregas por semana' : 'Entregas por día'}
            </h3>
            <div style={{ display: 'flex', gap: 13 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 11px ${SANS}`, color: '#54544C' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: GOOD }} />Entregado</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 11px ${SANS}`, color: '#54544C' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: BAD }} />Falló / definitivo</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
            <div style={{ flex: '0 0 38px', height: 200, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', padding: '1px 0' }}>
              {grid.map((g, i) => <span key={i} style={{ font: `500 10px ${MONO}`, color: '#8A8A80' }}>{g.label}</span>)}
            </div>
            <div style={{ flex: '1 1 auto', position: 'relative', height: 200, minWidth: 0 }}>
              {grid.map((g, i) => <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${g.topPct.toFixed(1)}%`, borderTop: '1px solid #F0EFEA' }} />)}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap }}>
                {bars.map((b) => (
                  <div key={b.bucket} title={`${b.label} · ${nf(b.ok)} entregados · ${nf(b.bad)} fallidos`} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <span style={{ font: `600 10px ${MONO}`, color: '#54544C', whiteSpace: 'nowrap' }}>{dense && b.total < maxBucket * 0.08 ? '' : nf(b.total)}</span>
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
                      <div style={{ height: `${b.badH.toFixed(1)}px`, background: BAD }} />
                      <div style={{ height: `${b.okH.toFixed(1)}px`, background: GOOD }} />
                    </div>
                  </div>
                ))}
                {bars.length === 0 && (
                  <span style={{ alignSelf: 'center', margin: '0 auto', font: `500 12px ${SANS}`, color: MUTED }}>{loading ? 'Cargando…' : 'Sin entregas en el rango'}</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: '0 0 38px' }} />
            <div style={{ flex: '1 1 auto', display: 'flex', gap, minWidth: 0 }}>
              {bars.map((b, i) => (
                <span key={b.bucket} style={{ flex: '1 1 0', minWidth: 0, textAlign: 'center', font: `500 9px ${MONO}`, color: '#9A9A90', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {dense ? (i % 2 === 0 ? b.label : '') : b.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Distribución por estado */}
        <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <h3 style={{ margin: 0, font: `700 14.5px ${SANS}`, letterSpacing: '-0.015em' }}>Distribución por estado</h3>
          <div style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', background: '#F0EFEA' }}>
            {statusRows.map((s) => (
              <div key={s.id} title={`${s.label} · ${nf(s.count)}`} style={{ width: `${(s.pct * 100).toFixed(2)}%`, background: s.color, transition: 'width .3s ease' }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {statusRows.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #F5F4EF' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: `700 12px ${SANS}` }}><span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flex: '0 0 9px' }} />{s.label}</span>
                <span style={{ font: `500 12px ${MONO}`, color: '#54544C', whiteSpace: 'nowrap', flex: '0 0 auto' }}>{nf(s.count)} · {pf(s.pct)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Causas de falla */}
      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, ...dim }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h3 style={{ margin: 0, font: `700 14.5px ${SANS}`, letterSpacing: '-0.015em' }}>Causas de falla más frecuentes</h3>
          <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>Códigos de error de Intelix en fallidos y definitivos del rango.</span>
        </div>
        {errors.map((e) => (
          <div key={e.code} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span title={e.label} style={{ flex: '0 0 230px', minWidth: 0, font: `600 12.5px ${SANS}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
            <div style={{ flex: '1 1 auto', height: 12, borderRadius: 6, background: '#F0EFEA', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${e.pct.toFixed(1)}%`, background: BAD, borderRadius: 6, transition: 'width .3s ease' }} />
            </div>
            <span style={{ flex: '0 0 46px', textAlign: 'right', font: `700 12px ${MONO}`, color: '#54544C' }}>{nf(e.n)}</span>
          </div>
        ))}
        {errors.length === 0 && (
          <span style={{ font: `500 12px ${SANS}`, color: MUTED }}>{loading ? 'Cargando…' : 'Sin fallas en el rango.'}</span>
        )}
      </div>

      {/* Distribución de intentos */}
      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, ...dim }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h3 style={{ margin: 0, font: `700 14.5px ${SANS}`, letterSpacing: '-0.015em' }}>Distribución de intentos</h3>
          <span style={{ font: `500 11.5px ${SANS}`, color: MUTED }}>Cuántas entregas llevan cada número de intentos (incluye las que siguen en cola).</span>
        </div>
        {attempts.map((a) => (
          <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ flex: '0 0 90px', font: `700 12px ${SANS}` }}>{a.label}</span>
            <div style={{ flex: '1 1 auto', height: 14, borderRadius: 7, background: '#F0EFEA', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${a.pct.toFixed(1)}%`, background: INK, borderRadius: 7, transition: 'width .3s ease' }} />
            </div>
            <span style={{ flex: '0 0 52px', textAlign: 'right', font: `700 12px ${MONO}`, color: '#54544C' }}>{nf(a.n)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
