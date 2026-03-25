const express  = require('express');
const passport = require('passport');
const router   = express.Router();

// GET /auth/google  — redirect to Google consent screen
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// GET /auth/google/callback  — Google redirects here after consent
router.get('/google/callback',
  passport.authenticate('google', {
    successRedirect: '/',
    failureRedirect: '/?auth=failed'
  })
);

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) console.error('Logout error:', err);
    req.session.destroy(() => res.redirect('/'));
  });
});

module.exports = router;
