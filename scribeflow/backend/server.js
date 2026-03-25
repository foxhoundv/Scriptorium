const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs-extra');

const projectsRouter = require('./routes/projects');
const documentsRouter = require('./routes/documents');
const exportRouter   = require('./routes/export');
const bibleRouter    = require('./routes/bible');
const requireAuth    = require('./middleware/auth');

const app       = express();
const PORT      = process.env.PORT     || 3051;
const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

// ── SESSION + PASSPORT (only when AUTH_ENABLED=true) ───────────────────────
if (AUTH_ENABLED) {
  const session         = require('express-session');
  const FileStore       = require('session-file-store')(session);
  const passport        = require('passport');
  const GoogleStrategy  = require('passport-google-oauth20').Strategy;

  const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
  fs.ensureDirSync(SESSIONS_DIR);

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('[AUTH] ERROR: AUTH_ENABLED=true but GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.');
    process.exit(1);
  }

  app.use(session({
    store: new FileStore({ path: SESSIONS_DIR, ttl: 86400 * 30, logFn: () => {} }),
    secret: process.env.SESSION_SECRET || 'scribeflow-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge:   86400000 * 30, // 30 days
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === 'true'
    }
  }));

  // Store the minimal profile needed to identify the user
  passport.serializeUser((user, done) => {
    done(null, JSON.stringify({
      id:          user.id,
      displayName: user.displayName,
      email:       user.emails?.[0]?.value || '',
      avatar:      user.photos?.[0]?.value || ''
    }));
  });

  passport.deserializeUser((str, done) => {
    try { done(null, JSON.parse(str)); }
    catch (e) { done(e); }
  });

  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
    },
    (accessToken, refreshToken, profile, done) => done(null, profile)
  ));

  app.use(passport.initialize());
  app.use(passport.session());

  // Mount Google OAuth routes
  app.use('/auth', require('./routes/auth'));
}

// ── CORE MIDDLEWARE ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

app.locals.DATA_DIR     = DATA_DIR;
app.locals.AUTH_ENABLED = AUTH_ENABLED;

// ── /api/me — always public, tells the client the auth state ───────────────
app.get('/api/me', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ authEnabled: false });

  if (req.isAuthenticated && req.isAuthenticated()) {
    const u = req.user;
    return res.json({
      authEnabled: true,
      user: {
        id:     u.id,
        name:   u.displayName,
        email:  u.email  || u.emails?.[0]?.value  || '',
        avatar: u.avatar || u.photos?.[0]?.value  || ''
      }
    });
  }
  res.json({ authEnabled: true, user: null });
});

// ── API ROUTES (behind auth guard) ─────────────────────────────────────────
app.use('/api/projects',  requireAuth, projectsRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/export',    requireAuth, exportRouter);
app.use('/api/bible',     bibleRouter);   // read-only public data, no auth needed

// Health check — includes live project count to verify volume access
app.get('/api/health', async (req, res) => {
  try {
    // Count only top-level .json files (single-user) or total across subdirs (multi-user)
    let count = 0;
    const entries = await fs.readdir(PROJECTS_DIR).catch(() => []);
    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        count++;
      } else {
        // May be a user subdirectory
        const sub = path.join(PROJECTS_DIR, entry);
        try {
          const stat = await fs.stat(sub);
          if (stat.isDirectory()) {
            const subFiles = await fs.readdir(sub);
            count += subFiles.filter(f => f.endsWith('.json')).length;
          }
        } catch {}
      }
    }
    res.json({ status: 'ok', version: '1.7.0', name: 'ScribeFlow', projects: count, dataDir: DATA_DIR, authEnabled: AUTH_ENABLED });
  } catch {
    res.json({ status: 'ok', version: '1.7.0', name: 'ScribeFlow', projects: 0, dataDir: DATA_DIR, authEnabled: AUTH_ENABLED });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
});

// ── STARTUP: scan, validate, and report on persisted data ──────────────────
async function startupScan() {
  const line = '─'.repeat(52);
  console.log(line);
  console.log('  ScribeFlow  v1.7');
  console.log(line);
  console.log(`  Port           : ${PORT}`);
  console.log(`  Data directory : ${DATA_DIR}`);
  console.log(`  Auth           : ${AUTH_ENABLED ? 'Google SSO enabled' : 'disabled (single-user)'}`);

  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(PROJECTS_DIR);

  let files;
  try {
    files = (await fs.readdir(PROJECTS_DIR)).filter(f => f.endsWith('.json'));
  } catch (err) {
    console.error(`  [ERROR] Cannot read projects dir: ${err.message}`);
    files = [];
  }

  if (AUTH_ENABLED) {
    console.log('  Projects       : stored per-user in subdirectories (auth mode)');
    console.log(line);
  } else {
    if (files.length === 0) {
      console.log('  Projects       : none found (fresh install or new volume)');
      console.log(line);
      return;
    }

    console.log(`  Projects found : ${files.length}`);
    console.log(line);

    let loaded = 0, repaired = 0, corrupted = 0;

    for (const file of files) {
      const filePath = path.join(PROJECTS_DIR, file);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        let project;
        try {
          project = JSON.parse(raw);
        } catch (parseErr) {
          console.warn(`  [WARN] Corrupt JSON: ${file} — ${parseErr.message}`);
          await fs.copy(filePath, filePath + '.bak').catch(() => {});
          corrupted++;
          continue;
        }

        let dirty = false;
        if (!project.id)          { project.id = path.basename(file, '.json'); dirty = true; }
        if (!project.title)       { project.title = 'Recovered Project'; dirty = true; }
        if (!project.documents || typeof project.documents !== 'object') { project.documents = {}; dirty = true; }
        if (!project.binder   || typeof project.binder   !== 'object') {
          project.binder = {
            id: 'root', title: 'Root', type: 'root',
            children: [
              { id: 'manuscript', title: 'Manuscript', type: 'folder', icon: 'book', expanded: true,  children: [] },
              { id: 'trash',      title: 'Trash',      type: 'trash',  icon: 'trash-2', expanded: false, children: [] }
            ]
          };
          dirty = true;
        }
        if (!project.settings || typeof project.settings !== 'object') { project.settings = {};  dirty = true; }
        if (!project.createdAt) { project.createdAt = new Date().toISOString(); dirty = true; }
        if (!project.updatedAt) { project.updatedAt = new Date().toISOString(); dirty = true; }

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
          const totalWc  = Object.values(project.documents).reduce((s, d) => s + (d.wordCount || 0), 0);
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
  }

  // Report Bible data status
  const biblesData = path.join(__dirname, 'data', 'bibles', 'index.json');
  if (require('fs-extra').existsSync(biblesData)) {
    try {
      const idx = JSON.parse(require('fs').readFileSync(biblesData, 'utf8'));
      console.log(`  Bible data     : ${idx.length} translation(s) ready`);
    } catch { console.log('  Bible data     : index unreadable'); }
  } else {
    console.log('  Bible data     : NOT FOUND — run scripts/fetch-bibles.js');
  }
  console.log(line);
}

// ── START ───────────────────────────────────────────────────────────────────
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
