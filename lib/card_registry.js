/**
 * card_registry.js  —  DUAL ENGINE (server + client)
 *
 * Deploys to BOTH:
 *   server: lib/card_registry.js   (require)
 *   client: js/card-registry.js    (window.CARD_REGISTRY)
 *
 * Cards now live in the DB (card_templates). This registry holds the active set
 * of cards as runtime objects (with a compiled effect from the formula DSL) and
 * is the single place the engine looks up a card by key.
 *
 * Resolution order in getCard(key):
 *   1. a card loaded into this registry (from DB rows), else
 *   2. the code-defined fallback in card_definitions.js (seed/offline safety).
 *
 * The server loads DB rows into the registry before each battle (so replay is
 * deterministic against whatever the cards currently are). The client loads the
 * same rows it receives from the serialized battle / a fetch, so its rendering
 * and any local (test) battle match the server.
 */
(function (root) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var DEFS    = isNode ? require('./card_definitions') : (root && root.CARD_DEFS);
  var FORMULA = isNode ? require('./card_formula')     : (root && root.CARD_FORMULA);

  // key -> runtime card object
  var _cards = {};

  // Build a runtime card object from a DB row. Compiles the formula into an
  // effect(state, actor, target, ctx) closure using the formula interpreter.
  function fromRow(row) {
    var card = {
      key: row.card_key,
      name: row.name,
      cost: (row.cost != null ? row.cost : 1) | 0,
      type: row.card_type || 'attack',
      target: row.target || 'enemy',
      rarity: row.rarity || 'common',
      desc: row.description || '',
      formula: row.formula || '',
      art_url: row.art_url || null,
      sfx: row.sfx || null,
      hit: row.hit || 'choose',
      pierce_count: (row.pierce_count != null ? row.pierce_count : null),
      pierce_falloff: (row.pierce_falloff != null ? row.pierce_falloff : 1.0),
      wither: !!row.wither,
      metadata: row.metadata || {},
    };
    card.effect = (FORMULA && card.formula)
      ? FORMULA.compileEffect(card.formula)
      : function () { return []; };
    return card;
  }

  // Replace the entire registry from a list of DB rows.
  function loadRows(rows) {
    _cards = {};
    (rows || []).forEach(function (row) {
      var c = fromRow(row);
      _cards[c.key] = c;
    });
    return Object.keys(_cards).length;
  }

  // Add/replace a single card from a row (used after an edit).
  function upsertRow(row) {
    var c = fromRow(row);
    _cards[c.key] = c;
    return c;
  }

  function clear() { _cards = {}; }
  function isLoaded() { return Object.keys(_cards).length > 0; }

  // Primary lookup: registry first, then code fallback.
  function getCard(key) {
    if (_cards[key]) return _cards[key];
    if (DEFS && DEFS.getCard) return DEFS.getCard(key);
    return null;
  }

  function allCards() {
    // Merge: registry wins, code fills any gaps (so an empty registry still
    // yields the seed cards for safety).
    var out = {};
    if (DEFS && DEFS.CARDS) Object.keys(DEFS.CARDS).forEach(function (k) { out[k] = DEFS.getCard(k); });
    Object.keys(_cards).forEach(function (k) { out[k] = _cards[k]; });
    return out;
  }

  // Targeting helpers proxy to card_definitions' taxonomy (mode tables live
  // there and don't depend on whether a card is DB- or code-defined).
  function targetMode(card) { return DEFS && DEFS.targetMode ? DEFS.targetMode(card) : { manual: false, aoe: false, side: 'none' }; }
  function needsManualTarget(card) { return DEFS && DEFS.needsManualTarget ? DEFS.needsManualTarget(card) : false; }
  function isAoE(card) { return DEFS && DEFS.isAoE ? DEFS.isAoE(card) : false; }

  // Expand a { key: count } deck map into a flat key array, using whichever
  // source has the card. Mirrors DEFS.expandDeck but registry-aware.
  function expandDeck(deckMap) {
    var out = [];
    var map = deckMap || (DEFS ? DEFS.DEFAULT_DECK : {});
    Object.keys(map).forEach(function (k) {
      if (!getCard(k)) return;
      var n = map[k] | 0;
      for (var i = 0; i < n; i++) out.push(k);
    });
    return out;
  }

  var API = {
    loadRows: loadRows,
    upsertRow: upsertRow,
    clear: clear,
    isLoaded: isLoaded,
    getCard: getCard,
    allCards: allCards,
    expandDeck: expandDeck,
    targetMode: targetMode,
    needsManualTarget: needsManualTarget,
    isAoE: isAoE,
    // re-export so callers can use a single module
    DEFAULT_DECK: DEFS ? DEFS.DEFAULT_DECK : {},
    scaledAmount: DEFS ? DEFS.scaledAmount : null,
  };

  if (isNode) module.exports = API;
  if (root) root.CARD_REGISTRY = API;
})(typeof window !== 'undefined' ? window : null);
