// scripts/travel_test.js — checks for GET /api/travel (lib/travel.js), the
// journeys drawn by the world map's travel path layer.
//
// Part 1 is pure. Part 2 seeds one journey of each kind in the database and
// reads them back over HTTP from a running server on the same DATABASE_URL.
// Run Part 2 only against a throwaway database.
//
// Usage:
//   node scripts/travel_test.js                       (Part 1 only)
//   DATABASE_URL=postgres://… TRAVEL_TEST_BASE=http://localhost:3999 \
//     node scripts/travel_test.js

'use strict';

const travel = require('../lib/travel');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}

function part1() {
  console.log('Pure');
  const rt = travel.roundTrip('2026-10-20T12:00:00Z', '2026-10-20T12:10:00Z');
  check(rt.arrives_at === '2026-10-20T12:05:00.000Z' && rt.returns_at === '2026-10-20T12:10:00.000Z', 'round trip turns round at the midpoint');
  check(travel.questDestination({ npc_q: 3, npc_r: 4 }).q === 3, 'NPC quest goes to the NPC town');
  check(travel.questDestination({ npc_q: null, npc_r: null }) === null, 'tavern quest has no place');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.TRAVEL_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  const tiles = [[3, 30], [9, 30], [15, 30]];

  async function user(name) {
    const username = `${name}_${RUN}_${seq}`;
    const [tq, tr] = tiles[seq++];
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Otters') RETURNING id",
      [username, `${username}@t.l`])).rows[0];
    await q('UPDATE settlements SET tile_q = NULL, tile_r = NULL WHERE tile_q=$1 AND tile_r=$2', [tq, tr]);   // earlier runs' towns
    const s = (await q(`INSERT INTO settlements (user_id, name, tile_q, tile_r, world_version) VALUES ($1,$2,$3,$4,2) RETURNING id`,
      [u.id, username, tq, tr])).rows[0];
    const c = (await q("INSERT INTO citizens (settlement_id, name, role, life_stage) VALUES ($1,$2,'idle','adult') RETURNING id",
      [s.id, 'Cit ' + name])).rows[0];
    return { id: u.id, sid: s.id, q: tq, r: tr, cid: c.id, token: jwt.sign({ userId: u.id, username, species: 'Otters' }, SECRET) };
  }
  const get = async p => (await fetch(BASE + '/api/travel', { headers: { Authorization: 'Bearer ' + p.token } })).json();
  const ago = s => new Date(Date.now() - s * 1000);
  const later = s => new Date(Date.now() + s * 1000);

  const seller = await user('seller'), buyer = await user('buyer'), stranger = await user('stranger');
  await q('DELETE FROM npc_settlements WHERE tile_q = 7 AND tile_r = 36');   // left by an earlier run
  const npc = (await q("INSERT INTO npc_settlements (name, tile_q, tile_r) VALUES ($1, 7, 36) RETURNING id", ['Burrowmere ' + RUN])).rows[0];

  // Market trip seller → buyer, outbound.
  const order = (await q(
    `INSERT INTO market_orders (seller_settlement_id, resource, lot_size, lot_price, qty_total, qty_escrowed, expires_at)
     VALUES ($1,'timber',100,70,100,0,NOW() + INTERVAL '1 day') RETURNING id`, [seller.sid])).rows[0];
  await q(`INSERT INTO market_trips (order_id, seller_settlement_id, buyer_settlement_id, citizen_id, resource, qty, gold_paid, fee, distance, departs_at, arrives_at, returns_at)
           VALUES ($1,$2,$3,$4,'timber',100,70,3,6,$5,$6,$7)`, [order.id, seller.sid, buyer.sid, seller.cid, ago(60), later(60), later(180)]);
  // Scout, envoy, NPC quest, tavern quest, clan quest — all the seller's.
  await q(`INSERT INTO expeditions (settlement_id, user_id, target_q, target_r, started_at, completes_at, path, citizen_id)
           VALUES ($1,$2,12,25,$3,$4,$5,$6)`, [seller.sid, seller.id, ago(30), later(90), JSON.stringify([{ q: 3, r: 30 }, { q: 12, r: 25 }]), seller.cid]);
  await q(`INSERT INTO diplomacy_relations (settlement_id, npc_id, status, citizen_id, contact_sent_at, contact_arrives_at)
           VALUES ($1,$2,'contact_sent',$3,$4,$5)`, [seller.sid, npc.id, seller.cid, ago(10), later(50)]);
  await q(`INSERT INTO quest_definitions (id, title, given_by_npc_id) VALUES ($1,'Lost Lantern',$2)`, ['tq_npc_' + RUN, npc.id]);
  await q(`INSERT INTO quest_definitions (id, title) VALUES ($1,'Tavern Errand')`, ['tq_tav_' + RUN]);
  await q(`INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, started_at, completes_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [seller.sid, seller.id, 'tq_npc_' + RUN, seller.cid, ago(60), later(540)]);
  await q(`INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, started_at, completes_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [seller.sid, seller.id, 'tq_tav_' + RUN, seller.cid, ago(60), later(540)]);
  const clan = (await q('INSERT INTO clans (name, founder_user_id, hq_q, hq_r) VALUES ($1,$2,20,20) RETURNING id', ['T ' + RUN, seller.id])).rows[0];
  const runRow = (await q(`INSERT INTO clan_quest_runs (clan_id, quest_key, kind, status, started_at, completes_at)
           VALUES ($1,'raid','solo','active',$2,$3) RETURNING id`, [clan.id, ago(60), later(60)])).rows[0];
  const extra = (await q("INSERT INTO citizens (settlement_id, name, role, life_stage) VALUES ($1,'Clanny','idle','adult') RETURNING id", [seller.sid])).rows[0];
  await q('INSERT INTO clan_quest_slots (run_id, role_index, user_id, settlement_id, citizen_id) VALUES ($1,0,$2,$3,$4)',
    [runRow.id, seller.id, seller.sid, extra.id]);

  console.log('Seller');
  const s = await get(seller);
  const by = k => (s.journeys || []).filter(j => j.kind === k);
  check(s.ok && typeof s.now === 'string', 'responds with server time');
  const m = by('market')[0];
  check(m && m.from.q === seller.q && m.to.q === buyer.q && m.returns_at && !m.incoming, 'market: seller → buyer, out-and-back');
  check(m && m.cargo.resource === 'timber' && m.cargo.qty === 100 && m.citizen.species === 'otters', 'market: cargo + species');
  const sc = by('scout')[0];
  check(sc && sc.from.q === 3 && sc.to.q === 12 && sc.to.r === 25 && sc.returns_at === null, 'scout: path start → target, one way');
  const en = by('envoy')[0];
  check(en && en.to.q === 7 && en.to.r === 36 && /Burrowmere/.test(en.title), 'envoy: home → NPC town');
  const qs = by('quest');
  check(qs.length === 1 && qs[0].to.q === 7 && qs[0].returns_at && /Lost Lantern/.test(qs[0].title), 'NPC quest drawn; tavern quest skipped');
  const cq = by('clan_quest')[0];
  check(cq && cq.to.q === 20 && cq.to.r === 20 && cq.returns_at, 'clan quest: home → clan HQ, out-and-back');

  console.log('Buyer & stranger');
  const b = await get(buyer);
  const inc = (b.journeys || []).find(j => j.kind === 'market');
  check(inc && inc.incoming === true && inc.returns_at === null && inc.to.q === buyer.q, 'buyer sees the incoming caravan, one way to them');
  check((b.journeys || []).length === 1, 'buyer sees nothing else of the seller');
  const st = await get(stranger);
  check((st.journeys || []).length === 0, 'stranger sees no journeys');

  console.log('After arrival');
  await q("UPDATE market_trips SET arrives_at = NOW() - INTERVAL '1 second' WHERE order_id=$1", [order.id]);
  const b2 = await get(buyer);
  check(!(b2.journeys || []).some(j => j.kind === 'market'), 'delivered caravan disappears for the buyer');
  const s2 = await get(seller);
  check((s2.journeys || []).some(j => j.kind === 'market'), 'seller still sees their merchant walking home');

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) await part2();
  else console.log('(DATABASE_URL not set — skipping HTTP checks)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
