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

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function create(seats, opts) {
  const difficulty = (opts && opts.difficulty) || 'smart';
  // seats: [{ seat, id, name, isAI }]
  const deck = shuffle(ROLES.flatMap(r => [r, r, r]));
  const players = seats.map(s => ({
    seat: s.seat, id: s.id, name: s.name, isAI: !!s.isAI,
    acorns: 2, alive: true,
    cards: [{ role: deck.pop(), revealed: false }, { role: deck.pop(), revealed: false }],
  }));
  const g = {
    deck, players,
    turn: Math.floor(Math.random() * players.length), // randomized first player
    round: 1,
    actionsThisGame: 0,
    difficulty,
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
  shuffle(g.deck);
  card.role = g.deck.pop();   // proven card returns; they redraw an unknown
}

function loseInfluence(g, p, why) {
  const h = hidden(p);
  if (!h.length) return false;
  if (h.length > 1) {
    g.phase = 'loseInfluence';
    g.pending = { ...(g.pending || {}), loserSeat: p.seat, why, resume: g._resume || null };
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
  if (target && !target.alive && ['pilfer', 'sting', 'banish'].includes(action)) { nextTurn(g); return; }

  switch (action) {
    case 'forage': actor.acorns += 1; break;
    case 'gather': actor.acorns += 2; break;
    case 'decree': actor.acorns += 3; break;
    case 'pilfer': { const take = Math.min(2, target.acorns); target.acorns -= take; actor.acorns += take;
      log(g, `${actor.name} pilfers ${take} from ${target.name}.`); break; }
    case 'sting': g._resume = 'afterEffect'; if (loseInfluence(g, target, 'The Adder strikes')) return; break;
    case 'banish': g._resume = 'afterEffect'; if (loseInfluence(g, target, 'Banished')) return; break;
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
  const keep = (keepIndices || []).slice(0, need).map(i => pool[i]).filter(Boolean);
  while (keep.length < need) keep.push(pool.find(r => !keep.includes(r)) || pool[0]);
  const h = hidden(actor);
  h.forEach((c, i) => { c.role = keep[i]; });
  pool.forEach((r, i) => { if (!keepIndices || !keepIndices.slice(0, need).includes(i)) g.deck.push(r); });
  shuffle(g.deck);
  log(g, `${actor.name} consults the Owl and rearranges their secrets.`);
  nextTurn(g);
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
  const rich = rivals.reduce((a, b) => (b.acorns > a.acorns ? b : a), rivals[0]);
  const bluffOK = Math.random() < (g.round === 1 ? 0.12 : 0.3); // shy to bluff early

  if (p.acorns >= 10) return { kind: 'action', action: 'banish', targetSeat: rich.seat };
  if (p.acorns >= 7 && Math.random() < 0.85) return { kind: 'action', action: 'banish', targetSeat: rich.seat };
  if (p.acorns >= 3 && (hasRole(p, 'adder') || bluffOK && Math.random() < 0.4))
    return { kind: 'action', action: 'sting', targetSeat: rich.seat };
  if (hasRole(p, 'elder') || (bluffOK && Math.random() < 0.5))
    return { kind: 'action', action: 'decree' };
  if (hasRole(p, 'magpie') && rich.acorns >= 2 && Math.random() < 0.75)
    return { kind: 'action', action: 'pilfer', targetSeat: rich.seat };
  if (hasRole(p, 'owl') && Math.random() < 0.25) return { kind: 'action', action: 'consult' };
  return Math.random() < 0.55 ? { kind: 'action', action: 'gather' } : { kind: 'action', action: 'forage' };
}

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
    return Math.random() < base;
  }

  const bluff = _bluffProb(g, observer, claimantSeat, role);

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
  // 0.55 multiplier + only firing meaningfully once bluff prob is real.
  const DAMP = 0.55;
  let chance = bluff * roundFactor * roleW * desperation * DAMP;

  // Below a confidence floor, almost never challenge (let it ride).
  if (bluff < 0.5 && desperation === 1) chance *= 0.4;

  chance = Math.max(0.01, Math.min(0.9, chance));
  return Math.random() < chance;
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
    let bluffBlock = g.difficulty === 'simple' ? 0.08 : 0.06;
    // Only bluff-block a lethal Sting you're the target of — survival instinct.
    if (g.pending.targetSeat === p.seat && g.pending.action === 'sting') bluffBlock = 0.28;
    return { blockRole: have || (Math.random() < bluffBlock ? roles[0] : null) };
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
  cur, living, ACTIONS,
};
