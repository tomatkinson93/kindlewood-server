// lib/briar_engine.js — server-authoritative Briarwood Court.
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

// ── Personalities (§1.3) ──────────────────────────────────────────────
// Each courtier plays a distinct, learnable character, turning "the AI is
// predictable" into a metagame ("Whisper bluffs constantly — challenge her";
// "don't poke Thorn"). Traits:
//   aggression   — sting/banish eagerness
//   bluffRate    — multiplier on every bluff roll
//   suspicion    — multiplier on challenge chance
//   greed        — gather-over-forage & pilfer eagerness
//   targetTemp   — softmax τ for target selection (low = focused, high = spread)
//   vengefulness — grudge weight multiplier
const PERSONALITIES = {
  'Old Bracken': { aggression: 0.6,  bluffRate: 0.5, suspicion: 1.3, greed: 0.8, targetTemp: 3, vengefulness: 1.5 },
  'Sly Whisper': { aggression: 0.5,  bluffRate: 1.6, suspicion: 0.8, greed: 1.0, targetTemp: 8, vengefulness: 0.7 },
  'Marigold':    { aggression: 0.4,  bluffRate: 0.8, suspicion: 1.0, greed: 1.2, targetTemp: 6, vengefulness: 1.0 },
  'Thorn':       { aggression: 0.9,  bluffRate: 1.0, suspicion: 1.1, greed: 0.9, targetTemp: 4, vengefulness: 2.0 },
};
const NEUTRAL_PERSONALITY = { aggression: 0.6, bluffRate: 1.0, suspicion: 1.0, greed: 1.0, targetTemp: 5, vengefulness: 1.0 };

// ── Difficulty tiers (§1.9) ───────────────────────────────────────────
// 'simple'  — near-uniform targeting, no grudges/claim-memory, flat challenge
//             table, timid bluffs, personalities muted. Beginner-friendly.
// 'smart'   — everything in the spec at moderate constants (default).
// 'cunning' — sharper targeting, personalities amplified, bystander damper
//             relaxed, slightly bolder bluffs & challenges.
// `persona` is a blend factor applied to each trait (0 = neutral, 1 = nominal,
// >1 = amplified toward the character's extreme).
const DIFFICULTY = {
  simple:  { tempMul: 3.0, grudges: false, claimMemory: false, endgame: false, persona: 0.0, damper: 0.5,  bluffMul: 0.6, flatChallenge: true  },
  smart:   { tempMul: 1.0, grudges: true,  claimMemory: true,  endgame: true,  persona: 1.0, damper: 0.5,  bluffMul: 1.0, flatChallenge: false },
  cunning: { tempMul: 0.7, grudges: true,  claimMemory: true,  endgame: true,  persona: 1.4, damper: 0.65, bluffMul: 1.15, flatChallenge: false },
};
function _diff(g) { return DIFFICULTY[g.difficulty] || DIFFICULTY.smart; }

// Effective traits for player p under the current difficulty: blend the
// character's nominal trait toward neutral (simple) or past it (cunning).
function _persona(g, p) {
  const base = p.personality || NEUTRAL_PERSONALITY;
  const d = _diff(g);
  const f = d.persona;
  const mix = (v, neutral) => neutral + (v - neutral) * f;
  return {
    aggression:   mix(base.aggression, 0.6),
    bluffRate:    mix(base.bluffRate, 1.0) * d.bluffMul,
    suspicion:    mix(base.suspicion, 1.0),
    greed:        mix(base.greed, 1.0),
    targetTemp:   Math.max(0.5, mix(base.targetTemp, 5) * d.tempMul),
    vengefulness: mix(base.vengefulness, 1.0),
  };
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
    personality: { ...(PERSONALITIES[s.name] || NEUTRAL_PERSONALITY) }, // §1.3
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
  log(g, 'Briarwood Court convenes. Two acorns each — and two secrets.');
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
    if (alive[0]) log(g, `👑 ${alive[0].name} holds the last seat at the Briarwood Court!`);
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
  // The actor's hand legitimately changed, so their prior role-claims are stale
  // evidence (§1.5/§2.4): drop them, relieving this AI's own claim-consistency
  // pressure and clearing rivals' block-avoidance/suspicion reads on it.
  actor.claimedRoles = {};
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
// §1.4: instead of a fixed priority ladder (whose invariant ordering leaked
// hand information — "didn't sting ⇒ no Adder"), enumerate the legal actions,
// SCORE each on expected value minus bluff-risk minus block-likelihood plus
// personality, then sample among the best. There is no readable order to
// exploit, and bluff decisions are independent per candidate (no once-per-turn
// tell). Forced coup at ≥10 stays deterministic — it's a rule, not a choice.
function aiDecide(g) {
  const p = g.players[g.turn];
  if (g.phase !== 'action' || !p.isAI) return null;
  const rivals = living(g).filter(x => x !== p);
  if (!rivals.length) return { kind: 'action', action: 'forage' };
  const persona = _persona(g, p);
  const target = () => _sampleTarget(g, p, rivals, persona.targetTemp);

  // Forced coup: only banish is legal at ≥10 acorns.
  if (p.acorns >= 10) return { kind: 'action', action: 'banish', targetSeat: target().seat };

  // Enumerate legal candidates. Targeted actions draw an INDEPENDENT weighted
  // target (§1.1), so the banish and pilfer options can eye different seats.
  const cands = [{ action: 'forage' }, { action: 'gather' }, { action: 'decree' }, { action: 'consult' }];
  { const t = target(); if (t.acorns >= 1) cands.push({ action: 'pilfer', targetSeat: t.seat }); }
  if (p.acorns >= 3) { const t = target(); cands.push({ action: 'sting', targetSeat: t.seat }); }
  if (p.acorns >= 7) { const t = target(); cands.push({ action: 'banish', targetSeat: t.seat }); }

  for (const c of cands) c._score = _scoreAction(g, p, c, persona);
  cands.sort((a, b) => b._score - a._score);

  // Sample among the top-k (k=3) with a low temperature: usually the best,
  // sometimes the runner-up — enough noise to blur the read without playing
  // badly. 'cunning' picks sharper (lower temp).
  const temp = g.difficulty === 'cunning' ? 0.9 : 1.4;
  const chosen = _softmaxPick(g, cands.slice(0, 3), c => c._score, temp);
  return { kind: 'action', action: chosen.action, targetSeat: chosen.targetSeat };
}

// How much is holding `role` worth right now (§1.8)? Distinct from
// ROLE_SUSPICION (a challenge-weighting prior) — this is card VALUE, and it's
// context-sensitive: Elder income matters most early, Adder scales with your
// own gold, Hedgewitch with incoming Adder threat, Magpie with rivals' purses.
function _roleUtility(g, p, role) {
  const rivals = living(g).filter(x => x !== p);
  switch (role) {
    case 'elder':      return 3.3 - Math.min(1.6, (g.round - 1) * 0.2);              // income, front-loaded
    case 'adder':      return p.acorns >= 3 ? 3.4 : 2.0;                             // needs 3 to fire
    case 'hedgewitch': return 1.8 + (rivals.some(r => (r.claimedRoles['adder'] || 0) >= 1) ? 1.6 : 0)
                                  + Math.min(1.2, p.acorns * 0.1);                    // defense
    case 'magpie':     return 1.6 + (rivals.some(r => r.acorns >= 3) ? 1.2 : 0);     // scales with targets
    case 'owl':        return 2.2;                                                    // moderate flat
    default:           return 2.0;
  }
}

// Score a candidate action for aiDecide (§1.4/§1.5/§1.6). Units are loose
// "acorn-equivalents"; INF is the worth of one influence card.
const INF = 6;
function _scoreAction(g, p, cand, persona) {
  const A = ACTIONS[cand.action];
  const t = cand.targetSeat != null ? bySeat(g, cand.targetSeat) : null;
  const headsUp = _diff(g).endgame && living(g).length <= 2;
  let v = 0;

  switch (cand.action) {
    case 'forage': v = 1; break;
    case 'gather': v = 2 * (0.9 + 0.2 * persona.greed); break;      // greed leans gather over forage
    case 'decree': v = 3; break;
    case 'pilfer': {
      const take = t ? Math.min(2, t.acorns) : 0;
      v = take * (0.9 + 0.2 * persona.greed) + take * 0.3;          // gain + denial
      break;
    }
    case 'sting': {
      const cards = t ? t.cards.filter(c => !c.revealed).length : 0;
      v = INF * (cards === 2 ? 1.0 : 0.75) * (0.7 + 0.6 * persona.aggression);
      if (headsUp) v *= 1.25;                                        // race to close it out
      break;
    }
    case 'banish': {
      const cards = t ? t.cards.filter(c => !c.revealed).length : 0;
      v = INF * (cards === 2 ? 1.0 : 0.85) * (0.8 + 0.4 * persona.aggression) - 1.5; // costs a big pile
      if (headsUp) v *= 1.2;
      break;
    }
    case 'consult': {
      // Worth more when our hand is weak (a low-utility card to swap out).
      const worst = Math.min(...hidden(p).map(c => _roleUtility(g, p, c.role)));
      v = 1.6 + Math.max(0, 2.4 - worst);
      break;
    }
  }

  // Bluff risk (§1.4): claiming a role we don't hold invites a challenge.
  if (A.claim && !hasRole(p, A.claim)) {
    let look = 0;                                    // how bluffy it looks to the sharpest rival
    for (const r of living(g)) if (r !== p) look = Math.max(look, _bluffProb(g, r, p.seat, A.claim));
    v -= look * INF * 1.2;                            // expected card loss if called
    v -= (1 - persona.bluffRate) * 1.5;              // timid characters discount bluffing at all
    if (persona.bluffRate > 1) v += (persona.bluffRate - 1) * 1.0;  // bold ones lean in
  }

  // Block likelihood (§1.4): a standing claim to a blocking role wastes it.
  if (A.blockable) {
    const roles = Array.isArray(A.blockable) ? A.blockable : [A.blockable];
    const claimed = roles.some(role => living(g).some(r => r !== p && (r.claimedRoles[role] || 0) >= 1));
    if (claimed) v *= 0.5;
  }

  // Claim self-consistency / table image (§1.5): a fresh distinct claim
  // telegraphs serial bluffing; doubling down on an established one is credible.
  if (A.claim && _diff(g).claimMemory) {
    const timesClaimed = p.claimedRoles[A.claim] || 0;
    if (timesClaimed === 0) {
      const distinct = _distinctClaims(p);
      if (distinct >= 2) v -= 3.0;                   // 3rd+ distinct role
      else if (distinct === 1) v -= 1.2;             // 2nd distinct
    } else {
      v += 0.6;                                       // re-claiming — consistent, harder to read
    }
  }

  return v;
}

// Softmax pick over a small candidate list by score, with temperature `temp`
// (lower = greedier). Falls back to the first element on degenerate input.
function _softmaxPick(g, arr, scoreFn, temp) {
  if (!arr.length) return null;
  if (arr.length === 1) return arr[0];
  const t = Math.max(0.2, temp);
  const scores = arr.map(scoreFn);
  const max = Math.max(...scores);
  const weights = scores.map(s => Math.exp((s - max) / t));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let r = g.rng() * total;
  for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length - 1];
}

// Threat score from p's perspective (§1.1/§1.2/§1.6). Influence (hidden cards)
// dominates — knocking a 2-card player toward elimination is worth more than
// poking someone on 1; gold and coup-capability add; a rival one turn from
// coup range draws leader-denial heat; and a grudge p holds against x makes x
// more magnetic (visible, human-feeling retaliation), weighted by how vengeful
// p is. Exported as threatOf so the self-play harness measures the same notion.
function _threatOf(g, p, x) {
  const cards = x.cards.filter(c => !c.revealed).length;   // 1 or 2
  let s = cards * 10 + x.acorns;                            // influence-weighted
  if (x.acorns >= 7) s += 12;                               // can coup — dangerous
  if (x.acorns >= 10) s += 20;
  // Leader denial (§1.6): 5–6 acorns is one turn from coup range — spike it so
  // pilfer/sting gravitate there before they arm.
  if (_diff(g).endgame && x.acorns >= 5 && x.acorns <= 6) s += 8;
  const grudge = (p.grudges && p.grudges[x.seat]) || 0;   // remember aggressors
  if (grudge) s += grudge * _persona(g, p).vengefulness;
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
  if (!_diff(g).grudges) return;   // 'simple' keeps no grudge memory (§1.9)
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
  const d = _diff(g);
  // Simple difficulty: the original flat-ish behaviour, lightly damped.
  if (d.flatChallenge) {
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
  // Heads-up (§1.6), everything affects you and there's no one else to police
  // the table, so the damper relaxes toward ~0.75. Personality suspicion and
  // 'cunning' also lift it.
  const headsUp = living(g).length <= 2;
  const DAMP = headsUp ? Math.max(d.damper, 0.75) : d.damper;
  const suspicion = _persona(g, observer).suspicion;
  let chance = bluff * roundFactor * roleW * desperation * DAMP * suspicion;

  // BYSTANDER damping: if this action doesn't affect the observer (they're
  // not the target, and it isn't a table-wide grab), they have little reason
  // to risk a card policing it for someone else. Marigold won't usually
  // block a theft aimed at Thorn. Strongly damp unless the bluff is blatant.
  // 'cunning' polices the table a little more than 'smart'.
  const affectsMe = P && (P.targetSeat === observer.seat
    || P.action === 'decree' || P.action === 'gather'); // public-ish gains
  if (!affectsMe && desperation === 1) chance *= (g.difficulty === 'cunning' ? 0.4 : 0.25);

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
    const persona = _persona(g, p);
    const amTarget = g.pending.targetSeat === p.seat;
    const isGather = g.pending.action === 'gather';

    // Honest block: hold the role AND it's worth it — aimed at me, or a Gather
    // I specifically want to deny. Gather-denial scales with greed/aggression
    // and how far ahead the gatherer already is (§1.7).
    let gatherDeny = 0;
    if (isGather && have) {
      const actor = bySeat(g, g.pending.actorSeat);
      const lead = actor.acorns - p.acorns;
      gatherDeny = 0.12 * (persona.greed + persona.aggression) + Math.max(0, lead) * 0.03;
    }
    if (have && (amTarget || (isGather && g.rng() < gatherDeny))) return { blockRole: have };

    // Bluff a block: really only to save my own skin from a lethal Sting, and
    // rarely a Pilfer — scaled by personality bluffRate. When bluffing, claim
    // the most plausible legal role (§1.7), not always roles[0].
    let bluffBlock = 0;
    if (amTarget && g.pending.action === 'sting') bluffBlock = 0.28 * persona.bluffRate;
    else if (amTarget && g.pending.action === 'pilfer') bluffBlock = (g.difficulty === 'simple' ? 0.05 : 0.08) * persona.bluffRate;
    if (g.rng() < bluffBlock) return { blockRole: _pickBluffBlockRole(g, p, roles) };
    return { blockRole: null };
  }
  if (g.phase === 'loseInfluence') {
    const hiddenCards = p.cards.map((c, i) => ({ c, i })).filter(x => !x.c.revealed);
    if (hiddenCards.length <= 1) return { cardIndex: 0 };
    // Pair rule (§1.7): holding two of a role, reveal ONE of the pair — it
    // preserves the strongest claim (that role can still be shown).
    const byRole = {};
    for (const h of hiddenCards) (byRole[h.c.role] = byRole[h.c.role] || []).push(h);
    const pair = Object.values(byRole).find(list => list.length >= 2);
    if (pair) return { cardIndex: pair[0].i };
    // Else reveal the least valuable card by role-utility (§1.8).
    const val = h => _roleUtility(g, p, h.c.role);
    hiddenCards.sort((a, b) => val(a) - val(b));
    return { cardIndex: hiddenCards[0].i };
  }
  if (g.phase === 'consult') {
    // Keep the highest-UTILITY roles (§1.7/§1.8) — not ROLE_SUSPICION, which is
    // a challenge prior and would wrongly make the AI discard Owls. Utility is
    // context-sensitive (defensive Hedgewitch when Adders loom, Adder/Elder
    // when ahead), so no extra special-casing is needed here.
    const pool = g.pending.consultPool || [];
    const keep = g.pending.consultKeep || 1;
    const idx = pool.map((r, i) => ({ r, i }))
      .sort((a, b) => _roleUtility(g, p, b.r) - _roleUtility(g, p, a.r))
      .slice(0, keep).map(x => x.i);
    return { keepIndices: idx };
  }
  return null;
}

// When bluffing a block, claim the legal role least likely to be called out
// (lowest bluff-probability from any rival's view), with a little jitter (§1.7).
function _pickBluffBlockRole(g, p, roles) {
  if (roles.length === 1) return roles[0];
  let best = roles[0], bestLook = Infinity;
  for (const role of roles) {
    let look = g.rng() * 0.1;
    for (const r of living(g)) if (r !== p) look = Math.max(look, _bluffProb(g, r, p.seat, role));
    if (look < bestLook) { bestLook = look; best = role; }
  }
  return best;
}

// Which seats does the engine currently need input from? Returns the full set
// still owing a decision in this window: a single seat for action / consult /
// challengeBlock / loseInfluence, and every not-yet-responded eligible seat for
// challengeAction / block. Difficulty- and AI-agnostic — callers decide who is
// AI vs human. This is the single source of truth for "who's next", shared by
// the server AI tick, the decision timers, the solo client, and the self-play
// harness, so that logic can't drift across copies.
function pendingSeats(g) {
  const P = g.pending;
  switch (g.phase) {
    case 'action':         return [g.players[g.turn].seat];
    case 'loseInfluence':  return P ? [P.loserSeat] : [];
    case 'consult':        return P ? [P.actorSeat] : [];
    case 'challengeBlock': return P ? [P.actorSeat] : [];
    case 'challengeAction':
      return P ? living(g).filter(p => p.seat !== P.actorSeat && !(P.passes || []).includes(p.seat)).map(p => p.seat) : [];
    case 'block': {
      if (!P) return [];
      const bl = P.action === 'gather'
        ? living(g).filter(p => p.seat !== P.actorSeat && !(P.passes || []).includes(p.seat))
        : living(g).filter(p => p.seat === P.targetSeat);
      return bl.map(p => p.seat);
    }
    default: return [];
  }
}
// Convenience: the first seat owing a decision (or null).
function pendingSeat(g) { const s = pendingSeats(g); return s.length ? s[0] : null; }

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
  cur, living, ACTIONS, mulberry32, shuffle, pendingSeats, pendingSeat,
  threatOf: _threatOf, PERSONALITIES, DIFFICULTY,
};
