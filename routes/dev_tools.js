// ══════════════════════════════════════════════════════════════════════════
//  GET /api/dev-tools — the Dev Tools panel's markup, for admins only
//  (docs/LAYOUT_SPEC.md §6). It used to be a static dev.html on the website,
//  which anyone could open; here a signed-in admin gets it, and everyone
//  else a 401 or 403. The frontend's js/dev-tools.js adds it to the game.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');

const router = express.Router();
const FILE = path.join(__dirname, '..', 'admin', 'dev-tools.html');
let cached = null;

router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    if (!cached || process.env.NODE_ENV !== 'production') cached = fs.readFileSync(FILE, 'utf8');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(cached);
  } catch (e) {
    console.error('[dev-tools]', e.message);
    res.status(500).json({ error: 'Dev Tools are missing on the server.' });
  }
});

module.exports = router;
