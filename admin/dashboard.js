/**
 * admin/dashboard.js
 * BAIT Prepago — Admin Dashboard client
 *
 * Rules:
 * - No inline event handlers in HTML
 * - No localStorage / sessionStorage / IndexedDB
 * - No external libraries
 * - CSP safe: runs as type="module"
 * - Dates: Intl.DateTimeFormat, locale es-MX, tz America/Mexico_City
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
const rangeSelect     = document.getElementById('rangeSelect');
const refreshBtn      = document.getElementById('refreshBtn');
const kpiGrid         = document.getElementById('kpiGrid');
const trendChartWrap  = document.getElementById('trendChartWrap');
const trendSubtitle   = document.getElementById('trendSubtitle');
const chartTooltip    = document.getElementById('chartTooltip');
const sourcesList     = document.getElementById('sourcesList');
const campaignList    = document.getElementById('campaignList');
const activityBody    = document.getElementById('activityBody');
const statusLive      = document.getElementById('statusLive');

// ── State ─────────────────────────────────────────────────────────────
let currentRange = 14;
let isLoading    = false;

// ── Helpers ───────────────────────────────────────────────────────────
function fmtDate(isoStr) {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: '2-digit'
  }).format(new Date(isoStr));
}

function fmtDateTime(isoStr) {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(isoStr));
}

function fmtNumber(n) {
  return new Intl.NumberFormat(LOCALE).format(n);
}

function setStatus(msg) {
  statusLive.textContent = msg;
}

function escHtml(str) {
  if (!str) return '';
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

// ── Render helpers ────────────────────────────────────────────────────

/** Render KPI skeleton (4 cards) */
function renderKpiSkeleton() {
  const defs = [
    { label: 'Total de leads',   support: 'Todos los registros' },
    { label: 'Últimas 24 h',     support: 'Desde hace 24 horas' },
    { label: 'Últimos 7 días',   support: 'Desde hace 7 días' },
    { label: 'Con atribución',   support: 'Tienen utm_source' }
  ];
  kpiGrid.innerHTML = defs.map(d => `
    <article class="kpi-card" aria-label="${escHtml(d.label)}">
      <div class="kpi-label">${escHtml(d.label)}</div>
      <div class="kpi-value skeleton" aria-hidden="true"></div>
      <div class="kpi-support skeleton" aria-hidden="true"></div>
    </article>
  `).join('');
}

/** Render real KPI cards */
function renderKpis(kpis) {
  const defs = [
    {
      label:   'Total de leads',
      value:   fmtNumber(kpis.total),
      support: 'Todos los registros capturados'
    },
    {
      label:   'Últimas 24 h',
      value:   fmtNumber(kpis.last24Hours),
      support: 'Nuevos en las últimas 24 horas'
    },
    {
      label:   'Últimos 7 días',
      value:   fmtNumber(kpis.last7Days),
      support: 'Nuevos en los últimos 7 días'
    },
    {
      label:   'Con atribución',
      value:   `${kpis.attributionRate}%`,
      support: 'Leads con utm_source registrado'
    }
  ];
  kpiGrid.innerHTML = defs.map(d => `
    <article class="kpi-card">
      <div class="kpi-label">${escHtml(d.label)}</div>
      <div class="kpi-value">${escHtml(d.value)}</div>
      <div class="kpi-support">${escHtml(d.support)}</div>
    </article>
  `).join('');
}

/** Build an SVG trend chart from trend array [{date, leads}] */
function renderTrendChart(trend, range) {
  trendSubtitle.textContent = `Últimos ${range} días`;

  if (!trend || trend.length === 0) {
    trendChartWrap.innerHTML = `
      <div class="state-empty">
        <div class="state-icon" aria-hidden="true">📈</div>
        <p class="state-title">Sin datos de tendencia</p>
        <p class="state-sub">No hay leads en el período seleccionado</p>
      </div>`;
    return;
  }

  const maxVal   = Math.max(...trend.map(d => d.leads), 1);
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

  // Path for line
  const linePts = trend.map((d, i) => `${px(i)},${py(d.leads)}`).join(' L ');
  const linePath = `M ${linePts}`;

  // Path for area fill (close below)
  const areaPath = `M ${px(0)},${py(0)} L ${linePts} L ${px(n - 1)},${padT + chartH} L ${px(0)},${padT + chartH} Z`;

  // X-axis labels: show first, last, and middle if range > 7
  const labelIdxs = new Set([0, n - 1]);
  if (n > 7) labelIdxs.add(Math.floor(n / 2));

  const xLabels = [...labelIdxs].map(i => {
    const d = trend[i];
    const label = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: TZ }).format(new Date(d.date + 'T12:00:00'));
    return `<text class="chart-axis-label" x="${px(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${escHtml(label)}</text>`;
  }).join('');

  // Y-axis max label
  const yLabel = `<text class="chart-axis-label" x="${padL - 4}" y="${padT}" text-anchor="end" dominant-baseline="middle">${fmtNumber(maxVal)}</text>`;

  // Hover dots (invisible circles for mouse events)
  const hoverCircles = trend.map((d, i) => `
    <circle
      class="chart-dot"
      cx="${px(i)}" cy="${py(d.leads)}" r="4"
      data-date="${escHtml(d.date)}" data-leads="${d.leads}"
      tabindex="0"
      aria-label="${new Intl.DateTimeFormat(LOCALE, {month:'short',day:'numeric',timeZone:TZ}).format(new Date(d.date+'T12:00:00'))}: ${d.leads} leads"
      role="img"
    />
  `).join('');

  const svg = `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" aria-label="Gráfico de tendencia de leads" role="img">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#0071dc" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#0071dc" stop-opacity="0.01"/>
        </linearGradient>
      </defs>

      <!-- Grid line at top -->
      <line class="chart-grid" x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}"/>
      <line class="chart-grid" x1="${padL}" y1="${padT + chartH / 2}" x2="${W - padR}" y2="${padT + chartH / 2}"/>
      <line class="chart-grid" x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}"/>

      <!-- Area fill -->
      <path class="chart-area" d="${areaPath}"/>

      <!-- Line -->
      <path class="chart-line" d="${linePath}"/>

      <!-- Dots -->
      ${hoverCircles}

      <!-- Labels -->
      ${yLabel}
      ${xLabels}
    </svg>
  `;

  trendChartWrap.innerHTML = svg;

  // Add tooltip behavior
  trendChartWrap.querySelectorAll('.chart-dot').forEach(dot => {
    const show = () => {
      const date  = dot.dataset.date;
      const leads = dot.dataset.leads;
      const label = new Intl.DateTimeFormat(LOCALE, { month: 'long', day: 'numeric', timeZone: TZ }).format(new Date(date + 'T12:00:00'));
      chartTooltip.textContent = `${label}: ${fmtNumber(Number(leads))} leads`;
      chartTooltip.style.display = 'block';
      chartTooltip.removeAttribute('aria-hidden');
      const svgEl = trendChartWrap.querySelector('svg');
      const svgRect = svgEl.getBoundingClientRect();
      const dotRect = dot.getBoundingClientRect();
      chartTooltip.style.left = `${dotRect.left - svgRect.left + dotRect.width / 2}px`;
      chartTooltip.style.top  = `${dotRect.top  - svgRect.top}px`;
    };
    const hide = () => {
      chartTooltip.style.display = 'none';
      chartTooltip.setAttribute('aria-hidden', 'true');
    };
    dot.addEventListener('mouseenter', show);
    dot.addEventListener('focus',      show);
    dot.addEventListener('mouseleave', hide);
    dot.addEventListener('blur',       hide);
  });
}

/** Render horizontal bar source chart */
function renderSources(sources) {
  if (!sources || sources.length === 0) {
    sourcesList.innerHTML = `
      <div class="state-empty" style="padding:24px 0">
        <div class="state-icon" aria-hidden="true">🔍</div>
        <p class="state-title">Sin datos de fuentes</p>
        <p class="state-sub">No hay leads con utm_source en este período</p>
      </div>`;
    return;
  }

  sourcesList.innerHTML = sources.map(s => `
    <div class="source-row" role="listitem">
      <div class="source-meta">
        <span class="source-name">${escHtml(s.source)}</span>
        <span class="source-count">${fmtNumber(s.count)} (${s.percentage}%)</span>
      </div>
      <div class="source-bar-bg" role="progressbar" aria-valuenow="${s.percentage}" aria-valuemin="0" aria-valuemax="100" aria-label="${escHtml(s.source)}: ${s.percentage}%">
        <div class="source-bar-fill" style="width:${s.percentage}%"></div>
      </div>
    </div>
  `).join('');
}

/** Render campaigns ranking */
function renderCampaigns(campaigns) {
  if (!campaigns || campaigns.length === 0) {
    campaignList.innerHTML = `
      <div class="state-empty" style="padding:24px 0">
        <div class="state-icon" aria-hidden="true">📣</div>
        <p class="state-title">Sin campañas</p>
        <p class="state-sub">No hay leads con utm_campaign en este período</p>
      </div>`;
    return;
  }

  campaignList.innerHTML = campaigns.map((c, i) => `
    <div class="campaign-row" role="listitem">
      <div class="campaign-rank" aria-hidden="true">${i + 1}</div>
      <div class="campaign-name" title="${escHtml(c.campaign)}">${escHtml(c.campaign)}</div>
      <div class="campaign-count">${fmtNumber(c.count)}</div>
    </div>
  `).join('');
}

/** Render recent activity table */
function renderActivity(items) {
  if (!items || items.length === 0) {
    activityBody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center;padding:32px;color:var(--text-tertiary);">
          Aún no hay leads para mostrar
        </td>
      </tr>`;
    return;
  }

  activityBody.innerHTML = items.map(item => {
    const dateStr = fmtDateTime(item.createdAt);
    const srcClass = item.source === 'Sin atribución' ? 'tag tag-gray' : 'tag';
    const campaign = item.campaign
      ? `<span class="tag" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;display:inline-block;">${escHtml(item.campaign)}</span>`
      : `<span style="color:var(--text-tertiary);font-size:12px;">—</span>`;

    return `
      <tr>
        <td class="time-cell">${escHtml(dateStr)}</td>
        <td><span class="${srcClass}">${escHtml(item.source)}</span></td>
        <td>${campaign}</td>
      </tr>`;
  }).join('');
}

/** Show full-page error state inside page body */
function renderError(onRetry) {
  // Only replace inner sections, keep structure
  kpiGrid.innerHTML = `<div style="grid-column:1/-1" class="state-error">
    <div class="state-icon" aria-hidden="true">⚠️</div>
    <p class="state-title">No pudimos cargar los datos del dashboard.</p>
    <p class="state-sub">Verifica tu conexión o inténtalo de nuevo.</p>
    <button class="btn-retry" id="retryBtn">Reintentar</button>
  </div>`;
  document.getElementById('retryBtn')?.addEventListener('click', onRetry);

  trendChartWrap.innerHTML = '';
  sourcesList.innerHTML = '';
  campaignList.innerHTML = '';
  activityBody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-tertiary);">—</td></tr>`;
}

// ── Load dashboard data ────────────────────────────────────────────────
async function loadDashboard(range) {
  if (isLoading) return;
  isLoading = true;

  setStatus('Actualizando datos...');
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');

  // Show skeletons
  renderKpiSkeleton();
  trendChartWrap.innerHTML = `<div class="chart-skeleton skeleton" aria-hidden="true"></div>`;
  sourcesList.innerHTML    = `<div class="source-row skeleton" style="height:56px;margin-bottom:8px"></div>`.repeat(3);
  campaignList.innerHTML   = `<div class="campaign-row skeleton" style="height:40px;margin-bottom:4px"></div>`.repeat(3);
  activityBody.innerHTML   = `<tr><td colspan="3"><div class="skeleton" style="height:36px;margin:4px 12px"></div></td></tr>`.repeat(5);

  try {
    const res = await fetch(`/api/admin/overview?range=${encodeURIComponent(range)}`, {
      credentials: 'same-origin'
    });

    if (res.status === 401) {
      // Session expired — clear DOM, redirect
      clearDashboardDOM();
      window.location.href = '/admin/';
      return;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    renderKpis(data.kpis);
    renderTrendChart(data.trend, data.range);
    renderSources(data.sources);
    renderCampaigns(data.campaigns);
    renderActivity(data.recentActivity);

    const genAt = new Intl.DateTimeFormat(LOCALE, {
      timeZone: TZ,
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(data.generatedAt));
    setStatus(`Datos actualizados a las ${genAt}`);

  } catch (err) {
    console.warn('Dashboard load error:', err.message);
    renderError(() => loadDashboard(currentRange));
    setStatus('Error al cargar datos');
  } finally {
    isLoading = false;
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('spinning');
  }
}

/** Clear sensitive DOM data before logout/redirect */
function clearDashboardDOM() {
  kpiGrid.innerHTML       = '';
  trendChartWrap.innerHTML= '';
  sourcesList.innerHTML   = '';
  campaignList.innerHTML  = '';
  activityBody.innerHTML  = '';
  userEmailEl.textContent = '';
  userRoleEl.textContent  = '';
  userAvatar.textContent  = '';
}

// ── Sidebar mobile ────────────────────────────────────────────────────
function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('show');
  hamburgerBtn.setAttribute('aria-expanded', 'true');
  sidebar.focus();
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
  hamburgerBtn.setAttribute('aria-expanded', 'false');
}

// ── Boot ──────────────────────────────────────────────────────────────
async function boot() {
  const user = await checkSession();

  if (!user) {
    window.location.href = '/admin/';
    return;
  }

  // Populate user info
  const initials = (user.email || '?').charAt(0).toUpperCase();
  userAvatar.textContent  = initials;
  userEmailEl.textContent = user.email;
  userRoleEl.textContent  = user.role;

  // Show app, hide loader
  app.style.display = 'flex';
  app.removeAttribute('aria-hidden');
  app.classList.add('visible');
  appLoader.classList.add('hidden');
  setTimeout(() => { appLoader.style.display = 'none'; }, 350);

  // Initial data load
  await loadDashboard(currentRange);

  // ── Event listeners ────────────────────────────────────────────────

  rangeSelect.addEventListener('change', () => {
    const v = parseInt(rangeSelect.value, 10);
    if ([7, 14, 30].includes(v)) {
      currentRange = v;
      loadDashboard(currentRange);
    }
  });

  refreshBtn.addEventListener('click', () => {
    loadDashboard(currentRange);
  });

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });
    } catch { /* ignore network error */ }
    clearDashboardDOM();
    window.location.href = '/admin/';
  });

  hamburgerBtn.addEventListener('click', openSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  // Close sidebar on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeSidebar();
    }
  });
}

// Entry point
boot();
