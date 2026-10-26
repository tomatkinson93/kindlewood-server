// ══════════════════════════════════════════════════════════════════════════
//  resource_defs — every resource a settlement can hold, in one list.
//
//  BYTE-IDENTICAL in two places — edit one, copy to the other:
//    kindlewood-server/lib/resource_defs.js    (module.exports)
//    kindlewood-frontend/js/resource-defs.js   (window.KWResources)
//  Pure data + small helpers: no DOM, no DB.
//
//  Each key is also a settlements column (INTEGER, migrations/0NN_resources.sql;
//  scripts/resources_test.js checks every key has one).
//
//  The key `metal` is Iron. Players only ever see "Iron"; the key stays
//  `metal` because hundreds of statements, saved quests and Happenings use it.
//
//  Fields
//    label, icon   what players see (icon: an emoji; img: the topbar sprite for
//                  the base five)
//    group         base | ore | rare | alloy
//    discovery     start    — always known
//                  mining   — known after the first find (a mine, an outpost,
//                             a village trade, an expedition)
//                  research — can't be found until the research project
//                             `research` is done; then as `mining`
//                  alloy    — made at the Smelter once `research` is done
//    mine_level    the Mine level whose miners start turning it up
//    terrain       outpost terrains that can yield it
//    follows       base resource whose season / Happening multiplier it shares
//    ref_price     Market reference price per unit (gold)
//    weight        porter load per unit (Market carry weight)
//    tradeable     Market lots, Wanted orders and villages
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  var DEFS = [
    { key: 'food',   label: 'Food',   icon: '🌾', img: '/assets/foodicon.png',  group: 'base', discovery: 'start', ref_price: 0.3, weight: 0.5, tradeable: true },
    { key: 'timber', label: 'Timber', icon: '🪵', img: '/assets/woodicon.png',  group: 'base', discovery: 'start', ref_price: 0.7, weight: 1,   tradeable: true },
    { key: 'stone',  label: 'Stone',  icon: '🪨', img: '/assets/stoneicon.png', group: 'base', discovery: 'start', ref_price: 1.0, weight: 1,   tradeable: true },
    { key: 'metal',  label: 'Iron',   icon: '⛓️', img: '/assets/metalicon.png', group: 'base', discovery: 'start', ref_price: 2.0, weight: 2,   tradeable: true },
    { key: 'wealth', label: 'Wealth', icon: '🪙', img: '/assets/goldicon.png',  group: 'base', discovery: 'start', tradeable: false },

    { key: 'copper',     label: 'Copper',     icon: '🟠', group: 'ore',   discovery: 'mining',   mine_level: 1, terrain: ['hills'],    follows: 'metal', ref_price: 3,   weight: 2,   tradeable: true },
    { key: 'tin',        label: 'Tin',        icon: '🔘', group: 'ore',   discovery: 'mining',   mine_level: 1, terrain: ['hills'],    follows: 'metal', ref_price: 3,   weight: 2,   tradeable: true },
    { key: 'coal',       label: 'Coal',       icon: '⚫', group: 'ore',   discovery: 'mining',   mine_level: 1, terrain: ['hills'],    follows: 'stone', ref_price: 1.5, weight: 1.5, tradeable: true },
    { key: 'silver',     label: 'Silver',     icon: '🥈', group: 'ore',   discovery: 'mining',   mine_level: 2, terrain: ['mountain'], follows: 'metal', ref_price: 8,   weight: 2,   tradeable: true },
    { key: 'goldore',    label: 'Gold Ore',   icon: '🟡', group: 'ore',   discovery: 'research', research: 'deep_veins',    mine_level: 3, terrain: ['mountain'], follows: 'metal', ref_price: 15, weight: 2,   tradeable: true },
    { key: 'gems',       label: 'Gems',       icon: '💎', group: 'rare',  discovery: 'research', research: 'deep_veins',    mine_level: 3, terrain: ['mountain'], follows: 'stone', ref_price: 40, weight: 0.2, tradeable: true },
    { key: 'obsidian',   label: 'Obsidian',   icon: '🔮', group: 'rare',  discovery: 'research', research: 'volcanic_lore', terrain: ['mountain'],               follows: 'stone', ref_price: 12, weight: 1.5, tradeable: true },
    { key: 'mithril',    label: 'Mithril',    icon: '💠', group: 'rare',  discovery: 'research', research: 'starmetal',     terrain: ['mountain'],               follows: 'metal', ref_price: 90, weight: 1,   tradeable: true },
    { key: 'moonsilver', label: 'Moonsilver', icon: '🌙', group: 'rare',  discovery: 'research', research: 'moon_lore',     terrain: ['mountain'],               follows: 'metal', ref_price: 70, weight: 1,   tradeable: true },
    { key: 'bronze',     label: 'Bronze',     icon: '🔶', group: 'alloy', discovery: 'alloy',    research: 'smelting',      follows: 'metal', ref_price: 8,  weight: 2,   tradeable: true },
    { key: 'steel',      label: 'Steel',      icon: '🔷', group: 'alloy', discovery: 'alloy',    research: 'steelworking',  follows: 'metal', ref_price: 10, weight: 2,   tradeable: true },
  ];

  var BY_KEY = {};
  for (var i = 0; i < DEFS.length; i++) BY_KEY[DEFS[i].key] = DEFS[i];
  var KEYS = DEFS.map(function (d) { return d.key; });
  var BASE = KEYS.filter(function (k) { return BY_KEY[k].group === 'base'; });
  var EXTRA = KEYS.filter(function (k) { return BY_KEY[k].group !== 'base'; });
  var TRADEABLE = KEYS.filter(function (k) { return BY_KEY[k].tradeable; });
  var GROUP_LABEL = { base: 'Basics', ore: 'Ores', rare: 'Rare materials', alloy: 'Alloys' };

  function def(key) { return BY_KEY[key] || null; }
  function isResource(key) { return !!BY_KEY[key]; }
  function label(key) { return BY_KEY[key] ? BY_KEY[key].label : String(key); }
  function icon(key) { return BY_KEY[key] ? BY_KEY[key].icon : '❔'; }
  function startsKnown(key) { return !!BY_KEY[key] && BY_KEY[key].discovery === 'start'; }

  // The set of keys a town knows: the base five plus its discoveries (an
  // array of keys, or rows with .key).
  function knownSet(discoveries) {
    var out = {};
    BASE.forEach(function (k) { out[k] = true; });
    (discoveries || []).forEach(function (d) { var k = typeof d === 'string' ? d : d && d.key; if (BY_KEY[k]) out[k] = true; });
    return out;
  }
  function isKnown(key, known) { return startsKnown(key) || !!(known && known[key]); }

  // "12 × Timber" — or "?? × 1" for something the town hasn't discovered.
  function costLabel(key, qty, known) {
    var n = ' × ' + qty;
    return isKnown(key, known) ? icon(key) + ' ' + label(key) + n : '?? ' + n.trim();
  }

  // Where a resource comes from, in words (the discovery card, the Library).
  function sourceHint(key) {
    var d = BY_KEY[key];
    if (!d) return '';
    var parts = [];
    if (d.discovery === 'alloy') return 'Smelted at the Smelter';
    if (d.mine_level) parts.push('miners at a Lv' + d.mine_level + '+ Mine');
    if (d.terrain && d.terrain.length) parts.push(d.terrain.join(' / ') + ' outposts');
    return parts.length ? 'Found by ' + parts.join(' and ') : '';
  }

  var api = {
    DEFS: DEFS, KEYS: KEYS, BASE: BASE, EXTRA: EXTRA, TRADEABLE: TRADEABLE, GROUP_LABEL: GROUP_LABEL,
    def: def, isResource: isResource, label: label, icon: icon, startsKnown: startsKnown,
    knownSet: knownSet, isKnown: isKnown, costLabel: costLabel, sourceHint: sourceHint,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KWResources = api;
})(typeof window !== 'undefined' ? window : this);
