// scripts/briar_cards_proofs.js — proofs for the Briar card changes:
// Ward (Hedgewitch action), Banish Legacy (elimination bounty), Court Seasons
// (variant) and The Heron (sixth role at 5–6 players).
//
// Scripted scenarios set up exact hands/purses on a seeded game and drive the
// real engine API; statistical checks run headless AI self-play. Exits non-zero
// on any failure.
//
// Usage:  node scripts/briar_cards_proofs.js

const E = require('../lib/briar_engine');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n${t}`); }

const NAMES = ['Old Bracken', 'Sly Whisper', 'Marigold', 'Thorn', 'Bramblefoot', 'Quill'];

// A seeded game with n seats. `hands` (optional) overrides each seat's two
// cards; `acorns` overrides purses; the turn is set to seat `turn`. Any cards
// swapped into hands are swapped out of the deck so the census stays exact.
// Scripted scenarios default to seasons OFF so a random season can't disturb
// the rule under test; the season tests switch it on explicitly.
function setup(n, { hands, acorns, turn = 0, seasons = false, seed = 7, ai = false } = {}) {
  const seats = Array.from({ length: n }, (_, i) => ({ seat: i, id: 'p' + i, name: NAMES[i], isAI: ai }));
  const g = E.create(seats, { rng: E.mulberry32(seed), seed, seasons });
  if (hands) {
    // Return all hands to the deck, then deal the requested roles from it.
    for (const p of g.players) for (const c of p.cards) g.deck.push(c.role);
    g.players.forEach((p, i) => {
      p.cards = hands[i].map(role => {
        const k = g.deck.indexOf(role);
        if (k < 0) throw new Error(`setup: no ${role} left in deck`);
        g.deck.splice(k, 1);
        return { role, revealed: false };
      });
    });
  }
  if (acorns) g.players.forEach((p, i) => { p.acorns = acorns[i]; });
  g.turn = turn;
  return g;
}
const P = (g, s) => g.players.find(p => p.seat === s);
const hiddenCount = p => p.cards.filter(c => !c.revealed).length;
// Everyone except `except` passes the current challenge/block window.
function passAll(g, except = []) {
  for (const s of E.pendingSeats(g)) {
    if (except.includes(s)) continue;
    if (g.phase === 'challengeAction') E.challengeAction(g, s, false);
    else if (g.phase === 'block') E.block(g, s, null);
  }
}
function census(g) {
  const c = {};
  for (const r of g.deck) c[r] = (c[r] || 0) + 1;
  for (const p of g.players) for (const card of p.cards) c[card.role] = (c[card.role] || 0) + 1;
  if (g.phase === 'consult' && g.pending && g.pending.consultPool)
    for (const r of g.pending.consultPool.slice(g.pending.consultKeep || 0)) c[r] = (c[r] || 0) + 1;
  return c;
}

// ─────────────────────────────────────────────────────────────────────────
section('§1 Ward');
{
  // Seat 0 wards seat 1 (honest Hedgewitch); seat 2 then Stings seat 1.
  const g = setup(4, { hands: [['hedgewitch', 'elder'], ['owl', 'elder'], ['adder', 'magpie'], ['owl', 'magpie']],
    acorns: [5, 2, 6, 2] });
  check('Ward accepted on another seat', E.doAction(g, 0, 'ward', 1));
  check('Ward costs 2 up front', P(g, 0).acorns === 3);
  passAll(g);
  check('Ward resolves into g.ward', g.ward && g.ward.protectedSeat === 1 && g.ward.expiresOnSeat === 0);
  check('Ward view is public', JSON.stringify(E.view(g, 'p3').ward) === JSON.stringify({ protectedSeat: 1, expiresOnSeat: 0 }));
  check('turn passed to seat 1', g.turn === 1);
  E.doAction(g, 1, 'forage');                                // seat 1's turn
  check('seat 2 may still declare Sting on warded seat', E.doAction(g, 2, 'sting', 1));
  check('challenge window still runs', g.phase === 'challengeAction');
  passAll(g);
  check('block window still runs', g.phase === 'block');
  E.block(g, 1, null);
  check('Sting fizzles: no influence lost', hiddenCount(P(g, 1)) === 2);
  check('Sting fizzles: 3 acorns still spent', P(g, 2).acorns === 3);
  check('fizzle is logged', g.log.some(l => /ward flares/.test(l)));

  // Pilfer against the warded seat also fizzles.
  E.doAction(g, 3, 'pilfer', 1); passAll(g); E.block(g, 1, null);
  check('Pilfer fizzles: no acorns move', P(g, 1).acorns === 3 && P(g, 3).acorns === 2);

  // Expiry: back to seat 0 — the ward ends at the start of the warder's turn.
  check('ward expired at warder\'s next turn start', g.turn === 0 && g.ward === null);
  E.doAction(g, 0, 'forage');
  E.doAction(g, 1, 'forage');
  E.doAction(g, 2, 'sting', 1); passAll(g); E.block(g, 1, null);
  check('a Sting after expiry lands', g.phase === 'loseInfluence' && g.pending.loserSeat === 1);
}
{
  // Ward on self is allowed; a second Ward replaces the first.
  const g = setup(4, { hands: [['hedgewitch', 'elder'], ['hedgewitch', 'owl'], ['adder', 'magpie'], ['owl', 'magpie']],
    acorns: [4, 4, 2, 2] });
  check('self-Ward accepted', E.doAction(g, 0, 'ward', 0));
  passAll(g);
  check('self-Ward protects self', g.ward && g.ward.protectedSeat === 0);
  E.doAction(g, 1, 'ward', 3); passAll(g);
  check('new Ward replaces the old', g.ward.protectedSeat === 3 && g.ward.expiresOnSeat === 1);
  check('replacement is logged', g.log.some(l => /old ward/.test(l)));
  check('Ward is never blockable', E.ACTIONS.ward.blockable === null);
}
{
  // Warding a player who then dies clears the slot.
  const g = setup(4, { hands: [['hedgewitch', 'elder'], ['owl', 'elder'], ['adder', 'magpie'], ['owl', 'magpie']],
    acorns: [3, 2, 8, 2] });
  P(g, 1).cards[1].revealed = true;                          // seat 1 on its last card
  E.doAction(g, 0, 'ward', 1); passAll(g);
  E.doAction(g, 1, 'forage');
  E.doAction(g, 2, 'banish', 1);                            // Banish ignores wards
  check('Banish kills through a ward', !P(g, 1).alive);
  check('dead ward target clears the slot', g.ward === null);
}
{
  // Bluffed Ward caught by a challenge: identical refund behaviour to a bluffed Sting.
  const mk = () => setup(4, { hands: [['elder', 'owl'], ['hedgewitch', 'adder'], ['magpie', 'magpie'], ['owl', 'elder']],
    acorns: [5, 2, 2, 2] });
  const gw = mk(); E.doAction(gw, 0, 'ward', 1); E.challengeAction(gw, 1, true);
  const gs = mk(); E.doAction(gs, 0, 'sting', 1); E.challengeAction(gs, 1, true);
  check('bluffed Ward: caster must lose influence', gw.phase === 'loseInfluence' && gw.pending.loserSeat === 0);
  E.resolveLoss(gw, 0, 0); E.resolveLoss(gs, 0, 0);
  check('bluffed Ward: no ward set', gw.ward === null);
  check('bluffed Ward: cost not refunded (like bluffed Sting)', P(gw, 0).acorns === 5 - 2 && P(gs, 0).acorns === 5 - 3);
}
{
  const g = setup(4, { acorns: [1, 2, 2, 2] });
  check('Ward rejected below 2 acorns', !E.doAction(g, 0, 'ward', 1));
  check('Ward rejected on a dead seat', (() => { const h = setup(4); P(h, 2).alive = false; return !E.doAction(h, 0, 'ward', 2); })());
  check('self-target still rejected for Sting', !E.doAction(setup(4, { acorns: [5, 2, 2, 2] }), 0, 'sting', 0));
}

// ─────────────────────────────────────────────────────────────────────────
section('§3 Banish Legacy');
function lethal(action, targetAcorns) {
  const g = setup(4, { hands: [['adder', 'elder'], ['owl', 'elder'], ['magpie', 'magpie'], ['owl', 'hedgewitch']],
    acorns: [8, targetAcorns, 2, 2] });
  P(g, 1).cards[1].revealed = true;
  E.doAction(g, 0, action, 1);
  if (action === 'sting') { passAll(g); E.block(g, 1, null); }
  return g;
}
{
  const g = lethal('banish', 5);
  check('lethal Banish on 5-acorn player: killer +2', P(g, 0).acorns === 8 - 7 + 2);
  check('lethal Banish: estate remainder zeroed', P(g, 1).acorns === 0 && !P(g, 1).alive);
  check('bounty logged', g.log.some(l => /estate/.test(l)));
}
{
  const g = lethal('sting', 5);
  check('lethal Sting on 5-acorn player: killer +2', P(g, 0).acorns === 8 - 3 + 2 && P(g, 1).acorns === 0);
}
{
  const g = lethal('banish', 1);
  check('lethal Banish on 1-acorn player: killer +1', P(g, 0).acorns === 8 - 7 + 1 && P(g, 1).acorns === 0);
  const z = lethal('banish', 0);
  check('dead-at-0: no bounty, no negative acorns', P(z, 0).acorns === 1 && P(z, 1).acorns === 0);
}
{
  const g = setup(4, { acorns: [8, 5, 2, 2] });
  E.doAction(g, 0, 'banish', 1);
  E.resolveLoss(g, 1, 0);
  check('non-lethal Banish: no bounty', P(g, 0).acorns === 1 && P(g, 1).acorns === 5);
}
{
  // Challenger on its last card loses a failed challenge — no bounty for the actor.
  const g = setup(4, { hands: [['elder', 'owl'], ['adder', 'magpie'], ['magpie', 'hedgewitch'], ['owl', 'hedgewitch']],
    acorns: [2, 5, 2, 2] });
  P(g, 1).cards[1].revealed = true;
  E.doAction(g, 0, 'decree');
  E.challengeAction(g, 1, true);
  check('challenge-loss elimination: target dead', !P(g, 1).alive);
  check('challenge-loss elimination: no bounty, purse untouched', P(g, 0).acorns === 5 && P(g, 1).acorns === 5);
}

// ─────────────────────────────────────────────────────────────────────────
section('§4 Court Seasons');
function withSeason(season, opts = {}) {
  const g = setup(4, { seasons: true, ...opts });
  g.season = season;
  return g;
}
{
  // Forage and Gather yields per season (Gather runs unblocked here: seats pass).
  const yieldOf = (season, action) => {
    const g = withSeason(season, { acorns: [2, 2, 2, 2] });
    E.doAction(g, 0, action);
    if (g.phase === 'block') for (const s of E.pendingSeats(g)) E.block(g, s, null);
    return P(g, 0).acorns - 2;
  };
  check('Harvest Moon: forage 2, gather 3', yieldOf('harvest', 'forage') === 2 && yieldOf('harvest', 'gather') === 3);
  check('Frost: forage 0, gather 1', yieldOf('frost', 'forage') === 0 && yieldOf('frost', 'gather') === 1);
  check('Quiet Court: forage 1, gather 2', yieldOf('quiet', 'forage') === 1 && yieldOf('quiet', 'gather') === 2);
  const c = setup(4, { acorns: [2, 2, 2, 2] }); E.doAction(c, 0, 'forage');
  check('seasons off: forage 1', P(c, 0).acorns === 3);
  const fv = withSeason('frost', { acorns: [2, 2, 2, 2] });
  check('Frost: view reports yields 0 / 1', E.view(fv, 'p0').forageGain === 0 && E.view(fv, 'p0').gatherGain === 1);
  check('no season changes Sting cost', ['harvest', 'frost', 'festival', 'shadows', 'quiet']
    .every(k => E.view(withSeason(k), 'p0').costs.sting === 3));
  const f10 = withSeason('frost', { acorns: [10, 2, 2, 2] });
  check('Frost never touches forced coup', !E.doAction(f10, 0, 'forage') && E.doAction(f10, 0, 'banish', 1) && P(f10, 0).acorns === 3);

  const fe = withSeason('festival', { acorns: [2, 2, 2, 2] });
  E.doAction(fe, 0, 'gather');
  check('Festival: gather resolves with no block window', fe.phase === 'action' && P(fe, 0).acorns === 4);
  const hv = withSeason('harvest', { acorns: [2, 2, 2, 2] });
  E.doAction(hv, 0, 'gather');
  check('outside Festival (Harvest): gather still blockable', hv.phase === 'block');
  const nf = withSeason('quiet', { acorns: [2, 2, 2, 2] });
  E.doAction(nf, 0, 'gather');
  check('outside Festival: gather opens a block window', nf.phase === 'block');

  const sh = withSeason('shadows', { hands: [['owl', 'elder'], ['adder', 'magpie'], ['magpie', 'hedgewitch'], ['adder', 'hedgewitch']] });
  E.doAction(sh, 0, 'consult'); passAll(sh);
  check('Long Shadows: consult pool = 3 + hand', sh.phase === 'consult' && sh.pending.consultPool.length === 5 && sh.pending.consultKeep === 2);
  E.resolveConsult(sh, 0, [4, 3]);
  const cs = census(sh);
  check('Long Shadows: every card returns (census exact)', E.SEASONS && Object.values(cs).every(v => v === 3) && Object.keys(cs).length === 5);
}
{
  // Rotation: exactly once per lap, reshuffle after all 5 are used.
  const g = setup(4, { seasons: true, acorns: [2, 2, 2, 2] });
  const seen = [g.season];
  let laps = 0;
  for (let step = 0; step < 4 * 12; step++) {
    const beforeTurn = g.turn, beforeDeck = g._seasonDeck.length;
    E.doAction(g, g.players[g.turn].seat, 'forage');
    g.players.forEach(p => { p.acorns = 2; });               // keep clear of forced coup
    const wrapped = g.turn === g.lapAnchor;                  // back to the opener = new round
    const drew = g._seasonDeck.length !== beforeDeck;        // popped one, or reshuffled
    if (wrapped) { laps++; seen.push(g.season); }
    if (wrapped !== drew) { check('season turns only when the marker wraps', false, `step ${step}`); break; }
  }
  check('season turns once per round', seen.length === laps + 1);
  check('a round is a full lap (4 turns at 4 seats)', laps === 12);
  const first5 = seen.slice(0, 5), next5 = seen.slice(5, 10);
  check('first 5 rounds see each season once', new Set(first5).size === 5);
  check('deck reshuffles after 5 rounds (next 5 also each once)', new Set(next5).size === 5);
}
{
  // Regression: the opener sits in the LAST chair. The season must hold for a
  // full lap of all six, not turn after the opener's single move.
  const g = setup(6, { seasons: true, acorns: [2, 2, 2, 2, 2, 2], turn: 5 });
  g.lapAnchor = 5;
  const first = g.seasonSeq;
  const turnsBefore = [];
  for (let i = 0; i < 6; i++) {
    turnsBefore.push(g.seasonSeq);
    E.doAction(g, g.players[g.turn].seat, 'forage');
    g.players.forEach(p => { p.acorns = 2; });
  }
  check('opener in the last seat: no new season until all six have played', turnsBefore.every(x => x === first) && g.seasonSeq === first + 1);
  // A dead opener still anchors the lap.
  const h = setup(4, { seasons: true, acorns: [2, 2, 2, 2], turn: 1 });
  h.lapAnchor = 1; h.players[1].alive = false; h.players[1].cards.forEach(c => { c.revealed = true; });
  h.turn = 2;
  const seq = h.seasonSeq;
  E.doAction(h, 2, 'forage'); E.doAction(h, 3, 'forage');
  check('no season mid-lap', h.seasonSeq === seq);
  E.doAction(h, 0, 'forage');                               // skips dead seat 1 → new lap
  check('passing a dead opener still turns the season', h.seasonSeq === seq + 1 && h.turn === 2);
}
{
  // Seasons are part of the game: on unless a test opts out.
  const seats = [0, 1, 2, 3].map(i => ({ seat: i, id: 'p' + i, name: NAMES[i], isAI: false }));
  const g = E.create(seats, { rng: E.mulberry32(3) });
  const v = E.view(g, 'p0');
  check('seasons on by default', g.seasons === true && v.seasonsEnabled === true && E.SEASONS.includes(v.season) && v.seasonSeq === 1);
  const off = E.view(setup(4), 'p0');
  check('seasons:false (tests only) carries no season', off.season === undefined && off.seasonsEnabled === false);
}

// ─────────────────────────────────────────────────────────────────────────
section('§2 The Heron');
for (const n of [2, 3, 4, 5, 6]) {
  const g = setup(n);
  const total = Object.values(census(g)).reduce((a, b) => a + b, 0);
  check(`deck census at ${n} players: ${n >= 5 ? 18 : 15} cards`, total === (n >= 5 ? 18 : 15) && (census(g).heron || 0) === (n >= 5 ? 3 : 0));
}
{
  const g4 = setup(4);
  check('Tithe rejected without the Heron (≤4 players)', !E.doAction(g4, 0, 'tithe'));
  check('roster in view', JSON.stringify(E.view(setup(5), 'p0').roster) === JSON.stringify(['elder', 'adder', 'magpie', 'owl', 'hedgewitch', 'heron']));
}
{
  // 5 players: seats 1,2 pay, seat 3 refuses, seat 4 broke → actor +2.
  const g = setup(5, { hands: [['heron', 'elder'], ['owl', 'elder'], ['adder', 'magpie'], ['owl', 'magpie'], ['adder', 'hedgewitch']],
    acorns: [2, 3, 3, 3, 0] });
  E.doAction(g, 0, 'tithe');
  passAll(g);
  check('Tithe enters titheBlock after the challenge window', g.phase === 'titheBlock');
  check('broke seat auto-responds', g.pending.responded.includes(4) && !E.pendingSeats(g).includes(4));
  check('pendingSeats lists the owing seats', JSON.stringify(E.pendingSeats(g)) === '[1,2,3]');
  E.titheRespond(g, 3, false);
  check('refusal recorded as a Heron claim', (P(g, 3).claimedRoles.heron || 0) === 1);
  check('view shows refused/paid ticks', E.view(g, 'p1').players[3].reaction === 'refused');
  check('duplicate response rejected', !E.titheRespond(g, 3, true));
  check('actor cannot respond', !E.titheRespond(g, 0, true));
  E.titheRespond(g, 1, true);
  E.titheRespond(g, 2, true);
  check('tithe collects 2', P(g, 0).acorns === 4);
  check('payers −1, refuser and broke untouched', P(g, 1).acorns === 2 && P(g, 2).acorns === 2 && P(g, 3).acorns === 3 && P(g, 4).acorns === 0);
  check('summary line logged', g.log.some(l => /collects the tithe: 2 acorns; Thorn refuses/.test(l)));
  check('turn advances after tithe', g.phase === 'action' && g.turn === 1);
}
{
  // Bluffing actor caught → loses influence, no tithe.
  const g = setup(5, { hands: [['owl', 'elder'], ['heron', 'elder'], ['adder', 'magpie'], ['owl', 'magpie'], ['adder', 'hedgewitch']],
    acorns: [2, 3, 3, 3, 3] });
  E.doAction(g, 0, 'tithe'); E.challengeAction(g, 2, true);
  E.resolveLoss(g, 0, 0);
  check('bluffed Tithe caught: no tithe happens', g.phase === 'action' && [1, 2, 3, 4].every(s => P(g, s).acorns === 3) && P(g, 0).acorns === 2);
  // Honest actor → challenger loses, tithe proceeds.
  const h = setup(5, { hands: [['heron', 'elder'], ['owl', 'elder'], ['adder', 'magpie'], ['owl', 'magpie'], ['adder', 'hedgewitch']],
    acorns: [2, 3, 3, 3, 3] });
  E.doAction(h, 0, 'tithe'); E.challengeAction(h, 2, true);
  check('honest Tithe: challenger loses influence', h.phase === 'loseInfluence' && h.pending.loserSeat === 2);
  E.resolveLoss(h, 2, 0);
  check('honest Tithe: tithe proceeds after the failed challenge', h.phase === 'titheBlock');
}
{
  // Heron-less view has no tithe fields; hidden info never leaks.
  const g = setup(6, { ai: true, seed: 11 });
  let leak = false, holes = false;
  for (let k = 0; k < 4000 && g.phase !== 'gameover'; k++) {
    for (const me of g.players) {
      const v = E.view(g, me.id);
      const js = JSON.stringify(v);
      if (js.includes('undefined')) holes = true;
      JSON.parse(js);
      for (const pv of v.players) {
        if (pv.id === me.id) continue;
        const real = P(g, pv.seat);
        pv.cards.forEach((c, i) => { if (!real.cards[i].revealed && c.role !== null) leak = true; });
      }
      if (v.pending && v.pending.consultPool && g.pending.actorSeat !== me.seat) leak = true;
    }
    const s = E.pendingSeat(g); applyAI(g, s, E.aiResolve(g, s));
  }
  check('view never leaks another seat\'s hidden cards (6p game)', !leak);
  check('view JSON round-trips cleanly', !holes);
}

// ─────────────────────────────────────────────────────────────────────────
section('Self-play (AI)');
function applyAI(g, s, m) {
  switch (m.kind) {
    case 'action':          return E.doAction(g, s, m.action, m.targetSeat);
    case 'challengeAction': return E.challengeAction(g, s, !!m.challenge);
    case 'block':           return E.block(g, s, m.blockRole || null);
    case 'challengeBlock':  return E.challengeBlock(g, s, !!m.challenge);
    case 'loseInfluence':   return E.resolveLoss(g, s, m.cardIndex | 0);
    case 'consult':         return E.resolveConsult(g, s, m.keepIndices || []);
    case 'titheRespond':    return E.titheRespond(g, s, !!m.pay);
  }
  return false;
}
function selfplay(games, n, { seasons, baseSeed = 1, onDeal, onEnd } = {}) {
  const r = { stalls: 0, rejected: 0, tithePhaseOverrun: 0, actions: {}, winsBySeat: {}, done: 0 };
  for (let k = 0; k < games; k++) {
    const seed = baseSeed + k;
    const seats = Array.from({ length: n }, (_, i) => ({ seat: i, id: 'ai' + i, name: NAMES[i], isAI: true }));
    const g = E.create(seats, { rng: E.mulberry32(seed), seed, seasons });
    if (onDeal) onDeal(g);
    let steps = 0, titheSteps = 0;
    while (g.phase !== 'gameover' && steps < 4000) {
      const s = E.pendingSeat(g);
      const m = E.aiResolve(g, s);
      if (!m) { r.rejected++; break; }
      if (m.kind === 'action') r.actions[m.action] = (r.actions[m.action] || 0) + 1;
      if (!applyAI(g, s, m)) { r.rejected++; break; }
      if (g.phase === 'titheBlock') { if (++titheSteps > n) { r.tithePhaseOverrun++; break; } } else titheSteps = 0;
      steps++;
    }
    if (g.phase !== 'gameover') { r.stalls++; continue; }
    r.done++;
    r.winsBySeat[g.winner] = (r.winsBySeat[g.winner] || 0) + 1;
    if (onEnd) onEnd(g);
  }
  return r;
}
const share = (r, a) => { const t = Object.values(r.actions).reduce((x, y) => x + y, 0); return (r.actions[a] || 0) / t; };
{
  const r = selfplay(500, 4);
  const w = share(r, 'ward');
  check(`500 games (4p): no stalls / rejected AI moves`, !r.stalls && !r.rejected, JSON.stringify(r));
  check(`Ward share within 1–10% (${(w * 100).toFixed(1)}%)`, w >= 0.01 && w <= 0.10);
}
{
  // Heron balance: win rate of players DEALT ≥1 Heron vs holders of other roles.
  for (const n of [5, 6]) {
    const dealt = new Map();
    const tally = {};
    const r = selfplay(1000, n, {
      baseSeed: 5000,
      onDeal: g => dealt.set(g, g.players.map(p => new Set(p.cards.map(c => c.role)))),
      onEnd: g => {
        dealt.get(g).forEach((roles, i) => {
          for (const role of roles) {
            const t = tally[role] = tally[role] || { n: 0, w: 0 };
            t.n++; if (g.players[i].seat === g.winner) t.w++;
          }
        });
        dealt.delete(g);
      },
    });
    check(`1000 games (${n}p): no stalls / rejected moves / tithe deadlocks`, !r.stalls && !r.rejected && !r.tithePhaseOverrun, JSON.stringify(r));
    const rate = role => tally[role].w / tally[role].n;
    const others = Object.keys(tally).filter(x => x !== 'heron');
    const otherRate = others.reduce((a, x) => a + rate(x), 0) / others.length;
    const diff = (rate('heron') - otherRate) * 100;
    check(`Heron-holder win rate within ±5pp of other holders (${n}p: ${(rate('heron') * 100).toFixed(1)}% vs ${(otherRate * 100).toFixed(1)}%)`, Math.abs(diff) <= 5);
    check(`Tithe is actually played (${n}p: ${(share(r, 'tithe') * 100).toFixed(1)}%)`, share(r, 'tithe') > 0.01);
  }
}
{
  // Seasons: no stalls, and seat win rates stay within noise of seasons-off.
  const on = selfplay(500, 4, { seasons: true, baseSeed: 9000 });
  const off = selfplay(500, 4, { seasons: false, baseSeed: 9000 });
  check('500 games with seasons on: no stalls / rejected moves', !on.stalls && !on.rejected, JSON.stringify(on));
  // 500 games, p≈0.25 → σ≈1.9pp per seat; the difference of two runs σ≈2.7pp. Allow 3σ.
  let worst = 0;
  for (let s = 0; s < 4; s++) worst = Math.max(worst, Math.abs((on.winsBySeat[s] || 0) - (off.winsBySeat[s] || 0)) / 500 * 100);
  check(`seat win rates: seasons on vs off within noise (max Δ ${worst.toFixed(1)}pp ≤ 8pp)`, worst <= 8);
}

// ─────────────────────────────────────────────────────────────────────────
section('Rooms (game_rooms): fixed 6-seat Court, Fill with AI, AFK human, real _serverTick');
{
  const rooms = require('../lib/game_rooms');
  const log = console.log; console.log = () => {};          // silence "[game_rooms] start" lines
  let stalls = 0, titheTimeouts = 0, seasonsSeen = new Set(), games = 40;
  let wrongCensus = false, allSix = true, allSeasons = true, fillOk = true, distinctFills = new Set();
  for (let i = 0; i < games; i++) {
    const host = 'cards-human' + i;
    const room = rooms.createRoom({ gameType: 'briar', hostId: host, hostName: 'H' + i,
      visibility: 'private', maxPlayers: 3, difficulty: 'smart' });   // requested size is ignored
    if (room.maxPlayers !== 6) allSix = false;
    let threw = false; try { rooms.start(room, host); } catch (e) { threw = true; }
    if (!threw) fillOk = false;                                  // can't start short of 6
    rooms.fillAI(room, host);
    const ai = room.players.filter(p => p.isAI).map(p => p.name);
    if (room.players.length !== 6 || new Set(ai).size !== 5) fillOk = false;
    distinctFills.add(ai.join(','));
    rooms.start(room, host);
    if (!room.state.seasons || !room.state.roster.includes('heron')) allSeasons = false;
    let steps = 0;
    while (room.state.phase !== 'gameover' && steps < 5000) {
      const humanTithe = room.state.phase === 'titheBlock' && rooms.pendingAiSeat(room) == null;
      room.deadlineAt = 1;
      rooms._serverTick(Infinity);
      if (humanTithe) titheTimeouts++;
      seasonsSeen.add(room.state.season);
      const total = Object.values(census(room.state)).reduce((a, b) => a + b, 0);
      if (total !== 18) wrongCensus = true;
      steps++;
    }
    if (room.state.phase !== 'gameover') stalls++;
  }
  console.log = log;
  check('Briar rooms are always 6 seats', allSix);
  check('start refused below 6; Fill with AI seats 5 distinct courtiers', fillOk);
  check(`Fill with AI picks randomly (${distinctFills.size} distinct line-ups in ${games})`, distinctFills.size > 5);
  check('every room deals the Heron and runs Seasons', allSeasons);
  check(`${games} rooms reach gameover via the tick (no stalls)`, stalls === 0, `stalls=${stalls}`);
  check(`AFK human's tithe window times out to pay (${titheTimeouts} timeouts)`, titheTimeouts > 0);
  check('18-card census holds throughout', !wrongCensus);
  check('seasons rotate in rooms', seasonsSeen.size >= 4);
  const full = rooms.createRoom({ gameType: 'briar', hostId: 'full-x', hostName: 'x' });
  rooms.fillAI(full, 'full-x');
  let threw = false; try { rooms.fillAI(full, 'full-x'); } catch (e) { threw = true; }
  check('Fill with AI on a full table is refused', threw);
  let nonHost = false; try { rooms.fillAI(rooms.createRoom({ gameType: 'briar', hostId: 'nh-x', hostName: 'x' }), 'intruder'); } catch (e) { nonHost = true; }
  check('only the host can fill', nonHost);
}
{
  // Scattered AI reactions: when a reaction window opens, every AI gets its
  // own due time in [250, 1500] ms; answers are not in seat order.
  const rooms = require('../lib/game_rooms');
  const log = console.log;
  let windows = 0, inSeatOrder = 0, inRange = true, t = Date.now();
  for (let r = 0; r < 40 && windows < 100; r++) {
    const host = 'scatter-human' + r;
    console.log = () => {};
    const room = rooms.createRoom({ gameType: 'briar', hostId: host, hostName: 'S' });
    rooms.fillAI(room, host);
    rooms.start(room, host);
    console.log = log;
    for (let k = 0; k < 40000 && room.state.phase !== 'gameover'; k++) {
      const before = room.aiDue && room.aiDue.sig;
      room.deadlineAt = 1;
      rooms._serverTick(t);
      // A freshly scheduled challenge window: nothing in it can be due yet.
      if (room.state.phase === 'challengeAction' && room.aiDue && room.aiDue.sig !== before) {
        const pend = rooms.pendingAiSeats(room), at = room.aiDue.at;
        if (pend.length >= 3) {
          if (pend.some(x => at[x] - t < 250 || at[x] - t > 1500)) inRange = false;
          const order = pend.slice().sort((x, y) => at[x] - at[y]);
          if (order.join() === pend.join()) inSeatOrder++;
          windows++;
        }
      }
      t += 300;
    }
  }
  check(`AI reaction due times fall within 250–1500 ms (${windows} windows)`, windows > 20 && inRange);
  check(`AI answers are scattered, not seat-ordered (${inSeatOrder}/${windows} happened to match seat order)`, inSeatOrder / windows < 0.35);
}
{
  // Season reveal hold: after a new season is drawn the AI waits out the
  // client reveal (3.3 s) before acting, and a human's decision clock starts
  // after it.
  const rooms = require('../lib/game_rooms');
  const log = console.log; console.log = () => {};
  const host = 'hold-human';
  const room = rooms.createRoom({ gameType: 'briar', hostId: host, hostName: 'H' });
  rooms.fillAI(room, host);
  rooms.start(room, host);
  console.log = log;
  const g = room.state;
  const t0 = Date.now();
  rooms._serverTick(t0);                                   // sees the opening season
  const hold = room.seasonHoldUntil;
  const aiAt = room.aiDue ? Object.values(room.aiDue.at) : [];
  const humanTurn = rooms.pendingAiSeats(room).length === 0;
  check('opening season starts a ~3.3 s hold', hold >= t0 + 3000 && hold <= Date.now() + 3400);
  check('AI due times (or the human clock) start after the hold',
    humanTurn ? room.deadlineAt >= hold : (aiAt.length > 0 && aiAt.every(x => x >= hold)));
  const snap = () => JSON.stringify([g.phase, g.turn, g.pending, g.players.map(p => p.acorns)]);
  const before = snap();
  rooms._serverTick(t0 + 2500);                             // still inside the hold
  check('nothing moves during the hold', snap() === before);
  rooms._serverTick(hold + 2000);                           // past the hold + max delay
  check('play resumes after the hold', humanTurn || snap() !== before);
}

{
  // Abandoned tables: when every human has left, the match ends and each
  // human who sat at the table takes a loss (no AI winner is credited).
  const rooms = require('../lib/game_rooms');
  const statsPath = require.resolve('../lib/game_stats_store');
  const recorded = [];
  require.cache[statsPath] = { id: statsPath, filename: statsPath, loaded: true,
    exports: { record: (uid, game, won, o) => { recorded.push({ uid, game, won }); return Promise.resolve(); } } };
  const log = console.log; console.log = () => {};
  const fake = () => ({ write() {}, end() {} });
  // Two humans: one is cast out and disconnects (counts as leaving), the other forfeits.
  const room = rooms.createRoom({ gameType: 'briar', hostId: 'ab-1', hostName: 'A' });
  rooms.join(room, { id: 'ab-2', name: 'B' });
  const r1 = fake(), r2 = fake();
  rooms.subscribe(room, 'ab-1', r1); rooms.subscribe(room, 'ab-2', r2);
  rooms.fillAI(room, 'ab-1');
  rooms.start(room, 'ab-1');
  console.log = log;
  const seat2 = room.seats.find(x => x.id === 'ab-2').seat;
  const gp2 = room.state.players.find(p => p.seat === seat2);
  gp2.cards.forEach(c => { c.revealed = true; }); gp2.alive = false;
  rooms.unsubscribe(room, 'ab-2', r2);
  rooms.markAbsent(room, 'ab-2');
  check('a cast-out player who disconnects is treated as leaving (no pause)', !(room.absent && [...room.absent.values()].some(e => !e.converted)) && room.status === 'playing');
  rooms.forfeit(room, 'ab-1');
  check('last human leaving ends the match', room.status === 'finished');
  const losses = recorded.filter(r => r.game === 'briar');
  check('every human is recorded a loss', losses.length === 2 && losses.every(r => r.won === false)
    && new Set(losses.map(r => r.uid)).size === 2);
  delete require.cache[statsPath];
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
