// ══════════════════════════════════════════════════════════════════════════
//  dungeon_map — dungeons on the world map (docs/DUNGEONS.md §6; build step 4).
//
//  A map dungeon is a generated dungeon (lib/dungeon_gen.js) that sits on a
//  tile for LIFE_H hours and then goes; another appears somewhere else. Its
//  land is the tile's, so its foes are that land's. Every town sees the same
//  dungeon, and has one attempt at it (lib/dungeons.js start).
//
//    spawn()                 top the world up: every town has PER_TOWN live
//                            dungeons within REACH tiles, one of them green
//                            or yellow, on free tiles (no town, village,
//                            outpost, camp or other dungeon)
//    tell()                  word of each dungeon reaches every town within
//                            REACH of it: the tile is lit on that town's
//                            map, and the town's news says so, once
//    listFor(userId)         the live dungeons this player has found, with
//                            how far, whether in reach, and how their town
//                            fared there
//    card(userId, id)        one of them, in full
//    enter(userId, id, ids)  send four citizens in (the party starts at the
//                            door: the walk there is not played yet)
//    tick()                  every TICK_MIN minutes, from the quest worker
//    tileMap(userId)         "q,r" → the card of the dungeon on that tile,
//                            for the map and the tile's panel
//
//  A town knows of a dungeon once its tile is lit on that town's map
//  (fog_of_war): tell() lights it for every town near enough to walk there,
//  and a town further off finds it by scouting, as it finds a camp. A run
//  still under way when its dungeon goes has GRACE_H hours to finish
//  (lib/dungeons.js sweep).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const DEFS = require('./dungeon_defs');
const F = require('./tactics_foes');

const LIFE_H = 72;         // how long a dungeon stays
const STAGGER_H = 8;       // …give or take, so the whole map never changes at once
const GRACE_H = 2;         // a run inside when it goes has this long to finish
const REACH = 8;           // how far from the town a party will walk (as a camp assault: lib/raid_camps.js)
const NEAR = [2, 6];       // a new dungeon is put this many tiles from the town it is for
const PER_TOWN = 2;        // live dungeons each town should have in reach
const TICK_MIN = 30;
// How often each skull turns up once a town has an easy one in reach.
const WEIGHTS = { green: 30, yellow: 26, orange: 20, red: 14, purple: 10 };
const EASY = ['green', 'yellow'];
const err = (status, msg) => Object.assign(new Error(msg), { status });
const dist = (a, b) => require('../mapgen').hexDistanceWrapped(a.q, a.r, b.q, b.r);
const LANDS = () => require('./dungeon_gen').LANDS;

const live = async (q = query) => (await q(`SELECT * FROM dungeons WHERE source='map' AND q IS NOT NULL AND expires_at > NOW() ORDER BY id`).catch(() => ({ rows: [] }))).rows;

function pickTier(rng, mustBeEasy) {
  const keys = mustBeEasy ? EASY : Object.keys(WEIGHTS);
  let roll = rng() * keys.reduce((n, k) => n + WEIGHTS[k], 0);
  for (const k of keys) { roll -= WEIGHTS[k]; if (roll <= 0) return k; }
  return keys[keys.length - 1];
}
// Tiles min..max away from a town (axial), wrapped to the world.
function ring(t, min, max, W, H) {
  const out = [];
  for (let dq = -max; dq <= max; dq++) for (let dr = -max; dr <= max; dr++) {
    const d = (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    if (d < min || d > max) continue;
    out.push({ q: (((t.q + dq) % W) + W) % W, r: (((t.r + dr) % H) + H) % H });
  }
  return out;
}

async function worldSize() {
  try { const m = (await query('SELECT map_w, map_h FROM world_meta WHERE id=1')).rows[0]; if (m) return [m.map_w, m.map_h]; } catch (e) { /* defaults */ }
  return [40, 40];
}
// Towns that stand on the map (a town not yet placed, or parked off it, has no dungeons).
const townsOnMap = async (W, H) => (await query(
  `SELECT id, user_id, tile_q AS q, tile_r AS r FROM settlements WHERE tile_q IS NOT NULL AND tile_r IS NOT NULL AND tile_q >= 0 AND tile_r >= 0 AND tile_q < $1 AND tile_r < $2 ORDER BY id`, [W, H])).rows;

// Top the world up. → how many were made.
async function spawn(rng = Math.random) {
  const [W, H] = await worldSize();
  const towns = await townsOnMap(W, H);
  if (!towns.length) return 0;
  const D = require('./dungeons');
  let have = await live(), made = 0;
  for (const t of towns) {
    const near = have.filter(d => dist(t, d) <= REACH);
    for (let i = near.length; i < PER_TOWN; i++) {
      const tier = pickTier(rng, !near.some(d => EASY.includes(d.tier)));
      // A free tile a short walk away, on land that can hold a dungeon.
      const spots = ring(t, NEAR[0], NEAR[1], W, H);
      for (let k = spots.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [spots[k], spots[j]] = [spots[j], spots[k]]; }
      let put = null;
      for (const s of spots.slice(0, 40)) {
        const tile = (await query('SELECT terrain FROM tiles WHERE q=$1 AND r=$2', [s.q, s.r])).rows[0];
        if (!tile || !LANDS().includes(tile.terrain)) continue;
        const busy = (await query(
          `SELECT 1 FROM settlements WHERE tile_q=$1 AND tile_r=$2 UNION SELECT 1 FROM npc_settlements WHERE tile_q=$1 AND tile_r=$2
           UNION SELECT 1 FROM outposts WHERE tile_q=$1 AND tile_r=$2 UNION SELECT 1 FROM withered_camps WHERE q=$1 AND r=$2 AND cleared_at IS NULL
           UNION SELECT 1 FROM dungeons WHERE source='map' AND q=$1 AND r=$2 AND expires_at > NOW()`, [s.q, s.r]).catch(() => ({ rows: [{}] }))).rows.length;
        if (busy) continue;
        const hours = LIFE_H - STAGGER_H / 2 + rng() * STAGGER_H;
        // No two dungeons a town can see share a name, where the land has names enough.
        const taken = have.filter(d => dist(s, d) <= REACH * 2).map(d => (d.layout || {}).name);
        put = await D.createGenerated({ tier, terrain: tile.terrain, source: 'map', q: s.q, r: s.r, expiresAt: new Date(Date.now() + hours * 3600e3), avoidNames: taken });
        break;
      }
      if (!put) break;      // nowhere to put one near this town
      have.push(put); near.push(put); made++;
    }
  }
  return made;
}

// Word of each live dungeon reaches every town near enough to walk there:
// its tile is lit on that town's map, and the town's news says so. Once for
// each town and dungeon (dungeon_sightings). → how many towns were told.
async function tell() {
  const list = await live();
  if (!list.length) return 0;
  const towns = await townsOnMap(...(await worldSize()));
  let told = 0;
  for (const d of list) {
    const near = towns.filter(t => dist(t, d) <= REACH);
    if (!near.length) continue;
    const fresh = new Set((await query(
      `INSERT INTO dungeon_sightings (dungeon_id, settlement_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING RETURNING settlement_id`, [d.id, near.map(t => t.id)])).rows.map(r => r.settlement_id));
    const who = near.filter(t => fresh.has(t.id));
    if (!who.length) continue;
    await query(`INSERT INTO fog_of_war (user_id, tile_q, tile_r) SELECT u, $2, $3 FROM unnest($1::int[]) AS u ON CONFLICT DO NOTHING`, [who.map(t => t.user_id), d.q, d.r]);
    const b = brief(d, null, null, null);
    const message = `💀 Word has reached the town of a dungeon nearby: ${b.name} (${b.skull} ${b.tier_name}). It will be gone in ${Math.max(1, Math.round(b.hours_left / 24))} day${Math.round(b.hours_left / 24) > 1 ? 's' : ''}.`;
    await query(`INSERT INTO settlement_events (settlement_id, type, message) SELECT s, 'dungeon', $2 FROM unnest($1::int[]) AS s`, [who.map(t => t.id), message]).catch(() => {});
    for (const t of who) { try { require('./event_bus').publish(t.id, { type: 'dungeon_found', dungeon_id: d.id, q: d.q, r: d.r, message }); } catch (e) { /* offline */ } }
    told += who.length;
  }
  return told;
}

// How this town fared in each dungeon it has been to: dungeon id → the run's status.
async function resultsFor(sid, ids) {
  if (!sid || !ids.length) return {};
  const rows = (await query('SELECT dungeon_id, status, id FROM dungeon_runs WHERE settlement_id=$1 AND dungeon_id = ANY($2::int[])', [sid, ids])).rows;
  return Object.fromEntries(rows.map(r => [r.dungeon_id, { status: r.status, run_id: r.id }]));
}
// Who has cleared each dungeon, the first first: dungeon id → { n, first }.
async function clearsOf(ids) {
  if (!ids.length) return {};
  const rows = (await query(
    `SELECT r.dungeon_id, s.name, r.ended_at FROM dungeon_runs r JOIN settlements s ON s.id = r.settlement_id
      WHERE r.dungeon_id = ANY($1::int[]) AND r.status = 'cleared' ORDER BY r.ended_at`, [ids])).rows;
  const out = {};
  for (const r of rows) { const o = out[r.dungeon_id] || (out[r.dungeon_id] = { n: 0, first: r.name }); o.n++; }
  return out;
}
// A dungeon as its card shows it. `mine`: this town's result there, if it has been.
function brief(d, town, mine, clears) {
  const story = d.layout || {}, t = DEFS.tier(d.tier), band = F.BANDS[(F.castFor(d.terrain, d.seed) || {}).band] || null;
  const away = town && town.q != null ? dist(town, d) : null;
  return {
    id: d.id, q: d.q, r: d.r, name: story.name || 'A dungeon', tier: t.key, tier_name: t.name, skull: t.skull, terrain: d.terrain,
    floors: (story.floors || []).length || 1, intro: story.intro || '', boss: story.boss || '', suggested_party: t.party,
    band: band ? band.name : null,
    expires_at: d.expires_at, hours_left: Math.max(0, Math.round((new Date(d.expires_at) - Date.now()) / 360000) / 10),
    distance: away, in_reach: away != null && away <= REACH,
    // How long the walk there is, one way (lib/dungeons.js walkSecs).
    walk_secs: away != null && away <= REACH ? Math.round(away * Math.max(0, require('./dungeons').CONFIG.WALK_SECS)) : null,
    // 'travelling' on the road there, 'active' inside, 'recalled' walking back without going in; any other status: it has had its one attempt.
    mine: mine ? mine.status : null,
    cleared_by: clears ? clears.n : 0, first_clear: clears ? clears.first : null,
    // What the first town to clear it wins (lib/dungeon_trophies.js); gone once someone has.
    prize: clears && clears.n ? null : (p => p && { title: p.title, icon: p.icon, wealth: p.wealth, from: p.from })(require('./dungeon_trophies').prize(d)),
  };
}
async function townOf(userId) { return (await query('SELECT id, tile_q AS q, tile_r AS r FROM settlements WHERE user_id=$1', [userId])).rows[0] || null; }
async function found(userId) {
  const seen = new Set((await query('SELECT tile_q, tile_r FROM fog_of_war WHERE user_id=$1', [userId])).rows.map(t => `${t.tile_q},${t.tile_r}`));
  return (await live()).filter(d => seen.has(`${d.q},${d.r}`));
}

async function listFor(userId) {
  const town = await townOf(userId);
  if (!town) throw err(404, 'No settlement.');
  const list = await found(userId), ids = list.map(d => d.id);
  const mine = await resultsFor(town.id, ids), clears = await clearsOf(ids);
  const dungeons = list.map(d => brief(d, town, mine[d.id], clears[d.id])).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
  const run = (await query(`SELECT dungeon_id FROM dungeon_runs WHERE settlement_id=$1 AND status IN ('travelling','active')`, [town.id])).rows[0];
  return { dungeons, in_dungeon: run ? run.dungeon_id : null, rules: { reach: REACH, party: require('./dungeons').PARTY, hours: LIFE_H }, hall: await require('./dungeon_trophies').hall(town.id) };
}
async function card(userId, id) {
  const town = await townOf(userId);
  if (!town) throw err(404, 'No settlement.');
  const d = (await found(userId)).find(x => x.id === Math.floor(Number(id)));
  if (!d) throw err(404, 'That dungeon is gone, or you have not found it.');
  const mine = await resultsFor(town.id, [d.id]), clears = await clearsOf([d.id]);
  return { dungeon: brief(d, town, mine[d.id], clears[d.id]) };
}
// Four citizens walk in. The run begins at the door (lib/dungeons.js start checks the party and the one attempt).
async function enter(userId, id, citizenIds) {
  const town = await townOf(userId);
  if (!town) throw err(404, 'No settlement.');
  const d = (await live()).find(x => x.id === Math.floor(Number(id)));
  if (!d) throw err(404, 'That dungeon is gone.');
  if (!(await query('SELECT 1 FROM fog_of_war WHERE user_id=$1 AND tile_q=$2 AND tile_r=$3', [userId, d.q, d.r])).rows.length) throw err(400, 'Scout that land first.');
  if (town.q == null || dist(town, d) > REACH) throw err(400, `That dungeon is too far away (within ${REACH} tiles of your town).`);
  return require('./dungeons').start(userId, d.id, citizenIds);
}

// What the map draws and the tile's panel shows: "q,r" → the dungeon's card (as listFor gives it), for the dungeons this player has found.
async function tileMap(userId) {
  const town = await townOf(userId);
  const list = await found(userId), ids = list.map(d => d.id);
  const mine = town ? await resultsFor(town.id, ids) : {}, clears = await clearsOf(ids);
  // `busy`: this town's party is in some other dungeon, so it cannot send one here.
  const run = town ? (await query(`SELECT dungeon_id FROM dungeon_runs WHERE settlement_id=$1 AND status IN ('travelling','active')`, [town.id])).rows[0] : null;
  const out = {};
  for (const d of list) out[`${d.q},${d.r}`] = { ...brief(d, town, mine[d.id], clears[d.id]), busy: !!run && run.dungeon_id !== d.id };
  return out;
}

// Dev Tools: every map dungeon goes now (a run inside keeps its grace).
const expireAll = async () => (await query(`UPDATE dungeons SET expires_at = NOW() - interval '1 second' WHERE source='map' AND expires_at > NOW()`)).rowCount;

let _last = 0;
async function tick() {
  if (Date.now() - _last < TICK_MIN * 60 * 1000) return;
  _last = Date.now();
  try { await spawn(); await tell(); } catch (e) { console.error('[dungeon_map]', e.message); }
}

module.exports = { LIFE_H, GRACE_H, REACH, PER_TOWN, WEIGHTS, spawn, tell, live, listFor, card, enter, tileMap, expireAll, tick, _pickTier: pickTier, _ring: ring };
