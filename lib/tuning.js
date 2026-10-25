// ══════════════════════════════════════════════════════════════════════════
//  tuning — balance multipliers Dev Tools can change live (career_tuning).
//
//    T(key)            the multiplier now (sync, from the cache; 1 if unknown)
//    refresh()         reload the cache (every 30 s, and after a save)
//    all()             [{ key, value, label, desc }]
//    set(key, value)   save one (0–5)
//
//  Keys: passive_xp (job XP per hour), craft_xp (XP per craft), discovery
//  (recipe discovery chance), research (research points), ore (ore found).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const KEYS = {
  passive_xp: { label: 'Job XP per hour',          desc: 'Experience every working citizen earns per hour.' },
  craft_xp:   { label: 'Crafting XP',              desc: 'Experience per finished craft or smelt.' },
  discovery:  { label: 'Recipe discovery chance',  desc: 'Chance a crafter works out a hidden recipe.' },
  research:   { label: 'Research speed',           desc: 'Research points Scholars earn.' },
  ore:        { label: 'Ore found',                desc: 'Ore from mines and outposts.' },
};
const REFRESH_MS = 30 * 1000;
let cache = {}, loadedAt = 0, loading = null;

function refresh() {
  if (loading) return loading;
  loading = query('SELECT key, value FROM career_tuning')
    .then(r => { cache = Object.fromEntries(r.rows.map(x => [x.key, Number(x.value)])); loadedAt = Date.now(); })
    .catch(() => {})
    .finally(() => { loading = null; });
  return loading;
}
function T(key) {
  if (Date.now() - loadedAt > REFRESH_MS) refresh();
  const v = cache[key];
  return typeof v === 'number' && isFinite(v) ? v : 1;
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

module.exports = { KEYS, T, refresh, all, set };
