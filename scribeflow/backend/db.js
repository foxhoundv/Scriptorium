const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs-extra');

let _db = null;

// ── Initialize ─────────────────────────────────────────────────────────────
function initDb(dataDir) {
  fs.ensureDirSync(dataDir);
  const dbPath = path.join(dataDir, 'scribeflow.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL DEFAULT '',
      role          TEXT NOT NULL DEFAULT 'user',
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    TEXT NOT NULL,
      last_seen_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT,
      title      TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return _db;
}

function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

// ── Project helpers ────────────────────────────────────────────────────────
function getProject(id) {
  const row = getDb().prepare('SELECT data FROM projects WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

function saveProject(project) {
  getDb().prepare(`
    INSERT INTO projects (id, owner_id, title, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner_id   = excluded.owner_id,
      title      = excluded.title,
      data       = excluded.data,
      updated_at = excluded.updated_at
  `).run(
    project.id,
    project.ownerId   || null,
    project.title     || 'Untitled',
    JSON.stringify(project),
    project.createdAt || new Date().toISOString(),
    project.updatedAt || new Date().toISOString()
  );
}

function deleteProject(id) {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

function getAllProjects() {
  return getDb()
    .prepare('SELECT data FROM projects ORDER BY updated_at DESC')
    .all()
    .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
    .filter(Boolean);
}

// ── Migrate existing JSON project files into SQLite (one-time) ─────────────
function migrateProjects(dataDir) {
  const projectsDir = path.join(dataDir, 'projects');
  if (!fs.existsSync(projectsDir)) return 0;

  const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'));
  if (!files.length) return 0;

  const db          = getDb();
  const existingIds = new Set(db.prepare('SELECT id FROM projects').all().map(r => r.id));

  const insert = db.prepare(`
    INSERT OR IGNORE INTO projects (id, owner_id, title, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  const runAll = db.transaction(() => {
    for (const file of files) {
      try {
        const raw  = fs.readFileSync(path.join(projectsDir, file), 'utf8');
        const proj = JSON.parse(raw);
        if (!proj.id || existingIds.has(proj.id)) continue;
        // Repair minimal required fields
        if (!proj.documents || typeof proj.documents !== 'object') proj.documents = {};
        if (!proj.sharedWith) proj.sharedWith = [];
        if (!proj.createdAt) proj.createdAt = new Date().toISOString();
        if (!proj.updatedAt) proj.updatedAt = new Date().toISOString();
        insert.run(
          proj.id,
          proj.ownerId   || null,
          proj.title     || 'Recovered Project',
          JSON.stringify(proj),
          proj.createdAt,
          proj.updatedAt
        );
        migrated++;
      } catch {}
    }
  });
  runAll();
  return migrated;
}

module.exports = { initDb, getDb, getProject, saveProject, deleteProject, getAllProjects, migrateProjects };
