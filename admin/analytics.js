/**
 * admin/analytics.js
 * BAIT Prepago — Analytics client
 *
 * Rules:
 * - No inline event handlers in HTML
 * - No localStorage / sessionStorage / IndexedDB
 * - No external libraries
 * - CSP safe: runs as type="module"
 */

// ── Constants ────────────────────────────────────────────────────────
const TZ      = 'America/Mexico_City';
const LOCALE  = 'es-MX';

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
const exportCsvBtn    = document.getElementById('exportCsvBtn');

const kpiGrid         = document.getElementById('kpiGrid');
const trendChartWrap  = document.getElementById('trendChartWrap');
const chartTooltip    = document.getElementById('chartTooltip');
const funnelList      = document.getElementById('funnelList');
const sourcesList     = document.getElementById('sourcesList');
const campaignList    = document.getElementById('campaignList');
const statusLive      = document.getElementById('statusLive');

const filtersForm     = document.getElementById('filtersForm');
const filterFrom      = document.getElementById('filterFrom');
const filterTo        = document.getElementById('filterTo');
const filterSource    = document.getElementById('filterSource');
const filterMedium    = document.getElementById('filterMedium');
const filterCampaign  = document.getElementById('filterCampaign');
const filterStatus    = document.getElementById('filterStatus');
const resetFiltersBtn = document.getElementById('resetFiltersBtn');

// ── State ─────────────────────────────────────────────────────────────
let isLoading = false;
let userObj   = null;

// ── Helpers ───────────────────────────────────────────────────────────
function fmtNumber(n) {
  return new Intl.NumberFormat(LOCALE).format(n);
}

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
async function fetchFacets() {
  try {
    const res = await fetch('/api/admin/analytics/facets', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    
    populateSelect(filterSource, data.sources, 'value', 'value');
    populateSelect(filterMedium, data.mediums, 'value', 'value');
    populateSelect(filterCampaign, data.campaigns, 'value', 'value');
    populateSelect(filterStatus, data.statuses, 'value', 'label');
  } catch (err) {
    console.error('Error fetching facets', err);
  }
}

function populateSelect(selectEl, items, valKey, lblKey) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">Todos</option>';
  items.forEach(item => {
    const val = item[valKey];
    const lbl = item[lblKey];
    if (val) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = lbl;
      selectEl.appendChild(opt);
    }
  });
  selectEl.value = current;
}

function getFilterParams() {
  const params = new URLSearchParams();
  if (filterFrom.value) params.set('from', filterFrom.value);
  if (filterTo.value) params.set('to', filterTo.value);
  if (filterSource.value) params.set('source', filterSource.value);
  if (filterMedium.value) params.set('medium', filterMedium.value);
  if (filterCampaign.value) params.set('campaign', filterCampaign.value);
  if (filterStatus.value) params.set('status', filterStatus.value);
  return params;
}

async function loadAnalytics() {
  if (isLoading) return;
  isLoading = true;
  setStatus('Cargando analíticas...');
  
  // Show skeletons
  kpiGrid.innerHTML = `
    <article class="kpi-card"><div class="kpi-label skeleton" style="height:16px;width:100px;"></div><div class="kpi-value skeleton" style="height:32px;width:80px;margin-top:8px;"></div></article>
    <article class="kpi-card"><div class="kpi-label skeleton" style="height:16px;width:100px;"></div><div class="kpi-value skeleton" style="height:32px;width:80px;margin-top:8px;"></div></article>
    <article class="kpi-card"><div class="kpi-label skeleton" style="height:16px;width:100px;"></div><div class="kpi-value skeleton" style="height:32px;width:80px;margin-top:8px;"></div></article>
    <article class="kpi-card"><div class="kpi-label skeleton" style="height:16px;width:100px;"></div><div class="kpi-value skeleton" style="height:32px;width:80px;margin-top:8px;"></div></article>
  `;
  trendChartWrap.innerHTML = `<div class="chart-skeleton skeleton" aria-hidden="true"></div>`;
  funnelList.innerHTML     = `<div class="skeleton" style="height:56px;border-radius:8px;margin-bottom:8px"></div>`.repeat(4);
  sourcesList.innerHTML    = `<div class="skeleton" style="height:32px;margin-bottom:8px"></div>`.repeat(3);
  campaignList.innerHTML   = `<div class="skeleton" style="height:32px;margin-bottom:8px"></div>`.repeat(3);

  try {
    const params = getFilterParams();
    const res = await fetch(`/api/admin/analytics?${params.toString()}`, { credentials: 'same-origin' });
    
    if (res.status === 401) {
      window.location.href = '/admin/';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    
    const data = await res.json();
    
    renderTotals(data.totals);
    renderTrend(data.trend);
    renderFunnel(data.funnel);
    renderSources(data.sources);
    renderCampaigns(data.campaigns);
    
    setStatus('Analíticas actualizadas.');
  } catch (err) {
    console.warn('Analytics load error:', err.message);
    kpiGrid.innerHTML = `<div style="grid-column:1/-1" class="state-error">Error al cargar datos.</div>`;
    setStatus('Error al cargar datos');
  } finally {
    isLoading = false;
  }
}

// ── Render ────────────────────────────────────────────────────────────
function renderTotals(t) {
  const defs = [
    { label: 'Total Leads', val: fmtNumber(t.leads), sub: 'En el periodo seleccionado' },
    { label: 'Atribuidos', val: fmtNumber(t.attributed), sub: 'Con utm_source' },
    { label: 'Completados', val: fmtNumber(t.completed), sub: 'Finalizados con éxito' },
    { label: 'Terminales', val: fmtNumber(t.terminal), sub: 'Completados, Rechazados, Cancelados' }
  ];
  kpiGrid.innerHTML = defs.map(d => `
    <article class="kpi-card">
      <div class="kpi-label">${escHtml(d.label)}</div>
      <div class="kpi-value">${escHtml(d.val)}</div>
      <div class="kpi-support">${escHtml(d.sub)}</div>
    </article>
  `).join('');
}

function renderFunnel(funnel) {
  if (!funnel || funnel.length === 0) {
    funnelList.innerHTML = `<div class="state-empty">Sin datos de embudo</div>`;
    return;
  }
  
  const max = Math.max(...funnel.map(f => f.count), 1);
  
  funnelList.innerHTML = funnel.map(f => {
    const width = Math.round((f.count / max) * 100);
    return `
      <div class="funnel-item">
        <div class="funnel-item-header">
          <span class="funnel-status-badge">${escHtml(f.status)}</span>
          <span class="funnel-count">${fmtNumber(f.count)}</span>
        </div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar-fill" style="width: ${width}%"></div>
        </div>
        <div class="funnel-pct">${f.percentage}% del total</div>
      </div>
    `;
  }).join('');
}

function renderSources(sources) {
  if (!sources || sources.length === 0) {
    sourcesList.innerHTML = `<div class="state-empty">Sin datos de fuentes</div>`;
    return;
  }
  const max = Math.max(...sources.map(s => s.count), 1);
  sourcesList.innerHTML = sources.map(s => `
    <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:14px;">
      <span style="font-weight:500;">${escHtml(s.source)}</span>
      <span style="color:var(--text-secondary);">${fmtNumber(s.count)}</span>
    </div>
    <div style="height:4px; background:var(--bg-dark); border-radius:2px; margin-bottom:12px;">
      <div style="height:100%; width:${(s.count/max)*100}%; background:var(--primary-color); border-radius:2px;"></div>
    </div>
  `).join('');
}

function renderCampaigns(campaigns) {
  if (!campaigns || campaigns.length === 0) {
    campaignList.innerHTML = `<div class="state-empty">Sin campañas</div>`;
    return;
  }
  const max = Math.max(...campaigns.map(c => c.count), 1);
  campaignList.innerHTML = campaigns.map(c => `
    <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:14px;">
      <span style="font-weight:500;" title="${escHtml(c.campaign)}">${escHtml(c.campaign)}</span>
      <span style="color:var(--text-secondary);">${fmtNumber(c.count)}</span>
    </div>
    <div style="height:4px; background:var(--bg-dark); border-radius:2px; margin-bottom:12px;">
      <div style="height:100%; width:${(c.count/max)*100}%; background:var(--primary-color); border-radius:2px;"></div>
    </div>
  `).join('');
}

function renderTrend(trend) {
  if (!trend || trend.length === 0) {
    trendChartWrap.innerHTML = `<div class="state-empty">Sin datos</div>`;
    return;
  }

  const maxVal   = Math.max(...trend.map(d => Math.max(d.created, d.completed)), 1);
  const W        = 540;
  const H        = 160;
  const padL     = 32;
  const padR     = 12;
  const padT     = 12;
  const padB     = 28;
  const chartW   = W - padL - padR;
  const chartH   = H - padT - padB;
  const n        = trend.length;
  const step     = n > 1 ? chartW / (n - 1) : chartW;

  const px = i => padL + i * step;
  const py = v => padT + chartH - (v / maxVal) * chartH;

  // Paths
  const createdPts = trend.map((d, i) => `${px(i)},${py(d.created)}`).join(' L ');
  const createdPath = `M ${createdPts}`;
  
  const completedPts = trend.map((d, i) => `${px(i)},${py(d.completed)}`).join(' L ');
  const completedPath = `M ${completedPts}`;

  // Axes
  const labelIdxs = new Set([0, n - 1]);
  if (n > 7) labelIdxs.add(Math.floor(n / 2));
  
  const xLabels = [...labelIdxs].map(i => {
    const d = trend[i];
    const lbl = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: TZ }).format(new Date(d.date + 'T12:00:00'));
    return `<text class="chart-axis-label" x="${px(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${escHtml(lbl)}</text>`;
  }).join('');
  const yLabel = `<text class="chart-axis-label" x="${padL - 4}" y="${padT}" text-anchor="end" dominant-baseline="middle">${fmtNumber(maxVal)}</text>`;

  // Hover dots
  const hoverDots = trend.map((d, i) => `
    <circle
      class="chart-dot" style="stroke: #0071dc"
      cx="${px(i)}" cy="${py(d.created)}" r="4"
      data-date="${escHtml(d.date)}" data-created="${d.created}" data-completed="${d.completed}"
      tabindex="0" role="img"
    />
  `).join('');

  const svg = `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" aria-label="Gráfico de tendencia" role="img">
      <line class="chart-grid" x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}"/>
      <line class="chart-grid" x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}"/>
      
      <path class="chart-line" d="${createdPath}" style="stroke: #0071dc;" />
      <path class="chart-line" d="${completedPath}" style="stroke: #10b981; stroke-dasharray: 4;" />
      ${hoverDots}
      ${yLabel}
      ${xLabels}
    </svg>
  `;

  trendChartWrap.innerHTML = svg;

  trendChartWrap.querySelectorAll('.chart-dot').forEach(dot => {
    const show = () => {
      const date  = dot.dataset.date;
      const created = dot.dataset.created;
      const completed = dot.dataset.completed;
      const label = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: TZ }).format(new Date(date + 'T12:00:00'));
      chartTooltip.innerHTML = `<strong>${escHtml(label)}</strong><br>Creados: ${fmtNumber(created)}<br>Completados: ${fmtNumber(completed)}`;
      chartTooltip.style.display = 'block';
      const svgRect = trendChartWrap.querySelector('svg').getBoundingClientRect();
      const dotRect = dot.getBoundingClientRect();
      chartTooltip.style.left = `${dotRect.left - svgRect.left + dotRect.width / 2}px`;
      chartTooltip.style.top  = `${dotRect.top  - svgRect.top - 10}px`;
    };
    const hide = () => chartTooltip.style.display = 'none';
    dot.addEventListener('mouseenter', show);
    dot.addEventListener('focus', show);
    dot.addEventListener('mouseleave', hide);
    dot.addEventListener('blur', hide);
  });
}

// ── Handlers ──────────────────────────────────────────────────────────
async function handleExport() {
  exportCsvBtn.disabled = true;
  exportCsvBtn.classList.add('spinning');
  try {
    const params = getFilterParams();
    window.location.href = `/api/admin/analytics/export?${params.toString()}`;
  } catch (err) {
    console.error(err);
  } finally {
    setTimeout(() => {
      exportCsvBtn.disabled = false;
      exportCsvBtn.classList.remove('spinning');
    }, 2000); // give it time to trigger download
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

  if (['SUPER_ADMIN', 'ADMIN'].includes(userObj.role)) {
    exportCsvBtn.style.display = 'inline-flex';
  }

  app.style.display = 'flex';
  app.removeAttribute('aria-hidden');
  app.classList.add('visible');
  appLoader.classList.add('hidden');
  setTimeout(() => appLoader.style.display = 'none', 350);

  // Set default dates (last 30 days)
  const dTo = new Date();
  const dFrom = new Date(dTo.getTime() - 30*24*60*60*1000);
  filterTo.value = dTo.toISOString().split('T')[0];
  filterFrom.value = dFrom.toISOString().split('T')[0];

  await fetchFacets();
  await loadAnalytics();

  // Listeners
  filtersForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loadAnalytics();
  });
  
  resetFiltersBtn.addEventListener('click', () => {
    filterSource.value = '';
    filterMedium.value = '';
    filterCampaign.value = '';
    filterStatus.value = '';
    filterTo.value = new Date().toISOString().split('T')[0];
    filterFrom.value = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
    loadAnalytics();
  });

  exportCsvBtn.addEventListener('click', handleExport);
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
