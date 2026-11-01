// ══════════════════════════════════════════════════════════════════════════
//  decks_test — saved battle decks (routes/decks.js): create, rename, set
//  active, delete, and the tables existing on a fresh database (0NN_cards.sql).
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 node scripts/decks_test.js
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
  const BASE = process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  const username = 'decks_' + RUN;
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, username + '@t.l'])).rows[0];
  await q("INSERT INTO settlements (user_id, name, world_version, last_tick) VALUES ($1,$2,2,NOW())", [u.id, username]);
  const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
  const api = async (method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const deck = { strike: 5, defend: 5, quick_jab: 2 };

  console.log('Decks');
  let r = await api('GET', '/api/decks');
  check(r.status === 200 && Array.isArray(r.body.templates) && r.body.templates.length === 0 && Object.keys(r.body.catalog).length > 0, 'a fresh town: no decks yet, the card catalog loads (tables exist)');
  r = await api('POST', '/api/decks', { name: 'Opener', cards: deck });
  const first = r.body.template;
  check(r.status === 200 && first.is_active === true, 'the first deck becomes the active one');
  r = await api('POST', '/api/decks', { name: 'Ambush', cards: deck });
  const second = r.body.template;
  check(r.status === 200 && second.is_active === false, 'later decks start inactive');
  r = await api('PUT', `/api/decks/${second.id}`, { name: 'Night Ambush', cards: deck });
  check(r.status === 200 && r.body.template.name === 'Night Ambush', 'rename');
  check((await api('DELETE', `/api/decks/${first.id}`)).status === 400, 'the active deck can\'t be deleted');
  r = await api('POST', `/api/decks/${second.id}/activate`);
  const list = (await api('GET', '/api/decks')).body.templates;
  check(r.status === 200 && list.filter(t => t.is_active).map(t => t.id).join() === String(second.id), 'set active: exactly one active deck');
  check((await api('DELETE', `/api/decks/${first.id}`)).status === 200, 'the old one can now go');
  check((await api('DELETE', `/api/decks/${second.id}`)).status === 400, 'your only deck stays');
  check((await api('PUT', `/api/decks/${second.id}`, { name: 'x', cards: { strike: 2 } })).status === 400, 'a deck under 12 cards is refused');

  await pool.end();
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(skipped — set DATABASE_URL and CRAFTING_TEST_BASE)'); console.log('\n0 passed, 0 failed'); return; }
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
