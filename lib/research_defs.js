// ══════════════════════════════════════════════════════════════════════════
//  research_defs — the Library's project tree.
//
//  BYTE-IDENTICAL in two places — edit one, copy to the other:
//    kindlewood-server/lib/research_defs.js    (module.exports)
//    kindlewood-frontend/js/research-defs.js   (window.KWResearch)
//
//  Each project: label, icon, field ('nature' — resources and production —
//  or 'lore'; Scholar specialists study their own field faster), cost
//  (research points), requires (projects finished first), desc (what
//  players read) and what it does:
//    resources   resource_defs keys it unlocks (ores turn up; alloys smelt)
//    buildings   buildings it unlocks (BUILDINGS[x].research names it too)
//    recipes     hidden recipes the whole town learns when it's done
//    effects     town-wide { type: value }:
//                  ore          +x ore from mines and outposts (pct)
//                  build_cost   −x building and upgrade costs (pct, negative)
//                  market_fee   −x Market fees (pct, negative)
//  Never rename a key: finished projects are stored by it.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  var PROJECTS = {
    prospecting:    { label: 'Prospecting',    icon: '🧭', field: 'nature', cost: 120, requires: [],
                      desc: 'Where the seams run. Mines and outposts turn up 15% more ore.', effects: { ore: 0.15 } },
    smelting:       { label: 'Smelting',       icon: '🔥', field: 'nature', cost: 150, requires: [],
                      desc: 'Furnaces hot enough to mix metals. Unlocks the Smelter and bronze.', buildings: ['smelter'], resources: ['bronze'] },
    record_keeping: { label: 'Record Keeping', icon: '📒', field: 'lore', cost: 200, requires: [],
                      desc: 'Ledgers, tallies and receipts. Market fees fall by a tenth.', effects: { market_fee: -0.1 } },
    deep_veins:     { label: 'Deep Veins',     icon: '🕳️', field: 'nature', cost: 300, requires: ['prospecting'],
                      desc: 'Shafts below the water line. A level 3 Mine and mountain outposts find gold ore and gems.', resources: ['goldore', 'gems'] },
    steelworking:   { label: 'Steelworking',   icon: '🔷', field: 'nature', cost: 350, requires: ['smelting'],
                      desc: 'Iron, coal and patience. The Smelter makes steel.', resources: ['steel'] },
    engineering:    { label: 'Engineering',    icon: '📐', field: 'lore', cost: 450, requires: ['record_keeping'],
                      desc: 'Plans before planks. Buildings and upgrades cost 5% less.', effects: { build_cost: -0.05 } },
    volcanic_lore:  { label: 'Volcanic Lore',  icon: '🌋', field: 'nature', cost: 400, requires: ['deep_veins'],
                      desc: 'What the mountain\'s fire left behind. Mountain outposts find obsidian.', resources: ['obsidian'] },
    master_recipes: { label: 'Master Recipes', icon: '📜', field: 'lore', cost: 500, requires: ['smelting'],
                      desc: 'Old pattern books, copied out. Your town learns the Falchion and the Tower Shield.', recipes: ['falchion', 'tower_shield'] },
    starmetal:      { label: 'Starmetal',      icon: '🌠', field: 'nature', cost: 900, requires: ['volcanic_lore', 'steelworking'],
                      desc: 'Metals that fell from the sky. Mountain outposts find mithril and moonsilver — very rarely.', resources: ['mithril', 'moonsilver'] },
  };
  var KEYS = Object.keys(PROJECTS);

  function project(key) { return PROJECTS[key] || null; }
  function label(key) { return PROJECTS[key] ? PROJECTS[key].label : String(key); }
  // Can the town start it? done: Set or array of finished keys.
  function blockedBy(key, done) {
    var p = PROJECTS[key], has = function (k) { return done && (done.has ? done.has(k) : done.indexOf(k) >= 0); };
    if (!p) return 'Unknown project.';
    if (has(key)) return 'Already studied.';
    var missing = p.requires.filter(function (r) { return !has(r); });
    return missing.length ? 'Study ' + missing.map(label).join(' and ') + ' first.' : null;
  }
  // Town-wide effects of everything finished: { type: total }.
  function effectsOf(done) {
    var out = {};
    (done ? Array.from(done) : []).forEach(function (k) {
      var e = PROJECTS[k] && PROJECTS[k].effects;
      if (e) Object.keys(e).forEach(function (t) { out[t] = (out[t] || 0) + e[t]; });
    });
    return out;
  }
  // Which project unlocks a resource / building (for "needs research" hints).
  function unlockerOf(kind, key) {
    for (var i = 0; i < KEYS.length; i++) if ((PROJECTS[KEYS[i]][kind] || []).indexOf(key) >= 0) return KEYS[i];
    return null;
  }

  var api = { PROJECTS: PROJECTS, KEYS: KEYS, project: project, label: label, blockedBy: blockedBy, effectsOf: effectsOf, unlockerOf: unlockerOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KWResearch = api;
})(typeof window !== 'undefined' ? window : this);
