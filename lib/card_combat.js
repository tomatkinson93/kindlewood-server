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
  // Prefer the runtime registry (DB cards) and fall back to code definitions.
  var DEFS = isNode
    ? (function () { try { return require('./card_registry'); } catch (e) { return require('./card_definitions'); } })()
    : (root && (root.CARD_REGISTRY || root.CARD_DEFS));
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

  // ── Formation helpers (positions; 1 = front) ─────────────────────────────
  function orderedSide(state, side) {
    return state.units
      .filter(function (u) { return u.side === side && alive(u); })
      .sort(function (a, b) { return (a.pos || 99) - (b.pos || 99); });
  }
  function frontmost(state, side) { var o = orderedSide(state, side); return o[0] || null; }
  function backmost(state, side) { var o = orderedSide(state, side); return o[o.length - 1] || null; }
  function isFront(state, unit) { var f = frontmost(state, unit.side); return !!(f && f.id === unit.id); }
  function isBack(state, unit) { var b = backmost(state, unit.side); return !!(b && b.id === unit.id); }
  function moveUnit(state, unit, delta) {
    var order = orderedSide(state, unit.side);
    var idx = -1;
    for (var i = 0; i < order.length; i++) if (order[i].id === unit.id) { idx = i; break; }
    if (idx < 0) return [];
    var target = Math.max(0, Math.min(order.length - 1, idx + delta));
    if (target === idx) return [];
    var moved = order.splice(idx, 1)[0];
    order.splice(target, 0, moved);
    for (var j = 0; j < order.length; j++) order[j].pos = j + 1;
    return [{ type: 'unit-moved', unit_id: unit.id, to_pos: moved.pos,
      log: unit.name + ' moves to position ' + moved.pos + '.' }];
  }
  function pushUnit(state, unit, n) {
    if (!n) return [];
    var evs = moveUnit(state, unit, n);
    if (evs.length) evs[0].log = unit.name + (n > 0 ? ' is pushed back.' : ' is pulled forward.');
    return evs;
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

    // 'weak' on the attacker reduces outgoing damage; 'vulnerable' on the
    // target increases incoming. Both are flat magnitudes from applyDebuff.
    if (actor.buffs && actor.buffs.weak) {
      total = Math.max(1, total - (actor.buffs.weak | 0));
    }
    if (target.buffs && target.buffs.vulnerable) {
      total = total + (target.buffs.vulnerable | 0);
    }

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
    // A standing block_bonus buff increases all block this unit gains.
    var bonus = (actor.buffs && actor.buffs.block_bonus) ? (actor.buffs.block_bonus | 0) : 0;
    var total = Math.max(0, (amount | 0) + bonus);
    actor.block = (actor.block || 0) + total;
    return [{
      type: 'block-gained',
      unit_id: actor.id,
      amount: total,
      bonus: bonus,
      total: actor.block,
      source: source || 'card',
      log: actor.name + ' braces (+' + total + ' block' + (bonus ? ', incl +' + bonus + ' bonus' : '') + ').',
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
      log: target.name + ' gains ' + buffKey.replace(/_/g, ' ') + ' (+' + (amount | 0) + ').',
    }];
  }

  // Debuffs are stored in the same buffs bag as negative/positive magnitudes
  // keyed by debuff name (e.g. 'weak' reduces outgoing damage, 'vulnerable'
  // increases incoming). The engine's dealDamage reads these. Storing them
  // together keeps one place to inspect/clear per-turn.
  function applyDebuff(target, debuffKey, amount, source) {
    if (!target.buffs) target.buffs = {};
    target.buffs[debuffKey] = (target.buffs[debuffKey] || 0) + (amount | 0);
    return [{
      type: 'debuff-applied',
      unit_id: target.id,
      debuff: debuffKey,
      amount: amount | 0,
      source: source || 'card',
      log: target.name + ' is afflicted with ' + debuffKey.replace(/_/g, ' ') + ' (' + (amount | 0) + ').',
    }];
  }

  function heal(target, amount, source) {
    if (!alive(target)) return [];
    var before = target.hp;
    var max = target.maxHp || target.max_hp || target.hp;
    target.hp = Math.min(max, target.hp + Math.max(0, amount | 0));
    var gained = target.hp - before;
    return [{
      type: 'heal',
      unit_id: target.id,
      amount: gained,
      source: source || 'card',
      log: target.name + ' recovers ' + gained + ' health.',
    }];
  }

  // Draw N cards into the hand via the deck engine (deterministic, seeded).
  // Respects the hand cap; cards over the cap are burned to discard.
  function drawCards(state, n, source) {
    if (!state.deck || !DECK.drawCards) return [];
    var evs = DECK.drawCards(state, n | 0);
    return evs;
  }

  // Discard N cards from the hand (from the front; deterministic). Used by
  // cards that trade hand size for power.
  function discardCards(state, n, source) {
    if (!state.deck) return [];
    var d = state.deck;
    var out = [];
    var count = Math.min(n | 0, d.hand.length);
    for (var i = 0; i < count; i++) {
      var key = d.hand.shift();
      d.discardPile.push(key);
      out.push({ type: 'card-discarded', card: key, source: source || 'card' });
    }
    if (count) out.push({ type: 'hand-discarded-some', count: count, log: 'Discarded ' + count + ' card' + (count > 1 ? 's' : '') + '.' });
    return out;
  }

  // Gold is a settlement reward, applied post-battle. We accumulate it on the
  // battle state so the resolver/aftermath can add it to the settlement. (We do
  // NOT touch the DB here — the engine stays pure/deterministic.)
  function gainGold(state, amount, source) {
    state.bonus_gold = (state.bonus_gold || 0) + (amount | 0);
    return [{ type: 'gold-gained', amount: amount | 0, source: source || 'card',
      log: 'Gained ' + (amount | 0) + ' wealth.' }];
  }

  // Stun: the target skips its next N turns. Stored as a countdown the engine
  // decrements when it would be the unit's turn.
  function applyStun(target, turns, source) {
    if (!target.buffs) target.buffs = {};
    target.buffs.stun = (target.buffs.stun || 0) + (turns | 0);
    return [{ type: 'stun-applied', unit_id: target.id, turns: turns | 0, source: source || 'card',
      log: target.name + ' is stunned (' + (turns | 0) + ' turn' + ((turns | 0) > 1 ? 's' : '') + ').' }];
  }

  // Poison / damage-over-time: stacks a counter that ticks at the start of the
  // poisoned unit's turn (handled in the engine's turn advance).
  function applyPoison(target, amount, source) {
    if (!target.buffs) target.buffs = {};
    target.buffs.poison = (target.buffs.poison || 0) + (amount | 0);
    return [{ type: 'poison-applied', unit_id: target.id, amount: amount | 0, source: source || 'card',
      log: target.name + ' is poisoned (' + (amount | 0) + ').' }];
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
        if (a && alive(a) && a.side === actor.side && a.id !== actor.id) return a;
        var allies = alliesOf(state, actor);
        return allies[0] || actor; // fall back to self (Rally handles this)
      }
      case 'ally_or_self': {
        var f = requestedTargetId != null ? byId(requestedTargetId) : null;
        if (f && alive(f) && f.side === actor.side) return f;
        return actor;
      }
      case 'any': {
        var x = requestedTargetId != null ? byId(requestedTargetId) : null;
        if (x && alive(x)) return x;
        return enemiesOf(state, actor)[0] || actor;
      }
      default:
        return requestedTargetId != null ? byId(requestedTargetId) : null;
    }
  }

  // The set of units a card may target right now, given its target mode AND
  // its formation hit mode. Used by the UI to highlight choices and by the
  // engine to validate a requested target. Returns live units (may be empty).
  function validTargets(state, actor, card) {
    var mode = (DEFS.targetMode ? DEFS.targetMode(card) : { side: 'none' }).side;
    var base;
    switch (mode) {
      case 'self':         base = [actor]; break;
      case 'enemy':        base = enemiesOf(state, actor); break;
      case 'ally':         base = alliesOf(state, actor); break; // excludes self
      case 'ally_or_self': base = state.units.filter(function (u) { return u.side === actor.side && alive(u); }); break;
      case 'any':          base = state.units.filter(function (u) { return alive(u); }); break;
      case 'none':
      default:             return [];
    }
    // Formation hit modes constrain WHICH enemy you may aim at:
    //   front  → only the frontmost living enemy is selectable
    //   pierce → you aim at the front; the engine carries it down the line
    //   aoe/choose → any in the base set
    var hit = card && card.hit;
    if ((hit === 'front' || hit === 'pierce') && mode === 'enemy') {
      var front = frontmost(state, _enemySideOf(state, actor));
      return front ? [front] : [];
    }
    return base;
  }

  function _enemySideOf(state, actor) {
    // The side opposite the actor.
    var e = enemiesOf(state, actor)[0];
    return e ? e.side : (actor.side === 'player' ? 'enemy' : 'player');
  }

  // True if the player must pick a target before this card can resolve: it's a
  // manual mode AND there's more than one candidate. (One candidate auto-
  // selects; zero candidates means the card still plays, e.g. Rally-alone.)
  function requiresTargetPrompt(state, actor, card) {
    if (!DEFS.needsManualTarget || !DEFS.needsManualTarget(card)) return false;
    return validTargets(state, actor, card).length > 1;
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
      rng: function () { return DECK.ensureRng(state)(); },
      damageScale: 1,   // pierce falloff sets this per target
      dealDamage: function (a, t, amt, src) { return dealDamage(state, a, t, Math.max(1, Math.round(amt * (ctx.damageScale || 1))), src); },
      addBlock: function (a, amt, src) { return addBlock(a, amt, src); },
      applyBuff: function (t, k, amt, src) { return applyBuff(t, k, amt, src); },
      applyDebuff: function (t, k, amt, src) { return applyDebuff(t, k, amt, src); },
      heal: function (t, amt, src) { return heal(t, amt, src); },
      grantEnergy: function (a, amt, src) { return grantEnergy(state, amt, src); },
      drawCards: function (amt, src) { return drawCards(state, amt, src); },
      discardCards: function (amt, src) { return discardCards(state, amt, src); },
      gainGold: function (amt, src) { return gainGold(state, amt, src); },
      applyStun: function (t, amt, src) { return applyStun(t, amt, src); },
      applyPoison: function (t, amt, src) { return applyPoison(t, amt, src); },
      // Formation: move the ACTOR, or push/pull a target.
      moveSelf: function (delta) { return moveUnit(state, actor, delta); },
      push: function (t, n) { return pushUnit(state, t, n); },
      // Front/back conditionals read by the formula compiler.
      isFront: function (u) { return isFront(state, u || actor); },
      isBack: function (u) { return isBack(state, u || actor); },
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
      var hit = card.hit || 'choose';
      var isDamaging = /(^|\n|;)\s*damage\s*:/.test(card.formula || '');

      if (DEFS.isAoE && DEFS.isAoE(card)) {
        // AoE: apply to every valid target at full scale.
        var aoeTargets = validTargets(state, actor, card);
        for (var i = 0; i < aoeTargets.length; i++) {
          ctx.damageScale = 1;
          effectEvents = effectEvents.concat(card.effect(state, actor, aoeTargets[i], ctx) || []);
        }
      } else if (isDamaging && (hit === 'front' || hit === 'pierce') && target && target.side !== actor.side) {
        // Formation hit: build the line from the front of the target's side and
        // distribute by hit mode. Non-damage parts of the formula also run on
        // each struck unit (e.g. a debuff that pierces); acceptable for now.
        var line = orderedSide(state, target.side);
        var depth = (hit === 'front') ? 1
                  : (card.pierce_count != null ? card.pierce_count : line.length);
        var falloff = (card.pierce_falloff != null) ? card.pierce_falloff : 1.0;
        var scale = 1;
        for (var d = 0; d < depth && d < line.length; d++) {
          ctx.damageScale = scale;
          effectEvents = effectEvents.concat(card.effect(state, actor, line[d], ctx) || []);
          scale = scale * falloff;
          if (scale <= 0) break;
        }
        ctx.damageScale = 1;
      } else {
        // choose / non-damage / ally / self → single resolved target, full scale.
        ctx.damageScale = 1;
        effectEvents = card.effect(state, actor, target, ctx) || [];
      }
    } catch (e) {
      effectEvents = [{ type: 'card-error', card: card.key, message: String(e && e.message || e) }];
    }
    events = events.concat(effectEvents);
    // Positions may have shifted (push/move/death) — nothing to normalise since
    // helpers sort living units by pos, but emit current front for UI clarity.
    return { ok: true, events: events, card: card };
  }

  var API = {
    alive: alive,
    enemiesOf: enemiesOf,
    alliesOf: alliesOf,
    dealDamage: dealDamage,
    addBlock: addBlock,
    applyBuff: applyBuff,
    applyDebuff: applyDebuff,
    heal: heal,
    grantEnergy: grantEnergy,
    drawCards: drawCards,
    discardCards: discardCards,
    gainGold: gainGold,
    applyStun: applyStun,
    applyPoison: applyPoison,
    frontmost: frontmost,
    backmost: backmost,
    isFront: isFront,
    isBack: isBack,
    moveUnit: moveUnit,
    pushUnit: pushUnit,
    orderedSide: orderedSide,
    resolveTarget: resolveTarget,
    validTargets: validTargets,
    requiresTargetPrompt: requiresTargetPrompt,
    playCard: playCard,
  };

  if (isNode) module.exports = API;
  if (root) root.CARD_COMBAT = API;
})(typeof window !== 'undefined' ? window : null);
