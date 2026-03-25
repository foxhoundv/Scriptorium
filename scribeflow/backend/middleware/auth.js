const { getUser } = require('../users');

const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

/**
 * Auth guard middleware.
 *
 * Single-user mode (AUTH_ENABLED != 'true'):
 *   req.userId = null, req.userRole = 'admin' — full access, no login required.
 *
 * Multi-user mode (AUTH_ENABLED = 'true'):
 *   Requires a valid session (set by POST /auth/login).
 *   Suspended accounts receive 403.
 */
module.exports = function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) {
    req.userId   = null;
    req.userRole = 'admin';
    return next();
  }

  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required', authEnabled: true });
  }

  const user = getUser(userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Session invalid', authEnabled: true });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Account suspended', code: 'suspended' });
  }

  req.userId   = user.id;
  req.userRole = user.role;
  next();
};
