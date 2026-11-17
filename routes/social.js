const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { gameplayNow } = require('../lib/server_clock');
const S = require('../lib/social');

// Talk to… and Praise (docs/HOME_SCENE.md Part F; lib/social.js). The roll
// and both daily limits are here on the server, so a second device shows the
// same town and gains nothing.
const router = express.Router();

async function settlementOf(req) {
  return (await query('SELECT id FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0] || null;
}
function run(fn, withState = true) {
  return async (req, res) => {
    try {
      const s = await settlementOf(req);
      if (!s) return res.status(404).json({ error: 'No settlement.' });
      const now = gameplayNow(req.user);
      const out = await fn(s, req, now);
      res.json({ ok: true, ...(out || {}), ...(withState ? { social: await S.state(s.id, now) } : {}) });
    } catch (e) {
      if (e instanceof S.SocialError) return res.status(e.status).json({ error: e.message });
      // Two devices at the same moment: the table's own once-a-day rule answers.
      if (e && e.code === '23505') return res.status(409).json({ error: 'That has been done today. Try again tomorrow morning.' });
      console.error('[social]', e);
      res.status(500).json({ error: 'That did not work. Try again.' });
    }
  };
}

// GET /api/social — today: who has had their chat, who has been praised, how
// much praise is left, and what the player has learned of each villager.
router.get('/', requireAuth, run(async (s, req, now) => S.state(s.id, now), false));

// GET /api/social/bonds/:id — that villager's bond with everyone else.
router.get('/bonds/:id', requireAuth, run(async (s, req) => ({ bonds: await S.bonds(s.id, req.params.id) }), false));

// POST /api/social/talk { speaker_id, listener_id, topic } — topic null or
// missing: anything (the server picks).
router.post('/talk', requireAuth, run(async (s, req, now) => {
  const b = req.body || {};
  const topic = b.topic == null || b.topic === '' || b.topic === 'anything' ? null : String(b.topic);
  return { chat: await S.talk(s.id, b.speaker_id, b.listener_id, topic, now) };
}));

// POST /api/social/praise { citizen_id }
router.post('/praise', requireAuth, run(async (s, req, now) => ({ praise: await S.praise(s.id, (req.body || {}).citizen_id, now) })));

module.exports = router;
