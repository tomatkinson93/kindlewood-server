// ══════════════════════════════════════════════════════════════════════════
//  FISHING ROUTES — server-authoritative catches (mounted at /api/fishing).
//
//  GET  /pool   season + in-season fish + the junk list (display only).
//  POST /cast   { ripple }      → the server rolls the catch and bite delay
//                                 and holds it as the player's one pending
//                                 catch. Reply: { catchId, biteDelayMs, catch }.
//  POST /land   { catchId, outcome: 'caught'|'lost' }
//                               → timing checked (lib/fishing.landCheck); a
//                                 landed fish is granted from the server's
//                                 table (lib/inventory.grantItem). Junk is
//                                 logged by the client only, as before.
//
//  Pending catches + cast stamps live in memory per user (a restart loses at
//  most one catch on the line). The ripple flag is the client's claim; it
//  only moves the junk chance between 7% and 3%.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const F = require('../lib/fishing');
const { grantItem } = require('../lib/inventory');
const { wallNow, gameplayNow } = require('../lib/server_clock');
const happenings = require('../lib/happenings');
const HFX = require('../lib/happening_effects');
const { seasonAt } = require('../seasons');

const router = express.Router();

const _pending = new Map();   // userId → { catchId, kind, fish, castAt, biteAt }
const _stamps = new Map();    // userId → recent cast times (rate limit)
let _rng = Math.random;

const uid = (req) => Number(req.user.userId);

router.get('/pool', requireAuth, (req, res) => {
  const now = wallNow();
  const season = seasonAt(now);
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    season: { id: season.id, name: season.name, emoji: season.emoji },
    fish: F.poolAt(now, season.id).map(f => ({ id: f.id, name: f.name, icon: f.icon, rarity: f.rarity })),
    catalogue: F.FISH_TABLE.map(f => ({ id: f.id, name: f.name, icon: f.icon, rarity: f.rarity }))
      .concat(F.JUNK_TABLE.map(j => ({ id: j.id, name: j.name, icon: j.icon, rarity: 'junk' }))),
  });
});

router.post('/cast', requireAuth, async (req, res) => {
  const now = wallNow();
  const id = uid(req);
  let stamps = _stamps.get(id);
  if (!stamps) { stamps = []; _stamps.set(id, stamps); }
  const lim = F.castAllowed(stamps, now);
  if (!lim.ok) return res.status(429).json({ error: 'The fish need a moment — try again shortly.', retryMs: lim.retryMs });

  const season = seasonAt(now);
  // Happening rare_fish / junk_catch at this player's gameplay clock.
  const mods = HFX.modifiersAt(await happenings.loadLive(), gameplayNow(req.user));
  const c = F.rollCatch(_rng, now, season.id, !!(req.body && req.body.ripple), mods);
  const p = { catchId: crypto.randomUUID(), kind: c.kind, fish: c.fish, castAt: now, biteAt: now + c.biteDelayMs };
  _pending.set(id, p);                     // a new cast replaces any catch still on the line
  res.json({ ok: true, catchId: p.catchId, biteDelayMs: c.biteDelayMs, catch: F.publicCatch(c) });
});

router.post('/land', requireAuth, async (req, res) => {
  const now = wallNow();
  const id = uid(req);
  const { catchId, outcome } = req.body || {};
  const p = _pending.get(id);
  if (!p || p.catchId !== catchId) return res.status(409).json({ error: 'No catch on the line.' });
  const verdict = F.landCheck(p, now, outcome === 'lost' ? 'lost' : 'caught');
  if (!verdict.ok) {
    if (now > p.castAt + F.PENDING_TTL_MS) _pending.delete(id);
    return res.status(409).json({ error: verdict.error });
  }
  _pending.delete(id);                     // consumed before granting: one catch, one item
  if (outcome === 'lost' || p.kind === 'junk') return res.json({ ok: true, granted: null, catch: F.publicCatch(p) });

  try {
    const sett = (await query('SELECT id FROM settlements WHERE user_id=$1', [id])).rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });
    const item = F.itemFor(p.fish);
    const r = await grantItem(query, sett.id, item);
    // Logged for the Biggest Fish / Most Fish rankings (lib/rankings.js).
    await require('../lib/rankings').recordCatch(id, p.fish).catch(e => console.error('[fishing] catch log failed', e.message));
    res.json({ ok: true, granted: { item_key: item.item_key, name: item.name, quantity: r.quantity }, catch: F.publicCatch(p) });
  } catch (e) {
    console.error('[fishing] land failed', e.message);
    res.status(500).json({ error: 'The catch slipped away (server error).' });
  }
});

// Test seams.
router._setRngForTest = (fn) => { _rng = typeof fn === 'function' ? fn : Math.random; };
router._resetForTest = () => { _pending.clear(); _stamps.clear(); _rng = Math.random; };

module.exports = router;
