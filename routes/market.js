// /api/market — player-to-player trading. See lib/market.js for the flow.
const express = require('express');
const { query, withTransaction } = require('../db');
const requireAuth = require('../middleware/auth');
const { BUILDINGS } = require('../buildings');
const market = require('../lib/market');
const eventBus = require('../lib/event_bus');

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
  mark(await market.merchantCitizenIds(ids), 'is already a merchant.');
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
      `SELECT (SELECT COUNT(*) FROM market_orders WHERE seller_settlement_id = $1 AND status = 'active')::int AS orders,
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
    if (req.query.resource && market.isTradeable(req.query.resource)) {
      params.push(req.query.resource); extra += ` AND o.resource = $${params.length}`;
    }
    const sellerId = parseId(req.query.seller);
    if (sellerId) { params.push(sellerId); extra += ` AND o.seller_settlement_id = $${params.length}`; }

    const live = "COALESCE(c.life_stage, 'adult') NOT IN ('deceased','child')";
    const rows = (await query(
      `SELECT o.id, o.resource, o.lot_size, o.lot_price, o.qty_total, o.qty_escrowed, o.created_at, o.expires_at,
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
          AND ${market.tradePartnerSql('s', { userId: '$1', q: '$2', r: '$3', worldVersion: '$4', settlementId: '$5' })}
          ${extra}
        LIMIT 500`, params)).rows;

    const now = Date.now();
    const orders = rows.filter(o => o.merchants > 0).map(o => {
      const distance = market.distanceBetween(me, o);
      const mods = market.tradeModifiers(o.seller_market_level);
      const paused = o.free_scouting == null;
      const leg = market.legSeconds(distance, { skills: { scouting: paused ? 1 : o.free_scouting } }, mods);
      const wait = paused && o.next_free_at ? Math.max(0, Math.round((new Date(o.next_free_at).getTime() - now) / 1000)) : 0;
      const nextQty = Math.min(o.lot_size, o.qty_escrowed);
      return {
        id: o.id, resource: o.resource,
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
        id: t.id, order_id: t.order_id, resource: t.resource, qty: t.qty,
        gold_paid: t.gold_paid, fee: t.fee, distance: t.distance, status: t.status,
        departs_at: t.departs_at, arrives_at: t.arrives_at, returns_at: t.returns_at,
        direction: t.seller_settlement_id === me.id ? 'selling' : 'buying',
        seller_name: t.seller_name, buyer_name: t.buyer_name, citizen_name: t.citizen_name,
      })),
      candidates: adults.map(c => ({
        id: c.id, name: c.name, role: c.role, scouting: Number(c.skills?.scouting) || 1,
        busy: busy[c.id] || null,
      })),
    });
  } catch (e) { sendError(res, e, 'Could not load your trades.'); }
});

// ── POST /api/market/orders ───────────────────────────────────────────────
// { resource, lot_size, lot_price, qty_total, citizen_ids: [] }
router.post('/orders', requireAuth, async (req, res) => {
  try {
    const me = await mySettlement(req.user.userId);
    await settle(me.id);
    if (me.tile_q == null) throw new MarketError(400, 'Place your settlement on the map first.');
    const body = {
      resource: req.body.resource,
      lot_size: toInt(req.body.lot_size), lot_price: toInt(req.body.lot_price), qty_total: toInt(req.body.qty_total),
    };
    const ids = parseCitizenIds(req.body.citizen_ids);
    if (!ids || !ids.length) throw new MarketError(400, 'Choose at least one merchant.');

    const mods = await market.loadModifiers({ query }, me.id);
    if (!mods.marketLevel) throw new MarketError(403, 'Build a Market first.');
    const bad = market.validateOrder(body, mods);
    if (bad) throw new MarketError(400, bad);

    const reasons = await unavailable(me.id, ids);
    const firstBad = ids.find(id => reasons[id]);
    if (firstBad) throw new MarketError(400, reasons[firstBad]);

    const order = await withTransaction(async (client) => {
      await client.query('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [me.id]);
      const counts = (await client.query(
        `SELECT (SELECT COUNT(*) FROM market_orders WHERE seller_settlement_id = $1 AND status = 'active')::int AS orders,
                (SELECT COUNT(*) FROM market_order_merchants m JOIN market_orders o ON o.id = m.order_id
                  WHERE o.seller_settlement_id = $1)::int AS merchants`, [me.id])).rows[0];
      if (counts.orders >= mods.maxOrders)
        throw new MarketError(400, `Your Market can run ${mods.maxOrders} order${mods.maxOrders === 1 ? '' : 's'} at once. Upgrade it for more.`);
      if (counts.merchants + ids.length > mods.merchants)
        throw new MarketError(400, `Your Market has room for ${mods.merchants} merchant${mods.merchants === 1 ? '' : 's'} (${counts.merchants} already working).`);

      const col = body.resource;  // whitelisted by validateOrder
      const paid = await client.query(
        `UPDATE settlements SET ${col} = ${col} - $2 WHERE id = $1 AND ${col} >= $2 RETURNING ${col}`,
        [me.id, body.qty_total]);
      if (!paid.rowCount) throw new MarketError(400, `Not enough ${col} — you need ${body.qty_total}.`);

      const o = (await client.query(
        `INSERT INTO market_orders (seller_settlement_id, resource, lot_size, lot_price, qty_total, qty_escrowed, expires_at)
         VALUES ($1,$2,$3,$4,$5,$5, NOW() + make_interval(hours => $6)) RETURNING *`,
        [me.id, col, body.lot_size, body.lot_price, body.qty_total, mods.expiryHours])).rows[0];
      for (const id of ids) {
        // UNIQUE(citizen_id) also guards a racing second listing.
        await client.query('INSERT INTO market_order_merchants (order_id, citizen_id) VALUES ($1,$2)', [o.id, id]);
      }
      await client.query("UPDATE citizens SET role = 'merchant' WHERE id = ANY($1::int[]) AND settlement_id = $2", [ids, me.id]);
      o.remaining = paid.rows[0][col];
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
        `INSERT INTO market_trips (order_id, seller_settlement_id, buyer_settlement_id, citizen_id, resource, qty,
                                   gold_paid, fee, distance, arrives_at, returns_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW() + make_interval(secs => $10), NOW() + make_interval(secs => $10 * 2))
         RETURNING *`,
        [o.id, o.seller_settlement_id, me.id, merchant.id, o.resource, qty, gold, fee, distance, leg])).rows[0];
      const left = o.qty_escrowed - qty;
      await client.query('UPDATE market_orders SET qty_escrowed = $2 WHERE id = $1', [o.id, left]);
      if (left === 0) await market.closeOrder(client, { ...o, qty_escrowed: 0 }, 'sold_out');
      return { trip, wealth: paid.rows[0].wealth, seller, merchant: merchant.name, soldOut: left === 0 };
    });

    eventBus.publish(result.trip.seller_settlement_id, {
      type: 'market_purchase', order_id: orderId, trip_id: result.trip.id,
      buyer: me.name, resource: result.trip.resource, qty: result.trip.qty, gold: result.trip.gold_paid,
      sold_out: result.soldOut,
    });
    res.json({
      ok: true, wealth: result.wealth, merchant: result.merchant, seller: result.seller.name,
      trip: {
        id: result.trip.id, resource: result.trip.resource, qty: result.trip.qty, gold_paid: result.trip.gold_paid,
        distance: result.trip.distance, departs_at: result.trip.departs_at, arrives_at: result.trip.arrives_at,
      },
    });
  } catch (e) { sendError(res, e, 'Could not buy that lot.'); }
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

module.exports = router;
