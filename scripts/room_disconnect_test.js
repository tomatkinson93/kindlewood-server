// scripts/room_disconnect_test.js — verifies §3.3 disconnect→AI conversion,
// reconnect restore, host migration, and §3.4 rematch, driving everything
// through the real game_rooms API + _serverTick (no wall-clock waits: the
// grace clock is fast-forwarded by back-dating `since`).
//
// Usage: node scripts/room_disconnect_test.js

const rooms = require('../lib/game_rooms');
const fakeRes = () => ({ write() {}, end() {} });
let failures = 0;
function ok(cond, msg) { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) failures++; }

// Build a started briar room with the given human ids (first is host) + AI fill.
function build(humanIds) {
  const host = humanIds[0];
  const room = rooms.createRoom({ gameType: 'briar', hostId: host, hostName: host, visibility: 'private', maxPlayers: 4, difficulty: 'smart' });
  const subs = {};
  subs[host] = fakeRes(); rooms.subscribe(room, host, subs[host]);
  for (const h of humanIds.slice(1)) { rooms.join(room, { id: h, name: h }); subs[h] = fakeRes(); rooms.subscribe(room, h, subs[h]); }
  while (room.players.length < Math.max(3, humanIds.length + 1)) rooms.addAI(room, host);
  rooms.start(room, host);
  return { room, subs };
}
const drop = (room, subs, id) => rooms.unsubscribe(room, id, subs[id]);
const seatOf = (room, id) => room.seats.find(s => s.id === id);

// ── 1. Grace expiry converts an absent human seat to AI, game still finishes ──
console.log('1. disconnect → AI conversion');
{
  const { room, subs } = build(['h0']);           // sole human + AIs
  drop(room, subs, 'h0');
  rooms.markAbsent(room, 'h0');
  ok(room.absent && room.absent.has('h0'), 'seat flagged absent');
  ok(seatOf(room, 'h0').isAI === false, 'still human before grace');
  room.absent.get('h0').since -= 61000;            // fast-forward past the 60s grace
  room.nextAiAt = 0;
  rooms._serverTick();
  ok(seatOf(room, 'h0').isAI === true, 'seat converted to AI on grace expiry');
  const gp = room.state.players.find(p => p.seat === seatOf(room, 'h0').seat);
  ok(gp && gp.isAI === true, 'engine player marked AI too');
  // Drive to completion (now all AI).
  let steps = 0;
  while (room.state.phase !== 'gameover' && steps < 4000) { room.nextAiAt = 0; room.deadlineAt = 1; rooms._serverTick(); steps++; }
  ok(room.state.phase === 'gameover', 'converted game reaches gameover');
}

// ── 2. Reconnect BEFORE grace cancels the absence ──
console.log('2. reconnect before grace');
{
  const { room, subs } = build(['h0', 'h1']);
  drop(room, subs, 'h1');
  rooms.markAbsent(room, 'h1');
  ok(room.absent.has('h1'), 'flagged absent');
  rooms.subscribe(room, 'h1', fakeRes());          // reconnect
  rooms.markPresent(room, 'h1');
  ok(!room.absent.has('h1'), 'absence cleared on reconnect');
  ok(seatOf(room, 'h1').isAI === false, 'seat remains human');
}

// ── 3. Reconnect AFTER conversion restores human control ──
console.log('3. reconnect after conversion restores control');
{
  const { room, subs } = build(['h0', 'h1']);
  drop(room, subs, 'h1');
  rooms.markAbsent(room, 'h1');
  room.absent.get('h1').since -= 61000;
  rooms._convertSeatToAI(room, 'h1', room.absent.get('h1'));
  ok(seatOf(room, 'h1').isAI === true, 'converted to AI');
  rooms.subscribe(room, 'h1', fakeRes());
  rooms.markPresent(room, 'h1');
  ok(seatOf(room, 'h1').isAI === false, 'human control restored');
  const gp = room.state.players.find(p => p.seat === seatOf(room, 'h1').seat);
  ok(gp && gp.isAI === false, 'engine player restored to human');
}

// ── 4. Host disconnect migrates host to another connected human ──
console.log('4. host migration on disconnect');
{
  const { room, subs } = build(['h0', 'h1']);      // h0 host, h1 connected
  drop(room, subs, 'h0');
  rooms.markAbsent(room, 'h0');
  ok(room.hostId === 'h1', 'host migrated to connected human h1');
}

// ── 5. Rematch: finished → lobby, keeps AI + connected humans ──
console.log('5. rematch flow');
{
  const { room, subs } = build(['h0', 'h1']);
  // drop h1 and let them fully leave (no reconnect) so rematch discards them
  drop(room, subs, 'h1');
  room.status = 'finished';                          // simulate match end
  rooms.rematch(room, 'h0');
  ok(room.status === 'lobby', 'back to lobby');
  ok(room.seats === null && room.state === null && room.engine === null, 'engine/seats/state cleared');
  ok(room.players.some(p => p.id === 'h0'), 'host retained');
  ok(!room.players.some(p => p.id === 'h1'), 'disconnected human dropped');
  ok(room.players.some(p => p.isAI), 'AI seats retained');
  ok(room.hostId === 'h0', 'host still valid');
  // and a fresh start works
  while (room.players.length < 3) rooms.addAI(room, 'h0');
  rooms.start(room, 'h0');
  ok(room.status === 'playing' && room.state, 'fresh match starts after rematch');
  // non-host cannot rematch
  room.status = 'finished';
  let threw = false;
  try { rooms.rematch(room, 'someone-else'); } catch (e) { threw = true; }
  ok(threw, 'non-host rematch rejected');
}

console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ All disconnect/rematch checks passed');
process.exitCode = failures ? 1 : 0;
