// scripts/quest_collect_test.js — collecting a finished quest pays exactly once.
//
// Drives a running server over HTTP against the same DATABASE_URL.
// Throwaway databases only.
//
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/quest_collect_test.js

'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}

async function main() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function user(name) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, wealth, food, last_tick) VALUES ($1,$2,2,100,500,NOW()) RETURNING *`, [u.id, username])).rows[0];
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  async function api(p, method, path, body) {
    const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const wealth = async p => Number((await q('SELECT wealth FROM settlements WHERE id=$1', [p.sid])).rows[0].wealth);

  const qid = 'qtest_' + RUN;
  await q(`INSERT INTO quest_definitions (id, title, reward_gold, drops) VALUES ($1, 'Test Quest', 25, $2)`,
    [qid, JSON.stringify([{ item_key: 'iron_ore', quantity: 2 }, { item_key: 'iron_ore', quantity: 1 }, { name: 'Odd Pebble', icon: '🪨', quantity: 1 }])]);
  const a = await user('collector');
  const b = await user('stranger');
  const runOf = async (p, status) => (await q(
    `INSERT INTO settlement_quests (settlement_id, user_id, quest_id, status, completes_at, success_roll, success_chance)
     VALUES ($1,$2,$3,$4,NOW() - interval '1 minute', 0.1, 0.9) RETURNING id`, [p.sid, p.id, qid, status])).rows[0].id;

  console.log('Collecting');
  const done = await runOf(a, 'completed');
  const w0 = await wealth(a);
  const results = await Promise.all(Array.from({ length: 5 }, () => api(a, 'POST', `/api/quests/collect/${done}`)));
  const oks = results.filter(r => r.status === 200), refused = results.filter(r => r.status === 400 && /Already collected/.test(r.body.error));
  check(oks.length === 1 && refused.length === 4, `five taps at once: one payout, four "Already collected" (${results.map(r => r.status).join(',')})`);
  const paid = oks[0] ? oks[0].body.gold_awarded : NaN;
  check(paid > 0 && (await wealth(a)) === w0 + paid, `gold paid once (+${paid})`);
  const ore = (await q("SELECT quantity FROM inventory_items WHERE settlement_id=$1 AND item_key='iron_ore'", [a.sid])).rows;
  check(ore.length === 1 && ore[0].quantity === 3, 'drops stack into one pile (2 + 1 iron ore), once');
  const ore1 = (await q("SELECT category, icon FROM inventory_items WHERE settlement_id=$1 AND item_key='iron_ore'", [a.sid])).rows[0];
  const tpl = (await q("SELECT category, icon FROM item_templates WHERE item_key='iron_ore'")).rows[0];
  check(tpl && ore1.category === tpl.category && ore1.icon === tpl.icon, 'a drop with a template takes its template\'s fields');
  const peb = (await q("SELECT quantity, name FROM inventory_items WHERE settlement_id=$1 AND item_key='drop_odd_pebble'", [a.sid])).rows;
  check(peb.length === 1 && peb[0].quantity === 1 && peb[0].name === 'Odd Pebble', 'a drop without a template still arrives, once');
  check((await q('SELECT status FROM settlement_quests WHERE id=$1', [done])).rows[0].status === 'collected', 'the quest is marked collected');

  console.log('Refusals');
  const active = await runOf(a, 'active');
  let r = await api(a, 'POST', `/api/quests/collect/${active}`);
  check(r.status === 400 && /still in progress/.test(r.body.error), 'a quest still under way can\'t be collected');
  r = await api(b, 'POST', `/api/quests/collect/${done}`);
  check(r.status === 404, 'nobody else can collect your quest');
  const failedRun = await runOf(a, 'failed');
  const w1 = await wealth(a);
  r = await api(a, 'POST', `/api/quests/collect/${failedRun}`);
  check(r.status === 200 && r.body.gold_awarded === 0 && (await wealth(a)) === w1, 'a failed quest collects with nothing paid');

  await q('DELETE FROM quest_definitions WHERE id=$1', [qid]);
  await pool.end();
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('Set DATABASE_URL and QUEST_TEST_BASE.'); process.exit(0); }
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
