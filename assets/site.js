(function () {
  'use strict';

  var BUSINESS_TIME_ZONE = 'America/Mexico_City';

  function todayCDMX() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var v = {};
    parts.forEach(function (p) { v[p.type] = p.value; });
    return v.year + '-' + v.month + '-' + v.day;
  }

  function addCivilDays(dateOnly, days) {
    var parts = dateOnly.split('-').map(Number);
    var ms = Date.UTC(parts[0], parts[1] - 1, parts[2]) + days * 86400000;
    var d = new Date(ms);
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  var header = document.querySelector('[data-header]');
  function updateHeader() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 12);
  }
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

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

  document.querySelectorAll('.faq-list details').forEach(function (detail) {
    detail.addEventListener('toggle', function () {
      if (!detail.open) return;
      document.querySelectorAll('.faq-list details').forEach(function (other) {
        if (other !== detail) other.open = false;
      });
    });
  });

  document.querySelectorAll('input[inputmode="numeric"]').forEach(function (input) {
    input.addEventListener('input', function () {
      input.value = input.value.replace(/\D/g, '').slice(0, Number(input.maxLength) || 99);
    });
  });

  var UTM_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid',
    'fbclid', 'fb_ad_id', 'fb_adset_id', 'fb_campaign_id'
  ];
  var SESSION_KEY = 'bait_utms';
  var DUPLICATE_SESSION_KEY = 'bait_duplicate_process';

  function captureUtms() {
    var params = new URLSearchParams(window.location.search);
    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch (_) { stored = {}; }
    UTM_KEYS.forEach(function (key) {
      var val = params.get(key);
      if (val) stored[key] = val;
    });
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored)); } catch (_) {}
    return stored;
  }

  function getUtms() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch (_) { return {}; }
  }
  captureUtms();

  var wrapper = document.getElementById('portability-form-wrapper');
  if (!wrapper) return;

  var step1 = document.getElementById('pf-step-1');
  var step2 = document.getElementById('pf-step-2');
  var step3 = document.getElementById('pf-step-3');
  var barFill = document.getElementById('pf-bar-fill');
  var stepLbl = document.getElementById('pf-step-label');
  var status = document.getElementById('form-status');
  var formData = {};

  var STEP_META = [
    { pct: '33%', label: 'PASO 1 DE 3 · TU NÚMERO' },
    { pct: '66%', label: 'PASO 2 DE 3 · TUS DATOS' },
    { pct: '100%', label: 'PASO 3 DE 3 · CONFIRMACIÓN' }
  ];

  function goTo(n) {
    [step1, step2, step3].forEach(function (s, i) { s.classList.toggle('pf-hidden', i + 1 !== n); });
    var m = STEP_META[n - 1];
    barFill.style.width = m.pct;
    stepLbl.textContent = m.label;
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

  function showErr(errId, msg) {
    var el = document.getElementById(errId);
    if (el) {
      el.textContent = msg;
      var field = el.closest('.field');
      if (field) field.classList.toggle('has-error', Boolean(msg));
    }
  }

  var nipInput = document.getElementById('pf-nip');
  var nipValidUntilWrap = document.getElementById('pf-nip-valid-until-field');
  var nipValidUntilInp = document.getElementById('pf-nip-valid-until');

  function nipMatchesPhoneLast4() {
    var phoneVal = document.getElementById('pf-phone').value;
    return /^\d{10}$/.test(phoneVal) && /^\d{4}$/.test(nipInput.value) && nipInput.value === phoneVal.slice(-4);
  }

  function updateNipValidUntilVisibility() {
    var show = nipMatchesPhoneLast4();
    if (nipValidUntilWrap) nipValidUntilWrap.classList.toggle('pf-hidden', !show);
    if (nipValidUntilInp) {
      nipValidUntilInp.required = show;
      if (!show) {
        nipValidUntilInp.value = '';
        clearErr('pf-nip-valid-until');
      } else {
        var today = todayCDMX();
        nipValidUntilInp.min = today;
        nipValidUntilInp.max = addCivilDays(today, 5);
      }
    }
  }

  nipInput.addEventListener('input', updateNipValidUntilVisibility);
  document.getElementById('pf-phone').addEventListener('input', updateNipValidUntilVisibility);

  step1.addEventListener('submit', function (e) {
    e.preventDefault();
    var phone = document.getElementById('pf-phone');
    var confirm = document.getElementById('pf-phone-confirm');
    var nip = nipInput;
    var nipConfirm = document.getElementById('pf-nip-confirm');
    var valid = true;

    if (!/^\d{10}$/.test(phone.value)) { fieldErr('pf-phone', 'Ingresa un número de 10 dígitos.'); valid = false; } else clearErr('pf-phone');
    if (!/^\d{10}$/.test(confirm.value)) { fieldErr('pf-phone-confirm', 'Confirma el número con 10 dígitos.'); valid = false; }
    else if (confirm.value !== phone.value) { fieldErr('pf-phone-confirm', 'Los números no coinciden.'); valid = false; } else clearErr('pf-phone-confirm');
    if (!/^\d{4}$/.test(nip.value)) { fieldErr('pf-nip', 'Ingresa el NIP de 4 dígitos recibido por SMS al 051.'); valid = false; } else clearErr('pf-nip');
    if (!/^\d{4}$/.test(nipConfirm.value)) { fieldErr('pf-nip-confirm', 'Confirma el NIP con los 4 dígitos.'); valid = false; }
    else if (nipConfirm.value !== nip.value) { fieldErr('pf-nip-confirm', 'Los NIP no coinciden.'); valid = false; } else clearErr('pf-nip-confirm');

    var nipValidUntil = null;
    if (valid && nipMatchesPhoneLast4()) {
      var today = todayCDMX();
      var max = addCivilDays(today, 5);
      var val = nipValidUntilInp.value;
      if (!val) { fieldErr('pf-nip-valid-until', 'Ingresa la fecha de vigencia del NIP.'); valid = false; }
      else if (val < today || val > max) { fieldErr('pf-nip-valid-until', 'La vigencia debe estar entre hoy y los próximos 5 días naturales.'); valid = false; }
      else { clearErr('pf-nip-valid-until'); nipValidUntil = val; }
    }

    if (!valid) { step1.querySelector('[aria-invalid="true"]').focus(); return; }
    formData.phone = phone.value;
    formData.nip = nip.value;
    formData.nipValidUntil = nipValidUntil;
    goTo(2);
  });

  document.getElementById('pf-back-2').addEventListener('click', function () { goTo(1); });
  document.getElementById('pf-back-3').addEventListener('click', function () { goTo(2); });

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  step2.addEventListener('submit', function (e) {
    e.preventDefault();
    var nombre = document.getElementById('pf-nombre');
    var apellido = document.getElementById('pf-apellido');
    var email = document.getElementById('pf-email');
    var valid = true;

    if (!nombre.value.trim()) { fieldErr('pf-nombre', 'Ingresa tu(s) nombre(s).'); valid = false; } else clearErr('pf-nombre');
    if (!apellido.value.trim()) { fieldErr('pf-apellido', 'Ingresa tu(s) apellido(s).'); valid = false; } else clearErr('pf-apellido');
    var emailVal = email.value.trim();
    if (!emailVal || /\s/.test(emailVal) || emailVal.length > 254 || !EMAIL_RE.test(emailVal)) {
      fieldErr('pf-email', 'Ingresa un correo electrónico válido. Aquí recibirás tu cupón BAIT.'); valid = false;
    } else clearErr('pf-email');
    if (!valid) { step2.querySelector('[aria-invalid="true"]').focus(); return; }

    formData.nombre = nombre.value.trim();
    formData.apellido = apellido.value.trim();
    formData.email = emailVal.toLowerCase();
    var summaryPhone = document.getElementById('pf-summary-phone');
    if (summaryPhone) summaryPhone.textContent = formData.phone;
    goTo(3);
    requestCaptchaChallenge();
  });

  var captchaChallengeId = null;
  var captchaImgEl = document.getElementById('pf-captcha-img-el');

  function requestCaptchaChallenge() {
    var inp = document.getElementById('pf-captcha-input');
    if (inp) inp.value = '';
    showErr('pf-captcha-error', '');
    captchaChallengeId = null;
    if (captchaImgEl) captchaImgEl.removeAttribute('src');
    return fetch('/api/captcha/challenge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    }).then(function (res) {
      if (!res.ok) throw new Error('captcha_challenge_failed');
      return res.json();
    }).then(function (data) {
      captchaChallengeId = data.challengeId;
      if (captchaImgEl) captchaImgEl.src = data.image;
    }).catch(function () {
      showErr('pf-captcha-error', 'No se pudo generar el código de seguridad. Intenta de nuevo.');
    });
  }

  var captchaImg = document.getElementById('pf-captcha-img');
  var captchaRefresh = document.getElementById('pf-captcha-refresh');
  if (captchaImg) captchaImg.addEventListener('click', requestCaptchaChallenge);
  if (captchaRefresh) captchaRefresh.addEventListener('click', requestCaptchaChallenge);

  var CAPTCHA_ERROR_MESSAGES = {
    captcha_required: 'Ingresa el código de seguridad.',
    captcha_invalid: 'El código no coincide. Intenta de nuevo.',
    captcha_expired: 'El código expiró. Generamos uno nuevo.',
    captcha_used: 'Ese código ya fue usado. Generamos uno nuevo.'
  };

  step3.addEventListener('submit', function (e) {
    e.preventDefault();
    var captchaInput = document.getElementById('pf-captcha-input');
    var consent = document.getElementById('pf-consent');
    var valid = true;

    if (!captchaChallengeId || !/^\d{6}$/.test(captchaInput.value)) {
      showErr('pf-captcha-error', 'Ingresa los 6 dígitos del código de seguridad.');
      captchaInput.setAttribute('aria-invalid', 'true'); valid = false;
    } else { showErr('pf-captcha-error', ''); captchaInput.setAttribute('aria-invalid', 'false'); }

    var consentErr = document.getElementById('pf-consent-error');
    if (!consent.checked) {
      if (consentErr) consentErr.textContent = 'Necesitas aceptar el Aviso de Privacidad para continuar.';
      consent.setAttribute('aria-invalid', 'true'); valid = false;
    } else {
      if (consentErr) consentErr.textContent = '';
      consent.setAttribute('aria-invalid', 'false');
    }
    if (!valid) return;

    var submitBtn = document.getElementById('pf-btn-3');
    if (submitBtn) submitBtn.disabled = true;
    if (status) status.textContent = 'Enviando solicitud…';

    var utms = getUtms();
    var payload = {
      phone: formData.phone,
      nip: formData.nip,
      nip_valid_until: formData.nipValidUntil,
      nombre: formData.nombre,
      apellido: formData.apellido,
      email: formData.email,
      consent: true,
      captcha_challenge_id: captchaChallengeId,
      captcha_answer: captchaInput.value,
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (res) {
      if (res.ok) return { ok: true, status: res.status };
      return res.json().catch(function () { return {}; }).then(function (body) {
        return {
          ok: false,
          status: res.status,
          error: body.error,
          code: body.code,
          details: body.details || [],
          duplicate: body.duplicate || null
        };
      });
    }).then(function (result) {
      if (submitBtn) submitBtn.disabled = false;

      if (!result.ok) {
        if (result.status === 409 && result.error === 'duplicate_lead') {
          try {
            sessionStorage.removeItem('bait_lead_name');
            sessionStorage.removeItem('bait_lead_phone');
            sessionStorage.setItem(DUPLICATE_SESSION_KEY, JSON.stringify({
              createdAt: result.duplicate && result.duplicate.createdAt ? result.duplicate.createdAt : null,
              registeredName: result.duplicate && result.duplicate.registeredName ? result.duplicate.registeredName : 'No disponible'
            }));
          } catch (_) {}
          window.location.assign('/duplicado/');
          return;
        }

        var captchaError = result.details.filter(function (code) {
          return Object.prototype.hasOwnProperty.call(CAPTCHA_ERROR_MESSAGES, code);
        })[0];
        if (captchaError) {
          showErr('pf-captcha-error', CAPTCHA_ERROR_MESSAGES[captchaError]);
          captchaInput.setAttribute('aria-invalid', 'true');
          requestCaptchaChallenge();
        } else if (status) {
          status.textContent = 'No pudimos validar tu solicitud. Revisa tus datos e intenta de nuevo.';
        }
        return;
      }

      try {
        sessionStorage.removeItem(DUPLICATE_SESSION_KEY);
        sessionStorage.setItem('bait_lead_name', formData.nombre || '');
        sessionStorage.setItem('bait_lead_phone', formData.phone || '');
      } catch (_) {}
      window.location.assign('/gracias/');
    }).catch(function () {
      if (submitBtn) submitBtn.disabled = false;
      if (status) status.textContent = 'No pudimos conectar con el servidor. Intenta de nuevo.';
    });
  });
})();
