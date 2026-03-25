const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function getProjectsDir(req) {
  return path.join(req.app.locals.DATA_DIR, 'projects');
}

function getProjectPath(req, projectId) {
  return path.join(getProjectsDir(req), `${projectId}.json`);
}

function createDefaultProject(title) {
  const rootId = uuidv4();
  const manuscriptId = uuidv4();
  const researchId = uuidv4();
  const trashId = uuidv4();
  const welcomeDocId = uuidv4();

  return {
    id: uuidv4(),
    title,
    description: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      targetWordCount: 80000,
      font: 'Georgia',
      fontSize: 16,
      lineHeight: 1.8,
      theme: 'light'
    },
    binder: {
      id: rootId,
      title: 'Root',
      type: 'root',
      children: [
        {
          id: manuscriptId,
          title: 'Manuscript',
          type: 'folder',
          icon: 'book',
          expanded: true,
          children: [
            {
              id: welcomeDocId,
              title: 'Welcome to ScribeFlow',
              type: 'document',
              icon: 'file-text',
              children: []
            }
          ]
        },
        {
          id: researchId,
          title: 'Research',
          type: 'folder',
          icon: 'search',
          expanded: false,
          children: []
        },
        {
          id: trashId,
          title: 'Trash',
          type: 'trash',
          icon: 'trash-2',
          expanded: false,
          children: []
        }
      ]
    },
    documents: {
      [welcomeDocId]: {
        id: welcomeDocId,
        title: 'Welcome to ScribeFlow',
        content: '<h2>Welcome to ScribeFlow</h2><p>ScribeFlow is your self-hosted writing workspace, inspired by Scrivener. Here\'s what you can do:</p><ul><li><strong>Binder</strong> – Organize your manuscript, research, and notes in the left panel</li><li><strong>Editor</strong> – Write with a rich text editor with full formatting support</li><li><strong>Inspector</strong> – Add notes, synopses, and metadata on the right panel</li><li><strong>Corkboard</strong> – View all documents as index cards for outlining</li><li><strong>Export</strong> – Export your entire manuscript as TXT, Markdown, DOCX, or PDF</li></ul><p>Start writing by clicking any document in the Binder, or create a new one with the + button.</p><p><em>Happy writing!</em></p>',
        synopsis: 'Introduction to ScribeFlow features.',
        notes: '',
        label: 'none',
        status: 'draft',
        includeInCompile: true,
        wordCount: 0,
        targetWordCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  };
}

// GET all projects
router.get('/', async (req, res) => {
  try {
    const dir = getProjectsDir(req);
    await fs.ensureDir(dir);
    const files = await fs.readdir(dir);
    const projects = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const data = await fs.readJson(path.join(dir, file));
        const settings = data.settings || {};
        projects.push({
          id: data.id,
          title: data.title,
          description: data.description,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          wordCount: Object.values(data.documents || {}).reduce((sum, doc) => sum + (doc.wordCount || 0), 0),
          docStyle: settings.docStyle || null,
          researchType: settings.researchType || null,
        });
      }
    }
    projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single project
router.get('/:id', async (req, res) => {
  try {
    const filePath = getProjectPath(req, req.params.id);
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const project = await fs.readJson(filePath);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create project
router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const project = createDefaultProject(title);
    const filePath = getProjectPath(req, project.id);
    await fs.writeJson(filePath, project, { spaces: 2 });
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update project (binder structure, settings, etc.)
router.put('/:id', async (req, res) => {
  try {
    const filePath = getProjectPath(req, req.params.id);
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const existing = await fs.readJson(filePath);
    const updated = {
      ...existing,
      ...req.body,
      id: existing.id,
      updatedAt: new Date().toISOString()
    };
    await fs.writeJson(filePath, updated, { spaces: 2 });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE project
router.delete('/:id', async (req, res) => {
  try {
    const filePath = getProjectPath(req, req.params.id);
    await fs.remove(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
