const bcrypt     = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb }  = require('./db');

// ── Queries ────────────────────────────────────────────────────────────────
function getUser(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) || null;
}

function getAllUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all();
}

function adminCount() {
  return getDb().prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'").get().n;
}

// ── Mutations ──────────────────────────────────────────────────────────────
async function createUser({ username, password, displayName, role = 'user' }) {
  const id   = uuidv4();
  const hash = await bcrypt.hash(password, 12);
  const now  = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run(id, username.trim(), hash, (displayName || username).trim(), role, now);
  return getUser(id);
}

async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password_hash);
}

async function setPassword(userId, password) {
  const hash = await bcrypt.hash(password, 12);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

function updateUser(id, fields) {
  const allowed = { display_name: true, role: true, status: true, last_seen_at: true };
  const entries = Object.entries(fields).filter(([k]) => allowed[k]);
  if (!entries.length) return;
  const sql = `UPDATE users SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`;
  getDb().prepare(sql).run(...entries.map(([, v]) => v), id);
}

function deleteUser(id) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = {
  getUser, getUserByUsername, getAllUsers, adminCount,
  createUser, verifyPassword, setPassword, updateUser, deleteUser
};
