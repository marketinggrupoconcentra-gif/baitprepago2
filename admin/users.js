/**
 * admin/users.js
 * BAIT Prepago — Users client
 *
 * Rules:
 * - No inline event handlers in HTML
 * - No localStorage / sessionStorage / IndexedDB
 * - No external libraries
 * - CSP safe: runs as type="module"
 */

const TZ     = 'America/Mexico_City';
const LOCALE = 'es-MX';

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
const statusLive      = document.getElementById('statusLive');

const usersBody       = document.getElementById('usersBody');
const newUserBtn      = document.getElementById('newUserBtn');

// Modals
const createUserModal = document.getElementById('createUserModal');
const closeCreateModalBtn = document.getElementById('closeCreateModalBtn');
const cancelCreateBtn = document.getElementById('cancelCreateBtn');
const createUserForm  = document.getElementById('createUserForm');
const createErrorBox  = document.getElementById('createErrorBox');
const submitCreateBtn = document.getElementById('submitCreateBtn');

const editUserModal   = document.getElementById('editUserModal');
const closeEditModalBtn = document.getElementById('closeEditModalBtn');
const cancelEditBtn   = document.getElementById('cancelEditBtn');
const editUserForm    = document.getElementById('editUserForm');
const editErrorBox    = document.getElementById('editErrorBox');
const submitEditBtn   = document.getElementById('submitEditBtn');

const editUserId      = document.getElementById('editUserId');
const editEmail       = document.getElementById('editEmail');
const editRole        = document.getElementById('editRole');
const editActive      = document.getElementById('editActive');

// ── State ─────────────────────────────────────────────────────────────
let isLoading = false;
let userObj   = null;
let usersList = [];

// ── Helpers ───────────────────────────────────────────────────────────
function setStatus(msg) {
  statusLive.textContent = msg;
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function fmtDateTime(isoStr) {
  if (!isoStr) return 'Nunca';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(isoStr));
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

// ── API Fetchers ──────────────────────────────────────────────────────
async function loadUsers() {
  if (isLoading) return;
  isLoading = true;
  setStatus('Cargando usuarios...');
  
  usersBody.innerHTML = `<tr><td colspan="5"><div class="skeleton" style="height:36px;margin:4px 0"></div></td></tr>`.repeat(3);

  try {
    const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
    if (res.status === 401) {
      window.location.href = '/admin/';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    
    const data = await res.json();
    usersList = data.users || [];
    renderUsers();
    setStatus('Usuarios cargados.');
  } catch (err) {
    console.warn('Users load error:', err.message);
    usersBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:32px;">Error al cargar usuarios.</td></tr>`;
    setStatus('Error al cargar datos');
  } finally {
    isLoading = false;
  }
}

// ── Render ────────────────────────────────────────────────────────────
function renderUsers() {
  if (usersList.length === 0) {
    usersBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:32px;">No hay usuarios.</td></tr>`;
    return;
  }

  const isSuperAdmin = userObj.role === 'SUPER_ADMIN';

  usersBody.innerHTML = usersList.map(u => {
    const badgeClass = String(u.role).toLowerCase();
    const statusText = u.active ? 'Activo' : 'Inactivo';
    const statusClass = u.active ? 'active' : 'inactive';
    const isSelf = u.id === userObj.id;
    const canEdit = isSuperAdmin && !isSelf;

    const actionBtn = canEdit ? `
      <button class="btn-icon edit-btn" data-id="${u.id}" aria-label="Editar usuario ${escHtml(u.email)}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
      </button>
    ` : `<span style="color:var(--text-tertiary);font-size:12px;">—</span>`;

    return `
      <tr>
        <td class="user-email-col">${escHtml(u.email)} ${isSelf ? '<span class="nav-badge" style="margin-left:8px">Tú</span>' : ''}</td>
        <td><span class="role-badge ${badgeClass}">${escHtml(u.role)}</span></td>
        <td>
          <div class="status-indicator">
            <div class="status-dot ${statusClass}"></div>
            <span>${statusText}</span>
          </div>
        </td>
        <td style="color:var(--text-secondary)">${escHtml(fmtDateTime(u.last_login_at))}</td>
        <td style="text-align:right">
          ${actionBtn}
        </td>
      </tr>
    `;
  }).join('');

  // Attach edit listeners
  usersBody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      openEditModal(id);
    });
  });
}

// ── Modals ────────────────────────────────────────────────────────────
function openCreateModal() {
  createErrorBox.style.display = 'none';
  createUserForm.reset();
  createUserModal.showModal();
}
function closeCreateModal() {
  createUserModal.close();
}

function openEditModal(id) {
  const u = usersList.find(x => x.id === id);
  if (!u) return;
  editErrorBox.style.display = 'none';
  editUserId.value = u.id;
  editEmail.value = u.email;
  editRole.value = u.role;
  editActive.value = u.active ? 'true' : 'false';
  editUserModal.showModal();
}
function closeEditModal() {
  editUserModal.close();
}

// ── Handlers ──────────────────────────────────────────────────────────
async function handleCreate(e) {
  e.preventDefault();
  submitCreateBtn.disabled = true;
  submitCreateBtn.textContent = 'Creando...';
  createErrorBox.style.display = 'none';

  const payload = {
    email: document.getElementById('createEmail').value.trim(),
    role: document.getElementById('createRole').value,
    password: document.getElementById('createPassword').value
  };

  try {
    const res = await fetch('/api/admin/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al crear usuario');
    }

    closeCreateModal();
    loadUsers();
  } catch (err) {
    createErrorBox.textContent = err.message;
    createErrorBox.style.display = 'block';
  } finally {
    submitCreateBtn.disabled = false;
    submitCreateBtn.textContent = 'Crear Usuario';
  }
}

async function handleEdit(e) {
  e.preventDefault();
  submitEditBtn.disabled = true;
  submitEditBtn.textContent = 'Guardando...';
  editErrorBox.style.display = 'none';

  const payload = {
    id: parseInt(editUserId.value, 10),
    role: editRole.value,
    active: editActive.value === 'true'
  };

  try {
    const res = await fetch('/api/admin/users/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al actualizar usuario');
    }

    closeEditModal();
    loadUsers();
  } catch (err) {
    editErrorBox.textContent = err.message;
    editErrorBox.style.display = 'block';
  } finally {
    submitEditBtn.disabled = false;
    submitEditBtn.textContent = 'Guardar Cambios';
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

  if (userObj.role === 'SUPER_ADMIN') {
    newUserBtn.style.display = 'inline-flex';
    newUserBtn.addEventListener('click', openCreateModal);
  }

  await loadUsers();

  // Listeners
  createUserForm.addEventListener('submit', handleCreate);
  closeCreateModalBtn.addEventListener('click', closeCreateModal);
  cancelCreateBtn.addEventListener('click', closeCreateModal);

  editUserForm.addEventListener('submit', handleEdit);
  closeEditModalBtn.addEventListener('click', closeEditModal);
  cancelEditBtn.addEventListener('click', closeEditModal);

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
