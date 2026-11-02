// ══════════════════════════════════════════════════════════════════════════
//  defences — what stands between the Withered and your stores.
//
//  Town     Walls (building, WALLS_PER_LEVEL each level, +research
//           walls_defence) and the Watchtower's watch (lib/watchtower).
//  Outpost  its fort (outposts.fort_level 0–3: FORT[level].defence, garrison
//           slots) and the Guards/Archers garrisoned there
//           (outpost_crew post='garrison': GARRISON_BASE + class level each).
//  Research Palisades / Stone Forts / Bastions allow fort levels 1/2/3 and
//           Walls (levels 3+ need Stone Forts); Drill Yards +25% garrison and
//           watch; Bastions +30% Walls (lib/research_defs, Building slot 1).
//  Clan     a member's spot on their clan's land gets CLAN_SHARE of the own
//           defence of every other member's spot on that land within
//           CLAN_SHARE_RANGE tiles, at most its own again. Non-members on
//           clan land get nothing from the clan.
//
//  ownDefence(...) → { kind: 'town'|'outpost', walls, watch, fort, garrison,
//                      own, posted: [citizens at the spot] }
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const WALLS_PER_LEVEL = 15;
const GARRISON_BASE = 8;
const CLAN_SHARE = 0.5;
const CLAN_SHARE_RANGE = 3;
const FORT = {
  1: { name: 'Palisade',    icon: '🪵', defence: 10, slots: 1, cost: { timber: 150, stone: 100, wealth: 40 } },
  2: { name: 'Stockade',    icon: '🏯', defence: 25, slots: 2, cost: { timber: 250, stone: 300, wealth: 80 } },
  3: { name: 'Stone Tower', icon: '🏰', defence: 45, slots: 3, cost: { stone: 500, wealth: 150, bronze: 20 } },
};
const GARRISON_ROLES = ['soldier', 'archer'];

const run = db => (db ? (t, p) => db.query(t, p) : query);
async function researchFx(sid, db) {
  try {
    const done = await require('./research').doneSet(db || null, sid);
    return require('./research_defs').effectsOf(done);
  } catch (e) { return {}; }
}
// How high a fort the town's research allows (0–3).
const fortAllowed = fx => Math.min(3, Math.max(0, Math.floor(fx.fort_level || 0)));

// Crew at one outpost: [{ id, name, role, post, class_level }].
async function crewOf(outpostId, db) {
  return (await run(db)(
    `SELECT c.id, c.name, c.role, oc.post, COALESCE(cc.level, 1) AS class_level
       FROM outpost_crew oc JOIN citizens c ON c.id = oc.citizen_id
       LEFT JOIN citizen_classes cc ON cc.citizen_id = c.id AND cc.class_key = c.role
      WHERE oc.outpost_id = $1 AND COALESCE(c.life_stage, 'adult') = 'adult' ORDER BY oc.post, c.id`, [outpostId])
    .catch(() => ({ rows: [] }))).rows.map(r => ({ ...r, class_level: Number(r.class_level) || 1 }));
}

async function outpostDefence(s, o, db, fx) {
  fx = fx || await researchFx(s.id, db);
  const lvl = Math.min(3, Math.max(0, Number(o.fort_level) || 0));   // research gates building it, not keeping it
  const fort = FORT[lvl] ? FORT[lvl].defence : 0;
  const crew = await crewOf(o.id, db);
  const garrisonCrew = crew.filter(c => c.post === 'garrison');
  const garrison = Math.round(garrisonCrew.reduce((t, c) => t + GARRISON_BASE + c.class_level, 0) * (1 + (fx.garrison_defence || 0)));
  return { kind: 'outpost', outpost_id: o.id, fort_level: lvl, fort, garrison, walls: 0, watch: 0, own: fort + garrison, posted: crew };
}

async function townDefence(s, db, fx) {
  fx = fx || await researchFx(s.id, db);
  const w = (await run(db)("SELECT level FROM buildings WHERE settlement_id=$1 AND type='walls'", [s.id])).rows[0];
  const wallsLevel = w ? Number(w.level) || 0 : 0;
  const walls = Math.round(wallsLevel * WALLS_PER_LEVEL * (1 + (fx.walls_defence || 0)));
  const wt = await require('./watchtower').state(db ? { query: run(db) } : null, s.id);
  // The tower itself (level × 10) plus the watch, the watch scaled by Drill Yards.
  const tower = wt.level * wt.def_per_level;
  const watch = Math.round(tower + (wt.defence - tower) * (1 + (fx.garrison_defence || 0)));
  return { kind: 'town', walls_level: wallsLevel, walls, watch, fort: 0, garrison: 0, own: walls + watch,
    posted: wt.posted.map(c => ({ ...c, post: 'watch' })) };
}

// The spot at (q, r) for settlement s: its outpost row, or null for the town.
async function spotAt(s, q, r, db) {
  if (q == null || (q === s.tile_q && r === s.tile_r)) return null;
  return (await run(db)('SELECT * FROM outposts WHERE settlement_id=$1 AND tile_q=$2 AND tile_r=$3', [s.id, q, r]).catch(() => ({ rows: [] }))).rows[0] || null;
}

async function ownDefence(s, target, db) {
  const fx = await researchFx(s.id, db);
  const o = target && target.outpost ? target.outpost : target ? await spotAt(s, target.q, target.r, db) : null;
  return o ? outpostDefence(s, o, db, fx) : townDefence(s, db, fx);
}

// The clan's share for a spot of s at (q, r): 0 unless s's owner is a
// member and the tile is their clan's land.
async function clanShare(s, q, r, ownValue, db) {
  const R = run(db);
  const m = (await R('SELECT clan_id FROM clan_members WHERE user_id=$1', [s.user_id]).catch(() => ({ rows: [] }))).rows[0];
  if (!m || q == null) return { value: 0, from: [] };
  const onLand = (await R('SELECT 1 FROM clan_territory WHERE clan_id=$1 AND q=$2 AND r=$3', [m.clan_id, q, r]).catch(() => ({ rows: [] }))).rows.length;
  if (!onLand) return { value: 0, from: [] };
  const dist = (a, b) => require('../mapgen').hexDistanceWrapped(a.q, a.r, b.q, b.r);
  // Other members' outposts and towns on this clan's land, within range.
  const spots = (await R(
    `SELECT 'outpost' AS kind, o.id, o.tile_q AS q, o.tile_r AS r, s2.id AS sid, s2.name AS town
       FROM outposts o JOIN settlements s2 ON s2.id = o.settlement_id
       JOIN clan_members cm ON cm.user_id = s2.user_id AND cm.clan_id = $1
       JOIN clan_territory t ON t.clan_id = $1 AND t.q = o.tile_q AND t.r = o.tile_r
      WHERE s2.id <> $2
     UNION ALL
     SELECT 'town', NULL, s2.tile_q, s2.tile_r, s2.id, s2.name
       FROM settlements s2 JOIN clan_members cm ON cm.user_id = s2.user_id AND cm.clan_id = $1
       JOIN clan_territory t ON t.clan_id = $1 AND t.q = s2.tile_q AND t.r = s2.tile_r
      WHERE s2.id <> $2`, [m.clan_id, s.id]).catch(() => ({ rows: [] }))).rows
    .filter(x => dist(x, { q, r }) <= CLAN_SHARE_RANGE);
  let total = 0; const from = [];
  for (const x of spots) {
    const s2 = (await R('SELECT * FROM settlements WHERE id=$1', [x.sid])).rows[0];
    const d = x.kind === 'outpost' ? await outpostDefence(s2, { id: x.id, fort_level: (await R('SELECT fort_level FROM outposts WHERE id=$1', [x.id])).rows[0].fort_level }, db)
                                   : await townDefence(s2, db);
    if (d.own > 0) { total += d.own * CLAN_SHARE; from.push(x.town); }
  }
  return { value: Math.round(Math.min(total, Math.max(0, ownValue))), from: [...new Set(from)] };
}

module.exports = {
  ownDefence, outpostDefence, townDefence, clanShare, crewOf, researchFx, fortAllowed, spotAt,
  FORT, WALLS_PER_LEVEL, GARRISON_BASE, GARRISON_ROLES, CLAN_SHARE, CLAN_SHARE_RANGE,
};
