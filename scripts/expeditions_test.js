// ══════════════════════════════════════════════════════════════════════════
//  expeditions_test — calling a scout home (POST /api/expeditions/:id/recall).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/expeditions_test.js
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
  const X = -60000 - Math.floor(Math.random() * 5000) * 20;
  let seq = 0;
  async function player(name) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const tq = X + seq * 40;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',$3,0,NOW()) RETURNING id`, [u.id, username, tq])).rows[0];
    return { id: u.id, sid: s.id, q: tq, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const a = await player('scouter'), b = await player('other');
  const cit = (await q("INSERT INTO citizens (settlement_id, name, role) VALUES ($1,'Wren','scout') RETURNING id", [a.sid])).rows[0].id;
  const path = Array.from({ length: 11 }, (_, i) => ({ q: a.q + i, r: 0 }));
  const exp = (await q(`INSERT INTO expeditions (settlement_id, user_id, target_q, target_r, started_at, completes_at, path, citizen_id)
                         VALUES ($1,$2,$3,0, NOW() - interval '100 seconds', NOW() + interval '100 seconds', $4, $5) RETURNING id`,
    [a.sid, a.id, a.q + 10, JSON.stringify(path), cit])).rows[0].id;

  console.log('Recall');
  check((await api(b, 'POST', `/api/expeditions/${exp}/recall`)).status === 404, 'someone else can\'t call your scout home');
  const r = await api(a, 'POST', `/api/expeditions/${exp}/recall`);
  const e = r.body.expedition || {};
  const secs = (Date.parse(e.completes_at) - Date.now()) / 1000;
  check(r.status === 200 && e.recalled_at && e.target_q === a.q && e.target_r === 0, 'they turn for home');
  check(secs > 90 && secs < 110, `home in about as long as they were out (${Math.round(secs)}s)`);
  check(Array.isArray(e.path) && e.path.length === 6 && e.path[0].q === a.q + 5 && e.path[e.path.length - 1].q === a.q, 'walking back from halfway');
  check((await api(a, 'POST', `/api/expeditions/${exp}/recall`)).status === 400, 'only once');
  const busy = (await q("SELECT 1 FROM expeditions WHERE citizen_id=$1 AND status='travelling'", [cit])).rows.length;
  check(busy === 1, 'still away on the walk home');
  const tr = await api(a, 'GET', '/api/travel');
  const j = (tr.body.journeys || []).find(x => x.id === 'scout:' + exp);
  check(j && j.recalled && /Coming home/.test(j.title) && j.to.q === a.q, 'the map shows them coming home');

  console.log('Home again');
  await q("UPDATE expeditions SET completes_at = NOW() - interval '1 second' WHERE id=$1", [exp]);
  const list = await api(a, 'GET', '/api/expeditions');
  check(list.status === 200 && !(list.body.expeditions || []).some(x => x.id === exp), 'back home: no longer away');
  const free = (await q("SELECT 1 FROM expeditions WHERE citizen_id=$1 AND status='travelling'", [cit])).rows.length;
  check(free === 0, 'the scout is free');
  const seen = (await q('SELECT COUNT(*)::int AS n FROM fog_of_war WHERE user_id=$1', [a.id])).rows[0].n;
  check(seen === 0, 'nothing new revealed');
  check((await api(a, 'POST', `/api/expeditions/${exp}/recall`)).status === 404, 'nothing to recall once home');

  await pool.end();
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(skipped — set DATABASE_URL and QUEST_TEST_BASE)'); console.log('\n0 passed, 0 failed'); return; }
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
