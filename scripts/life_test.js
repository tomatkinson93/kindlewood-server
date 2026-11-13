// ══════════════════════════════════════════════════════════════════════════
//  life_test — the life cycle (docs/PHASE_1_LIFE_CYCLE.md). Step 1 so far:
//  houses hold 4, births need a free bed in town, the population follows
//  the living, the kin rule, housing sorts itself, the dead free their bed.
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/life_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function main() {
  const LIFE = require('../lib/life');
  const SIM = require('../simulation');
  const S = require('../seasons');

  console.log('Kin');
  const ma = { id: 1, parent_ids: [] }, pa = { id: 2, parent_ids: [] };
  const kid1 = { id: 3, parent_ids: [1, 2] }, kid2 = { id: 4, parent_ids: '[1,2]' };
  const half = { id: 5, parent_ids: [2, 9] }, stranger = { id: 6, parent_ids: [7, 8] };
  check(LIFE.kin(ma, kid1) && LIFE.kin(kid1, ma) && LIFE.kin(pa, kid2), 'parent and child are kin (either order; parent_ids as JSON text too)');
  check(LIFE.kin(kid1, kid2), 'siblings are kin');
  check(LIFE.kin(kid1, half), 'half-siblings are kin');
  check(!LIFE.kin(kid1, stranger) && !LIFE.kin(ma, pa) && !LIFE.kin(ma, ma), 'unrelated citizens are not; nobody is their own kin');

  console.log('Partnerships skip kin');
  const T0 = Date.UTC(2026, 0, 1);
  const ctx = { at: T0, season: S.seasonAt(T0), hMods: {} };
  const mk = (id, over = {}) => Object.assign({ id, name: 'C' + id, gender: id % 2 ? 'male' : 'female', life_stage: 'adult', house_id: 1,
    life: { happiness: 90 }, hidden_traits: [], visible_traits: [], stats: {}, skills: {}, partner_id: null, generation: 1, parent_ids: [] }, over);
  {
    const orig = Math.random; Math.random = () => 0;
    try {
      const sib1 = mk(11, { parent_ids: [1, 2] }), sib2 = mk(12, { parent_ids: [1, 2] });
      const s1 = { pairs: [[sib1, sib2]], rels: { '11_12': { score: 95, gain: 0, state: 'bonded' } }, newPartners: [], events: [] };
      SIM._hourly.partnerships(s1, ctx);
      check(s1.newPartners.length === 0 && !sib1.partner_id, 'two siblings with a bond of 95 never become partners');
      const a = mk(13), b = mk(14);
      const s2 = { pairs: [[a, b]], rels: { '13_14': { score: 95, gain: 0, state: 'bonded' } }, newPartners: [], events: [] };
      SIM._hourly.partnerships(s2, ctx);
      check(s2.newPartners.length === 1 && a.partner_id === 14, 'two strangers with the same bond do');
    } finally { Math.random = orig; }
  }

  console.log('Births need a free bed in town');
  {
    const orig = Math.random; Math.random = () => 0;   // every roll succeeds
    try {
      const a = mk(1, { partner_id: 2, house_id: 1 }), b = mk(2, { partner_id: 1, house_id: 2 });
      const houses = { 1: { id: 1, capacity: 4, occupants: 4, name: 'Oak' }, 2: { id: 2, capacity: 4, occupants: 3, name: 'Ash' }, 3: { id: 3, capacity: 4, occupants: 0, name: 'Elm' } };
      const sim = { pairs: [[a, b]], rels: {}, houses, freeBeds: 2, newPartners: [], events: [], births: [] };
      for (let h = 0; h < 10; h++) SIM._hourly.breeding(sim, { ...ctx, at: T0 + h * 3600e3 });
      check(sim.births.length === 2, 'a couple in different houses has children while the town has beds (2 free → 2 births)');
      check(sim.births[0].house.id === 2, "the first baby sleeps in a parent's house with room (Ash, not the full Oak)");
      check(sim.births[1].house.id === 3, 'when both parents\' houses are full, the next goes to a house with room');
      check(sim.freeBeds === 0, 'free beds count down');
      const full = { pairs: [[mk(1, { partner_id: 2 }), mk(2, { partner_id: 1 })]], rels: {}, houses: { 1: { id: 1, capacity: 4, occupants: 2 } }, freeBeds: 0, newPartners: [], events: [], births: [] };
      SIM._hourly.breeding(full, ctx);
      check(full.births.length === 0, 'no free bed in town (an unhoused citizen counts): no birth, even with room in their own house');
      const same = { pairs: [[mk(1, { partner_id: 2, gender: 'male' }), mk(2, { partner_id: 1, gender: 'male' })]], rels: {}, houses: { 1: { id: 1, capacity: 4, occupants: 2 } }, freeBeds: 2, newPartners: [], events: [], births: [] };
      SIM._hourly.breeding(same, ctx);
      check(same.births.length === 0, 'same-gender partners still have no births');
    } finally { Math.random = orig; }
  }

  console.log('Housing sorts itself (planner)');
  {
    const H = [{ id: 1, capacity: 4 }, { id: 2, capacity: 4 }, { id: 3, capacity: 4 }];
    let m = LIFE.planHousing([{ id: 1, house_id: 1 }, { id: 2, house_id: 2 }], H, [[1, 2]]);
    check(m.length === 2 && m.every(x => x.house_id === 3), 'a new couple takes an empty house when there is one');
    m = LIFE.planHousing([{ id: 1, house_id: 1 }, { id: 2, house_id: 2 }, { id: 9, house_id: 3 }], H, [[1, 2]]);
    check(m.length === 1 && m[0].id === 2 && m[0].house_id === 1, "with no empty house, one moves into the other's home");
    m = LIFE.planHousing([{ id: 1, house_id: 1 }, { id: 2, house_id: 2 }], H);
    check(m.length === 0, 'housed citizens are never moved without a reason (a manual choice stays)');
    m = LIFE.planHousing([{ id: 1, house_id: 2, partner_id: 5 }, { id: 5, house_id: null, partner_id: 1 }], H);
    check(m.length === 1 && m[0].house_id === 2, 'an unhoused citizen joins their partner');
    m = LIFE.planHousing([{ id: 1, house_id: 2 }, { id: 2, house_id: 3 }, { id: 7, house_id: null, life_stage: 'child', parent_ids: [2] }], H);
    check(m.length === 1 && m[0].house_id === 3, 'an unhoused child joins a parent');
    m = LIFE.planHousing([{ id: 1, house_id: 2 }, { id: 8, house_id: null }], H);
    check(m.length === 1 && m[0].house_id === 2, 'a single settles where someone already lives, keeping empty houses for couples');
    m = LIFE.planHousing([{ id: 3, house_id: null, partner_id: 4 }, { id: 4, house_id: null, partner_id: 3 }, { id: 9, house_id: 1 }], H);
    check(m.length === 2 && m[0].house_id === m[1].house_id && m[0].house_id !== 1, 'an unhoused couple moves into an empty house together');
    const crowd = Array.from({ length: 14 }, (_, i) => ({ id: 100 + i, house_id: null }));
    m = LIFE.planHousing(crowd, H);
    check(m.length === 12, 'never more people than beds (12 beds, 14 people: 2 stay unhoused)');
  }

  // ── Against the database and the running API ─────────────────────────────
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const q = (t, p) => pool.query(t, p);
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const username = `life_${RUN}`;
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
  const tq = -90000 - Math.floor(Math.random() * 5000) * 20;
  const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, population, timber, stone)
                      VALUES ($1,$2,2,'camp',$3,0,NOW(),10,500,500) RETURNING id`, [u.id, username, tq])).rows[0];
  const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
  const api = async (method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const cit = async (name, over = {}) => (await q(
    `INSERT INTO citizens (settlement_id, name, gender, role, house_id, partner_id, parent_ids, life_stage)
     VALUES ($1,$2,$3,'idle',$4,$5,$6,$7) RETURNING id`,
    [s.id, name, over.gender || 'female', over.house_id || null, over.partner_id || null, JSON.stringify(over.parent_ids || []), over.life_stage || 'adult'])).rows[0].id;

  console.log('Population follows the living');
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await cit('Folk' + i));
  check(await LIFE.recount(s.id) === 3, 'recount sets population to the living count (was a stored 10)');
  let ti = await api('GET', '/api/game/tier-info');
  check(ti.status === 200 && ti.body.requirementsMet.current.population === 3, 'tier info reads the live count');
  let st = await api('GET', '/api/game/settlement');
  check(st.status === 200 && st.body.settlement.population === 3 && st.body.settlement.beds === 0, 'the settlement shows live population and beds (no huts yet: 0)');

  console.log('Building a hut: 4 beds, and the homeless move in');
  const br = await api('POST', '/api/buildings/build', { buildingId: 'starter_house' });
  const hut = (await q('SELECT id, capacity FROM houses WHERE settlement_id = $1', [s.id])).rows;
  check(br.status === 200 && hut.length === 1 && hut[0].capacity === 4, 'a new Willow Hut holds 4');
  const housed = (await q('SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1 AND house_id = $2', [s.id, hut[0].id])).rows[0].n;
  check(housed === 3, 'the three unhoused citizens moved in by themselves');
  const happy = (await q("SELECT (life->>'happiness')::int AS h FROM citizens WHERE id = $1", [ids[0]])).rows[0].h;
  check(happy === 80, 'moving in gives the usual happiness lift (70 → 80)');
  st = await api('GET', '/api/game/settlement');
  check(st.body.settlement.beds === 4, 'beds: 4');

  console.log('Death frees the bed');
  await require('../deaths').writeDeathEvent({ citizenId: ids[0], settlementId: s.id, cause: 'combat', narrative: 'fell.' });
  const dead = (await q('SELECT house_id, life_stage FROM citizens WHERE id = $1', [ids[0]])).rows[0];
  check(dead.life_stage === 'deceased' && dead.house_id === null, 'the dead citizen no longer holds a place in the house');
  check((await q('SELECT population FROM settlements WHERE id = $1', [s.id])).rows[0].population === 2, 'and the population drops to 2');
  const hs = await api('GET', '/api/housing');
  check(hs.body.houses[0].residents.length === 2 && !hs.body.unhoused.some(c => c.id === ids[0]), 'the housing screen lists only the living');
  const newcomer = await cit('Newcomer');
  const asg = await api('POST', '/api/housing/assign', { citizen_id: newcomer, house_id: hut[0].id });
  check(asg.status === 200, 'the freed place can be filled (3 living in a hut of 4)');

  console.log('The real simulation: a couple in separate houses has a child');
  // A second hut; put a couple in different houses and run an hour of catch-up.
  await api('POST', '/api/buildings/build', { buildingId: 'starter_house' });
  const huts = (await q('SELECT id FROM houses WHERE settlement_id = $1 ORDER BY id', [s.id])).rows.map(r => r.id);
  const mum = await cit('Mum', { gender: 'female', house_id: huts[0] });
  const dad = await cit('Dad', { gender: 'male', house_id: huts[1] });
  await q('UPDATE citizens SET partner_id = $1 WHERE id = $2', [dad, mum]);
  await q('UPDATE citizens SET partner_id = $1 WHERE id = $2', [mum, dad]);
  await q("UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{happiness}', '95') WHERE settlement_id = $1", [s.id]);
  const before = await LIFE.livingCount(s.id);
  const orig = Math.random; Math.random = () => 0;
  try {
    const last = new Date(Date.now() - 1.2 * 3600e3);
    await q('UPDATE settlements SET last_sim_tick = $1 WHERE id = $2', [last, s.id]);
    await SIM.runSimulation({ id: s.id }, 1.2, (await q('SELECT last_sim_tick FROM settlements WHERE id = $1', [s.id])).rows[0].last_sim_tick);
  } finally { Math.random = orig; }
  const kids = (await q("SELECT id, house_id, parent_ids FROM citizens WHERE settlement_id = $1 AND life_stage = 'child'", [s.id])).rows;
  check(kids.length >= 1, 'a child was born although the parents live apart');
  check(kids.every(k => huts.includes(k.house_id)), 'and was housed');
  const pop = (await q('SELECT population FROM settlements WHERE id = $1', [s.id])).rows[0].population;
  check(pop === before + kids.length, 'the population went up with the births');
  const beds = await LIFE.beds(s.id);
  check(beds.living <= beds.beds, `the town is never overfilled (${beds.living}/${beds.beds})`);

  console.log('Migration for existing towns');
  const oldHouse = (await q("INSERT INTO houses (settlement_id, name, building_type, capacity) VALUES ($1, 'Old Hut', 'starter_house', 2) RETURNING id", [s.id])).rows[0].id;
  const ghost = await cit('Ghost', { life_stage: 'deceased', house_id: oldHouse });
  await q('UPDATE settlements SET population = 10 WHERE id = $1', [s.id]);
  const fs = require('fs'), path = require('path');
  const file = fs.readdirSync(path.join(__dirname, '..', 'migrations')).find(f => f.endsWith('_life_beds.sql'));
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');
  await q(sql); await q(sql);
  check((await q('SELECT capacity FROM houses WHERE id = $1', [oldHouse])).rows[0].capacity === 4, 'old huts of 2 now hold 4');
  check((await q('SELECT house_id FROM citizens WHERE id = $1', [ghost])).rows[0].house_id === null, 'the dead are taken out of their houses');
  check((await q('SELECT population FROM settlements WHERE id = $1', [s.id])).rows[0].population === await LIFE.livingCount(s.id), 'the stuck population is set to the living count');

  await pool.end();
}

main().catch(e => { failed++; console.error(e); }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
