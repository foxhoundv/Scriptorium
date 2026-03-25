const express  = require('express');
const router   = express.Router();
const { getAllUsers, getUser, updateUser, createUser, deleteUser, adminCount, setPassword } = require('../users');

const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

function requireAdmin(req, res, next) {
  if (req.userRole === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// ── GET /api/admin/status ─────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    multiUserEnabled: AUTH_ENABLED,
    isAdmin:          req.userRole === 'admin'
  });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────
router.get('/users', requireAdmin, (req, res) => {
  res.json(getAllUsers().map(u => ({
    id:          u.id,
    username:    u.username,
    displayName: u.display_name,
    role:        u.role,
    status:      u.status,
    createdAt:   u.created_at,
    lastSeenAt:  u.last_seen_at || null
  })));
});

// ── POST /api/admin/users  { username, password, displayName, role } ───────
router.post('/users', requireAdmin, async (req, res) => {
  const { username, password, displayName, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const user = await createUser({ username, password, displayName, role: role || 'user' });
    res.status(201).json({
      id:          user.id,
      username:    user.username,
      displayName: user.display_name,
      role:        user.role,
      status:      user.status
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/admin/users/:id/password  { password } ───────────────────────
router.put('/users/:id/password', requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await setPassword(req.params.id, password);
  res.json({ success: true });
});

// ── POST /api/admin/users/:id/suspend ─────────────────────────────────────
router.post('/users/:id/suspend', requireAdmin, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot suspend an administrator account' });
  updateUser(req.params.id, { status: 'suspended' });
  res.json({ success: true });
});

// ── POST /api/admin/users/:id/reactivate ──────────────────────────────────
router.post('/users/:id/reactivate', requireAdmin, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  updateUser(req.params.id, { status: 'active' });
  res.json({ success: true });
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────
router.delete('/users/:id', requireAdmin, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin' && adminCount() <= 1) {
    return res.status(400).json({ error: 'Cannot delete the only administrator account' });
  }
  deleteUser(req.params.id);
  res.json({ success: true });
});

module.exports = router;
