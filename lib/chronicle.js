// ══════════════════════════════════════════════════════════════════════════
//  The chronicle: the family record (docs/PHASE_1_LIFE_CYCLE.md §4.9).
//
//    write(settlementId, { kind, text, citizenIds, familyId, at }, q?)
//
//  One small function called from each place something worth keeping
//  happens: comings of age (step 3); births, partnerships, deaths,
//  inheritances and settlers arrive with steps 4–6. Never throws: a failed
//  chronicle line must not break the thing it records.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query } = require('../db');

const KINDS = ['birth', 'came_of_age', 'partnership', 'death', 'inheritance', 'settler', 'quest', 'raid', 'discovery', 'craft'];

async function write(settlementId, { kind, text, citizenIds = [], familyId = null, at = null } = {}, q = query) {
  if (!settlementId || !kind || !text) return null;
  try {
    const r = await q(
      `INSERT INTO chronicle (settlement_id, family_id, citizen_ids, kind, text, at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW())) RETURNING id`,
      [settlementId, familyId, JSON.stringify(citizenIds.map(Number).filter(Boolean)), kind, String(text).slice(0, 500),
       at ? new Date(Math.min(new Date(at).getTime(), Date.now())).toISOString() : null]);
    return r.rows[0] ? r.rows[0].id : null;
  } catch (e) {
    console.error('[chronicle] write failed:', e.message);
    return null;
  }
}

module.exports = { KINDS, write };
