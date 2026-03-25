const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function getProjectPath(req, projectId) {
  const base = path.join(req.app.locals.DATA_DIR, 'projects');
  const dir  = req.userId ? path.join(base, req.userId) : base;
  return path.join(dir, `${projectId}.json`);
}

function countWords(html) {
  if (!html) return 0;
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').filter(w => w.length > 0).length : 0;
}

// GET single document within a project
router.get('/:projectId/:docId', async (req, res) => {
  try {
    const filePath = getProjectPath(req, req.params.projectId);
    if (!await fs.pathExists(filePath)) return res.status(404).json({ error: 'Project not found' });
    const project = await fs.readJson(filePath);
    const doc = project.documents[req.params.docId];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT save/update document
router.put('/:projectId/:docId', async (req, res) => {
  try {
    const filePath = getProjectPath(req, req.params.projectId);
    if (!await fs.pathExists(filePath)) return res.status(404).json({ error: 'Project not found' });
    const project = await fs.readJson(filePath);
    
    const existing = project.documents[req.params.docId] || {};
    const updated = {
      ...existing,
      ...req.body,
      id: req.params.docId,
      updatedAt: new Date().toISOString()
    };
    
    // Auto-calculate word count from content
    if (req.body.content !== undefined) {
      updated.wordCount = countWords(req.body.content);
    }
    
    project.documents[req.params.docId] = updated;
    project.updatedAt = new Date().toISOString();
    await fs.writeJson(filePath, project, { spaces: 2 });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create a new document in a project
router.post('/:projectId', async (req, res) => {
  try {
    const filePath = getProjectPath(req, req.params.projectId);
    if (!await fs.pathExists(filePath)) return res.status(404).json({ error: 'Project not found' });
    const project = await fs.readJson(filePath);
    
    const docId = uuidv4();
    const newDoc = {
      id: docId,
      title: req.body.title || 'Untitled',
      content: '',
      synopsis: '',
      notes: '',
      label: 'none',
      status: 'draft',
      includeInCompile: true,
      wordCount: 0,
      targetWordCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    project.documents[docId] = newDoc;
    project.updatedAt = new Date().toISOString();
    await fs.writeJson(filePath, project, { spaces: 2 });
    res.status(201).json(newDoc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE document from project
router.delete('/:projectId/:docId', async (req, res) => {
  try {
    const filePath = getProjectPath(req, req.params.projectId);
    if (!await fs.pathExists(filePath)) return res.status(404).json({ error: 'Project not found' });
    const project = await fs.readJson(filePath);
    delete project.documents[req.params.docId];
    project.updatedAt = new Date().toISOString();
    await fs.writeJson(filePath, project, { spaces: 2 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
