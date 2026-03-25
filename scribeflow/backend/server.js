const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

const projectsRouter = require('./routes/projects');
const documentsRouter = require('./routes/documents');
const exportRouter = require('./routes/export');
const bibleRouter  = require('./routes/bible');

const app = express();
const PORT = process.env.PORT || 3051;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// ── STARTUP: scan, validate, and report on persisted data ──────────────────
async function startupScan() {
  const line = '─'.repeat(52);
  console.log(line);
  console.log('  ScribeFlow  v0.8');
  console.log(line);
  console.log(`  Port           : ${PORT}`);
  console.log(`  Data directory : ${DATA_DIR}`);

  // Ensure directories exist — safe even if volume already has content
  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(PROJECTS_DIR);

  // Scan for existing project files on the mounted volume
  let files;
  try {
    files = (await fs.readdir(PROJECTS_DIR)).filter(f => f.endsWith('.json'));
  } catch (err) {
    console.error(`  [ERROR] Cannot read projects dir: ${err.message}`);
    files = [];
  }

  if (files.length === 0) {
    console.log('  Projects       : none found (fresh install or new volume)');
    console.log(line);
    return;
  }

  console.log(`  Projects found : ${files.length}`);
  console.log(line);

  let loaded = 0;
  let repaired = 0;
  let corrupted = 0;

  for (const file of files) {
    const filePath = path.join(PROJECTS_DIR, file);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      let project;

      // Parse — write .bak and skip if JSON is malformed
      try {
        project = JSON.parse(raw);
      } catch (parseErr) {
        console.warn(`  [WARN] Corrupt JSON: ${file} — ${parseErr.message}`);
        await fs.copy(filePath, filePath + '.bak').catch(() => {});
        corrupted++;
        continue;
      }

      // Structural integrity: patch missing required fields
      let dirty = false;

      if (!project.id) { project.id = path.basename(file, '.json'); dirty = true; }
      if (!project.title) { project.title = 'Recovered Project'; dirty = true; }
      if (!project.documents || typeof project.documents !== 'object') { project.documents = {}; dirty = true; }
      if (!project.binder || typeof project.binder !== 'object') {
        project.binder = {
          id: 'root', title: 'Root', type: 'root',
          children: [
            { id: 'manuscript', title: 'Manuscript', type: 'folder', icon: 'book', expanded: true, children: [] },
            { id: 'trash',      title: 'Trash',      type: 'trash',  icon: 'trash-2', expanded: false, children: [] }
          ]
        };
        dirty = true;
      }
      if (!project.settings || typeof project.settings !== 'object') { project.settings = {}; dirty = true; }
      if (!project.createdAt) { project.createdAt = new Date().toISOString(); dirty = true; }
      if (!project.updatedAt) { project.updatedAt = new Date().toISOString(); dirty = true; }

      // Recalculate word counts for documents missing them
      let wcFixed = 0;
      for (const doc of Object.values(project.documents)) {
        if (typeof doc.wordCount !== 'number') {
          doc.wordCount = doc.content
            ? doc.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w).length
            : 0;
          wcFixed++;
          dirty = true;
        }
      }

      if (dirty) {
        await fs.writeJson(filePath, project, { spaces: 2 });
        repaired++;
        const wcNote = wcFixed ? `, ${wcFixed} word count(s) recalculated` : '';
        console.log(`  [REPAIRED] "${project.title}"${wcNote}`);
      } else {
        const totalWc = Object.values(project.documents)
          .reduce((s, d) => s + (d.wordCount || 0), 0);
        const docCount = Object.keys(project.documents).length;
        console.log(`  [OK]       "${project.title}" — ${docCount} doc(s), ${totalWc.toLocaleString()} words`);
      }
      loaded++;
    } catch (err) {
      console.error(`  [ERROR] Could not process ${file}: ${err.message}`);
      corrupted++;
    }
  }

  console.log(line);
  console.log(`  Loaded: ${loaded}  |  Repaired: ${repaired}  |  Skipped (corrupt): ${corrupted}`);
  // Report Bible data status
  const bibleDir   = path.join(DATA_DIR, '..', 'bibles') ;
  const biblesData = path.join(__dirname, 'data', 'bibles', 'index.json');
  if (require('fs-extra').existsSync(biblesData)) {
    try {
      const idx = JSON.parse(require('fs').readFileSync(biblesData, 'utf8'));
      console.log(`  Bible data     : ${idx.length} translation(s) ready`);
    } catch { console.log('  Bible data     : index unreadable'); }
  } else {
    console.log('  Bible data     : NOT FOUND — run scripts/fetch-bibles.js');
    console.log('  (Bible data is fetched during Docker build automatically)');
  }
  console.log(line);
}

// ── EXPRESS SETUP ──────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

app.locals.DATA_DIR = DATA_DIR;

app.use('/api/projects',  projectsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/export',    exportRouter);
app.use('/api/bible',     bibleRouter);

// Health check — includes live project count to verify volume access
app.get('/api/health', async (req, res) => {
  try {
    const files = (await fs.readdir(PROJECTS_DIR)).filter(f => f.endsWith('.json'));
    res.json({ status: 'ok', version: '0.8.0', name: 'ScribeFlow', projects: files.length, dataDir: DATA_DIR });
  } catch {
    res.json({ status: 'ok', version: '0.8.0', name: 'ScribeFlow', projects: 0, dataDir: DATA_DIR });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
});

// ── START (run scan first, then bind) ──────────────────────────────────────
startupScan()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`  Listening on http://0.0.0.0:${PORT}`);
      console.log('─'.repeat(52));
    });
  })
  .catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
