// ══════════════════════════════════════════════════════════════════════════
//  outpost_state — what each outpost is producing at right now, on top of
//  its level (outposts_config.outpostYields):
//
//    workers  citizens posted there (outpost_crew post='worker', up to the
//             outpost's level): +25% each, +50% when their class suits the land.
//             Garrison (post='garrison') defend it (lib/defences).
//             While posted they don't work in town (careers.loadWorkforce
//             leaves them out) and count as busy everywhere else
//             (market.merchantCitizenIds).
//    unfed    settlements.outposts_unfed_since (famine.js sets it when the
//             outposts' food upkeep can't be paid): ×0.5 until fed again.
//    clan     on the owner's clan land (lib/clan_treasury): +10%.
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
  // Workers (outpost_crew post='worker'): each adds its bonus; slots = level.
  // Crew still walking out (outpost_crew.arrives_at) are listed but count
  // only once they get there.
  const crew = Array.isArray(o.crew) ? o.crew : [];
  const walking = c => !!(c.arrives_at && new Date(c.arrives_at).getTime() > now);
  const arr = c => (walking(c) ? { arriving: true, arrives_at: new Date(c.arrives_at).toISOString() } : {});
  const workersAll = crew.filter(c => c.post === 'worker').map(c => ({ id: c.id, name: c.name, role: c.role, fit: FIT[o.terrain] === c.role, ...arr(c) }));
  const workers = workersAll.filter(w => !w.arriving);
  const garrison = crew.filter(c => c.post === 'garrison').map(c => ({ id: c.id, name: c.name, role: c.role, class_level: c.class_level || 1, ...arr(c) }));
  // Standing haulers carry the store home, run after run (lib/outpost_store).
  const haulers = crew.filter(c => c.post === 'hauler').map(c => ({ id: c.id, name: c.name, role: c.role }));
  if (workers.length) {
    const b = workers.reduce((t, w) => t + (w.fit ? FIT_BONUS : WORKER_BONUS), 0);
    mult *= 1 + b;
    const names = workers.map(w => w.name).join(', ');
    notes.push({ key: 'worker', short: `${workers.length > 1 ? workers.length + ' workers' : names} +${Math.round(b * 100)}%`, label: `${names} ${workers.length > 1 ? 'are' : 'is'} working here (+${Math.round(b * 100)}%).` });
  }
  if (o.on_clan_land) {
    const b = require('./clan_treasury').LAND_OUTPOST_BONUS;
    mult *= 1 + b;
    notes.push({ key: 'clan_land', short: `clan land +${Math.round(b * 100)}%`, label: `On your clan's land (+${Math.round(b * 100)}%, and harder to raid).` });
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
  o.workers = workersAll;
  o.worker = workers[0] || null;   // older callers
  o.garrison = garrison;
  o.haulers = haulers;
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
    `SELECT o.*,
            EXISTS (SELECT 1 FROM clan_territory t JOIN clan_members cm ON cm.clan_id = t.clan_id
                     WHERE cm.user_id = $2 AND t.q = o.tile_q AND t.r = o.tile_r) AS on_clan_land
       FROM outposts o
      WHERE o.settlement_id = $1 ORDER BY o.built_at, o.id`, [s.id, s.user_id]).catch(() =>
    run('SELECT o.*, FALSE AS on_clan_land FROM outposts o WHERE o.settlement_id = $1 ORDER BY o.built_at, o.id', [s.id]).catch(() => ({ rows: [] })));
  // Crew at every outpost, adults only.
  const ids = r.rows.map(o => o.id);
  const crew = ids.length ? (await run(
    `SELECT oc.outpost_id, oc.post, oc.arrives_at, c.id, c.name, c.role, COALESCE(cc.level, 1) AS class_level
       FROM outpost_crew oc JOIN citizens c ON c.id = oc.citizen_id
       LEFT JOIN citizen_classes cc ON cc.citizen_id = c.id AND cc.class_key = c.role
      WHERE oc.outpost_id = ANY($1::int[]) AND COALESCE(c.life_stage, 'adult') = 'adult' ORDER BY oc.assigned_at, c.id`, [ids])
    .catch(() => ({ rows: [] }))).rows : [];
  for (const o of r.rows) o.crew = crew.filter(c => c.outpost_id === o.id).map(c => ({ ...c, class_level: Number(c.class_level) || 1 }));
  // Buildings inside each outpost (lib/outpost_buildings): what's up, and the
  // merged effects of the ready ones (o.bfx).
  const B = require('./outpost_buildings');
  const bRows = await B.rowsFor(ids, db, now);
  for (const o of r.rows) { o.buildings = bRows.get(o.id) || []; o.bfx = B.effectsOf(o.buildings.filter(b => b.ready).map(b => b.key)); }
  return r.rows.map(o => annotate(o, s, now));
}

// Citizen ids posted at any outpost of the settlement (left out of the town
// workforce).
async function postedIds(sid, db) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const r = await run('SELECT oc.citizen_id AS id FROM outpost_crew oc JOIN citizens c ON c.id = oc.citizen_id WHERE c.settlement_id=$1', [sid])
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
  const hauling = await query("SELECT kind FROM outpost_hauls WHERE citizen_id=$1 AND status IN ('outbound','returning') LIMIT 1", [id]).catch(() => ({ rows: [] }));
  if (hauling.rows.length) {
    const k = hauling.rows[0].kind || 'haul';
    return k === 'post' ? `${c.name} is already on the road to an outpost.` : k === 'return' ? `${c.name} is walking home from an outpost.` : `${c.name} is carrying goods from an outpost.`;
  }
  if ((await require('./market').merchantCitizenIds([id])).length) return `${c.name} is busy at work (Market, workshop or outpost).`;
  const scouting = await query("SELECT 1 FROM expeditions WHERE citizen_id=$1 AND status='travelling' LIMIT 1", [id]).catch(() => ({ rows: [] }));
  if (scouting.rows.length) return `${c.name} is out scouting.`;
  const diplo = await query("SELECT 1 FROM diplomacy_relations WHERE citizen_id=$1 AND (status='contact_sent' OR pending_action IS NOT NULL) LIMIT 1", [id]).catch(() => ({ rows: [] }));
  if (diplo.rows.length) return `${c.name} is on a diplomatic mission.`;
  return null;
}

module.exports = { load, annotate, postedIds, busyReason, WORKER_BONUS, FIT_BONUS, UNFED_MULT, FIT };
