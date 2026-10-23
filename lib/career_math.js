// ══════════════════════════════════════════════════════════════════════════
//  career_math — the numbers behind citizen careers (classes & skill trees).
//
//  BYTE-IDENTICAL in two places — edit one, copy to the other:
//    kindlewood-server/lib/career_math.js     (module.exports)
//    kindlewood-frontend/js/career-math.js    (window.KWCareerMath)
//  Pure: no DOM, no DB, never reads the clock (callers pass times in).
//
//  Levels 1–20 per class. Total XP to reach level L is 3.5·(L−1)^2.84:
//  Lv10 ≈ 1,800 (~a week full-time), Lv20 ≈ 15,000 (~2 months).
//  One perk point per level after the first; the fork is at Lv10 and the
//  capstone (free) at Lv20.
//
//  Effects: every perk, trait and piece of gear speaks the same small
//  vocabulary (EFFECTS). A citizen's effects add up per type[:param] and
//  clamp to the type's [min, max]. 'pct' values are fractions (+0.1 = +10%).
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  var MAX_LEVEL = 20;
  var FORK_LEVEL = 10;
  var XP_A = 3.5, XP_P = 2.84;
  var BASE_XP_PER_HOUR = 10;
  var HOURS_PER_YEAR = 28;          // one Kindlewood year (seasons.js)
  var STAT_CENTRE = 8;              // mean of rollStat(8, 5)

  // ── Levels ───────────────────────────────────────────────────────────────

  function xpForLevel(level) {
    var l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level) || 1));
    return Math.round(XP_A * Math.pow(l - 1, XP_P));
  }
  function levelForXp(xp) {
    var x = Number(xp) || 0, l = 1;
    while (l < MAX_LEVEL && x >= xpForLevel(l + 1)) l++;
    return l;
  }
  // Progress within the current level: { level, into, need, pct }.
  function levelProgress(xp) {
    var l = levelForXp(xp);
    if (l >= MAX_LEVEL) return { level: l, into: 0, need: 0, pct: 1 };
    var lo = xpForLevel(l), hi = xpForLevel(l + 1);
    return { level: l, into: (Number(xp) || 0) - lo, need: hi - lo, pct: ((Number(xp) || 0) - lo) / (hi - lo) };
  }
  function perkPoints(level) { return Math.max(0, Math.min(MAX_LEVEL, level) - 1); }

  function titleFor(level, classLabel, specLabel) {
    var name = specLabel || classLabel;
    if (level >= 20) return 'Master ' + name;
    if (level >= 15) return 'Expert ' + name;
    if (level >= 10) return name;
    if (level >= 5) return 'Journeyman ' + classLabel;
    return 'Apprentice ' + classLabel;
  }
  function serviceYears(hours) { return Math.floor((Number(hours) || 0) / HOURS_PER_YEAR); }

  // ── Effects ──────────────────────────────────────────────────────────────
  // kind 'pct': fraction; 'flat': plain number. param: what the effect needs
  // to name (a season, a skill, an item key…).

  var EFFECTS = {
    output:      { label: 'Work output',          kind: 'pct',  min: -0.6, max: 0.5 },
    season:      { label: 'Output in a season',   kind: 'pct',  min: 0,    max: 1,    param: 'season' },
    aura:        { label: 'Output for all classmates', kind: 'pct', min: 0, max: 0.25 },
    xp:          { label: 'Experience gained',    kind: 'pct',  min: -0.5, max: 0.75 },
    mentor:      { label: 'Apprentices learn faster', kind: 'pct', min: 0,  max: 1 },
    upkeep:      { label: 'Food eaten',           kind: 'pct',  min: -0.5, max: 0.5 },
    travel:      { label: 'Travel speed',         kind: 'pct',  min: -0.4, max: 0.5 },
    carry:       { label: 'Carrying capacity',    kind: 'pct',  min: -0.3, max: 0.5 },
    fee:         { label: 'Market fees',          kind: 'pct',  min: -0.5, max: 0.2 },
    max_orders:  { label: 'Sell orders',          kind: 'flat', min: 0,    max: 3 },
    merchants:   { label: 'Merchant slots',       kind: 'flat', min: 0,    max: 2 },
    stall_slots: { label: 'Stall slots',          kind: 'flat', min: 0,    max: 5 },
    reveal:      { label: 'Scouting reveal radius', kind: 'flat', min: 0,  max: 3 },
    envoy:       { label: 'Envoy speed',          kind: 'pct',  min: 0,    max: 0.5 },
    quest:       { label: 'Quest success',        kind: 'pct',  min: -0.2, max: 0.25, param: 'skill' },
    injury:      { label: 'Injury risk',          kind: 'flat', min: -30,  max: 30 },
    skill:       { label: 'Skill',                kind: 'flat', min: -3,   max: 5,    param: 'skill' },
    stat:        { label: 'Stat',                 kind: 'flat', min: -5,   max: 5,    param: 'stat' },
    happiness:   { label: 'Settlement happiness', kind: 'flat', min: 0,    max: 20 },
    mood:        { label: 'Own happiness',        kind: 'flat', min: -15,  max: 10 },
    find:        { label: 'Finds per day',        kind: 'flat', min: 0,    max: 6,    param: 'item' },
    npc_trust:   { label: 'Village trust per trade', kind: 'flat', min: 0, max: 2 },
    craft_speed: { label: 'Crafting speed',       kind: 'pct',  min: -0.3, max: 0.6 },
    quality:     { label: 'Craft quality',        kind: 'flat', min: -20,  max: 25 },
    refund:      { label: 'Chance to save materials', kind: 'pct', min: 0, max: 0.4 },
  };

  function effectKey(e) { return e.param ? e.type + ':' + e.param : e.type; }

  // [{ type, param?, value }] → { 'type[:param]': total } (clamped).
  function aggregate(list) {
    var out = {};
    (list || []).forEach(function (e) {
      if (!e || !EFFECTS[e.type]) return;
      var k = effectKey(e);
      out[k] = (out[k] || 0) + (Number(e.value) || 0);
    });
    Object.keys(out).forEach(function (k) {
      var def = EFFECTS[k.split(':')[0]];
      out[k] = Math.max(def.min, Math.min(def.max, out[k]));
      out[k] = Math.round(out[k] * 1000) / 1000;
    });
    return out;
  }
  function eff(totals, type, param) { return (totals && totals[param ? type + ':' + param : type]) || 0; }

  // "+10% Work output", "+1 Skill (combat)", "Finds per day: 0.5 iron ore".
  function describeEffect(e, names) {
    var def = EFFECTS[e.type];
    if (!def) return '';
    var v = Number(e.value) || 0;
    var sign = v > 0 ? '+' : v < 0 ? '−' : '';
    var amt = def.kind === 'pct' ? Math.round(Math.abs(v) * 100) + '%' : String(Math.round(Math.abs(v) * 100) / 100);
    var p = e.param ? ((names && names[e.param]) || String(e.param).replace(/_/g, ' ')) : '';
    if (e.type === 'find') return amt + ' ' + p + ' a day';
    if (e.type === 'season') return sign + amt + ' output in ' + p;
    if (e.type === 'skill' || e.type === 'stat') return sign + amt + ' ' + p;
    if (e.type === 'quest') return sign + amt + ' ' + p + ' quest success';
    if (e.type === 'quality') return sign + amt + ' craft quality';
    return sign + amt + ' ' + def.label.toLowerCase();
  }

  // ── Work & learning ──────────────────────────────────────────────────────

  // Stat scaling for job output, centred on the average roll.
  function outputMult(stats, cls) {
    if (!cls || !cls.primary) return 1;
    var s = stats || {};
    var p = Number(s[cls.primary]) || STAT_CENTRE, q = Number(s[cls.secondary]) || STAT_CENTRE;
    var m = 1 + (p - STAT_CENTRE) * 0.02 + (q - STAT_CENTRE) * 0.01;
    return Math.round(Math.max(0.8, Math.min(1.35, m)) * 1000) / 1000;
  }

  // Hours of [fromMs, toMs) that fall in the night phase (01:00–09:00 UTC).
  function nightHours(fromMs, toMs) {
    if (!(toMs > fromMs)) return 0;
    var DAY = 86400000, H = 3600000, total = 0;
    for (var d = Math.floor(fromMs / DAY) * DAY; d < toMs; d += DAY) {
      var a = Math.max(fromMs, d + H), b = Math.min(toMs, d + 9 * H);
      if (b > a) total += b - a;
    }
    return total / H;
  }

  // Passive XP per hour of work. ctx: { intelligence, traits: [ids],
  // aptitude, aversion, happiness, starving, mentor (bool), mentorBonus,
  // leaderAura (bool), familyTrade (bool), xp (effect total), nightShare }.
  // Returns { perHour, parts: [{ label, mult }] } — parts explain the rate.
  function passiveRate(ctx) {
    var c = ctx || {}, parts = [], m = 1;
    function add(label, mult) { if (mult !== 1) { parts.push({ label: label, mult: Math.round(mult * 1000) / 1000 }); m *= mult; } }
    var t = c.traits || [];
    add('Intelligence', 1 + ((Number(c.intelligence) || STAT_CENTRE) - STAT_CENTRE) * 0.03);
    if (t.indexOf('genius') >= 0) add('Genius', 1.25);
    if (t.indexOf('slow_learner') >= 0) add('Slow learner', 0.75);
    if (t.indexOf('night_worker') >= 0 && c.nightShare > 0) add('Night worker', 1 + 0.25 * Math.min(1, c.nightShare));
    if (c.aptitude) add(c.aptitudeKnown ? 'Natural talent' : 'Something clicks', 1.5);
    if (c.aversion) add(c.aversionKnown ? 'Bad fit' : 'Something is off', 0.75);
    var h = Number(c.happiness);
    if (isFinite(h)) add(h >= 80 ? 'Happy' : h >= 40 ? 'Content' : h >= 20 ? 'Unhappy' : 'Miserable', h >= 80 ? 1.1 : h >= 40 ? 1 : h >= 20 ? 0.75 : 0.5);
    if (c.mentor) add('Mentor', 1.2 + (Number(c.mentorBonus) || 0));
    if (c.leaderAura) add('Natural leader nearby', 1.1);
    if (c.familyTrade) add('Family trade', 1.1);
    if (c.xp) add('Perks', 1 + c.xp);
    if (c.starving) { parts.push({ label: 'Starving', mult: 0 }); m = 0; }
    return { perHour: Math.round(BASE_XP_PER_HOUR * m * 1000) / 1000, parts: parts };
  }

  // Class level lifts the matching old skill (1–10); never lowers it.
  function syncedSkill(current, level) {
    return Math.min(10, Math.max(Number(current) || 1, Math.floor((Number(level) || 1) / 2)));
  }

  // ── Crafting quality ─────────────────────────────────────────────────────
  // roll = score + d100 (uniform 0–100), banded. Legendary needs Lv15+ and
  // the recipe's cap. Odds are exact (no simulation), so the UI can show them.
  var QUALITIES = ['basic', 'sturdy', 'fine', 'superior', 'legendary'];
  var QUALITY_LABEL = { basic: 'Basic', sturdy: 'Sturdy', fine: 'Fine', superior: 'Superior', legendary: 'Legendary' };
  var QUALITY_FROM = { sturdy: 50, fine: 80, superior: 105, legendary: 130 };
  var QUALITY_STAT_MULT = { basic: 1, sturdy: 1.25, fine: 1.5, superior: 2, legendary: 2.5 };
  var QUALITY_VALUE_MULT = { basic: 1, sturdy: 1.4, fine: 2, superior: 3, legendary: 5 };
  var QUALITY_XP_MULT = { basic: 1, sturdy: 1.2, fine: 1.5, superior: 2, legendary: 3 };

  // Score before the roll. c: { level, minLevel, primary (stat), quality
  // (effect total), tool (crafting skill from gear), station (level) }.
  function qualityScore(c) {
    return Math.max(0, (Number(c.level) || 1) - (Number(c.minLevel) || 1)) * 2
      + ((Number(c.primary) || STAT_CENTRE) - STAT_CENTRE) * 1.5
      + (Number(c.quality) || 0) + Math.min(5, Number(c.tool) || 0) * 3 + (Number(c.station) || 1) * 2;
  }
  // Chance of each quality: { basic, sturdy, … } summing to 1.
  function qualityOdds(score, cap, level) {
    var top = QUALITIES.indexOf(cap || 'legendary');
    if (top < 0) top = 4;
    if ((Number(level) || 1) < 15) top = Math.min(top, 3);
    var reach = function (t) { return Math.max(0, Math.min(1, (score + 100 - t) / 100)); };
    var out = {}, prev = 1;
    for (var i = 1; i <= 4; i++) {
      var q = QUALITIES[i], p = i <= top ? reach(QUALITY_FROM[q]) : 0;
      out[QUALITIES[i - 1]] = Math.max(0, prev - p);
      prev = p;
    }
    out.legendary = top >= 4 ? prev : 0;
    if (top < 4) out[QUALITIES[top]] += prev;
    return out;
  }
  function rollQuality(score, cap, level, u) {
    var odds = qualityOdds(score, cap, level), acc = 0;
    for (var i = 0; i < QUALITIES.length; i++) { acc += odds[QUALITIES[i]]; if (u < acc) return QUALITIES[i]; }
    for (var j = QUALITIES.length - 1; j > 0; j--) if (odds[QUALITIES[j]] > 0) return QUALITIES[j];
    return 'basic';
  }
  // Seconds for one craft.
  function craftSeconds(base, speed, statMult) {
    return Math.max(30, Math.round((Number(base) || 60) / ((1 + (Number(speed) || 0)) * (Number(statMult) || 1))));
  }

  // ── Trees ────────────────────────────────────────────────────────────────
  // node: { id, name, branch: 'trunk' | <spec>, tier (level needed), lane,
  //         maxRank, requires: [ids], effects: [{ type, param?, per }],
  //         capstone?, secret? (hidden trait id), retired? }
  // row:  { level, spec, nodes: { id: rank }, retrain_until? }

  function spentPoints(tree, nodes) {
    var byId = {};
    (tree || []).forEach(function (n) { byId[n.id] = n; });
    var s = 0;
    Object.keys(nodes || {}).forEach(function (id) {
      var n = byId[id];
      if (n && !n.retired && !n.capstone) s += Math.min(n.maxRank || 1, Number(nodes[id]) || 0);
    });
    return s;
  }
  function freePoints(tree, row) {
    return perkPoints(row.level) - spentPoints(tree, row.nodes);
  }

  // Why a node can't be bought, or null. ctx: { revealed: [trait ids], now }.
  function buyBlocker(tree, row, nodeId, ctx) {
    var n = (tree || []).filter(function (x) { return x.id === nodeId; })[0];
    if (!n || n.retired) return 'No such perk.';
    if (n.capstone) return 'Capstones come free at level 20.';
    if (row.retrain_until && ctx && ctx.now && Date.parse(row.retrain_until) > ctx.now) return 'Still retraining.';
    if (n.branch !== 'trunk' && n.branch !== row.spec) return row.spec ? 'That path was not chosen.' : 'Choose a path at level ' + FORK_LEVEL + ' first.';
    if (n.secret && !((ctx && ctx.revealed) || []).some(function (t) { return t === n.secret; })) return 'A hidden talent unlocks this.';
    if (row.level < n.tier) return 'Needs level ' + n.tier + '.';
    var have = Number((row.nodes || {})[n.id]) || 0;
    if (have >= (n.maxRank || 1)) return 'Already mastered.';
    for (var i = 0; i < (n.requires || []).length; i++) {
      if (!(Number((row.nodes || {})[n.requires[i]]) > 0)) return 'Needs an earlier perk first.';
    }
    if (freePoints(tree, row) < 1) return 'No perk points left.';
    return null;
  }

  // Effects a class row grants: [{ type, param, value, source }].
  function nodeEffects(tree, row) {
    var out = [];
    (tree || []).forEach(function (n) {
      if (n.retired) return;
      if (n.branch !== 'trunk' && n.branch !== row.spec) return;
      var rank = n.capstone ? (row.level >= MAX_LEVEL ? 1 : 0) : Math.min(n.maxRank || 1, Number((row.nodes || {})[n.id]) || 0);
      if (!rank) return;
      (n.effects || []).forEach(function (e) {
        out.push({ type: e.type, param: e.param, value: (Number(e.per) || 0) * rank, source: n.name });
      });
    });
    return out;
  }

  var api = {
    MAX_LEVEL: MAX_LEVEL, FORK_LEVEL: FORK_LEVEL, BASE_XP_PER_HOUR: BASE_XP_PER_HOUR,
    HOURS_PER_YEAR: HOURS_PER_YEAR, STAT_CENTRE: STAT_CENTRE, EFFECTS: EFFECTS,
    xpForLevel: xpForLevel, levelForXp: levelForXp, levelProgress: levelProgress, perkPoints: perkPoints,
    titleFor: titleFor, serviceYears: serviceYears,
    effectKey: effectKey, aggregate: aggregate, eff: eff, describeEffect: describeEffect,
    outputMult: outputMult, nightHours: nightHours, passiveRate: passiveRate, syncedSkill: syncedSkill,
    spentPoints: spentPoints, freePoints: freePoints, buyBlocker: buyBlocker, nodeEffects: nodeEffects,
    QUALITIES: QUALITIES, QUALITY_LABEL: QUALITY_LABEL, QUALITY_FROM: QUALITY_FROM,
    QUALITY_STAT_MULT: QUALITY_STAT_MULT, QUALITY_VALUE_MULT: QUALITY_VALUE_MULT, QUALITY_XP_MULT: QUALITY_XP_MULT,
    qualityScore: qualityScore, qualityOdds: qualityOdds, rollQuality: rollQuality, craftSeconds: craftSeconds,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KWCareerMath = api;
})(typeof window !== 'undefined' ? window : this);
