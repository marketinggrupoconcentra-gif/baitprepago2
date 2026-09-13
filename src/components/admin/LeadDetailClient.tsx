/**
 * src/components/admin/LeadDetailClient.tsx
 *
 * Página completa de detalle de un lead.
 * Muestra: datos del formulario (PII), atribución, consentimientos,
 * gestión CRM (con cambio de estado) y entrega a Intelix.
 */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { hasPermission } from '@/lib/rbac';
import type { AdminSession } from '@/lib/session';

/* ─── Tipos ──────────────────────────────────────────────────────────────────── */
interface LeadDetail {
  id: string;
  publicReference: string;
  status: string;
  stateCode: string | null;
  planCode: string;
  createdAt: string;
  updatedAt: string;
  pii: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    birthdate: string;
  };
  attribution: {
    sourceCategory: string | null;
    firstUtmSource: string | null;
    firstUtmMedium: string | null;
    firstUtmCampaign: string | null;
    firstUtmTerm: string | null;
    firstUtmContent: string | null;
    lastUtmSource: string | null;
    lastUtmMedium: string | null;
    lastUtmCampaign: string | null;
    lastUtmTerm: string | null;
    lastUtmContent: string | null;
    landingUrl: string | null;
    referrerHost: string | null;
    firstTouchAt: string | null;
    lastTouchAt: string | null;
  } | null;
  consent: {
    contractingAccepted: boolean;
    privacyAccepted: boolean;
    privacyPolicyVersion: string;
    termsVersion: string;
    acceptedAt: string;
  } | null;
  management: {
    commercialStatus: string;
    notes: string | null;
    updatedAt: string | null;
    assignedToAuthUserId: string | null;
  } | null;
  delivery: {
    destination: string;
    status: string;
    attempts: number;
    deliveredAt: string | null;
    lastErrorCode: string | null;
    nextAttemptAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
}

/* ─── Constantes ─────────────────────────────────────────────────────────────── */
const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  received:   { label: 'Recibido',   color: 'oklch(38% 0.12 240)', bg: 'oklch(93% 0.06 240)' },
  processing: { label: 'En proceso', color: 'oklch(38% 0.12 97)',  bg: 'oklch(95% 0.08 97)'  },
  delivered:  { label: 'Enviado',    color: 'oklch(35% 0.12 155)', bg: 'oklch(93% 0.08 155)' },
  failed:     { label: 'Fallido',    color: 'oklch(40% 0.12 25)',  bg: 'oklch(95% 0.05 25)'  },
  duplicate:  { label: 'Duplicado',  color: 'oklch(42% 0 0)',      bg: 'oklch(93% 0 0)'      },
  pending:    { label: 'Pendiente',  color: 'oklch(38% 0.12 97)',  bg: 'oklch(95% 0.08 97)'  },
  dead:       { label: 'Muerto',     color: 'oklch(40% 0.12 25)',  bg: 'oklch(95% 0.05 25)'  },
};

const COMMERCIAL_MAP: Record<string, { label: string; color: string; bg: string }> = {
  NEW:        { label: 'Nuevo',        color: 'oklch(38% 0.12 240)', bg: 'oklch(93% 0.06 240)' },
  CONTACTED:  { label: 'Contactado',   color: 'oklch(38% 0.12 97)',  bg: 'oklch(95% 0.08 97)'  },
  FOLLOW_UP:  { label: 'Seguimiento',  color: 'oklch(38% 0.12 97)',  bg: 'oklch(95% 0.08 97)'  },
  WON:        { label: 'Ganado',       color: 'oklch(35% 0.12 155)', bg: 'oklch(93% 0.08 155)' },
  LOST:       { label: 'Perdido',      color: 'oklch(40% 0.12 25)',  bg: 'oklch(95% 0.05 25)'  },
};

const SOURCE_LABELS: Record<string, string> = {
  google_ads:  'Google Ads',
  meta_ads:    'Meta Ads',
  paid_other:  'Paid — Otro',
  organic:     'Orgánico',
  referral:    'Referral',
  direct:      'Directo',
  other:       'Otro',
};

const PLAN_LABELS: Record<string, string> = {
  prepago_100: 'Prepago $100 · 36 GB',
};

/* ─── Helpers ────────────────────────────────────────────────────────────────── */
function fmtDate(d: string | null | undefined, withTime = true): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'America/Mexico_City',
  });
}

function fmtPhone(p: string): string {
  const clean = p.replace(/\D/g, '');
  if (clean.length === 10) return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
  return p;
}

function Badge({ value, map }: { value: string; map: Record<string, { label: string; color: string; bg: string }> }) {
  const s = map[value] ?? { label: value, color: 'oklch(42% 0 0)', bg: 'oklch(93% 0 0)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: '12px', fontWeight: '700',
      padding: '4px 12px', borderRadius: '100px',
      color: s.color, background: s.bg,
      letterSpacing: '0.01em',
    }}>
      {s.label}
    </span>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid oklch(91% 0 0)',
      borderRadius: '16px',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid oklch(93% 0 0)',
        display: 'flex', alignItems: 'center', gap: '10px',
        background: 'oklch(98.5% 0 0)',
      }}>
        <span style={{ fontSize: '17px' }}>{icon}</span>
        <span style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'oklch(40% 0 0)' }}>
          {title}
        </span>
      </div>
      <div style={{ padding: '20px 24px' }}>
        {children}
      </div>
    </div>
  );
}

function DataRow({ label, value, mono = false, highlight = false }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr',
      gap: '12px',
      padding: '10px 0',
      borderBottom: '1px solid oklch(95% 0 0)',
      alignItems: 'start',
    }}>
      <span style={{ fontSize: '12.5px', color: 'oklch(52% 0 0)', paddingTop: '1px', fontWeight: '500' }}>
        {label}
      </span>
      <span style={{
        fontSize: mono ? '13px' : '14px',
        fontWeight: highlight ? '700' : '500',
        color: highlight ? 'oklch(18% 0 0)' : 'oklch(25% 0 0)',
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-all',
      }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

/* ─── Componente principal ───────────────────────────────────────────────────── */
export default function LeadDetailClient({
  id,
  session,
}: {
  id: string;
  session: AdminSession;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoAssigned, setAutoAssigned] = useState(false);

  // CRM
  const [newStatus, setNewStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const canViewPii     = hasPermission(session.role, 'leads.detail.view');
  const canChangeStatus = hasPermission(session.role, 'leads.status.change');

  useEffect(() => {
    fetch(`/api/admin/leads/${id}`)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data: LeadDetail) => {
        setLead(data);
        setNewStatus(data.management?.commercialStatus ?? 'NEW');
        setNotes(data.management?.notes ?? '');
        // Detectar si fue auto-asignado en esta apertura
        setAutoAssigned(!data.management?.assignedToAuthUserId);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSaveStatus() {
    if (!lead || !canChangeStatus) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/admin/leads/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commercialStatus: newStatus, notes }),
      });
      if (!res.ok) throw new Error('Error al guardar');
      setSaveMsg('✓ Guardado correctamente');
      // Refrescar
      const updated = await fetch(`/api/admin/leads/${id}`).then(r => r.json());
      setLead(updated);
      setTimeout(() => setSaveMsg(''), 3000);
    } catch {
      setSaveMsg('✗ Error al guardar. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  /* ── Loading ── */
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', gap: '16px' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid oklch(90% 0 0)', borderTopColor: 'oklch(30% 0 0)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontSize: '14px', color: 'oklch(52% 0 0)', margin: 0 }}>Cargando detalle…</p>
      </div>
    );
  }

  /* ── Error ── */
  if (error || !lead) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
        <p style={{ fontSize: '16px', color: 'oklch(40% 0.12 25)', fontWeight: '600', marginBottom: '8px' }}>
          No se pudo cargar el lead
        </p>
        <p style={{ fontSize: '14px', color: 'oklch(55% 0 0)', marginBottom: '24px' }}>
          {error === '404' ? 'Lead no encontrado.' : 'Error de servidor. Intenta de nuevo.'}
        </p>
        <button
          className="admin-btn-secondary"
          onClick={() => router.push('/admin/leads')}
        >
          ← Volver a leads
        </button>
      </div>
    );
  }



  return (
    <div style={{ maxWidth: '900px' }}>

      {/* ─── Breadcrumb + Header ─── */}
      <div style={{ marginBottom: '28px' }}>
        <button
          onClick={() => router.push('/admin/leads')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: 'oklch(52% 0 0)', padding: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          ← Leads
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ margin: '0 0 6px', fontSize: '26px', fontWeight: '800', color: 'oklch(14% 0 0)', letterSpacing: '-0.01em' }}>
              {canViewPii ? `${lead.pii.firstName} ${lead.pii.lastName}` : 'Lead'}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <code style={{ fontSize: '12px', color: 'oklch(50% 0 0)', background: 'oklch(95% 0 0)', padding: '3px 8px', borderRadius: '6px' }}>
                {lead.publicReference}
              </code>
              <Badge value={lead.status} map={STATUS_MAP} />
              <Badge value={lead.management?.commercialStatus ?? 'NEW'} map={COMMERCIAL_MAP} />
            </div>
          </div>
          <div style={{ fontSize: '12.5px', color: 'oklch(52% 0 0)', textAlign: 'right' }}>
            <div>Creado: {fmtDate(lead.createdAt)}</div>
            <div>Actualizado: {fmtDate(lead.updatedAt)}</div>
          </div>
        </div>
      </div>

      {/* ─── Grid de secciones ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* 1. Datos del formulario (PII) */}
        {canViewPii && (
          <Section title="Datos del solicitante" icon="👤">
            <DataRow label="Nombre" value={lead.pii.firstName} highlight />
            <DataRow label="Apellido" value={lead.pii.lastName} highlight />
            <DataRow label="Email" value={
              <a href={`mailto:${lead.pii.email}`} style={{ color: 'oklch(38% 0.12 240)', textDecoration: 'none' }}>
                {lead.pii.email}
              </a>
            } />
            <DataRow label="Teléfono" value={
              <a href={`tel:${lead.pii.phone}`} style={{ color: 'oklch(38% 0.12 240)', textDecoration: 'none' }}>
                {fmtPhone(lead.pii.phone)}
              </a>
            } />
            {lead.pii.birthdate && <DataRow label="Fecha de nacimiento" value={lead.pii.birthdate} />}
          </Section>
        )}

        {/* 2. Información del plan */}
        <Section title="Plan solicitado" icon="📋">
          <DataRow label="Plan" value={PLAN_LABELS[lead.planCode] ?? lead.planCode} highlight />
          <DataRow label="Estado" value={<Badge value={lead.status} map={STATUS_MAP} />} />
          <DataRow label="Entidad" value={lead.stateCode ?? '—'} />
          <DataRow label="Referencia pública" value={lead.publicReference} mono />
          <DataRow label="ID interno" value={lead.id} mono />
        </Section>

        {/* 3. Consentimientos */}
        {lead.consent && (
          <Section title="Consentimientos legales" icon="✅">
            <DataRow
              label="Aviso de privacidad"
              value={
                <span style={{ color: lead.consent.privacyAccepted ? 'oklch(35% 0.12 155)' : 'oklch(40% 0.12 25)' }}>
                  {lead.consent.privacyAccepted ? '✓ Aceptado' : '✗ No aceptado'}
                </span>
              }
            />
            <DataRow
              label="Términos de contratación"
              value={
                <span style={{ color: lead.consent.contractingAccepted ? 'oklch(35% 0.12 155)' : 'oklch(40% 0.12 25)' }}>
                  {lead.consent.contractingAccepted ? '✓ Aceptado' : '✗ No aceptado'}
                </span>
              }
            />
            <DataRow label="Versión privacidad" value={lead.consent.privacyPolicyVersion} mono />
            <DataRow label="Versión términos" value={lead.consent.termsVersion} mono />
            <DataRow label="Aceptado el" value={fmtDate(lead.consent.acceptedAt)} />
          </Section>
        )}

        {/* 4. Gestión CRM */}
        <Section title="Gestión CRM" icon="📊">
          {/* Banner de auto-asignación */}
          {autoAssigned && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 14px', borderRadius: '10px', marginBottom: '16px',
              background: 'oklch(93% 0.06 155)', border: '1px solid oklch(80% 0.10 155)',
            }}>
              <span style={{ fontSize: '15px' }}>✅</span>
              <span style={{ fontSize: '13px', color: 'oklch(30% 0.12 155)', fontWeight: '600' }}>
                Lead asignado automáticamente a tu usuario al abrir el detalle.
              </span>
            </div>
          )}
          <div style={{ marginBottom: '4px' }}>
            <DataRow
              label="Estado actual"
              value={<Badge value={lead.management?.commercialStatus ?? 'NEW'} map={COMMERCIAL_MAP} />}
            />
            {lead.management?.assignedToAuthUserId && (
              <DataRow
                label="Asignado a"
                value={
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                      width: '22px', height: '22px', borderRadius: '50%',
                      background: 'oklch(88% 0.12 240)', color: 'oklch(35% 0.15 240)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: '700',
                    }}>
                      {session.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </span>
                    <span style={{ fontWeight: '600', color: 'oklch(22% 0 0)' }}>
                      {lead.management.assignedToAuthUserId === session.userId
                        ? `${session.name} (tú)`
                        : lead.management.assignedToAuthUserId}
                    </span>
                  </span>
                }
              />
            )}
            {lead.management?.notes && (
              <DataRow label="Notas" value={lead.management.notes} />
            )}
            {lead.management?.updatedAt && (
              <DataRow label="Última actualización" value={fmtDate(lead.management.updatedAt)} />
            )}
          </div>

          {canChangeStatus && (
            <div style={{
              marginTop: '20px',
              padding: '20px',
              background: 'oklch(98% 0 0)',
              border: '1px solid oklch(91% 0 0)',
              borderRadius: '12px',
            }}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'oklch(45% 0 0)', marginBottom: '14px' }}>
                Actualizar estado
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <select
                  className="admin-input"
                  value={newStatus}
                  onChange={e => setNewStatus(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {Object.entries(COMMERCIAL_MAP).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <textarea
                  className="admin-input"
                  placeholder="Notas internas (máx. 500 caracteres)…"
                  value={notes}
                  onChange={e => setNotes(e.target.value.slice(0, 500))}
                  style={{ minHeight: '90px', resize: 'vertical', width: '100%' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    className="admin-btn-primary"
                    onClick={handleSaveStatus}
                    disabled={saving}
                  >
                    {saving ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                  {saveMsg && (
                    <span style={{
                      fontSize: '13px',
                      color: saveMsg.startsWith('✓') ? 'oklch(35% 0.12 155)' : 'oklch(40% 0.12 25)',
                      fontWeight: '600',
                    }}>
                      {saveMsg}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11.5px', color: 'oklch(58% 0 0)' }}>
                  {notes.length}/500 caracteres
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* 5. Atribución */}
        {lead.attribution && (
          <Section title="Atribución de marketing" icon="📡">
            <DataRow label="Fuente" value={SOURCE_LABELS[lead.attribution.sourceCategory ?? ''] ?? lead.attribution.sourceCategory} highlight />
            {lead.attribution.landingUrl && (
              <DataRow label="Landing URL" value={
                <a href={lead.attribution.landingUrl} target="_blank" rel="noopener noreferrer"
                  style={{ color: 'oklch(38% 0.12 240)', textDecoration: 'none', fontSize: '12.5px', wordBreak: 'break-all' }}>
                  {lead.attribution.landingUrl}
                </a>
              } />
            )}
            {lead.attribution.referrerHost && (
              <DataRow label="Referrer" value={lead.attribution.referrerHost} mono />
            )}
            {lead.attribution.firstTouchAt && (
              <DataRow label="Primer contacto" value={fmtDate(lead.attribution.firstTouchAt)} />
            )}
            {lead.attribution.lastTouchAt && (
              <DataRow label="Último contacto" value={fmtDate(lead.attribution.lastTouchAt)} />
            )}

            {/* First touch UTMs */}
            {(lead.attribution.firstUtmSource || lead.attribution.firstUtmCampaign) && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid oklch(93% 0 0)' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'oklch(52% 0 0)', marginBottom: '10px' }}>
                  First Touch UTMs
                </div>
                {lead.attribution.firstUtmSource   && <DataRow label="utm_source"   value={lead.attribution.firstUtmSource}   mono />}
                {lead.attribution.firstUtmMedium   && <DataRow label="utm_medium"   value={lead.attribution.firstUtmMedium}   mono />}
                {lead.attribution.firstUtmCampaign && <DataRow label="utm_campaign" value={lead.attribution.firstUtmCampaign} mono />}
                {lead.attribution.firstUtmTerm     && <DataRow label="utm_term"     value={lead.attribution.firstUtmTerm}     mono />}
                {lead.attribution.firstUtmContent  && <DataRow label="utm_content"  value={lead.attribution.firstUtmContent}  mono />}
              </div>
            )}

            {/* Last touch UTMs */}
            {(lead.attribution.lastUtmSource || lead.attribution.lastUtmCampaign) && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid oklch(93% 0 0)' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'oklch(52% 0 0)', marginBottom: '10px' }}>
                  Last Touch UTMs
                </div>
                {lead.attribution.lastUtmSource   && <DataRow label="utm_source"   value={lead.attribution.lastUtmSource}   mono />}
                {lead.attribution.lastUtmMedium   && <DataRow label="utm_medium"   value={lead.attribution.lastUtmMedium}   mono />}
                {lead.attribution.lastUtmCampaign && <DataRow label="utm_campaign" value={lead.attribution.lastUtmCampaign} mono />}
                {lead.attribution.lastUtmTerm     && <DataRow label="utm_term"     value={lead.attribution.lastUtmTerm}     mono />}
                {lead.attribution.lastUtmContent  && <DataRow label="utm_content"  value={lead.attribution.lastUtmContent}  mono />}
              </div>
            )}
          </Section>
        )}

        {/* 6. Entrega Intelix */}
        {lead.delivery && (
          <Section title="Entrega a Intelix" icon="🚀">
            <DataRow label="Destino" value={lead.delivery.destination} mono />
            <DataRow label="Estado" value={<Badge value={lead.delivery.status} map={STATUS_MAP} />} />
            <DataRow label="Intentos" value={String(lead.delivery.attempts)} />
            {lead.delivery.deliveredAt && (
              <DataRow label="Entregado el" value={fmtDate(lead.delivery.deliveredAt)} />
            )}
            {lead.delivery.lastErrorCode && (
              <DataRow
                label="Último error"
                value={
                  <span style={{ color: 'oklch(40% 0.12 25)', fontFamily: 'monospace', fontSize: '12px' }}>
                    {lead.delivery.lastErrorCode}
                  </span>
                }
              />
            )}
            {lead.delivery.nextAttemptAt && (
              <DataRow label="Próximo intento" value={fmtDate(lead.delivery.nextAttemptAt)} />
            )}
            {lead.delivery.createdAt && (
              <DataRow label="Creado" value={fmtDate(lead.delivery.createdAt)} />
            )}
          </Section>
        )}

      </div>
    </div>
  );
}
