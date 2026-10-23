// scripts/market_test.js — checks for the player-to-player Market.
//
// Part 1 is pure (caps, pricing, travel, validation) and needs no database.
// Part 2 drives a running server over HTTP against the same DATABASE_URL.
// Run Part 2 only against a throwaway database.
//
// Usage:
//   node scripts/market_test.js                       (Part 1 only)
//   DATABASE_URL=postgres://… MARKET_TEST_BASE=http://localhost:3999 \
//     node scripts/market_test.js

'use strict';

const market = require('../lib/market');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}

function part1() {
  console.log('Caps & modifiers');
  const m1 = market.tradeModifiers(1), m3 = market.tradeModifiers(3), m5 = market.tradeModifiers(5);
  check(m1.carryWeight === 100 && m1.merchants === 1 && m1.maxOrders === 2, 'L1: 100 weight, 1 merchant, 2 orders');
  check(m3.carryWeight === 350 && m3.merchants === 3 && m3.maxOrders === 4, 'L3: 350 weight, 3 merchants, 4 orders');
  check(m5.carryWeight === 800 && m5.merchants === 5, 'L5: 800 weight, 5 merchants');
  check(market.tradeModifiers(0).carryWeight === 0 && market.tradeModifiers(0).merchants === 0, 'no market: nothing');
  check(m1.feeRate === 0.05 && m1.expiryHours === 168, 'fee 5%, expiry one week');
  const boosted = market.tradeModifiers(1, [{ key: 'carryWeight', mult: 1.5 }, { key: 'merchants', add: 1 }, { key: 'speedMult', mult: 2 }]);
  check(boosted.carryWeight === 150 && boosted.merchants === 2 && boosted.speedMult === 2, 'bonuses compose (research hook)');
  check(market.tradeModifiers(1, [{ key: 'marketLevel', add: 4 }]).marketLevel === 1, 'bonuses cannot change market level');

  console.log('Lots & pricing');
  check(market.maxLotUnits('food', 100) === 200 && market.maxLotUnits('metal', 100) === 50, 'carry weight: 200 food / 50 metal at L1');
  check(market.maxLotUnits('wealth', 100) === 0, 'wealth is not tradeable');
  const o = { lot_size: 100, lot_price: 70 };
  check(market.priceFor(o, 100) === 70 && market.priceFor(o, 30) === 21 && market.priceFor(o, 1) === 1, 'short final lot priced pro-rata, rounded up');
  check(market.feeFor(70, 0.05) === 3, 'fee rounds down');
  const v = (x) => market.validateOrder({ resource: 'timber', lot_size: 100, lot_price: 50, qty_total: 500, ...x }, m1);
  check(v({}) === null, 'valid order passes');
  check(/carry at most 100/.test(v({ lot_size: 101 })), 'lot over carry weight rejected');
  check(/more than the total/.test(v({ lot_size: 100, qty_total: 50 })), 'lot larger than total rejected');
  check(/cannot be traded/.test(v({ resource: 'wealth' })), 'wealth listing rejected');
  check(/Invalid/.test(v({ lot_price: 0 })) && /Invalid/.test(v({ lot_size: 1.5 })), 'non-positive / fractional numbers rejected');

  console.log('Item weights');
  check(market.itemWeight({ category: 'fish' }) === 0.5 && market.itemWeight({ equip_slot: 'armour' }) === 5 &&
        market.itemWeight({ equip_slot: 'weapon' }) === 3 && market.itemWeight({ category: 'material' }) === 1, 'weights: fish ½, material 1, weapon 3, armour 5');
  check(market.maxItemUnits({ category: 'fish' }, 100) === 200 && market.maxItemUnits({ equip_slot: 'weapon' }, 100) === 1, 'L1 trip: 200 fish, or one weapon');
  check(market.maxItemUnits({ equip_slot: 'armour' }, 4) === 0, 'armour too heavy for a tiny carry cap');
  const iv = (x) => market.validateOrder({ lot_size: 1, lot_price: 50, qty_total: 1, ...x }, m1, { name: 'Sword', equip_slot: 'weapon' });
  check(iv({}) === null && /one piece per order/.test(iv({ qty_total: 2, lot_size: 1 })), 'equipment: one piece per order');
  check(/at most 200 Trout/.test(market.validateOrder({ lot_size: 201, lot_price: 5, qty_total: 300 }, m1, { name: 'Trout', category: 'fish' })), 'stack lot over carry weight rejected');

  console.log('Ironhaven & categories (pure)');
  check(market.ironhavenUnitPrice(10, false) === 3 && market.ironhavenUnitPrice(10, true) === 6, 'Ironhaven pays 30%, wanted items 60%');
  check(market.ironhavenUnitPrice(1, false) === 1 && market.ironhavenUnitPrice(0, false) === 1, 'Ironhaven pays at least 1 gold');
  const tpls = Array.from({ length: 12 }, (_, i) => ({ item_key: 'k' + i, sell_value: 5, tradeable: i !== 3 }));
  const w1 = market.ironhavenWants(tpls, 100), w1b = market.ironhavenWants(tpls, 100), w2 = market.ironhavenWants(tpls, 101);
  check(w1.length === 3 && JSON.stringify(w1) === JSON.stringify(w1b) && JSON.stringify(w1) !== JSON.stringify(w2), 'weekly wants: 3 items, stable within a week, change weekly');
  check(!market.ironhavenWants(tpls.map(t => ({ ...t, tradeable: false })), 100).length, 'untradeable items are never wanted');
  check(market.categoryOf({ equip_slot: 'weapon', category: 'equipment' }) === 'weapon' && market.categoryOf({ category: 'fish' }) === 'fish' &&
        market.categoryOf({ category: 'quest_item' }) === 'misc', 'categories: slot first, then category, else misc');
  check(market.porterMax({ category: 'fish' }) === 40 && market.porterMax({ equip_slot: 'weapon' }) === 6 && market.porterMax({ equip_slot: 'armour' }) === 4,
    'porter carries 20: 40 fish, 6 weapons, 4 armour');

  console.log('NPC traders (pure)');
  const npcT = require('../lib/npc_trade');
  const tpls2 = [
    { item_key: 'f1', name: 'Perch', icon: '🐠', category: 'fish', rarity: 'common', sell_value: 5 },
    { item_key: 't1', name: 'Hammer', icon: '🔨', category: 'equipment', equip_slot: 'tool', rarity: 'common', sell_value: 20 },
    { item_key: 'x1', name: 'Crown', icon: '👑', category: 'trophy', rarity: 'legendary', sell_value: 500 },
  ];
  const vill = { id: 7, species: 'mice' };
  const d1 = npcT.npcOrdersFor(vill, '2026-10-22', tpls2), d1b = npcT.npcOrdersFor(vill, '2026-10-22', tpls2), d2 = npcT.npcOrdersFor(vill, '2026-10-23', tpls2);
  check(JSON.stringify(d1) === JSON.stringify(d1b) && JSON.stringify(d1) !== JSON.stringify(d2), 'village orders: same all day, new the next');
  const sells = d1.filter(o => o.side === 'sell'), buys = d1.filter(o => o.side === 'buy');
  check(sells.length >= 1 && sells.length <= 3 && buys.length >= 1 && buys.length <= 2, 'mix: up to 3 sell and 1–2 buy orders');
  check(d1.every(o => (o.side === 'sell' ? ['food', 'fish'] : ['timber', 'tool']).includes(o.kind === 'item' ? o.item.cat : o.resource)), 'mice sell food/fish and buy timber/tools');
  check(d1.filter(o => o.kind === 'resource').every(o => o.qty >= 100 && o.qty <= 300 && o.per === 100 &&
    o.price >= Math.floor(market.REFERENCE_PRICE[o.resource] * (o.side === 'sell' ? 95 : 85)) && o.price <= Math.ceil(market.REFERENCE_PRICE[o.resource] * (o.side === 'sell' ? 115 : 100))),
    'resource amounts 100–300 at standard prices');
  check(!d1.some(o => o.item && o.item.item_key === 'x1'), 'no rare or legendary items');
  const fr = npcT.tierFor(50), al = npcT.tierFor(80);
  const base = { side: 'sell', kind: 'resource', qty: 200, price: 70, per: 100 };
  check(npcT.applyTier(base, fr).qty === 300 && npcT.applyTier(base, fr).price === 67 && npcT.applyTier(base, al).qty === 400 && npcT.applyTier(base, al).price === 63,
    'Friendly: 1.5× amount, 5% cheaper; Allied: 2×, 10% cheaper');
  check(npcT.applyTier({ ...base, side: 'buy' }, al).price === 77, 'Allied villages also pay you 10% more');
  check(npcT.tierFor(20) === null && npcT.tierFor(21).key === 'familiar', 'trading opens at Familiar (21)');

  console.log('Travel');
  check(market.legSeconds(0, {}, m1) === market.MIN_LEG_SECONDS, 'minimum leg');
  check(market.legSeconds(10, {}, m1) === 450, '10 hexes at 45s = 450s');
  check(market.legSeconds(10, { skills: { scouting: 6 } }, m1) === Math.round(450 / 1.3), 'scouting speeds caravans up');
  check(market.legSeconds(10, {}, { speedMult: 2 }) === 225, 'speed modifier halves the trip');
  check(market.distanceBetween({ tile_q: 0, tile_r: 0 }, { tile_q: 39, tile_r: 0 }) === 1, 'distance wraps the map edge');
}

// ── Part 2 ────────────────────────────────────────────────────────────────

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.MARKET_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  // Spread towns out; each gets its own tile.
  const tiles = [[2, 2], [8, 2], [14, 2], [20, 2], [26, 2], [2, 20], [8, 20], [14, 20], [30, 30], [36, 30]];

  async function user(name, { market: lvl = 1, wealth = 1000, timber = 1000 } = {}) {
    const username = `${name}_${RUN}_${seq}`;
    const [tq, tr] = tiles[seq++];
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id",
      [username, `${username}@t.l`])).rows[0];
    await q('UPDATE settlements SET tile_q = NULL, tile_r = NULL WHERE tile_q=$1 AND tile_r=$2', [tq, tr]);   // earlier runs' towns
    const s = (await q(`INSERT INTO settlements (user_id, name, tile_q, tile_r, world_version, wealth, timber, last_tick)
                        VALUES ($1,$2,$3,$4,2,$5,$6,NOW()) RETURNING *`, [u.id, username, tq, tr, wealth, timber])).rows[0];
    if (lvl) await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'market',$2)", [s.id, lvl]);
    await q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [u.id, tq, tr]);
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    return { id: u.id, username, sid: s.id, q: tq, r: tr, token };
  }
  async function citizen(p, name, scouting = 1) {
    return (await q(`INSERT INTO citizens (settlement_id, name, role, skills, life_stage) VALUES ($1,$2,'farmer',$3,'adult') RETURNING id`,
      [p.sid, name, JSON.stringify({ scouting })])).rows[0].id;
  }
  const reveal = (viewer, target) => q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [viewer.id, target.q, target.r]);
  async function api(p, method, path, body) {
    const r = await fetch(BASE + path, {
      method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const res = async (p, col) => (await q(`SELECT ${col} FROM settlements WHERE id=$1`, [p.sid])).rows[0][col];
  const role = async id => (await q('SELECT role FROM citizens WHERE id=$1', [id])).rows[0].role;
  const due = (orderId, col) => q(`UPDATE market_trips SET ${col} = NOW() - INTERVAL '1 second' WHERE order_id=$1 AND status <> 'done'`, [orderId]);
  const landAll = async (orderId) => {
    await due(orderId, 'arrives_at');
    await q("UPDATE market_trips SET returns_at = NOW() - INTERVAL '1 second' WHERE order_id=$1 AND status <> 'done'", [orderId]);
    await market.resolveDue();
  };

  const seller = await user('seller');
  const buyer = await user('buyer');
  const stranger = await user('stranger');
  const clanmate = await user('clanmate');
  const nomarket = await user('nomarket', { market: 0 });
  const a1 = await citizen(seller, 'Ash', 1);
  const a2 = await citizen(seller, 'Birch', 1);
  await reveal(seller, buyer); await reveal(buyer, seller);
  await reveal(stranger, seller);            // one-way only
  await reveal(nomarket, seller); await reveal(seller, nomarket);

  console.log('Status & gate');
  let r = await api(nomarket, 'GET', '/api/market/status');
  check(r.status === 200 && r.body.unlocked === false, 'no market → locked');
  check(r.body.building && r.body.building.cost.timber === 60 && r.body.building.cost.food === 30, 'locked status carries the Market cost');
  check(r.body.building.levelTierReq && r.body.building.levelTierReq[2] === 'village', 'locked status carries level tier gates');
  r = await api(seller, 'GET', '/api/market/status');
  check(r.body.unlocked === true && r.body.mods.carryWeight === 100, 'seller unlocked at L1');
  r = await api(nomarket, 'POST', '/api/market/orders/1/buy');
  check(r.status === 403, 'buying needs a Market');

  console.log('Listing');
  r = await api(seller, 'POST', '/api/market/orders', { resource: 'timber', lot_size: 101, lot_price: 70, qty_total: 300, citizen_ids: [a1] });
  check(r.status === 400 && /carry at most 100/.test(r.body.error), 'lot over carry weight rejected');
  r = await api(seller, 'POST', '/api/market/orders', { resource: 'timber', lot_size: 100, lot_price: 70, qty_total: 5000, citizen_ids: [a1] });
  check(r.status === 400 && /Not enough timber/.test(r.body.error), 'cannot list more than you have');
  r = await api(seller, 'POST', '/api/market/orders', { resource: 'timber', lot_size: 100, lot_price: 70, qty_total: 250, citizen_ids: [a1, a2] });
  check(r.status === 400 && /room for 1 merchant/.test(r.body.error), 'L1 market has room for one merchant');
  r = await api(seller, 'POST', '/api/market/orders', { resource: 'timber', lot_size: 100, lot_price: 70, qty_total: 250, citizen_ids: [a1] });
  check(r.status === 200 && r.body.order, 'order listed');
  const orderId = r.body.order.id;
  check(await res(seller, 'timber') === 750, 'goods escrowed on listing (1000 → 750)');
  check(await role(a1) === 'merchant', 'citizen becomes a merchant');
  r = await api(seller, 'POST', '/api/market/orders', { resource: 'timber', lot_size: 10, lot_price: 7, qty_total: 10, citizen_ids: [a1] });
  check(r.status === 400, 'a merchant works one order at a time');
  r = await api(seller, 'PATCH', `/api/citizens/${a2}/role`, { role: 'merchant' });
  check(r.status === 400, 'merchant role cannot be set by hand');

  console.log('Visibility');
  r = await api(buyer, 'GET', '/api/market/orders');
  const seen = (r.body.orders || []).find(o => o.id === orderId);
  check(!!seen, 'mutually-revealed buyer sees the order');
  check(seen && seen.distance === 6 && seen.unit_price === 0.7 && seen.paused === false, 'order carries distance, unit price, paused flag');
  check(seen && seen.eta_seconds === 270, 'ETA = one leg at 45s/hex');
  r = await api(stranger, 'GET', '/api/market/orders');
  check(!(r.body.orders || []).some(o => o.id === orderId), 'one-way reveal is not enough');
  r = await api(stranger, 'POST', `/api/market/orders/${orderId}/buy`);
  check(r.status === 403, 'stranger cannot buy');
  r = await api(clanmate, 'GET', '/api/market/orders');
  check(!(r.body.orders || []).some(o => o.id === orderId), 'not yet clanmates → hidden');
  const clan = (await q('INSERT INTO clans (name, founder_user_id) VALUES ($1,$2) RETURNING id', [`M ${RUN}`, seller.id])).rows[0];
  await q("INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'founder')", [seller.id, clan.id]);
  await q("UPDATE clans SET join_policy = 'open' WHERE id=$1", [clan.id]).catch(() => {});
  r = await api(clanmate, 'POST', `/api/clans/${clan.id}/join`);
  check(r.status === 200, 'clanmate joins an open clan');
  r = await api(clanmate, 'GET', '/api/market/orders');
  check((r.body.orders || []).some(o => o.id === orderId), 'clanmates can always trade');
  const fogBoth = (await q(`SELECT
      EXISTS (SELECT 1 FROM fog_of_war WHERE user_id=$1 AND tile_q=$3 AND tile_r=$4) AS a,
      EXISTS (SELECT 1 FROM fog_of_war WHERE user_id=$2 AND tile_q=$5 AND tile_r=$6) AS b`,
    [clanmate.id, seller.id, seller.q, seller.r, clanmate.q, clanmate.r])).rows[0];
  check(fogBoth.a && fogBoth.b, 'joining a clan reveals clanmates’ towns both ways');
  r = await api(buyer, 'GET', '/api/map/world');
  const tile = (r.body.tiles || []).find(t => t.q === seller.q && t.r === seller.r);
  check(tile && tile.settlement && tile.settlement.can_trade === true && tile.settlement.settlement_id === seller.sid,
    'map marks the seller as a trade partner');

  console.log('Buying & caravans');
  r = await api(buyer, 'POST', `/api/market/orders/${orderId}/buy`);
  check(r.status === 200 && r.body.trip && r.body.trip.qty === 100, 'buyer buys one lot');
  check(await res(buyer, 'wealth') === 930, 'gold taken up front (1000 → 930)');
  r = await api(seller, 'PATCH', `/api/citizens/${a1}/role`, { role: 'farmer' });
  check(r.status === 400 && /trade run/.test(r.body.error), 'merchant on the road cannot be reassigned');
  r = await api(clanmate, 'GET', '/api/market/orders');
  const paused = (r.body.orders || []).find(o => o.id === orderId);
  check(paused && paused.paused === true && paused.qty_available === 150, 'order pauses while its only merchant travels');
  r = await api(clanmate, 'POST', `/api/market/orders/${orderId}/buy`);
  check(r.status === 409, 'cannot buy while every merchant is away');
  r = await api(seller, 'GET', '/api/citizens');
  const ash = (r.body.citizens || r.body || []).find?.(c => c.id === a1);
  check(ash && ash.trade && ash.trade.on_road === true, 'citizen list shows the trade run');

  await due(orderId, 'arrives_at');
  await api(buyer, 'GET', '/api/market/mine');   // lazy resolve
  check(await res(buyer, 'timber') === 1100, 'goods credited on arrival');
  check(await res(seller, 'wealth') === 1000, 'seller not paid until the merchant is home');
  await q("UPDATE market_trips SET returns_at = NOW() - INTERVAL '1 second' WHERE order_id=$1 AND status='returning'", [orderId]);
  await market.tick();                            // worker path
  check(await res(seller, 'wealth') === 1067, 'gold minus 5% fee banked on return (70 − 3)');

  console.log('Concurrency');
  const [x, y] = await Promise.all([
    api(buyer, 'POST', `/api/market/orders/${orderId}/buy`),
    api(clanmate, 'POST', `/api/market/orders/${orderId}/buy`),
  ]);
  check([x.status, y.status].sort().join() === '200,409', 'two simultaneous buys on one merchant: exactly one wins');
  const spent = (await res(buyer, 'wealth')) + (await res(clanmate, 'wealth'));
  check(spent === 930 + 1000 - 70, 'only the winner paid');

  console.log('Cancel');
  r = await api(seller, 'POST', `/api/market/orders/${orderId}/cancel`);
  check(r.status === 200 && r.body.refunded === 50, 'cancel refunds undispatched goods');
  check(await res(seller, 'timber') === 800, 'refund lands in stock (750 + 50)');
  check(await role(a1) === 'merchant', 'merchant on the road keeps travelling');
  await landAll(orderId);
  check(await role(a1) === 'idle', 'merchant goes idle once home from a closed order');

  console.log('Short final lot & sell-out');
  r = await api(seller, 'POST', '/api/market/orders', { resource: 'timber', lot_size: 100, lot_price: 70, qty_total: 130, citizen_ids: [a2] });
  const o2 = r.body.order.id;
  await api(buyer, 'POST', `/api/market/orders/${o2}/buy`);
  await landAll(o2);
  const w0 = await res(buyer, 'wealth');
  r = await api(buyer, 'POST', `/api/market/orders/${o2}/buy`);
  check(r.status === 200 && r.body.trip.qty === 30 && r.body.trip.gold_paid === 21, 'final 30 units cost 21 gold');
  check(await res(buyer, 'wealth') === w0 - 21, 'buyer charged pro-rata');
  check((await q('SELECT status FROM market_orders WHERE id=$1', [o2])).rows[0].status === 'sold_out', 'order sold out');
  await landAll(o2);
  check(await role(a2) === 'idle', 'merchant released after sell-out');

  console.log('Expiry & reassignment');
  r = await api(seller, 'POST', '/api/market/orders', { resource: 'timber', lot_size: 50, lot_price: 30, qty_total: 100, citizen_ids: [a1] });
  const o3 = r.body.order.id;
  const t0 = await res(seller, 'timber');
  await q("UPDATE market_orders SET expires_at = NOW() - INTERVAL '1 second' WHERE id=$1", [o3]);
  await market.tick();
  check((await q('SELECT status FROM market_orders WHERE id=$1', [o3])).rows[0].status === 'expired', 'stale order expires');
  check(await res(seller, 'timber') === t0 + 100, 'expired goods refunded');
  check(await role(a1) === 'idle', 'merchant freed on expiry');
  r = await api(seller, 'POST', '/api/market/orders', { resource: 'timber', lot_size: 50, lot_price: 30, qty_total: 100, citizen_ids: [a1] });
  const o4 = r.body.order.id;
  r = await api(seller, 'PATCH', `/api/citizens/${a1}/role`, { role: 'forager' });
  check(r.status === 200 && (await q('SELECT 1 FROM market_order_merchants WHERE citizen_id=$1', [a1])).rowCount === 0,
    'reassigning a merchant at home takes them off the order');
  await api(seller, 'POST', `/api/market/orders/${o4}/cancel`);

  console.log('Market levels');
  r = await api(seller, 'POST', '/api/buildings/build', { buildingId: 'market' });
  check(r.status === 400 && /Village/.test(r.body.error), 'Market L2 needs a Village');

  // ── Items ───────────────────────────────────────────────────────────────
  console.log('Items');
  const isel = await user('itemseller', { market: 3 });
  const ibuy = await user('itembuyer');
  await reveal(isel, ibuy); await reveal(ibuy, isel);
  const m1 = await citizen(isel, 'Moss'), m2 = await citizen(isel, 'Fern');
  const tradeKey = 'mt_trout_' + RUN, lockedKey = 'mt_relic_' + RUN;
  await q("INSERT INTO item_templates (item_key, name, category, sell_value) VALUES ($1,'Test Trout','fish',10)", [tradeKey]);
  await q("INSERT INTO item_templates (item_key, name, category, tradeable) VALUES ($1,'Test Relic','trophy',false)", [lockedKey]);
  const inv = async (p, key, extra = {}) => (await q(
    `INSERT INTO inventory_items (settlement_id, item_key, name, icon, category, quantity, equip_slot, equipped_to, tradeable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [p.sid, key, extra.name || key, extra.icon || '🐟', extra.category || 'fish', extra.quantity || 1,
     extra.equip_slot || null, extra.equipped_to || null, extra.tradeable !== false])).rows[0].id;
  const trout = await inv(isel, tradeKey, { name: 'Test Trout', quantity: 300 });
  const relic = await inv(isel, lockedKey, { name: 'Test Relic', category: 'trophy' });
  const bound = await inv(isel, 'mt_bound_' + RUN, { name: 'Bound Charm', category: 'misc', tradeable: false });
  const worn = await inv(isel, 'mt_worn_' + RUN, { name: 'Worn Sword', category: 'equipment', equip_slot: 'weapon', equipped_to: m2 });
  const plate = await inv(isel, 'mt_plate_' + RUN, { name: 'Plate Mail', icon: '🛡', category: 'equipment', equip_slot: 'armour' });
  await inv(ibuy, tradeKey, { name: 'Test Trout', quantity: 5 });   // buyer already has a stack
  const qty = async id => ((await q('SELECT quantity FROM inventory_items WHERE id=$1', [id])).rows[0] || {}).quantity || 0;
  const itemOrder = (id, extra) => api(isel, 'POST', '/api/market/orders',
    { kind: 'item', inventory_id: id, unit_price: 15, qty_total: 20, ...extra });
  const bp1 = await citizen(ibuy, 'Pip', 1), bp2 = await citizen(ibuy, 'Wren', 1);
  const landRuns = async () => {
    await q("UPDATE market_runs SET arrives_at = NOW() - INTERVAL '2 seconds' WHERE status = 'outbound' AND (settlement_id = $1 OR target_settlement_id = $1)", [isel.sid]);
    await market.resolveDue();
    await q("UPDATE market_runs SET returns_at = NOW() - INTERVAL '1 second' WHERE status = 'returning' AND (settlement_id = $1 OR target_settlement_id = $1)", [isel.sid]);
    await market.resolveDue();
  };

  r = await itemOrder(relic, { qty_total: 1 });
  check(r.status === 400 && /cannot be traded/.test(r.body.error), 'template marked not tradeable → refused');
  r = await itemOrder(bound, { qty_total: 1 });
  check(r.status === 400 && /cannot be traded/.test(r.body.error), 'stack marked not tradeable → refused');
  r = await itemOrder(worn, { qty_total: 1 });
  check(r.status === 400 && /Unequip/.test(r.body.error), 'equipped item → refused');
  r = await itemOrder(trout, { qty_total: 301 });
  check(r.status === 400 && /only have 300/.test(r.body.error), 'cannot list more than the stack holds');
  r = await itemOrder(plate, { qty_total: 2 });
  check(r.status === 400, 'cannot list more equipment than you have');
  r = await itemOrder(trout);
  check(r.status === 200 && r.body.order.kind === 'item' && r.body.order.venue === 'market' && r.body.order.lot_price === 15,
    'stack listed on a Market stall at 15 each — no merchants needed');
  const fishOrder = r.body.order.id;
  check(await qty(trout) === 280, 'listed units leave the stack (300 → 280)');
  r = await itemOrder(plate, { qty_total: 1, unit_price: 90 });
  check(r.status === 200 && r.body.order.qty_total === 1, 'equipment listed');
  const plateOrder = r.body.order.id;
  check((await q('SELECT 1 FROM inventory_items WHERE id=$1', [plate])).rowCount === 0, 'a fully listed row leaves the inventory');
  r = await itemOrder(trout, { qty_total: 1 }); const extra1 = r.body.order.id;
  r = await itemOrder(trout, { qty_total: 1 }); const extra2 = r.body.order.id;
  r = await itemOrder(trout, { qty_total: 1 });
  check(r.status === 400 && /stalls/.test(r.body.error), 'Market level 3 has 4 item stalls', r.body.error);
  r = await api(isel, 'GET', '/api/market/mine');
  check(r.body.stalls && r.body.stalls.market.slots === 4 && r.body.stalls.market.free === 0, 'stall usage reported');
  await api(isel, 'POST', `/api/market/orders/${extra1}/cancel`);
  await api(isel, 'POST', `/api/market/orders/${extra2}/cancel`);

  r = await api(ibuy, 'GET', '/api/market/orders?resource=items');
  const seenItems = (r.body.orders || []).filter(o => o.seller.id === isel.sid);
  check(seenItems.length === 2 && seenItems.every(o => o.kind === 'item' && o.item && o.unit_price && o.porter_max), 'Items list: stalls with unit price and porter cap');
  check(((r.body.orders || []).find(o => o.id === fishOrder) || {}).porter_max === 20, 'porter cap is min(available, carry): 20 trout');
  r = await api(ibuy, 'GET', '/api/market/orders?resource=timber');
  check(!(r.body.orders || []).some(o => o.kind === 'item'), 'resource filters exclude items');
  r = await api(ibuy, 'POST', `/api/market/orders/${fishOrder}/buy`);
  check(r.status === 409 && /porter/.test(r.body.error), 'items can only be collected, not delivered');

  const buyerGold = await res(ibuy, 'wealth'), sellerGold = await res(isel, 'wealth');
  r = await api(ibuy, 'POST', `/api/market/orders/${fishOrder}/pickup`, { qty: 10, citizen_id: bp1 });
  check(r.status === 200 && r.body.run.qty === 10 && r.body.run.gold === 150, 'porter sent for 10 trout (150 gold held)');
  check(await res(ibuy, 'wealth') === buyerGold - 150, 'buyer\'s gold held at dispatch');
  check((await q('SELECT qty_reserved FROM market_orders WHERE id=$1', [fishOrder])).rows[0].qty_reserved === 10, '10 trout reserved on the stall');
  r = await api(ibuy, 'POST', `/api/market/orders/${fishOrder}/pickup`, { qty: 11, citizen_id: bp2 });
  check(r.status === 409 && /Only 10 left/.test(r.body.error), 'reserved units can\'t be bought twice');
  r = await api(isel, 'GET', '/api/travel');
  check((r.body.journeys || []).some(j => j.incoming && /to buy 10× Test Trout/.test(j.title)), 'seller sees the porter coming on the map');
  await landRuns();
  check(await res(isel, 'wealth') === sellerGold + 150 - 7, 'seller paid on arrival, minus the 5% fee');
  const buyerTrout = (await q('SELECT quantity FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [ibuy.sid, tradeKey])).rows;
  check(buyerTrout.length === 1 && buyerTrout[0].quantity === 15, 'porter home: trout stacked onto the buyer\'s 5');

  // Race for the last plate: exactly one porter wins.
  const [pa, pb] = await Promise.all([
    api(ibuy, 'POST', `/api/market/orders/${plateOrder}/pickup`, { qty: 1, citizen_id: bp1 }),
    api(ibuy, 'POST', `/api/market/orders/${plateOrder}/pickup`, { qty: 1, citizen_id: bp2 }),
  ]);
  check([pa.status, pb.status].sort().join() === '200,409', 'two porters for the last piece: exactly one is sent');
  await landRuns();
  check((await q("SELECT 1 FROM inventory_items WHERE settlement_id=$1 AND item_key=$2 AND equip_slot='armour'", [ibuy.sid, 'mt_plate_' + RUN])).rowCount === 1,
    'equipment arrives as its own piece');
  check((await q('SELECT status FROM market_orders WHERE id=$1', [plateOrder])).rows[0].status === 'sold_out', 'emptied stall closes');

  // Cancelling with a porter on the way: they still get theirs.
  r = await api(ibuy, 'POST', `/api/market/orders/${fishOrder}/pickup`, { qty: 4, citizen_id: bp1 });
  const tBefore = await qty(trout);
  r = await api(isel, 'POST', `/api/market/orders/${fishOrder}/cancel`);
  check(r.status === 200 && r.body.refunded === 6 && await qty(trout) === tBefore + 6, 'cancel returns the unreserved 6, keeps the 4 on the way');
  await landRuns();
  check((await q('SELECT quantity FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [ibuy.sid, tradeKey])).rows[0].quantity === 19,
    'the porter still collects the reserved 4');

  r = await api(isel, 'GET', '/api/market/mine');
  const pick = (r.body.items || []).reduce((m, i) => (m[i.id] = i, m), {});
  check(pick[trout] && pick[trout].tradeable && pick[trout].sell_value === 10, 'Sell picker: tradeable stack with its town value');
  check(pick[relic] && !pick[relic].tradeable && pick[worn] && /Unequip/.test(pick[worn].reason), 'Sell picker: untradeable and equipped items say why');

  // Dev Tools: the tradeable toggle on a template.
  const adminId = Number(process.env.MARKET_TEST_ADMIN_ID || 0);
  if (adminId) {
    await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO NOTHING",
      [adminId, 'admin_' + RUN, 'admin_' + RUN + '@t.l']);
    const admin = { token: jwt.sign({ userId: adminId, username: 'admin', species: 'Mice' }, SECRET) };
    r = await api(admin, 'PATCH', `/api/game/items/${tradeKey}`, { tradeable: false });
    check(r.status === 200, 'Dev Tools: edit saves (PATCH /api/game/items/:key)');
    r = await itemOrder(trout);
    check(r.status === 400 && /cannot be traded/.test(r.body.error), 'Dev Tools: unticking Tradeable stops new listings');
    r = await api(admin, 'POST', '/api/game/items', { item_key: 'mt_new_' + RUN, name: 'New Thing', tradeable: false });
    const row = (await q('SELECT tradeable FROM item_templates WHERE item_key=$1', ['mt_new_' + RUN])).rows[0];
    check(r.status === 200 && row && row.tradeable === false, 'Dev Tools: new items can be created not tradeable');
    await api(admin, 'PATCH', `/api/game/items/${tradeKey}`, { tradeable: true });
  } else console.log('  (MARKET_TEST_ADMIN_ID not set — skipping Dev Tools checks)');

  // ── Shops ──────────────────────────────────────────────────────────────
  console.log('Shops');
  r = await api(isel, 'POST', '/api/buildings/build', { buildingId: 'smithy' });
  check(r.status === 400 && /Village/.test(r.body.error), 'Smithy needs a Village');
  r = await api(isel, 'POST', '/api/buildings/build', { buildingId: 'jeweller' });
  check(r.status === 400 && /Town/.test(r.body.error), 'Jeweller needs a Town');
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'smithy',1), ($1,'fishing_post',2)", [isel.sid]);
  const sword = await inv(isel, 'mt_sword_' + RUN, { name: 'Shop Sword', icon: '🗡', category: 'equipment', equip_slot: 'weapon' });
  r = await itemOrder(sword, { qty_total: 1, unit_price: 50, venue: 'smithy' });
  check(r.status === 400 && /needs a shopkeeper/.test(r.body.error), 'a shop without a shopkeeper can\'t sell');
  r = await api(isel, 'GET', '/api/market/shops');
  check(r.body.stalls.smithy.slots === 4 && r.body.stalls.smithy.open === false && r.body.stalls.fishing_post.slots === 4, 'Smithy L1: 4 stalls (closed); Fishing Post L2: 4');
  const smith = await citizen(isel, 'Anvil'), fishwife = await citizen(isel, 'Marsh');
  r = await api(isel, 'PATCH', '/api/market/shops/smithy/keeper', { citizen_id: smith });
  check(r.status === 200 && r.body.stalls.smithy.open && r.body.stalls.smithy.keeper.id === smith && await role(smith) === 'shopkeeper', 'shopkeeper assigned; the Smithy opens');
  r = await api(isel, 'PATCH', '/api/market/shops/fishing_post/keeper', { citizen_id: smith });
  check(r.status === 400 && /busy/.test(r.body.error), 'one citizen minds one shop');
  await api(isel, 'PATCH', '/api/market/shops/fishing_post/keeper', { citizen_id: fishwife });
  r = await itemOrder(sword, { qty_total: 1, unit_price: 50 });
  check(r.status === 200 && r.body.order.venue === 'smithy', 'weapons go to the Smithy by default');
  const swordOrder = r.body.order.id;
  r = await itemOrder(trout, { qty_total: 5, unit_price: 3 });
  check(r.status === 200 && r.body.order.venue === 'fishing_post', 'fish go to the Fishing Post stall');
  const fishStall = r.body.order.id;
  r = await itemOrder(trout, { qty_total: 1, unit_price: 3, venue: 'smithy' });
  check(r.status === 400 && /doesn't sell fish/.test(r.body.error), 'a shop only sells its own kinds of item');
  r = await api(ibuy, 'GET', '/api/market/orders?category=weapon');
  const swordRow = (r.body.orders || []).find(o => o.id === swordOrder);
  check(swordRow && swordRow.venue_label === 'Smithy', 'buyers see it at the Smithy');
  r = await api(isel, 'PATCH', `/api/citizens/${smith}/role`, { role: 'forager' });
  check(r.status === 200 && (await q('SELECT 1 FROM shop_keepers WHERE citizen_id=$1', [smith])).rowCount === 0, 'reassigning the shopkeeper closes the shop');
  r = await api(ibuy, 'GET', '/api/market/orders?category=weapon');
  check(!(r.body.orders || []).some(o => o.id === swordOrder), 'closed shop: its stalls are hidden');
  r = await api(ibuy, 'POST', `/api/market/orders/${swordOrder}/pickup`, { qty: 1, citizen_id: bp1 });
  check(r.status === 409 && /closed/.test(r.body.error), 'and nobody can collect from it');
  await api(isel, 'PATCH', '/api/market/shops/smithy/keeper', { citizen_id: smith });
  r = await api(ibuy, 'POST', `/api/market/orders/${swordOrder}/pickup`, { qty: 1, citizen_id: bp1 });
  check(r.status === 200, 'shop reopened: the sword can be collected');
  await landRuns();
  await api(isel, 'POST', `/api/market/orders/${fishStall}/cancel`);

  // ── Wanted (buy orders) ───────────────────────────────────────────────
  console.log('Wanted');
  r = await api(ibuy, 'POST', '/api/market/wants', { kind: 'item', item_key: lockedKey, qty: 1, price: 5 });
  check(r.status === 400 && /cannot be traded/.test(r.body.error), 'cannot ask for untradeable items');
  let bGold = await res(ibuy, 'wealth');
  r = await api(ibuy, 'POST', '/api/market/wants', { kind: 'item', item_key: tradeKey, qty: 10, price: 4 });
  check(r.status === 200 && r.body.gold_held === 40 && await res(ibuy, 'wealth') === bGold - 40, 'want 10 trout at 4 each: 40 gold held');
  const troutWant = r.body.want.id;
  r = await api(ibuy, 'POST', '/api/market/wants', { kind: 'resource', resource: 'timber', qty: 300, price: 60 });
  check(r.status === 200 && r.body.gold_held === 180, 'want 300 timber at 60 per 100: 180 gold held');
  const timberWant = r.body.want.id;
  r = await api(isel, 'GET', '/api/market/wants');
  const wv = (r.body.wants || []).find(w => w.id === troutWant);
  check(wv && wv.you_have > 0 && wv.qty_open === 10 && wv.item.name === 'Test Trout' && wv.buyer.id === ibuy.sid, 'sellers see the want and how many they hold');
  r = await api(isel, 'GET', '/api/market/wants?category=fish');
  check((r.body.wants || []).every(w => w.item && w.item.cat === 'fish') && (r.body.wants || []).some(w => w.id === troutWant), 'wants filter by category');
  const filler = await citizen(isel, 'Courier');
  r = await api(isel, 'POST', `/api/market/wants/${troutWant}/fill`, { inventory_id: relic, qty: 1, citizen_id: filler });
  check(r.status === 400 && /exactly/.test(r.body.error), 'only the exact item can fill a want');
  const tq0 = await qty(trout), sGold0 = await res(isel, 'wealth');
  r = await api(isel, 'POST', `/api/market/wants/${troutWant}/fill`, { inventory_id: trout, qty: 4, citizen_id: filler });
  check(r.status === 200 && r.body.gold === 16, 'fill 4 of 10: a porter sets off (16 gold due)');
  check(await qty(trout) === tq0 - 4, 'the 4 trout leave the seller');
  r = await api(isel, 'POST', `/api/market/wants/${troutWant}/fill`, { inventory_id: trout, qty: 7, citizen_id: await citizen(isel, 'Runner') });
  check(r.status === 409 && /only want 6/.test(r.body.error), 'cannot over-fill: 6 still wanted');
  const bt0 = (await q('SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [ibuy.sid, tradeKey])).rows[0].n;
  await landRuns();
  const bt1 = (await q('SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [ibuy.sid, tradeKey])).rows[0].n;
  check(bt1 === bt0 + 4, 'buyer receives the trout');
  check(await res(isel, 'wealth') === sGold0 + 16, 'seller paid when the porter is home (fee rounds to 0)');
  bGold = await res(ibuy, 'wealth');
  r = await api(ibuy, 'POST', `/api/market/wants/${troutWant}/cancel`);
  check(r.status === 200 && r.body.refunded === 24 && await res(ibuy, 'wealth') === bGold + 24, 'cancel refunds the 24 gold still held');
  // Equipment is one row per piece: a fill draws from several rows.
  const bladeKey = 'mt_blade_' + RUN;
  await q("INSERT INTO item_templates (item_key, name, category, equip_slot, sell_value) VALUES ($1,'Test Blade','equipment','weapon',20)", [bladeKey]);
  for (let i = 0; i < 3; i++) await inv(isel, bladeKey, { name: 'Test Blade', icon: '🗡', category: 'equipment', equip_slot: 'weapon' });
  r = await api(ibuy, 'POST', '/api/market/wants', { kind: 'item', item_key: bladeKey, qty: 2, price: 25 });
  const bladeWant = r.body.want.id;
  r = await api(isel, 'POST', `/api/market/wants/${bladeWant}/fill`, { qty: 2, citizen_id: await citizen(isel, 'Smith2') });
  check(r.status === 200 && (await q('SELECT COUNT(*)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [isel.sid, bladeKey])).rows[0].n === 1,
    'filling 2 blades takes two separate pieces');
  await landRuns();
  check((await q('SELECT COUNT(*)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [ibuy.sid, bladeKey])).rows[0].n === 2,
    'buyer receives both blades');
  const tb0 = await res(isel, 'timber'), btb0 = await res(ibuy, 'timber'), sg1 = await res(isel, 'wealth');
  r = await api(isel, 'POST', `/api/market/wants/${timberWant}/fill`, { qty: 300, citizen_id: filler });
  check(r.status === 200 && r.body.gold === 180, 'fill all 300 timber with one trip (Market L3 caravan)');
  check((await q('SELECT status FROM market_wants WHERE id=$1', [timberWant])).rows[0].status === 'filled', 'fully promised want closes');
  await landRuns();
  check(await res(isel, 'timber') === tb0 - 300 && await res(ibuy, 'timber') === btb0 + 300, 'timber moves from seller to buyer');
  check(await res(isel, 'wealth') === sg1 + 171, 'seller gets 180 minus the 5% fee');
  r = await api(ibuy, 'POST', '/api/market/wants', { kind: 'item', item_key: tradeKey, qty: 2, price: 3 });
  const stale = r.body.want.id; bGold = await res(ibuy, 'wealth');
  await q("UPDATE market_wants SET expires_at = NOW() - INTERVAL '1 second' WHERE id=$1", [stale]);
  await market.tick();
  check((await q('SELECT status FROM market_wants WHERE id=$1', [stale])).rows[0].status === 'expired' && await res(ibuy, 'wealth') === bGold + 6,
    'expired want refunds its gold');

  // ── NPC village traders ───────────────────────────────────────────────
  console.log('NPC traders');
  await q('DELETE FROM npc_settlements WHERE tile_q = 33 AND tile_r = 33');
  const villa = (await q("INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1, 33, 33, 'neutral', 'badger', 'friendly') RETURNING id", ['Testholt ' + RUN])).rows[0];
  const npcBuyer = await user('npcbuyer', { market: 2, wealth: 5000, timber: 2000 });
  const npcOther = await user('npcother', { market: 1 });
  const npcPorter = await citizen(npcBuyer, 'Hob', 2);
  await q("INSERT INTO diplomacy_relations (settlement_id, npc_id, status, trust) VALUES ($1,$2,'contacted',15), ($3,$2,'familiar',25)", [npcBuyer.sid, villa.id, npcOther.sid]);
  await q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,33,33), ($2,33,33) ON CONFLICT DO NOTHING', [npcBuyer.id, npcOther.id]);
  const npcSells = async p => ((await api(p, 'GET', '/api/market/orders?resource=resources')).body.orders || []).filter(o => o.npc && o.npc.id === villa.id);
  check((await npcSells(npcBuyer)).length === 0, 'trust 15: the village doesn\'t trade yet');
  await q('UPDATE diplomacy_relations SET trust = 45, status = \'friendly\' WHERE settlement_id = $1 AND npc_id = $2', [npcBuyer.sid, villa.id]);
  const rows1 = await npcSells(npcBuyer);
  check(rows1.length >= 1 && rows1.every(o => ['stone', 'metal'].includes(o.resource) && o.npc.tier === 'Friendly'), 'Friendly: badger village sells stone/metal at the Market');
  r = await api(npcBuyer, 'GET', '/api/market/orders?resource=resources&npc=0');
  check(!(r.body.orders || []).some(o => o.npc), '?npc=0 hides NPC traders');
  r = await api(npcBuyer, 'GET', '/api/market/wants?resource=resources');
  const vb = (r.body.wants || []).find(w => w.npc && w.npc.id === villa.id);
  check(vb && ['food', 'timber'].includes(vb.resource) && typeof vb.you_have === 'number', 'its buy orders show under Wanted');
  const ob = (await npcSells(npcOther))[0], o1 = rows1.find(x => x.order_key === ob.order_key) || rows1[0];
  check(ob && o1.qty_available > ob.qty_available, 'Friendly gets more than Familiar (1.5×)');

  // Buy from the village.
  const res0 = await res(npcBuyer, o1.resource), g0 = await res(npcBuyer, 'wealth');
  const want = Math.min(50, o1.qty_available);
  r = await api(npcBuyer, 'POST', `/api/market/npc/${villa.id}/${o1.order_key}`, { qty: o1.qty_available + 10, citizen_id: npcPorter });
  check(r.status === 409, 'cannot go past your allowance');
  r = await api(npcBuyer, 'POST', `/api/market/npc/${villa.id}/${o1.order_key}`, { qty: want, citizen_id: npcPorter });
  const cost = Math.ceil(o1.price * want / o1.per);
  check(r.status === 200 && r.body.side === 'buy' && r.body.gold === cost && await res(npcBuyer, 'wealth') === g0 - cost, 'buying: gold held at dispatch');
  check(((await npcSells(npcBuyer)).find(x => x.order_key === o1.order_key) || { qty_available: 0 }).qty_available === o1.qty_available - want, 'allowance drops by what you sent for');
  check(((await npcSells(npcOther)).find(x => x.order_key === ob.order_key) || {}).qty_available === ob.qty_available, 'another player\'s allowance is untouched');
  r = await api(npcBuyer, 'GET', '/api/travel');
  check((r.body.journeys || []).some(j => /Buying .* from Testholt/.test(j.title)), 'the trip shows on the map');
  const npcRunNow = async () => (await q(
    "SELECT status, EXTRACT(EPOCH FROM arrives_at - NOW()) AS a, EXTRACT(EPOCH FROM returns_at - NOW()) AS b FROM market_runs WHERE settlement_id = $1 AND kind = 'npc' AND status <> 'done' ORDER BY id DESC LIMIT 1",
    [npcBuyer.sid])).rows[0];
  const nr0 = await npcRunNow();
  check(nr0 && nr0.status === 'outbound' && Number(nr0.a) >= 115 && Number(nr0.b) >= 235, 'village porter is on the road: arrives in 2+ min, home in 4+ min');
  for (const p of ['/api/market/orders', '/api/market/wants', '/api/market/mine', '/api/market/status']) await api(npcBuyer, 'GET', p);
  await market.resolveDue();
  const nr1 = await npcRunNow();
  check(nr1 && nr1.status === 'outbound' && await res(npcBuyer, o1.resource) === res0, 'reading the Market (and the worker) doesn\'t complete the trade early');
  const trust0 = (await q('SELECT trust FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [npcBuyer.sid, villa.id])).rows[0].trust;
  const landNpc = async () => {
    await q("UPDATE market_runs SET arrives_at = NOW() - INTERVAL '2 seconds', returns_at = NOW() - INTERVAL '1 second' WHERE settlement_id = $1 AND status <> 'done'", [npcBuyer.sid]);
    await market.resolveDue(); await market.resolveDue();
  };
  await landNpc();
  check(await res(npcBuyer, o1.resource) === res0 + want, 'goods arrive when the porter is home');
  const trust1 = (await q('SELECT trust FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [npcBuyer.sid, villa.id])).rows[0].trust;
  check(trust1 === trust0 + 1, 'a completed trade adds 1 trust');

  // Sell to the village (its buy order), twice more: trust caps at +2/day.
  const sellRow = vb;
  const have0 = await res(npcBuyer, sellRow.resource), g1 = await res(npcBuyer, 'wealth');
  const sq = Math.min(20, sellRow.qty_open);
  r = await api(npcBuyer, 'POST', `/api/market/npc/${villa.id}/${sellRow.order_key}`, { qty: sq, citizen_id: npcPorter });
  check(r.status === 200 && r.body.side === 'sell' && await res(npcBuyer, sellRow.resource) === have0 - sq, 'selling: goods leave at dispatch');
  await landNpc();
  check(await res(npcBuyer, 'wealth') === g1 + Math.ceil(sellRow.price * sq / sellRow.per), 'gold arrives when the porter is home');
  r = await api(npcBuyer, 'POST', `/api/market/npc/${villa.id}/${sellRow.order_key}`, { qty: 1, citizen_id: npcPorter });
  await landNpc();
  const trust2 = (await q('SELECT trust FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [npcBuyer.sid, villa.id])).rows[0].trust;
  check(trust2 === trust0 + 2, 'trust from trading caps at +2 a day');
  await q('UPDATE fog_of_war SET tile_q = 34 WHERE user_id = $1 AND tile_q = 33 AND tile_r = 33', [npcOther.id]);
  check((await npcSells(npcOther)).length === 0, 'unrevealed villages don\'t trade');

  // Misc covers trophies.
  const trophyKey = 'mt_cup_' + RUN;
  await q("INSERT INTO item_templates (item_key, name, category, sell_value) VALUES ($1,'Test Cup','trophy',30)", [trophyKey]);
  const cup = await inv(isel, trophyKey, { name: 'Test Cup', icon: '🏆', category: 'trophy' });
  r = await itemOrder(cup, { qty_total: 1, unit_price: 40, venue: 'market' });
  const cupOrder = r.body.order && r.body.order.id;
  r = await api(ibuy, 'GET', '/api/market/orders?category=misc');
  check(cupOrder && (r.body.orders || []).some(o => o.id === cupOrder), 'the Misc filter includes trophies');
  await api(isel, 'POST', `/api/market/orders/${cupOrder}/cancel`);

  // ── Search & Ironhaven ─────────────────────────────────────────────────
  console.log('Search & Ironhaven');
  r = await api(isel, 'GET', '/api/market/catalog?q=Te');
  check(r.status === 200 && r.body.items.length === 0, 'search needs 3+ characters');
  r = await api(isel, 'GET', '/api/market/catalog?q=' + encodeURIComponent('Test Tro'));
  // (Earlier runs leave more "Test Trout" templates; match by name.)
  check((r.body.items || []).some(i => i.name === 'Test Trout' && i.cat === 'fish') && r.body.items.length <= 8, 'search finds "Test Trout" with its category (max 8)');
  r = await api(isel, 'GET', '/api/market/catalog?q=' + encodeURIComponent('Test Rel'));
  check(!(r.body.items || []).some(i => i.item_key === lockedKey), 'untradeable items are not offered in search');
  r = await api(isel, 'GET', '/api/market/catalog');
  check(Array.isArray(r.body.categories) && r.body.categories.length === 9, 'category list with order counts');
  r = await api(isel, 'POST', `/api/inventory/${trout}/sell`);
  check(r.status === 410, 'instant selling is retired (410)');

  let ih = (await q('SELECT id FROM npc_settlements WHERE is_kingdom LIMIT 1')).rows[0];
  if (!ih) {
    await q('DELETE FROM npc_settlements WHERE tile_q = 0 AND tile_r = 0');
    ih = (await q("INSERT INTO npc_settlements (name, tile_q, tile_r, faction, is_kingdom) VALUES ('Ironhaven', 0, 0, 'kingdom', TRUE) RETURNING id")).rows[0];
  }
  r = await api(isel, 'GET', '/api/market/ironhaven');
  check(r.status === 200 && r.body.ironhaven && r.body.wants.length <= 3 && r.body.porter_carry === 20, 'Ironhaven: location, weekly wants, porter carry');
  const offer = (r.body.items || []).find(i => i.id === trout);
  const wantedTrout = offer && offer.wanted;
  check(offer && offer.unit_price === (wantedTrout ? 6 : 3) && offer.max_qty === 40, 'Ironhaven offers 30% (60% if wanted) and caps the porter at 40 fish');
  check(((r.body.items || []).find(i => i.id === relic) || {}).tradeable === false, 'untradeable items flagged on the Ironhaven list');
  const porter = await citizen(isel, 'Thistle', 3);
  r = await api(isel, 'POST', '/api/market/ironhaven/sell', { inventory_id: relic, qty: 1, citizen_id: porter });
  check(r.status === 400 && /cannot be traded/.test(r.body.error), 'Ironhaven refuses untradeable items');
  r = await api(isel, 'POST', '/api/market/ironhaven/sell', { inventory_id: trout, qty: 41, citizen_id: porter });
  check(r.status === 400 && /at most 40/.test(r.body.error), 'porter carry limit enforced');
  const troutBefore = await qty(trout), goldBefore = await res(isel, 'wealth');
  r = await api(isel, 'POST', '/api/market/ironhaven/sell', { inventory_id: trout, qty: 10, citizen_id: porter });
  check(r.status === 200 && r.body.gold === (wantedTrout ? 60 : 30), 'porter sets off with 10 trout, priced now');
  check(await qty(trout) === troutBefore - 10, 'the trout leave the inventory');
  r = await api(isel, 'POST', '/api/market/ironhaven/sell', { inventory_id: trout, qty: 1, citizen_id: porter });
  check(r.status === 400 && /busy/.test(r.body.error), 'a porter on the road cannot be sent again');
  await q("UPDATE market_runs SET arrives_at = NOW() - INTERVAL '2 seconds', returns_at = NOW() - INTERVAL '1 second' WHERE citizen_id = $1", [porter]);
  await market.resolveDue();
  check(await res(isel, 'wealth') === goldBefore + (wantedTrout ? 60 : 30), 'gold credited when the porter is home');
  r = await api(isel, 'GET', '/api/travel');
  check(!(r.body.journeys || []).some(j => j.id && j.id.startsWith('run:')), 'finished run leaves the map');

  console.log('Ledger & price history');
  const ledger = require('../lib/market_ledger');
  const mySids = [seller, buyer, stranger, clanmate, nomarket].map(p => p.sid);
  // Every trip and run this test made has exactly one trade record that matches it.
  const tripRows = (await q(`SELECT t.*, m.id AS mid, m.gold AS mgold, m.fee AS mfee, m.qty AS mqty, m.seller_settlement_id AS ms, m.buyer_settlement_id AS mb,
                                    m.delivered_at, m.paid_at, m.price_signal
                               FROM market_trips t LEFT JOIN market_trades m ON m.source = 'trip' AND m.source_id = t.id
                              WHERE t.seller_settlement_id = ANY($1::int[]) OR t.buyer_settlement_id = ANY($1::int[])`, [mySids])).rows;
  check(tripRows.length > 0 && tripRows.every(t => t.mid && t.mgold === t.gold_paid && t.mfee === t.fee && t.mqty === t.qty
    && t.ms === t.seller_settlement_id && t.mb === t.buyer_settlement_id && t.price_signal), `every caravan lot is recorded once (${tripRows.length})`);
  check(tripRows.every(t => (t.status === 'outbound') === !t.delivered_at && (t.status === 'done') === !!t.paid_at),
    'lots: delivered on arrival, paid when the merchant is home');
  const runRows = (await q(
    `SELECT r.*, m.id AS mid, m.kind AS mkind, m.gold AS mgold, m.fee AS mfee, m.price_signal, m.failed AS mfailed,
            m.seller_settlement_id AS ms, m.buyer_settlement_id AS mb, m.paid_at, m.delivered_at
       FROM market_runs r LEFT JOIN market_trades m ON m.source = 'run' AND m.source_id = r.id
      WHERE r.settlement_id IN (SELECT id FROM settlements WHERE name LIKE $1)`, ['%\\_' + RUN + '\\_%'])).rows;
  const kinds = new Set(runRows.map(r => r.kind));
  check(runRows.length > 0 && runRows.every(r => r.mid && r.mkind === r.kind && r.mgold === r.gold && r.mfee === r.fee),
    `every porter run is recorded once (${runRows.length}: ${[...kinds].join(', ')})`);
  check(runRows.every(r => r.price_signal === ['pickup', 'fill'].includes(r.kind)), 'only player deals carry the price signal (not Ironhaven or villages)');
  check(runRows.filter(r => r.kind === 'pickup').every(r => r.mb === r.settlement_id && r.ms === r.target_settlement_id)
    && runRows.filter(r => r.kind === 'fill').every(r => r.ms === r.settlement_id && r.mb === r.target_settlement_id),
    'pickups: the porter\'s town buys; fills: the porter\'s town sells');
  check(runRows.filter(r => r.failed).every(r => r.mfailed && !r.paid_at), 'a pickup that found the stall empty is marked failed, never paid');
  check(runRows.filter(r => r.status === 'done' && !r.failed).every(r => r.paid_at && r.delivered_at), 'finished runs are settled both ways');

  r = await api(seller, 'GET', '/api/market/ledger');
  const sold = (r.body.entries || []).filter(e => e.side === 'sold' && e.kind === 'lot');
  check(r.status === 200 && sold.length > 0 && sold.every(e => e.net === e.gross - e.fee && e.counterparty && e.citizen_name), 'seller\'s Ledger: lots with net after fee, buyer and merchant');
  check(r.body.weeks.length === 8 && r.body.weeks[7].in >= sold.filter(e => e.status !== 'returned').reduce((a, e) => a + e.net, 0) - 1, '8 weeks of totals, this week\'s income adds up');
  r = await api(buyer, 'GET', '/api/market/ledger?side=bought');
  check(r.body.entries.length > 0 && r.body.entries.every(e => e.side === 'bought' && e.net === -e.gross && e.fee === 0), 'buyer\'s Ledger: purchases cost the full price, no fee');
  r = await api(seller, 'GET', '/api/market/ledger?limit=1');
  const pg1 = await api(seller, 'GET', '/api/market/ledger?before=' + (r.body.entries[0] ? r.body.entries[0].id : 1));
  check(!pg1.body.entries.some(e => e.id >= r.body.entries[0].id), 'paging with before');

  // Price maths on goods nobody else trades.
  const res1 = 'tst' + RUN, item1 = 'tsti' + RUN;
  const rec = (o) => ledger.record({ query: q }, { kind: 'lot', source: 'trip', source_id: 900000000 + Math.floor(Math.random() * 99999999), resource: res1,
    seller_id: seller.sid, buyer_id: buyer.sid, fee: 0, ...o });
  await rec({ qty: 100, gold: 70 });
  await rec({ qty: 50, gold: 50 });
  await ledger.record({ query: q }, { kind: 'npc', source: 'run', source_id: 900000000 + Math.floor(Math.random() * 99999999), resource: res1, qty: 10, gold: 1000, buyer_id: buyer.sid });
  let ph = (await ledger.priceHistory(ledger.parseGoods('resource:' + res1)))['resource:' + res1];
  check(ph.week.avg === 0.8 && ph.week.n === 2 && ph.week.low === 0.7 && ph.week.high === 1, 'volume-weighted 7-day average (120 gold / 150 = 0.8); village deals ignored');
  check(ph.guide === null && ph.guide_source === null, 'under 3 trades and no reference: no guide');
  await rec({ qty: 50, gold: 30 });
  ph = (await ledger.priceHistory(ledger.parseGoods('resource:' + res1)))['resource:' + res1];
  check(ph.guide === 0.75 && ph.guide_source === 'trades' && ph.days.length === 1 && ph.days[0].n === 3, '3 trades: the guide follows the trades (150 / 200)');
  const tSnap = q2 => ({ item_key: item1, name: 'Test Blade', icon: '🗡️', metadata: q2 ? { quality: q2, crafted_by: { name: 'Fenn' } } : {} });
  await rec({ item_snapshot: tSnap(null), qty: 1, gold: 10 });
  await rec({ item_snapshot: tSnap('fine'), qty: 1, gold: 40 });
  await rec({ item_snapshot: tSnap('fine'), qty: 1, gold: 50, kind: 'pickup' });
  const ip = await ledger.priceHistory(ledger.parseGoods(`item:${item1},item:${item1}:fine`));
  check(ip[`item:${item1}:basic`].week.avg === 10 && ip[`item:${item1}:fine`].week.avg === 45, 'items are priced per quality (Fine doesn\'t move Basic)');
  const failId = 900000000 + Math.floor(Math.random() * 99999999);
  await ledger.record({ query: q }, { kind: 'pickup', source: 'run', source_id: failId, item_snapshot: tSnap(null), qty: 1, gold: 999, buyer_id: buyer.sid, seller_id: seller.sid });
  await ledger.settle({ query: q }, 'run', failId, { failed: true });
  check((await ledger.priceHistory(ledger.parseGoods(`item:${item1}`)))[`item:${item1}:basic`].week.avg === 10, 'a failed pickup doesn\'t count');
  r = await api(seller, 'GET', `/api/market/prices?goods=resource:${res1},item:${item1}:fine`);
  check(r.status === 200 && r.body.prices['resource:' + res1].guide === 0.75 && r.body.prices[`item:${item1}:fine`].week.n === 2, 'GET /prices');
  r = await api(seller, 'GET', '/api/market/prices?goods=resource:timber,item:iron_sword:shiny');
  check(r.status === 400, 'unknown qualities are refused');
  r = await api(seller, 'GET', '/api/market/prices?goods=' + Array.from({ length: 13 }, (_, i) => 'resource:r' + i).join(','));
  check(r.status === 400 && /12/.test(r.body.error), 'at most 12 goods per request');
  r = await api(seller, 'GET', '/api/market/prices?goods=resource:timber');
  check(r.body.prices['resource:timber'].reference.price === 0.7, 'resources fall back to the reference price');
  r = await api(seller, 'GET', '/api/market/prices/movers');
  const mv = (r.body.goods || []).find(g => g.key === 'resource:' + res1);
  check(mv && mv.avg === 0.75 && mv.qty === 200 && mv.n === 3, 'Prices view: this week\'s goods with volume');
  r = await api(seller, 'GET', '/api/market/status');
  check(r.body.guide && ['food', 'timber', 'stone', 'metal'].every(k => r.body.guide[k] && ['trades', 'reference'].includes(r.body.guide[k].source)), '/status carries guide prices for the Sell form');
  // The backfill is idempotent: re-running the migration adds nothing.
  const n0 = Number((await q('SELECT COUNT(*) FROM market_trades')).rows[0].count);
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'migrations', '0NN_market_ledger.sql'), 'utf8');
  await q(sql);
  check(Number((await q('SELECT COUNT(*) FROM market_trades')).rows[0].count) === n0, 're-running the migration adds no duplicates');
  await q('DELETE FROM market_trades WHERE resource = $1 OR item_key = $2', [res1, item1]);

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) await part2();
  else console.log('(DATABASE_URL not set — skipping HTTP checks)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
