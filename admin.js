// ===== VELARYN ADMIN PANEL v3 =====
const SUPABASE_URL = 'https://kklwsrrlynmpsyispbyn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrbHdzcnJseW5tcHN5aXNwYnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDU5NDEsImV4cCI6MjA4NTkyMTk0MX0.rA62ShgmXMvGyDl5cxEd4s-rIBEV1Spn0HX8YF_Qjrc';
const ADMIN_PASSWORD = 'velaryn2024';
const LOGIN_ATTEMPTS_MAX = 5;
const LOGIN_COOLDOWN_MS = 60000;

// State
let currentTab = 'agencies';
let usersData = [];
let blockedData = [];
let licenseKeysData = [];
let userDataCache = {};
let autoRefreshInterval = null;
let profileRefreshInterval = null;
let currentProfileId = null;
let usersFilter = 'active';
let trackerUsersData = [];
let trackerNotes = {};
let trackerNickToId = {};
let trackerTransactions = [];
let usersSortBy = 'last_seen';
let usersSortDesc = true;
let usersPage = 1;
let usersPageSize = 25;
let usersSelectedIds = new Set();
let loadAbortController = null;
let usersViewMode = 'ip'; // 'ip' | 'device' — по умолчанию группировка по IP
let expandedIPs = new Set();
let agencyRealtimeUnsubscribe = null;
let agencyPollingInterval = null;

// ===== THEME =====
function applyTheme(theme) {
  let resolved = theme;
  if (theme === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', resolved);
}
function initTheme() {
  const saved = localStorage.getItem('velaryn_admin_theme') || 'system';
  const setSelectValue = (el, v) => { if (el) el.value = v; };
  setSelectValue(document.getElementById('themeSelect'), saved);
  setSelectValue(document.getElementById('themeSelectLogin'), saved);
  applyTheme(saved);
  const onThemeChange = (e) => {
    const v = e.target.value;
    localStorage.setItem('velaryn_admin_theme', v);
    setSelectValue(document.getElementById('themeSelect'), v);
    setSelectValue(document.getElementById('themeSelectLogin'), v);
    applyTheme(v);
  };
  document.getElementById('themeSelect')?.addEventListener('change', onThemeChange);
  document.getElementById('themeSelectLogin')?.addEventListener('change', onThemeChange);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('velaryn_admin_theme') || 'system') === 'system') applyTheme('system');
  });
}

// ===== AUTH =====
let loginAttempts = 0;
let loginLockedUntil = 0;
function login() {
  const pwInput = document.getElementById('passwordInput');
  const pw = pwInput?.value?.trim() || '';
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const now = Date.now();
  if (now < loginLockedUntil) {
    const remaining = Math.ceil((loginLockedUntil - now) / 1000);
    showToast(`Too many attempts. Try again in ${remaining}s`, 'error');
    return;
  }
  if (!pw) {
    if (loginError) { loginError.textContent = 'Enter password'; loginError.style.display = 'block'; }
    return;
  }
  if (loginError) loginError.style.display = 'none';
  loginBtn.disabled = true;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.add('active');
    localStorage.setItem('velaryn_admin_auth', 'true');
    loadData();
    startAutoRefresh();
    loginAttempts = 0;
  } else {
    loginAttempts++;
    showToast('Invalid password', 'error');
    if (loginAttempts >= LOGIN_ATTEMPTS_MAX) {
      loginLockedUntil = now + LOGIN_COOLDOWN_MS;
      showToast(`Locked for ${LOGIN_COOLDOWN_MS / 1000}s after ${LOGIN_ATTEMPTS_MAX} failed attempts`, 'error');
    }
  }
  loginBtn.disabled = false;
}

function logout() {
  localStorage.removeItem('velaryn_admin_auth');
  stopAutoRefresh();
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('dashboard').classList.remove('active');
}

function checkAuth() {
  if (localStorage.getItem('velaryn_admin_auth') === 'true') {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.add('active');
    loadData();
    startAutoRefresh();
  }
}

// ===== AUTO REFRESH =====
function startAutoRefresh() {
  if (autoRefreshInterval) return;
  autoRefreshInterval = setInterval(loadData, 15000);
}
function stopAutoRefresh() {
  if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
}

// ===== SUPABASE HELPERS =====
// If you have a service_role key, set it here for full write access:
const SUPABASE_SERVICE_KEY = null; // e.g. 'eyJ...' — set this if anon key gets 401

function sbHeaders() {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${key}` };
}
function sbHeadersWrite(prefer) {
  return { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': prefer || 'return=minimal' };
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${r.status} ${t}`);
  }
  return r.json();
}

async function sbPost(path, data, prefer) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST', headers: sbHeadersWrite(prefer), body: JSON.stringify(data)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`POST ${path} failed: ${r.status} ${t}`);
  }
  if (prefer === 'return=representation') return r.json();
}

async function sbPatch(path, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: sbHeadersWrite(), body: JSON.stringify(data)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`PATCH ${path} failed: ${r.status} ${t}`);
  }
}

async function sbDelete(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE', headers: { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`DELETE ${path} failed: ${r.status} ${t}`);
  }
}

async function loadWithRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function showErrorBoundary(msg) {
  const el = document.getElementById('errorBoundary');
  const msgEl = document.getElementById('errorBoundaryMsg');
  if (el && msgEl) {
    msgEl.textContent = msg || 'An unexpected error occurred.';
    el.style.display = 'flex';
  }
}

// ===== DATA LOADING =====
async function loadData() {
  if (loadAbortController) loadAbortController.abort();
  loadAbortController = new AbortController();
  const signal = loadAbortController.signal;
  try {
    const [users, blocked, keys] = await loadWithRetry(async () => {
      const [u, b, k] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/users?select=*&order=last_heartbeat.desc.nullslast,last_seen.desc`, { headers: sbHeaders(), signal }).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status))),
        fetch(`${SUPABASE_URL}/rest/v1/blocked_ips?select=*&order=blocked_at.desc`, { headers: sbHeaders(), signal }).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status))),
        fetch(`${SUPABASE_URL}/rest/v1/license_keys?select=*&order=created_at.desc`, { headers: sbHeaders(), signal }).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      ]);
      return [u, b, k];
    });
    usersData = users;
    blockedData = blocked;
    licenseKeysData = keys;
    updateStats();
    if (currentTab === 'users' && !currentProfileId) renderUsersTable();
    if (currentTab === 'blocked') renderBlockedTable();
    if (currentTab === 'keys') renderKeysTab();
    if (currentTab === 'agencies') loadAgencies();
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Failed to load data:', error);
    showToast('Failed to load data. Retrying...', 'error');
    setTimeout(loadData, 3000);
  }
}

// ===== STATS =====
function updateStats() {
  const blockedIPs = new Set(blockedData.map(b => b.ip));
  const onlineCount = usersData.filter(u => {
    if (blockedIPs.has(u.ip)) return false;
    return isOnline(u);
  }).length;
  const totalMessages = usersData.reduce((sum, u) => sum + (u.messages_sent || 0), 0);
  const activeKeys = licenseKeysData.filter(k => k.status === 'active').length;

  // В режиме IP — считаем уникальные IP, иначе устройства
  const totalCount = usersViewMode === 'ip'
    ? new Set(usersData.map(u => u.ip || 'no-ip')).size
    : usersData.length;
  setText('totalUsers', totalCount);
  setText('onlineUsers', onlineCount);
  setText('blockedUsers', blockedData.length);
  setText('totalMessages', totalMessages);
  setText('statActiveKeys', `${activeKeys}/${licenseKeysData.length}`);
}

// ===== TABS =====
function showTab(tab) {
  currentTab = tab;
  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (navEl) navEl.classList.add('active');
  // Close profile if open
  if (currentProfileId) closeUserProfile();
  // Show/hide sections
  setDisplay('usersSection', tab === 'users' ? 'block' : 'none');
  setDisplay('blockedSection', tab === 'blocked' ? 'block' : 'none');
  setDisplay('keysSection', tab === 'keys' ? 'block' : 'none');
  setDisplay('agenciesSection', tab === 'agencies' ? 'block' : 'none');
  if (tab === 'agencies') loadAgencies();
  const titles = { users: 'Users', blocked: 'Blocked IPs', keys: 'Licenses', agencies: 'Agencies' };
  const descs = { users: 'View and manage all registered devices. Group by IP or see individual devices.', blocked: 'IP addresses that are denied access to the extension.', keys: 'Generate and manage license keys for users.', agencies: 'Create and manage agencies, generate codes, control access.' };
  setText('pageTitle', titles[tab] || 'Dashboard');
  const descEl = document.getElementById('pageDesc');
  if (descEl) descEl.textContent = descs[tab] || '';
  loadData();
}

// ===== RENDER: USERS TABLE =====
function getFilteredAndSortedUsers() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  let filtered = usersData;
  if (usersFilter === 'active') filtered = filtered.filter(u => u.license_status === 'activated');
  else if (usersFilter === 'inactive') filtered = filtered.filter(u => u.license_status !== 'activated');
  if (q) {
    filtered = filtered.filter(u =>
      (u.ip || '').toLowerCase().includes(q) ||
      (u.device_id || '').toLowerCase().includes(q) ||
      (u.country || '').toLowerCase().includes(q) ||
      (u.city || '').toLowerCase().includes(q) ||
      (u.note || '').toLowerCase().includes(q)
    );
  }
  const cmp = (a, b) => {
    let va = a, vb = b;
    if (usersSortBy === 'last_seen' || usersSortBy === 'messages') {
      va = Number(va) || 0; vb = Number(vb) || 0;
    }
    if (va < vb) return usersSortDesc ? 1 : -1;
    if (va > vb) return usersSortDesc ? -1 : 1;
    return 0;
  };
  const getVal = u => {
    if (usersSortBy === 'ip') return (u.ip || '').toLowerCase();
    if (usersSortBy === 'country') return (u.country || '').toLowerCase();
    if (usersSortBy === 'messages') return u.messages_sent || 0;
    return new Date(u.last_heartbeat || u.last_seen || 0).getTime();
  };
  filtered = [...filtered].sort((a, b) => cmp(getVal(a), getVal(b)));
  return filtered;
}

// Группировка по IP: { ip, devices, count }. devices сортируются по last_seen desc.
function getGroupedByIP(filtered) {
  const groups = new Map();
  for (const u of filtered) {
    const ip = u.ip || 'no-ip';
    if (!groups.has(ip)) groups.set(ip, { ip, devices: [], count: 0 });
    groups.get(ip).devices.push(u);
    groups.get(ip).count++;
  }
  for (const g of groups.values()) {
    g.devices.sort((a, b) => new Date(b.last_heartbeat || b.last_seen || 0).getTime() - new Date(a.last_heartbeat || a.last_seen || 0).getTime());
  }
  return Array.from(groups.values());
}

function toggleIPExpand(ip) {
  if (expandedIPs.has(ip)) expandedIPs.delete(ip);
  else expandedIPs.add(ip);
  renderUsersTable();
}

function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  const blockedIPs = new Set(blockedData.map(b => b.ip));

  document.querySelectorAll('th.sortable').forEach(h => {
    h.classList.remove('sort-asc', 'sort-desc');
    if (h.dataset.sort === usersSortBy) h.classList.add(usersSortDesc ? 'sort-desc' : 'sort-asc');
  });

  const activeCount = usersData.filter(u => u.license_status === 'activated').length;
  const inactiveCount = usersData.filter(u => u.license_status !== 'activated').length;
  const allCount = usersData.length;
  setText('filterCountAll', allCount);
  setText('filterCountActive', activeCount);
  setText('filterCountInactive', inactiveCount);

  const titleEl = document.getElementById('usersTitle');
  if (titleEl) {
    const titles = { all: 'All Users', active: 'Active Users', inactive: 'Inactive Users' };
    titleEl.textContent = titles[usersFilter] || 'All Users';
  }

  const filtered = getFilteredAndSortedUsers();
  const isIPMode = usersViewMode === 'ip';

  let dataToRender, totalCount, pageDataForSelect;
  if (isIPMode) {
    const groups = getGroupedByIP(filtered);
    totalCount = groups.length;
    const start = (usersPage - 1) * usersPageSize;
    const pageGroups = groups.slice(start, start + usersPageSize);
    pageDataForSelect = pageGroups.flatMap(g => g.devices);
    const rows = [];
    for (const grp of pageGroups) {
      const expanded = expandedIPs.has(grp.ip);
      const singleDevice = grp.count === 1;
      const arrow = grp.count > 1 ? (expanded ? '▼' : '▶') : '';
      const ini = getInitials(grp.ip === 'no-ip' ? '?' : grp.ip);
      const lastDevice = grp.devices[0];
      const online = grp.devices.some(u => isOnline(u));
      const blocked = blockedIPs.has(grp.ip);
      const licensedCount = grp.devices.filter(u => u.license_status === 'activated').length;
      const rowAction = singleDevice ? 'open-profile' : 'toggle-ip';
      const rowData = singleDevice ? `data-device-id="${esc(lastDevice?.device_id || '')}"` : `data-ip="${esc(grp.ip)}"`;
      const grpNote = grp.devices[0]?.note || '';
      const actionsTd = [
        grp.ip !== 'no-ip' ? `<button class="action-btn edit" data-action="edit-ip-note" data-ip="${esc(grp.ip)}" title="Add/Edit note for this IP">📝 Note</button>` : '',
        !blocked ? `<button class="action-btn block" data-action="block-user" data-ip="${esc(grp.ip)}">Block</button>` : ''
      ].filter(Boolean).join('');
      const grpIpDisplay = grp.ip === 'no-ip' ? 'Detecting...' : grp.ip;
      const grpCityRegion = [lastDevice?.city, lastDevice?.region].filter(v => v && v !== 'Unknown').join(', ');
      const grpLastActive = lastDevice?.last_heartbeat || lastDevice?.last_seen;
      rows.push(`<tr class="ip-group-row clickable${expanded ? ' expanded' : ''}" data-action="${rowAction}" ${rowData}>
        <td class="col-check"></td>
        <td><div class="user-cell"><div class="user-avatar">${ini}</div><div class="user-info"><div class="ip">${esc(grpIpDisplay)} <span class="ip-devices-badge">${grp.count} device${grp.count > 1 ? 's' : ''}</span></div><div class="note ip-expand-hint">${grpNote ? esc(grpNote) : (singleDevice ? 'Click to open profile' : arrow + ' Click to expand')}</div></div></div></td>
        <td><div class="location-cell"><span class="country">${esc(lastDevice?.country || 'Unknown')}</span><span class="city">${esc(grpCityRegion)}</span></div></td>
        <td><div class="system-cell">—</div></td>
        <td><div class="stats-cell">—</div></td>
        <td><div class="status-cell">${blocked ? '<span class="badge blocked">Blocked</span>' : `<span class="online-indicator ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>`} <span class="badge badge-small">${licensedCount}/${grp.count} licensed</span></div></td>
        <td class="time-ago">${fmtDate(grpLastActive)}</td>
        <td><div class="actions-cell">${actionsTd}</div></td>
      </tr>`);
      if (expanded && grp.devices.length > 0) {
        for (const u of grp.devices) rows.push(renderUserRow(u, true));
      }
    }
    dataToRender = rows.join('');
    setText('paginationInfo', `Page ${usersPage} of ${Math.max(1, Math.ceil(totalCount / usersPageSize))} (${totalCount} IP groups)`);
  } else {
    totalCount = filtered.length;
    const start = (usersPage - 1) * usersPageSize;
    pageDataForSelect = filtered.slice(start, start + usersPageSize);
    dataToRender = pageDataForSelect.map(u => renderUserRow(u)).join('');
    setText('paginationInfo', `Page ${usersPage} of ${Math.max(1, Math.ceil(totalCount / usersPageSize))} (${totalCount} total)`);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / usersPageSize));
  usersPage = Math.min(usersPage, totalPages);

  document.getElementById('exportUsersBtn').style.display = 'block';
  document.getElementById('findDuplicatesBtn').style.display = 'block';
  const paginationEl = document.getElementById('usersPagination');
  paginationEl.style.display = totalCount > 0 ? 'flex' : 'none';
  document.getElementById('prevPageBtn').disabled = usersPage <= 1;
  document.getElementById('nextPageBtn').disabled = usersPage >= totalPages;
  const pageSizeSel = document.getElementById('pageSizeSelect');
  if (pageSizeSel) pageSizeSel.value = String(usersPageSize);

  const selectAll = document.getElementById('selectAllUsers');
  if (selectAll) selectAll.checked = pageDataForSelect.length > 0 && pageDataForSelect.every(u => usersSelectedIds.has(u.device_id));

  if (totalCount === 0) {
    const msg = usersFilter === 'active' ? 'No active (licensed) users found' : usersFilter === 'inactive' ? 'No inactive users found' : 'No users found';
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><div class="icon">👥</div><div>${msg}</div></td></tr>`;
    document.getElementById('usersBulkBar').style.display = 'none';
    return;
  }

  tbody.innerHTML = dataToRender;

  const bulkBar = document.getElementById('usersBulkBar');
  if (usersSelectedIds.size > 0) {
    bulkBar.style.display = 'flex';
    setText('bulkSelectedCount', `${usersSelectedIds.size} selected`);
  } else {
    bulkBar.style.display = 'none';
  }
  return;
}

function renderUserRow(user, isChild = false) {
  const blockedIPs = new Set(blockedData.map(b => b.ip));
  const blocked = blockedIPs.has(user.ip);
  const online = isOnline(user);
  const ini = getInitials(user.ip || user.device_id || '??');
  const did = user.device_id ? user.device_id.substring(0, 8) : '?';
  const licensed = user.license_status === 'activated';
  const licenseBadge = licensed ? '<span class="badge licensed">Licensed</span>' : '<span class="badge unlicensed">No license</span>';
  const checked = usersSelectedIds.has(user.device_id) ? 'checked' : '';
  const rowClass = (usersSelectedIds.has(user.device_id) ? 'clickable selected' : 'clickable') + (isChild ? ' ip-child-row' : '');
  const ipDisplay = user.ip || 'Detecting...';
  const cityRegion = [user.city, user.region].filter(v => v && v !== 'Unknown').join(', ');
  const lastActive = user.last_heartbeat || user.last_seen;
  return `<tr class="${rowClass}" data-action="open-profile" data-device-id="${esc(user.device_id || '')}" data-ip="${esc(user.ip)}">
    <td class="col-check"><input type="checkbox" class="user-row-check" data-device-id="${esc(user.device_id || '')}" ${checked} onclick="event.stopPropagation()"></td>
    <td><div class="user-cell"><div class="user-avatar">${ini}</div><div class="user-info"><div class="ip">${esc(ipDisplay)}</div><div class="note">${esc(user.note || did)}</div></div></div></td>
    <td><div class="location-cell"><span class="country">${esc(user.country || 'Unknown')}</span><span class="city">${esc(cityRegion)}</span></div></td>
    <td><div class="system-cell"><div class="os">${esc(user.os || 'Unknown')}</div><div class="browser">${esc((user.browser || '') + ' ' + (user.browser_version || ''))}</div></div></td>
    <td><div class="stats-cell"><div class="main-stat">${user.messages_sent || 0} msgs</div><div class="sub-stat">${user.sessions_count || 1} sessions</div></div></td>
    <td><div class="status-cell">${blocked ? '<span class="badge blocked">Blocked</span>' : `<span class="online-indicator ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>`}${licenseBadge}</div></td>
    <td class="time-ago">${fmtDate(lastActive)}</td>
    <td>
      <button class="action-btn edit" data-action="edit-note" data-device-id="${esc(user.device_id || '')}" data-ip="${esc(user.ip)}">✏️</button>
      ${blocked ? '' : `<button class="action-btn block" data-action="block-user" data-ip="${esc(user.ip)}">Block</button>`}
      <button class="action-btn delete text-danger" data-action="delete-user" data-device-id="${esc(user.device_id || '')}" data-ip="${esc(user.ip)}">🗑️</button>
    </td>
  </tr>`;
}

// ===== RENDER: BLOCKED TABLE =====
function renderBlockedTable() {
  const tbody = document.getElementById('blockedTableBody');
  if (blockedData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><div class="icon">✅</div><div>No blocked users</div></td></tr>';
    return;
  }
  tbody.innerHTML = blockedData.map(b => `<tr>
    <td><span class="mono-primary">${esc(b.ip)}</span></td>
    <td>${esc(b.reason || '-')}</td>
    <td class="time-ago">${fmtDate(b.blocked_at)}</td>
    <td><button class="action-btn unblock" data-action="unblock-user" data-ip="${esc(b.ip)}">Unblock</button></td>
  </tr>`).join('');
}

// ===== KEYS TAB: TWO-LEVEL UI =====
let keysSelectedUserIP = null;
let keysFilter = 'all';

function renderKeysTab() {
  // Update stats
  const active = licenseKeysData.filter(k => k.status === 'active').length;
  const unused = licenseKeysData.filter(k => k.status === 'unused').length;
  const revoked = licenseKeysData.filter(k => k.status === 'revoked').length;
  setText('keyStat-total', licenseKeysData.length);
  setText('keyStat-active', active);
  setText('keyStat-unused', unused);
  setText('keyStat-revoked', revoked);

  renderKeysUserList();
  if (keysSelectedUserIP) {
    renderKeysForUser(keysSelectedUserIP);
  } else {
    renderAllKeysTable();
  }
}

function renderKeysUserList() {
  const c = document.getElementById('keysUserList');
  if (!c) return;

  // Build map: user IP -> key count
  const keysByIP = {};
  licenseKeysData.forEach(k => {
    const ip = k.owner_ip || k.bound_ip;
    if (ip) { keysByIP[ip] = (keysByIP[ip] || 0) + 1; }
  });

  // Get unique users that have at least one key (bound or owner)
  const userIPs = new Set();
  licenseKeysData.forEach(k => {
    if (k.owner_ip) userIPs.add(k.owner_ip);
    if (k.bound_ip) userIPs.add(k.bound_ip);
  });

  // Build user list from usersData + any IPs from keys
  const items = [];
  const seenIPs = new Set();

  // First add users from the users table that have keys
  usersData.forEach(u => {
    if (userIPs.has(u.ip)) {
      items.push({ ip: u.ip, note: u.note, country: u.country, online: isOnline(u), keyCount: keysByIP[u.ip] || 0 });
      seenIPs.add(u.ip);
    }
  });

  // Then add any IPs that have keys but aren't in the users table
  userIPs.forEach(ip => {
    if (!seenIPs.has(ip)) {
      items.push({ ip, note: null, country: null, online: false, keyCount: keysByIP[ip] || 0 });
      seenIPs.add(ip);
    }
  });

  // Also add users without keys (so admin can generate for them)
  usersData.forEach(u => {
    if (!seenIPs.has(u.ip)) {
      items.push({ ip: u.ip, note: u.note, country: u.country, online: isOnline(u), keyCount: 0 });
      seenIPs.add(u.ip);
    }
  });

  // Sort: users with keys first, then by key count desc, then by IP
  items.sort((a, b) => b.keyCount - a.keyCount || a.ip.localeCompare(b.ip));

  // Count unassigned keys
  const unassigned = licenseKeysData.filter(k => !k.owner_ip && !k.bound_ip).length;

  if (!items.length) {
    c.innerHTML = '<div class="empty-state small">No users</div>';
    return;
  }

  c.innerHTML = items.map(u => {
    const isActive = keysSelectedUserIP === u.ip;
    const ini = getInitials(u.ip);
    const meta = [u.note, u.country].filter(Boolean).join(' · ') || 'No info';
    return `<div class="keys-user-item ${isActive ? 'active' : ''}" data-action="select-keys-user" data-ip="${esc(u.ip)}">
      <div class="avatar">${ini}</div>
      <div class="info">
        <div class="ip">${esc(u.ip)}</div>
        <div class="meta">${esc(meta)}</div>
      </div>
      ${u.keyCount > 0 ? `<span class="key-count">${u.keyCount}</span>` : ''}
    </div>`;
  }).join('');
}

function getKeysForUser(ip) {
  return licenseKeysData.filter(k => k.owner_ip === ip || k.bound_ip === ip);
}

function renderKeysForUser(ip) {
  const panel = document.getElementById('keysPanel');
  const allTable = document.getElementById('keysAllTable');
  if (allTable) allTable.style.display = 'none';

  const user = usersData.find(u => u.ip === ip);
  const keys = getKeysForUser(ip);
  const ini = getInitials(ip);
  const note = user?.note || 'No note';
  const country = user?.country || '';

  // Apply filter
  let filtered = keys;
  if (keysFilter !== 'all') {
    filtered = keys.filter(k => k.status === keysFilter);
  }

  panel.innerHTML = `
    <div class="keys-user-detail-header">
      <div class="avatar">${ini}</div>
      <div class="info">
        <div class="ip">${esc(ip)}</div>
        <div class="meta">${esc(note)}${country ? ' · ' + esc(country) : ''} · ${keys.length} key(s)</div>
      </div>
      <div class="actions">
        <button class="key-action-btn primary" data-action="generate-for-user" data-ip="${esc(ip)}">+ Generate Key</button>
        <button class="key-action-btn secondary" data-action="deselect-keys-user">✕ Close</button>
      </div>
    </div>
    <div class="table-card">
      <div class="table-header"><h3>Keys for ${esc(ip)}</h3></div>
      <div class="modal-scroll">
      <table>
        <thead><tr><th>Key</th><th>Status</th><th>Device</th><th>Bound At</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${!filtered.length
          ? '<tr><td colspan="6" class="empty-state"><div class="icon">🔑</div><div>No keys for this user yet.</div></td></tr>'
          : filtered.map(k => renderKeyRow(k)).join('')
        }</tbody>
      </table>
      </div>
    </div>
  `;
}

function renderAllKeysTable() {
  const panel = document.getElementById('keysPanel');
  const allTable = document.getElementById('keysAllTable');
  panel.innerHTML = '<div class="keys-panel-empty"><div class="icon">🔑</div><div>Select a user from the left to manage their keys.</div></div>';
  if (allTable) allTable.style.display = 'block';

  const tbody = document.getElementById('keysTableBody');
  if (!tbody) return;

  const q = (document.getElementById('keysSearch')?.value || '').toLowerCase();
  let filtered = licenseKeysData;

  // Apply status filter
  if (keysFilter === 'unassigned') {
    filtered = filtered.filter(k => !k.owner_ip && !k.bound_ip);
  } else if (keysFilter !== 'all') {
    filtered = filtered.filter(k => k.status === keysFilter);
  }

  // Apply search
  if (q) {
    filtered = filtered.filter(k =>
      (k.key || '').toLowerCase().includes(q) ||
      (k.bound_ip || '').toLowerCase().includes(q) ||
      (k.owner_ip || '').toLowerCase().includes(q) ||
      (k.note || '').toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="icon">🔑</div><div>No keys match the current filter.</div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(k => renderKeyRow(k, true)).join('');
}

function renderKeyRow(k, showOwner = false) {
  const statusClass = k.status === 'active' ? 'key-active' : k.status === 'revoked' ? 'key-revoked' : 'key-unused';
  const deviceHtml = k.bound_device_id
    ? `<span class="text-muted" title="${esc(k.bound_device_id)}">${esc(k.bound_device_id.substring(0, 12))}...</span>`
    : '<span class="text-dim">-</span>';

  if (showOwner) {
    const ownerHtml = k.owner_ip || k.bound_ip
      ? `<span class="mono-primary">${esc(k.owner_ip || k.bound_ip)}</span>`
      : '<span class="text-dim">Unassigned</span>';
    return `<tr>
      <td><code class="key-code">${esc(k.key)}</code> <button class="copy-btn" data-action="copy-key" data-key="${esc(k.key)}" title="Copy">📋</button></td>
      <td><span class="key-badge ${statusClass}">${k.status}</span></td>
      <td>${ownerHtml}</td>
      <td>${deviceHtml}</td>
      <td class="time-ago">${fmtDate(k.created_at)}</td>
      <td>
        ${k.status === 'active' ? `<button class="action-btn block" data-action="revoke-key" data-id="${k.id}">Revoke</button>` : ''}
        ${k.status === 'unused' ? `<button class="action-btn block" data-action="delete-key" data-id="${k.id}">Delete</button>` : ''}
        ${k.status === 'revoked' ? `<button class="action-btn unblock" data-action="reactivate-key" data-id="${k.id}">Reset</button>` : ''}
      </td>
    </tr>`;
  } else {
    // Per-user table: Key | Status | Device | Bound At | Created | Actions
    return `<tr>
      <td><code class="key-code">${esc(k.key)}</code> <button class="copy-btn" data-action="copy-key" data-key="${esc(k.key)}" title="Copy">📋</button></td>
      <td><span class="key-badge ${statusClass}">${k.status}</span></td>
      <td>${deviceHtml}</td>
      <td class="time-ago">${k.bound_at ? fmtDate(k.bound_at) : '-'}</td>
      <td class="time-ago">${fmtDate(k.created_at)}</td>
      <td>
        ${k.status === 'active' ? `<button class="action-btn block" data-action="revoke-key" data-id="${k.id}">Revoke</button>` : ''}
        ${k.status === 'unused' ? `<button class="action-btn block" data-action="delete-key" data-id="${k.id}">Delete</button>` : ''}
        ${k.status === 'revoked' ? `<button class="action-btn unblock" data-action="reactivate-key" data-id="${k.id}">Reset</button>` : ''}
      </td>
    </tr>`;
  }
}

function selectKeysUser(ip) {
  keysSelectedUserIP = ip;
  renderKeysTab();
}

function deselectKeysUser() {
  keysSelectedUserIP = null;
  renderKeysTab();
}

function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => /^\d+$/.test(p) && parseInt(p, 10) >= 0 && parseInt(p, 10) <= 255);
}

// ===== ACTIONS: USERS =====
async function blockUser(ip) {
  if (!isValidIP(ip)) {
    showToast('Invalid IP address', 'error');
    return;
  }
  openModal('Block User', `
    <div class="modal-field"><label>IP Address</label><input type="text" value="${esc(ip)}" disabled></div>
    <div class="modal-field"><label>Reason (optional, shown to user)</label><textarea id="blockReason" placeholder="e.g., Violation of terms"></textarea></div>
  `, async () => {
    const reason = (document.getElementById('blockReason').value || '').trim();
    try {
      await sbPost('blocked_ips', { ip, reason: reason || null, blocked_at: new Date().toISOString() });
      showToast(`User ${ip} blocked`, 'success');
      closeModal();
      loadData();
    } catch (e) { showToast('Failed to block user', 'error'); }
  });
}

async function unblockUser(ip) {
  if (!confirm(`Unblock ${ip}?`)) return;
  try {
    await sbDelete(`blocked_ips?ip=eq.${encodeURIComponent(ip)}`);
    showToast(`User ${ip} unblocked`, 'success');
    loadData();
  } catch (e) { showToast('Failed to unblock', 'error'); }
}

async function deleteUser(deviceId, ip) {
  const user = usersData.find(u => u.device_id === deviceId);
  const displayName = user?.note || ip || deviceId?.substring(0, 12) || 'Unknown';
  openModal('Delete User', `
    <div class="modal-body">
      <div class="modal-warning-icon">⚠️</div>
      <p>Delete user <strong>${esc(displayName)}</strong>?</p>
      <p class="modal-muted">IP: ${esc(ip || 'N/A')}</p>
      <p class="modal-muted">Device: ${esc(deviceId ? deviceId.substring(0, 16) + '...' : 'N/A')}</p>
      <p class="modal-danger">This will permanently delete all user data (users + user_data). This action cannot be undone.</p>
      <div class="modal-confirm-row center">
        <input type="checkbox" id="deleteConfirmCheck">
        <label for="deleteConfirmCheck">I understand, delete permanently</label>
      </div>
    </div>
  `, async () => {
    if (!document.getElementById('deleteConfirmCheck').checked) {
      showToast('Please confirm by checking the box', 'warning');
      return;
    }
    try {
      if (deviceId) {
        await sbDelete(`users?device_id=eq.${encodeURIComponent(deviceId)}`);
      }
      if (currentProfileId === deviceId) closeUserProfile();
      showToast(`User ${displayName} deleted`, 'success');
      closeModal();
      loadData();
    } catch (e) {
      showToast('Failed to delete user: ' + e.message, 'error');
      closeModal();
    }
  });
}

function editNote(deviceId) {
  const user = usersData.find(u => u.device_id === deviceId);
  const currentNote = user?.note || '';
  const ip = user?.ip || 'Unknown';
  openModal('Edit Note', `
    <div class="modal-field"><label>IP Address</label><input type="text" value="${esc(ip)}" disabled></div>
    <div class="modal-field"><label>Device</label><input type="text" value="${esc(deviceId ? deviceId.substring(0, 12) + '...' : '-')}" disabled></div>
    <div class="modal-field"><label>Note (only visible to you)</label><textarea id="userNote" placeholder="e.g., Friend, Test user">${esc(currentNote)}</textarea></div>
  `, async () => {
    const note = (document.getElementById('userNote').value || '').trim();
    try {
      await sbPatch(`users?device_id=eq.${encodeURIComponent(deviceId)}`, { note: note || null });
      showToast('Note saved', 'success');
      closeModal();
      loadData();
    } catch (e) { showToast('Failed to save note', 'error'); }
  });
}

function editNoteForIP(ip) {
  if (!ip || ip === 'no-ip') return;
  const devices = usersData.filter(u => u.ip === ip);
  const currentNote = devices[0]?.note || '';
  const deviceCount = devices.length;
  openModal('Add Note for IP', `
    <div class="modal-field"><label>IP Address</label><input type="text" value="${esc(ip)}" disabled></div>
    <div class="modal-field"><label>Devices under this IP</label><input type="text" value="${deviceCount} device${deviceCount > 1 ? 's' : ''}" disabled></div>
    <div class="modal-field"><label>Note (applies to all devices under this IP, visible only to you)</label><textarea id="ipNote" placeholder="e.g., Suspicious, VIP, Test account">${esc(currentNote)}</textarea></div>
  `, async () => {
    const note = (document.getElementById('ipNote').value || '').trim();
    try {
      await sbPatch(`users?ip=eq.${encodeURIComponent(ip)}`, { note: note || null });
      showToast(`Note saved for ${deviceCount} device(s)`, 'success');
      closeModal();
      loadData();
    } catch (e) { showToast('Failed to save note', 'error'); }
  });
}

function exportUsersCSV() {
  const filtered = getFilteredAndSortedUsers();
  if (!filtered.length) { showToast('No users to export', 'warning'); return; }
  const headers = ['IP', 'Device ID', 'Country', 'City', 'OS', 'Browser', 'Messages', 'Sessions', 'Last Seen', 'License', 'Note'];
  const rows = filtered.map(u => [
    u.ip || '', (u.device_id || '').substring(0, 16),
    u.country || '', u.city || '', u.os || '', (u.browser || '') + ' ' + (u.browser_version || ''),
    u.messages_sent || 0, u.sessions_count || 1, u.last_seen || '',
    u.license_status === 'activated' ? 'yes' : 'no', (u.note || '').replace(/"/g, '""')
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c)}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `velaryn_users_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported CSV', 'success');
}

function showFindDuplicatesModal() {
  const groups = getGroupedByIP(usersData);
  const multiIP = groups.filter(g => g.count > 1);
  if (!multiIP.length) {
    showToast('No duplicate IP groups found', 'success');
    return;
  }
  let html = '<p class="modal-intro">IP groups with multiple devices. Review and delete empty duplicates manually.</p>';
  html += '<div class="modal-scroll-sm">';
  for (const grp of multiIP) {
    html += `<div class="dup-group">`;
    html += `<div class="dup-group-header">${esc(grp.ip)} — ${grp.count} devices</div>`;
    for (const u of grp.devices) {
      const msgs = u.messages_sent || 0;
      html += `<div class="dup-device-row">
        <span>${esc((u.device_id || '').substring(0, 12))}… · ${u.os || '?'} · ${msgs} msgs</span>
        <button class="action-btn delete badge-small" data-action="dup-delete" data-device-id="${esc(u.device_id)}" data-ip="${esc(grp.ip)}">Delete</button>
      </div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  openModal('Find Duplicates', html, () => closeModal());
}

function bulkBlockUsers() {
  const ids = Array.from(usersSelectedIds);
  if (!ids.length) return;
  const users = ids.map(did => usersData.find(u => u.device_id === did)).filter(Boolean);
  const ips = users.map(u => u.ip).filter(ip => ip && isValidIP(ip));
  if (!ips.length) { showToast('No valid IPs to block', 'error'); return; }
  openModal('Block Selected Users', `
    <p class="modal-intro">Block ${ips.length} user(s)?</p>
    <div class="modal-field"><label>Reason (optional)</label><textarea id="bulkBlockReason" placeholder="e.g., Violation of terms"></textarea></div>
  `, async () => {
    const reason = (document.getElementById('bulkBlockReason').value || '').trim();
    try {
      for (const ip of ips) {
        await sbPost('blocked_ips', { ip, reason: reason || null, blocked_at: new Date().toISOString() });
      }
      showToast(`${ips.length} user(s) blocked`, 'success');
      closeModal();
      usersSelectedIds.clear();
      loadData();
    } catch (e) { showToast('Failed to block', 'error'); }
  });
}

function bulkDeleteUsers() {
  const ids = Array.from(usersSelectedIds);
  if (!ids.length) return;
  openModal('Delete Selected Users', `
    <div class="modal-body">
      <p>Permanently delete <strong>${ids.length}</strong> user(s)?</p>
      <p class="modal-danger">This cannot be undone. All user data will be lost.</p>
      <div class="modal-confirm-row center">
        <input type="checkbox" id="bulkDeleteConfirmCheck">
        <label for="bulkDeleteConfirmCheck">I understand, delete permanently</label>
      </div>
    </div>
  `, async () => {
    if (!document.getElementById('bulkDeleteConfirmCheck').checked) {
      showToast('Please confirm', 'warning');
      return;
    }
    try {
      for (const did of ids) {
        await sbDelete(`users?device_id=eq.${encodeURIComponent(did)}`);
      }
      if (currentProfileId && ids.includes(currentProfileId)) closeUserProfile();
      showToast(`${ids.length} user(s) deleted`, 'success');
      closeModal();
      usersSelectedIds.clear();
      loadData();
    } catch (e) { showToast('Failed to delete: ' + e.message, 'error'); }
  });
}

function bulkDeselectUsers() {
  usersSelectedIds.clear();
  renderUsersTable();
}

// ===== ACTIONS: LICENSE KEYS =====
function generateKeyString() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I,O,0,1 for clarity
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `VLR-${seg()}-${seg()}-${seg()}`;
}

async function generateKey(count = 1, ownerIP = null) {
  try {
    for (let i = 0; i < count; i++) {
      const key = generateKeyString();
      const payload = { key, status: 'unused', created_at: new Date().toISOString() };
      if (ownerIP) payload.owner_ip = ownerIP;
      await sbPost('license_keys', payload);
    }
    const label = ownerIP ? `${count} key(s) for ${ownerIP}` : `${count} unassigned key(s)`;
    showToast(`${label} generated`, 'success');
    loadData();
  } catch (e) { showToast('Failed to generate key', 'error'); console.error(e); }
}

async function revokeKey(id) {
  if (!confirm('Revoke this license key? The user will lose access.')) return;
  try {
    await sbPatch(`license_keys?id=eq.${id}`, { status: 'revoked' });
    showToast('Key revoked', 'success');
    loadData();
  } catch (e) { showToast('Failed to revoke', 'error'); }
}

async function deleteKey(id) {
  openModal('Delete Key', `
    <div class="modal-body">
      <p>Delete this unused key? This cannot be undone.</p>
      <div class="modal-confirm-row center">
        <input type="checkbox" id="deleteKeyConfirmCheck">
        <label for="deleteKeyConfirmCheck">I understand</label>
      </div>
    </div>
  `, async () => {
    if (!document.getElementById('deleteKeyConfirmCheck')?.checked) {
      showToast('Please confirm', 'warning');
      return;
    }
    try {
      await sbDelete(`license_keys?id=eq.${id}`);
      showToast('Key deleted', 'success');
      closeModal();
      loadData();
    } catch (e) { showToast('Failed to delete', 'error'); }
  });
}

async function reactivateKey(id) {
  if (!confirm('Reset this key to unused? It will unbind from the device.')) return;
  try {
    await sbPatch(`license_keys?id=eq.${id}`, { status: 'unused', bound_ip: null, bound_device_id: null, bound_at: null });
    showToast('Key reset to unused', 'success');
    loadData();
  } catch (e) { showToast('Failed to reset', 'error'); }
}

// ===== USER PROFILE (by device_id) =====
async function openUserProfile(deviceId) {
  currentProfileId = deviceId;
  setDisplay('usersSection', 'none');
  setDisplay('blockedSection', 'none');
  setDisplay('keysSection', 'none');
  setDisplay('userProfileSection', 'block');
  setText('pageTitle', 'User Profile');
  const descEl = document.getElementById('pageDesc');
  if (descEl) descEl.textContent = 'View detailed info, invites, and tracker data for this user.';
  // Reset tabs
  document.querySelectorAll('.profile-tabs .segmented-btn').forEach(t => t.classList.remove('active'));
  document.querySelector('.profile-tabs .segmented-btn')?.classList.add('active');
  document.querySelectorAll('.profile-tab-pane').forEach(t => t.classList.remove('active'));
  document.getElementById('tabInfo')?.classList.add('active');
  await loadUserProfile(deviceId);
  if (profileRefreshInterval) clearInterval(profileRefreshInterval);
  profileRefreshInterval = setInterval(() => loadUserProfile(deviceId), 10000);
}

async function loadUserProfile(deviceId) {
  const user = usersData.find(u => u.device_id === deviceId);
  if (!user) return;
  const ip = user.ip || 'Detecting...';
  const did = deviceId ? deviceId.substring(0, 12) + '...' : '-';
  setText('profileIP', ip);
  setText('profileDeviceId', did);
  setText('profileNote', user.note || 'No note');
  setText('profileAvatar', getInitials(user.ip || deviceId));
  const online = isOnline(user);
  document.getElementById('profileStatus').innerHTML = `<span class="online-indicator ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>`;
  setText('profileMessages', user.messages_sent || 0);
  setText('profileParses', user.parses_done || 0);
  setText('profileSessions', user.sessions_count || 0);
  setText('profileAIRequests', user.ai_requests || 0);
  setText('infoOS', user.os || '-');
  setText('infoBrowser', `${user.browser || '-'} ${user.browser_version || ''}`);
  setText('infoLanguage', user.language || '-');
  setText('infoTimezone', user.timezone || '-');
  setText('infoCountry', user.country || '-');
  setText('infoCity', user.city || '-');
  setText('infoRegion', user.region || '-');
  setText('infoDeviceId', deviceId || '-');
  setText('infoFirstSeen', fmtDate(user.first_seen));
  setText('infoLastActivity', fmtDate(user.last_heartbeat || user.last_seen));
  setText('infoVersion', user.extension_version || '-');
  await loadUserDataForProfile(deviceId);
}

async function loadUserDataForProfile(deviceId) {
  try {
    const data = await sbGet(`user_data?device_id=eq.${encodeURIComponent(deviceId)}&select=*`);
    const ud = data[0] || null;
    userDataCache[deviceId] = ud;
    renderInvitesTab(ud);
    renderDatabaseTab(ud);
    renderHistoryTab(ud);
    renderSettingsTab(ud);
    renderTrackerTab(ud);
  } catch (e) { console.error('Failed to load user data:', e); }
}

function closeUserProfile() {
  currentProfileId = null;
  if (profileRefreshInterval) { clearInterval(profileRefreshInterval); profileRefreshInterval = null; }
  setDisplay('userProfileSection', 'none');
  showTab(currentTab);
}

function refreshUserProfile() {
  if (currentProfileId) { loadUserProfile(currentProfileId); showToast('Refreshed', 'success'); }
}

function deleteCurrentUser() {
  if (!currentProfileId) return;
  const user = usersData.find(u => u.device_id === currentProfileId);
  deleteUser(currentProfileId, user?.ip);
}

function exportUserData() {
  const user = usersData.find(u => u.device_id === currentProfileId);
  const ud = userDataCache[currentProfileId];
  const blob = new Blob([JSON.stringify({ user, userData: ud, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `user_${(user?.ip || 'unknown').replace(/\./g, '_')}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported', 'success');
}

// ===== PROFILE TAB RENDERERS =====
function showProfileTab(tabName) {
  document.querySelectorAll('.profile-tabs .segmented-btn').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-tab-pane').forEach(t => t.classList.remove('active'));
  document.querySelector(`.profile-tabs .segmented-btn[data-tab="${tabName}"]`)?.classList.add('active');
  document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`)?.classList.add('active');
}

function renderInvitesTab(ud) {
  const c = document.getElementById('invitesGrid');
  if (!ud) { c.innerHTML = '<div class="empty-state"><div class="icon">📨</div><div>No data synced</div></div>'; return; }
  let invites = [], personal = [];
  try { invites = JSON.parse(ud.invites || '[]'); } catch(e) {}
  try { personal = JSON.parse(ud.personal_invites || '[]'); } catch(e) {}
  if (!invites.length && !personal.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📨</div><div>No invites</div></div>'; return; }
  c.innerHTML = invites.map((inv, i) => `<div class="invite-card"><span class="invite-type auto">Auto</span><h5>${esc(inv.title || `Invite #${i+1}`)}</h5><p>${esc(inv.text || inv.message || JSON.stringify(inv))}</p></div>`).join('') +
    personal.map((inv, i) => `<div class="invite-card"><span class="invite-type personal">Personal</span><h5>${esc(inv.title || `Personal #${i+1}`)}</h5><p>${esc(inv.text || inv.message || JSON.stringify(inv))}</p></div>`).join('');
}

function renderDatabaseTab(ud) {
  const tbody = document.getElementById('databaseTableBody');
  const countEl = document.getElementById('databaseCount');
  if (!ud) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><div class="icon">👥</div><div>No data synced</div></td></tr>'; countEl.textContent = '0'; return; }
  let followers = [];
  try { followers = JSON.parse(ud.followers || '[]'); } catch(e) {}
  countEl.textContent = `${followers.length} followers`;
  if (!followers.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><div class="icon">👥</div><div>No followers</div></td></tr>'; return; }
  const q = (document.getElementById('databaseSearch')?.value || '').toLowerCase();
  let f = followers;
  if (q) f = followers.filter(x => (x.nickname || '').toLowerCase().includes(q) || (x.id || '').toString().includes(q));
  tbody.innerHTML = f.map((x, i) => `<tr><td>${x.number || i+1}</td><td class="text-primary" style="font-weight:500">${esc(x.nickname || x.id || '-')}</td><td><span class="badge" style="background:${statusColor(x.status)};color:#fff">${x.status || '?'}</span></td><td>${x.invited ? '✅' : '❌'}</td></tr>`).join('');
}

function renderHistoryTab(ud) {
  const c = document.getElementById('historyList');
  if (!ud) { c.innerHTML = '<div class="empty-state"><div class="icon">📜</div><div>No data synced</div></div>'; return; }
  let h = [];
  try { h = JSON.parse(ud.send_history || '[]'); } catch(e) {}
  if (!h.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📜</div><div>No history</div></div>'; return; }
  // Sort newest first
  h.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  c.innerHTML = h.map(item => {
    const isPersonal = item.type === 'personal';
    // Extract username from target URL (e.g. https://www.manyvids.com/messages/12345 or profile URL)
    let targetLabel = 'Auto Send';
    let targetUrl = '#';
    if (item.target) {
      targetUrl = item.target;
      // Try to extract readable ID from URL
      const idMatch = item.target.match(/\/messages\/(\d+)/);
      const profileMatch = item.target.match(/\/Profile\/([^/]+)/);
      if (idMatch) targetLabel = `User #${idMatch[1]}`;
      else if (profileMatch) targetLabel = decodeURIComponent(profileMatch[1]);
      else targetLabel = item.target.replace(/^https?:\/\/(www\.)?manyvids\.com\/?/, '').slice(0, 40) || item.target;
    }
    // Status badge
    let statusBadge = '';
    if (isPersonal) {
      if (item.success === true) statusBadge = '<span class="badge badge-success" style="margin-left:8px;">sent</span>';
      else if (item.success === false) statusBadge = `<span class="badge badge-danger" style="margin-left:8px;">failed</span>`;
    }
    // Type badge
    const typeBadge = isPersonal
      ? '<span class="text-primary badge-small" style="margin-right:6px;">Personal</span>'
      : '<span class="badge-small" style="color:var(--accent-blue);margin-right:6px;">Auto</span>';
    // Target display
    const targetHtml = item.target
      ? `<a href="${esc(safeUrl(targetUrl))}" target="_blank" class="text-primary" style="font-weight:500;">${esc(targetLabel)}</a>`
      : `<span class="text-dim">${esc(targetLabel)}</span>`;
    return `<div class="history-item"><div class="target">${typeBadge}${targetHtml}${statusBadge}</div><div class="time">${fmtDate(item.timestamp || item.sentAt || item.date)}</div></div>`;
  }).join('');
}

function renderSettingsTab(ud) {
  if (!ud) { setText('settingsGroqKey', 'Not synced'); setText('settingsTheme', '-'); setText('settingsLanguage', '-'); return; }
  setText('settingsGroqKey', ud.groq_api_key || 'Not set');
  let s = {};
  try { s = JSON.parse(ud.settings || '{}'); } catch(e) {}
  setText('settingsTheme', s.theme || 'dark');
  setText('settingsLanguage', s.language || 'en');
}

function renderTrackerTab(ud) {
  let purchases = {}, transactions = [], notes = {}, ranks = {}, nickToId = {};
  if (ud) {
    try { purchases = JSON.parse(ud.purchases || '{}'); } catch(e) {}
    try { transactions = JSON.parse(ud.transactions || '[]'); } catch(e) {}
    try { notes = JSON.parse(ud.tracker_notes || '{}'); } catch(e) {}
    try { ranks = JSON.parse(ud.mv_ranks || '{}'); } catch(e) {}
    try { nickToId = JSON.parse(ud.mv_nick_to_id || '{}'); } catch(e) {}
  }
  trackerNotes = notes; trackerNickToId = nickToId; trackerTransactions = transactions;
  const userMap = new Map();
  if (Array.isArray(transactions)) {
    transactions.forEach(tx => {
      const nick = tx.nick || tx.username || 'Unknown';
      const key = nick.toLowerCase();
      if (!userMap.has(key)) userMap.set(key, { nick, totalSpent: 0, transactionCount: 0, lastTransaction: null, lastAmount: 0, rank: null, note: null, userId: tx.userId || null });
      const u = userMap.get(key);
      u.totalSpent += (tx.amount || 0); u.transactionCount++;
      const d = tx.transactionDate || tx.date;
      if (d && (!u.lastTransaction || d > u.lastTransaction)) { u.lastTransaction = d; u.lastAmount = tx.amount || 0; }
      if (tx.userId) u.userId = tx.userId;
    });
  }
  Object.entries(ranks).forEach(([uid, d]) => { const n = d.nick || uid; const k = n.toLowerCase(); if (userMap.has(k)) { userMap.get(k).rank = d.rank; userMap.get(k).userId = uid; } else { userMap.set(k, { nick: n, totalSpent: 0, transactionCount: 0, lastTransaction: null, lastAmount: 0, rank: d.rank, note: null, userId: uid }); } });
  Object.entries(notes).forEach(([nk, nt]) => { const n = nk.replace(/^(mv_)?note_/, '').replace(/_/g, ' '); const k = n.toLowerCase(); if (userMap.has(k)) userMap.get(k).note = nt; else userMap.set(k, { nick: n, totalSpent: 0, transactionCount: 0, lastTransaction: null, lastAmount: 0, rank: null, note: nt, userId: null }); });
  trackerUsersData = Array.from(userMap.values());
  const totalSpent = trackerUsersData.reduce((s, u) => s + u.totalSpent, 0);
  const totalTx = trackerUsersData.reduce((s, u) => s + u.transactionCount, 0);
  setText('trackerTotalSpent', `$${totalSpent.toFixed(2)}`);
  setText('trackerTransactions', totalTx);
  setText('trackerUniqueUsers', trackerUsersData.filter(u => u.totalSpent > 0).length);
  setText('trackerNotes', trackerUsersData.filter(u => u.note).length);
  renderTrackerTable();
  renderTrackerNotes(trackerNotes, trackerNickToId);
  renderTrackerLastTransactions(trackerTransactions, trackerNickToId);
  renderTrackerLastSent(ud);
}

function renderTrackerTable() {
  const tbody = document.getElementById('trackerTableBody');
  const q = (document.getElementById('trackerSearch')?.value || '').toLowerCase();
  const sort = document.getElementById('trackerSort')?.value || 'spent';
  let f = trackerUsersData;
  if (q) f = f.filter(u => (u.nick || '').toLowerCase().includes(q) || (u.note || '').toLowerCase().includes(q));
  f = [...f];
  if (sort === 'spent') f.sort((a, b) => b.totalSpent - a.totalSpent);
  else if (sort === 'transactions') f.sort((a, b) => b.transactionCount - a.transactionCount);
  else if (sort === 'rank') f.sort((a, b) => (a.rank || 99999) - (b.rank || 99999));
  else if (sort === 'recent') f.sort((a, b) => (b.lastTransaction || 0) - (a.lastTransaction || 0));
  if (!f.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="icon">📊</div><div>No tracker data</div></td></tr>'; return; }
  tbody.innerHTML = f.map(u => {
    const ini = u.nick ? u.nick.slice(0, 2).toUpperCase() : '??';
    const ac = u.totalSpent >= 500 ? 'whale' : u.totalSpent >= 100 ? 'high' : '';
    const rc = u.rank && u.rank <= 10 ? 'top10' : u.rank && u.rank <= 100 ? 'top100' : '';
    const url = u.userId ? `https://www.manyvids.com/messages/${u.userId}` : `https://www.manyvids.com/Profile/${encodeURIComponent(u.nick)}/`;
    return `<tr><td><div class="tracker-user"><div class="tracker-user-avatar">${ini}</div><a href="${esc(safeUrl(url))}" target="_blank" class="tracker-user-link">${esc(u.nick)}</a></div></td><td><span class="tracker-amount ${ac}">$${u.totalSpent.toFixed(2)}</span></td><td>${u.transactionCount}</td><td>${u.rank ? `<span class="tracker-rank ${rc}">#${u.rank}</span>` : '-'}</td><td class="tracker-date">${u.lastTransaction ? `${fmtDate(u.lastTransaction)} ($${u.lastAmount.toFixed(2)})` : '-'}</td><td><span class="tracker-note" title="${esc(u.note || '')}">${esc(u.note || '-')}</span></td></tr>`;
  }).join('');
}

function renderTrackerNotes(notes, nickToId) {
  const c = document.getElementById('trackerNotesSection');
  if (!c) return;
  const arr = Object.entries(notes);
  if (!arr.length) { c.innerHTML = '<div class="empty-state small">No notes</div>'; return; }
  c.innerHTML = arr.map(([k, v]) => {
    const nick = k.replace(/^(mv_)?note_/, '').replace(/_/g, ' ');
    const uid = nickToId[nick] || nickToId[nick.toLowerCase()] || null;
    const url = uid ? `https://www.manyvids.com/messages/${uid}` : '#';
    return `<div class="tracker-note-item"><div class="tracker-note-header"><span class="tracker-note-user"><a href="${esc(safeUrl(url))}" target="_blank">👤 ${esc(nick)}</a></span></div><div class="tracker-note-text">${esc(v)}</div></div>`;
  }).join('');
}

function renderTrackerLastTransactions(tx, nickToId) {
  const c = document.getElementById('trackerLastTransactionsSection');
  if (!c) return;
  if (!Array.isArray(tx) || !tx.length) { c.innerHTML = '<div class="empty-state small">No transactions</div>'; return; }
  const sorted = [...tx].sort((a, b) => (b.timestamp || b.date || 0) - (a.timestamp || a.date || 0)).slice(0, 20);
  c.innerHTML = sorted.map(t => {
    const nick = t.nick || t.username || '?';
    const amt = t.amount || 0;
    const uid = t.userId || nickToId[nick] || null;
    const url = uid ? `https://www.manyvids.com/messages/${uid}` : '#';
    const ac = amt >= 500 ? 'whale' : amt >= 100 ? 'high' : '';
    return `<div class="tracker-tx-item"><div class="tracker-tx-avatar">💰</div><div class="tracker-tx-info"><div class="tracker-tx-user"><a href="${esc(safeUrl(url))}" target="_blank">${esc(nick)}</a></div><div class="tracker-tx-details">${esc(t.type || t.item || 'Purchase')} • ${fmtDate(t.timestamp || t.date)}</div></div><div class="tracker-tx-amount ${ac}">$${amt.toFixed(2)}</div></div>`;
  }).join('');
}

function renderTrackerLastSent(ud) {
  const c = document.getElementById('trackerLastSentSection');
  if (!c) return;
  let hist = [], followers = [];
  if (ud) { try { hist = JSON.parse(ud.send_history || '[]'); } catch(e) {} try { followers = JSON.parse(ud.followers || '[]'); } catch(e) {} }
  const msgs = [];
  if (Array.isArray(hist)) hist.forEach(h => { if (h.message || h.text || h.content) msgs.push({ nick: h.target || h.nickname || h.to || '?', id: h.userId || h.id, ts: h.timestamp || h.sentAt || h.date, msg: h.message || h.text || h.content }); });
  if (Array.isArray(followers)) followers.forEach(f => { if ((f.invited || f.status === 'sent') && f.sentMessage) msgs.push({ nick: f.nickname || f.nick || '?', id: f.id || f.mvid, ts: f.inviteTimestamp || f.sentAt, msg: f.sentMessage }); });
  const sorted = msgs.filter(m => m.msg).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 15);
  if (!sorted.length) { c.innerHTML = '<div class="empty-state small">No sent messages</div>'; return; }
  c.innerHTML = sorted.map(m => {
    const ini = m.nick ? m.nick.slice(0, 2).toUpperCase() : '📤';
    const url = m.id ? `https://www.manyvids.com/messages/${m.id}` : '#';
    return `<div class="tracker-sent-message"><div class="tracker-sent-header"><div class="tracker-sent-to"><div class="tracker-sent-to-avatar">${ini}</div><div class="tracker-sent-to-name"><a href="${esc(safeUrl(url))}" target="_blank">${esc(m.nick)}</a></div></div><span class="tracker-sent-date">${fmtDate(m.ts)}</span></div><div class="tracker-sent-content">${esc(m.msg)}</div></div>`;
  }).join('');
}

// ===== MODAL =====
let modalCallback = null;
let lastModalTrigger = null;
function openModal(title, content, onConfirm, triggerEl) {
  lastModalTrigger = triggerEl || document.activeElement;
  setText('modalTitle', title);
  document.getElementById('modalContent').innerHTML = content;
  document.getElementById('modalOverlay').classList.add('active');
  modalCallback = onConfirm;
  requestAnimationFrame(() => {
    const first = document.querySelector('#modalContent input:not([disabled]), #modalContent textarea, #modalContent select');
    if (first) first.focus();
  });
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  modalCallback = null;
  if (lastModalTrigger && typeof lastModalTrigger.focus === 'function') lastModalTrigger.focus();
  lastModalTrigger = null;
}

// ===== TOAST =====
function showToast(message, type = 'success', durationMs = 3000) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span><span>${esc(message)}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), durationMs);
}

// ===== UTILITIES =====
function isOnline(u) {
  if (!u.last_heartbeat) return false;
  return new Date(u.last_heartbeat).getTime() > Date.now() - 2 * 60 * 1000;
}
function getInitials(str) {
  if (!str) return '??';
  const p = str.split('.');
  if (p.length >= 2) return p[0].slice(-1) + p[1].slice(-1);
  // Fallback for device_id (uuid)
  return str.substring(0, 2).toUpperCase();
}
function esc(text) {
  if (text == null) return '';
  const d = document.createElement('div'); d.textContent = String(text); return d.innerHTML;
}
function safeUrl(url) {
  if (!url) return '#';
  try { const u = new URL(url); if (u.protocol === 'http:' || u.protocol === 'https:') return url; } catch(e) {}
  return '#';
}
function setText(id, val) {
  const el = document.getElementById(id); if (el) el.textContent = val;
}
function setDisplay(id, val) {
  const el = document.getElementById(id); if (el) el.style.display = val;
}
function statusColor(s) {
  return { pending: 'rgba(251,191,36,0.3)', sent: 'rgba(59,130,246,0.3)', invited: 'rgba(16,185,129,0.3)', skipped: 'rgba(113,113,122,0.3)', error: 'rgba(239,68,68,0.3)' }[s] || 'rgba(113,113,122,0.3)';
}
function fmtDate(d) {
  if (!d) return '-';
  const date = new Date(d); const now = new Date(); const diff = now - date;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

// ===== EVENT DELEGATION =====
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const ip = btn.dataset.ip;
  const deviceId = btn.dataset.deviceId;
  const id = btn.dataset.id;
  const key = btn.dataset.key;

  e.stopPropagation();

  switch (action) {
    case 'toggle-ip': toggleIPExpand(ip); return;
    case 'open-profile': openUserProfile(deviceId || ip); break;
    case 'edit-note': editNote(deviceId); break;
    case 'edit-ip-note': editNoteForIP(ip); return;
    case 'block-user': blockUser(ip); break;
    case 'unblock-user': unblockUser(ip); break;
    case 'delete-user': deleteUser(deviceId, ip); break;
    case 'dup-delete':
      if (confirm(`Delete device ${(deviceId || '').substring(0, 12)}…?`)) {
        sbDelete(`users?device_id=eq.${encodeURIComponent(deviceId)}`).then(() => {
          showToast('Deleted', 'success');
          closeModal();
          loadData();
        }).catch(e => showToast('Delete failed', 'error'));
      }
      return;
    case 'copy-key':
      navigator.clipboard.writeText(key).then(() => showToast('Key copied!', 'success')).catch(() => showToast('Copy failed', 'error'));
      break;
    case 'revoke-key': revokeKey(id); break;
    case 'delete-key': deleteKey(id); break;
    case 'reactivate-key': reactivateKey(id); break;
    case 'generate-unassigned': generateKey(1, null); break;
    case 'generate-for-user': generateKey(1, ip); break;
    case 'select-keys-user': selectKeysUser(ip); break;
    case 'deselect-keys-user': deselectKeysUser(); break;
    case 'export-users': exportUsersCSV(); break;
    case 'find-duplicates': showFindDuplicatesModal(); break;
    case 'bulk-block': bulkBlockUsers(); break;
    case 'bulk-delete': bulkDeleteUsers(); break;
    case 'bulk-deselect': bulkDeselectUsers(); break;
  }
});

// Click on table rows (exclude checkbox and action buttons)
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr.clickable');
  if (row && !e.target.closest('[data-action]') && !e.target.closest('.user-row-check, .col-check')) {
    const deviceId = row.dataset.deviceId;
    if (deviceId) openUserProfile(deviceId);
  }
});

// ===== INIT =====
document.getElementById('modalConfirm')?.addEventListener('click', () => { if (modalCallback) modalCallback(); });
document.getElementById('modalOverlay')?.addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });
document.getElementById('passwordInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') login(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
document.getElementById('searchInput')?.addEventListener('input', renderUsersTable);
document.getElementById('keysSearch')?.addEventListener('input', () => {
  if (keysSelectedUserIP) renderKeysForUser(keysSelectedUserIP);
  else renderAllKeysTable();
});
document.getElementById('databaseSearch')?.addEventListener('input', () => { if (currentProfileId && userDataCache[currentProfileId]) renderDatabaseTab(userDataCache[currentProfileId]); });
document.getElementById('trackerSearch')?.addEventListener('input', renderTrackerTable);
document.getElementById('trackerSort')?.addEventListener('change', renderTrackerTable);

// Nav items
document.querySelectorAll('.nav-item[data-tab]').forEach(n => {
  n.addEventListener('click', () => showTab(n.dataset.tab));
});

// "Users" shortcut button inside Agencies section
document.getElementById('goToUsersBtn')?.addEventListener('click', () => showTab('users'));

// Profile tabs
document.querySelectorAll('.profile-tabs .segmented-btn[data-tab]').forEach(t => {
  t.addEventListener('click', () => showProfileTab(t.dataset.tab));
});

// Keys filter tabs (delegated since they exist in DOM)
document.addEventListener('click', (e) => {
  const filterBtn = e.target.closest('#keysSection .segmented-btn[data-filter]');
  if (!filterBtn) return;
  keysFilter = filterBtn.dataset.filter;
  filterBtn.closest('.segmented-control')?.querySelectorAll('.segmented-btn').forEach(f => f.classList.remove('active'));
  filterBtn.classList.add('active');
  if (keysSelectedUserIP) renderKeysForUser(keysSelectedUserIP);
  else renderAllKeysTable();
});

// Users view toggle (By IP / By Device)
document.addEventListener('click', (e) => {
  const viewBtn = e.target.closest('#usersViewToggle .segmented-btn[data-view]');
  if (!viewBtn) return;
  usersViewMode = viewBtn.dataset.view;
  document.querySelectorAll('#usersViewToggle .segmented-btn').forEach(b => b.classList.remove('active'));
  viewBtn.classList.add('active');
  expandedIPs.clear();
  usersPage = 1;
  updateStats();
  renderUsersTable();
});

// Users filter tabs (All / Active / Inactive)
document.addEventListener('click', (e) => {
  const filterBtn = e.target.closest('#usersFilterTabs .segmented-btn[data-filter]');
  if (!filterBtn) return;
  usersFilter = filterBtn.dataset.filter;
  document.querySelectorAll('#usersFilterTabs .segmented-btn').forEach(f => f.classList.remove('active'));
  filterBtn.classList.add('active');
  usersPage = 1;
  renderUsersTable();
});

// Select all users
document.getElementById('selectAllUsers')?.addEventListener('change', (e) => {
  const filtered = getFilteredAndSortedUsers();
  let pageData;
  if (usersViewMode === 'ip') {
    const groups = getGroupedByIP(filtered);
    const start = (usersPage - 1) * usersPageSize;
    pageData = groups.slice(start, start + usersPageSize).flatMap(g => g.devices);
  } else {
    const start = (usersPage - 1) * usersPageSize;
    pageData = filtered.slice(start, start + usersPageSize);
  }
  if (e.target.checked) {
    pageData.forEach(u => usersSelectedIds.add(u.device_id));
  } else {
    pageData.forEach(u => usersSelectedIds.delete(u.device_id));
  }
  renderUsersTable();
});

// Row checkbox (delegated)
document.addEventListener('change', (e) => {
  if (!e.target.classList.contains('user-row-check')) return;
  const did = e.target.dataset.deviceId;
  if (e.target.checked) usersSelectedIds.add(did);
  else usersSelectedIds.delete(did);
  renderUsersTable();
});

// Pagination
document.getElementById('prevPageBtn')?.addEventListener('click', () => { usersPage = Math.max(1, usersPage - 1); renderUsersTable(); });
document.getElementById('nextPageBtn')?.addEventListener('click', () => { usersPage++; renderUsersTable(); });
document.getElementById('pageSizeSelect')?.addEventListener('change', (e) => {
  usersPageSize = parseInt(e.target.value, 10);
  usersPage = 1;
  renderUsersTable();
});

// Sortable headers
document.addEventListener('click', (e) => {
  const th = e.target.closest('th.sortable[data-sort]');
  if (!th) return;
  const sort = th.dataset.sort;
  if (usersSortBy === sort) usersSortDesc = !usersSortDesc;
  else { usersSortBy = sort; usersSortDesc = true; }
  usersPage = 1;
  document.querySelectorAll('th.sortable').forEach(h => {
    h.classList.remove('sort-asc', 'sort-desc');
    if (h.dataset.sort === usersSortBy) h.classList.add(usersSortDesc ? 'sort-desc' : 'sort-asc');
  });
  renderUsersTable();
});

document.getElementById('sidebarToggle')?.addEventListener('click', () => {
  document.querySelector('.sidebar')?.classList.toggle('open');
});
document.querySelector('.main')?.addEventListener('click', (e) => {
  if (window.innerWidth <= 600 && document.querySelector('.sidebar.open') && !e.target.closest('.sidebar')) {
    document.querySelector('.sidebar')?.classList.remove('open');
  }
});

// ===== AGENCIES =====
let agenciesData = [];
let currentAgencyId = null;

async function loadAgencies() {
  try {
    const resp = await sbGet('agencies?select=*&order=created_at.desc');
    agenciesData = resp || [];
    renderAgenciesList();
  } catch (e) { showToast('Failed to load agencies', 'error'); }
}

function renderAgenciesList() {
  const container = document.getElementById('agenciesList');
  const q = (document.getElementById('agenciesSearch')?.value || '').toLowerCase();
  const filtered = q ? agenciesData.filter(a => a.name.toLowerCase().includes(q)) : agenciesData;

  container.innerHTML = filtered.map(a => `
    <div class="agency-card" data-id="${a.id}">
      <div class="agency-card-header">
        <h3>${esc(a.name)}</h3>
        <span class="badge ${a.status === 'active' ? 'green' : 'red'}">${a.status}</span>
      </div>
      <div class="agency-card-meta">
        <span>Created: ${fmtDate(a.created_at)}</span>
        ${a.license_key ? `<span>Key: ${esc(a.license_key).slice(0, 12)}...</span>` : ''}
      </div>
      <div class="agency-card-actions">
        <button class="btn-secondary" onclick="openAgencyProfile('${a.id}')">View</button>
        <button class="btn-warning" onclick="toggleAgencyBan('${a.id}', '${a.status}')">${a.status === 'active' ? 'Ban' : 'Unban'}</button>
        <button class="btn-danger" onclick="deleteAgency('${a.id}')">Delete</button>
      </div>
    </div>
  `).join('') || '<p class="empty-row">No agencies yet. Create one to get started.</p>';
}

document.getElementById('agenciesSearch')?.addEventListener('input', renderAgenciesList);

document.getElementById('createAgencyBtn')?.addEventListener('click', () => {
  const autoKey = generateCodeStr('VLR');
  openModal('Create Agency', `
    <label>Agency Name</label>
    <input type="text" id="newAgencyName" class="search-input glass-input" placeholder="Agency name" style="width:100%;margin-bottom:12px;">
    <label>License Key <span style="opacity:.5">(auto-generated)</span></label>
    <input type="text" id="newAgencyKey" class="search-input glass-input mono" value="${autoKey}" style="width:100%;" readonly>
  `, async () => {
    const name = document.getElementById('newAgencyName')?.value.trim();
    if (!name) { showToast('Enter a name', 'error'); return; }
    const key = document.getElementById('newAgencyKey')?.value.trim() || autoKey;
    try {
      const created = await sbPost('agencies', { name, license_key: key, status: 'active' }, 'return=representation');
      const agencyId = created?.[0]?.id;
      if (agencyId) {
        const code = generateCodeStr('SPA');
        await sbPost('agency_codes', { agency_id: agencyId, code, type: 'superadmin', status: 'unused' });
        showToast(`Agency created! Superadmin code: ${code}`, 'success', 15000);
      } else {
        showToast('Agency created, but could not get ID for admin code', 'warning');
      }
      closeModal();
      loadAgencies();
    } catch (e) { showToast('Failed to create agency: ' + (e.message || e), 'error', 8000); }
  });
});

function generateCodeStr(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${seg()}-${seg()}-${seg()}`;
}

async function toggleAgencyBan(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'banned' : 'active';
  const patch = { status: newStatus };
  if (newStatus === 'banned') patch.banned_at = new Date().toISOString();
  try {
    await sbPatch(`agencies?id=eq.${id}`, patch);
    showToast(`Agency ${newStatus === 'banned' ? 'banned' : 'unbanned'}`, 'success');
    loadAgencies();
    if (currentAgencyId === id) openAgencyProfile(id);
  } catch (e) { showToast('Failed to update agency', 'error'); }
}

async function deleteAgency(id) {
  if (!confirm('Delete this agency and ALL its accounts, models, codes, notes, transactions? This cannot be undone!')) return;
  try {
    const accounts = await sbGet(`agency_accounts?agency_id=eq.${id}&select=id`);
    const accountIds = (accounts || []).map(a => a.id);

    if (accountIds.length > 0) {
      const acFilter = accountIds.map(aid => `account_id.eq.${aid}`).join(',');
      await sbDelete(`agency_account_devices?or=(${acFilter})`);
      await sbDelete(`agency_account_models?or=(${acFilter})`);
    }
    try { await sbDelete(`agency_notes?agency_id=eq.${id}`); } catch (_) {}
    try { await sbDelete(`agency_transactions?agency_id=eq.${id}`); } catch (_) {}
    try { await sbDelete(`agency_activity_log?agency_id=eq.${id}`); } catch (_) {}
    await sbDelete(`agency_codes?agency_id=eq.${id}`);
    await sbDelete(`agency_accounts?agency_id=eq.${id}`);
    await sbDelete(`agency_models?agency_id=eq.${id}`);
    await sbDelete(`agencies?id=eq.${id}`);

    showToast('Agency deleted', 'success');
    currentAgencyId = null;
    setDisplay('agencyProfile', 'none');
    loadAgencies();
  } catch (e) { showToast('Failed to delete agency', 'error'); }
}

async function openAgencyProfile(id) {
  currentAgencyId = id;
  const agency = agenciesData.find(a => a.id === id);
  if (!agency) return;

  setText('agencyProfileName', agency.name);
  document.getElementById('agencyProfileStatus').textContent = agency.status;
  document.getElementById('agencyProfileStatus').className = `agency-profile-status badge ${agency.status === 'active' ? 'green' : 'red'}`;
  document.getElementById('toggleAgencyBanBtn').textContent = agency.status === 'active' ? 'Ban' : 'Unban';
  document.getElementById('toggleAgencyBanBtn').onclick = () => toggleAgencyBan(id, agency.status);
  document.getElementById('deleteAgencyBtn').onclick = () => deleteAgency(id);
  document.getElementById('closeAgencyProfile').onclick = () => {
    unsubscribeAgencyWorkersRealtime();
    setDisplay('agencyProfile', 'none');
    currentAgencyId = null;
  };

  setDisplay('agencyProfile', 'block');
  const accounts = await loadAgencyAccounts(id);
  const accountIds = (accounts || []).map(a => a.id);
  subscribeAgencyWorkersRealtime(id, accountIds);
  loadAgencyModelsAdmin(id);
  loadAgencyCodesAdmin(id);

  document.querySelectorAll('.agency-profile-tabs .segmented-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.agency-profile-tabs .segmented-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.agency-tab-pane').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
      const target = document.getElementById('agencyTab' + btn.dataset.agencyTab.charAt(0).toUpperCase() + btn.dataset.agencyTab.slice(1));
      if (target) { target.style.display = 'block'; target.classList.add('active'); }
      if (btn.dataset.agencyTab === 'stats') loadAgencyStats(id);
    };
  });
}

function subscribeAgencyWorkersRealtime(agencyId, accountIds) {
  unsubscribeAgencyWorkersRealtime();
  if (!agencyId || !accountIds || accountIds.length === 0) return;
  const supabaseLib = typeof window !== 'undefined' && window.supabase;
  if (!supabaseLib?.createClient) return;

  try {
    const client = supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const refreshAccounts = () => { if (currentAgencyId === agencyId) loadAgencyAccounts(agencyId); };

    const setLiveIndicator = (on) => {
      const ind = document.getElementById('agencyLiveIndicator');
      if (ind) ind.style.display = on ? 'inline-flex' : 'none';
    };

    const channelDevices = client.channel(`agency-devices-${agencyId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'agency_account_devices',
        filter: `account_id=in.(${accountIds.join(',')})`
      }, refreshAccounts)
      .subscribe((status) => {
        setLiveIndicator(status === 'SUBSCRIBED');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') startAgencyPolling(agencyId);
      });

    const channelAccounts = client.channel(`agency-accounts-${agencyId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'agency_accounts',
        filter: `agency_id=eq.${agencyId}`
      }, refreshAccounts)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') startAgencyPolling(agencyId);
      });

    agencyRealtimeUnsubscribe = () => {
      try { client.removeChannel(channelDevices); } catch (e) {}
      try { client.removeChannel(channelAccounts); } catch (e) {}
      agencyRealtimeUnsubscribe = null;
      const ind = document.getElementById('agencyLiveIndicator');
      if (ind) ind.style.display = 'none';
    };
  } catch (e) {
    console.warn('[Admin] Realtime subscribe failed, using polling:', e.message);
    console.warn('[Admin] To enable Realtime: Supabase Dashboard → Database → Replication → add agency_account_devices, agency_accounts to supabase_realtime publication.');
    startAgencyPolling(agencyId);
  }
}

function unsubscribeAgencyWorkersRealtime() {
  if (agencyRealtimeUnsubscribe) {
    agencyRealtimeUnsubscribe();
    agencyRealtimeUnsubscribe = null;
  }
  stopAgencyPolling();
  const ind = document.getElementById('agencyLiveIndicator');
  if (ind) ind.style.display = 'none';
}

function startAgencyPolling(agencyId) {
  stopAgencyPolling();
  agencyPollingInterval = setInterval(() => {
    if (currentAgencyId === agencyId) loadAgencyAccounts(agencyId);
  }, 15000);
}

function stopAgencyPolling() {
  if (agencyPollingInterval) {
    clearInterval(agencyPollingInterval);
    agencyPollingInterval = null;
  }
}

async function loadAgencyAccounts(agencyId) {
  try {
    const accounts = await sbGet(`agency_accounts?agency_id=eq.${agencyId}&status=neq.deleted&select=*&order=created_at.asc`);
    const allModels = await sbGet(`agency_account_models?select=account_id,agency_models:model_id(name)`);
    const modelsByAcc = {};
    (allModels || []).forEach(m => {
      if (!m.agency_models) return;
      if (!modelsByAcc[m.account_id]) modelsByAcc[m.account_id] = [];
      modelsByAcc[m.account_id].push(m.agency_models.name);
    });

    // Fetch per-device sessions (multi-device support)
    const accountIds = (accounts || []).map(a => a.id);
    let devicesByAcc = {};
    if (accountIds.length > 0) {
      const acFilter = accountIds.map(id => `account_id.eq.${id}`).join(',');
      const devRows = await sbGet(`agency_account_devices?or=(${acFilter})&select=account_id,device_id,model_id,is_online,last_seen,idle_state,idle_since,current_page,agency_models:model_id(name)`);
      (devRows || []).forEach(d => {
        if (!devicesByAcc[d.account_id]) devicesByAcc[d.account_id] = [];
        devicesByAcc[d.account_id].push(d);
      });
    }

    const tbody = document.getElementById('agencyAccountsTable');
    const now = Date.now();
    tbody.innerHTML = (accounts || []).map(a => {
      const models = (modelsByAcc[a.id] || []).join(', ') || '—';
      const devices = (devicesByAcc[a.id] || []).map(d => {
        const lastSeenMs = d.last_seen ? new Date(d.last_seen).getTime() : 0;
        const isStale = (now - lastSeenMs) > 180000;
        return { ...d, is_online: d.is_online && !isStale };
      });
      const onlineCount = devices.filter(d => d.is_online).length;
      const onlineBadge = onlineCount > 0
        ? `<span class="badge green">${onlineCount} online</span>`
        : '<span class="badge">Offline</span>';
      const deviceDetails = devices.length > 0
        ? devices.map(d => {
            const dStatus = d.is_online ? '🟢' : '⚫';
            const dModel = d.agency_models?.name || '—';
            return `${dStatus} ${esc(dModel)}`;
          }).join('<br>')
        : '—';
      const onlineDevs = devices.filter(d => d.is_online);
      const devWithState = onlineDevs.sort((a,b) => (b.last_seen || '').localeCompare(a.last_seen || ''))[0];
      let idleDisplay = '—';
      if (devWithState?.idle_state) {
        if (devWithState.idle_state === 'active') idleDisplay = 'Active';
        else if (devWithState.idle_state === 'locked') idleDisplay = 'Locked';
        else if (devWithState.idle_since) { const min = Math.floor((Date.now() - new Date(devWithState.idle_since).getTime()) / 60000); idleDisplay = `Idle ${min}m`; }
      }
      const pageDisplay = devWithState?.current_page || '—';
      const limits = a.role === 'worker' ? `S:${a.daily_send_limit ?? '∞'} AI:${a.daily_ai_limit ?? '∞'} P:${a.daily_parse_limit ?? '∞'}` : '—';
      const lastSeen = devices.length > 0
        ? fmtDate(devices.reduce((latest, d) => (!latest || (d.last_seen && d.last_seen > latest) ? d.last_seen : latest), null) || a.last_seen)
        : (a.last_seen ? fmtDate(a.last_seen) : '—');
      const sToday = a.sends_today ?? 0;
      const aiToday = a.ai_requests_today ?? 0;
      const pToday = a.parses_today ?? 0;
      const hasActivity = sToday > 0 || aiToday > 0 || pToday > 0;
      const activityClass = hasActivity ? 'agency-activity-active' : 'agency-activity-idle';
      const activityToday = a.role === 'worker' ? `<span class="agency-activity ${activityClass}" title="Sends / AI / Parses today">${sToday}/${aiToday}/${pToday}</span>` : '—';
      return `<tr data-account-id="${a.id}">
        <td>${esc(a.display_name)}</td>
        <td class="mono">${esc(a.username)}</td>
        <td><span class="badge ${a.role === 'superadmin' ? 'purple' : a.role === 'admin' ? 'orange' : 'green'}">${a.role}</span></td>
        <td>${esc(models)}</td>
        <td><span class="badge ${a.status === 'active' ? 'green' : 'red'}">${a.status}</span></td>
        <td>${onlineBadge}</td>
        <td>${esc(idleDisplay)}</td>
        <td>${esc(pageDisplay)}</td>
        <td>${lastSeen}</td>
        <td>${activityToday}</td>
        <td>${limits}</td>
        <td style="font-size:11px">${deviceDetails}</td>
        <td><button class="btn-danger" onclick="deleteAgencyAccountAdmin('${a.id}')">Delete</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="13" class="empty-row">No accounts</td></tr>';
    return accounts;
  } catch (e) { showToast('Failed to load accounts', 'error'); return []; }
}

async function loadAgencyModelsAdmin(agencyId) {
  try {
    const models = await sbGet(`agency_models?agency_id=eq.${agencyId}&select=*&order=created_at.asc`);
    const tbody = document.getElementById('agencyModelsTable');
    tbody.innerHTML = (models || []).map(m => `<tr>
      <td>${esc(m.name)}</td>
      <td>${fmtDate(m.created_at)}</td>
      <td><button class="btn-danger" onclick="deleteAgencyModelAdmin('${m.id}')">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="3" class="empty-row">No models</td></tr>';
  } catch (e) { /* silent */ }
}

async function deleteAgencyModelAdmin(modelId) {
  if (!confirm('Delete this model?')) return;
  try {
    await sbDelete(`agency_models?id=eq.${modelId}`);
    showToast('Model deleted', 'success');
    if (currentAgencyId) loadAgencyModelsAdmin(currentAgencyId);
  } catch (e) { showToast('Failed', 'error'); }
}

document.getElementById('agencyAddModelBtn')?.addEventListener('click', async () => {
  if (!currentAgencyId) return;
  const name = document.getElementById('agencyNewModelName')?.value.trim();
  if (!name) { showToast('Enter model name', 'error'); return; }
  try {
    await sbPost('agency_models', { agency_id: currentAgencyId, name });
    document.getElementById('agencyNewModelName').value = '';
    showToast('Model added', 'success');
    loadAgencyModelsAdmin(currentAgencyId);
  } catch (e) { showToast('Failed', 'error'); }
});

async function loadAgencyCodesAdmin(agencyId) {
  try {
    const codes = await sbGet(`agency_codes?agency_id=eq.${agencyId}&select=*&order=created_at.desc`);
    const tbody = document.getElementById('agencyCodesTable');
    tbody.innerHTML = (codes || []).map(c => `<tr>
      <td class="mono">${esc(c.code)}</td>
      <td><span class="badge ${c.type === 'superadmin' ? 'purple' : c.type === 'admin' ? 'orange' : 'blue'}">${c.type}</span></td>
      <td><span class="badge ${c.status === 'unused' ? 'green' : ''}">${c.status}</span></td>
      <td>${fmtDate(c.created_at)}</td>
      <td><button class="btn-danger" onclick="deleteAgencyCode('${c.id}')">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-row">No codes</td></tr>';
  } catch (e) { /* silent */ }
}

async function deleteAgencyCode(codeId) {
  if (!confirm('Delete this code? If an account was registered with it, that account will also be deleted.')) return;
  try {
    // Find and delete the account registered with this code
    const codes = await sbGet(`agency_codes?id=eq.${codeId}&select=used_by_account_id`);
    const accountId = codes?.[0]?.used_by_account_id;
    if (accountId) {
      await sbDelete(`agency_account_devices?account_id=eq.${accountId}`);
      await sbDelete(`agency_account_models?account_id=eq.${accountId}`);
      try { await sbDelete(`agency_notes?account_id=eq.${accountId}`); } catch (_) {}
      await sbDelete(`agency_accounts?id=eq.${accountId}`);
    }
    await sbDelete(`agency_codes?id=eq.${codeId}`);
    showToast('Code and associated account deleted', 'success');
    if (currentAgencyId) {
      loadAgencyCodesAdmin(currentAgencyId);
      loadAgencyAccounts(currentAgencyId);
    }
  } catch (e) { showToast('Failed to delete code: ' + (e.message || e), 'error'); }
}

async function deleteAgencyAccountAdmin(accountId) {
  if (!confirm('Delete this account? This cannot be undone.')) return;
  try {
    await sbDelete(`agency_account_devices?account_id=eq.${accountId}`);
    await sbDelete(`agency_account_models?account_id=eq.${accountId}`);
    try { await sbDelete(`agency_notes?account_id=eq.${accountId}`); } catch (_) {}
    // Also mark the code as unused if one was used by this account
    try { await sbPatch(`agency_codes?used_by_account_id=eq.${accountId}`, { used_by_account_id: null, status: 'unused', used_at: null }); } catch (_) {}
    await sbDelete(`agency_accounts?id=eq.${accountId}`);
    showToast('Account deleted', 'success');
    if (currentAgencyId) loadAgencyAccounts(currentAgencyId);
  } catch (e) { showToast('Failed to delete account: ' + (e.message || e), 'error'); }
}

document.getElementById('agencyGenCodeBtn')?.addEventListener('click', async () => {
  if (!currentAgencyId) return;
  const type = document.getElementById('agencyCodeTypeSelect')?.value || 'worker';
  const prefixMap = { superadmin: 'SPA', admin: 'ADM', worker: 'WRK' };
  const code = generateCodeStr(prefixMap[type] || 'WRK');
  try {
    await sbPost('agency_codes', { agency_id: currentAgencyId, code, type, status: 'unused' });
    showToast(`Code generated: ${code}`, 'success', 8000);
    loadAgencyCodesAdmin(currentAgencyId);
  } catch (e) { showToast('Failed', 'error'); }
});

// ===== AGENCY STATS =====
async function loadAgencyStats(agencyId) {
  try {
    const [accounts, transactions, notes, models, activityLog] = await Promise.all([
      sbGet(`agency_accounts?agency_id=eq.${agencyId}&status=neq.deleted&select=id,display_name,role,device_id,last_seen`),
      sbGet(`agency_transactions?agency_id=eq.${agencyId}&select=id,account_id,model_id,fan_nick,amount,transaction_date,agency_models:model_id(name),agency_accounts:account_id(display_name)`),
      sbGet(`agency_notes?agency_id=eq.${agencyId}&select=*,agency_accounts:account_id(display_name),agency_models:model_id(name)&order=updated_at.desc`),
      sbGet(`agency_models?agency_id=eq.${agencyId}&select=id,name`),
      sbGet(`agency_activity_log?agency_id=eq.${agencyId}&select=*,agency_accounts:actor_account_id(display_name)&order=created_at.desc&limit=50`)
    ]);

    const accountIds = (accounts || []).map(a => a.id);
    let deviceIds = [];
    if (accountIds.length > 0) {
      const acFilter = accountIds.map(id => `account_id.eq.${id}`).join(',');
      const devRows = await sbGet(`agency_account_devices?or=(${acFilter})&select=device_id`);
      deviceIds = [...new Set((devRows || []).map(d => d.device_id).filter(Boolean))];
    }

    let usersStats = [];
    if (deviceIds.length > 0) {
      const devFilter = deviceIds.map(d => `device_id.eq.${encodeURIComponent(d)}`).join(',');
      usersStats = await sbGet(`users?or=(${devFilter})&select=device_id,messages_sent,ai_requests,parses_done,last_heartbeat`);
    }
    const userStatsByDevice = {};
    (usersStats || []).forEach(u => { userStatsByDevice[u.device_id] = u; });

    const allTx = transactions || [];
    let totalSpend = 0;
    allTx.forEach(t => { totalSpend += Number(t.amount) || 0; });

    let totalMsgs = 0, totalAI = 0, totalParses = 0;
    Object.values(userStatsByDevice).forEach(u => {
      totalMsgs += u.messages_sent || 0;
      totalAI += u.ai_requests || 0;
      totalParses += u.parses_done || 0;
    });

    setText('agStatTotalSpend', '$' + totalSpend.toFixed(2));
    setText('agStatAccounts', (accounts || []).length);
    setText('agStatMessages', totalMsgs);
    setText('agStatAI', totalAI);
    setText('agStatParses', totalParses);
    setText('agStatTransactions', allTx.length);

    // Spending by Model
    const byModel = {};
    allTx.forEach(t => {
      const mId = t.model_id || 'none';
      const mName = t.agency_models?.name || 'No model';
      if (!byModel[mId]) byModel[mId] = { name: mName, total: 0, count: 0, workers: new Set() };
      byModel[mId].total += Number(t.amount) || 0;
      byModel[mId].count++;
      if (t.account_id) byModel[mId].workers.add(t.account_id);
    });

    const modelTbody = document.getElementById('agencyStatsModelTable');
    modelTbody.innerHTML = Object.values(byModel).map(m => `<tr>
      <td>${esc(m.name)}</td>
      <td>$${m.total.toFixed(2)}</td>
      <td>${m.count}</td>
      <td>${m.workers.size}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-row">No transactions yet</td></tr>';

    // Spending by Worker
    const byWorker = {};
    allTx.forEach(t => {
      const aId = t.account_id || 'unknown';
      const aName = t.agency_accounts?.display_name || 'Unknown';
      if (!byWorker[aId]) byWorker[aId] = { name: aName, total: 0, count: 0 };
      byWorker[aId].total += Number(t.amount) || 0;
      byWorker[aId].count++;
    });
    const accountMap = {};
    (accounts || []).forEach(a => { accountMap[a.id] = a; });

    const workerTbody = document.getElementById('agencyStatsWorkerTable');
    const workerRows = (accounts || []).map(a => {
      const w = byWorker[a.id] || { total: 0, count: 0 };
      const devRows = Object.entries(userStatsByDevice);
      let msgs = 0;
      if (a.device_id && userStatsByDevice[a.device_id]) msgs = userStatsByDevice[a.device_id].messages_sent || 0;
      return `<tr>
        <td>${esc(a.display_name)}</td>
        <td><span class="badge ${a.role === 'superadmin' ? 'purple' : a.role === 'admin' ? 'orange' : 'green'}">${a.role}</span></td>
        <td>$${w.total.toFixed(2)}</td>
        <td>${w.count}</td>
        <td>${msgs}</td>
        <td>${a.last_seen ? fmtDate(a.last_seen) : '—'}</td>
      </tr>`;
    });
    workerTbody.innerHTML = workerRows.join('') || '<tr><td colspan="6" class="empty-row">No accounts</td></tr>';

    // Tracker by Fan (fan + model level)
    const byFan = {};
    const notesByFanModel = {};
    (notes || []).forEach(n => {
      const key = `${(n.fan_nick || '').toLowerCase()}::${n.model_id || 'none'}`;
      notesByFanModel[key] = n.note_text || '';
    });
    allTx.forEach(t => {
      const fan = t.fan_nick || 'Unknown';
      const mId = t.model_id || 'none';
      const mName = t.agency_models?.name || 'No model';
      const key = `${fan.toLowerCase()}::${mId}`;
      if (!byFan[key]) byFan[key] = { fan, modelId: mId, modelName: mName, total: 0, count: 0, lastPayment: null, lastAmount: 0 };
      const r = byFan[key];
      r.total += Number(t.amount) || 0;
      r.count++;
      const d = t.transaction_date;
      if (d && (!r.lastPayment || d > r.lastPayment)) { r.lastPayment = d; r.lastAmount = Number(t.amount) || 0; }
    });
    const fanRows = Object.values(byFan).sort((a, b) => b.total - a.total);
    fanRows.forEach(r => {
      const noteKey = `${r.fan.toLowerCase()}::${r.modelId}`;
      r.note = notesByFanModel[noteKey] || notesByFanModel[`${r.fan.toLowerCase()}::none`] || '';
    });
    const fanTbody = document.getElementById('agencyStatsFanTable');
    fanTbody.innerHTML = fanRows.map(r => `<tr>
      <td>${esc(r.fan)}</td>
      <td>${esc(r.modelName)}</td>
      <td>$${r.total.toFixed(2)}</td>
      <td>${r.count}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${esc(r.note || '-')}</td>
      <td>${r.lastPayment ? fmtDate(r.lastPayment) + ' ($' + r.lastAmount.toFixed(2) + ')' : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty-row">No transactions yet</td></tr>';

    // Recent Transactions (last 20)
    const recentTx = [...allTx].sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0)).slice(0, 20);
    const recentTbody = document.getElementById('agencyStatsRecentTxTable');
    recentTbody.innerHTML = recentTx.map(t => `<tr>
      <td>${esc(t.fan_nick || '—')}</td>
      <td>$${Number(t.amount || 0).toFixed(2)}</td>
      <td>${esc(t.agency_models?.name || '—')}</td>
      <td>${fmtDate(t.transaction_date)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-row">No transactions yet</td></tr>';

    // Notes
    const noteFilter = document.getElementById('agencyStatsNoteFilter');
    noteFilter.innerHTML = '<option value="">All Models</option>' +
      (models || []).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    noteFilter.onchange = () => renderAgencyNotes(notes || [], noteFilter.value);
    renderAgencyNotes(notes || [], '');

    const logTbody = document.getElementById('agencyStatsLogTable');
    logTbody.innerHTML = (activityLog || []).map(l => `<tr>
      <td>${fmtDate(l.created_at)}</td>
      <td>${esc(l.agency_accounts?.display_name || '—')}</td>
      <td>${esc(l.action)}</td>
      <td>${esc(l.target_type || '—')}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;font-size:11px;">${l.details ? esc(JSON.stringify(l.details)) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-row">No activity yet</td></tr>';

    let chatLog = [];
    try {
      chatLog = await sbGet(`agency_chat_log?agency_id=eq.${agencyId}&select=*,agency_accounts:account_id(display_name),agency_models:model_id(name)&order=created_at.desc&limit=100`);
    } catch (_) { chatLog = []; }
    const chatLogTbody = document.getElementById('agencyStatsChatLogTable');
    if (chatLogTbody) {
      chatLogTbody.innerHTML = (chatLog || []).map(c => {
        const msg = (c.message_text || '').substring(0, 200);
        const msgDisplay = msg.length < (c.message_text || '').length ? msg + '…' : msg;
        return `<tr>
          <td>${fmtDate(c.created_at)}</td>
          <td>${esc(c.agency_accounts?.display_name || '—')}</td>
          <td>${esc(c.fan_nick || '—')}</td>
          <td><span class="badge ${c.direction === 'sent' ? 'green' : 'blue'}">${esc(c.direction || 'sent')}</span></td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;font-size:12px;" title="${esc(c.message_text || '')}">${esc(msgDisplay)}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="empty-row">No chat messages yet. Run supabase_migrations.sql to create agency_chat_log table.</td></tr>';
    }
  } catch (e) {
    console.error('loadAgencyStats error:', e);
    showToast('Failed to load agency stats', 'error');
  }
}

function renderAgencyNotes(notes, filterModelId) {
  const filtered = filterModelId ? notes.filter(n => n.model_id === filterModelId) : notes;
  const tbody = document.getElementById('agencyStatsNotesTable');
  tbody.innerHTML = filtered.map(n => `<tr>
    <td>${esc(n.agency_accounts?.display_name || 'Unknown')}</td>
    <td>${esc(n.agency_models?.name || '—')}</td>
    <td>${esc(n.fan_nick || '—')}</td>
    <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;">${esc(n.note_text || '')}</td>
    <td>${fmtDate(n.updated_at)}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="empty-row">No notes</td></tr>';
}

initTheme();
checkAuth();
