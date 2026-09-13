(function () {
  'use strict';

  // Configurable por la landing vía window.BAIT_ANALYTICS_CONFIG antes de cargar
  // este script: { formId, formName, landingSections[], thankYouSections[], contentName }.
  var CFG = window.BAIT_ANALYTICS_CONFIG || {};
  var TRACK_URL = '/api/track';
  var CONFIG_URL = '/api/analytics/config';
  var FORM_ID = CFG.formId || 'lp-portability-form';
  var FORM_NAME = CFG.formName || 'portabilidad_prepago';
  var CONTENT_NAME = CFG.contentName || 'BAIT Prepago';
  var SESSION_KEY = 'bait_analytics_session_id';
  var FIRST_TOUCH_KEY = 'bait_analytics_first_touch';
  var LAST_TOUCH_KEY = 'bait_analytics_last_touch';
  var FORM_SUCCESS_KEY = 'bait_form_submission_success';
  var pageType = document.body.getAttribute('data-analytics-page') ||
    (window.location.pathname.indexOf('gracias') !== -1 ? 'thank_you' : 'landing');
  var formStarted = false;
  var formSubmitted = false;
  var currentStep = 1;
  var activeMs = 0;
  var activeSince = document.visibilityState === 'visible' ? Date.now() : null;
  var engagementMilestones = [10, 30, 60, 120, 300];
  var engagementSent = {};
  var scrollSent = {};
  var sectionSent = {};
  var fieldStarted = {};
  var fieldCompleted = {};
  var vendorConfig = null;
  var pendingVendorEvents = [];

  window.dataLayer = window.dataLayer || [];

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return Array.prototype.map.call(bytes, function (b) {
      return (b + 256).toString(16).slice(1);
    }).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  function storageGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (_) {}
  }

  function getSessionId() {
    var existing = storageGet(SESSION_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    var created = uuid();
    storageSet(SESSION_KEY, created);
    return created;
  }

  function clean(value, max) {
    if (typeof value !== 'string') return undefined;
    var normalized = value.trim().slice(0, max || 200);
    return normalized || undefined;
  }

  function referrerHost() {
    if (!document.referrer) return '';
    try {
      var host = new URL(document.referrer).hostname.replace(/^www\./, '').toLowerCase();
      return host === window.location.hostname.replace(/^www\./, '').toLowerCase() ? '' : host;
    } catch (_) { return ''; }
  }

  function resolveSource(params, referrer) {
    var medium = (params.get('utm_medium') || '').toLowerCase().trim();
    var source = (params.get('utm_source') || '').toLowerCase().trim();
    var paid = ['cpc', 'ppc', 'paidsearch', 'paid', 'display', 'cpm', 'cpv', 'social_paid', 'paid_social', 'banner'];
    if (params.has('gclid') || params.has('gbraid') || params.has('wbraid')) return 'google_ads';
    if (params.has('fbclid')) return 'meta_ads';
    if (paid.indexOf(medium) !== -1) {
      if (source.indexOf('google') !== -1) return 'google_ads';
      if (/facebook|instagram|meta/.test(source)) return 'meta_ads';
      return 'paid_other';
    }
    if (referrer) {
      if (/^(google\.com|google\.com\.mx|bing\.com|yahoo\.com|duckduckgo\.com|yandex\.com|baidu\.com|ask\.com)$/.test(referrer)) return 'organic';
      return 'referral';
    }
    if (source || medium) return 'other';
    return 'direct';
  }

  function currentTouch() {
    var params = new URLSearchParams(window.location.search);
    var referrer = referrerHost();
    return {
      sourceCategory: resolveSource(params, referrer),
      utmSource: clean(params.get('utm_source')),
      utmMedium: clean(params.get('utm_medium')),
      utmCampaign: clean(params.get('utm_campaign')),
      utmContent: clean(params.get('utm_content')),
      utmTerm: clean(params.get('utm_term')),
      referrerHost: clean(referrer),
      gclidPresent: params.has('gclid'),
      gbraidPresent: params.has('gbraid'),
      wbraidPresent: params.has('wbraid'),
      fbclidPresent: params.has('fbclid')
    };
  }

  function readTouch(key) {
    try { return JSON.parse(storageGet(key) || 'null'); } catch (_) { return null; }
  }

  var landingTouch = currentTouch();
  if (pageType === 'landing' || !storageGet(FIRST_TOUCH_KEY)) {
    if (!storageGet(FIRST_TOUCH_KEY)) storageSet(FIRST_TOUCH_KEY, JSON.stringify(landingTouch));
    storageSet(LAST_TOUCH_KEY, JSON.stringify(landingTouch));
  }
  var attribution = readTouch(FIRST_TOUCH_KEY) || landingTouch;

  function deviceCategory() {
    var width = window.innerWidth || document.documentElement.clientWidth || 1024;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  }

  function safeName(value, fallback) {
    var normalized = String(value || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return (normalized || fallback || 'unknown').slice(0, 100);
  }

  function firstPartyPayload(eventName, params, eventId) {
    var payload = {
      eventId: eventId,
      sessionId: getSessionId(),
      eventName: eventName,
      pagePath: window.location.pathname,
      deviceCategory: deviceCategory(),
      sourceCategory: attribution.sourceCategory || 'direct'
    };
    ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'].forEach(function (key) {
      if (attribution[key]) payload[key] = attribution[key];
    });
    if (params.section_id) payload.sectionId = safeName(params.section_id);
    if (params.cta_id) payload.ctaId = safeName(params.cta_id);
    if (typeof params.scroll_percent === 'number') payload.scrollPct = Math.max(0, Math.min(100, Math.round(params.scroll_percent)));
    if (params.error_code) payload.errorCode = safeName(params.error_code);
    return payload;
  }

  function sendFirstParty(payload, beacon) {
    var body = JSON.stringify(payload);
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(TRACK_URL, new Blob([body], { type: 'application/json' }));
      return;
    }
    if (window.fetch) {
      window.fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'same-origin'
      }).catch(function () {});
    }
  }

  function gaEventName(eventName) {
    return eventName === 'form_submit_success' ? 'generate_lead' : eventName;
  }

  function sendVendors(eventName, params, eventId) {
    if (!vendorConfig) {
      pendingVendorEvents.push([eventName, params, eventId]);
      return;
    }
    var vendorParams = Object.assign({}, params, {
      event_id: eventId,
      page_type: pageType,
      source_category: attribution.sourceCategory || 'direct'
    });
    if (!vendorConfig.gtmId && vendorConfig.ga4Id && typeof window.gtag === 'function') {
      window.gtag('event', gaEventName(eventName), vendorParams);
    }
    if (vendorConfig.metaPixelId && typeof window.fbq === 'function') {
      if (eventName === 'page_view') window.fbq('track', 'PageView', {}, { eventID: eventId });
      else if (eventName === 'landing_view') window.fbq('track', 'ViewContent', { content_name: CONTENT_NAME + ' landing' }, { eventID: eventId });
      else if (eventName === 'form_submit_success') window.fbq('track', 'Lead', { content_name: FORM_NAME }, { eventID: eventId });
      else window.fbq('trackCustom', eventName, vendorParams, { eventID: eventId });
    }
  }

  function track(eventName, params, options) {
    params = params || {};
    var eventId = uuid();
    var dataLayerEvent = Object.assign({}, params, {
      event: eventName,
      event_id: eventId,
      session_id: getSessionId(),
      page_path: window.location.pathname,
      page_type: pageType,
      source_category: attribution.sourceCategory || 'direct'
    });
    window.dataLayer.push(dataLayerEvent);
    sendFirstParty(firstPartyPayload(eventName, params, eventId), options && options.beacon);
    sendVendors(eventName, params, eventId);
    return eventId;
  }

  function loadScript(src, id) {
    if (id && document.getElementById(id)) return;
    var script = document.createElement('script');
    script.async = true;
    script.src = src;
    if (id) script.id = id;
    document.head.appendChild(script);
  }

  function configureVendors(config) {
    vendorConfig = config || {};
    if (vendorConfig.gtmId) {
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      loadScript('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(vendorConfig.gtmId), 'bait-gtm');
    } else if (vendorConfig.ga4Id) {
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', vendorConfig.ga4Id, { send_page_view: false });
      loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(vendorConfig.ga4Id), 'bait-ga4');
    }
    if (vendorConfig.metaPixelId) {
      if (!window.fbq) {
        var fbq = function () { if (fbq.callMethod) { fbq.callMethod.apply(fbq, arguments); } else { fbq.queue.push(arguments); } };
        fbq.queue = [];
        fbq.loaded = true;
        fbq.version = '2.0';
        window.fbq = fbq;
      }
      window.fbq('init', vendorConfig.metaPixelId);
      loadScript('https://connect.facebook.net/en_US/fbevents.js', 'bait-meta-pixel');
    }
    var queued = pendingVendorEvents.slice();
    pendingVendorEvents = [];
    queued.forEach(function (item) { sendVendors(item[0], item[1], item[2]); });
  }

  function loadVendorConfig() {
    if (!window.fetch) { configureVendors({}); return; }
    window.fetch(CONFIG_URL, { credentials: 'same-origin' })
      .then(function (response) { return response.ok ? response.json() : {}; })
      .then(configureVendors)
      .catch(function () { configureVendors({}); });
  }

  function effectiveActiveMs() {
    return activeMs + (activeSince === null ? 0 : Date.now() - activeSince);
  }

  function updateVisibility() {
    if (document.visibilityState === 'visible') {
      if (activeSince === null) activeSince = Date.now();
    } else if (activeSince !== null) {
      activeMs += Date.now() - activeSince;
      activeSince = null;
    }
  }

  function watchEngagement() {
    window.setInterval(function () {
      var seconds = Math.floor(effectiveActiveMs() / 1000);
      engagementMilestones.forEach(function (milestone) {
        if (seconds >= milestone && !engagementSent[milestone]) {
          engagementSent[milestone] = true;
          track('engagement_time', { engagement_time_msec: milestone * 1000, section_id: 'active_' + milestone + 's' });
        }
      });
    }, 1000);
  }

  function watchScroll() {
    var thresholds = [10, 25, 50, 75, 90, 100];
    var check = function () {
      var max = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight;
      var pct = max <= 0 ? 100 : Math.min(100, Math.round((window.scrollY / max) * 100));
      thresholds.forEach(function (threshold) {
        if (pct >= threshold && !scrollSent[threshold]) {
          scrollSent[threshold] = true;
          track('scroll_depth', { scroll_percent: threshold });
        }
      });
    };
    window.addEventListener('scroll', check, { passive: true });
    window.setTimeout(check, 250);
  }

  function assignSections() {
    var selectors = pageType === 'thank_you'
      ? (CFG.thankYouSections || ['.ty-card', '.ty-coupon-section', '.ty-benefits', '.ty-steps-grid', '.ty-cta-box', '.ty-footer'])
      : (CFG.landingSections || ['.lp-hero', '.lp-trust', '.lp-section', '.lp-final', '.lp-footer']);
    var count = 0;
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (element) {
        if (!element.getAttribute('data-analytics-section')) {
          count += 1;
          // Si la sección tiene id, se usa como nombre (p. ej. "inicio", "beneficios").
          element.setAttribute('data-analytics-section', element.id ? safeName(element.id) : pageType + '_section_' + count);
        }
      });
    });
  }

  function watchSections() {
    assignSections();
    if (!window.IntersectionObserver) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.getAttribute('data-analytics-section');
        if (entry.isIntersecting && id && !sectionSent[id]) {
          sectionSent[id] = true;
          track('section_view', { section_id: id });
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.35 });
    document.querySelectorAll('[data-analytics-section]').forEach(function (element) { observer.observe(element); });
  }

  function ctaId(element) {
    var explicit = element.getAttribute('data-analytics-cta');
    if (explicit) return safeName(explicit);
    var href = element.getAttribute('href') || '';
    if (/whatsapp\.com|wa\.me/.test(href)) return 'whatsapp';
    if (/^tel:/.test(href)) return 'phone';
    if (/^sms:/.test(href)) return 'sms';
    if (/^mailto:/.test(href)) return 'email';
    if (element.classList.contains('ty-coupon-screenshot-btn')) return 'share_coupon';
    if (element.closest && element.closest('.lp-final')) return 'final_form';
    if (element.getAttribute('data-pf-next') || /^pf-btn-/.test(element.id || '')) return 'form_next_' + (element.id || 'step');
    return safeName(element.id || element.name || 'generic_cta');
  }

  function watchClicks() {
    document.addEventListener('click', function (event) {
      var element = event.target.closest && event.target.closest('a,button,[data-analytics-cta]');
      if (!element || (element.closest && element.closest('#' + FORM_ID) && element.type === 'submit')) return;
      var id = ctaId(element);
      track('cta_click', { cta_id: id });
      var href = element.getAttribute('href');
      if (href) {
        try {
          var url = new URL(href, window.location.href);
          if (/^https?:$/.test(url.protocol) && url.hostname !== window.location.hostname) {
            track('outbound_click', { cta_id: id, link_domain: url.hostname });
          }
        } catch (_) {}
      }
      if (id === 'share_coupon') track('share', { cta_id: id, method: navigator.share ? 'web_share' : 'print' });
    });
    document.querySelectorAll('details.lp-faq-item').forEach(function (item, index) {
      item.addEventListener('toggle', function () {
        if (item.open) track('faq_open', { section_id: 'faq_' + (index + 1) });
      });
    });
  }

  function normalizedField(control) {
    return safeName((control.name || control.id || '').replace(/^portability_/, ''), 'unknown_field');
  }

  function fieldHasValue(control) {
    if (control.type === 'checkbox' || control.type === 'radio') return control.checked;
    return String(control.value || '').trim().length > 0;
  }

  function watchForm() {
    var form = document.getElementById(FORM_ID);
    if (!form) return;
    form.addEventListener('focusin', function (event) {
      var control = event.target;
      if (!control.matches || !control.matches('input,select,textarea')) return;
      var field = normalizedField(control);
      if (!formStarted) {
        formStarted = true;
        track('form_start', { form_id: FORM_NAME, form_step: currentStep });
      }
      if (!fieldStarted[field]) {
        fieldStarted[field] = true;
        track('form_field_started', { form_id: FORM_NAME, form_step: currentStep, field_name: field, section_id: 'field_' + field });
      }
    });
    form.addEventListener('focusout', function (event) {
      var control = event.target;
      if (!control.matches || !control.matches('input,select,textarea')) return;
      var field = normalizedField(control);
      if (fieldHasValue(control) && control.getAttribute('aria-invalid') !== 'true' && !fieldCompleted[field]) {
        fieldCompleted[field] = true;
        track('form_field_completed', { form_id: FORM_NAME, form_step: currentStep, field_name: field, section_id: 'field_' + field });
      }
    });
  }

  function endSession() {
    updateVisibility();
    if (formStarted && !formSubmitted) {
      track('form_abandoned', { form_id: FORM_NAME, form_step: currentStep, section_id: 'step_' + currentStep }, { beacon: true });
    }
    track('session_end', { engagement_time_msec: Math.round(effectiveActiveMs()), section_id: 'active_total' }, { beacon: true });
  }

  window.BaitAnalytics = {
    track: track,
    formStepView: function (step) {
      currentStep = Number(step) || 1;
      track('form_step_view', { form_id: FORM_NAME, form_step: currentStep, section_id: 'step_' + currentStep });
      track('form_step_' + currentStep + '_start', { form_id: FORM_NAME, form_step: currentStep, section_id: 'step_' + currentStep });
    },
    formStepCompleted: function (step) {
      track('form_step_completed', { form_id: FORM_NAME, form_step: Number(step), section_id: 'step_' + step });
    },
    formStepBack: function (fromStep, toStep) {
      currentStep = Number(toStep) || 1;
      track('form_step_back', { form_id: FORM_NAME, form_step: Number(fromStep), section_id: 'step_' + fromStep, destination_step: currentStep });
    },
    formError: function (step, field) {
      track('form_error', { form_id: FORM_NAME, form_step: Number(step), field_name: safeName(field), section_id: 'field_' + safeName(field), error_code: 'invalid_' + safeName(field) });
    },
    formSubmitted: function () {
      formSubmitted = true;
      track('form_submitted', { form_id: FORM_NAME, form_step: currentStep });
    },
    formResult: function (success, status) {
      if (success) {
        formSucceeded = true;
        storageSet(FORM_SUCCESS_KEY, '1');
        track('form_submit_success', { form_id: FORM_NAME, response_status: Number(status) || 200 });
      } else {
        track('form_submit_error', { form_id: FORM_NAME, error_code: 'downstream_rejected', response_status: Number(status) || 0 });
      }
    }
  };

  document.addEventListener('visibilitychange', updateVisibility);
  window.addEventListener('pagehide', endSession, { once: true });
  loadVendorConfig();
  watchEngagement();
  watchScroll();
  watchSections();
  watchClicks();
  watchForm();
  track('page_view', { page_title: document.title });
  track(pageType === 'thank_you' ? 'thank_you_view' : 'landing_view', {
    content_name: pageType === 'thank_you' ? CONTENT_NAME + ' gracias' : CONTENT_NAME + ' landing',
    confirmed_submission: pageType === 'thank_you' && storageGet(FORM_SUCCESS_KEY) === '1'
  });
})();
