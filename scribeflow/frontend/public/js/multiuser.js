// ── MULTI-USER STATE ──────────────────────────────────────────────────────
let currentUser  = null;   // { id, username, displayName, role, status }
let multiUserEnabled = false;

// ── ADMIN PANEL ───────────────────────────────────────────────────────────
let adminPanelOpen = false;

function openAdminPanel(tab) {
  loadAdminStatus();
  switchAdminTab(tab || 'multiuser');
  const ov = document.getElementById('admin-overlay');
  ov.style.display = 'flex';
  requestAnimationFrame(() => ov.classList.add('open'));
  adminPanelOpen = true;
}

function closeAdminPanel() {
  const ov = document.getElementById('admin-overlay');
  ov.classList.remove('open');
  setTimeout(() => { if (!adminPanelOpen) ov.style.display = 'none'; }, 220);
  adminPanelOpen = false;
}

function switchAdminTab(name) {
  document.querySelectorAll('.an-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  const tab = document.querySelector(`.an-item[data-asection="${name}"]`);
  const sec = document.getElementById(`asection-${name}`);
  if (tab) tab.classList.add('active');
  if (sec) sec.classList.add('active');
  if (name === 'users') loadUserManagement();
}

async function loadAdminStatus() {
  try {
    const res  = await fetch('/api/admin/status');
    const data = await res.json();
    // Show Users tab only for admins
    const usersTab = document.getElementById('an-users');
    if (usersTab) usersTab.style.display = data.isAdmin ? '' : 'none';
  } catch (err) { console.error('Admin status failed:', err); }
}

// ── USER MANAGEMENT ───────────────────────────────────────────────────────
async function loadUserManagement() {
  try {
    const res   = await fetch('/api/admin/users');
    const users = await res.json();
    renderUserLists(users);
  } catch (err) { console.error('User management failed:', err); }
}

function renderUserLists(users) {
  renderUserGroup('users-active-list', users.filter(u => u.status === 'active'), [
    { label: 'Suspend', cls: 'btn-suspend', action: 'suspend', skipAdmin: true }
  ]);
  renderUserGroup('users-suspended-list', users.filter(u => u.status === 'suspended'), [
    { label: 'Reactivate', cls: 'btn-approve',  action: 'reactivate' },
    { label: 'Delete',     cls: 'btn-delete',    action: 'delete' }
  ]);
}

function renderUserGroup(elId, users, actions) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!users.length) { el.innerHTML = '<span class="no-users">None</span>'; return; }
  el.innerHTML = users.map(u => `
    <div class="user-row">
      <div class="user-row-avatar-placeholder">${_initials(u.displayName || u.username)}</div>
      <div class="user-row-info">
        <div class="user-row-name">${_esc(u.displayName || u.username)}</div>
        <div class="user-row-email">${_esc(u.username)}</div>
      </div>
      <span class="user-row-role ${u.role}">${u.role}</span>
      <div class="user-row-actions">
        ${actions.filter(a => !a.skipAdmin || u.role !== 'admin').map(a =>
          `<button class="um-btn ${a.cls}" onclick="_userAction('${a.action}','${u.id}')">${a.label}</button>`
        ).join('')}
      </div>
    </div>`).join('');
}

async function _userAction(action, userId) {
  const map = { suspend: 'POST', reactivate: 'POST', delete: 'DELETE' };
  if (action === 'delete' && !confirm('Permanently delete this user?')) return;
  const url    = `/api/admin/users/${userId}` + (action === 'delete' ? '' : `/${action}`);
  const method = map[action] || 'POST';
  const res    = await fetch(url, { method });
  if (res.ok) loadUserManagement();
  else { const e = await res.json(); alert(e.error || 'Action failed'); }
}

// ── CREATE USER ───────────────────────────────────────────────────────────
async function _createUser() {
  const username    = document.getElementById('cu-username').value.trim();
  const displayName = document.getElementById('cu-displayname').value.trim();
  const password    = document.getElementById('cu-password').value;
  const role        = document.getElementById('cu-role').value;
  const msgEl       = document.getElementById('cu-message');
  const btn         = document.getElementById('cu-create-btn');

  msgEl.style.display = 'none';
  if (!username || !password) {
    msgEl.textContent = 'Username and password are required.';
    msgEl.style.color = 'var(--red)';
    msgEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const res  = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password, role })
    });
    const data = await res.json();
    if (!res.ok) {
      msgEl.textContent = data.error || 'Failed to create user.';
      msgEl.style.color = 'var(--red)';
      msgEl.style.display = 'block';
    } else {
      msgEl.textContent = `User "${data.displayName || data.username}" created successfully.`;
      msgEl.style.color = 'var(--accent)';
      msgEl.style.display = 'block';
      document.getElementById('cu-username').value    = '';
      document.getElementById('cu-displayname').value = '';
      document.getElementById('cu-password').value    = '';
      document.getElementById('cu-role').value        = 'user';
      loadUserManagement();
    }
  } catch (err) {
    msgEl.textContent = 'Network error: ' + err.message;
    msgEl.style.color = 'var(--red)';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create';
  }
}

function _initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function _esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── PROJECT SHARING ───────────────────────────────────────────────────────
let _allUsers = [];

async function openShareModal() {
  if (!currentProject) return;
  const ov = document.getElementById('share-overlay');
  ov.style.display = 'flex';
  requestAnimationFrame(() => ov.classList.add('open'));
  await refreshShareModal();
}

async function refreshShareModal() {
  try {
    const [shareRes, usersRes] = await Promise.all([
      fetch(`/api/projects/${currentProject.id}/share`),
      fetch('/api/admin/users')
    ]);
    const shareData = await shareRes.json();
    _allUsers = usersRes.ok ? await usersRes.json() : [];
    renderShareModal(shareData);
  } catch (err) { console.error('Share modal error:', err); }
}

function renderShareModal(shareData) {
  document.getElementById('share-owner-name').textContent =
    shareData.ownerName || shareData.ownerId || 'You';
  const xBtn = document.getElementById('share-transfer-btn');
  xBtn.style.display = (!currentUser || shareData.ownerId === currentUser.id) ? '' : 'none';

  const listEl = document.getElementById('share-users-list');
  const sw     = shareData.sharedWith || [];
  if (!sw.length) {
    listEl.innerHTML = '<span class="no-users" style="padding:8px 0;display:block">Not shared with anyone yet</span>';
  } else {
    listEl.innerHTML = sw.map(e => `
      <div class="share-user-row">
        <div class="user-row-avatar-placeholder">${_initials(e.userName)}</div>
        <div class="user-row-info">
          <div class="user-row-name">${_esc(e.userName || e.userId)}</div>
          <div class="user-row-email">${_esc(e.userEmail || '')}</div>
        </div>
        <select class="share-role-sel" onchange="_shareUpdateRole('${e.userId}',this.value)">
          <option value="editor" ${e.role==='editor'?'selected':''}>Editor</option>
          <option value="viewer" ${e.role==='viewer'?'selected':''}>Viewer</option>
        </select>
        <button class="um-btn btn-delete" onclick="_shareRemove('${e.userId}')">Remove</button>
      </div>`).join('');
  }

  const sel       = document.getElementById('share-user-select');
  const sharedIds = new Set(sw.map(s => s.userId));
  const available = _allUsers.filter(u =>
    u.id !== shareData.ownerId && !sharedIds.has(u.id) && u.status === 'active');
  sel.innerHTML = '<option value="">— Select a user —</option>' +
    available.map(u => `<option value="${u.id}">${_esc(u.displayName || u.username)}</option>`).join('');
}

async function _shareAdd() {
  const userId = document.getElementById('share-user-select').value;
  const role   = document.getElementById('share-role-select').value;
  if (!userId) return;
  await fetch(`/api/projects/${currentProject.id}/share`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ userId, role })
  });
  await refreshShareModal();
  await loadProjectList();
}

async function _shareRemove(userId) {
  if (!confirm("Remove this user's access?")) return;
  await fetch(`/api/projects/${currentProject.id}/share/${userId}`, { method: 'DELETE' });
  await refreshShareModal();
  await loadProjectList();
}

async function _shareUpdateRole(userId, role) {
  await fetch(`/api/projects/${currentProject.id}/share`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ userId, role })
  });
}

async function _shareTransfer() {
  const active = _allUsers.filter(u => u.status === 'active' && u.id !== currentUser?.id);
  if (!active.length) { alert('No other active users to transfer to.'); return; }
  const names  = active.map(u => `${u.displayName || u.username} (${u.username})`).join('\n');
  const chosen = prompt(`Enter exact username of new owner:\n\n${names}`);
  if (!chosen) return;
  const target = active.find(u => u.username === chosen.trim());
  if (!target) { alert('User not found. Please enter an exact username.'); return; }
  if (!confirm(`Transfer ownership of "${currentProject.title}" to ${target.displayName || target.username}?`)) return;
  const res = await fetch(`/api/projects/${currentProject.id}/share/transfer`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ toUserId: target.id })
  });
  if (res.ok) { await refreshShareModal(); await loadProjectList(); alert('Ownership transferred.'); }
  else { const e = await res.json(); alert('Failed: ' + (e.error || 'Unknown error')); }
}

// ── SOCKET.IO REAL-TIME COLLABORATION ─────────────────────────────────────
let _socket       = null;
let _currentRoom  = null;
let _broadcastTimer = null;

function initSocket() {
  if (_socket) return;
  _socket = io({ transports: ['websocket', 'polling'] });
  _socket.on('connect',    () => {});
  _socket.on('disconnect', () => renderPresence({}));
  _socket.on('doc-updated', ({ projectId, docId, content, userId }) => {
    if (!currentProject || projectId !== currentProject.id) return;
    if (docId !== currentDocId) return;
    if (userId === currentUser?.id) return;
    if (document.activeElement?.id !== 'editor') {
      const ed = document.getElementById('editor');
      if (ed) { ed.innerHTML = content; updateStats(); }
    }
  });
  _socket.on('presence-update', ({ users }) => renderPresence(users));
}

function _joinDocRoom(projectId, docId) {
  if (!_socket) return;
  _leaveDocRoom();
  _currentRoom = `${projectId}:${docId}`;
  _socket.emit('join-doc', { projectId, docId });
}

function _leaveDocRoom() {
  if (!_socket || !_currentRoom) return;
  const [projectId, docId] = _currentRoom.split(':');
  _socket.emit('leave-doc', { projectId, docId });
  _currentRoom = null;
  renderPresence({});
}

function renderPresence(users) {
  const bar     = document.getElementById('collab-bar');
  const avatars = document.getElementById('collab-avatars');
  const text    = document.getElementById('collab-text');
  const others  = Object.values(users).filter(u => u.userId !== currentUser?.id);
  if (!others.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  avatars.innerHTML = others.slice(0, 5).map(u =>
    `<div class="presence-avatar-initial" title="${_esc(u.name)}">${_initials(u.name)}</div>`
  ).join('');
  text.textContent = others.length === 1
    ? `${others[0].name} is also editing`
    : `${others.length} others are here`;
}

// Hook selectDoc to join/leave rooms
const _origSelectDoc = selectDoc;
selectDoc = async function(docId) {
  if (_socket && currentProject) _leaveDocRoom();
  await _origSelectDoc(docId);
  if (_socket && currentProject && currentDocId) _joinDocRoom(currentProject.id, currentDocId);
};

// Hook showHome to leave room and hide share button
const _origShowHome = showHome;
showHome = async function() {
  if (_socket) _leaveDocRoom();
  await _origShowHome();
  document.getElementById('btn-share').style.display = 'none';
};

// Hook openProject to show Share button in multi-user mode
const _origOpenProject = openProject;
openProject = async function(id) {
  await _origOpenProject(id);
  if (multiUserEnabled) {
    const shareBtn = document.getElementById('btn-share');
    if (shareBtn) shareBtn.style.display = '';
  }
};

// Broadcast content changes on debounce
document.getElementById('editor').addEventListener('input', () => {
  if (!_socket || !currentProject || !currentDocId) return;
  clearTimeout(_broadcastTimer);
  _broadcastTimer = setTimeout(() => {
    _socket.emit('doc-change', {
      projectId: currentProject.id,
      docId: currentDocId,
      content: getEditorContent()
    });
  }, 400);
});

// ── LOGIN FORM ────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('auth-error-msg');
  const btn      = document.getElementById('login-btn');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const res  = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent   = data.error || 'Sign-in failed.';
      errEl.style.display = 'block';
      btn.disabled    = false;
      btn.textContent = 'Sign In';
      return;
    }
    window.location.reload();
  } catch (err) {
    errEl.textContent   = 'Network error: ' + err.message;
    errEl.style.display = 'block';
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
});

// ── AUTH INIT ─────────────────────────────────────────────────────────────
async function _initAuthMultiUser() {
  try {
    const res  = await fetch('/api/me');
    const data = await res.json();

    if (!data.authEnabled) {
      // Single-user mode — hide user-info and auth controls, go straight to app
      multiUserEnabled = false;
      document.getElementById('btn-admin-panel').style.display = 'none';
      document.getElementById('btn-share').style.display       = 'none';
      document.getElementById('user-info').style.display       = 'none';
      showHome();
      return;
    }

    multiUserEnabled = true;

    if (!data.user) {
      // Not logged in — show login screen
      document.getElementById('auth-overlay').style.display = 'flex';
      return;
    }

    if (data.user.status === 'suspended') {
      document.getElementById('auth-overlay').style.display = 'flex';
      const el = document.getElementById('auth-error-msg');
      el.textContent   = 'Your account has been suspended. Contact the administrator.';
      el.style.display = 'block';
      // Disable login form inputs
      document.getElementById('login-form').style.display = 'none';
      return;
    }

    // Active user — set up toolbar
    currentUser = data.user;

    const ui = document.getElementById('user-info');
    ui.style.display = 'flex';
    document.getElementById('user-name').textContent = data.user.displayName || data.user.username;

    // Admin button: only admins see it
    document.getElementById('btn-admin-panel').style.display =
      data.user.role === 'admin' ? '' : 'none';

    // Init real-time collaboration
    initSocket();

    showHome();

  } catch (err) {
    console.error('Auth check failed:', err);
    showHome();
  }
}

// ── WIRE UP BUTTONS ───────────────────────────────────────────────────────
document.getElementById('btn-admin-panel').addEventListener('click', () => openAdminPanel());
document.getElementById('admin-close').addEventListener('click', closeAdminPanel);
document.getElementById('admin-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('admin-overlay')) closeAdminPanel();
});

document.getElementById('admin-nav').addEventListener('click', e => {
  const item = e.target.closest('.an-item');
  if (item && item.dataset.asection) switchAdminTab(item.dataset.asection);
});

document.getElementById('cu-create-btn').addEventListener('click', _createUser);

document.getElementById('btn-share').addEventListener('click', openShareModal);
document.getElementById('share-close').addEventListener('click', () => {
  const ov = document.getElementById('share-overlay');
  ov.classList.remove('open');
  setTimeout(() => { ov.style.display = 'none'; }, 220);
});
document.getElementById('share-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('share-overlay')) {
    const ov = document.getElementById('share-overlay');
    ov.classList.remove('open');
    setTimeout(() => { ov.style.display = 'none'; }, 220);
  }
});
document.getElementById('share-add-btn').addEventListener('click', _shareAdd);
document.getElementById('share-transfer-btn').addEventListener('click', _shareTransfer);

document.getElementById('btn-logout').addEventListener('click', () => {
  location.href = '/auth/logout';
});

// ── RUN ───────────────────────────────────────────────────────────────────
_initAuthMultiUser();
