const express = require('express');
const requireAuth = require('../middleware/auth');
const G = require('../lib/guide');

// The guide (docs/PHASE_3_ONBOARDING.md; lib/guide.js).
//
//   GET  /api/guide                    the beat to show, the elder, what is unlocked
//   POST /api/guide/advance { key, did? }   past a beat with nothing to do, or one the screen reports
//   POST /api/guide/check              has the town done what the beat asks?
//   POST /api/guide/skip               end the tour; every gift it would have given is given
//   POST /api/guide/replay             again from the start (Help)
//   POST /api/guide/finish { site_id? }     free "Finish now" while the tour runs (building time)
//   POST /api/guide/later { key }      a one-off line the first time something happens
//
// Which beat a player is on, when it is done and what is given are all here.
const router = express.Router();

function run(fn) {
  return async (req, res) => {
    try { res.json({ ok: true, guide: await fn(req.user.userId, req.body || {}) }); }
    catch (e) {
      if (e instanceof G.GuideError) return res.status(e.status).json({ error: e.message });
      console.error('[guide]', e);
      res.status(500).json({ error: 'That did not work. Try again.' });
    }
  };
}

router.get('/', requireAuth, run(u => G.view(u)));
router.post('/advance', requireAuth, run((u, b) => G.advance(u, String(b.key || ''), b.did == null ? null : String(b.did))));
router.post('/check', requireAuth, run(u => G.check(u)));
router.post('/skip', requireAuth, run(u => G.skip(u)));
router.post('/replay', requireAuth, run(u => G.replay(u)));
router.post('/finish', requireAuth, run((u, b) => G.finishNow(u, b.site_id)));
router.post('/later', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await G.later(req.user.userId, String((req.body || {}).key || ''))) }); }
  catch (e) {
    if (e instanceof G.GuideError) return res.status(e.status).json({ error: e.message });
    console.error('[guide] later', e);
    res.status(500).json({ error: 'That did not work. Try again.' });
  }
});

module.exports = router;
