// ══════════════════════════════════════════════════════════════════════════
//  /api/tactics — battles on the board (docs/TACTICS.md). The browser shows
//  the battle; the server keeps it and checks every choice with the same
//  rules (lib/tactics_battles.js).
//
//    GET  /admin/options   the classes, levels, skulls and lands for a practice battle (admins, Dev Tools)
//    POST /admin/setup     { classes: [×4], level, tier, terrain, seed, fight, band?, citizen_ids? }
//                          → { seed, land, tier, name, party, enemies }
//    POST /battles             a practice battle the server keeps (admins): { battle: { id, setup, actions, check } }
//    GET  /battles/current     the town's open dungeon or practice battle, or null (to pick it up after a reload)
//    GET  /battles/:id
//    POST /battles/:id/act     { n, action }  the player's n-th choice; refused if the rules do not allow it
//    POST /battles/:id/leave
//    GET  /open                where the board is open to this player
//    POST /quest/:questRunId   a quest's battle (lib/tactics_quests.js): every player's
//    GET  /abilities/:id, POST /abilities/:id/second   what a citizen knows and brings (lib/tactics_abilities.js)
//    GET  /study/:id, POST /study/:id { lesson }, POST /study/:id/cancel, POST /study/:id/passive { key }
//                              study at a class building, and the passive slot (lib/tactics_study.js)
//    POST /admin/study/finish  Dev Tools: finish the town's studies now
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const T = require('../lib/tactics_setup');

const router = express.Router();
const fail = (res, e) => { if (!e.status) console.error('[tactics]', e); res.status(e.status || 500).json({ error: e.status ? e.message : 'The battle could not be set up.' }); };

router.get('/admin/options', requireAuth, requireAdmin, (req, res) => {
  try {
    const CC = require('../lib/class_abilities'), DEFS = require('../lib/dungeon_defs');
    res.json({
      ok: true,
      classes: Object.keys(T.KITS).map(k => ({ key: k, label: CC.CLASSES[k].label, icon: CC.CLASSES[k].icon })),
      levels: [{ key: 'skull', label: "What the skull expects" }, { key: 'as_is', label: 'As the citizens really are' }].concat(Object.keys(T.LEVELS).map(k => ({ key: k, label: T.LEVELS[k].label }))),
      tiers: DEFS.TIER_ORDER.map(k => ({ key: k, name: DEFS.TIERS[k].name, skull: DEFS.TIERS[k].skull })),
      lands: require('../lib/dungeon_gen').LANDS,
      fights: [{ key: 'first', label: 'An ordinary fight' }, { key: 'hard', label: 'The hardest fight' }, { key: 'boss', label: 'The boss' }],
      // Whose fight: as the land and the seed decide, or one band's showcase (lib/tactics_foes.js SHOWCASE).
      bands: [{ key: '', label: 'Whoever lives in that land' }].concat(Object.keys(T.FOES.BANDS).map(k => ({ key: k, label: T.FOES.BANDS[k].name }))),
    });
  } catch (e) { fail(res, e); }
});
router.post('/admin/setup', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await T.build(req.user.userId, req.body || {})); } catch (e) { fail(res, e); }
});

// ── Battles the server keeps (lib/tactics_battles.js) ──────────────────────
// Admins only while tactics battles are a Dev Tools thing; a failed choice
// carries the battle as it really stands, so the browser can put itself right.
const B = require('../lib/tactics_battles');
const failWith = (res, e) => { if (!e.status) console.error('[tactics]', e); res.status(e.status || 500).json({ error: e.status ? e.message : 'The battle could not be reached.', battle: e.battle || undefined }); };
router.post('/battles', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, battle: await B.create(req.user.userId, req.body || {}) }); } catch (e) { failWith(res, e); }
});
// A battle a town has is its own to play: a quest's is every player's. A dungeon's battle is for whoever may be in
// a dungeon (admins, and everyone once `dungeons.on` is switched on), so switching dungeons off closes its fights too.
const mayPlay = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isFinite(id) && id > 0) {
      const b = (await require('../db').query('SELECT source FROM tactics_battles WHERE id=$1', [id])).rows[0];
      if (b && b.source === 'dungeon' && !(await require('../lib/dungeons').allowed(req.user))) return res.status(403).json({ error: 'Dungeons are not open yet.' });
    }
    next();
  } catch (e) { failWith(res, e); }
};
router.get('/battles/current', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, battle: await B.current(req.user.userId) }); } catch (e) { failWith(res, e); }
});
router.get('/battles/:id', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, battle: await B.get(req.user.userId, Number(req.params.id)) }); } catch (e) { failWith(res, e); }
});
router.post('/battles/:id/act', requireAuth, mayPlay, async (req, res) => {
  // A dungeon's battle that has just ended also says what became of the run: { dungeon: { run, found, ended, injuries } }.
  // A quest's battle that has just ended says what became of the quest: { quest: { outcome, wealth, items, upgraded, injuries } }.
  // And any battle that has just ended: { rewards: { kept, xp, party: [rows] } } when it was won (lib/tactics_xp.js), { rolls } for injuries when a run ended,
  // { mastered: [{ citizen_id, key, name, icon }] } for abilities used often enough to be mastered with it (lib/tactics_mastery.js).
  try { const b = req.body || {}; const { dungeon, quest, rewards, rolls, mastered, ...battle } = await B.act(req.user.userId, Number(req.params.id), b.n, b.action); res.json({ ok: true, battle, dungeon, quest, rewards, rolls, mastered }); } catch (e) { failWith(res, e); }
});
router.post('/battles/:id/leave', requireAuth, mayPlay, async (req, res) => {
  try { const { dungeon, ...battle } = await B.leave(req.user.userId, Number(req.params.id)); res.json({ ok: true, battle, dungeon }); } catch (e) { failWith(res, e); }
});

// ── Where the board is open to this player: quest battles for everyone; dungeons where the player may enter them ──
router.get('/open', requireAuth, async (req, res) => {
  try { res.json({ ok: true, dungeons: !!(await require('../lib/dungeons').allowed(req.user)), quests: true }); } catch (e) { failWith(res, e); }
});
// ── A quest's battle on the board (lib/tactics_quests.js): the one open for that quest, made if it is not there ──
router.post('/quest/:questRunId', requireAuth, async (req, res) => {
  try { res.json({ ok: true, battle: await require('../lib/tactics_quests').open(req.user, req.params.questRunId) }); } catch (e) { failWith(res, e); }
});

// ── What a citizen knows and brings (lib/tactics_abilities.js; the Abilities page on a citizen) ──
router.get('/abilities/:citizenId', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/tactics_abilities').page(req.user.userId, req.params.citizenId)) }); } catch (e) { failWith(res, e); }
});
// { keys: [five ability keys] }: the ones this citizen brings to a battle from now on.
// Study at a class building, and the passive slot (lib/tactics_study.js).
router.get('/study/:citizenId', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/tactics_study').page(req.user.userId, req.params.citizenId)) }); } catch (e) { failWith(res, e); }
});
router.post('/study/:citizenId', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/tactics_study').start(req.user.userId, req.params.citizenId, (req.body || {}).lesson)) }); } catch (e) { failWith(res, e); }
});
router.post('/study/:citizenId/cancel', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/tactics_study').cancel(req.user.userId, req.params.citizenId)) }); } catch (e) { failWith(res, e); }
});
router.post('/study/:citizenId/passive', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/tactics_study').setPassive(req.user.userId, req.params.citizenId, (req.body || {}).key)) }); } catch (e) { failWith(res, e); }
});
// Dev Tools: every grown citizen of the admin's town with no family signature is taught one by their parents, if they can.
router.post('/admin/signatures', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { query } = require('../db');
    const s = (await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId])).rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    res.json({ ok: true, taught: await require('../lib/tactics_signature').assignMissing(s.id) });
  } catch (e) { failWith(res, e); }
});
// Dev Tools: every study in the admin's town is finished now.
router.post('/admin/study/finish', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { query } = require('../db');
    const s = (await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId])).rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    await query('UPDATE citizen_study SET done_at = NOW() WHERE settlement_id=$1', [s.id]);
    res.json({ ok: true, finished: await require('../lib/tactics_study').finishDue(s.id) });
  } catch (e) { failWith(res, e); }
});
// The second school: { cls, keys } — a class the citizen has levels in and up to five of its abilities; cls 'none' brings nothing.
router.post('/abilities/:citizenId/second', requireAuth, mayPlay, async (req, res) => {
  const b = req.body || {};
  try { res.json({ ok: true, ...(await require('../lib/tactics_abilities').setSecond(req.user.userId, req.params.citizenId, b.cls, b.keys)) }); } catch (e) { failWith(res, e); }
});

module.exports = router;
