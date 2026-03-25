const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs-extra');
const http     = require('http');
const { Server: SocketIO } = require('socket.io');
const session  = require('express-session');
const FileStore = require('session-file-store')(session);

const { initDb, migrateProjects } = require('./db');
const { adminCount, createUser, getUser } = require('./users');

const projectsRouter  = require('./routes/projects');
const documentsRouter = require('./routes/documents');
const exportRouter    = require('./routes/export');
const bibleRouter     = require('./routes/bible');
const adminRouter     = require('./routes/admin');
const shareRouter     = require('./routes/share');
const authRouter      = require('./routes/auth');
const requireAuth     = require('./middleware/auth');

const app  = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'frontend', 'views'));

const PORT        = process.env.PORT     || 3051;
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

// ── HTTP server (required for socket.io) ────────────────────────────────────
const httpServer = http.createServer(app);
const io         = new SocketIO(httpServer);

// ── Session ──────────────────────────────────────────────────────────────────
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

// Share session with socket.io
io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

// ── Core middleware ──────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// ── /api/me — returns auth state + current user ───────────────────────────
app.get('/api/me', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ authEnabled: false });

  const userId = req.session?.userId;
  if (!userId)  return res.json({ authEnabled: true, user: null });

  const user = getUser(userId);
  if (!user)    return res.json({ authEnabled: true, user: null });

  if (user.status === 'suspended') {
    return res.json({
      authEnabled: true,
      user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role, status: 'suspended' }
    });
  }

  res.json({
    authEnabled: true,
    user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role, status: user.status }
  });
});

// ── Auth routes ──────────────────────────────────────────────────────────────
app.use('/auth', authRouter);

// ── API routes (behind auth guard) ───────────────────────────────────────────
app.use('/api/projects',  requireAuth, projectsRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/export',    requireAuth, exportRouter);
app.use('/api/bible',     bibleRouter);          // public read-only
app.use('/api/admin',     requireAuth, adminRouter);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const { getAllProjects } = require('./db');
  try {
    const count = getAllProjects().length;
    res.json({ status: 'ok', version: '2.2.0', name: 'ScribeFlow', projects: count, dataDir: DATA_DIR, authEnabled: AUTH_ENABLED });
  } catch {
    res.json({ status: 'ok', version: '2.2.0', name: 'ScribeFlow', projects: 0, dataDir: DATA_DIR, authEnabled: AUTH_ENABLED });
  }
});

// ── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.render('index'));

// ── Socket.io: real-time collaboration ───────────────────────────────────────
io.on('connection', (socket) => {
  const userId   = socket.request.session?.userId || null;
  let   userName = 'Guest';
  if (userId) {
    try {
      const u = getUser(userId);
      if (u) userName = u.display_name || u.username;
    } catch {}
  }

  socket._userId   = userId;
  socket._userName = userName;
  socket._rooms    = new Set();

  function broadcastPresence(roomKey) {
    const room     = io.sockets.adapter.rooms.get(roomKey);
    const presence = {};
    if (room) {
      for (const sid of room) {
        const s = io.sockets.sockets.get(sid);
        if (s) presence[sid] = { userId: s._userId, name: s._userName };
      }
    }
    io.to(roomKey).emit('presence-update', { users: presence });
  }

  socket.on('join-doc', ({ projectId, docId }) => {
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
    for (const roomKey of socket._rooms) broadcastPresence(roomKey);
    socket._rooms.clear();
  });
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function startup() {
  const line = '─'.repeat(52);

  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(path.join(DATA_DIR, 'projects'));

  // Initialize SQLite
  initDb(DATA_DIR);

  // Migrate any legacy JSON project files
  const migrated = migrateProjects(DATA_DIR);

  // Ensure admin account exists in multi-user mode
  if (AUTH_ENABLED && adminCount() === 0) {
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin';
    await createUser({ username: adminUser, password: adminPass, displayName: 'Administrator', role: 'admin' });
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('  [WARN] No ADMIN_PASSWORD set — default password "admin" used. Change it immediately!');
    }
  }

  // Scan projects for startup log
  const { getAllProjects } = require('./db');
  const projects = getAllProjects();

  console.log(line);
  console.log('  ScribeFlow  v2.2');
  console.log(line);
  console.log(`  Port           : ${PORT}`);
  console.log(`  Data directory : ${DATA_DIR}`);
  console.log(`  Auth           : ${AUTH_ENABLED ? 'Multi-user (local accounts)' : 'single-user (no login required)'}`);
  if (migrated > 0) console.log(`  Migrated       : ${migrated} project(s) from JSON files → SQLite`);

  if (projects.length === 0) {
    console.log('  Projects       : none found');
  } else {
    console.log(`  Projects found : ${projects.length}`);
    console.log(line);
    for (const p of projects) {
      const wc = Object.values(p.documents || {}).reduce((s, d) => s + (d.wordCount || 0), 0);
      const dc = Object.keys(p.documents || {}).length;
      console.log(`  [OK]       "${p.title}" — ${dc} doc(s), ${wc.toLocaleString()} words`);
    }
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

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`  Listening on http://0.0.0.0:${PORT}`);
    console.log(line);
  });
}

startup().catch(err => { console.error('Fatal startup error:', err); process.exit(1); });
