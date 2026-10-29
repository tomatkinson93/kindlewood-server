/**
 * routes/feedback.js  (server)
 *
 * Deploys to: routes/feedback.js
 * Register in index.js:
 *     const feedbackRoutes = require('./routes/feedback');
 *     app.use('/api/feedback', feedbackRoutes);
 *
 * User-submitted bug reports & suggestions. Anyone signed in can submit and
 * see their own reports; admins (ADMIN_USER_IDS, middleware/admin) see all of
 * them and can resolve or delete them.
 */
const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { isAdminUser } = require('../middleware/admin');
const router = express.Router();

async function isAdmin(req) {
  return isAdminUser(req.user);
}

// ── POST /api/feedback — submit a bug/suggestion ──
router.post('/', requireAuth, async (req, res) => {
  try {
    const d = req.body || {};
    const title = (d.title || '').trim();
    if (!title) return res.status(400).json({ error: 'A short title is required.' });
    const kind = d.kind === 'suggestion' ? 'suggestion' : 'bug';
    let name = null;
    try {
      const u = await query('SELECT username FROM users WHERE id=$1', [req.user.userId]);
      name = u.rows[0] ? u.rows[0].username : null;
    } catch (e) { /* username column may differ; non-fatal */ }
    await query(
      `INSERT INTO bug_reports (user_id, reporter_name, kind, title, body, page_context)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.userId, name, kind, title.slice(0, 200), (d.body || '').slice(0, 4000), (d.page_context || '').slice(0, 200)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/feedback — list reports (players: their own) ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const admin = await isAdmin(req);
    const r = admin
      ? await query('SELECT * FROM bug_reports ORDER BY created_at DESC LIMIT 500')
      : await query('SELECT * FROM bug_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.userId]);
    res.json({ ok: true, reports: r.rows, admin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/feedback/:id — toggle status (open/resolved) ──
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Not permitted.' });
    const status = req.body && req.body.status === 'resolved' ? 'resolved' : 'open';
    await query('UPDATE bug_reports SET status=$1 WHERE id=$2', [status, parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/feedback/:id ──
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Not permitted.' });
    await query('DELETE FROM bug_reports WHERE id=$1', [parseInt(req.params.id, 10)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
