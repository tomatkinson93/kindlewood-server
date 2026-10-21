// /api/market — player-to-player trading. See lib/market.js for the flow.
const express = require('express');
const { query, withTransaction } = require('../db');
const requireAuth = require('../middleware/auth');
const { BUILDINGS } = require('../buildings');
const market = require('../lib/market');
const eventBus = require('../lib/event_bus');
const { takeItem, takeItemsByKey, snapshotOf, untradeableReason } = require('../lib/inventory');

const router = express.Router();

class MarketError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function sendError(res, e, fallback) {
  if (e instanceof MarketError) return res.status(e.status).json({ error: e.message });
  console.error('[market]', e);
  res.status(500).json({ error: fallback });
}
const toInt = v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const parseId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

async function mySettlement(userId) {
  const s = (await query('SELECT * FROM settlements WHERE user_id = $1', [userId])).rows[0];
  if (!s) throw new MarketError(404, 'No settlement.');
  return s;
}

// Lazy resolve, so a player sees arrivals even if the worker is off.
async function settle(settlementId) {
  try { await market.resolveDue(settlementId); } catch (e) { console.error('[market] resolve failed:', e.message); }
}

// Why each of `ids` cannot become a merchant ({ id: reason }); free ids are absent.
async function unavailable(settlementId, ids) {
  const out = {};
  const cits = (await query(
    'SELECT id, name, life_stage FROM citizens WHERE settlement_id = $1 AND id = ANY($2::int[])',
    [settlementId, ids])).rows;
  const byId = Object.fromEntries(cits.map(c => [c.id, c]));
  const nameOf = id => byId[id]?.name || 'That citizen';
  for (const id of ids) {
    const c = byId[id];
    if (!c) out[id] = 'That citizen is not yours.';
    else if (c.life_stage === 'child') out[id] = `${c.name} is too young to trade.`;
    else if (c.life_stage === 'deceased') out[id] = `${c.name} has passed away.`;
  }
  const mark = (rows, why) => rows.forEach(id => { if (!out[id]) out[id] = `${nameOf(id)} ${why}`; });
  mark(await market.merchantCitizenIds(ids), 'is busy at the Market.');
  mark((await query("SELECT citizen_id FROM expeditions WHERE status = 'travelling' AND citizen_id = ANY($1::int[])", [ids]))
    .rows.map(r => r.citizen_id), 'is on an expedition.');
  const quests = (await query(
    "SELECT citizen_id, party_ids FROM settlement_quests WHERE settlement_id = $1 AND status = 'active'", [settlementId])).rows;
  const onQuest = new Set();
  quests.forEach(q => { if (q.citizen_id) onQuest.add(q.citizen_id); (q.party_ids || []).forEach(id => onQuest.add(Number(id))); });
  mark(ids.filter(id => onQuest.has(id)), 'is on a quest.');
  mark(await require('../lib/clan_quests').busyCitizenIds(ids), 'is on a clan quest.');
  const diplo = await query(
    "SELECT citizen_id FROM diplomacy_relations WHERE citizen_id = ANY($1::int[]) AND (status = 'contact_sent' OR pending_action IS NOT NULL)",
    [ids]).catch(() => ({ rows: [] }));
  mark(diplo.rows.map(r => r.citizen_id), 'is on a diplomatic mission.');
  return out;
}

function parseCitizenIds(raw) {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.map(Number))];
  return ids.every(id => Number.isInteger(id) && id > 0) ? ids : null;
}

// ── GET /api/market/status ────────────────────────────────────────────────
// Whether trading is unlocked, the caps, and — when it is not — what it
// takes to build a Market (straight from the building definition).
router.get('/status', requireAuth, async (req, res) => {
  try {
    const s = await mySettlement(req.user.userId);
    await settle(s.id);
    const mods = await market.loadModifiers({ query }, s.id);
    const def = BUILDINGS.market;
    const builtRows = (await query('SELECT DISTINCT type FROM buildings WHERE settlement_id = $1', [s.id])).rows;
    const built = new Set(builtRows.map(r => r.type));
    const counts = (await query(
      `SELECT (SELECT COUNT(*) FROM market_orders WHERE seller_settlement_id = $1 AND status = 'active' AND kind = 'resource')::int AS orders,
              (SELECT COUNT(*) FROM market_order_merchants m JOIN market_orders o ON o.id = m.order_id
                WHERE o.seller_settlement_id = $1)::int AS merchants`, [s.id])).rows[0];
    res.json({
      ok: true,
      unlocked: mods.marketLevel > 0,
      placed: s.tile_q != null,
      tier: s.tier || 'camp',
      mods,
      activeOrders: counts.orders,
      merchantsAssigned: counts.merchants,
      tradeable: market.TRADEABLE,
      unitWeight: market.UNIT_WEIGHT,
      itemSlotWeight: market.ITEM_SLOT_WEIGHT,
      stalls: await market.stallState({ query }, s.id),
      porterCarry: market.PORTER_CARRY,
      itemCategoryWeight: market.ITEM_CATEGORY_WEIGHT,
      referencePrice: market.REFERENCE_PRICE,
      secondsPerHex: market.SECONDS_PER_HEX,
      minLegSeconds: market.MIN_LEG_SECONDS,
      levelCaps: market.LEVEL_CAPS,
      building: {
        id: def.id, label: def.label, icon: def.icon, desc: def.desc, imgFile: def.imgFile || null,
        maxLevel: def.maxLevel, minTier: def.minTier || 'camp', levelTierReq: def.levelTierReq || {},
        // Cost of the next level (level 1 when none is built).
        cost: Object.fromEntries(Object.entries(def.cost).map(([r, v]) => [r, v * (mods.marketLevel + 1)])),
        requires: def.requires.map(id => ({ id, label: BUILDINGS[id]?.label || id, built: built.has(id) })),
      },
      resources: { food: s.food, timber: s.timber, stone: s.stone, metal: s.metal, wealth: s.wealth },
    });
  } catch (e) { sendError(res, e, 'Could not load the market.'); }
});

// ── GET /api/market/orders ────────────────────────────────────────────────
// Other sellers' open orders the caller may trade with.
// ?resource=food&sort=distance|unit_price|amount|eta&dir=asc|desc&seller=<settlementId>
const SORTS = {
  distance: o => o.distance,
  unit_price: o => o.unit_price,
  amount: o => o.qty_available,
  eta: o => o.eta_seconds,
};
router.get('/orders', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) return res.json({ ok: true, orders: [] });

    const params = [me.user_id, me.tile_q, me.tile_r, me.world_version, me.id];
    let extra = '';
    if (req.query.resource === 'items') extra += ` AND o.kind = 'item'`;
    else if (req.query.resource === 'resources') extra += ` AND o.kind = 'resource'`;
    if (req.query.item_key) { params.push(String(req.query.item_key)); extra += ` AND o.item_key = $${params.length}`; }
    if (market.ITEM_CATEGORIES.includes(req.query.category)) {
      params.push(req.query.category);
      extra += ` AND o.kind = 'item' AND ${market.categorySql('o.item_snapshot', true)} = $${params.length}`;
    }
    else if (req.query.resource && market.isTradeable(req.query.resource)) {
      params.push(req.query.resource); extra += ` AND o.resource = $${params.length}`;
    }
    const sellerId = parseId(req.query.seller);
    if (sellerId) { params.push(sellerId); extra += ` AND o.seller_settlement_id = $${params.length}`; }

    const live = "COALESCE(c.life_stage, 'adult') NOT IN ('deceased','child')";
    const rows = (await query(
      `SELECT o.id, o.kind, o.resource, o.item_key, o.item_snapshot, o.venue, o.qty_reserved, o.lot_size, o.lot_price, o.qty_total, o.qty_escrowed, o.created_at, o.expires_at,
              s.id AS seller_id, s.name AS seller_name, s.tier AS seller_tier, s.tile_q, s.tile_r,
              u.username AS seller_username, u.species AS seller_species,
              (SELECT COUNT(*) FROM market_order_merchants m JOIN citizens c ON c.id = m.citizen_id
                WHERE m.order_id = o.id AND ${live})::int AS merchants,
              (SELECT MAX(COALESCE((c.skills->>'scouting')::int, 1)) FROM market_order_merchants m JOIN citizens c ON c.id = m.citizen_id
                WHERE m.order_id = o.id AND ${live} AND NOT ${market.ON_ROAD}) AS free_scouting,
              (SELECT MIN(t.returns_at) FROM market_trips t
                WHERE t.order_id = o.id AND t.status IN ('outbound','returning')) AS next_free_at,
              (SELECT COALESCE(MAX(b.level), 0) FROM buildings b
                WHERE b.settlement_id = s.id AND b.type = 'market')::int AS seller_market_level
         FROM market_orders o
         JOIN settlements s ON s.id = o.seller_settlement_id
         JOIN users u ON u.id = s.user_id
        WHERE o.status = 'active' AND o.expires_at > NOW() AND o.qty_escrowed > 0
          AND (o.kind <> 'item' OR ${market.venueOpenSql('o')})
          AND ${market.tradePartnerSql('s', { userId: '$1', q: '$2', r: '$3', worldVersion: '$4', settlementId: '$5' })}
          ${extra}
        LIMIT 500`, params)).rows;

    const now = Date.now();
    const orders = rows.filter(o => (o.kind === 'item' ? o.qty_escrowed - o.qty_reserved > 0 : o.merchants > 0)).map(o => {
      const distance = market.distanceBetween(me, o);
      if (o.kind === 'item') {
        // A stall: the buyer's own porter walks there and back.
        const available = o.qty_escrowed - o.qty_reserved;
        const venue = market.VENUES[o.venue || 'market'] || market.VENUES.market;
        return {
          id: o.id, kind: 'item', item: o.item_snapshot, item_key: o.item_key, venue: o.venue || 'market', venue_label: venue.label,
          unit_price: o.lot_price, lot_size: 1, lot_price: o.lot_price, next_lot_qty: 1, next_lot_price: o.lot_price,
          qty_available: available, qty_total: o.qty_total, porter_max: Math.min(available, market.porterMax(o.item_snapshot)),
          expires_at: o.expires_at,
          seller: { id: o.seller_id, name: o.seller_name, username: o.seller_username, species: o.seller_species, tier: o.seller_tier },
          distance, merchants: 0, paused: false, next_free_at: null,
          eta_seconds: 2 * market.legSeconds(distance, null, {}),   // there and back with a scouting-1 porter
        };
      }
      const mods = market.tradeModifiers(o.seller_market_level);
      const paused = o.free_scouting == null;
      const leg = market.legSeconds(distance, { skills: { scouting: paused ? 1 : o.free_scouting } }, mods);
      const wait = paused && o.next_free_at ? Math.max(0, Math.round((new Date(o.next_free_at).getTime() - now) / 1000)) : 0;
      const nextQty = Math.min(o.lot_size, o.qty_escrowed);
      return {
        id: o.id, kind: o.kind, resource: o.resource, item: o.item_snapshot || null,
        lot_size: o.lot_size, lot_price: o.lot_price,
        next_lot_qty: nextQty, next_lot_price: market.priceFor(o, nextQty),
        unit_price: Math.round((o.lot_price / o.lot_size) * 100) / 100,
        qty_available: o.qty_escrowed, qty_total: o.qty_total,
        expires_at: o.expires_at,
        seller: { id: o.seller_id, name: o.seller_name, username: o.seller_username, species: o.seller_species, tier: o.seller_tier },
        distance, merchants: o.merchants, paused,
        next_free_at: paused ? o.next_free_at : null,
        eta_seconds: wait + leg,
      };
    });

    const sortKey = SORTS[req.query.sort] ? req.query.sort : 'distance';
    const dir = req.query.dir === 'desc' ? -1 : 1;
    orders.sort((a, b) => (SORTS[sortKey](a) - SORTS[sortKey](b)) * dir || a.unit_price - b.unit_price || a.id - b.id);
    res.json({ ok: true, sort: sortKey, dir: dir === 1 ? 'asc' : 'desc', orders: orders.slice(0, 200) });
  } catch (e) { sendError(res, e, 'Could not load orders.'); }
});

// ── GET /api/market/mine ──────────────────────────────────────────────────
// The caller's orders, their merchants, live trips both ways, and the
// citizens who could be made merchants.
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);

    const orders = (await query(
      `SELECT * FROM market_orders WHERE seller_settlement_id = $1
          AND (status = 'active' OR closed_at > NOW() - INTERVAL '24 hours')
        ORDER BY (status = 'active') DESC, created_at DESC LIMIT 50`, [me.id])).rows;
    const merchants = (await query(
      `SELECT m.order_id, c.id, c.name, c.skills, c.life_stage, ${market.ON_ROAD} AS on_road
         FROM market_order_merchants m JOIN citizens c ON c.id = m.citizen_id
         JOIN market_orders o ON o.id = m.order_id
        WHERE o.seller_settlement_id = $1`, [me.id])).rows;
    const trips = (await query(
      `SELECT t.*, ss.name AS seller_name, bs.name AS buyer_name, c.name AS citizen_name
         FROM market_trips t
         JOIN settlements ss ON ss.id = t.seller_settlement_id
         JOIN settlements bs ON bs.id = t.buyer_settlement_id
         LEFT JOIN citizens c ON c.id = t.citizen_id
        WHERE (t.seller_settlement_id = $1 OR t.buyer_settlement_id = $1)
          AND (t.status <> 'done' OR t.returns_at > NOW() - INTERVAL '24 hours')
        ORDER BY t.departs_at DESC LIMIT 60`, [me.id])).rows;

    const adults = (await query(
      `SELECT id, name, role, skills FROM citizens
        WHERE settlement_id = $1 AND COALESCE(life_stage, 'adult') NOT IN ('child','deceased')
        ORDER BY name`, [me.id])).rows;
    const busy = adults.length ? await unavailable(me.id, adults.map(c => c.id)) : {};

    // Inventory for the Sell tab's item picker: each stack with whether it
    // can be listed, how many fit on one trip, and the town merchant price.
    const mods = await market.loadModifiers({ query }, me.id);
    const inv = (await query(
      `SELECT i.*, t.tradeable AS template_tradeable, t.sell_value AS template_sell
         FROM inventory_items i LEFT JOIN item_templates t ON t.item_key = i.item_key
        WHERE i.settlement_id = $1 ORDER BY i.category, i.name`, [me.id])).rows;
    const items = inv.map(r => {
      const snap = snapshotOf(r);
      const why = untradeableReason(r, r.template_tradeable == null ? null : { tradeable: r.template_tradeable });
      return {
        id: r.id, ...snap, quantity: r.quantity,
        tradeable: !why, reason: why,
        weight: market.itemWeight(snap), max_lot: market.maxItemUnits(snap, mods.carryWeight),
        sell_value: Number(r.template_sell) || Number(r.metadata && r.metadata.sell_value) || 0,
      };
    });

    res.json({
      ok: true,
      now: new Date().toISOString(),
      orders: orders.map(o => ({
        ...o,
        unit_price: Math.round((o.lot_price / o.lot_size) * 100) / 100,
        merchants: merchants.filter(m => m.order_id === o.id).map(m => ({
          id: m.id, name: m.name, scouting: Number(m.skills?.scouting) || 1,
          on_road: m.on_road, deceased: m.life_stage === 'deceased',
        })),
      })),
      trips: trips.map(t => ({
        id: t.id, order_id: t.order_id, kind: t.kind, resource: t.resource, item: t.item_snapshot || null, qty: t.qty,
        gold_paid: t.gold_paid, fee: t.fee, distance: t.distance, status: t.status,
        departs_at: t.departs_at, arrives_at: t.arrives_at, returns_at: t.returns_at,
        direction: t.seller_settlement_id === me.id ? 'selling' : 'buying',
        seller_name: t.seller_name, buyer_name: t.buyer_name, citizen_name: t.citizen_name,
      })),
      items,
      stalls: await market.stallState({ query }, me.id),
      wants: (await query(
        `SELECT * FROM market_wants WHERE buyer_settlement_id = $1
            AND (status = 'active' OR closed_at > NOW() - INTERVAL '24 hours') ORDER BY (status = 'active') DESC, created_at DESC LIMIT 30`,
        [me.id])).rows.map(w => wantView(w)),
      runs: (await query(
        `SELECT r.*, c.name AS citizen_name, s.name AS from_name FROM market_runs r
           LEFT JOIN citizens c ON c.id = r.citizen_id JOIN settlements s ON s.id = r.settlement_id
          WHERE r.kind IN ('pickup','fill') AND (r.settlement_id = $1 OR (r.target_settlement_id = $1 AND r.status = 'outbound'))
            AND (r.status <> 'done' OR r.returns_at > NOW() - INTERVAL '24 hours')
          ORDER BY r.departs_at DESC LIMIT 40`, [me.id])).rows.map(r => ({
        id: r.id, kind: r.kind, resource: r.resource,
        direction: r.settlement_id === me.id ? (r.kind === 'fill' ? 'delivering' : 'collecting') : (r.kind === 'fill' ? 'arriving' : 'incoming'),
        status: r.status, failed: r.failed,
        qty: r.qty, gold: r.gold, fee: r.fee, item: r.item_snapshot, citizen_name: r.citizen_name,
        from_name: r.from_name, target_name: r.target_name, distance: r.distance,
        departs_at: r.departs_at, arrives_at: r.arrives_at, returns_at: r.returns_at,
      })),
      candidates: adults.map(c => ({
        id: c.id, name: c.name, role: c.role, scouting: Number(c.skills?.scouting) || 1,
        busy: busy[c.id] || null,
      })),
    });
  } catch (e) { sendError(res, e, 'Could not load your trades.'); }
});

// Lists `qty_total` of an inventory stack on an item stall at `unit_price`
// each (body.lot_price is accepted as the unit price too). No merchants:
// buyers send their own porters to collect.
async function listItemStall(me, item, invId, b) {
  const qty = toInt(b.qty_total), unit = toInt(b.unit_price != null ? b.unit_price : b.lot_price);
  if (!Number.isInteger(qty) || qty <= 0) throw new MarketError(400, 'Invalid quantity.');
  if (!Number.isInteger(unit) || unit <= 0) throw new MarketError(400, 'Set a price per item.');
  if (unit > 1000000) throw new MarketError(400, 'That price is too high.');
  const stalls = await market.stallState({ query }, me.id);
  const cat = market.categoryOf(item);
  // The requested venue, else the first one that sells this and has room.
  let venue = b.venue && stalls[b.venue] ? b.venue : null;
  if (!venue) venue = Object.keys(stalls).find(v => stalls[v].free > 0 && (!stalls[v].sells || stalls[v].sells.includes(cat))) || null;
  if (!venue) {
    const any = Object.values(stalls).some(s => s.slots > 0);
    throw new MarketError(any ? 400 : 403, any ? 'All your stalls are full — wait for a sale or cancel a listing.' : 'Build a Market first.');
  }
  const v = stalls[venue];
  if (!v.slots) throw new MarketError(400, `Build a ${v.label} first.`);
  if (!v.open) throw new MarketError(400, `Your ${v.label} needs a shopkeeper before it can sell.`);
  if (v.sells && !v.sells.includes(cat)) throw new MarketError(400, `Your ${v.label} doesn't sell ${cat} items.`);
  const mods = await market.loadModifiers({ query }, me.id);

  return withTransaction(async (client) => {
    await client.query('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [me.id]);
    const used = (await client.query(
      `SELECT COUNT(*)::int AS n FROM market_orders WHERE seller_settlement_id = $1 AND status = 'active'
          AND kind = 'item' AND COALESCE(venue, 'market') = $2`, [me.id, venue])).rows[0].n;
    if (used >= v.slots) throw new MarketError(400, `All ${v.slots} stalls at your ${v.label} are full.`);
    let snap;
    try { snap = await takeItem(client, me.id, invId, qty); }
    catch (e) { throw new MarketError(e.status || 400, e.message); }
    return (await client.query(
      `INSERT INTO market_orders (seller_settlement_id, kind, item_key, item_snapshot, venue,
                                  lot_size, lot_price, qty_total, qty_escrowed, expires_at)
       VALUES ($1,'item',$2,$3,$4,1,$5,$6,$6, NOW() + make_interval(hours => $7)) RETURNING *`,
      [me.id, snap.item_key, JSON.stringify(snap), venue, unit, qty, mods.expiryHours])).rows[0];
  });
}

// ── POST /api/market/orders ───────────────────────────────────────────────
// { resource, lot_size, lot_price, qty_total, citizen_ids: [] }
router.post('/orders', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) throw new MarketError(400, 'Place your settlement on the map first.');
    const isItem = req.body.kind === 'item';
    const body = {
      resource: isItem ? null : req.body.resource,
      lot_size: toInt(req.body.lot_size), lot_price: toInt(req.body.lot_price), qty_total: toInt(req.body.qty_total),
    };
    // Item orders: read the stack now to validate weight and lot size; it is
    // taken (and re-checked) under a row lock in the transaction below.
    let item = null, invId = null;
    if (isItem) {
      invId = parseId(req.body.inventory_id);
      if (!invId) throw new MarketError(400, 'Choose an item to sell.');
      const row = (await query(
        `SELECT i.*, t.tradeable AS template_tradeable FROM inventory_items i
           LEFT JOIN item_templates t ON t.item_key = i.item_key
          WHERE i.id = $1 AND i.settlement_id = $2`, [invId, me.id])).rows[0];
      if (!row) throw new MarketError(404, 'That item is not in your inventory.');
      const why = untradeableReason(row, row.template_tradeable == null ? null : { tradeable: row.template_tradeable });
      if (why) throw new MarketError(400, why);
      if (body.qty_total > row.quantity) throw new MarketError(400, `You only have ${row.quantity} ${row.name}.`);
      item = snapshotOf(row);
      return res.json({ ok: true, order: await listItemStall(me, item, invId, req.body) });
    }
    const ids = parseCitizenIds(req.body.citizen_ids);
    if (!ids || !ids.length) throw new MarketError(400, 'Choose at least one merchant.');

    const mods = await market.loadModifiers({ query }, me.id);
    if (!mods.marketLevel) throw new MarketError(403, 'Build a Market first.');
    const bad = market.validateOrder(body, mods, item);
    if (bad) throw new MarketError(400, bad);

    const reasons = await unavailable(me.id, ids);
    const firstBad = ids.find(id => reasons[id]);
    if (firstBad) throw new MarketError(400, reasons[firstBad]);

    const order = await withTransaction(async (client) => {
      await client.query('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [me.id]);
      const counts = (await client.query(
        `SELECT (SELECT COUNT(*) FROM market_orders WHERE seller_settlement_id = $1 AND status = 'active' AND kind = 'resource')::int AS orders,
                (SELECT COUNT(*) FROM market_order_merchants m JOIN market_orders o ON o.id = m.order_id
                  WHERE o.seller_settlement_id = $1)::int AS merchants`, [me.id])).rows[0];
      if (counts.orders >= mods.maxOrders)
        throw new MarketError(400, `Your Market can run ${mods.maxOrders} order${mods.maxOrders === 1 ? '' : 's'} at once. Upgrade it for more.`);
      if (counts.merchants + ids.length > mods.merchants)
        throw new MarketError(400, `Your Market has room for ${mods.merchants} merchant${mods.merchants === 1 ? '' : 's'} (${counts.merchants} already working).`);

      let remaining = null, snapshot = null;
      if (isItem) {
        try { snapshot = await takeItem(client, me.id, invId, body.qty_total); }
        catch (e) { throw new MarketError(e.status || 400, e.message); }
      } else {
        const col = body.resource;  // whitelisted by validateOrder
        const paid = await client.query(
          `UPDATE settlements SET ${col} = ${col} - $2 WHERE id = $1 AND ${col} >= $2 RETURNING ${col}`,
          [me.id, body.qty_total]);
        if (!paid.rowCount) throw new MarketError(400, `Not enough ${col} — you need ${body.qty_total}.`);
        remaining = paid.rows[0][col];
      }

      const o = (await client.query(
        `INSERT INTO market_orders (seller_settlement_id, kind, resource, item_key, item_snapshot,
                                    lot_size, lot_price, qty_total, qty_escrowed, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8, NOW() + make_interval(hours => $9)) RETURNING *`,
        [me.id, isItem ? 'item' : 'resource', body.resource, snapshot && snapshot.item_key,
         snapshot && JSON.stringify(snapshot), body.lot_size, body.lot_price, body.qty_total, mods.expiryHours])).rows[0];
      for (const id of ids) {
        // UNIQUE(citizen_id) also guards a racing second listing.
        await client.query('INSERT INTO market_order_merchants (order_id, citizen_id) VALUES ($1,$2)', [o.id, id]);
      }
      await client.query("UPDATE citizens SET role = 'merchant' WHERE id = ANY($1::int[]) AND settlement_id = $2", [ids, me.id]);
      o.remaining = remaining;
      return o;
    });
    res.json({ ok: true, order });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'One of those citizens is already a merchant.' });
    sendError(res, e, 'Could not list that order.');
  }
});

// ── POST /api/market/orders/:id/buy ───────────────────────────────────────
// Buys the next lot. Gold is taken now; a free merchant sets off.
router.post('/orders/:id/buy', requireAuth, async (req, res) => {
  const orderId = parseId(req.params.id);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) throw new MarketError(400, 'Place your settlement on the map first.');
    if (!(await market.marketLevelOf({ query }, me.id))) throw new MarketError(403, 'Build a Market first.');

    const result = await withTransaction(async (client) => {
      const o = (await client.query('SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
      if (!o || o.status !== 'active' || new Date(o.expires_at) <= new Date() || o.qty_escrowed <= 0)
        throw new MarketError(404, 'That order is no longer available.');
      if (o.seller_settlement_id === me.id) throw new MarketError(400, 'You cannot buy your own goods.');
      if (o.kind === 'item') throw new MarketError(409, 'Items are collected: send a porter to pick them up.');
      if (!(await market.canTrade(client, me, o.seller_settlement_id)))
        throw new MarketError(403, 'You do not know that settlement well enough to trade.');

      const merchant = (await client.query(
        `SELECT c.* FROM market_order_merchants m JOIN citizens c ON c.id = m.citizen_id
          WHERE m.order_id = $1 AND COALESCE(c.life_stage, 'adult') NOT IN ('deceased','child') AND NOT ${market.ON_ROAD}
          ORDER BY COALESCE((c.skills->>'scouting')::int, 1) DESC, c.id
          LIMIT 1 FOR UPDATE OF c`, [o.id])).rows[0];
      if (!merchant) throw new MarketError(409, 'Every merchant on that order is on the road. Try again when one returns.');

      const qty = Math.min(o.lot_size, o.qty_escrowed);
      const gold = market.priceFor(o, qty);
      const paid = await client.query(
        'UPDATE settlements SET wealth = wealth - $2 WHERE id = $1 AND wealth >= $2 RETURNING wealth', [me.id, gold]);
      if (!paid.rowCount) throw new MarketError(400, `Not enough gold — that lot costs ${gold}.`);

      const seller = (await client.query('SELECT id, name, tile_q, tile_r FROM settlements WHERE id = $1', [o.seller_settlement_id])).rows[0];
      const sellerMods = await market.loadModifiers(client, o.seller_settlement_id);
      const distance = market.distanceBetween(seller, me) || 0;
      const leg = market.legSeconds(distance, merchant, sellerMods);
      const fee = market.feeFor(gold, sellerMods.feeRate);

      const trip = (await client.query(
        `INSERT INTO market_trips (order_id, seller_settlement_id, buyer_settlement_id, citizen_id, kind, resource,
                                   item_key, item_snapshot, qty, gold_paid, fee, distance, arrives_at, returns_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW() + make_interval(secs => $13), NOW() + make_interval(secs => $13 * 2))
         RETURNING *`,
        [o.id, o.seller_settlement_id, me.id, merchant.id, o.kind, o.resource, o.item_key,
         o.item_snapshot ? JSON.stringify(o.item_snapshot) : null, qty, gold, fee, distance, leg])).rows[0];
      const left = o.qty_escrowed - qty;
      await client.query('UPDATE market_orders SET qty_escrowed = $2 WHERE id = $1', [o.id, left]);
      if (left === 0) await market.closeOrder(client, { ...o, qty_escrowed: 0 }, 'sold_out');
      return { trip, wealth: paid.rows[0].wealth, seller, merchant: merchant.name, soldOut: left === 0 };
    });

    eventBus.publish(result.trip.seller_settlement_id, {
      type: 'market_purchase', order_id: orderId, trip_id: result.trip.id,
      buyer: me.name, resource: result.trip.resource, qty: result.trip.qty, gold: result.trip.gold_paid,
      sold_out: result.soldOut, ...market.itemEventBits(result.trip),
    });
    res.json({
      ok: true, wealth: result.wealth, merchant: result.merchant, seller: result.seller.name,
      trip: {
        id: result.trip.id, kind: result.trip.kind, resource: result.trip.resource, item: result.trip.item_snapshot,
        qty: result.trip.qty, gold_paid: result.trip.gold_paid,
        distance: result.trip.distance, departs_at: result.trip.departs_at, arrives_at: result.trip.arrives_at,
      },
    });
  } catch (e) { sendError(res, e, 'Could not buy that lot.'); }
});

// ── POST /api/market/orders/:id/pickup ────────────────────────────────────
// { qty, citizen_id } — send a porter to collect items from a stall. The
// gold is held now, paid to the seller when the porter arrives; the units
// are reserved so nobody else can take them meanwhile.
router.post('/orders/:id/pickup', requireAuth, async (req, res) => {
  const orderId = parseId(req.params.id);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) throw new MarketError(400, 'Place your settlement on the map first.');
    if (!(await market.marketLevelOf({ query }, me.id))) throw new MarketError(403, 'Build a Market first.');
    const qty = toInt(req.body.qty), citizenId = parseId(req.body.citizen_id);
    if (!Number.isInteger(qty) || qty <= 0) throw new MarketError(400, 'Invalid quantity.');
    if (!citizenId) throw new MarketError(400, 'Choose a porter.');
    const reasons = await unavailable(me.id, [citizenId]);
    if (reasons[citizenId]) throw new MarketError(400, reasons[citizenId]);

    const result = await withTransaction(async (client) => {
      const o = (await client.query('SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
      if (!o || o.kind !== 'item' || o.status !== 'active' || new Date(o.expires_at) <= new Date())
        throw new MarketError(404, 'That listing is no longer available.');
      const open = (await client.query(`SELECT ${market.venueOpenSql('o')} AS open FROM market_orders o WHERE o.id = $1`, [o.id])).rows[0].open;
      if (!open) throw new MarketError(409, 'That shop is closed — nobody is minding it right now.');
      if (o.seller_settlement_id === me.id) throw new MarketError(400, 'You cannot buy your own goods.');
      const available = o.qty_escrowed - o.qty_reserved;
      if (available < qty) throw new MarketError(409, available > 0 ? `Only ${available} left on that stall.` : 'That stall is sold out.');
      const max = market.porterMax(o.item_snapshot);
      if (qty > max) throw new MarketError(400, `A porter can carry at most ${max} ${o.item_snapshot.name}.`);
      if (!(await market.canTrade(client, me, o.seller_settlement_id)))
        throw new MarketError(403, 'You do not know that settlement well enough to trade.');

      const gold = o.lot_price * qty;
      const paid = await client.query(
        'UPDATE settlements SET wealth = wealth - $2 WHERE id = $1 AND wealth >= $2 RETURNING wealth', [me.id, gold]);
      if (!paid.rowCount) throw new MarketError(400, `Not enough gold — that costs ${gold}.`);
      const seller = (await client.query('SELECT id, name, tile_q, tile_r FROM settlements WHERE id = $1', [o.seller_settlement_id])).rows[0];
      const sellerMods = await market.loadModifiers(client, o.seller_settlement_id);
      const cit = (await client.query('SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2', [citizenId, me.id])).rows[0];
      const distance = market.distanceBetween(me, seller) || 0;
      const leg = market.legSeconds(distance, cit, {});
      const run = (await client.query(
        `INSERT INTO market_runs (kind, settlement_id, citizen_id, order_id, target_settlement_id, target_name, target_q, target_r,
                                  item_key, item_snapshot, qty, gold, fee, distance, arrives_at, returns_at)
         VALUES ('pickup',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW() + make_interval(secs => $14), NOW() + make_interval(secs => $14 * 2))
         RETURNING *`,
        [me.id, citizenId, o.id, seller.id, seller.name, seller.tile_q, seller.tile_r, o.item_key, JSON.stringify(o.item_snapshot),
         qty, gold, market.feeFor(gold, sellerMods.feeRate), distance, leg])).rows[0];
      await client.query('UPDATE market_orders SET qty_reserved = qty_reserved + $2 WHERE id = $1', [o.id, qty]);
      return { run, wealth: paid.rows[0].wealth, porter: cit.name, seller };
    });
    eventBus.publish(result.seller.id, {
      type: 'market_pickup_coming', run_id: result.run.id, buyer: me.name, qty: result.run.qty,
      ...market.itemEventBits({ kind: 'item', item_snapshot: result.run.item_snapshot }),
    });
    res.json({
      ok: true, wealth: result.wealth, porter: result.porter, seller: result.seller.name,
      run: { id: result.run.id, qty: result.run.qty, gold: result.run.gold, item: result.run.item_snapshot,
             arrives_at: result.run.arrives_at, returns_at: result.run.returns_at, distance: result.run.distance },
    });
  } catch (e) { sendError(res, e, 'Could not send the porter.'); }
});

// ── Shops: who minds each one ──────────────────────────────────────────────

// GET /api/market/shops — your stall venues, their keepers, and who could keep them.
router.get('/shops', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    res.json({ ok: true, stalls: await market.stallState({ query }, me.id), candidates: await freeAdults(me.id) });
  } catch (e) { sendError(res, e, 'Could not load your shops.'); }
});

// PATCH /api/market/shops/:venue/keeper { citizen_id | null }
router.patch('/shops/:venue/keeper', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    const venue = req.params.venue;
    const def = market.VENUES[venue];
    if (!def || !def.keeper) throw new MarketError(400, 'That building has no shopkeeper.');
    const built = (await query('SELECT 1 FROM buildings WHERE settlement_id = $1 AND type = $2', [me.id, def.building])).rowCount;
    if (!built) throw new MarketError(400, `Build a ${def.label} first.`);
    const citizenId = req.body.citizen_id == null ? null : parseId(req.body.citizen_id);
    if (req.body.citizen_id != null && !citizenId) throw new MarketError(400, 'Bad citizen id.');
    if (citizenId) {
      const reasons = await unavailable(me.id, [citizenId]);
      if (reasons[citizenId]) throw new MarketError(400, reasons[citizenId]);
    }
    await withTransaction(async (client) => {
      const prev = (await client.query('DELETE FROM shop_keepers WHERE settlement_id = $1 AND venue = $2 RETURNING citizen_id', [me.id, venue])).rows[0];
      if (prev) await client.query("UPDATE citizens SET role = 'idle' WHERE id = $1 AND role = 'shopkeeper'", [prev.citizen_id]);
      if (citizenId) {
        await client.query('INSERT INTO shop_keepers (settlement_id, venue, citizen_id) VALUES ($1,$2,$3)', [me.id, venue, citizenId]);
        await client.query("UPDATE citizens SET role = 'shopkeeper' WHERE id = $1 AND settlement_id = $2", [citizenId, me.id]);
      }
    });
    res.json({ ok: true, stalls: await market.stallState({ query }, me.id) });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'That citizen already minds another shop.' });
    sendError(res, e, 'Could not change the shopkeeper.');
  }
});

// ── Buy orders ("Wanted") ─────────────────────────────────────────────────

function wantView(w, me) {
  const per = w.per || 1;
  return {
    id: w.id, kind: w.kind, item_key: w.item_key, resource: w.resource,
    item: w.kind === 'item' ? { name: w.item_name, icon: w.item_icon, cat: w.item_cat } : null,
    qty_total: w.qty_total, qty_open: w.qty_open, price: w.price, per,
    unit_price: Math.round((w.price / per) * 100) / 100,
    total_open: market.wantGold(w.price, w.qty_open, per),
    status: w.status, expires_at: w.expires_at, created_at: w.created_at,
    buyer: w.buyer_name ? { id: w.buyer_settlement_id, name: w.buyer_name, username: w.buyer_username, species: w.buyer_species } : undefined,
    distance: me && w.tile_q != null ? market.distanceBetween(me, w) : undefined,
  };
}

// GET /api/market/wants?category=&item_key=&resource= — other towns' buy
// orders you could fill (trade partners only).
router.get('/wants', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) return res.json({ ok: true, wants: [] });
    const params = [me.user_id, me.tile_q, me.tile_r, me.world_version, me.id];
    let extra = '';
    if (req.query.item_key) { params.push(String(req.query.item_key)); extra += ` AND w.item_key = $${params.length}`; }
    else if (req.query.resource === 'resources') extra += ` AND w.kind = 'resource'`;
    else if (market.isTradeable(req.query.resource)) { params.push(req.query.resource); extra += ` AND w.resource = $${params.length}`; }
    else if (market.ITEM_CATEGORIES.includes(req.query.category)) { params.push(req.query.category); extra += ` AND w.item_cat = $${params.length}`; }
    const rows = (await query(
      `SELECT w.*, s.name AS buyer_name, s.tile_q, s.tile_r, u.username AS buyer_username, u.species AS buyer_species
         FROM market_wants w JOIN settlements s ON s.id = w.buyer_settlement_id JOIN users u ON u.id = s.user_id
        WHERE w.status = 'active' AND w.expires_at > NOW() AND w.qty_open > 0
          AND ${market.tradePartnerSql('s', { userId: '$1', q: '$2', r: '$3', worldVersion: '$4', settlementId: '$5' })}
          ${extra}
        ORDER BY (w.price::float / w.per) DESC, w.created_at LIMIT 200`, params)).rows;
    // What you hold that could fill each one.
    const haveItems = Object.fromEntries((await query(
      `SELECT item_key, SUM(quantity)::int AS n FROM inventory_items
        WHERE settlement_id = $1 AND equipped_to IS NULL AND tradeable GROUP BY item_key`, [me.id])).rows.map(r => [r.item_key, r.n]));
    const mods = await market.loadModifiers({ query }, me.id);
    res.json({ ok: true, wants: rows.map(w => {
      const v = wantView(w, me);
      v.you_have = w.kind === 'item' ? (haveItems[w.item_key] || 0) : (me[w.resource] || 0);
      v.carry_max = w.kind === 'item' ? market.porterMax({ category: w.item_cat === 'fish' || w.item_cat === 'food' ? w.item_cat : 'misc',
        equip_slot: ['weapon', 'armour', 'tool', 'trinket'].includes(w.item_cat) ? w.item_cat : null }) : market.fillMaxResource(w.resource, mods);
      return v;
    }) });
  } catch (e) { sendError(res, e, 'Could not load wanted orders.'); }
});

// POST /api/market/wants { kind, item_key | resource, qty, price }
// price is per item, or per 100 units of a resource. The gold is held.
router.post('/wants', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) throw new MarketError(400, 'Place your settlement on the map first.');
    const mods = await market.loadModifiers({ query }, me.id);
    if (!mods.marketLevel) throw new MarketError(403, 'Build a Market first.');
    const kind = req.body.kind === 'resource' ? 'resource' : 'item';
    const qty = toInt(req.body.qty), price = toInt(req.body.price);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 1000000) throw new MarketError(400, 'Invalid quantity.');
    if (!Number.isInteger(price) || price <= 0 || price > 1000000) throw new MarketError(400, 'Set a price.');
    let tpl = null, per = 1;
    if (kind === 'item') {
      tpl = (await query('SELECT * FROM item_templates WHERE item_key = $1', [String(req.body.item_key || '')])).rows[0];
      if (!tpl) throw new MarketError(400, 'Pick an item from the list.');
      if (tpl.tradeable === false) throw new MarketError(400, 'That item cannot be traded.');
    } else {
      if (!market.isTradeable(req.body.resource)) throw new MarketError(400, 'That resource cannot be traded.');
      per = market.WANT_RESOURCE_PER;
    }
    const gold = market.wantGold(price, qty, per);
    const want = await withTransaction(async (client) => {
      await client.query('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [me.id]);
      const n = (await client.query("SELECT COUNT(*)::int AS n FROM market_wants WHERE buyer_settlement_id = $1 AND status = 'active'", [me.id])).rows[0].n;
      const cap = market.wantsMax(mods.marketLevel);
      if (n >= cap) throw new MarketError(400, `Your Market can post ${cap} wanted orders at once.`);
      const paid = await client.query('UPDATE settlements SET wealth = wealth - $2 WHERE id = $1 AND wealth >= $2', [me.id, gold]);
      if (!paid.rowCount) throw new MarketError(400, `Not enough gold — this needs ${gold} held.`);
      return (await client.query(
        `INSERT INTO market_wants (buyer_settlement_id, kind, item_key, item_name, item_icon, item_cat, resource,
                                   qty_total, qty_open, price, per, gold_held, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11, NOW() + make_interval(hours => $12)) RETURNING *`,
        [me.id, kind, tpl && tpl.item_key, tpl && tpl.name, tpl && tpl.icon, tpl && market.categoryOf(tpl),
         kind === 'resource' ? req.body.resource : null, qty, price, per, gold, mods.expiryHours])).rows[0];
    });
    res.json({ ok: true, want: wantView(want), gold_held: gold });
  } catch (e) { sendError(res, e, 'Could not post that order.'); }
});

// POST /api/market/wants/:id/cancel — refunds the gold not yet promised.
router.post('/wants/:id/cancel', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id.' });
  try {
    const me = await mySettlement(req.user.userId);
    const refunded = await withTransaction(async (client) => {
      const w = (await client.query(
        "SELECT * FROM market_wants WHERE id = $1 AND buyer_settlement_id = $2 AND status = 'active' FOR UPDATE", [id, me.id])).rows[0];
      if (!w) throw new MarketError(404, 'Order not found.');
      return market.closeWant(client, w, 'cancelled');
    });
    res.json({ ok: true, refunded });
  } catch (e) { sendError(res, e, 'Could not cancel that order.'); }
});

// POST /api/market/wants/:id/fill { qty, citizen_id, inventory_id? }
// Your porter takes the goods to the buyer; you're paid when they're home.
router.post('/wants/:id/fill', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id.' });
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) throw new MarketError(400, 'Place your settlement on the map first.');
    const qty = toInt(req.body.qty), citizenId = parseId(req.body.citizen_id);
    if (!Number.isInteger(qty) || qty <= 0) throw new MarketError(400, 'Invalid quantity.');
    if (!citizenId) throw new MarketError(400, 'Choose a porter.');
    const reasons = await unavailable(me.id, [citizenId]);
    if (reasons[citizenId]) throw new MarketError(400, reasons[citizenId]);
    const mods = await market.loadModifiers({ query }, me.id);

    const result = await withTransaction(async (client) => {
      const w = (await client.query('SELECT * FROM market_wants WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!w || w.status !== 'active' || new Date(w.expires_at) <= new Date()) throw new MarketError(404, 'That order is no longer open.');
      if (w.buyer_settlement_id === me.id) throw new MarketError(400, 'You cannot fill your own order.');
      if (qty > w.qty_open) throw new MarketError(409, w.qty_open ? `They only want ${w.qty_open} more.` : 'That order is already filled.');
      if (!(await market.canTrade(client, me, w.buyer_settlement_id)))
        throw new MarketError(403, 'You do not know that settlement well enough to trade.');

      let snap = null;
      if (w.kind === 'item') {
        // Optional inventory_id: if given it must be the wanted item. The
        // units come from all your matching stacks (equipment is one row
        // per piece).
        const invId = parseId(req.body.inventory_id);
        if (invId) {
          const row = (await client.query('SELECT item_key FROM inventory_items WHERE id = $1 AND settlement_id = $2', [invId, me.id])).rows[0];
          if (!row) throw new MarketError(404, 'That item is not in your inventory.');
          if (row.item_key !== w.item_key) throw new MarketError(400, `They want ${w.item_name}, exactly.`);
        }
        const tpl = (await client.query('SELECT item_key, category, equip_slot FROM item_templates WHERE item_key = $1', [w.item_key])).rows[0];
        const max = market.porterMax(tpl || { category: w.item_cat });
        if (qty > max) throw new MarketError(400, `A porter can carry at most ${max} ${w.item_name}.`);
        try { snap = await takeItemsByKey(client, me.id, w.item_key, qty); }
        catch (e) { throw new MarketError(e.status || 400, e.message); }
      } else {
        const max = market.fillMaxResource(w.resource, mods);
        if (qty > max) throw new MarketError(400, `You can carry at most ${max} ${w.resource} per trip.`);
        const col = w.resource;   // whitelisted at posting
        const took = await client.query(`UPDATE settlements SET ${col} = ${col} - $2 WHERE id = $1 AND ${col} >= $2`, [me.id, qty]);
        if (!took.rowCount) throw new MarketError(400, `Not enough ${col}.`);
      }
      const gold = Math.min(w.gold_held, market.wantGold(w.price, qty, w.per));
      const left = w.qty_open - qty;
      await client.query('UPDATE market_wants SET qty_open = $2, gold_held = gold_held - $3 WHERE id = $1', [w.id, left, gold]);
      if (left === 0) {
        // Fully promised: return any rounding remainder and close.
        const after = (await client.query('SELECT * FROM market_wants WHERE id = $1', [w.id])).rows[0];
        await market.closeWant(client, after, 'filled');
      }
      const buyer = (await client.query('SELECT id, name, tile_q, tile_r FROM settlements WHERE id = $1', [w.buyer_settlement_id])).rows[0];
      const cit = (await client.query('SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2', [citizenId, me.id])).rows[0];
      const distance = market.distanceBetween(me, buyer) || 0;
      const leg = market.legSeconds(distance, cit, mods);
      const run = (await client.query(
        `INSERT INTO market_runs (kind, settlement_id, citizen_id, want_id, target_settlement_id, target_name, target_q, target_r,
                                  item_key, item_snapshot, resource, qty, gold, fee, distance, arrives_at, returns_at)
         VALUES ('fill',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW() + make_interval(secs => $15), NOW() + make_interval(secs => $15 * 2))
         RETURNING *`,
        [me.id, citizenId, w.id, buyer.id, buyer.name, buyer.tile_q, buyer.tile_r, snap && snap.item_key,
         snap && JSON.stringify(snap), w.kind === 'resource' ? w.resource : null, qty, gold, market.feeFor(gold, mods.feeRate), distance, leg])).rows[0];
      return { run, buyer, porter: cit.name, want: w };
    });
    eventBus.publish(result.buyer.id, {
      type: 'market_want_filling', want_id: id, seller: me.name, qty, resource: result.want.resource,
      ...(result.want.kind === 'item' ? { item: { name: result.want.item_name, icon: result.want.item_icon } } : {}),
    });
    res.json({ ok: true, porter: result.porter, buyer: result.buyer.name, gold: result.run.gold, fee: result.run.fee,
      run: { id: result.run.id, qty: result.run.qty, arrives_at: result.run.arrives_at, returns_at: result.run.returns_at } });
  } catch (e) { sendError(res, e, 'Could not fill that order.'); }
});

// ── POST /api/market/orders/:id/cancel ────────────────────────────────────
// Refunds the undispatched goods. Merchants on the road finish their trip.
router.post('/orders/:id/cancel', requireAuth, async (req, res) => {
  const orderId = parseId(req.params.id);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    const refunded = await withTransaction(async (client) => {
      const o = (await client.query(
        "SELECT * FROM market_orders WHERE id = $1 AND seller_settlement_id = $2 AND status = 'active' FOR UPDATE",
        [orderId, me.id])).rows[0];
      if (!o) throw new MarketError(404, 'Order not found.');
      return market.closeOrder(client, o, 'cancelled');
    });
    res.json({ ok: true, refunded });
  } catch (e) { sendError(res, e, 'Could not cancel that order.'); }
});

// ── PATCH /api/market/orders/:id/merchants ────────────────────────────────
// { add: [citizenId], remove: [citizenId] }. Only merchants at home leave.
router.patch('/orders/:id/merchants', requireAuth, async (req, res) => {
  const orderId = parseId(req.params.id);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    const add = parseCitizenIds(req.body.add || []);
    const remove = parseCitizenIds(req.body.remove || []);
    if (!add || !remove) throw new MarketError(400, 'Bad citizen ids.');
    if (add.length) {
      const reasons = await unavailable(me.id, add);
      const firstBad = add.find(id => reasons[id]);
      if (firstBad) throw new MarketError(400, reasons[firstBad]);
    }
    const mods = await market.loadModifiers({ query }, me.id);

    await withTransaction(async (client) => {
      const o = (await client.query(
        "SELECT * FROM market_orders WHERE id = $1 AND seller_settlement_id = $2 AND status = 'active' FOR UPDATE",
        [orderId, me.id])).rows[0];
      if (!o) throw new MarketError(404, 'Order not found.');
      if (remove.length) {
        const onRoad = (await client.query(
          `SELECT c.name FROM citizens c WHERE c.id = ANY($1::int[]) AND ${market.ON_ROAD}`, [remove])).rows;
        if (onRoad.length) throw new MarketError(400, `${onRoad[0].name} is on the road — wait until they return.`);
        await client.query('DELETE FROM market_order_merchants WHERE order_id = $1 AND citizen_id = ANY($2::int[])', [o.id, remove]);
        await client.query("UPDATE citizens SET role = 'idle' WHERE id = ANY($1::int[]) AND settlement_id = $2 AND role = 'merchant'", [remove, me.id]);
      }
      if (add.length) {
        const n = (await client.query(
          `SELECT COUNT(*)::int AS n FROM market_order_merchants m JOIN market_orders o ON o.id = m.order_id
            WHERE o.seller_settlement_id = $1`, [me.id])).rows[0].n;
        if (n + add.length > mods.merchants)
          throw new MarketError(400, `Your Market has room for ${mods.merchants} merchant${mods.merchants === 1 ? '' : 's'}.`);
        for (const id of add)
          await client.query('INSERT INTO market_order_merchants (order_id, citizen_id) VALUES ($1,$2)', [o.id, id]);
        await client.query("UPDATE citizens SET role = 'merchant' WHERE id = ANY($1::int[]) AND settlement_id = $2", [add, me.id]);
      }
      const left = (await client.query('SELECT COUNT(*)::int AS n FROM market_order_merchants WHERE order_id = $1', [o.id])).rows[0].n;
      if (!left) throw new MarketError(400, 'An order needs at least one merchant — cancel it instead.');
    });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'That citizen is already a merchant.' });
    sendError(res, e, 'Could not update merchants.');
  }
});

// ── GET /api/market/catalog?q=iro ─────────────────────────────────────────
// Search box autocomplete: tradeable item names containing q (3+ chars).
// Without q: the item categories with how many open orders each has.
router.get('/catalog', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length >= 3) {
      const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
      const rows = (await query(
        `SELECT item_key, name, icon, category, equip_slot, rarity FROM item_templates
          WHERE tradeable AND name ILIKE $1
          ORDER BY (lower(name) LIKE lower($2)) DESC, name LIMIT 8`, [like, q + '%'])).rows;
      return res.json({ ok: true, items: rows.map(r => ({ ...r, cat: market.categoryOf(r) })) });
    }
    const counts = (await query(
      `SELECT ${market.categorySql('o.item_snapshot', true)} AS cat, COUNT(*)::int AS n
         FROM market_orders o WHERE o.status = 'active' AND o.kind = 'item' GROUP BY 1`)).rows;
    res.json({ ok: true, items: [], categories: market.ITEM_CATEGORIES.map(c => ({ cat: c, n: (counts.find(x => x.cat === c) || {}).n || 0 })) });
  } catch (e) { sendError(res, e, 'Search failed.'); }
});

// ── Ironhaven: sell items to the kingdom for little, by porter ────────────

// Free adults who could carry for the Market (porters / merchants).
async function freeAdults(settlementId) {
  const adults = (await query(
    `SELECT id, name, role, skills FROM citizens
      WHERE settlement_id = $1 AND COALESCE(life_stage, 'adult') NOT IN ('child','deceased') ORDER BY name`, [settlementId])).rows;
  const busy = adults.length ? await unavailable(settlementId, adults.map(c => c.id)) : {};
  return adults.map(c => ({ id: c.id, name: c.name, role: c.role, scouting: Number(c.skills?.scouting) || 1, busy: busy[c.id] || null }));
}

async function ironhavenState(me) {
  const ih = await market.ironhavenTile({ query });
  const templates = (await query('SELECT item_key, name, icon, category, equip_slot, sell_value, tradeable FROM item_templates')).rows;
  const wants = market.ironhavenWants(templates);
  const tplBy = Object.fromEntries(templates.map(t => [t.item_key, t]));
  const best = Object.fromEntries((await query(
    `SELECT item_key, MIN(lot_price::float / lot_size) AS p FROM market_orders
      WHERE status = 'active' AND kind = 'item' GROUP BY item_key`)).rows.map(r => [r.item_key, Math.round(r.p * 100) / 100]));
  const inv = (await query(
    `SELECT i.*, t.tradeable AS template_tradeable, t.sell_value AS template_sell
       FROM inventory_items i LEFT JOIN item_templates t ON t.item_key = i.item_key
      WHERE i.settlement_id = $1 ORDER BY i.category, i.name`, [me.id])).rows;
  const distance = ih ? market.distanceBetween(me, ih) : null;
  return {
    ironhaven: ih ? { name: ih.name, q: ih.tile_q, r: ih.tile_r, distance, leg_seconds: market.legSeconds(distance, null, {}) } : null,
    week_ends: market.weekEnds().toISOString(),
    rate: market.IRONHAVEN_RATE, want_rate: market.IRONHAVEN_WANT_RATE, porter_carry: market.PORTER_CARRY,
    wants: wants.map(k => {
      const t = tplBy[k];
      return { item_key: k, name: t.name, icon: t.icon, cat: market.categoryOf(t), unit_price: market.ironhavenUnitPrice(t.sell_value, true) };
    }),
    items: inv.map(r => {
      const snap = snapshotOf(r);
      const why = untradeableReason(r, r.template_tradeable == null ? null : { tradeable: r.template_tradeable });
      const value = Number(r.template_sell) || Number(r.metadata && r.metadata.sell_value) || 1;
      const wanted = wants.includes(r.item_key);
      return {
        id: r.id, ...snap, quantity: r.quantity, cat: market.categoryOf(snap),
        tradeable: !why, reason: why, wanted,
        unit_price: market.ironhavenUnitPrice(value, wanted),
        player_price: best[r.item_key] || null,
        max_qty: Math.min(r.quantity, market.porterMax(snap)),
      };
    }),
  };
}

// GET /api/market/ironhaven — wants, offers per stack, porters, runs.
router.get('/ironhaven', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    const runs = (await query(
      `SELECT r.*, c.name AS citizen_name FROM market_runs r LEFT JOIN citizens c ON c.id = r.citizen_id
        WHERE r.settlement_id = $1 AND r.kind = 'ironhaven'
          AND (r.status <> 'done' OR r.returns_at > NOW() - INTERVAL '24 hours')
        ORDER BY r.departs_at DESC LIMIT 20`, [me.id])).rows;
    res.json({
      ok: true, now: new Date().toISOString(), ...(await ironhavenState(me)),
      candidates: await freeAdults(me.id),
      runs: runs.map(r => ({
        id: r.id, status: r.status, qty: r.qty, gold: r.gold, item: r.item_snapshot, citizen_name: r.citizen_name,
        departs_at: r.departs_at, arrives_at: r.arrives_at, returns_at: r.returns_at, distance: r.distance,
      })),
    });
  } catch (e) { sendError(res, e, 'Could not reach Ironhaven.'); }
});

// POST /api/market/ironhaven/sell { inventory_id, qty, citizen_id }
// The porter takes the items now; the gold (priced now) arrives with them.
router.post('/ironhaven/sell', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) throw new MarketError(400, 'Place your settlement on the map first.');
    const invId = parseId(req.body.inventory_id), citizenId = parseId(req.body.citizen_id);
    const qty = toInt(req.body.qty);
    if (!invId) throw new MarketError(400, 'Choose an item to sell.');
    if (!citizenId) throw new MarketError(400, 'Choose a porter.');
    if (!Number.isInteger(qty) || qty <= 0) throw new MarketError(400, 'Invalid quantity.');
    const ih = await market.ironhavenTile({ query });
    if (!ih) throw new MarketError(503, 'Ironhaven cannot be reached right now.');
    const reasons = await unavailable(me.id, [citizenId]);
    if (reasons[citizenId]) throw new MarketError(400, reasons[citizenId]);

    const result = await withTransaction(async (client) => {
      const row = (await client.query('SELECT * FROM inventory_items WHERE id = $1 AND settlement_id = $2', [invId, me.id])).rows[0];
      if (!row) throw new MarketError(404, 'That item is not in your inventory.');
      const max = market.porterMax(snapshotOf(row));
      if (qty > max) throw new MarketError(400, `A porter can carry at most ${max} ${row.name}.`);
      let snap;
      try { snap = await takeItem(client, me.id, invId, qty); }
      catch (e) { throw new MarketError(e.status || 400, e.message); }
      const tpl = (await client.query('SELECT item_key, sell_value, tradeable FROM item_templates')).rows;
      const wanted = market.ironhavenWants(tpl).includes(snap.item_key);
      const t = tpl.find(x => x.item_key === snap.item_key);
      const value = (t && Number(t.sell_value)) || Number(snap.metadata && snap.metadata.sell_value) || 1;
      const gold = market.ironhavenUnitPrice(value, wanted) * qty;
      const cit = (await client.query('SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2', [citizenId, me.id])).rows[0];
      const distance = market.distanceBetween(me, ih) || 0;
      const leg = market.legSeconds(distance, cit, {});
      const run = (await client.query(
        `INSERT INTO market_runs (kind, settlement_id, citizen_id, target_name, target_q, target_r, item_key, item_snapshot,
                                  qty, gold, distance, arrives_at, returns_at)
         VALUES ('ironhaven',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() + make_interval(secs => $11), NOW() + make_interval(secs => $11 * 2))
         RETURNING *`,
        [me.id, citizenId, ih.name, ih.tile_q, ih.tile_r, snap.item_key, JSON.stringify(snap), qty, gold, distance, leg])).rows[0];
      return { run, citizen: cit.name, wanted };
    });
    res.json({
      ok: true, gold: result.run.gold, wanted: result.wanted, porter: result.citizen,
      run: { id: result.run.id, qty: result.run.qty, item: result.run.item_snapshot, arrives_at: result.run.arrives_at, returns_at: result.run.returns_at },
    });
  } catch (e) { sendError(res, e, 'Could not send the porter.'); }
});

module.exports = router;
