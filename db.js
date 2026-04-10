const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      species TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settlements (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      name TEXT NOT NULL,
      tier TEXT DEFAULT 'camp',
      tile_x INTEGER DEFAULT 4,
      tile_y INTEGER DEFAULT 3,
      food INTEGER DEFAULT 500,
      timber INTEGER DEFAULT 300,
      stone INTEGER DEFAULT 150,
      metal INTEGER DEFAULT 50,
      wealth INTEGER DEFAULT 100,
      population INTEGER DEFAULT 10,
      population_cap INTEGER DEFAULT 20,
      happiness TEXT DEFAULT 'content',
      last_tick TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS buildings (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES settlements(id),
      type TEXT NOT NULL,
      level INTEGER DEFAULT 1
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS citizens (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES settlements(id),
      name TEXT NOT NULL,
      role TEXT DEFAULT 'idle',
      traits JSONB DEFAULT '[]',
      generation INTEGER DEFAULT 1,
      parent_ids JSONB DEFAULT '[]',
      born_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log('Database initialised');
}

module.exports = { query, initDB };
