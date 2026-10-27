// ══════════════════════════════════════════════════════════════════════════
//  research_defs — the Library's project tree.
//
//  Server only: the browser never gets this file, so the names of distant
//  projects stay secret. The Library screen draws from GET /api/research
//  (hidden projects redacted); Dev Tools reads GET /api/research/admin/defs.
//
//  The tree: BRANCHES are its rows (paths), ERAS its columns. Each project:
//  branch, tier (era 1–8), slot (two in one path and era), field (from its
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
//                  bank         +x research points that can bank (flat)
//                  ore:<key>    +x of one ore (pct)
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
  var ERAS = ['Foundations', 'Workings', 'Guilds', 'Mastery', 'Discovery', 'Ingenuity', 'Wonders', 'Legends'];
  // Research points per era: the end game is a long-term investment (a full
  // Library needs months to reach Starmetal).
  var ERA_COST = [120, 300, 650, 1100, 1700, 2500, 3600, 5000];

  // p(branch, tier, slot, label, icon, requires, desc, extra) — cost from the era
  function p(branch, tier, slot, label, icon, requires, desc, extra) {
    var o = { branch: branch, tier: tier, slot: slot, field: BRANCHES[branch].field, label: label, icon: icon,
      cost: ERA_COST[tier - 1], requires: requires, desc: desc };
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
  }

  var PROJECTS = {
    // ⛏ Mining
    prospecting:    p('mining', 1, 0, 'Prospecting I', '🧭', [], 'Where the seams run. Mines and outposts turn up 10% more ore.', { effects: { ore: 0.1 } }),
    shoring:        p('mining', 2, 0, 'Shoring', '🪵', ['prospecting'], 'Timbered tunnels go further. 25% more copper and tin.', { effects: { 'ore:copper': 0.25, 'ore:tin': 0.25 } }),
    prospecting_2:  p('mining', 2, 1, 'Prospecting II', '🧭', ['prospecting'], 'Better maps of the hills. Another 10% more ore.', { effects: { ore: 0.1 } }),
    assaying:       p('mining', 3, 0, 'Assaying', '⚖️', ['shoring'], 'Knowing good ore from bad. 25% more silver.', { effects: { 'ore:silver': 0.25 } }),
    deep_veins:     p('mining', 4, 0, 'Deep Veins', '🕳️', ['assaying', 'prospecting_2'], 'Shafts below the water line. A level 3 Mine and mountain outposts find gold ore and gems.', { resources: ['goldore', 'gems'] }),
    gem_lore:       p('mining', 5, 0, 'Gem Lore', '💎', ['deep_veins'], 'Where the bright stones hide. 30% more gems and gold ore.', { effects: { 'ore:gems': 0.3, 'ore:goldore': 0.3 } }),
    prospecting_3:  p('mining', 5, 1, 'Prospecting III', '🧭', ['prospecting_2', 'deep_veins'], 'Every seam charted. Another 15% more ore.', { effects: { ore: 0.15 } }),
    volcanic_lore:  p('mining', 6, 0, 'Volcanic Lore', '🌋', ['deep_veins'], 'What the mountain\'s fire left behind. Mountain outposts find obsidian.', { resources: ['obsidian'] }),
    mine_pumps:     p('mining', 6, 1, 'Mine Pumps', '💧', ['prospecting_3'], 'Dry shafts, deeper faces. Another 10% more ore.', { effects: { ore: 0.1 } }),
    moon_lore:      p('mining', 7, 0, 'Moon Lore', '🌙', ['volcanic_lore', 'gem_lore'], 'Silver that shines without light. Mountain outposts find moonsilver — very rarely.', { resources: ['moonsilver'] }),
    // 🔥 Metallurgy
    smelting:       p('metallurgy', 1, 0, 'Smelting', '🔥', [], 'Furnaces hot enough to mix metals. Unlocks the Smelter and bronze.', { buildings: ['smelter'], resources: ['bronze'] }),
    furnaces:       p('metallurgy', 2, 0, 'Hotter Furnaces I', '🌡️', ['smelting'], 'Better flues. The Smelter works 15% faster.', { effects: { 'craft_speed:smelter': 0.15 } }),
    bellows:        p('metallurgy', 3, 0, 'Bellows Craft', '🌬️', ['furnaces'], 'Leather lungs for the fire. The Smelter works 10% faster.', { effects: { 'craft_speed:smelter': 0.1 } }),
    steelworking:   p('metallurgy', 4, 0, 'Steelworking', '🔷', ['bellows'], 'Iron, coal and patience. The Smelter makes steel.', { resources: ['steel'] }),
    furnaces_2:     p('metallurgy', 5, 0, 'Hotter Furnaces II', '🌡️', ['steelworking'], 'Blast furnaces. The Smelter works another 15% faster.', { effects: { 'craft_speed:smelter': 0.15 } }),
    tempering:      p('metallurgy', 6, 0, 'Tempering', '♨️', ['furnaces_2'], 'Heat, quench, heat again. +2 craft quality.', { effects: { quality: 2 } }),
    meteor_hunting: p('metallurgy', 7, 0, 'Meteor Hunting', '☄️', ['tempering', 'observatory'], 'Following falling stars to where they land. The way to starmetal.'),
    starmetal:      p('metallurgy', 8, 0, 'Starmetal', '🌠', ['meteor_hunting', 'moon_lore'], 'Metal that fell from the sky. Mountain outposts find mithril — very rarely.', { resources: ['mithril'] }),
    // 🔨 Craftsmanship
    apprenticeship: p('crafts', 1, 0, 'Apprenticeship', '🧑‍🔧', [], 'Masters take on learners. Crafters earn 10% more XP.', { effects: { craft_xp: 0.1 } }),
    guild_marks:    p('crafts', 2, 0, 'Guild Marks', '🔖', ['apprenticeship'], 'Every piece stamped and judged. +2 craft quality.', { effects: { quality: 2 } }),
    smithing_lore:  p('crafts', 3, 0, 'Smithing Lore', '⚒️', ['guild_marks'], 'The anvil\'s old songs. The Smithy works 15% faster.', { effects: { 'craft_speed:smithy': 0.15 } }),
    fine_settings:  p('crafts', 3, 1, 'Fine Settings', '💍', ['guild_marks'], 'Claws, bezels and patience. The Jeweller works 15% faster.', { effects: { 'craft_speed:jeweller': 0.15 } }),
    master_recipes: p('crafts', 4, 0, 'Master Recipes', '📜', ['smithing_lore', 'smelting'], 'Old pattern books, copied out. Your town learns the Falchion and the Tower Shield.', { recipes: ['falchion', 'tower_shield'] }),
    joinery_lore:   p('crafts', 5, 0, 'Joinery Lore', '🪚', ['master_recipes'], 'Dovetails and mortises. The Workshop works 15% faster.', { effects: { 'craft_speed:workshop': 0.15 } }),
    swift_benches:  p('crafts', 6, 0, 'Swift Benches', '⚙️', ['joinery_lore', 'fine_settings'], 'Jigs, clamps and good habits. Every workshop works 10% faster.', { effects: { craft_speed: 0.1 } }),
    journeymen:     p('crafts', 7, 0, 'Journeymen', '🧳', ['swift_benches'], 'Crafters who travel and learn. 15% more crafting XP.', { effects: { craft_xp: 0.15 } }),
    masterworks:    p('crafts', 8, 0, 'Masterworks', '🏆', ['journeymen'], 'The pursuit of perfection. +4 craft quality.', { effects: { quality: 4 } }),
    // 🏗 Building
    masonry:        p('building', 1, 0, 'Masonry', '🧱', [], 'Square stones, true walls. Buildings and upgrades cost 3% less.', { effects: { build_cost: -0.03 } }),
    surveying:      p('building', 2, 0, 'Surveying', '📏', ['masonry'], 'Level ground, straight lines. Another 3% off buildings.', { effects: { build_cost: -0.03 } }),
    engineering:    p('building', 3, 0, 'Engineering', '📐', ['surveying'], 'Plans before planks. Another 4% off buildings.', { effects: { build_cost: -0.04 } }),
    architecture:   p('building', 5, 0, 'Architecture', '🏛️', ['engineering'], 'Arches, vaults and proportion. Another 4% off buildings.', { effects: { build_cost: -0.04 } }),
    grand_works:    p('building', 7, 0, 'Grand Works', '🏰', ['architecture'], 'Cranes, guilds and great designs. Another 4% off buildings.', { effects: { build_cost: -0.04 } }),
    // 📒 Trade
    record_keeping: p('trade', 1, 0, 'Record Keeping', '📒', [], 'Ledgers, tallies and receipts. Market fees fall by 6%.', { effects: { market_fee: -0.06 } }),
    caravan_routes: p('trade', 2, 0, 'Caravan Routes', '🐫', ['record_keeping'], 'Known roads and good packing. Porters and merchants carry 10% more.', { effects: { carry: 0.1 } }),
    weights_measures: p('trade', 3, 0, 'Weights & Measures', '⚖️', ['caravan_routes'], 'Honest scales everywhere. Market fees fall by another 6%.', { effects: { market_fee: -0.06 } }),
    trade_charters: p('trade', 4, 0, 'Trade Charters', '📜', ['weights_measures'], 'Sealed agreements. Market fees fall by another 8%.', { effects: { market_fee: -0.08 } }),
    pack_animals:   p('trade', 5, 0, 'Pack Animals', '🐴', ['trade_charters'], 'Sturdy beasts for the road. Porters and merchants carry 10% more.', { effects: { carry: 0.1 } }),
    banking:        p('trade', 6, 0, 'Banking Houses', '🏦', ['pack_animals'], 'Credit and letters of exchange. Market fees fall by another 8%.', { effects: { market_fee: -0.08 } }),
    grand_caravans: p('trade', 7, 0, 'Grand Caravans', '🛞', ['banking'], 'Wagon trains between towns. Porters and merchants carry 15% more.', { effects: { carry: 0.15 } }),
    // 📚 Scholarship
    scriptorium:    p('scholarship', 1, 0, 'Scriptorium', '🪶', [], 'Copyists and clean ink. Research goes 8% faster.', { effects: { research: 0.08 } }),
    quills:         p('scholarship', 2, 0, 'Quills & Ink', '✒️', ['scriptorium'], 'Notes kept between projects. Up to 100 more research points bank while nothing is studied.', { effects: { bank: 100 } }),
    academy:        p('scholarship', 3, 0, 'Academy', '🎓', ['quills', 'record_keeping'], 'Lectures and debates. Research goes 10% faster.', { effects: { research: 0.1 } }),
    archives:       p('scholarship', 4, 0, 'Archives', '🗄️', ['academy'], 'Nothing learned is lost. Up to 200 more research points bank.', { effects: { bank: 200 } }),
    natural_philosophy: p('scholarship', 5, 0, 'Natural Philosophy', '🔬', ['archives'], 'Asking how the world works. Research goes 10% faster.', { effects: { research: 0.1 } }),
    observatory:    p('scholarship', 6, 0, 'Observatory', '🔭', ['natural_philosophy'], 'Watching the night sky. Research goes 10% faster.', { effects: { research: 0.1 } }),
    great_library:  p('scholarship', 7, 0, 'Great Library', '🏛️', ['observatory'], 'Every book worth keeping, under one roof. Research goes 12% faster.', { effects: { research: 0.12 } }),
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
  // How far each project is from what the town knows: finished 0; else 1 +
  // the furthest of its prerequisites (1 = can study now). Over HIDE_BEYOND
  // the Library shows it as ?? — too distant to understand yet.
  var HIDE_BEYOND = 2;
  function distances(done) {
    var has = function (k) { return done && (done.has ? done.has(k) : done.indexOf(k) >= 0); };
    var out = {};
    function d(k) {
      if (out[k] != null) return out[k];
      if (has(k)) return (out[k] = 0);
      var m = 0;
      PROJECTS[k].requires.forEach(function (r) { m = Math.max(m, d(r)); });
      return (out[k] = 1 + m);
    }
    KEYS.forEach(d);
    return out;
  }
  // key and every unfinished prerequisite, in an order they can be studied.
  function pathTo(key, done) {
    var has = function (k) { return done && (done.has ? done.has(k) : done.indexOf(k) >= 0); };
    var out = [];
    (function visit(k) {
      if (has(k) || out.indexOf(k) >= 0 || !PROJECTS[k]) return;
      PROJECTS[k].requires.forEach(visit);
      out.push(k);
    })(key);
    return out;
  }

  // A project's name — or a vague line when the town can't see it yet (more
  // than HIDE_BEYOND steps away), so no message gives the tree away.
  var UNKNOWN_RESEARCH = 'research your scholars don\'t understand yet';
  function labelFor(key, done) {
    if (!PROJECTS[key]) return String(key);
    return distances(done || [])[key] > HIDE_BEYOND ? UNKNOWN_RESEARCH : PROJECTS[key].label;
  }

  // Which project unlocks a resource / building (for "needs research" hints).
  function unlockerOf(kind, key) {
    for (var i = 0; i < KEYS.length; i++) if ((PROJECTS[KEYS[i]][kind] || []).indexOf(key) >= 0) return KEYS[i];
    return null;
  }

  var api = { BRANCHES: BRANCHES, ERAS: ERAS, ERA_COST: ERA_COST, HIDE_BEYOND: HIDE_BEYOND, PROJECTS: PROJECTS, KEYS: KEYS, distances: distances, pathTo: pathTo, labelFor: labelFor, UNKNOWN_RESEARCH: UNKNOWN_RESEARCH, project: project, label: label, blockedBy: blockedBy, effectsOf: effectsOf, unlockerOf: unlockerOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KWResearch = api;
})(typeof window !== 'undefined' ? window : this);
