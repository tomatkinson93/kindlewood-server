// Server time API (spec 021 §2.2). Mounted by routes/game.js under /api/game:
//   GET  /time        no auth, no-store — wall clock + phase/sun/moon/season
//   GET  /time/me     auth — the above + this user's gameplay clock
//   POST /time/debug  auth + admin — set/clear this admin's gameplay offset
// Kept in its own module (no DB) so scripts/daycycle_test.js can drive it.
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin, isAdminUser } = require('../middleware/admin');
const clock = require('../lib/server_clock');
const D = require('../lib/day_cycle');
const { seasonAt } = require('../seasons');

function timePayload(now) {
  const s = seasonAt(now);
  return {
    now,
    tz: 'UTC',
    phase: D.phaseAt(now),
    sun: D.sunAt(now),
    moon: D.moonAt(now),
    season: { id: s.id, index: s.index, progress: s.progress, msRemaining: s.msRemaining, year: s.year },
  };
}

function mePayload(user) {
  const now = clock.wallNow();
  const admin = isAdminUser(user);
  const off = admin ? clock.getDebugOffset(user.userId) : 0;
  const gp = now + off;
  return Object.assign(timePayload(now), {
    isAdmin: admin,   // lets the client reconcile its visual override
    gameplayNow: gp,
    debugOffsetMs: off,
    debugExpiresAt: admin ? clock.getDebugExpiry(user.userId) : null,
    gameplay: { phase: D.phaseAt(gp), moon: D.moonAt(gp) },
  });
}

const router = express.Router();

router.get('/time', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(timePayload(clock.wallNow()));
});

router.get('/time/me', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(mePayload(req.user));
});

router.post('/time/debug', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  const uid = req.user.userId;
  res.set('Cache-Control', 'no-store');
  if (b.clear) {
    clock.clearDebugOffset(uid);
    return res.json(mePayload(req.user));
  }
  let r;
  if (b.offsetMs != null) {
    if (!Number.isFinite(Number(b.offsetMs))) return res.status(400).json({ error: 'offsetMs must be a number.' });
    r = { offsetMs: Number(b.offsetMs) };
  } else if (b.phase != null) {
    if (!D.PHASE_IDS.includes(b.phase)) return res.status(400).json({ error: 'phase must be dawn, day, dusk or night.' });
    r = { phase: b.phase };
  } else if (b.moon != null) {
    const m = Number(b.moon);
    if (!Number.isInteger(m) || m < 0 || m > 7) return res.status(400).json({ error: 'moon must be 0–7.' });
    r = { moon: m };
  } else {
    return res.status(400).json({ error: 'Send one of offsetMs, phase, moon, or clear.' });
  }
  const off = D.overrideOffset(r, clock.wallNow(), clock.getDebugOffset(uid));
  clock.setDebugOffset(uid, off);
  res.json(mePayload(req.user));
});

module.exports = router;
module.exports.timePayload = timePayload;
