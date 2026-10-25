// scripts/prepare_test_db.js — bring a throwaway test database up to date.
//
// db.js applies migrations/0NN_*.sql on boot, but some older columns are
// still only added by the admin endpoint POST /api/game/migrate (diplomacy
// pending_action, famine last_consumption_at / consumption_carry, …). A
// fresh test database without them makes several suites fail for reasons
// that have nothing to do with the change under test. Run this once after
// the server is up:
//
//   PREPARE_TEST_BASE=http://localhost:3999 PREPARE_TEST_ADMIN_ID=990001 node scripts/prepare_test_db.js
//
// The admin id must be in the server's ADMIN_USER_IDS.

'use strict';

const jwt = require('jsonwebtoken');
const BASE = process.env.PREPARE_TEST_BASE || 'http://localhost:3000';
const ADMIN = Number(process.env.PREPARE_TEST_ADMIN_ID || 0);
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

(async () => {
  if (!ADMIN) { console.error('Set PREPARE_TEST_ADMIN_ID (an id in the server\'s ADMIN_USER_IDS).'); process.exit(1); }
  const token = jwt.sign({ userId: ADMIN, username: 'test-admin', species: 'Mice' }, SECRET);
  const r = await fetch(BASE + '/api/game/migrate', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  const body = await r.json().catch(() => ({}));
  const results = body.results || [];
  const errs = results.filter(x => /^ERR/.test(x));
  console.log(`migrate: ${r.status} — ${results.length - errs.length} ok, ${errs.length} errors`);
  errs.forEach(e => console.log('  ' + e));
  process.exit(r.ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
