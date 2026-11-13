// ══════════════════════════════════════════════════════════════════════════
//  The life cycle (docs/PHASE_1_LIFE_CYCLE.md). Every number is in CONFIG.
//
//    ageOf(c, now)              years since born_at (one year = 28 real hours)
//    stageOf(c, now)            child · youth · adult · elder · deceased
//    deathChance(age)           chance of dying on a birthday at this age
//    fertile(c, now)            an adult aged 14–55
//    bornAtFor(age, now)        the born_at that gives this age now
//    apprenticeships(citizens, classRows, now)   each youth's trade, mentor, XP rate
//    comeOfAge(settlementId)    children of 12+ become adults in their trade
//    kin(a, b)                  parent and child, siblings, half-siblings
//    recount(settlementId)      settlements.population = living citizens
//    livingCount(settlementId)  the same count, read only
//    beds(settlementId)         { beds, living, free } for the bed rule
//    autoHouse(settlementId, { couples })   housing sorts itself
//
//  Stored life_stage keeps its three values (child, adult, deceased): a youth
//  is a child aged 7+, an elder an adult aged 60+ (§3), so the many
//  life_stage = 'adult' checks elsewhere keep working.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query } = require('../db');

// §2, the "Recommended" column (chosen 2026-11-12). Change numbers here and
// re-run scripts/population_model.js; ask for a review before changing them.
const YEAR_MS = 28 * 3600 * 1000;   // one game year: 28 real hours
const CONFIG = {
  YEAR_MS,
  YOUTH_FROM: 7,               // child 0–6, youth 7–11
  ADULT_FROM: 12,              // grown up at 12 (14 real days)
  ELDER_FROM: 60,              // 56 days as a working adult
  DEATH_FROM: 70,
  DEATH_BASE: 0.06,            // 6% at 70 …
  DEATH_STEP: 0.03,            // … +3% each year …
  DEATH_MAX: 0.6,              // … at most 60%
  FERTILE_FROM: 14,
  FERTILE_TO: 55,
  BIRTH_GAP_YEARS: 2,          // between a couple's children (56 hours)
  MAX_CHILDREN: 4,             // per couple
  MIGRATION_AGE_CAP: 45,       // existing adults start ageing from at most 45
  YOUTH_XP_SHARE: 0.5,         // a youth learns at half the passive rate …
  YOUTH_XP_MENTORED: 1,        // … the full rate with a mentor
  YOUTH_OUTPUT: 0.25,          // and adds a quarter of an adult's basic output
  MENTOR_PUPILS: 2,            // one mentor teaches up to two youths
  ELDER_OUTPUT: 0.6,           // elders work at 60%
  ELDER_HOME_HAPPINESS: 3,     // an elder at home cheers the household
  HOUSE_BEDS: 4,               // every Willow Hut holds 4 (was 2)
  HOUSED_HAPPINESS_BONUS: 10,  // same as a manual move (routes/housing.js)
};

const msOf = v => (v == null ? NaN : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

// Age in years (a fraction). Without a born_at, the old stored age.
function ageOf(c, now = Date.now()) {
  const born = msOf(c && c.born_at);
  if (Number.isFinite(born)) return Math.max(0, (now - born) / YEAR_MS);
  const stored = Number(c && c.life && c.life.age);
  return Number.isFinite(stored) ? stored : 0;
}
function stageOf(c, now = Date.now()) {
  const stored = (c && c.life_stage) || 'adult';
  if (stored === 'deceased') return 'deceased';
  const age = ageOf(c, now);
  if (stored === 'child') return age >= CONFIG.YOUTH_FROM ? 'youth' : 'child';
  return age >= CONFIG.ELDER_FROM ? 'elder' : 'adult';
}
function deathChance(age) {
  const a = Math.floor(Number(age) || 0);
  if (a < CONFIG.DEATH_FROM) return 0;
  return Math.min(CONFIG.DEATH_MAX, CONFIG.DEATH_BASE + CONFIG.DEATH_STEP * (a - CONFIG.DEATH_FROM));
}
function fertile(c, now = Date.now()) {
  if (((c && c.life_stage) || 'adult') !== 'adult') return false;
  const age = ageOf(c, now);
  return age >= CONFIG.FERTILE_FROM && age < CONFIG.FERTILE_TO + 1;
}
function bornAtFor(age, now = Date.now()) {
  return new Date(now - Math.max(0, Number(age) || 0) * YEAR_MS);
}
// Why a partnered couple can't have a child now (empty = they can), apart
// from the hourly chance and happiness. `couple` = { children, lastChildAt }.
function birthBlockers(a, b, couple = {}, now = Date.now()) {
  const out = [];
  if (!a || !b || a.gender === b.gender) return ['Same-gender partners have no children'];
  if (!fertile(a, now) || !fertile(b, now)) out.push(`Both must be ${CONFIG.FERTILE_FROM}–${CONFIG.FERTILE_TO}`);
  if ((couple.children || 0) >= CONFIG.MAX_CHILDREN) out.push(`They have ${CONFIG.MAX_CHILDREN} children already`);
  const last = msOf(couple.lastChildAt);
  if (Number.isFinite(last) && now - last < CONFIG.BIRTH_GAP_YEARS * YEAR_MS) out.push('Their last child is still very young');
  return out;
}

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

// ── Youths and coming of age (§4.2) ───────────────────────────────────────

const _classes = () => require('./careers/classes');
const _traits = () => require('./careers/traits');
const arr = v => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (_) { return []; } })() : []);

// The trade a youth learns when the player hasn't chosen: a parent's.
// `byId`: Map(id → citizen) of the town (the dead included is fine).
function defaultTrade(c, byId) {
  const C = _classes();
  for (const pid of parentsOf(c)) {
    const p = byId.get(pid);
    if (p && C.classOf(p.role) && !C.CLASSES[p.role].assignedBy) return p.role;
  }
  return null;
}

// Every youth's apprenticeship. citizens: the living town (born_at, role,
// life_stage, parent_ids, apprentice_class, mentor_id, stats, life…);
// classRows: citizen_classes rows (for mentor levels).
// Map(youthId → { classKey, chosen, mentorId, mentorName, rate, hint }).
function apprenticeships(citizens, classRows = [], now = Date.now()) {
  const C = _classes();
  const byId = new Map(citizens.map(c => [Number(c.id), c]));
  const levelOf = (cid, k) => { const r = classRows.find(x => Number(x.citizen_id) === Number(cid) && x.class_key === k); return r ? Number(r.level) || 1 : 1; };
  const youths = citizens.filter(c => stageOf(c, now) === 'youth').sort((a, b) => a.id - b.id);
  const pupils = new Map();   // mentorId → count
  const out = new Map();
  // Mentors: living adults or elders working that trade.
  const mentorsFor = k => citizens.filter(m => (m.life_stage || 'adult') === 'adult' && m.role === k)
    .sort((a, b) => levelOf(b.id, k) - levelOf(a.id, k) || a.id - b.id);
  const free = m => (pupils.get(m.id) || 0) < CONFIG.MENTOR_PUPILS;
  const plan = youths.map(y => {
    const chosen = y.apprentice_class && C.classOf(y.apprentice_class) ? y.apprentice_class : null;
    return { y, classKey: chosen || defaultTrade(y, byId), chosen: !!chosen };
  });
  // Chosen mentors first, then everyone else takes the best free one.
  for (const pass of ['chosen', 'auto']) {
    for (const x of plan) {
      if (!x.classKey || out.has(x.y.id)) continue;
      let mentor = null;
      if (pass === 'chosen') {
        const m = x.y.mentor_id ? byId.get(Number(x.y.mentor_id)) : null;
        if (!m || m.role !== x.classKey || (m.life_stage || 'adult') !== 'adult' || !free(m)) continue;
        mentor = m;
      } else {
        mentor = mentorsFor(x.classKey).find(free) || null;
      }
      if (mentor) pupils.set(mentor.id, (pupils.get(mentor.id) || 0) + 1);
      out.set(x.y.id, {
        classKey: x.classKey, chosen: x.chosen,
        mentorId: mentor ? mentor.id : null, mentorName: mentor ? mentor.name : null,
        rate: mentor ? CONFIG.YOUTH_XP_MENTORED : CONFIG.YOUTH_XP_SHARE,
        hint: aptitudeHint(x.y, x.classKey),
      });
    }
  }
  for (const x of plan) if (!out.has(x.y.id)) out.set(x.y.id, { classKey: null, chosen: false, mentorId: null, mentorName: null, rate: 0, hint: null });
  return out;
}

// A youth's hidden talent or dislike for the trade shows as a hint (§4.2).
function aptitudeHint(c, classKey) {
  if (!classKey) return null;
  const T = _traits();
  const C = _classes();
  const hidden = arr(c.hidden_traits);
  const where = (C.CLASSES[classKey] && C.CLASSES[classKey].label || classKey).toLowerCase();
  if (hidden.some(t => T.AVERSIONS[t] && T.AVERSIONS[t].classes.includes(classKey))) return `Seems restless at the ${where}'s work.`;
  if (hidden.some(t => T.APTITUDES[t] && T.APTITUDES[t].classes.includes(classKey))) return `Takes to the ${where}'s work as if born to it.`;
  return null;
}

// Children of 12 or more become adults: their apprenticed trade (or a
// parent's, or Forager if the town lacks the building) and the XP they
// earned. One chronicle line and one event (a toast) each. Atomic per
// citizen, so two requests can't both promote someone.
async function comeOfAge(settlementId, now = Date.now(), q = query) {
  const due = (await q(
    `SELECT id FROM citizens WHERE settlement_id = $1 AND life_stage = 'child'
        AND born_at <= $2::timestamptz`, [settlementId, new Date(now - CONFIG.ADULT_FROM * YEAR_MS).toISOString()])).rows;
  if (!due.length) return [];
  const town = (await q(`SELECT id, name, role, life_stage, parent_ids, apprentice_class, family_id, gender FROM citizens WHERE settlement_id = $1`, [settlementId])).rows;
  const byId = new Map(town.map(c => [Number(c.id), c]));
  const types = (await q('SELECT type FROM buildings WHERE settlement_id = $1', [settlementId])).rows.map(r => r.type);
  const C = _classes();
  const grown = [];
  for (const { id } of due) {
    const c = byId.get(Number(id));
    if (!c) continue;
    const want = (c.apprentice_class && C.classOf(c.apprentice_class) ? c.apprentice_class : null) || defaultTrade(c, byId) || C.FALLBACK_ROLE;
    const role = C.fallbackRole(want, types);
    const r = await q(
      `UPDATE citizens SET life_stage = 'adult', role = $2, mentor_id = NULL
        WHERE id = $1 AND life_stage = 'child' RETURNING id`, [id, role]);
    if (!r.rows.length) continue;   // someone else got there first
    const label = (C.CLASSES[role] && C.CLASSES[role].label || role).toLowerCase();
    const text = `${c.name} has come of age and takes up work as a ${label}.`;
    const at = now;
    await require('./chronicle').write(settlementId, { kind: 'came_of_age', text, citizenIds: [c.id], familyId: c.family_id, at }, q);
    await q(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1, 'came_of_age', $2, $3)`,
      [settlementId, `🎓 ${text}`, JSON.stringify([c.id])]).catch(() => {});
    grown.push({ id: c.id, name: c.name, role });
  }
  if (grown.length) require('./milestones').town(settlementId, 'first_coming_of_age').catch(() => {});
  return grown;
}

// Anyone in the town without a family joins (or founds) the one named for
// their surname: arrivals, travellers, admin citizens. Same rule as the
// migration (0NN_life_cycle.sql).
async function assignFamilies(settlementId, q = query) {
  const SURNAME = "COALESCE(NULLIF(split_part(c.name, ' ', 2), ''), 'Woodkin')";
  await q(`INSERT INTO families (settlement_id, name)
           SELECT DISTINCT c.settlement_id, ${SURNAME} FROM citizens c
            WHERE c.settlement_id = $1 AND c.family_id IS NULL
           ON CONFLICT (settlement_id, name) DO NOTHING`, [settlementId]);
  await q(`UPDATE citizens c SET family_id = f.id FROM families f
            WHERE c.settlement_id = $1 AND c.family_id IS NULL
              AND f.settlement_id = c.settlement_id AND f.name = ${SURNAME}`, [settlementId]);
}

module.exports = { CONFIG, YEAR_MS, assignFamilies, defaultTrade, apprenticeships, aptitudeHint, comeOfAge, LIVING, ageOf, stageOf, deathChance, fertile, bornAtFor, birthBlockers,
  kin, parentsOf, livingCount, recount, beds, planHousing, autoHouse };
