// ══════════════════════════════════════════════════════════════════════════
//  rankings — the Rankings boards (GET /api/stats/board/:id).
//
//  board(id, userId) → { columns, rows: [{ rank, name, sub, values, you }], you }
//    name/sub are what the row shows (a ruler or citizen, and their town);
//    only public numbers are returned — no ids, no emails.
//  Boards: score, wealth, population (settlements), skilled, oldest,
//  adventurous (citizens), squirrel (tavern), biggest, mostfish (fishing).
//  Overall Score = tier × 1000 + building levels × 25 + living citizens × 20
//                  + finished research × 40.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const { TIER_ORDER } = require('../buildings');

const TOP = 25;
const SCORE = { tier: 1000, building_level: 25, citizen: 20, research: 40 };
const LIVING = "COALESCE(c.life_stage, 'adult') <> 'deceased'";
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// Rank a full list (sorted already) and cut it to the top, marking the
// viewer's own row and keeping their place if they're further down.
function ranked(list, userId, columns) {
  list.forEach((r, i) => { r.rank = i + 1; r.you = userId != null && r.user_id === userId; });
  const mine = list.find(r => r.you) || null;
  const clean = r => ({ rank: r.rank, name: r.name, sub: r.sub, values: r.values, you: r.you });
  return { columns, rows: list.slice(0, TOP).map(clean), you: mine && mine.rank > TOP ? clean(mine) : null };
}

const SETTLEMENTS = `
  SELECT s.id, s.user_id, s.name AS town, u.username, s.tier, s.wealth,
         (SELECT COALESCE(SUM(b.level), 0) FROM buildings b WHERE b.settlement_id = s.id)::int AS building_levels,
         (SELECT COUNT(*) FROM citizens c WHERE c.settlement_id = s.id AND ${LIVING})::int AS citizens,
         (SELECT COUNT(*) FROM settlement_research r WHERE r.settlement_id = s.id AND r.done_at IS NOT NULL)::int AS research
    FROM settlements s JOIN users u ON u.id = s.user_id
   WHERE s.tile_q IS NOT NULL`;

function score(s) {
  return Math.max(0, TIER_ORDER.indexOf(s.tier || 'camp')) * SCORE.tier + s.building_levels * SCORE.building_level
    + s.citizens * SCORE.citizen + s.research * SCORE.research;
}

const BOARDS = {
  async score(userId) {
    const rows = (await query(SETTLEMENTS)).rows.map(s => ({ ...s, score: score(s) }))
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
    return ranked(rows.map(s => ({ user_id: s.user_id, name: s.username, sub: `${s.town} · ${cap(s.tier)}`,
      values: [s.score.toLocaleString('en-GB'), cap(s.tier)] })), userId, ['Score', 'Tier']);
  },
  async wealth(userId) {
    const rows = (await query(SETTLEMENTS)).rows.sort((a, b) => Number(b.wealth) - Number(a.wealth));
    return ranked(rows.map(s => ({ user_id: s.user_id, name: s.username, sub: s.town,
      values: [Math.floor(Number(s.wealth) || 0).toLocaleString('en-GB')] })), userId, ['Wealth']);
  },
  async population(userId) {
    const rows = (await query(SETTLEMENTS)).rows.sort((a, b) => b.citizens - a.citizens || b.building_levels - a.building_levels);
    return ranked(rows.map(s => ({ user_id: s.user_id, name: s.username, sub: s.town, values: [s.citizens] })), userId, ['Citizens']);
  },
  async skilled(userId) {
    const C = require('./careers/classes').CLASSES;
    const rows = (await query(`
      SELECT DISTINCT ON (c.id) c.name, cc.class_key, cc.level, cc.xp, s.name AS town, s.user_id
        FROM citizen_classes cc JOIN citizens c ON c.id = cc.citizen_id JOIN settlements s ON s.id = c.settlement_id
       WHERE ${LIVING}
       ORDER BY c.id, cc.level DESC, cc.xp DESC`)).rows
      .sort((a, b) => b.level - a.level || Number(b.xp) - Number(a.xp));
    return ranked(rows.map(r => {
      const d = C[r.class_key] || {};
      return { user_id: r.user_id, name: r.name, sub: r.town, values: [`${d.icon || ''} ${d.label || r.class_key}`.trim(), `Lv ${r.level}`] };
    }), userId, ['Career', 'Level']);
  },
  async oldest(userId) {
    const rows = (await query(`
      SELECT c.name, c.born_at, s.name AS town, s.user_id
        FROM citizens c JOIN settlements s ON s.id = c.settlement_id
       WHERE ${LIVING} AND c.born_at IS NOT NULL ORDER BY c.born_at ASC LIMIT 500`)).rows;
    const days = d => Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000));
    return ranked(rows.map(r => ({ user_id: r.user_id, name: r.name, sub: r.town, values: [`${days(r.born_at)} days`] })), userId, ['Age']);
  },
  async adventurous(userId) {
    const rows = (await query(`
      SELECT c.name, s.name AS town, s.user_id, x.n
        FROM (SELECT q.cid, COUNT(*)::int AS n
                FROM (SELECT jsonb_array_elements_text(COALESCE(party_ids, jsonb_build_array(citizen_id)))::int AS cid
                        FROM settlement_quests WHERE status IN ('completed', 'collected')) q
               GROUP BY q.cid) x
        JOIN citizens c ON c.id = x.cid JOIN settlements s ON s.id = c.settlement_id
       WHERE ${LIVING} ORDER BY x.n DESC, c.name LIMIT 500`)).rows;
    return ranked(rows.map(r => ({ user_id: r.user_id, name: r.name, sub: r.town, values: [r.n] })), userId, ['Quests won']);
  },
  async squirrel(userId) {
    await require('./game_stats_store').ready();
    const rows = (await query(`SELECT u.username, g.user_id, g.wins, g.games FROM game_stats g JOIN users u ON u.id = g.user_id
                                WHERE g.game = 'squirrel' AND g.games > 0 ORDER BY g.wins DESC, g.games ASC LIMIT 500`)).rows;
    return ranked(rows.map(r => ({ user_id: r.user_id, name: r.username, sub: '', values: [r.wins, r.games] })), userId, ['Wins', 'Games']);
  },
  async biggest(userId) {
    const rows = (await query(`
      SELECT DISTINCT ON (f.user_id) f.user_id, u.username, f.fish_name, f.value
        FROM fishing_catches f JOIN users u ON u.id = f.user_id
       ORDER BY f.user_id, f.value DESC, f.caught_at ASC`)).rows
      .sort((a, b) => b.value - a.value || a.username.localeCompare(b.username));
    return ranked(rows.map(r => ({ user_id: r.user_id, name: r.username, sub: '', values: [r.fish_name, `${r.value} gold`] })), userId, ['Best catch', 'Worth']);
  },
  async mostfish(userId) {
    const rows = (await query(`SELECT f.user_id, u.username, COUNT(*)::int AS n FROM fishing_catches f JOIN users u ON u.id = f.user_id
                                GROUP BY f.user_id, u.username ORDER BY n DESC, u.username LIMIT 500`)).rows;
    return ranked(rows.map(r => ({ user_id: r.user_id, name: r.username, sub: '', values: [r.n] })), userId, ['Fish']);
  },
};

async function board(id, userId) {
  const fn = BOARDS[id];
  if (!fn) return null;
  return fn(userId == null ? null : Number(userId));
}

// A landed fish, for the fishing boards.
async function recordCatch(userId, fish) {
  if (!fish) return;
  await query('INSERT INTO fishing_catches (user_id, fish_id, fish_name, value) VALUES ($1,$2,$3,$4)',
    [userId, fish.id, fish.name, Number(fish.value) || 0]);
}

module.exports = { board, recordCatch, BOARDS: Object.keys(BOARDS), SCORE, score, TOP };
