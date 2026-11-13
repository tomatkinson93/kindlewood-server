// ══════════════════════════════════════════════════════════════════════════
//  milestones — the first time each player reaches each step (player_milestones),
//  so we can see where new players stop.
//
//  Recorded without touching the routes: `middleware` watches successful
//  requests and matches them against RULES. Births are marked from
//  simulation.js. Each (player, step) is written once; a small in-memory set
//  keeps repeat requests from asking the database again.
//
//    STEPS     the funnel, in order (registered comes from users.created_at)
//    mark(userId, key)
//    funnel(days) → { players, steps: [{ key, label, players, pct, median_minutes }] }
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const STEPS = [
  ['registered',            'Made an account'],
  ['placed',                'Founded a town'],
  ['seen',                  'Loaded the game'],
  ['first_building',        'Built something'],
  ['first_job',             'Changed a citizen\'s job'],
  ['first_quest_sent',      'Sent someone on a quest'],
  ['first_quest_collected', 'Collected a quest reward'],
  ['first_scout',           'Sent a scout'],
  ['first_outpost',         'Founded an outpost'],
  ['first_research',        'Started research'],
  ['first_birth',           'A child was born'],
  ['first_coming_of_age',   'A child came of age'],
  ['first_moment',          'Answered a moment'],
  ['first_inheritance',     'An heir took up a family\'s things'],
  ['return_d1',             'Came back the next day'],
  ['village',               'Grew past a Camp'],
  ['return_d7',             'Came back after a week'],
];

// [method, path pattern, step]
const RULES = [
  ['POST',  /^\/api\/map\/(arrive|place)$/,             'placed'],
  ['POST',  /^\/api\/buildings\/build$/,                'first_building'],
  ['PATCH', /^\/api\/citizens\/\d+\/role$/,             'first_job'],
  ['POST',  /^\/api\/quests\/accept$/,                  'first_quest_sent'],
  ['POST',  /^\/api\/quests\/collect\/[^/]+$/,          'first_quest_collected'],
  ['POST',  /^\/api\/expeditions\/send$/,               'first_scout'],
  ['POST',  /^\/api\/game\/outposts\/build$/,           'first_outpost'],
  ['POST',  /^\/api\/research\/(start|queue)$/,         'first_research'],
  ['POST',  /^\/api\/game\/upgrade-tier$/,              'village'],
];

const _done = new Set();          // `${userId}:${key}` already written (this process)
const _joined = new Map();        // userId → registration time (ms)

async function mark(userId, key) {
  const id = Number(userId);
  if (!Number.isFinite(id) || !key) return false;
  const k = id + ':' + key;
  if (_done.has(k)) return false;
  _done.add(k);
  try {
    const r = await query('INSERT INTO player_milestones (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, key]);
    return r.rowCount > 0;
  } catch (e) {
    _done.delete(k);
    if (!(e && (e.code === '42P01' || e.code === '23503'))) console.error('[milestones]', e.message);
    return false;
  }
}

// Loading the game: "seen" the first time, then the two return marks.
async function seen(userId, now = Date.now()) {
  const id = Number(userId);
  await mark(id, 'seen');
  if (_done.has(id + ':return_d7')) return;
  let at = _joined.get(id);
  if (at == null) {
    const r = await query('SELECT created_at FROM users WHERE id=$1', [id]).catch(() => ({ rows: [] }));
    if (!r.rows[0]) return;
    at = new Date(r.rows[0].created_at).getTime();
    _joined.set(id, at);
  }
  const hours = (now - at) / 3600000;
  if (hours >= 20) await mark(id, 'return_d1');
  if (hours >= 6.5 * 24) await mark(id, 'return_d7');
}

// Express middleware: after a successful request, mark what it was.
function middleware(req, res, next) {
  res.on('finish', () => {
    try {
      if (res.statusCode >= 300 || !req.user || !req.user.userId) return;
      const p = (req.originalUrl || '').split('?')[0];
      if (req.method === 'GET' && p === '/api/game/settlement') return void seen(req.user.userId);
      for (const [m, re, key] of RULES) if (m === req.method && re.test(p)) return void mark(req.user.userId, key);
    } catch (e) { /* never break a request */ }
  });
  next();
}

// A child born in a settlement (simulation.js).
async function birth(settlementId) {
  const r = await query('SELECT user_id FROM settlements WHERE id=$1', [settlementId]).catch(() => ({ rows: [] }));
  if (r.rows[0]) await mark(r.rows[0].user_id, 'first_birth');
}

// Any other town event (lib/life.js: comings of age, inheritances, …).
async function town(settlementId, key) {
  const r = await query('SELECT user_id FROM settlements WHERE id=$1', [settlementId]).catch(() => ({ rows: [] }));
  if (r.rows[0]) await mark(r.rows[0].user_id, key);
}

// The funnel for players who registered in the last `days` days.
async function funnel(days = 30) {
  const d = Math.max(1, Math.min(3650, Math.round(Number(days) || 30)));
  const total = Number((await query(`SELECT COUNT(*)::int AS n FROM users WHERE created_at >= NOW() - make_interval(days => $1)`, [d])).rows[0].n);
  const rows = (await query(
    `SELECT m.key, COUNT(*)::int AS players,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (m.reached_at - u.created_at)) / 60) AS median_minutes
       FROM player_milestones m JOIN users u ON u.id = m.user_id
      WHERE u.created_at >= NOW() - make_interval(days => $1) GROUP BY m.key`, [d])).rows;
  const by = Object.fromEntries(rows.map(r => [r.key, r]));
  const steps = STEPS.map(([key, label]) => {
    const n = key === 'registered' ? total : (by[key] ? by[key].players : 0);
    return { key, label, players: n, pct: total ? Math.round(n / total * 1000) / 10 : 0,
      median_minutes: key === 'registered' ? 0 : (by[key] ? Math.round(Number(by[key].median_minutes)) : null) };
  });
  return { days: d, players: total, steps };
}

module.exports = { STEPS, RULES, mark, seen, birth, town, middleware, funnel, _reset() { _done.clear(); _joined.clear(); } };
