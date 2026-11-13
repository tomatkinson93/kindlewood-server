// ══════════════════════════════════════════════════════════════════════════
//  Timed town effects (migrations/0NN_town_effects.sql): what a moment leaves
//  behind for a while. lib/town_mods adds the ones in force to a town's mods
//  (production only for the hours each overlapped); simulation.js adds
//  birth_chance hour by hour.
//
//    add(q, sid, { key, label, mods, startsAt?, endsAt })
//    recent(db, sid, now)        effects that ended no more than 30 days ago
//    modsAt(rows, at)            the summed mods in force at `at`
//    overlap(rows, key, from, to) a mod weighted by its share of [from, to]
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query } = require('../db');

const KEYS = ['all_production', 'food_production', 'timber_production', 'stone_production', 'metal_production', 'wealth_production', 'happiness', 'food_upkeep', 'birth_chance'];
const PRODUCTION = KEYS.filter(k => k.endsWith('_production'));
const ms = v => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

async function add(q, sid, { key, label, mods, startsAt = Date.now(), endsAt }) {
  q = q || query;
  const clean = {};
  for (const k of KEYS) if (mods && Number(mods[k])) clean[k] = Number(mods[k]);
  await q(`INSERT INTO town_effects (settlement_id, key, label, mods, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [sid, key, label, JSON.stringify(clean), new Date(ms(startsAt)).toISOString(), new Date(ms(endsAt)).toISOString()]);
}
async function recent(db, sid, now = Date.now()) {
  const run = db ? (t, p) => db.query(t, p) : query;
  try {
    return (await run(`SELECT key, label, mods, starts_at, ends_at FROM town_effects WHERE settlement_id = $1 AND ends_at > $2 ORDER BY starts_at`,
      [sid, new Date(now - 30 * 24 * 3600e3).toISOString()])).rows;
  } catch (e) { return []; }   // pre-migration
}
const live = (r, at) => ms(r.starts_at) <= at && at < ms(r.ends_at);
function modsAt(rows, at) {
  const out = {};
  for (const r of rows || []) if (live(r, at)) for (const [k, v] of Object.entries(r.mods || {})) out[k] = (out[k] || 0) + Number(v);
  return out;
}
function overlap(rows, key, from, to) {
  const span = Math.max(1, to - from);
  let v = 0;
  for (const r of rows || []) {
    const m = Number((r.mods || {})[key]) || 0;
    if (!m) continue;
    const o = Math.max(0, Math.min(to, ms(r.ends_at)) - Math.max(from, ms(r.starts_at)));
    v += m * (o / span);
  }
  return v;
}
module.exports = { KEYS, PRODUCTION, add, recent, modsAt, overlap, live };
