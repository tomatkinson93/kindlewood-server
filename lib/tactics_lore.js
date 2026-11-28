// ══════════════════════════════════════════════════════════════════════════
//  tactics_lore — what an Allied village teaches (docs/TACTICS.md §6, stage
//  G). This is the perk that replaces the two card lessons a week an Allied
//  village used to give.
//
//  Each kind of village folk has one ability of its own, on no class ladder:
//  village lore. A village at Allied trust will teach it to one of the
//  town's citizens for a fee, once a week. The citizen has it for life, at
//  full strength, whatever class they are; a citizen carries one piece of
//  village lore at a time (being taught another replaces it).
//
//    Mice      Rally        a friend's next attack lands harder (quick)
//    Badgers   Bulwark      block for everyone near
//    Squirrels Quick Jab    a light hit that does not end the turn
//    Otters    Riptide      a blow that knocks a foe back and slows it
//    Weasels   Smoke Bomb   block for everyone near
//
//    view(npc, rel)                       for the village's window
//    teach(userId, npcId, citizenId)      pay and learn → { citizen, ability, replaced, wealth }
//    forCitizens(ids)                     Map id → { key, from }
//    kitOf(key)                           the ability's facts on the board
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const CC = require('./class_abilities');

const err = (status, msg) => Object.assign(new Error(msg), { status });
const ALLIED_TRUST = 71;
const FEE = 200;            // wealth
const EVERY_DAYS = 7;       // a village teaches one citizen of a town this often

const LORE = {
  mice:     { key: 'c_rally',      kit: { icon: '📣', min: 1, max: 3, quick: true, cooldown: 2 }, says: 'A word at the right moment: a friend\'s next attack lands harder. Does not end the turn.' },
  badger:   { key: 'g_bulwark',    kit: { icon: '🦡', shape: 'around', radius: 2, cooldown: 3 }, says: 'Close ranks: block for yourself and everyone within two tiles.' },
  squirrel: { key: 'c_quick_jab',  kit: { icon: '🐿️', min: 1, max: 1, quick: true, cooldown: 1 }, says: 'A light, quick hit that does not end the turn.' },
  otter:    { key: 'l_riptide',    kit: { icon: '🌊', min: 1, max: 3, cooldown: 2 }, says: 'A blow like a river in spate: it knocks a foe back a tile and slows it.' },
  weasel:   { key: 'c_smoke_bomb', kit: { icon: '💨', shape: 'around', radius: 2, cooldown: 3 }, says: 'A burst of smoke: a little block for yourself and everyone within two tiles.' },
};
for (const k of Object.keys(LORE)) LORE[k].kit.key = LORE[k].key;
const ofSpecies = species => LORE[String(species || '').toLowerCase()] || LORE.mice;
const kitOf = key => { const l = Object.values(LORE).find(x => x.key === key); return l ? { ...l.kit, school: 'lore' } : null; };
const brief = l => ({ key: l.key, name: CC.ability(l.key).name, icon: l.kit.icon, says: l.says });

// For the village's window: is it Allied, what it teaches, what it costs, and when it will teach again.
function view(npc, rel) {
  const allied = !!rel && rel.trust >= ALLIED_TRUST;
  const next = rel && rel.taught_at ? new Date(new Date(rel.taught_at).getTime() + EVERY_DAYS * 86400e3) : null;
  return { allied, ability: brief(ofSpecies(npc.species)), fee: FEE, every_days: EVERY_DAYS, needs_trust: ALLIED_TRUST,
    available: allied && !(next && next > new Date()), next_at: next && next > new Date() ? next.toISOString() : null };
}

async function teach(userId, npcId, citizenId) {
  const cid = Math.floor(Number(citizenId));
  const out = await withTransaction(async client => {
    const s = (await client.query('SELECT id, wealth FROM settlements WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    if (!s) throw err(404, 'No settlement.');
    const npc = (await client.query('SELECT * FROM npc_settlements WHERE id=$1', [npcId])).rows[0];
    if (!npc) throw err(404, 'No such village.');
    const rel = (await client.query('SELECT trust, taught_at FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2 FOR UPDATE', [s.id, npc.id])).rows[0];
    const v = view(npc, rel);
    if (!v.allied) throw err(400, `Only an Allied village (trust ${ALLIED_TRUST}+) teaches its lore.`);
    if (!v.available) throw err(400, `${npc.name} has taught one of yours this week. They will teach again later.`);
    const c = cid > 0 && (await client.query(`SELECT id, name, COALESCE(life_stage, 'adult') AS life_stage, lore, lore_from FROM citizens WHERE id=$1 AND settlement_id=$2 FOR UPDATE`, [cid, s.id])).rows[0];
    if (!c || c.life_stage === 'deceased') throw err(404, 'No such citizen.');
    if (c.life_stage === 'child') throw err(400, `${c.name} is too young.`);
    if ((await require('./dungeons').busyCitizenIds([c.id], client)).length) throw err(400, `${c.name} is away at a dungeon.`);
    const l = ofSpecies(npc.species);
    if (c.lore === l.key) throw err(400, `${c.name} already knows ${CC.ability(l.key).name}.`);
    if (Number(s.wealth) < FEE) throw err(400, `The lesson costs ${FEE} wealth.`);
    const w = (await client.query('UPDATE settlements SET wealth = wealth - $2 WHERE id=$1 RETURNING wealth', [s.id, FEE])).rows[0].wealth;
    await client.query('UPDATE citizens SET lore=$2, lore_from=$3 WHERE id=$1', [c.id, l.key, npc.name]);
    await client.query('UPDATE diplomacy_relations SET taught_at = NOW(), last_interaction = NOW() WHERE settlement_id=$1 AND npc_id=$2', [s.id, npc.id]);
    const replaced = c.lore && kitOf(c.lore) ? CC.ability(c.lore).name : null;
    const message = `🏡 ${c.name} was taught ${CC.ability(l.key).name} at ${npc.name}${replaced ? `, in place of ${replaced}` : ''}.`;
    await client.query(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,'study',$2,$3)`, [s.id, message, JSON.stringify([c.id])]).catch(() => {});
    return { citizen: { id: c.id, name: c.name }, ability: brief(l), replaced, wealth: Number(w), message, npc, rel: { ...rel, taught_at: new Date() } };
  });
  return { citizen: out.citizen, ability: out.ability, replaced: out.replaced, wealth: out.wealth, message: out.message, teaching: view(out.npc, out.rel) };
}

async function forCitizens(ids) {
  const out = new Map();
  if (!ids || !ids.length) return out;
  const rows = (await query('SELECT id, lore, lore_from FROM citizens WHERE id = ANY($1::int[]) AND lore IS NOT NULL', [ids]).catch(() => ({ rows: [] }))).rows;
  for (const r of rows) if (kitOf(r.lore)) out.set(r.id, { key: r.lore, from: r.lore_from || null });
  return out;
}

module.exports = { LORE, FEE, EVERY_DAYS, ALLIED_TRUST, ofSpecies, kitOf, view, teach, forCitizens };
