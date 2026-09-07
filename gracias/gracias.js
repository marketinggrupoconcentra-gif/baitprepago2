(function () {
  'use strict';

  function safeRead(key) {
    try {
      return sessionStorage.getItem(key) || '';
    } catch (_) {
      return '';
    }
  }

  var name = safeRead('bait_lead_name').trim();
  var phone = safeRead('bait_lead_phone').replace(/\D/g, '').slice(-10);

  if (name) {
    var nameSpan = document.getElementById('thanks-customer-name');
    if (nameSpan) nameSpan.textContent = ', ' + name;
  }

  if (/^\d{10}$/.test(phone)) {
    var phoneRow = document.getElementById('thanks-phone-row');
    var phoneValue = document.getElementById('thanks-phone');
    if (phoneValue) phoneValue.textContent = '••••••' + phone.slice(-4);
    if (phoneRow) phoneRow.hidden = false;
  }

  try {
    sessionStorage.removeItem('bait_lead_name');
    sessionStorage.removeItem('bait_lead_phone');
  } catch (_) {}
})();
