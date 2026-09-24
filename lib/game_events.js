// ══════════════════════════════════════════════════════════════════════════
//  GAME EVENTS — in-process domain events (spec 016 §8a)
//
//  Gameplay code emits facts ("a quest succeeded") without knowing who
//  listens; features such as clans subscribe. Emit AFTER the relevant
//  COMMIT, so listeners only ever see committed state.
//
//  Fan-out is synchronous and every handler is isolated: a handler that
//  throws, or an async handler that rejects, is logged and never reaches
//  the emitter. Async handlers are not awaited, so a listener bug can never
//  break or delay a quest resolution.
//
//  Events (payloads):
//    quest_completed     { settlementId, questRunId, durationS, success }
//    battle_won          { settlementId, userId?, enemyCount }
//    tier_upgraded       { settlementId, userId, tier }
//    outpost_established { settlementId, userId }
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const _handlers = new Map();   // type → Set<handler>

function on(type, handler) {
  let set = _handlers.get(type);
  if (!set) { set = new Set(); _handlers.set(type, set); }
  set.add(handler);
  return () => set.delete(handler);
}

function emit(type, payload) {
  const set = _handlers.get(type);
  if (!set) return;
  for (const h of [...set]) {
    try {
      const r = h(payload);
      if (r && typeof r.then === 'function') {
        r.catch(e => console.error(`[game_events] ${type} handler failed:`, e));
      }
    } catch (e) {
      console.error(`[game_events] ${type} handler threw:`, e);
    }
  }
}

module.exports = { on, emit };
