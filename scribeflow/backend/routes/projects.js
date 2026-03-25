const express = require('express');
const router  = express.Router();
const fs      = require('fs-extra');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const shareRouter = require('./share');

// ── Paths ──────────────────────────────────────────────────────────────────
function projectsDir(req)       { return path.join(req.app.locals.DATA_DIR, 'projects'); }
function projectPath(req, id)   { return path.join(projectsDir(req), `${id}.json`); }

// ── Access helpers ─────────────────────────────────────────────────────────
function userAccess(project, userId) {
  if (!userId) return 'owner';                           // single-user: full access
  if (project.ownerId === userId) return 'owner';
  const share = (project.sharedWith || []).find(s => s.userId === userId);
  if (share) return share.role;                          // 'editor' | 'viewer'
  return null;
}

// ── Default project factory ────────────────────────────────────────────────
function createDefaultProject(title, ownerId) {
  const rootId       = uuidv4();
  const manuscriptId = uuidv4();
  const researchId   = uuidv4();
  const trashId      = uuidv4();
  const welcomeDocId = uuidv4();
  return {
    id:          uuidv4(),
    title,
    description: '',
    ownerId:     ownerId || null,
    sharedWith:  [],
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    settings: { targetWordCount: 80000, font: 'Georgia', fontSize: 16, lineHeight: 1.8, theme: 'light' },
    binder: {
      id: rootId, title: 'Root', type: 'root',
      children: [
        { id: manuscriptId, title: 'Manuscript', type: 'folder', icon: 'book',   expanded: true,  children: [
          { id: welcomeDocId, title: 'Welcome to ScribeFlow', type: 'document', icon: 'file-text', children: [] }
        ]},
        { id: researchId, title: 'Research', type: 'folder', icon: 'search', expanded: false, children: [] },
        { id: trashId,    title: 'Trash',    type: 'trash',  icon: 'trash-2', expanded: false, children: [] }
      ]
    },
    documents: {
      [welcomeDocId]: {
        id: welcomeDocId, title: 'Welcome to ScribeFlow',
        content: '<h2>Welcome to ScribeFlow</h2><p>ScribeFlow is your self-hosted writing workspace. Here\'s what you can do:</p><ul><li><strong>Binder</strong> – Organize your manuscript and research</li><li><strong>Editor</strong> – Write with full formatting support</li><li><strong>Inspector</strong> – Add notes, synopses, and metadata</li><li><strong>Corkboard</strong> – View documents as index cards</li><li><strong>Export</strong> – Export as TXT, Markdown, DOCX, or HTML</li></ul><p><em>Happy writing!</em></p>',
        synopsis: 'Introduction to ScribeFlow features.',
        notes: '', label: 'none', status: 'draft',
        includeInCompile: true, wordCount: 0, targetWordCount: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
    }
  };
}

// ── GET /api/projects ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const dir = projectsDir(req);
    await fs.ensureDir(dir);
    const files    = (await fs.readdir(dir)).filter(f => f.endsWith('.json'));
    const projects = [];

    for (const file of files) {
      try {
        const data   = await fs.readJson(path.join(dir, file));
        const access = userAccess(data, req.userId);
        if (!access) continue;                // no access — skip

        const settings = data.settings || {};
        projects.push({
          id:          data.id,
          title:       data.title,
          description: data.description,
          createdAt:   data.createdAt,
          updatedAt:   data.updatedAt,
          wordCount:   Object.values(data.documents || {}).reduce((s, d) => s + (d.wordCount || 0), 0),
          docStyle:    settings.docStyle    || null,
          researchType:settings.researchType|| null,
          ownerId:     data.ownerId         || null,
          sharedWith:  data.sharedWith      || [],
          accessRole:  access               // 'owner' | 'editor' | 'viewer'
        });
      } catch {}
    }

    projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const fp = projectPath(req, req.params.id);
    if (!await fs.pathExists(fp)) return res.status(404).json({ error: 'Project not found' });
    const project = await fs.readJson(fp);
    if (!userAccess(project, req.userId)) return res.status(403).json({ error: 'Access denied' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/projects ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const project = createDefaultProject(title, req.userId || null);
    await fs.ensureDir(projectsDir(req));
    await fs.writeJson(projectPath(req, project.id), project, { spaces: 2 });
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/projects/:id ─────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const fp = projectPath(req, req.params.id);
    if (!await fs.pathExists(fp)) return res.status(404).json({ error: 'Project not found' });
    const existing = await fs.readJson(fp);
    const access   = userAccess(existing, req.userId);
    if (!access)            return res.status(403).json({ error: 'Access denied' });
    if (access === 'viewer') return res.status(403).json({ error: 'Viewers cannot edit projects' });

    const updated = {
      ...existing,
      ...req.body,
      id:         existing.id,
      ownerId:    existing.ownerId,    // ownership is never changed via PUT
      sharedWith: existing.sharedWith,
      updatedAt:  new Date().toISOString()
    };
    await fs.writeJson(fp, updated, { spaces: 2 });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/projects/:id ──────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const fp = projectPath(req, req.params.id);
    if (await fs.pathExists(fp)) {
      const existing = await fs.readJson(fp);
      if (req.userId && existing.ownerId !== req.userId) {
        return res.status(403).json({ error: 'Only the project owner can delete it' });
      }
    }
    await fs.remove(fp);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Share sub-router mounted at /:id/share ────────────────────────────────
router.use('/:id/share', shareRouter);

module.exports = router;
