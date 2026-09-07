/**
 * admin/settings.js
 * BAIT Prepago — Settings client
 *
 * Rules:
 * - No inline event handlers in HTML
 * - No localStorage / sessionStorage / IndexedDB
 * - No external libraries
 * - CSP safe: runs as type="module"
 */

// ── DOM refs ─────────────────────────────────────────────────────────
const appLoader       = document.getElementById('appLoader');
const app             = document.getElementById('app');
const sidebar         = document.getElementById('sidebar');
const sidebarOverlay  = document.getElementById('sidebarOverlay');
const hamburgerBtn    = document.getElementById('hamburgerBtn');
const userAvatar      = document.getElementById('userAvatar');
const userEmailEl     = document.getElementById('userEmail');
const userRoleEl      = document.getElementById('userRole');
const logoutBtn       = document.getElementById('logoutBtn');

const passwordForm    = document.getElementById('passwordForm');
const pwdAlertBox     = document.getElementById('pwdAlertBox');
const currentPassword = document.getElementById('currentPassword');
const newPassword     = document.getElementById('newPassword');
const confirmPassword = document.getElementById('confirmPassword');
const submitPwdBtn    = document.getElementById('submitPwdBtn');

const emailConfigState = document.getElementById('emailConfigState');
const emailOutboxBody  = document.getElementById('emailOutboxBody');

const reportsBody      = document.getElementById('reportsBody');
const newReportBtn     = document.getElementById('newReportBtn');
const createReportModal = document.getElementById('createReportModal');
const closeReportModalBtn = document.getElementById('closeReportModalBtn');
const cancelReportBtn  = document.getElementById('cancelReportBtn');
const createReportForm = document.getElementById('createReportForm');

// ── State ─────────────────────────────────────────────────────────────
let userObj = null;
let reportList = [];

// ── Helpers ───────────────────────────────────────────────────────────
function showMessage(msg, isError) {
  pwdAlertBox.style.display = 'block';
  pwdAlertBox.textContent = msg;
  if (isError) {
    pwdAlertBox.className = 'alert-box error';
  } else {
    pwdAlertBox.className = 'alert-box success';
  }
}

// ── Auth ──────────────────────────────────────────────────────────────
async function checkSession() {
  try {
    const res = await fetch('/api/admin/session', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.authenticated ? data.user : null;
  } catch {
    return null;
  }
}

// ── Settings Modules ──────────────────────────────────────────────────
async function loadEmailSettings() {
  if (userObj.role !== 'SUPER_ADMIN' && userObj.role !== 'ADMIN') {
    emailConfigState.innerHTML = '<p>No tienes permiso para ver esta sección.</p>';
    return;
  }

  try {
    const res = await fetch('/api/admin/settings/email', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    
    emailConfigState.innerHTML = `
      <p><strong>Modo:</strong> ${data.config.mode.toUpperCase()}</p>
      <p><strong>API Key:</strong> ${data.config.hasApiKey ? '<span style="color:var(--status-green)">Configurada</span>' : '<span style="color:var(--status-red)">Faltante</span>'}</p>
      <p><strong>Remitente:</strong> ${escHtml(data.config.fromAddress)}</p>
    `;

    const outbox = data.outbox;
    emailOutboxBody.innerHTML = Object.keys(outbox).map(status => `
      <tr>
        <td>${status}</td>
        <td>${outbox[status]}</td>
      </tr>
    `).join('') || '<tr><td colspan="2">Cola vacía</td></tr>';
  } catch (err) {
    emailConfigState.innerHTML = '<p>Error al cargar configuración.</p>';
  }
}

async function loadReports() {
  if (userObj.role !== 'SUPER_ADMIN' && userObj.role !== 'ADMIN') {
    reportsBody.innerHTML = '<tr><td colspan="5">Sin acceso</td></tr>';
    return;
  }

  try {
    const res = await fetch('/api/admin/reports/schedules', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    reportList = data.schedules || [];
    
    if (reportList.length === 0) {
      reportsBody.innerHTML = '<tr><td colspan="5">No hay reportes programados</td></tr>';
      return;
    }

    reportsBody.innerHTML = reportList.map(r => {
      const toggleAction = r.status === 'ACTIVE' 
        ? `<button class="btn-secondary toggle-report-btn" data-id="${r.id}" data-status="PAUSED">Pausar</button>`
        : `<button class="btn-primary toggle-report-btn" data-id="${r.id}" data-status="ACTIVE" style="padding: 4px 8px; font-size: 12px;">Activar</button>`;
      
      return `
        <tr>
          <td>${escHtml(r.name)}</td>
          <td>${escHtml(r.frequency)}</td>
          <td>${r.status === 'ACTIVE' ? escHtml(new Date(r.next_run_at).toLocaleString()) : '—'}</td>
          <td><span class="status-dot ${r.status === 'ACTIVE' ? 'active' : 'inactive'}"></span> ${r.status}</td>
          <td>${toggleAction}</td>
        </tr>
      `;
    }).join('');

    reportsBody.querySelectorAll('.toggle-report-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await fetch('/api/admin/reports/schedules', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: btn.dataset.id, status: btn.dataset.status })
          });
          loadReports();
        } catch (e) {
          alert('Error al cambiar estado');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    reportsBody.innerHTML = '<tr><td colspan="5">Error al cargar reportes</td></tr>';
  }
}

// ── Handlers ──────────────────────────────────────────────────────────
async function handlePasswordChange(e) {
  e.preventDefault();
  pwdAlertBox.style.display = 'none';

  const cpwd = currentPassword.value;
  const npwd = newPassword.value;
  const cpwd2 = confirmPassword.value;

  if (npwd !== cpwd2) {
    showMessage('La nueva contraseña y la confirmación no coinciden.', true);
    return;
  }

  if (npwd.length < 8) {
    showMessage('La nueva contraseña debe tener al menos 8 caracteres.', true);
    return;
  }

  submitPwdBtn.disabled = true;
  submitPwdBtn.textContent = 'Actualizando...';

  try {
    const res = await fetch('/api/admin/settings/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: cpwd,
        newPassword: npwd
      })
    });
    
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al cambiar la contraseña');
    }

    showMessage('Contraseña actualizada exitosamente. Redirigiendo al login...', false);
    passwordForm.reset();
    
    // Redirect after 2s because the server invalidated the session
    setTimeout(() => {
      window.location.href = '/admin/';
    }, 2000);

  } catch (err) {
    showMessage(err.message, true);
  } finally {
    submitPwdBtn.disabled = false;
    submitPwdBtn.textContent = 'Actualizar contraseña';
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────
function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('show');
  hamburgerBtn.setAttribute('aria-expanded', 'true');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
  hamburgerBtn.setAttribute('aria-expanded', 'false');
}

// ── Boot ──────────────────────────────────────────────────────────────
async function boot() {
  userObj = await checkSession();
  if (!userObj) {
    window.location.href = '/admin/';
    return;
  }

  // Populate user info
  userAvatar.textContent  = (userObj.email || '?').charAt(0).toUpperCase();
  userEmailEl.textContent = userObj.email;
  userRoleEl.textContent  = userObj.role;

  // Show app, hide loader
  app.style.display = 'flex';
  app.removeAttribute('aria-hidden');
  app.classList.add('visible');
  appLoader.classList.add('hidden');
  setTimeout(() => appLoader.style.display = 'none', 350);

  // Listeners
  passwordForm.addEventListener('submit', handlePasswordChange);

  if (userObj.role === 'SUPER_ADMIN' || userObj.role === 'ADMIN') {
    newReportBtn.addEventListener('click', () => {
      createReportForm.reset();
      createReportModal.showModal();
    });
    
    const closeReport = () => createReportModal.close();
    closeReportModalBtn.addEventListener('click', closeReport);
    cancelReportBtn.addEventListener('click', closeReport);

    createReportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitReportBtn');
      btn.disabled = true;
      try {
        await fetch('/api/admin/reports/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('reportName').value,
            frequency: document.getElementById('reportFrequency').value,
            status: 'ACTIVE'
          })
        });
        closeReport();
        loadReports();
      } catch (err) {
        alert('Error al crear reporte');
      } finally {
        btn.disabled = false;
      }
    });

    await loadEmailSettings();
    await loadReports();
  }

  logoutBtn.addEventListener('click', async () => {
    try { await fetch('/api/admin/logout', { method: 'POST' }); } catch {}
    window.location.href = '/admin/';
  });

  hamburgerBtn.addEventListener('click', openSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });
}

boot();
