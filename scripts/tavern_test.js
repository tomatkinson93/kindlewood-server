// ══════════════════════════════════════════════════════════════════════════
//  tavern_test — tavern card-game winnings are decided by the server.
//
//  lib/tavern_pay.js, routes/tavern.js, lib/game_rooms.js finishMatch.
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 node scripts/tavern_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const pay = require('../lib/tavern_pay');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function main() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CRAFTING_TEST_BASE || process.env.MARKET_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function user(name) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    await q(`INSERT INTO settlements (user_id, name, world_version, wealth, last_tick) VALUES ($1,$2,2,100,NOW())`, [u.id, username]);
    return { id: u.id, name: username, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  async function api(p, pth, body) {
    const r = await fetch(BASE + pth, { method: 'POST', headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const wealth = async p => Number((await q('SELECT wealth FROM settlements WHERE user_id=$1', [p.id])).rows[0].wealth);
  const age = (ticket, secs) => q("UPDATE tavern_games SET started_at = NOW() - make_interval(secs => $2) WHERE id = $1", [ticket, secs]);
  const wins = async (p, game) => ((await q('SELECT wins, games FROM game_stats WHERE user_id=$1 AND game=$2', [p.id, game])).rows[0] || { wins: 0, games: 0 });

  console.log('Solo games');
  const a = await user('tav');
  let r = await api(a, '/api/game/award-gold', { amount: 10 });
  check(r.status === 404 && await wealth(a) === 100, 'the old award-gold route is gone');
  r = await api(a, '/api/game/tavern/solo-start', { game: 'poker' });
  check(r.status === 400, 'only real tavern games get a ticket');
  r = await api(a, '/api/game/tavern/solo-start', { game: 'briar' });
  const t1 = r.body.ticket;
  check(r.status === 200 && /^[0-9a-f]{32}$/.test(t1), 'a solo game starts with a ticket');
  r = await api(a, '/api/game/tavern/solo-finish', { ticket: t1, won: true });
  check(r.status === 400 && /too quick/.test(r.body.error) && await wealth(a) === 100, 'a win straight away is too quick to count…');
  r = await api(a, '/api/game/tavern/solo-finish', { ticket: t1, won: true });
  check(r.status === 409, '…and its ticket is spent');
  r = await api(a, '/api/game/tavern/solo-finish', { ticket: 'deadbeef', won: true });
  check(r.status === 404, 'a made-up ticket pays nothing');

  const t2 = (await api(a, '/api/game/tavern/solo-start', { game: 'briar' })).body.ticket;
  await age(t2, 120);
  const b = await user('tavb');
  r = await api(b, '/api/game/tavern/solo-finish', { ticket: t2, won: true });
  check(r.status === 404 && await wealth(b) === 100, 'someone else\'s ticket pays nothing');
  r = await api(a, '/api/game/tavern/solo-finish', { ticket: t2, won: true });
  check(r.status === 200 && r.body.paid === pay.WIN_GOLD && r.body.wealth === 100 + pay.WIN_GOLD && await wealth(a) === 100 + pay.WIN_GOLD,
    `a real win pays ${pay.WIN_GOLD} and says the new total`);
  check((await wins(a, 'briar')).wins === 1, '…and counts on the rankings');
  r = await api(a, '/api/game/tavern/solo-finish', { ticket: t2, won: true });
  check(r.status === 409 && await wealth(a) === 100 + pay.WIN_GOLD, 'a ticket only works once');

  const t3 = (await api(a, '/api/game/tavern/solo-start', { game: 'squirrel' })).body.ticket;
  r = await api(a, '/api/game/tavern/solo-finish', { ticket: t3, won: false });
  const ws = await wins(a, 'squirrel');
  check(r.status === 200 && r.body.paid === 0 && ws.games === 1 && ws.wins === 0, 'a loss (even a quick one) counts as a game, pays nothing');

  const t4 = (await api(a, '/api/game/tavern/solo-start', { game: 'briar' })).body.ticket;
  const t5 = (await api(a, '/api/game/tavern/solo-start', { game: 'briar' })).body.ticket;
  await age(t4, 120); await age(t5, 120);
  r = await api(a, '/api/game/tavern/solo-finish', { ticket: t4, won: true });
  check(r.status === 409, 'starting another game forfeits the open one (no stockpiled tickets)');
  check((await api(a, '/api/game/tavern/solo-finish', { ticket: t5, won: true })).body.paid === pay.WIN_GOLD, '…the new one still pays');

  console.log('Daily cap');
  const c = await user('tavc');
  for (let i = 0; i < pay.DAILY_PAID_WINS; i++) {
    const t = (await api(c, '/api/game/tavern/solo-start', { game: 'briar' })).body.ticket;
    await age(t, 120);
    await api(c, '/api/game/tavern/solo-finish', { ticket: t, won: true });
  }
  check(await wealth(c) === 100 + pay.DAILY_PAID_WINS * pay.WIN_GOLD, `${pay.DAILY_PAID_WINS} wins a day pay`);
  const tx = (await api(c, '/api/game/tavern/solo-start', { game: 'briar' })).body.ticket;
  await age(tx, 120);
  r = await api(c, '/api/game/tavern/solo-finish', { ticket: tx, won: true });
  check(r.status === 200 && r.body.paid === 0 && r.body.capped === true && await wealth(c) === 100 + pay.DAILY_PAID_WINS * pay.WIN_GOLD
    && (await wins(c, 'briar')).wins === pay.DAILY_PAID_WINS + 1, 'past the cap: no gold, but the win still counts');

  console.log('Multiplayer');
  const rooms = require('../lib/game_rooms');
  const m = await user('tavm');
  const room = rooms.createRoom({ gameType: 'briar', hostId: m.id, hostName: m.name, visibility: 'private', maxPlayers: 6, difficulty: 'smart' });
  rooms.fillAI(room, m.id);
  rooms.start(room, m.id);
  const mine = room.seats.find(s => String(s.id) === String(m.id));
  const heard = [];
  room.subscribers.set(m.id, new Set([{ write: line => heard.push(JSON.parse(line.replace(/^data: /, ''))) }]));
  room.state.winner = mine.seat;
  rooms._finishMatch(room);
  for (let i = 0; i < 40 && !heard.some(e => e.type === 'payout'); i++) await new Promise(res => setTimeout(res, 50));
  const po = heard.find(e => e.type === 'payout');
  check(await wealth(m) === 100 + pay.WIN_GOLD && po && po.paid === pay.WIN_GOLD, 'the server pays a multiplayer winner itself, and tells only them');
  const row = (await q("SELECT mode, paid FROM tavern_games WHERE user_id=$1", [m.id])).rows[0];
  check(row && row.mode === 'multiplayer' && row.paid === pay.WIN_GOLD, '…logged against the same daily cap');

  await pool.end();
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(skipped — set DATABASE_URL and CRAFTING_TEST_BASE)'); console.log('\n0 passed, 0 failed'); return; }
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
