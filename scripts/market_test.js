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
  const tiles = [[2, 2], [8, 2], [14, 2], [20, 2], [26, 2], [2, 20], [8, 20], [14, 20]];

  async function user(name, { market: lvl = 1, wealth = 1000, timber = 1000 } = {}) {
    const username = `${name}_${RUN}_${seq}`;
    const [tq, tr] = tiles[seq++];
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id",
      [username, `${username}@t.l`])).rows[0];
    await q('DELETE FROM settlements WHERE tile_q=$1 AND tile_r=$2', [tq, tr]).catch(() => {});
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
  r = await api(seller, 'PATCH', `/api/citizens/${a1}/role`, { role: 'farmer' });
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
    { kind: 'item', inventory_id: id, lot_size: 10, lot_price: 15, qty_total: 20, citizen_ids: [m1], ...extra });

  r = await itemOrder(relic, { lot_size: 1, qty_total: 1 });
  check(r.status === 400 && /cannot be traded/.test(r.body.error), 'template marked not tradeable → refused');
  r = await itemOrder(bound, { lot_size: 1, qty_total: 1 });
  check(r.status === 400 && /cannot be traded/.test(r.body.error), 'stack marked not tradeable → refused');
  r = await itemOrder(worn, { lot_size: 1, qty_total: 1 });
  check(r.status === 400 && /Unequip/.test(r.body.error), 'equipped item → refused');
  r = await itemOrder(trout, { lot_size: 10, qty_total: 301 });
  check(r.status === 400 && /only have 300/.test(r.body.error), 'cannot list more than the stack holds');
  r = await itemOrder(plate, { lot_size: 1, qty_total: 2 });
  check(r.status === 400, 'cannot list more equipment than you have');
  r = await itemOrder(trout);
  check(r.status === 200 && r.body.order.kind === 'item' && r.body.order.item_snapshot.name === 'Test Trout', 'stack listed as an item order');
  const fishOrder = r.body.order.id;
  check(await qty(trout) === 280, 'listed units leave the stack (300 → 280)');
  r = await api(isel, 'POST', '/api/market/orders', { kind: 'item', inventory_id: plate, lot_size: 1, lot_price: 90, qty_total: 1, citizen_ids: [await citizen(isel, 'Reed')] });
  check(r.status === 200 && r.body.order.qty_total === 1, 'equipment listed as a single piece');
  const plateOrder = r.body.order.id;
  check((await q('SELECT 1 FROM inventory_items WHERE id=$1', [plate])).rowCount === 0, 'a fully listed row leaves the inventory');

  r = await api(ibuy, 'GET', '/api/market/orders?resource=items');
  const seenItems = (r.body.orders || []).filter(o => o.seller.id === isel.sid);
  check(seenItems.length === 2 && seenItems.every(o => o.kind === 'item' && o.item && o.item.name), 'Items filter lists item orders with their details');
  r = await api(ibuy, 'GET', '/api/market/orders?resource=timber');
  check(!(r.body.orders || []).some(o => o.kind === 'item'), 'resource filters exclude items');

  r = await api(ibuy, 'POST', `/api/market/orders/${fishOrder}/buy`);
  check(r.status === 200 && r.body.trip.qty === 10 && r.body.trip.item.name === 'Test Trout', 'buy a lot of 10 trout');
  await landAll(fishOrder);
  const buyerTrout = (await q('SELECT quantity FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [ibuy.sid, tradeKey])).rows;
  check(buyerTrout.length === 1 && buyerTrout[0].quantity === 15, 'delivered trout stack onto the buyer\'s existing 5');
  r = await api(ibuy, 'POST', `/api/market/orders/${plateOrder}/buy`);
  await landAll(plateOrder);
  check((await q("SELECT 1 FROM inventory_items WHERE settlement_id=$1 AND item_key=$2 AND equip_slot='armour'", [ibuy.sid, 'mt_plate_' + RUN])).rowCount === 1,
    'equipment arrives as its own piece');
  r = await api(isel, 'POST', `/api/market/orders/${fishOrder}/cancel`);
  check(r.status === 200 && r.body.refunded === 10 && await qty(trout) === 290, 'cancel returns unsold items to the stack');

  r = await api(isel, 'GET', '/api/market/mine');
  const pick = (r.body.items || []).reduce((m, i) => (m[i.id] = i, m), {});
  check(pick[trout] && pick[trout].tradeable && pick[trout].max_lot === 700 && pick[trout].sell_value === 10, 'Sell picker: tradeable stack, carry cap, town price');
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

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) await part2();
  else console.log('(DATABASE_URL not set — skipping HTTP checks)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
