// ══════════════════════════════════════════════════════════════════════════
//  /api/tactics — the tactics battle prototype (docs/TACTICS.md).
//  Admins only, from Dev Tools. The browser shows the battle; the server keeps
//  it and checks every choice with the same rules (lib/tactics_battles.js).
//  Nothing is paid or lost.
//
//    GET  /admin/options   the classes, levels, skulls and lands to choose from
//    POST /admin/setup     { classes: [×4], level, tier, terrain, seed, fight, band?, citizen_ids? }
//                          → { seed, land, tier, name, party, enemies }
//    POST /battles             the same choices → a battle the server keeps: { battle: { id, setup, actions, check } }
//    GET  /battles/current     the town's open battle, or null (to pick it up after a reload)
//    GET  /battles/:id
//    POST /battles/:id/act     { n, action }  the player's n-th choice; refused if the rules do not allow it
//    POST /battles/:id/leave
//    GET  /open                where the board is open to this player
//    POST /quest/:questRunId   a quest's battle on the board (lib/tactics_quests.js); admins, or everyone once `tactics.quests` is on
//    GET  /abilities/:id, POST /abilities/:id/ready   what a citizen knows and brings (lib/tactics_abilities.js)
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const T = require('../lib/tactics_setup');

const router = express.Router();
const fail = (res, e) => { if (!e.status) console.error('[tactics]', e); res.status(e.status || 500).json({ error: e.status ? e.message : 'The battle could not be set up.' }); };

router.get('/admin/options', requireAuth, requireAdmin, async (req, res) => {
  try {
    const CC = require('../lib/class_cards'), DEFS = require('../lib/dungeon_defs');
    res.json({
      ok: true,
      classes: Object.keys(T.KITS).map(k => ({ key: k, label: CC.PACKS[k].label, icon: CC.PACKS[k].icon })),
      levels: [{ key: 'skull', label: "What the skull expects" }, { key: 'as_is', label: 'As the citizens really are' }].concat(Object.keys(T.LEVELS).map(k => ({ key: k, label: T.LEVELS[k].label }))),
      tiers: DEFS.TIER_ORDER.map(k => ({ key: k, name: DEFS.TIERS[k].name, skull: DEFS.TIERS[k].skull })),
      lands: require('../lib/dungeon_gen').LANDS,
      fights: [{ key: 'first', label: 'An ordinary fight' }, { key: 'hard', label: 'The hardest fight' }, { key: 'boss', label: 'The boss' }],
      // Whose fight: as the land and the seed decide, or one band's showcase (lib/tactics_foes.js SHOWCASE).
      bands: [{ key: '', label: 'Whoever lives in that land' }].concat(Object.keys(T.FOES.BANDS).map(k => ({ key: k, label: T.FOES.BANDS[k].name }))),
      // Are quest battles on the board for every player (the switch `tactics.quests`)?
      quests_on: await require('../lib/tuning').switchOn('tactics.quests'),
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
// A battle a town already has (its dungeon's, say) is open to whoever may play dungeons, not only admins.
const mayPlay = async (req, res, next) => {
  try { if (await require('../lib/dungeons').allowed(req.user) || (await require('../lib/tactics_quests').mode(req.user)) !== 'off') return next(); res.status(403).json({ error: 'Battles on the board are not open yet.' }); }
  catch (e) { failWith(res, e); }
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
  // And any battle that has just ended: { rewards: { kept, xp, party: [rows] } } when it was won (lib/tactics_xp.js), { rolls } for injuries when a run ended.
  try { const b = req.body || {}; const { dungeon, quest, rewards, rolls, ...battle } = await B.act(req.user.userId, Number(req.params.id), b.n, b.action); res.json({ ok: true, battle, dungeon, quest, rewards, rolls }); } catch (e) { failWith(res, e); }
});
router.post('/battles/:id/leave', requireAuth, mayPlay, async (req, res) => {
  try { const { dungeon, ...battle } = await B.leave(req.user.userId, Number(req.params.id)); res.json({ ok: true, battle, dungeon }); } catch (e) { failWith(res, e); }
});

// ── Where the board is open to this player: { dungeons, quests: 'on' | 'choice' | 'off' } ──
router.get('/open', requireAuth, async (req, res) => {
  try { res.json({ ok: true, dungeons: !!(await require('../lib/dungeons').allowed(req.user)), quests: await require('../lib/tactics_quests').mode(req.user) }); } catch (e) { failWith(res, e); }
});
// ── A quest's battle on the board (lib/tactics_quests.js): the one open for that quest, made if it is not there ──
router.post('/quest/:questRunId', requireAuth, async (req, res) => {
  try { res.json({ ok: true, battle: await require('../lib/tactics_quests').open(req.user, req.params.questRunId) }); } catch (e) { failWith(res, e); }
});
// Quest battles on the board for every player, or (off) for admins only, who are then offered both.
router.post('/admin/quests-switch', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, on: await require('../lib/tuning').setSwitch('tactics.quests', !!(req.body || {}).on) }); } catch (e) { failWith(res, e); }
});

// ── What a citizen knows and brings (lib/tactics_abilities.js; the Abilities page on a citizen) ──
router.get('/abilities/:citizenId', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/tactics_abilities').page(req.user.userId, req.params.citizenId)) }); } catch (e) { failWith(res, e); }
});
// { keys: [five ability keys] }: the ones this citizen brings to a battle from now on.
router.post('/abilities/:citizenId/ready', requireAuth, mayPlay, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/tactics_abilities').setReady(req.user.userId, req.params.citizenId, (req.body || {}).keys)) }); } catch (e) { failWith(res, e); }
});

module.exports = router;
