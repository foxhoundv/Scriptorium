// ── MULTI-USER STATE ──────────────────────────────────────────────────────
let currentUser  = null;   // { id, name, email, avatar, role, status }
let ssoEnabled   = false;

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
    renderAdminMultiUserTab(data);
  } catch (err) { console.error('Admin status failed:', err); }
}

function renderAdminMultiUserTab(status) {
  // Credentials indicator
  const credEl = document.getElementById('mu-cred-status');
  if (status.credentialsConfigured) {
    credEl.innerHTML = '<p class="mu-cred-ok">✓ Google OAuth credentials are configured.</p>';
  } else {
    credEl.innerHTML = '<p class="mu-cred-warn">⚠ Google OAuth credentials are not set. Add them to your docker-compose.yml and rebuild:<code>GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=...\nGOOGLE_CALLBACK_URL=https://your-domain/auth/google/callback\nSESSION_SECRET=...</code></p>';
  }

  const disabledView = document.getElementById('mu-disabled-view');
  const enabledView  = document.getElementById('mu-enabled-view');
  const enableBtn    = document.getElementById('mu-enable-btn');

  if (status.ssoEnabled) {
    disabledView.style.display = 'none';
    enabledView.style.display  = 'block';
    const approvalToggle = document.getElementById('mu-require-approval');
    approvalToggle.checked = status.requireApproval;
    const adminOnly = document.getElementById('mu-admin-only');
    if (adminOnly) adminOnly.style.display = status.isAdmin ? 'block' : 'none';
    const usersTab = document.getElementById('an-users');
    if (usersTab) usersTab.style.display = status.isAdmin ? '' : 'none';
  } else {
    disabledView.style.display = 'block';
    enabledView.style.display  = 'none';
    enableBtn.disabled = !status.credentialsConfigured;
  }
}

async function enableSSO() {
  const btn = document.getElementById('mu-enable-btn');
  btn.disabled = true;
  btn.textContent = 'Enabling…';
  try {
    const res  = await fetch('/api/admin/enable-sso', { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = 'Enable Multi-User SSO';
      return;
    }
    if (data.redirectTo) window.location.href = data.redirectTo;
  } catch (err) {
    alert('Failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Enable Multi-User SSO';
  }
}

async function disableSSO() {
  if (!confirm('Disable SSO? The app will return to single-user mode. All data is preserved.')) return;
  const res = await fetch('/api/admin/disable-sso', { method: 'POST' });
  if ((await res.json()).success) window.location.reload();
  else alert('Failed to disable SSO.');
}

async function updateRequireApproval(checked) {
  await fetch('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requireApproval: checked })
  });
}

// ── USER MANAGEMENT ───────────────────────────────────────────────────────
async function loadUserManagement() {
  try {
    const res   = await fetch('/api/admin/users');
    const users = await res.json();
    renderUserLists(users);
    // Update pending dot
    const pending = users.filter(u => u.status === 'pending').length;
    const dot = document.getElementById('user-pending-dot');
    if (dot) { dot.textContent = pending || ''; dot.style.display = pending ? 'inline' : 'none'; }
  } catch (err) { console.error('User management failed:', err); }
}

function renderUserLists(users) {
  renderUserGroup('users-pending-list',   users.filter(u => u.status === 'pending'),
    [{ label:'Approve', cls:'btn-approve', action:'approve' }, { label:'Deny', cls:'btn-delete', action:'delete' }]);
  renderUserGroup('users-active-list',    users.filter(u => u.status === 'active'),
    [{ label:'Suspend', cls:'btn-suspend', action:'suspend', skipAdmin:true }]);
  renderUserGroup('users-suspended-list', users.filter(u => u.status === 'suspended'),
    [{ label:'Reactivate', cls:'btn-approve', action:'reactivate' }, { label:'Delete', cls:'btn-delete', action:'delete' }]);
}

function renderUserGroup(elId, users, actions) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!users.length) { el.innerHTML = '<span class="no-users">None</span>'; return; }
  el.innerHTML = users.map(u => `
    <div class="user-row">
      <img class="user-row-avatar" src="${u.avatar || ''}" onerror="this.style.display='none'" alt="">
      <div class="user-row-info">
        <div class="user-row-name">${_esc(u.name)}</div>
        <div class="user-row-email">${_esc(u.email)}</div>
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
  const map = { approve:'POST', suspend:'POST', reactivate:'POST', delete:'DELETE' };
  if (action === 'delete' && !confirm('Permanently delete this user?')) return;
  const url    = `/api/admin/users/${userId}` + (action === 'delete' ? '' : `/${action}`);
  const method = map[action] || 'POST';
  const res    = await fetch(url, { method });
  if (res.ok) loadUserManagement();
  else { const e = await res.json(); alert(e.error || 'Action failed'); }
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
  // Owner row
  document.getElementById('share-owner-name').textContent =
    shareData.ownerName || shareData.ownerId || 'You';
  const xBtn = document.getElementById('share-transfer-btn');
  xBtn.style.display = (!currentUser || shareData.ownerId === currentUser.id) ? '' : 'none';

  // Shared-with list
  const listEl = document.getElementById('share-users-list');
  const sw = shareData.sharedWith || [];
  if (!sw.length) {
    listEl.innerHTML = '<span class="no-users" style="padding:8px 0;display:block">Not shared with anyone yet</span>';
  } else {
    listEl.innerHTML = sw.map(e => `
      <div class="share-user-row">
        <img class="user-row-avatar" src="${_esc(e.userAvatar||'')}" onerror="this.style.display='none'" alt="">
        <div class="user-row-info">
          <div class="user-row-name">${_esc(e.userName||e.userId)}</div>
          <div class="user-row-email">${_esc(e.userEmail||'')}</div>
        </div>
        <select class="share-role-sel" onchange="_shareUpdateRole('${e.userId}',this.value)">
          <option value="editor" ${e.role==='editor'?'selected':''}>Editor</option>
          <option value="viewer" ${e.role==='viewer'?'selected':''}>Viewer</option>
        </select>
        <button class="um-btn btn-delete" onclick="_shareRemove('${e.userId}')">Remove</button>
      </div>`).join('');
  }

  // Add-user select
  const sel = document.getElementById('share-user-select');
  const sharedIds = new Set(sw.map(s => s.userId));
  const available = _allUsers.filter(u =>
    u.id !== shareData.ownerId && !sharedIds.has(u.id) && u.status === 'active');
  sel.innerHTML = '<option value="">— Select a user —</option>' +
    available.map(u => `<option value="${u.id}">${_esc(u.name)} (${_esc(u.email)})</option>`).join('');
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
  await loadProjectList(); // refresh badges
}

async function _shareRemove(userId) {
  if (!confirm('Remove this user\'s access?')) return;
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
  const active = _allUsers.filter(u => u.status === 'active' && u.id !== (currentUser?.id));
  if (!active.length) { alert('No other active users to transfer to.'); return; }
  const emails = active.map(u => `${u.name} — ${u.email}`).join('\n');
  const chosen = prompt(`Enter exact email address of new owner:\n\n${emails}`);
  if (!chosen) return;
  const target = active.find(u => u.email === chosen.trim());
  if (!target) { alert('User not found. Please enter an exact email address.'); return; }
  if (!confirm(`Transfer ownership of "${currentProject.title}" to ${target.name}?`)) return;
  const res = await fetch(`/api/projects/${currentProject.id}/share/transfer`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ toUserId: target.id })
  });
  if (res.ok) { await refreshShareModal(); await loadProjectList(); alert('Ownership transferred.'); }
  else { const e = await res.json(); alert('Failed: ' + (e.error || 'Unknown error')); }
}

// ── SOCKET.IO REAL-TIME COLLABORATION ─────────────────────────────────────
let _socket       = null;
let _currentRoom  = null;   // 'projectId:docId'
let _broadcastTimer = null;

function initSocket() {
  if (_socket) return;
  _socket = io({ transports: ['websocket', 'polling'] });
  _socket.on('connect',    () => {});
  _socket.on('disconnect', () => renderPresence({}));

  _socket.on('doc-updated', ({ projectId, docId, content, userId }) => {
    if (!currentProject || projectId !== currentProject.id) return;
    if (docId !== currentDocId) return;
    if (userId === currentUser?.id) return;   // our own echo
    // Apply remote content only if user isn't actively typing
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
  avatars.innerHTML = others.slice(0,5).map(u =>
    `<img class="presence-avatar" src="${_esc(u.avatar||'')}" title="${_esc(u.name)}" onerror="this.style.display='none'">`
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

// Hook showHome to leave room
const _origShowHome = showHome;
showHome = async function() {
  if (_socket) _leaveDocRoom();
  await _origShowHome();
  // Show/hide share button
  document.getElementById('btn-share').style.display = 'none';
};

// Hook openProject to show Share button
const _origOpenProject = openProject;
openProject = async function(id) {
  await _origOpenProject(id);
  const shareBtn = document.getElementById('btn-share');
  if (ssoEnabled && shareBtn) shareBtn.style.display = '';
};

// Broadcast content changes on debounce (faster than save timer)
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

// ── UPDATED initAuth ──────────────────────────────────────────────────────
// (replaces the one in the main script block)
async function _initAuthMultiUser() {
  try {
    const res  = await fetch('/api/me');
    const data = await res.json();

    if (!data.authEnabled) {
      // Single-user mode: always show admin panel button (for SSO setup)
      ssoEnabled = false;
      document.getElementById('btn-admin-panel').style.display = '';
      showHome();
      return;
    }

    ssoEnabled = true;

    if (!data.user) {
      document.getElementById('auth-overlay').style.display = 'flex';
      if (location.search.includes('auth=failed')) {
        const el = document.getElementById('auth-error-msg');
        el.textContent = 'Sign-in failed or access denied. Please try again.';
        el.style.display = 'block';
      }
      return;
    }

    if (data.user.status === 'pending') {
      document.getElementById('pending-overlay').style.display = 'flex';
      return;
    }

    if (data.user.status === 'suspended') {
      document.getElementById('auth-overlay').style.display = 'flex';
      const el = document.getElementById('auth-error-msg');
      el.textContent = 'Your account has been suspended. Contact the administrator.';
      el.style.display = 'block';
      return;
    }

    // Active user
    currentUser = data.user;

    // Toolbar user info
    const ui = document.getElementById('user-info');
    ui.style.display = 'flex';
    if (data.user.avatar) {
      const img = document.getElementById('user-avatar');
      img.src = data.user.avatar;
      img.onerror = () => { img.style.display = 'none'; };
    }
    document.getElementById('user-name').textContent = data.user.name || data.user.email || '';

    // Admin panel button: always visible in multi-user mode (contents adapt per role)
    document.getElementById('btn-admin-panel').style.display = '';

    // Init real-time
    initSocket();

    showHome();

  } catch (err) {
    console.error('Auth check failed:', err);
    showHome();
  }
}

// ── WIRE UP ALL NEW BUTTONS ───────────────────────────────────────────────
document.getElementById('btn-admin-panel').addEventListener('click', () => openAdminPanel());
document.getElementById('admin-close').addEventListener('click', closeAdminPanel);
document.getElementById('admin-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('admin-overlay')) closeAdminPanel();
});

// Admin nav tabs
document.getElementById('admin-nav').addEventListener('click', e => {
  const item = e.target.closest('.an-item');
  if (item && item.dataset.asection) switchAdminTab(item.dataset.asection);
});

document.getElementById('mu-enable-btn').addEventListener('click', enableSSO);
document.getElementById('mu-disable-btn').addEventListener('click', disableSSO);
document.getElementById('mu-require-approval').addEventListener('change', e => updateRequireApproval(e.target.checked));

// Share modal
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

// ── RE-RUN INIT ────────────────────────────────────────────────────────────
// This replaces the initAuth() call in the main script block.
// We cancel the previous call by overwriting initAuth and re-running.
_initAuthMultiUser();