const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs-extra');
const http     = require('http');
const { Server: SocketIO } = require('socket.io');

const projectsRouter  = require('./routes/projects');
const documentsRouter = require('./routes/documents');
const exportRouter    = require('./routes/export');
const bibleRouter     = require('./routes/bible');
const adminRouter     = require('./routes/admin');
const shareRouter     = require('./routes/share');
const authRouter      = require('./routes/auth');
const requireAuth     = require('./middleware/auth');
const { getConfig, saveConfig } = require('./config');
const { getUser }     = require('./users');

const app  = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'frontend', 'views'));
const PORT = process.env.PORT    || 3051;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// ── HTTP server (required for socket.io) ───────────────────────────────────
const httpServer = http.createServer(app);
const io         = new SocketIO(httpServer);

// ── SESSION + PASSPORT (always set up, strategy only if creds present) ─────
const session        = require('express-session');
const FileStore      = require('session-file-store')(session);
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
fs.ensureDirSync(SESSIONS_DIR);

const sessionMiddleware = session({
  store:             new FileStore({ path: SESSIONS_DIR, ttl: 86400 * 30, logFn: () => {} }),
  secret:            process.env.SESSION_SECRET || 'scribeflow-dev-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   86400000 * 30,
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.COOKIE_SECURE === 'true'
  }
});

app.use(sessionMiddleware);

// Serialize the minimal user object we need
passport.serializeUser((user, done) => {
  done(null, JSON.stringify({
    id:          user.id,
    displayName: user.displayName,
    email:       user.emails?.[0]?.value  || '',
    avatar:      user.photos?.[0]?.value  || ''
  }));
});
passport.deserializeUser((str, done) => {
  try { done(null, JSON.parse(str)); } catch (e) { done(e); }
});

// Register Google strategy only if credentials are available
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
    },
    (accessToken, refreshToken, profile, done) => done(null, profile)
  ));
}

app.use(passport.initialize());
app.use(passport.session());

// Share the session with socket.io so it can read req.user
io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
io.use((socket, next) => passport.initialize()(socket.request, socket.request.res || {}, next));
io.use((socket, next) => passport.session()(socket.request, socket.request.res || {}, next));

// ── CORE MIDDLEWARE ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

app.locals.DATA_DIR = DATA_DIR;

// ── /api/me — public endpoint, returns auth state + current user ───────────
app.get('/api/me', async (req, res) => {
  const config = await getConfig();

  if (!config.ssoEnabled) return res.json({ authEnabled: false });

  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.json({ authEnabled: true, user: null });
  }

  const user = await getUser(req.user.id);
  if (!user) return res.json({ authEnabled: true, user: null });

  res.json({
    authEnabled: true,
    user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, role: user.role, status: user.status }
  });
});

// ── AUTH ROUTES (Google OAuth) ─────────────────────────────────────────────
app.use('/auth', authRouter);

// ── API ROUTES (behind auth guard) ─────────────────────────────────────────
app.use('/api/projects',  requireAuth, projectsRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/export',    requireAuth, exportRouter);
app.use('/api/bible',     bibleRouter);          // public read-only
app.use('/api/admin',     requireAuth, adminRouter);

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const config  = await getConfig();
    const entries = await fs.readdir(PROJECTS_DIR).catch(() => []);
    const count   = entries.filter(f => f.endsWith('.json')).length;
    res.json({ status: 'ok', version: '1.7.0', name: 'ScribeFlow', projects: count, dataDir: DATA_DIR, ssoEnabled: config.ssoEnabled });
  } catch {
    res.json({ status: 'ok', version: '1.7.0', name: 'ScribeFlow', projects: 0, dataDir: DATA_DIR });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.render('index');
});

// ── SOCKET.IO: REAL-TIME COLLABORATION ────────────────────────────────────
io.on('connection', (socket) => {
  const gUser  = socket.request.user;
  const userId = gUser?.id || null;
  const userName   = gUser?.displayName || gUser?.name || 'Guest';
  const userAvatar = gUser?.avatar || gUser?.photos?.[0]?.value || '';

  socket._userId   = userId;
  socket._userName = userName;
  socket._avatar   = userAvatar;
  socket._rooms    = new Set();

  function broadcastPresence(roomKey) {
    const room     = io.sockets.adapter.rooms.get(roomKey);
    const presence = {};
    if (room) {
      for (const sid of room) {
        const s = io.sockets.sockets.get(sid);
        if (s) presence[sid] = { userId: s._userId, name: s._userName, avatar: s._avatar };
      }
    }
    io.to(roomKey).emit('presence-update', { users: presence });
  }

  socket.on('join-doc', async ({ projectId, docId }) => {
    // Access check when SSO is on
    const config = await getConfig();
    if (config.ssoEnabled && userId) {
      try {
        const filePath = path.join(DATA_DIR, 'projects', `${projectId}.json`);
        const proj = await fs.readJson(filePath);
        const isOwner = proj.ownerId === userId;
        const isShared = (proj.sharedWith || []).some(s => s.userId === userId);
        if (!isOwner && !isShared) return; // silently deny
      } catch { return; }
    }

    const roomKey = `doc:${projectId}:${docId}`;
    socket.join(roomKey);
    socket._rooms.add(roomKey);
    broadcastPresence(roomKey);
  });

  socket.on('leave-doc', ({ projectId, docId }) => {
    const roomKey = `doc:${projectId}:${docId}`;
    socket.leave(roomKey);
    socket._rooms.delete(roomKey);
    broadcastPresence(roomKey);
  });

  socket.on('doc-change', ({ projectId, docId, content }) => {
    const roomKey = `doc:${projectId}:${docId}`;
    socket.to(roomKey).emit('doc-updated', { projectId, docId, content, userId, userName });
  });

  socket.on('disconnect', () => {
    for (const roomKey of socket._rooms) {
      broadcastPresence(roomKey);
    }
    socket._rooms.clear();
  });
});

// ── STARTUP SCAN ────────────────────────────────────────────────────────────
async function startupScan() {
  const line = '─'.repeat(52);
  const config = await getConfig();
  console.log(line);
  console.log('  ScribeFlow  v1.7');
  console.log(line);
  console.log(`  Port           : ${PORT}`);
  console.log(`  Data directory : ${DATA_DIR}`);
  console.log(`  Auth           : ${config.ssoEnabled ? 'Multi-user SSO' : 'single-user (no login)'}`);
  console.log(`  Google creds   : ${process.env.GOOGLE_CLIENT_ID ? 'configured' : 'not set (SSO unavailable)'}`);

  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(PROJECTS_DIR);

  let files;
  try {
    files = (await fs.readdir(PROJECTS_DIR)).filter(f => f.endsWith('.json'));
  } catch (err) {
    console.error(`  [ERROR] Cannot read projects dir: ${err.message}`);
    files = [];
  }

  if (files.length === 0) {
    console.log('  Projects       : none found');
    console.log(line);
  } else {
    console.log(`  Projects found : ${files.length}`);
    console.log(line);

    let loaded = 0, repaired = 0, corrupted = 0;
    for (const file of files) {
      const filePath = path.join(PROJECTS_DIR, file);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        let project;
        try { project = JSON.parse(raw); }
        catch (parseErr) {
          console.warn(`  [WARN] Corrupt JSON: ${file}`);
          await fs.copy(filePath, filePath + '.bak').catch(() => {});
          corrupted++; continue;
        }

        let dirty = false;
        if (!project.id)        { project.id = path.basename(file, '.json'); dirty = true; }
        if (!project.title)     { project.title = 'Recovered Project'; dirty = true; }
        if (!project.documents || typeof project.documents !== 'object') { project.documents = {}; dirty = true; }
        if (!project.binder    || typeof project.binder    !== 'object') {
          project.binder = { id: 'root', title: 'Root', type: 'root', children: [
            { id: 'manuscript', title: 'Manuscript', type: 'folder', icon: 'book', expanded: true,  children: [] },
            { id: 'trash',      title: 'Trash',      type: 'trash',  icon: 'trash-2', expanded: false, children: [] }
          ]};
          dirty = true;
        }
        if (!project.settings  || typeof project.settings  !== 'object') { project.settings = {}; dirty = true; }
        if (!project.createdAt) { project.createdAt = new Date().toISOString(); dirty = true; }
        if (!project.updatedAt) { project.updatedAt = new Date().toISOString(); dirty = true; }
        // Ensure sharedWith exists
        if (!Array.isArray(project.sharedWith)) { project.sharedWith = []; dirty = true; }

        let wcFixed = 0;
        for (const doc of Object.values(project.documents)) {
          if (typeof doc.wordCount !== 'number') {
            doc.wordCount = doc.content
              ? doc.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w).length
              : 0;
            wcFixed++; dirty = true;
          }
        }

        if (dirty) {
          await fs.writeJson(filePath, project, { spaces: 2 });
          repaired++;
          console.log(`  [REPAIRED] "${project.title}"${wcFixed ? ` (+${wcFixed} wc)` : ''}`);
        } else {
          const wc  = Object.values(project.documents).reduce((s, d) => s + (d.wordCount || 0), 0);
          const dc  = Object.keys(project.documents).length;
          console.log(`  [OK]       "${project.title}" — ${dc} doc(s), ${wc.toLocaleString()} words`);
        }
        loaded++;
      } catch (err) {
        console.error(`  [ERROR] ${file}: ${err.message}`);
        corrupted++;
      }
    }
    console.log(line);
    console.log(`  Loaded: ${loaded}  |  Repaired: ${repaired}  |  Corrupt: ${corrupted}`);
  }

  const biblesIndex = path.join(__dirname, 'data', 'bibles', 'index.json');
  if (fs.existsSync(biblesIndex)) {
    try {
      const idx = JSON.parse(fs.readFileSync(biblesIndex, 'utf8'));
      console.log(`  Bible data     : ${idx.length} translation(s) ready`);
    } catch { console.log('  Bible data     : index unreadable'); }
  } else {
    console.log('  Bible data     : NOT FOUND — run scripts/fetch-bibles.js');
  }
  console.log(line);
}

// ── START ────────────────────────────────────────────────────────────────────
startupScan()
  .then(() => {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`  Listening on http://0.0.0.0:${PORT}`);
      console.log('─'.repeat(52));
    });
  })
  .catch(err => { console.error('Fatal startup error:', err); process.exit(1); });
