// ══════════════════════════════════════════════════════════════════════════
//  dungeon_trophies — what the first town to clear a map dungeon wins
//  (docs/DUNGEONS.md §14; decided by the owner 2026-11-26).
//
//  A dungeon on the map is every nearby town's, and each has one go at it.
//  The first to clear it takes a trophy from its boss home, and a little
//  wealth. The trophy is not an item: it hangs in the town's trophy hall and
//  cannot be sold, traded or lost. There is one for each boss, on a mount
//  that says which skull it was won at, so the full hall is
//  (bosses × skulls) trophies. A town can win the same one twice; the hall
//  counts them.
//
//  Later clears win the dungeon's ordinary loot, as before: the trophy is for
//  the race, not the reward for going in at all.
//
//    prize(dungeon)        what the first clear of this dungeon would win
//    award(client|null, …) record it for a town (one per dungeon: the unique
//                          index decides a tie) → the trophy, or null
//    hall(settlementId)    the town's trophies, grouped, and how many of the
//                          full hall it has
//
//  ("Keepsake" is a different thing in DUNGEONS.md §5.2a: something found on
//  a run that changes how its fights start. Not built.)
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const F = require('./tactics_foes');
const DEFS = require('./dungeon_defs');

// One for each boss of the board (lib/tactics_foes.js: one boss a land).
const TROPHIES = {
  redtooth:        { name: 'Redtooth\'s Crown',          icon: '👑', words: 'A dented brass crown the Brigand King cut for himself.' },
  greyfeather:     { name: 'Greyfeather\'s Pinion',      icon: '🪶', words: 'One grey flight feather, as long as a mouse is tall.' },
  grum:            { name: 'Grum\'s Tusk',               icon: '🦷', words: 'The Ogre Chief\'s left tusk, notched once for every town he burned.' },
  storm_matriarch: { name: 'The Matriarch\'s Talon',     icon: '🦅', words: 'A black talon that still hums before a storm.' },
  old_snapjaw:     { name: 'Snapjaw\'s Shell-plate',     icon: '🐢', words: 'A plate of old shell, scored by a hundred years of river stones.' },
  bog_mother:      { name: 'The Bog Mother\'s Lantern',  icon: '🏮', words: 'The pale light she led travellers astray with. It has not gone out.' },
  hollow_king:     { name: 'The Hollow King\'s Circlet', icon: '💍', words: 'A thin iron circlet, cold to hold, from a king with nothing under it.' },
};
// The mount says which skull it was won at, and how much wealth came with it.
const MOUNTS = {
  green:  { mount: 'oak',    wealth: 40 },
  yellow: { mount: 'copper', wealth: 70 },
  orange: { mount: 'bronze', wealth: 110 },
  red:    { mount: 'silver', wealth: 160 },
  purple: { mount: 'gold',   wealth: 240 },
};
const KINDS = Object.keys(TROPHIES).length * Object.keys(MOUNTS).length;

// The boss of a dungeon: the foe of rank boss in its last floor's boss room.
function bossOf(layout) {
  const floors = (layout && layout.floors) || [], last = floors[floors.length - 1];
  const room = last && (last.rooms || []).find(r => r.type === 'boss');
  return ((room && room.enemies) || []).find(k => F.FOES[k] && F.FOES[k].rank === 'boss') || null;
}
// A trophy as it is shown: "Greyfeather's Pinion, on silver".
function describe(foeKey, tier) {
  const t = TROPHIES[foeKey], m = MOUNTS[tier];
  if (!t || !m) return null;
  const skull = DEFS.TIERS[tier];
  return { foe: foeKey, tier, name: t.name, mount: m.mount, title: `${t.name}, on ${m.mount}`, icon: t.icon, words: t.words, wealth: m.wealth, skull: skull.skull, tier_name: skull.name, from: F.FOES[foeKey].name };
}
// What the first clear of this dungeon (a row of `dungeons`) would win; null for a dungeon with no boss of the board.
const prize = d => (d && d.source === 'map' ? describe(bossOf(d.layout), d.tier) : null);

// Record the first clear. `q`: a client's query, or the pool's. One trophy a
// dungeon (the unique index): a town that clears it second gets null.
async function award(q, { dungeon, settlementId, runId, party = [] }) {
  const p = prize(dungeon);
  if (!p) return null;
  const row = (await q(
    `INSERT INTO dungeon_trophies (dungeon_id, settlement_id, run_id, foe_key, tier, dungeon_name, terrain, party, wealth)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (dungeon_id) DO NOTHING RETURNING id, won_at`,
    [dungeon.id, settlementId, runId, p.foe, p.tier, (dungeon.layout || {}).name || 'A dungeon', dungeon.terrain || null, JSON.stringify(party), p.wealth])).rows[0];
  if (!row) return null;
  await q('UPDATE settlements SET wealth = wealth + $2 WHERE id=$1', [settlementId, p.wealth]);
  return { ...p, id: row.id, won_at: row.won_at, dungeon: (dungeon.layout || {}).name || 'A dungeon' };
}

// The town's hall: each kind it has (newest first) with how many, and the count against the full hall.
async function hall(settlementId) {
  const rows = (await query('SELECT foe_key, tier, dungeon_name, party, won_at FROM dungeon_trophies WHERE settlement_id=$1 ORDER BY won_at DESC, id DESC', [settlementId]).catch(() => ({ rows: [] }))).rows;
  const kinds = new Map();
  for (const r of rows) {
    const key = `${r.foe_key}:${r.tier}`, p = describe(r.foe_key, r.tier);
    if (!p) continue;
    if (!kinds.has(key)) kinds.set(key, { ...p, count: 0, last: { dungeon: r.dungeon_name, party: r.party || [], won_at: r.won_at } });
    kinds.get(key).count++;
  }
  return { trophies: [...kinds.values()], total: rows.length, have: kinds.size, kinds: KINDS };
}
// How many trophies each of these towns has: settlement id → n.
async function counts(ids) {
  if (!ids || !ids.length) return {};
  const rows = (await query('SELECT settlement_id, COUNT(*)::int AS n FROM dungeon_trophies WHERE settlement_id = ANY($1::int[]) GROUP BY 1', [ids]).catch(() => ({ rows: [] }))).rows;
  return Object.fromEntries(rows.map(r => [r.settlement_id, r.n]));
}

module.exports = { TROPHIES, MOUNTS, KINDS, bossOf, describe, prize, award, hall, counts };
