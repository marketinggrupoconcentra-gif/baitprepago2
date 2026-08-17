(function () {
  'use strict';

  var WHATSAPP_URL = 'https://api.whatsapp.com/send/?phone=5215548268533&text=%C2%A1Hola%21+Quiero+m%C3%A1s+informaci%C3%B3n&type=phone_number&app_absent=0';
  var header = document.querySelector('[data-header]');
  var menuButton = document.querySelector('.menu-toggle');
  var mobileMenu = document.getElementById('mobile-menu');

  function updateHeader() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 12);
  }

  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  if (menuButton && mobileMenu && header) {
    menuButton.addEventListener('click', function () {
      var open = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!open));
      menuButton.setAttribute('aria-label', open ? 'Abrir menú' : 'Cerrar menú');
      mobileMenu.hidden = open;
      header.classList.toggle('menu-open', !open);
    });

    mobileMenu.addEventListener('click', function (event) {
      if (!event.target.closest('a')) return;
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Abrir menú');
      mobileMenu.hidden = true;
      header.classList.remove('menu-open');
    });
  }

  var revealItems = document.querySelectorAll('.reveal');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach(function (item) { item.classList.add('is-visible'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px' });
    revealItems.forEach(function (item) { observer.observe(item); });
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

  var form = document.getElementById('portability-form');
  if (!form) return;

  var phone = document.getElementById('phone');
  var phoneConfirm = document.getElementById('phone-confirm');
  var nip = document.getElementById('nip');
  var consent = document.getElementById('consent');
  var status = document.getElementById('form-status');

  function setError(input, message) {
    var field = input.closest('.field');
    var error = document.getElementById(input.getAttribute('aria-describedby'));
    if (field) field.classList.toggle('has-error', Boolean(message));
    input.setAttribute('aria-invalid', String(Boolean(message)));
    if (error) error.textContent = message || '';
  }

  function validate() {
    var valid = true;
    var phoneValid = /^\d{10}$/.test(phone.value);
    var confirmValid = /^\d{10}$/.test(phoneConfirm.value);
    var nipValid = /^\d{4}$/.test(nip.value);

    setError(phone, phoneValid ? '' : 'Ingresa un número de 10 dígitos.');
    setError(phoneConfirm, !confirmValid ? 'Confirma el número con 10 dígitos.' : (phoneConfirm.value !== phone.value ? 'Los números no coinciden.' : ''));
    setError(nip, nipValid ? '' : 'Ingresa el NIP de 4 dígitos recibido por SMS.');

    if (!phoneValid || !confirmValid || phoneConfirm.value !== phone.value || !nipValid) valid = false;

    var consentError = document.getElementById('consent-error');
    if (consentError) consentError.textContent = consent.checked ? '' : 'Necesitamos tu autorización para continuar.';
    consent.setAttribute('aria-invalid', String(!consent.checked));
    if (!consent.checked) valid = false;

    return valid;
  }

  [phone, phoneConfirm, nip].forEach(function (input) {
    input.addEventListener('blur', validate);
  });

  consent.addEventListener('change', function () {
    var consentError = document.getElementById('consent-error');
    if (consentError) consentError.textContent = consent.checked ? '' : 'Necesitamos tu autorización para continuar.';
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    status.textContent = '';

    if (!validate()) {
      var firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    status.textContent = 'Datos validados. Abriendo WhatsApp para continuar…';
    window.location.assign(WHATSAPP_URL);
  });
})();
