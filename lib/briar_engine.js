// lib/briar_engine.js — server-authoritative Briar Court.
//
// WHY THIS EXISTS: multiplayer Coup cannot be client-authoritative. The
// server holds the real hands and resolves every action; each client gets
// a REDACTED view (you never receive another live player's hidden cards).
// This is both correctness (one shared game) and anti-cheat (a client that
// knows everyone's cards is a client that cheats).
//
// MODEL: not an async loop — a phase state machine. The game advances only
// when the expected player sends the expected input. Phases:
//   'action'         — currentSeat must choose an action (+target)
//   'challengeAction'— any other living seat may challenge the role claim
//   'block'          — the blocker(s) may block (or pass)
//   'challengeBlock' — the actor may challenge the block
//   'loseInfluence'  — a seat must pick which card to reveal
//   'consult'        — actor picks which cards to keep (Owl)
//   'gameover'
//
// AI seats are resolved by the host's tick (engine exposes aiDecide()).

const ROLES = ['elder', 'adder', 'magpie', 'owl', 'hedgewitch'];
const ACTIONS = {
  forage:  { cost: 0, claim: null,  targeted: false, blockable: null },
  gather:  { cost: 0, claim: null,  targeted: false, blockable: 'elder' }, // anyone blocks
  decree:  { cost: 0, claim: 'elder', targeted: false, blockable: null },
  pilfer:  { cost: 0, claim: 'magpie', targeted: true, blockable: ['magpie', 'owl'] },
  sting:   { cost: 3, claim: 'adder', targeted: true, blockable: ['hedgewitch'] },
  consult: { cost: 0, claim: 'owl',  targeted: false, blockable: null },
  banish:  { cost: 7, claim: null,  targeted: true, blockable: null },
};

// mulberry32 — small deterministic PRNG. Given the same 32-bit seed it emits
// the same 0..1 stream, so a whole match can be replayed from its seed
// (reproducible bug reports, deterministic self-play). Same call shape as
// Math.random.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// All engine randomness routes through an injectable RNG (g.rng) so a seeded
// match is fully reproducible. shuffle takes the rng explicitly because it
// also runs during create() before g exists.
function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function create(seats, opts) {
  const difficulty = (opts && opts.difficulty) || 'smart';
  const rng = (opts && opts.rng) || Math.random;
  // seats: [{ seat, id, name, isAI }]
  const deck = shuffle(ROLES.flatMap(r => [r, r, r]), rng);
  const players = seats.map(s => ({
    seat: s.seat, id: s.id, name: s.name, isAI: !!s.isAI,
    acorns: 2, alive: true,
    claimedRoles: {},   // role -> count of times they've claimed it (memory)
    grudges: {},        // seat -> retaliation score against past aggressors
    cards: [{ role: deck.pop(), revealed: false }, { role: deck.pop(), revealed: false }],
  }));
  const g = {
    deck, players, rng,
    turn: Math.floor(rng() * players.length), // randomized first player
    round: 1,
    actionsThisGame: 0,
    difficulty,
    seed: (opts && opts.seed != null) ? opts.seed : null,
    phase: 'action',
    pending: null,   // { action, actorSeat, targetSeat, claim, ... }
    log: [],
    winner: null,
  };
  log(g, 'The Briar Court convenes. Two acorns each — and two secrets.');
  log(g, `${cur(g).name} opens the Court.`);
  return g;
}

const cur = g => g.players[g.turn];
const bySeat = (g, s) => g.players.find(p => p.seat === s);
const living = g => g.players.filter(p => p.alive);
const hidden = p => p.cards.filter(c => !c.revealed);
const hasRole = (p, r) => p.cards.some(c => !c.revealed && c.role === r);
function log(g, m) { g.log.push(m); if (g.log.length > 40) g.log.shift(); }

function nextTurn(g) {
  if (checkWin(g)) return;
  g.actionsThisGame++;
  // A "round" is one full lap of the living players.
  if (g.actionsThisGame % Math.max(1, living(g).length) === 0) g.round++;
  do { g.turn = (g.turn + 1) % g.players.length; } while (!g.players[g.turn].alive);
  // Grudges cool off: each time play returns to a seat, its stored grievances
  // fade (×0.8), so retaliation is recent-weighted rather than eternal.
  _decayGrudges(g.players[g.turn]);
  g.phase = 'action';
  g.pending = null;
}

function checkWin(g) {
  const alive = living(g);
  if (alive.length <= 1) {
    g.winner = alive[0] ? alive[0].seat : null;
    g.phase = 'gameover';
    if (alive[0]) log(g, `👑 ${alive[0].name} holds the last seat at the Briar Court!`);
    return true;
  }
  return false;
}

function recycle(g, p, role) {
  const card = p.cards.find(c => !c.revealed && c.role === role);
  if (!card) return;
  g.deck.push(card.role);
  shuffle(g.deck, g.rng);
  card.role = g.deck.pop();   // proven card returns; they redraw an unknown
}

function loseInfluence(g, p, why) {
  const h = hidden(p);
  if (!h.length) return false;
  if (h.length > 1) {
    g.phase = 'loseInfluence';
    g.pending = { ...(g.pending || {}), loserSeat: p.seat, why };
    return true; // needs a choice
  }
  reveal(g, p, h[0]);
  return false;
}
function reveal(g, p, card) {
  card.revealed = true;
  log(g, `${p.name} loses influence — the ${cap(card.role)} is revealed.`);
  if (!hidden(p).length) { p.alive = false; log(g, `🍂 ${p.name} is cast out of the Court.`); }
}
const cap = r => r.charAt(0).toUpperCase() + r.slice(1);

// ── Action declaration ──
function doAction(g, seat, action, targetSeat) {
  if (g.phase !== 'action' || g.turn !== g.players.findIndex(p => p.seat === seat)) return false;
  const A = ACTIONS[action];
  if (!A) return false;
  const actor = bySeat(g, seat);
  if (actor.acorns >= 10 && action !== 'banish') return false; // forced coup
  if (A.cost > actor.acorns) return false;
  if (A.targeted) { const t = bySeat(g, targetSeat); if (!t || !t.alive || t === actor) return false; }

  actor.acorns -= A.cost;
  g.pending = { action, actorSeat: seat, targetSeat: A.targeted ? targetSeat : null,
                claim: A.claim, passes: [] };
  const tName = A.targeted ? ` on ${bySeat(g, targetSeat).name}` : '';
  log(g, `${actor.name} declares ${cap(action)}${tName}.`);
  if (A.claim) _recordClaim(actor, A.claim);

  if (A.claim) { g.phase = 'challengeAction'; }
  else if (A.blockable && _blockers(g).length > 0) { g.phase = 'block'; }
  else { resolve(g); }
  return true;
}

// ── Challenge of an action's role claim ──
// decision: { seat, challenge:bool }
function challengeAction(g, seat, challenge) {
  if (g.phase !== 'challengeAction') return false;
  const actor = bySeat(g, g.pending.actorSeat);
  const ch = bySeat(g, seat);
  if (!ch || !ch.alive || seat === actor.seat) return false;

  if (!challenge) {
    if (!g.pending.passes.includes(seat)) g.pending.passes.push(seat);
    // everyone else passed?
    const others = living(g).filter(p => p.seat !== actor.seat);
    if (g.pending.passes.length >= others.length) {
      const A = ACTIONS[g.pending.action];
      if (A.blockable && _blockers(g).length > 0) { g.phase = 'block'; g.pending.passes = []; }
      else resolve(g);
    }
    return true;
  }

  log(g, `${ch.name} challenges ${actor.name}'s claim to the ${cap(g.pending.claim)}!`);
  _grudge(g, actor, ch.seat, 4);   // being challenged breeds a grudge
  if (hasRole(actor, g.pending.claim)) {
    log(g, `${actor.name} reveals the ${cap(g.pending.claim)} — the challenge fails.`);
    recycle(g, actor, g.pending.claim);
    g._resume = 'postChallengeAction';
    if (!loseInfluence(g, ch, 'A failed challenge')) _afterChallengeAction(g);
  } else {
    log(g, `${actor.name} was bluffing!`);
    g._resume = 'bluffCaught';
    if (!loseInfluence(g, actor, 'Caught bluffing')) nextTurn(g);
  }
  return true;
}
function _afterChallengeAction(g) {
  const A = ACTIONS[g.pending.action];
  if (A.blockable && _blockers(g).length > 0) { g.phase = 'block'; g.pending.passes = []; }
  else resolve(g);
}

// ── Block ──  decision: { seat, blockRole|null }
function block(g, seat, blockRole) {
  if (g.phase !== 'block') return false;
  const A = ACTIONS[g.pending.action];
  const actor = bySeat(g, g.pending.actorSeat);
  const eligible = _blockers(g);
  const p = bySeat(g, seat);
  if (!eligible.some(e => e.seat === seat)) return false;

  if (!blockRole) {
    if (!g.pending.passes.includes(seat)) g.pending.passes.push(seat);
    if (g.pending.passes.length >= eligible.length) resolve(g); // nobody blocked
    return true;
  }
  const allowed = Array.isArray(A.blockable) ? A.blockable : [A.blockable];
  if (!allowed.includes(blockRole)) return false;

  g.pending.blockerSeat = seat;
  g.pending.blockRole = blockRole;
  g.phase = 'challengeBlock';
  log(g, `${p.name} claims the ${cap(blockRole)} to block!`);
  _recordClaim(p, blockRole);
  return true;
}
function _blockers(g) {
  const A = ACTIONS[g.pending.action];
  if (g.pending.action === 'gather') return living(g).filter(p => p.seat !== g.pending.actorSeat);
  if (A.targeted) { const t = bySeat(g, g.pending.targetSeat); return t && t.alive ? [t] : []; }
  return [];
}

// ── Challenge of a block ──  decision: { challenge:bool }  (only actor decides)
function challengeBlock(g, seat, challenge) {
  if (g.phase !== 'challengeBlock' || seat !== g.pending.actorSeat) return false;
  const actor = bySeat(g, g.pending.actorSeat);
  const blocker = bySeat(g, g.pending.blockerSeat);
  if (!challenge) {
    log(g, 'The block stands.');
    nextTurn(g);
    return true;
  }
  log(g, `${actor.name} challenges the block!`);
  _grudge(g, blocker, actor.seat, 4);   // the challenged blocker resents it
  if (hasRole(blocker, g.pending.blockRole)) {
    log(g, `${blocker.name} truly holds the ${cap(g.pending.blockRole)}.`);
    recycle(g, blocker, g.pending.blockRole);
    g._resume = 'blockStands';
    if (!loseInfluence(g, actor, 'A failed challenge')) nextTurn(g);
  } else {
    log(g, `${blocker.name} was bluffing the block!`);
    g._resume = 'blockBroken';
    if (!loseInfluence(g, blocker, 'Caught bluffing')) resolve(g);
  }
  return true;
}

// ── Resolve the action's effect (all challenge/block windows passed) ──
function resolve(g) {
  const { action, actorSeat, targetSeat } = g.pending;
  const actor = bySeat(g, actorSeat);
  const target = targetSeat != null ? bySeat(g, targetSeat) : null;
  // A dead target voids sting/banish (no influence left to take), but a PILFER
  // still collects the acorns — being eliminated by a failed challenge doesn't
  // refund the gold the actor rightfully earned.
  if (target && !target.alive && ['sting', 'banish'].includes(action)) { nextTurn(g); return; }

  switch (action) {
    case 'forage': actor.acorns += 1; break;
    case 'gather': actor.acorns += 2; break;
    case 'decree': actor.acorns += 3; break;
    case 'pilfer': { const take = Math.min(2, target.acorns); target.acorns -= take; actor.acorns += take;
      log(g, `${actor.name} pilfers ${take} from ${target.name}.`); _grudge(g, target, actorSeat, 3); break; }
    case 'sting': _grudge(g, target, actorSeat, 6); g._resume = 'afterEffect'; if (loseInfluence(g, target, 'The Adder strikes')) return; break;
    case 'banish': _grudge(g, target, actorSeat, 6); g._resume = 'afterEffect'; if (loseInfluence(g, target, 'Banished')) return; break;
    case 'consult': {
      const drawn = [g.deck.pop(), g.deck.pop()].filter(Boolean);
      g.pending.consultPool = [...hidden(actor).map(c => c.role), ...drawn];
      g.pending.consultKeep = hidden(actor).length;
      g.phase = 'consult';
      return;
    }
  }
  nextTurn(g);
}

// ── loseInfluence resolution ──  decision: { seat, cardIndex }
function resolveLoss(g, seat, cardIndex) {
  if (g.phase !== 'loseInfluence' || g.pending.loserSeat !== seat) return false;
  const p = bySeat(g, seat);
  const h = hidden(p);
  reveal(g, p, h[Math.max(0, Math.min(h.length - 1, cardIndex | 0))]);
  _resumeAfterLoss(g);
  return true;
}
function _resumeAfterLoss(g) {
  const r = g._resume; g._resume = null;
  if (r === 'bluffCaught' || r === 'blockStands') { nextTurn(g); return; }
  if (r === 'postChallengeAction') { _afterChallengeAction(g); return; }
  if (r === 'blockBroken') { resolve(g); return; }
  if (r === 'afterEffect') { nextTurn(g); return; }
  nextTurn(g);
}

// ── Owl consult resolution ── decision: { seat, keepIndices:[...] }
function resolveConsult(g, seat, keepIndices) {
  if (g.phase !== 'consult' || g.pending.actorSeat !== seat) return false;
  const actor = bySeat(g, seat);
  const pool = g.pending.consultPool;
  const need = g.pending.consultKeep;

  // Sanitize the requested indices (§2.1): unique, integer, in-range POOL
  // indices, capped at `need`. A tampered client sending e.g. [0,0] must not
  // be able to keep two copies of one pool card — that would inject a 4th
  // copy of a role into play and corrupt the copies-left math everywhere.
  const chosen = [];
  const used = new Set();
  for (const raw of (keepIndices || [])) {
    const i = raw | 0;
    if (i < 0 || i >= pool.length || used.has(i)) continue;
    used.add(i);
    chosen.push(i);
    if (chosen.length >= need) break;
  }
  // Fill any shortfall from the remaining pool indices BY INDEX (never by role
  // value — the pool can legitimately hold duplicate roles, so matching on
  // role would under-fill and silently lose a card).
  for (let i = 0; i < pool.length && chosen.length < need; i++) {
    if (!used.has(i)) { used.add(i); chosen.push(i); }
  }

  const keepRoles = chosen.map(i => pool[i]);
  const h = hidden(actor);
  h.forEach((c, i) => { if (i < keepRoles.length) c.role = keepRoles[i]; });
  // Everything not kept returns to the deck. `used` now holds exactly the kept
  // indices, so the complement is unambiguous — no card is duplicated or lost.
  pool.forEach((r, i) => { if (!used.has(i)) g.deck.push(r); });
  shuffle(g.deck, g.rng);
  log(g, `${actor.name} consults the Owl and rearranges their secrets.`);
  nextTurn(g);
}

// Per-seat reaction status for the current window, for UI tinting:
//  'passed'      — declined to challenge/block (green tick)
//  'challenging' — actively challenging (purple)
//  'blocking'    — claiming a block (blue)
//  null          — still deciding / not their window
function _reactionFor(g, seat) {
  const P = g.pending;
  if (!P) return null;
  if ((g.phase === 'challengeAction' || g.phase === 'block') && (P.passes || []).includes(seat)) return 'passed';
  if (g.phase === 'challengeBlock' && P.blockerSeat === seat) return 'blocking';
  if (g.phase === 'block' && P.blockerSeat === seat) return 'blocking';
  return null;
}

// ── REDACTED per-player view ── never leak others' hidden cards
function view(g, forId) {
  return {
    phase: g.phase,
    turn: g.turn,
    turnSeat: g.players[g.turn] ? g.players[g.turn].seat : null,
    winner: g.winner,
    log: g.log.slice(-14),
    pending: g.pending ? {
      action: g.pending.action, actorSeat: g.pending.actorSeat,
      targetSeat: g.pending.targetSeat, claim: g.pending.claim,
      passes: (g.pending.passes || []).slice(),
      blockerSeat: g.pending.blockerSeat, blockRole: g.pending.blockRole,
      loserSeat: g.pending.loserSeat,
      // Owl pool is shown only to the consulting player
      consultPool: (g.phase === 'consult' && bySeat(g, g.pending.actorSeat).id === forId)
        ? g.pending.consultPool : undefined,
      consultKeep: g.pending.consultKeep,
    } : null,
    players: g.players.map(p => ({
      seat: p.seat, id: p.id, name: p.name, isAI: p.isAI,
      acorns: p.acorns, alive: p.alive,
      reaction: _reactionFor(g, p.seat),
      cards: p.cards.map(c => (c.revealed || p.id === forId)
        ? { role: c.role, revealed: c.revealed }
        : { role: null, revealed: false }),   // hidden from others
    })),
  };
}

// ── AI decision (host resolves AI seats locally, sends as their action) ──
function aiDecide(g) {
  const p = g.players[g.turn];
  if (g.phase !== 'action' || !p.isAI) return null;
  const rivals = living(g).filter(x => x !== p);
  if (!rivals.length) return { kind: 'action', action: 'forage' };

  // Weighted target selection (§1.1): sample rivals by threat via softmax with
  // a per-difficulty temperature τ, plus a floor so no rival is ever provably
  // safe. This replaces the old deterministic argmax, which let a human
  // sandbag under the leader and *guarantee* they were never targeted. Each
  // targeted action draws INDEPENDENTLY, so the banish target and a fallback
  // pilfer target needn't be the same seat.
  // Softmax temperature: 'simple' plays near-uniform (beginner-friendly, no
  // reliable "who will it hit" read), 'smart' concentrates on real threats.
  // Full per-personality τ arrives with §1.3.
  const tau = g.difficulty === 'simple' ? 25 : 4;
  const target = () => _sampleTarget(g, p, rivals, tau);

  const bluffOK = g.rng() < (g.round === 1 ? 0.12 : 0.3);

  // Has any rival CLAIMED a role that would block `action`? If so the play
  // will likely be wasted (they'll just block again) — avoid it unless we're
  // willing to challenge. This is the "don't keep walking into the same
  // block" instinct: if someone keeps blocking Gather as Elder, stop
  // Gathering and do something unblockable instead.
  const someoneClaims = role => rivals.some(r => (r.claimedRoles[role] || 0) >= 1);
  const gatherBlocked = someoneClaims('elder');       // Elder blocks Gather
  const pilferBlocked = someoneClaims('magpie') || someoneClaims('owl');

  // Forced / strong coup — the target is sampled, not always the top threat.
  if (p.acorns >= 10) return { kind: 'action', action: 'banish', targetSeat: target().seat };
  if (p.acorns >= 7 && g.rng() < 0.85) return { kind: 'action', action: 'banish', targetSeat: target().seat };

  // Sting if we hold Adder (or brave bluff) AND the sampled target hasn't
  // claimed Hedgewitch (which would block it).
  if (p.acorns >= 3 && (hasRole(p, 'adder') || (bluffOK && g.rng() < 0.4))) {
    const t = target();
    if ((t.claimedRoles['hedgewitch'] || 0) < 1)
      return { kind: 'action', action: 'sting', targetSeat: t.seat };
  }

  // Decree (Elder) is unblockable — prefer it when Gather is being blocked
  if (hasRole(p, 'elder') || (bluffOK && g.rng() < (gatherBlocked ? 0.65 : 0.5)))
    return { kind: 'action', action: 'decree' };

  // Pilfer only if no rival has claimed a Pilfer-blocking role, and the sampled
  // target actually holds acorns worth taking.
  if (hasRole(p, 'magpie') && !pilferBlocked && g.rng() < 0.75) {
    const t = target();
    if (t.acorns >= 2) return { kind: 'action', action: 'pilfer', targetSeat: t.seat };
  }

  if (hasRole(p, 'owl') && g.rng() < 0.25) return { kind: 'action', action: 'consult' };

  // Fall-through: Gather (2) vs Forage (1). Gather is only blockable by an
  // Elder. Work out whether a blocking Elder can even still exist among rivals:
  // count Elders we can see (our hidden cards + all revealed) — if all 3 are
  // accounted for, Gather is 100% safe and we should always take the 2.
  let eldersSeen = p.cards.filter(c => !c.revealed && c.role === 'elder').length;
  for (const pl of g.players) eldersSeen += pl.cards.filter(c => c.revealed && c.role === 'elder').length;
  const elderImpossible = eldersSeen >= 3;          // no hidden Elder can remain
  const noRivalClaimedElder = !someoneClaims('elder');

  if (elderImpossible) return { kind: 'action', action: 'gather' };   // always safe
  // If nobody has claimed Elder, Gather is very likely safe — be greedy.
  if (noRivalClaimedElder) return { kind: 'action', action: 'gather' };
  // An Elder has been claimed and could be real: Forage safe, but sometimes
  // Gather anyway to avoid being bullied out of income every turn.
  return g.rng() < 0.35 ? { kind: 'action', action: 'gather' } : { kind: 'action', action: 'forage' };
}

// Threat score from p's perspective (§1.1/§1.2). Influence (hidden cards)
// dominates — knocking a 2-card player toward elimination is worth more than
// poking someone on 1; gold and coup-capability add; and a grudge p holds
// against x makes x more magnetic (visible, human-feeling retaliation).
function _threatOf(g, p, x) {
  const cards = x.cards.filter(c => !c.revealed).length;   // 1 or 2
  let s = cards * 10 + x.acorns;                            // influence-weighted
  if (x.acorns >= 7) s += 12;                               // can coup — dangerous
  if (x.acorns >= 10) s += 20;
  s += (p.grudges && p.grudges[x.seat]) || 0;              // remember aggressors
  return s;
}

// Softmax-with-floor sampling over rivals by threat (§1.1). Temperature τ
// controls sharpness: low τ ≈ argmax (nearly always the top threat), high τ ≈
// uniform. Every rival keeps a minimum share (5%) so none is provably safe.
function _sampleTarget(g, p, rivals, tau) {
  if (rivals.length === 1) return rivals[0];
  const t = Math.max(0.5, tau);
  const scores = rivals.map(x => _threatOf(g, p, x));
  const max = Math.max(...scores);
  const weights = scores.map(s => Math.exp((s - max) / t));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const floor = 0.05;                          // minimum probability per rival
  const spread = 1 - floor * rivals.length;    // remainder shared out by weight
  let r = g.rng();
  for (let i = 0; i < rivals.length; i++) {
    r -= floor + (spread > 0 ? spread * (weights[i] / total) : 0);
    if (r <= 0) return rivals[i];
  }
  return rivals[rivals.length - 1];
}

function _recordClaim(p, role) {
  p.claimedRoles[role] = (p.claimedRoles[role] || 0) + 1;
}

// ── Grudge memory (§1.2) ──────────────────────────────────────────────
// Grudges live in engine state (never exposed via view()) so they survive
// the redaction boundary. A victim remembers who struck at them; that memory
// feeds _threatOf so retaliation looks human ("Thorn came after me because I
// stung him") and organically breaks the "always the richest" pattern.
function _grudge(g, victim, againstSeat, amt) {
  if (!victim || victim.seat === againstSeat) return;
  victim.grudges = victim.grudges || {};
  victim.grudges[againstSeat] = (victim.grudges[againstSeat] || 0) + amt;
}
function _decayGrudges(p) {
  if (!p || !p.grudges) return;
  for (const k of Object.keys(p.grudges)) {
    p.grudges[k] *= 0.8;
    if (p.grudges[k] < 0.5) delete p.grudges[k];
  }
}

// How many DISTINCT roles has this player claimed? Someone juggling many
// different role-claims is likelier to be bluffing at least one.
function _distinctClaims(p) { return Object.keys(p.claimedRoles).length; }

// ── AI REASONING ──────────────────────────────────────────────────────
// How likely is a claimed `role` to be a BLUFF, from `observer`'s seat?
// There are 3 of each role. The observer accounts for: its own hidden
// cards of that role, and every revealed card of that role anywhere.
// The claimant holds (typically) 2 hidden cards; we estimate the chance
// at least one is the claimed role given how many copies are unseen.
function _bluffProb(g, observer, claimantSeat, role) {
  const claimant = bySeat(g, claimantSeat);
  let accounted = 0;
  // observer's own hidden copies
  accounted += observer.cards.filter(c => !c.revealed && c.role === role).length;
  // all revealed copies, table-wide
  for (const pl of g.players)
    accounted += pl.cards.filter(c => c.revealed && c.role === role).length;
  const copiesLeft = Math.max(0, 3 - accounted);     // could be in unseen hands/deck
  if (copiesLeft === 0) return 0.97;                  // all 3 visible elsewhere → almost surely a bluff

  // Unseen cards = deck + every other hidden card the observer can't see.
  let unseen = g.deck.length;
  for (const pl of g.players) {
    if (pl === observer) continue;
    unseen += pl.cards.filter(c => !c.revealed).length;
  }
  unseen = Math.max(1, unseen);
  const claimantHidden = claimant.cards.filter(c => !c.revealed).length || 1;
  // P(claimant has >=1 of the role) ≈ 1 - C(unseen-copiesLeft, hidden)/C(unseen, hidden)
  let pHasNone = 1;
  for (let i = 0; i < claimantHidden; i++) {
    pHasNone *= (unseen - copiesLeft - i) / (unseen - i);
    if (pHasNone < 0) { pHasNone = 0; break; }
  }
  const pHas = 1 - Math.max(0, pHasNone);
  return 1 - pHas;   // bluff probability
}

// Per-role suspicion multiplier: a false Elder (Decree, +3) is a juicy,
// common bluff; a false Owl (Consult) is rarely worth lying about, so
// challenging it is less rewarding. Tuned, not derived.
const ROLE_SUSPICION = { elder: 1.15, adder: 1.05, magpie: 1.0, owl: 0.7, hedgewitch: 0.95 };

function _aiChallengeDecision(g, observer, claimantSeat, role) {
  // Simple difficulty: the original flat-ish behaviour, lightly damped.
  if (g.difficulty === 'simple') {
    let n = observer.cards.filter(c => !c.revealed && c.role === role).length;
    for (const pl of g.players) n += pl.cards.filter(c => c.revealed && c.role === role).length;
    const base = [0.08, 0.18, 0.4, 0.75][Math.min(n, 3)];
    return g.rng() < base;
  }

  let bluff = _bluffProb(g, observer, claimantSeat, role);

  // Claim memory: someone juggling many DIFFERENT role-claims is likely
  // bluffing at least one of them. Nudge suspicion up per distinct extra
  // claim. A repeated claim of the SAME role (already unchallenged) is a
  // touch more credible.
  const claimant = bySeat(g, claimantSeat);
  const distinct = _distinctClaims(claimant);
  if (distinct >= 2) bluff = Math.min(0.98, bluff + 0.12 * (distinct - 1));
  if ((claimant.claimedRoles[role] || 0) >= 2) bluff = Math.max(0, bluff - 0.1);

  // Round timidity: early on, humans feel things out — so do the AIs.
  const roundFactor = Math.min(1, 0.4 + 0.25 * (g.round - 1));

  // Role weighting
  const roleW = ROLE_SUSPICION[role] || 1;

  // Desperation: a player on their LAST card targeted by a lethal action
  // has nothing to lose by challenging.
  let desperation = 1;
  const hiddenLeft = observer.cards.filter(c => !c.revealed).length;
  const P = g.pending;
  const iAmTarget = P && P.targetSeat === observer.seat;
  const lethal = P && (P.action === 'sting' || P.action === 'banish');
  if (hiddenLeft === 1 && iAmTarget && lethal) desperation = 2.2;

  // GLOBAL DAMPER: only challenge when genuinely suspicious. Real players
  // let most claims slide; mutual challenge-suicide ends games too early.
  const DAMP = 0.5;
  let chance = bluff * roundFactor * roleW * desperation * DAMP;

  // BYSTANDER damping: if this action doesn't affect the observer (they're
  // not the target, and it isn't a table-wide grab), they have little reason
  // to risk a card policing it for someone else. Marigold won't usually
  // block a theft aimed at Thorn. Strongly damp unless the bluff is blatant.
  const affectsMe = P && (P.targetSeat === observer.seat
    || P.action === 'decree' || P.action === 'gather'); // public-ish gains
  if (!affectsMe && desperation === 1) chance *= 0.25;

  // Below a confidence floor, almost never challenge (let it ride).
  if (bluff < 0.5 && desperation === 1) chance *= 0.4;

  chance = Math.max(0.01, Math.min(0.9, chance));
  return g.rng() < chance;
}

function aiReact(g, seat) {
  const p = bySeat(g, seat);
  if (!p || !p.isAI) return null;

  if (g.phase === 'challengeAction') {
    return { challenge: _aiChallengeDecision(g, p, g.pending.actorSeat, g.pending.claim) };
  }
  if (g.phase === 'challengeBlock') {
    return { challenge: _aiChallengeDecision(g, p, g.pending.blockerSeat, g.pending.blockRole) };
  }
  if (g.phase === 'block') {
    const A = ACTIONS[g.pending.action];
    const roles = Array.isArray(A.blockable) ? A.blockable : [A.blockable];
    const have = roles.find(r => hasRole(p, r));
    // Block honestly if able; bluff a block occasionally, more so if the
    // action is lethal and they're the target.
    // Bystander logic: only the TARGET of a steal/sting has reason to block.
    // For Gather (table-wide), a bystander Elder-block is almost never worth
    // a card, so don't bluff it. Block honestly if holding the role and it
    // affects you; bluff-block only a lethal Sting aimed at you.
    const amTarget = g.pending.targetSeat === p.seat;
    const isGather = g.pending.action === 'gather';
    let bluffBlock = 0;
    if (amTarget && g.pending.action === 'sting') bluffBlock = 0.28;     // save my own skin
    else if (amTarget && g.pending.action === 'pilfer') bluffBlock = g.difficulty === 'simple' ? 0.05 : 0.08;
    // Honest block: use a real role if I hold it AND it's worth it (mine, or
    // a Gather I specifically want to deny — rare).
    const honest = have && (amTarget || (isGather && g.rng() < 0.25));
    return { blockRole: honest ? have : (g.rng() < bluffBlock ? roles[0] : null) };
  }
  if (g.phase === 'loseInfluence') {
    // Lose the less useful card: keep a role we hold a pair of, else keep
    // the higher-suspicion (more bluffable) role. Reveal the other.
    const hidden = p.cards.map((c, i) => ({ c, i })).filter(x => !x.c.revealed);
    if (hidden.length <= 1) return { cardIndex: 0 };
    const score = role => (ROLE_SUSPICION[role] || 1);
    hidden.sort((a, b) => score(a.c.role) - score(b.c.role)); // lowest value first
    return { cardIndex: hidden[0].i };  // reveal the least valuable
  }
  if (g.phase === 'consult') {
    // Keep the highest-value roles
    const pool = g.pending.consultPool || [];
    const keep = g.pending.consultKeep || 1;
    const idx = pool.map((r, i) => ({ r, i }))
      .sort((a, b) => (ROLE_SUSPICION[b.r] || 1) - (ROLE_SUSPICION[a.r] || 1))
      .slice(0, keep).map(x => x.i);
    return { keepIndices: idx };
  }
  return null;
}

// Single entry the host calls: given the seat the engine is waiting on,
// return that AI's decision for the current phase (or null).
function aiResolve(g, seat) {
  if (g.phase === 'action') {
    if (g.turn !== g.players.findIndex(p => p.seat === seat)) return null;
    return aiDecide(g);
  }
  const r = aiReact(g, seat);
  if (!r) return null;
  if (g.phase === 'challengeAction') return { kind: 'challengeAction', challenge: r.challenge };
  if (g.phase === 'challengeBlock') return { kind: 'challengeBlock', challenge: r.challenge };
  if (g.phase === 'block') return { kind: 'block', blockRole: r.blockRole };
  if (g.phase === 'loseInfluence') return { kind: 'loseInfluence', cardIndex: r.cardIndex };
  if (g.phase === 'consult') return { kind: 'consult', keepIndices: r.keepIndices };
  return null;
}

module.exports = {
  create, doAction, challengeAction, block, challengeBlock, aiResolve,
  resolveLoss, resolveConsult, view, aiDecide, aiReact,
  cur, living, ACTIONS, mulberry32, shuffle,
};
