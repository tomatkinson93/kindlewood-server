// ══════════════════════════════════════════════════════════════════════════
//  tactics_mastery — an ability used enough in battle becomes its ✦ form for
//  that citizen, for good (docs/TACTICS.md §6, stage B; the owner chose "a
//  flat edge", 2026-11-26).
//
//  Every use of an ability by a citizen in a kept battle is counted
//  (citizen_ability_uses). At USES it is mastered: its damage, healing and
//  block are EDGE times as much in that citizen's hands, wherever it comes
//  from (their own school or their second). A practice battle counts nothing.
//
//    usesIn(setup, actions)       who used what, from a battle's own record
//    record(setup, actions)       add them to the counts → what was mastered
//                                 just now: [{ citizen_id, key, name, icon }]
//    starsFor(ids)                citizen id → Set of mastered keys
//    countsFor(citizenId)         key → uses
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const E = require('./tactics_engine');

const USES = 25;      // uses in battle that master an ability
const EDGE = 1.2;     // how much stronger a mastered ability is

// Play the record through, noting whose turn each use was. → { citizenId: { key: n } }
function usesIn(setup, actions) {
  const out = {};
  let st;
  try { st = E.replay(setup, []).state; } catch (e) { return out; }
  for (const a of actions || []) {
    const u = E.current(st);
    if (a && a.t === 'use' && u && u.side === 'player' && u.citizen_id && a.key) {
      const mine = out[u.citizen_id] || (out[u.citizen_id] = {});
      mine[a.key] = (mine[a.key] || 0) + 1;
    }
    if (!E.apply(st, a)) break;
  }
  return out;
}

// Count a finished battle's uses. → the abilities that reached USES with this battle.
async function record(setup, actions) {
  const used = usesIn(setup, actions), fresh = [];
  for (const cid of Object.keys(used)) {
    for (const key of Object.keys(used[cid])) {
      const row = (await query(
        `INSERT INTO citizen_ability_uses (citizen_id, ability_key, uses) VALUES ($1,$2,$3)
         ON CONFLICT (citizen_id, ability_key) DO UPDATE SET uses = citizen_ability_uses.uses + EXCLUDED.uses RETURNING uses`,
        [Number(cid), key, used[cid][key]]).catch(() => ({ rows: [] }))).rows[0];
      if (row && row.uses >= USES && row.uses - used[cid][key] < USES) {
        const unit = (setup.party || []).find(u => Number(u.citizen_id) === Number(cid)), ab = unit && (unit.abilities || []).find(x => x.key === key);
        fresh.push({ citizen_id: Number(cid), key, name: ab ? ab.name : key, icon: ab ? ab.icon : '✦' });
      }
    }
  }
  return fresh;
}

async function starsFor(ids) {
  const out = new Map();
  if (!ids || !ids.length) return out;
  const rows = (await query('SELECT citizen_id, ability_key FROM citizen_ability_uses WHERE citizen_id = ANY($1::int[]) AND uses >= $2', [ids, USES]).catch(() => ({ rows: [] }))).rows;
  for (const r of rows) { if (!out.has(r.citizen_id)) out.set(r.citizen_id, new Set()); out.get(r.citizen_id).add(r.ability_key); }
  return out;
}
async function countsFor(citizenId) {
  const rows = (await query('SELECT ability_key, uses FROM citizen_ability_uses WHERE citizen_id=$1', [citizenId]).catch(() => ({ rows: [] }))).rows;
  return Object.fromEntries(rows.map(r => [r.ability_key, r.uses]));
}

module.exports = { USES, EDGE, usesIn, record, starsFor, countsFor };
