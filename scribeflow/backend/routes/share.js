const express = require('express');
const router  = express.Router({ mergeParams: true });
const fs      = require('fs-extra');
const path    = require('path');
const { getAllUsers } = require('../users');

function projectPath(req, id) {
  return path.join(req.app.locals.DATA_DIR, 'projects', `${id}.json`);
}

// ── Check project access ───────────────────────────────────────────────────
function hasAccess(project, userId, requireEdit = false) {
  if (!userId) return true;                         // single-user mode
  if (project.ownerId === userId) return true;
  const share = (project.sharedWith || []).find(s => s.userId === userId);
  if (!share) return false;
  return requireEdit ? share.role === 'editor' : true;
}

// Middleware: load project + verify at least read access
async function loadProject(req, res, next) {
  try {
    const p = await fs.readJson(projectPath(req, req.params.id));
    if (!hasAccess(p, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    req.project = p;
    next();
  } catch {
    res.status(404).json({ error: 'Project not found' });
  }
}

// Middleware: owner only
function requireOwner(req, res, next) {
  if (!req.userId || req.project.ownerId === req.userId) return next(); // single-user or owner
  res.status(403).json({ error: 'Only the project owner can manage sharing' });
}

// ── GET /api/projects/:id/share ────────────────────────────────────────────
router.get('/', loadProject, async (req, res) => {
  const p = req.project;
  // Enrich sharedWith with user info
  const allUsers = await getAllUsers().catch(() => []);
  const userMap  = Object.fromEntries(allUsers.map(u => [u.id, u]));
  const sharedWith = (p.sharedWith || []).map(entry => ({
    ...entry,
    userName:   userMap[entry.userId]?.name  || entry.userId,
    userEmail:  userMap[entry.userId]?.email || '',
    userAvatar: userMap[entry.userId]?.avatar || ''
  }));
  const ownerUser = userMap[p.ownerId];
  res.json({
    ownerId:       p.ownerId || null,
    ownerName:     ownerUser?.name  || null,
    ownerEmail:    ownerUser?.email || null,
    ownerAvatar:   ownerUser?.avatar || null,
    sharedWith
  });
});

// ── PUT /api/projects/:id/share  { userId, role } ─────────────────────────
router.put('/', loadProject, requireOwner, async (req, res) => {
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
  await fs.writeJson(projectPath(req, req.params.id), p, { spaces: 2 });
  res.json({ sharedWith: p.sharedWith });
});

// ── DELETE /api/projects/:id/share/:userId ────────────────────────────────
router.delete('/:userId', loadProject, requireOwner, async (req, res) => {
  const p = req.project;
  p.sharedWith   = (p.sharedWith || []).filter(s => s.userId !== req.params.userId);
  p.updatedAt    = new Date().toISOString();
  await fs.writeJson(projectPath(req, req.params.id), p, { spaces: 2 });
  res.json({ success: true });
});

// ── POST /api/projects/:id/share/transfer  { toUserId } ───────────────────
router.post('/transfer', loadProject, requireOwner, async (req, res) => {
  const { toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId required' });
  const p           = req.project;
  const oldOwnerId  = p.ownerId;
  p.ownerId         = toUserId;
  // Remove new owner from sharedWith if present
  p.sharedWith = (p.sharedWith || []).filter(s => s.userId !== toUserId);
  // Give old owner editor access
  if (oldOwnerId && !p.sharedWith.find(s => s.userId === oldOwnerId)) {
    p.sharedWith.push({ userId: oldOwnerId, role: 'editor', grantedAt: new Date().toISOString() });
  }
  p.updatedAt = new Date().toISOString();
  await fs.writeJson(projectPath(req, req.params.id), p, { spaces: 2 });
  res.json({ success: true, ownerId: toUserId });
});

module.exports = router;
