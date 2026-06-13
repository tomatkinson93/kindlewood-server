// lib/game_rooms.js — generic multiplayer room manager for tavern games.
//
// In-memory and single-instance by design — the same constraint (and the
// same trade-off) as lib/event_bus.js. Rooms, lobby listings, SSE fan-out
// and seat assignment are shared infrastructure; each game registers a
// small descriptor. Game RULES are not resolved here yet (Phase 2): the
// relay() function rebroadcasts client actions stamped with their seat,
// and broadcast() accepts a per-recipient transform so a server-side
// rules engine can redact hidden information per player.

const crypto = require('crypto');
const briar = require('./briar_engine');

// Per-gameType engines. Add new server-authoritative games here.
const ENGINES = { briar };

const GAMES = {};          // gameType -> { name, minPlayers, maxPlayers }
const rooms = new Map();   // code -> room

function registerGame(type, def) { GAMES[type] = def; }

// ── Registered games ──
registerGame('briar', { name: 'The Briar Court', minPlayers: 2, maxPlayers: 6 });

// AI courtiers a host may seat in empty slots (same roster as single-player)
const AI_ROSTER = ['Old Bracken', 'Sly Whisper', 'Marigold', 'Thorn'];

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
function makeCode() {
  let c;
  do {
    c = Array.from(crypto.randomBytes(6)).map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  } while (rooms.has(c));
  return c;
}

function createRoom({ gameType, hostId, hostName, visibility, maxPlayers, difficulty }) {
  const def = GAMES[gameType];
  if (!def) throw new Error('Unknown game type');
  const max = Math.max(def.minPlayers, Math.min(def.maxPlayers, parseInt(maxPlayers, 10) || def.maxPlayers));
  const room = {
    code: makeCode(),
    gameType,
    visibility: visibility === 'private' ? 'private' : 'public',
    difficulty: difficulty === 'simple' ? 'simple' : 'smart',
    maxPlayers: max,
    status: 'lobby',           // lobby | playing | finished
    hostId,
    players: [{ id: hostId, name: hostName }],
    seats: null,
    state: null,               // Phase 2: server-authoritative game state
    subscribers: new Map(),    // userId -> Set(res)
    updatedAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function publicView(room) {
  return {
    code: room.code,
    gameType: room.gameType,
    gameName: GAMES[room.gameType] ? GAMES[room.gameType].name : room.gameType,
    visibility: room.visibility,
    maxPlayers: room.maxPlayers,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, isAI: !!p.isAI })),
    aiRoster: AI_ROSTER,
  };
}

function listPublic(gameType) {
  const out = [];
  for (const r of rooms.values()) {
    if (r.visibility !== 'public' || r.status !== 'lobby') continue;
    if (gameType && r.gameType !== gameType) continue;
    if (r.players.length >= r.maxPlayers) continue;
    out.push(publicView(r));
  }
  return out.sort((a, b) => b.players.length - a.players.length).slice(0, 50);
}

function get(code) { return rooms.get(String(code || '').trim().toUpperCase()); }

function join(room, user) {
  if (room.players.some(p => p.id === user.id)) { touch(room); return room; } // rejoin is fine
  if (room.status !== 'lobby') throw new Error('That game has already started');
  if (room.players.length >= room.maxPlayers) throw new Error('That room is full');
  room.players.push({ id: user.id, name: user.name });
  touch(room);
  broadcast(room, { type: 'lobby_update', room: publicView(room) });
  return room;
}

function leave(room, userId) {
  room.players = room.players.filter(p => p.id !== userId);
  touch(room);
  if (!room.players.length) { destroy(room); return; }
  if (room.hostId === userId) {
    room.hostId = room.players[0].id;   // host migration
  }
  broadcast(room, { type: 'lobby_update', room: publicView(room) });
}

function addAI(room, userId, name) {
  if (room.hostId !== userId) throw new Error('Only the host can add courtiers');
  if (room.status !== 'lobby') throw new Error('Game already started');
  if (room.players.length >= room.maxPlayers) throw new Error('No empty seats');
  const taken = new Set(room.players.filter(p => p.isAI).map(p => p.name));
  const pick = name && AI_ROSTER.includes(name) && !taken.has(name)
    ? name : AI_ROSTER.find(n => !taken.has(n));
  if (!pick) throw new Error('No more courtiers available');
  room.players.push({ id: 'ai:' + pick.replace(/\s+/g, '_'), name: pick, isAI: true });
  touch(room);
  broadcast(room, { type: 'lobby_update', room: publicView(room) });
  return room;
}

function removeAI(room, userId, aiId) {
  if (room.hostId !== userId) throw new Error('Only the host can remove courtiers');
  const before = room.players.length;
  room.players = room.players.filter(p => !(p.isAI && p.id === aiId));
  if (room.players.length !== before) {
    touch(room);
    broadcast(room, { type: 'lobby_update', room: publicView(room) });
  }
  return room;
}

function start(room, userId) {
  if (room.hostId !== userId) throw new Error('Only the host can start the game');
  if (room.status !== 'lobby') throw new Error('Already started');
  const def = GAMES[room.gameType];
  if (room.players.length < def.minPlayers) throw new Error(`Need at least ${def.minPlayers} players`);
  if (!room.players.some(p => !p.isAI)) throw new Error('Need at least one human player');
  room.status = 'playing';
  // Server assigns randomized seats once, so every client agrees
  room.seats = [...room.players]
    .sort(() => Math.random() - 0.5)
    .map((p, i) => ({ seat: i, id: p.id, name: p.name, isAI: !!p.isAI }));

  // Spin up the server-authoritative engine (if this game has one)
  const engine = ENGINES[room.gameType];
  if (engine) {
    room.engine = engine;
    room.state = engine.create(room.seats, { difficulty: room.difficulty });
  }
  touch(room);
  broadcast(room, { type: 'match_started', gameType: room.gameType, seats: room.seats });
  pushState(room);
}

// Chat. scope 'all' goes to everyone; a whisper (to = userId) reaches only
// sender and recipient. Uses broadcast's per-recipient transform so the
// server never leaks a whisper to anyone else.
function chat(room, fromId, fromName, text, to) {
  if (to) {
    const recip = String(to);
    broadcast(room, { type: 'chat', scope: 'whisper', fromId, fromName, to: recip, text },
      (ev, uid) => (String(uid) === String(fromId) || String(uid) === recip) ? ev : null);
  } else {
    broadcast(room, { type: 'chat', scope: 'all', fromId, fromName, text });
  }
  touch(room);
}

// Typing indicator — broadcasts only WHO is typing (no text, no target),
// so others see "whispering…" without learning to whom or what.
function typing(room, userId, on) {
  broadcast(room, { type: 'typing', userId, on },
    (ev, uid) => String(uid) === String(userId) ? null : ev); // don't echo to self
  touch(room);
}

// Push each connected player their own redacted view of the game state.
function pushState(room) {
  if (!room.engine || !room.state) return;
  broadcast(room, { type: 'game_state' }, (ev, uid) => ({
    type: 'game_state',
    state: room.engine.view(room.state, uid),
  }));
}

// Apply a validated game action from a specific user, then push new state.
// The engine enforces turn/phase ownership; we only map userId -> seat and
// reject inputs from a user who isn't the seat the engine is waiting on.
function gameAction(room, userId, msg) {
  if (!room.engine || !room.state || room.status !== 'playing') return;
  const g = room.state;
  const seat = room.seats.find(s => s.id === userId);
  if (!seat) return;
  const s = seat.seat;
  const E = room.engine;

  switch (msg.kind) {
    case 'action':        E.doAction(g, s, msg.action, msg.targetSeat); break;
    case 'challengeAction': E.challengeAction(g, s, !!msg.challenge); break;
    case 'block':         E.block(g, s, msg.blockRole || null); break;
    case 'challengeBlock': E.challengeBlock(g, s, !!msg.challenge); break;
    case 'loseInfluence': E.resolveLoss(g, s, msg.cardIndex | 0); break;
    case 'consult':       E.resolveConsult(g, s, msg.keepIndices || []); break;
    default: return;
  }
  touch(room);
  pushState(room);

  if (g.phase === 'gameover') finishMatch(room);
}

// Host-only AI tick. The host's browser pings this; the SERVER decides
// which seat the engine is waiting on and resolves it with the engine's
// own reasoning. The host no longer computes AI moves — it just drives the
// clock. Returns true if it resolved something (so the host can ping again).
function aiAction(room, userId) {
  if (room.hostId !== userId) return false;
  if (!room.engine || !room.state || room.status !== 'playing') return false;
  const g = room.state;
  const seat = pendingAiSeat(room);
  if (seat == null) return false;
  const decision = room.engine.aiResolve(g, seat);
  if (!decision) return false;
  gameActionBySeat(room, seat, decision);
  return true;
}

// Which AI seat (if any) is the engine currently waiting on?
function pendingAiSeat(room) {
  const g = room.state, E = room.engine;
  const seatIsAI = s => { const o = room.seats.find(x => x.seat === s); return o && o.isAI; };
  const P = g.pending;
  if (g.phase === 'action') { const s = g.players[g.turn].seat; return seatIsAI(s) ? s : null; }
  if (g.phase === 'loseInfluence') return seatIsAI(P.loserSeat) ? P.loserSeat : null;
  if (g.phase === 'consult') return seatIsAI(P.actorSeat) ? P.actorSeat : null;
  if (g.phase === 'challengeBlock') return seatIsAI(P.actorSeat) ? P.actorSeat : null;
  if (g.phase === 'challengeAction') {
    const cand = g.players.filter(p => p.alive && p.seat !== P.actorSeat && !(P.passes||[]).includes(p.seat));
    const ai = cand.find(p => { const o = room.seats.find(x => x.seat === p.seat); return o && o.isAI; });
    return ai ? ai.seat : null;
  }
  if (g.phase === 'block') {
    const blockers = P.action === 'gather'
      ? g.players.filter(p => p.alive && p.seat !== P.actorSeat && !(P.passes||[]).includes(p.seat))
      : g.players.filter(p => p.seat === P.targetSeat && p.alive);
    const ai = blockers.find(p => { const o = room.seats.find(x => x.seat === p.seat); return o && o.isAI; });
    return ai ? ai.seat : null;
  }
  return null;
}

function gameActionBySeat(room, s, msg) {
  const g = room.state, E = room.engine;
  switch (msg.kind) {
    case 'action':        E.doAction(g, s, msg.action, msg.targetSeat); break;
    case 'challengeAction': E.challengeAction(g, s, !!msg.challenge); break;
    case 'block':         E.block(g, s, msg.blockRole || null); break;
    case 'challengeBlock': E.challengeBlock(g, s, !!msg.challenge); break;
    case 'loseInfluence': E.resolveLoss(g, s, msg.cardIndex | 0); break;
    case 'consult':       E.resolveConsult(g, s, msg.keepIndices || []); break;
    default: return;
  }
  touch(room);
  pushState(room);
  if (g.phase === 'gameover') finishMatch(room);
}

// Host ends the match early (e.g. someone left mid-game).
function endMatch(room, userId) {
  if (room.hostId !== userId) throw new Error('Only the host can end the game');
  broadcast(room, { type: 'match_over', winnerSeat: null, winnerName: null, ended: true });
  room.status = 'finished';
  touch(room);
}

// Called when a subscriber's last connection drops during a live match.
// We don't remove them immediately — give a grace window to reconnect,
// and tell the table they've gone quiet so the host can decide to end.
function notePresence(room, userId, present) {
  if (room.status !== 'playing') return;
  const seat = room.seats && room.seats.find(s => s.id === userId);
  if (!seat) return;
  broadcast(room, { type: 'presence', seat: seat.seat, name: seat.name, present });
}

function finishMatch(room) {
  const g = room.state;
  const winnerSeat = g.winner;
  const winner = winnerSeat != null ? room.seats.find(s => s.seat === winnerSeat) : null;
  broadcast(room, { type: 'match_over', winnerSeat, winnerName: winner ? winner.name : null });
  room.status = 'finished';
  touch(room);
}

function subscribe(room, userId, res) {
  if (!room.subscribers.has(userId)) room.subscribers.set(userId, new Set());
  room.subscribers.get(userId).add(res);
}

function unsubscribe(room, userId, res) {
  const set = room.subscribers.get(userId);
  if (set) { set.delete(res); if (!set.size) room.subscribers.delete(userId); }
}

// perUser(event, userId) -> event | null lets a rules engine send each
// player a different (redacted) view, or skip them entirely.
function broadcast(room, event, perUser) {
  for (const [uid, set] of room.subscribers) {
    const ev = perUser ? perUser(event, uid) : event;
    if (!ev) continue;
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of set) {
      try { res.write(line); } catch (e) { /* dead connection; sweep handles it */ }
    }
  }
}

function touch(room) { room.updatedAt = Date.now(); }

function destroy(room) {
  broadcast(room, { type: 'room_closed' });
  for (const set of room.subscribers.values()) {
    for (const res of set) { try { res.end(); } catch (e) {} }
  }
  rooms.delete(room.code);
}

// Sweep idle rooms: 30 min in lobby, 2 h once playing
setInterval(() => {
  const now = Date.now();
  for (const r of [...rooms.values()]) {
    const idle = now - r.updatedAt;
    if ((r.status === 'lobby' && idle > 30 * 60e3) || (r.status !== 'lobby' && idle > 120 * 60e3)) {
      destroy(r);
    }
  }
}, 60e3).unref();

function stats() {
  return { rooms: rooms.size, playing: [...rooms.values()].filter(r => r.status === 'playing').length };
}

module.exports = {
  registerGame, createRoom, listPublic, get, join, leave, start,
  gameAction, aiAction, endMatch, notePresence, pushState,
  addAI, removeAI, chat, typing, subscribe, unsubscribe, broadcast, publicView, stats,
};
