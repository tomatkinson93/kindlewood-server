// ══════════════════════════════════════════════════════════════════════════
//  The life cycle (docs/PHASE_1_LIFE_CYCLE.md). Step 1 lives here so far:
//
//    kin(a, b)                  parent and child, siblings, half-siblings
//    recount(settlementId)      settlements.population = living citizens
//    livingCount(settlementId)  the same count, read only
//    beds(settlementId)         { beds, living, free } for the bed rule
//    autoHouse(settlementId, { couples })   housing sorts itself
//
//  Ages, stages, death rolls and families arrive with steps 2–6.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query } = require('../db');

const CONFIG = {
  HOUSE_BEDS: 4,               // every Willow Hut holds 4 (was 2)
  HOUSED_HAPPINESS_BONUS: 10,  // same as a manual move (routes/housing.js)
};

const LIVING = "COALESCE(life_stage, 'adult') <> 'deceased'";

function parentsOf(c) {
  let p = c && c.parent_ids;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (_) { p = []; } }
  return Array.isArray(p) ? p.map(Number).filter(Boolean) : [];
}

// Kin may not become partners: a parent and their child, or two citizens who
// share a parent (siblings and half-siblings).
function kin(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const pa = parentsOf(a), pb = parentsOf(b);
  if (pa.includes(Number(b.id)) || pb.includes(Number(a.id))) return true;
  return pa.some(id => pb.includes(id));
}

async function livingCount(settlementId, q = query) {
  const r = await q(`SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1 AND ${LIVING}`, [settlementId]);
  return r.rows[0].n;
}

// Keeps settlements.population in step with the living (fixes B2). Called
// after every birth, death, arrival and admin change; returns the count.
async function recount(settlementId, q = query) {
  const r = await q(
    `UPDATE settlements SET population =
       (SELECT COUNT(*) FROM citizens WHERE settlement_id = $1 AND ${LIVING})
      WHERE id = $1 RETURNING population`, [settlementId]);
  return r.rows[0] ? r.rows[0].population : 0;
}

async function beds(settlementId, q = query) {
  const [h, n] = await Promise.all([
    q('SELECT COALESCE(SUM(capacity), 0)::int AS beds FROM houses WHERE settlement_id = $1', [settlementId]),
    livingCount(settlementId, q),
  ]);
  const total = h.rows[0].beds;
  return { beds: total, living: n, free: Math.max(0, total - n) };
}

// ── Housing sorts itself ────────────────────────────────────────────────────
// Pure planner, so it can be tested without a database. Never moves anyone
// who is housed unless they are in `couples` (a partnership that just
// formed): a manual choice stays until that citizen's circumstances change.
//
//   citizens: [{ id, partner_id, parent_ids, house_id, life_stage }]  (living)
//   houses:   [{ id, capacity }]   in build order
//   couples:  [[idA, idB], …]      new partners to bring under one roof
// Returns [{ id, house_id, from }] moves.
function planHousing(citizens, houses, couples = []) {
  const byId = new Map(citizens.map(c => [Number(c.id), { ...c, id: Number(c.id) }]));
  const room = new Map(houses.map(h => [Number(h.id), { id: Number(h.id), capacity: Number(h.capacity) || 0, n: 0 }]));
  for (const c of byId.values()) if (c.house_id != null && room.has(Number(c.house_id))) room.get(Number(c.house_id)).n++;
  const moves = [];
  const free = h => h && h.n < h.capacity;
  const move = (c, h) => {
    const from = c.house_id != null && room.has(Number(c.house_id)) ? room.get(Number(c.house_id)) : null;
    if (from) from.n--;
    h.n++;
    moves.push({ id: c.id, house_id: h.id, from: from ? from.id : null });
    c.house_id = h.id;
  };
  const houseOf = c => (c && c.house_id != null ? room.get(Number(c.house_id)) : null);
  const empty = () => [...room.values()].find(h => h.n === 0 && h.capacity >= 2);
  // Singles go where there is already someone, so empty huts stay free for couples.
  const anyBed = () => {
    const open = [...room.values()].filter(free);
    return open.find(h => h.n > 0) || open[0] || null;
  };

  // 1. New couples share: an empty house if there is one, else whichever of
  //    their homes has room for the other.
  for (const [ia, ib] of couples) {
    const a = byId.get(Number(ia)), b = byId.get(Number(ib));
    if (!a || !b) continue;
    if (a.house_id != null && a.house_id === b.house_id) continue;
    const e = empty();
    if (e) { move(a, e); move(b, e); continue; }
    const ha = houseOf(a), hb = houseOf(b);
    if (ha && free(ha)) move(b, ha);
    else if (hb && free(hb)) move(a, hb);
  }

  // 2. Anyone without a home: partners join their partner, children their
  //    parents, the rest any free bed. Adults first, oldest records first.
  const unhoused = [...byId.values()].filter(c => c.house_id == null || !room.has(Number(c.house_id)))
    .sort((x, y) => (x.life_stage === 'child') - (y.life_stage === 'child') || x.id - y.id);
  for (const c of unhoused) {
    if (c.house_id != null && room.has(Number(c.house_id))) continue;   // housed with their partner above
    let h = null;
    const partner = c.partner_id ? byId.get(Number(c.partner_id)) : null;
    if (partner && free(houseOf(partner))) h = houseOf(partner);
    if (!h && c.life_stage === 'child') h = parentsOf(c).map(id => houseOf(byId.get(id))).find(free) || null;
    if (!h && partner && partner.house_id == null) {
      // An unhoused couple takes an empty house together.
      const e = empty();
      if (e) { move(c, e); move(partner, e); continue; }
    }
    if (!h) h = anyBed();
    if (h) move(c, h);
  }
  return moves;
}

async function autoHouse(settlementId, { couples = [] } = {}, q = query) {
  const [cr, hr] = await Promise.all([
    q(`SELECT id, partner_id, parent_ids, house_id, life_stage FROM citizens WHERE settlement_id = $1 AND ${LIVING}`, [settlementId]),
    q('SELECT id, capacity FROM houses WHERE settlement_id = $1 ORDER BY created_at, id', [settlementId]),
  ]);
  if (!hr.rows.length) return [];
  const moves = planHousing(cr.rows, hr.rows, couples);
  for (const m of moves) {
    await q('UPDATE citizens SET house_id = $1 WHERE id = $2 AND settlement_id = $3', [m.house_id, m.id, settlementId]);
    // Moving in from no home: the same happiness lift as a manual move.
    if (m.from == null) {
      await q(`UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{happiness}',
                 to_jsonb(LEAST(100, COALESCE((life->>'happiness')::int, 70) + $1))) WHERE id = $2`,
        [CONFIG.HOUSED_HAPPINESS_BONUS, m.id]);
    }
  }
  return moves;
}

module.exports = { CONFIG, LIVING, kin, parentsOf, livingCount, recount, beds, planHousing, autoHouse };
