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
const IDLE_H = 12;              // an undefended outpost, fully raided
const FULL_SHARE = 0.15;        // a full raid takes 15% of each resource…
const STEAL_CAP = 2000;         // …at most 2,000 of each
const STEALABLE = ['food', 'timber', 'stone', 'metal', 'wealth'];
const TIER_INDEX = { camp: 0, village: 1, town: 2, city: 3 };
const TRIBUTE_BASE = 200;       // × (tier index + 1)
const TRIBUTE_HOURS = 24;
const TRIBUTE_STREAK_DAYS = 3;  // each tribute within this of the last costs +50%
const RANGE = { base: 0.35, scout: 0.20, signal: 0.10, both: 0.05 };

const dist = (a, b) => require('../mapgen').hexDistanceWrapped(a.q, a.r, b.q, b.r);
// Where raids can set out from: Withered villages and their camps
// (lib/raid_camps) — a camp, being nearer, is usually where they come from.
const withered = async q => {
  const villages = (await q(`SELECT id, name, tile_q AS q, tile_r AS r FROM npc_settlements
                             WHERE COALESCE(disposition,'neutral') = 'hostile' OR COALESCE(faction,'neutral') = 'hostile'`)).rows;
  const camps = (await q(`SELECT c.id AS camp_id, c.npc_id AS id, c.q, c.r, 'a Withered camp' AS name FROM withered_camps c WHERE c.cleared_at IS NULL`)
    .catch(() => ({ rows: [] }))).rows;
  return [...camps, ...villages];
};

// The nearest place a Withered band could strike: { outpost?, name, q, r,
// from, d } or null when nothing is in reach.
async function targetFor(s, bands, q) {
  if (s.tile_q == null || !bands.length) return null;
  const { OUTPOST_CONFIG } = require('../outposts_config');
  const spots = [{ name: s.name || 'your town', q: s.tile_q, r: s.tile_r, outpost: null }];
  for (const o of (await q('SELECT id, terrain, tile_q, tile_r, level, fort_level FROM outposts WHERE settlement_id=$1', [s.id]).catch(() =>
    q('SELECT id, terrain, tile_q, tile_r, level FROM outposts WHERE settlement_id=$1', [s.id]))).rows) {
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
  return Math.round(25 + 15 * lvl + 25 * (TIER_INDEX[s.tier] || 0) + rng() * 15);
}

// The defence of one spot right now, with its breakdown:
// { own, walls, watch, fort, garrison, militia, town, land, clan, total,
//   undefended, allies, clan_from, posted: [citizens at the spot] }.
// `own` is the spot's own defences (walls + watch, or fort + garrison);
// `undefended` when that is 0 — a full raid, no roll.
async function defenceFor(s, target, q) {
  q = q || ((t, p) => query(t, p));
  const D = require('./defences');
  const db = { query: q };
  const at = target || { q: s.tile_q, r: s.tile_r };
  const own = await D.ownDefence(s, at, db);
  let militia = 0; const allies = [];
  const rows = (await q(`SELECT n.name, n.tile_q AS q, n.tile_r AS r FROM diplomacy_relations d JOIN npc_settlements n ON n.id = d.npc_id
                          WHERE d.settlement_id = $1 AND d.trust >= 71`, [s.id])).rows;
  for (const n of rows) if (at.q != null && dist(n, at) <= MILITIA_REACH && allies.length < 2) { allies.push(n.name); militia += MILITIA; }
  let town = 0;
  try { town = Math.round(Number((await require('./town_mods').load(db, s)).effects.raid_defence) || 0); } catch (e) { /* none */ }
  let land = 0;
  try { if (await require('./clan_treasury').onClanLand(db, s.user_id, at.q, at.r)) land = require('./clan_treasury').LAND_DEFENCE; } catch (e) { /* none */ }
  let clan = { value: 0, from: [] };
  try { clan = await D.clanShare(s, at.q, at.r, own.own, db); } catch (e) { /* none */ }
  const total = own.own + militia + town + land + clan.value;
  return {
    kind: own.kind, own: own.own, walls: own.walls, watch: own.watch, fort: own.fort, garrison: own.garrison,
    militia, town, land, clan: clan.value, clan_from: clan.from, total, undefended: own.own <= 0, allies,
    posted: own.posted.map(c => ({ id: c.id, name: c.name, role: c.role, post: c.post })),
  };
}

// Town research effects (raid warning, scouting, loss reduction).
async function fxOf(sid, q) { return require('./defences').researchFx(sid, q ? { query: q } : null); }

// How well the town can judge a raid's strength: ±share of it.
async function scoutRange(s, q = (t, p) => query(t, p)) {
  const fx = await fxOf(s.id, q);
  const post = (await q("SELECT 1 FROM buildings WHERE settlement_id=$1 AND type='scout_post'", [s.id]).catch(() => ({ rows: [] }))).rows.length > 0;
  const signal = (fx.scout_range || 0) > 0;
  return post && signal ? RANGE.both : signal ? RANGE.signal : post ? RANGE.scout : RANGE.base;
}

// Start a raid: warn now, strike in WARN_H (+ Signal Fires) hours
// (opts.arriveInMs overrides). A town at peace (tribute) is skipped unless
// opts.force.
async function start(s, opts = {}, q = (t, p) => query(t, p)) {
  if (!opts.force && s.raid_peace_until && Date.parse(s.raid_peace_until) > Date.now()) return null;
  const bands = opts.bands || await withered(q);
  let target = null;
  if (opts.outpostId) {
    // Dev Tools: strike this outpost, from the nearest band (or the Withered at large).
    const { OUTPOST_CONFIG } = require('../outposts_config');
    const o = (await q('SELECT * FROM outposts WHERE id=$1 AND settlement_id=$2', [opts.outpostId, s.id])).rows[0];
    if (!o) return null;
    const near = bands.slice().sort((a, b) => dist(a, { q: o.tile_q, r: o.tile_r }) - dist(b, { q: o.tile_q, r: o.tile_r }))[0];
    target = { name: `the ${(OUTPOST_CONFIG[o.terrain] || {}).name || 'outpost'}`, q: o.tile_q, r: o.tile_r, outpost: o, from: near || { id: null, name: 'the Withered' } };
  } else if (opts.town) {
    const near = bands.slice().sort((a, b) => dist(a, { q: s.tile_q, r: s.tile_r }) - dist(b, { q: s.tile_q, r: s.tile_r }))[0];
    target = { name: s.name || 'your town', q: s.tile_q, r: s.tile_r, outpost: null, from: near || { id: null, name: 'the Withered' } };
  } else {
    target = await targetFor(s, bands, q) || (opts.force ? { name: s.name || 'your town', q: s.tile_q, r: s.tile_r, outpost: null, from: bands[0] || { id: null, name: 'the Withered' } } : null);
  }
  if (!target) return null;
  const strength = opts.strength || strengthFor(s, target);
  const warnH = WARN_H + ((await fxOf(s.id, q)).raid_warning_h || 0);
  const arrives = new Date(Date.now() + (opts.arriveInMs != null ? opts.arriveInMs : warnH * 3600e3));
  const r = await q(
    `INSERT INTO settlement_raids (settlement_id, outpost_id, target_name, from_npc_id, from_name, strength, arrives_at, from_camp_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING *`,
    [s.id, target.outpost ? target.outpost.id : null, target.name, target.from.id || null, target.from.name || 'the Withered', strength, arrives, target.from.camp_id || null]);
  const raid = r.rows[0];
  if (!raid) return null;   // one already on its way
  const hrs = Math.max(1, Math.round((arrives - Date.now()) / 3600e3));
  await q("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'raid_warning',$2)",
    [s.id, `🔥 Raiders from ${raid.from_name} are gathering — they will strike ${raid.target_name} in about ${hrs} hour${hrs === 1 ? '' : 's'}. Man the defences.`]);
  try { require('./event_bus').publish(s.id, { type: 'raid_warning', raid: view(raid, await scoutRange(s, q)) }); } catch (e) { /* offline */ }
  try { require('./game_events').emit('raid_started', { settlementId: s.id, raidId: raid.id }); } catch (e) { /* no listeners */ }
  try { await require('./raid_extras').callToArms(raid); } catch (e) { /* not on clan land, or no clan */ }
  return raid;
}

// A wound for someone caught at a raided spot; worse when more was lost.
async function injure(q, sid, c, share, raid) {
  const T = require('./injury_table');
  const severity = share >= 0.5 ? 'wound' : 'scratch';
  const parts = T.BODY_PARTS || [{ key: 'arm' }];
  const part = (parts[Math.floor(Math.random() * parts.length)] || {}).key || 'arm';
  const cfg = (T.SEVERITY_EFFECTS || {})[severity] || {};
  const mods = (cfg.modifiers_by_part || {})[part] || {};
  const narrative = `${c.name} was hurt holding ${raid.target_name} against the raiders from ${raid.from_name}.`;
  const ev = (await q(
    `INSERT INTO citizen_events (citizen_id, settlement_id, event_type, severity, body_part, narrative, cause)
     VALUES ($1,$2,'injury',$3,$4,$5,'raid') RETURNING id`, [c.id, sid, severity, part, narrative]).catch(() =>
    q(`INSERT INTO citizen_events (citizen_id, settlement_id, event_type, severity, body_part, narrative)
       VALUES ($1,$2,'injury',$3,$4,$5) RETURNING id`, [c.id, sid, severity, part, narrative]))).rows[0];
  if (Object.keys(mods).length) {
    await q(`INSERT INTO citizen_conditions (citizen_id, condition_type, body_part, severity, stat_modifiers, expires_at, source_event_id)
             VALUES ($1,'injury',$2,$3,$4, NOW() + make_interval(days => $5), $6)`, [c.id, part, severity, JSON.stringify(mods), cfg.heal_days || 2, ev.id]);
  }
  return { id: c.id, name: c.name, severity };
}

// Settle one raid that has arrived. Graded: undefended → the full raid;
// otherwise loss = max(0, 1 − defence × (0.85–1.15) / strength) of it
// (Iron Gates −25%); nothing when the defence holds. Everyone at a spot that
// lost anything is hurt and sent home. Returns the updated row, or null if
// someone else got it first.
async function resolve(raidId, rng = Math.random) {
  const out = await withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const raid = (await q('SELECT * FROM settlement_raids WHERE id=$1 AND resolved_at IS NULL FOR UPDATE SKIP LOCKED', [raidId])).rows[0];
    if (!raid) return null;
    const s = (await q('SELECT * FROM settlements WHERE id=$1 FOR UPDATE', [raid.settlement_id])).rows[0];
    if (!s) return null;
    const o = raid.outpost_id ? (await q('SELECT * FROM outposts WHERE id=$1', [raid.outpost_id])).rows[0] : null;
    const def = await defenceFor(s, o ? { q: o.tile_q, r: o.tile_r, outpost: o } : { q: s.tile_q, r: s.tile_r }, q);
    // Reinforcements answering a call to arms (lib/raid_extras).
    let reinf = { value: 0, citizens: [] };
    try { reinf = await require('./raid_extras').reinforcementDefence(q, raid.id); } catch (e) { /* none yet */ }
    const total = def.total + reinf.value;
    const undefended = def.undefended && reinf.value <= 0;
    const roll = undefended ? 0 : Math.round(total * (0.85 + rng() * 0.3));
    const fx = await fxOf(s.id, q);
    let share = undefended ? 1 : Math.max(0, Math.min(1, 1 - roll / Math.max(1, raid.strength)));
    if (share > 0 && !undefended) share *= Math.max(0, 1 + (fx.raid_loss || 0));   // Iron Gates
    share = Math.round(share * 1000) / 1000;
    const loot = { defence: { ...def, reinforcements: reinf.value }, share };
    let outcome, msg;
    if (share <= 0) {
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
      // Everyone who held the spot earns its keep.
      const xp = def.posted.filter(c => ['soldier', 'archer'].includes(c.role));
      if (xp.length) { try { await require('./careers').grantXp(client, s.id, xp.map(c => ({ citizenId: c.id, classKey: c.role, xp: 40 })), []); } catch (e) { /* careers off */ } }
      msg = `🛡️ The raiders from ${raid.from_name} broke against your defences at ${raid.target_name} and fled. +${gold} wealth${loot.reward.item ? ` and a ${loot.reward.item.name}` : ''}.`;
    } else {
      outcome = share >= 1 ? 'lost' : 'partial';
      // Stolen: share × 15% of each resource, at most 2,000 × share each.
      const stolen = {};
      for (const res of STEALABLE) {
        const take = Math.floor(Math.min(STEAL_CAP, (Number(s[res]) || 0) * FULL_SHARE) * share);
        if (take > 0) stolen[res] = take;
      }
      const keys = Object.keys(stolen);
      if (keys.length) await q(`UPDATE settlements SET ${keys.map((r, i) => `${r} = GREATEST(0, ${r} - $${i + 2})`).join(', ')} WHERE id=$1`, [s.id, ...keys.map(k => stolen[k])]);
      loot.stolen = stolen;
      if (o) {
        const hours = Math.max(1, Math.round(IDLE_H * share));
        await q("UPDATE outposts SET raided_until = NOW() + make_interval(hours => $2) WHERE id=$1", [o.id, hours]);
        loot.idle = { outpost_id: o.id, hours };
      }
      // Everyone at the spot is hurt and goes home.
      const hurt = [];
      for (const c of [...def.posted, ...reinf.citizens]) hurt.push(await injure(q, c.settlement_id || s.id, c, share, raid));
      if (o) await q('DELETE FROM outpost_crew WHERE outpost_id=$1', [o.id]);
      loot.injured = hurt;
      const what = Object.entries(stolen).map(([r, v]) => `${v} ${r === 'metal' ? 'iron' : r}`).join(', ') || 'nothing of worth';
      msg = outcome === 'lost'
        ? `🔥 ${raid.target_name} stood undefended — raiders from ${raid.from_name} carried off ${what}${loot.idle ? ` and left it in ruins for ${loot.idle.hours} hours` : ''}.`
        : `🔥 Raiders from ${raid.from_name} broke through at ${raid.target_name} (${Math.round(share * 100)}% of a full raid): they carried off ${what}${loot.idle ? `; it needs ${loot.idle.hours} hours to set right` : ''}.`;
      if (hurt.length) msg += ` ${hurt.map(h => h.name).join(', ')} ${hurt.length === 1 ? 'was' : 'were'} hurt and sent home.`;
    }
    const up = (await q("UPDATE settlement_raids SET resolved_at = NOW(), outcome = $2, defence = $3, loot = $4, loss_share = $5 WHERE id=$1 RETURNING *",
      [raid.id, outcome, roll, JSON.stringify(loot), share])).rows[0];
    await q("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,$2,$3)", [s.id, outcome === 'repelled' ? 'raid_repelled' : 'raid_lost', msg]);
    try { await require('./raid_extras').releaseReinforcements(q, raid.id); } catch (e) { /* none */ }
    return { raid: up, settlementId: s.id, msg };
  });
  if (out) {
    try { require('./event_bus').publish(out.settlementId, { type: 'raid_resolved', raid: view(out.raid), message: out.msg }); } catch (e) { /* offline */ }
    try { if (out.raid.outcome === 'repelled') require('./game_events').emit('raid_repelled', { settlementId: out.settlementId }); } catch (e) { /* no listeners */ }
  }
  return out ? out.raid : null;
}

// ── Tribute: 24 hours of peace ─────────────────────────────────────────────
// TRIBUTE_BASE × (tier + 1) wealth, +50% for each tribute within
// TRIBUTE_STREAK_DAYS of the last; turning back a raid already on its way
// costs double.
function tributeQuote(s, active, now = Date.now()) {
  const base = TRIBUTE_BASE * ((TIER_INDEX[s.tier] || 0) + 1);
  const recent = s.raid_tribute_at && now - Date.parse(s.raid_tribute_at) < TRIBUTE_STREAK_DAYS * 86400e3;
  const streak = recent ? (s.raid_tribute_streak || 0) : 0;
  const cost = Math.round(base * Math.pow(1.5, streak) * (active ? 2 : 1));
  const peace = s.raid_peace_until && Date.parse(s.raid_peace_until) > now ? new Date(s.raid_peace_until).toISOString() : null;
  return { cost, hours: TRIBUTE_HOURS, streak, turns_back: !!active, peace_until: peace };
}
async function payTribute(userId) {
  return withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const s = (await q('SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    if (!s) throw Object.assign(new Error('No settlement.'), { status: 404 });
    const active = (await q('SELECT * FROM settlement_raids WHERE settlement_id=$1 AND resolved_at IS NULL FOR UPDATE', [s.id])).rows[0];
    const quote = tributeQuote(s, active);
    if (quote.peace_until && !active) throw Object.assign(new Error('The Withered are already paid — there is peace until ' + new Date(quote.peace_until).toUTCString() + '.'), { status: 400 });
    if (Number(s.wealth) < quote.cost) throw Object.assign(new Error(`The Withered want ${quote.cost} wealth.`), { status: 400 });
    await q(`UPDATE settlements SET wealth = wealth - $2, raid_peace_until = NOW() + make_interval(hours => $3),
              raid_tribute_at = NOW(), raid_tribute_streak = $4 WHERE id=$1`, [s.id, quote.cost, TRIBUTE_HOURS, quote.streak + 1]);
    if (active) {
      await q("UPDATE settlement_raids SET resolved_at = NOW(), outcome = 'turned_back', loss_share = 0, loot = $2 WHERE id=$1", [active.id, JSON.stringify({ tribute: quote.cost })]);
      try { await require('./raid_extras').releaseReinforcements(q, active.id); } catch (e) { /* none */ }
    }
    await q("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'raid_tribute',$2)", [s.id, active
      ? `🪙 You paid the Withered ${quote.cost} wealth. The raiders turn back, and leave you be for ${TRIBUTE_HOURS} hours.`
      : `🪙 You paid the Withered ${quote.cost} wealth for ${TRIBUTE_HOURS} hours of peace.`]);
    return { settlementId: s.id, cost: quote.cost, turned_back: !!active, raidId: active ? active.id : null, peace_hours: TRIBUTE_HOURS };
  }).then(r => {
    if (r.turned_back) { try { require('./event_bus').publish(r.settlementId, { type: 'raid_resolved', raid: { id: r.raidId, outcome: 'turned_back' }, message: `🪙 The raiders turn back.` }); } catch (e) { /* offline */ } }
    return r;
  });
}

// Towns that could be raided now (outside protection), each with a target.
async function eligible(now = Date.now()) {
  const bands = await withered((t, p) => query(t, p));
  if (!bands.length) return { bands, list: [] };
  const rows = (await query(
    `SELECT s.* FROM settlements s JOIN users u ON u.id = s.user_id
      WHERE s.tile_q IS NOT NULL AND COALESCE(s.tier,'camp') <> 'camp'
        AND (s.raid_peace_until IS NULL OR s.raid_peace_until < to_timestamp($1 / 1000.0))
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

// Call a raid off (Dev Tools): no outcome, no loss, no cooldown — the row
// goes, reinforcements come home and any sally party is freed.
async function cancel(raidId) {
  const out = await withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const raid = (await q('SELECT * FROM settlement_raids WHERE id=$1 AND resolved_at IS NULL FOR UPDATE', [raidId])).rows[0];
    if (!raid) return null;
    try { await require('./raid_extras').releaseReinforcements(q, raid.id); } catch (e) { /* none */ }
    if (raid.sally_run_id) await q("UPDATE settlement_quests SET status = 'collected', completes_at = NOW() WHERE id=$1", [raid.sally_run_id]).catch(() => {});
    await q('DELETE FROM settlement_raids WHERE id=$1', [raid.id]);
    return raid;
  });
  if (out) { try { require('./event_bus').publish(out.settlement_id, { type: 'raid_cancelled', raid: { id: out.id } }); } catch (e) { /* offline */ } }
  return out;
}

// Why the normal hourly check would (not) start a raid on this town now:
// [] when it is eligible, else reasons in plain words.
async function whyNot(s, now = Date.now()) {
  const reasons = [];
  if (s.tile_q == null) reasons.push('Your town has no home tile yet.');
  if ((s.tier || 'camp') === 'camp') reasons.push('Camps are never raided — grow to a Village.');
  if (s.raid_peace_until && Date.parse(s.raid_peace_until) > now) reasons.push('There is tribute peace until ' + new Date(s.raid_peace_until).toUTCString() + '.');
  const u = (await query('SELECT created_at FROM users WHERE id=$1', [s.user_id])).rows[0];
  if (u && now - Date.parse(u.created_at) < NEW_PLAYER_DAYS * 86400e3) reasons.push(`New players are safe for ${NEW_PLAYER_DAYS} days (account made ${new Date(u.created_at).toUTCString()}).`);
  const open = (await query('SELECT id FROM settlement_raids WHERE settlement_id=$1 AND resolved_at IS NULL', [s.id])).rows[0];
  if (open) reasons.push('A raid is already on its way.');
  const cd = cooldownUntil((await query('SELECT MAX(resolved_at) AS t FROM settlement_raids WHERE settlement_id=$1', [s.id])).rows[0].t, now);
  if (cd) reasons.push('Cooling down after the last raid until ' + new Date(cd).toUTCString() + '.');
  if (s.tile_q != null && !(await targetFor(s, await withered((t, p) => query(t, p)), (t, p) => query(t, p)))) reasons.push(`No Withered village or camp within ${REACH} tiles of your town or outposts.`);
  return reasons;
}
function cooldownUntil(lastResolved, now = Date.now()) {
  if (!lastResolved) return null;
  const until = Date.parse(lastResolved) + COOLDOWN_H * 3600e3;
  return until > now ? new Date(until).toISOString() : null;
}

// What the client sees. Before it strikes the strength is only a range
// (scoutRange: ±35% … ±5%); the exact number comes with the outcome.
function view(r, range) {
  if (!r) return null;
  const open = !r.resolved_at;
  const pct = range == null ? RANGE.base : range;
  return { id: r.id, target: r.target_name, outpost_id: r.outpost_id, from: r.from_name, from_npc_id: r.from_npc_id,
    strength: open ? null : r.strength,
    strength_min: open ? Math.max(1, Math.round(r.strength * (1 - pct))) : r.strength,
    strength_max: open ? Math.round(r.strength * (1 + pct)) : r.strength,
    warned_at: r.warned_at, arrives_at: r.arrives_at, resolved_at: r.resolved_at, outcome: r.outcome, defence: r.defence,
    loss_share: r.loss_share != null ? Number(r.loss_share) : null, loot: r.loot,
    sally: r.sally_run_id ? (r.sally_outcome || "fighting") : null, sally_run_id: r.sally_run_id || null };
}
async function activeFor(sid) {
  const r = (await query('SELECT * FROM settlement_raids WHERE settlement_id=$1 AND resolved_at IS NULL ORDER BY id DESC LIMIT 1', [sid]).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const s = (await query('SELECT * FROM settlements WHERE id=$1', [sid])).rows[0];
  const v = view(r, s ? await scoutRange(s) : RANGE.base);
  // Where they come from and where they're going, for the red trail.
  const from = r.from_npc_id ? (await query('SELECT tile_q AS q, tile_r AS r FROM npc_settlements WHERE id=$1', [r.from_npc_id]).catch(() => ({ rows: [] }))).rows[0] : null;
  const camp = r.from_camp_id ? (await query('SELECT q, r FROM withered_camps WHERE id=$1', [r.from_camp_id]).catch(() => ({ rows: [] }))).rows[0] : null;
  const o = r.outpost_id ? (await query('SELECT tile_q AS q, tile_r AS r FROM outposts WHERE id=$1', [r.outpost_id]).catch(() => ({ rows: [] }))).rows[0] : null;
  v.from_at = camp || from || null;
  v.target_at = o || (s && s.tile_q != null ? { q: s.tile_q, r: s.tile_r } : null);
  return v;
}

module.exports = {
  start, resolve, tick, cancel, whyNot, cooldownUntil, eligible, targetFor, defenceFor, strengthFor, activeFor, view, withered, scoutRange, tributeQuote, payTribute, injure,
  REACH, NEW_PLAYER_DAYS, COOLDOWN_H, WARN_H, DAYS_PER_RAID, CHECK_CHANCE, MILITIA, MILITIA_REACH, IDLE_H, STEAL_CAP, FULL_SHARE, RANGE,
  TRIBUTE_BASE, TRIBUTE_HOURS, TRIBUTE_STREAK_DAYS, TIER_INDEX,
};
