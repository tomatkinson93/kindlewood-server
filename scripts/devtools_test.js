// ══════════════════════════════════════════════════════════════════════════
//  devtools_test — GET /api/dev-tools serves the Dev Tools markup to signed-in
//  admins only (docs/LAYOUT_SPEC.md §6; it was a static dev.html anyone could
//  open).
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/devtools_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ', m); } else { failed++; console.log('  FAIL', m); } };

(async () => {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID || 0);
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  const get = async tok => { const r = await fetch(BASE + '/api/dev-tools', { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }); return { status: r.status, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', body: await r.text() }; };
  console.log('The Dev Tools markup');
  check((await get(null)).status === 401, 'signed out: 401');
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [`dev_${RUN}`, `dev_${RUN}@t.l`])).rows[0];
  const player = await get(jwt.sign({ userId: u.id, username: `dev_${RUN}`, species: 'Mice' }, SECRET));
  check(player.status === 403 && !/cheat-modal/.test(player.body), 'a player: 403, and none of the markup');
  if (ADMIN) {
    const a = await get(jwt.sign({ userId: ADMIN, username: 'admin', species: 'Mice' }, SECRET));
    check(a.status === 200 && /text\/html/.test(a.type) && /<div class="cheat-backdrop" id="cheat-modal">/.test(a.body) && (a.body.match(/class="cheat-tab( active)?"/g) || []).length === 14, 'an admin: the markup, 14 tabs');
    check(/no-store/.test(a.cache), 'never cached');
  }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
