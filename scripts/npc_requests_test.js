// scripts/npc_requests_test.js — village special requests ("Burrowmere needs
// 20 bronze by Friday"): seeded per village and day, filled by porters over
// as many trips as you like, paid above market, with thanks in trust.
//
// Part 1 is pure (lib/npc_trade requestFor). Part 2 uses the database and a
// running server over HTTP against the same DATABASE_URL. Throwaway
// databases only.
//
//   node scripts/npc_requests_test.js
//   DATABASE_URL=postgres://… MARKET_TEST_BASE=http://localhost:3999 node scripts/npc_requests_test.js

'use strict';

const npcTrade = require('../lib/npc_trade');
const market = require('../lib/market');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}

const TPL = [
  { item_key: 'pick', name: 'Pick', category: 'equipment', equip_slot: 'tool', sell_value: 20, rarity: 'common', tradeable: true },
  { item_key: 'trout', name: 'Trout', category: 'fish', sell_value: 3, rarity: 'common', tradeable: true },
  { item_key: 'relic', name: 'Relic', category: 'equipment', equip_slot: 'tool', sell_value: 500, rarity: 'epic', tradeable: true },
];

function part1() {
  console.log('Requests');
  const days = Array.from({ length: 30 }, (_, i) => `2026-04-${String(i + 1).padStart(2, '0')}`);
  const all = [];
  for (let id = 1; id <= 20; id++) for (const d of days) { const r = npcTrade.requestFor({ id }, d, TPL); if (r) all.push({ id, d, r }); }
  const share = all.length / (20 * 30);
  check(share > 0.25 && share < 0.8, `villages often have a request, not always (${Math.round(share * 100)}% of days)`);
  check(all.every(x => x.r.key === 'req' && x.r.side === 'buy' && x.r.request.trust === npcTrade.REQUEST_TRUST), 'a request is a village buy order keyed "req", with bonus trust');
  check(all.every(x => { const span = (Date.parse(x.r.request.ends_at) - Date.parse(x.r.request.day + 'T00:00:00Z')) / 86400000; return span >= 1 && span <= 3; }), 'each lasts 1–3 days');
  check(all.every(x => Date.parse(x.d + 'T00:00:00Z') < Date.parse(x.r.request.ends_at) && x.r.request.day <= x.d), '…and covers the day it is listed');
  const same = npcTrade.requestFor({ id: all[0].id }, all[0].d, TPL);
  check(JSON.stringify(same) === JSON.stringify(all[0].r), 'seeded: every town sees the same request');
  const nextDay = all.find(x => all.some(y => y.id === x.id && y.r.request.day === x.r.request.day && y.d > x.d));
  check(!nextDay || JSON.stringify(npcTrade.requestFor({ id: nextDay.id }, nextDay.d, TPL).request) === JSON.stringify(nextDay.r.request), 'a multi-day request is the same one each day');
  const res = all.filter(x => x.r.kind === 'resource'), items = all.filter(x => x.r.kind === 'item');
  check(res.length && items.length, 'requests ask for resources and for items');
  check(res.every(x => x.r.per === 10 && x.r.qty >= 10 && x.r.price / 10 > market.REFERENCE_PRICE[x.r.resource] * 1.3), 'resources: priced per 10, well above the reference price');
  check(res.some(x => ['copper', 'tin', 'coal', 'silver', 'bronze', 'steel'].includes(x.r.resource)), 'villages ask for the new metals too');
  check(items.every(x => x.r.item.item_key !== 'relic' && x.r.price > TPL.find(t => t.item_key === x.r.item.item_key).sell_value * 1.25), 'items: common goods, paid well above their value');
  const tier = npcTrade.tierFor(80);
  const big = all.find(x => x.r.price >= 20) || all[0];
  const adj = npcTrade.applyTier(big.r, tier);
  check(adj.qty === big.r.qty && adj.price > big.r.price, 'Allied villages ask the same amount but pay more');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.MARKET_TEST_BASE || process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);

  const today = npcTrade.dayOf();
  const tpls = (await q('SELECT * FROM item_templates WHERE tradeable')).rows;
  // A village with a resource request today (requests are seeded by id and day).
  let villa = null, req = null;
  for (let i = 0; i < 80 && !req; i++) {
    await q('DELETE FROM npc_settlements WHERE tile_q = 61 AND tile_r = 61 AND name LIKE $1', ['Askwell %']);
    const v = (await q("INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1, 61, 61, 'neutral', 'badger', 'friendly') RETURNING *",
      ['Askwell ' + RUN + i])).rows[0];
    const r = npcTrade.requestFor(v, today, tpls);
    if (r && r.kind === 'resource') { villa = v; req = r; } else await q('DELETE FROM npc_settlements WHERE id = $1', [v.id]);
  }
  if (!req) { check(false, 'found a village with a resource request today'); return pool.end(); }

  const username = `req_${RUN}`;
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
  await q('UPDATE settlements SET tile_q = NULL, tile_r = NULL WHERE tile_q = 58 AND tile_r = 58');
  const s = (await q(`INSERT INTO settlements (user_id, name, tile_q, tile_r, world_version, wealth, last_tick) VALUES ($1,$2,58,58,2,1000,NOW()) RETURNING *`, [u.id, username])).rows[0];
  await q(`UPDATE settlements SET ${req.resource} = $2 WHERE id = $1`, [s.id, req.qty * 2]);
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'market',5)", [s.id]);
  await q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,61,61), ($1,58,58) ON CONFLICT DO NOTHING', [u.id]);
  await q("INSERT INTO diplomacy_relations (settlement_id, npc_id, status, trust) VALUES ($1,$2,'familiar',30)", [s.id, villa.id]);
  const porters = [];
  for (const n of ['Hob', 'Nell']) porters.push((await q(`INSERT INTO citizens (settlement_id, name, role, skills, life_stage) VALUES ($1,$2,'farmer','{"scouting":1}','adult') RETURNING id`, [s.id, n])).rows[0].id);
  const p = { token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  const api = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  console.log('In the Wanted tab');
  let r = await api('GET', '/api/market/wants?resource=resources');
  const row = (r.body.wants || []).find(w => w.npc && w.npc.id === villa.id && w.order_key === 'req');
  check(row && row.request && row.request.by && row.qty_open === req.qty && row.expires_at === req.request.ends_at, `the request shows with its deadline: ${req.qty} ${req.resource} by ${req.request.by}`);

  console.log('Filling it');
  const half = Math.max(10, Math.floor(req.qty / 2 / 10) * 10);
  r = await api('POST', `/api/market/npc/${villa.id}/req`, { qty: half, citizen_id: porters[0] });
  check(r.status === 200 && r.body.side === 'sell', `the first trip carries ${half}` + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  const usage = (await q("SELECT to_char(day, 'YYYY-MM-DD') AS day, qty FROM npc_trade_usage WHERE settlement_id = $1 AND order_key = 'req'", [s.id])).rows[0];
  check(usage && usage.day === req.request.day && usage.qty === half, 'it counts on the request\'s start day');
  r = await api('GET', '/api/market/wants?resource=resources');
  const row2 = (r.body.wants || []).find(w => w.npc && w.npc.id === villa.id && w.order_key === 'req');
  check(row2 && row2.qty_open === req.qty - half, 'what is left shows');
  const runs0 = (await q("SELECT order_key FROM market_runs WHERE settlement_id = $1 AND kind = 'npc'", [s.id])).rows;
  check(runs0.length === 1 && runs0[0].order_key === 'req', 'a partial trip is a plain request run');
  const trust0 = (await q('SELECT trust FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [s.id, villa.id])).rows[0].trust;
  r = await api('POST', `/api/market/npc/${villa.id}/req`, { qty: req.qty - half, citizen_id: porters[1] });
  check(r.status === 200, 'the second trip finishes it');
  const done = (await q("SELECT order_key FROM market_runs WHERE settlement_id = $1 AND kind = 'npc' ORDER BY id DESC LIMIT 1", [s.id])).rows[0];
  check(done.order_key === 'req!', 'the finishing trip is marked');
  r = await api('POST', `/api/market/npc/${villa.id}/req`, { qty: 10, citizen_id: porters[0] });
  check(r.status === 409 || r.status === 400, 'a filled request takes no more');

  console.log('The porters come home');
  const g0 = Number((await q('SELECT wealth FROM settlements WHERE id=$1', [s.id])).rows[0].wealth);
  await q("UPDATE market_runs SET arrives_at = NOW() - INTERVAL '2 seconds', returns_at = NOW() - INTERVAL '1 second' WHERE settlement_id = $1 AND status <> 'done'", [s.id]);
  await market.resolveDue(); await market.resolveDue();
  const g1 = Number((await q('SELECT wealth FROM settlements WHERE id=$1', [s.id])).rows[0].wealth);
  const paid = npcTrade.dealGold(npcTrade.applyTier(req, npcTrade.tierFor(30)), half) + npcTrade.dealGold(npcTrade.applyTier(req, npcTrade.tierFor(30)), req.qty - half);
  check(g1 - g0 === paid, `paid above market: ${paid} gold for ${req.qty} ${req.resource}`);
  const trust1 = (await q('SELECT trust FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [s.id, villa.id])).rows[0].trust;
  check(trust1 - trust0 >= npcTrade.REQUEST_TRUST, `finishing it earns the village's thanks (+${trust1 - trust0} trust)`);
  const ev = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='village_request'", [s.id])).rows;
  check(ev.length === 1 && /grateful/.test(ev[0].message), 'a settlement event (and the away report) says so');

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and MARKET_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
