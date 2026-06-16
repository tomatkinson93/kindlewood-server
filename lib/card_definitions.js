/**
 * card_definitions.js  —  DUAL ENGINE (server + client)
 *
 * Deploys to BOTH:
 *   server: lib/card_definitions.js   (require)
 *   client: js/card-definitions.js    (window.CARD_DEFS)
 *
 * Data-driven registry of combat cards. A card is pure data plus an `effect`
 * function. Effects receive the live battle `state`, the `actor` unit, an
 * optional `target` unit, and a `ctx` object exposing engine helpers
 * (rng, dealDamage, addBlock, grantEnergy, applyBuff, log). Effects MUST NOT
 * call Math.random() directly — all randomness comes through ctx.rng so the
 * server replay stays deterministic.
 *
 * To add a card later: append an entry here, ship the file to both sides,
 * bump the ?v= on the client script tag. No engine edits required for
 * effects built from the ctx helpers below.
 */
(function (root) {
  'use strict';

  // --- scaling helpers -----------------------------------------------------
  // Combat units in Kindlewood's engine carry stats FLATTENED onto the unit
  // (see unitFromCitizen in combat_engine.js): u.strength, u.agility,
  // u.endurance, u.intelligence, and u.combatSkill — NOT nested under
  // u.stats / u.skills. We read flat first, then fall back to nested so the
  // card defs also work in isolation/tests that use the nested shape.
  var SKILL_ALIASES = { combat: 'combatSkill' };
  function stat(u, key) {
    if (!u) return 0;
    if (typeof u[key] === 'number') return u[key];                 // flattened
    if (u.stats && typeof u.stats[key] === 'number') return u.stats[key]; // nested
    return 0;
  }
  function skill(u, key) {
    if (!u) return 0;
    var flatKey = SKILL_ALIASES[key] || key;
    if (typeof u[flatKey] === 'number') return u[flatKey];         // flattened (combatSkill)
    if (u.skills && typeof u.skills[key] === 'number') return u.skills[key]; // nested
    return 0;
  }

  // A scaling descriptor is { primary, weightP, skill, weightS, base }.
  // value = base + primary*weightP + combatSkill*weightS, floored at 1 for damage.
  function scaledAmount(actor, scaling) {
    var p = stat(actor, scaling.primary) * (scaling.weightP || 0);
    var s = skill(actor, scaling.skill || 'combat') * (scaling.weightS || 0);
    return (scaling.base || 0) + p + s;
  }

  /**
   * CARDS registry. Keys are stable IDs (used in DB deck rows + action logs).
   * NEVER rename a key once shipped — it's persisted in deck templates and
   * replayed from action logs.
   */
  var CARDS = {
    strike: {
      key: 'strike',
      name: 'Strike',
      cost: 1,
      type: 'attack',
      target: 'enemy',
      desc: 'Deal damage scaling with Strength and Combat.',
      scaling: { primary: 'strength', weightP: 0.6, skill: 'combat', weightS: 0.8, base: 4 },
      effect: function (state, actor, target, ctx) {
        if (!target) return [];
        var dmg = Math.max(1, Math.round(scaledAmount(actor, this.scaling)));
        return ctx.dealDamage(actor, target, dmg, 'strike');
      },
    },

    defend: {
      key: 'defend',
      name: 'Defend',
      cost: 1,
      type: 'defense',
      target: 'self',
      desc: 'Gain block scaling with Endurance and Combat.',
      scaling: { primary: 'endurance', weightP: 0.7, skill: 'combat', weightS: 0.5, base: 4 },
      effect: function (state, actor, target, ctx) {
        var blk = Math.max(1, Math.round(scaledAmount(actor, this.scaling)));
        return ctx.addBlock(actor, blk, 'defend');
      },
    },

    quick_jab: {
      key: 'quick_jab',
      name: 'Quick Jab',
      cost: 0,
      type: 'attack',
      target: 'enemy',
      desc: 'A free, low-damage hit scaling with Agility.',
      scaling: { primary: 'agility', weightP: 0.5, skill: 'combat', weightS: 0.4, base: 2 },
      effect: function (state, actor, target, ctx) {
        if (!target) return [];
        var dmg = Math.max(1, Math.round(scaledAmount(actor, this.scaling)));
        return ctx.dealDamage(actor, target, dmg, 'quick_jab');
      },
    },

    rally: {
      key: 'rally',
      name: 'Rally',
      cost: 1,
      type: 'support',
      target: 'ally', // resolves to actor if no other ally is alive
      desc: 'Buff an ally\u2019s next attack, scaling with Charisma. If alone, regain 1 energy.',
      scaling: { primary: 'charisma', weightP: 0.4, skill: 'combat', weightS: 0.2, base: 2 },
      effect: function (state, actor, target, ctx) {
        // If there's a valid ally target other than self, buff them.
        if (target && target.id !== actor.id) {
          var amt = Math.max(1, Math.round(scaledAmount(actor, this.scaling)));
          return ctx.applyBuff(target, 'damage_bonus', amt, 'rally');
        }
        // Otherwise refund energy so the card is never dead.
        return ctx.grantEnergy(actor, 1, 'rally');
      },
    },
  };

  // The default deck composition for a brand-new settlement, expressed as
  // { cardKey: count }. Mirrored by the SQL seed; kept here so the engine can
  // fall back to a sane deck if the DB row is missing.
  var DEFAULT_DECK = {
    strike: 5,
    defend: 5,
    quick_jab: 2,
    rally: 1,
  };

  function getCard(key) {
    return CARDS[key] || null;
  }

  // Expand a { key: count } map into a flat array of card keys (the raw,
  // pre-shuffle draw pile contents).
  function expandDeck(deckMap) {
    var out = [];
    var map = deckMap || DEFAULT_DECK;
    Object.keys(map).forEach(function (k) {
      if (!CARDS[k]) return; // skip unknown keys defensively
      var n = map[k] | 0;
      for (var i = 0; i < n; i++) out.push(k);
    });
    return out;
  }

  var API = {
    CARDS: CARDS,
    DEFAULT_DECK: DEFAULT_DECK,
    getCard: getCard,
    expandDeck: expandDeck,
    scaledAmount: scaledAmount,
  };

  // Dual-engine export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  if (root) {
    root.CARD_DEFS = API;
  }
})(typeof window !== 'undefined' ? window : null);
