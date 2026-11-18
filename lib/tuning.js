// ══════════════════════════════════════════════════════════════════════════
//  tuning — balance multipliers Dev Tools can change live (career_tuning).
//
//    T(key)            the multiplier now (sync, from the cache; 1 if unknown)
//    refresh()         reload the cache (every 30 s, and after a save)
//    all()             [{ key, value, label, desc }]
//    set(key, value)   save one (0–5)
//
//  Keys: passive_xp (job XP per hour), craft_xp (XP per craft), discovery
//  (recipe discovery chance), research (research points), ore (ore found),
//  build_work (the work a construction site needs; lib/construction.js).
//
//  setSwitch(key, on) turns a feature switch on or off (Dev Tools).
//
//  Life numbers (docs/PHASE_1_LIFE_CYCLE.md §2, §8) are not multipliers: each
//  has its own default and bounds and is stored in life_tuning (career_tuning
//  only takes 0–5). value(key) gives the override or null; lifeAll() / setLife() /
//  resetLife() are for Dev Tools. lib/life.js, settlers.js and inheritance.js
//  read them through live CONFIG getters.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const KEYS = {
  passive_xp: { label: 'Job XP per hour',          desc: 'Experience every working citizen earns per hour.' },
  craft_xp:   { label: 'Crafting XP',              desc: 'Experience per finished craft or smelt.' },
  discovery:  { label: 'Recipe discovery chance',  desc: 'Chance a crafter works out a hidden recipe.' },
  research:   { label: 'Research speed',           desc: 'Research points Scholars earn.' },
  ore:        { label: 'Ore found',                desc: 'Ore from mines and outposts.' },
  build_work: { label: 'Building work',            desc: 'How much work a new site needs (builder-minutes). Applies to sites ordered from now on.' },
};
// Life numbers: { default, min, max, step, label, desc, group }.
const LIFE_KEYS = {
  YOUTH_FROM:      { default: 7,    min: 2,    max: 15,  step: 1,    group: 'Ages',     label: 'Youth from',           desc: 'Age a child starts learning a trade.' },
  ADULT_FROM:      { default: 12,   min: 6,    max: 25,  step: 1,    group: 'Ages',     label: 'Grown up at',          desc: 'Age a youth comes of age and works full time.' },
  ELDER_FROM:      { default: 60,   min: 30,   max: 120, step: 1,    group: 'Ages',     label: 'Elder from',           desc: 'Age a citizen starts working at part strength.' },
  DEATH_FROM:      { default: 70,   min: 30,   max: 150, step: 1,    group: 'Death',    label: 'Deaths begin',         desc: 'First birthday with a chance of a peaceful death.' },
  DEATH_BASE:      { default: 0.06, min: 0,    max: 1,   step: 0.01, group: 'Death',    label: 'Chance at first',      desc: 'Chance of death on that first birthday.' },
  DEATH_STEP:      { default: 0.03, min: 0,    max: 0.5, step: 0.01, group: 'Death',    label: 'More each year',       desc: 'Added to the chance for every year after.' },
  DEATH_MAX:       { default: 0.6,  min: 0,    max: 1,   step: 0.01, group: 'Death',    label: 'Chance at most',       desc: 'The yearly chance never goes above this.' },
  FERTILE_FROM:    { default: 14,   min: 6,    max: 40,  step: 1,    group: 'Families', label: 'Fertile from',         desc: 'Both partners must be at least this old.' },
  FERTILE_TO:      { default: 55,   min: 20,   max: 120, step: 1,    group: 'Families', label: 'Fertile until',        desc: 'Neither partner may be older.' },
  BIRTH_GAP_YEARS: { default: 2,    min: 0,    max: 10,  step: 0.5,  group: 'Families', label: 'Years between children', desc: "Gap between a couple's children." },
  MAX_CHILDREN:    { default: 4,    min: 0,    max: 12,  step: 1,    group: 'Families', label: 'Children per couple',  desc: 'A couple has no more than this.' },
  SETTLER_EVERY_DAYS: { default: 7, min: 1,    max: 60,  step: 1,    group: 'Settlers', label: 'Settler every (days)', desc: 'While a bed is free.' },
  SETTLER_RESCUE_BELOW: { default: 6, min: 0,  max: 40,  step: 1,    group: 'Settlers', label: 'Rescue below',         desc: 'Fewer working adults than this: a settler the next day.' },
  HEIR_CHOOSE_HOURS: { default: 24, min: 0,    max: 168, step: 1,    group: 'Inheritance', label: 'Hours to choose an heir', desc: 'Then the default heir inherits by itself.' },
  // Upkeep (docs/HOME_SCENE.md Part E; lib/upkeep.js).
  UPKEEP_PER_BUILDER:   { default: 8, min: 1, max: 60, step: 1,   group: 'Upkeep', label: 'Buildings per builder', desc: 'How many buildings one builder looks after.' },
  UPKEEP_DAYS_TO_BREAK: { default: 5, min: 0.5, max: 60, step: 0.5, group: 'Upkeep', label: 'Days to break',       desc: 'Real days for a sound building nobody looks after to become broken.' },
  // Dungeons (docs/DUNGEONS.md §4; lib/dungeons.js, lib/dungeon_defs.js). Health
  // and strength are added to every creature in a dungeon of that skull
  // (0.5 = +50%); agility rises by half the strength figure. A change applies
  // to fights started from then on: a fight under way keeps its numbers.
  DUNGEON_HP_GREEN:   { default: 0.50, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🟢 Green: creature health',    desc: 'Added to creature health in an Easy dungeon (0.5 = +50%).' },
  DUNGEON_STR_GREEN:  { default: 0.40, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🟢 Green: creature strength',  desc: 'Added to creature strength in an Easy dungeon.' },
  DUNGEON_HP_YELLOW:  { default: 0.75, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🟡 Yellow: creature health',   desc: 'Added to creature health in a Moderate dungeon.' },
  DUNGEON_STR_YELLOW: { default: 0.60, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🟡 Yellow: creature strength', desc: 'Added to creature strength in a Moderate dungeon.' },
  DUNGEON_HP_ORANGE:  { default: 1.00, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🟠 Orange: creature health',   desc: 'Added to creature health in a Hard dungeon.' },
  DUNGEON_STR_ORANGE: { default: 0.80, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🟠 Orange: creature strength', desc: 'Added to creature strength in a Hard dungeon.' },
  DUNGEON_HP_RED:     { default: 1.25, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🔴 Red: creature health',      desc: 'Added to creature health in a Deadly dungeon.' },
  DUNGEON_STR_RED:    { default: 1.00, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🔴 Red: creature strength',    desc: 'Added to creature strength in a Deadly dungeon.' },
  DUNGEON_HP_PURPLE:  { default: 1.75, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🟣 Purple: creature health',   desc: 'Added to creature health in a Nightmare dungeon.' },
  DUNGEON_STR_PURPLE: { default: 1.40, min: 0, max: 5, step: 0.05, group: 'Dungeons', label: '🟣 Purple: creature strength', desc: 'Added to creature strength in a Nightmare dungeon.' },
  DUNGEON_REST:       { default: 0.30, min: 0, max: 1, step: 0.05, group: 'Dungeons', label: 'Rest heals',                  desc: 'Share of full health a rest room gives back.' },
  DUNGEON_FLEE_KEEP:  { default: 0.50, min: 0, max: 1, step: 0.05, group: 'Dungeons', label: 'Loot kept when fleeing',      desc: 'Share of the run loot a party keeps when it flees a fight.' },
  DUNGEON_IDLE_HOURS: { default: 24,   min: 1, max: 168, step: 1,  group: 'Dungeons', label: 'Idle hours',                  desc: 'A run nobody touches for this long ends by itself.' },
};

const REFRESH_MS = 30 * 1000;
let cache = {}, lifeCache = {}, loadedAt = 0, loading = null;

function refresh() {
  if (loading) return loading;
  loading = Promise.all([
    query('SELECT key, value FROM career_tuning').then(r => { cache = Object.fromEntries(r.rows.map(x => [x.key, Number(x.value)])); }).catch(() => {}),
    query('SELECT key, value FROM life_tuning').then(r => { lifeCache = Object.fromEntries(r.rows.map(x => [x.key, Number(x.value)])); }).catch(() => {}),
  ]).then(() => { loadedAt = Date.now(); })
    .finally(() => { loading = null; });
  return loading;
}
function T(key) {
  if (Date.now() - loadedAt > REFRESH_MS) refresh();
  const v = cache[key];
  return typeof v === 'number' && isFinite(v) ? v : 1;
}
// A life number's override, or null (callers fall back to the default).
function value(key) {
  if (Date.now() - loadedAt > REFRESH_MS) refresh();
  const v = lifeCache[key];
  return typeof v === 'number' && isFinite(v) ? v : null;
}
async function lifeAll() {
  await refresh();
  return Object.entries(LIFE_KEYS).map(([k, d]) => ({ key: k, ...d, value: value(k) ?? d.default, changed: value(k) != null && value(k) !== d.default }));
}
async function setLife(key, raw) {
  const d = LIFE_KEYS[key];
  const v = Number(raw);
  if (!d) { const e = new Error('Unknown life number.'); e.status = 400; throw e; }
  if (!isFinite(v) || v < d.min || v > d.max) { const e = new Error(`${d.label} must be between ${d.min} and ${d.max}.`); e.status = 400; throw e; }
  await query(`INSERT INTO life_tuning (key, value, updated_at) VALUES ($1,$2,NOW())
               ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, [key, Math.round(v * 1000) / 1000]);
  loadedAt = 0;
  await refresh();
  return lifeAll();
}
async function resetLife(key = null) {
  if (key && !LIFE_KEYS[key]) { const e = new Error('Unknown life number.'); e.status = 400; throw e; }
  if (key) await query('DELETE FROM life_tuning WHERE key = $1', [key]);
  // Only the numbers: the switches (building time, upkeep) live in the same table and are not numbers to reset.
  else await query('DELETE FROM life_tuning WHERE key = ANY($1::text[])', [Object.keys(LIFE_KEYS)]);
  loadedAt = 0;
  await refresh();
  return lifeAll();
}

async function all() {
  await refresh();
  return Object.keys(KEYS).map(k => ({ key: k, value: T(k), ...KEYS[k] }));
}
async function set(key, value) {
  const v = Number(value);
  if (!KEYS[key]) { const e = new Error('Unknown tuning key.'); e.status = 400; throw e; }
  if (!isFinite(v) || v < 0 || v > 5) { const e = new Error('Value must be between 0 and 5.'); e.status = 400; throw e; }
  await query(`INSERT INTO career_tuning (key, value, updated_at) VALUES ($1,$2,NOW())
               ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, [key, Math.round(v * 1000) / 1000]);
  loadedAt = 0;
  await refresh();
  return all();
}

// ── Switches: features shipped off, turned on from Dev Tools when ready ─────
// Stored in life_tuning as 1 (on) or absent/0 (off). Not listed among the
// life numbers. `construction.on`: building time with builders
// (docs/HOME_SCENE.md step 12); off until that step is built and reviewed.
const SWITCHES = {
  'construction.on': { default: 0, label: 'Building time (builders)', desc: 'Buildings take time and need a builder (HOME_SCENE.md Part D).' },
  'upkeep.on':       { default: 0, label: 'Upkeep (building health)', desc: 'Buildings nobody looks after wear and break (HOME_SCENE.md Part E).' },
  // On while the game is in closed testing; turn it off before real players arrive.
  // Dungeons (docs/DUNGEONS.md): off until they are ready for players. While
  // off, only admins can start or play a run (from Dev Tools).
  'dungeons.on':     { default: 0, label: 'Dungeons', desc: 'Players can enter dungeons. While off, only admins can, from Dev Tools (docs/DUNGEONS.md).' },
  'test_login.on':   { default: 1, label: 'Test accounts (login screen button)', desc: 'A button on the login screen that makes a fresh account, deleted on sign-out (lib/test_accounts.js).' },
};
// Is a switch on? Reads the store afresh (switches change rarely and are
// read rarely, so a stale cache must never hide a change).
async function switchOn(key) {
  if (!SWITCHES[key]) return false;
  await refresh();
  const v = lifeCache[key];
  return typeof v === 'number' && isFinite(v) ? v >= 1 : !!SWITCHES[key].default;
}

async function setSwitch(key, on) {
  if (!SWITCHES[key]) { const e = new Error('Unknown switch.'); e.status = 400; throw e; }
  await query(`INSERT INTO life_tuning (key, value, updated_at) VALUES ($1,$2,NOW())
               ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`, [key, on ? 1 : 0]);
  loadedAt = 0;
  await refresh();
  return switchOn(key);
}

module.exports = { KEYS, LIFE_KEYS, SWITCHES, T, value, refresh, all, set, lifeAll, setLife, resetLife, switchOn, setSwitch };
