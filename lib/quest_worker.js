// ══════════════════════════════════════════════════════════════════════════
//  QUEST WORKER — periodic background resolver
//
//  What it does:
//    Every TICK_MS, runs one "find due work, process it" cycle:
//      1. Discovery probe (one tiny query): which settlements have at least
//         one quest whose completes_at has passed, or one rolled-but-not-yet-
//         fired combat trigger that's due?
//      2. For each settlement returned (capped at MAX_CONCURRENT in parallel),
//         calls resolveCompletedQuests(settlementId). That function already
//         calls processCombatTriggers internally, holds row locks with
//         FOR UPDATE SKIP LOCKED, and publishes SSE events through the
//         existing event bus. No new code paths.
//
//  Why a single Node-internal scheduler (not BullMQ / pg-boss / cron):
//    - The site runs as one Render Starter instance. There is exactly one
//      Node process. An in-process timer is the simplest correct thing.
//    - We already have a Postgres pool and the event bus is process-local;
//      adding a queue would mean a second persistence layer to operate.
//    - No horizontal scaling is planned. If it ever happens, this module
//      gets swapped for pg-boss or similar and the rest of the code is
//      unchanged — resolveCompletedQuests doesn't know who calls it.
//
//  Cheapness on idle ticks:
//    The discovery probe is bounded by the number of currently-active
//    quests, filtered server-side by completes_at <= NOW() and the combat
//    trigger conditions. On an idle game (nothing due), the query returns
//    zero rows in well under a millisecond. We do not iterate over the
//    settlements table.
//
//  Concurrency & pool budget:
//    resolveCompletedQuests acquires one pool client and holds a
//    transaction. The pg pool defaults to max=10. HTTP requests also use
//    the pool. We cap parallel settlement processing at MAX_CONCURRENT (3)
//    so the worker never holds more than a few clients at once. If a tick
//    finds more due settlements than that, the rest are processed in
//    subsequent batches within the same tick (sequential drain through
//    Promise.all of bounded slices).
//
//  Isolation:
//    Each settlement is processed inside its own try/catch. One settlement
//    crashing (corrupt JSON in combat_encounter, missing quest_def, etc.)
//    does not stop the others, and does not stop the loop.
//
//  Tick scheduling:
//    setTimeout chain, not setInterval. The next tick is scheduled when
//    the current one finishes. This guarantees we never have two ticks
//    running concurrently and prevents a slow tick from causing a stack-up.
//    Trade-off: an unusually slow tick delays the next one by its overrun.
//    That is fine here — we are not racing the clock to a fixed grid.
//
//  Lifecycle:
//    start({ intervalMs }) schedules the first tick on the next event-loop
//    turn. stop() clears the pending timer and awaits the in-flight tick
//    (if any). index.js calls stop() on SIGTERM/SIGINT so Render-initiated
//    redeploys don't leave a half-finished transaction hanging.
//
//  Coexistence with the HTTP-triggered path:
//    /api/quests still calls resolveCompletedQuests on read. That is
//    deliberate. The HTTP path is now redundant in steady state — but it
//    serves as a safety net if the worker ever wedges (and a fast path
//    if the user happens to hit the endpoint between worker ticks).
//    SKIP LOCKED guarantees the two callers never both process the same
//    row. Once the worker has run reliably in production for a while,
//    the HTTP-side call can be removed; not now.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { pool } = require('../db');
const quests = require('../routes/quests');

// ── Tunables ──
// 30s default. The original spec called for 30-60s; 30s keeps the worst-
// case "quest finished but UI hasn't noticed" gap under a minute, which
// is below the threshold where players reach for the reload button. Lower
// values increase DB probe traffic linearly with diminishing UX benefit.
const DEFAULT_INTERVAL_MS = 30 * 1000;

// Cap parallel settlement processing to keep the worker from saturating
// the pg pool. Pool default is 10 connections; HTTP needs most of them.
// 3 is comfortable headroom even during a deploy-time burst where many
// settlements come due within a single tick.
const MAX_CONCURRENT = 3;

// If a single tick takes longer than this, log a warning. Useful as a
// canary if quest counts grow and resolveCompletedQuests slows down.
const SLOW_TICK_WARN_MS = 5 * 1000;

// ── State ──
let _timer = null;
let _running = false;        // true while a tick is in flight
let _stopping = false;       // set by stop(); prevents new ticks from scheduling
let _stoppedResolve = null;  // resolved by the in-flight tick when it returns

// Diagnostic counters. Exposed via stats() for /api/quest-worker/stats if
// you ever want to wire up a status endpoint.
const _stats = {
  ticks_total: 0,
  ticks_with_work: 0,
  settlements_processed_total: 0,
  errors_total: 0,
  last_tick_ms: null,
  last_tick_at: null,
  last_error_at: null,
  last_error_message: null,
};

// ── Discovery probe ──
// Returns the distinct settlement_ids that have something for us to do.
// Cheap when nothing is due: one indexed scan over active quests, zero rows
// returned on idle.
//
// We intentionally use the same conditions resolveCompletedQuests and
// processCombatTriggers test for. If those queries ever change, this one
// must change too. (Kept in this file rather than exported from quests.js
// so the worker can be reasoned about as a single unit.)
async function _findSettlementsWithDueWork() {
  const sql = `
    SELECT DISTINCT settlement_id
    FROM settlement_quests
    WHERE status = 'active'
      AND (
            completes_at <= NOW()
        OR  (combat_status = 'rolled' AND combat_trigger_at IS NOT NULL AND combat_trigger_at <= NOW())
      )
  `;
  const r = await pool.query(sql);
  return r.rows.map(row => row.settlement_id);
}

// Process N settlements at a time. Each one is isolated: a thrown error
// is caught here, logged, counted, and the others continue.
async function _processBatch(settlementIds) {
  for (let i = 0; i < settlementIds.length; i += MAX_CONCURRENT) {
    const slice = settlementIds.slice(i, i + MAX_CONCURRENT);
    await Promise.all(slice.map(async (settlementId) => {
      try {
        // resolveCompletedQuests calls processCombatTriggers internally
        // (see routes/quests.js). One entry point is enough.
        await quests.resolveCompletedQuests(settlementId);
        _stats.settlements_processed_total++;
      } catch (e) {
        _stats.errors_total++;
        _stats.last_error_at = new Date().toISOString();
        _stats.last_error_message = (e && e.message) || String(e);
        // Log with settlement context so we can correlate with route logs.
        console.error('[quest_worker] settlement %s failed: %s', settlementId, _stats.last_error_message);
        // Stack trace at debug level so it's visible during development
        // without flooding production logs.
        if (process.env.NODE_ENV !== 'production') console.error(e);
      }
    }));
  }
}

// One full tick: discover + process. Returns nothing; never throws.
// (Any error in discovery is logged and the tick is treated as a no-op,
// so a transient DB hiccup doesn't poison the loop.)
async function _tick() {
  const startedAt = Date.now();
  _stats.ticks_total++;
  try {
    const ids = await _findSettlementsWithDueWork();
    if (ids.length > 0) {
      _stats.ticks_with_work++;
      await _processBatch(ids);
    }
  } catch (e) {
    _stats.errors_total++;
    _stats.last_error_at = new Date().toISOString();
    _stats.last_error_message = 'discovery: ' + ((e && e.message) || String(e));
    console.error('[quest_worker] discovery probe failed: %s', _stats.last_error_message);
  } finally {
    const elapsed = Date.now() - startedAt;
    _stats.last_tick_ms = elapsed;
    _stats.last_tick_at = new Date().toISOString();
    if (elapsed > SLOW_TICK_WARN_MS) {
      console.warn('[quest_worker] slow tick: %dms', elapsed);
    }
  }
}

// Drives the loop. Wrapped so we can await the in-flight tick during
// stop() — Node timers don't expose a "did the callback finish" hook.
async function _runTickAndReschedule(intervalMs) {
  _running = true;
  try {
    await _tick();
  } finally {
    _running = false;
    // If stop() was called while we were ticking, let it resolve and
    // don't schedule the next one.
    if (_stopping) {
      if (_stoppedResolve) { _stoppedResolve(); _stoppedResolve = null; }
      return;
    }
    // Schedule next tick. unref() so an idle worker doesn't keep the
    // event loop alive past server shutdown if someone forgets to stop().
    _timer = setTimeout(() => _runTickAndReschedule(intervalMs), intervalMs);
    if (_timer.unref) _timer.unref();
  }
}

// ── Public API ──

function start(opts = {}) {
  if (_timer || _running) {
    // Defensive — double-start should be a no-op rather than a second loop.
    return;
  }
  _stopping = false;
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : DEFAULT_INTERVAL_MS;

  // Defer the first tick to the next event-loop turn. This keeps
  // require()/start() out of the synchronous startup path and means
  // an immediate stop() call right after start() has predictable
  // semantics (it cancels the pending first tick).
  _timer = setTimeout(() => _runTickAndReschedule(intervalMs), 0);
  if (_timer.unref) _timer.unref();

  console.log('[quest_worker] started (intervalMs=%d, maxConcurrent=%d)', intervalMs, MAX_CONCURRENT);
}

// Returns a promise that resolves once the in-flight tick (if any) is done.
// Safe to call from a SIGTERM handler.
function stop() {
  _stopping = true;
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  if (!_running) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    _stoppedResolve = resolve;
  });
}

function stats() {
  return { ..._stats, running: _running, stopping: _stopping, scheduled: !!_timer };
}

// Exposed for tests that want to drive a single cycle deterministically
// (start a clock, call runOnce, assert). Not used by the production loop.
async function runOnce() {
  await _tick();
}

module.exports = { start, stop, stats, runOnce };
