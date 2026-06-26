/**
 * card_engine.js  —  DUAL ENGINE (server + client)
 *
 * Deploys to BOTH:
 *   server: lib/card_engine.js   (require)
 *   client: js/card-engine.js    (window.CARD_ENGINE)
 *
 * The deck state machine: shuffle, draw, discard, reshuffle, energy, and the
 * ctx helpers card effects use. Everything that consumes randomness pulls from
 * the battle's seeded RNG (state._rng) so the server replay is identical to
 * the client. NO Math.random() anywhere in this file.
 *
 * Deck state lives at state.deck (ONE shared deck for the whole player side,
 * per the MVP design):
 *   {
 *     drawPile:    [cardKey, ...],   // top of pile = end of array (pop)
 *     hand:        [cardKey, ...],
 *     discardPile: [cardKey, ...],
 *     exhausted:   [cardKey, ...],   // removed for the rest of this battle
 *     energy:      number,
 *     energyMax:   number,
 *     handSize:    number
 *   }
 *
 * Energy is per-active-turn for the player side. In the MVP the player side
 * shares one energy pool and one hand; whichever player unit is acting plays
 * from it. (Per-citizen hands are a future expansion — the state shape leaves
 * room by keying nothing to a unit id here.)
 */
(function (root) {
  'use strict';

  // Card lookups go through the registry when present (DB cards), falling back
  // to card_definitions (code seed). DECK/expandDeck use registry too.
  var DEFS = (typeof module !== 'undefined' && module.exports)
    ? (function () { try { return require('./card_registry'); } catch (e) { return require('./card_definitions'); } })()
    : (root && (root.CARD_REGISTRY || root.CARD_DEFS));

  var DEFAULT_HAND_SIZE = 5;
  var DEFAULT_ENERGY = 3;

  // --- seeded RNG plumbing -------------------------------------------------
  // Kindlewood's combat engine reseeds a mulberry32 per action from
  //   _seed + _actionsApplied * 17
  // rather than threading one continuous stream. Deck operations (shuffle,
  // reshuffle) must be deterministic on replay too, so we derive a fresh
  // seeded RNG per deck operation from the battle seed plus a monotonically
  // increasing deck-op counter, kept on state._deckOps. This guarantees the
  // server replay and the client produce identical shuffles WITHOUT colliding
  // with the engine's per-action RNG stream.
  function mulberry32(seed) {
    var a = (seed | 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Returns a NEW seeded rng for the next deck operation and bumps the counter.
  // Falls back to a stable seed of 1 for unseeded (test) battles so behaviour
  // is still repeatable within a single run.
  function nextDeckRng(state) {
    var base = (state && state._deckSeed != null) ? (state._deckSeed | 0)
             : (state && state._seed != null)     ? (state._seed | 0)
             : 1;
    state._deckOps = (state._deckOps || 0) + 1;
    // Offset by a large prime-ish stride so deck ops never alias the engine's
    // per-action stream (_seed + actionsApplied*17).
    return mulberry32(base + state._deckOps * 1009 + 7919);
  }

  // Back-compat shim: some helpers historically called ensureRng(state). We
  // keep it returning a per-call deck rng so old call sites stay deterministic.
  function ensureRng(state) {
    return nextDeckRng(state);
  }

  // Fisher–Yates using the seeded rng. Mutates the array in place.
  function shuffleSeeded(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Initialise deck state on a battle. deckMap is the settlement's active
   * template as { cardKey: count }. Shuffles and draws the opening hand.
   */
  function initDeck(state, deckMap, opts) {
    opts = opts || {};
    var rng = ensureRng(state);
    var defs = DEFS;
    var pile = defs.expandDeck(deckMap);
    shuffleSeeded(pile, rng);

    state.deck = {
      drawPile: pile,
      hand: [],
      discardPile: [],
      exhausted: [],
      withered: [],
      energy: opts.energy != null ? opts.energy : DEFAULT_ENERGY,
      energyMax: opts.energy != null ? opts.energy : DEFAULT_ENERGY,
      handSize: opts.handSize != null ? opts.handSize : DEFAULT_HAND_SIZE,
    };

    drawCards(state, state.deck.handSize);
    return state.deck;
  }

  // Reshuffle discard back into draw (seeded). Exhausted cards stay out.
  function reshuffle(state) {
    var d = state.deck;
    if (!d) return [];
    var rng = ensureRng(state);
    if (d.discardPile.length === 0) return [];
    var moved = d.discardPile.length;
    while (d.discardPile.length) d.drawPile.push(d.discardPile.pop());
    shuffleSeeded(d.drawPile, rng);
    return [{ type: 'deck-reshuffled', count: moved, log: 'The deck is reshuffled.' }];
  }

  var MAX_HAND = 10;

  // Draw up to n cards into the hand, reshuffling when the draw pile empties.
  // The hand is capped at MAX_HAND (10). A drawn card that would exceed the cap
  // is "burned" — it's revealed from the draw pile but goes straight to discard,
  // emitting a card-burned event so the UI can animate draw→discard.
  function drawCards(state, n) {
    var d = state.deck;
    if (!d) return [];
    var events = [];
    for (var i = 0; i < n; i++) {
      if (d.drawPile.length === 0) {
        var rs = reshuffle(state);
        for (var k = 0; k < rs.length; k++) events.push(rs[k]);
        if (d.drawPile.length === 0) break; // genuinely nothing left to draw
      }
      var key = d.drawPile.pop();
      if (d.hand.length >= MAX_HAND) {
        // Hand full — burn the card to discard.
        d.discardPile.push(key);
        events.push({ type: 'card-burned', card: key, log: 'Hand is full \u2014 ' + key + ' was discarded.' });
        continue;
      }
      d.hand.push(key);
      events.push({ type: 'card-drawn', card: key });
    }
    return events;
  }

  // Move every card in hand to discard (end-of-turn discard rule).
  function discardHand(state) {
    var d = state.deck;
    if (!d) return [];
    var n = d.hand.length;
    while (d.hand.length) d.discardPile.push(d.hand.pop());
    return n ? [{ type: 'hand-discarded', count: n }] : [];
  }

  // Can the active side afford to play the card at hand index?
  function canPlay(state, handIndex) {
    var d = state.deck;
    if (!d) return { ok: false, reason: 'no-deck' };
    var key = d.hand[handIndex];
    if (!key) return { ok: false, reason: 'empty-slot' };
    var card = DEFS.getCard(key);
    if (!card) return { ok: false, reason: 'unknown-card' };
    if (card.cost > d.energy) return { ok: false, reason: 'no-energy' };
    return { ok: true, card: card, key: key };
  }

  // Spend energy + remove the played card from hand. Returns the card def.
  // The actual EFFECT is run by the combat engine (which owns dealDamage etc.).
  function consumeCard(state, handIndex) {
    var d = state.deck;
    var check = canPlay(state, handIndex);
    if (!check.ok) return null;
    d.energy -= check.card.cost;
    d.hand.splice(handIndex, 1);
    // Withering cards are spent for the rest of combat — they go to the
    // "withered" pile (never reshuffled, never redrawn) instead of discard.
    if (check.card.wither) {
      if (!d.withered) d.withered = [];
      d.withered.push(check.key);
    } else {
      d.discardPile.push(check.key);
    }
    return check.card;
  }

  // Refill energy to max (start of the player side's turn).
  function refillEnergy(state) {
    var d = state.deck;
    if (!d) return;
    d.energy = d.energyMax;
  }

  function grantEnergy(state, amount) {
    var d = state.deck;
    if (!d) return [];
    d.energy = Math.max(0, d.energy + amount);
    return [{ type: 'energy-changed', energy: d.energy }];
  }

  // End-of-turn: discard hand, refill energy, draw a fresh hand.
  function endTurnCycle(state) {
    var d = state.deck;
    if (!d) return [];
    var events = [];
    events = events.concat(discardHand(state));
    refillEnergy(state);
    events.push({ type: 'energy-changed', energy: d.energy });
    events = events.concat(drawCards(state, d.handSize));
    return events;
  }

  var API = {
    DEFAULT_HAND_SIZE: DEFAULT_HAND_SIZE,
    DEFAULT_ENERGY: DEFAULT_ENERGY,
    ensureRng: ensureRng,
    shuffleSeeded: shuffleSeeded,
    initDeck: initDeck,
    reshuffle: reshuffle,
    drawCards: drawCards,
    discardHand: discardHand,
    canPlay: canPlay,
    consumeCard: consumeCard,
    refillEnergy: refillEnergy,
    grantEnergy: grantEnergy,
    endTurnCycle: endTurnCycle,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  if (root) {
    root.CARD_ENGINE = API;
  }
})(typeof window !== 'undefined' ? window : null);
