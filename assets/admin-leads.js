/**
 * assets/admin-leads.js
 * Lógica cliente para el módulo de Leads (Stage 1C).
 */

let currentCursor = null;
let currentFilters = {
  source: '',
  medium: '',
  campaign: '',
  from: '',
  to: ''
};
let isSearchMode = false; // Indica si estamos viendo resultados de búsqueda
let revealTimers = {}; // Para el control al revelar teléfonos

const UI = {
  leadsBody: document.getElementById('leadsBody'),
  btnLoadMore: document.getElementById('btnLoadMore'),
  paginationStatus: document.getElementById('paginationStatus'),
  filtersForm: document.getElementById('filtersForm'),
  btnResetFilters: document.getElementById('btnResetFilters'),
  filterSource: document.getElementById('filterSource'),
  filterMedium: document.getElementById('filterMedium'),
  filterCampaign: document.getElementById('filterCampaign'),
  filterFrom: document.getElementById('filterFrom'),
  filterTo: document.getElementById('filterTo'),
  searchForm: document.getElementById('searchForm'),
  phoneSearch: document.getElementById('phoneSearch'),
  refreshBtn: document.getElementById('refreshBtn'),
  statusLive: document.getElementById('statusLive'),
  
  // Drawer
  drawerOverlay: document.getElementById('drawerOverlay'),
  leadDrawer: document.getElementById('leadDrawer'),
  btnCloseDrawer: document.getElementById('btnCloseDrawer'),
  drawerLoader: document.getElementById('drawerLoader'),
  drawerContent: document.getElementById('drawerContent'),
  
  drawerFields: {
    id: document.getElementById('drawerLeadId'),
    phone: document.getElementById('detailPhone'),
    source: document.getElementById('detailSource'),
    medium: document.getElementById('detailMedium'),
    campaign: document.getElementById('detailCampaign'),
    term: document.getElementById('detailTerm'),
    content: document.getElementById('detailContent'),
    date: document.getElementById('detailDate'),
    pageUrl: document.getElementById('detailPageUrl'),
    referrer: document.getElementById('detailReferrer'),
    fbAdId: document.getElementById('detailFbAdId'),
    fbAdsetId: document.getElementById('detailFbAdsetId'),
    fbCampaignId: document.getElementById('detailFbCampaignId')
  },
  
  btnRevealPhone: document.getElementById('btnRevealPhone'),
  revealTimerWrap: document.getElementById('revealTimerWrap'),
  revealCountdown: document.getElementById('revealCountdown')
};

/**
 * Muestra mensaje a tecnologías de asistencia
 */
function announce(msg) {
  if (UI.statusLive) {
    UI.statusLive.textContent = msg;
  }
}

/**
 * Fetch con credenciales y manejo de sesión
 */
async function fetchWithAuth(url, options = {}) {
  options.credentials = 'same-origin';
  const res = await fetch(url, options);
  if (res.status === 401) {
    handleSessionExpired();
    return Promise.reject(new Error('Unauthorized'));
  }
  return res;
}

/**
 * Maneja la sesión expirada limpiando PII antes de redirigir.
 */
function handleSessionExpired() {
  resetRevealTimer();
  UI.leadsBody.textContent = '';
  window.location.href = '/admin/';
}

/**
 * Cierra sesión
 */
async function logout() {
  resetRevealTimer();
  UI.leadsBody.textContent = '';
  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });
  } catch { /* ignore network error */ }
  window.location.href = '/admin/';
}

/**
 * Inicialización
 */
async function init() {
  const user = await checkSession();
  if (!user) {
    window.location.href = '/admin/';
    return;
  }
  
  // Update sidebar user widget if present
  const userAvatar = document.getElementById('userAvatar');
  const userEmail = document.getElementById('userEmail');
  const userRole = document.getElementById('userRole');
  if (userAvatar && user.email) userAvatar.textContent = user.email.charAt(0).toUpperCase();
  if (userEmail) userEmail.textContent = user.email;
  if (userRole) userRole.textContent = user.role;

  await loadFacets();
  await loadLeads(true);
  setupEventListeners();
}

/**
 * Revisa sesión activa
 */
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

/**
 * Configura los eventos del DOM
 */
function setupEventListeners() {
  // Filtros
  UI.filtersForm.addEventListener('submit', (e) => {
    e.preventDefault();
    isSearchMode = false;
    currentFilters = {
      source: UI.filterSource.value,
      medium: UI.filterMedium.value,
      campaign: UI.filterCampaign.value,
      from: UI.filterFrom.value,
      to: UI.filterTo.value
    };
    UI.phoneSearch.value = ''; // Limpiar búsqueda al usar filtros
    loadLeads(true);
  });

  UI.btnResetFilters.addEventListener('click', () => {
    isSearchMode = false;
    UI.filtersForm.reset();
    currentFilters = { source: '', medium: '', campaign: '', from: '', to: '' };
    UI.phoneSearch.value = '';
    loadLeads(true);
  });

  // Búsqueda Segura
  UI.searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = UI.phoneSearch.value.trim();
    if (!/^\d{10}$/.test(phone)) return;
    
    isSearchMode = true;
    UI.filtersForm.reset(); // Limpiar UI de filtros
    currentFilters = { source: '', medium: '', campaign: '', from: '', to: '' };
    
    UI.phoneSearch.value = ''; // Limpiar campo PII inmediatamente
    await searchPhone(phone);
  });

  // Paginación y Refresh
  UI.btnLoadMore.addEventListener('click', () => {
    if (!isSearchMode && currentCursor) {
      loadLeads(false);
    }
  });

  UI.refreshBtn.addEventListener('click', () => {
    if (isSearchMode) {
      // Salimos del modo búsqueda ya que no conservamos el teléfono
      isSearchMode = false;
      loadLeads(true);
    } else {
      loadLeads(true);
    }
  });

  // Drawer
  UI.btnCloseDrawer.addEventListener('click', closeDrawer);
  UI.drawerOverlay.addEventListener('click', closeDrawer);
  
  // Logout link binding si existe (del admin-core)
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  
  // Limpieza PII al navegar
  window.addEventListener('beforeunload', resetRevealTimer);
  window.addEventListener('pagehide', resetRevealTimer);
}

/**
 * Carga facetas para los filtros (dropdowns)
 */
async function loadFacets() {
  try {
    const res = await fetchWithAuth('/api/admin/leads/facets');
    if (!res.ok) return;
    
    const { sources, mediums, campaigns } = await res.json();
    
    const populate = (select, data) => {
      data.forEach(item => {
        if (!item || !item.value) return;
        const opt = document.createElement('option');
        opt.value = item.value;
        opt.textContent = `${item.value} (${item.count})`;
        select.appendChild(opt);
      });
    };
    
    populate(UI.filterSource, sources || []);
    populate(UI.filterMedium, mediums || []);
    populate(UI.filterCampaign, campaigns || []);
    
  } catch (err) {
    console.error('Error cargando facetas', err);
  }
}

/**
 * Renderiza la tabla con los leads (Prevención XSS)
 */
function renderTable(leads, append) {
  if (!append) {
    UI.leadsBody.textContent = '';
  }
  
  if (leads.length === 0 && !append) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.style.textAlign = 'center';
    td.style.padding = '2rem';
    td.textContent = 'No se encontraron leads.';
    tr.appendChild(td);
    UI.leadsBody.appendChild(tr);
    announce('No se encontraron leads.');
    return;
  }
  
  const formatter = new Intl.DateTimeFormat('es-MX', { 
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  leads.forEach(lead => {
    const tr = document.createElement('tr');
    
    const tdId = document.createElement('td');
    tdId.textContent = lead.id;
    
    const tdDate = document.createElement('td');
    tdDate.style.whiteSpace = 'nowrap';
    tdDate.textContent = formatter.format(new Date(lead.createdAt));
    
    const tdPhone = document.createElement('td');
    const strongPhone = document.createElement('strong');
    strongPhone.textContent = lead.phoneMasked || '-';
    tdPhone.appendChild(strongPhone);
    
    const tdSource = document.createElement('td');
    const spanSource = document.createElement('span');
    spanSource.className = lead.source ? 'badge badge-primary' : 'badge';
    spanSource.textContent = lead.source || '-';
    tdSource.appendChild(spanSource);
    
    const tdCampaign = document.createElement('td');
    tdCampaign.textContent = lead.campaign || '-';
    
    const tdActions = document.createElement('td');
    const btnDrawer = document.createElement('button');
    btnDrawer.className = 'btn-ghost btn-sm';
    btnDrawer.textContent = 'Ver detalle';
    btnDrawer.addEventListener('click', () => openLeadDrawer(lead.id));
    tdActions.appendChild(btnDrawer);
    
    tr.appendChild(tdId);
    tr.appendChild(tdDate);
    tr.appendChild(tdPhone);
    tr.appendChild(tdSource);
    tr.appendChild(tdCampaign);
    tr.appendChild(tdActions);
    
    UI.leadsBody.appendChild(tr);
  });
  
  announce(`Se cargaron ${leads.length} leads.`);
}

/**
 * Carga la lista de leads
 */
async function loadLeads(reset = false) {
  if (reset) {
    currentCursor = null;
    UI.leadsBody.textContent = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.style.textAlign = 'center';
    td.style.padding = '2rem';
    const loader = document.createElement('div');
    loader.className = 'loader-ring';
    loader.style.width = '24px';
    loader.style.height = '24px';
    td.appendChild(loader);
    tr.appendChild(td);
    UI.leadsBody.appendChild(tr);
  }

  const params = new URLSearchParams();
  if (currentFilters.source) params.set('source', currentFilters.source);
  if (currentFilters.medium) params.set('medium', currentFilters.medium);
  if (currentFilters.campaign) params.set('campaign', currentFilters.campaign);
  if (currentFilters.from) params.set('from', currentFilters.from);
  if (currentFilters.to) params.set('to', currentFilters.to);
  if (currentCursor) params.set('cursor', currentCursor);
  params.set('limit', '25'); // Stage 1C limit=25

  try {
    const res = await fetchWithAuth(`/api/admin/leads?${params.toString()}`);
    if (res.status === 403) {
      alert('No tienes permisos para ver los leads.');
      return;
    }
    if (!res.ok) throw new Error('Error al cargar leads');
    
    const json = await res.json();
    const items = json.items || [];
    renderTable(items, !reset);
    
    if (json.pagination) {
      currentCursor = json.pagination.nextCursor;
      if (currentCursor) {
        UI.btnLoadMore.style.display = 'inline-flex';
        UI.paginationStatus.textContent = '';
      } else {
        UI.btnLoadMore.style.display = 'none';
        if (items.length > 0) {
          UI.paginationStatus.textContent = \`No hay más resultados (Total: \${json.pagination.total}).\`;
        } else {
          UI.paginationStatus.textContent = '';
        }
      }
    }
    
  } catch (err) {
    console.error(err);
    if (reset) {
      UI.leadsBody.textContent = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.style.textAlign = 'center';
      td.style.color = 'red';
      td.textContent = 'Error al cargar leads';
      tr.appendChild(td);
      UI.leadsBody.appendChild(tr);
    }
  }
}

/**
 * Búsqueda de teléfono exacta
 */
async function searchPhone(phone) {
  UI.leadsBody.textContent = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 6;
  td.style.textAlign = 'center';
  td.style.padding = '2rem';
  const loader = document.createElement('div');
  loader.className = 'loader-ring';
  loader.style.width = '24px';
  loader.style.height = '24px';
  td.appendChild(loader);
  td.appendChild(document.createTextNode(' Buscando en auditoría...'));
  tr.appendChild(td);
  UI.leadsBody.appendChild(tr);
  
  UI.btnLoadMore.style.display = 'none';
  UI.paginationStatus.textContent = '';
  
  try {
    const res = await fetchWithAuth('/api/admin/leads/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    
    if (res.status === 403) {
      UI.leadsBody.textContent = '';
      const errTr = document.createElement('tr');
      const errTd = document.createElement('td');
      errTd.colSpan = 6;
      errTd.style.textAlign = 'center';
      errTd.style.color = 'red';
      errTd.textContent = 'No tienes rol SUPER_ADMIN para buscar teléfonos.';
      errTr.appendChild(errTd);
      UI.leadsBody.appendChild(errTr);
      return;
    }
    if (!res.ok) throw new Error('Error en la búsqueda');
    
    const json = await res.json();
    renderTable(json.items || [], false);
    
  } catch (err) {
    console.error(err);
    UI.leadsBody.textContent = '';
    const errTr = document.createElement('tr');
    const errTd = document.createElement('td');
    errTd.colSpan = 6;
    errTd.style.textAlign = 'center';
    errTd.style.color = 'red';
    errTd.textContent = 'Error en la búsqueda.';
    errTr.appendChild(errTd);
    UI.leadsBody.appendChild(errTr);
  }
}

/**
 * Lógica del Drawer
 */
async function openLeadDrawer(id) {
  UI.drawerOverlay.setAttribute('aria-hidden', 'false');
  UI.leadDrawer.setAttribute('aria-hidden', 'false');
  UI.drawerLoader.style.display = 'block';
  UI.drawerContent.style.display = 'none';
  
  // Limpiar timers activos de este u otros leads
  resetRevealTimer();

  try {
    const res = await fetchWithAuth(`/api/admin/leads/detail?id=${id}`);
    if (!res.ok) throw new Error('Error cargando detalle');
    
    const data = await res.json(); // Ahora la respuesta es el objeto directamente o data depende de tu api
    // Asumimos que data es el objeto lead dado que se refactorizó el contracto (veremos en el backend)
    
    UI.drawerFields.id.textContent = `#${data.id}`;
    UI.drawerFields.phone.textContent = data.phoneMasked || '-';
    UI.drawerFields.source.textContent = data.utmSource || '-';
    UI.drawerFields.medium.textContent = data.utmMedium || '-';
    UI.drawerFields.campaign.textContent = data.utmCampaign || '-';
    UI.drawerFields.term.textContent = data.utmTerm || '-';
    UI.drawerFields.content.textContent = data.utmContent || '-';
    
    const formatter = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'medium' });
    if (data.createdAt) {
      UI.drawerFields.date.textContent = formatter.format(new Date(data.createdAt));
    } else {
      UI.drawerFields.date.textContent = '-';
    }
    
    if (data.page && !data.page.includes('invalid-protocol')) {
      UI.drawerFields.pageUrl.href = data.page;
      UI.drawerFields.pageUrl.textContent = data.page;
      UI.drawerFields.pageUrl.style.pointerEvents = 'auto';
    } else {
      UI.drawerFields.pageUrl.href = '#';
      UI.drawerFields.pageUrl.textContent = 'No disponible';
      UI.drawerFields.pageUrl.style.pointerEvents = 'none';
    }
    
    UI.drawerFields.referrer.textContent = data.referrer || '-';
    
    // Meta IDs
    UI.drawerFields.fbAdId.textContent = data.fbAdId || '-';
    UI.drawerFields.fbAdsetId.textContent = data.fbAdsetId || '-';
    UI.drawerFields.fbCampaignId.textContent = data.fbCampaignId || '-';
    
    // Configurar botón reveal (remove onclick from html previously, use listener safely)
    const newBtn = UI.btnRevealPhone.cloneNode(true);
    UI.btnRevealPhone.parentNode.replaceChild(newBtn, UI.btnRevealPhone);
    UI.btnRevealPhone = newBtn;
    
    UI.btnRevealPhone.addEventListener('click', () => revealPhone(data.id, data.phoneMasked));
    UI.btnRevealPhone.style.display = 'inline-flex';
    UI.drawerFields.phone.classList.remove('revealed-phone');
    
    UI.drawerLoader.style.display = 'none';
    UI.drawerContent.style.display = 'block';
    
  } catch (err) {
    console.error(err);
    UI.drawerLoader.textContent = 'Error cargando el detalle.';
  }
}

function closeDrawer() {
  UI.drawerOverlay.setAttribute('aria-hidden', 'true');
  UI.leadDrawer.setAttribute('aria-hidden', 'true');
  resetRevealTimer();
}

/**
 * Reveal Phone and Timer logic
 */
function resetRevealTimer() {
  if (revealTimers.interval) clearInterval(revealTimers.interval);
  UI.revealTimerWrap.style.display = 'none';
  // Restaurar enmascarado del DOM si es que quedaba algo
  if (!UI.drawerFields.phone.textContent.includes('*')) {
    // Si no contiene *, volvemos a enmascarar (safe fallback)
    UI.drawerFields.phone.textContent = '******' + UI.drawerFields.phone.textContent.slice(-4);
  }
  UI.drawerFields.phone.classList.remove('revealed-phone');
  if (UI.btnRevealPhone) {
    UI.btnRevealPhone.style.display = 'inline-flex';
  }
}

async function revealPhone(id, maskedVal) {
  try {
    const res = await fetchWithAuth('/api/admin/leads/reveal-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    
    if (res.status === 403) {
      alert('Solo el rol SUPER_ADMIN puede revelar teléfonos.');
      return;
    }
    if (!res.ok) throw new Error('Error al revelar');
    
    const { phone, expiresInSeconds } = await res.json();
    const duration = expiresInSeconds || 60;
    
    UI.drawerFields.phone.textContent = phone;
    UI.drawerFields.phone.classList.add('revealed-phone');
    UI.btnRevealPhone.style.display = 'none';
    
    // Iniciar temporizador usando timestamp de deadline único
    UI.revealTimerWrap.style.display = 'block';
    const deadline = Date.now() + (duration * 1000);
    
    // Initial paint
    UI.revealCountdown.textContent = duration;
    
    if (revealTimers.interval) clearInterval(revealTimers.interval);
    
    revealTimers.interval = setInterval(() => {
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      
      if (remaining <= 0) {
        resetRevealTimer();
        UI.drawerFields.phone.textContent = maskedVal;
      } else {
        UI.revealCountdown.textContent = remaining;
      }
    }, 1000);
    
  } catch (err) {
    console.error('Reveal error');
    // Silent fail outside of generic message, no raw console error
  }
}

// Iniciar aplicación
document.addEventListener('DOMContentLoaded', init);
