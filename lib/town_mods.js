// ══════════════════════════════════════════════════════════════════════════
//  town_mods — a town's own bonuses and upkeep, on top of the realm-wide
//  Happenings (lib/happening_effects): a festival, finished wonders
//  (lib/wonders), and what the treasury pays each hour.
//
//  load(db, settlement, now) → {
//    festival:  { active, started_at, until, cooldown_until, cost, can_start, why }
//    mods:      { all_production, food_production, food_upkeep, happiness }  (HFX keys)
//    effects:   { craft_speed, quality, research, market_fee, carry }        (research keys)
//    upkeep:    { wonders, city, total }   wealth per hour
//    arrears:   true while upkeep went unpaid (wonder bonuses off, happiness −10)
//    watch:     { level, posted, slots, defence }  the Watchtower (lib/watchtower)
//    sources:   [{ key, label, … }]   for the breakdown and the town panel
//  }
//  productionFactors(t, fromMs, toMs) → { food: ×, timber: ×, … } over an
//  interval (a festival only counts for the hours it overlapped).
//
//  Upkeep: each finished wonder WONDER_UPKEEP/hr; in a City each building
//  level above 3 costs CITY_UPKEEP_PER_LEVEL/hr. Charged by the settlement
//  tick (routes/game.js applyTick) as wealth; the treasury never goes below 0.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const { TIER_ORDER } = require('../buildings');

const BASIC = ['food', 'timber', 'stone', 'metal', 'wealth'];
const FESTIVAL = { hours: 24, cooldown_hours: 72, happiness: 10, production: 0.10 };
const WONDER_UPKEEP = 12;
const CITY_UPKEEP_PER_LEVEL = 2;
const CITY_FREE_LEVELS = 3;
const ARREARS_HAPPINESS = -10;
const H = 3600 * 1000;

function festivalCost(tier) {
  const n = Math.max(0, TIER_ORDER.indexOf(tier || 'camp')) + 1;
  return { wealth: 150 * n, food: 100 * n };
}

// Finished wonders and their bonuses (lib/wonders; none before it exists).
async function wonderParts(db, sid) {
  try { return await require('./wonders').townBonuses(db, sid); }
  catch (e) { return { finished: [], mods: {}, effects: {}, upkeep_mult: 1 }; }
}

async function load(db, s, now = Date.now()) {
  db = db || { query };
  const t = { festival: null, mods: {}, effects: {}, upkeep: { wonders: 0, city: 0, total: 0 }, arrears: !!s.arrears_since, sources: [] };
  const add = (obj, k, v) => { if (v) obj[k] = (obj[k] || 0) + v; };

  // Festival
  const until = s.festival_until ? Date.parse(s.festival_until) : 0;
  const cool = s.festival_cooldown_until ? Date.parse(s.festival_cooldown_until) : 0;
  const active = until > now;
  const cost = festivalCost(s.tier);
  const short = Object.entries(cost).find(([r, v]) => (Number(s[r]) || 0) < v);
  t.festival = {
    active, started_at: s.festival_started_at, until: active ? new Date(until).toISOString() : null,
    cooldown_until: cool > now ? new Date(cool).toISOString() : null, cost,
    can_start: !active && cool <= now && !short,
    why: active ? 'A festival is already under way.' : cool > now ? 'The town is still recovering from the last one.' : short ? `Not enough ${short[0] === 'metal' ? 'iron' : short[0]}.` : null,
    hours: FESTIVAL.hours, cooldown_hours: FESTIVAL.cooldown_hours, happiness: FESTIVAL.happiness, production: FESTIVAL.production,
  };
  if (active) {
    add(t.mods, 'happiness', FESTIVAL.happiness);
    add(t.mods, 'all_production', FESTIVAL.production);
    t.sources.push({ key: 'festival', label: '🎉 Festival', all_production: FESTIVAL.production, happiness: FESTIVAL.happiness });
  }

  // Wonders: bonuses only while upkeep is paid.
  const w = await wonderParts(db, s.id);
  if (w.finished.length) {
    t.upkeep.wonders = Math.round(w.finished.length * WONDER_UPKEEP * (w.upkeep_mult ?? 1) * 100) / 100;
    if (!t.arrears) {
      for (const [k, v] of Object.entries(w.mods || {})) add(t.mods, k, v);
      for (const [k, v] of Object.entries(w.effects || {})) add(t.effects, k, v);
      for (const f of w.finished) t.sources.push({ key: 'wonder:' + f.key, label: `${f.icon} ${f.label}`, ...(f.mods || {}), ...(f.effects || {}) });
    }
  }

  // Watchtower: each Guard or Archer on watch +1 happiness (lib/watchtower).
  try {
    const wt = await require('./watchtower').state(db, s.id);
    t.watch = { level: wt.level, posted: wt.posted.length, slots: wt.slots, defence: wt.defence };
    if (wt.happiness) {
      add(t.mods, 'happiness', wt.happiness);
      t.sources.push({ key: 'watchtower', label: '🗼 Watchtower', happiness: wt.happiness });
    }
  } catch (e) { /* pre-migration */ }

  // Clan boons bought from the treasury (lib/clan_treasury).
  try {
    const cb = await require('./clan_treasury').memberBonuses(db, s);
    for (const [k, v] of Object.entries(cb.mods)) add(t.mods, k, v);
    for (const [k, v] of Object.entries(cb.effects)) add(t.effects, k, v);
    t.sources.push(...cb.sources);
  } catch (e) { /* pre-migration */ }

  // City upkeep: building levels above 3.
  if (s.tier === 'city') {
    const lv = (await db.query(`SELECT COALESCE(SUM(GREATEST(level - ${CITY_FREE_LEVELS}, 0)), 0)::int AS n FROM buildings WHERE settlement_id = $1`, [s.id])).rows[0].n;
    t.upkeep.city = lv * CITY_UPKEEP_PER_LEVEL;
  }
  t.upkeep.total = Math.round((t.upkeep.wonders + t.upkeep.city) * 100) / 100;

  if (t.arrears) {
    add(t.mods, 'happiness', ARREARS_HAPPINESS);
    t.sources.push({ key: 'arrears', label: '⚠️ Unpaid upkeep', happiness: ARREARS_HAPPINESS });
  }
  return t;
}

// Production multipliers over [fromMs, toMs]: wonders throughout, a festival
// only for the hours it overlapped.
function productionFactors(t, s, fromMs, toMs) {
  const span = Math.max(1, toMs - fromMs);
  const fStart = s.festival_started_at ? Date.parse(s.festival_started_at) : 0;
  const fEnd = s.festival_until ? Date.parse(s.festival_until) : 0;
  const overlap = Math.max(0, Math.min(toMs, fEnd) - Math.max(fromMs, fStart));
  const fest = fEnd > fromMs ? FESTIVAL.production * (overlap / span) : 0;
  const all = (t.mods.all_production || 0) - (t.festival && t.festival.active ? FESTIVAL.production : 0) + fest;
  const out = {};
  for (const r of BASIC) out[r] = Math.max(0.1, 1 + all + (t.mods[r + '_production'] || 0));
  return out;
}

// After a tick: fall into arrears when upkeep went unpaid, climb out once the
// treasury has wealth again (or nothing is owed). Writes a settlement event
// each way. Returns the new arrears_since (ISO) or null.
async function settleArrears(s, unpaid, wealth, owes) {
  if (unpaid && !s.arrears_since) {
    const r = await query('UPDATE settlements SET arrears_since = NOW() WHERE id = $1 AND arrears_since IS NULL RETURNING arrears_since', [s.id]);
    if (r.rowCount) await query("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'arrears',$2)",
      [s.id, '⚠️ The treasury is empty and upkeep is going unpaid. Wonders lie dormant and spirits sink until wealth returns.']);
    return r.rows[0] ? r.rows[0].arrears_since : s.arrears_since;
  }
  if (s.arrears_since && !unpaid && (wealth > 0 || !owes)) {
    const r = await query('UPDATE settlements SET arrears_since = NULL WHERE id = $1 AND arrears_since IS NOT NULL', [s.id]);
    if (r.rowCount) await query("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'arrears_cleared',$2)",
      [s.id, '✅ Upkeep is paid again — the wonders wake and the town breathes easier.']);
    return null;
  }
  return s.arrears_since || null;
}

// Just the effects crafting, the Library and the Market read (research.effectsFor).
async function effectsFor(db, sid) {
  db = db || { query };
  const s = (await db.query('SELECT * FROM settlements WHERE id = $1', [sid])).rows[0];
  return s ? (await load(db, s)).effects : {};
}

module.exports = { load, effectsFor, settleArrears, productionFactors, festivalCost, FESTIVAL, WONDER_UPKEEP, CITY_UPKEEP_PER_LEVEL, CITY_FREE_LEVELS, ARREARS_HAPPINESS, BASIC };
