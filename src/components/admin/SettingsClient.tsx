/**
 * src/components/admin/SettingsClient.tsx
 *
 * Configuración — vista `/admin/settings`. Diseño: "Configuración.dc.html".
 *
 * Integraciones (GTM/GA4/Pixel, Meta CAPI, Resend, Google Ads, valor de
 * conversión) se editan aquí y se guardan en app.settings (secretos cifrados,
 * enmascarados en la UI) con fallback a variables de entorno. El resto de la
 * pantalla (sistema, formulario, reportes) es informativo.
 */
'use client';

import { useEffect, useState } from 'react';
import type { AdminSession } from '@/lib/session';

// ── Paleta del diseño ─────────────────────────────────────────────────────────
const INK = '#16160F';
const MUTED = '#6E6E64';
const LINE = '#E6E5E0';
const ROW_LINE = '#F5F4EF';
const CARD = '#FFFFFF';
const AMBER_SOFT = '#FFF6DC';
const AMBER_BD = '#F4E2AE';
const GOLD = '#8C6A00';
const GREEN_FG = '#1B6B44';

const SANS = "'Manrope', system-ui, -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export type IntegrationStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'PARTIAL';
export interface Integration {
  key: string;
  label: string;
  meta: string;
  status: IntegrationStatus;
  value?: string | null;
  configKeys?: { label: string; dbKey: string; val: string; ph?: string; secret?: boolean; numeric?: boolean; help?: string }[];
}
interface SystemInfo {
  appUrl: string | null;
  allowedOrigins: string[];
  environment: string;
  commit: string | null;
  timezone: string;
  authProvider: string;
  privacyPolicyVersion: string | null;
  termsVersion: string | null;
  maxDeliveryAttempts: number;
}
interface FormField { label: string; key: string; visible: boolean; required: boolean; conditional?: boolean; locked?: boolean }
interface ReportSchedule { id: string; name: string; frequency: string; isActive: boolean; recipientCount: number; recipientDomains: string[] }

const STATUS_PILL: Record<IntegrationStatus, { label: string; fg: string; bg: string; bd: string }> = {
  CONFIGURED: { label: 'Configurada', fg: GREEN_FG, bg: '#EAF5EE', bd: '#CBE5D6' },
  PARTIAL: { label: 'Parcial', fg: GOLD, bg: AMBER_SOFT, bd: AMBER_BD },
  NOT_CONFIGURED: { label: 'Sin conectar', fg: '#54544C', bg: '#F3F2ED', bd: LINE },
};
const FREQ_LABELS: Record<string, string> = { DAILY: 'Diario', WEEKLY: 'Semanal', MONTHLY: 'Mensual' };

const SECTIONS = [
  { id: 'cuenta', label: 'Cuenta' },
  { id: 'formulario', label: 'Formulario' },
  { id: 'validacion', label: 'Validación y entrega' },
  { id: 'integraciones', label: 'Integraciones' },
  { id: 'avisos', label: 'Avisos' },
  { id: 'datos', label: 'Datos y privacidad' },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function SettingsClient({
  session, integrations = [], systemInfo, formFields = [],
}: {
  session: AdminSession;
  integrations?: Integration[];
  systemInfo?: SystemInfo;
  formFields?: FormField[];
}) {
  const [schedules, setSchedules] = useState<ReportSchedule[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/reports/schedules')
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setSchedules((j.data ?? []) as ReportSchedule[]); })
      .catch(() => { if (!cancelled) setSchedules([]); });
    return () => { cancelled = true; };
  }, []);

  const si = systemInfo;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, font: `400 14px ${SANS}`, color: INK, maxWidth: 1440, margin: '0 auto' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
        .st-nav a:hover { background: #F5F5F3; color: #16160F; }
        html { scroll-behavior: smooth; }
      `}</style>

      {/* Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <span style={{ font: `700 11px ${SANS}`, letterSpacing: '0.08em', color: MUTED }}>BAIT PREPAGO · PORTABILIDAD</span>
          <h1 style={{ margin: 0, font: `800 28px ${SANS}`, letterSpacing: '-0.028em', lineHeight: 1.1 }}>Configuración</h1>
          <p style={{ margin: 0, font: `500 13.5px ${SANS}`, color: MUTED, maxWidth: '64ch' }}>
            Cómo se capturan, validan y entregan los leads de portabilidad, y quién recibe los avisos.
          </p>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, background: AMBER_SOFT, border: `1px solid ${AMBER_BD}`, borderRadius: 20, padding: '7px 13px', font: `600 12px ${SANS}`, color: GOLD, maxWidth: 460 }}>
          Integraciones editables aquí · secretos cifrados y enmascarados · el resto es informativo
        </span>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '176px minmax(0,1fr)', gap: 16, alignItems: 'start' }} className="st-grid">
          {/* Nav lateral */}
          <nav className="st-nav" style={{ position: 'sticky', top: 14, background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '12px 10px', display: 'flex', flexWrap: 'wrap', gap: 4, zIndex: 10 }}>
            <div style={{ font: `700 10.5px ${SANS}`, letterSpacing: '0.08em', color: MUTED, padding: '0 4px 4px', width: '100%' }}>SECCIONES</div>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 9, font: `600 12.5px ${SANS}`, color: '#5C5C54', whiteSpace: 'nowrap', width: '100%' }}>
                {s.label}
              </a>
            ))}
          </nav>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

            {/* ── Cuenta ── */}
            <Section id="cuenta" title="Cuenta" sub="Identidad de la cuenta y formato de los datos en todo el panel.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
                <ReadField label="Nombre de la cuenta" value="BAIT Prepago · Portabilidad" />
                <ReadField label="Dominio de la landing" value={si?.appUrl ?? '—'} mono />
                <ReadField label="Zona horaria" value={si?.timezone ?? 'America/Mexico_City'} mono />
                <ReadField label="Entorno" value={si?.environment ?? '—'} mono />
                <ReadField label="Commit desplegado" value={si?.commit ?? '—'} mono />
                <ReadField label="Proveedor de identidad" value={si?.authProvider ?? '—'} />
              </div>
              {si?.allowedOrigins && si.allowedOrigins.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ font: `700 11.5px ${SANS}`, color: '#3E3E36' }}>Orígenes permitidos</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {si.allowedOrigins.map((o) => (
                      <span key={o} style={{ font: `500 11px ${MONO}`, color: MUTED, background: '#F3F2ED', borderRadius: 6, padding: '4px 8px' }}>{o}</span>
                    ))}
                  </div>
                </div>
              )}
              <Note>Se define en <code style={cs}>APP_URL</code>, <code style={cs}>ALLOWED_ORIGINS</code> y el CLI de Neon Auth.</Note>
            </Section>

            {/* ── Formulario ── */}
            <Section id="formulario" title="Formulario de portabilidad" sub="Campos que pide la landing. Cada campo obligatorio reduce la conversión.">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.8fr 0.9fr 0.9fr', gap: 12, paddingBottom: 8, borderBottom: `1px solid #EFEEE9`, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>
                  <span>CAMPO</span><span style={{ textAlign: 'center' }}>VISIBLE</span><span style={{ textAlign: 'center' }}>OBLIGATORIO</span><span style={{ textAlign: 'right' }}>TIPO</span>
                </div>
                {formFields.map((c) => (
                  <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.8fr 0.9fr 0.9fr', gap: 12, alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${ROW_LINE}` }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ font: `600 13px ${SANS}` }}>{c.label}</span>
                      <span style={{ font: `500 11px ${MONO}`, color: MUTED }}>{c.key}</span>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={c.visible} /></span>
                    <span style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={c.required} amber /></span>
                    <span style={{ textAlign: 'right', font: `600 11px ${SANS}`, color: c.conditional ? GOLD : MUTED }}>
                      {c.conditional ? 'condicional' : c.locked ? 'fijo' : 'opcional'}
                    </span>
                  </div>
                ))}
              </div>
              <Note>
                Los campos y su obligatoriedad están definidos en el esquema de validación de la landing
                (<code style={cs}>src/lib/validators/lead-schema.ts</code>). La vigencia del NIP aparece solo
                cuando el NIP coincide con los últimos 4 dígitos del teléfono. El NIP nunca se persiste.
              </Note>
            </Section>

            {/* ── Validación y entrega ── */}
            <Section id="validacion" title="Validación y entrega" sub="Reglas que se aplican antes de enviar un lead al CRM.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Rule label="Formato del número" desc="Se rechaza cualquier número que no tenga exactamente 10 dígitos." on />
                <Rule label="Vigencia del NIP" desc="Si el NIP coincide con los últimos 4 dígitos del teléfono, se exige una fecha de vigencia dentro de los próximos 5 días naturales." on />
                <Rule label="CAPTCHA propio" desc="Reto de 6 dígitos de un solo uso emitido por el servidor (POST /api/captcha/challenge); solo se guarda su hash." on />
                <Rule label="Detección de duplicados" desc="El teléfono se indexa (blind index) al insertar; un alta repetida se marca como duplicado." on />
                <Rule label="Anti-abuso" desc="Honeypot, rate limiting distribuido por IP/teléfono y bloqueo de bots/escáneres en el edge." on />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, borderTop: `1px solid #EFEEE9`, paddingTop: 16 }}>
                <ReadField label="Reintentos de envío a Intelix" value={`${si?.maxDeliveryAttempts ?? 12} intentos`}
                  hint="Cada 5 min con backoff; al agotarlos el envío queda muerto y el lead como fallido (sección Logs)." />
                <ReadField label="NIP de portabilidad" value="Cifrado y temporal"
                  hint="Se cifra (AES-256-GCM) solo para entregarlo a Intelix; se borra al entregar o a las 72 h (NIP_RETENTION_HOURS). Nunca en claro, nunca visible en el admin." />
              </div>
            </Section>

            {/* ── Integraciones ── */}
            <Section id="integraciones" title="Integraciones" sub="Fuentes de datos y destinos conectados a esta cuenta.">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {integrations.map((i) => {
                  const pill = STATUS_PILL[i.status];
                  return (
                    <div key={i.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 0', borderBottom: `1px solid ${ROW_LINE}` }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <span style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 10, background: '#FFFFFF', border: '1px solid #E5E5E5', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {i.key === 'landing' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#00E17A"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                          {i.key === 'gtm' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 12l-10-10H2v10l10 10 10-10z" fill="#4285F4"/><circle cx="7" cy="7" r="2" fill="#F9AB00"/></svg>}
                          {i.key === 'ga4' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="15" width="4" height="7" fill="#F9AB00"/><rect x="10" y="9" width="4" height="13" fill="#E37400"/><rect x="17" y="2" width="4" height="20" fill="#E37400"/></svg>}
                          {i.key === 'meta_pixel' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 10.174c1.766-2.784 3.315-4.174 4.648-4.174 2 0 3.263 2.213 4 5.217.704 2.869.5 6.783-2 6.783-1.114 0-2.648-1.565-4.148-3.652a27.627 27.627 0 01-2.5-4.174z" stroke="#0668E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 10.174c-1.766-2.784-3.315-4.174-4.648-4.174-2 0-3.263 2.213-4 5.217-.704 2.869-.5 6.783 2 6.783 1.114 0 2.648-1.565 4.148-3.652 1-1.391 1.833-2.783 2.5-4.174z" stroke="#0668E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          {i.key === 'meta_capi' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 10.174c1.766-2.784 3.315-4.174 4.648-4.174 2 0 3.263 2.213 4 5.217.704 2.869.5 6.783-2 6.783-1.114 0-2.648-1.565-4.148-3.652a27.627 27.627 0 01-2.5-4.174z" stroke="#0668E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 10.174c-1.766-2.784-3.315-4.174-4.648-4.174-2 0-3.263 2.213-4 5.217-.704 2.869-.5 6.783 2 6.783 1.114 0 2.648-1.565 4.148-3.652 1-1.391 1.833-2.783 2.5-4.174z" stroke="#0668E1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          {i.key === 'resend' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#000"/><path d="M11 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6" stroke="#fff" strokeWidth="1.5"/><path d="M15 16h6M18 13l3 3-3 3" stroke="#fff" strokeWidth="1.5"/></svg>}
                          {i.key === 'google_ads' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.66 2l-8.58 19.33h7.16l4.29-9.66-2.87-9.67z" fill="#F4B400"/><path d="M14.53 2h7.16l-8.58 19.33h-7.16z" fill="#4285F4"/></svg>}
                          {i.key === 'intelix' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="8" rx="3" fill="#6366F1"/><rect x="3" y="12" width="18" height="8" rx="3" fill="#4F46E5"/><line x1="7" y1="8" x2="7.01" y2="8" stroke="#fff" strokeWidth="2" strokeLinecap="round"/><line x1="7" y1="16" x2="7.01" y2="16" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>}
                          {i.key === 'conversions' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#16160F" strokeWidth="1.6"/><path d="M12 7v10M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5H10.5a1.75 1.75 0 0 0 0 3.5h4" stroke="#16160F" strokeWidth="1.6" strokeLinecap="round"/></svg>}
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ font: `700 13px ${SANS}` }}>{i.label}</span>
                          <span style={{ font: `500 11px ${MONO}`, color: MUTED }}>{i.meta}</span>
                        </span>
                      </span>
                      {i.key === 'landing' ? (
                        <span style={{ font: `700 11px ${SANS}`, color: pill.fg, background: pill.bg, border: `1px solid ${pill.bd}`, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>{pill.label}</span>
                      ) : (
                        <IntegrationEditor integration={i} />
                      )}
                    </div>
                  );
                })}
              </div>
              <Note>Lo que guardes aquí tiene prioridad sobre las variables de entorno. Los secretos (tokens, client secret, refresh token) se cifran en reposo y nunca se vuelven a mostrar; al editar, deja el campo enmascarado para conservarlo o escribe uno nuevo para reemplazarlo. Guía por plataforma: <code style={cs}>docs/atribucion.md</code>.</Note>
            </Section>

            {/* ── Avisos ── */}
            <Section id="avisos" title="Avisos" sub="Reportes por correo programados (Resend).">
              {schedules === null ? (
                <div style={{ font: `500 12px ${SANS}`, color: MUTED }}>Cargando reportes…</div>
              ) : schedules.length === 0 ? (
                <div style={{ background: '#FBFBF9', border: `1px solid #EFEEE9`, borderRadius: 12, padding: '13px 14px', font: `500 12px ${SANS}`, color: MUTED }}>
                  No hay reportes programados. Se crean con permiso <code style={cs}>reports.create</code>.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1fr 0.7fr', gap: 12, paddingBottom: 8, borderBottom: `1px solid #EFEEE9`, font: `700 10.5px ${SANS}`, letterSpacing: '0.06em', color: MUTED }}>
                    <span>REPORTE</span><span>FRECUENCIA</span><span>DESTINATARIOS</span><span style={{ textAlign: 'right' }}>ESTADO</span>
                  </div>
                  {schedules.map((s) => (
                    <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1fr 0.7fr', gap: 12, alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${ROW_LINE}` }}>
                      <span style={{ font: `600 13px ${SANS}` }}>{s.name}</span>
                      <span style={{ font: `500 12px ${SANS}`, color: '#4B4B44' }}>{FREQ_LABELS[s.frequency] ?? s.frequency}</span>
                      <span style={{ font: `500 11.5px ${MONO}`, color: MUTED }}>{s.recipientCount} · {s.recipientDomains.join(', ') || '—'}</span>
                      <span style={{ justifySelf: 'end', font: `700 11px ${SANS}`, color: s.isActive ? GREEN_FG : '#54544C', background: s.isActive ? '#EAF5EE' : '#F3F2ED', border: `1px solid ${s.isActive ? '#CBE5D6' : LINE}`, borderRadius: 20, padding: '3px 9px' }}>
                        {s.isActive ? 'Activo' : 'Pausado'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Note>Los avisos operativos (caída de leads, fallos de tracking) se registran en la bitácora; su envío por correo depende de que Resend esté configurado.</Note>
            </Section>

            {/* ── Datos y privacidad ── */}
            <Section id="datos" title="Datos y privacidad" sub="Cuánto se conserva y cómo se exporta.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
                <ReadField label="Versión del Aviso de Privacidad" value={si?.privacyPolicyVersion ?? '—'} mono />
                <ReadField label="Versión de Términos" value={si?.termsVersion ?? '—'} mono />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ font: `600 12.5px ${SANS}` }}>Cifrado de PII</span>
                <span style={{ font: `500 11.5px ${SANS}`, color: '#5C5C54' }}>
                  Nombre, apellidos, correo, teléfono y fecha de nacimiento se guardan cifrados (AES-256-GCM).
                  La búsqueda usa blind indexes (HMAC), nunca el valor en claro. La IP se guarda como HMAC.
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#FBFBF9', border: `1px solid #EFEEE9`, borderRadius: 12, padding: '13px 14px' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ font: `700 12.5px ${SANS}` }}>Exportar leads a CSV</span>
                  <span style={{ font: `500 11.5px ${SANS}`, color: '#5C5C54' }}>Requiere permiso <code style={cs}>leads.export</code>; con <code style={cs}>?sensitive=1</code> incluye PII (permiso aparte).</span>
                </span>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- descarga de archivo (route handler) */}
                <a href="/api/admin/leads/export" style={{ cursor: 'pointer', border: `1px solid ${LINE}`, background: CARD, borderRadius: 9, padding: '8px 13px', font: `700 12px ${SANS}`, color: INK, textDecoration: 'none' }}>Exportar CSV</a>
              </div>
            </Section>

            <div style={{ font: `500 11.5px ${SANS}`, color: MUTED, padding: '4px 2px' }}>
              Sesión: {session.email} · {session.role}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const cs: React.CSSProperties = { font: `500 11px ${MONO}`, background: '#F3F2ED', borderRadius: 4, padding: '1px 4px' };

// ── Sub-componentes ───────────────────────────────────────────────────────────
function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, font: `700 16px ${SANS}`, letterSpacing: '-0.015em' }}>{title}</h2>
        <p style={{ margin: 0, font: `500 12.5px ${SANS}`, color: MUTED }}>{sub}</p>
      </div>
      {children}
    </section>
  );
}

function ReadField({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: `700 11.5px ${SANS}`, color: '#3E3E36' }}>{label}</span>
      <div style={{ border: `1px solid ${LINE}`, background: '#F3F2ED', borderRadius: 10, padding: '10px 12px', font: mono ? `500 12px ${MONO}` : `600 12.5px ${SANS}`, color: INK, wordBreak: 'break-word' }}>
        {value}
      </div>
      {hint && <span style={{ font: `500 11px ${SANS}`, color: MUTED }}>{hint}</span>}
    </div>
  );
}

function Toggle({ on, amber }: { on: boolean; amber?: boolean }) {
  return (
    <span aria-hidden style={{ display: 'inline-block', width: 38, height: 22, borderRadius: 22, background: on ? (amber ? '#E0A800' : INK) : '#DDDCD5', position: 'relative', opacity: 0.85 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: 16, background: '#fff', boxShadow: '0 1px 2px rgba(22,22,15,0.2)' }} />
    </span>
  );
}

function Rule({ label, desc, on }: { label: string; desc: string; on: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, padding: '12px 13px', background: on ? '#FFFDF4' : '#FBFBF9', border: `1px solid ${on ? AMBER_BD : '#EFEEE9'}`, borderRadius: 12 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ font: `700 12.5px ${SANS}` }}>{label}</span>
        <span style={{ font: `500 11.5px ${SANS}`, color: '#5C5C54' }}>{desc}</span>
      </span>
      <span style={{ flex: '0 0 auto', marginTop: 2 }}><Toggle on={on} /></span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: AMBER_SOFT, border: `1px solid ${AMBER_BD}`, borderRadius: 12, padding: '11px 13px', font: `500 12px ${SANS}`, color: GOLD }}>
      {children}
    </div>
  );
}

function IntegrationEditor({ integration }: { integration: Integration }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    integration.configKeys?.forEach(k => init[k.dbKey] = k.val || '');
    return init;
  });
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      if (!integration.configKeys) return;
      const promises = integration.configKeys.map(k =>
        fetch('/api/admin/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: k.dbKey, value: values[k.dbKey] }),
        })
      );
      const results = await Promise.all(promises);
      if (results.every(r => r.ok)) {
        window.location.reload();
      } else {
        const problems = await Promise.all(results.filter(r => !r.ok).map(async r => {
          try { const j = await r.json(); return j.error as string; } catch { return 'Error al guardar'; }
        }));
        alert(`No se guardó la configuración de ${integration.label}:` + String.fromCharCode(10) + problems.join(String.fromCharCode(10)));
      }
    } catch {
      alert(`Error de red al guardar ${integration.label}`);
    } finally {
      setLoading(false);
    }
  };

  const pill = STATUS_PILL[integration.status];

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: `700 11px ${SANS}`, color: pill.fg, background: pill.bg, border: `1px solid ${pill.bd}`, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>{pill.label}</span>
        {integration.configKeys && integration.configKeys.length > 0 && (
          <button onClick={() => setEditing(true)} style={{ font: `600 11px ${SANS}`, color: '#4B4B44', background: '#F3F2ED', border: `1px solid ${LINE}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>Editar</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch', width: 'min(100%, 560px)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        {integration.configKeys?.map(k => (
          <label key={k.dbKey} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: `600 11px ${SANS}`, color: '#4B4B44' }}>{k.label}{k.secret ? ' · secreto' : ''}</span>
            <input
              type={k.secret ? 'password' : 'text'}
              autoComplete="off"
              value={values[k.dbKey]}
              onFocus={() => { if (k.secret && values[k.dbKey] === '••••••••••••••••') setValues(prev => ({ ...prev, [k.dbKey]: '' })); }}
              inputMode={k.numeric ? 'numeric' : undefined}
              pattern={k.numeric ? '[0-9]*' : undefined}
              onChange={e => setValues(prev => ({ ...prev, [k.dbKey]: k.numeric ? e.target.value.replace(/\D/g, '') : e.target.value }))}
              placeholder={k.ph || ''}
              title={k.label}
              style={{ font: `500 12px ${MONO}`, padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6, width: '100%', outline: 'none', boxSizing: 'border-box' }}
              disabled={loading}
            />
            {k.help && <span style={{ font: `500 10.5px ${SANS}`, color: MUTED, lineHeight: 1.35 }}>{k.help}</span>}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={handleSave} disabled={loading} style={{ font: `600 11px ${SANS}`, color: '#FFF', background: INK, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Guardando...' : 'Guardar'}
        </button>
        <button onClick={() => { 
          setEditing(false); 
          setValues(() => {
            const init: Record<string, string> = {};
            integration.configKeys?.forEach(k => init[k.dbKey] = k.val || '');
            return init;
          });
        }} disabled={loading} style={{ font: `600 11px ${SANS}`, color: '#4B4B44', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

