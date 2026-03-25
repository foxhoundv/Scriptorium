const express  = require('express');
const router   = express.Router();
const { getUserByUsername, verifyPassword, updateUser } = require('../users');

// ── POST /auth/login ───────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = getUserByUsername(username);
  if (!user || !(await verifyPassword(user, password))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Your account has been suspended. Contact the administrator.' });
  }

  req.session.userId = user.id;
  updateUser(user.id, { last_seen_at: new Date().toISOString() });

  res.json({
    success: true,
    user: {
      id:          user.id,
      username:    user.username,
      displayName: user.display_name,
      role:        user.role
    }
  });
});

// ── GET /auth/logout ───────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
