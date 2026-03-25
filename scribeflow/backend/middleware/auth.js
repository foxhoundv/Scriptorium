const { getConfig } = require('../config');
const { getUser }   = require('../users');

/**
 * Auth guard middleware.
 *
 * Single-user mode (ssoEnabled=false, default):
 *   req.userId = null, req.userRole = 'admin' — full access, no login required.
 *
 * Multi-user mode (ssoEnabled=true):
 *   Requires an active Google SSO session.
 *   - pending  → 403 { code: 'pending'   } — awaiting admin approval
 *   - suspended→ 403 { code: 'suspended' } — account suspended
 *   - active   → sets req.userId + req.userRole, proceeds
 */
module.exports = async function requireAuth(req, res, next) {
  const config = await getConfig();

  if (!config.ssoEnabled) {
    req.userId   = null;
    req.userRole = 'admin';
    return next();
  }

  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required', authEnabled: true });
  }

  const user = await getUser(req.user.id);

  if (!user) {
    return res.status(403).json({ error: 'User not registered', code: 'not_found' });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Awaiting admin approval', code: 'pending' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Account suspended', code: 'suspended' });
  }

  req.userId   = user.id;
  req.userRole = user.role;
  next();
};
