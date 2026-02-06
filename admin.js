// ===== VELARYN ADMIN PANEL =====
// Настройки Supabase
const SUPABASE_URL = 'https://kklwsrrlynmpsyispbyn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrbHdzcnJseW5tcHN5aXNwYnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDU5NDEsImV4cCI6MjA4NTkyMTk0MX0.rA62ShgmXMvGyDl5cxEd4s-rIBEV1Spn0HX8YF_Qjrc';

// Пароль для доступа к админке (можете изменить)
const ADMIN_PASSWORD = 'velaryn2024';

let currentTab = 'users';
let usersData = [];
let blockedData = [];

// === АВТОРИЗАЦИЯ ===
function login() {
  const password = document.getElementById('passwordInput').value;
  if (password === ADMIN_PASSWORD) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.add('active');
    localStorage.setItem('velaryn_admin_auth', 'true');
    loadData();
  } else {
    alert('Неверный пароль');
  }
}

function logout() {
  localStorage.removeItem('velaryn_admin_auth');
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('dashboard').classList.remove('active');
}

// Проверка авторизации при загрузке
function checkAuth() {
  if (localStorage.getItem('velaryn_admin_auth') === 'true') {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.add('active');
    loadData();
  }
}

// Enter для входа
document.getElementById('passwordInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') login();
});

// === ЗАГРУЗКА ДАННЫХ ===
async function loadData() {
  document.querySelector('.refresh-btn').classList.add('loading');
  
  try {
    // Загрузка пользователей
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

    // Загрузка заблокированных
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
    alert('Ошибка загрузки данных');
  }
  
  document.querySelector('.refresh-btn').classList.remove('loading');
}

// === СТАТИСТИКА ===
function updateStats() {
  const blockedIPs = new Set(blockedData.map(b => b.ip));
  const activeCount = usersData.filter(u => !blockedIPs.has(u.ip)).length;
  
  document.getElementById('totalUsers').textContent = usersData.length;
  document.getElementById('activeUsers').textContent = activeCount;
  document.getElementById('blockedUsers').textContent = blockedData.length;
}

// === РЕНДЕР ТАБЛИЦ ===
function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  const blockedIPs = new Set(blockedData.map(b => b.ip));
  
  if (usersData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Нет пользователей</td></tr>';
    return;
  }

  tbody.innerHTML = usersData.map(user => {
    const isBlocked = blockedIPs.has(user.ip);
    return `
      <tr>
        <td class="ip-cell">${user.ip}</td>
        <td class="country-cell">
          ${user.country || 'Unknown'}${user.city ? `, ${user.city}` : ''}
        </td>
        <td>${user.extension_version || '-'}</td>
        <td>${user.sessions_count || 1}</td>
        <td class="time-ago">${formatDate(user.first_seen)}</td>
        <td class="time-ago">${formatDate(user.last_seen)}</td>
        <td>
          ${isBlocked 
            ? `<span class="badge blocked">Заблокирован</span>`
            : `<button class="action-btn block" onclick="blockUser('${user.ip}')">Заблокировать</button>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

function renderBlockedTable() {
  const tbody = document.getElementById('blockedTableBody');
  
  if (blockedData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Нет заблокированных</td></tr>';
    return;
  }

  tbody.innerHTML = blockedData.map(blocked => `
    <tr>
      <td class="ip-cell">${blocked.ip}</td>
      <td>${blocked.reason || '-'}</td>
      <td class="time-ago">${formatDate(blocked.blocked_at)}</td>
      <td>
        <button class="action-btn unblock" onclick="unblockUser('${blocked.ip}')">Разблокировать</button>
      </td>
    </tr>
  `).join('');
}

// === ДЕЙСТВИЯ ===
async function blockUser(ip) {
  const reason = prompt('Причина блокировки (необязательно):');
  
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/blocked_ips`,
      {
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
      }
    );

    if (response.ok) {
      alert(`IP ${ip} заблокирован`);
      loadData();
    } else {
      throw new Error('Failed to block');
    }
  } catch (error) {
    console.error('Block error:', error);
    alert('Ошибка блокировки');
  }
}

async function unblockUser(ip) {
  if (!confirm(`Разблокировать ${ip}?`)) return;
  
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
      alert(`IP ${ip} разблокирован`);
      loadData();
    } else {
      throw new Error('Failed to unblock');
    }
  } catch (error) {
    console.error('Unblock error:', error);
    alert('Ошибка разблокировки');
  }
}

// === ВКЛАДКИ ===
function showTab(tab) {
  currentTab = tab;
  
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab:nth-child(${tab === 'users' ? 1 : 2})`).classList.add('active');
  
  document.getElementById('usersTable').style.display = tab === 'users' ? 'block' : 'none';
  document.getElementById('blockedTable').style.display = tab === 'blocked' ? 'block' : 'none';
}

// === УТИЛИТЫ ===
function formatDate(dateString) {
  if (!dateString) return '-';
  
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  
  // Меньше минуты
  if (diff < 60000) return 'Только что';
  
  // Меньше часа
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins} мин. назад`;
  }
  
  // Меньше дня
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} ч. назад`;
  }
  
  // Меньше недели
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} дн. назад`;
  }
  
  // Иначе показываем дату
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

// Инициализация
checkAuth();
