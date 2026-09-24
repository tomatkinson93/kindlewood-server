// Admin gate for destructive world operations. Mount after requireAuth.
// Admins are listed by user id in ADMIN_USER_IDS (comma separated). When the
// variable is unset nobody is an admin, so the guarded routes fail closed.
function adminIds() {
  return (process.env.ADMIN_USER_IDS || '')
    .split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
}

function isAdminUser(user) {
  return !!user && adminIds().includes(Number(user.userId));
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Admins only.' });
  next();
}

module.exports = { requireAdmin, isAdminUser };
