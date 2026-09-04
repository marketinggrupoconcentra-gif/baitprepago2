(function () {
  'use strict';

  var WHATSAPP_URL = 'https://api.whatsapp.com/send/?phone=5215548268533&text=%C2%A1Hola%21+Quiero+m%C3%A1s+informaci%C3%B3n&type=phone_number&app_absent=0';

  /* ── Scroll / header ── */
  var header = document.querySelector('[data-header]');
  function updateHeader() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 12);
  }
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  /* ── Reveal on scroll ── */
  var revealItems = document.querySelectorAll('.reveal');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px' });
    revealItems.forEach(function (el) { observer.observe(el); });
  }

  /* ── FAQ accordion ── */
  document.querySelectorAll('.faq-list details').forEach(function (detail) {
    detail.addEventListener('toggle', function () {
      if (!detail.open) return;
      document.querySelectorAll('.faq-list details').forEach(function (other) {
        if (other !== detail) other.open = false;
      });
    });
  });

  /* ── Numeric-only inputs ── */
  document.querySelectorAll('input[inputmode="numeric"]').forEach(function (input) {
    input.addEventListener('input', function () {
      input.value = input.value.replace(/\D/g, '').slice(0, Number(input.maxLength) || 99);
    });
  });

  /* ── UTM Capture ── */
  var UTM_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid',
    'fbclid', 'fb_ad_id', 'fb_adset_id', 'fb_campaign_id'
  ];
  var SESSION_KEY = 'bait_utms';

  function captureUtms() {
    var params = new URLSearchParams(window.location.search);
    var stored = {};
    try {
      stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    } catch (_) {
      stored = {};
    }
    UTM_KEYS.forEach(function (key) {
      var val = params.get(key);
      if (val) stored[key] = val;
    });
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    } catch (_) {}
    return stored;
  }

  function getUtms() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }
  captureUtms();

  /* ================================================================
     MULTI-STEP PORTABILITY FORM
     ================================================================ */
  var wrapper = document.getElementById('portability-form-wrapper');
  if (!wrapper) return;

  /* Elements */
  var step1   = document.getElementById('pf-step-1');
  var step2   = document.getElementById('pf-step-2');
  var step3   = document.getElementById('pf-step-3');
  var barFill = document.getElementById('pf-bar-fill');
  var stepLbl = document.getElementById('pf-step-label');
  var status  = document.getElementById('form-status');

  /* Stored data */
  var formData = {};

  /* ── Step labels ── */
  var STEP_META = [
    { pct: '33%',  label: 'PASO 1 DE 3 · TU NÚMERO'    },
    { pct: '66%',  label: 'PASO 2 DE 3 · TUS DATOS'     },
    { pct: '100%', label: 'PASO 3 DE 3 · CONFIRMACIÓN'  },
  ];

  function goTo(n) {
    [step1, step2, step3].forEach(function (s, i) {
      s.classList.toggle('pf-hidden', i + 1 !== n);
    });
    var m = STEP_META[n - 1];
    barFill.style.width = m.pct;
    stepLbl.textContent = m.label;
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Generic error helpers ── */
  function fieldErr(inputId, msg) {
    var input = document.getElementById(inputId);
    var errEl = document.getElementById(inputId + '-error');
    if (!input) return;
    var field = input.closest('.field');
    if (field) field.classList.toggle('has-error', Boolean(msg));
    input.setAttribute('aria-invalid', String(Boolean(msg)));
    if (errEl) errEl.textContent = msg || '';
  }

  function clearErr(inputId) { fieldErr(inputId, ''); }

  /* ── Inline error display (for non-standard error ids) ── */
  function showErr(errId, msg) {
    var el = document.getElementById(errId);
    if (el) {
      el.textContent = msg;
      var field = el.closest('.field');
      if (field) field.classList.toggle('has-error', Boolean(msg));
    }
  }

  /* ==============================
     STEP 1 — Phone + NIP + Confirm NIP
  ============================== */
  step1.addEventListener('submit', function (e) {
    e.preventDefault();
    var phone      = document.getElementById('pf-phone');
    var confirm    = document.getElementById('pf-phone-confirm');
    var nip        = document.getElementById('pf-nip');
    var nipConfirm = document.getElementById('pf-nip-confirm');
    var valid      = true;

    if (!/^\d{10}$/.test(phone.value)) {
      fieldErr('pf-phone', 'Ingresa un número de 10 dígitos.'); valid = false;
    } else { clearErr('pf-phone'); }

    if (!/^\d{10}$/.test(confirm.value)) {
      fieldErr('pf-phone-confirm', 'Confirma el número con 10 dígitos.'); valid = false;
    } else if (confirm.value !== phone.value) {
      fieldErr('pf-phone-confirm', 'Los números no coinciden.'); valid = false;
    } else { clearErr('pf-phone-confirm'); }

    if (!/^\d{4}$/.test(nip.value)) {
      fieldErr('pf-nip', 'Ingresa el NIP de 4 dígitos recibido por SMS al 051.'); valid = false;
    } else { clearErr('pf-nip'); }

    if (!/^\d{4}$/.test(nipConfirm.value)) {
      fieldErr('pf-nip-confirm', 'Confirma el NIP con los 4 dígitos.'); valid = false;
    } else if (nipConfirm.value !== nip.value) {
      fieldErr('pf-nip-confirm', 'Los NIP no coinciden.'); valid = false;
    } else { clearErr('pf-nip-confirm'); }

    if (!valid) { step1.querySelector('[aria-invalid="true"]').focus(); return; }

    formData.phone = phone.value;
    formData.nip   = nip.value;
    goTo(2);
  });

  /* ── Back buttons ── */
  document.getElementById('pf-back-2').addEventListener('click', function () { goTo(1); });
  document.getElementById('pf-back-3').addEventListener('click', function () { goTo(2); });

  /* ==============================
     STEP 2 — Personal data
  ============================== */
  step2.addEventListener('submit', function (e) {
    e.preventDefault();
    var nombre   = document.getElementById('pf-nombre');
    var apellido = document.getElementById('pf-apellido');
    var valid    = true;

    if (!nombre.value.trim()) {
      fieldErr('pf-nombre', 'Ingresa tu(s) nombre(s).'); valid = false;
    } else { clearErr('pf-nombre'); }

    if (!apellido.value.trim()) {
      fieldErr('pf-apellido', 'Ingresa tu(s) apellido(s).'); valid = false;
    } else { clearErr('pf-apellido'); }

    if (!valid) { step2.querySelector('[aria-invalid="true"]').focus(); return; }

    formData.nombre   = nombre.value.trim();
    formData.apellido = apellido.value.trim();

    /* Update summary in step 3 */
    var summaryPhone = document.getElementById('pf-summary-phone');
    if (summaryPhone) summaryPhone.textContent = formData.phone;

    goTo(3);
    generateCaptcha();
  });

  /* ==============================
     CAPTCHA (canvas-based)
  ============================== */
  var captchaCode = '';

  function generateCaptcha() {
    var chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    captchaCode = '';
    for (var i = 0; i < 6; i++) {
      captchaCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    var container = document.getElementById('pf-captcha-img');
    if (!container) return;
    container.innerHTML = '';

    var canvas = document.createElement('canvas');
    canvas.width  = 240;
    canvas.height = 68;
    container.appendChild(canvas);

    var ctx = canvas.getContext('2d');

    /* Background */
    ctx.fillStyle = '#f8f8f4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    /* Noise lines */
    for (var n = 0; n < 8; n++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
      ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
      ctx.strokeStyle = 'rgba(' + [
        Math.floor(Math.random()*180),
        Math.floor(Math.random()*180),
        Math.floor(Math.random()*180)
      ].join(',') + ',.5)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    /* Dots */
    for (var d = 0; d < 40; d++) {
      ctx.beginPath();
      ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.15)';
      ctx.fill();
    }

    /* Letters */
    var colors = ['#1a237e','#880e4f','#1b5e20','#e65100','#4a148c','#006064'];
    var xStep  = canvas.width / (captchaCode.length + 1);
    for (var c = 0; c < captchaCode.length; c++) {
      ctx.save();
      ctx.font = 'bold ' + (24 + Math.random() * 8) + 'px monospace';
      ctx.fillStyle = colors[c % colors.length];
      var x = xStep * (c + 1);
      var y = 40 + (Math.random() * 14 - 7);
      ctx.translate(x, y);
      ctx.rotate((Math.random() - 0.5) * 0.5);
      ctx.fillText(captchaCode[c], 0, 0);
      ctx.restore();
    }

    /* Clear captcha input */
    var inp = document.getElementById('pf-captcha-input');
    if (inp) inp.value = '';
    showErr('pf-captcha-error', '');
  }

  /* Click on captcha image or refresh button → regenerate */
  var captchaImg = document.getElementById('pf-captcha-img');
  var captchaRefresh = document.getElementById('pf-captcha-refresh');
  if (captchaImg) captchaImg.addEventListener('click', generateCaptcha);
  if (captchaRefresh) captchaRefresh.addEventListener('click', generateCaptcha);

  /* ── "Get code via WhatsApp" button ── */
  var getWaCodeBtn = document.getElementById('pf-get-wa-code');
  if (getWaCodeBtn) {
    getWaCodeBtn.addEventListener('click', function () {
      var msg = encodeURIComponent('¡Hola! Necesito mi código de verificación para portar el número ' + (formData.phone || ''));
      window.open('https://api.whatsapp.com/send/?phone=5215548268533&text=' + msg + '&type=phone_number&app_absent=0', '_blank');
    });
  }

  /* ==============================
     STEP 3 — Confirm & submit
  ============================== */
  step3.addEventListener('submit', function (e) {
    e.preventDefault();
    var captchaInput = document.getElementById('pf-captcha-input');
    var waCode       = document.getElementById('pf-wa-code');
    var consent      = document.getElementById('pf-consent');
    var valid        = true;

    /* Captcha */
    if (!captchaInput.value || captchaInput.value.toUpperCase() !== captchaCode) {
      showErr('pf-captcha-error', 'El código no coincide. Intenta de nuevo.');
      captchaInput.setAttribute('aria-invalid', 'true');
      generateCaptcha();
      valid = false;
    } else {
      showErr('pf-captcha-error', '');
      captchaInput.setAttribute('aria-invalid', 'false');
    }

    /* WA verification code */
    if (!/^\d{6}$/.test(waCode.value)) {
      showErr('pf-wa-code-error', 'Ingresa el código de 6 dígitos.');
      waCode.setAttribute('aria-invalid', 'true');
      valid = false;
    } else {
      showErr('pf-wa-code-error', '');
      waCode.setAttribute('aria-invalid', 'false');
    }

    /* Consent */
    var consentErr = document.getElementById('pf-consent-error');
    if (!consent.checked) {
      if (consentErr) consentErr.textContent = 'Necesitas aceptar el Aviso de Privacidad para continuar.';
      consent.setAttribute('aria-invalid', 'true');
      valid = false;
    } else {
      if (consentErr) consentErr.textContent = '';
      consent.setAttribute('aria-invalid', 'false');
    }

    if (!valid) return;

    /* Guardar lead en la base de datos para seguimiento y panel admin */
    try {
      var utms = getUtms();
      var payload = {
        phone: formData.phone,
        nip: formData.nip,
        nombre: formData.nombre,
        apellido: formData.apellido,
        consent: true,
        utm_source: utms.utm_source || null,
        utm_medium: utms.utm_medium || null,
        utm_campaign: utms.utm_campaign || null,
        utm_content: utms.utm_content || null,
        utm_term: utms.utm_term || null,
        gclid: utms.gclid || null,
        fbclid: utms.fbclid || null,
        fb_ad_id: utms.fb_ad_id || null,
        fb_adset_id: utms.fb_adset_id || null,
        fb_campaign_id: utms.fb_campaign_id || null,
        referrer: document.referrer || null,
        page_url: window.location.href
      };

      fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (_) {}

    /* All good → redirect to WhatsApp */
    var msg = encodeURIComponent(
      '¡Hola! Quiero continuar mi portabilidad.\n' +
      'Número a portar: ' + formData.phone + '\n' +
      'NIP: ' + formData.nip + '\n' +
      'Nombre: ' + formData.nombre + ' ' + formData.apellido + '\n' +
      'Código verificación: ' + waCode.value
    );
    if (status) status.textContent = 'Datos validados. Abriendo WhatsApp para continuar…';
    window.location.assign('https://api.whatsapp.com/send/?phone=5215548268533&text=' + msg + '&type=phone_number&app_absent=0');
  });

})();
