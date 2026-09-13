/**
 * src/components/admin/LeadDrawer.tsx
 *
 * Detalle de un lead — drawer lateral. Diseño: "Leads.dc.html" (Claude Design).
 *
 * Abre /api/admin/leads/[id] (descifra PII, audita LEAD_DETAIL_VIEWED y
 * auto-asigna el lead). El control de estado comercial usa PATCH .../status.
 */
'use client';

import { useEffect, useState } from 'react';
import { hasPermission } from '@/lib/rbac';
import type { AdminSession } from '@/lib/session';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const INK = '#16160F';
const MUTED = '#6E6E64';
const LINE = '#E6E5E0';
const ROW_LINE = '#F5F4EF';
const CARD = '#FFFFFF';

const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const STATUS_PILL: Record<string, { label: string; fg: string; bg: string; bd: string }> = {
  delivered: { label: 'Validado', fg: '#1B6B44', bg: '#EAF5EE', bd: '#CBE5D6' },
  received: { label: 'En validación', fg: '#8C6A00', bg: '#FFF6DC', bd: '#F4E2AE' },
  processing: { label: 'En validación', fg: '#8C6A00', bg: '#FFF6DC', bd: '#F4E2AE' },
  duplicate: { label: 'Duplicado', fg: '#54544C', bg: '#F3F2ED', bd: '#E6E5E0' },
  failed: { label: 'Fallido', fg: '#A33A2A', bg: '#FBEDEA', bd: '#F0D5CE' },
};
const COMMERCIAL: { id: string; label: string }[] = [
  { id: 'NEW', label: 'Nuevo' }, { id: 'CONTACTED', label: 'Contactado' },
  { id: 'FOLLOW_UP', label: 'Seguimiento' }, { id: 'WON', label: 'Ganado' }, { id: 'LOST', label: 'Perdido' },
];
const PLAN_LABELS: Record<string, string> = {
  prepago_100: 'Prepago $100 · 36 GB',
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

interface LeadDetail {
  id: string;
  publicReference: string;
  status: string;
  stateCode: string | null;
  planCode: string;
  createdAt: string;
  updatedAt: string;
  pii: { firstName: string; lastName: string; email: string; phone: string; birthdate: string };
  attribution: {
    sourceCategory: string | null;
    lastUtmSource: string | null; lastUtmMedium: string | null; lastUtmCampaign: string | null;
    firstUtmSource: string | null; firstUtmMedium: string | null; firstUtmCampaign: string | null;
    landingUrl: string | null; referrerHost: string | null;
    firstTouchAt: string | null; lastTouchAt: string | null;
  } | null;
  consent: { contractingAccepted: boolean; privacyAccepted: boolean; acceptedAt: string } | null;
  management: { commercialStatus: string; notes: string | null; assignedToAuthUserId: string | null; updatedAt: string | null } | null;
}

const fmtDateTime = (d: string | null | undefined) =>
  !d ? '—' : new Date(d).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/Mexico_City',
  });
const fmtDate = (d: string | null | undefined) =>
  !d || !/^\d{4}-\d{2}-\d{2}/.test(d) ? (d || '—')
    : new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtPhone = (p: string) => {
  const x = (p || '').replace(/\D/g, '');
  return x.length === 10 ? `${x.slice(0, 2)} ${x.slice(2, 6)} ${x.slice(6)}` : p;
};

export default function LeadDrawer({ id, session, onClose }: {
  id: string; session: AdminSession; onClose: () => void;
}) {
  const canChangeStatus = hasPermission(session.role, 'leads.status.change');

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commercial, setCommercial] = useState('NEW');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/leads/${id}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
        setLead(json as LeadDetail);
        setCommercial(json.management?.commercialStatus ?? 'NEW');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo cargar el lead');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const saveStatus = async () => {
    if (!canChangeStatus) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/admin/leads/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commercialStatus: commercial }),
      });
      if (!res.ok) throw new Error();
      setSaveMsg('Guardado');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch {
      setSaveMsg('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const pill = lead ? (STATUS_PILL[lead.status] ?? { label: lead.status, fg: MUTED, bg: '#F3F2ED', bd: LINE }) : null;
  const nombre = lead ? `${lead.pii.firstName} ${lead.pii.lastName}`.trim() : '';
  const at = lead?.attribution ?? null;

  const fields: [string, string][] = lead ? [
    ['Teléfono a portar', fmtPhone(lead.pii.phone)],
    ['Correo', lead.pii.email],
    ['Plan solicitado', PLAN_LABELS[lead.planCode] ?? lead.planCode],
    ...(lead.pii.birthdate ? [['Fecha de nacimiento', fmtDate(lead.pii.birthdate)] as [string, string]] : []),
    ['Ciudad / Estado', lead.stateCode ? (STATE_NAMES[lead.stateCode] ?? lead.stateCode) : '(no se pide en prepago)'],
    ['Consentimiento', lead.consent ? `Aceptado ${fmtDateTime(lead.consent.acceptedAt)}` : 'Sin registro'],
  ] : [];

  const utm: [string, string][] = lead ? [
    ['utm_source', at?.lastUtmSource || at?.firstUtmSource || '(sin valor)'],
    ['utm_medium', at?.lastUtmMedium || at?.firstUtmMedium || '(sin valor)'],
    ['utm_campaign', at?.lastUtmCampaign || at?.firstUtmCampaign || '(sin valor)'],
    ['source_category', at?.sourceCategory || 'other'],
    ['landing', at?.landingUrl ? new URL(at.landingUrl, 'https://x').pathname : '/'],
    ['referrer', at?.referrerHost || '(directo)'],
  ] : [];

  const log: { t: string; at: string; dot: string }[] = lead ? [
    { t: 'Formulario enviado', at: fmtDateTime(lead.createdAt), dot: INK },
    {
      t: 'Estado técnico',
      at: pill?.label ?? lead.status,
      dot: lead.status === 'failed' ? '#A33A2A' : lead.status === 'delivered' ? '#1B7F4B' : '#E0A800',
    },
    {
      t: 'Estado comercial',
      at: lead.management ? `${COMMERCIAL.find((c) => c.id === lead.management!.commercialStatus)?.label ?? lead.management.commercialStatus} · act. ${fmtDateTime(lead.management.updatedAt)}` : 'sin gestión',
      dot: '#C9C8C0',
    },
  ] : [];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .ld-scr::-webkit-scrollbar { width: 8px; }
        .ld-scr::-webkit-scrollbar-thumb { background: #DDDCD5; border-radius: 8px; }
      `}</style>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(22,22,15,0.24)' }} />
      <aside className="ld-scr" style={{
        position: 'relative', width: 'min(430px,92vw)', background: CARD, borderLeft: `1px solid ${LINE}`,
        height: '100%', overflowY: 'auto', padding: '22px 24px 40px', display: 'flex', flexDirection: 'column', gap: 20,
        boxShadow: '-14px 0 40px rgba(22,22,15,0.10)', font: `400 14px ${SANS}`, color: INK,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span style={{ font: `500 11.5px ${MONO}`, color: MUTED }}>{lead ? lead.publicReference.slice(0, 8) : '········'}</span>
            <h2 style={{ margin: 0, font: `800 20px ${SANS}`, letterSpacing: '-0.022em' }}>{loading ? 'Cargando…' : error ? 'Error' : nombre || 'Lead'}</h2>
            {pill && (
              <span style={{ font: `700 11px ${SANS}`, color: pill.fg, background: pill.bg, border: `1px solid ${pill.bd}`, borderRadius: 20, padding: '3px 9px', alignSelf: 'flex-start' }}>{pill.label}</span>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ border: `1px solid ${LINE}`, background: CARD, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, font: `700 14px ${SANS}`, color: '#54544C', flex: '0 0 30px' }}>×</button>
        </div>

        {error && (
          <div style={{ padding: '12px 14px', background: '#FBEDEA', border: `1px solid #F0D5CE`, borderRadius: 12, color: '#A33A2A', font: `600 12.5px ${SANS}` }}>{error}</div>
        )}

        {lead && (
          <>
            <Section title="DATOS DEL LEAD">
              {fields.map(([k, v]) => (
                <Row key={k} k={k} v={v} />
              ))}
            </Section>

            <Section title="ATRIBUCIÓN">
              {utm.map(([k, v]) => (
                <Row key={k} k={k} v={v} mono />
              ))}
            </Section>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ font: `700 10.5px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>BITÁCORA</div>
              {log.map((l) => (
                <div key={l.t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 7, background: l.dot, marginTop: 5, flex: '0 0 7px' }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ font: `600 12.5px ${SANS}` }}>{l.t}</span>
                    <span style={{ font: `500 11.5px ${MONO}`, color: MUTED }}>{l.at}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Acción real: estado comercial */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto', paddingTop: 8, borderTop: `1px solid ${ROW_LINE}` }}>
              <div style={{ font: `700 10.5px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>GESTIÓN CRM</div>
              {canChangeStatus ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={commercial} onChange={(e) => setCommercial(e.target.value)}
                    style={{ flex: '1 1 auto', border: `1px solid ${LINE}`, background: '#FBFBF9', borderRadius: 10, padding: '10px 12px', font: `600 12.5px ${SANS}`, color: INK, cursor: 'pointer' }}>
                    {COMMERCIAL.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <button type="button" onClick={saveStatus} disabled={saving}
                    style={{ border: 'none', cursor: saving ? 'default' : 'pointer', background: INK, color: '#fff', borderRadius: 10, padding: '10px 16px', font: `700 12.5px ${SANS}` }}>
                    {saving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              ) : (
                <div style={{ font: `500 12px ${SANS}`, color: MUTED }}>Sin permiso para cambiar el estado comercial.</div>
              )}
              {saveMsg && <span style={{ font: `600 12px ${SANS}`, color: saveMsg === 'Guardado' ? '#1B7F4B' : '#A33A2A' }}>{saveMsg}</span>}
            </div>
          </>
        )}
      </aside>
    </div>
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

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, padding: '8px 0', borderBottom: `1px solid ${ROW_LINE}` }}>
      <span style={{ font: mono ? `500 11.5px ${MONO}` : `600 12px ${SANS}`, color: MUTED }}>{k}</span>
      <span style={{ font: `500 12.5px ${MONO}`, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
    </div>
  );
}
