const express  = require('express');
const router   = express.Router({ mergeParams: true });
const { getProject, saveProject } = require('../db');
const { getAllUsers } = require('../users');

function hasAccess(project, userId, requireEdit = false) {
  if (!userId) return true;
  if (project.ownerId === userId) return true;
  const share = (project.sharedWith || []).find(s => s.userId === userId);
  if (!share) return false;
  return requireEdit ? share.role === 'editor' : true;
}

function loadProject(req, res, next) {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (!hasAccess(p, req.userId)) return res.status(403).json({ error: 'Access denied' });
  req.project = p;
  next();
}

function requireOwner(req, res, next) {
  if (!req.userId || req.project.ownerId === req.userId) return next();
  res.status(403).json({ error: 'Only the project owner can manage sharing' });
}

// ── GET /api/projects/:id/share ────────────────────────────────────────────
router.get('/', loadProject, (req, res) => {
  const p       = req.project;
  const allUsers = getAllUsers();
  const userMap  = Object.fromEntries(allUsers.map(u => [u.id, u]));

  const sharedWith = (p.sharedWith || []).map(entry => ({
    ...entry,
    userName:  userMap[entry.userId]?.display_name || userMap[entry.userId]?.username || entry.userId,
    userEmail: userMap[entry.userId]?.username     || ''
  }));
  const owner = userMap[p.ownerId];
  res.json({
    ownerId:   p.ownerId   || null,
    ownerName: owner?.display_name || owner?.username || null,
    sharedWith
  });
});

// ── PUT /api/projects/:id/share  { userId, role } ─────────────────────────
router.put('/', loadProject, requireOwner, (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !['editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'userId and role ("editor" or "viewer") are required' });
  }
  if (userId === req.project.ownerId) {
    return res.status(400).json({ error: 'Cannot share with the current owner' });
  }
  const p = req.project;
  p.sharedWith = p.sharedWith || [];
  const existing = p.sharedWith.find(s => s.userId === userId);
  if (existing) {
    existing.role = role;
  } else {
    p.sharedWith.push({ userId, role, grantedAt: new Date().toISOString() });
  }
  p.updatedAt = new Date().toISOString();
  saveProject(p);
  res.json({ sharedWith: p.sharedWith });
});

// ── DELETE /api/projects/:id/share/:userId ────────────────────────────────
router.delete('/:userId', loadProject, requireOwner, (req, res) => {
  const p = req.project;
  p.sharedWith = (p.sharedWith || []).filter(s => s.userId !== req.params.userId);
  p.updatedAt  = new Date().toISOString();
  saveProject(p);
  res.json({ success: true });
});

// ── POST /api/projects/:id/share/transfer  { toUserId } ───────────────────
router.post('/transfer', loadProject, requireOwner, (req, res) => {
  const { toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId required' });
  const p          = req.project;
  const oldOwnerId = p.ownerId;
  p.ownerId        = toUserId;
  p.sharedWith     = (p.sharedWith || []).filter(s => s.userId !== toUserId);
  if (oldOwnerId && !p.sharedWith.find(s => s.userId === oldOwnerId)) {
    p.sharedWith.push({ userId: oldOwnerId, role: 'editor', grantedAt: new Date().toISOString() });
  }
  p.updatedAt = new Date().toISOString();
  saveProject(p);
  res.json({ success: true, ownerId: toUserId });
});

module.exports = router;
