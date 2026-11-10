// /api/funnel — where new players stop (admins only; lib/milestones).
//   GET /api/funnel?days=30
'use strict';
const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/milestones').funnel(req.query.days)) }); }
  catch (e) { console.error('[funnel]', e); res.status(500).json({ error: 'Could not load the funnel.' }); }
});

module.exports = router;
