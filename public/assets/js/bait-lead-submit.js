(function () {
  'use strict';

  var form = document.getElementById('lp-portability-form');
  if (!form) return;
  var config = Object.assign({ apiUrl: '/api/v1/leads', requestTimeout: 18000 }, window.BAIT_FORM_CONFIG || {});
  var submitButton = document.getElementById('lp-submit-form');
  var formAlert = document.getElementById('lp-form-alert');
  var formStartedAt = Date.now();
  var idempotencyKey = uuid();
  var sessionId = readSessionId();

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return Array.prototype.map.call(bytes, function (b) {
      return (b + 256).toString(16).slice(1);
    }).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  function readSessionId() {
    try {
      var stored = sessionStorage.getItem('bait_analytics_session_id');
      if (stored && /^[0-9a-f-]{36}$/i.test(stored)) return stored;
    } catch (_) {}
    return uuid();
  }

  function value(id) {
    var element = document.getElementById(id);
    return element ? String(element.value || '').trim() : '';
  }

  function setAlert(message) {
    if (formAlert) { formAlert.textContent = message; formAlert.hidden = false; }
    var live = document.getElementById('lp-form-live');
    if (live) live.textContent = message;
  }

  function setFieldError(field, message) {
    var input = document.getElementById('portability_' + field);
    var error = document.getElementById('portability_' + field + '-error');
    if (input) input.setAttribute('aria-invalid', 'true');
    if (error) error.textContent = message;
  }

  function analytics(method) {
    if (!window.BaitAnalytics || typeof window.BaitAnalytics[method] !== 'function') return;
    window.BaitAnalytics[method].apply(window.BaitAnalytics, Array.prototype.slice.call(arguments, 1));
  }

  async function postJson(url, body) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, config.requestTimeout);
    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      var data = await response.json().catch(function () { return {}; });
      return { response: response, data: data };
    } finally { window.clearTimeout(timeout); }
  }

  function stateCode() {
    var codes = ['AG', 'BC', 'BS', 'CM', 'CO', 'CL', 'CS', 'CH', 'DF', 'DG', 'GT', 'GR', 'HG', 'JC', 'MC', 'MN', 'MS', 'NT', 'NL', 'OA', 'PU', 'QT', 'QR', 'SL', 'SI', 'SO', 'TB', 'TM', 'TL', 'VZ', 'YN', 'ZS'];
    return codes[Number(value('portability_state')) - 1] || '';
  }

  function leadPayload() {
    return {
      phone: value('portability_dn'),
      phone_confirm: value('portability_dn_confirm'),
      nip: value('portability_nip'),
      nip_confirm: value('portability_nip_confirm'),
      first_name: value('portability_name'),
      last_name: value('portability_lastname'),
      email: value('portability_email'),
      birthdate: value('portability_birthdate'),
      state: stateCode(),
      contracting_accepted: document.getElementById('portability_acepta_contratacion').checked,
      privacy_accepted: document.getElementById('portability_acepta_aviso_privacidad').checked,
      website: '',
      form_started_at: formStartedAt,
      idempotency_key: idempotencyKey,
      session_id: sessionId,
      landing_url: window.location.href,
      referrer: document.referrer || undefined
    };
  }

  function showFirstStep() {
    var firstStep = form.querySelector('[data-step="1"]');
    form.querySelectorAll('.lp-form-step').forEach(function (step) { step.hidden = step !== firstStep; });
    var progress = document.getElementById('lp-progress');
    if (progress) progress.setAttribute('aria-valuenow', '1');
    var meta = document.getElementById('lp-step-meta');
    var percent = document.getElementById('lp-step-percent');
    if (meta) meta.textContent = 'Paso 1 de 3 · Portabilidad';
    if (percent) percent.textContent = '33%';
  }

  function showDuplicate() {
    var message = 'Este número ya está registrado. No se creó una nueva solicitud.';
    showFirstStep();
    setFieldError('dn', message);
    setAlert(message);
    var phone = document.getElementById('portability_dn');
    if (phone) { phone.focus({ preventScroll: true }); phone.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    analytics('formResult', false, 409);
  }

  async function submit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!document.getElementById('lp-captcha-status').classList.contains('is-valid')) {
      setFieldError('captcha', 'Completa la verificación de seguridad.');
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Guardando…';
    analytics('formSubmitted');
    try {
      var result = await postJson(config.apiUrl, leadPayload());
      if (result.response.status === 409 && result.data.code === 'PHONE_ALREADY_REGISTERED') {
        showDuplicate();
        return;
      }
      if (!result.response.ok) {
        analytics('formResult', false, result.response.status);
        setAlert(result.data.error || 'No pudimos guardar tu solicitud. Inténtalo de nuevo.');
        return;
      }
      analytics('formResult', true, result.response.status);
      try {
        sessionStorage.setItem('bait_lead_name', value('portability_name'));
        sessionStorage.setItem('bait_lead_dn', value('portability_dn'));
        sessionStorage.setItem('bait_lead_email', value('portability_email'));
        sessionStorage.setItem('bait_lead_state', value('portability_state'));
      } catch (_) {}
      
      window.location.assign(window.location.protocol === 'file:' ? 'gracias/index.html' : 'gracias/');
    } catch (error) {
      analytics('formResult', false, 0);
      setAlert(error && error.name === 'AbortError'
        ? 'El envío tardó demasiado. Inténtalo de nuevo.'
        : 'Error de conexión. Verifica tu internet e intenta de nuevo.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Acepto y contrato mi plan pospago';
    }
  }

  form.addEventListener('submit', submit, true);
})();
