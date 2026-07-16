// scripts/briar_selfplay.js — headless AI-vs-AI harness for Briar Court (§5.2).
//
// Runs N full games through the real engine API with a seeded RNG, so every
// run is deterministic and CI-able. Reports win rate by seat, targeting
// distribution against the perceived #1 threat, game length, stalls, and hard
// per-game invariants (15 role cards always accounted for, acorns never
// negative, exactly one winner). A failing invariant prints the seed so the
// exact game can be replayed.
//
// Usage:  node scripts/briar_selfplay.js [games] [players] [difficulty] [baseSeed]
//   node scripts/briar_selfplay.js 2000 4 smart 1

const E = require('../lib/briar_engine');

const AI_ROSTER = ['Old Bracken', 'Sly Whisper', 'Marigold', 'Thorn', 'Bramblefoot', 'Quill'];
const ROLES = ['elder', 'adder', 'magpie', 'owl', 'hedgewitch'];
const TURN_CAP = 4000;   // engine steps before we call a game stalled

// Mirror of the engine's threat scoring (incl. grudges) so the harness can ask
// "did the AI target its own perceived #1 threat?" without reaching into
// engine internals.
function threatOf(p, x) {
  const cards = x.cards.filter(c => !c.revealed).length;
  let s = cards * 10 + x.acorns;
  if (x.acorns >= 7) s += 12;
  if (x.acorns >= 10) s += 20;
  s += (p.grudges && p.grudges[x.seat]) || 0;
  return s;
}

// Which seat is the engine waiting on? Uses the engine's own single-source-of-
// truth helper (all seats are AI here, so the first pending seat always acts).
const pendingSeat = g => E.pendingSeat(g);

function apply(g, s, msg) {
  switch (msg.kind) {
    case 'action':         E.doAction(g, s, msg.action, msg.targetSeat); break;
    case 'challengeAction': E.challengeAction(g, s, !!msg.challenge); break;
    case 'block':          E.block(g, s, msg.blockRole || null); break;
    case 'challengeBlock': E.challengeBlock(g, s, !!msg.challenge); break;
    case 'loseInfluence':  E.resolveLoss(g, s, msg.cardIndex | 0); break;
    case 'consult':        E.resolveConsult(g, s, msg.keepIndices || []); break;
  }
}

// Returns { role: count } across deck + every card in play. Must always be
// exactly {each role: 3}. Catches card duplication/loss (e.g. the §2.1 bug).
function roleCensus(g) {
  const c = {};
  for (const r of ROLES) c[r] = 0;
  for (const r of g.deck) c[r] = (c[r] || 0) + 1;
  for (const p of g.players) for (const card of p.cards) c[card.role] = (c[card.role] || 0) + 1;
  // Mid-consult, the freshly DRAWN cards sit in pending.consultPool (pulled
  // from the deck, not yet returned to a hand). The pool is laid out as
  // [ ...actor's hidden roles, ...drawn ]; the hidden portion is already
  // counted in the hands above, so only the drawn tail is in-flight.
  if (g.phase === 'consult' && g.pending && Array.isArray(g.pending.consultPool)) {
    const drawn = g.pending.consultPool.slice(g.pending.consultKeep || 0);
    for (const r of drawn) c[r] = (c[r] || 0) + 1;
  }
  return c;
}

function checkInvariants(g, seed, problems) {
  const census = roleCensus(g);
  for (const r of ROLES) {
    if (census[r] !== 3) { problems.push(`seed ${seed}: role ${r} count=${census[r]} (expected 3)`); return false; }
  }
  const total = Object.values(census).reduce((a, b) => a + b, 0);
  if (total !== 15) { problems.push(`seed ${seed}: total cards=${total} (expected 15)`); return false; }
  for (const p of g.players) {
    if (p.acorns < 0) { problems.push(`seed ${seed}: ${p.name} acorns=${p.acorns} (<0)`); return false; }
  }
  return true;
}

function playGame(seed, nPlayers, difficulty, agg) {
  const seats = [];
  for (let i = 0; i < nPlayers; i++) {
    seats.push({ seat: i, id: 'ai:' + i, name: AI_ROSTER[i % AI_ROSTER.length], isAI: true });
  }
  const g = E.create(seats, { rng: E.mulberry32(seed), difficulty, seed });

  let steps = 0;
  while (g.phase !== 'gameover' && steps < TURN_CAP) {
    const seat = pendingSeat(g);
    if (seat == null) { agg.problems.push(`seed ${seed}: no pending seat in phase ${g.phase}`); return; }
    const decision = E.aiResolve(g, seat);
    if (!decision) { agg.problems.push(`seed ${seed}: null decision, phase ${g.phase}, seat ${seat}`); return; }

    // Targeting instrumentation: before applying a targeted action, ask whether
    // the chosen target is this actor's perceived #1 threat.
    if (decision.kind === 'action' && ['sting', 'banish', 'pilfer'].includes(decision.action)) {
      const actor = g.players.find(p => p.seat === seat);
      const rivals = g.players.filter(p => p.alive && p.seat !== seat);
      if (rivals.length) {
        const top = Math.max(...rivals.map(x => threatOf(actor, x)));
        const chosen = g.players.find(p => p.seat === decision.targetSeat);
        const isTop = chosen && threatOf(actor, chosen) === top;
        agg.targeted++;
        if (isTop) agg.hitTop++;
        // Bucketed by rivals alive: with only 1–2 rivals the choice is near-
        // forced, so the interesting signal is full-table (3+ rivals) decisions.
        if (rivals.length >= 3) { agg.targetedFull++; if (isTop) agg.hitTopFull++; }
      }
    }

    apply(g, seat, decision);
    if (!checkInvariants(g, seed, agg.problems)) return;
    steps++;
  }

  if (g.phase !== 'gameover') { agg.stalls++; agg.problems.push(`seed ${seed}: STALL after ${steps} steps (round ${g.round})`); return; }

  const alive = g.players.filter(p => p.alive);
  if (alive.length !== 1) { agg.problems.push(`seed ${seed}: ${alive.length} survivors at gameover`); return; }
  const w = g.players.find(p => p.seat === g.winner);
  agg.winsBySeat[g.winner] = (agg.winsBySeat[g.winner] || 0) + 1;
  agg.winsByName[w.name] = (agg.winsByName[w.name] || 0) + 1;
  agg.rounds.push(g.round);
  agg.completed++;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(n, d) { return d ? (100 * n / d).toFixed(1) + '%' : 'n/a'; }

function main() {
  const games = parseInt(process.argv[2], 10) || 2000;
  const nPlayers = parseInt(process.argv[3], 10) || 4;
  const difficulty = process.argv[4] || 'smart';
  const baseSeed = parseInt(process.argv[5], 10) || 1;

  const agg = {
    completed: 0, stalls: 0, targeted: 0, hitTop: 0, targetedFull: 0, hitTopFull: 0,
    winsBySeat: {}, winsByName: {}, rounds: [], problems: [],
  };

  const t0 = Date.now();
  for (let k = 0; k < games; k++) playGame(baseSeed + k, nPlayers, difficulty, agg);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nBriar self-play — ${games} games, ${nPlayers} players, difficulty=${difficulty}, baseSeed=${baseSeed} (${dt}s)`);
  console.log(`completed=${agg.completed}  stalls=${agg.stalls}  invariant-issues=${agg.problems.length}`);

  console.log('\nWin rate by seat position:');
  for (let i = 0; i < nPlayers; i++) console.log(`  seat ${i}: ${pct(agg.winsBySeat[i] || 0, agg.completed)}`);

  console.log('\nWin rate by courtier:');
  for (const name of Object.keys(agg.winsByName).sort((a, b) => agg.winsByName[b] - agg.winsByName[a]))
    console.log(`  ${name.padEnd(14)} ${pct(agg.winsByName[name], agg.completed)}`);

  console.log(`\nTargeting — share of targeted actions on perceived #1 threat:`);
  console.log(`  overall:            ${pct(agg.hitTop, agg.targeted)}  (n=${agg.targeted})`);
  console.log(`  full-table (3+ rivals): ${pct(agg.hitTopFull, agg.targetedFull)}  (n=${agg.targetedFull})`);
  console.log(`  §1.1 acceptance reads the full-table bucket: ~65–80% smart, flatter on simple.`);

  console.log(`\nGame length (rounds): median=${median(agg.rounds)}  mean=${(agg.rounds.reduce((a, b) => a + b, 0) / (agg.rounds.length || 1)).toFixed(1)}  min=${Math.min(...agg.rounds)}  max=${Math.max(...agg.rounds)}`);
  console.log(`Guard: median below ~6 rounds suggests challenge-suicide regression.`);

  if (agg.problems.length) {
    console.log(`\n⚠️  ${agg.problems.length} problem(s) — first 10:`);
    for (const p of agg.problems.slice(0, 10)) console.log('  ' + p);
    process.exitCode = 1;
  } else {
    console.log('\n✅ No invariant violations, stalls, or state-machine faults.');
  }
}

main();
