// scripts/balance_test.js — Dev Tools career balance (overview + live
// tuning), Stonemason building discounts and Night Worker output.
//
// Part 1 is pure. Part 2 uses the database and a running server over HTTP
// against the same DATABASE_URL. Throwaway databases only.
//
//   node scripts/balance_test.js
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/balance_test.js

'use strict';

const M = require('../lib/career_math');
const C = require('../lib/careers/classes');
const P = require('../lib/careers/profiles');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}

function part1() {
  console.log('Stonemason & Night Workers');
  check(M.EFFECTS.build_cost && M.EFFECTS.build_cost.min === -0.2 && M.EFFECTS.build_cost.max === 0, 'build_cost effect: up to −20%');
  const tree = JSON.stringify(C.CLASSES.miner.tree);
  check(/"id":"miner.master_mason"[^}]*"type":"build_cost"/.test(tree) || C.CLASSES.miner.tree.find(n => n.id === 'miner.master_mason').effects.some(e => e.type === 'build_cost'), 'Master Mason cuts building costs');
  check(C.CLASSES.miner.tree.filter(n => n.branch === 'stonemason' && n.effects.some(e => e.type === 'build_cost')).length >= 3, 'the Stonemason path has several building-cost perks');
  const cit = (id, traits) => ({ id, name: 'N' + id, role: 'farmer', stats: { strength: 8, agility: 8, endurance: 8, intelligence: 8, charisma: 8 }, visible_traits: traits });
  const { byId } = P.buildProfiles([cit(1, []), cit(2, ['night_worker'])], [], [], {});
  const a = byId.get(1).outputMult, b = byId.get(2).outputMult;
  check(Math.abs(b / a - (1 + P.NIGHT_WORKER_BONUS * P.NIGHT_SHARE)) < 0.01, `a Night Worker produces ~${Math.round(P.NIGHT_WORKER_BONUS * P.NIGHT_SHARE * 100)}% more (a third of their hours at +25%)`);
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const careers = require('../lib/careers');
  const BASE = process.env.CRAFTING_TEST_BASE || process.env.CAREERS_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.BALANCE_TEST_ADMIN_ID || process.env.CRAFTING_TEST_ADMIN_ID) || null;
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function user(name, buildings = [], forceId = null) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET username = users.username RETURNING id", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    let s = (await q('SELECT * FROM settlements WHERE user_id = $1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, wealth, food, timber, stone, metal, last_tick) VALUES ($1,$2,2,5000,5000,5000,5000,5000,NOW()) RETURNING *`, [u.id, username])).rows[0];
    for (const [type, level] of buildings) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,$3)', [s.id, type, level]);
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  async function citizen(p, role, name) {
    return (await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, career_settled_at)
                     VALUES ($1,$2,$3,'{"strength":8,"agility":8,"endurance":8,"intelligence":8,"charisma":8}','{}','{"happiness":60,"hunger":20}','adult','[]','[]',NOW()) RETURNING id`,
      [p.sid, name, role])).rows[0].id;
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  console.log('Stonemason discount');
  const t = await user('mason', [['mine', 2]]);
  let r = await api(t, 'GET', '/api/buildings');
  const lib0 = r.body.buildings.find(b => b.id === 'library');
  check(!lib0.discount, 'no Stonemason: full price');
  const m = await citizen(t, 'miner', 'Gritt');
  await careers.adminGrant(t.sid, m, 'miner', { level: 20 });
  await q("UPDATE citizen_classes SET spec = 'stonemason', nodes = $2 WHERE citizen_id = $1 AND class_key = 'miner'", [m, JSON.stringify({ 'miner.dressed_stone': 2, 'miner.steady_chisel': 2 })]);
  r = await api(t, 'GET', '/api/buildings');
  const lib1 = r.body.buildings.find(b => b.id === 'library');
  const pct = 0.04 + 0.04 + 0.08;
  check(lib1.discount && lib1.discount[0].label === 'Stonemason Gritt' && Math.abs(lib1.discount[0].pct + pct) < 1e-9, `a Lv20 Stonemason: −${Math.round(pct * 100)}%, named`);
  check(lib1.cost.timber === Math.ceil(lib0.cost.timber * (1 - pct)), `the cost shown is already reduced (${lib0.cost.timber} → ${lib1.cost.timber} timber)`);
  await require('../lib/research').adminComplete(t.sid, 'record_keeping');
  await require('../lib/research').adminComplete(t.sid, 'engineering');
  r = await api(t, 'GET', '/api/buildings');
  const lib2 = r.body.buildings.find(b => b.id === 'library');
  check(lib2.cost.timber === Math.ceil(lib0.cost.timber * 0.8) && lib2.discount.length === 2, 'with Engineering too, the total is capped at −20%');
  const w0 = Number((await q('SELECT timber FROM settlements WHERE id=$1', [t.sid])).rows[0].timber);
  r = await api(t, 'POST', '/api/buildings/build', { buildingId: 'library' });
  const w1 = Number((await q('SELECT timber FROM settlements WHERE id=$1', [t.sid])).rows[0].timber);
  check(r.status === 200 && w0 - w1 === lib2.cost.timber, 'building charges the discounted price');

  if (ADMIN) {
    console.log('Dev Tools: balance & tuning');
    const adm = await user('baladm', [], ADMIN);
    r = await api(adm, 'GET', '/api/careers/admin/balance');
    check(r.status === 200 && r.body.classes.some(c => c.key === 'scholar') && r.body.classes.some(c => c.key === 'smelter') && !r.body.classes.some(c => c.key === 'crafter'),
      'the overview lists every current class (Scholar and Smelter included, retired ones not)');
    const miner = r.body.classes.find(c => c.key === 'miner');
    check(miner && miner.levels.length === 20 && miner.levels[19] >= 1 && miner.forks.stonemason >= 1, 'levels 1–20 and forks per class');
    check(Array.isArray(r.body.crafting.days) && typeof r.body.discoveries.recipes === 'number' && typeof r.body.research.finished_7d === 'number' && r.body.research.finished_7d >= 2,
      'crafts per day, discoveries and research for the last week');
    check(r.body.tuning.length === 5 && r.body.tuning.every(x => x.value === 1 || typeof x.value === 'number'), 'five tuning multipliers');
    const lib = await user('tunelib', [['library', 1]]);
    await citizen(lib, 'scholar', 'Ink');
    const base = (await require('../lib/research').scholarsOf(lib.sid, 'prospecting')).perHour;
    r = await api(adm, 'POST', '/api/careers/admin/tuning', { key: 'research', value: 2 });
    check(r.status === 200 && r.body.tuning.find(x => x.key === 'research').value === 2, 'save research ×2');
    // This process has its own cache: refresh it as the server's save did.
    await require('../lib/tuning').refresh();
    const twice = (await require('../lib/research').scholarsOf(lib.sid, 'prospecting')).perHour;
    check(Math.abs(twice - base * 2) < 0.15, `research points double (${base} → ${twice}/hr)`);
    r = await api(adm, 'POST', '/api/careers/admin/tuning', { key: 'research', value: 9 });
    check(r.status === 400, 'values stay within 0–5');
    r = await api(adm, 'POST', '/api/careers/admin/tuning', { key: 'nonsense', value: 1 });
    check(r.status === 400, 'unknown keys are refused');
    await api(adm, 'POST', '/api/careers/admin/tuning', { key: 'research', value: 1 });
    // (User id 1 is an admin on test servers — on a fresh database that can be the first town made.)
    let pl = await user('player');
    if (pl.id === 1) pl = await user('player');
    r = await api(pl, 'GET', '/api/careers/admin/balance');
    check(r.status === 403, 'players can\'t see the overview');
  } else console.log('  (admin checks skipped — set CRAFTING_TEST_ADMIN_ID)');

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
