// ═══════════════════════════════════════════════════════════════════════════
//  Weather (docs/HOME_SCENE.md Part F, F.5; step 21).
//
//  Looks only: nothing in the game reads the weather. The server rolls it so
//  every device shows the same sky.
//
//  A game day (dawn to dawn, as lib/social.js gameDay) has one word for the
//  day, `today` (clear, cloudy, rain, or snow in winter), and four spells of
//  six hours each. A clear day may cloud over for a spell; a wet day is wet
//  for at least one spell and cloudy for the rest, so it never rains for a
//  whole real day. The roll is seeded by the town and the day: no table, no
//  tick, the same answer every time it is asked.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const { seasonAt } = require('../seasons');

const DAY_MS = 86400e3;
const CONFIG = {
  DAWN_HOUR: 9,            // as lib/social.js: a day turns at 09:00 UTC
  SPELLS: 4,
  // Chance of a clear, a cloudy and a wet day, by season.
  ODDS: { spring: [0.45, 0.30, 0.25], summer: [0.60, 0.25, 0.15], autumn: [0.35, 0.35, 0.30], winter: [0.35, 0.30, 0.35] },
  CLEAR_STAYS: 0.8,        // a spell of a clear day is clear
  CLOUD_STAYS: 0.75,       // a spell of a cloudy day is cloudy
  WET_FALLS: 0.55,         // a spell of a wet day is wet
};
const KINDS = ['clear', 'cloudy', 'rain', 'snow'];
const LABEL = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow' };

// A small seeded generator (mulberry32) for a town's day. Pure.
function rng(sid, day) {
  let a = (Math.imul(Number(sid) | 0, 0x9E3779B1) ^ Math.imul(Number(day) | 0, 0x85EBCA6B) ^ 0x5bd1e995) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dayOfMs = now => Math.floor((now - CONFIG.DAWN_HOUR * 3600e3) / DAY_MS);
const startOf = day => day * DAY_MS + CONFIG.DAWN_HOUR * 3600e3;

// One day's weather. → { today, spells: [kind × 4] }. Pure.
function roll(sid, day, seasonId) {
  const r = rng(sid, day), o = CONFIG.ODDS[seasonId] || CONFIG.ODDS.summer, wet = seasonId === 'winter' ? 'snow' : 'rain';
  const x = r(), today = x < o[0] ? 'clear' : x < o[0] + o[1] ? 'cloudy' : wet;
  const n = CONFIG.SPELLS, each = f => Array.from({ length: n }, f);
  let spells;
  if (today === 'clear') spells = each(() => (r() < CONFIG.CLEAR_STAYS ? 'clear' : 'cloudy'));
  else if (today === 'cloudy') spells = each(() => (r() < CONFIG.CLOUD_STAYS ? 'cloudy' : 'clear'));
  else {
    spells = each(() => (r() < CONFIG.WET_FALLS ? wet : 'cloudy'));
    if (!spells.includes(wet)) spells[Math.floor(r() * n)] = wet;
  }
  return { today, spells };
}
// A town's weather at a moment: the day, its spells, the one it is in, and
// the one before it (rain leaves puddles and snow lies for a spell after).
function at(sid, now = Date.now()) {
  const day = dayOfMs(now), starts = startOf(day), spellMs = DAY_MS / CONFIG.SPELLS;
  const d = roll(sid, day, seasonAt(starts).id);
  const i = Math.min(CONFIG.SPELLS - 1, Math.max(0, Math.floor((now - starts) / spellMs)));
  const y = roll(sid, day - 1, seasonAt(startOf(day - 1)).id);
  return {
    day, today: d.today, spells: d.spells, starts: new Date(starts).toISOString(), spell_ms: spellMs,
    before: y.spells[CONFIG.SPELLS - 1],
    now: d.spells[i], was: i > 0 ? d.spells[i - 1] : y.spells[CONFIG.SPELLS - 1],
  };
}
// "Rain today, clearing by evening" for the news. Pure.
function line(w) {
  if (!w) return '';
  const wet = w.spells.find(k => k === 'rain' || k === 'snow');
  if (w.today === 'clear') return w.spells.includes('cloudy') ? 'A clear day with some cloud.' : 'A clear day.';
  if (w.today === 'cloudy') return w.spells.includes('clear') ? 'Cloudy, with the sun breaking through now and then.' : 'A grey, cloudy day.';
  const n = w.spells.filter(k => k === wet).length;
  return wet === 'snow' ? (n >= 3 ? 'Snow for most of the day.' : 'Snow showers.') : (n >= 3 ? 'Rain for most of the day.' : 'Showers.');
}

module.exports = { CONFIG, KINDS, LABEL, roll, at, line, _rng: rng, _dayOfMs: dayOfMs, _startOf: startOf };
