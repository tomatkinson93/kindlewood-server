// ══════════════════════════════════════════════════════════════════════════
//  raid_camps — sallying out against a raid, and Withered camps.
//
//  Sally   The town whose spot is targeted sends 1–3 citizens to meet the
//          raiders before they strike: a card battle (a settlement_quests
//          run, quest 'raid_sally', played through /api/combat like any quest
//          battle). Win → the raid is broken: nothing lost, bonus wealth (and
//          the usual battle spoils). Lose → the raiders arrive SALLY_ANGER
//          stronger. One sally per raid.
//  Camps   Up to CAMPS_PER_VILLAGE camps within CAMP_RANGE tiles of each
//          Withered village (tick); a cleared camp comes back after
//          RESPAWN_H. Raids set out from the nearest camp (lib/raids). A party
//          of 1–4 can assault a camp you've discovered within ASSAULT_RANGE of
//          your town (quest 'camp_assault'); winning clears it and gives every
//          town within PEACE_RANGE tiles PEACE_H hours of peace.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');

const SALLY_ANGER = 1.25;
const CAMPS_PER_VILLAGE = 2;
const CAMP_RANGE = 3;
const RESPAWN_H = 24;
const ASSAULT_RANGE = 8;
const PEACE_RANGE = 6;
const PEACE_H = 72;
const BATTLE_MIN = 10;   // the run's nominal length (its clock is paused while the battle waits)
const err = (status, msg) => Object.assign(new Error(msg), { status });
const dist = (a, b) => require('../mapgen').hexDistanceWrapped(a.q, a.r, b.q, b.r);

// Withered warbands sized to a strength (1–4 creatures).
function enemiesFor(strength, seed) {
  const pool = ['withered_husk', 'rot_shaman', 'withered_husk', 'bog_lurker', 'withered_husk', 'night_wolf'];
  const n = Math.max(1, Math.min(4, Math.round(strength / 35)));
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(seed + i * 7) % pool.length]);
  return out;
}

// A pending card battle for `citizenIds` against `encounter` (the same row
// shape processCombatTriggers leaves for a manual battle).
async function battleRun(client, s, userId, questId, citizenIds, encounter) {
  const seed = Math.floor(Math.random() * 0x7fffffff) + 1;
  let mods = null;
  try {
    const CR = require('./combat_resolver');
    mods = CR.withParty(CR.combatModsOf({}), await require('./careers').combatDeltas(s.id, citizenIds).catch(() => ({})));
  } catch (e) { /* no careers */ }
  return (await client.query(
    `INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, party_ids, quest_type, completes_at, status,
                                    combat_status, combat_trigger_at, combat_seed, combat_encounter, combat_clock_paused_at, combat_mods, auto_resolve_combat)
     VALUES ($1,$2,$3,$4,$5,'party', NOW() + make_interval(mins => $6), 'active', 'pending', NOW(), $7, $8, NOW(), $9, FALSE) RETURNING *`,
    [s.id, userId, questId, citizenIds[0], JSON.stringify(citizenIds), BATTLE_MIN, seed, JSON.stringify(encounter), mods ? JSON.stringify(mods) : null])).rows[0];
}

async function checkParty(client, s, citizenIds, max) {
  const ids = [...new Set((citizenIds || []).map(Number).filter(Number.isFinite))];
  if (!ids.length || ids.length > max) throw err(400, `Send 1 to ${max} citizens.`);
  for (const id of ids) {
    const c = (await client.query('SELECT id, name, settlement_id, life_stage, role FROM citizens WHERE id=$1', [id])).rows[0];
    const why = await require('./outpost_state').busyReason(c, s.id);
    if (why) throw err(400, why);
  }
  return ids;
}

// ── Sally out ──────────────────────────────────────────────────────────────
async function startSally(userId, raidId, citizenIds) {
  const out = await withTransaction(async client => {
    const s = (await client.query('SELECT * FROM settlements WHERE user_id=$1', [userId])).rows[0];
    if (!s) throw err(404, 'No settlement.');
    const raid = (await client.query('SELECT * FROM settlement_raids WHERE id=$1 AND settlement_id=$2 AND resolved_at IS NULL FOR UPDATE', [raidId, s.id])).rows[0];
    if (!raid) throw err(404, 'No raid on its way.');
    if (raid.sally_run_id) throw err(400, 'You have already sallied out against this raid.');
    const ids = await checkParty(client, s, citizenIds, 3);
    const run = await battleRun(client, s, userId, 'raid_sally', ids, enemiesFor(raid.strength, raid.id));
    await client.query("UPDATE settlement_raids SET sally_run_id = $2, sally_outcome = 'fighting' WHERE id=$1", [raid.id, run.id]);
    return { run, settlementId: s.id };
  });
  try { require('./event_bus').publish(out.settlementId, { type: 'combat_pending', quest_run_id: out.run.id }); } catch (e) { /* offline */ }
  return { quest_run_id: out.run.id };
}

// ── Camps ──────────────────────────────────────────────────────────────────
async function openCamps(q = (t, p) => query(t, p)) {
  return (await q(`SELECT c.*, n.name AS village FROM withered_camps c LEFT JOIN npc_settlements n ON n.id = c.npc_id WHERE c.cleared_at IS NULL`).catch(() => ({ rows: [] }))).rows;
}

// Keep each Withered village's camps topped up (cleared ones return after RESPAWN_H).
// Tiles 2..max away from v (axial), wrapped to the world when v is on it.
function ringTiles(v, min, max, W, H) {
  const out = [];
  const onMap = v.q >= 0 && v.r >= 0 && v.q < W && v.r < H;
  for (let dq = -max; dq <= max; dq++) for (let dr = -max; dr <= max; dr++) {
    const d = (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    if (d < min || d > max) continue;
    let q = v.q + dq, r = v.r + dr;
    if (onMap) { q = ((q % W) + W) % W; r = ((r % H) + H) % H; }
    out.push({ q, r });
  }
  return out;
}

async function spawnCamps(rng = Math.random) {
  let W = 40, H = 40;
  try { const m = (await query('SELECT map_w, map_h FROM world_meta WHERE id=1')).rows[0]; if (m) { W = m.map_w; H = m.map_h; } } catch (e) { /* defaults */ }
  const villages = (await query(`SELECT id, name, tile_q AS q, tile_r AS r FROM npc_settlements
                                  WHERE COALESCE(disposition,'neutral') = 'hostile' OR COALESCE(faction,'neutral') = 'hostile'`)).rows;
  let made = 0;
  for (const v of villages) {
    const open = Number((await query('SELECT COUNT(*)::int AS n FROM withered_camps WHERE npc_id=$1 AND cleared_at IS NULL', [v.id])).rows[0].n);
    const recent = Number((await query(`SELECT COUNT(*)::int AS n FROM withered_camps WHERE npc_id=$1 AND cleared_at > NOW() - make_interval(hours => $2)`, [v.id, RESPAWN_H])).rows[0].n);
    for (let i = open + recent; i < CAMPS_PER_VILLAGE; i++) {
      // A free tile 2–CAMP_RANGE away: not a town, village, outpost or camp.
      const spots = ringTiles(v, 2, CAMP_RANGE, W, H);
      for (let tries = 0; tries < 12 && spots.length; tries++) {
        const t = spots.splice(Math.floor(rng() * spots.length), 1)[0];
        const busy = (await query(`SELECT 1 FROM settlements WHERE tile_q=$1 AND tile_r=$2 UNION SELECT 1 FROM npc_settlements WHERE tile_q=$1 AND tile_r=$2
                                   UNION SELECT 1 FROM outposts WHERE tile_q=$1 AND tile_r=$2 UNION SELECT 1 FROM withered_camps WHERE q=$1 AND r=$2 AND cleared_at IS NULL`, [t.q, t.r]).catch(() => ({ rows: [{}] }))).rows.length;
        if (busy) continue;
        await query('INSERT INTO withered_camps (npc_id, q, r, strength) VALUES ($1,$2,$3,$4)', [v.id, t.q, t.r, Math.round(40 + rng() * 25)]);
        made++;
        break;
      }
    }
  }
  return made;
}

async function startAssault(userId, campId, citizenIds) {
  const out = await withTransaction(async client => {
    const s = (await client.query('SELECT * FROM settlements WHERE user_id=$1', [userId])).rows[0];
    if (!s) throw err(404, 'No settlement.');
    const camp = (await client.query('SELECT * FROM withered_camps WHERE id=$1 AND cleared_at IS NULL FOR UPDATE', [campId])).rows[0];
    if (!camp) throw err(404, 'That camp is gone.');
    if (camp.run_id) {
      const live = (await client.query("SELECT 1 FROM settlement_quests WHERE id=$1 AND status='active'", [camp.run_id])).rows.length;
      if (live) throw err(400, 'Someone is already attacking this camp.');
    }
    if (s.tile_q == null || dist({ q: s.tile_q, r: s.tile_r }, camp) > ASSAULT_RANGE) throw err(400, `That camp is too far away (within ${ASSAULT_RANGE} tiles of your town).`);
    const seen = (await client.query('SELECT 1 FROM fog_of_war WHERE user_id=$1 AND tile_q=$2 AND tile_r=$3', [userId, camp.q, camp.r])).rows.length;
    if (!seen) throw err(400, 'Scout that land first.');
    const ids = await checkParty(client, s, citizenIds, 4);
    const run = await battleRun(client, s, userId, 'camp_assault', ids, enemiesFor(camp.strength + 15, camp.id));
    await client.query('UPDATE withered_camps SET run_id = $2 WHERE id=$1', [camp.id, run.id]);
    return { run, settlementId: s.id };
  });
  try { require('./event_bus').publish(out.settlementId, { type: 'combat_pending', quest_run_id: out.run.id }); } catch (e) { /* offline */ }
  return { quest_run_id: out.run.id };
}

// ── After the card battle (routes/combat.js /resolve) ───────────────────────
const SPECIAL = ['raid_sally', 'camp_assault'];
async function onBattleEnded(run, outcome) {
  if (!run || !SPECIAL.includes(run.quest_id)) return null;
  // The run is done either way: nothing for the quest board to settle.
  await query("UPDATE settlement_quests SET status = 'collected', completes_at = NOW() WHERE id=$1", [run.id]);
  if (run.quest_id === 'raid_sally') {
    const raid = (await query('SELECT * FROM settlement_raids WHERE sally_run_id=$1 AND resolved_at IS NULL', [run.id])).rows[0];
    if (!raid) return null;
    if (outcome === 'victory') {
      const gold = 30 + raid.strength;
      await query('UPDATE settlements SET wealth = wealth + $2 WHERE id=$1', [raid.settlement_id, gold]);
      const up = (await query(`UPDATE settlement_raids SET resolved_at = NOW(), outcome = 'broken', sally_outcome = 'won', loss_share = 0,
                                loot = $2 WHERE id=$1 AND resolved_at IS NULL RETURNING *`, [raid.id, JSON.stringify({ sally: true, reward: { wealth: gold } })])).rows[0];
      await require('./raid_extras').releaseReinforcements((t, p) => query(t, p), raid.id);
      const msg = `⚔️ Your sally broke the raiders from ${raid.from_name} before they reached ${raid.target_name}. +${gold} wealth.`;
      await query("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'raid_repelled',$2)", [raid.settlement_id, msg]);
      try { require('./event_bus').publish(raid.settlement_id, { type: 'raid_resolved', raid: require('./raids').view(up), message: msg }); } catch (e) { /* offline */ }
      try { require('./game_events').emit('raid_repelled', { settlementId: raid.settlement_id }); } catch (e) { /* none */ }
      return { sally: 'won' };
    }
    await query("UPDATE settlement_raids SET strength = ROUND(strength * $2::numeric), sally_outcome = 'lost' WHERE id=$1", [raid.id, SALLY_ANGER]);
    await query("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'raid_warning',$2)",
      [raid.settlement_id, `🔥 Your sally was driven back — the raiders from ${raid.from_name} come on angrier than before.`]);
    return { sally: 'lost' };
  }
  // camp_assault
  const camp = (await query('SELECT * FROM withered_camps WHERE run_id=$1 AND cleared_at IS NULL', [run.id])).rows[0];
  if (!camp) return null;
  if (outcome !== 'victory') { await query('UPDATE withered_camps SET run_id = NULL WHERE id=$1', [camp.id]); return { camp: 'held' }; }
  await query('UPDATE withered_camps SET cleared_at = NOW(), cleared_by = $2 WHERE id=$1', [camp.id, run.settlement_id]);
  const gold = 40 + camp.strength;
  await query('UPDATE settlements SET wealth = wealth + $2 WHERE id=$1', [run.settlement_id, gold]);
  // Peace for every town nearby.
  const towns = (await query('SELECT id, name, tile_q AS q, tile_r AS r FROM settlements WHERE tile_q IS NOT NULL')).rows.filter(t => dist(t, camp) <= PEACE_RANGE);
  const hero = (await query('SELECT name FROM settlements WHERE id=$1', [run.settlement_id])).rows[0];
  for (const t of towns) {
    await query(`UPDATE settlements SET raid_peace_until = GREATEST(COALESCE(raid_peace_until, NOW()), NOW() + make_interval(hours => $2)) WHERE id=$1`, [t.id, PEACE_H]);
    await query("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'camp_cleared',$2)", [t.id, t.id === run.settlement_id
      ? `🏕️ Your party burned the Withered camp. +${gold} wealth, and ${PEACE_H / 24} days of peace for the towns around it.`
      : `🏕️ ${hero ? hero.name : 'A neighbour'} burned a nearby Withered camp — ${PEACE_H / 24} days of peace.`]).catch(() => {});
  }
  return { camp: 'cleared', peace_towns: towns.length };
}

let _last = 0;
async function tick() {
  if (Date.now() - _last < 30 * 60 * 1000) return;
  _last = Date.now();
  try { await spawnCamps(); } catch (e) { console.error('[raid_camps]', e.message); }
}

module.exports = {
  startSally, startAssault, onBattleEnded, spawnCamps, openCamps, enemiesFor, tick, SPECIAL,
  SALLY_ANGER, CAMPS_PER_VILLAGE, CAMP_RANGE, RESPAWN_H, ASSAULT_RANGE, PEACE_RANGE, PEACE_H,
};
