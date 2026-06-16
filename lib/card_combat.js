/**
 * card_combat.js  —  DUAL ENGINE (server + client)
 *
 * Deploys to BOTH:
 *   server: lib/card_combat.js   (require)
 *   client: js/card-combat.js    (window.CARD_COMBAT)
 *
 * Bridges the card system to your existing combat-engine unit model. This is
 * the ONLY file that needs to know about your engine's unit shape and event
 * conventions, so adapting to the live engine = editing helpers here, not the
 * data-driven card defs.
 *
 * ASSUMPTIONS about the engine state / units (verify against combat-engine.js
 * and adjust the helpers if these differ):
 *   - state.units: [{ id, side('player'|'enemy'), hp, maxHp, flags:{downed},
 *                     stats:{}, skills:{}, block?:number, buffs?:{} }]
 *   - emit/event objects are plain {type, ...} pushed to state.events; the
 *     engine's emit() fans them to listeners. We RETURN event arrays and let
 *     the caller emit them, matching how action.perform() already returns
 *     events in your engine.
 *   - downed = hp<=0; engine marks flags.downed after an action resolves.
 *
 * Damage model: block absorbs damage first, remainder hits hp. A one-shot
 * 'damage_bonus' buff (granted by Rally) is added to the next outgoing attack
 * then cleared.
 */
(function (root) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var DEFS = isNode ? require('./card_definitions') : (root && root.CARD_DEFS);
  var DECK = isNode ? require('./card_engine') : (root && root.CARD_ENGINE);

  // --- unit helpers --------------------------------------------------------
  function alive(u) { return u && u.hp > 0 && !(u.flags && u.flags.downed); }

  function enemiesOf(state, actor) {
    return state.units.filter(function (u) {
      return u.side !== actor.side && alive(u);
    });
  }
  function alliesOf(state, actor) {
    return state.units.filter(function (u) {
      return u.side === actor.side && u.id !== actor.id && alive(u);
    });
  }

  // --- ctx helpers (what card effects call) --------------------------------
  // Each returns an array of engine events describing what happened.

  function dealDamage(state, actor, target, amount, source) {
    if (!alive(target)) return [];
    // consume one-shot damage_bonus buff
    var bonus = 0;
    if (actor.buffs && actor.buffs.damage_bonus) {
      bonus = actor.buffs.damage_bonus;
      actor.buffs.damage_bonus = 0;
    }
    var total = Math.max(1, (amount | 0) + bonus);

    // Honour the engine's Defend flag the same way _resolveDamage does:
    // a defending target halves the incoming hit (min 1).
    var mitigated = 0;
    if (target.flags && target.flags.defending) {
      var before = total;
      total = Math.max(1, Math.round(total * 0.5));
      mitigated = before - total;
    }

    // Card block (from Defend card) absorbs after the defend-halving.
    var absorbed = 0;
    if (target.block && target.block > 0) {
      absorbed = Math.min(target.block, total);
      target.block -= absorbed;
      total -= absorbed;
    }

    target.hp = Math.max(0, target.hp - total);
    var fell = target.hp === 0;

    // Emit the engine's NATIVE damage event shape so combat-ui.js animates
    // card hits with no UI changes. (mitigated = defend-halving; absorbed =
    // card block, surfaced as an extra field the UI can ignore.)
    return [{
      type: 'damage',
      actor_id: actor.id,
      target_id: target.id,
      amount: total,
      mitigated: mitigated,
      absorbed: absorbed,
      bonus: bonus,
      source: source || 'card',
      fell: fell,
      log: actor.name + ' ' + (source === 'quick_jab' ? 'jabs ' : 'hits ') + target.name +
           ' for ' + total + ' damage' +
           (mitigated ? ' (defended, ' + mitigated + ' absorbed)' : '') +
           (absorbed ? ' (' + absorbed + ' blocked)' : '') + '.' +
           (fell ? ' ' + target.name + ' falls.' : ''),
    }];
  }

  function addBlock(actor, amount, source) {
    actor.block = (actor.block || 0) + Math.max(0, amount | 0);
    return [{
      type: 'block-gained',
      unit_id: actor.id,
      amount: amount | 0,
      total: actor.block,
      source: source || 'card',
      log: actor.name + ' braces (+' + (amount | 0) + ' block).',
    }];
  }

  function applyBuff(target, buffKey, amount, source) {
    if (!target.buffs) target.buffs = {};
    target.buffs[buffKey] = (target.buffs[buffKey] || 0) + (amount | 0);
    return [{
      type: 'buff-applied',
      unit_id: target.id,
      buff: buffKey,
      amount: amount | 0,
      source: source || 'card',
      log: target.name + ' is rallied (+' + (amount | 0) + ' next hit).',
    }];
  }

  // grantEnergy is on the deck (side-wide), not the unit.
  function grantEnergy(state, amount, source) {
    var evs = DECK.grantEnergy(state, amount);
    evs.forEach(function (e) {
      e.log = '+' + amount + ' energy.';
      e.source = source || 'card';
    });
    return evs;
  }

  // Resolve which target a card wants, given a requested targetId.
  function resolveTarget(state, actor, card, requestedTargetId) {
    var byId = function (id) {
      return state.units.filter(function (u) { return u.id === id; })[0] || null;
    };
    switch (card.target) {
      case 'self':
        return actor;
      case 'enemy': {
        var t = requestedTargetId != null ? byId(requestedTargetId) : null;
        if (t && alive(t) && t.side !== actor.side) return t;
        return enemiesOf(state, actor)[0] || null; // auto-pick first enemy
      }
      case 'ally': {
        var a = requestedTargetId != null ? byId(requestedTargetId) : null;
        if (a && alive(a) && a.side === actor.side) return a;
        var allies = alliesOf(state, actor);
        return allies[0] || actor; // fall back to self (Rally handles this)
      }
      default:
        return requestedTargetId != null ? byId(requestedTargetId) : null;
    }
  }

  /**
   * Play a card from the active side's hand.
   *   handIndex      — index into state.deck.hand
   *   requestedTargetId — optional unit id the player chose
   * Returns { ok, events, error }. Caller (combat engine) emits the events.
   */
  function playCard(state, actor, handIndex, requestedTargetId) {
    if (!state.deck) return { ok: false, error: 'no-deck', events: [] };
    var check = DECK.canPlay(state, handIndex);
    if (!check.ok) return { ok: false, error: check.reason, events: [] };

    var card = check.card;
    var target = resolveTarget(state, actor, card, requestedTargetId);

    // Spend energy + move card to discard BEFORE running effect, so effects
    // that grant energy (Rally-when-alone) read a correct post-cost pool.
    DECK.consumeCard(state, handIndex);

    var ctx = {
      // Lazy: only derive a deck-op rng if an effect actually calls ctx.rng().
      // Otherwise playing a non-random card would bump the deck-op counter and
      // desync replay shuffles. None of the four MVP cards use ctx.rng, but
      // future cards (e.g. a random-target card) can.
      rng: function () { return DECK.ensureRng(state)(); },
      dealDamage: function (a, t, amt, src) { return dealDamage(state, a, t, amt, src); },
      addBlock: function (a, amt, src) { return addBlock(a, amt, src); },
      applyBuff: function (t, k, amt, src) { return applyBuff(t, k, amt, src); },
      grantEnergy: function (a, amt, src) { return grantEnergy(state, amt, src); },
    };

    var events = [{
      type: 'card-played',
      actor_id: actor.id,
      card: card.key,
      cost: card.cost,
      target_id: target ? target.id : null,
      log: actor.name + ' plays ' + card.name + '.',
    }];

    var effectEvents = [];
    try {
      effectEvents = card.effect(state, actor, target, ctx) || [];
    } catch (e) {
      effectEvents = [{ type: 'card-error', card: card.key, message: String(e && e.message || e) }];
    }
    events = events.concat(effectEvents);
    return { ok: true, events: events, card: card };
  }

  var API = {
    alive: alive,
    enemiesOf: enemiesOf,
    alliesOf: alliesOf,
    dealDamage: dealDamage,
    addBlock: addBlock,
    applyBuff: applyBuff,
    grantEnergy: grantEnergy,
    resolveTarget: resolveTarget,
    playCard: playCard,
  };

  if (isNode) module.exports = API;
  if (root) root.CARD_COMBAT = API;
})(typeof window !== 'undefined' ? window : null);
