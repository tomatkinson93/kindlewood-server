// milestones_test — the new-player funnel (lib/milestones, GET /api/funnel).
//   DATABASE_URL=postgres://… TRAVEL_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/milestones_test.js
'use strict';
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ', m); } else { failed++; console.log('  FAIL', m); } };

function part1() {
  const M = require('../lib/milestones');
  console.log('Rules');
  const hit = (m, p) => (M.RULES.find(([mm, re]) => mm === m && re.test(p)) || [])[2];
  check(hit('POST', '/api/buildings/build') === 'first_building' && hit('PATCH', '/api/citizens/42/role') === 'first_job' && hit('POST', '/api/quests/collect/abc') === 'first_quest_collected',
    'building, a job change and collecting a quest are steps');
  check(hit('POST', '/api/game/outposts/build') === 'first_outpost' && hit('POST', '/api/game/outposts/5/haul') === undefined && hit('GET', '/api/buildings/build') === undefined, 'only the exact request counts');
  check(M.STEPS[0][0] === 'registered' && M.STEPS.some(s => s[0] === 'return_d1') && M.STEPS.some(s => s[0] === 'first_birth'), 'the funnel runs from registering to coming back');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const M = require('../lib/milestones');
  const BASE = process.env.TRAVEL_TEST_BASE || process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID || 0);
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  const api = async (tok, method, pth, body) => { const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const have = async id => (await q('SELECT key FROM player_milestones WHERE user_id=$1', [id])).rows.map(r => r.key);

  console.log('Recording');
  const name = 'mile_' + RUN;
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [name, name + '@t.l'])).rows[0];
  const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, last_tick, tile_q, tile_r) VALUES ($1,$2,2,'camp',5000,5000,5000,5000,5000,NOW(),-61000,-61000) RETURNING id`, [u.id, name])).rows[0];
  const tok = jwt.sign({ userId: u.id, username: name, species: 'Mice' }, SECRET);
  await api(tok, 'GET', '/api/game/settlement'); await wait(300);
  check((await have(u.id)).join() === 'seen', 'loading the game: seen (and nothing else yet)');
  const c = (await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, life_stage) VALUES ($1,'Pip','female','idle','{}','adult') RETURNING id`, [s.id])).rows[0];
  let r = await api(tok, 'PATCH', `/api/citizens/${c.id}/role`, { role: 'forager' }); await wait(300);
  check(r.status === 200 && (await have(u.id)).includes('first_job'), 'a job change is recorded');
  r = await api(tok, 'PATCH', `/api/citizens/999999999/role`, { role: 'forager' }); await wait(200);
  const before = (await q('SELECT reached_at FROM player_milestones WHERE user_id=$1 AND key=$2', [u.id, 'first_job'])).rows[0].reached_at;
  await api(tok, 'PATCH', `/api/citizens/${c.id}/role`, { role: 'idle' }); await wait(300);
  const after = (await q('SELECT reached_at FROM player_milestones WHERE user_id=$1 AND key=$2', [u.id, 'first_job'])).rows[0].reached_at;
  check(r.status >= 400 && +before === +after, 'a failed request records nothing; a repeat keeps the first time');
  await q("UPDATE users SET created_at = NOW() - interval '2 days' WHERE id=$1", [u.id]);
  M._reset();
  await M.seen(u.id);
  check((await have(u.id)).includes('return_d1') && !(await have(u.id)).includes('return_d7'), 'back after a day: return_d1, not yet return_d7');
  await M.birth(s.id);
  check((await have(u.id)).includes('first_birth'), 'a birth is recorded for the town\'s owner');

  console.log('Reading');
  const f = await M.funnel(30);
  const step = k => f.steps.find(x => x.key === k);
  check(f.players >= 1 && step('registered').players === f.players && step('first_job').players >= 1 && step('first_job').pct > 0 && step('first_job').median_minutes != null, 'the funnel counts players per step, with a share and a median time');
  if (ADMIN) {
    await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO NOTHING", [ADMIN, 'adm_' + RUN, 'adm_' + RUN + '@t.l']);
    r = await api(jwt.sign({ userId: ADMIN, username: 'adm', species: 'Mice' }, SECRET), 'GET', '/api/funnel?days=7');
    check(r.status === 200 && r.body.days === 7 && Array.isArray(r.body.steps) && r.body.steps.length === M.STEPS.length, 'GET /api/funnel for admins');
  }
  check((await api(tok, 'GET', '/api/funnel')).status === 403, 'not for players');
  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) { try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); } }
  else console.log('\n(Part 2 skipped — set DATABASE_URL and TRAVEL_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
