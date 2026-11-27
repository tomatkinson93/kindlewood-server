// ══════════════════════════════════════════════════════════════════════════
//  tactics_study — study at a class building, and the passive slot
//  (docs/TACTICS.md §6, stage D; the owner's choices, 2026-11-27).
//
//  Levels teach a class's core abilities. Its building teaches the rest:
//  extra abilities of its school, and passives. A lesson takes hours and a
//  fee in wealth, needs a class level and a building level, and takes one of
//  the building's seats (one a building level). The citizen carries on as
//  normal while they study. What is learned is the citizen's for good.
//
//    Watchtower       a Guard (Arms) or an Archer (Archery) studies here
//    Wizard's Tower   a Wizard (Wild magic)
//    Hearth Shrine    a Hearthkeeper (Hearth magic)
//
//  An extra ability joins its school: it comes to every battle while the
//  citizen is that class, and is among what that class taught them when it is
//  their second school. A passive goes in the citizen's one passive slot
//  (citizens.passive), chosen at home among those they know, whatever class
//  they are now.
//
//    page(userId, citizenId)             what the Study part of the page shows
//    start(userId, citizenId, lesson)    pay, take a seat, begin
//    cancel(userId, citizenId)           stop; the fee comes back
//    setPassive(userId, citizenId, key)  choose the passive (null: none)
//    lessonsFor(ids)  → Map id → Set of lesson keys known
//    passiveFor(ids)  → Map id → the passive in their slot
//    finishDue(sid?)  studies whose time is up are learned; tick() for the worker
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const CC = require('./class_abilities');

const err = (status, msg) => Object.assign(new Error(msg), { status });
const BUILDING = { guard: 'watchtower', archer: 'watchtower', wizard: 'wizard_tower', hearthkeeper: 'hearth_shrine' };
const BUILDING_NAME = { watchtower: 'Watchtower', wizard_tower: 'Wizard\'s Tower', hearth_shrine: 'Hearth Shrine' };
const SCHOOL_OF = { guard: 'arms', archer: 'archery', wizard: 'wild', hearthkeeper: 'hearth' };
// How long a lesson takes and what it costs, by how advanced it is.
const TIERS = { 1: { hours: 2, wealth: 50 }, 2: { hours: 6, wealth: 150 }, 3: { hours: 12, wealth: 400 } };

// kind: 'ability' (kit: its facts on the board) or 'passive'. school: whose building teaches it (null: any of
// the three, to a citizen of its class). level: the class level it needs; building: the building level.
const LESSONS = {
  // ── Arms (the Watchtower, to a Guard)
  c_second_wind: { kind: 'ability', school: 'arms', tier: 1, level: 3, building: 1, kit: { icon: '💨', max: 0, uses: 1 }, says: 'Catch your breath: heal yourself. Once a battle.' },
  c_cleave:      { kind: 'ability', school: 'arms', tier: 2, level: 8, building: 2, kit: { icon: '🪓', shape: 'around', radius: 1, cooldown: 2 }, says: 'A wide swing at every foe beside you.' },
  brace:         { kind: 'passive', school: 'arms', tier: 1, level: 3, building: 1, name: 'Brace', icon: '🧱', says: 'The first hit they take each round does a third less.' },
  counter:       { kind: 'passive', school: 'arms', tier: 2, level: 6, building: 2, name: 'Counter', icon: '↩️', says: 'Struck by a foe standing next to them, they strike back at half strength. Once a round.' },
  // ── Archery (the Watchtower, to an Archer)
  a_venom:       { kind: 'ability', school: 'archery', tier: 1, level: 3, building: 1, kit: { icon: '🐍', min: 2, max: 5, cooldown: 2 }, says: 'A barbed arrow that poisons.' },
  c_expose:      { kind: 'ability', school: 'archery', tier: 2, level: 8, building: 2, kit: { icon: '🎯', min: 1, max: 5, cooldown: 2 }, says: 'Find the gap: hits on that foe land harder.' },
  light_feet:    { kind: 'passive', school: 'archery', tier: 1, level: 3, building: 1, name: 'Light Feet', icon: '🪶', says: 'Walks one tile further.' },
  keen_eye:      { kind: 'passive', school: 'archery', tier: 2, level: 6, building: 2, name: 'Keen Eye', icon: '👁️', says: 'Archery reaches one tile further.' },
  // ── Wild magic (the Wizard's Tower)
  c_weaken:      { kind: 'ability', school: 'wild', tier: 1, level: 3, building: 1, kit: { icon: '🌫️', min: 1, max: 4, cooldown: 1 }, says: 'A hex: that foe hits less hard.' },
  w_deep_freeze: { kind: 'ability', school: 'wild', tier: 3, level: 12, building: 3, kit: { icon: '🧊', min: 1, max: 4, uses: 1 }, says: 'Frozen solid: a foe loses its next turn. Once a battle.' },
  focus:         { kind: 'passive', school: 'wild', tier: 1, level: 3, building: 1, name: 'Focus', icon: '🔆', says: 'Wild magic is a tenth stronger.' },
  quick_hands:   { kind: 'passive', school: 'wild', tier: 2, level: 6, building: 2, name: 'Quick Hands', icon: '🤲', says: 'Wild magic is ready a turn sooner.' },
  // ── Hearth magic (the Hearth Shrine)
  h_brand:       { kind: 'ability', school: 'hearth', tier: 1, level: 3, building: 1, kit: { icon: '♨️', min: 1, max: 3, cooldown: 2 }, says: 'A searing coal: it burns, and the foe hits less hard.' },
  h_mend:        { kind: 'ability', school: 'hearth', tier: 2, level: 8, building: 2, kit: { icon: '🎶', shape: 'around', radius: 2, uses: 2 }, says: 'A mending song: heals everyone near a little. Twice a battle.' },
  warm_hands:    { kind: 'passive', school: 'hearth', tier: 1, level: 3, building: 1, name: 'Warm Hands', icon: '🫶', says: 'Their healing is 15% stronger.' },
  deep_embers:   { kind: 'passive', school: 'hearth', tier: 2, level: 6, building: 2, name: 'Deep Embers', icon: '🪵', says: 'Abilities with a number of uses a battle have one more.' },
  // ── Any of the three buildings, to a citizen of its class
  sure_footed:   { kind: 'passive', school: null, tier: 1, level: 2, building: 1, name: 'Sure-footed', icon: '🥾', says: 'Jumps one step higher.' },
  tough:         { kind: 'passive', school: null, tier: 1, level: 4, building: 1, name: 'Tough', icon: '💪', says: 'A tenth more health.' },
};
for (const k of Object.keys(LESSONS)) { const l = LESSONS[k]; l.key = k; if (l.kind === 'ability') { l.kit.key = k; l.name = CC.ability(k).name; l.icon = l.kit.icon; } }
const PASSIVES = Object.values(LESSONS).filter(l => l.kind === 'passive');
// What a passive does to a unit and its abilities when it is built (lib/tactics_setup.js). Brace and Counter are
// the board's own rules (lib/tactics_engine.js): the unit only carries the name.
const PASSIVE = { TOUGH: 1.1, FOCUS: 1.1, WARM: 1.15 };

async function lessonsFor(ids) {
  const out = new Map();
  if (!ids || !ids.length) return out;
  const rows = (await query('SELECT citizen_id, lesson_key FROM citizen_lessons WHERE citizen_id = ANY($1::int[])', [ids]).catch(() => ({ rows: [] }))).rows;
  for (const r of rows) { if (!LESSONS[r.lesson_key]) continue; if (!out.has(r.citizen_id)) out.set(r.citizen_id, new Set()); out.get(r.citizen_id).add(r.lesson_key); }
  return out;
}
// The passive each has chosen, if they still know it.
async function passiveFor(ids) {
  const out = new Map();
  if (!ids || !ids.length) return out;
  const rows = (await query(`SELECT c.id, c.passive FROM citizens c JOIN citizen_lessons l ON l.citizen_id = c.id AND l.lesson_key = c.passive WHERE c.id = ANY($1::int[]) AND c.passive IS NOT NULL`, [ids]).catch(() => ({ rows: [] }))).rows;
  for (const r of rows) if (LESSONS[r.passive] && LESSONS[r.passive].kind === 'passive') out.set(r.id, r.passive);
  return out;
}

// Studies whose time is up: the lesson is learned, the seat is free, the town is told. → how many.
async function finishDue(sid = null) {
  const due = (await query(`DELETE FROM citizen_study WHERE done_at <= NOW()${sid ? ' AND settlement_id = $1' : ''} RETURNING citizen_id, settlement_id, lesson_key`, sid ? [sid] : []).catch(() => ({ rows: [] }))).rows;
  for (const d of due) {
    const l = LESSONS[d.lesson_key];
    if (!l) continue;
    await query('INSERT INTO citizen_lessons (citizen_id, lesson_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [d.citizen_id, d.lesson_key]);
    // A first passive goes straight into the empty slot.
    if (l.kind === 'passive') await query('UPDATE citizens SET passive = $2 WHERE id = $1 AND passive IS NULL', [d.citizen_id, d.lesson_key]).catch(() => {});
    const c = (await query('SELECT name FROM citizens WHERE id=$1', [d.citizen_id])).rows[0];
    const message = `📖 ${c ? c.name : 'A citizen'} has finished studying ${l.name}${l.kind === 'passive' ? ' (a passive)' : ''}.`;
    await query(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,'study',$2,$3)`, [d.settlement_id, message, JSON.stringify([d.citizen_id])]).catch(() => {});
    try { require('./event_bus').publish(d.settlement_id, { type: 'study_done', citizen_id: d.citizen_id, lesson: d.lesson_key, message }); } catch (e) { /* offline */ }
  }
  return due.length;
}
let _last = 0;
async function tick() {
  if (Date.now() - _last < 20 * 1000) return;
  _last = Date.now();
  try { await finishDue(); } catch (e) { console.error('[study]', e.message); }
}

async function load(userId, citizenId) {
  const id = Math.floor(Number(citizenId));
  const s = (await query('SELECT id, wealth FROM settlements WHERE user_id=$1', [userId])).rows[0];
  if (s) await finishDue(s.id);      // first: what has just been learned is part of what is read below
  const c = s && id > 0 && (await query(`SELECT id, name, role, COALESCE(life_stage, 'adult') AS life_stage, passive FROM citizens WHERE id=$1 AND settlement_id=$2`, [id, s.id])).rows[0];
  if (!c || c.life_stage === 'deceased') throw err(404, 'No such citizen.');
  if (c.life_stage === 'child') throw err(400, `${c.name} is too young to study.`);
  const cls = CC.classFor(c).cls, building = BUILDING[cls] || null;
  const career = (CC.CLASSES[cls] || {}).career || null;
  const row = career ? (await query('SELECT level FROM citizen_classes WHERE citizen_id=$1 AND class_key=$2', [c.id, career])).rows[0] : null;
  const bld = building ? (await query('SELECT level FROM buildings WHERE settlement_id=$1 AND type=$2 AND health > 0 ORDER BY level DESC LIMIT 1', [s.id, building]).catch(() => ({ rows: [] }))).rows[0] : null;
  const used = building ? (await query('SELECT COUNT(*)::int AS n FROM citizen_study WHERE settlement_id=$1 AND building=$2', [s.id, building])).rows[0].n : 0;
  const known = (await lessonsFor([c.id])).get(c.id) || new Set();
  const studying = (await query('SELECT lesson_key, building, wealth, started_at, done_at FROM citizen_study WHERE citizen_id=$1', [c.id])).rows[0] || null;
  return { s, c: { ...c, passive: known.has(c.passive) ? c.passive : null }, cls, school: SCHOOL_OF[cls] || null, building, level: (row && row.level) || 1, bldLevel: bld ? bld.level : 0, used, known, studying };
}
// Why this citizen cannot begin this lesson now, or null.
function refusal(w, l) {
  if (w.known.has(l.key)) return 'Already known.';
  if (!w.building) return 'Only a Guard, Archer, Wizard or Hearthkeeper studies.';
  if (l.school && l.school !== w.school) return 'Not taught to their class.';
  if (!w.bldLevel) return `The town has no ${BUILDING_NAME[w.building]}.`;
  if (w.bldLevel < l.building) return `Needs the ${BUILDING_NAME[w.building]} at level ${l.building}.`;
  if (w.level < l.level) return `Needs class level ${l.level}.`;
  if (w.studying) return 'Already studying something.';
  if (w.used >= w.bldLevel) return `Every seat at the ${BUILDING_NAME[w.building]} is taken.`;
  if (Number(w.s.wealth) < TIERS[l.tier].wealth) return `Costs ${TIERS[l.tier].wealth} wealth.`;
  return null;
}

async function page(userId, citizenId) {
  const w = await load(userId, citizenId);
  const mine = Object.values(LESSONS).filter(l => w.school && (!l.school || l.school === w.school));
  // Passives learned in an earlier class stay theirs: they are listed too, as known.
  const others = Object.values(LESSONS).filter(l => l.kind === 'passive' && w.known.has(l.key) && !mine.includes(l));
  return {
    citizen: { id: w.c.id, name: w.c.name },
    building: w.building ? { type: w.building, name: BUILDING_NAME[w.building], level: w.bldLevel, seats: w.bldLevel, used: w.used } : null,
    level: w.level, wealth: Math.floor(Number(w.s.wealth) || 0),
    studying: w.studying ? { key: w.studying.lesson_key, name: (LESSONS[w.studying.lesson_key] || {}).name || w.studying.lesson_key, done_at: w.studying.done_at, started_at: w.studying.started_at, wealth: w.studying.wealth } : null,
    lessons: mine.concat(others).map(l => {
      const why = refusal(w, l), now = w.studying && w.studying.lesson_key === l.key;
      return { key: l.key, kind: l.kind, name: l.name, icon: l.icon, says: l.says, school: l.school, tier: l.tier, hours: TIERS[l.tier].hours, wealth: TIERS[l.tier].wealth, need_level: l.level, need_building: l.building,
        state: w.known.has(l.key) ? 'known' : now ? 'studying' : why ? 'locked' : 'open', why: w.known.has(l.key) || now ? null : why };
    }),
    passive: w.c.passive, passives: PASSIVES.filter(l => w.known.has(l.key)).map(l => ({ key: l.key, name: l.name, icon: l.icon, says: l.says })),
  };
}

async function start(userId, citizenId, key) {
  const l = LESSONS[String(key)];
  if (!l) throw err(400, 'No such lesson.');
  const w = await load(userId, citizenId);
  const why = refusal(w, l);
  if (why) throw err(400, `${w.c.name} cannot study ${l.name}: ${why}`);
  const fee = TIERS[l.tier].wealth;
  await withTransaction(async client => {
    const s = (await client.query('SELECT wealth FROM settlements WHERE id=$1 FOR UPDATE', [w.s.id])).rows[0];
    if (Number(s.wealth) < fee) throw err(400, `Costs ${fee} wealth.`);
    const used = (await client.query('SELECT COUNT(*)::int AS n FROM citizen_study WHERE settlement_id=$1 AND building=$2', [w.s.id, w.building])).rows[0].n;
    if (used >= w.bldLevel) throw err(400, `Every seat at the ${BUILDING_NAME[w.building]} is taken.`);
    await client.query('UPDATE settlements SET wealth = wealth - $2 WHERE id=$1', [w.s.id, fee]);
    await client.query(`INSERT INTO citizen_study (citizen_id, settlement_id, lesson_key, building, wealth, done_at) VALUES ($1,$2,$3,$4,$5, NOW() + make_interval(secs => $6))`,
      [w.c.id, w.s.id, l.key, w.building, fee, TIERS[l.tier].hours * 3600]);
  }).catch(e => { if (e && e.code === '23505') throw err(400, `${w.c.name} is already studying something.`); throw e; });
  return page(userId, citizenId);
}
// Stop studying: the seat is free and the fee comes back.
async function cancel(userId, citizenId) {
  const w = await load(userId, citizenId);
  if (!w.studying) throw err(400, `${w.c.name} is not studying anything.`);
  await withTransaction(async client => {
    const gone = (await client.query('DELETE FROM citizen_study WHERE citizen_id=$1 RETURNING wealth', [w.c.id])).rows[0];
    if (gone && gone.wealth > 0) await client.query('UPDATE settlements SET wealth = wealth + $2 WHERE id=$1', [w.s.id, gone.wealth]);
  });
  return page(userId, citizenId);
}
async function setPassive(userId, citizenId, key) {
  const w = await load(userId, citizenId);
  if ((await require('./dungeons').busyCitizenIds([w.c.id])).length) throw err(400, `${w.c.name} is away at a dungeon. A passive is chosen at home.`);
  const k = key == null || key === '' || key === 'none' ? null : String(key);
  if (k && !(LESSONS[k] && LESSONS[k].kind === 'passive' && w.known.has(k))) throw err(400, `${w.c.name} has not learned that.`);
  // 'none' is kept apart from "never chosen" so a passive learned later does not take the slot by itself.
  await query('UPDATE citizens SET passive = $2 WHERE id = $1', [w.c.id, k || 'none']);
  return page(userId, citizenId);
}

module.exports = { LESSONS, PASSIVES, PASSIVE, TIERS, BUILDING, BUILDING_NAME, lessonsFor, passiveFor, finishDue, tick, page, start, cancel, setPassive };
