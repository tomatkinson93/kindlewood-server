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

  // ── Targeting taxonomy ───────────────────────────────────────────────────
  // A card's `target` declares who it can affect. The UI uses this to decide
  // whether to prompt for a target and which units to highlight; the engine
  // uses it to resolve/validate. Adding a new card = pick a target mode; no
  // engine changes needed.
  //
  //   'self'         actor only (no prompt)
  //   'enemy'        one enemy   (prompt: highlight enemies)
  //   'ally'         one ally other than self, falls back to self (prompt: allies)
  //   'ally_or_self' one friendly incl. self (prompt: all friendly)
  //   'any'          one unit, either side (prompt: everyone)
  //   'all_enemies'  AoE every living enemy (no prompt)
  //   'all_allies'   every living friendly incl. self (no prompt)
  //   'none'         no unit target — pure economy (energy/self) (no prompt)
  var TARGET_MODES = {
    self:         { manual: false, side: 'self',  aoe: false },
    enemy:        { manual: true,  side: 'enemy', aoe: false },
    ally:         { manual: true,  side: 'ally',  aoe: false },
    ally_or_self: { manual: true,  side: 'ally_or_self', aoe: false },
    any:          { manual: true,  side: 'any',   aoe: false },
    all_enemies:  { manual: false, side: 'enemy', aoe: true  },
    all_allies:   { manual: false, side: 'ally_or_self', aoe: true },
    none:         { manual: false, side: 'none',  aoe: false },
  };

  function targetMode(card) {
    return TARGET_MODES[card && card.target] || TARGET_MODES.none;
  }
  // Does the player need to click a unit before this card resolves?
  // (Manual modes only prompt when there's a real choice — i.e. >1 candidate.)
  function needsManualTarget(card) {
    return !!targetMode(card).manual;
  }
  function isAoE(card) {
    return !!targetMode(card).aoe;
  }

  var API_TARGETING = {
    TARGET_MODES: TARGET_MODES,
    targetMode: targetMode,
    needsManualTarget: needsManualTarget,
    isAoE: isAoE,
  };

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

    // ── Example cards using the richer taxonomy (not in the starter deck;
    //    unlock via research/quests). They show the patterns for AoE, debuff,
    //    energy economy, and healing so new cards are copy-paste. ──────────

    cleave: {
      key: 'cleave',
      name: 'Cleave',
      cost: 2,
      type: 'attack',
      target: 'all_enemies',          // AoE — engine loops the effect per enemy
      desc: 'Strike every enemy for moderate damage. Scales with Strength.',
      scaling: { primary: 'strength', weightP: 0.5, skill: 'combat', weightS: 0.4, base: 3 },
      effect: function (state, actor, target, ctx) {
        if (!target) return [];
        var dmg = Math.max(1, Math.round(scaledAmount(actor, this.scaling)));
        return ctx.dealDamage(actor, target, dmg, 'cleave');
      },
    },

    weaken: {
      key: 'weaken',
      name: 'Weaken',
      cost: 1,
      type: 'support',                // support = debuff in card-type coloring
      target: 'enemy',
      desc: 'Sap an enemy\u2019s strength: their attacks deal less for the fight.',
      scaling: { primary: 'intelligence', weightP: 0.3, skill: 'combat', weightS: 0.2, base: 2 },
      effect: function (state, actor, target, ctx) {
        if (!target) return [];
        var amt = Math.max(1, Math.round(scaledAmount(actor, this.scaling)));
        return ctx.applyDebuff(target, 'weak', amt, 'weaken');
      },
    },

    expose: {
      key: 'expose',
      name: 'Expose',
      cost: 1,
      type: 'support',
      target: 'enemy',
      desc: 'Mark an enemy vulnerable: they take extra damage from all sources.',
      scaling: { primary: 'agility', weightP: 0.3, skill: 'combat', weightS: 0.2, base: 2 },
      effect: function (state, actor, target, ctx) {
        if (!target) return [];
        var amt = Math.max(1, Math.round(scaledAmount(actor, this.scaling)));
        return ctx.applyDebuff(target, 'vulnerable', amt, 'expose');
      },
    },

    focus: {
      key: 'focus',
      name: 'Focus',
      cost: 0,
      type: 'support',
      target: 'none',                 // pure economy — no unit target/prompt
      desc: 'Center yourself: gain 2 energy this turn.',
      scaling: { base: 2 },
      effect: function (state, actor, target, ctx) {
        return ctx.grantEnergy(actor, 2, 'focus');
      },
    },

    mend: {
      key: 'mend',
      name: 'Mend',
      cost: 1,
      type: 'support',
      target: 'ally_or_self',         // any friendly incl. self — prompt
      desc: 'Heal a friendly unit. Scales with Intelligence.',
      scaling: { primary: 'intelligence', weightP: 0.6, skill: 'combat', weightS: 0.2, base: 4 },
      effect: function (state, actor, target, ctx) {
        var t = target || actor;
        var amt = Math.max(1, Math.round(scaledAmount(actor, this.scaling)));
        return ctx.heal(t, amt, 'mend');
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
    TARGET_MODES: API_TARGETING.TARGET_MODES,
    targetMode: API_TARGETING.targetMode,
    needsManualTarget: API_TARGETING.needsManualTarget,
    isAoE: API_TARGETING.isAoE,
  };

  // Dual-engine export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  if (root) {
    root.CARD_DEFS = API;
  }
})(typeof window !== 'undefined' ? window : null);
