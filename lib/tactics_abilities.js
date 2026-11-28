// ══════════════════════════════════════════════════════════════════════════
//  tactics_abilities — what a citizen knows, and what they bring to a battle
//  (docs/TACTICS.md §6: schools, the whole kit, and a second school).
//
//  A citizen brings everything their current class has taught them (the class
//  ladder: lib/tactics_setup.js KITS, `at`), and up to five abilities from one
//  other class they have levels in: their second school, at three-quarters
//  strength. Which class, and which five, is the citizen's own choice, made
//  at home (citizens.second_class, second_ready). With nothing chosen they
//  bring the first five of the other class they are furthest along in.
//
//    page(userId, citizenId)                  → what the Abilities page shows
//    setSecond(userId, citizenId, cls, keys)  → the page again, after saving
//                                               (cls 'none': bring nothing)
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const CC = require('./class_abilities');
const M = require('./career_math');
const T = require('./tactics_setup');
const { CLASSES } = require('./careers/classes');

const err = (status, msg) => Object.assign(new Error(msg), { status });
const school = key => ({ key, ...(T.SCHOOLS[key] || T.SCHOOLS.basics) });

async function load(userId, citizenId) {
  const id = Math.floor(Number(citizenId));
  const s = (await query('SELECT id FROM settlements WHERE user_id=$1', [userId])).rows[0];
  const c = s && id > 0 && (await query(`SELECT id, name, role, COALESCE(life_stage, 'adult') AS life_stage, second_class, second_ready FROM citizens WHERE id=$1 AND settlement_id=$2`, [id, s.id])).rows[0];
  if (!c || c.life_stage === 'deceased') throw err(404, 'No such citizen.');
  if (c.life_stage === 'child') throw err(400, `${c.name} is too young to fight.`);
  const own = CC.classFor(c), cls = T.KITS[own.cls] ? own.cls : 'villager', career = (CC.CLASSES[cls] || {}).career || null;
  const rows = (await query('SELECT class_key, xp, level FROM citizen_classes WHERE citizen_id=$1', [c.id])).rows;
  return { s, c, cls, career, trade: own.trade, rows, row: (career && rows.find(r => r.class_key === career)) || null };
}
// The other classes this citizen has levels in: [{ cls, level }], the furthest along first.
function others(rows, cls) {
  return Object.keys(T.KITS).filter(k => k !== cls && k !== 'villager').map(k => {
    const r = rows.find(x => x.class_key === (CC.CLASSES[k] || {}).career);
    return r && (Number(r.level) > 1 || Number(r.xp) > 0) ? { cls: k, level: Number(r.level) || 1 } : null;
  }).filter(Boolean).sort((a, b) => b.level - a.level);
}

async function view({ s, c, cls, career, trade, rows, row }) {
  // As a battle builds them: with what their career has made of them, and what they hold and wear (lib/careers combatDeltas).
  const CR = require('./combat_resolver'), deltas = await require('./careers').combatDeltas(s.id, [c.id]).catch(() => ({}));
  const real = (await CR.partyUnits([c.id], CR.withParty(null, deltas)))[0];
  const level = career ? ((row && row.level) || 1) : 1, xp = Number(row && row.xp) || 0;
  const second = T.secondOf(rows, cls, c);
  // Mastery: how often each has been used in battle, and which are ✦ (lib/tactics_mastery.js).
  const MA = require('./tactics_mastery'), uses = await MA.countsFor(c.id), stars = new Set(Object.keys(uses).filter(k => uses[k] >= MA.USES));
  // `used`: times used in battle towards mastery. (Not `uses`: that is an ability's own limit of times a battle.)
  const mark = a => ({ ...a, used: Math.min(MA.USES, uses[a.key] || 0), star: stars.has(a.key) });
  // As a battle would build them, so the page and the board never disagree.
  // What they have learned by study, and the passive in their slot (lib/tactics_study.js).
  const ST = require('./tactics_study'), lessons = (await ST.lessonsFor([c.id])).get(c.id) || null, passive = (await ST.passiveFor([c.id])).get(c.id) || null;
  const brought = T.secondKits(second, cls, lessons).map(k => k.key);
  // What the town has researched for battle (the Library's Battlecraft path): every citizen has it.
  const signature = (await require('./tactics_signature').forCitizens([c.id])).get(c.id) || null;
  const research = await T.researchOf(s.id), RS = require('./research_defs'), done = research ? await require('./research').doneSet(null, s.id) : new Set();
  const unit = T.partyUnit({ id: c.id, name: c.name, role: c.role, unit: real.unit }, cls, null, trade, level, second, stars, { lessons, passive, research, signature });
  const kit = T.KITS[cls], p = M.levelProgress(xp), pack = CC.CLASSES[cls] || CC.CLASSES.villager;
  const busy = (await require('./dungeons').busyCitizenIds([c.id])).length > 0;
  const ahead = kit.abilities.filter(k => (k.at || 1) > level && k.key !== T.ATTACK[cls]).sort((a, b) => a.at - b.at);
  return {
    citizen: { id: c.id, name: c.name },
    cls, label: pack.label, icon: pack.icon, career, career_label: career ? CLASSES[career].label : null,
    level, xp: { into: Math.round(p.into), need: p.need },
    school: school(T.SCHOOL_OF[cls]),
    // Everything they bring from their own class (and Basics, and a villager's trade), as the board will have it…
    mastery: { uses: MA.USES, edge: MA.EDGE },
    // What they hold and wear, and what its kind does to their abilities (lib/gear_kinds.js). `kinds`: every kind, for the page's guide.
    gear: unit.gear || null, move: unit.move,
    kinds: Object.entries(require('./gear_kinds').KINDS).map(([key, k]) => ({ key, name: k.name, says: k.says, hands: k.hands })),
    // Their Attack: on its own, apart from their abilities.
    attack: mark(unit.abilities.find(a => a.attack)),
    abilities: unit.abilities.filter(a => !a.off && !a.attack).map(a => ({ ...mark(a), at: (kit.abilities.find(k => k.key === a.key) || {}).at || 1, known: true, school_name: school(a.school).name, studied: !!(ST.LESSONS[a.key]) && !a.signature })),
    // The family's signature, if a parent taught them one: { key, name, from_name }.
    signature: signature ? { key: signature.key, name: CC.ability(signature.key).name, from_name: signature.from_name } : null,
    // The town's finished Battlecraft research, in words.
    research: RS.KEYS.filter(k => RS.PROJECTS[k].branch === 'battle' && done.has(k)).map(k => ({ key: k, name: RS.PROJECTS[k].label, icon: RS.PROJECTS[k].icon, says: RS.PROJECTS[k].desc })),
    // The passive in their slot (chosen on the Study part of the page).
    passive: unit.passive_info || null, jump: unit.jump,
    // …and what the class has yet to teach.
    ahead: ahead.map(k => ({ ...T.abilityOf(k, real.unit), at: k.at, known: false })),
    // The second school: each other class they have levels in, what it taught them, and which they bring.
    second: {
      max: T.SECOND, strength: T.OFF, busy,
      cls: second ? second.cls : null,
      chosen: c.second_class || null,       // null: not chosen yet (the furthest-along class comes by default); 'none': nothing
      options: others(rows, cls).map(o => ({
        cls: o.cls, label: (CC.CLASSES[o.cls] || {}).label, icon: (CC.CLASSES[o.cls] || {}).icon, level: o.level, school: school(T.SCHOOL_OF[o.cls]),
        abilities: T.knownAt(o.cls, o.level).concat(T.studied(o.cls, lessons)).map(k => ({ ...mark(T.abilityOf(k, real.unit, { off: true, star: stars.has(k.key), passive, research, school: k.school })), at: k.at || 1, studied: !!k.studied, ready: !!second && second.cls === o.cls && brought.includes(k.key) })),
      })),
    },
  };
}

async function page(userId, citizenId) { return view(await load(userId, citizenId)); }

// Choose the second school: a class the citizen has levels in and up to five of what it taught them, or 'none'.
async function setSecond(userId, citizenId, cls, keys) {
  const who = await load(userId, citizenId);
  if ((await require('./dungeons').busyCitizenIds([who.c.id])).length) throw err(400, `${who.c.name} is away at a dungeon. Abilities are chosen at home.`);
  if (cls === 'none' || cls == null || cls === '') {
    await query(`UPDATE citizens SET second_class='none', second_ready=NULL WHERE id=$1`, [who.c.id]);
    return page(userId, citizenId);
  }
  const opt = others(who.rows, who.cls).find(o => o.cls === cls);
  if (!opt) throw err(400, `${who.c.name} has never been that. Abilities from another class come from having been one.`);
  const mine = (await require('./tactics_study').lessonsFor([who.c.id])).get(who.c.id) || null;
  const known = T.knownAt(opt.cls, opt.level).concat(T.studied(opt.cls, mine)).map(k => k.key);
  const want = [...new Set((Array.isArray(keys) ? keys : []).map(String))];
  if (want.some(k => !known.includes(k))) throw err(400, `${who.c.name} does not know that.`);
  if (want.length > T.SECOND) throw err(400, `Choose up to ${T.SECOND}.`);
  if (!want.length) throw err(400, 'Choose at least one, or bring none from another class.');
  await query(`UPDATE citizens SET second_class=$2, second_ready=$3::jsonb WHERE id=$1`, [who.c.id, opt.cls, JSON.stringify(want)]);
  return page(userId, citizenId);
}

module.exports = { page, setSecond };
