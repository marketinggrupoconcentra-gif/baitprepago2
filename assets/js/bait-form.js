(function () {
  'use strict';

  var form = document.getElementById('lp-portability-form');
  if (!form) return;

  var isLocalPreview = window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    new URLSearchParams(window.location.search).get('demo') === '1';

  var config = Object.assign({
    apiUrl: 'https://intelix-api.grupoconcentra.com/api/framer-form-pospago-test',
    otpUrl: 'https://intelix-api.grupoconcentra.com/api/bait-otp/send',
    capturista: '89977',
    requestTimeout: 18000,
    otpCooldown: 120,
    captchaLifetime: 120000,
    demo: isLocalPreview
  }, window.BAIT_FORM_CONFIG || {});

  var steps = Array.prototype.slice.call(form.querySelectorAll('.lp-form-step'));
  var progress = document.getElementById('lp-progress');
  var progressBars = Array.prototype.slice.call(progress.querySelectorAll('span'));
  var stepMeta = document.getElementById('lp-step-meta');
  var stepPercent = document.getElementById('lp-step-percent');
  var formAlert = document.getElementById('lp-form-alert');
  var liveRegion = document.getElementById('lp-form-live');
  var shell = document.getElementById('lp-form-shell');
  var successPanel = document.getElementById('lp-form-success');
  var submitButton = document.getElementById('lp-submit-form');
  var otpButton = document.getElementById('lp-send-otp');
  var otpHelp = document.getElementById('lp-otp-help');
  var captchaChallenge = document.getElementById('lp-captcha-challenge');
  var captchaInput = document.getElementById('portability_captcha');
  var captchaVerify = document.getElementById('lp-captcha-verify');
  var captchaRefresh = document.getElementById('lp-captcha-refresh');
  var captchaStatus = document.getElementById('lp-captcha-status');
  var currentStep = 1;
  var otpTimer = null;
  var captchaTimer = null;
  var captcha = {
    answer: null,
    expiresAt: 0,
    id: '',
    verified: false,
    attempts: 0
  };

  var stepLabels = {
    1: 'Paso 1 de 3 · Portabilidad',
    2: 'Paso 2 de 3 · Tus datos',
    3: 'Paso 3 de 3 · Confirmación'
  };

  var fieldStep = {
    dn: 1,
    dn_confirm: 1,
    nip: 1,
    nip_confirm: 1,
    name: 2,
    lastname: 2,
    email: 2,
    birthdate: 2,
    state: 2,
    captcha: 3,
    acepta_contratacion: 3,
    acepta_aviso_privacidad: 3
  };

  function value(id) {
    var field = document.getElementById(id);
    return field ? field.value.trim() : '';
  }

  function announce(message) {
    liveRegion.textContent = '';
    window.setTimeout(function () {
      liveRegion.textContent = message;
    }, 20);
  }

  function showAlert(message) {
    formAlert.textContent = message;
    formAlert.hidden = false;
  }

  function hideAlert() {
    formAlert.textContent = '';
    formAlert.hidden = true;
  }

  function controlFor(field) {
    return document.getElementById('portability_' + field);
  }

  function errorFor(field) {
    return document.getElementById('portability_' + field + '-error');
  }

  function setError(field, message) {
    var control = controlFor(field);
    var error = errorFor(field);
    if (error) error.textContent = Array.isArray(message) ? message[0] : message;
    if (control) control.setAttribute('aria-invalid', 'true');
  }

  function clearError(field) {
    var control = controlFor(field);
    var error = errorFor(field);
    if (error) error.textContent = '';
    if (control) control.removeAttribute('aria-invalid');
  }

  function clearStepErrors(step) {
    Object.keys(fieldStep).forEach(function (field) {
      if (!step || fieldStep[field] === step) clearError(field);
    });
    hideAlert();
  }

  function focusFirstError(step) {
    var target = form.querySelector('[data-step="' + step + '"] [aria-invalid="true"]');
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function validateStep(step) {
    clearStepErrors(step);
    var ok = true;

    function fail(field, message) {
      setError(field, message);
      ok = false;
    }

    if (step === 1) {
      var dn = value('portability_dn');
      var dnConfirm = value('portability_dn_confirm');
      var nip = value('portability_nip');
      var nipConfirm = value('portability_nip_confirm');

      if (!/^\d{10}$/.test(dn)) fail('dn', 'Ingresa los 10 dígitos de tu número.');
      if (!dnConfirm) fail('dn_confirm', 'Confirma tu número.');
      else if (dn !== dnConfirm) fail('dn_confirm', 'Los números no coinciden.');
      if (!/^\d{4}$/.test(nip)) fail('nip', 'Ingresa los 4 dígitos de tu NIP.');
      if (!nipConfirm) fail('nip_confirm', 'Confirma tu NIP.');
      else if (nip !== nipConfirm) fail('nip_confirm', 'Los NIP no coinciden.');
    }

    if (step === 2) {
      if (!value('portability_name')) fail('name', 'Ingresa tu(s) nombre(s).');
      if (!value('portability_lastname')) fail('lastname', 'Ingresa tu(s) apellido(s).');
      var email = value('portability_email');
      if (!email) fail('email', 'Ingresa tu email.');
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('email', 'Ingresa un email válido.');
      if (!value('portability_birthdate')) fail('birthdate', 'Selecciona tu fecha de nacimiento.');
      if (!value('portability_state')) fail('state', 'Selecciona tu estado.');
    }

    if (step === 3) {
      if (!validateCaptcha(false)) ok = false;

      if (!document.getElementById('portability_acepta_contratacion').checked) {
        fail('acepta_contratacion', 'Debes aceptar la contratación de tu plan pospago para continuar.');
      }
      if (!document.getElementById('portability_acepta_aviso_privacidad').checked) {
        fail('acepta_aviso_privacidad', 'Debes aceptar el Aviso de Privacidad para continuar.');
      }
    }

    if (!ok) {
      showAlert('Revisa los campos marcados antes de continuar.');
      focusFirstError(step);
      announce('Hay errores en el paso ' + step + '. Revisa los campos marcados.');
    }
    return ok;
  }

  function goToStep(step, focusTitle) {
    currentStep = step;
    steps.forEach(function (section) {
      var active = Number(section.getAttribute('data-step')) === step;
      section.hidden = !active;
      section.classList.remove('is-entering');
      if (active) {
        void section.offsetWidth;
        section.classList.add('is-entering');
      }
    });

    progressBars.forEach(function (bar, index) {
      bar.classList.toggle('active', index < step);
      bar.classList.toggle('current', index === step - 1);
    });
    progress.setAttribute('aria-valuenow', String(step));
    stepMeta.textContent = stepLabels[step];
    stepPercent.textContent = Math.round((step / 3) * 100) + '%';
    hideAlert();

    if (step === 3) {
      document.getElementById('lp-summary-dn').textContent = value('portability_dn') || '—';
      if (!captcha.id || Date.now() >= captcha.expiresAt) generateCaptcha();
    }

    announce(stepLabels[step]);
    if (focusTitle !== false) {
      var heading = document.getElementById('lp-step-title-' + step);
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function randomInt(min, max) {
    if (window.crypto && window.crypto.getRandomValues) {
      var array = new Uint32Array(1);
      window.crypto.getRandomValues(array);
      return min + (array[0] % (max - min + 1));
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function challengeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return String(Date.now()) + '-' + String(randomInt(100000, 999999));
  }

  function updateCaptchaClock() {
    if (!captcha.id || captcha.verified) return;
    var remaining = Math.max(0, Math.ceil((captcha.expiresAt - Date.now()) / 1000));
    if (remaining <= 0) {
      captchaStatus.textContent = 'El reto expiró. Genera uno nuevo para continuar.';
      captchaStatus.classList.remove('is-valid');
      setError('captcha', 'El reto de seguridad expiró. Inténtalo de nuevo.');
      return;
    }
    var minutes = Math.floor(remaining / 60);
    var seconds = String(remaining % 60).padStart(2, '0');
    captchaStatus.textContent = 'El reto expira en ' + minutes + ':' + seconds + ' minutos.';
  }

  function generateCaptcha() {
    var first = randomInt(3, 12);
    var second = randomInt(1, 9);
    var subtract = randomInt(0, 1) === 1;
    if (subtract && second > first) {
      var swap = first;
      first = second;
      second = swap;
    }

    captcha.answer = subtract ? first - second : first + second;
    captcha.expiresAt = Date.now() + config.captchaLifetime;
    captcha.id = challengeId();
    captcha.verified = false;
    captcha.attempts = 0;
    captchaInput.value = '';
    captchaInput.disabled = false;
    captchaVerify.disabled = false;
    captchaChallenge.textContent = first + (subtract ? ' − ' : ' + ') + second + ' = ?';
    captchaChallenge.setAttribute('aria-label', '¿Cuánto es ' + first + (subtract ? ' menos ' : ' más ') + second + '?');
    captchaStatus.classList.remove('is-valid');
    clearError('captcha');
    updateCaptchaClock();
    if (captchaTimer) window.clearInterval(captchaTimer);
    captchaTimer = window.setInterval(updateCaptchaClock, 1000);
  }

  function validateCaptcha(announceResult) {
    clearError('captcha');
    if (!captcha.id || Date.now() >= captcha.expiresAt) {
      captcha.verified = false;
      setError('captcha', 'El reto de seguridad expiró. Genera uno nuevo.');
      captchaStatus.textContent = 'El reto expiró. Usa el botón de actualizar.';
      if (announceResult) announce('El reto de seguridad expiró.');
      return false;
    }
    if (!value('portability_captcha')) {
      setError('captcha', 'Completa la verificación de seguridad.');
      if (announceResult) announce('Escribe el resultado del reto de seguridad.');
      return false;
    }
    if (Number(value('portability_captcha')) !== captcha.answer) {
      captcha.verified = false;
      captcha.attempts += 1;
      setError('captcha', 'El resultado no es correcto. Inténtalo de nuevo.');
      captchaStatus.textContent = 'Verificación incorrecta. Puedes reintentar o generar otro reto.';
      if (announceResult) announce('El resultado del reto de seguridad no es correcto.');
      if (captcha.attempts >= 3) generateCaptcha();
      return false;
    }

    captcha.verified = true;
    captchaInput.disabled = true;
    captchaVerify.disabled = true;
    captchaStatus.textContent = 'Verificación correcta.';
    captchaStatus.classList.add('is-valid');
    if (captchaTimer) window.clearInterval(captchaTimer);
    if (announceResult) announce('Verificación de seguridad correcta.');
    return true;
  }

  function setOtpCooldown(seconds) {
    if (otpTimer) window.clearInterval(otpTimer);
    var remaining = Math.max(0, Math.ceil(seconds));

    function render() {
      if (remaining <= 0) {
        window.clearInterval(otpTimer);
        otpTimer = null;
        otpButton.disabled = false;
        otpButton.textContent = 'Reenviar código';
        return;
      }
      var minutes = Math.floor(remaining / 60);
      var secs = String(remaining % 60).padStart(2, '0');
      otpButton.disabled = true;
      otpButton.textContent = 'Reenviar en ' + minutes + ':' + secs;
      remaining -= 1;
    }

    render();
    otpTimer = window.setInterval(render, 1000);
  }

  async function postJson(url, payload) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, config.requestTimeout);
    try {
      var response = await window.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      var text = await response.text();
      var data = null;
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
      return { response: response, data: data };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function sendOtp() {
    clearError('otp');
    hideAlert();
    otpButton.disabled = true;
    otpButton.textContent = 'Enviando…';

    if (config.demo) {
      await new Promise(function (resolve) { window.setTimeout(resolve, 650); });
      otpHelp.innerHTML = '<i class="ti ti-circle-check" aria-hidden="true"></i><span>Código enviado. En esta vista de prueba usa <strong>123456</strong>.</span>';
      setOtpCooldown(30);
      announce('Código de prueba enviado. Usa 123456.');
      return;
    }

    try {
      var result = await postJson(config.otpUrl, {
        dn: value('portability_dn'),
        email: value('portability_email'),
        name: value('portability_name'),
        tipo: 'pospago'
      });
      if (result.response.ok && result.data && result.data.success) {
        otpHelp.innerHTML = '<i class="ti ti-circle-check" aria-hidden="true"></i><span>Código enviado. Revisa tus mensajes de WhatsApp.</span>';
        setOtpCooldown(result.data.expires_in || config.otpCooldown);
        announce('Código de verificación enviado.');
      } else {
        var message = result.data && result.data.message ? result.data.message : 'No se pudo enviar el código. Inténtalo de nuevo.';
        setError('otp', message);
        otpButton.disabled = false;
        otpButton.textContent = 'Obtener código vía WhatsApp';
        announce(message);
      }
    } catch (error) {
      var message = error && error.name === 'AbortError' ?
        'El envío tardó demasiado. Revisa tu conexión e inténtalo de nuevo.' :
        'Error de conexión al enviar el código.';
      setError('otp', message);
      otpButton.disabled = false;
      otpButton.textContent = 'Obtener código vía WhatsApp';
      announce(message);
    }
  }

  function payload() {
    return {
      dn: value('portability_dn'),
      dn_confirm: value('portability_dn_confirm'),
      imei: '',
      nip: value('portability_nip'),
      nip_confirm: value('portability_nip_confirm'),
      name: value('portability_name'),
      lastname: value('portability_lastname'),
      email: value('portability_email'),
      state: value('portability_state'),
      birthdate: value('portability_birthdate'),
      otp: '',
      acepta_contratacion: document.getElementById('portability_acepta_contratacion').checked,
      acepta_aviso_privacidad: document.getElementById('portability_acepta_aviso_privacidad').checked,
      capturista: config.capturista,
      captcha: value('portability_captcha'),
      captcha_token: captcha.id,
      captcha_verified: captcha.verified
    };
  }

  function firstServerErrorStep(messages) {
    var targetStep = 3;
    Object.keys(messages || {}).forEach(function (field) {
      if (fieldStep[field]) targetStep = Math.min(targetStep, fieldStep[field]);
    });
    return targetStep;
  }

  function applyServerErrors(messages) {
    Object.keys(messages || {}).forEach(function (field) {
      if (fieldStep[field]) setError(field, messages[field]);
    });
    var targetStep = firstServerErrorStep(messages);
    goToStep(targetStep, false);
    showAlert('El servidor encontró información que necesita corrección.');
    focusFirstError(targetStep);
    if (messages && messages.captcha) generateCaptcha();
  }

  function showSuccess() {
    try {
      sessionStorage.setItem('bait_lead_name', value('portability_name'));
      sessionStorage.setItem('bait_lead_dn', value('portability_dn'));
      sessionStorage.setItem('bait_lead_email', value('portability_email'));
      sessionStorage.setItem('bait_lead_state', value('portability_state'));
    } catch (_) {}
    if (window.dataLayer) {
      window.dataLayer.push({ event: 'Envio_formulario', form_type: 'portabilidad_pospago' });
    }
    var targetUrl = (window.location.protocol === 'file:') ? 'gracias/index.html' : 'gracias/';
    window.location.assign(targetUrl);
  }

  async function submitRequest(event) {
    event.preventDefault();
    if (!validateStep(3)) return;

    submitButton.disabled = true;
    submitButton.textContent = 'Guardando…';
    hideAlert();

    var targetUrl = (window.location.protocol === 'file:') ? 'gracias/index.html' : 'gracias/';

    try {
      sessionStorage.setItem('bait_lead_name', value('portability_name'));
      sessionStorage.setItem('bait_lead_dn', value('portability_dn'));
      sessionStorage.setItem('bait_lead_email', value('portability_email'));
      sessionStorage.setItem('bait_lead_state', value('portability_state'));
    } catch (_) {}

    var redirected = false;
    function finishAndRedirect() {
      if (redirected) return;
      redirected = true;
      if (window.dataLayer) {
        window.dataLayer.push({ event: 'Envio_formulario', form_type: 'portabilidad_pospago' });
      }
      window.location.assign(targetUrl);
    }

    var safetyTimer = window.setTimeout(finishAndRedirect, 1800);

    try {
      var leadPayload = payload();

      if (window.fetch) {
        window.fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: leadPayload.dn,
            nip: leadPayload.nip,
            nombre: leadPayload.name,
            apellido: leadPayload.lastname,
            email: leadPayload.email,
            state: leadPayload.state,
            birthdate: leadPayload.birthdate,
            tipo: 'pospago',
            consent: true,
            page_url: window.location.href,
            referrer: document.referrer || null
          }),
          keepalive: true
        }).catch(function () {});
      }

      if (config.apiUrl) {
        postJson(config.apiUrl, leadPayload)
          .then(function () {
            window.clearTimeout(safetyTimer);
            finishAndRedirect();
          })
          .catch(function () {
            window.clearTimeout(safetyTimer);
            finishAndRedirect();
          });
      } else {
        window.clearTimeout(safetyTimer);
        finishAndRedirect();
      }
    } catch (_) {
      window.clearTimeout(safetyTimer);
      finishAndRedirect();
    }
  }

  function resetForm() {
    form.reset();
    clearStepErrors();
    if (otpTimer) window.clearInterval(otpTimer);
    otpTimer = null;
    if (otpButton) {
      otpButton.disabled = false;
      otpButton.textContent = 'Obtener código vía WhatsApp';
    }
    if (otpHelp) {
      otpHelp.innerHTML = '<i class="ti ti-message" aria-hidden="true"></i><span>Te enviaremos un código de 6 dígitos al número a portar.</span>';
    }
    if (successPanel) successPanel.hidden = true;
    shell.hidden = false;
    generateCaptcha();
    goToStep(1);
  }

  form.querySelectorAll('[data-next]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (validateStep(currentStep)) goToStep(Number(button.getAttribute('data-next')));
    });
  });

  form.querySelectorAll('[data-prev]').forEach(function (button) {
    button.addEventListener('click', function () {
      goToStep(Number(button.getAttribute('data-prev')));
    });
  });

  ['portability_dn', 'portability_dn_confirm', 'portability_nip', 'portability_nip_confirm',
    'portability_captcha'].forEach(function (id) {
      var field = document.getElementById(id);
      if (!field) return;
      field.addEventListener('input', function () {
        var max = Number(field.getAttribute('maxlength')) || 20;
        field.value = field.value.replace(/\D/g, '').slice(0, max);
      });
    });

  Object.keys(fieldStep).forEach(function (field) {
    var control = controlFor(field);
    if (!control) return;
    var eventName = control.type === 'checkbox' || control.tagName === 'SELECT' ? 'change' : 'input';
    control.addEventListener(eventName, function () {
      clearError(field);
      if (field === 'captcha' && captcha.verified) {
        captcha.verified = false;
        captchaStatus.classList.remove('is-valid');
      }
    });
  });

  if (otpButton) {
    otpButton.addEventListener('click', sendOtp);
  }
  if (captchaVerify) {
    captchaVerify.addEventListener('click', function () {
      validateCaptcha(true);
    });
  }
  if (captchaRefresh) {
    captchaRefresh.addEventListener('click', function () {
      generateCaptcha();
      if (captchaInput) captchaInput.focus();
      announce('Se generó un nuevo reto de seguridad.');
    });
  }
  if (captchaInput) {
    captchaInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        validateCaptcha(true);
      }
    });
  }
  form.addEventListener('submit', submitRequest);
  var newReqBtn = document.getElementById('lp-new-request');
  if (newReqBtn) {
    newReqBtn.addEventListener('click', resetForm);
  }

  window.lpScrollToForm = function () {
    var card = document.getElementById('lp-form');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(function () {
      card.classList.add('pulsing');
      window.setTimeout(function () { card.classList.remove('pulsing'); }, 1800);
    }, 400);
  };

  generateCaptcha();
  goToStep(1, false);
})();
