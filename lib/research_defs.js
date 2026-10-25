// ══════════════════════════════════════════════════════════════════════════
//  research_defs — the Library's project tree.
//
//  BYTE-IDENTICAL in two places — edit one, copy to the other:
//    kindlewood-server/lib/research_defs.js    (module.exports)
//    kindlewood-frontend/js/research-defs.js   (window.KWResearch)
//
//  The tree: BRANCHES are its rows (paths), ERAS its columns. Each project:
//  branch, tier (era 1–5), slot (two in one path and era), field (from its
//  path: 'nature' or 'lore'; Scholar specialists study their own field
//  faster), label, icon, cost (research points), requires (finished first —
//  always an earlier era), desc (what players read) and what it does:
//    resources   resource_defs keys it unlocks (ores turn up; alloys smelt)
//    buildings   buildings it unlocks (BUILDINGS[x].research names it too)
//    recipes     hidden recipes the whole town learns when it's done
//    effects     town-wide { type: value }:
//                  ore          +x ore from mines and outposts (pct)
//                  build_cost   −x building and upgrade costs (pct, negative)
//                  market_fee   −x Market fees (pct, negative)
//                  research     +x research points (pct)
//                  craft_speed  +x crafting speed, every workshop (pct);
//                               craft_speed:<station> for one
//                  craft_xp     +x XP per craft (pct)
//                  quality      +x craft quality (flat)
//                  carry        +x Market carry weight (pct)
//  Never rename a key: finished projects are stored by it.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // Paths (rows of the tree) and eras (columns). A project's field — the
  // Scholar specialisations — comes from its path.
  var BRANCHES = {
    mining:      { label: 'Mining',        icon: '⛏️', field: 'nature', order: 0 },
    metallurgy:  { label: 'Metallurgy',    icon: '🔥', field: 'nature', order: 1 },
    crafts:      { label: 'Craftsmanship', icon: '🔨', field: 'lore',   order: 2 },
    building:    { label: 'Building',      icon: '🏗️', field: 'lore',   order: 3 },
    trade:       { label: 'Trade',         icon: '📒', field: 'lore',   order: 4 },
    scholarship: { label: 'Scholarship',   icon: '📚', field: 'lore',   order: 5 },
  };
  var ERAS = ['Foundations', 'Workings', 'Guilds', 'Mastery', 'Legends'];

  // p(branch, tier, slot, label, icon, cost, requires, desc, extra)
  function p(branch, tier, slot, label, icon, cost, requires, desc, extra) {
    var o = { branch: branch, tier: tier, slot: slot, field: BRANCHES[branch].field, label: label, icon: icon, cost: cost, requires: requires, desc: desc };
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
  }

  var PROJECTS = {
    // ⛏ Mining
    prospecting:    p('mining', 1, 0, 'Prospecting I', '🧭', 120, [], 'Where the seams run. Mines and outposts turn up 15% more ore.', { effects: { ore: 0.15 } }),
    prospecting_2:  p('mining', 2, 0, 'Prospecting II', '🧭', 260, ['prospecting'], 'Better maps of the hills. Another 15% more ore.', { effects: { ore: 0.15 } }),
    deep_veins:     p('mining', 3, 0, 'Deep Veins', '🕳️', 400, ['prospecting_2'], 'Shafts below the water line. A level 3 Mine and mountain outposts find gold ore and gems.', { resources: ['goldore', 'gems'] }),
    prospecting_3:  p('mining', 4, 0, 'Prospecting III', '🧭', 650, ['prospecting_2', 'deep_veins'], 'Every seam charted. Another 20% more ore.', { effects: { ore: 0.2 } }),
    volcanic_lore:  p('mining', 4, 1, 'Volcanic Lore', '🌋', 650, ['deep_veins'], 'What the mountain\'s fire left behind. Mountain outposts find obsidian.', { resources: ['obsidian'] }),
    // 🔥 Metallurgy
    smelting:       p('metallurgy', 1, 0, 'Smelting', '🔥', 130, [], 'Furnaces hot enough to mix metals. Unlocks the Smelter and bronze.', { buildings: ['smelter'], resources: ['bronze'] }),
    furnaces:       p('metallurgy', 2, 0, 'Hotter Furnaces I', '🌡️', 260, ['smelting'], 'Better bellows and flues. The Smelter works 15% faster.', { effects: { 'craft_speed:smelter': 0.15 } }),
    steelworking:   p('metallurgy', 3, 0, 'Steelworking', '🔷', 400, ['furnaces'], 'Iron, coal and patience. The Smelter makes steel.', { resources: ['steel'] }),
    furnaces_2:     p('metallurgy', 4, 0, 'Hotter Furnaces II', '🌡️', 650, ['furnaces', 'steelworking'], 'Blast furnaces. The Smelter works another 15% faster.', { effects: { 'craft_speed:smelter': 0.15 } }),
    starmetal:      p('metallurgy', 5, 0, 'Starmetal', '🌠', 1000, ['volcanic_lore', 'steelworking'], 'Metals that fell from the sky. Mountain outposts find mithril and moonsilver — very rarely.', { resources: ['mithril', 'moonsilver'] }),
    // 🔨 Craftsmanship
    apprenticeship: p('crafts', 1, 0, 'Apprenticeship', '🧑‍🔧', 120, [], 'Masters take on learners. Crafters earn 10% more XP.', { effects: { craft_xp: 0.1 } }),
    guild_marks:    p('crafts', 2, 0, 'Guild Marks', '🔖', 260, ['apprenticeship'], 'Every piece stamped and judged. +3 craft quality.', { effects: { quality: 3 } }),
    master_recipes: p('crafts', 3, 0, 'Master Recipes', '📜', 400, ['guild_marks', 'smelting'], 'Old pattern books, copied out. Your town learns the Falchion and the Tower Shield.', { recipes: ['falchion', 'tower_shield'] }),
    swift_benches:  p('crafts', 4, 0, 'Swift Benches', '⚙️', 650, ['master_recipes'], 'Jigs, clamps and good habits. Every workshop works 10% faster.', { effects: { craft_speed: 0.1 } }),
    masterworks:    p('crafts', 5, 0, 'Masterworks', '🏆', 1000, ['swift_benches', 'guild_marks'], 'The pursuit of perfection. +5 craft quality.', { effects: { quality: 5 } }),
    // 🏗 Building
    masonry:        p('building', 1, 0, 'Masonry', '🧱', 120, [], 'Square stones, true walls. Buildings and upgrades cost 3% less.', { effects: { build_cost: -0.03 } }),
    engineering:    p('building', 2, 0, 'Engineering', '📐', 260, ['masonry'], 'Plans before planks. Buildings and upgrades cost 5% less.', { effects: { build_cost: -0.05 } }),
    architecture:   p('building', 3, 0, 'Architecture', '🏛️', 400, ['engineering'], 'Arches, vaults and proportion. Another 5% off buildings.', { effects: { build_cost: -0.05 } }),
    // 📒 Trade
    record_keeping: p('trade', 1, 0, 'Record Keeping', '📒', 120, [], 'Ledgers, tallies and receipts. Market fees fall by a tenth.', { effects: { market_fee: -0.1 } }),
    caravan_routes: p('trade', 2, 0, 'Caravan Routes', '🐫', 260, ['record_keeping'], 'Known roads and good packing. Porters and merchants carry 10% more.', { effects: { carry: 0.1 } }),
    trade_charters: p('trade', 3, 0, 'Trade Charters', '📜', 400, ['caravan_routes'], 'Sealed agreements. Market fees fall by another tenth.', { effects: { market_fee: -0.1 } }),
    // 📚 Scholarship
    scriptorium:    p('scholarship', 1, 0, 'Scriptorium', '🪶', 120, [], 'Copyists and clean ink. Research goes 10% faster.', { effects: { research: 0.1 } }),
    academy:        p('scholarship', 3, 0, 'Academy', '🎓', 400, ['scriptorium', 'record_keeping'], 'Lectures and debates. Research goes another 15% faster.', { effects: { research: 0.15 } }),
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

  var api = { BRANCHES: BRANCHES, ERAS: ERAS, PROJECTS: PROJECTS, KEYS: KEYS, project: project, label: label, blockedBy: blockedBy, effectsOf: effectsOf, unlockerOf: unlockerOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KWResearch = api;
})(typeof window !== 'undefined' ? window : this);
