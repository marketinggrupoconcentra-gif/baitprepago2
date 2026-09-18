'use client';

import { useEffect, useRef } from 'react';
import { parseUtmParams, parseClickIds } from '@/lib/attribution';

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
    google_tag_manager?: Record<string, unknown>;
    fbq?: ((...args: unknown[]) => void) & {
      push?: unknown;
      loaded?: boolean;
      version?: string;
      queue?: unknown[];
      callMethod?: (...args: unknown[]) => void;
    };
    _fbq?: unknown;
    gtag?: (...args: unknown[]) => void;
  }
}

const GTM_ID   = process.env.NEXT_PUBLIC_GTM_ID;
const GA4_ID   = process.env.NEXT_PUBLIC_GA4_ID;
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

type FirstPartyEvent = 
  | 'page_view'
  | 'form_step_1_start'
  | 'form_step_2_start'
  | 'form_step_3_start'
  | 'form_submitted'
  | 'form_error'
  | 'cta_click'
  | 'scroll_50'
  | 'scroll_90'
  | 'section_view';

export function getOrCreateAnalyticsSessionId(): string {
  if (typeof window === 'undefined') return crypto.randomUUID();
  let sid = sessionStorage.getItem('bait_analytics_session_id');
  if (!sid || sid.length !== 36) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('bait_analytics_session_id', sid);
  }
  return sid;
}

export function TrackingProvider({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  const initialized = useRef(false);
  const { trackFirstParty } = useTrack();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // ── GTM ────────────────────────────────────────────────────────────────
    if (GTM_ID && !document.getElementById('gtm-script')) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

      const script = document.createElement('script');
      script.id = 'gtm-script';
      script.async = true;
      if (nonce) script.nonce = nonce;
      script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
      document.head.appendChild(script);
    }

    // ── GA4 directo (solo si NO hay GTM) ─────────────────────────────────
    if (GA4_ID && !GTM_ID && !document.getElementById('ga4-script')) {
      window.dataLayer = window.dataLayer || [];
      const gtag = (...args: unknown[]) => { window.dataLayer.push(args as unknown as Record<string, unknown>); };
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', GA4_ID, { send_page_view: true });

      const script = document.createElement('script');
      script.id = 'ga4-script';
      script.async = true;
      if (nonce) script.nonce = nonce;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
      document.head.appendChild(script);
    }

    // ── Meta Pixel ────────────────────────────────────────────────────────
    if (PIXEL_ID && !document.getElementById('meta-pixel-script')) {
      const queue: unknown[][] = [];
      type FbqFn = {
        (...args: unknown[]): void;
        push?: unknown;
        loaded?: boolean;
        version?: string;
        queue?: unknown[];
        callMethod?: (...args: unknown[]) => void;
      };
      const fbq: FbqFn = (...args: unknown[]) => {
        if (typeof fbq.callMethod === 'function') {
          fbq.callMethod(...args);
        } else {
          queue.push(args);
        }
      };
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = queue;

      if (!window._fbq) window._fbq = fbq;
      window.fbq = fbq as typeof window.fbq;

      const script = document.createElement('script');
      script.id = 'meta-pixel-script';
      script.async = true;
      if (nonce) script.nonce = nonce;
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.appendChild(script);

      window.fbq!('init', PIXEL_ID);
      window.fbq!('track', 'PageView');
    }

    // ── 1st Party Session & Attribution ────────────────────────────────────
    getOrCreateAnalyticsSessionId();
    
    // Check if the URL has attribution signals
    const href = window.location.href;
    const utmParams = parseUtmParams(href);
    const clickIds = parseClickIds(href);
    const hasCampaign = !!(utmParams.utmSource || utmParams.utmMedium || utmParams.utmCampaign || clickIds.gclidPresent || clickIds.fbclidPresent);
    
    // Always store first touch if missing
    if (!sessionStorage.getItem('bait_analytics_first_touch')) {
      sessionStorage.setItem('bait_analytics_first_touch', JSON.stringify({
        url: href,
        referrer: document.referrer || '',
        timestamp: new Date().toISOString()
      }));
    }

    // Emit 1st party page_view event on mount — sólo fuera del admin: las rutas
    // React son /admin y /api, y una visita al panel no es una sesión de la landing
    // (contaminaba "sesiones" en Resumen/Analítica y escribía en Neon sin valor).
    if (!window.location.pathname.startsWith('/admin')) trackFirstParty('page_view');

    // Update last touch ONLY if there is an explicit acquisition signal 
    // so we don't erase last touch with a direct page reload
    if (hasCampaign) {
      sessionStorage.setItem('bait_analytics_last_touch', JSON.stringify({
        url: href,
        referrer: document.referrer || '',
        timestamp: new Date().toISOString()
      }));
    }
    // `href`/`hasCampaign` se calculan dentro del efecto a partir de
    // window.location (no reactivo) — no van en las dependencias.
  }, [nonce, trackFirstParty]);

  return (
    <>
      {GTM_ID && (
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
      )}
      {children}
    </>
  );
}

export function useTrack() {
  function dispatchThirdParty(eventName: string, params?: Record<string, string | number | boolean>) {
    if (typeof window === 'undefined') return;
    
    const eventId = crypto.randomUUID();

    if (window.dataLayer) {
      window.dataLayer.push({ event: eventName, eventId, ...params });
    }

    if (typeof window.fbq === 'function') {
      if (eventName === 'generate_lead') {
        window.fbq('track', 'Lead', params);
      } else {
        window.fbq('trackCustom', eventName, params);
      }
    }
  }

  function trackFirstParty(
    eventName: FirstPartyEvent,
    metadata?: {
      pagePath?: string;
      sectionId?: string;
      ctaId?: string;
      scrollPct?: number;
      errorCode?: string;
      deviceCategory?: 'mobile' | 'tablet' | 'desktop';
    }
  ) {
    if (typeof window === 'undefined') return;

    const eventId = crypto.randomUUID();
    const sessionId = getOrCreateAnalyticsSessionId();

    // Call first-party API safely without blocking UI
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName,
        eventId,
        sessionId,
        ...metadata,
      }),
      keepalive: true,
    }).catch(() => {});

    // Also push to 3rd party for visibility
    dispatchThirdParty(eventName, metadata);
  }

  return { trackFirstParty, dispatchThirdParty };
}

