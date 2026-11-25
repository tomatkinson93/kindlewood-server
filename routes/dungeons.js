// ══════════════════════════════════════════════════════════════════════════
//  /api/dungeons — a party's run through a dungeon (lib/dungeons.js,
//  docs/DUNGEONS.md §9.3). The server holds all state: the client never
//  decides what is in a room.
//
//    GET  /               the dungeons on the map this player has found (lib/dungeon_map.js)
//    GET  /:id            one of them: its card
//    POST /:id/enter      { citizen_ids: [×4] }  send a party in; the run begins at the door
//    GET  /run            the town's unfinished run, or the last finished one
//    POST /run/move       { room }    enter a connected room
//    POST /run/choose     { option }  answer a rest room or a landing ('rest', 'deeper')
//    POST /run/leave      turn back (between rooms): keep everything
//    POST /run/flee       leave a fight: the run ends, half the loot is kept
//
//  While the switch `dungeons.on` is off, only admins may use these.
//
//  Admins (Dev Tools → Dungeons):
//    GET  /admin/status          the switch, the test dungeons, free adults
//    POST /admin/switch          { on }
//    POST /admin/test            { story, citizen_ids? }  start a test dungeon (fought on the board)
//    POST /admin/generate        { tier, terrain, seed?, citizen_ids? }  generate a dungeon and start it (on the board)
//                                (every fight is a battle on the board: docs/TACTICS.md)
//    POST /admin/sweep           { idle_run? } end idle runs now (optionally age this town's run first)
//    POST /admin/heal            the party back to full health, everyone up
//    POST /admin/win             win the open fight outright (to walk a path quickly)
//    POST /admin/map             { expire? }  put dungeons on the map now (first sending every one away, with expire)
//
//  Fights are battles on the board, played through /api/tactics (battles/:id/act).
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { query } = require('../db');
const D = require('../lib/dungeons');
const TU = require('../lib/tuning');

const router = express.Router();
const fail = (res, e) => { if (!e.status) console.error('[dungeons]', e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong in the dungeon.' }); };
const gate = async (req, res, next) => {
  try { if (await D.allowed(req.user)) return next(); res.status(403).json({ error: 'Dungeons are not open yet.' }); }
  catch (e) { fail(res, e); }
};

// ── Dungeons on the map (docs/DUNGEONS.md §6) ──
const M = require('../lib/dungeon_map');
router.get('/', requireAuth, gate, async (req, res) => {
  try { res.json({ ok: true, ...(await M.listFor(req.user.userId)) }); } catch (e) { fail(res, e); }
});
router.get('/:id(\\d+)', requireAuth, gate, async (req, res) => {
  try { res.json({ ok: true, ...(await M.card(req.user.userId, req.params.id)) }); } catch (e) { fail(res, e); }
});
router.post('/:id(\\d+)/enter', requireAuth, gate, async (req, res) => {
  try { res.json({ ok: true, ...(await M.enter(req.user.userId, req.params.id, (req.body || {}).citizen_ids)) }); } catch (e) { fail(res, e); }
});
router.post('/admin/map', requireAuth, requireAdmin, async (req, res) => {
  try {
    const gone = (req.body || {}).expire ? await M.expireAll() : 0;
    const made = await M.spawn();
    res.json({ ok: true, gone, made, told: await M.tell(), live: (await M.live()).length });
  } catch (e) { fail(res, e); }
});

router.get('/run', requireAuth, async (req, res) => {
  try {
    const on = await D.allowed(req.user);
    if (!on) return res.json({ ok: true, on: false, run: null, last: null });
    res.json({ ok: true, on: true, ...(await D.current(req.user.userId)) });
  } catch (e) { fail(res, e); }
});
router.post('/run/move', requireAuth, gate, async (req, res) => {
  try { res.json({ ok: true, ...(await D.move(req.user.userId, (req.body || {}).room)) }); } catch (e) { fail(res, e); }
});
router.post('/run/choose', requireAuth, gate, async (req, res) => {
  try { res.json({ ok: true, ...(await D.choose(req.user.userId, (req.body || {}).option)) }); } catch (e) { fail(res, e); }
});
router.post('/run/leave', requireAuth, gate, async (req, res) => {
  try { res.json({ ok: true, ...(await D.leave(req.user.userId)) }); } catch (e) { fail(res, e); }
});
router.post('/run/flee', requireAuth, gate, async (req, res) => {
  try { res.json({ ok: true, ...(await D.flee(req.user.userId)) }); } catch (e) { fail(res, e); }
});

// ── Dev Tools ───────────────────────────────────────────────────────────────
router.get('/admin/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = (await query('SELECT * FROM settlements WHERE user_id=$1', [req.user.userId])).rows[0];
    const DEFS = require('../lib/dungeon_defs');
    res.json({
      ok: true, on: await TU.switchOn('dungeons.on'), stories: D.stories(), free_adults: s ? (await D.freeAdults(s)).length : 0, party: D.PARTY,
      tiers: DEFS.TIER_ORDER.map(k => ({ key: k, name: DEFS.TIERS[k].name, skull: DEFS.TIERS[k].skull })), lands: require('../lib/dungeon_gen').LANDS,
      map: { live: (await M.live()).length },
      ...(await D.current(req.user.userId)),
    });
  } catch (e) { fail(res, e); }
});
router.post('/admin/switch', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, on: await TU.setSwitch('dungeons.on', !!(req.body || {}).on) }); } catch (e) { fail(res, e); }
});
router.post('/admin/test', requireAuth, requireAdmin, async (req, res) => {
  // Every dungeon is fought on the board now (docs/TACTICS.md §8): a run with cards can no longer be started from the game.
  try { const b = req.body || {}; res.json({ ok: true, ...(await D.startTest(req.user.userId, b.story, b.citizen_ids)) }); } catch (e) { fail(res, e); }
});
router.post('/admin/generate', requireAuth, requireAdmin, async (req, res) => {
  try { const b = req.body || {}; res.json({ ok: true, ...(await D.startGenerated(req.user.userId, { tier: b.tier, terrain: b.terrain, seed: b.seed }, b.citizen_ids)) }); } catch (e) { fail(res, e); }
});
router.post('/admin/sweep', requireAuth, requireAdmin, async (req, res) => {
  try {
    if ((req.body || {}).idle_run) {
      await query(`UPDATE dungeon_runs SET last_action_at = NOW() - make_interval(hours => $2)
                    WHERE status='active' AND settlement_id = (SELECT id FROM settlements WHERE user_id=$1)`, [req.user.userId, D.CONFIG.IDLE_HOURS + 1]);
    }
    res.json({ ok: true, ended: await D.sweep(), ...(await D.current(req.user.userId)) });
  } catch (e) { fail(res, e); }
});
router.post('/admin/heal', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = (await query(`SELECT id, party_state FROM dungeon_runs WHERE status='active' AND settlement_id = (SELECT id FROM settlements WHERE user_id=$1)`, [req.user.userId])).rows[0];
    if (!r) return res.status(404).json({ error: 'No party of yours is in a dungeon.' });
    const state = r.party_state || {};
    for (const k of Object.keys(state)) state[k] = { ...state[k], hp: state[k].max, down: false };
    await query('UPDATE dungeon_runs SET party_state=$2 WHERE id=$1', [r.id, JSON.stringify(state)]);
    res.json({ ok: true, ...(await D.current(req.user.userId)) });
  } catch (e) { fail(res, e); }
});
router.post('/admin/win', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await D.adminWin(req.user.userId)) }); } catch (e) { fail(res, e); }
});

module.exports = router;
