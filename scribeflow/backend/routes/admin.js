const express = require('express');
const router  = express.Router();
const { getConfig, saveConfig } = require('../config');
const { getAllUsers, getUser, saveUser, deleteUser } = require('../users');

// ── Require admin role ──────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.userRole === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// ── GET /api/admin/status ─────────────────────────────────────────────────
// Always accessible after requireAuth; returns SSO status for the UI.
router.get('/status', async (req, res) => {
  const config = await getConfig();
  const credentialsConfigured = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
  res.json({
    ssoEnabled:            config.ssoEnabled,
    requireApproval:       config.requireApproval !== false,
    credentialsConfigured,
    isAdmin:               req.userRole === 'admin'
  });
});

// ── POST /api/admin/enable-sso ────────────────────────────────────────────
// Single-user mode only (SSO not yet enabled).
// Sets setupMode=true so the next Google callback creates the admin account.
router.post('/enable-sso', async (req, res) => {
  const config = await getConfig();
  if (config.ssoEnabled) {
    return res.status(400).json({ error: 'SSO is already enabled.' });
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({
      error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set as environment variables before enabling SSO.'
    });
  }
  await saveConfig({ ssoEnabled: true, setupMode: true });
  res.json({ success: true, redirectTo: '/auth/google' });
});

// ── POST /api/admin/disable-sso ───────────────────────────────────────────
router.post('/disable-sso', requireAdmin, async (req, res) => {
  await saveConfig({ ssoEnabled: false, setupMode: false });
  res.json({ success: true });
});

// ── PUT /api/admin/config ─────────────────────────────────────────────────
router.put('/config', requireAdmin, async (req, res) => {
  const updates = {};
  if (typeof req.body.requireApproval === 'boolean') {
    updates.requireApproval = req.body.requireApproval;
  }
  const cfg = await saveConfig(updates);
  res.json(cfg);
});

// ── GET /api/admin/users ──────────────────────────────────────────────────
router.get('/users', requireAdmin, async (req, res) => {
  const users = await getAllUsers();
  res.json(users);
});

// ── POST /api/admin/users/:id/approve ────────────────────────────────────
router.post('/users/:id/approve', requireAdmin, async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.status     = 'active';
  user.approvedAt = new Date().toISOString();
  user.approvedBy = req.userId || 'admin';
  await saveUser(user);
  res.json(user);
});

// ── POST /api/admin/users/:id/suspend ────────────────────────────────────
router.post('/users/:id/suspend', requireAdmin, async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot suspend the administrator account' });
  user.status = 'suspended';
  await saveUser(user);
  res.json(user);
});

// ── POST /api/admin/users/:id/reactivate ─────────────────────────────────
router.post('/users/:id/reactivate', requireAdmin, async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.status = 'active';
  await saveUser(user);
  res.json(user);
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') {
    return res.status(400).json({ error: 'Cannot delete the administrator account' });
  }
  await deleteUser(req.params.id);
  res.json({ success: true });
});

module.exports = router;
