const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

module.exports = function requireAuth(req, res, next) {
  const cookieToken = req.cookies?.token || null;
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

  const token = cookieToken || bearerToken;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired.' });
  }
};