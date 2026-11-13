// ══════════════════════════════════════════════════════════════════════════
//  DEATHS — shared death-event writer (server root, alongside simulation.js)
//
//  Single pipeline for marking a citizen deceased + writing the permanent
//  citizen_events row. Used by:
//    - combat_resolver.js  (cause: 'combat',     sourceBattleId set)
//    - famine.js           (cause: 'starvation', sourceBattleId null)
//    - simulation.js       (cause: 'old_age', back-dated to its hour)
//
//  Extracted from the fatal branch of combat_resolver._writeInjury per spec
//  §4 — starvation extends the event pipeline without touching the d100
//  injury table, so the natural-fatal carve-out (~2% combat death) is
//  preserved untouched.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query } = require('./db');

/**
 * Mark a citizen deceased and write the permanent death event.
 * Returns the inserted citizen_events row.
 */
async function writeDeathEvent({
  citizenId,
  settlementId,
  cause,                 // 'combat' | 'starvation' | 'old_age'
  narrative,
  severity = 'fatal',
  bodyPart = null,
  sourceBattleId = null,
  at = null,             // when it happened (old age in a catch-up is back-dated)
}) {
  const when = at ? new Date(Math.min(new Date(at).getTime(), Date.now())).toISOString() : null;
  // The dead give up their bed (docs/PHASE_1_LIFE_CYCLE.md §4.4). Only the
  // first call marks them: a second death of the same citizen does nothing.
  const marked = await query(
    `UPDATE citizens SET life_stage='deceased', house_id=NULL, died_at=COALESCE($2::timestamptz, NOW()), death_cause=$3
      WHERE id=$1 AND COALESCE(life_stage, 'adult') <> 'deceased' RETURNING id`,
    [citizenId, when, cause]
  );
  const ev = await query(
    `INSERT INTO citizen_events
       (citizen_id, settlement_id, event_type, severity, body_part, narrative, source_battle_id, cause, occurred_at)
     VALUES ($1,$2,'death',$3,$4,$5,$6,$7, COALESCE($8::timestamptz, NOW())) RETURNING *`,
    [citizenId, settlementId, severity, bodyPart, narrative, sourceBattleId, cause, when]
  );
  // Gear is no longer stripped here: inheritance decides where it goes
  // (heirlooms for the heir), and the partner is widowed (lib/inheritance).
  if (marked.rows.length) {
    await require('./lib/inheritance').onDeath({ citizenId, settlementId, cause, at: when })
      .catch(e => console.error('[inheritance] onDeath failed:', e.message));
  }
  // The population follows the living; a freed bed may house someone.
  const life = require('./lib/life');
  await life.recount(settlementId).catch(() => {});
  await life.autoHouse(settlementId).catch(() => {});
  return ev.rows[0];
}

module.exports = { writeDeathEvent };
