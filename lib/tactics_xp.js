// ══════════════════════════════════════════════════════════════════════════
//  tactics_xp — what a battle on the board teaches (docs/TACTICS.md §6).
//
//  A battle that is won pays experience to everyone who fought it, into the
//  same class levels the rest of the game uses (citizen_classes, 1 to 20;
//  lib/careers, lib/career_math.js). A Guard, Archer, Wizard or Hearthkeeper
//  earns it in their own class. Anyone else earns half of it as Guard
//  training, as card battles already paid them. Whoever lay fallen when it
//  ended earns half. A battle that is lost pays nothing.
//
//  How much: each foe is worth its rank's figure, times the skull's.
//    green, three regulars: 30 · red, a heavy and two regulars: 79 ·
//    purple, a boss and two regulars: 240
//  For scale (career_math): level 5 is 180 experience in all, level 10 is
//  1,800, level 20 is 15,000; a citizen at their job at home earns 10 an hour.
//
//    xpOf(keys, tier)                          what a fight is worth to each citizen
//    award(sid, units, xp)                     pay it, and → the rows the screen shows
//    preview(sid, units, xp)                   the same rows with nothing paid (a practice field)
//  A row: { citizen_id, name, cls, class_key, class_label, icon, own, down,
//           gain, before: { level, xp, into, need }, after: { … }, levels,
//           learned: [{ key, name, icon, at, spare }] }   abilities the new levels brought (spare: beyond the
//                                                 first five, so it must be readied at home to be used)
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, withTransaction } = require('../db');
const M = require('./career_math');
const F = require('./tactics_foes');
const { CLASSES } = require('./careers/classes');
const CC = require('./class_cards');

const RANK_XP = { minion: 6, regular: 10, heavy: 16, elite: 30, boss: 60 };
const TIER_XP = { green: 1, yellow: 1.3, orange: 1.7, red: 2.2, purple: 3 };
const OFF_JOB = 0.5;       // someone who is no fighter by trade (lib/career_subscriber.js offJob)
const FALLEN = 0.5;        // someone who lay fallen when the battle ended
const TRAINING = 'soldier';   // the class a villager's fighting counts towards: the Guard's

// A fight's worth to each citizen. A creature the board knows only by its row counts as a regular.
function xpOf(keys, tier) {
  const base = (keys || []).reduce((n, k) => n + (RANK_XP[(F.foe(k) || {}).rank] || RANK_XP.regular), 0);
  return Math.round(base * (TIER_XP[tier] || 1));
}

const spot = xp => { const p = M.levelProgress(xp); return { level: p.level, xp: Math.round(Number(xp) * 100) / 100, into: Math.round(p.into * 100) / 100, need: p.need }; };

// Who earns what, in which class. `byCls`: take the class from the unit (a practice field, where any
// citizen can be tried as any class); otherwise from the citizen's own job.
async function plan(sid, units, xp, byCls) {
  const mine = (units || []).filter(u => u && u.citizen_id);
  const ids = mine.map(u => Number(u.citizen_id));
  if (!ids.length || !(xp > 0)) return [];
  const cits = (await query(`SELECT id, name, role, COALESCE(life_stage, 'adult') AS life_stage FROM citizens WHERE settlement_id = $1 AND id = ANY($2::int[])`, [sid, ids])).rows;
  const rows = (await query('SELECT citizen_id, class_key, xp, level FROM citizen_classes WHERE citizen_id = ANY($1::int[])', [ids]).catch(() => ({ rows: [] }))).rows;
  const out = [];
  for (const u of mine) {
    const c = cits.find(x => x.id === Number(u.citizen_id));
    if (!c || c.life_stage === 'deceased') continue;
    const career = byCls ? ((CC.PACKS[u.cls] || {}).career || null) : ((CLASSES[c.role] || {}).kind === 'combat' ? c.role : null);
    const key = career || TRAINING, own = !!career, cls = CLASSES[key];
    const gain = Math.max(1, Math.round(xp * (own ? 1 : OFF_JOB) * (u.down ? FALLEN : 1)));
    const have = Number((rows.find(r => r.citizen_id === c.id && r.class_key === key) || {}).xp) || 0;
    out.push({ citizen_id: c.id, name: c.name, cls: u.cls || null, class_key: key, class_label: cls.label, icon: cls.icon, own, down: !!u.down,
      gain, before: spot(have), after: spot(have + gain), levels: M.levelForXp(have + gain) - M.levelForXp(have), learned: [] });
  }
  return out;
}

// Pay a won battle's experience. Its own transaction, after the battle's has committed, as every
// other grant is (lib/career_subscriber.js): careers.grantXp locks the citizens first.
async function award(sid, units, xp) {
  const rows = await plan(sid, units, xp, false);
  if (!rows.length) return rows;
  const careers = require('./careers'), events = [];
  let got = null;
  await withTransaction(async client => { got = await careers.grantXp(client, sid, rows.map(r => ({ citizenId: r.citizen_id, classKey: r.class_key, xp: r.gain })), events); });
  careers.publish(sid, events);
  // What the rows really hold now (something else may have paid in between).
  for (const r of rows) {
    const row = got && got.get(r.citizen_id) && got.get(r.citizen_id)[r.class_key];
    if (row) { r.after = spot(Number(row.xp)); r.levels = r.after.level - r.before.level; }
  }
  return withLearned(rows);
}
// What each has learned by the levels they gained: their own class's ladder (lib/tactics_setup.js KITS).
function withLearned(rows) {
  const S = require('./tactics_setup'), packOf = key => Object.keys(CC.PACKS).find(k => CC.PACKS[k].career === key);
  for (const r of rows) r.learned = r.own && r.after.level > r.before.level ? S.learnedBetween(packOf(r.class_key), r.before.level, r.after.level) : [];
  return rows;
}
const preview = async (sid, units, xp) => withLearned(await plan(sid, units, xp, true));

module.exports = { RANK_XP, TIER_XP, OFF_JOB, FALLEN, TRAINING, xpOf, award, preview };
