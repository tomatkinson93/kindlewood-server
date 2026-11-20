// ══════════════════════════════════════════════════════════════════════════
//  /api/tactics — the tactics battle prototype (docs/TACTICS.md).
//  Admins only, from Dev Tools. The battle is played in the browser; these
//  routes only say who is on the board. Nothing is stored or paid.
//
//    GET  /admin/options   the classes, levels, skulls and lands to choose from
//    POST /admin/setup     { classes: [×4], level, tier, terrain, seed, fight, citizen_ids? }
//                          → { seed, land, tier, name, party, enemies }
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
    const CC = require('../lib/class_cards'), DEFS = require('../lib/dungeon_defs');
    res.json({
      ok: true,
      classes: Object.keys(T.KITS).map(k => ({ key: k, label: CC.PACKS[k].label, icon: CC.PACKS[k].icon })),
      levels: [{ key: 'skull', label: "What the skull expects" }, { key: 'as_is', label: 'As the citizens really are' }].concat(Object.keys(T.LEVELS).map(k => ({ key: k, label: T.LEVELS[k].label }))),
      tiers: DEFS.TIER_ORDER.map(k => ({ key: k, name: DEFS.TIERS[k].name, skull: DEFS.TIERS[k].skull })),
      lands: require('../lib/dungeon_gen').LANDS,
      fights: [{ key: 'first', label: 'An ordinary fight' }, { key: 'hard', label: 'The hardest fight' }, { key: 'boss', label: 'The boss' }],
    });
  } catch (e) { fail(res, e); }
});
router.post('/admin/setup', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await T.build(req.user.userId, req.body || {})); } catch (e) { fail(res, e); }
});

module.exports = router;
