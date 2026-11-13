// ══════════════════════════════════════════════════════════════════════════
//  life_test — the life cycle (docs/PHASE_1_LIFE_CYCLE.md).
//  Step 1: houses hold 4, births need a free bed in town, the population
//  follows the living, the kin rule, housing sorts itself, the dead free
//  their bed. Step 2: ages from born_at, stages, death chance, fertility and
//  the gap between children, families, the migration for existing towns.
//  Step 3: apprenticeships and mentors, youth XP and output, elders at 60%,
//  coming of age.
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
  const mk = (id, over = {}) => Object.assign({ id, name: 'C' + id, gender: id % 2 ? 'male' : 'female', life_stage: 'adult', house_id: 1, born_at: LIFE.bornAtFor(30, T0),
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
      // A second couple, both in the full Oak (one baby per couple: the two-year gap).
      const c = mk(5, { partner_id: 6, house_id: 1 }), d = mk(6, { partner_id: 5, house_id: 1 });
      const sim = { pairs: [[a, b], [c, d]], rels: {}, houses, freeBeds: 2, newPartners: [], events: [], births: [] };
      for (let h = 0; h < 10; h++) SIM._hourly.breeding(sim, { ...ctx, at: T0 + h * 3600e3 });
      check(sim.births.length === 2, 'couples in different houses have children while the town has beds (2 free → 2 births, then none)');
      check(sim.births[0].house.id === 2, "the first baby sleeps in a parent's house with room (Ash, not the full Oak)");
      check(sim.births[1].house.id === 3, 'when both parents\' houses are full, the baby goes to a house with room');
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

  console.log('Ages and stages (step 2)');
  {
    const Y = LIFE.YEAR_MS, now = Date.UTC(2026, 5, 1);
    const at = (age, stored) => ({ born_at: new Date(now - age * Y), life_stage: stored || (age < 12 ? 'child' : 'adult') });
    check(Y === 28 * 3600e3 && Math.abs(LIFE.ageOf(at(30), now) - 30) < 1e-9, 'one game year is 28 real hours; age is time since born_at');
    check(LIFE.ageOf({ life: { age: 22 } }, now) === 22, 'without a born_at, the old stored age (until the migration runs)');
    const st = [[0, 'child'], [6.99, 'child'], [7, 'youth'], [11.99, 'youth'], [12, 'adult'], [59.99, 'adult'], [60, 'elder'], [90, 'elder']]
      .map(([a, want]) => LIFE.stageOf(at(a), now) === want);
    check(st.every(Boolean), 'stages: child 0–6, youth 7–11, adult 12–59, elder 60+');
    check(LIFE.stageOf(at(13, 'child'), now) === 'youth', 'a stored child stays a child or youth until it comes of age (step 3)');
    check(LIFE.stageOf({ ...at(40), life_stage: 'deceased' }, now) === 'deceased', 'the dead are deceased at any age');
    check(LIFE.deathChance(69) === 0 && Math.abs(LIFE.deathChance(70) - 0.06) < 1e-9 && Math.abs(LIFE.deathChance(80) - 0.36) < 1e-9 && LIFE.deathChance(120) === 0.6,
      'death chance: none before 70, 6% at 70, +3% a year, at most 60%');
    check(!LIFE.fertile(at(13.9), now) && LIFE.fertile(at(14), now) && LIFE.fertile(at(55.5), now) && !LIFE.fertile(at(56), now) && !LIFE.fertile(at(30, 'child'), now),
      'fertile: adults aged 14 to 55');
    const m = { gender: 'male', ...at(30) }, f = { gender: 'female', ...at(30) };
    check(LIFE.birthBlockers(m, f, { children: 1, lastChildAt: now - 3 * Y }, now).length === 0, 'a couple of 30 with one child three years old can have another');
    check(LIFE.birthBlockers(m, f, { children: 1, lastChildAt: now - 1 * Y }, now).some(b => /very young/.test(b)), 'not within two years of their last child');
    check(LIFE.birthBlockers(m, f, { children: 4 }, now).some(b => /4 children/.test(b)), 'not after four children');
    check(LIFE.birthBlockers(m, { gender: 'female', ...at(58) }, {}, now).some(b => /14–55/.test(b)), 'not if either partner is past 55');
    check(Math.abs(LIFE.ageOf({ born_at: LIFE.bornAtFor(25, now) }, now) - 25) < 1e-9, 'bornAtFor gives the born_at for an age');
  }

  console.log('Births follow the age rules (step 2)');
  {
    const orig = Math.random; Math.random = () => 0;
    try {
      const a = mk(1, { partner_id: 2 }), b = mk(2, { partner_id: 1 });
      const sim = { pairs: [[a, b]], rels: {}, houses: { 1: { id: 1, capacity: 20, occupants: 2 } }, freeBeds: 18, couples: {}, newPartners: [], events: [], births: [] };
      for (let h = 0; h < 200; h++) SIM._hourly.breeding(sim, { ...ctx, at: T0 + h * 3600e3 });
      const gaps = sim.births.slice(1).map((x, i) => (x.at - sim.births[i].at) / LIFE.YEAR_MS);
      check(sim.births.length === 4 && gaps.every(g => g >= 2), `with beds to spare: four children, two years apart (${sim.births.length}; gaps ${gaps.map(g => g.toFixed(1)).join(', ')})`);
      const old = mk(3, { partner_id: 4, born_at: LIFE.bornAtFor(57, T0) }), young = mk(4, { partner_id: 3 });
      const s2 = { pairs: [[old, young]], rels: {}, houses: { 1: { id: 1, capacity: 20, occupants: 2 } }, freeBeds: 18, couples: {}, newPartners: [], events: [], births: [] };
      for (let h = 0; h < 10; h++) SIM._hourly.breeding(s2, { ...ctx, at: T0 + h * 3600e3 });
      check(s2.births.length === 0, 'no births when a partner is past 55');
    } finally { Math.random = orig; }
  }

  console.log('Youths and elders (step 3, pure)');
  {
    const Y = LIFE.YEAR_MS, now = Date.UTC(2026, 6, 1);
    const ad = (id, role, over = {}) => ({ id, name: 'A' + id, role, life_stage: 'adult', born_at: new Date(now - 30 * Y), ...over });
    const kid = (id, age, over = {}) => ({ id, name: 'K' + id, life_stage: 'child', born_at: new Date(now - age * Y), parent_ids: [1, 2], ...over });
    const town = [ad(1, 'farmer'), ad(2, 'miner', { name: 'Moss' }),
      kid(3, 8), kid(4, 9, { apprentice_class: 'miner' }), kid(5, 10, { apprentice_class: 'miner' }), kid(6, 11, { apprentice_class: 'miner' }), kid(7, 4)];
    const A = LIFE.apprenticeships(town, [], now);
    check(A.get(3).classKey === 'farmer' && !A.get(3).chosen, "a youth with no choice follows a parent's trade");
    check(A.get(4).classKey === 'miner' && A.get(4).chosen, 'a chosen trade is kept');
    const mentored = [4, 5, 6].filter(id => A.get(id).mentorId === 2);
    check(mentored.length === 2 && A.get(6).mentorId === null && A.get(6).rate === 0.5, 'one mentor teaches two youths at most; the third learns at half the rate');
    check(A.get(4).rate === 1 && A.get(4).mentorName === 'Moss', 'a mentored youth learns at the full rate');
    check(!A.has(7), 'a child under 7 is not an apprentice');
    const picked = LIFE.apprenticeships([...town.slice(0, 2), ad(8, 'miner', { name: 'Flint' }), kid(4, 9, { apprentice_class: 'miner', mentor_id: 8 })], [], now);
    check(picked.get(4).mentorId === 8, 'a chosen mentor in that trade is honoured');
    const idleParents = LIFE.apprenticeships([ad(1, 'idle'), ad(2, 'idle'), kid(3, 8)], [], now);
    check(idleParents.get(3).classKey === null && idleParents.get(3).rate === 0, 'no trade (parents idle): nothing learned until one is chosen');
    check(/restless/.test(LIFE.aptitudeHint({ hidden_traits: ['claustrophobic'] }, 'miner')) && /born to it/.test(LIFE.aptitudeHint({ hidden_traits: ['stone_sense'] }, 'miner'))
      && LIFE.aptitudeHint({ hidden_traits: [] }, 'miner') === null, 'a hidden dislike or knack for the trade shows as a hint');

    const P = require('../lib/careers/profiles');
    const base = { role: 'miner', stats: { strength: 10, agility: 10, endurance: 10, intelligence: 10, charisma: 10 }, skills: {}, visible_traits: [], hidden_traits: [], earned_traits: [], parent_ids: [] };
    const prof = P.buildProfiles([{ ...base, id: 1, born_at: new Date(now - 30 * Y) }, { ...base, id: 2, born_at: new Date(now - 65 * Y) }], [], [], { now }).byId;
    check(prof.get(2).elder && !prof.get(1).elder && Math.abs(prof.get(2).outputMult / prof.get(1).outputMult - 0.6) < 0.01, 'an elder works at 60% of the same adult');

    const B = require('../buildings');
    const workers = [{ id: 1, role: 'farmer', profile: null }];
    const plain = B.calculateRates([], workers, 'Mice');
    const withYouth = Object.assign([...workers], { youths: [{ id: 9, role: 'miner', youth: true, profile: { outputMult: 0.25, effects: {} } }] });
    const more = B.calculateRates([], withYouth, 'Mice');
    check(Math.abs((more.stone - plain.stone) - 0.75) < 0.01 && Math.abs((more.metal - plain.metal) - 0.5) < 0.01, "a youth miner adds a quarter of an adult miner's output (stone 3 → 0.75, metal 2 → 0.5)");
    const bd = B.calculateRatesBreakdown([], withYouth, 'Mice');
    check(bd.stone.sources.some(x => x.kind === 'citizen_youth') && Math.abs(bd.stone.total - more.stone) < 0.01, 'the resource breakdown shows the youths and still adds up');

    const F = require('../famine');
    if (typeof F.upkeepPerHour === 'function') {
      const up = c => F.upkeepPerHour({ role: 'idle', visible_traits: [], ...c });
      check(up({ life_stage: 'adult', born_at: new Date(Date.now() - 65 * Y) }) === 0.75 && up({ life_stage: 'child', born_at: new Date(Date.now() - 9 * Y) }) === 0.5
        && up({ life_stage: 'adult', born_at: new Date(Date.now() - 30 * Y) }) === 1, 'upkeep: elders 0.75, youths eat as children, adults 1');
    } else check(false, 'famine exports upkeepPerHour');
    const H = require('../happiness').calculateHappinessFactors;
    const hf = H({ house_id: 1, role: 'farmer', life: {} }, { elderInHouse: 3 });
    check(hf.factors.some(f => /elder at home/.test(f.label) && f.value === 3), 'an elder at home is a happiness factor for the household');
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
    `INSERT INTO citizens (settlement_id, name, gender, role, house_id, partner_id, parent_ids, life_stage, born_at)
     VALUES ($1,$2,$3,'idle',$4,$5,$6,$7,$8) RETURNING id`,
    [s.id, name, over.gender || 'female', over.house_id || null, over.partner_id || null, JSON.stringify(over.parent_ids || []), over.life_stage || 'adult',
     LIFE.bornAtFor(over.age != null ? over.age : 30).toISOString()])).rows[0].id;

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
  await LIFE.assignFamilies(s.id);   // as arrival and the migration do for every citizen
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

  console.log('A child: born at its hour, in the smaller family line (step 2)');
  {
    const famRows = (await q('SELECT c.id, c.born_at, c.family_id, f.name AS fam, c.last_birthday_year FROM citizens c LEFT JOIN families f ON f.id = c.family_id WHERE c.id = $1', [kids[0].id])).rows[0];
    const parents = (await q('SELECT id, family_id, last_child_at FROM citizens WHERE id = ANY($1)', [[mum, dad]])).rows;
    check(famRows.born_at && Date.now() - new Date(famRows.born_at).getTime() < 3 * 3600e3 && famRows.last_birthday_year === 0, 'the child\'s born_at is the hour it was born');
    check(parents.every(p => p.last_child_at), 'both parents remember when their last child was born');
    check(famRows.family_id && parents.some(p => p.family_id === famRows.family_id), "the child is in one of its parents' families");
  }

  console.log('The citizens API shows age and stage (step 2)');
  {
    await q('UPDATE citizens SET born_at = $1 WHERE id = $2', [LIFE.bornAtFor(64).toISOString(), ids[1]]);
    await q("UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{age}', '19') WHERE id = $1", [ids[1]]);
    const cr = await api('GET', '/api/citizens');
    const elder = cr.body.citizens.find(c => c.id === ids[1]);
    check(cr.status === 200 && elder && elder.age === 64 && elder.stage === 'elder', 'an adult born 64 years ago is 64 and an elder');
    check(elder && elder.life.age === 64, 'life.age is the computed age, not the stored 19 (§4.1)');
    const kid = cr.body.citizens.find(c => c.id === kids[0].id);
    check(kid && kid.stage === 'child' && kid.age === 0, 'a newborn is a child of 0');
    const pm = cr.body.citizens.find(c => c.id === mum);
    check(pm && pm.breeding_status && !pm.breeding_status.blockers.includes('Not living together'), 'the "can they have a child" box no longer asks them to share a house');
    check(pm && pm.breeding_status && pm.breeding_status.blockers.some(b => /very young/.test(b)), 'it says their last child is still very young');
  }

  console.log('Coming of age and youth XP (step 3)');
  {
    await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1, 'mine', 1)", [s.id]);
    const miner = await cit('Flint Stonebrook', { gender: 'male' });
    await q("UPDATE citizens SET role = 'miner', stats = '{\"intelligence\":10}' WHERE id = $1", [miner]);
    const y1 = await cit('Wren Stonebrook', { life_stage: 'child', age: 9, parent_ids: [miner] });
    const y2 = await cit('Pip Stonebrook', { life_stage: 'child', age: 9, parent_ids: [miner] });
    const y3 = await cit('Bramble Stonebrook', { life_stage: 'child', age: 9, parent_ids: [miner] });
    await q("UPDATE citizens SET stats = '{\"intelligence\":10}', life = jsonb_build_object('happiness', 70), career_settled_at = NOW() - interval '10 hours' WHERE id = ANY($1)", [[y1, y2, y3]]);
    const ap = await api('POST', `/api/citizens/${y1}/apprentice`, { class: 'miner', mentor_id: miner });
    check(ap.status === 200 && ap.body.apprentice.class_key === 'miner' && ap.body.apprentice.mentor_id === miner, 'a youth takes up mining with Flint as mentor');
    check((await api('POST', `/api/citizens/${miner}/apprentice`, { class: 'miner' })).status === 400, 'an adult cannot become an apprentice');
    check((await api('POST', `/api/citizens/${y2}/apprentice`, { class: 'wizard' })).status === 400, 'an unknown trade is refused');
    check((await api('POST', `/api/citizens/${y2}/apprentice`, { class: 'farmer', mentor_id: miner })).status === 400, 'a mentor must work that trade');
    await require('../lib/careers').settle(s.id, { force: true });
    const xp = (await q("SELECT citizen_id, xp FROM citizen_classes WHERE class_key = 'miner' AND citizen_id = ANY($1)", [[y1, y2, y3]])).rows;
    const xpOf = id => Number((xp.find(r => r.citizen_id === id) || {}).xp) || 0;
    check(xpOf(y1) > 0 && xpOf(y2) > 0 && xpOf(y3) > 0, "youths earn XP in their trade (two chose nothing: their father's, mining)");
    check(xpOf(y3) > 0 && Math.abs(xpOf(y1) / xpOf(y3) - 2) < 0.15, `mentored youths learn about twice as fast as the one Flint has no room for (${xpOf(y1)} vs ${xpOf(y3)})`);
    const cr = await api('GET', '/api/citizens');
    const w = cr.body.citizens.find(c => c.id === y1);
    check(w && w.stage === 'youth' && w.apprentice && w.apprentice.class_key === 'miner' && w.apprentice.mentor_name === 'Flint Stonebrook', 'the citizens API shows the apprenticeship');

    await q('UPDATE citizens SET born_at = $1 WHERE id = $2', [LIFE.bornAtFor(12.2).toISOString(), y1]);
    const grown = await LIFE.comeOfAge(s.id);
    const row = (await q('SELECT life_stage, role, mentor_id FROM citizens WHERE id = $1', [y1])).rows[0];
    check(grown.length === 1 && row.life_stage === 'adult' && row.role === 'miner' && row.mentor_id === null, 'at 12 a youth comes of age in their trade');
    check(xpOf(y1) > 0 && Number((await q("SELECT xp FROM citizen_classes WHERE citizen_id = $1 AND class_key = 'miner'", [y1])).rows[0].xp) === xpOf(y1), 'and keeps the XP they earned');
    const chron = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'came_of_age' AND citizen_ids @> $2::jsonb", [s.id, JSON.stringify([y1])])).rows;
    const ev = (await q("SELECT message FROM settlement_events WHERE settlement_id = $1 AND type = 'came_of_age' AND citizen_ids @> $2::jsonb", [s.id, JSON.stringify([y1])])).rows;
    check(chron.length === 1 && /come of age/.test(chron[0].text) && ev.length === 1, 'one chronicle line and one event (a toast)');
    check((await LIFE.comeOfAge(s.id)).length === 0, 'it happens once');
    await q("UPDATE citizens SET born_at = $1, apprentice_class = 'farmer' WHERE id = $2", [LIFE.bornAtFor(12.5).toISOString(), y2]);
    await LIFE.comeOfAge(s.id);
    check((await q('SELECT role FROM citizens WHERE id = $1', [y2])).rows[0].role === 'forager', 'a trade the town has no building for becomes Forager');
  }

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

  console.log('Migration, step 2: ages and families');
  {
    const lc = fs.readFileSync(path.join(__dirname, '..', 'migrations', fs.readdirSync(path.join(__dirname, '..', 'migrations')).find(f => f.endsWith('_life_cycle.sql'))), 'utf8');
    const old1 = await cit('Hazel Oakbrook', { age: 0 }), old2 = await cit('Rowan Oakbrook', { age: 0 }), old3 = await cit('Pip Thistle', { age: 0 });
    await q("UPDATE citizens SET family_id = NULL, born_at = NOW(), last_birthday_year = NULL, life = jsonb_build_object('age', a.age) FROM (VALUES ($1::int, 30), ($2::int, 70), ($3::int, 20)) a(id, age) WHERE citizens.id = a.id", [old1, old2, old3]);
    await q("DELETE FROM migration_marks WHERE key = 'life_cycle_ages'");
    await q(lc); await q(lc);   // twice is the same as once
    const r = (await q('SELECT c.id, c.born_at, c.last_birthday_year, f.name AS fam FROM citizens c LEFT JOIN families f ON f.id = c.family_id WHERE c.id = ANY($1) ORDER BY c.id', [[old1, old2, old3]])).rows;
    const ageNow = row => LIFE.ageOf(row);
    check(Math.abs(ageNow(r[0]) - 30) < 0.1 && Math.abs(ageNow(r[2]) - 20) < 0.1, 'existing adults start ageing from their shown age');
    check(Math.abs(ageNow(r[1]) - 45) < 0.1, 'capped at 45, so nobody is suddenly elderly or dead');
    check(r.every(x => x.last_birthday_year === Math.floor(ageNow(x))), 'no death rolls owed for years before the life cycle');
    check(r[0].fam === 'Oakbrook' && r[1].fam === 'Oakbrook' && r[2].fam === 'Thistle', 'one family per surname in the town');
    const fams = (await q("SELECT COUNT(*)::int AS n FROM families WHERE settlement_id = $1 AND name = 'Oakbrook'", [s.id])).rows[0].n;
    check(fams === 1, 'running it again makes no duplicate families');
    await q("UPDATE citizens SET born_at = NOW() - interval '1 hour' WHERE id = $1", [old1]);
    await q(lc);
    check(Math.abs(LIFE.ageOf((await q('SELECT born_at FROM citizens WHERE id = $1', [old1])).rows[0]) - 1 / 28) < 0.01, 'the ageing part runs only once (a later boot leaves born_at alone)');
  }

  await pool.end();
}

main().catch(e => { failed++; console.error(e); }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
