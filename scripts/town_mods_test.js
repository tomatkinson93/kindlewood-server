// ══════════════════════════════════════════════════════════════════════════
//  town_mods_test — festivals, City upkeep and arrears (lib/town_mods.js,
//  routes/town.js, the settlement tick in routes/game.js).
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/town_mods_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const T = require('../lib/town_mods');
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  console.log('Rules');
  check(JSON.stringify(T.festivalCost('camp')) === '{"wealth":150,"food":100}' && T.festivalCost('city').wealth === 600, 'a festival costs more the bigger the town (150–600 wealth)');
  const s = { festival_started_at: new Date(0).toISOString(), festival_until: new Date(5 * 3600e3).toISOString() };
  const t = { mods: {}, festival: { active: false } };
  const f = T.productionFactors(t, s, 0, 10 * 3600e3);
  check(Math.abs(f.food - 1.05) < 1e-9, 'a festival that covered half the time away counts for half (+5%)');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID) || null;
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function town(name, tier, wealth = 1000, forceId = null) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET email = users.email RETURNING id", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    let s = (await q('SELECT id FROM settlements WHERE user_id=$1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                          VALUES ($1,$2,2,$3,$4,1000,500,500,500,-70000-$5,-70000,NOW()) RETURNING id`, [u.id, username, tier, wealth, seq])).rows[0];
    else await q("UPDATE settlements SET tier=$2, wealth=$3, food=1000, festival_until=NULL, festival_cooldown_until=NULL, arrears_since=NULL WHERE id=$1", [s.id, tier, wealth]);
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const sett = async p => (await api(p, 'GET', '/api/game/settlement')).body.settlement;
  const row = async p => (await q('SELECT * FROM settlements WHERE id=$1', [p.sid])).rows[0];

  console.log('Festivals');
  const a = await town('fest', 'village');
  let s0 = await sett(a);
  let r = await api(a, 'POST', '/api/town/festival');
  let after = await row(a);
  check(r.status === 200 && r.body.festival.active && Number(after.wealth) <= Number(s0.resources.wealth) - 300 + 2 && Number(after.food) <= Number(s0.resources.food) - 200 + 2, 'a Village festival costs 300 wealth and 200 food');
  const s1 = await sett(a);
  check(s1.town.festival.active && s1.happiness - s0.happiness === 10 || (s0.happiness >= 90 && s1.happiness === 100), `+10 happiness while it runs (${s0.happiness} → ${s1.happiness})`);
  check(s1.rates.timber > s0.rates.timber && Math.abs(s1.rates.timber / s0.rates.timber - 1.1) < 0.06, `+10% production (${s0.rates.timber} → ${s1.rates.timber} timber/hr)`);
  const bd = (await api(a, 'GET', '/api/game/resource-breakdown')).body.breakdown;
  check(bd.food.sources.some(x => x.kind === 'town_bonus' && /×1\.10/.test(x.label)), 'the food breakdown shows the town bonus');
  r = await api(a, 'POST', '/api/town/festival');
  check(r.status === 400 && /already/.test(r.body.error), 'one festival at a time');
  await q("UPDATE settlements SET festival_until = NOW() - interval '1 minute' WHERE id=$1", [a.sid]);
  r = await api(a, 'POST', '/api/town/festival');
  check(r.status === 400 && /recovering/.test(r.body.error) && !(await sett(a)).town.festival.active, 'when it ends, a cooldown before the next');
  await q("UPDATE settlements SET festival_cooldown_until = NOW() - interval '1 minute', wealth = 10 WHERE id=$1", [a.sid]);
  r = await api(a, 'POST', '/api/town/festival');
  check(r.status === 400 && /Not enough wealth/.test(r.body.error), 'and it has to be paid for');
  const ev = (await q("SELECT 1 FROM settlement_events WHERE settlement_id=$1 AND type='festival'", [a.sid])).rows;
  check(ev.length === 1, 'the festival is announced as a settlement event');

  console.log('City upkeep');
  const c = await town('cityup', 'city', 5000);
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'market',5), ($1,'farm',3)", [c.sid]);
  let sc = await sett(c);
  check(sc.town.upkeep.city === 2 * T.CITY_UPKEEP_PER_LEVEL, `a City pays for building levels above 3 (Market Lv5 → ${sc.town.upkeep.city}/hr)`);
  const bdc = (await api(c, 'GET', '/api/game/resource-breakdown')).body.breakdown;
  check(bdc.wealth.sources.some(x => x.kind === 'city_upkeep' && x.value === -sc.town.upkeep.city), 'the wealth breakdown shows it');
  await q("UPDATE settlements SET tier='town' WHERE id=$1", [c.sid]);
  check((await sett(c)).town.upkeep.city === 0, 'a Town pays nothing for them');

  console.log('Arrears');
  const d = await town('broke', 'city', 0);
  await q(`INSERT INTO buildings (settlement_id, type, level) SELECT $1, 'starter_house', 10 FROM generate_series(1, 40)`, [d.sid]);
  const sd0 = await sett(d);
  check(sd0.town.upkeep.city === 40 * 7 * T.CITY_UPKEEP_PER_LEVEL && sd0.rates.wealth < 0, `upkeep can outrun income (${sd0.rates.wealth}/hr)`);
  await q("UPDATE settlements SET last_tick = NOW() - interval '3 hours', wealth = 5 WHERE id=$1", [d.sid]);
  const sd1 = await sett(d);
  const rd = await row(d);
  check(Number(rd.wealth) === 0 && rd.arrears_since && sd1.town.arrears === true, 'the treasury stops at 0 and the town falls into arrears');
  check(sd1.happiness <= sd0.happiness - 10 || sd1.happiness === 0, `arrears cost happiness (${sd0.happiness} → ${sd1.happiness})`);
  check((await q("SELECT 1 FROM settlement_events WHERE settlement_id=$1 AND type='arrears'", [d.sid])).rows.length === 1, 'an event says so');
  await q("DELETE FROM buildings WHERE settlement_id=$1", [d.sid]);
  await q("UPDATE settlements SET last_tick = NOW() - interval '1 hour', wealth = 50 WHERE id=$1", [d.sid]);
  const sd2 = await sett(d);
  check(sd2.town.arrears === false && !(await row(d)).arrears_since && (await q("SELECT 1 FROM settlement_events WHERE settlement_id=$1 AND type='arrears_cleared'", [d.sid])).rows.length === 1, 'paid up: out of arrears, with an event');

  if (ADMIN) {
    console.log('Dev Tools');
    const adm = await town('townadm', 'camp', 0, ADMIN);
    r = await api(adm, 'POST', '/api/town/admin/festival');
    check(r.status === 200 && r.body.festival.active, 'Dev Tools: a free festival');
    r = await api(a, 'POST', '/api/town/admin/festival');
    check(r.status === 403, 'players can\'t');
  }
  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and CRAFTING_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
