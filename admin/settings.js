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

// ── State ─────────────────────────────────────────────────────────────
let userObj = null;

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

// ── Form Handlers ─────────────────────────────────────────────────────
async function handlePasswordSubmit(e) {
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
  passwordForm.addEventListener('submit', handlePasswordSubmit);

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
