const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../lib/jwt_secret');

module.exports = function requireAuth(req, res, next) {
  // Bearer token only. The sign-in cookie is not read: with SameSite=None it
  // let other websites act as a signed-in player (SECURITY_REVIEW.md S2).
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired.' });
  }
};
