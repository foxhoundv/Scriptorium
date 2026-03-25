const fs   = require('fs-extra');
const path = require('path');

function usersDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'users');
}

async function getUser(userId) {
  try {
    return await fs.readJson(path.join(usersDir(), `${userId}.json`));
  } catch {
    return null;
  }
}

async function saveUser(user) {
  await fs.ensureDir(usersDir());
  await fs.writeJson(path.join(usersDir(), `${user.id}.json`), user, { spaces: 2 });
  return user;
}

async function getAllUsers() {
  try {
    await fs.ensureDir(usersDir());
    const files = (await fs.readdir(usersDir())).filter(f => f.endsWith('.json'));
    const users = [];
    for (const file of files) {
      try { users.push(await fs.readJson(path.join(usersDir(), file))); } catch {}
    }
    return users.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } catch { return []; }
}

async function getUserByEmail(email) {
  const all = await getAllUsers();
  return all.find(u => u.email === email) || null;
}

async function deleteUser(userId) {
  await fs.remove(path.join(usersDir(), `${userId}.json`));
}

module.exports = { getUser, saveUser, getAllUsers, getUserByEmail, deleteUser };
