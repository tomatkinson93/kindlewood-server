// ══════════════════════════════════════════════════════════════════════════
//  NPC TRADE — friendly villages post small, ordinary orders every day
//
//  Villages a player has revealed and is at least Familiar with (trust 21+)
//  appear at the Market alongside players: their sell orders in Buy, their
//  buy orders in Wanted. The player always sends a porter; the deal
//  completes when the porter is home (lib/market.js resolveRuns, kind 'npc').
//
//  Orders are generated, not stored: npcOrdersFor(npc, day) is a pure
//  function of the village and the UTC day, so every player sees the same
//  offers. Each player's own allowance is tracked in npc_trade_usage, so
//  nobody races anyone to empty a village. Trust scales amounts and prices.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const market = require('./market');

// What each village species trades: 'r:<resource>' or 'c:<item category>'.
// Ores (copper, tin, coal, silver) too: buying one from a village is how
// many towns first discover it (lib/market creditResource).
const SPECIES_TRADE = {
  mice:     { sells: ['r:food', 'c:fish'],                 buys: ['r:timber', 'c:tool', 'r:tin'] },
  badger:   { sells: ['r:stone', 'r:metal', 'r:copper', 'r:coal'], buys: ['r:food', 'r:timber'] },
  squirrel: { sells: ['r:timber', 'r:food'],               buys: ['r:stone', 'c:trinket', 'r:coal'] },
  otter:    { sells: ['c:fish', 'r:food', 'r:tin'],        buys: ['r:timber', 'r:metal', 'r:copper'] },
  weasel:   { sells: ['r:metal', 'c:material', 'r:silver'], buys: ['r:food', 'r:stone', 'r:silver'] },
};
const DEFAULT_TRADE = { sells: ['r:food', 'r:timber'], buys: ['r:stone', 'r:metal'] };

const MIN_TRUST = 21;   // Familiar
// Trust tiers: daily amounts × mult, prices better by `edge`.
function tierFor(trust) {
  if (trust >= 71) return { key: 'allied', label: 'Allied', mult: 2, edge: 0.10 };
  if (trust >= 41) return { key: 'friendly', label: 'Friendly', mult: 1.5, edge: 0.05 };
  if (trust >= MIN_TRUST) return { key: 'familiar', label: 'Familiar', mult: 1, edge: 0 };
  return null;
}
const TRUST_PER_TRADE = 1;
const TRUST_PER_DAY = 2;

const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const dayEnds = (t = Date.now()) => new Date(Date.parse(dayOf(t) + 'T00:00:00Z') + 24 * 3600 * 1000);

// Seeded PRNG (mulberry32) from an FNV-1a hash of the seed string.
function rng(seed) {
  let h = 0x811c9dc5;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + r() * (hi - lo);
const intBetween = (r, lo, hi) => Math.floor(between(r, lo, hi + 1));

// Today's base orders for a village (before trust): pure and deterministic.
// templates: tradeable item_templates rows (item_key, name, icon, category,
// equip_slot, rarity, sell_value). Each order:
//   { key, side: 'sell'|'buy' (the village's side), kind, resource?, item?,
//     qty, price, per }  — price is per `per` units (100 for resources).
function npcOrdersFor(npc, day, templates) {
  const r = rng(`${npc.id}:${day}`);
  const trade = SPECIES_TRADE[String(npc.species || '').toLowerCase()] || DEFAULT_TRADE;
  const common = (templates || []).filter(t => t.tradeable !== false && Number(t.sell_value) > 0 &&
    ['common', 'uncommon'].includes(t.rarity || 'common') && t.category !== 'schematic');
  const out = [];
  for (const side of ['sell', 'buy']) {
    const goods = side === 'sell' ? trade.sells : trade.buys;
    const n = side === 'sell' ? intBetween(r, 2, 3) : intBetween(r, 1, 2);
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const g = goods[(i + intBetween(r, 0, goods.length - 1)) % goods.length];
      const [type, what] = g.split(':');
      if (type === 'r') {
        if (used.has(g)) continue;
        used.add(g);
        const ref = market.REFERENCE_PRICE[what] || 1;
        const unit = ref * (side === 'sell' ? between(r, 0.95, 1.15) : between(r, 0.85, 1.0));
        const amount = intBetween(r, 100, 300);
        // Ores are dearer: fewer of them (about 60–200 gold's worth), priced per 10.
        if (require('./resource_defs').def(what).group !== 'base') out.push({ key: `${side[0]}${i}`, side, kind: 'resource', resource: what,
          qty: Math.max(10, Math.round(amount * 0.66 / ref / 10) * 10), price: Math.max(1, Math.round(unit * 10)), per: 10 });
        else out.push({ key: `${side[0]}${i}`, side, kind: 'resource', resource: what,
          qty: Math.round(amount / 10) * 10, price: Math.max(1, Math.round(unit * 100)), per: 100 });
      } else {
        const pool = common.filter(t => market.categoryOf(t) === what && !used.has(t.item_key));
        if (!pool.length) continue;
        const t = pool[intBetween(r, 0, pool.length - 1)];
        used.add(t.item_key);
        const unit = Number(t.sell_value) * (side === 'sell' ? between(r, 1.1, 1.3) : between(r, 0.6, 0.8));
        out.push({ key: `${side[0]}${i}`, side, kind: 'item',
          item: { item_key: t.item_key, name: t.name, icon: t.icon, category: t.category, equip_slot: t.equip_slot,
                  rarity: t.rarity, cat: market.categoryOf(t) },
          qty: intBetween(r, 2, 6), price: Math.max(1, Math.round(unit)), per: 1 });
      }
    }
  }
  // Now and then a village has a schematic to sell (one, today). Rarer ones
  // only for towns it trusts more (npcTradersFor drops them otherwise).
  const schematics = (templates || []).filter(t => t.category === 'schematic' && t.tradeable !== false && Number(t.sell_value) > 0);
  if (schematics.length && r() < SCHEMATIC_CHANCE) {
    const t = schematics[intBetween(r, 0, schematics.length - 1)];
    out.push({ key: 's9', side: 'sell', kind: 'item', schematic: true, min_tier: SCHEMATIC_TIER[t.rarity] || 'familiar',
      item: { item_key: t.item_key, name: t.name, icon: t.icon, category: t.category, equip_slot: null, rarity: t.rarity, cat: 'misc' },
      qty: 1, price: Math.max(1, Math.round(Number(t.sell_value) * 1.2)), per: 1 });
  }
  return out;
}
const SCHEMATIC_CHANCE = 0.35;

// ── Special requests ───────────────────────────────────────────────────────
// Now and then a village posts one request: "Burrowmere needs 20 bronze by
// Friday". It lasts 1–3 days, is the same for every town (seeded by village
// and start day) and each town fills it once, in as many trips as it likes.
// It pays well above market, and finishing it earns extra trust.
// Order key 'req'; usage is counted on its start day (npc_trade_usage.day).
const REQUEST_CHANCE = 0.3;      // a new request starts on a given day
const REQUEST_TRUST = 3;         // bonus trust for finishing one
const REQUEST_RESOURCES = ['timber', 'stone', 'metal', 'copper', 'tin', 'coal', 'silver', 'bronze', 'steel', 'goldore', 'gems', 'obsidian'];
const REQUEST_CATS = ['tool', 'weapon', 'armour', 'fish', 'trinket'];
const DAY_MS = 24 * 3600 * 1000;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function requestFor(npc, day, templates) {
  const today = Date.parse(day + 'T00:00:00Z');
  for (let back = 0; back < 3; back++) {
    const start = dayOf(today - back * DAY_MS);
    const r = rng(`req:${npc.id}:${start}`);
    if (r() >= REQUEST_CHANCE) continue;
    const days = intBetween(r, 1, 3);
    if (back >= days) continue;
    const ends = new Date(Date.parse(start + 'T00:00:00Z') + days * DAY_MS);
    const base = { key: 'req', side: 'buy', request: { day: start, ends_at: ends.toISOString(), by: WEEKDAY[new Date(ends - 1).getUTCDay()], trust: REQUEST_TRUST } };
    const items = (templates || []).filter(t => t.tradeable !== false && Number(t.sell_value) > 0 && t.category !== 'schematic'
      && ['common', 'uncommon'].includes(t.rarity || 'common') && REQUEST_CATS.includes(market.categoryOf(t)));
    if (r() < 0.5 || !items.length) {
      const res = REQUEST_RESOURCES[intBetween(r, 0, REQUEST_RESOURCES.length - 1)];
      const ref = market.REFERENCE_PRICE[res] || 1;
      const qty = Math.max(10, Math.round(intBetween(r, 150, 400) / ref / 10) * 10);
      return { ...base, kind: 'resource', resource: res, qty, price: Math.max(1, Math.round(ref * between(r, 1.4, 1.8) * 10)), per: 10 };
    }
    const t = items[intBetween(r, 0, items.length - 1)];
    return { ...base, kind: 'item', qty: intBetween(r, 2, 5), price: Math.max(1, Math.round(Number(t.sell_value) * between(r, 1.3, 1.6))), per: 1,
      item: { item_key: t.item_key, name: t.name, icon: t.icon, category: t.category, equip_slot: t.equip_slot, rarity: t.rarity, cat: market.categoryOf(t) } };
  }
  return null;
}
// The orders a town at this trust tier sees, adjusted for the tier.
function forTier(orders, tier) {
  return orders.filter(o => !o.min_tier || TIER_ORDER.indexOf(tier.key) >= TIER_ORDER.indexOf(o.min_tier)).map(o => applyTier(o, tier));
}
const TIER_ORDER = ['familiar', 'friendly', 'allied'];
const SCHEMATIC_TIER = { common: 'familiar', uncommon: 'familiar', rare: 'friendly', epic: 'allied', legendary: 'allied' };

// An order adjusted for the player's trust tier.
function applyTier(o, tier) {
  // A request asks every town for the same amount; trust only improves the pay.
  const qty = o.schematic || o.request ? o.qty : o.kind === 'resource' ? Math.round(o.qty * tier.mult / 10) * 10 : Math.round(o.qty * tier.mult);
  // Better prices: the village sells cheaper and buys dearer.
  const price = Math.max(1, Math.round(o.price * (o.side === 'sell' ? 1 - tier.edge : 1 + tier.edge)));
  return { ...o, qty, price };
}

// Gold for `qty` units of an order.
const dealGold = (o, qty) => Math.ceil(o.price * qty / o.per);

// Villages that trade with settlement `me` today: [{ npc, trust, tier, orders }]
// where each order carries `remaining` (your allowance left today).
async function npcTradersFor(db, me, templates) {
  if (!me || me.tile_q == null) return [];
  const rows = (await db.query(
    `SELECT n.id, n.name, n.species, n.tile_q, n.tile_r, d.trust
       FROM npc_settlements n
       JOIN diplomacy_relations d ON d.npc_id = n.id AND d.settlement_id = $1
      WHERE NOT COALESCE(n.is_kingdom, FALSE) AND COALESCE(n.disposition, 'neutral') <> 'hostile'
        AND COALESCE(n.faction, 'neutral') <> 'hostile' AND d.trust >= $3
        AND EXISTS (SELECT 1 FROM fog_of_war f WHERE f.user_id = $2 AND f.tile_q = n.tile_q AND f.tile_r = n.tile_r)
      ORDER BY n.id`, [me.id, me.user_id, MIN_TRUST])).rows;
  if (!rows.length) return [];
  const day = dayOf();
  if (!templates) templates = (await db.query('SELECT * FROM item_templates WHERE tradeable')).rows;
  // Today's usage, and the last few days' for requests (counted on their start day).
  const usage = (await db.query(
    `SELECT npc_id, order_key, qty, to_char(day, 'YYYY-MM-DD') AS day FROM npc_trade_usage
      WHERE settlement_id = $1 AND (day = $2 OR (order_key = 'req' AND day >= $2::date - 3))`, [me.id, day])).rows;
  const used = (npcId, key, d) => (usage.find(u => u.npc_id === npcId && u.order_key === key && u.day === d) || {}).qty || 0;
  return rows.map(n => {
    const tier = tierFor(n.trust);
    const req = requestFor(n, day, templates);
    const orders = forTier(npcOrdersFor(n, day, templates).concat(req ? [req] : []), tier)
      .map(o => ({ ...o, remaining: Math.max(0, o.qty - used(n.id, o.key, o.request ? o.request.day : day)) }));
    return { npc: n, trust: n.trust, tier, orders, day, ends_at: dayEnds().toISOString() };
  });
}

// Adds trust for a completed trade, at most TRUST_PER_DAY per village per
// UTC day. `bonus` (a porter's Village Friend perk) adds to both the trade
// and the day's cap. Returns the trust actually gained.
async function grantTradeTrust(client, settlementId, npcId, day, bonus = 0) {
  const per = TRUST_PER_TRADE + Math.max(0, bonus | 0), dayCap = TRUST_PER_DAY + Math.max(0, bonus | 0);
  // Make sure the day's row exists, then lock it: concurrent trades can't both slip under the cap.
  await client.query(
    'INSERT INTO npc_trade_trust (settlement_id, npc_id, day, gained) VALUES ($1,$2,$3,0) ON CONFLICT DO NOTHING',
    [settlementId, npcId, day]);
  const had = Number((await client.query(
    'SELECT gained FROM npc_trade_trust WHERE settlement_id = $1 AND npc_id = $2 AND day = $3 FOR UPDATE',
    [settlementId, npcId, day])).rows[0].gained) || 0;
  const add = Math.max(0, Math.min(per, dayCap - had));
  if (!add) return 0;
  await client.query('UPDATE npc_trade_trust SET gained = gained + $4 WHERE settlement_id = $1 AND npc_id = $2 AND day = $3',
    [settlementId, npcId, day, add]);
  const rel = (await client.query(
    'UPDATE diplomacy_relations SET trust = LEAST(100, trust + $3), last_interaction = NOW(), interactions = interactions + 1 WHERE settlement_id = $1 AND npc_id = $2 RETURNING trust',
    [settlementId, npcId, add])).rows[0];
  if (!rel) return 0;
  const lvl = require('../routes/diplomacy').getTrustLevel(rel.trust);
  if (lvl && lvl.status !== 'unknown') {
    await client.query("UPDATE diplomacy_relations SET status = $3 WHERE settlement_id = $1 AND npc_id = $2 AND status <> 'contact_sent'",
      [settlementId, npcId, lvl.status]);
  }
  return add;
}

module.exports = {
  SPECIES_TRADE, MIN_TRUST, TRUST_PER_TRADE, TRUST_PER_DAY,
  tierFor, dayOf, dayEnds, npcOrdersFor, applyTier, forTier, dealGold, npcTradersFor, grantTradeTrust,
  requestFor, REQUEST_TRUST, REQUEST_CHANCE,
};
