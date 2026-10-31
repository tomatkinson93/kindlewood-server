// ══════════════════════════════════════════════════════════════════════════
//  tavern_pay — wealth and stats for tavern card games, decided here.
//
//  Multiplayer games finish on the server (lib/game_rooms.js finishMatch),
//  which calls payWin() for the winner. Solo games run in the browser, so
//  the server only pays against a ticket it issued when the game started:
//    soloStart(userId, game)            → ticket (voids that game's older open ones)
//    soloFinish(userId, ticket, won)    → { won, paid, capped }
//  A ticket works once, and a win only counts after MIN_SOLO_SECONDS.
//  Either way at most DAILY_PAID_WINS wins a day (UTC) pay WIN_GOLD; later
//  wins still count for the rankings.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const stats = require('./game_stats_store');

const WIN_GOLD = 4;
const DAILY_PAID_WINS = 10;
const MIN_SOLO_SECONDS = 45;
const GAMES = ['briar', 'squirrel'];

class TavernError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const newId = () => crypto.randomBytes(16).toString('hex');

async function paidToday(db, userId) {
  return Number((await db.query(
    `SELECT COUNT(*)::int AS n FROM tavern_games
      WHERE user_id = $1 AND paid > 0 AND used_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [userId])).rows[0].n);
}

// Pays a win if today's cap allows; returns the wealth paid (0 when capped).
async function payout(db, userId) {
  if (await paidToday(db, userId) >= DAILY_PAID_WINS) return 0;
  const r = await db.query('UPDATE settlements SET wealth = wealth + $2 WHERE user_id = $1', [userId, WIN_GOLD]);
  return r.rowCount ? WIN_GOLD : 0;
}

// A multiplayer win the server saw happen. Locks the user's rows so two
// finishes can't both slip under the cap.
async function payWin(userId, game) {
  return withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tavern:' + userId]);
    const paid = await payout(client, userId);
    await client.query(`INSERT INTO tavern_games (id, user_id, game, mode, used_at, won, paid) VALUES ($1,$2,$3,'multiplayer',NOW(),TRUE,$4)`,
      [newId(), userId, game, paid]);
    return paid;
  });
}

async function soloStart(userId, game) {
  if (!GAMES.includes(game)) throw new TavernError(400, 'Unknown game.');
  const id = newId();
  // One open game at a time per kind: starting again forfeits the last one.
  await query(`UPDATE tavern_games SET used_at = NOW(), won = FALSE
                WHERE user_id = $1 AND game = $2 AND mode = 'solo' AND used_at IS NULL`, [userId, game]);
  await query(`INSERT INTO tavern_games (id, user_id, game, mode) VALUES ($1,$2,$3,'solo')`, [id, userId, game]);
  return id;
}

async function soloFinish(userId, ticket, won) {
  const out = await withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tavern:' + userId]);
    const t = (await client.query(
      `SELECT *, EXTRACT(EPOCH FROM (NOW() - started_at)) AS age FROM tavern_games
        WHERE id = $1 AND user_id = $2 AND mode = 'solo' FOR UPDATE`, [String(ticket || ''), userId])).rows[0];
    if (!t) throw new TavernError(404, 'No such game.');
    if (t.used_at) throw new TavernError(409, 'That game is already over.');
    if (won && Number(t.age) < MIN_SOLO_SECONDS) {
      // Spend the ticket (it can't be retried), then refuse — after commit.
      await client.query('UPDATE tavern_games SET used_at = NOW(), won = FALSE WHERE id = $1', [t.id]);
      return { tooQuick: true };
    }
    const paid = won ? await payout(client, userId) : 0;
    await client.query('UPDATE tavern_games SET used_at = NOW(), won = $2, paid = $3 WHERE id = $1', [t.id, !!won, paid]);
    return { game: t.game, won: !!won, paid, capped: !!won && paid === 0 };
  });
  if (out.tooQuick) throw new TavernError(400, 'That game was too quick to count.');
  await stats.record(userId, out.game, out.won, { solo: true }).catch(() => {});
  return out;
}

module.exports = { WIN_GOLD, DAILY_PAID_WINS, MIN_SOLO_SECONDS, GAMES, TavernError, payWin, soloStart, soloFinish, paidToday };
