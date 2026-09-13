(function () {
  'use strict';

  var STORAGE_KEY = 'bait_duplicate_process';
  var createdEl = document.getElementById('duplicate-created-at');
  var nameEl = document.getElementById('duplicate-registered-name');

  function formatDate(value) {
    if (!value) return 'No disponible';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No disponible';
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: 'long',
      day: '2-digit'
    }).format(date);
  }

  var data = null;
  try {
    data = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (_) {
    data = null;
  }

  if (createdEl) createdEl.textContent = formatDate(data && data.createdAt);
  if (nameEl) nameEl.textContent = data && data.registeredName ? data.registeredName : 'No disponible';
})();
