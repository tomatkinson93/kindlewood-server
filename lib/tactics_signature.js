// ══════════════════════════════════════════════════════════════════════════
//  tactics_signature — an ability that runs in a family (docs/TACTICS.md §6,
//  stage F).
//
//  When a child comes of age, a parent (or, with no parent who can, their
//  mentor) teaches them one ability of their own: the one that parent has
//  used most in battle, or else the furthest along their class's ladder. The
//  child keeps it for life, whatever class they take, at full strength, and
//  may hand it on in their turn: so a blow or a blessing can be known by a
//  family's name for generations.
//
//    choose(parents)                  which ability, from whom → { key, from, from_name } | null
//    handDown(q, child, town)         at coming of age (lib/life.js) → the same, written
//    forCitizens(ids)                 Map id → { key, from_name }
//    kitOf(key)                       the ability's facts on the board, with its school
//    assignMissing(sid)               Dev Tools: every grown citizen without one, from their parents
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const CC = require('./class_abilities');

const T = () => require('./tactics_setup');
const FIGHTERS = ['guard', 'archer', 'wizard', 'hearthkeeper'];

// An ability's kit entry, wherever it is taught: a class ladder or a building's lessons. Not an Attack.
function kitOf(key) {
  const S = T();
  if (!key || Object.values(S.ATTACK).includes(key)) return null;
  for (const cls of FIGHTERS) { const k = S.KITS[cls].abilities.find(a => a.key === key); if (k) return { ...k, school: S.SCHOOL_OF[cls] }; }
  const l = require('./tactics_study').LESSONS[key];
  return l && l.kind === 'ability' ? { ...l.kit, school: l.school } : null;
}

// What one grown citizen could teach: [{ key, at, used }], from every class they have levels in, what they
// studied, and the signature they were taught themselves.
async function teachable(q, c) {
  const S = T(), out = new Map();
  const rows = (await q('SELECT class_key, level, xp FROM citizen_classes WHERE citizen_id=$1', [c.id])).rows;
  const lessons = (await q('SELECT lesson_key FROM citizen_lessons WHERE citizen_id=$1', [c.id]).catch(() => ({ rows: [] }))).rows.map(r => r.lesson_key);
  for (const cls of FIGHTERS) {
    const r = rows.find(x => x.class_key === (CC.CLASSES[cls] || {}).career);
    if (!r || !(Number(r.level) > 1 || Number(r.xp) > 0)) continue;
    for (const k of S.knownAt(cls, Number(r.level) || 1)) out.set(k.key, { key: k.key, at: k.at || 1, used: 0 });
  }
  for (const k of lessons) if (kitOf(k)) out.set(k, { key: k, at: 5, used: 0 });
  // Their own family's signature comes before anything else they have not used more in battle.
  if (c.signature && kitOf(c.signature)) out.set(c.signature, { key: c.signature, at: 99, used: 0 });
  if (!out.size) return [];
  const uses = (await q('SELECT ability_key, uses FROM citizen_ability_uses WHERE citizen_id=$1', [c.id]).catch(() => ({ rows: [] }))).rows;
  for (const u of uses) if (out.has(u.ability_key)) out.get(u.ability_key).used = u.uses;
  return [...out.values()];
}
// The one they would teach: most used in battle, then furthest along; the same every time.
const best = list => list.slice().sort((a, b) => b.used - a.used || b.at - a.at || (a.key < b.key ? -1 : 1))[0] || null;

// Which ability a child is taught, and by whom. teachers: citizen rows { id, name, signature }, in the order to
// ask (parents first, then the mentor): the first who has anything to teach, and of those the one whose best is
// most used.
async function choose(q, teachers) {
  let pick = null;
  for (const t of teachers || []) {
    const b = best(await teachable(q, t));
    if (b && (!pick || b.used > pick.used)) pick = { key: b.key, used: b.used, from: t.id, from_name: t.name };
  }
  return pick ? { key: pick.key, from: pick.from, from_name: pick.from_name } : null;
}

// At coming of age. child: { id, parent_ids, mentor_id }; town: Map id → citizen row (anyone, living or not).
async function handDown(q, child, town) {
  const ids = [].concat(Array.isArray(child.parent_ids) ? child.parent_ids : [], child.mentor_id ? [child.mentor_id] : []).map(Number).filter(Boolean);
  if (!ids.length) return null;
  const known = ids.map(id => town && town.get(id)).filter(Boolean);
  const missing = ids.filter(id => !known.some(k => Number(k.id) === id));
  const more = missing.length ? (await q('SELECT id, name, signature FROM citizens WHERE id = ANY($1::int[])', [missing])).rows : [];
  const teachers = ids.map(id => known.find(k => Number(k.id) === id) || more.find(m => Number(m.id) === id)).filter(Boolean);
  const got = await choose(q, teachers);
  if (!got) return null;
  const up = await q('UPDATE citizens SET signature=$2, signature_from=$3, signature_from_name=$4 WHERE id=$1 AND signature IS NULL RETURNING id', [child.id, got.key, got.from, got.from_name]);
  return up.rows.length ? { ...got, name: CC.ability(got.key).name } : null;
}

async function forCitizens(ids) {
  const out = new Map();
  if (!ids || !ids.length) return out;
  const rows = (await query('SELECT id, signature, signature_from_name FROM citizens WHERE id = ANY($1::int[]) AND signature IS NOT NULL', [ids]).catch(() => ({ rows: [] }))).rows;
  for (const r of rows) if (kitOf(r.signature)) out.set(r.id, { key: r.signature, from_name: r.signature_from_name || null });
  return out;
}

// Dev Tools: every grown citizen of the town who has no signature is taught one by their parents, if they can. → how many.
async function assignMissing(sid) {
  const q = (t, p) => query(t, p);
  const town = (await q(`SELECT id, name, parent_ids, mentor_id, signature, COALESCE(life_stage, 'adult') AS life_stage FROM citizens WHERE settlement_id=$1`, [sid])).rows;
  const byId = new Map(town.map(c => [Number(c.id), c]));
  let n = 0;
  for (const c of town) {
    if (c.signature || c.life_stage === 'child' || c.life_stage === 'deceased') continue;
    if (await handDown(q, { id: c.id, parent_ids: c.parent_ids, mentor_id: null }, byId)) n++;
  }
  return n;
}

module.exports = { kitOf, teachable, best, choose, handDown, forCitizens, assignMissing };
