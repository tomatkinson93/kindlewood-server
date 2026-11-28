// Dev Tools admin gates — every Dev Tools route answers 401 without a login
// and 403 for a logged-in non-admin; an admin gets past the gate. Routes that
// normal play needs (enemy + card lists) stay open.
// In-process express with a stubbed db module — never touches Postgres.
// Run from the server root: node scripts/admin_gates_test.js
'use strict';
process.env.ADMIN_USER_IDS = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const http = require('http');
const path = require('path');

// ── stub ../db before any route loads it ──────────────────────────────────
const emptyQ = async () => ({ rows: [], rowCount: 0 });
const fakeClient = { query: emptyQ, release() {} };
require.cache[require.resolve('../db')] = {
  id: 'db', filename: require.resolve('../db'), loaded: true,
  exports: { query: emptyQ, pool: { connect: async () => fakeClient, query: emptyQ }, withTransaction: async fn => fn(fakeClient), initDB: async () => {} },
};

let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
}

const GATED = [
  ['POST', '/api/game/cheat/resources'], ['POST', '/api/game/cheat/citizen'], ['PATCH', '/api/game/cheat/citizen/1'],
  ['POST', '/api/game/cheat/simulate-event'], ['POST', '/api/game/cheat/relationship'], ['POST', '/api/game/cheat/partnership'],
  ['POST', '/api/game/cheat/trigger-birth'], ['POST', '/api/game/seed-npcs'], ['POST', '/api/game/migrate'],
  ['GET', '/api/game/npc-list'], ['POST', '/api/game/debug-diplomacy'], ['POST', '/api/game/debug-diplomacy-reset'],
  ['GET', '/api/game/items'], ['POST', '/api/game/items'], ['DELETE', '/api/game/items/x'], ['POST', '/api/game/items/x/spawn'],
  ['POST', '/api/combat/enemies'], ['PATCH', '/api/combat/enemies/x'], ['DELETE', '/api/combat/enemies/x'], ['POST', '/api/combat/enemies/seed'],
  ['POST', '/api/combat/admin/inflict'], ['POST', '/api/combat/admin/heal'],
  ['POST', '/api/expeditions/reveal-all'], ['POST', '/api/expeditions/reset-fog'],
  ['POST', '/api/inventory/cheat/add'],
  ['GET', '/api/quest-admin'], ['POST', '/api/quest-admin'], ['PATCH', '/api/quest-admin/x'], ['DELETE', '/api/quest-admin/x'], ['POST', '/api/quest-admin/seed'],
  ['GET', '/api/item-admin'], ['POST', '/api/item-admin'], ['PATCH', '/api/item-admin/x'], ['DELETE', '/api/item-admin/x'], ['POST', '/api/item-admin/x/spawn'],
  ['POST', '/api/clans/cheat/prestige'], ['POST', '/api/clan-quests/cheat/finish'],
  ['POST', '/api/game/time/debug'], ['POST', '/api/game/reset-placement'],
];
const OPEN = [['GET', '/api/combat/enemies'], ['GET', '/api/combat/pending']];   // (player item adds are gone: scripts/fishing_test.js)

(async () => {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const jwt = require('jsonwebtoken');
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/game', require('../routes/game'));
  app.use('/api/combat', require('../routes/combat'));
  app.use('/api/expeditions', require('../routes/expeditions'));
  app.use('/api/inventory', require('../routes/inventory'));
  app.use('/api/quest-admin', require('../routes/quest_admin'));
  app.use('/api/item-admin', require('../routes/item_admin'));
  app.use('/api/clans', require('../routes/clans'));
  app.use('/api/clan-quests', require('../routes/clan_quests'));
  app.use('/api/diplomacy', require('../routes/diplomacy'));
  app.use('/api/stats', require('../routes/game_stats'));
  app.use('/api/feedback', require('../routes/feedback'));
  app.use('/api/game/tavern', require('../routes/tavern'));
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const tok = id => jwt.sign({ userId: id }, process.env.JWT_SECRET);
  const call = async (m, p, userId) => {
    const headers = { 'Content-Type': 'application/json' };
    if (userId) headers.Authorization = 'Bearer ' + tok(userId);
    const r = await fetch(base + p, { method: m, headers, body: m === 'GET' ? undefined : '{}' });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, gate: r.status === 403 && body.error === 'Admins only.' };
  };

  const anon = [], player = [], admin = [];
  for (const [m, p] of GATED) {
    const a = await call(m, p), u = await call(m, p, 2), s = await call(m, p, 1);
    if (a.status !== 401) anon.push(`${m} ${p}=${a.status}`);
    if (!u.gate) player.push(`${m} ${p}=${u.status}`);
    if (s.status === 401 || s.gate) admin.push(`${m} ${p}=${s.status}`);   // a later check (e.g. clan membership) may still refuse
  }
  check(`1. all ${GATED.length} Dev Tools routes → 401 without a login`, !anon.length, anon.join(' · '));
  check(`2. all ${GATED.length} Dev Tools routes → 403 "Admins only." for a logged-in non-admin`, !player.length, player.join(' · '));
  check(`3. an admin gets past the gate on all ${GATED.length}`, !admin.length, admin.join(' · '));

  const blocked = [];
  for (const [m, p] of OPEN) { const s = await call(m, p, 2); if (s.status === 401 || s.status === 403) blocked.push(`${m} ${p}=${s.status}`); }
  check('4. gameplay routes stay open to players (the creature list, the Battles list)', !blocked.length, blocked.join(' · '));

  // The card battler's routes are gone: nothing is left that takes a client's word for how a battle went.
  const gone = async (m, p) => (await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(1) }, body: '{}' })).status;
  const card = [await gone('POST', '/api/combat/resolve'), await gone('POST', '/api/combat/engage/5'), await gone('POST', '/api/combat/action/5')];
  check('5. /combat/resolve, /engage and /action are gone (a battle is played and decided on the server: /api/tactics)', card.every(x => x === 404), card.join(' · '));

  // Exploits closed: client-set gold, client-set trust, client-reported wins.
  const st = async (m, p, userId, body) => (await fetch(base + p, { method: m,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(userId) }, body: JSON.stringify(body || {}) })).status;
  check('6. POST /game/award-gold is gone (tavern wins are paid by the server)', await st('POST', '/api/game/award-gold', 2, { amount: 10 }) === 404);
  check('7. the legacy free-trust POST /diplomacy/:id/interact is gone', await st('POST', '/api/diplomacy/1/interact', 2, { trust_gain: 20 }) === 404);
  check('8. POST /stats/record is retired (410)', await st('POST', '/api/stats/record', 2, { game: 'briar', won: true }) === 410);
  const fbList = await (await fetch(base + '/api/feedback', { headers: { Authorization: 'Bearer ' + tok(2) } })).json();
  check('9. feedback: players can\'t resolve or delete reports, and see only their own',
        await st('PATCH', '/api/feedback/1', 2, { status: 'resolved' }) === 403 && await st('DELETE', '/api/feedback/1', 2) === 403 && fbList.admin === false);
  check('10. feedback: admins still can', await st('PATCH', '/api/feedback/1', 1, { status: 'resolved' }) === 200 && await st('DELETE', '/api/feedback/1', 1) === 200);

  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
