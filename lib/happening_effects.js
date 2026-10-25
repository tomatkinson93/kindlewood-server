// ══════════════════════════════════════════════════════════════════════════
//  happening_effects — what a Happening DOES while it runs (spec 021 §6.3+).
//
//  BYTE-IDENTICAL in two places — edit one, copy to the other:
//    kindlewood-server/lib/happening_effects.js   (module.exports)
//    kindlewood-frontend/js/happening-effects.js  (window.KWHappeningEffects)
//  Pure: no DOM, no DB, never reads the clock. Needs day_cycle (windows).
//
//  Effects:
//    { type: 'banner' }                            HUD list + start toast
//    { type: 'enemy_pool', add: [enemy ids] }      random encounters may pick them
//    { type: 'map_flourish', kind: <VISUALS id> }  cosmetic map effect (client)
//    { type: 'modifier', stat: <STATS id>, value } a game-stat change, + or −
//    { type: 'random_modifier', mood: 'any'|'good'|'bad' }
//        one stat + value picked per WINDOW, deterministically from the
//        Happening id and the window start — client and server pick the same
//        and it stays fixed for that window.
//
//  Modifier values: 'pct' stats are fractions (+0.2 = +20%); 'flat' stats
//  add directly (happiness points, chance). Several active modifiers on one
//  stat add up, then clamp to the stat's [min, max].
//
//  This replaces decision D7 (no economy multipliers): production is now
//  integrated over the exact offline span with averageFactor(), so a 2h
//  festival during a 10h absence boosts 2h, not 10h.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  var D = (typeof module !== 'undefined' && module.exports) ? require('./day_cycle') : root.KWDayCycle;

  // ── Visuals (drawn by the frontend map overlay) ──────────────────────────
  var VISUALS = {
    lanterns:          { label: 'Ground lanterns',     icon: '🏮', when: 'night', desc: 'Warm lantern lights around settlements.' },
    floating_lanterns: { label: 'Floating lanterns',   icon: '🏮', when: 'any',   desc: 'Paper sky lanterns drift up from every settlement.' },
    fireworks:         { label: 'Fireworks',           icon: '🎆', when: 'any',   desc: 'Bursts of colour over the settlements.' },
    purple_moon:       { label: 'Purple moon',         icon: '🟣', when: 'any',   desc: 'An eerie violet cast over the whole map.' },
    blood_moon:        { label: 'Blood moon',          icon: '🔴', when: 'any',   desc: 'A crimson cast over the whole map.' },
    golden_glow:       { label: 'Golden glow',         icon: '🌾', when: 'any',   desc: 'A warm harvest-gold cast over the map.' },
    aurora:            { label: 'Aurora',              icon: '🌌', when: 'night', desc: 'Shimmering green ribbons across the sky.' },
    fireflies:         { label: 'Fireflies',           icon: '✨', when: 'night', desc: 'Blinking motes around the settlements.' },
    will_o_wisps:      { label: "Will-o'-wisps",       icon: '👻', when: 'night', desc: 'Pale blue lights wandering the land.' },
    shooting_stars:    { label: 'Shooting stars',      icon: '🌠', when: 'night', desc: 'Streaks across the night sky.' },
    petals:            { label: 'Blossom petals',      icon: '🌸', when: 'any',   desc: 'Pink petals drifting across the map.' },
    mist:              { label: 'Rolling mist',        icon: '🌫', when: 'any',   desc: 'Low banks of fog drifting over the land.' },
  };

  // ── Stats a modifier can change ──────────────────────────────────────────
  // kind:  pct (fraction of the base) | flat (added)
  // min/max: clamp for the SUM of active modifiers on this stat
  // rand:  [lo, hi] magnitude a random_modifier may roll (sign by mood)
  // step:  rounding for random rolls
  // clock: wall (shared, economy — real time) | gameplay (per player)
  // where: what it touches (shown in the admin picker)
  var STATS = {
    all_production:    { label: 'All production',      group: 'Economy',  kind: 'pct',  min: -0.9, max: 2,   rand: [0.05, 0.15], step: 0.05, clock: 'wall', where: 'food, timber, stone, iron and wealth per hour' },
    food_production:   { label: 'Food production',     group: 'Economy',  kind: 'pct',  min: -0.9, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'wall', where: 'food per hour' },
    timber_production: { label: 'Timber production',   group: 'Economy',  kind: 'pct',  min: -0.9, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'wall', where: 'timber per hour' },
    stone_production:  { label: 'Stone production',    group: 'Economy',  kind: 'pct',  min: -0.9, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'wall', where: 'stone per hour' },
    metal_production:  { label: 'Iron production' ,    group: 'Economy',  kind: 'pct',  min: -0.9, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'wall', where: 'iron per hour' },
    wealth_production: { label: 'Wealth production',   group: 'Economy',  kind: 'pct',  min: -0.9, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'wall', where: 'wealth per hour' },
    food_upkeep:       { label: 'Food upkeep',         group: 'Economy',  kind: 'pct',  min: -0.75, max: 1,  rand: [0.1, 0.25],  step: 0.05, clock: 'wall', where: 'food each citizen eats', invert: true },
    happiness:         { label: 'Happiness',           group: 'Citizens', kind: 'flat', min: -30, max: 30,   rand: [3, 8],       step: 1,    clock: 'wall', where: 'every citizen\'s happiness (points)' },
    birth_chance:      { label: 'Birth chance',        group: 'Citizens', kind: 'flat', min: -0.2, max: 0.3, rand: [0.03, 0.1],  step: 0.01, clock: 'wall', where: 'chance a housed couple has a child each day' },
    bonding:           { label: 'Bonding',             group: 'Citizens', kind: 'pct',  min: -0.9, max: 2,   rand: [0.15, 0.4],  step: 0.05, clock: 'wall', where: 'how fast citizens grow closer' },
    quest_success:     { label: 'Quest success',       group: 'Quests',   kind: 'flat', min: -0.3, max: 0.3, rand: [0.03, 0.1],  step: 0.01, clock: 'gameplay', where: 'success chance of quests resolving now' },
    quest_duration:    { label: 'Quest duration',      group: 'Quests',   kind: 'pct',  min: -0.5, max: 1,   rand: [0.1, 0.25],  step: 0.05, clock: 'gameplay', where: 'length of quests started now', invert: true },
    quest_rewards:     { label: 'Quest rewards',       group: 'Quests',   kind: 'pct',  min: -0.9, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'gameplay', where: 'gold from quests collected now' },
    enemy_health:      { label: 'Enemy health',        group: 'Combat',   kind: 'pct',  min: -0.5, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'gameplay', where: 'enemy max HP in battles that start now', invert: true },
    enemy_strength:    { label: 'Enemy strength',      group: 'Combat',   kind: 'pct',  min: -0.5, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'gameplay', where: 'enemy strength in battles that start now', invert: true },
    enemy_agility:     { label: 'Enemy agility',       group: 'Combat',   kind: 'pct',  min: -0.5, max: 2,   rand: [0.1, 0.3],   step: 0.05, clock: 'gameplay', where: 'enemy agility in battles that start now', invert: true },
    party_strength:    { label: 'Party strength',      group: 'Combat',   kind: 'flat', min: -5, max: 5,     rand: [1, 2],       step: 1,    clock: 'gameplay', where: 'your citizens\' strength in battles that start now' },
    party_agility:     { label: 'Party agility',       group: 'Combat',   kind: 'flat', min: -5, max: 5,     rand: [1, 2],       step: 1,    clock: 'gameplay', where: 'your citizens\' agility in battles that start now' },
    party_endurance:   { label: 'Party endurance',     group: 'Combat',   kind: 'flat', min: -5, max: 5,     rand: [1, 2],       step: 1,    clock: 'gameplay', where: 'your citizens\' endurance in battles that start now' },
    rare_fish:         { label: 'Rare fish',           group: 'Fishing',  kind: 'pct',  min: -0.9, max: 3,   rand: [0.25, 0.75], step: 0.05, clock: 'gameplay', where: 'chance of rare + legendary catches' },
    junk_catch:        { label: 'Junk catches',        group: 'Fishing',  kind: 'pct',  min: -0.9, max: 3,   rand: [0.25, 0.75], step: 0.05, clock: 'gameplay', where: 'chance of reeling in junk', invert: true },
  };
  var STAT_IDS = Object.keys(STATS);
  var RESOURCES = ['food', 'timber', 'stone', 'metal', 'wealth'];
  var EFFECT_TYPES = ['banner', 'enemy_pool', 'map_flourish', 'modifier', 'random_modifier'];
  var ID_RE = /^[a-z0-9_]{2,40}$/;

  function roundTo(v, step) { return Math.round(v / step) * step; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── Validation (server saves + the admin form) ───────────────────────────
  function validateEffects(effects) {
    if (effects == null) return { ok: true, effects: [] };
    if (!Array.isArray(effects)) return { ok: false, error: 'effects must be an array.' };
    if (effects.length > 12) return { ok: false, error: 'At most 12 effects.' };
    var out = [];
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i], t = e && e.type;
      if (EFFECT_TYPES.indexOf(t) < 0) return { ok: false, error: 'Unknown effect type "' + t + '" (' + EFFECT_TYPES.join(', ') + ').' };
      if (t === 'banner') out.push({ type: t });
      if (t === 'enemy_pool') {
        var add = Array.isArray(e.add) ? e.add.map(String).filter(function (x, j, a) { return a.indexOf(x) === j; }) : [];
        if (!add.length || add.some(function (id) { return !ID_RE.test(id); })) return { ok: false, error: 'enemy_pool.add must list enemy ids (lowercase, underscores).' };
        out.push({ type: t, add: add.slice(0, 20) });
      }
      if (t === 'map_flourish') {
        if (!VISUALS[e.kind]) return { ok: false, error: 'map_flourish.kind must be one of: ' + Object.keys(VISUALS).join(', ') + '.' };
        out.push({ type: t, kind: e.kind });
      }
      if (t === 'modifier') {
        var s = STATS[e.stat], v = Number(e.value);
        if (!s) return { ok: false, error: 'modifier.stat must be one of: ' + STAT_IDS.join(', ') + '.' };
        if (!isFinite(v) || v === 0) return { ok: false, error: 'modifier.value for ' + e.stat + ' must be a non-zero number.' };
        if (v < s.min || v > s.max) return { ok: false, error: e.stat + ' value must be between ' + s.min + ' and ' + s.max + (s.kind === 'pct' ? ' (fractions: 0.2 = +20%)' : '') + '.' };
        out.push({ type: t, stat: e.stat, value: v });
      }
      if (t === 'random_modifier') {
        var mood = e.mood == null ? 'any' : e.mood;
        if (['any', 'good', 'bad'].indexOf(mood) < 0) return { ok: false, error: 'random_modifier.mood must be any, good or bad.' };
        out.push({ type: t, mood: mood });
      }
    }
    return { ok: true, effects: out };
  }

  // ── Deterministic random_modifier ────────────────────────────────────────
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // "Good" for the player: raising a normal stat, lowering an inverted one.
  function rollRandom(happeningId, windowStartMs, effectIndex, mood) {
    var rng = mulberry32(fnv(String(happeningId) + ':' + windowStartMs + ':' + effectIndex));
    var stat = STAT_IDS[Math.floor(rng() * STAT_IDS.length)];
    var s = STATS[stat];
    var mag = roundTo(s.rand[0] + rng() * (s.rand[1] - s.rand[0]), s.step) || s.step;
    var good = mood === 'good' ? true : mood === 'bad' ? false : rng() < 0.6;
    var sign = (good !== !!s.invert) ? 1 : -1;
    return { type: 'modifier', stat: stat, value: Number((sign * mag).toFixed(4)), random: true };
  }

  // The effects of h for the window starting at windowStartMs, with any
  // random_modifier replaced by its rolled modifier.
  function resolveEffects(h, windowStartMs) {
    var fx = (h && h.effects) || [], out = [];
    for (var i = 0; i < fx.length; i++) {
      out.push(fx[i].type === 'random_modifier' ? rollRandom(h.id, windowStartMs, i, fx[i].mood || 'any') : fx[i]);
    }
    return out;
  }

  function isLive(h) { return h && h.enabled !== false && !h.archived; }

  // [{ h, window, effects }] for Happenings running at ms (effects resolved).
  function activeAt(defs, ms) {
    var out = [];
    for (var i = 0; i < (defs || []).length; i++) {
      var h = defs[i];
      if (!isLive(h)) continue;
      var w = D.windowsBetween(h.rule, ms, ms + 1);
      if (w.length) out.push({ h: h, window: w[0], effects: resolveEffects(h, w[0].startMs) });
    }
    return out;
  }

  // { stat: summed value (clamped) } for every modifier active at ms.
  // filter(statId) → bool limits which stats are summed (e.g. by clock).
  function modifiersAt(defs, ms) {
    var sums = {};
    var act = activeAt(defs, ms);
    for (var i = 0; i < act.length; i++) {
      for (var j = 0; j < act[i].effects.length; j++) {
        var e = act[i].effects[j];
        if (e.type === 'modifier' && STATS[e.stat]) sums[e.stat] = (sums[e.stat] || 0) + e.value;
      }
    }
    for (var k in sums) sums[k] = clamp(sums[k], STATS[k].min, STATS[k].max);
    return sums;
  }

  // Multiplier for a resource's production from a modifier map:
  // (1 + resource pct + all_production pct), floored at 0.1.
  function productionFactor(mods, resource) {
    return Math.max(0.1, 1 + (mods[resource + '_production'] || 0) + (mods.all_production || 0));
  }

  // Time-weighted average of fn(modifiersAt(t)) over [fromMs, toMs]: the
  // span is cut at every window edge of every live Happening, and each
  // piece (constant modifiers) is weighted by its length. This is the
  // offline integration D7 asked for.
  function averageOver(defs, fromMs, toMs, fn) {
    if (!(toMs > fromMs)) return fn(modifiersAt(defs, fromMs));
    var cuts = [fromMs, toMs];
    for (var i = 0; i < (defs || []).length; i++) {
      if (!isLive(defs[i])) continue;
      var w = D.windowsBetween(defs[i].rule, fromMs, toMs);
      for (var j = 0; j < w.length; j++) {
        if (w[j].startMs > fromMs && w[j].startMs < toMs) cuts.push(w[j].startMs);
        if (w[j].endMs > fromMs && w[j].endMs < toMs) cuts.push(w[j].endMs);
      }
    }
    cuts.sort(function (a, b) { return a - b; });
    var acc = 0;
    for (var c = 0; c + 1 < cuts.length; c++) {
      var a = cuts[c], b = cuts[c + 1];
      if (b <= a) continue;
      acc += fn(modifiersAt(defs, (a + b) / 2)) * (b - a);
    }
    return acc / (toMs - fromMs);
  }
  function averageProductionFactor(defs, resource, fromMs, toMs) {
    return averageOver(defs, fromMs, toMs, function (m) { return productionFactor(m, resource); });
  }

  // ── Words ────────────────────────────────────────────────────────────────
  function describeModifier(stat, value) {
    var s = STATS[stat];
    if (!s) return stat;
    var sign = value > 0 ? '+' : '−', mag = Math.abs(value);
    var num = s.kind === 'pct' ? Math.round(mag * 100) + '%'
      : (s.max <= 1 ? Math.round(mag * 100) + '%' : String(Math.round(mag * 10) / 10));
    return sign + num + ' ' + s.label.toLowerCase();
  }
  function isGood(stat, value) { var s = STATS[stat]; return s ? ((value > 0) !== !!s.invert) : true; }
  function describeEffect(e) {
    if (!e) return '';
    if (e.type === 'banner') return 'Announced in the clock panel';
    if (e.type === 'enemy_pool') return 'Creatures roam: ' + e.add.join(', ');
    if (e.type === 'map_flourish') return (VISUALS[e.kind] ? VISUALS[e.kind].icon + ' ' + VISUALS[e.kind].label : e.kind);
    if (e.type === 'modifier') return describeModifier(e.stat, e.value) + (e.random ? ' (random)' : '');
    if (e.type === 'random_modifier') return '🎲 A random ' + (e.mood === 'good' ? 'blessing' : e.mood === 'bad' ? 'curse' : 'twist');
    return e.type;
  }

  var API = {
    VISUALS: VISUALS, STATS: STATS, STAT_IDS: STAT_IDS, RESOURCES: RESOURCES, EFFECT_TYPES: EFFECT_TYPES,
    validateEffects: validateEffects, rollRandom: rollRandom, resolveEffects: resolveEffects,
    activeAt: activeAt, modifiersAt: modifiersAt, productionFactor: productionFactor,
    averageOver: averageOver, averageProductionFactor: averageProductionFactor,
    describeModifier: describeModifier, describeEffect: describeEffect, isGood: isGood,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.KWHappeningEffects = API;
})(typeof window !== 'undefined' ? window : null);
