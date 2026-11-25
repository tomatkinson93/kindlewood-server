// ══════════════════════════════════════════════════════════════════════════
//  tactics_abilities — what a citizen knows, and what they bring to a battle
//  (docs/TACTICS.md §6: knowing and readying).
//
//  Knowing is the class ladder: a Guard, Archer, Wizard or Hearthkeeper learns
//  an ability at set class levels (lib/tactics_setup.js KITS, `at`), ten in
//  all. Readying is the citizen's own choice, made at home: which five of
//  what they know go into a battle (citizen_classes.ready, a list of keys).
//  With nothing chosen they bring the first five they learned. Anyone else
//  fights with a villager's three, and has nothing to choose.
//
//    page(userId, citizenId)            → what the Abilities page shows
//    setReady(userId, citizenId, keys)  → the page again, after saving
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const CC = require('./class_abilities');
const M = require('./career_math');
const T = require('./tactics_setup');
const { CLASSES } = require('./careers/classes');

const err = (status, msg) => Object.assign(new Error(msg), { status });

async function load(userId, citizenId) {
  const id = Math.floor(Number(citizenId));
  const s = (await query('SELECT id FROM settlements WHERE user_id=$1', [userId])).rows[0];
  const c = s && id > 0 && (await query(`SELECT id, name, role, COALESCE(life_stage, 'adult') AS life_stage FROM citizens WHERE id=$1 AND settlement_id=$2`, [id, s.id])).rows[0];
  if (!c || c.life_stage === 'deceased') throw err(404, 'No such citizen.');
  if (c.life_stage === 'child') throw err(400, `${c.name} is too young to fight.`);
  const own = CC.classFor(c), cls = T.KITS[own.cls] ? own.cls : 'villager', career = (CC.CLASSES[cls] || {}).career || null;
  const row = career ? (await query('SELECT xp, level, ready FROM citizen_classes WHERE citizen_id=$1 AND class_key=$2', [c.id, career])).rows[0] : null;
  return { s, c, cls, career, trade: own.trade, row: row || null };
}

async function view({ s, c, cls, career, trade, row }) {
  const real = (await require('./combat_resolver').partyUnits([c.id], null))[0];
  const level = career ? ((row && row.level) || 1) : 1, xp = Number(row && row.xp) || 0;
  const kit = T.KITS[cls], all = kit.abilities.concat(career ? [] : [T.TRADE_KIT[trade] || T.TRADE_KIT.t_tool]);
  const known = all.filter(k => (k.at || 1) <= level), bring = T.readied(known, row && row.ready).map(k => k.key);
  const p = M.levelProgress(xp), pack = CC.CLASSES[cls] || CC.CLASSES.villager;
  const busy = (await require('./dungeons').busyCitizenIds([c.id])).length > 0;
  return {
    citizen: { id: c.id, name: c.name },
    cls, label: pack.label, icon: pack.icon, career, career_label: career ? CLASSES[career].label : null,
    level, xp: { into: Math.round(p.into), need: p.need },
    max: T.READY,
    // Something to choose only when more is known than can be brought, and not from inside a dungeon.
    can_choose: !!career && known.length > T.READY, busy,
    abilities: all.slice().sort((a, b) => (a.at || 1) - (b.at || 1)).map(k => ({
      ...T.abilityOf(k, real.unit), at: k.at || 1, known: (k.at || 1) <= level, ready: bring.includes(k.key),
    })),
  };
}

async function page(userId, citizenId) { return view(await load(userId, citizenId)); }

async function setReady(userId, citizenId, keys) {
  const who = await load(userId, citizenId);
  if (!who.career) throw err(400, `${who.c.name} has no class to choose abilities in. A Guard, Archer, Wizard or Hearthkeeper has.`);
  const level = (who.row && who.row.level) || 1;
  const known = T.KITS[who.cls].abilities.filter(k => (k.at || 1) <= level).map(k => k.key);
  const want = [...new Set((Array.isArray(keys) ? keys : []).map(String))];
  const need = Math.min(T.READY, known.length);
  if (want.some(k => !known.includes(k))) throw err(400, `${who.c.name} does not know that yet.`);
  if (want.length !== need) throw err(400, `Choose ${need} abilities to bring.`);
  if ((await require('./dungeons').busyCitizenIds([who.c.id])).length) throw err(400, `${who.c.name} is in a dungeon. Abilities are readied at home.`);
  await query(
    `INSERT INTO citizen_classes (citizen_id, settlement_id, class_key, ready) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (citizen_id, class_key) DO UPDATE SET ready = EXCLUDED.ready, updated_at = NOW()`,
    [who.c.id, who.s.id, who.career, JSON.stringify(want)]);
  return page(userId, citizenId);
}

module.exports = { page, setReady };
