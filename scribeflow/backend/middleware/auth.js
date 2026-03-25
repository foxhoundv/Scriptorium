const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

/**
 * Auth guard middleware.
 *
 * When AUTH_ENABLED=false (default): sets req.userId = null and proceeds.
 * Data is stored in the flat DATA_DIR/projects/ directory — fully backward
 * compatible with single-user deployments.
 *
 * When AUTH_ENABLED=true: requires a valid Google SSO session.
 * Sets req.userId = Google profile ID; data goes in DATA_DIR/projects/{userId}/.
 * Returns 401 JSON for unauthenticated API requests.
 */
module.exports = function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) {
    req.userId = null;
    return next();
  }

  if (req.isAuthenticated && req.isAuthenticated()) {
    req.userId = req.user.id;
    return next();
  }

  res.status(401).json({ error: 'Authentication required', authEnabled: true });
};
