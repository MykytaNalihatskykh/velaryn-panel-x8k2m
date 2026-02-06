// ===== VELARYN ADMIN PANEL =====
const SUPABASE_URL = 'https://kklwsrrlynmpsyispbyn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrbHdzcnJseW5tcHN5aXNwYnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDU5NDEsImV4cCI6MjA4NTkyMTk0MX0.rA62ShgmXMvGyDl5cxEd4s-rIBEV1Spn0HX8YF_Qjrc';
const ADMIN_PASSWORD = 'velaryn2024';

let currentTab = 'users';
let usersData = [];
let blockedData = [];
let userDataCache = {}; // Cache for user_data table
let autoRefreshInterval = null;
let profileRefreshInterval = null;
let currentProfileIP = null;

// === AUTH ===
function login() {
  const password = document.getElementById('passwordInput').value;
  if (password === ADMIN_PASSWORD) {
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

// === AUTO REFRESH ===
function startAutoRefresh() {
  if (autoRefreshInterval) return;
  autoRefreshInterval = setInterval(loadData, 5000); // Refresh every 5 seconds for real-time updates
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// === DATA LOADING ===
async function loadData() {
  try {
    const usersResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=*&order=last_seen.desc`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    usersData = await usersResponse.json();

    const blockedResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/blocked_ips?select=*&order=blocked_at.desc`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    blockedData = await blockedResponse.json();

    updateStats();
    renderUsersTable();
    renderBlockedTable();
  } catch (error) {
    console.error('Failed to load data:', error);
    showToast('Failed to load data', 'error');
  }
}

// === STATS ===
function updateStats() {
  const blockedIPs = new Set(blockedData.map(b => b.ip));
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  
  const onlineCount = usersData.filter(u => {
    if (blockedIPs.has(u.ip)) return false;
    const lastActivity = new Date(u.last_activity || u.last_seen).getTime();
    return lastActivity > fiveMinAgo;
  }).length;

  const totalMessages = usersData.reduce((sum, u) => sum + (u.messages_sent || 0), 0);

  document.getElementById('totalUsers').textContent = usersData.length;
  document.getElementById('onlineUsers').textContent = onlineCount;
  document.getElementById('blockedUsers').textContent = blockedData.length;
  document.getElementById('totalMessages').textContent = totalMessages;
}

// === RENDER ===
function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  const blockedIPs = new Set(blockedData.map(b => b.ip));
  const searchQuery = document.getElementById('searchInput').value.toLowerCase();

  let filtered = usersData;
  if (searchQuery) {
    filtered = usersData.filter(u => 
      u.ip?.toLowerCase().includes(searchQuery) ||
      u.country?.toLowerCase().includes(searchQuery) ||
      u.city?.toLowerCase().includes(searchQuery) ||
      u.note?.toLowerCase().includes(searchQuery)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          <div class="icon">👥</div>
          <div>No users found</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(user => {
    const isBlocked = blockedIPs.has(user.ip);
    const isOnline = isUserOnline(user);
    const initials = getInitials(user.ip);

    return `
      <tr class="clickable" onclick="openUserProfile('${user.ip}')">
        <td>
          <div class="user-cell">
            <div class="user-avatar">${initials}</div>
            <div class="user-info">
              <div class="ip">${user.ip}</div>
              <div class="note">${user.note || 'No note'}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="location-cell">
            <span class="country">${user.country || 'Unknown'}</span>
            <span class="city">${user.city || ''}</span>
          </div>
        </td>
        <td>
          <div class="system-cell">
            <div class="os">${user.os || 'Unknown'}</div>
            <div class="browser">${user.browser || ''} ${user.browser_version || ''}</div>
          </div>
        </td>
        <td>
          <div class="stats-cell">
            <div class="main-stat">${user.messages_sent || 0} msgs</div>
            <div class="sub-stat">${user.sessions_count || 1} sessions</div>
          </div>
        </td>
        <td>
          ${isBlocked 
            ? '<span class="badge blocked">Blocked</span>'
            : `<span class="online-indicator ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>`
          }
        </td>
        <td class="time-ago">${formatDate(user.last_seen)}</td>
        <td>
          <button class="action-btn edit" onclick="event.stopPropagation(); editNote('${user.ip}', '${escapeHtml(user.note || '')}')">✏️ Note</button>
          ${isBlocked 
            ? ''
            : `<button class="action-btn block" onclick="event.stopPropagation(); blockUser('${user.ip}')">Block</button>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

function renderBlockedTable() {
  const tbody = document.getElementById('blockedTableBody');

  if (blockedData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          <div class="icon">✅</div>
          <div>No blocked users</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = blockedData.map(blocked => `
    <tr>
      <td class="user-info"><span class="ip" style="color: #a78bfa; font-family: monospace;">${blocked.ip}</span></td>
      <td>${blocked.reason || '-'}</td>
      <td class="time-ago">${formatDate(blocked.blocked_at)}</td>
      <td>
        <button class="action-btn unblock" onclick="unblockUser('${blocked.ip}')">Unblock</button>
      </td>
    </tr>
  `).join('');
}

// === ACTIONS ===
async function blockUser(ip) {
  openModal('Block User', `
    <div class="modal-field">
      <label>IP Address</label>
      <input type="text" value="${ip}" disabled>
    </div>
    <div class="modal-field">
      <label>Reason (will be shown to user)</label>
      <textarea id="blockReason" placeholder="e.g., Violation of terms"></textarea>
    </div>
  `, async () => {
    const reason = document.getElementById('blockReason').value;
    
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/blocked_ips`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          ip: ip,
          reason: reason || null,
          blocked_at: new Date().toISOString()
        })
      });

      if (response.ok) {
        showToast(`User ${ip} blocked`, 'success');
        closeModal();
        loadData();
      } else {
        throw new Error('Failed to block');
      }
    } catch (error) {
      showToast('Failed to block user', 'error');
    }
  });
}

async function unblockUser(ip) {
  if (!confirm(`Unblock ${ip}?`)) return;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/blocked_ips?ip=eq.${encodeURIComponent(ip)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (response.ok) {
      showToast(`User ${ip} unblocked`, 'success');
      loadData();
    } else {
      throw new Error('Failed to unblock');
    }
  } catch (error) {
    showToast('Failed to unblock user', 'error');
  }
}

function editNote(ip, currentNote) {
  openModal('Edit Note', `
    <div class="modal-field">
      <label>IP Address</label>
      <input type="text" value="${ip}" disabled>
    </div>
    <div class="modal-field">
      <label>Note (only visible to you)</label>
      <textarea id="userNote" placeholder="e.g., Friend, Test user, etc.">${currentNote}</textarea>
    </div>
  `, async () => {
    const note = document.getElementById('userNote').value;
    
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/users?ip=eq.${encodeURIComponent(ip)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ note: note || null })
        }
      );

      if (response.ok) {
        showToast('Note saved', 'success');
        closeModal();
        loadData();
      } else {
        throw new Error('Failed to save note');
      }
    } catch (error) {
      showToast('Failed to save note', 'error');
    }
  });
}

// === TABS ===
function showTab(tab) {
  currentTab = tab;
  
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  event.currentTarget.classList.add('active');
  
  document.getElementById('usersTable').style.display = tab === 'users' ? 'block' : 'none';
  document.getElementById('blockedTable').style.display = tab === 'blocked' ? 'block' : 'none';
  document.getElementById('pageTitle').textContent = tab === 'users' ? 'Users' : 'Blocked Users';
}

// === MODAL ===
let modalCallback = null;

function openModal(title, content, onConfirm) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalContent').innerHTML = content;
  document.getElementById('modalOverlay').classList.add('active');
  modalCallback = onConfirm;
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  modalCallback = null;
}

document.getElementById('modalConfirm').addEventListener('click', () => {
  if (modalCallback) modalCallback();
});

document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});

// === TOAST ===
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : '❌'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// === UTILS ===
function isUserOnline(user) {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const lastActivity = new Date(user.last_activity || user.last_seen).getTime();
  return lastActivity > fiveMinAgo;
}

function getInitials(ip) {
  const parts = ip.split('.');
  return parts.length >= 2 ? parts[0].slice(-1) + parts[1].slice(-1) : '??';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/'/g, "\\'");
}

function formatDate(dateString) {
  if (!dateString) return '-';
  
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

// === SEARCH ===
document.getElementById('searchInput').addEventListener('input', () => {
  renderUsersTable();
});

// === KEYBOARD ===
document.getElementById('passwordInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') login();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// === USER PROFILE ===
async function openUserProfile(ip) {
  currentProfileIP = ip;
  
  // Hide tables, show profile
  document.getElementById('usersTable').style.display = 'none';
  document.getElementById('blockedTable').style.display = 'none';
  document.getElementById('userProfileSection').style.display = 'block';
  document.getElementById('pageTitle').textContent = 'User Profile';
  
  // Reset tabs
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.profile-tab').classList.add('active');
  document.querySelectorAll('.profile-tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tabInfo').classList.add('active');
  
  await loadUserProfile(ip);
  
  // Start profile auto-refresh (every 10 seconds)
  if (profileRefreshInterval) clearInterval(profileRefreshInterval);
  profileRefreshInterval = setInterval(() => loadUserProfile(ip), 10000);
}

async function loadUserProfile(ip) {
  // Get user data from cache or loaded data
  const user = usersData.find(u => u.ip === ip);
  if (!user) {
    showToast('User not found', 'error');
    closeUserProfile();
    return;
  }
  
  // Update profile header
  document.getElementById('profileAvatar').textContent = getInitials(ip);
  document.getElementById('profileIP').textContent = ip;
  document.getElementById('profileNote').textContent = user.note || 'No note';
  
  const isOnline = isUserOnline(user);
  document.getElementById('profileStatus').innerHTML = `
    <span class="online-indicator ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>
  `;
  
  // Update stats
  document.getElementById('profileMessages').textContent = user.messages_sent || 0;
  document.getElementById('profileParses').textContent = user.parses_done || 0;
  document.getElementById('profileSessions').textContent = user.sessions_count || 0;
  document.getElementById('profileAIRequests').textContent = user.ai_requests || 0;
  
  // Update info tab
  document.getElementById('infoOS').textContent = user.os || '-';
  document.getElementById('infoBrowser').textContent = `${user.browser || '-'} ${user.browser_version || ''}`;
  document.getElementById('infoLanguage').textContent = user.language || '-';
  document.getElementById('infoScreen').textContent = user.screen_resolution || '-';
  document.getElementById('infoTimezone').textContent = user.timezone || '-';
  document.getElementById('infoCountry').textContent = user.country || '-';
  document.getElementById('infoCity').textContent = user.city || '-';
  document.getElementById('infoFirstSeen').textContent = formatDate(user.first_seen);
  document.getElementById('infoLastActivity').textContent = formatDate(user.last_activity || user.last_seen);
  document.getElementById('infoVersion').textContent = user.extension_version || '-';
  
  // Load user_data (invites, followers, etc.)
  await loadUserDataForProfile(ip);
}

async function loadUserDataForProfile(ip) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/user_data?ip=eq.${encodeURIComponent(ip)}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    
    const data = await response.json();
    const userData = data[0] || null;
    userDataCache[ip] = userData;
    
    // Update invites tab
    renderInvitesTab(userData);
    
    // Update database tab
    renderDatabaseTab(userData);
    
    // Update history tab
    renderHistoryTab(userData);
    
    // Update settings tab
    renderSettingsTab(userData);
    
    // Update tracker tab
    renderTrackerTab(userData);
    
  } catch (error) {
    console.error('Failed to load user data:', error);
  }
}

function renderInvitesTab(userData) {
  const container = document.getElementById('invitesGrid');
  
  if (!userData) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📨</div>
        <div>No data synced yet</div>
      </div>
    `;
    return;
  }
  
  let invites = [];
  let personalInvites = [];
  
  try { invites = JSON.parse(userData.invites || '[]'); } catch (e) {}
  try { personalInvites = JSON.parse(userData.personal_invites || '[]'); } catch (e) {}
  
  if (invites.length === 0 && personalInvites.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📨</div>
        <div>No invites created</div>
      </div>
    `;
    return;
  }
  
  let html = '';
  
  // Auto invites
  invites.forEach((inv, idx) => {
    html += `
      <div class="invite-card">
        <span class="invite-type auto">Auto Invite</span>
        <h5>${inv.title || `Invite #${idx + 1}`}</h5>
        <p>${escapeHtml(inv.text || inv.message || JSON.stringify(inv))}</p>
      </div>
    `;
  });
  
  // Personal invites
  personalInvites.forEach((inv, idx) => {
    html += `
      <div class="invite-card">
        <span class="invite-type personal">Personal Invite</span>
        <h5>${inv.title || `Personal #${idx + 1}`}</h5>
        <p>${escapeHtml(inv.text || inv.message || JSON.stringify(inv))}</p>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function renderDatabaseTab(userData) {
  const tbody = document.getElementById('databaseTableBody');
  const countEl = document.getElementById('databaseCount');
  
  if (!userData) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          <div class="icon">👥</div>
          <div>No data synced yet</div>
        </td>
      </tr>
    `;
    countEl.textContent = '0 followers';
    return;
  }
  
  let followers = [];
  try { followers = JSON.parse(userData.followers || '[]'); } catch (e) {}
  
  if (followers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          <div class="icon">👥</div>
          <div>No followers in database</div>
        </td>
      </tr>
    `;
    countEl.textContent = '0 followers';
    return;
  }
  
  countEl.textContent = `${followers.length} followers`;
  
  const searchQuery = document.getElementById('databaseSearch').value.toLowerCase();
  let filtered = followers;
  if (searchQuery) {
    filtered = followers.filter(f => 
      f.nickname?.toLowerCase().includes(searchQuery) ||
      f.id?.toString().includes(searchQuery)
    );
  }
  
  tbody.innerHTML = filtered.map((f, idx) => `
    <tr>
      <td>${f.number || idx + 1}</td>
      <td style="color: #a78bfa; font-weight: 500;">${f.nickname || f.id || '-'}</td>
      <td><span class="badge" style="background: ${getStatusColor(f.status)}; color: #fff;">${f.status || 'unknown'}</span></td>
      <td>${f.invited ? '✅' : '❌'}</td>
    </tr>
  `).join('');
}

function getStatusColor(status) {
  const colors = {
    'pending': 'rgba(251, 191, 36, 0.3)',
    'sent': 'rgba(59, 130, 246, 0.3)',
    'invited': 'rgba(16, 185, 129, 0.3)',
    'skipped': 'rgba(113, 113, 122, 0.3)',
    'error': 'rgba(239, 68, 68, 0.3)'
  };
  return colors[status] || 'rgba(113, 113, 122, 0.3)';
}

function renderHistoryTab(userData) {
  const container = document.getElementById('historyList');
  
  if (!userData) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📜</div>
        <div>No data synced yet</div>
      </div>
    `;
    return;
  }
  
  let history = [];
  try { history = JSON.parse(userData.send_history || '[]'); } catch (e) {}
  
  if (history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📜</div>
        <div>No send history</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = history.map(item => `
    <div class="history-item">
      <div class="target">${item.target || item.nickname || item.to || 'Unknown'}</div>
      <div class="time">${formatDate(item.timestamp || item.sentAt || item.date)}</div>
    </div>
  `).join('');
}

function renderSettingsTab(userData) {
  if (!userData) {
    document.getElementById('settingsGroqKey').textContent = 'Not synced';
    document.getElementById('settingsTheme').textContent = '-';
    document.getElementById('settingsLanguage').textContent = '-';
    return;
  }
  
  // API Key (full)
  const apiKey = userData.groq_api_key;
  if (apiKey) {
    document.getElementById('settingsGroqKey').textContent = apiKey;
  } else {
    document.getElementById('settingsGroqKey').textContent = 'Not set';
  }
  
  // Settings
  let settings = {};
  try { settings = JSON.parse(userData.settings || '{}'); } catch (e) {}
  
  document.getElementById('settingsTheme').textContent = settings.theme || 'dark';
  document.getElementById('settingsLanguage').textContent = settings.language || 'en';
}

// Store tracker data globally for sorting/filtering
let trackerUsersData = [];
let trackerNotes = {};
let trackerNickToId = {};
let trackerTransactions = [];

function renderTrackerTab(userData) {
  // Parse tracker data
  let purchases = {};
  let transactions = [];
  let notes = {};
  let ranks = {};
  let nickToId = {};
  
  if (userData) {
    try { purchases = JSON.parse(userData.purchases || '{}'); } catch (e) {}
    try { transactions = JSON.parse(userData.transactions || '[]'); } catch (e) {}
    try { notes = JSON.parse(userData.tracker_notes || '{}'); } catch (e) {}
    try { ranks = JSON.parse(userData.mv_ranks || '{}'); } catch (e) {}
    try { nickToId = JSON.parse(userData.mv_nick_to_id || '{}'); } catch (e) {}
  }
  
  // Store globally for other functions
  trackerNotes = notes;
  trackerNickToId = nickToId;
  trackerTransactions = transactions;
  
  // Aggregate data by user
  const userMap = new Map();
  
  // Process transactions
  if (Array.isArray(transactions)) {
    transactions.forEach(tx => {
      const nick = tx.nick || tx.username || 'Unknown';
      const key = nick.toLowerCase();
      
      if (!userMap.has(key)) {
        userMap.set(key, {
          nick: nick,
          totalSpent: 0,
          transactionCount: 0,
          lastTransaction: null,
          lastAmount: 0,
          rank: null,
          note: null,
          userId: tx.userId || null
        });
      }
      
      const user = userMap.get(key);
      user.totalSpent += (tx.amount || 0);
      user.transactionCount += 1;
      
      const txDate = tx.transactionDate || tx.date;
      if (txDate && (!user.lastTransaction || txDate > user.lastTransaction)) {
        user.lastTransaction = txDate;
        user.lastAmount = tx.amount || 0;
      }
      
      if (tx.userId) user.userId = tx.userId;
    });
  }
  
  // Add ranks
  Object.entries(ranks).forEach(([userId, data]) => {
    const nick = data.nick || userId;
    const key = nick.toLowerCase();
    
    if (userMap.has(key)) {
      userMap.get(key).rank = data.rank;
      userMap.get(key).userId = userId;
    } else {
      userMap.set(key, {
        nick: nick,
        totalSpent: 0,
        transactionCount: 0,
        lastTransaction: null,
        lastAmount: 0,
        rank: data.rank,
        note: null,
        userId: userId
      });
    }
  });
  
  // Add notes
  Object.entries(notes).forEach(([noteKey, noteText]) => {
    // Extract nick from key (mv_note_NICK or note_NICK)
    const nick = noteKey.replace(/^(mv_)?note_/, '').replace(/_/g, ' ');
    const key = nick.toLowerCase();
    
    if (userMap.has(key)) {
      userMap.get(key).note = noteText;
    } else {
      userMap.set(key, {
        nick: nick,
        totalSpent: 0,
        transactionCount: 0,
        lastTransaction: null,
        lastAmount: 0,
        rank: null,
        note: noteText,
        userId: null
      });
    }
  });
  
  // Convert to array
  trackerUsersData = Array.from(userMap.values());
  
  // Calculate stats
  const totalSpent = trackerUsersData.reduce((sum, u) => sum + u.totalSpent, 0);
  const totalTransactions = trackerUsersData.reduce((sum, u) => sum + u.transactionCount, 0);
  const notesCount = trackerUsersData.filter(u => u.note).length;
  
  // Update stats
  document.getElementById('trackerTotalSpent').textContent = `$${totalSpent.toFixed(2)}`;
  document.getElementById('trackerTransactions').textContent = totalTransactions;
  document.getElementById('trackerUniqueUsers').textContent = trackerUsersData.filter(u => u.totalSpent > 0).length;
  document.getElementById('trackerNotes').textContent = notesCount;
  
  // Render table
  renderTrackerTable();
  
  // Render notes section
  renderTrackerNotes(trackerNotes, trackerNickToId);
  
  // Render last transactions section
  renderTrackerLastTransactions(trackerTransactions, trackerNickToId);
  
  // Render last sent messages section
  renderTrackerLastSent(userData);
}

function renderTrackerTable() {
  const tbody = document.getElementById('trackerTableBody');
  const searchQuery = document.getElementById('trackerSearch')?.value?.toLowerCase() || '';
  const sortBy = document.getElementById('trackerSort')?.value || 'spent';
  
  // Filter
  let filtered = trackerUsersData;
  if (searchQuery) {
    filtered = trackerUsersData.filter(u => 
      u.nick?.toLowerCase().includes(searchQuery) ||
      u.note?.toLowerCase().includes(searchQuery)
    );
  }
  
  // Sort
  switch (sortBy) {
    case 'spent':
      filtered.sort((a, b) => b.totalSpent - a.totalSpent);
      break;
    case 'transactions':
      filtered.sort((a, b) => b.transactionCount - a.transactionCount);
      break;
    case 'rank':
      filtered.sort((a, b) => (a.rank || 99999) - (b.rank || 99999));
      break;
    case 'recent':
      filtered.sort((a, b) => (b.lastTransaction || 0) - (a.lastTransaction || 0));
      break;
  }
  
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <div class="icon">📊</div>
          <div>No tracker data synced yet</div>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = filtered.map(user => {
    const initials = user.nick ? user.nick.slice(0, 2).toUpperCase() : '??';
    const amountClass = user.totalSpent >= 500 ? 'whale' : (user.totalSpent >= 100 ? 'high' : '');
    const rankClass = user.rank && user.rank <= 10 ? 'top10' : (user.rank && user.rank <= 100 ? 'top100' : '');
    
    // ManyVids chat URL
    const chatUrl = user.userId 
      ? `https://www.manyvids.com/messages/${user.userId}`
      : `https://www.manyvids.com/Profile/${encodeURIComponent(user.nick)}/`;
    
    return `
      <tr>
        <td>
          <div class="tracker-user">
            <div class="tracker-user-avatar">${initials}</div>
            <a href="${chatUrl}" target="_blank" class="tracker-user-link">${escapeHtml(user.nick)}</a>
          </div>
        </td>
        <td>
          <span class="tracker-amount ${amountClass}">$${user.totalSpent.toFixed(2)}</span>
        </td>
        <td>${user.transactionCount}</td>
        <td>
          ${user.rank 
            ? `<span class="tracker-rank ${rankClass}">#${user.rank}</span>` 
            : '<span style="color: #71717a;">-</span>'
          }
        </td>
        <td class="tracker-date">
          ${user.lastTransaction 
            ? `${formatDate(user.lastTransaction)} ($${user.lastAmount.toFixed(2)})`
            : '-'
          }
        </td>
        <td>
          <span class="tracker-note" title="${escapeHtml(user.note || '')}">${escapeHtml(user.note || '-')}</span>
        </td>
      </tr>
    `;
  }).join('');
}

function renderTrackerNotes(notes, nickToId) {
  const container = document.getElementById('trackerNotesSection');
  if (!container) return;
  
  const notesArray = Object.entries(notes);
  
  if (notesArray.length === 0) {
    container.innerHTML = '<div class="empty-state small">No notes synced</div>';
    return;
  }
  
  // Sort by key (newest first if we had timestamps, but for now alphabetically)
  notesArray.sort((a, b) => a[0].localeCompare(b[0]));
  
  container.innerHTML = notesArray.map(([key, noteText]) => {
    // Extract user info from key
    const nick = key.replace(/^(mv_)?note_/, '').replace(/_/g, ' ');
    const userId = nickToId[nick] || nickToId[nick.toLowerCase()] || null;
    const chatUrl = userId 
      ? `https://www.manyvids.com/messages/${userId}`
      : `https://www.manyvids.com/Profile/${encodeURIComponent(nick)}/`;
    
    return `
      <div class="tracker-note-item">
        <div class="tracker-note-header">
          <span class="tracker-note-user">
            <a href="${chatUrl}" target="_blank">👤 ${escapeHtml(nick)}</a>
          </span>
        </div>
        <div class="tracker-note-text">${escapeHtml(noteText)}</div>
      </div>
    `;
  }).join('');
}

function renderTrackerLastTransactions(transactions, nickToId) {
  const container = document.getElementById('trackerLastTransactionsSection');
  if (!container) return;
  
  if (!Array.isArray(transactions) || transactions.length === 0) {
    container.innerHTML = '<div class="empty-state small">No transactions synced</div>';
    return;
  }
  
  // Sort by date (newest first)
  const sorted = [...transactions].sort((a, b) => {
    const dateA = a.timestamp || a.date || 0;
    const dateB = b.timestamp || b.date || 0;
    return dateB - dateA;
  }).slice(0, 20);
  
  container.innerHTML = sorted.map(tx => {
    const nick = tx.nick || tx.username || 'Unknown';
    const amount = tx.amount || 0;
    const userId = tx.userId || nickToId[nick] || nickToId[nick.toLowerCase()] || null;
    const chatUrl = userId 
      ? `https://www.manyvids.com/messages/${userId}`
      : `https://www.manyvids.com/Profile/${encodeURIComponent(nick)}/`;
    const dateStr = tx.timestamp || tx.date ? formatDate(tx.timestamp || tx.date) : 'Unknown';
    const type = tx.type || tx.item || 'Purchase';
    
    let amountClass = '';
    if (amount >= 500) amountClass = 'whale';
    else if (amount >= 100) amountClass = 'high';
    
    return `
      <div class="tracker-tx-item">
        <div class="tracker-tx-avatar">💰</div>
        <div class="tracker-tx-info">
          <div class="tracker-tx-user">
            <a href="${chatUrl}" target="_blank">${escapeHtml(nick)}</a>
          </div>
          <div class="tracker-tx-details">${escapeHtml(type)} • ${dateStr}</div>
        </div>
        <div class="tracker-tx-amount ${amountClass}">$${amount.toFixed(2)}</div>
      </div>
    `;
  }).join('');
}

function renderTrackerLastSent(userData) {
  const container = document.getElementById('trackerLastSentSection');
  if (!container) return;
  
  let sendHistory = [];
  let invites = [];
  let personalInvites = [];
  let followers = [];
  
  if (userData) {
    try { sendHistory = JSON.parse(userData.send_history || '[]'); } catch (e) {}
    try { invites = JSON.parse(userData.invites || '[]'); } catch (e) {}
    try { personalInvites = JSON.parse(userData.personal_invites || '[]'); } catch (e) {}
    try { followers = JSON.parse(userData.followers || '[]'); } catch (e) {}
  }
  
  // Collect all sent messages with content
  const allMessages = [];
  
  // From send history
  if (Array.isArray(sendHistory)) {
    sendHistory.forEach(h => {
      if (h.message || h.text || h.content) {
        allMessages.push({
          nick: h.target || h.nickname || h.to || 'Unknown',
          id: h.userId || h.id,
          timestamp: h.timestamp || h.sentAt || h.date,
          message: h.message || h.text || h.content
        });
      }
    });
  }
  
  // From invites (templates that were used)
  if (Array.isArray(invites)) {
    invites.forEach(inv => {
      if (inv.lastUsed && inv.text) {
        allMessages.push({
          nick: inv.lastSentTo || 'Multiple users',
          id: null,
          timestamp: inv.lastUsed,
          message: inv.text,
          isInvite: true,
          inviteName: inv.name || 'Invite'
        });
      }
    });
  }
  
  // From followers with invite info
  if (Array.isArray(followers)) {
    followers.forEach(f => {
      if ((f.invited || f.status === 'sent') && f.sentMessage) {
        allMessages.push({
          nick: f.nickname || f.nick || f.username || 'Unknown',
          id: f.id || f.mvid,
          timestamp: f.inviteTimestamp || f.sentAt,
          message: f.sentMessage
        });
      }
    });
  }
  
  // Sort by timestamp (newest first) and limit
  const sorted = allMessages
    .filter(m => m.message)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 15);
  
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty-state small">No sent messages with content found</div>';
    return;
  }
  
  container.innerHTML = sorted.map(item => {
    const initials = item.nick ? item.nick.slice(0, 2).toUpperCase() : '📤';
    const chatUrl = item.id 
      ? `https://www.manyvids.com/messages/${item.id}`
      : `https://www.manyvids.com/Profile/${encodeURIComponent(item.nick)}/`;
    const dateStr = item.timestamp ? formatDate(item.timestamp) : 'Unknown time';
    const label = item.isInvite ? `(Template: ${item.inviteName})` : '';
    
    return `
      <div class="tracker-sent-message">
        <div class="tracker-sent-header">
          <div class="tracker-sent-to">
            <div class="tracker-sent-to-avatar">${initials}</div>
            <div class="tracker-sent-to-name">
              <a href="${chatUrl}" target="_blank">${escapeHtml(item.nick)}</a>
              ${label ? `<span style="color:#71717a;font-size:11px;margin-left:6px">${label}</span>` : ''}
            </div>
          </div>
          <span class="tracker-sent-date">${dateStr}</span>
        </div>
        <div class="tracker-sent-content">${escapeHtml(item.message)}</div>
      </div>
    `;
  }).join('');
}

// Tracker search and sort handlers (initialized on page load)
function initTrackerHandlers() {
  const searchEl = document.getElementById('trackerSearch');
  const sortEl = document.getElementById('trackerSort');
  if (searchEl) searchEl.addEventListener('input', renderTrackerTable);
  if (sortEl) sortEl.addEventListener('change', renderTrackerTable);
}

function showProfileTab(tabName) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-tab-content').forEach(t => t.classList.remove('active'));
  
  event.currentTarget.classList.add('active');
  document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).classList.add('active');
}

function closeUserProfile() {
  currentProfileIP = null;
  
  if (profileRefreshInterval) {
    clearInterval(profileRefreshInterval);
    profileRefreshInterval = null;
  }
  
  document.getElementById('userProfileSection').style.display = 'none';
  document.getElementById('usersTable').style.display = currentTab === 'users' ? 'block' : 'none';
  document.getElementById('blockedTable').style.display = currentTab === 'blocked' ? 'block' : 'none';
  document.getElementById('pageTitle').textContent = currentTab === 'users' ? 'Users' : 'Blocked Users';
}

function refreshUserProfile() {
  if (currentProfileIP) {
    loadUserProfile(currentProfileIP);
    showToast('Profile refreshed', 'success');
  }
}

function exportUserData() {
  const user = usersData.find(u => u.ip === currentProfileIP);
  const userData = userDataCache[currentProfileIP];
  
  const exportData = {
    user: user,
    userData: userData,
    exportedAt: new Date().toISOString()
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `user_${currentProfileIP.replace(/\./g, '_')}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Data exported', 'success');
}

// Database search
document.getElementById('databaseSearch').addEventListener('input', () => {
  if (currentProfileIP && userDataCache[currentProfileIP]) {
    renderDatabaseTab(userDataCache[currentProfileIP]);
  }
});

// === INIT ===
checkAuth();
initTrackerHandlers();
