// lib/squirrel_engine.js — server-authoritative Squirrel's Stash.
//
// Push-your-luck: draw from a shared pile, bank Acorns, avoid busting on a
// duplicate number in your own stash. Dual Node/browser export so the same
// engine drives single-player (local) and multiplayer (server), exactly
// like the Briar engine.
//
// PHASES (state machine — advances only on the expected player's input):
//   'turn'        — current player must Draw or Bank (after 3 safe draws)
//   'squirrel'    — current player drew Squirrel: keep 1 of 2 drawn
//   'storm'       — EVERY living player picks 1 stash card to shuffle back
//   'magpie'      — current player steals ONE card from a chosen player
//   'foxdare'     — current player chose a victim who must draw 3
//   'gameover'
//
// Stashes are PUBLIC (face-up) — view() does not redact them. Banked piles
// are counted at the end; Rotten Acorn (-7) included.

// ── Deck definition ──
function buildDeck() {
  const deck = [];
  const add = (n, kind, value, extra) => {
    for (let i = 0; i < n; i++) deck.push(Object.assign({ kind, value }, extra || {}));
  };
  // Number cards (1-6, 8-10) ×7 each. Note: no 7 (Lucky Seven is its own).
  for (const num of [1, 2, 3, 4, 5, 6, 8, 9, 10]) add(7, 'number', num, { num });
  // Special value cards
  add(7, 'lucky7', 7, { num: 'L7' });           // banks automatically, can't be stolen
  add(7, 'rotten', -7, { num: 'R7' });          // own unique number for dup checks
  add(2, 'golden', 20, { num: 'G20' });         // rare high value
  // Special effect cards (3 each)
  add(3, 'magpie', 0);
  add(3, 'burrow', 0);
  add(3, 'pact', 0);                            // Forest Pact
  add(3, 'badger', 0);
  add(3, 'squirrel', 0);
  add(3, 'storm', 0);
  add(3, 'foxdare', 0);                         // Fox's Dare
  return deck;
}

const CARD_LABEL = {
  number: c => String(c.num),
  lucky7: () => 'Lucky 7',
  rotten: () => 'Rotten (-7)',
  golden: () => 'Golden (20)',
  magpie: () => 'Magpie',
  burrow: () => 'Burrow',
  pact: () => 'Forest Pact',
  badger: () => 'Badger',
  squirrel: () => 'Squirrel',
  storm: () => 'Storm',
  foxdare: () => "Fox's Dare",
};
function label(c) { return CARD_LABEL[c.kind] ? CARD_LABEL[c.kind](c) : c.kind; }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const TOTAL_ROUNDS = 5;

function create(seats, opts) {
  const difficulty = (opts && opts.difficulty) || 'smart';
  const deck = shuffle(buildDeck());
  const players = seats.map(s => ({
    seat: s.seat, id: s.id, name: s.name, isAI: !!s.isAI,
    banked: [],          // permanent score pile (array of cards)
    stash: [],           // current unbanked cards
    badgerArmed: false,  // a Badger in stash can absorb one bust
    pactReady: false,    // drew a Forest Pact, waiting for a match
    drawsThisTurn: 0,
    busted: false,
  }));
  const g = {
    deck, players,
    turn: Math.floor(Math.random() * players.length),
    round: 1, totalRounds: TOTAL_ROUNDS,
    turnsThisRound: 0,
    phase: 'turn',
    pending: null,
    log: [],
    winner: null,
    difficulty,
  };
  log(g, "The squirrel's hoard is tipped onto the table. Draw, but mind the duplicates!");
  log(g, `${cur(g).name} reaches in first.`);
  return g;
}

const cur = g => g.players[g.turn];
const alive = g => g.players; // all players play every round; "alive" not used like Briar
function log(g, m) { g.log.push(m); if (g.log.length > 16) g.log.shift(); }
const bySeat = (g, s) => g.players.find(p => p.seat === s);

// Numbers that count for duplicate/steal matching (number, lucky7 excluded
// from busting per rules — but lucky7 can't be stolen and doesn't bust;
// rotten counts as its own unique number; golden counts as its own).
function matchKey(c) {
  if (c.kind === 'number') return 'n' + c.num;
  if (c.kind === 'rotten') return 'rotten';
  if (c.kind === 'golden') return 'golden';
  return null; // lucky7 and specials don't participate in dup/steal matching
}

// ── Draw a card from the pile ──
function draw(g, seat) {
  if (g.phase !== 'turn' || cur(g).seat !== seat) return false;
  const p = cur(g);
  if (!g.deck.length) { endGame(g); return true; }
  const card = g.deck.pop();
  p.drawsThisTurn++;
  log(g, `${p.name} draws ${label(card)}.`);
  // Record this draw for the client reveal animation.
  g._seq = (g._seq || 0) + 1;
  g.lastDraw = { seq: g._seq, seat: p.seat, card: { kind: card.kind, num: card.num, value: card.value, label: label(card) }, outcome: 'pending' };
  const _busted0 = p.busted;

  // Special effect cards trigger immediately and are DISCARDED after use
  // (they never sit in the stash, can't be banked or stolen). The only
  // exception is Badger, which stays armed in the stash until it absorbs a
  // bust or the stash banks.
  switch (card.kind) {
    case 'squirrel': return _doSquirrel(g, p, card);          // discarded; draws 2 keep 1
    case 'storm':    log(g, `${p.name} draws Storm!`); return _doStorm(g, p);
    case 'burrow':   log(g, `${p.name} draws Burrow — banking everything.`); return bank(g, seat, true);
    case 'magpie':   log(g, `${p.name} draws a Magpie!`); return _enterMagpie(g, p);
    case 'foxdare':  log(g, `${p.name} draws Fox's Dare!`); return _enterFoxDare(g, p);
    case 'pact':     log(g, `${p.name} draws a Forest Pact!`); return _doPact(g, p, card);
    case 'badger':   p.stash.push(card); p.badgerArmed = true; log(g, `${p.name} tucks a Badger away — the next bust will be ignored.`); return _afterDraw(g, p);
  }

  // Lucky 7 — sits in stash, can't be stolen, auto-banks at safe turn end
  if (card.kind === 'lucky7') { p.stash.push(card); return _afterDraw(g, p); }

  // Number / rotten / golden: check steals + busts
  const key = matchKey(card);

  // Steal: if another player's stash has this number, take ALL copies
  let stoleFrom = null;
  for (const other of g.players) {
    if (other === p) continue;
    const taken = other.stash.filter(c => matchKey(c) === key);
    if (taken.length) {
      other.stash = other.stash.filter(c => matchKey(c) !== key);
      p.stash.push(...taken);
      stoleFrom = { name: other.name, count: taken.length };
    }
  }
  p.stash.push(card);

  // Bust check: duplicate of a number already in MY stash (after the safe 3)
  const myCopies = p.stash.filter(c => matchKey(c) === key).length;
  const safe = p.drawsThisTurn <= 3;
  if (stoleFrom) { if (g.lastDraw) g.lastDraw.outcome = 'steal'; log(g, `${p.name} steals ${stoleFrom.count} × ${label(card)} from ${stoleFrom.name}!`); }

  if (!safe && myCopies >= 2 && !stoleFrom) {
    // A genuine duplicate from the pile (not one we just stole into a pair)
    if (p.badgerArmed) {
      p.badgerArmed = false;
      p.stash = p.stash.filter(c => c.kind !== 'badger');
      log(g, `${p.name} would bust — but the Badger absorbs it!`);
      return _afterDraw(g, p);
    }
    return _bust(g, p, card);
  }
  // Edge: stealing can create a pair too; rules say steal happens, then it's
  // a duplicate. Treat a post-steal pair as a bust risk after safe draws.
  if (!safe && myCopies >= 2 && stoleFrom) {
    if (p.badgerArmed) { p.badgerArmed = false; p.stash = p.stash.filter(c => c.kind !== 'badger'); log(g, `${p.name}'s Badger absorbs the clash!`); return _afterDraw(g, p); }
    return _bust(g, p, card);
  }

  return _afterDraw(g, p);
}

function _afterDraw(g, p) {
  g.phase = 'turn';
  g.pending = null;
  return true;
}

function _bust(g, p, card) {
  if (g.lastDraw && g.lastDraw.seat === p.seat) g.lastDraw.outcome = 'bust';
  log(g, `${p.name} draws a second ${label(card)} and BUSTS — the whole stash is lost!`);
  p.stash = [];
  p.busted = true;
  p.badgerArmed = false;
  endTurn(g);
  return true;
}

// ── Bank ──  (manual after 3 draws, or forced by Burrow)
// "Stop" (the player chooses to end drawing). Cards STAY in the stash, active
// and stealable, until the player's next turn. force=true (Burrow / Forest
// Pact) banks immediately instead.
function bank(g, seat, force) {
  if (!force) {
    if (g.phase !== 'turn' || cur(g).seat !== seat) return false;
    if (cur(g).drawsThisTurn < 3) return false; // must take the 3 safe draws first
  }
  const p = bySeat(g, seat);
  if (force) {
    if (p.stash.length) {
      const n = _bankStash(p);
      log(g, `${p.name} banks ${n} card${n === 1 ? '' : 's'}.`);
    }
  } else {
    log(g, `${p.name} stops, leaving ${p.stash.length} card${p.stash.length === 1 ? '' : 's'} on the table.`);
  }
  endTurn(g);
  return true;
}

// Move only VALUE cards from a stash to the banked pile; specials (badger)
// are discarded. Returns how many were banked.
function _bankStash(p) {
  const value = p.stash.filter(c => c.kind !== 'badger' && !_isSpecial(c));
  p.banked.push(...value);
  p.stash = [];
  p.badgerArmed = false;
  return value.length;
}
function _isSpecial(c) {
  return ['magpie','burrow','pact','storm','squirrel','foxdare'].includes(c.kind);
}

// Bank a player's surviving active stash (called at the start of their turn).
function _bankActive(g, p) {
  if (!p.stash.length) return;
  const n = _bankStash(p);
  if (n) log(g, `${p.name} banks their stash from last turn (${n} card${n === 1 ? '' : 's'}).`);
}

// At a safe turn end, any Lucky 7s auto-bank even if the rest is lost? Per
// rules Lucky 7 banks automatically at end of your turn IF YOU SURVIVE.
// On a bust the stash is lost — but Lucky 7 "remains even if other cards are
// stolen" and "cannot be stolen"; it does not say it survives a bust, so we
// only auto-bank Lucky 7 on a non-bust turn end (handled in endTurn).
function endTurn(g) {
  const p = cur(g);
  p.busted = false;
  p.drawsThisTurn = 0;

  // Deck empty → game ends immediately and we count.
  if (!g.deck.length) { endGame(g); return; }

  g.turnsThisRound++;
  // Advance to next player
  g.turn = (g.turn + 1) % g.players.length;
  if (g.turnsThisRound >= g.players.length) {
    g.turnsThisRound = 0;
    g.round++;
    if (g.round > g.totalRounds) { endGame(g); return; }
    log(g, `— Round ${g.round} of ${g.totalRounds} —`);
  }
  // The NEW current player banks whatever survived on the table since their
  // last turn, then starts fresh.
  _bankActive(g, cur(g));
  if (!g.deck.length) { endGame(g); return; }
  g.phase = 'turn';
  g.pending = null;
}

// ── Special effect resolvers ──
function _doSquirrel(g, p, card) {
  const a = g.deck.pop(), b = g.deck.pop();
  const drawn = [a, b].filter(Boolean);
  if (drawn.length < 2) { // not enough to choose; just keep what we got as a draw
    drawn.forEach(c => g.deck.push(c));
    return _afterDraw(g, p);
  }
  g.phase = 'squirrel';
  g.pending = { actorSeat: p.seat, choices: drawn };
  log(g, `${p.name} found a Squirrel — drawing two to keep one.`);
  return true;
}
function resolveSquirrel(g, seat, keepIndex) {
  if (g.phase !== 'squirrel' || g.pending.actorSeat !== seat) return false;
  const p = bySeat(g, seat);
  const choices = g.pending.choices;
  const keep = choices[keepIndex] || choices[0];
  const back = choices[keepIndex === 0 ? 1 : 0];
  g.deck.push(back); shuffle(g.deck);
  log(g, `${p.name} keeps ${label(keep)}, slips the other back.`);
  // The kept card resolves like a normal draw (could be a number → steal/bust)
  g.phase = 'turn'; g.pending = null;
  return _resolveKeptCard(g, p, keep);
}
function _resolveKeptCard(g, p, card) {
  // Specials resolve their effect and discard (not pushed to stash).
  if (['magpie','burrow','pact','badger','storm','squirrel','foxdare','lucky7'].includes(card.kind)) {
    if (card.kind === 'lucky7') { p.stash.push(card); return true; }
    if (card.kind === 'burrow') { return bank(g, p.seat, true); }
    if (card.kind === 'badger') { p.stash.push(card); p.badgerArmed = true; return true; }
    if (card.kind === 'storm') { return _doStorm(g, p); }
    if (card.kind === 'magpie') { return _enterMagpie(g, p); }
    if (card.kind === 'foxdare') { return _enterFoxDare(g, p); }
    if (card.kind === 'pact') { return _doPact(g, p, card); }
    if (card.kind === 'squirrel') { return _doSquirrel(g, p, card); }
  }
  const key = matchKey(card);
  let stole = false;
  for (const other of g.players) { if (other === p) continue;
    const taken = other.stash.filter(c => matchKey(c) === key);
    if (taken.length) { other.stash = other.stash.filter(c => matchKey(c) !== key); p.stash.push(...taken); stole = true; log(g, `${p.name} steals ${taken.length} × ${label(card)} from ${other.name}!`); }
  }
  p.stash.push(card);
  const copies = p.stash.filter(c => matchKey(c) === key).length;
  if (p.drawsThisTurn > 3 && copies >= 2) {
    if (p.badgerArmed) { p.badgerArmed = false; p.stash = p.stash.filter(c => c.kind !== 'badger'); log(g, `${p.name}'s Badger absorbs it!`); return true; }
    return _bust(g, p, card);
  }
  return true;
}

function _doStorm(g, actor) {
  log(g, `A Storm sweeps the table — everyone returns a card to the hoard.`);
  // Each player with a stash must choose one card to shuffle back.
  const needers = g.players.filter(p => p.stash.length > 0);
  if (!needers.length) return _afterDraw(g, actor);
  g.phase = 'storm';
  g.pending = { actorSeat: actor.seat, resolved: [] };
  return true;
}
function resolveStorm(g, seat, cardIndex) {
  if (g.phase !== 'storm') return false;
  const p = bySeat(g, seat);
  if (!p || g.pending.resolved.includes(seat)) return false;
  if (p.stash.length) {
    const idx = Math.max(0, Math.min(p.stash.length - 1, cardIndex | 0));
    const chosen = p.stash[idx];
    const key = matchKey(chosen);
    // Giving up a card means giving up the WHOLE matching stack (all copies
    // of that number). Specials (no matchKey) just remove the one card.
    let returned;
    if (key) { returned = p.stash.filter(c => matchKey(c) === key); p.stash = p.stash.filter(c => matchKey(c) !== key); }
    else { returned = [chosen]; p.stash.splice(idx, 1); }
    g._returnedToPile = (g._returnedToPile || 0) + returned.length; // signal a shuffle
    returned.forEach(c => g.deck.push(c)); shuffle(g.deck);
    log(g, `${p.name} returns ${returned.length > 1 ? returned.length + ' × ' : ''}${label(chosen)} to the hoard.`);
  }
  g.pending.resolved.push(seat);
  // Done when every player with cards has resolved
  const remaining = g.players.filter(pl => pl.stash.length > 0 && !g.pending.resolved.includes(pl.seat));
  if (!remaining.length) { g.phase = 'turn'; g.pending = null; }
  return true;
}
function stormPending(g) { // seats still needing to act
  if (g.phase !== 'storm') return [];
  return g.players.filter(p => p.stash.length > 0 && !g.pending.resolved.includes(p.seat)).map(p => p.seat);
}

function _enterMagpie(g, p) {
  const targets = g.players.filter(o => o !== p && o.stash.some(c => c.kind !== 'lucky7'));
  if (!targets.length) { log(g, `${p.name}'s Magpie finds nothing to take.`); return _afterDraw(g, p); }
  g.phase = 'magpie';
  g.pending = { actorSeat: p.seat };
  return true;
}
function resolveMagpie(g, seat, targetSeat, cardIndex) {
  if (g.phase !== 'magpie' || g.pending.actorSeat !== seat) return false;
  const p = bySeat(g, seat), t = bySeat(g, targetSeat);
  if (!t || t === p) return false;
  const stealable = t.stash.map((c, i) => ({ c, i })).filter(x => x.c.kind !== 'lucky7');
  if (!stealable.length) { g.phase = 'turn'; g.pending = null; return _afterDraw(g, p); }
  const pick = stealable.find(x => x.i === cardIndex) || stealable[0];
  t.stash.splice(pick.i, 1);
  p.stash.push(pick.c);
  log(g, `${p.name}'s Magpie snatches ${label(pick.c)} from ${t.name}.`);
  g.phase = 'turn'; g.pending = null;
  return true;
}

function _enterFoxDare(g, p) {
  g.phase = 'foxdare';
  g.pending = { actorSeat: p.seat };
  log(g, `${p.name} plays Fox's Dare — someone must draw three.`);
  return true;
}
function resolveFoxDare(g, seat, targetSeat) {
  if (g.phase !== 'foxdare' || g.pending.actorSeat !== seat) return false;
  const t = bySeat(g, targetSeat);
  if (!t) return false;
  log(g, `${bySeat(g,seat).name} dares ${t.name} to draw three!`);
  // Enter a sequential dare: the victim draws one at a time (each its own
  // engine step, so the client animates them). The actor's turn resumes after.
  g.dare = { victimSeat: targetSeat, returnSeat: seat, remaining: 3 };
  g.phase = 'daredraw';
  g.pending = { actorSeat: targetSeat };
  return true;
}

// One forced draw of the dare. Called repeatedly (by human click or AI tick)
// until remaining hits 0 or the victim busts.
function dareDraw(g, seat) {
  if (g.phase !== 'daredraw' || !g.dare || g.dare.victimSeat !== seat) return false;
  const t = bySeat(g, seat);
  if (!g.deck.length || g.dare.remaining <= 0) return _endDare(g);
  const card = g.deck.pop();
  g._seq = (g._seq || 0) + 1;
  g.lastDraw = { seq: g._seq, seat: t.seat, card: { kind: card.kind, num: card.num, value: card.value, label: label(card) }, outcome: 'pending' };
  g.dare.remaining--;
  log(g, `${t.name} is dared to draw ${label(card)}.`);
  _forcedResolveCard(g, t, card);
  if (t.busted) { if (g.lastDraw) g.lastDraw.outcome = 'bust'; t.busted = false; return _endDare(g); }
  if (g.dare.remaining <= 0) return _endDare(g);
  return true; // stay in daredraw for the next one
}
function _endDare(g) {
  g.dare = null;
  g.phase = 'turn';
  g.pending = null;
  return true;
}
// A forced draw (Fox's Dare) for a non-current player — like draw() but
// targets t and doesn't consume the current player's turn.
function _forcedDraw(g, t) {
  const card = g.deck.pop();
  if (!card) return;
  log(g, `${t.name} is forced to draw ${label(card)}.`);
  return _forcedResolveCard(g, t, card);
}
// Resolve an already-drawn card for a forced/dare draw (steal/bust/special).
function _forcedResolveCard(g, t, card) {
  if (card.kind === 'lucky7') { t.stash.push(card); return; }
  // Specials resolve their effect (auto-resolving any choices for the dared
  // player), then discard — they do not linger in the stash.
  if (card.kind === 'badger') { t.stash.push(card); t.badgerArmed = true; log(g, `${t.name} arms a Badger.`); return; }
  if (card.kind === 'burrow') {
    const value = t.stash.filter(c => c.kind !== 'badger');
    if (value.length) { t.banked.push(...value); log(g, `${t.name}'s forced Burrow banks ${value.length}.`); }
    t.stash = []; t.badgerArmed = false; return;
  }
  if (card.kind === 'pact') { t.pactReady = true; log(g, `${t.name} is now Pact-ready.`); return; }
  if (card.kind === 'magpie') {
    // Auto-steal the best card from the richest rival
    let best = null;
    for (const o of g.players) { if (o === t) continue; o.stash.forEach((c, i) => { if (c.kind === 'lucky7' || c.kind === 'badger') return; const v = c.value||0; if (!best || v > best.v) best = { o, i, c, v }; }); }
    if (best) { best.o.stash.splice(best.i, 1); t.stash.push(best.c); log(g, `${t.name}'s Magpie steals ${label(best.c)} from ${best.o.name}.`); }
    return;
  }
  if (card.kind === 'squirrel') {
    // Draw 2, keep the higher value, shuffle the other back
    const a = g.deck.pop(), b = g.deck.pop();
    const pick = (a && b) ? ((a.value||0) >= (b.value||0) ? a : b) : (a || b);
    const back = (a && b) ? ((pick === a) ? b : a) : null;
    if (back) { g.deck.push(back); shuffle(g.deck); }
    if (pick) { log(g, `${t.name}'s Squirrel keeps ${label(pick)}.`); _forcedDrawResolve(g, t, pick); }
    return;
  }
  if (card.kind === 'storm' || card.kind === 'foxdare') {
    // These cascade awkwardly inside a forced sequence; resolve minimally.
    log(g, `${t.name}'s ${label(card)} fizzles in the rush of the dare.`);
    return;
  }
  return _forcedDrawResolve(g, t, card);
}

// Resolve a value card (number/rotten/golden) for a forced/kept draw: steal
// matches, push, then bust-check.
function _forcedDrawResolve(g, t, card) {
  const key = matchKey(card);
  if (!key) { t.stash.push(card); return; }
  for (const other of g.players) { if (other === t) continue;
    const taken = other.stash.filter(c => matchKey(c) === key);
    if (taken.length) { other.stash = other.stash.filter(c => matchKey(c) !== key); t.stash.push(...taken); log(g, `${t.name} steals ${taken.length} × ${label(card)} from ${other.name}!`); }
  }
  t.stash.push(card);
  const copies = t.stash.filter(c => matchKey(c) === key).length;
  if (copies >= 2) {
    if (t.badgerArmed) { t.badgerArmed = false; t.stash = t.stash.filter(c => c.kind !== 'badger'); log(g, `${t.name}'s Badger absorbs the dare's clash!`); return; }
    log(g, `${t.name} busts on the dare — stash lost!`);
    t.stash = []; t.busted = true;
  }
}

function _doPact(g, p, card) {
  // Forest Pact cards don't persist in the stash; instead a player who draws
  // one becomes "pact-ready". If another player is already pact-ready, the
  // pact resonates: both bank everything immediately.
  const other = g.players.find(o => o !== p && o.pactReady);
  if (other) {
    other.pactReady = false; p.pactReady = false;
    log(g, `Two Forest Pacts resonate — ${p.name} and ${other.name} both bank everything!`);
    for (const who of [p, other]) {
      if (who.stash.length) {
        // Discard any armed Badger (a special) — only value cards bank.
        const value = who.stash.filter(c => c.kind !== 'badger');
        who.banked.push(...value); who.stash = []; who.badgerArmed = false;
      }
    }
    endTurn(g);
    return true;
  }
  p.pactReady = true;
  log(g, `${p.name} makes a Forest Pact — it will resonate if another player draws one.`);
  return _afterDraw(g, p);
}

// ── End / scoring ──
function score(p) { return p.banked.reduce((s, c) => s + (c.value || 0), 0); }
function endGame(g) {
  g.phase = 'gameover';
  // Active stashes count at game end (they were just unbanked, not lost).
  for (const p of g.players) { if (p.stash.length) _bankStash(p); }
  let best = null;
  for (const p of g.players) { const s = score(p); if (best == null || s > best.s) best = { seat: p.seat, s, name: p.name }; }
  g.winner = best ? best.seat : null;
  log(g, `The hoard is empty. Final tallies are counted…`);
  if (best) log(g, `🏆 ${best.name} wins with ${best.s} acorns!`);
}

// Count remaining cards by display label (for the 'what's left' tracker).
function _composition(deck) {
  const counts = {};
  for (const c of deck) {
    const key = c.kind === 'number' ? ('n' + c.num) : c.kind;
    if (!counts[key]) counts[key] = { kind: c.kind, num: c.num, label: label(c), n: 0 };
    counts[key].n++;
  }
  return counts;
}

// ── Redacted view (stashes are PUBLIC; banked shown as counts + score) ──
function view(g, forId) {
  return {
    game: 'squirrel',
    phase: g.phase,
    turn: g.turn,
    turnSeat: g.players[g.turn] ? g.players[g.turn].seat : null,
    round: g.round, totalRounds: g.totalRounds,
    deckLeft: g.deck.length,
    deckComposition: _composition(g.deck),
    lastDraw: g.lastDraw || null,
    dare: g.dare ? { victimSeat: g.dare.victimSeat, remaining: g.dare.remaining } : null,
    _returnedToPile: g._returnedToPile || 0,
    winner: g.winner,
    log: g.log.slice(-10),
    pending: g.pending ? {
      actorSeat: g.pending.actorSeat,
      choices: (g.phase === 'squirrel' && bySeat(g, g.pending.actorSeat).id === forId) ? g.pending.choices.map(c => ({ kind: c.kind, num: c.num, value: c.value, label: label(c) })) : undefined,
      stormResolved: g.phase === 'storm' ? g.pending.resolved.slice() : undefined,
    } : null,
    players: g.players.map(p => ({
      seat: p.seat, id: p.id, name: p.name, isAI: p.isAI,
      score: score(p),
      bankedCount: p.banked.length,
      drawsThisTurn: p.drawsThisTurn,
      badgerArmed: p.badgerArmed,
      pactReady: p.pactReady,
      stash: p.stash.map(c => ({ kind: c.kind, num: c.num, value: c.value, label: label(c) })),
    })),
  };
}

// ── AI ──
// Push-your-luck heuristic: draw while safe or stash is small; bank when the
// stash is valuable or risk of a duplicate climbs. Bust risk rises with the
// count of distinct numbers held vs numbers left.
function aiResolve(g, seat) {
  const p = bySeat(g, seat);
  if (!p) return null;

  if (g.phase === 'turn' && g.turn === g.players.findIndex(x => x.seat === seat)) {
    if (p.drawsThisTurn < 3) return { kind: 'draw' };           // safe draws — always take
    if (p.badgerArmed) return { kind: 'draw' };                 // Badger = next bust free, keep going
    // Estimate bust risk: distinct number-keys in stash / cards left
    const keys = new Set(p.stash.map(matchKey).filter(Boolean));
    const stashVal = p.stash.reduce((s, c) => s + (c.value || 0), 0);
    const risk = Math.min(0.85, keys.size / Math.max(8, g.deckLeft || g.deck.length) * 9);
    // Greed scales with difficulty; bank more readily when stash is fat
    const greed = g.difficulty === 'simple' ? 0.35 : 0.5;
    const wantBank = stashVal >= 12 ? 0.6 : 0.2;
    if (Math.random() < Math.max(risk, wantBank) && Math.random() > greed) return { kind: 'bank' };
    if (risk > 0.6 && Math.random() < 0.7) return { kind: 'bank' };
    return { kind: 'draw' };
  }
  if (g.phase === 'daredraw' && g.dare && g.dare.victimSeat === seat) {
    return { kind: 'daredraw' };
  }
  if (g.phase === 'squirrel' && g.pending.actorSeat === seat) {
    // Keep the higher-value, lower-risk card
    const ch = g.pending.choices;
    const val = c => (c.kind === 'golden' ? 20 : c.value || 0) - (matchKeyHeld(p, c) ? 8 : 0);
    return { kind: 'squirrel', keepIndex: val(ch[0]) >= val(ch[1]) ? 0 : 1 };
  }
  if (g.phase === 'storm') {
    // Return the least valuable stash card
    if (!p.stash.length) return null;
    let worst = 0; for (let i = 1; i < p.stash.length; i++) if ((p.stash[i].value||0) < (p.stash[worst].value||0)) worst = i;
    return { kind: 'storm', cardIndex: worst };
  }
  if (g.phase === 'magpie' && g.pending.actorSeat === seat) {
    // Steal the most valuable stealable card from the richest rival
    let best = null;
    for (const o of g.players) { if (o.seat === seat) continue;
      o.stash.forEach((c, i) => { if (c.kind === 'lucky7') return; const v = c.value||0; if (!best || v > best.v) best = { targetSeat: o.seat, cardIndex: i, v }; }); }
    if (!best) return { kind: 'magpie', targetSeat: seat, cardIndex: 0 };
    return { kind: 'magpie', targetSeat: best.targetSeat, cardIndex: best.cardIndex };
  }
  if (g.phase === 'foxdare' && g.pending.actorSeat === seat) {
    // Dare the player with the fattest stash (most to lose)
    let best = null;
    for (const o of g.players) { if (o.seat === seat) continue; const v = o.stash.reduce((s,c)=>s+(c.value||0),0); if (!best || v > best.v) best = { seat: o.seat, v }; }
    return { kind: 'foxdare', targetSeat: best ? best.seat : seat };
  }
  return null;
}
function matchKeyHeld(p, c) {
  const k = matchKey(c); if (!k) return false;
  return p.stash.some(x => matchKey(x) === k);
}

module.exports = {
  create, draw, bank,
  resolveSquirrel, resolveStorm, resolveMagpie, resolveFoxDare, dareDraw,
  stormPending, view, aiResolve, score,
};

