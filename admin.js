// ===== VELARYN ADMIN PANEL v2 =====
const SUPABASE_URL = 'https://kklwsrrlynmpsyispbyn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrbHdzcnJseW5tcHN5aXNwYnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDU5NDEsImV4cCI6MjA4NTkyMTk0MX0.rA62ShgmXMvGyDl5cxEd4s-rIBEV1Spn0HX8YF_Qjrc';
const ADMIN_PASSWORD = 'velaryn2024';

// State
let currentTab = 'users';
let usersData = [];
let blockedData = [];
let licenseKeysData = [];
let userDataCache = {};
let autoRefreshInterval = null;
let profileRefreshInterval = null;
let currentProfileIP = null;
let trackerUsersData = [];
let trackerNotes = {};
let trackerNickToId = {};
let trackerTransactions = [];

// ===== AUTH =====
function login() {
  const pw = document.getElementById('passwordInput').value;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.add('active');
    localStorage.setItem('velaryn_admin_auth', 'true');
    loadData();
    startAutoRefresh();
  } else {
    showToast('Invalid password', 'error');
  }
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
function sbHeaders() {
  return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };
}
function sbHeadersWrite() {
  return { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`GET ${path} failed: ${r.status}`);
  return r.json();
}

async function sbPost(path, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST', headers: sbHeadersWrite(), body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`POST ${path} failed: ${r.status}`);
}

async function sbPatch(path, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: sbHeadersWrite(), body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`PATCH ${path} failed: ${r.status}`);
}

async function sbDelete(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE', headers: sbHeaders()
  });
  if (!r.ok) throw new Error(`DELETE ${path} failed: ${r.status}`);
}

// ===== DATA LOADING =====
async function loadData() {
  try {
    const [users, blocked, keys] = await Promise.all([
      sbGet('users?select=*&order=last_seen.desc'),
      sbGet('blocked_ips?select=*&order=blocked_at.desc'),
      sbGet('license_keys?select=*&order=created_at.desc')
    ]);
    usersData = users;
    blockedData = blocked;
    licenseKeysData = keys;
    updateStats();
    if (currentTab === 'users' && !currentProfileIP) renderUsersTable();
    if (currentTab === 'blocked') renderBlockedTable();
    if (currentTab === 'keys') renderKeysTable();
    if (currentProfileIP) loadUserProfile(currentProfileIP);
  } catch (error) {
    console.error('Failed to load data:', error);
  }
}

// ===== STATS =====
function updateStats() {
  const blockedIPs = new Set(blockedData.map(b => b.ip));
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const onlineCount = usersData.filter(u => {
    if (blockedIPs.has(u.ip)) return false;
    return new Date(u.last_activity || u.last_seen).getTime() > fiveMinAgo;
  }).length;
  const totalMessages = usersData.reduce((sum, u) => sum + (u.messages_sent || 0), 0);
  const activeKeys = licenseKeysData.filter(k => k.status === 'active').length;

  setText('totalUsers', usersData.length);
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
  if (currentProfileIP) closeUserProfile();
  // Show/hide sections
  setDisplay('usersSection', tab === 'users' ? 'block' : 'none');
  setDisplay('blockedSection', tab === 'blocked' ? 'block' : 'none');
  setDisplay('keysSection', tab === 'keys' ? 'block' : 'none');
  const titles = { users: 'Users', blocked: 'Blocked Users', keys: 'License Keys' };
  setText('pageTitle', titles[tab] || 'Dashboard');
  loadData();
}

// ===== RENDER: USERS TABLE =====
function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  const blockedIPs = new Set(blockedData.map(b => b.ip));
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  let filtered = usersData;
  if (q) {
    filtered = usersData.filter(u =>
      (u.ip || '').toLowerCase().includes(q) ||
      (u.country || '').toLowerCase().includes(q) ||
      (u.city || '').toLowerCase().includes(q) ||
      (u.note || '').toLowerCase().includes(q)
    );
  }
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="icon">👥</div><div>No users found</div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(user => {
    const blocked = blockedIPs.has(user.ip);
    const online = isOnline(user);
    const ini = getInitials(user.ip);
    return `<tr class="clickable" data-action="open-profile" data-ip="${esc(user.ip)}">
      <td><div class="user-cell"><div class="user-avatar">${ini}</div><div class="user-info"><div class="ip">${esc(user.ip)}</div><div class="note">${esc(user.note || 'No note')}</div></div></div></td>
      <td><div class="location-cell"><span class="country">${esc(user.country || 'Unknown')}</span><span class="city">${esc(user.city || '')}</span></div></td>
      <td><div class="system-cell"><div class="os">${esc(user.os || 'Unknown')}</div><div class="browser">${esc((user.browser || '') + ' ' + (user.browser_version || ''))}</div></div></td>
      <td><div class="stats-cell"><div class="main-stat">${user.messages_sent || 0} msgs</div><div class="sub-stat">${user.sessions_count || 1} sessions</div></div></td>
      <td>${blocked ? '<span class="badge blocked">Blocked</span>' : `<span class="online-indicator ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>`}</td>
      <td class="time-ago">${fmtDate(user.last_seen)}</td>
      <td>
        <button class="action-btn edit" data-action="edit-note" data-ip="${esc(user.ip)}">✏️</button>
        ${blocked ? '' : `<button class="action-btn block" data-action="block-user" data-ip="${esc(user.ip)}">Block</button>`}
      </td>
    </tr>`;
  }).join('');
}

// ===== RENDER: BLOCKED TABLE =====
function renderBlockedTable() {
  const tbody = document.getElementById('blockedTableBody');
  if (blockedData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><div class="icon">✅</div><div>No blocked users</div></td></tr>';
    return;
  }
  tbody.innerHTML = blockedData.map(b => `<tr>
    <td><span style="color:#a78bfa;font-family:monospace">${esc(b.ip)}</span></td>
    <td>${esc(b.reason || '-')}</td>
    <td class="time-ago">${fmtDate(b.blocked_at)}</td>
    <td><button class="action-btn unblock" data-action="unblock-user" data-ip="${esc(b.ip)}">Unblock</button></td>
  </tr>`).join('');
}

// ===== RENDER: LICENSE KEYS TABLE =====
function renderKeysTable() {
  const tbody = document.getElementById('keysTableBody');
  const q = (document.getElementById('keysSearch')?.value || '').toLowerCase();
  let filtered = licenseKeysData;
  if (q) {
    filtered = licenseKeysData.filter(k =>
      (k.key || '').toLowerCase().includes(q) ||
      (k.bound_ip || '').toLowerCase().includes(q) ||
      (k.note || '').toLowerCase().includes(q)
    );
  }
  // Update key stats
  const active = licenseKeysData.filter(k => k.status === 'active').length;
  const unused = licenseKeysData.filter(k => k.status === 'unused').length;
  const revoked = licenseKeysData.filter(k => k.status === 'revoked').length;
  setText('keyStat-total', licenseKeysData.length);
  setText('keyStat-active', active);
  setText('keyStat-unused', unused);
  setText('keyStat-revoked', revoked);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="icon">🔑</div><div>No license keys yet. Generate one!</div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(k => {
    const statusClass = k.status === 'active' ? 'key-active' : k.status === 'revoked' ? 'key-revoked' : 'key-unused';
    return `<tr>
      <td><code class="key-code">${esc(k.key)}</code> <button class="copy-btn" data-action="copy-key" data-key="${esc(k.key)}" title="Copy">📋</button></td>
      <td><span class="key-badge ${statusClass}">${k.status}</span></td>
      <td>${k.bound_ip ? `<span style="color:#a78bfa;font-family:monospace;font-size:12px">${esc(k.bound_ip)}</span>` : '<span style="color:#52525b">-</span>'}</td>
      <td>${k.bound_device_id ? `<span style="color:#71717a;font-size:11px">${esc(k.bound_device_id.substring(0, 8))}...</span>` : '<span style="color:#52525b">-</span>'}</td>
      <td class="time-ago">${fmtDate(k.created_at)}</td>
      <td>
        ${k.status === 'active' ? `<button class="action-btn block" data-action="revoke-key" data-id="${k.id}">Revoke</button>` : ''}
        ${k.status === 'unused' ? `<button class="action-btn block" data-action="delete-key" data-id="${k.id}">Delete</button>` : ''}
        ${k.status === 'revoked' ? `<button class="action-btn unblock" data-action="reactivate-key" data-id="${k.id}">Reset</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

// ===== ACTIONS: USERS =====
async function blockUser(ip) {
  openModal('Block User', `
    <div class="modal-field"><label>IP Address</label><input type="text" value="${esc(ip)}" disabled></div>
    <div class="modal-field"><label>Reason (shown to user)</label><textarea id="blockReason" placeholder="e.g., Violation of terms"></textarea></div>
  `, async () => {
    const reason = document.getElementById('blockReason').value;
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

function editNote(ip) {
  const user = usersData.find(u => u.ip === ip);
  const currentNote = user?.note || '';
  openModal('Edit Note', `
    <div class="modal-field"><label>IP Address</label><input type="text" value="${esc(ip)}" disabled></div>
    <div class="modal-field"><label>Note (only visible to you)</label><textarea id="userNote" placeholder="e.g., Friend, Test user">${esc(currentNote)}</textarea></div>
  `, async () => {
    const note = document.getElementById('userNote').value;
    try {
      await sbPatch(`users?ip=eq.${encodeURIComponent(ip)}`, { note: note || null });
      showToast('Note saved', 'success');
      closeModal();
      loadData();
    } catch (e) { showToast('Failed to save note', 'error'); }
  });
}

// ===== ACTIONS: LICENSE KEYS =====
function generateKeyString() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I,O,0,1 for clarity
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `VLR-${seg()}-${seg()}-${seg()}`;
}

async function generateKey(count = 1) {
  try {
    for (let i = 0; i < count; i++) {
      const key = generateKeyString();
      await sbPost('license_keys', { key, status: 'unused', created_at: new Date().toISOString() });
    }
    showToast(`${count} key(s) generated`, 'success');
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
  if (!confirm('Delete this unused key?')) return;
  try {
    await sbDelete(`license_keys?id=eq.${id}`);
    showToast('Key deleted', 'success');
    loadData();
  } catch (e) { showToast('Failed to delete', 'error'); }
}

async function reactivateKey(id) {
  if (!confirm('Reset this key to unused? It will unbind from the device.')) return;
  try {
    await sbPatch(`license_keys?id=eq.${id}`, { status: 'unused', bound_ip: null, bound_device_id: null, bound_at: null });
    showToast('Key reset to unused', 'success');
    loadData();
  } catch (e) { showToast('Failed to reset', 'error'); }
}

// ===== USER PROFILE =====
async function openUserProfile(ip) {
  currentProfileIP = ip;
  setDisplay('usersSection', 'none');
  setDisplay('blockedSection', 'none');
  setDisplay('keysSection', 'none');
  setDisplay('userProfileSection', 'block');
  setText('pageTitle', 'User Profile');
  // Reset tabs
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.profile-tab')?.classList.add('active');
  document.querySelectorAll('.profile-tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tabInfo')?.classList.add('active');
  await loadUserProfile(ip);
  if (profileRefreshInterval) clearInterval(profileRefreshInterval);
  profileRefreshInterval = setInterval(() => loadUserProfile(ip), 10000);
}

async function loadUserProfile(ip) {
  const user = usersData.find(u => u.ip === ip);
  if (!user) return;
  setText('profileIP', ip);
  setText('profileNote', user.note || 'No note');
  setText('profileAvatar', getInitials(ip));
  const online = isOnline(user);
  document.getElementById('profileStatus').innerHTML = `<span class="online-indicator ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>`;
  setText('profileMessages', user.messages_sent || 0);
  setText('profileParses', user.parses_done || 0);
  setText('profileSessions', user.sessions_count || 0);
  setText('profileAIRequests', user.ai_requests || 0);
  setText('infoOS', user.os || '-');
  setText('infoBrowser', `${user.browser || '-'} ${user.browser_version || ''}`);
  setText('infoLanguage', user.language || '-');
  setText('infoScreen', user.screen_resolution || '-');
  setText('infoTimezone', user.timezone || '-');
  setText('infoCountry', user.country || '-');
  setText('infoCity', user.city || '-');
  setText('infoFirstSeen', fmtDate(user.first_seen));
  setText('infoLastActivity', fmtDate(user.last_activity || user.last_seen));
  setText('infoVersion', user.extension_version || '-');
  await loadUserDataForProfile(ip);
}

async function loadUserDataForProfile(ip) {
  try {
    const data = await sbGet(`user_data?ip=eq.${encodeURIComponent(ip)}&select=*`);
    const ud = data[0] || null;
    userDataCache[ip] = ud;
    renderInvitesTab(ud);
    renderDatabaseTab(ud);
    renderHistoryTab(ud);
    renderSettingsTab(ud);
    renderTrackerTab(ud);
  } catch (e) { console.error('Failed to load user data:', e); }
}

function closeUserProfile() {
  currentProfileIP = null;
  if (profileRefreshInterval) { clearInterval(profileRefreshInterval); profileRefreshInterval = null; }
  setDisplay('userProfileSection', 'none');
  showTab(currentTab);
}

function refreshUserProfile() {
  if (currentProfileIP) { loadUserProfile(currentProfileIP); showToast('Refreshed', 'success'); }
}

function exportUserData() {
  const user = usersData.find(u => u.ip === currentProfileIP);
  const ud = userDataCache[currentProfileIP];
  const blob = new Blob([JSON.stringify({ user, userData: ud, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `user_${(currentProfileIP || '').replace(/\./g, '_')}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported', 'success');
}

// ===== PROFILE TAB RENDERERS =====
function showProfileTab(tabName) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.profile-tab[data-tab="${tabName}"]`)?.classList.add('active');
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
  tbody.innerHTML = f.map((x, i) => `<tr><td>${x.number || i+1}</td><td style="color:#a78bfa;font-weight:500">${esc(x.nickname || x.id || '-')}</td><td><span class="badge" style="background:${statusColor(x.status)};color:#fff">${x.status || '?'}</span></td><td>${x.invited ? '✅' : '❌'}</td></tr>`).join('');
}

function renderHistoryTab(ud) {
  const c = document.getElementById('historyList');
  if (!ud) { c.innerHTML = '<div class="empty-state"><div class="icon">📜</div><div>No data synced</div></div>'; return; }
  let h = [];
  try { h = JSON.parse(ud.send_history || '[]'); } catch(e) {}
  if (!h.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📜</div><div>No history</div></div>'; return; }
  c.innerHTML = h.map(item => `<div class="history-item"><div class="target">${esc(item.target || item.nickname || item.to || '?')}</div><div class="time">${fmtDate(item.timestamp || item.sentAt || item.date)}</div></div>`).join('');
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
    return `<tr><td><div class="tracker-user"><div class="tracker-user-avatar">${ini}</div><a href="${url}" target="_blank" class="tracker-user-link">${esc(u.nick)}</a></div></td><td><span class="tracker-amount ${ac}">$${u.totalSpent.toFixed(2)}</span></td><td>${u.transactionCount}</td><td>${u.rank ? `<span class="tracker-rank ${rc}">#${u.rank}</span>` : '-'}</td><td class="tracker-date">${u.lastTransaction ? `${fmtDate(u.lastTransaction)} ($${u.lastAmount.toFixed(2)})` : '-'}</td><td><span class="tracker-note" title="${esc(u.note || '')}">${esc(u.note || '-')}</span></td></tr>`;
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
    return `<div class="tracker-note-item"><div class="tracker-note-header"><span class="tracker-note-user"><a href="${url}" target="_blank">👤 ${esc(nick)}</a></span></div><div class="tracker-note-text">${esc(v)}</div></div>`;
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
    return `<div class="tracker-tx-item"><div class="tracker-tx-avatar">💰</div><div class="tracker-tx-info"><div class="tracker-tx-user"><a href="${url}" target="_blank">${esc(nick)}</a></div><div class="tracker-tx-details">${esc(t.type || t.item || 'Purchase')} • ${fmtDate(t.timestamp || t.date)}</div></div><div class="tracker-tx-amount ${ac}">$${amt.toFixed(2)}</div></div>`;
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
    return `<div class="tracker-sent-message"><div class="tracker-sent-header"><div class="tracker-sent-to"><div class="tracker-sent-to-avatar">${ini}</div><div class="tracker-sent-to-name"><a href="${url}" target="_blank">${esc(m.nick)}</a></div></div><span class="tracker-sent-date">${fmtDate(m.ts)}</span></div><div class="tracker-sent-content">${esc(m.msg)}</div></div>`;
  }).join('');
}

// ===== MODAL =====
let modalCallback = null;
function openModal(title, content, onConfirm) {
  setText('modalTitle', title);
  document.getElementById('modalContent').innerHTML = content;
  document.getElementById('modalOverlay').classList.add('active');
  modalCallback = onConfirm;
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  modalCallback = null;
}

// ===== TOAST =====
function showToast(message, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span><span>${esc(message)}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ===== UTILITIES =====
function isOnline(u) {
  return new Date(u.last_activity || u.last_seen).getTime() > Date.now() - 5 * 60 * 1000;
}
function getInitials(ip) {
  const p = ip.split('.'); return p.length >= 2 ? p[0].slice(-1) + p[1].slice(-1) : '??';
}
function esc(text) {
  if (text == null) return '';
  const d = document.createElement('div'); d.textContent = String(text); return d.innerHTML;
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
  const id = btn.dataset.id;
  const key = btn.dataset.key;

  e.stopPropagation();

  switch (action) {
    case 'open-profile': openUserProfile(ip); break;
    case 'edit-note': editNote(ip); break;
    case 'block-user': blockUser(ip); break;
    case 'unblock-user': unblockUser(ip); break;
    case 'copy-key':
      navigator.clipboard.writeText(key).then(() => showToast('Key copied!', 'success')).catch(() => showToast('Copy failed', 'error'));
      break;
    case 'revoke-key': revokeKey(id); break;
    case 'delete-key': deleteKey(id); break;
    case 'reactivate-key': reactivateKey(id); break;
    case 'generate-1': generateKey(1); break;
    case 'generate-5': generateKey(5); break;
  }
});

// Click on table rows
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr.clickable');
  if (row && !e.target.closest('[data-action]')) {
    const ip = row.dataset.ip;
    if (ip) openUserProfile(ip);
  }
});

// ===== INIT =====
document.getElementById('modalConfirm')?.addEventListener('click', () => { if (modalCallback) modalCallback(); });
document.getElementById('modalOverlay')?.addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });
document.getElementById('passwordInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') login(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
document.getElementById('searchInput')?.addEventListener('input', renderUsersTable);
document.getElementById('keysSearch')?.addEventListener('input', renderKeysTable);
document.getElementById('databaseSearch')?.addEventListener('input', () => { if (currentProfileIP && userDataCache[currentProfileIP]) renderDatabaseTab(userDataCache[currentProfileIP]); });
document.getElementById('trackerSearch')?.addEventListener('input', renderTrackerTable);
document.getElementById('trackerSort')?.addEventListener('change', renderTrackerTable);

// Nav items
document.querySelectorAll('.nav-item[data-tab]').forEach(n => {
  n.addEventListener('click', () => showTab(n.dataset.tab));
});

// Profile tabs
document.querySelectorAll('.profile-tab[data-tab]').forEach(t => {
  t.addEventListener('click', () => showProfileTab(t.dataset.tab));
});

checkAuth();
