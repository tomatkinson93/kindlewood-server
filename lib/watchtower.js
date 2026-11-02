// ══════════════════════════════════════════════════════════════════════════
//  watchtower — Guards (`soldier`) and Archers keep watch at the Watchtower.
//
//  state(db, sid) → { level, slots, posted: [{ id, name, role, class_level }],
//                     happiness, defence }
//    posted     adult Guards/Archers at home (not on a quest, clan quest,
//               trip or outpost), best first, up to slots (2 per level).
//    happiness  +1 per posted citizen, at most HAPPY_CAP (lib/town_mods).
//    defence    level × DEF_PER_LEVEL + Σ (DEF_PER_WATCH + class level) —
//               the town's own share of raid defence (lib/raids).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const HAPPY_CAP = 5;
const DEF_PER_LEVEL = 10;
const DEF_PER_WATCH = 5;
const ROLES = ['soldier', 'archer'];

async function state(db, sid) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const b = (await run("SELECT level FROM buildings WHERE settlement_id=$1 AND type='watchtower'", [sid])).rows[0];
  const level = b ? Number(b.level) || 0 : 0;
  const out = { level, slots: level * 2, posted: [], happiness: 0, defence: 0, def_per_level: DEF_PER_LEVEL, def_per_watch: DEF_PER_WATCH };
  if (!level) return out;
  const r = await run(
    `SELECT c.id, c.name, c.role, COALESCE(cc.level, 1) AS class_level
       FROM citizens c
       LEFT JOIN citizen_classes cc ON cc.citizen_id = c.id AND cc.class_key = c.role
      WHERE c.settlement_id = $1 AND c.role = ANY($2::text[]) AND COALESCE(c.life_stage, 'adult') = 'adult'
      ORDER BY COALESCE(cc.level, 1) DESC, c.id`, [sid, ROLES]).catch(() =>
    run(`SELECT id, name, role, 1 AS class_level FROM citizens WHERE settlement_id = $1 AND role = ANY($2::text[]) AND COALESCE(life_stage, 'adult') = 'adult' ORDER BY id`, [sid, ROLES]));
  const ids = r.rows.map(c => c.id);
  const away = new Set();
  if (ids.length) {
    const q1 = await run(`SELECT citizen_id AS id FROM settlement_quests WHERE status='active' AND citizen_id = ANY($1::int[])
                          UNION SELECT (jsonb_array_elements_text(party_ids))::int FROM settlement_quests WHERE status='active' AND quest_type='party' AND settlement_id=$2`, [ids, sid]).catch(() => ({ rows: [] }));
    for (const x of q1.rows) away.add(Number(x.id));
    for (const x of await require('./clan_quests').busyCitizenIds(ids).catch(() => [])) away.add(Number(x));
    for (const x of await require('./market').merchantCitizenIds(ids).catch(() => [])) away.add(Number(x));
  }
  out.posted = r.rows.filter(c => !away.has(c.id)).slice(0, out.slots)
    .map(c => ({ id: c.id, name: c.name, role: c.role, class_level: Number(c.class_level) || 1 }));
  out.happiness = Math.min(HAPPY_CAP, out.posted.length);
  out.defence = level * DEF_PER_LEVEL + out.posted.reduce((t, c) => t + DEF_PER_WATCH + c.class_level, 0);
  return out;
}

module.exports = { state, HAPPY_CAP, DEF_PER_LEVEL, DEF_PER_WATCH, ROLES };
