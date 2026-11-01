// ══════════════════════════════════════════════════════════════════════════
//  outpost_state — what each outpost is producing at right now, on top of
//  its level (outposts_config.outpostYields):
//
//    worker   a citizen posted there (outposts.assigned_citizen_id):
//             +25%, or +50% when their class suits the land (FIT).
//             While posted they don't work in town (careers.loadWorkforce
//             leaves them out) and count as busy everywhere else
//             (market.merchantCitizenIds).
//    unfed    settlements.outposts_unfed_since (famine.js sets it when the
//             outposts' food upkeep can't be paid): ×0.5 until fed again.
//    raided   outposts.raided_until (soft raids, lib/raids): ×0 until then.
//
//  load(db, settlement) → outpost rows, each with mult, worker, notes; the
//  rows feed calculateRates / calculateRatesBreakdown / oreRates directly.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const WORKER_BONUS = 0.25;
const FIT_BONUS = 0.5;
const UNFED_MULT = 0.5;
// Class that knows the land → the larger bonus.
const FIT = { plains: 'farmer', forest: 'woodcutter', hills: 'miner', mountain: 'miner', river: 'fisher', marsh: 'forager', ruins: 'scout' };

function annotate(o, s, now = Date.now()) {
  const notes = [];
  let mult = 1;
  const worker = o.assigned_citizen_id && o.worker_name
    ? { id: o.assigned_citizen_id, name: o.worker_name, role: o.worker_role, fit: FIT[o.terrain] === o.worker_role }
    : null;
  if (worker) {
    const b = worker.fit ? FIT_BONUS : WORKER_BONUS;
    mult *= 1 + b;
    notes.push({ key: 'worker', short: `${worker.name} +${Math.round(b * 100)}%`, label: `${worker.name} is working here (+${Math.round(b * 100)}%${worker.fit ? ', knows this land' : ''}).` });
  }
  if (s && s.outposts_unfed_since) {
    mult *= UNFED_MULT;
    notes.push({ key: 'unfed', short: 'unfed ×0.5', label: 'Its food upkeep is going unpaid — half yield until the stores can feed it.' });
  }
  const raided = o.raided_until && Date.parse(o.raided_until) > now;
  if (raided) {
    mult = 0;
    notes.push({ key: 'raided', short: 'raided', label: 'Raiders left it in ruins — idle until it is set right.', until: new Date(o.raided_until).toISOString() });
  }
  o.mult = Math.round(mult * 1000) / 1000;
  o.worker = worker;
  o.notes = notes;
  return o;
}

// All of a settlement's outposts, annotated. `s` is the settlement row (for
// outposts_unfed_since); fetched when only an id is given.
async function load(db, s, now = Date.now()) {
  const run = db ? (t, p) => db.query(t, p) : query;
  if (typeof s !== 'object') s = (await run('SELECT * FROM settlements WHERE id=$1', [s])).rows[0];
  if (!s) return [];
  const r = await run(
    `SELECT o.*, c.name AS worker_name, c.role AS worker_role
       FROM outposts o
       LEFT JOIN citizens c ON c.id = o.assigned_citizen_id AND COALESCE(c.life_stage, 'adult') = 'adult'
      WHERE o.settlement_id = $1 ORDER BY o.built_at, o.id`, [s.id]).catch(() => ({ rows: [] }));
  return r.rows.map(o => annotate(o, s, now));
}

// Citizen ids posted at any outpost of the settlement (left out of the town
// workforce).
async function postedIds(sid, db) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const r = await run('SELECT assigned_citizen_id AS id FROM outposts WHERE settlement_id=$1 AND assigned_citizen_id IS NOT NULL', [sid])
    .catch(() => ({ rows: [] }));
  return new Set(r.rows.map(x => x.id));
}

// Why this citizen can't go and work an outpost (null = they can).
async function busyReason(c, sid) {
  if (!c || c.settlement_id !== sid) return 'Citizen not found.';
  if ((c.life_stage || 'adult') !== 'adult') return `${c.name} is too young to work an outpost.`;
  const id = c.id;
  const onQuest = await query(
    `SELECT 1 FROM settlement_quests WHERE status='active' AND (citizen_id=$1 OR party_ids @> $2::jsonb) LIMIT 1`,
    [id, JSON.stringify([id])]);
  if (onQuest.rows.length) return `${c.name} is on a quest.`;
  if ((await require('./clan_quests').busyCitizenIds([id])).length) return `${c.name} is on a clan quest.`;
  if ((await require('./market').merchantCitizenIds([id])).length) return `${c.name} is busy at work (Market, workshop or outpost).`;
  const scouting = await query("SELECT 1 FROM expeditions WHERE citizen_id=$1 AND status='travelling' LIMIT 1", [id]).catch(() => ({ rows: [] }));
  if (scouting.rows.length) return `${c.name} is out scouting.`;
  const diplo = await query("SELECT 1 FROM diplomacy_relations WHERE citizen_id=$1 AND (status='contact_sent' OR pending_action IS NOT NULL) LIMIT 1", [id]).catch(() => ({ rows: [] }));
  if (diplo.rows.length) return `${c.name} is on a diplomatic mission.`;
  return null;
}

module.exports = { load, annotate, postedIds, busyReason, WORKER_BONUS, FIT_BONUS, UNFED_MULT, FIT };
