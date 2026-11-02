// ══════════════════════════════════════════════════════════════════════════
//  first_steps_test — the new-town checklist (lib/first_steps, GET/POST
//  /api/game/first-steps).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/first_steps_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function main() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  const username = `steps_${RUN}`;
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
  const tq = -70000 - Math.floor(Math.random() * 5000) * 20;
  const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick) VALUES ($1,$2,2,'camp',$3,0,NOW()) RETURNING id`, [u.id, username, tq])).rows[0];
  const p = { token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  const api = async (method, pth) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  await q("INSERT INTO citizens (settlement_id, name, role) VALUES ($1,'Moss','forager')", [s.id]);
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'farm',1)", [s.id]);

  let x = await api('GET', '/api/game/first-steps');
  check(x.status === 200 && x.body.total === 7 && x.body.done === 0 && !x.body.dismissed, 'a new town: 7 steps, none done');
  check(x.body.steps.every(st => st.title && st.hint && st.show && st.icon), 'each step says what, how, and where to look');

  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'lumber_camp',1)", [s.id]);
  await q("UPDATE citizens SET role='woodcutter' WHERE settlement_id=$1", [s.id]);
  await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level) VALUES ($1,$2,0,'hills',1)", [s.id, tq + 1]);
  await q("INSERT INTO settlement_research (settlement_id, project) VALUES ($1,'agriculture')", [s.id]);
  x = await api('GET', '/api/game/first-steps');
  const done = Object.fromEntries(x.body.steps.map(st => [st.key, st.done]));
  check(done.lumber && done.jobs && done.outpost && done.research && !done.quest && !done.scout && !done.market && x.body.done === 4, 'steps tick off from what the town has done');

  x = await api('POST', '/api/game/first-steps/dismiss');
  check(x.status === 200, 'dismiss');
  x = await api('GET', '/api/game/first-steps');
  check(x.body.dismissed === true, '…and it stays dismissed');

  await q('DELETE FROM outposts WHERE settlement_id=$1', [s.id]);
  await pool.end();
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(skipped — set DATABASE_URL and QUEST_TEST_BASE)'); console.log('\n0 passed, 0 failed'); return; }
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
