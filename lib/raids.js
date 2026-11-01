// ══════════════════════════════════════════════════════════════════════════
//  raids — soft raids by the Withered (hostile villages, npc_seed.js).
//
//  Who:     towns with an outpost (or the town itself) within REACH tiles of
//           a Withered village. Not Camps, not players younger than
//           NEW_PLAYER_DAYS, not within COOLDOWN_H of their last raid, and
//           one raid on its way at a time.
//  How often: each check (every CHECK_EVERY_MS) a town rolls CHECK_CHANCE —
//           about one raid every DAYS_PER_RAID days.
//  Warning: WARN_H hours ahead (event, banner, outpost panel).
//  Defence: the Watchtower (lib/watchtower: level ×10 + each Guard/Archer on
//           watch), each Allied village within MILITIA_REACH of the target
//           (+MILITIA, at most two), and any town effect `raid_defence`
//           (clan boons and territory — lib/town_mods effects).
//  Outcome: defence × (0.75–1.25) ≥ strength → repelled: a little wealth,
//           sometimes a Withered Fang, XP for the watch. Otherwise lost: the
//           outpost sits idle IDLE_H hours, or the raiders carry off
//           5–10% of one stored resource (at most STEAL_CAP). Nothing is
//           ever destroyed.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');

const REACH = 6;
const NEW_PLAYER_DAYS = 7;
const COOLDOWN_H = 48;
const WARN_H = 6;
const DAYS_PER_RAID = 5;
const CHECK_EVERY_MS = 10 * 60 * 1000;
const CHECK_CHANCE = CHECK_EVERY_MS / (DAYS_PER_RAID * 24 * 3600 * 1000);
const MILITIA = 15;
const MILITIA_REACH = 4;
const IDLE_H = 6;
const STEAL_CAP = 300;
const STEALABLE = ['food', 'timber', 'stone', 'metal', 'wealth'];
const TIER_INDEX = { camp: 0, village: 1, town: 2, city: 3 };

const dist = (a, b) => require('../mapgen').hexDistanceWrapped(a.q, a.r, b.q, b.r);
const withered = q => q(`SELECT id, name, tile_q AS q, tile_r AS r FROM npc_settlements
                          WHERE COALESCE(disposition,'neutral') = 'hostile' OR COALESCE(faction,'neutral') = 'hostile'`).then(r => r.rows);

// The nearest place a Withered band could strike: { outpost?, name, q, r,
// from, d } or null when nothing is in reach.
async function targetFor(s, bands, q) {
  if (s.tile_q == null || !bands.length) return null;
  const { OUTPOST_CONFIG } = require('../outposts_config');
  const spots = [{ name: s.name || 'your town', q: s.tile_q, r: s.tile_r, outpost: null }];
  for (const o of (await q('SELECT id, terrain, tile_q, tile_r, level FROM outposts WHERE settlement_id=$1', [s.id])).rows) {
    spots.push({ name: `the ${(OUTPOST_CONFIG[o.terrain] || {}).name || 'outpost'}`, q: o.tile_q, r: o.tile_r, outpost: o });
  }
  let best = null;
  for (const sp of spots) for (const b of bands) {
    const d = dist(sp, b);
    if (d <= REACH && (!best || d < best.d || (d === best.d && sp.outpost && !best.outpost))) best = { ...sp, from: b, d };
  }
  return best;
}

function strengthFor(s, target, rng = Math.random) {
  const lvl = target.outpost ? Math.max(1, target.outpost.level || 1) : 1;
  return Math.round(20 + 10 * lvl + 15 * (TIER_INDEX[s.tier] || 0) + rng() * 10);
}

// The town's defence for a target right now: { watch, militia, town, total, allies: [names] }.
async function defenceFor(s, target, q) {
  q = q || ((t, p) => query(t, p));
  const wt = await require('./watchtower').state({ query: q }, s.id);
  let militia = 0; const allies = [];
  if (target) {
    const rows = (await q(`SELECT n.name, n.tile_q AS q, n.tile_r AS r FROM diplomacy_relations d JOIN npc_settlements n ON n.id = d.npc_id
                            WHERE d.settlement_id = $1 AND d.trust >= 71`, [s.id])).rows;
    for (const n of rows) if (dist(n, target) <= MILITIA_REACH && allies.length < 2) { allies.push(n.name); militia += MILITIA; }
  }
  let town = 0;
  try { town = Math.round(Number((await require('./town_mods').load({ query: q }, s)).effects.raid_defence) || 0); } catch (e) { /* none */ }
  return { watch: wt.defence, militia, town, total: wt.defence + militia + town, allies, posted: wt.posted.length };
}

// Start a raid: warn now, strike in WARN_H hours (opts.arriveInMs overrides).
async function start(s, opts = {}, q = (t, p) => query(t, p)) {
  const bands = opts.bands || await withered(q);
  const target = await targetFor(s, bands, q) || (opts.force ? { name: s.name || 'your town', q: s.tile_q, r: s.tile_r, outpost: null, from: bands[0] || { id: null, name: 'the Withered' } } : null);
  if (!target) return null;
  const strength = opts.strength || strengthFor(s, target);
  const arrives = new Date(Date.now() + (opts.arriveInMs != null ? opts.arriveInMs : WARN_H * 3600e3));
  const r = await q(
    `INSERT INTO settlement_raids (settlement_id, outpost_id, target_name, from_npc_id, from_name, strength, arrives_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`,
    [s.id, target.outpost ? target.outpost.id : null, target.name, target.from.id || null, target.from.name || 'the Withered', strength, arrives]);
  const raid = r.rows[0];
  if (!raid) return null;   // one already on its way
  const hrs = Math.max(1, Math.round((arrives - Date.now()) / 3600e3));
  await q("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'raid_warning',$2)",
    [s.id, `🔥 Raiders from ${raid.from_name} are gathering — they will strike ${raid.target_name} in about ${hrs} hour${hrs === 1 ? '' : 's'}. Man the Watchtower.`]);
  try { require('./event_bus').publish(s.id, { type: 'raid_warning', raid: view(raid) }); } catch (e) { /* offline */ }
  return raid;
}

// Settle one raid that has arrived. Returns the updated row (or null if
// someone else got it first).
async function resolve(raidId, rng = Math.random) {
  const out = await withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const raid = (await q('SELECT * FROM settlement_raids WHERE id=$1 AND resolved_at IS NULL FOR UPDATE SKIP LOCKED', [raidId])).rows[0];
    if (!raid) return null;
    const s = (await q('SELECT * FROM settlements WHERE id=$1 FOR UPDATE', [raid.settlement_id])).rows[0];
    if (!s) return null;
    const o = raid.outpost_id ? (await q('SELECT * FROM outposts WHERE id=$1', [raid.outpost_id])).rows[0] : null;
    const def = await defenceFor(s, o ? { q: o.tile_q, r: o.tile_r } : { q: s.tile_q, r: s.tile_r }, q);
    const roll = Math.round(def.total * (0.75 + rng() * 0.5));
    const loot = { defence: def };
    let outcome, msg;
    if (roll >= raid.strength) {
      outcome = 'repelled';
      const gold = 20 + Math.round(raid.strength / 2);
      await q('UPDATE settlements SET wealth = wealth + $2 WHERE id=$1', [s.id, gold]);
      loot.reward = { wealth: gold };
      if (rng() < 0.3) {
        const t = (await q("SELECT * FROM item_templates WHERE item_key='withered_fang'")).rows[0];
        if (t) {
          await require('./inventory').grantItem(q, s.id, { item_key: t.item_key, name: t.name, description: t.description, icon: t.icon, category: t.category, rarity: t.rarity, quantity: 1, source: 'raid', metadata: { sell_value: t.sell_value } });
          loot.reward.item = { name: t.name, icon: t.icon };
        }
      }
      // The watch earns its keep.
      const wt = await require('./watchtower').state({ query: q }, s.id);
      if (wt.posted.length) {
        try { await require('./careers').grantXp(client, s.id, wt.posted.map(c => ({ citizenId: c.id, classKey: c.role, xp: 40 })), []); } catch (e) { /* careers off */ }
      }
      msg = `🛡️ The raiders from ${raid.from_name} broke against your defences at ${raid.target_name} and fled. +${gold} wealth${loot.reward.item ? ` and a ${loot.reward.item.name}` : ''}.`;
    } else {
      outcome = 'lost';
      if (o && rng() < 0.5) {
        await q("UPDATE outposts SET raided_until = NOW() + make_interval(hours => $2) WHERE id=$1", [o.id, IDLE_H]);
        loot.idle = { outpost_id: o.id, hours: IDLE_H };
        msg = `🔥 Raiders from ${raid.from_name} overran ${raid.target_name}. It will take ${IDLE_H} hours to set it right.`;
      } else {
        const res = STEALABLE.slice().sort((a, b) => (Number(s[b]) || 0) - (Number(s[a]) || 0))[0];
        const take = Math.min(STEAL_CAP, Math.floor((Number(s[res]) || 0) * (0.05 + rng() * 0.05)));
        if (take > 0) await q(`UPDATE settlements SET ${res} = GREATEST(0, ${res} - $2) WHERE id=$1`, [s.id, take]);
        loot.stolen = { resource: res, qty: take };
        msg = `🔥 Raiders from ${raid.from_name} slipped past your defences at ${raid.target_name} and carried off ${take} ${res === 'metal' ? 'iron' : res}.`;
      }
    }
    const up = (await q("UPDATE settlement_raids SET resolved_at = NOW(), outcome = $2, defence = $3, loot = $4 WHERE id=$1 RETURNING *",
      [raid.id, outcome, roll, JSON.stringify(loot)])).rows[0];
    await q("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,$2,$3)", [s.id, outcome === 'repelled' ? 'raid_repelled' : 'raid_lost', msg]);
    return { raid: up, settlementId: s.id, msg };
  });
  if (out) {
    try { require('./event_bus').publish(out.settlementId, { type: 'raid_resolved', raid: view(out.raid), message: out.msg }); } catch (e) { /* offline */ }
    try { if (out.raid.outcome === 'repelled') require('./game_events').emit('raid_repelled', { settlementId: out.settlementId }); } catch (e) { /* no listeners */ }
  }
  return out ? out.raid : null;
}

// Towns that could be raided now (outside protection), each with a target.
async function eligible(now = Date.now()) {
  const bands = await withered((t, p) => query(t, p));
  if (!bands.length) return { bands, list: [] };
  const rows = (await query(
    `SELECT s.* FROM settlements s JOIN users u ON u.id = s.user_id
      WHERE s.tile_q IS NOT NULL AND COALESCE(s.tier,'camp') <> 'camp'
        AND u.created_at < to_timestamp($1 / 1000.0) - make_interval(days => $2)
        AND NOT EXISTS (SELECT 1 FROM settlement_raids x WHERE x.settlement_id = s.id
                         AND (x.resolved_at IS NULL OR x.resolved_at > to_timestamp($1 / 1000.0) - make_interval(hours => $3)))`,
    [now, NEW_PLAYER_DAYS, COOLDOWN_H])).rows;
  const list = [];
  for (const s of rows) { const t = await targetFor(s, bands, (a, b) => query(a, b)); if (t) list.push({ s, t }); }
  return { bands, list };
}

let _lastCheck = 0;
async function tick(rng = Math.random) {
  try {
    // Arrived raids first.
    for (const r of (await query('SELECT id FROM settlement_raids WHERE resolved_at IS NULL AND arrives_at <= NOW() ORDER BY arrives_at LIMIT 20')).rows) {
      await resolve(r.id, rng);
    }
    if (Date.now() - _lastCheck < CHECK_EVERY_MS) return;
    _lastCheck = Date.now();
    const { bands, list } = await eligible();
    for (const { s } of list) if (rng() < CHECK_CHANCE) await start(s, { bands });
  } catch (e) { console.error('[raids]', e.message); }
}

// What the client sees.
function view(r) {
  if (!r) return null;
  return { id: r.id, target: r.target_name, outpost_id: r.outpost_id, from: r.from_name, strength: r.strength,
    warned_at: r.warned_at, arrives_at: r.arrives_at, resolved_at: r.resolved_at, outcome: r.outcome, defence: r.defence, loot: r.loot };
}
async function activeFor(sid) {
  const r = (await query('SELECT * FROM settlement_raids WHERE settlement_id=$1 AND resolved_at IS NULL ORDER BY id DESC LIMIT 1', [sid]).catch(() => ({ rows: [] }))).rows[0];
  return view(r);
}

module.exports = {
  start, resolve, tick, eligible, targetFor, defenceFor, strengthFor, activeFor, view, withered,
  REACH, NEW_PLAYER_DAYS, COOLDOWN_H, WARN_H, DAYS_PER_RAID, CHECK_CHANCE, MILITIA, MILITIA_REACH, IDLE_H, STEAL_CAP,
};
