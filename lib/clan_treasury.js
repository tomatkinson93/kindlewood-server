// ══════════════════════════════════════════════════════════════════════════
//  clan_treasury — a clan's shared wealth and what it buys.
//
//  Donations  any member, up to DONATE_DAILY_CAP wealth a UTC day; every
//             PRESTIGE_PER wealth earns 1 prestige (the normal daily cap
//             applies — lib/clan_subscriber).
//  Boons      bought from the treasury by ranks with `treasury` permission,
//             BOON_DAYS days each, one of each kind at a time. Cost grows with
//             the roster. Every member's town gets the boon's mods/effects
//             (lib/town_mods → production, happiness, research, crafting,
//             Market fee, raid defence).
//  Land       each claimed tile pays LAND_INCOME wealth a day into the
//             treasury (tick); a member's outpost on clan land works
//             +LAND_OUTPOST_BONUS and gets +LAND_DEFENCE against raids
//             (lib/outpost_state, lib/raids).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');

const DONATE_DAILY_CAP = 2000;
const PRESTIGE_PER = 10;
const BOON_DAYS = 7;
const LAND_INCOME = 2;
const LAND_OUTPOST_BONUS = 0.10;
const LAND_DEFENCE = 10;
const BOONS = {
  bountiful_fields: { label: 'Bountiful Fields', icon: '🌾', desc: '+5% food in every member\'s town.', mods: { food_production: 0.05 } },
  steady_hands:     { label: 'Steady Hands',     icon: '⚒️', desc: '+5% crafting speed for every member.', effects: { craft_speed: 0.05 } },
  scholars_circle:  { label: 'Scholars\' Circle', icon: '📜', desc: '+5% research for every member.', effects: { research: 0.05 } },
  iron_wall:        { label: 'Iron Wall',        icon: '🛡️', desc: '+20 defence against raids for every member.', effects: { raid_defence: 20 } },
  trade_pact:       { label: 'Trade Pact',       icon: '💰', desc: '−5% Market fees for every member.', effects: { market_fee: -0.05 } },
};
const boonCost = members => 300 + 60 * Math.max(1, members | 0);
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const err = (status, msg) => Object.assign(new Error(msg), { status });

async function clanOf(userId, db) {
  const run = db ? (t, p) => db.query(t, p) : query;
  return (await run('SELECT cm.clan_id, cm.rank, c.treasury, c.name FROM clan_members cm JOIN clans c ON c.id = cm.clan_id WHERE cm.user_id = $1', [userId])).rows[0] || null;
}

async function donate(userId, amount) {
  amount = Math.floor(Number(amount));
  if (!(amount > 0)) throw err(400, 'Give at least 1 wealth.');
  const today = utcDay();
  const out = await withTransaction(async client => {
    const m = (await client.query(
      `SELECT cm.clan_id, cm.donated_day::text AS day, cm.donated_today FROM clan_members cm WHERE cm.user_id = $1 FOR UPDATE`, [userId])).rows[0];
    if (!m) throw err(403, 'You are not in a clan.');
    const given = m.day === today ? m.donated_today : 0;
    if (given + amount > DONATE_DAILY_CAP) throw err(400, `You can give at most ${DONATE_DAILY_CAP} a day (${Math.max(0, DONATE_DAILY_CAP - given)} left today).`);
    const s = await client.query('UPDATE settlements SET wealth = wealth - $2 WHERE user_id = $1 AND wealth >= $2 RETURNING wealth', [userId, amount]);
    if (!s.rowCount) throw err(400, 'Not enough wealth.');
    await client.query('UPDATE clan_members SET donated_day = $2, donated_today = $3 WHERE user_id = $1', [userId, today, given + amount]);
    const c = (await client.query('UPDATE clans SET treasury = treasury + $2 WHERE id = $1 RETURNING treasury', [m.clan_id, amount])).rows[0];
    await client.query("INSERT INTO clan_treasury_log (clan_id, user_id, kind, amount) VALUES ($1,$2,'donate',$3)", [m.clan_id, userId, amount]);
    return { clanId: m.clan_id, treasury: Number(c.treasury), wealth: Number(s.rows[0].wealth), left: DONATE_DAILY_CAP - given - amount };
  });
  const pr = await require('./clan_subscriber').awardPrestige({ userId, raw: Math.floor(amount / PRESTIGE_PER), source: 'donation', detail: { amount } });
  try { require('./event_bus').publish(`clan:${out.clanId}`, { type: 'clan_treasury', clan_id: out.clanId }); } catch (e) { /* offline */ }
  return { ...out, prestige: pr ? pr.effective : 0 };
}

async function activeBoons(clanId, db) {
  const run = db ? (t, p) => db.query(t, p) : query;
  return (await run('SELECT boon_key, until, started_at FROM clan_boons WHERE clan_id = $1 AND until > NOW()', [clanId]).catch(() => ({ rows: [] }))).rows;
}

async function buyBoon(userId, key) {
  const def = BOONS[key];
  if (!def) throw err(404, 'No such boon.');
  const perm = await require('./clan_permissions').checkClanPermission(userId, 'treasury');
  if (!perm) throw err(403, 'You are not in a clan.');
  if (!perm.allowed) throw err(403, 'Your rank can\'t spend the treasury.');
  return withTransaction(async client => {
    const c = (await client.query('SELECT id, treasury FROM clans WHERE id = $1 FOR UPDATE', [perm.clanId])).rows[0];
    const members = Number((await client.query('SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [c.id])).rows[0].n);
    const cost = boonCost(members);
    const live = (await client.query('SELECT until FROM clan_boons WHERE clan_id = $1 AND boon_key = $2 AND until > NOW()', [c.id, key])).rows[0];
    if (live) throw err(400, `${def.label} is already active.`);
    if (Number(c.treasury) < cost) throw err(400, `The treasury needs ${cost} wealth for ${def.label}.`);
    await client.query('UPDATE clans SET treasury = treasury - $2 WHERE id = $1', [c.id, cost]);
    const b = (await client.query(
      `INSERT INTO clan_boons (clan_id, boon_key, bought_by, started_at, until) VALUES ($1,$2,$3,NOW(), NOW() + make_interval(days => $4))
       ON CONFLICT (clan_id, boon_key) DO UPDATE SET bought_by = $3, started_at = NOW(), until = NOW() + make_interval(days => $4) RETURNING until`,
      [c.id, key, userId, BOON_DAYS])).rows[0];
    await client.query("INSERT INTO clan_treasury_log (clan_id, user_id, kind, amount, detail) VALUES ($1,$2,'boon',$3,$4)", [c.id, userId, -cost, JSON.stringify({ boon: key })]);
    await client.query("INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'boon_bought',$2,$3)", [c.id, userId, JSON.stringify({ boon: key, label: def.label, cost })]).catch(() => {});
    return { boon: key, until: b.until, cost };
  });
}

// What a member's town gets from its clan: { mods, effects, sources }.
async function memberBonuses(db, settlement) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const out = { mods: {}, effects: {}, sources: [] };
  const m = (await run('SELECT clan_id FROM clan_members WHERE user_id = $1', [settlement.user_id]).catch(() => ({ rows: [] }))).rows[0];
  if (!m) return out;
  for (const b of await activeBoons(m.clan_id, { query: run })) {
    const def = BOONS[b.boon_key];
    if (!def) continue;
    for (const [k, v] of Object.entries(def.mods || {})) out.mods[k] = (out.mods[k] || 0) + v;
    for (const [k, v] of Object.entries(def.effects || {})) out.effects[k] = (out.effects[k] || 0) + v;
    out.sources.push({ key: 'boon:' + b.boon_key, label: `🛡 Clan boon: ${def.label}`, until: b.until, ...(def.mods || {}), ...(def.effects || {}) });
  }
  return out;
}

// The clan whose land a tile is, for a settlement's owner: true when it's
// their own clan's.
async function onClanLand(db, userId, q, r) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const x = (await run(`SELECT 1 FROM clan_territory t JOIN clan_members cm ON cm.clan_id = t.clan_id
                         WHERE cm.user_id = $1 AND t.q = $2 AND t.r = $3`, [userId, q, r]).catch(() => ({ rows: [] }))).rows[0];
  return !!x;
}

// Daily: land pays the treasury.
let _lastLand = 0;
async function tick() {
  if (Date.now() - _lastLand < 10 * 60 * 1000) return;
  _lastLand = Date.now();
  try {
    const due = (await query(
      `UPDATE clans c SET treasury = treasury + t.n * $1, territory_paid_on = CURRENT_DATE
         FROM (SELECT clan_id, COUNT(*)::int AS n FROM clan_territory GROUP BY clan_id) t
        WHERE t.clan_id = c.id AND (c.territory_paid_on IS NULL OR c.territory_paid_on < CURRENT_DATE)
        RETURNING c.id, t.n`, [LAND_INCOME])).rows;
    for (const d of due) {
      await query("INSERT INTO clan_treasury_log (clan_id, kind, amount, detail) VALUES ($1,'territory',$2,$3)", [d.id, d.n * LAND_INCOME, JSON.stringify({ tiles: d.n })]);
    }
  } catch (e) { console.error('[clan_treasury]', e.message); }
}

async function view(userId) {
  const m = await clanOf(userId);
  if (!m) return null;
  const members = Number((await query('SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [m.clan_id])).rows[0].n);
  const me = (await query('SELECT donated_day::text AS day, donated_today FROM clan_members WHERE user_id = $1', [userId])).rows[0];
  const given = me && me.day === utcDay() ? me.donated_today : 0;
  const perm = await require('./clan_permissions').checkClanPermission(userId, 'treasury');
  const live = Object.fromEntries((await activeBoons(m.clan_id)).map(b => [b.boon_key, b]));
  const log = (await query(
    `SELECT l.kind, l.amount, l.detail, l.created_at, u.username FROM clan_treasury_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.clan_id = $1 ORDER BY l.id DESC LIMIT 20`, [m.clan_id])).rows;
  const tiles = Number((await query('SELECT COUNT(*)::int AS n FROM clan_territory WHERE clan_id = $1', [m.clan_id])).rows[0].n);
  const cost = boonCost(members);
  return {
    treasury: Number(m.treasury), can_spend: !!(perm && perm.allowed), members,
    donate: { cap: DONATE_DAILY_CAP, given_today: given, left_today: Math.max(0, DONATE_DAILY_CAP - given), prestige_per: PRESTIGE_PER },
    land: { tiles, income_per_day: tiles * LAND_INCOME, outpost_bonus: LAND_OUTPOST_BONUS, defence: LAND_DEFENCE },
    boons: Object.entries(BOONS).map(([key, b]) => ({ key, label: b.label, icon: b.icon, desc: b.desc, cost, days: BOON_DAYS, active: !!live[key], until: live[key] ? live[key].until : null })),
    log: log.map(l => ({ kind: l.kind, amount: l.amount, who: l.username || null, detail: l.detail, at: l.created_at })),
  };
}

module.exports = {
  donate, buyBoon, activeBoons, memberBonuses, onClanLand, tick, view, clanOf, boonCost,
  BOONS, DONATE_DAILY_CAP, PRESTIGE_PER, BOON_DAYS, LAND_INCOME, LAND_OUTPOST_BONUS, LAND_DEFENCE,
};
