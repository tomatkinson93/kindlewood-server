// ══════════════════════════════════════════════════════════════════════════
//  research — what a town has studied (the Library; see lib/research_defs.js
//  once projects land). For now: the set of finished projects, which unlocks
//  rarer ores (lib/ores.js) and alloys.
//
//    doneSet(db, sid) → Set of finished project keys
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query: pool } = require('../db');
const q = (db, sql, params) => (db && db.query ? db.query(sql, params) : pool(sql, params));

async function doneSet(db, sid) {
  const r = await q(db, 'SELECT project FROM settlement_research WHERE settlement_id=$1 AND done_at IS NOT NULL', [sid])
    .catch(() => ({ rows: [] }));
  return new Set(r.rows.map(x => x.project));
}

module.exports = { doneSet };
