// lib/game_stats_store.js — shared DB helper for recording game results,
// used by both routes/game_stats.js (HTTP) and lib/game_rooms.js (server
// match completion). Keeps the upsert logic in one place.

const { query } = require('../db');

let _ready = null;
function ready() {
  if (!_ready) {
    _ready = query(`
      CREATE TABLE IF NOT EXISTS game_stats (
        user_id   INTEGER NOT NULL REFERENCES users(id),
        game      TEXT NOT NULL,
        wins      INTEGER NOT NULL DEFAULT 0,
        games     INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, game)
      )
    `).catch(e => { _ready = null; throw e; });
  }
  return _ready;
}

async function record(userId, game, won, opts) {
  // opts.solo reserved for future solo/multiplayer split; currently unused.
  await ready();
  await query(`
    INSERT INTO game_stats (user_id, game, wins, games, updated_at)
    VALUES ($1, $2, $3, 1, now())
    ON CONFLICT (user_id, game) DO UPDATE
      SET wins = game_stats.wins + $3,
          games = game_stats.games + 1,
          updated_at = now()
  `, [userId, String(game).slice(0, 40), won ? 1 : 0]);
}

module.exports = { record, ready };
