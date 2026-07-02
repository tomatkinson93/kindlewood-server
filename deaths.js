// ══════════════════════════════════════════════════════════════════════════
//  DEATHS — shared death-event writer (server root, alongside simulation.js)
//
//  Single pipeline for marking a citizen deceased + writing the permanent
//  citizen_events row. Used by:
//    - combat_resolver.js  (cause: 'combat',     sourceBattleId set)
//    - famine.js           (cause: 'starvation', sourceBattleId null)
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
  cause,                 // 'combat' | 'starvation'
  narrative,
  severity = 'fatal',
  bodyPart = null,
  sourceBattleId = null,
}) {
  await query(
    `UPDATE citizens SET life_stage='deceased' WHERE id=$1`,
    [citizenId]
  );
  const ev = await query(
    `INSERT INTO citizen_events
       (citizen_id, settlement_id, event_type, severity, body_part, narrative, source_battle_id, cause)
     VALUES ($1,$2,'death',$3,$4,$5,$6,$7) RETURNING *`,
    [citizenId, settlementId, severity, bodyPart, narrative, sourceBattleId, cause]
  );
  return ev.rows[0];
}

module.exports = { writeDeathEvent };
