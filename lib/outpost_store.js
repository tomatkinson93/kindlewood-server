// ══════════════════════════════════════════════════════════════════════════
//  outpost_store — each outpost keeps what it produces; porters carry it home.
//
//  Store    outposts.store (jsonb { res: amount }) fills on its own clock,
//           outposts.store_tick, at the outpost's rate (yields + ores, with
//           its workers / unfed / raided multiplier, seasons, Happenings and
//           the town's festival and wonders). Each resource stops at
//           STORE_PER_LEVEL × level until a porter takes some away.
//  Hauls    outpost_hauls: a porter walks out (MIN_LEG_SECONDS or
//           SECONDS_PER_TILE per tile, faster with travel perks), loads up
//           to their carry weight from the store, walks home and puts it in
//           the town's stores. Carry: a porter's load (market.PORTER_CARRY),
//           or the Market's caravan capacity once there is one, × the
//           Porter's carry perks. The load is a fair share of everything
//           stored, by weight.
//             • one-off runs: POST /api/game/outposts/:id/haul
//             • standing haulers (outpost_crew post='hauler', HAULER_SLOTS):
//               set out again as soon as they're home while anything's stored.
//  Raids    an outpost raid loots its store, not the town (lib/raids).
//
//  sync(settlement) resolves due runs, fills the stores and sends idle
//  haulers out; GET /settlement, GET /outposts and the worker tick call it.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const RD = require('./resource_defs');

const STORE_PER_LEVEL = 300;     // per resource, × outpost level
const SECONDS_PER_TILE = 600;    // 10 minutes per tile, each way
const MIN_LEG_SECONDS = 120;
const HAULER_SLOTS = 1;
const WEALTH_WEIGHT = 0.1;       // coin is light
const MAX_CHAIN = 50;            // standing runs caught up in one go
const TICK_EVERY_MS = 60 * 1000;

const r3 = v => Math.round(v * 1000) / 1000;
// Milliseconds from a Date (node-pg) or an ISO string, keeping the ms.
const msOf = v => (v instanceof Date ? v.getTime() : new Date(v).getTime());
const weightOf = res => (res === 'wealth' ? WEALTH_WEIGHT : Number((RD.def(res) || {}).weight) || 1);
// Store room: per level, more with a Storehouse (o.bfx from outpost_state.load).
// On the owner's clan land the store is a quarter bigger again.
const CLAN_LAND_CAP = 0.25;
const capOf = o => Math.round(STORE_PER_LEVEL * Math.max(1, Number(o.level) || 1) * (1 + ((o.bfx && o.bfx.cap) || 0) + (o.on_clan_land ? CLAN_LAND_CAP : 0)));
// What porters may carry from here (outposts.haul_filter: null = everything).
const filterOf = o => (Array.isArray(o && o.haul_filter) && o.haul_filter.length ? o.haul_filter.filter(k => RD.isResource(k)) : null);
const wanted = (o, st) => { const f = filterOf(o); const s = st || storeOf(o); return f ? Object.fromEntries(Object.entries(s).filter(([k]) => f.includes(k))) : s; };
const storeOf = o => {
  const s = o && o.store && typeof o.store === 'object' ? o.store : {};
  const out = {};
  for (const [k, v] of Object.entries(s)) if (RD.isResource(k) && Number(v) > 0) out[k] = Number(v);
  return out;
};

// Per-hour production of one annotated outpost (outpost_state.load row).
function ratesFor(o, research) {
  const { outpostYields } = require('../outposts_config');
  const out = { ...outpostYields(o.terrain, o.level, o.mult ?? 1) };
  // Buildings: +x on one resource (a Sawpit's timber), +x on every ore.
  const fx = o.bfx || {};
  for (const [k, x] of Object.entries(fx.yield || {})) if (out[k]) out[k] = r3(out[k] * (1 + x));
  const ore = require('./ores').oreRates([], [], [o], research).rates;
  for (const [k, v] of Object.entries(ore)) out[k] = r3((out[k] || 0) + v * (1 + (fx.ore || 0)));
  for (const k of Object.keys(out)) if (!(out[k] > 0)) delete out[k];
  return out;
}

// What `amount` would add over [fromMs, toMs): rate × effective hours
// (season and Happening weighted, by the base resource each follows) × the
// town's production factor.
function produced(rates, effHours, tf) {
  const out = {};
  for (const [res, rate] of Object.entries(rates)) {
    const f = (RD.def(res) || {}).follows;
    const h = effHours[res] ?? effHours[f] ?? 0;
    const v = rate * h * (tf[res] ?? tf[f] ?? 1);
    if (v > 0) out[res] = v;
  }
  return out;
}

// Wrap-aware hex distance at the world's dims.
async function worldDims(run) {
  try {
    const m = (await run('SELECT map_w, map_h FROM world_meta WHERE id=1')).rows[0];
    if (m) return { W: m.map_w, H: m.map_h };
  } catch (e) { /* no world_meta yet */ }
  const mapgen = require('../mapgen');
  return { W: mapgen.MAP_W, H: mapgen.MAP_H };
}
function hexDist(q1, r1, q2, r2, W, H) {
  const d = (a, b, c, e) => { const dq = a - c, dr = b - e; return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2; };
  let min = Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) min = Math.min(min, d(q1, r1, q2 + i * W, r2 + j * H));
  return min;
}

// Fill every outpost's store up to now (compare-and-swap on store_tick, and
// arithmetic in SQL so a porter loading up at the same moment is never undone).
async function accrue(settlement, now = Date.now(), db = null) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const outposts = await require('./outpost_state').load(db, settlement, now);
  if (!outposts.length) return outposts;
  const research = await require('./research').doneSet(db, settlement.id).catch(() => new Set());
  const happenings = await require('./happenings').loadLive().catch(() => []);
  const town = await require('./town_mods').load(db, settlement, now).catch(() => null);
  const A = require('./away_report');
  for (const o of outposts) {
    const from = o.store_tick ? msOf(o.store_tick) : (o.built_at ? msOf(o.built_at) : now);
    if (!(now - from >= 5000)) continue;
    const tf = town ? require('./town_mods').productionFactors(town, settlement, from, now) : {};
    const add = produced(ratesFor(o, research), A.effectiveProductionHours(happenings, from, now), tf);
    const cap = Number(capOf(o));
    const keys = Object.keys(add);
    // $1 id, $2 now (ms), $3 the tick we read (ms, or null), $4… amounts.
    // Never more than the cap, never less than what is already there.
    const parts = keys.map((k, i) => `'${k}', LEAST(GREATEST(${cap}::float8, COALESCE((store->>'${k}')::float8, 0)), COALESCE((store->>'${k}')::float8, 0) + $${i + 4}::float8)`);
    const set = keys.length ? `store = COALESCE(store, '{}'::jsonb) || jsonb_build_object(${parts.join(', ')}),` : '';
    const w = await run(
      `UPDATE outposts SET ${set} store_tick = date_trunc('milliseconds', to_timestamp($2::float8 / 1000.0))
        WHERE id = $1 AND (($3::float8 IS NULL AND store_tick IS NULL)
                        OR abs(extract(epoch FROM store_tick) * 1000 - $3::float8) < 1.5)
        RETURNING store, store_tick`,
      [o.id, now, o.store_tick ? msOf(o.store_tick) : null, ...keys.map(k => add[k])]);
    if (w.rows[0]) { o.store = w.rows[0].store; o.store_tick = w.rows[0].store_tick; }
    // The first of a new ore turned up here is a discovery.
    for (const k of keys) if (RD.EXTRA.includes(k)) await require('./resources').discover(db, settlement.id, k, 'mine').catch(() => {});
  }
  return outposts;
}

// A fair, weight-limited load from `store`: everything if it fits, else the
// same share of each (whole units), topped up one unit at a time.
function pickLoad(store, carry, filter = null) {
  const keys = Object.keys(store).filter(k => Math.floor(store[k]) > 0 && (!filter || filter.includes(k)));
  const whole = Object.fromEntries(keys.map(k => [k, Math.floor(store[k])]));
  const total = keys.reduce((t, k) => t + whole[k] * weightOf(k), 0);
  if (total <= carry) return whole;
  const f = carry / total;
  const load = {};
  let used = 0;
  for (const k of keys) { const n = Math.floor(whole[k] * f); if (n > 0) { load[k] = n; used += n * weightOf(k); } }
  // Top up with what's left, most-stored first.
  for (const k of keys.slice().sort((a, b) => (whole[b] - (load[b] || 0)) - (whole[a] - (load[a] || 0)))) {
    while ((load[k] || 0) < whole[k] && used + weightOf(k) <= carry + 1e-9) { load[k] = (load[k] || 0) + 1; used += weightOf(k); }
  }
  return load;
}

// Is there anything a porter may carry, and (for a standing hauler) is the
// store full enough? `o.haul_threshold` is a % of the cap for any one of the
// goods it carries (0 = anything at all).
async function readyToHaul(o, db = null, standing = true) {
  const w = wanted(o);
  if (!Object.values(w).some(v => v >= 1)) return false;
  const pct = standing ? Math.max(0, Math.min(100, Number(o.haul_threshold) || 0)) : 0;
  if (!pct) return true;
  if (!o.bfx && o.id) o = { ...o, bfx: await require('./outpost_buildings').fxFor(o.id, db).catch(() => ({})) };
  const need = capOf(o) * pct / 100;
  return Object.values(w).some(v => v >= need);
}

// Carry weight and leg time for `citizen` going to outpost `o`.
async function tripFor(db, settlement, o, citizen) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const market = require('./market');
  const mods = await market.loadModifiers(db || { query }, settlement.id).catch(() => ({ marketLevel: 0 }));
  const perks = (await require('./careers').travelCitizen(settlement.id, { id: citizen.id }).catch(() => null)) || {};
  // The outpost's Waystation (faster) and Mule Pen (more carried).
  const bfx = o.bfx || (o.id ? await require('./outpost_buildings').fxFor(o.id, db).catch(() => ({})) : {});
  // A clan's Outpost Network boon (lib/clan_treasury): porters carry more.
  let boon = 0;
  try { boon = Number((await require('./clan_treasury').memberBonuses(db, settlement)).effects.haul_carry) || 0; } catch (e) { /* no clan */ }
  const carry = Math.floor((mods.marketLevel ? mods.carryWeight : market.PORTER_CARRY) * (1 + (Number(perks.carry) || 0)) * (1 + (bfx.carry || 0) + boon));
  const { W, H } = await worldDims(run);
  const tiles = settlement.tile_q == null ? 1 : hexDist(settlement.tile_q, settlement.tile_r, o.tile_q, o.tile_r, W, H);
  // A Waystation and the road (lib/outpost_roads) speed every leg; a
  // clanmate helping from another town walks their own way, no road.
  const road = settlement.id === o.settlement_id || o.settlement_id == null ? require('./outpost_roads').tripMult(o) : 1;
  const leg = Math.round(Math.max(MIN_LEG_SECONDS, tiles * SECONDS_PER_TILE) * Math.max(0.25, (1 + (bfx.trip || 0)) * road) / (1 + Math.max(0, Number(perks.travel) || 0)));
  return { carry: Math.max(1, carry), leg, tiles };
}

// Send `citizen` to outpost `o`. `departMs` lets a standing hauler's next run
// start when the last one got home.
async function startHaul(db, settlement, o, citizen, standing, departMs = Date.now(), ownerId = null) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const t = await tripFor(db, settlement, o, citizen);
  const r = await run(
    `INSERT INTO outpost_hauls (settlement_id, outpost_id, citizen_id, standing, status, carry, departs_at, arrives_at, returns_at, owner_settlement_id)
     VALUES ($1, $2, $3, $4, 'outbound', $5, to_timestamp($6::float8 / 1000.0), to_timestamp($7::float8 / 1000.0), to_timestamp($8::float8 / 1000.0), $9) RETURNING *`,
    [settlement.id, o.id, citizen.id, !!standing, t.carry, departMs, departMs + t.leg * 1000, departMs + 2 * t.leg * 1000, ownerId]);
  return r.rows[0];
}

// A crew member's one-way walk: 'post' (town → outpost; arrives_at is when
// they get there) or 'return' (outpost → town; returns_at is when they're
// home). `legMs` overrides the walk (turning back halfway).
async function startWalk(db, settlement, o, citizen, kind, legMs = null, departMs = Date.now()) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const leg = legMs != null ? Math.max(0, legMs) : (await tripFor(db, settlement, o, citizen)).leg * 1000;
  const arrive = kind === 'post' ? departMs + leg : departMs;
  const back = kind === 'post' ? departMs + leg : departMs + leg;
  const r = await run(
    `INSERT INTO outpost_hauls (settlement_id, outpost_id, citizen_id, standing, kind, status, carry, departs_at, arrives_at, returns_at)
     VALUES ($1, $2, $3, FALSE, $4, $5, 0, to_timestamp($6::float8 / 1000.0), to_timestamp($7::float8 / 1000.0), to_timestamp($8::float8 / 1000.0)) RETURNING *`,
    [settlement.id, o.id, citizen.id, kind, kind === 'post' ? 'outbound' : 'returning', departMs, arrive, back]);
  return r.rows[0];
}

// Adds to the "Since you were gone…" ledger (produced_ and hauled_ per resource).
async function ledger(run, sid, load) {
  const keys = Object.keys(load).filter(k => load[k] > 0);
  if (!keys.length) return;
  const parts = [];
  keys.forEach((k, i) => {
    parts.push(`'produced_${k}', COALESCE((away_ledger->>'produced_${k}')::float8, 0) + $${i + 2}`);
    parts.push(`'hauled_${k}', COALESCE((away_ledger->>'hauled_${k}')::float8, 0) + $${i + 2}`);
  });
  await run(`UPDATE settlements SET away_ledger = COALESCE(away_ledger, '{}'::jsonb) || jsonb_build_object(${parts.join(', ')}) WHERE id=$1`,
    [sid, ...keys.map(k => load[k])]).catch(() => {});
}

// Advance one settlement's due runs. Returns [{ haul, event }] for messages.
async function resolveDue(settlement, now = Date.now()) {
  const done = [];
  for (let i = 0; i < MAX_CHAIN; i++) {
    const step = await withTransaction(async client => {
      const q = (t, p) => client.query(t, p);
      const h = (await q(
        `SELECT * FROM outpost_hauls WHERE settlement_id = $1 AND status IN ('outbound','returning')
           AND (CASE WHEN status = 'outbound' THEN arrives_at ELSE returns_at END) <= to_timestamp($2::float8 / 1000.0)
         ORDER BY (CASE WHEN status = 'outbound' THEN arrives_at ELSE returns_at END), id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [settlement.id, now])).rows[0];
      if (!h) return null;
      // Walks: a new post reached, or home from one. Nothing to carry.
      if ((h.kind || 'haul') !== 'haul') {
        await q("UPDATE outpost_hauls SET status = 'done' WHERE id = $1", [h.id]);
        return { h, kind: h.kind === 'post' ? 'arrived' : 'walked_home' };
      }
      if (h.status === 'outbound') {
        // At the outpost: load up from its store.
        const o = (await q('SELECT * FROM outposts WHERE id = $1 FOR UPDATE', [h.outpost_id])).rows[0];
        const load = o ? pickLoad(storeOf(o), Number(h.carry) || 0, filterOf(o)) : {};
        const keys = Object.keys(load);
        if (o && keys.length) {
          await q(`UPDATE outposts SET store = COALESCE(store, '{}'::jsonb) || jsonb_build_object(${keys.map((k, j) => `'${k}', GREATEST(0, COALESCE((store->>'${k}')::float8, 0) - $${j + 2})`).join(', ')}) WHERE id = $1`,
            [o.id, ...keys.map(k => load[k])]);
        }
        await q("UPDATE outpost_hauls SET status = 'returning', load = $2 WHERE id = $1", [h.id, JSON.stringify(load)]);
        return { h: { ...h, status: 'returning', load }, kind: 'loaded' };
      }
      // Home: into the town's stores.
      const load = h.load || {};
      const keys = Object.keys(load).filter(k => RD.isResource(k) && Number(load[k]) > 0);
      // A clanmate's porter delivers to the outpost's owner.
      const to = h.owner_settlement_id || h.settlement_id;
      if (keys.length) {
        await q(`UPDATE settlements SET ${keys.map((k, j) => `${k} = ${k} + $${j + 2}`).join(', ')} WHERE id = $1`, [to, ...keys.map(k => Number(load[k]))]);
        for (const k of keys) if (RD.EXTRA.includes(k)) await require('./resources').discover(client, to, k, 'mine').catch(() => {});
      }
      await q("UPDATE outpost_hauls SET status = 'done' WHERE id = $1", [h.id]);
      await ledger(q, to, load);
      if (h.owner_settlement_id && keys.length) {
        const who = (await q('SELECT s.name FROM settlements s WHERE s.id = $1', [h.settlement_id])).rows[0];
        await q('INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1, $2, $3)', [to, 'clan_haul',
          `🤝 A porter from ${(who && who.name) || 'a clanmate'} carried ${keys.map(k => `${load[k]} ${RD.label(k).toLowerCase()}`).join(', ')} home from your outpost.`]).catch(() => {});
      }
      // A standing hauler still at their post goes straight back out — if
      // there is anything to fetch (else the next sync sends them).
      let next = null;
      if (h.standing) {
        const post = (await q("SELECT 1 FROM outpost_crew WHERE citizen_id = $1 AND outpost_id = $2 AND post = 'hauler'", [h.citizen_id, h.outpost_id])).rows[0];
        const o = post && (await q('SELECT * FROM outposts WHERE id = $1', [h.outpost_id])).rows[0];
        if (o && await readyToHaul(o, client)) next = await startHaul(client, settlement, o, { id: h.citizen_id }, true, msOf(h.returns_at));
      }
      return { h, kind: 'home', load, next };
    });
    if (!step) break;
    done.push(step);
    if (step.kind === 'arrived' || step.kind === 'walked_home') {
      try { require('./event_bus').publish(step.h.settlement_id, { type: 'outpost_walk', kind: step.kind, haul_id: step.h.id, outpost_id: step.h.outpost_id, citizen_id: step.h.citizen_id }); } catch (e) { /* no stream */ }
    }
    if (step.kind === 'home') {
      const hours = (msOf(step.h.returns_at) - msOf(step.h.departs_at)) / 3600000;
      try { require('./game_events').emit('porter_home', { settlementId: step.h.settlement_id, citizenId: step.h.citizen_id, kind: 'outpost', hours }); } catch (e) { /* no listeners */ }
      try { require('./event_bus').publish(step.h.settlement_id, { type: 'outpost_haul_home', haul_id: step.h.id, outpost_id: step.h.outpost_id, citizen_id: step.h.citizen_id, load: step.load, standing: !!step.h.standing }); } catch (e) { /* no stream */ }
    }
  }
  return done;
}

// Standing haulers at home with something to fetch set out now.
async function sendIdleHaulers(settlement, now = Date.now()) {
  const r = await query(
    `SELECT oc.citizen_id, o.* FROM outpost_crew oc JOIN outposts o ON o.id = oc.outpost_id
      WHERE o.settlement_id = $1 AND oc.post = 'hauler'
        AND NOT EXISTS (SELECT 1 FROM outpost_hauls h WHERE h.citizen_id = oc.citizen_id AND h.status IN ('outbound','returning'))`,
    [settlement.id]).catch(() => ({ rows: [] }));
  const sent = [];
  for (const row of r.rows) {
    if (!(await readyToHaul({ ...row, id: row.id }))) continue;
    sent.push(await startHaul(null, settlement, row, { id: row.citizen_id }, true, now).catch(() => null));
  }
  return sent.filter(Boolean);
}

// Everything due for one settlement, in order: runs that arrived, stores up
// to now, idle haulers out (and any of their runs already due).
async function sync(settlement, now = Date.now()) {
  if (!settlement || !settlement.id) return;
  try {
    await resolveDue(settlement, now);
    await accrue(settlement, now);
    if ((await sendIdleHaulers(settlement, now)).length) await resolveDue(settlement, now);
  } catch (e) {
    if (!(e && (e.code === '42P01' || e.code === '42703'))) console.error('[outpost_store] sync', e.message);
  }
}

// Active runs (with citizen names) for a settlement, or one outpost.
async function activeHauls(sid, outpostId = null) {
  const r = await query(
    `SELECT h.*, c.name AS citizen_name FROM outpost_hauls h JOIN citizens c ON c.id = h.citizen_id
      WHERE (h.settlement_id = $1 OR h.owner_settlement_id = $1) AND h.status IN ('outbound','returning') ${outpostId ? 'AND h.outpost_id = $2' : ''}
      ORDER BY h.departs_at, h.id`, outpostId ? [sid, outpostId] : [sid]).catch(() => ({ rows: [] }));
  return r.rows.map(h => ({
    id: h.id, outpost_id: h.outpost_id, citizen_id: h.citizen_id, name: h.citizen_name, standing: !!h.standing, kind: h.kind || 'haul',
    helper: h.owner_settlement_id && h.owner_settlement_id !== h.settlement_id ? true : undefined,
    status: h.status, carry: Number(h.carry) || 0, load: h.load || null,
    departs_at: h.departs_at, arrives_at: h.arrives_at, returns_at: h.returns_at,
  }));
}

// The store as the client sees it: whole units, cap, what's full, its weight.
function present(o) {
  const st = storeOf(o), cap = capOf(o);
  const items = Object.fromEntries(Object.entries(st).map(([k, v]) => [k, Math.floor(v)]).filter(([, v]) => v > 0));
  return {
    items, cap,
    full: Object.keys(st).filter(k => st[k] >= cap - 1e-6),
    weight: r3(Object.entries(items).reduce((t, [k, v]) => t + v * weightOf(k), 0)),
  };
}

// Worker: every settlement with outposts, about once a minute.
let _last = 0;
async function tick() {
  if (Date.now() - _last < TICK_EVERY_MS) return;
  _last = Date.now();
  try {
    const r = await query(`SELECT s.* FROM settlements s WHERE EXISTS (SELECT 1 FROM outposts o WHERE o.settlement_id = s.id)
                              OR EXISTS (SELECT 1 FROM outpost_hauls h WHERE h.settlement_id = s.id AND h.status IN ('outbound','returning')) LIMIT 500`);
    try { await require('./outpost_events').tick(); } catch (e) { /* events off */ }
    for (const s of r.rows) await sync(s);
  } catch (e) {
    if (!(e && (e.code === '42P01' || e.code === '42703'))) console.error('[outpost_store] tick', e.message);
  }
}

module.exports = {
  STORE_PER_LEVEL, SECONDS_PER_TILE, MIN_LEG_SECONDS, HAULER_SLOTS, WEALTH_WEIGHT,
  weightOf, capOf, storeOf, ratesFor, filterOf, wanted, readyToHaul, CLAN_LAND_CAP, produced, pickLoad, tripFor, startHaul, startWalk, accrue, resolveDue, sendIdleHaulers,
  sync, activeHauls, present, tick, hexDist,
};
