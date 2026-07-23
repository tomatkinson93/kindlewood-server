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
const squirrel = require('./squirrel_engine');

// Per-gameType engines. Add new server-authoritative games here.
const ENGINES = { briar, squirrel };

const GAMES = {};          // gameType -> { name, minPlayers, maxPlayers }
const rooms = new Map();   // code -> room

function registerGame(type, def) { GAMES[type] = def; }

// ── Registered games ──
registerGame('briar', { name: 'Briarwood Court', minPlayers: 2, maxPlayers: 6 });
registerGame('squirrel', { name: "Squirrel's Stash", minPlayers: 2, maxPlayers: 6 });

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
  const busy = activeRoomForUser(hostId);
  if (busy) throw new Error(`You're already in a game (table ${busy.code}). Leave it before hosting another.`);
  const max = Math.max(def.minPlayers, Math.min(def.maxPlayers, parseInt(maxPlayers, 10) || def.maxPlayers));
  const room = {
    code: makeCode(),
    gameType,
    visibility: visibility === 'private' ? 'private' : 'public',
    difficulty: ['simple', 'smart', 'cunning'].includes(difficulty) ? difficulty : 'smart',
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

// One active game per user (server-side, so it holds across devices/browsers,
// not just tabs). Returns the OTHER active room — a lobby they're seated in, or
// an in-progress game where they still hold a LIVE seat — or null. A seat that
// was handed to the AI after a disconnect (§3.3) no longer counts, so a
// replaced player is free to start fresh.
function _userInRoom(r, uid) {
  if (r.status === 'lobby') return r.players.some(p => !_isAI(p) && String(p.id) === uid);
  if (r.status === 'playing') { const seats = r.seats || r.players; return seats.some(s => !_isAI(s) && String(s.id) === uid); }
  return false;
}
function activeRoomForUser(userId, exceptCode) {
  const uid = String(userId);
  for (const r of rooms.values()) {
    if (exceptCode && r.code === exceptCode) continue;
    if (_userInRoom(r, uid)) return r;
  }
  return null;
}
// All active rooms this user holds a live seat in — for the "rejoin your game"
// list on the tavern screen.
function roomsForUser(userId) {
  const uid = String(userId);
  const out = [];
  for (const r of rooms.values()) if (_userInRoom(r, uid)) out.push(publicView(r));
  return out;
}

function join(room, user) {
  if (room.players.some(p => p.id === user.id)) { touch(room); return room; } // rejoin is fine
  const busy = activeRoomForUser(user.id, room.code);
  if (busy) throw new Error(`You're already in a game (table ${busy.code}). Leave it before joining another.`);
  if (room.status !== 'lobby') throw new Error('That game has already started');
  if (room.players.length >= room.maxPlayers) throw new Error('That room is full');
  room.players.push({ id: user.id, name: user.name });
  touch(room);
  broadcast(room, { type: 'lobby_update', room: publicView(room) });
  return room;
}

function leave(room, userId) {
  // During play, `seats` is canonical — don't mutate `players` (that desyncs
  // the two). Route a leave through the disconnect flow (§3.3) so the seat is
  // handed to the AI rather than vanishing mid-hand.
  if (room.status === 'playing') { markAbsent(room, userId); return; }
  room.players = room.players.filter(p => p.id !== userId);
  touch(room);
  // No players left at all → destroy.
  if (!room.players.length) { destroy(room); return; }
  // If only AI courtiers remain (no humans), there's no one to play — close
  // the lobby rather than leaving an orphaned AI-only room open.
  const humans = room.players.filter(p => !_isAI(p));
  if (!humans.length) { destroy(room); return; }
  if (room.hostId === userId) {
    room.hostId = humans[0].id;   // migrate host to a remaining human
  }
  broadcast(room, { type: 'lobby_update', room: publicView(room) });
}

// AI seats carry isAI:true (and an 'ai:'-prefixed id); humans do not.
function _isAI(p) { return !!(p && (p.isAI || (typeof p.id === 'string' && p.id.startsWith('ai')))); }

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
  // Seed a per-match PRNG so the whole game is reproducible from one number
  // (§2.5): the seat order and every engine roll derive from it. The seed is
  // logged so a bug report can be replayed ("room X, seed Y").
  const seed = crypto.randomBytes(4).readUInt32BE(0) >>> 0;
  const rng = briar.mulberry32(seed);
  room.seed = seed;
  // Server assigns randomized seats once, so every client agrees. Fisher–Yates
  // (§2.3) via the engine's shuffle — the old `.sort(() => rng-0.5)` was a
  // known-biased shuffle.
  const order = briar.shuffle([...room.players], rng);
  room.seats = order.map((p, i) => ({ seat: i, id: p.id, name: p.name, isAI: !!p.isAI }));

  // Spin up the server-authoritative engine (if this game has one), threading
  // in the seeded RNG so the match is fully deterministic.
  const engine = ENGINES[room.gameType];
  if (engine) {
    room.engine = engine;
    room.state = engine.create(room.seats, { difficulty: room.difficulty, rng, seed });
  }
  console.log(`[game_rooms] room ${room.code} start game=${room.gameType} seed=${seed}`);
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

// Cursor relay — broadcasts a player's normalized cursor position (0..1) so
// everyone can see each other's pointers fly around the table. Never echoed
// to self. Very lightweight; not persisted, not touch()'d (avoids bumping
// idle timers on mere mouse movement).
function cursor(room, userId, name, x, y) {
  broadcast(room, { type: 'cursor', userId, name, x, y },
    (ev, uid) => String(uid) === String(userId) ? null : ev);
}

// Push each connected player their own redacted view of the game state.
// deadlineAt (§3.2) is stamped at this layer, not in the engine's view(): the
// timer is a server/multiplayer concern (solo has no server clock), so the
// engine stays pure and dual-environment.
function pushState(room) {
  if (!room.engine || !room.state) return;
  _refreshDeadline(room);
  const deadlineAt = room.deadlineAt || null;
  const pause = _pauseInfo(room);
  broadcast(room, { type: 'game_state' }, (ev, uid) => ({
    type: 'game_state',
    state: { ...room.engine.view(room.state, uid), deadlineAt, pause },
  }));
}

// Apply a validated game action from a specific user, then push new state.
// The engine enforces turn/phase ownership; we only map userId -> seat and
// reject inputs from a user who isn't the seat the engine is waiting on.
function gameAction(room, userId, msg) {
  if (!room.engine || !room.state || room.status !== 'playing') return;
  if (_absentHumans(room).length) return;   // table paused for a disconnect
  const g = room.state;
  const seat = room.seats.find(s => s.id === userId);
  if (!seat) return;
  const s = seat.seat;
  _applyAction(room, g, s, msg);
  touch(room);
  pushState(room);
  if (g.phase === 'gameover') finishMatch(room);
}

// Dispatch an action to whichever engine this room runs.
function _applyAction(room, g, s, msg) {
  const E = room.engine;
  if (room.gameType === 'squirrel') {
    switch (msg.kind) {
      case 'draw':     E.draw(g, s); break;
      case 'bank':     E.bank(g, s); break;
      case 'squirrel': E.resolveSquirrel(g, s, msg.keepIndex | 0); break;
      case 'storm':    E.resolveStorm(g, s, msg.cardIndex | 0); break;
      case 'magpie':   E.resolveMagpie(g, s, msg.targetSeat, msg.cardIndex | 0); break;
      case 'foxdare':  E.resolveFoxDare(g, s, msg.targetSeat); break;
      case 'daredraw': E.dareDraw(g, s); break;
    }
    return;
  }
  // Briar
  switch (msg.kind) {
    case 'action':        E.doAction(g, s, msg.action, msg.targetSeat); break;
    case 'challengeAction': E.challengeAction(g, s, !!msg.challenge); break;
    case 'block':         E.block(g, s, msg.blockRole || null); break;
    case 'challengeBlock': E.challengeBlock(g, s, !!msg.challenge); break;
    case 'loseInfluence': E.resolveLoss(g, s, msg.cardIndex | 0); break;
    case 'consult':       E.resolveConsult(g, s, msg.keepIndices || []); break;
  }
}

// Which AI seat (if any) is the engine currently waiting on? Briar delegates
// to the engine's pendingSeats() (single source of truth); squirrel keeps its
// own per-phase logic for now.
function pendingAiSeat(room) {
  const g = room.state, E = room.engine;
  const seatIsAI = s => { const o = room.seats.find(x => x.seat === s); return o && o.isAI; };
  if (room.gameType === 'squirrel') {
    const P = g.pending;
    if (g.phase === 'turn') { const a = E.currentActor(g); return seatIsAI(a) ? a : null; }
    if (g.phase === 'squirrel' || g.phase === 'magpie' || g.phase === 'foxdare')
      return seatIsAI(P.actorSeat) ? P.actorSeat : null;
    if (g.phase === 'storm') {
      const pending = E.stormPending(g);
      const ai = pending.find(seatIsAI);
      return ai != null ? ai : null;
    }
    return null;
  }
  // Briar: first AI among the seats owing a decision this window.
  const ai = E.pendingSeats(g).find(seatIsAI);
  return ai != null ? ai : null;
}

function gameActionBySeat(room, s, msg) {
  _applyAction(room, room.state, s, msg);
  touch(room);
  pushState(room);
  if (room.state.phase === 'gameover') finishMatch(room);
}

// ── Server-side AI clock + decision timers (§3.1 / §3.2) ──────────────────
// A single in-process interval (mirroring the idle-sweep pattern already used
// below) advances every live room, so AI seats no longer depend on the host's
// browser POSTing /ai-action, and no decision window can stall forever on an
// AFK human. AI moves are jitter-paced (nextAiAt) so they don't feel instant.
const AI_TICK_MS = 1000;              // clock granularity (also the countdown resolution)
const AI_MIN_DELAY = 700;             // per-AI-move pacing floor (ms)
const AI_MAX_DELAY = 1600;            // per-AI-move pacing ceiling (ms)
const DISCONNECT_GRACE_MS = 30000;    // §3.3: grace before an absent seat becomes AI
const SQUIRREL_DECISION_TIMEOUT = 30000; // per-decision AFK timeout for Squirrel

// Per-phase human decision deadlines for Briar (ms). Squirrel is not covered
// yet — its default-action mapping would differ — so it keeps no timer.
const BRIAR_PHASE_TIMEOUT = {
  action:          75000,   // → auto-forage (never auto-coup a live turn)
  challengeAction: 30000,   // → auto-pass every seat that hasn't responded
  block:           30000,   // → auto-pass every eligible blocker
  challengeBlock:  25000,   // → auto-accept the block
  loseInfluence:   30000,   // → auto-reveal card index 0
  consult:         45000,   // → keep the first `need` pool indices
};

// A signature of the current decision window. It deliberately excludes the
// `passes` array so that AIs passing one-by-one through a challenge/block
// window does NOT keep resetting the human's countdown — only a real phase
// transition does.
function _phaseSig(g, gameType) {
  const P = g.pending || {};
  if (gameType === 'squirrel') {
    // A "decision" changes on each draw too (drawsThisTurn), so every draw
    // resets the 30s — the timer is per-decision, not just per-turn.
    const cur = g.players[g.turn] || {};
    const dare = g.dare || {};
    return ['sq', g.phase, g.turn, cur.drawsThisTurn, dare.victimSeat, dare.remaining, P.actorSeat, (P.resolved || []).length].join('|');
  }
  return [g.phase, g.turn, P.action, P.actorSeat, P.targetSeat, P.blockerSeat, P.loserSeat].join('|');
}

// Reset the deadline whenever the decision window changes. Called from
// pushState, so every state mutation keeps it current. Briar + Squirrel.
function _refreshDeadline(room) {
  const g = room.state;
  const timeout = room.gameType === 'briar'
    ? null   // per-phase table below
    : (room.gameType === 'squirrel' ? SQUIRREL_DECISION_TIMEOUT : 0);
  if ((room.gameType !== 'briar' && room.gameType !== 'squirrel') || !g || g.phase === 'gameover') {
    room.deadlineAt = null; room.phaseSig = 'none'; return;
  }
  const sig = _phaseSig(g, room.gameType);
  if (sig !== room.phaseSig) {
    room.phaseSig = sig;
    const ms = room.gameType === 'briar' ? (BRIAR_PHASE_TIMEOUT[g.phase] || 60000) : timeout;
    room.deadlineAt = Date.now() + ms;
  }
}

// Least-bad target for the forced-coup AFK edge (a player at ≥10 acorns can
// only banish — forage is illegal — so we must strike someone). Aim at the
// strongest rival, consistent with how a coup is normally used.
function _topRivalSeat(g, seat) {
  const rivals = g.players.filter(p => p.alive && p.seat !== seat);
  if (!rivals.length) return null;
  const score = x => x.cards.filter(c => !c.revealed).length * 10 + x.acorns;
  return rivals.reduce((a, b) => (score(b) > score(a) ? b : a), rivals[0]).seat;
}

// AFK default for Squirrel: play the idle actor's current decision exactly as
// the AI would (one step), then the deadline resets for the next decision. For
// the table-wide Storm, resolve every seat still pending.
function _enforceSquirrelTimeout(room) {
  const g = room.state, E = room.engine;
  if (g.phase === 'storm') {
    for (const s of E.stormPending(g)) { const a = E.aiResolve(g, s); if (a) gameActionBySeat(room, s, a); }
    return;
  }
  const seat = E.currentActor(g);
  if (seat == null) return;
  const a = E.aiResolve(g, seat);
  if (a) gameActionBySeat(room, seat, a);
}

// Enforce the current phase's default when its deadline passes.
function _enforceTimeout(room) {
  const g = room.state, E = room.engine;
  if (room.gameType === 'squirrel') { _enforceSquirrelTimeout(room); return; }
  const P = g.pending || {};
  switch (g.phase) {
    case 'action': {
      const seat = g.players[g.turn].seat;
      if (g.players[g.turn].acorns >= 10) {
        const t = _topRivalSeat(g, seat);           // forced coup: must banish
        if (t != null) E.doAction(g, seat, 'banish', t);
      } else {
        E.doAction(g, seat, 'forage');              // never auto-coup a live turn
      }
      break;
    }
    case 'challengeAction':
      for (const s of E.pendingSeats(g)) E.challengeAction(g, s, false);
      break;
    case 'block':
      for (const s of E.pendingSeats(g)) E.block(g, s, null);
      break;
    case 'challengeBlock':
      E.challengeBlock(g, P.actorSeat, false);      // accept the block
      break;
    case 'loseInfluence':
      E.resolveLoss(g, P.loserSeat, 0);
      break;
    case 'consult': {
      const need = P.consultKeep || 0;
      const idx = [];
      for (let i = 0; i < need; i++) idx.push(i);   // keep the first `need`
      E.resolveConsult(g, P.actorSeat, idx);
      break;
    }
    default: return;
  }
  touch(room);
  pushState(room);
  if (g.phase === 'gameover') finishMatch(room);
}

// One clock cycle: for each live room, either advance one AI decision (paced)
// or, if the room is waiting on a human past the deadline, apply the default.
function _serverTick() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== 'playing' || !room.engine || !room.state) continue;
    const g = room.state;
    if (g.phase === 'gameover') continue;
    try {
      // Disconnect handling (§3.3): while a human is absent the whole table is
      // PAUSED — no AI moves, no AFK timeout — so nobody plays on without them.
      // If others are still present, an absent seat past the 30s grace is handed
      // to the AI (which lifts the pause); if nobody else is present the game
      // just stays paused for the player to resume (no forfeit pressure).
      if (room.absent && room.absent.size) {
        const othersPresent = _presentHumans(room).length > 0;
        for (const [uid, entry] of room.absent) {
          if (!entry.converted && othersPresent && now - entry.since >= DISCONNECT_GRACE_MS) {
            _convertSeatToAI(room, uid, entry);
          }
        }
        if (_endIfNoHumans(room)) continue;          // last human gone → match ended
        if (_absentHumans(room).length) continue;    // still paused this cycle
      }
      const aiSeat = pendingAiSeat(room);
      if (aiSeat != null) {
        if (now >= (room.nextAiAt || 0)) {
          const decision = room.engine.aiResolve(g, aiSeat);
          if (decision) gameActionBySeat(room, aiSeat, decision);
          room.nextAiAt = now + AI_MIN_DELAY + Math.random() * (AI_MAX_DELAY - AI_MIN_DELAY);
        }
      } else if ((room.gameType === 'briar' || room.gameType === 'squirrel') && room.deadlineAt && now >= room.deadlineAt) {
        _enforceTimeout(room);
      }
    } catch (e) { /* a single wedged room must not stop the clock for others */ }
  }
}
setInterval(_serverTick, AI_TICK_MS).unref();

// Host ends the match early (e.g. someone left mid-game).
function endMatch(room, userId) {
  if (room.hostId !== userId) throw new Error('Only the host can end the game');
  broadcast(room, { type: 'match_over', winnerSeat: null, winnerName: null, ended: true });
  room.status = 'finished';
  touch(room);
}

// Host runs it back (§3.4): from a finished match, drop back to the lobby with
// the same table — keep AI seats and still-connected humans, discard everyone
// who left — and clear the engine so a fresh start() deals a new game.
function rematch(room, userId) {
  if (room.hostId !== userId) throw new Error('Only the host can start a rematch');
  if (room.status !== 'finished') throw new Error('No finished match to run back');
  const kept = room.players.filter(p => _isAI(p) || room.subscribers.has(p.id));
  if (kept.some(p => !_isAI(p))) room.players = kept;   // keep ≥1 human
  room.status = 'lobby';
  room.seats = null;
  room.state = null;
  room.engine = null;
  room.seed = null;
  room.deadlineAt = null;
  room.phaseSig = null;
  room.nextAiAt = 0;
  room.absent = null;
  // Host must be a still-connected human.
  const humans = room.players.filter(p => !_isAI(p));
  if (!humans.some(h => h.id === room.hostId)) room.hostId = humans[0] ? humans[0].id : room.hostId;
  touch(room);
  broadcast(room, { type: 'lobby_update', room: publicView(room) });
  return room;
}

// ── Disconnect handling (§3.3) ────────────────────────────────────────────
// During play, `seats` is canonical (never mutate `players`). When a human's
// last connection drops we flag the seat absent and start a grace window; the
// tick (above) converts it to AI on expiry so the table keeps moving. On
// reconnect within — or after — the grace, control is handed straight back.
// The engine doesn't care: seats are just ids with an isAI flag to it.

// Humans currently connected to a live match (non-AI seats with a subscriber).
function _presentHumans(room) {
  if (!room.seats) return [];
  return room.seats.filter(s => !_isAI(s) && room.subscribers.has(s.id));
}
// Absent humans still within the grace window (not yet handed to the AI).
function _absentHumans(room) {
  const out = [];
  if (room.absent) for (const [uid, e] of room.absent) if (!e.converted) out.push({ uid, ...e });
  return out;
}
// Pause descriptor for the pushed state: present while any human is absent. If
// others are still at the table it carries a resume deadline (the 30s grace);
// if nobody else is present (effectively solo) it just marks the game paused
// for resume, with no countdown/forfeit pressure.
function _pauseInfo(room) {
  const absent = _absentHumans(room);
  if (!absent.length) return null;
  const waiting = _presentHumans(room).length > 0;
  return {
    names: absent.map(e => e.name),
    waiting,
    resumeBy: waiting ? Math.min(...absent.map(e => e.since + DISCONNECT_GRACE_MS)) : null,
  };
}

// A human's last connection dropped mid-match.
function markAbsent(room, userId) {
  if (room.status !== 'playing') return;
  if (room.subscribers.has(userId)) return;         // already reconnected
  const seat = room.seats && room.seats.find(s => s.id === userId);
  if (!seat || seat.isAI) return;                   // not a live human seat
  room.absent = room.absent || new Map();
  if (!room.absent.has(userId)) {
    room.absent.set(userId, { seat: seat.seat, name: seat.name, since: Date.now(), converted: false });
    broadcast(room, { type: 'presence', seat: seat.seat, name: seat.name, present: false });
    pushState(room);   // push the paused state (with resume countdown) to the table
  }
  if (room.hostId === userId) _migrateHost(room, userId);
}

// A player (re)connected mid-match — cancel any pending grace and, if the seat
// was already handed to the AI, give it back.
function markPresent(room, userId) {
  const seat = room.seats && room.seats.find(s => s.id === userId);
  if (!seat || room.status !== 'playing') return;
  const entry = room.absent && room.absent.get(userId);
  if (entry && entry.forfeited) return;   // they chose to leave — no takebacks
  if (entry) {
    room.absent.delete(userId);
    if (entry.converted) {
      seat.isAI = false;
      const gp = room.state && room.state.players.find(p => p.seat === seat.seat);
      if (gp) gp.isAI = false;
      broadcast(room, { type: 'seat_restored', seat: seat.seat, name: seat.name });
    }
  }
  // Give the table a fresh decision window on resume — the AFK clock was
  // frozen during the pause, so don't let a stale deadline fire immediately.
  room.deadlineAt = null; room.phaseSig = null;
  broadcast(room, { type: 'presence', seat: seat.seat, name: seat.name, present: true });
  pushState(room);   // clear the paused overlay for everyone (and re-stamp the deadline)
}

// Grace expired: hand the seat to the AI (both the seat entry and the engine
// player), so pendingAiSeat/the tick drive it. Reversible via markPresent
// unless the seat was forfeited.
function _convertSeatToAI(room, userId, entry, message) {
  const seat = room.seats.find(s => s.id === userId);
  if (!seat) { room.absent.delete(userId); return; }
  seat.isAI = true;
  const gp = room.state && room.state.players.find(p => p.seat === seat.seat);
  if (gp) {
    gp.isAI = true;
    // Give a Briar takeover a random courtier personality (undisclosed to the
    // table) so the replacement plays with character rather than flatly.
    if (room.gameType === 'briar' && room.engine && room.engine.PERSONALITIES) {
      const names = Object.keys(room.engine.PERSONALITIES);
      if (names.length) gp.personality = { ...room.engine.PERSONALITIES[names[Math.floor(Math.random() * names.length)]] };
    }
  }
  entry.converted = true;
  broadcast(room, { type: 'seat_converted', seat: seat.seat, name: seat.name,
    message: message || `${seat.name} disconnected — an AI will play their hand.` });
  touch(room);
  pushState(room);   // clear the paused overlay; the tick now drives the AI seat
}

// Human seats still eligible to hold the game open: live (non-AI) seats plus
// paused humans who may still return (absent but not forfeited/converted).
function _humansRemain(room) {
  if (!room.seats) return false;
  if (room.seats.some(s => !_isAI(s))) return true;
  return _absentHumans(room).some(e => !e.forfeited);
}
// End a live match that has no human stakeholders left — an all-AI table with
// nobody watching should not keep playing (or be rejoinable).
function _endIfNoHumans(room) {
  if (room.status !== 'playing') return false;
  if (_humansRemain(room)) return false;
  broadcast(room, { type: 'match_over', winnerSeat: null, winnerName: null, ended: true });
  room.status = 'finished';
  room.deadlineAt = null; room.phaseSig = null;
  touch(room);
  return true;
}

// A player explicitly leaves an in-progress game (the tavern "Leave game"
// button). Unlike a disconnect this is a permanent forfeit: hand their seat to
// the AI right now (no grace, no takebacks). If they were the last human, the
// table has no audience left — end the match rather than play on all-AI.
function forfeit(room, userId) {
  if (room.status !== 'playing') { leave(room, userId); return; }
  const seat = room.seats && room.seats.find(s => s.id === userId);
  if (!seat || seat.isAI) return;
  room.absent = room.absent || new Map();
  let entry = room.absent.get(userId);
  if (!entry) { entry = { seat: seat.seat, name: seat.name, since: Date.now(), converted: false }; room.absent.set(userId, entry); }
  entry.forfeited = true;   // permanent — markPresent/roomsForUser won't bring them back
  if (room.hostId === userId) _migrateHost(room, userId);
  _convertSeatToAI(room, userId, entry, `${seat.name} left the game — an AI takes their seat.`);
  _endIfNoHumans(room);     // last human out → finish the match
}

// Host dropped mid-match — migrate to another connected human so /end and
// /rematch stay authorised. `seats` is canonical during play.
function _migrateHost(room, leavingId) {
  if (room.hostId !== leavingId) return;
  const cand = room.seats.find(s => !s.isAI && s.id !== leavingId
    && !(typeof s.id === 'string' && s.id.startsWith('ai')) && room.subscribers.has(s.id));
  if (cand) {
    room.hostId = cand.id;
    broadcast(room, { type: 'host_changed', hostId: cand.id });
  }
}

function finishMatch(room) {
  const g = room.state;
  const winnerSeat = g.winner;
  const winner = winnerSeat != null ? room.seats.find(s => s.seat === winnerSeat) : null;
  broadcast(room, { type: 'match_over', winnerSeat, winnerName: winner ? winner.name : null });
  room.status = 'finished';
  touch(room);
  // Record stats for every HUMAN seat (AI ids look like 'ai:...').
  try {
    const stats = require('./game_stats_store');
    const humanCount = room.seats.filter(s => !(typeof s.id === 'string' && s.id.startsWith('ai'))).length;
    const solo = humanCount <= 1;   // 1 human vs AI = single-player
    for (const s of room.seats) {
      if (typeof s.id === 'string' && s.id.startsWith('ai')) continue;
      // Pass solo so rankings can weight or separate solo vs multiplayer wins.
      stats.record(s.id, room.gameType, s.seat === winnerSeat, { solo }).catch(() => {});
    }
  } catch (e) { /* stats are best-effort */ }
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

// Live activity per game type for the tavern select screen (spec 19 §5.4).
// openTables = public lobbies still joinable; waiting = human players sitting
// in those lobbies; playing = matches currently in progress. Keyed by the
// server game-type so the client can map it straight onto KWGames.META.
function summary() {
  const out = {};
  for (const type of Object.keys(GAMES)) out[type] = { openTables: 0, waiting: 0, playing: 0 };
  for (const r of rooms.values()) {
    const s = out[r.gameType];
    if (!s) continue;
    if (r.status === 'playing') { s.playing++; continue; }
    if (r.status === 'lobby' && r.visibility === 'public' && r.players.length < r.maxPlayers) {
      s.openTables++;
      s.waiting += r.players.filter(p => !_isAI(p)).length;
    }
  }
  return out;
}

module.exports = {
  registerGame, createRoom, listPublic, get, join, leave, start,
  gameAction, endMatch, rematch, markAbsent, markPresent, pushState,
  // exposed for tests/observability (see scripts/room_tick_test.js)
  pendingAiSeat, _serverTick, _enforceTimeout, _refreshDeadline, _convertSeatToAI,
  addAI, removeAI, chat, typing, cursor, subscribe, unsubscribe, broadcast, publicView, stats, summary,
  activeRoomForUser, roomsForUser, forfeit,
};
