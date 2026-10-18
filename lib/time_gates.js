// ══════════════════════════════════════════════════════════════════════════
//  time_gates — time-of-day / moon gating for random content (spec 021 §5).
//
//  enemy_definitions.active_phases / moon_phases (JSONB arrays, NULL = any)
//  restrict which enemies a RANDOM pick may choose. Only random picks are
//  filtered: a quest author who names a nocturnal enemy in combat_encounter
//  gets it at any hour — that's author intent. combat_resolver's roster load
//  stays unfiltered (it's the roster, not the pick).
//
//  Which clock:
//    solo quests  gameplayNow(owner) — an admin's debug offset moves only
//                 their own creatures (worker runs load the owner from the
//                 settlement).
//    clan quests  wallNow() — shared content, never moved by a warp.
//
//  enemyEligibleSql returns { sql, params } so Phase 6 can widen it with the
//  Happening pool (… OR id = ANY($k)) without changing callers.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const D = require('./day_cycle');

const ENGINE_FALLBACK = 'marsh_rat';   // bundled with the combat engine

// Phase + moon ids at ms, as stored in the gate columns.
function timeContext(ms) {
  return { phase: D.phaseAt(ms).phase, moon: D.moonAt(ms).id };
}

// WHERE fragment matching enemies eligible at ctx. Placeholders start at
// $startIndex; append the returned params after your own.
function enemyEligibleSql(startIndex, ctx) {
  const a = startIndex, b = startIndex + 1;
  return {
    sql: `(active_phases IS NULL OR active_phases @> jsonb_build_array($${a}::text))` +
         ` AND (moon_phases IS NULL OR moon_phases @> jsonb_build_array($${b}::text))`,
    params: [ctx.phase, ctx.moon],
  };
}

// One random non-archived enemy id eligible at ms, as a one-element
// encounter. Empty eligible pool → the unfiltered pool (combat must never
// fail for lack of a creature); empty table or a DB error → the engine
// fallback. q defaults to db.query (injectable for tests).
async function pickRandomEnemy(ms, q) {
  q = q || require('../db').query;
  try {
    const g = enemyEligibleSql(1, timeContext(ms));
    const r = await q(`SELECT id FROM enemy_definitions WHERE archived = FALSE AND ${g.sql} ORDER BY random() LIMIT 1`, g.params);
    if (r.rows.length) return [r.rows[0].id];
    const all = await q('SELECT id FROM enemy_definitions WHERE archived = FALSE ORDER BY random() LIMIT 1');
    if (all.rows.length) return [all.rows[0].id];
  } catch (e) {}
  return [ENGINE_FALLBACK];
}

// Admin form validation: keep known ids only, deduped, in table order; an
// empty selection is stored as NULL ("any").
function cleanPhases(v) { return _clean(v, D.PHASE_IDS); }
function cleanMoons(v) { return _clean(v, D.MOON_IDS); }
function _clean(v, known) {
  if (!Array.isArray(v)) return null;
  const out = known.filter(id => v.indexOf(id) >= 0);
  return out.length ? out : null;
}

module.exports = { timeContext, enemyEligibleSql, pickRandomEnemy, cleanPhases, cleanMoons, ENGINE_FALLBACK };
