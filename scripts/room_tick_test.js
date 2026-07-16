// scripts/room_tick_test.js — verifies the server-side AI clock and decision
// timers (§3.1 / §3.2) end-to-end through the real _serverTick, without
// waiting on wall-clock delays.
//
// It stands up real briar rooms (1 human seat + AI courtiers) and drives them
// purely with _serverTick, forcing the pacing gate (nextAiAt) and the human
// deadline (deadlineAt) into the past each cycle so a full game plays out
// synchronously in milliseconds. The human seat is never acted for by a
// "client", so its windows can ONLY advance via the timeout path — exercising
// every default in _enforceTimeout. AI seats can ONLY advance via the tick.
//
// Usage: node scripts/room_tick_test.js [games]

const rooms = require('../lib/game_rooms');
const briar = require('../lib/briar_engine');
const ROLES = ['elder', 'adder', 'magpie', 'owl', 'hedgewitch'];

function census(g) {
  const c = {}; for (const r of ROLES) c[r] = 0;
  for (const r of g.deck) c[r]++;
  for (const p of g.players) for (const cd of p.cards) c[cd.role]++;
  if (g.phase === 'consult' && g.pending && g.pending.consultPool) {
    for (const r of g.pending.consultPool.slice(g.pending.consultKeep || 0)) c[r]++;
  }
  return c;
}
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; throw new Error(msg); } }

function buildRoom(i) {
  const room = rooms.createRoom({
    gameType: 'briar', hostId: 'human' + i, hostName: 'Human' + i,
    visibility: 'private', maxPlayers: 4, difficulty: 'smart',
  });
  rooms.addAI(room, 'human' + i, 'Thorn');
  rooms.addAI(room, 'human' + i, 'Marigold');
  rooms.addAI(room, 'human' + i, 'Old Bracken');
  rooms.start(room, 'human' + i);
  return room;
}

function playThroughTick(room) {
  let steps = 0, timeouts = 0, aiMoves = 0;
  const seen = { forage: false };
  while (room.state.phase !== 'gameover' && steps < 4000) {
    const before = room.state.log.length;
    const humanPending = rooms.pendingAiSeat(room) == null && room.state.phase !== 'gameover';
    room.nextAiAt = 0;                 // let any pending AI move fire now
    room.deadlineAt = 1;               // force any human window to time out now
    rooms._serverTick();
    if (room.state.phase === 'gameover') break;
    // Invariant: 15 cards, 3 of each role, always.
    const c = census(room.state);
    for (const r of ROLES) assert(c[r] === 3, `role ${r}=${c[r]} at step ${steps} (room ${room.code})`);
    for (const p of room.state.players) assert(p.acorns >= 0, `negative acorns (room ${room.code})`);
    if (humanPending) timeouts++; else aiMoves++;
    if (humanPending && room.state.log.slice(before).some(l => /declares Forage/i.test(l))) seen.forage = true;
    steps++;
  }
  assert(room.state.phase === 'gameover', `room ${room.code} stalled after ${steps} steps`);
  assert(room.state.players.filter(p => p.alive).length === 1, `room ${room.code} not exactly one winner`);
  return { steps, timeouts, aiMoves, seen };
}

function forcedCoupUnitTest() {
  // Directly exercise the forced-coup timeout branch: a human at ≥10 acorns
  // can't forage, so _enforceTimeout must banish (never stall).
  const room = buildRoom(9999);
  const g = room.state;
  // Rotate to the human seat's action turn and give them 10 acorns.
  const humanSeat = room.seats.find(s => !s.isAI).seat;
  while (g.players[g.turn].seat !== humanSeat) g.turn = (g.turn + 1) % g.players.length;
  g.phase = 'action'; g.pending = null;
  g.players[g.turn].acorns = 10;
  const before = g.players.filter(p => p.alive).length;
  rooms._enforceTimeout(room);
  const banished = g.log.some(l => /Banish/i.test(l)) || g.phase === 'loseInfluence' ||
    g.players.filter(p => p.alive).length < before || g.phase === 'gameover';
  assert(banished, 'forced-coup timeout did not banish');
  console.log('  forced-coup timeout → banish: OK');
}

function main() {
  const n = parseInt(process.argv[2], 10) || 100;
  let totalTimeouts = 0, totalAi = 0, foraged = 0;
  for (let i = 0; i < n; i++) {
    const room = buildRoom(i);
    const r = playThroughTick(room);
    totalTimeouts += r.timeouts; totalAi += r.aiMoves;
    if (r.seen.forage) foraged++;
    rooms.get(room.code) && require('../lib/game_rooms'); // keep ref
  }
  forcedCoupUnitTest();
  console.log(`\nroom_tick_test — ${n} games driven purely by _serverTick`);
  console.log(`  AI moves via tick:      ${totalAi}`);
  console.log(`  human windows timed out: ${totalTimeouts}`);
  console.log(`  games where AFK human auto-foraged: ${foraged}/${n}`);
  if (!process.exitCode) console.log('\n✅ Server tick + decision timers drive full games with no stalls or invariant faults.');
}

main();
