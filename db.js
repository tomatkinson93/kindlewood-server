const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'kindlewood.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    species TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tier TEXT DEFAULT 'camp',
    tile_x INTEGER DEFAULT 2,
    tile_y INTEGER DEFAULT 2,
    food INTEGER DEFAULT 500,
    timber INTEGER DEFAULT 300,
    stone INTEGER DEFAULT 150,
    metal INTEGER DEFAULT 50,
    wealth INTEGER DEFAULT 100,
    population INTEGER DEFAULT 10,
    population_cap INTEGER DEFAULT 20,
    happiness TEXT DEFAULT 'content',
    last_tick DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    FOREIGN KEY (settlement_id) REFERENCES settlements(id)
  );
`);

module.exports = db;
