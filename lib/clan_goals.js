// ══════════════════════════════════════════════════════════════════════════
//  clan_goals — three goals a week for each clan, and clan honors.
//
//  Each ISO week (Monday 00:00 UTC) a clan draws GOALS_PER_WEEK goals from
//  POOL (seeded by clan + week, targets scaled to the roster). Progress is
//  counted straight from the game's own records for the clan's current
//  members since the week began — quests, battles, crafts, raids, wonder
//  stages, donations — so nothing has to be tracked as it happens.
//  A goal met pays GOAL_PRESTIGE prestige and GOAL_TREASURY treasury, once
//  (refresh/tick). All three in a week counts toward the goal honors.
//
//  Honors (clan_honors) are earned once, from data: goal weeks, land, level
//  and members' wonders. They show on the clan profile.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');

const GOALS_PER_WEEK = 3;
const GOAL_PRESTIGE = 60;
const GOAL_TREASURY = 150;
const POOL = [
  { key: 'quests',  icon: '📜', label: n => `Finish ${n} quests`,                 lo: 8,    hi: 30 },
  { key: 'battles', icon: '⚔️', label: n => `Win ${n} battles`,                   lo: 4,    hi: 15 },
  { key: 'crafts',  icon: '⚒️', label: n => `Craft ${n} items`,                   lo: 6,    hi: 24 },
  { key: 'donate',  icon: '💰', label: n => `Give ${n} wealth to the treasury`,   lo: 1000, hi: 5000 },
  { key: 'raids',   icon: '🛡️', label: n => `Repel ${n} raid${n === 1 ? '' : 's'}`, lo: 1, hi: 3, minLevel: 2 },
  { key: 'wonder',  icon: '🏛', label: n => `Finish ${n} wonder stage${n === 1 ? '' : 's'}`, lo: 1, hi: 2, minLevel: 5 },
];
const HONORS = {
  goals_1:   { icon: '🎯', label: 'A Week\'s Work',   desc: 'Met all three weekly goals.' },
  goals_4:   { icon: '🏅', label: 'Four Weeks Strong', desc: 'Met every weekly goal in four weeks.' },
  goals_12:  { icon: '🏆', label: 'A Season of Purpose', desc: 'Met every weekly goal in twelve weeks.' },
  land_16:   { icon: '🗺', label: 'Broad Lands',      desc: 'Held 16 tiles of territory.' },
  land_48:   { icon: '👑', label: 'A Realm',           desc: 'Held 48 tiles of territory.' },
  level_5:   { icon: '⭐', label: 'Rising Banner',     desc: 'Reached clan level 5.' },
  level_10:  { icon: '🌟', label: 'Legendary Banner',  desc: 'Reached clan level 10.' },
  wonders_1: { icon: '🏛', label: 'Builders of Wonders', desc: 'A member finished a Wonder.' },
  wonders_5: { icon: '✨', label: 'Age of Wonders',    desc: 'Members finished five Wonders.' },
};

// ISO week id and its Monday 00:00 UTC.
function weekOf(ms = Date.now()) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;   // Monday = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  const th = new Date(monday + 3 * 86400e3);   // the week's Thursday decides the year
  const wk = Math.ceil(((th - Date.UTC(th.getUTCFullYear(), 0, 1)) / 86400e3 + 1) / 7);
  return { id: `${th.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`, start: new Date(monday), ends: new Date(monday + 7 * 86400e3) };
}

function drawGoals(clanId, week, members, level) {
  const rng = require('./clan_quests').seededRng(`goals:${clanId}:${week}`);
  const pool = POOL.filter(g => !g.minLevel || level >= g.minLevel);
  const out = [];
  const scale = Math.min(1, Math.max(0, (members - 1) / 9));
  while (pool.length && out.length < GOALS_PER_WEEK) {
    const g = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    let n = Math.round(g.lo + (g.hi - g.lo) * scale);
    if (g.key === 'donate') n = Math.round(n / 100) * 100;
    out.push({ key: g.key, icon: g.icon, label: g.label(n), target: n });
  }
  return out;
}

// Progress toward one goal since `since`, for the clan's current members.
async function progressOf(clanId, key, since, db) {
  const q = db ? (t, p) => db.query(t, p) : query;
  const members = `SELECT s.id FROM settlements s JOIN clan_members cm ON cm.user_id = s.user_id WHERE cm.clan_id = $1`;
  const one = async (sql) => Number((await q(sql, [clanId, since]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n) || 0;
  switch (key) {
    case 'quests':  return one(`SELECT COUNT(*)::int AS n FROM settlement_quests WHERE settlement_id IN (${members}) AND status IN ('completed','collected') AND completes_at >= $2`);
    case 'battles': return one(`SELECT COUNT(*)::int AS n FROM settlement_quests WHERE settlement_id IN (${members}) AND combat_outcome = 'victory' AND combat_resolved_at >= $2`);
    case 'crafts':  return one(`SELECT COUNT(*)::int AS n FROM craft_jobs WHERE settlement_id IN (${members}) AND status = 'done' AND finished_at >= $2`);
    case 'raids':   return one(`SELECT COUNT(*)::int AS n FROM settlement_raids WHERE settlement_id IN (${members}) AND outcome = 'repelled' AND resolved_at >= $2`);
    case 'wonder':  return one(`SELECT COUNT(*)::int AS n FROM settlement_events WHERE settlement_id IN (${members}) AND type = 'wonder' AND created_at >= $2`);
    case 'donate':  return one(`SELECT COALESCE(SUM(amount), 0)::int AS n FROM clan_treasury_log WHERE clan_id = $1 AND kind = 'donate' AND created_at >= $2`);
    default: return 0;
  }
}

// This week's board for a clan, paying out any goal newly met. Returns
// { week, ends_at, goals: [{ key, icon, label, target, progress, done }], all_done, weeks_done }.
async function refresh(clanId, now = Date.now()) {
  const w = weekOf(now);
  const clan = (await query('SELECT id, level FROM clans WHERE id = $1', [clanId])).rows[0];
  if (!clan) return null;
  const members = Number((await query('SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [clanId])).rows[0].n);
  await query('INSERT INTO clan_weekly_goals (clan_id, week, goals) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [clanId, w.id, JSON.stringify(drawGoals(clanId, w.id, members, clan.level))]);
  const row = (await query('SELECT * FROM clan_weekly_goals WHERE clan_id = $1 AND week = $2', [clanId, w.id])).rows[0];
  const goals = [];
  for (const g of row.goals) goals.push({ ...g, progress: await progressOf(clanId, g.key, w.start) });
  const newly = goals.filter(g => g.progress >= g.target && !row.completed.includes(g.key)).map(g => g.key);
  if (newly.length) {
    const paid = await withTransaction(async client => {
      const cur = (await client.query('SELECT completed FROM clan_weekly_goals WHERE clan_id = $1 AND week = $2 FOR UPDATE', [clanId, w.id])).rows[0];
      const fresh = newly.filter(k => !cur.completed.includes(k));
      if (!fresh.length) return [];
      const done = [...cur.completed, ...fresh];
      const all = done.length >= row.goals.length;
      await client.query(`UPDATE clan_weekly_goals SET completed = $3, all_done_at = CASE WHEN $4 THEN NOW() ELSE all_done_at END WHERE clan_id = $1 AND week = $2`,
        [clanId, w.id, JSON.stringify(done), all]);
      await client.query('UPDATE clans SET treasury = treasury + $2 WHERE id = $1', [clanId, GOAL_TREASURY * fresh.length]);
      for (const k of fresh) {
        await client.query("INSERT INTO clan_treasury_log (clan_id, kind, amount, detail) VALUES ($1,'goal',$2,$3)", [clanId, GOAL_TREASURY, JSON.stringify({ goal: k, week: w.id })]);
        const g = await require('./clan_subscriber').grantPrestige(client, clanId, GOAL_PRESTIGE);
        if (g) await require('./clan_subscriber').applyLevelUp(client, clanId, g.prestige_lifetime);
        await client.query("INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'goal_met',NULL,$2)",
          [clanId, JSON.stringify({ goal: k, label: (row.goals.find(x => x.key === k) || {}).label, prestige: GOAL_PRESTIGE, treasury: GOAL_TREASURY })]).catch(() => {});
      }
      return fresh;
    });
    if (paid.length) {
      row.completed = [...row.completed, ...paid];
      try { require('./event_bus').publish(`clan:${clanId}`, { type: 'clan_goal_met', clan_id: clanId, goals: paid }); } catch (e) { /* offline */ }
      try { require('./clan_chat').systemLine(clanId, `🎯 Weekly goal met: ${paid.map(k => (row.goals.find(x => x.key === k) || {}).label).join(', ')}!`); } catch (e) { /* no chat */ }
    }
  }
  const weeksDone = Number((await query('SELECT COUNT(*)::int AS n FROM clan_weekly_goals WHERE clan_id = $1 AND all_done_at IS NOT NULL', [clanId])).rows[0].n);
  await awardHonors(clanId);
  return {
    week: w.id, ends_at: w.ends.toISOString(), reward: { prestige: GOAL_PRESTIGE, treasury: GOAL_TREASURY },
    goals: goals.map(g => ({ ...g, done: row.completed.includes(g.key) })),
    all_done: row.completed.length >= row.goals.length, weeks_done: weeksDone,
  };
}

// Earn any honor the clan now qualifies for (once each). Returns new keys.
async function awardHonors(clanId) {
  const c = (await query('SELECT level FROM clans WHERE id = $1', [clanId])).rows[0];
  if (!c) return [];
  const weeks = Number((await query('SELECT COUNT(*)::int AS n FROM clan_weekly_goals WHERE clan_id = $1 AND all_done_at IS NOT NULL', [clanId])).rows[0].n);
  const land = Number((await query('SELECT COUNT(*)::int AS n FROM clan_territory WHERE clan_id = $1', [clanId])).rows[0].n);
  const wonders = Number((await query(
    `SELECT COUNT(*)::int AS n FROM settlement_wonders w JOIN settlements s ON s.id = w.settlement_id JOIN clan_members cm ON cm.user_id = s.user_id
      WHERE cm.clan_id = $1 AND w.completed_at IS NOT NULL`, [clanId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
  const earn = [];
  if (weeks >= 1) earn.push('goals_1'); if (weeks >= 4) earn.push('goals_4'); if (weeks >= 12) earn.push('goals_12');
  if (land >= 16) earn.push('land_16'); if (land >= 48) earn.push('land_48');
  if (c.level >= 5) earn.push('level_5'); if (c.level >= 10) earn.push('level_10');
  if (wonders >= 1) earn.push('wonders_1'); if (wonders >= 5) earn.push('wonders_5');
  const fresh = [];
  for (const k of earn) {
    const r = await query('INSERT INTO clan_honors (clan_id, honor_key) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING honor_key', [clanId, k]);
    if (r.rows.length) {
      fresh.push(k);
      await query("INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'honor_earned',NULL,$2)", [clanId, JSON.stringify({ honor: k, label: HONORS[k].label })]).catch(() => {});
    }
  }
  return fresh;
}

async function honorsOf(clanId) {
  const rows = (await query('SELECT honor_key, earned_at FROM clan_honors WHERE clan_id = $1 ORDER BY earned_at', [clanId]).catch(() => ({ rows: [] }))).rows;
  return rows.filter(r => HONORS[r.honor_key]).map(r => ({ key: r.honor_key, ...HONORS[r.honor_key], earned_at: r.earned_at }));
}

// Hourly: refresh every clan's goals (pays goals met while nobody looked).
let _last = 0;
async function tick() {
  if (Date.now() - _last < 60 * 60 * 1000) return;
  _last = Date.now();
  try {
    for (const c of (await query('SELECT id FROM clans')).rows) await refresh(c.id).catch(e => console.error('[clan_goals]', c.id, e.message));
  } catch (e) { console.error('[clan_goals]', e.message); }
}

module.exports = { refresh, awardHonors, honorsOf, drawGoals, progressOf, weekOf, tick, POOL, HONORS, GOAL_PRESTIGE, GOAL_TREASURY, GOALS_PER_WEEK };
