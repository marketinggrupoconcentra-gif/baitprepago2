/**
 * assets/admin-leads.js
 * Lógica cliente para el módulo de Leads (Stage 1C).
 */

let currentCursor = null;
let currentFilters = {
  source: '',
  medium: '',
  campaign: ''
};
let isSearchMode = false; // Indica si estamos viendo resultados de búsqueda
let revealTimers = {}; // Para el control de 60s al revelar teléfonos

const UI = {
  leadsBody: document.getElementById('leadsBody'),
  btnLoadMore: document.getElementById('btnLoadMore'),
  paginationStatus: document.getElementById('paginationStatus'),
  filtersForm: document.getElementById('filtersForm'),
  btnResetFilters: document.getElementById('btnResetFilters'),
  filterSource: document.getElementById('filterSource'),
  filterMedium: document.getElementById('filterMedium'),
  filterCampaign: document.getElementById('filterCampaign'),
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
    ua: document.getElementById('detailUA')
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
    window.location.href = '/admin/';
    return Promise.reject(new Error('Unauthorized'));
  }
  return res;
}

/**
 * Cierra sesión
 */
async function logout() {
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
      campaign: UI.filterCampaign.value
    };
    UI.phoneSearch.value = ''; // Limpiar búsqueda al usar filtros
    loadLeads(true);
  });

  UI.btnResetFilters.addEventListener('click', () => {
    isSearchMode = false;
    UI.filtersForm.reset();
    currentFilters = { source: '', medium: '', campaign: '' };
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
    currentFilters = { source: '', medium: '', campaign: '' };
    
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
      UI.searchForm.dispatchEvent(new Event('submit'));
    } else {
      loadLeads(true);
    }
  });

  // Drawer
  UI.btnCloseDrawer.addEventListener('click', closeDrawer);
  UI.drawerOverlay.addEventListener('click', closeDrawer);
  
  // Logout link binding si existe (del admin-core)
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
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
      data.forEach(val => {
        if (!val) return;
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        select.appendChild(opt);
      });
    };
    
    populate(UI.filterSource, sources);
    populate(UI.filterMedium, mediums);
    populate(UI.filterCampaign, campaigns);
    
  } catch (err) {
    console.error('Error cargando facetas', err);
  }
}

/**
 * Renderiza la tabla con los leads
 */
function renderTable(leads, append) {
  if (!append) {
    UI.leadsBody.innerHTML = '';
  }
  
  if (leads.length === 0 && !append) {
    UI.leadsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;">No se encontraron leads.</td></tr>';
    announce('No se encontraron leads.');
    return;
  }
  
  const formatter = new Intl.DateTimeFormat('es-MX', { 
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  leads.forEach(lead => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${lead.id}</td>
      <td style="white-space: nowrap;">${formatter.format(new Date(lead.created_at))}</td>
      <td><strong>${lead.phone}</strong></td>
      <td><span class="badge ${lead.utm_source ? 'badge-primary' : ''}">${lead.utm_source || '-'}</span></td>
      <td>${lead.utm_campaign || '-'}</td>
      <td><button class="btn-ghost btn-sm" onclick="window.openLeadDrawer(${lead.id})">Ver detalle</button></td>
    `;
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
    UI.leadsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;"><div class="loader-ring" style="width:24px; height:24px;"></div></td></tr>';
  }

  const params = new URLSearchParams();
  if (currentFilters.source) params.set('source', currentFilters.source);
  if (currentFilters.medium) params.set('medium', currentFilters.medium);
  if (currentFilters.campaign) params.set('campaign', currentFilters.campaign);
  if (currentCursor) params.set('cursor', currentCursor);
  params.set('limit', '20');

  try {
    const res = await fetchWithAuth(`/api/admin/leads?${params.toString()}`);
    if (res.status === 403) {
      alert('No tienes permisos para ver los leads.');
      return;
    }
    if (!res.ok) throw new Error('Error al cargar leads');
    
    const json = await res.json();
    renderTable(json.data || [], !reset);
    
    currentCursor = json.nextCursor;
    if (currentCursor) {
      UI.btnLoadMore.style.display = 'inline-flex';
      UI.paginationStatus.textContent = '';
    } else {
      UI.btnLoadMore.style.display = 'none';
      if ((json.data || []).length > 0) {
        UI.paginationStatus.textContent = 'No hay más resultados.';
      } else {
        UI.paginationStatus.textContent = '';
      }
    }
    
  } catch (err) {
    console.error(err);
    if (reset) UI.leadsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Error al cargar leads</td></tr>';
  }
}

/**
 * Búsqueda de teléfono exacta
 */
async function searchPhone(phone) {
  UI.leadsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;"><div class="loader-ring" style="width:24px; height:24px;"></div> Buscando en auditoría...</td></tr>';
  UI.btnLoadMore.style.display = 'none';
  UI.paginationStatus.textContent = '';
  
  try {
    const res = await fetchWithAuth('/api/admin/leads/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    
    if (res.status === 403) {
      UI.leadsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">No tienes rol SUPER_ADMIN para buscar teléfonos.</td></tr>';
      return;
    }
    if (!res.ok) throw new Error('Error en la búsqueda');
    
    const json = await res.json();
    renderTable(json.data || [], false);
    
  } catch (err) {
    console.error(err);
    UI.leadsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Error en la búsqueda.</td></tr>';
  }
}

/**
 * Lógica del Drawer
 */
window.openLeadDrawer = async function(id) {
  UI.drawerOverlay.setAttribute('aria-hidden', 'false');
  UI.leadDrawer.setAttribute('aria-hidden', 'false');
  UI.drawerLoader.style.display = 'block';
  UI.drawerContent.style.display = 'none';
  
  // Limpiar timers activos de este u otros leads
  resetRevealTimer();

  try {
    const res = await fetchWithAuth(`/api/admin/leads/detail?id=${id}`);
    if (!res.ok) throw new Error('Error cargando detalle');
    
    const { data } = await res.json();
    
    UI.drawerFields.id.textContent = `#${data.id}`;
    UI.drawerFields.phone.textContent = data.phone;
    UI.drawerFields.source.textContent = data.utm_source || '-';
    UI.drawerFields.medium.textContent = data.utm_medium || '-';
    UI.drawerFields.campaign.textContent = data.utm_campaign || '-';
    UI.drawerFields.term.textContent = data.utm_term || '-';
    UI.drawerFields.content.textContent = data.utm_content || '-';
    
    const formatter = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'medium' });
    UI.drawerFields.date.textContent = formatter.format(new Date(data.created_at));
    
    if (data.page_url && !data.page_url.includes('invalid-protocol')) {
      UI.drawerFields.pageUrl.href = data.page_url;
      UI.drawerFields.pageUrl.textContent = data.page_url;
      UI.drawerFields.pageUrl.style.pointerEvents = 'auto';
    } else {
      UI.drawerFields.pageUrl.href = '#';
      UI.drawerFields.pageUrl.textContent = 'No disponible';
      UI.drawerFields.pageUrl.style.pointerEvents = 'none';
    }
    
    UI.drawerFields.referrer.textContent = data.referrer || '-';
    UI.drawerFields.ua.textContent = data.user_agent || '-';
    
    // Configurar botón reveal
    UI.btnRevealPhone.onclick = () => revealPhone(data.id, data.phone);
    UI.btnRevealPhone.style.display = 'inline-flex';
    UI.drawerFields.phone.classList.remove('revealed-phone');
    
    UI.drawerLoader.style.display = 'none';
    UI.drawerContent.style.display = 'block';
    
  } catch (err) {
    console.error(err);
    UI.drawerLoader.textContent = 'Error cargando el detalle.';
  }
};

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
  if (revealTimers.timeout) clearTimeout(revealTimers.timeout);
  UI.revealTimerWrap.style.display = 'none';
  // Restaurar enmascarado del DOM si es que quedaba algo
  if (!UI.drawerFields.phone.textContent.includes('*')) {
    // Es un hack, pero para asegurar, si lo cerramos, lo re-enmascaramos
    UI.drawerFields.phone.textContent = '******' + UI.drawerFields.phone.textContent.slice(-4);
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
    
    const { phone } = await res.json();
    
    UI.drawerFields.phone.textContent = phone;
    UI.drawerFields.phone.classList.add('revealed-phone');
    UI.btnRevealPhone.style.display = 'none';
    
    // Iniciar temporizador de 60s
    UI.revealTimerWrap.style.display = 'block';
    let secondsLeft = 60;
    UI.revealCountdown.textContent = secondsLeft;
    
    revealTimers.interval = setInterval(() => {
      secondsLeft--;
      UI.revealCountdown.textContent = secondsLeft;
      if (secondsLeft <= 0) {
        resetRevealTimer();
        UI.drawerFields.phone.textContent = maskedVal;
        UI.drawerFields.phone.classList.remove('revealed-phone');
        UI.btnRevealPhone.style.display = 'inline-flex';
      }
    }, 1000);
    
    revealTimers.timeout = setTimeout(() => {
      resetRevealTimer();
      UI.drawerFields.phone.textContent = maskedVal;
      UI.drawerFields.phone.classList.remove('revealed-phone');
      UI.btnRevealPhone.style.display = 'inline-flex';
    }, 60000);
    
  } catch (err) {
    console.error('Reveal error:', err);
    alert('Error al revelar el teléfono.');
  }
}

// Iniciar aplicación
document.addEventListener('DOMContentLoaded', init);
