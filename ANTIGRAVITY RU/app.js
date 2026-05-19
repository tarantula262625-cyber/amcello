// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = '/api';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const datePicker      = document.getElementById('datePicker');
const loadBtn         = document.getElementById('loadBtn');
const refreshBtn      = document.getElementById('refreshBtn');
const searchInput     = document.getElementById('searchInput');
const statusDot       = document.getElementById('statusDot');
const statusText      = document.getElementById('statusText');
const summaryBar      = document.getElementById('summaryBar');
const totalMatchesEl  = document.getElementById('totalMatches');
const withOddsEl      = document.getElementById('withOdds');
const cacheBadge      = document.getElementById('cacheBadge');
const loadingWrap     = document.getElementById('loadingWrap');
const loadingText     = document.getElementById('loadingText');
const errorBox        = document.getElementById('errorBox');
const errorMsg        = document.getElementById('errorMsg');
const emptyBox        = document.getElementById('emptyBox');
const resultsSection  = document.getElementById('resultsSection');
const leagueContainer = document.getElementById('leagueContainer');

// ── State ─────────────────────────────────────────────────────────────────────
let allMatches = [];

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  const today = new Date();
  datePicker.value = formatDate(today);

  loadBtn.addEventListener('click', () => loadOdds(false));
  refreshBtn.addEventListener('click', () => loadOdds(true));
  searchInput.addEventListener('input', filterAndRender);

  checkServerStatus();
  setInterval(checkServerStatus, 15000);

  loadOdds(false);
})();

// ── Server Status ─────────────────────────────────────────────────────────────
async function checkServerStatus() {
  try {
    const res = await fetch(`${API_BASE}/status`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      statusDot.className = 'status-dot online';
      statusText.textContent = 'Server aktiv';
    } else throw new Error();
  } catch {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Server bağlı deyil';
  }
}

// ── Load Odds ─────────────────────────────────────────────────────────────────
async function loadOdds(forceRefresh = false) {
  const date = datePicker.value;
  if (!date) return;

  showLoading('TheStatsAPI-dən məlumat çəkilir...');

  const endpoint = forceRefresh
    ? `${API_BASE}/refresh?date=${date}`
    : `${API_BASE}/odds?date=${date}`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Server xətası: ${res.status}`);
    }

    const data = await res.json();

    // Server iki fərqli field adı istifadə edə bilər: matchId və ya eventId
    allMatches = (data.matches || []).map(m => ({
      ...m,
      // Hər iki formatı dəstəklə
      homeTeam : m.homeTeam  || m.home_team?.name  || m.home_team  || '—',
      awayTeam : m.awayTeam  || m.away_team?.name  || m.away_team  || '—',
      league   : m.league    || m.competition_name || m.competition_id || 'Naməlum',
      score    : m.score     || null,
      matchTime: m.matchTime || m.status           || null,
      bet365   : normalizeBet365(m.bet365),
    }));

    updateSummary(data);
    filterAndRender();
    showResults();
  } catch (err) {
    showError(err.message);
  }
}

// bet365 obyektini normalize et — string "—" dəyərləri null-a çevir
function normalizeBet365(b) {
  if (!b) return null;
  const toNum = v => {
    if (v === null || v === undefined || v === '—' || v === '') return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const open1 = toNum(b.open1);
  const openX = toNum(b.openX);
  const open2 = toNum(b.open2);
  const curr1 = toNum(b.curr1);
  const currX = toNum(b.currX);
  const curr2 = toNum(b.curr2);

  // Heç bir dəyər yoxdursa null qaytar
  if (!open1 && !openX && !open2) return null;

  return { open1, openX, open2, curr1, currX, curr2 };
}

// ── Filter & Render ───────────────────────────────────────────────────────────
function filterAndRender() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? allMatches.filter(m =>
        (m.homeTeam || '').toLowerCase().includes(q) ||
        (m.awayTeam || '').toLowerCase().includes(q) ||
        (m.league   || '').toLowerCase().includes(q)
      )
    : allMatches;

  renderByLeague(filtered);
}

function renderByLeague(matches) {
  leagueContainer.innerHTML = '';

  if (!matches.length) { showEmpty(); return; }

  const leagues = {};
  for (const m of matches) {
    const key = m.league || 'Digər';
    if (!leagues[key]) leagues[key] = [];
    leagues[key].push(m);
  }

  // Liqa adlarını əlifba sırası ilə göstər
  const sorted = Object.entries(leagues).sort(([a], [b]) => a.localeCompare(b));
  for (const [league, leagueMatches] of sorted) {
    leagueContainer.appendChild(buildLeagueBlock(league, leagueMatches));
  }
}

function buildLeagueBlock(league, matches) {
  const block = document.createElement('div');
  block.className = 'league-block';

  const header = document.createElement('div');
  header.className = 'league-header';
  header.innerHTML = `
    <span class="league-flag">🏆</span>
    <span class="league-name">${escHtml(league)}</span>
    <span class="league-count">${matches.length} matç</span>
  `;
  block.appendChild(header);

  const table = document.createElement('table');
  table.className = 'match-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="text-align:left">Matç</th>
        <th>Hesab</th>
        <th>1 (Ev)</th>
        <th>X (Heç)</th>
        <th>2 (Qonaq)</th>
        <th>Mənbə</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  for (const m of matches) tbody.appendChild(buildMatchRow(m));

  block.appendChild(table);
  return block;
}

function buildMatchRow(m) {
  const tr = document.createElement('tr');
  tr.className = 'match-row';

  const b       = m.bet365;
  const hasOdds = b && (b.open1 || b.openX || b.open2);

  const diff1 = hasOdds && b.curr1 != null && b.open1 != null ? (b.curr1 - b.open1).toFixed(2) : null;
  const diffX = hasOdds && b.currX != null && b.openX != null ? (b.currX - b.openX).toFixed(2) : null;
  const diff2 = hasOdds && b.curr2 != null && b.open2 != null ? (b.curr2 - b.open2).toFixed(2) : null;

  tr.innerHTML = `
    <td class="teams-cell">
      <div class="teams-wrap">
        <span class="team-name">${escHtml(m.homeTeam || '—')}</span>
        <span class="team-vs">vs</span>
        <span class="team-name">${escHtml(m.awayTeam || '—')}</span>
        ${m.matchTime ? `<span class="match-time-small">⏰ ${escHtml(m.matchTime)}</span>` : ''}
      </div>
    </td>
    <td class="score-cell">
      ${m.score ? `<span class="score-badge">${escHtml(m.score)}</span>` : '<span style="color:var(--text3)">—</span>'}
    </td>
    ${hasOdds ? `
      <td class="odds-cell">
        <div class="odds-val">
          <span class="odds-open home">${fmt(b.open1)}</span>
          <span class="odds-lbl">Opening</span>
          ${b.curr1 != null && diff1 !== '0.00' ? `<span class="odds-curr ${diffClass(diff1)}">${fmt(b.curr1)} ${diffArrow(diff1)}</span>` : ''}
        </div>
      </td>
      <td class="odds-cell">
        <div class="odds-val">
          <span class="odds-open draw">${fmt(b.openX)}</span>
          <span class="odds-lbl">Opening</span>
          ${b.currX != null && diffX !== '0.00' ? `<span class="odds-curr ${diffClass(diffX)}">${fmt(b.currX)} ${diffArrow(diffX)}</span>` : ''}
        </div>
      </td>
      <td class="odds-cell">
        <div class="odds-val">
          <span class="odds-open away">${fmt(b.open2)}</span>
          <span class="odds-lbl">Opening</span>
          ${b.curr2 != null && diff2 !== '0.00' ? `<span class="odds-curr ${diffClass(diff2)}">${fmt(b.curr2)} ${diffArrow(diff2)}</span>` : ''}
        </div>
      </td>
      <td class="odds-cell" style="font-size:12px;color:var(--green)">Bet365</td>
    ` : `
      <td class="no-odds-cell" colspan="4">Bet365 odds yoxdur</td>
    `}
  `;
  return tr;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(v) {
  if (v == null) return '—';
  return parseFloat(v).toFixed(2);
}

function diffClass(d) {
  if (!d) return '';
  const n = parseFloat(d);
  if (n > 0.01)  return 'odds-up';
  if (n < -0.01) return 'odds-down';
  return '';
}

function diffArrow(d) {
  if (!d) return '';
  const n = parseFloat(d);
  if (n > 0.01)  return '▲';
  if (n < -0.01) return '▼';
  return '';
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateSummary(data) {
  const total = (data.matches || []).length;
  const withO = (data.matches || []).filter(m => {
    const b = m.bet365;
    if (!b) return false;
    const open1 = parseFloat(b.open1);
    return !isNaN(open1) && open1 > 1;
  }).length;

  totalMatchesEl.textContent = total;
  withOddsEl.textContent     = withO;

  if (data.fromCache) {
    cacheBadge.textContent = '📦 Keş';
    cacheBadge.className   = 'cache-badge cached';
  } else {
    cacheBadge.textContent = '⚡ Süratli API';
    cacheBadge.className   = 'cache-badge live';
  }
}

// ── Show/Hide states ──────────────────────────────────────────────────────────
function showLoading(msg) {
  loadingText.textContent      = msg || 'Yüklənir...';
  loadingWrap.style.display    = 'flex';
  errorBox.style.display       = 'none';
  emptyBox.style.display       = 'none';
  resultsSection.style.display = 'none';
  summaryBar.style.display     = 'none';
}

function showResults() {
  loadingWrap.style.display    = 'none';
  errorBox.style.display       = 'none';
  emptyBox.style.display       = 'none';
  resultsSection.style.display = 'block';
  summaryBar.style.display     = 'flex';
}

function showError(msg) {
  errorMsg.textContent         = msg;
  loadingWrap.style.display    = 'none';
  errorBox.style.display       = 'flex';
  emptyBox.style.display       = 'none';
  resultsSection.style.display = 'none';
}

function showEmpty() {
  emptyBox.style.display = 'flex';
}
