const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getProject, saveProject } = require('../db');

function hasEditAccess(project, userId) {
  if (!userId) return true;
  if (project.ownerId === userId) return true;
  const share = (project.sharedWith || []).find(s => s.userId === userId);
  return share?.role === 'editor';
}

function hasReadAccess(project, userId) {
  if (!userId) return true;
  if (project.ownerId === userId) return true;
  return (project.sharedWith || []).some(s => s.userId === userId);
}

function countWords(html) {
  if (!html) return 0;
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').filter(w => w.length > 0).length : 0;
}

// ── GET /:projectId/:docId ─────────────────────────────────────────────────
router.get('/:projectId/:docId', (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!hasReadAccess(project, req.userId)) return res.status(403).json({ error: 'Access denied' });
    const doc = project.documents[req.params.docId];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:projectId/:docId ─────────────────────────────────────────────────
router.put('/:projectId/:docId', (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!hasEditAccess(project, req.userId)) return res.status(403).json({ error: 'Viewers cannot edit documents' });

    const existing = project.documents[req.params.docId] || {};
    const updated  = { ...existing, ...req.body, id: req.params.docId, updatedAt: new Date().toISOString() };
    if (req.body.content !== undefined) updated.wordCount = countWords(req.body.content);

    project.documents[req.params.docId] = updated;
    project.updatedAt = new Date().toISOString();
    saveProject(project);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:projectId ───────────────────────────────────────────────────────
router.post('/:projectId', (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!hasEditAccess(project, req.userId)) return res.status(403).json({ error: 'Access denied' });

    const docId  = uuidv4();
    const newDoc = {
      id: docId, title: req.body.title || 'Untitled',
      content: '', synopsis: '', notes: '',
      label: 'none', status: 'draft',
      includeInCompile: true, wordCount: 0, targetWordCount: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };

    project.documents[docId] = newDoc;
    project.updatedAt = new Date().toISOString();
    saveProject(project);
    res.status(201).json(newDoc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:projectId/:docId ─────────────────────────────────────────────
router.delete('/:projectId/:docId', (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    delete project.documents[req.params.docId];
    project.updatedAt = new Date().toISOString();
    saveProject(project);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
