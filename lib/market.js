// ══════════════════════════════════════════════════════════════════════════
//  MARKET — player-to-player trading (sell orders + merchant caravans)
//
//  Flow:
//    1. A seller lists a sell order: resource, lot size, lot price, total.
//       The whole total is escrowed off the seller's stock immediately and
//       one or more of their citizens are assigned as merchants (role
//       'merchant').
//    2. A buyer who knows the seller (see tradePartnerSql) buys one lot.
//       Their gold is taken up front and a free merchant sets off: a
//       market_trips row, status 'outbound'.
//    3. arrives_at → goods credited to the buyer, trip 'returning'.
//       returns_at → gold minus the market fee credited to the seller,
//       trip 'done', merchant free for the next lot.
//    An order whose merchants are all on the road is "paused" — nobody can
//    buy until one gets home.
//
//  Resolution is lazy (every /api/market call resolves due trips first)
//  plus lib/quest_worker.js, which calls tick() every few seconds. Rows are
//  taken with FOR UPDATE SKIP LOCKED so the two never double-credit.
//
//  Caps live in one place — tradeModifiers() — so research / clan perks /
//  items can add `bonuses` later without touching the routes.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query, withTransaction } = require('../db');
const mapgen = require('../mapgen');
const { BUILDINGS } = require('../buildings');
const eventBus = require('./event_bus');

// ── Tuning ─────────────────────────────────────────────────────────────────

// Per market level. carryWeight is per trip (see UNIT_WEIGHT); merchants
// comes from the building's citizenSlots so the two can never drift.
const LEVEL_CAPS = {
  1: { carryWeight: 100, maxOrders: 2 },
  2: { carryWeight: 200, maxOrders: 3 },
  3: { carryWeight: 350, maxOrders: 4 },
  4: { carryWeight: 550, maxOrders: 5 },
  5: { carryWeight: 800, maxOrders: 6 },
};
// Carry weight of one unit. Wealth is the currency, so it is not listable.
const UNIT_WEIGHT = { food: 0.5, timber: 1, stone: 1, metal: 2 };
const TRADEABLE = Object.keys(UNIT_WEIGHT);
// Display-only price hints (gold per unit), from species base rates and the
// tier-upgrade cost ratios. Players price freely.
const REFERENCE_PRICE = { food: 0.3, timber: 0.7, stone: 1.0, metal: 2.0 };

const SECONDS_PER_HEX = 45;      // laden caravan, per leg
const MIN_LEG_SECONDS = 120;
const SCOUTING_SPEEDUP = 0.06;   // per scouting point above 1 (same as envoys)
const FEE_RATE = 0.05;           // off the seller's gold
const EXPIRY_HOURS = 168;        // one week
const MAX_QTY = 1000000;
const MAX_PRICE = 1000000;

// ── Modifiers ──────────────────────────────────────────────────────────────

// Trade caps for a settlement whose market is at `marketLevel` (0 = none).
// `bonuses`: [{ key, add?, mult? }] from future research / perks — applied
// in order, adds before mults within each entry.
function tradeModifiers(marketLevel, bonuses = []) {
  const level = Math.max(0, Math.min(BUILDINGS.market.maxLevel, Number(marketLevel) || 0));
  const caps = LEVEL_CAPS[level];
  const mods = {
    marketLevel: level,
    carryWeight: caps ? caps.carryWeight : 0,
    merchants: level ? BUILDINGS.market.citizenSlots(level) : 0,
    maxOrders: caps ? caps.maxOrders : 0,
    speedMult: 1,
    feeRate: FEE_RATE,
    expiryHours: EXPIRY_HOURS,
  };
  for (const b of bonuses || []) {
    if (!b || !(b.key in mods) || b.key === 'marketLevel') continue;
    if (b.add) mods[b.key] += Number(b.add) || 0;
    if (b.mult) mods[b.key] *= Number(b.mult) || 1;
  }
  mods.carryWeight = Math.max(0, Math.floor(mods.carryWeight));
  mods.merchants = Math.max(0, Math.floor(mods.merchants));
  mods.maxOrders = Math.max(0, Math.floor(mods.maxOrders));
  mods.speedMult = Math.max(0.1, mods.speedMult);
  mods.feeRate = Math.min(1, Math.max(0, mods.feeRate));
  return mods;
}

// Research does not exist yet; this is where its trade bonuses will load.
async function loadBonuses(/* db, settlementId */) {
  return [];
}

async function marketLevelOf(db, settlementId) {
  const r = await db.query(
    "SELECT COALESCE(MAX(level), 0)::int AS level FROM buildings WHERE settlement_id=$1 AND type='market'",
    [settlementId]);
  return r.rows[0].level;
}

async function loadModifiers(db, settlementId) {
  return tradeModifiers(await marketLevelOf(db, settlementId), await loadBonuses(db, settlementId));
}

// ── Pure helpers ───────────────────────────────────────────────────────────

const isTradeable = res => TRADEABLE.includes(res);

// Most units of `resource` one trip can carry.
function maxLotUnits(resource, carryWeight) {
  if (!isTradeable(resource)) return 0;
  return Math.floor(carryWeight / UNIT_WEIGHT[resource]);
}

// Gold for `qty` units of an order — a short final lot is pro-rata, rounded up.
function priceFor(order, qty) {
  if (qty >= order.lot_size) return order.lot_price;
  return Math.max(1, Math.ceil(order.lot_price * qty / order.lot_size));
}

const feeFor = (gold, feeRate) => Math.floor(gold * feeRate);

function distanceBetween(a, b) {
  if (a.tile_q == null || b.tile_q == null) return null;
  return mapgen.hexDistanceWrapped(a.tile_q, a.tile_r, b.tile_q, b.tile_r);
}

// One leg (there or back) for `citizen` over `distance` hexes.
function legSeconds(distance, citizen, mods) {
  const scouting = Number(citizen?.skills?.scouting) || 1;
  const speed = (1 + (scouting - 1) * SCOUTING_SPEEDUP) * ((mods && mods.speedMult) || 1);
  return Math.max(MIN_LEG_SECONDS, Math.round((distance || 0) * SECONDS_PER_HEX / speed));
}

// Validates a new order's numbers. Returns an error string or null.
function validateOrder({ resource, lot_size, lot_price, qty_total }, mods) {
  if (!isTradeable(resource)) return 'That resource cannot be traded.';
  for (const [k, v] of Object.entries({ lot_size, lot_price, qty_total }))
    if (!Number.isInteger(v) || v <= 0) return `Invalid ${k.replace('_', ' ')}.`;
  if (qty_total > MAX_QTY) return 'That is more than any market could list.';
  if (lot_price > MAX_PRICE) return 'That price is too high.';
  if (lot_size > qty_total) return 'Lot size cannot be more than the total listed.';
  const maxLot = maxLotUnits(resource, mods.carryWeight);
  if (lot_size > maxLot) return `A merchant can carry at most ${maxLot} ${resource} per trip.`;
  return null;
}

// ── Visibility ─────────────────────────────────────────────────────────────

// SQL predicate: settlement alias `s` can trade with the viewer. Both towns
// have revealed each other's home tile, or both owners share a clan; both
// placed in the same world. Params: $userId, $q, $r, $worldVersion, $settlementId.
function tradePartnerSql(s, p) {
  return `(${s}.id <> ${p.settlementId} AND ${s}.tile_q IS NOT NULL AND ${s}.world_version = ${p.worldVersion}
    AND ( (EXISTS (SELECT 1 FROM fog_of_war f1 WHERE f1.user_id = ${p.userId} AND f1.tile_q = ${s}.tile_q AND f1.tile_r = ${s}.tile_r)
           AND EXISTS (SELECT 1 FROM fog_of_war f2 WHERE f2.user_id = ${s}.user_id AND f2.tile_q = ${p.q} AND f2.tile_r = ${p.r}))
       OR EXISTS (SELECT 1 FROM clan_members ca JOIN clan_members cb ON cb.clan_id = ca.clan_id
                   WHERE ca.user_id = ${p.userId} AND cb.user_id = ${s}.user_id) ))`;
}

// Ids of every settlement `me` (a settlements row) can trade with.
async function tradePartnerIds(db, me) {
  if (!me || me.tile_q == null) return [];
  const r = await db.query(
    `SELECT s.id FROM settlements s WHERE ${tradePartnerSql('s', { userId: '$1', q: '$2', r: '$3', worldVersion: '$4', settlementId: '$5' })}`,
    [me.user_id, me.tile_q, me.tile_r, me.world_version, me.id]);
  return r.rows.map(x => x.id);
}

async function canTrade(db, me, otherId) {
  if (!me || me.tile_q == null) return false;
  const r = await db.query(
    `SELECT 1 FROM settlements s WHERE s.id = $6 AND ${tradePartnerSql('s', { userId: '$1', q: '$2', r: '$3', worldVersion: '$4', settlementId: '$5' })}`,
    [me.user_id, me.tile_q, me.tile_r, me.world_version, me.id, otherId]);
  return r.rowCount > 0;
}

// Reveals userId's town tile to every clanmate and theirs to userId. Called
// on clan join and on (re)placing a settlement.
async function revealClanmates(db, userId) {
  await db.query(
    `INSERT INTO fog_of_war (user_id, tile_q, tile_r)
     SELECT x.viewer, x.q, x.r FROM (
       SELECT cb.user_id AS viewer, s.tile_q AS q, s.tile_r AS r
         FROM clan_members ca JOIN clan_members cb ON cb.clan_id = ca.clan_id AND cb.user_id <> ca.user_id
         JOIN settlements s ON s.user_id = ca.user_id
        WHERE ca.user_id = $1
       UNION
       SELECT ca.user_id, s.tile_q, s.tile_r
         FROM clan_members ca JOIN clan_members cb ON cb.clan_id = ca.clan_id AND cb.user_id <> ca.user_id
         JOIN settlements s ON s.user_id = cb.user_id
        WHERE ca.user_id = $1
     ) x WHERE x.q IS NOT NULL AND x.r IS NOT NULL
     ON CONFLICT DO NOTHING`, [userId]);
}

// ── Citizens ───────────────────────────────────────────────────────────────

// Of `ids`, the citizens working a market order (home or on the road).
async function merchantCitizenIds(ids, db) {
  if (!ids || !ids.length) return [];
  const run = db ? (t, p) => db.query(t, p) : query;
  const r = await run(
    `SELECT citizen_id FROM market_order_merchants WHERE citizen_id = ANY($1::int[])
     UNION SELECT citizen_id FROM market_trips WHERE status IN ('outbound','returning') AND citizen_id = ANY($1::int[])`,
    [ids.map(Number)]).catch(() => ({ rows: [] }));  // pre-migration
  return r.rows.map(x => x.citizen_id);
}

const ON_ROAD = `EXISTS (SELECT 1 FROM market_trips t WHERE t.citizen_id = c.id AND t.status IN ('outbound','returning'))`;

// Ends an order: refunds escrow, drops its merchants (those at home go back
// to idle; those on the road go idle when they return).
async function closeOrder(db, order, status) {
  if (order.qty_escrowed > 0 && isTradeable(order.resource)) {
    await db.query(`UPDATE settlements SET ${order.resource} = ${order.resource} + $2 WHERE id = $1`,
      [order.seller_settlement_id, order.qty_escrowed]);
  }
  await db.query(
    "UPDATE market_orders SET status = $2, qty_escrowed = 0, closed_at = NOW() WHERE id = $1",
    [order.id, status]);
  const m = await db.query('DELETE FROM market_order_merchants WHERE order_id = $1 RETURNING citizen_id', [order.id]);
  if (m.rows.length) {
    await db.query(
      `UPDATE citizens c SET role = 'idle' WHERE c.id = ANY($1::int[]) AND c.role = 'merchant' AND NOT ${ON_ROAD}`,
      [m.rows.map(x => x.citizen_id)]);
  }
  return order.qty_escrowed;
}

// ── Resolution ─────────────────────────────────────────────────────────────

// Advances every due trip (optionally only those touching settlementId) and
// expires stale orders. SSE events go out after commit.
async function resolveDue(settlementId = null) {
  const events = [];
  await withTransaction(async (client) => {
    const scope = settlementId ? 'AND (seller_settlement_id = $1 OR buyer_settlement_id = $1)' : '';
    const params = settlementId ? [settlementId] : [];

    const arrived = await client.query(
      `SELECT * FROM market_trips WHERE status = 'outbound' AND arrives_at <= NOW() ${scope}
        ORDER BY arrives_at LIMIT 100 FOR UPDATE SKIP LOCKED`, params);
    for (const t of arrived.rows) {
      if (isTradeable(t.resource)) {
        await client.query(`UPDATE settlements SET ${t.resource} = ${t.resource} + $2 WHERE id = $1`,
          [t.buyer_settlement_id, t.qty]);
      }
      await client.query("UPDATE market_trips SET status = 'returning' WHERE id = $1", [t.id]);
      events.push([t.buyer_settlement_id, { type: 'market_delivery', trip_id: t.id, resource: t.resource, qty: t.qty }]);
      events.push([t.seller_settlement_id, { type: 'market_trip_update', trip_id: t.id }]);
    }

    const returned = await client.query(
      `SELECT * FROM market_trips WHERE status = 'returning' AND returns_at <= NOW() ${scope}
        ORDER BY returns_at LIMIT 100 FOR UPDATE SKIP LOCKED`, params);
    for (const t of returned.rows) {
      const net = Math.max(0, t.gold_paid - t.fee);
      await client.query('UPDATE settlements SET wealth = wealth + $2 WHERE id = $1', [t.seller_settlement_id, net]);
      await client.query("UPDATE market_trips SET status = 'done' WHERE id = $1", [t.id]);
      if (t.citizen_id) {
        // Back home: free for the next lot, or idle if the order has closed.
        await client.query(
          `UPDATE citizens SET role = 'idle' WHERE id = $1 AND role = 'merchant'
             AND NOT EXISTS (SELECT 1 FROM market_order_merchants WHERE citizen_id = $1)`, [t.citizen_id]);
      }
      events.push([t.seller_settlement_id, { type: 'market_return', trip_id: t.id, gold: net, resource: t.resource, qty: t.qty }]);
    }

    const expired = await client.query(
      `SELECT * FROM market_orders WHERE status = 'active' AND expires_at <= NOW()
        ${settlementId ? 'AND seller_settlement_id = $1' : ''}
        LIMIT 100 FOR UPDATE SKIP LOCKED`, params);
    for (const o of expired.rows) {
      const refunded = await closeOrder(client, o, 'expired');
      events.push([o.seller_settlement_id, { type: 'market_order_expired', order_id: o.id, resource: o.resource, qty: refunded }]);
    }
  });
  for (const [sid, ev] of events) eventBus.publish(sid, ev);
  return events.length;
}

// Worker probe: cheap indexed check, resolve only when something is due.
async function tick() {
  try {
    const due = await query(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM market_trips WHERE status = 'outbound' AND arrives_at <= NOW())
          OR EXISTS (SELECT 1 FROM market_trips WHERE status = 'returning' AND returns_at <= NOW())
          OR EXISTS (SELECT 1 FROM market_orders WHERE status = 'active' AND expires_at <= NOW())`);
    if (due.rowCount) await resolveDue();
  } catch (e) {
    if (e && e.code === '42P01') return;  // pre-migration: tables missing
    console.error('[market] tick failed:', e.message);
  }
}

module.exports = {
  LEVEL_CAPS, UNIT_WEIGHT, TRADEABLE, REFERENCE_PRICE, SECONDS_PER_HEX, MIN_LEG_SECONDS,
  FEE_RATE, EXPIRY_HOURS,
  tradeModifiers, loadModifiers, marketLevelOf,
  isTradeable, maxLotUnits, priceFor, feeFor, distanceBetween, legSeconds, validateOrder,
  tradePartnerSql, tradePartnerIds, canTrade, revealClanmates,
  merchantCitizenIds, closeOrder, ON_ROAD,
  resolveDue, tick,
};
