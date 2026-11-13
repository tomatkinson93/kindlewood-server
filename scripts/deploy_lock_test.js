// ══════════════════════════════════════════════════════════════════════════
//  deploy_lock_test — reads made inside a transaction must not queue behind
//  a deploy's ALTER TABLE (2026-11-12/13: every deploy hung).
//
//  careers.settleIn locked a town's citizens, then loadState read citizens
//  through the pool. A booting server's ALTER TABLE citizens queued behind
//  the lock, the pool read queued behind the ALTER, and the transaction
//  waited on the read: a loop Postgres cannot see. This reproduces it.
//   DATABASE_URL=postgres://… node scripts/deploy_lock_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}
const within = (p, ms) => Promise.race([p.then(v => ({ ok: true, v })), new Promise(r => setTimeout(() => r({ ok: false }), ms))]);

async function main() {
  const { pool, withTransaction } = require('../db');
  const { Client } = require('pg');
  const careers = require('../lib/careers');
  const q = (t, p) => pool.query(t, p);
  const RUN = Math.random().toString(36).slice(2, 7);
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [`lock_${RUN}`, `lock_${RUN}@t.l`])).rows[0];
  const s = (await q("INSERT INTO settlements (user_id, name) VALUES ($1,$2) RETURNING id", [u.id, `lock_${RUN}`])).rows[0];
  for (let i = 0; i < 3; i++) await q("INSERT INTO citizens (settlement_id, name, role) VALUES ($1,$2,'farmer')", [s.id, 'Lock' + i]);

  // A separate connection plays the booting server.
  const deployer = new Client({ connectionString: process.env.DATABASE_URL });
  await deployer.connect();
  let alterDone = false, alterErr = null;

  console.log('Reads inside a locking transaction while a deploy waits for the table');
  const result = await within(withTransaction(async client => {
    // settleIn's claim: lock this town's citizen rows.
    await client.query('SELECT id FROM citizens WHERE settlement_id = $1 FOR UPDATE', [s.id]);
    // The deploy arrives and queues for the whole table.
    deployer.query("ALTER TABLE citizens ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'male'")
      .then(() => { alterDone = true; }, e => { alterErr = e; });
    await new Promise(r => setTimeout(r, 300));
    const waiting = (await client.query(
      "SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'ALTER TABLE citizens%'")).rows[0].n;
    check(waiting >= 1, 'the ALTER TABLE is queued behind the transaction');
    // The reads settleIn makes while holding the lock.
    const state = await careers.loadState(client, s.id);
    const away = await careers.awayMap(client, s.id);
    const wf = await careers.loadWorkforce(client, s.id);
    return { state, away, wf };
  }), 8000);

  check(result.ok, 'loadState, awayMap and loadWorkforce with the transaction client finish (no deadlock)');
  if (result.ok) {
    check(result.v.state.citizens.length === 3 && result.v.away instanceof Map && result.v.wf.length === 3, 'and return the town as usual');
  }
  await new Promise(r => setTimeout(r, 500));
  check(alterDone && !alterErr, 'once the transaction commits, the deploy\'s ALTER goes through');

  console.log('Optional reads cannot abort the caller\'s transaction');
  const opt = await within(withTransaction(async client => {
    await client.query('ALTER TABLE shop_keepers RENAME TO shop_keepers_hidden');   // an old database without it
    const st = await careers.loadState(client, s.id);
    const after = (await client.query('SELECT 1 AS one')).rows[0].one;           // would fail if aborted
    await client.query('ALTER TABLE shop_keepers_hidden RENAME TO shop_keepers');
    return { keepers: st.keepers.length, after };
  }), 8000);
  check(opt.ok && opt.v.keepers === 0 && opt.v.after === 1, 'a missing optional table reads as empty and the transaction carries on');

  console.log('Outside a transaction nothing changed');
  const plain = await careers.loadState(null, s.id);
  check(plain.citizens.length === 3, 'loadState(null, sid) still reads through the pool');

  if (!result.ok) {
    // Deadlocked: free the database for whoever runs next, then leave.
    try { await new Client({ connectionString: process.env.DATABASE_URL }).connect().then(async c => {
      await c.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database() AND (query LIKE 'ALTER TABLE citizens%' OR state LIKE 'idle in transaction%')");
      await c.end();
    }); } catch (_) {}
    return;
  }
  await deployer.end();
  await pool.end();
}

main().catch(e => { failed++; console.error(e); }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
