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

const GAMES = {};          // gameType -> { name, minPlayers, maxPlayers }
const rooms = new Map();   // code -> room

function registerGame(type, def) { GAMES[type] = def; }

// ── Registered games ──
registerGame('briar', { name: 'The Briar Court', minPlayers: 2, maxPlayers: 6 });

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
function makeCode() {
  let c;
  do {
    c = Array.from(crypto.randomBytes(6)).map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  } while (rooms.has(c));
  return c;
}

function createRoom({ gameType, hostId, hostName, visibility, maxPlayers }) {
  const def = GAMES[gameType];
  if (!def) throw new Error('Unknown game type');
  const max = Math.max(def.minPlayers, Math.min(def.maxPlayers, parseInt(maxPlayers, 10) || def.maxPlayers));
  const room = {
    code: makeCode(),
    gameType,
    visibility: visibility === 'private' ? 'private' : 'public',
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
    players: room.players.map(p => ({ id: p.id, name: p.name })),
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

function start(room, userId) {
  if (room.hostId !== userId) throw new Error('Only the host can start the game');
  if (room.status !== 'lobby') throw new Error('Already started');
  const def = GAMES[room.gameType];
  if (room.players.length < def.minPlayers) throw new Error(`Need at least ${def.minPlayers} players`);
  room.status = 'playing';
  // Server assigns randomized seats once, so every client agrees
  room.seats = [...room.players]
    .sort(() => Math.random() - 0.5)
    .map((p, i) => ({ seat: i, id: p.id, name: p.name }));
  touch(room);
  broadcast(room, { type: 'match_started', gameType: room.gameType, seats: room.seats });
}

// Phase-2 seam: rebroadcast a client's game action stamped with their
// seat. The server-authoritative engine will replace this with real
// rule resolution + per-recipient redaction via broadcast()'s transform.
function relay(room, userId, payload) {
  const seat = room.seats ? room.seats.find(s => s.id === userId) : null;
  broadcast(room, { type: 'game_event', from: seat ? seat.seat : null, payload });
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
  registerGame, createRoom, listPublic, get, join, leave, start, relay,
  subscribe, unsubscribe, broadcast, publicView, stats,
};
