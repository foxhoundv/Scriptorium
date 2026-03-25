const express  = require('express');
const passport = require('passport');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs-extra');
const { getConfig, saveConfig } = require('../config');
const { getUser, saveUser } = require('../users');

// ── GET /auth/google ──────────────────────────────────────────────────────
router.get('/google', async (req, res, next) => {
  const config = await getConfig();
  if (!config.ssoEnabled && !config.setupMode) return res.redirect('/');
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// ── GET /auth/google/callback ─────────────────────────────────────────────
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?auth=failed' }),
  async (req, res) => {
    const config     = await getConfig();
    const gProfile   = req.user;          // raw Google profile from passport
    const userId     = gProfile.id;
    const now        = new Date().toISOString();

    // ── First-run admin setup ──────────────────────────────────────────────
    if (config.setupMode) {
      const adminUser = {
        id:          userId,
        googleId:    userId,
        name:        gProfile.displayName  || '',
        email:       gProfile.emails?.[0]?.value  || '',
        avatar:      gProfile.photos?.[0]?.value  || '',
        role:        'admin',
        status:      'active',
        createdAt:   now,
        approvedAt:  now,
        approvedBy:  'system'
      };
      await saveUser(adminUser);

      // Migrate all existing projects — admin owns them
      const projectsDir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'projects');
      try {
        const files = (await fs.readdir(projectsDir)).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const fp   = path.join(projectsDir, file);
            const proj = await fs.readJson(fp);
            if (!proj.ownerId) {
              proj.ownerId    = userId;
              proj.sharedWith = proj.sharedWith || [];
              await fs.writeJson(fp, proj, { spaces: 2 });
            }
          } catch {}
        }
      } catch {}

      await saveConfig({ setupMode: false, adminUserId: userId, ssoEnabled: true });

      // Deserialize minimal profile so session contains our flat user object
      req.session.save(() => res.redirect('/'));
      return;
    }

    // ── Regular sign-in ───────────────────────────────────────────────────
    let user = await getUser(userId);

    if (!user) {
      // New user: create record, status depends on requireApproval setting
      const requireApproval = config.requireApproval !== false;
      user = {
        id:          userId,
        googleId:    userId,
        name:        gProfile.displayName  || '',
        email:       gProfile.emails?.[0]?.value  || '',
        avatar:      gProfile.photos?.[0]?.value  || '',
        role:        'user',
        status:      requireApproval ? 'pending' : 'active',
        createdAt:   now,
        approvedAt:  requireApproval ? null : now,
        approvedBy:  requireApproval ? null : 'auto'
      };
    } else {
      // Refresh profile fields on every sign-in
      user.name       = gProfile.displayName  || user.name;
      user.email      = gProfile.emails?.[0]?.value  || user.email;
      user.avatar     = gProfile.photos?.[0]?.value  || user.avatar;
      user.lastSeenAt = now;
    }

    await saveUser(user);

    if (user.status === 'pending') return res.redirect('/?status=pending');
    res.redirect('/');
  }
);

// ── GET /auth/logout ──────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) console.error('Logout error:', err);
    req.session.destroy(() => res.redirect('/'));
  });
});

module.exports = router;
