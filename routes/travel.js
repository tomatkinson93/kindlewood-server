// /api/travel — citizen journeys for the world map's travel path layer.
const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const travel = require('../lib/travel');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const me = (await query(
      'SELECT s.*, u.species FROM settlements s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1',
      [req.user.userId])).rows[0];
    if (!me) return res.status(404).json({ error: 'No settlement.' });
    // Advance due caravans first so a just-arrived merchant isn't drawn.
    await require('../lib/market').resolveDue(me.id).catch(() => {});
    res.json({ ok: true, now: new Date().toISOString(), journeys: await travel.journeysFor(me, me.species) });
  } catch (e) {
    console.error('[travel]', e);
    res.status(500).json({ error: 'Could not load journeys.' });
  }
});

module.exports = router;
