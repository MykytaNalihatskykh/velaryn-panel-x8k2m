// ===== VELARYN ADMIN PANEL =====
const SUPABASE_URL = 'https://kklwsrrlynmpsyispbyn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrbHdzcnJseW5tcHN5aXNwYnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDU5NDEsImV4cCI6MjA4NTkyMTk0MX0.rA62ShgmXMvGyDl5cxEd4s-rIBEV1Spn0HX8YF_Qjrc';
const ADMIN_PASSWORD = 'velaryn2024';

let currentTab = 'users';
let usersData = [];
let blockedData = [];
let autoRefreshInterval = null;

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
  autoRefreshInterval = setInterval(loadData, 30000);
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
      <tr>
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
          <button class="action-btn edit" onclick="editNote('${user.ip}', '${escapeHtml(user.note || '')}')">✏️ Note</button>
          ${isBlocked 
            ? ''
            : `<button class="action-btn block" onclick="blockUser('${user.ip}')">Block</button>`
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

// === INIT ===
checkAuth();
