// ═══════════════════════════════════════════════════════════════════════════
//  test_accounts_test — the "fresh test account" button (lib/test_accounts.js,
//  /api/auth/test-account): made in one press, deleted on sign-out.
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/test_accounts_test.js
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}

async function main() {
  const TA = require('../lib/test_accounts');
  console.log('What counts as the town\'s');
  check(['settlement_id', 'seller_settlement_id', 'user_id', 'author_user_id'].every(c => TA._OWNED.test(c)) && !['owner_id', 'citizen_id', 'id', 'resettlement_id_x', 'superuser_idx'].some(c => TA._OWNED.test(c)), 'columns that name a town or a player, and nothing else');
  check(TA._LET_GO.tiles && TA._LET_GO.clan_territory, 'a map tile and a clan\'s claim are let go, never deleted');
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const TU = require('../lib/tuning');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const q = (t, p) => pool.query(t, p);
  const api = async (method, pth, token, body) => {
    const r = await fetch(BASE + pth, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const wasOn = await TA.available();
  await TU.setSwitch('test_login.on', true);
  const count = async (t, col, id) => (await q(`SELECT COUNT(*)::int AS n FROM ${t} WHERE ${col} = $1`, [id])).rows[0].n;

  console.log('One press');
  let x = await api('GET', '/api/auth/test-account');
  check(x.status === 200 && x.body.available === true, 'the login screen is told the button is offered');
  x = await api('POST', '/api/auth/test-account');
  check(x.status === 200 && x.body.token && x.body.test === true && /^Tester_/.test(x.body.username) && x.body.species === 'pending', 'a fresh account, signed in, with its species still to choose', x.body);
  const token = x.body.token;
  const me = (await q('SELECT id, is_test, email FROM users WHERE username = $1', [x.body.username])).rows[0];
  check(me && me.is_test === true && /@test\.kindlewood\.invalid$/.test(me.email), 'it is marked as a test account, with an address nobody can sign in by');
  x = await api('GET', '/api/game/settlement', token);
  check(x.status === 200 && x.body.settlement && x.body.settlement.isNewSettlement === true, 'it plays as a brand-new player: a town not yet founded');
  const sid = x.body.settlement.id;

  console.log('Signing out deletes it, and everything of its town');
  {
    // A town with things of every kind hanging off it.
    await q("UPDATE settlements SET tile_q = -990001, tile_r = 7, tier = 'village', upkeep_on = TRUE WHERE id = $1", [sid]);
    const c1 = (await q("INSERT INTO citizens (settlement_id, name, gender, role) VALUES ($1,'Ada Test','female','forager') RETURNING id", [sid])).rows[0].id;
    const c2 = (await q("INSERT INTO citizens (settlement_id, name, gender, role) VALUES ($1,'Bo Test','male','forager') RETURNING id", [sid])).rows[0].id;
    await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'tavern',1), ($1,'farm',1)", [sid]);
    await q("INSERT INTO houses (settlement_id, name, building_type, capacity) VALUES ($1,'Willow Hut #1','starter_house',4)", [sid]);
    await q('INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state) VALUES ($1,$2,$3,50,$4)', [sid, Math.min(c1, c2), Math.max(c1, c2), 'friends']);
    await q("INSERT INTO chronicle (settlement_id, citizen_ids, kind, text) VALUES ($1,$2,'town','A test line.')", [sid, JSON.stringify([c1])]);
    await q("INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,'test','A test event.','[]')", [sid]);
    await q("INSERT INTO moments (settlement_id, kind, subject, data, expires_at) VALUES ($1,'scene_cart','{}','{}', NOW() + interval '1 hour')", [sid]);
    await q("INSERT INTO decorations (settlement_id, kind, area, x, y) VALUES ($1,'bench','town',50,80)", [sid]);
    await q('INSERT INTO lost_things (settlement_id, day, kind, owner_id, owner_name, seed) VALUES ($1,1,$2,$3,$4,5)', [sid, 'ribbon', c1, 'Ada Test']);
    await require('../lib/social').ensure(sid).catch(() => {});
    await q("INSERT INTO player_milestones (user_id, step) VALUES ($1,'placed') ON CONFLICT DO NOTHING", [me.id]).catch(() => {});
    const tile = (await q('SELECT q, r FROM tiles WHERE settlement_id IS NULL LIMIT 1').catch(() => ({ rows: [] }))).rows[0];
    if (tile) await q('UPDATE tiles SET settlement_id = $3 WHERE q = $1 AND r = $2', [tile.q, tile.r, sid]);
    const others = { users: (await q('SELECT COUNT(*)::int AS n FROM users')).rows[0].n, towns: (await q('SELECT COUNT(*)::int AS n FROM settlements')).rows[0].n, cits: (await q('SELECT COUNT(*)::int AS n FROM citizens')).rows[0].n,
      tiles: (await q('SELECT COUNT(*)::int AS n FROM tiles').catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n };

    x = await api('POST', '/api/auth/logout', token);
    check(x.status === 200 && x.body.test_account_deleted === true, 'signing out says the test account is gone', x.body);
    check((await count('users', 'id', me.id)) === 0 && (await count('settlements', 'id', sid)) === 0, 'the account and its town are deleted');
    const left = {};
    for (const [t, col] of [['citizens', 'settlement_id'], ['buildings', 'settlement_id'], ['houses', 'settlement_id'], ['citizen_relationships', 'settlement_id'], ['chronicle', 'settlement_id'], ['settlement_events', 'settlement_id'],
      ['moments', 'settlement_id'], ['decorations', 'settlement_id'], ['lost_things', 'settlement_id'], ['player_milestones', 'user_id']]) left[t] = await count(t, col, col === 'user_id' ? me.id : sid);
    check(Object.values(left).every(n => n === 0), 'and so is everything of the town: villagers, buildings, homes, bonds, chronicle, news, moments, decorations', left);
    check((await q('SELECT COUNT(*)::int AS n FROM citizen_interests WHERE citizen_id = ANY($1::int[])', [[c1, c2]])).rows[0].n === 0, 'and what hung off its villagers');
    const now = { users: (await q('SELECT COUNT(*)::int AS n FROM users')).rows[0].n, towns: (await q('SELECT COUNT(*)::int AS n FROM settlements')).rows[0].n, cits: (await q('SELECT COUNT(*)::int AS n FROM citizens')).rows[0].n,
      tiles: (await q('SELECT COUNT(*)::int AS n FROM tiles').catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n };
    check(now.users === others.users - 1 && now.towns === others.towns - 1 && now.cits === others.cits - 2, 'nobody else lost anything: one account, one town, two villagers fewer', { others, now });
    check(now.tiles === others.tiles && (!tile || (await q('SELECT settlement_id FROM tiles WHERE q = $1 AND r = $2', [tile.q, tile.r])).rows[0].settlement_id === null), 'its map tile is still there, and free again');
    x = await api('GET', '/api/game/settlement', token);
    check(x.status === 401 || x.status === 404, 'its old token opens nothing', x.status);
  }

  console.log('Only ever a test account');
  {
    const real = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", ['real_' + Date.now().toString(36), `real_${Date.now()}@t.l`])).rows[0].id;
    const rs = (await q("INSERT INTO settlements (user_id, name) VALUES ($1,'Real Town') RETURNING id", [real])).rows[0].id;
    check((await TA.purge(real)) === false && (await count('users', 'id', real)) === 1 && (await count('settlements', 'id', rs)) === 1, 'an ordinary account is never deleted this way');
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign({ userId: real, username: 'real', species: 'Mice' }, process.env.JWT_SECRET || 'dev-secret-change-in-production');
    x = await api('POST', '/api/auth/logout', tok);
    check(x.status === 200 && !x.body.test_account_deleted && (await count('users', 'id', real)) === 1, 'an ordinary player signing out keeps their account');
    x = await api('POST', '/api/auth/logout');
    check(x.status === 200, 'signing out with no token still answers');
    check((await TA.purge('nope')) === false && (await TA.purge(-5)) === false, 'nonsense is refused quietly');
    await q('DELETE FROM settlements WHERE id = $1', [rs]); await q('DELETE FROM users WHERE id = $1', [real]);
  }

  console.log('Left behind, and switched off');
  {
    const a = await TA.create(), b = await TA.create();
    await q("UPDATE users SET created_at = NOW() - interval '5 days' WHERE id = $1", [a.userId]);
    const n = await TA.sweep(Date.now(), true);
    check(n >= 1 && (await count('users', 'id', a.userId)) === 0 && (await count('users', 'id', b.userId)) === 1, 'a test account nobody signed out of is cleared after three days; a fresh one is kept');
    await TA.purge(b.userId);
    x = await api('POST', '/api/auth/test-account/switch', null, { on: false });
    check(x.status === 401, 'only an admin can switch the button off');
    await TU.setSwitch('test_login.on', false);
    x = await api('GET', '/api/auth/test-account');
    const y = await api('POST', '/api/auth/test-account');
    check(x.body.available === false && y.status === 403, 'switched off: the button is not offered and the route refuses');
    await TU.setSwitch('test_login.on', wasOn);
  }

  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
