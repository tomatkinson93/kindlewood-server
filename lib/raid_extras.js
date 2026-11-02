// ══════════════════════════════════════════════════════════════════════════
//  raid_extras — call to arms (clanmates reinforce a raided spot).
//  (Sallies and Withered camps live in lib/raid_camps.js.)
//
//  When a raid targets a clan member's spot on their clan's land, every
//  member hears of it (clan event, chat line, activity). Any member may send
//  free Guards or Archers (MAX_PER_MEMBER each, MAX_TOTAL in all) to hold
//  it: they count toward its defence (GARRISON_BASE + class level each), are
//  busy until the raid resolves, then come home — hurt, if the spot fell.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');

const MAX_PER_MEMBER = 2;
const MAX_TOTAL = 6;
const err = (status, msg) => Object.assign(new Error(msg), { status });

// The clan a raid's target belongs to, when the spot is on its land: { clanId, q, r } or null.
async function clanOfRaid(q, raid) {
  const s = (await q('SELECT id, user_id, tile_q, tile_r FROM settlements WHERE id=$1', [raid.settlement_id])).rows[0];
  if (!s) return null;
  const o = raid.outpost_id ? (await q('SELECT tile_q, tile_r FROM outposts WHERE id=$1', [raid.outpost_id])).rows[0] : null;
  const at = o ? { q: o.tile_q, r: o.tile_r } : { q: s.tile_q, r: s.tile_r };
  const m = (await q(`SELECT cm.clan_id FROM clan_members cm JOIN clan_territory t ON t.clan_id = cm.clan_id AND t.q = $2 AND t.r = $3
                       WHERE cm.user_id = $1`, [s.user_id, at.q, at.r]).catch(() => ({ rows: [] }))).rows[0];
  return m ? { clanId: m.clan_id, ...at, ownerUserId: s.user_id } : null;
}

// Raise the alarm for a new raid on clan land.
async function callToArms(raid) {
  const q = (t, p) => query(t, p);
  const c = await clanOfRaid(q, raid);
  if (!c) return null;
  const s = (await q('SELECT name FROM settlements WHERE id=$1', [raid.settlement_id])).rows[0];
  const text = `📯 Call to arms! Raiders from ${raid.from_name} will strike ${raid.target_name} of ${s ? s.name : 'a clanmate'} — send Guards or Archers to hold it.`;
  await q("INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'call_to_arms',$2,$3)",
    [c.clanId, c.ownerUserId, JSON.stringify({ raid_id: raid.id, target: raid.target_name, town: s && s.name, from: raid.from_name, arrives_at: raid.arrives_at })]).catch(() => {});
  try { require('./event_bus').publish(`clan:${c.clanId}`, { type: 'clan_call_to_arms', clan_id: c.clanId, raid_id: raid.id, target: raid.target_name, town: s && s.name, arrives_at: raid.arrives_at, message: text }); } catch (e) { /* offline */ }
  try { require('./clan_chat').systemLine(c.clanId, text); } catch (e) { /* no chat */ }
  return c;
}

// Raids clanmates could help with right now (for the caller's clan).
async function openCalls(userId) {
  const m = (await query('SELECT clan_id FROM clan_members WHERE user_id=$1', [userId])).rows[0];
  if (!m) return [];
  const rows = (await query(
    `SELECT r.*, s.name AS town, s.user_id AS owner_user_id FROM settlement_raids r
       JOIN settlements s ON s.id = r.settlement_id
       JOIN clan_members cm ON cm.user_id = s.user_id AND cm.clan_id = $1
      WHERE r.resolved_at IS NULL ORDER BY r.arrives_at`, [m.clan_id])).rows;
  const out = [];
  for (const r of rows) {
    const c = await clanOfRaid((t, p) => query(t, p), r);
    if (!c || c.clanId !== m.clan_id) continue;
    const reinf = (await query(
      `SELECT rr.citizen_id, rr.settlement_id, c.name, c.role, s.name AS from_town FROM raid_reinforcements rr
         JOIN citizens c ON c.id = rr.citizen_id JOIN settlements s ON s.id = rr.settlement_id WHERE rr.raid_id = $1`, [r.id])).rows;
    out.push({ raid_id: r.id, town: r.town, target: r.target_name, from: r.from_name, arrives_at: r.arrives_at, mine: r.owner_user_id === userId,
      reinforcements: reinf.map(x => ({ id: x.citizen_id, name: x.name, role: x.role, from_town: x.from_town })), max_total: MAX_TOTAL, max_per_member: MAX_PER_MEMBER });
  }
  return out;
}

async function reinforce(userId, raidId, citizenId) {
  return withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const raid = (await q('SELECT * FROM settlement_raids WHERE id=$1 AND resolved_at IS NULL FOR UPDATE', [raidId])).rows[0];
    if (!raid) throw err(404, 'That raid is over.');
    const c = await clanOfRaid(q, raid);
    const me = (await q('SELECT clan_id FROM clan_members WHERE user_id=$1', [userId])).rows[0];
    if (!c || !me || me.clan_id !== c.clanId) throw err(403, 'Only clanmates can answer this call, and only for a spot on clan land.');
    const mine = (await q('SELECT * FROM settlements WHERE user_id=$1', [userId])).rows[0];
    const cit = (await q('SELECT id, name, settlement_id, life_stage, role FROM citizens WHERE id=$1', [citizenId])).rows[0];
    if (!cit || !mine || cit.settlement_id !== mine.id) throw err(404, 'Citizen not found.');
    if (!['soldier', 'archer'].includes(cit.role)) throw err(400, 'Only Guards and Archers can answer a call to arms.');
    const why = await require('./outpost_state').busyReason(cit, mine.id);
    if (why) throw err(400, why);
    const already = (await q('SELECT 1 FROM raid_reinforcements WHERE citizen_id=$1', [cit.id])).rows.length;
    if (already) throw err(400, `${cit.name} is already holding a clanmate's spot.`);
    const n = (await q('SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE settlement_id = $2)::int AS mine FROM raid_reinforcements WHERE raid_id=$1', [raid.id, mine.id])).rows[0];
    if (n.n >= MAX_TOTAL) throw err(400, `${MAX_TOTAL} defenders already stand there.`);
    if (n.mine >= MAX_PER_MEMBER) throw err(400, `You can send at most ${MAX_PER_MEMBER}.`);
    await q('INSERT INTO raid_reinforcements (citizen_id, raid_id, settlement_id) VALUES ($1,$2,$3)', [cit.id, raid.id, mine.id]);
    await q("INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'reinforced',$2,$3)",
      [c.clanId, userId, JSON.stringify({ raid_id: raid.id, citizen: cit.name, target: raid.target_name })]).catch(() => {});
    return { raid_id: raid.id, citizen: { id: cit.id, name: cit.name }, owner: raid.settlement_id, clanId: c.clanId };
  }).then(r => {
    try { require('./event_bus').publish(r.owner, { type: 'raid_reinforced', raid_id: r.raid_id, citizen: r.citizen }); } catch (e) { /* offline */ }
    return r;
  });
}

// For lib/raids.resolve: the reinforcements' defence and who they are.
async function reinforcementDefence(q, raidId) {
  const D = require('./defences');
  const rows = (await q(
    `SELECT c.id, c.name, c.role, rr.settlement_id, COALESCE(cc.level, 1) AS class_level FROM raid_reinforcements rr
       JOIN citizens c ON c.id = rr.citizen_id
       LEFT JOIN citizen_classes cc ON cc.citizen_id = c.id AND cc.class_key = c.role
      WHERE rr.raid_id = $1 AND COALESCE(c.life_stage, 'adult') = 'adult'`, [raidId]).catch(() => ({ rows: [] }))).rows;
  return { value: rows.reduce((t, c) => t + D.GARRISON_BASE + (Number(c.class_level) || 1), 0), citizens: rows.map(c => ({ ...c, post: 'reinforcement' })) };
}
async function releaseReinforcements(q, raidId) {
  await q('DELETE FROM raid_reinforcements WHERE raid_id=$1', [raidId]).catch(() => {});
}

module.exports = { callToArms, openCalls, reinforce, reinforcementDefence, releaseReinforcements, clanOfRaid, MAX_PER_MEMBER, MAX_TOTAL };
