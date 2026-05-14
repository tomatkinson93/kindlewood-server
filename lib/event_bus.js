// ══════════════════════════════════════════════════════════════════════════
//  EVENT BUS — in-memory pub/sub for Server-Sent Events
//
//  How it fits:
//    1. routes/stream.js opens an SSE connection per authenticated client and
//       calls subscribe(settlementId, cb). The callback writes JSON to the
//       response stream.
//    2. App code (routes/quests.js, routes/combat.js) calls publish(settlementId,
//       event) at meaningful state-change moments — quest resolved, combat
//       triggered, etc.
//    3. The bus invokes every subscriber for that settlement.
//
//  Scope decisions:
//    - In-memory only. Adequate for a single Node process; if/when we scale
//      to multiple instances, swap this module for a Redis pub/sub adapter
//      and the rest of the code doesn't change.
//    - Keyed on settlement_id (not user_id) because every existing code
//      path already has settlement_id handy. If multi-settlement-per-user
//      ever becomes a thing, the API of this module accommodates it.
//    - Publish is fire-and-forget; no awaits. A slow subscriber doesn't
//      block subsequent publishes.
//    - Errors in callbacks are caught and logged; one broken stream doesn't
//      take down the others.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

// Map<settlementId, Set<callback>>
const _subs = new Map();

// Useful diagnostic counters for debugging "did the event reach the client?"
let _published = 0;
let _delivered = 0;

function subscribe(settlementId, callback) {
  if (!settlementId || typeof callback !== 'function') {
    throw new Error('subscribe requires settlementId and a callback');
  }
  let set = _subs.get(settlementId);
  if (!set) {
    set = new Set();
    _subs.set(settlementId, set);
  }
  set.add(callback);

  // Return an unsubscribe function so the SSE handler can clean up on
  // disconnect without needing to remember its own callback reference.
  return function unsubscribe() {
    const s = _subs.get(settlementId);
    if (!s) return;
    s.delete(callback);
    if (s.size === 0) _subs.delete(settlementId);
  };
}

function publish(settlementId, event) {
  _published++;
  const set = _subs.get(settlementId);
  if (!set || set.size === 0) return;
  // Iterate via copy so a callback that unsubscribes itself doesn't mutate
  // the set mid-iteration.
  for (const cb of [...set]) {
    try {
      cb(event);
      _delivered++;
    } catch (e) {
      // A callback throwing should not affect other subscribers. The
      // stream handler is responsible for closing its own connection on
      // write errors; here we just log.
      console.error('[event_bus] subscriber error:', e.message);
    }
  }
}

// Diagnostic helper — returns counts and an estimate of memory pressure.
// Used by /api/stream/stats for ops checks.
function stats() {
  let totalSubs = 0;
  for (const set of _subs.values()) totalSubs += set.size;
  return {
    settlements_with_subs: _subs.size,
    total_subscribers: totalSubs,
    published_total: _published,
    delivered_total: _delivered,
  };
}

module.exports = { subscribe, publish, stats };
