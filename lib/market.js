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
// Items: carry weight by equipment slot, else by category (default 1).
const ITEM_SLOT_WEIGHT = { weapon: 3, armour: 5, trinket: 2, tool: 2 };
const ITEM_CATEGORY_WEIGHT = { food: 0.5, fish: 0.5, material: 1, trophy: 1, misc: 1, quest_item: 1 };

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

function itemWeight(item) {
  if (!item) return 1;
  if (item.equip_slot) return ITEM_SLOT_WEIGHT[item.equip_slot] || 3;
  return ITEM_CATEGORY_WEIGHT[item.category] || 1;
}
// Most of `item` one trip can carry. Equipment is one piece per order.
function maxItemUnits(item, carryWeight) {
  const n = Math.floor(carryWeight / itemWeight(item));
  return item && item.equip_slot ? Math.min(1, n) : n;
}
// What an order is selling, for messages: "100 timber" / "3× Trout".
function goodsLabel(o, qty) {
  if (o.kind === 'item') return `${qty}× ${(o.item_snapshot && o.item_snapshot.name) || 'item'}`;
  return `${qty} ${o.resource}`;
}

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

// Validates a new order's numbers. `item` (a snapshot) makes it an item
// order; otherwise `resource` must be tradeable. Returns an error or null.
function validateOrder({ resource, lot_size, lot_price, qty_total }, mods, item) {
  if (!item && !isTradeable(resource)) return 'That resource cannot be traded.';
  for (const [k, v] of Object.entries({ lot_size, lot_price, qty_total }))
    if (!Number.isInteger(v) || v <= 0) return `Invalid ${k.replace('_', ' ')}.`;
  if (qty_total > MAX_QTY) return 'That is more than any market could list.';
  if (lot_price > MAX_PRICE) return 'That price is too high.';
  if (lot_size > qty_total) return 'Lot size cannot be more than the total listed.';
  if (item) {
    if (item.equip_slot && qty_total !== 1) return 'Equipment is sold one piece per order.';
    const maxLot = maxItemUnits(item, mods.carryWeight);
    if (maxLot < 1) return `${item.name} is too heavy for your merchants to carry.`;
    if (lot_size > maxLot) return `A merchant can carry at most ${maxLot} ${item.name} per trip.`;
    return null;
  }
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
     UNION SELECT citizen_id FROM market_trips WHERE status IN ('outbound','returning') AND citizen_id = ANY($1::int[])
     UNION SELECT citizen_id FROM market_runs  WHERE status IN ('outbound','returning') AND citizen_id = ANY($1::int[])`,
    [ids.map(Number)]).catch(() => ({ rows: [] }));  // pre-migration
  return r.rows.map(x => x.citizen_id);
}

const ON_ROAD = `EXISTS (SELECT 1 FROM market_trips t WHERE t.citizen_id = c.id AND t.status IN ('outbound','returning'))`;

// Ends an order: refunds escrow, drops its merchants (those at home go back
// to idle; those on the road go idle when they return).
// Item stalls keep any units a buyer's porter is already walking to
// collect (qty_reserved); the porter still gets them when they arrive.
async function closeOrder(db, order, status) {
  const reserved = order.kind === 'item' ? Math.min(order.qty_escrowed, Number(order.qty_reserved) || 0) : 0;
  const refund = order.qty_escrowed - reserved;
  if (refund > 0 && order.kind === 'item' && order.item_snapshot) {
    await require('./inventory').grantItem((t, p) => db.query(t, p), order.seller_settlement_id,
      { ...order.item_snapshot, quantity: refund, source: 'market' });
  } else if (refund > 0 && isTradeable(order.resource)) {
    await db.query(`UPDATE settlements SET ${order.resource} = ${order.resource} + $2 WHERE id = $1`,
      [order.seller_settlement_id, refund]);
  }
  await db.query(
    "UPDATE market_orders SET status = $2, qty_escrowed = $3, closed_at = NOW() WHERE id = $1",
    [order.id, status, reserved]);
  const m = await db.query('DELETE FROM market_order_merchants WHERE order_id = $1 RETURNING citizen_id', [order.id]);
  if (m.rows.length) {
    await db.query(
      `UPDATE citizens c SET role = 'idle' WHERE c.id = ANY($1::int[]) AND c.role = 'merchant' AND NOT ${ON_ROAD}`,
      [m.rows.map(x => x.citizen_id)]);
  }
  return refund;
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
      if (t.kind === 'item' && t.item_snapshot) {
        await require('./inventory').grantItem((s, p) => client.query(s, p), t.buyer_settlement_id,
          { ...t.item_snapshot, quantity: t.qty, source: 'market' });
      } else if (isTradeable(t.resource)) {
        await client.query(`UPDATE settlements SET ${t.resource} = ${t.resource} + $2 WHERE id = $1`,
          [t.buyer_settlement_id, t.qty]);
      }
      await client.query("UPDATE market_trips SET status = 'returning' WHERE id = $1", [t.id]);
      events.push([t.buyer_settlement_id, { type: 'market_delivery', trip_id: t.id, resource: t.resource, qty: t.qty, ...itemEventBits(t) }]);
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
      events.push([t.seller_settlement_id, { type: 'market_return', trip_id: t.id, gold: net, resource: t.resource, qty: t.qty, ...itemEventBits(t) }]);
    }

    await resolveRuns(client, settlementId, events);

    const expired = await client.query(
      `SELECT * FROM market_orders WHERE status = 'active' AND expires_at <= NOW()
        ${settlementId ? 'AND seller_settlement_id = $1' : ''}
        LIMIT 100 FOR UPDATE SKIP LOCKED`, params);
    for (const o of expired.rows) {
      const refunded = await closeOrder(client, o, 'expired');
      events.push([o.seller_settlement_id, { type: 'market_order_expired', order_id: o.id, resource: o.resource, qty: refunded, ...itemEventBits(o) }]);
    }
  });
  for (const [sid, ev] of events) eventBus.publish(sid, ev);
  return events.length;
}

// ── Porters & Ironhaven ────────────────────────────────────────────────────

// A porter (any free adult) carries this much weight per run.
const PORTER_CARRY = 20;
// Ironhaven pays a share of an item's town value; the weekly wants list pays more.
const IRONHAVEN_RATE = 0.3;
const IRONHAVEN_WANT_RATE = 0.6;
const IRONHAVEN_WANT_COUNT = 3;
const WEEK_MS = 7 * 24 * 3600 * 1000;
// Weeks run Monday 00:00 UTC to Monday (1970-01-05 was a Monday).
const WEEK_EPOCH = Date.UTC(1970, 0, 5);
const weekNo = (t = Date.now()) => Math.floor((t - WEEK_EPOCH) / WEEK_MS);
const weekEnds = (t = Date.now()) => new Date(WEEK_EPOCH + (weekNo(t) + 1) * WEEK_MS);

// Most of `item` one porter can carry.
function porterMax(item) { return Math.max(1, Math.floor(PORTER_CARRY / itemWeight(item))); }

// Browse category for an item: its equipment slot, else its category.
const ITEM_CATEGORIES = ['weapon', 'armour', 'tool', 'trinket', 'fish', 'food', 'material', 'trophy', 'misc'];
function categoryOf(item) {
  if (!item) return 'misc';
  if (['weapon', 'armour', 'tool', 'trinket'].includes(item.equip_slot)) return item.equip_slot;
  return ['fish', 'food', 'material', 'trophy'].includes(item.category) ? item.category : 'misc';
}
// SQL for the same, over a row alias carrying equip_slot + category columns
// (or JSON fields when `json` is set: alias->>'equip_slot').
function categorySql(a, json) {
  const f = k => (json ? `${a}->>'${k}'` : `${a}.${k}`);
  return `(CASE WHEN ${f('equip_slot')} IN ('weapon','armour','tool','trinket') THEN ${f('equip_slot')}
               WHEN ${f('category')} IN ('fish','food','material','trophy') THEN ${f('category')} ELSE 'misc' END)`;
}

// Deterministic pick of this week's wanted items from the tradeable
// templates that have a value (FNV hash of week number + key → lowest wins).
function ironhavenWants(templates, week = weekNo()) {
  const h = s => { let x = 0x811c9dc5; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 0x01000193); } return x >>> 0; };
  return templates
    .filter(t => t.tradeable !== false && Number(t.sell_value) > 0)
    .map(t => ({ t, k: h(week + ':' + t.item_key) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, IRONHAVEN_WANT_COUNT)
    .map(x => x.t.item_key);
}
// Gold Ironhaven pays for one unit with town value `sellValue`.
function ironhavenUnitPrice(sellValue, wanted) {
  return Math.max(1, Math.floor((Number(sellValue) || 1) * (wanted ? IRONHAVEN_WANT_RATE : IRONHAVEN_RATE)));
}

// Ironhaven's tile (the kingdom seat), or null.
async function ironhavenTile(db) {
  const r = await db.query(
    "SELECT id, name, tile_q, tile_r FROM npc_settlements WHERE is_kingdom ORDER BY (name = 'Ironhaven') DESC, id LIMIT 1");
  return r.rows[0] || null;
}

// ── Item stalls ────────────────────────────────────────────────────────────

// Venues that host item stalls, and what each sells (null = anything).
// Shops join in phase 3; the Market takes anything as a fallback.
const VENUES = { market: { building: 'market', label: 'Market', sells: null } };

// { venue: { label, slots, used, free } } for a settlement.
async function stallState(db, settlementId) {
  const levels = Object.fromEntries((await db.query(
    'SELECT type, MAX(level)::int AS level FROM buildings WHERE settlement_id = $1 GROUP BY type', [settlementId])).rows
    .map(r => [r.type, r.level]));
  const used = Object.fromEntries((await db.query(
    `SELECT COALESCE(venue, 'market') AS v, COUNT(*)::int AS n FROM market_orders
      WHERE seller_settlement_id = $1 AND status = 'active' AND kind = 'item' GROUP BY 1`, [settlementId])).rows
    .map(r => [r.v, r.n]));
  const out = {};
  for (const [v, def] of Object.entries(VENUES)) {
    const lvl = levels[def.building] || 0;
    const bdef = BUILDINGS[def.building];
    const slots = lvl && bdef && bdef.stallSlots ? bdef.stallSlots(lvl) : 0;
    out[v] = { label: def.label, slots, used: used[v] || 0, free: Math.max(0, slots - (used[v] || 0)), sells: def.sells };
  }
  return out;
}

// Advances due porter runs inside transaction `client`; pushes SSE events.
async function resolveRuns(client, settlementId, events) {
  const scope = settlementId ? 'AND (settlement_id = $1 OR target_settlement_id = $1)' : '';
  const params = settlementId ? [settlementId] : [];
  const grant = (sid, snap, qty) => require('./inventory').grantItem((s, p) => client.query(s, p), sid, { ...snap, quantity: qty, source: 'market' });

  const arrived = (await client.query(
    `SELECT * FROM market_runs WHERE status = 'outbound' AND arrives_at <= NOW() ${scope}
      ORDER BY arrives_at LIMIT 100 FOR UPDATE SKIP LOCKED`, params)).rows;
  for (const r of arrived) {
    if (r.kind === 'pickup') {
      // Collect the reserved units and pay the seller.
      const o = r.order_id ? (await client.query('SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [r.order_id])).rows[0] : null;
      if (o && o.qty_reserved >= r.qty && o.qty_escrowed >= r.qty) {
        const left = o.qty_escrowed - r.qty;
        await client.query('UPDATE market_orders SET qty_escrowed = $2, qty_reserved = qty_reserved - $3 WHERE id = $1', [o.id, left, r.qty]);
        await client.query('UPDATE settlements SET wealth = wealth + $2 WHERE id = $1', [o.seller_settlement_id, Math.max(0, r.gold - r.fee)]);
        if (left === 0 && o.status === 'active') await closeOrder(client, { ...o, qty_escrowed: 0 }, 'sold_out');
        events.push([o.seller_settlement_id, { type: 'market_sale', run_id: r.id, gold: r.gold - r.fee, qty: r.qty, ...itemEventBits({ kind: 'item', item_snapshot: r.item_snapshot }) }]);
      } else {
        await client.query('UPDATE market_runs SET failed = TRUE WHERE id = $1', [r.id]);
      }
    }
    await client.query("UPDATE market_runs SET status = 'returning' WHERE id = $1", [r.id]);
    events.push([r.settlement_id, { type: 'market_run_update', run_id: r.id }]);
  }

  const back = (await client.query(
    `SELECT * FROM market_runs WHERE status = 'returning' AND returns_at <= NOW() ${scope}
      ORDER BY returns_at LIMIT 100 FOR UPDATE SKIP LOCKED`, params)).rows;
  for (const r of back) {
    const failed = (await client.query('SELECT failed FROM market_runs WHERE id = $1', [r.id])).rows[0].failed;
    if (r.kind === 'ironhaven') {
      await client.query('UPDATE settlements SET wealth = wealth + $2 WHERE id = $1', [r.settlement_id, r.gold]);
    } else if (r.kind === 'pickup') {
      if (failed) await client.query('UPDATE settlements SET wealth = wealth + $2 WHERE id = $1', [r.settlement_id, r.gold]);
      else if (r.item_snapshot) await grant(r.settlement_id, r.item_snapshot, r.qty);
    }
    await client.query("UPDATE market_runs SET status = 'done' WHERE id = $1", [r.id]);
    events.push([r.settlement_id, { type: 'market_porter_home', run_id: r.id, kind: r.kind, failed, gold: r.gold, qty: r.qty,
      ...itemEventBits({ kind: 'item', item_snapshot: r.item_snapshot }) }]);
  }
}

// Item name/icon for SSE toasts (empty for resources).
function itemEventBits(row) {
  return row.kind === 'item' && row.item_snapshot
    ? { item: { name: row.item_snapshot.name, icon: row.item_snapshot.icon } } : {};
}

// Worker probe: cheap indexed check, resolve only when something is due.
async function tick() {
  try {
    const due = await query(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM market_trips WHERE status = 'outbound' AND arrives_at <= NOW())
          OR EXISTS (SELECT 1 FROM market_trips WHERE status = 'returning' AND returns_at <= NOW())
          OR EXISTS (SELECT 1 FROM market_orders WHERE status = 'active' AND expires_at <= NOW())
          OR EXISTS (SELECT 1 FROM market_runs WHERE status = 'outbound' AND arrives_at <= NOW())
          OR EXISTS (SELECT 1 FROM market_runs WHERE status = 'returning' AND returns_at <= NOW())`);
    if (due.rowCount) await resolveDue();
  } catch (e) {
    if (e && e.code === '42P01') return;  // pre-migration: tables missing
    console.error('[market] tick failed:', e.message);
  }
}

module.exports = {
  LEVEL_CAPS, UNIT_WEIGHT, TRADEABLE, REFERENCE_PRICE, SECONDS_PER_HEX, MIN_LEG_SECONDS,
  ITEM_SLOT_WEIGHT, ITEM_CATEGORY_WEIGHT, itemWeight, maxItemUnits, goodsLabel, itemEventBits,
  PORTER_CARRY, IRONHAVEN_RATE, IRONHAVEN_WANT_RATE, ITEM_CATEGORIES, weekNo, weekEnds, porterMax, VENUES, stallState,
  categoryOf, categorySql, ironhavenWants, ironhavenUnitPrice, ironhavenTile,
  FEE_RATE, EXPIRY_HOURS,
  tradeModifiers, loadModifiers, marketLevelOf,
  isTradeable, maxLotUnits, priceFor, feeFor, distanceBetween, legSeconds, validateOrder,
  tradePartnerSql, tradePartnerIds, canTrade, revealClanmates,
  merchantCitizenIds, closeOrder, ON_ROAD,
  resolveDue, tick,
};
