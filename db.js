const { Pool } = require('pg');
const { generateMap } = require('./mapgen');

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
      tile_x INTEGER DEFAULT NULL,
      tile_y INTEGER DEFAULT NULL,
      rerolls_used INTEGER DEFAULT 0,
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
      gender TEXT DEFAULT 'male',
      generation INTEGER DEFAULT 1,
      role TEXT DEFAULT 'idle',
      parent_ids JSONB DEFAULT '[]',
      stats JSONB DEFAULT '{}',
      skills JSONB DEFAULT '{}',
      life JSONB DEFAULT '{}',
      repro JSONB DEFAULT '{}',
      visible_traits JSONB DEFAULT '[]',
      hidden_traits JSONB DEFAULT '[]',
      born_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migrate old citizens table if it exists without new columns
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'male'`).catch(()=>{});
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT '{}'`).catch(()=>{});
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '{}'`).catch(()=>{});
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS life JSONB DEFAULT '{}'`).catch(()=>{});
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS repro JSONB DEFAULT '{}'`).catch(()=>{});
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS visible_traits JSONB DEFAULT '[]'`).catch(()=>{});
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS hidden_traits JSONB DEFAULT '[]'`).catch(()=>{});

  await query(`
    CREATE TABLE IF NOT EXISTS tiles (
      id SERIAL PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      terrain TEXT NOT NULL,
      settlement_id INTEGER DEFAULT NULL,
      UNIQUE(x, y)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS fog_of_war (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      tile_x INTEGER NOT NULL,
      tile_y INTEGER NOT NULL,
      UNIQUE(user_id, tile_x, tile_y)
    )
  `);

  // Seed map if empty
  const tileCount = await query('SELECT COUNT(*) FROM tiles');
  if (parseInt(tileCount.rows[0].count) === 0) {
    console.log('Generating world map...');
    const tiles = generateMap(Date.now());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of tiles) {
        await client.query(
          'INSERT INTO tiles (x, y, terrain) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [t.x, t.y, t.terrain]
        );
      }
      await client.query('COMMIT');
      console.log(`World map generated: ${tiles.length} tiles`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Add missing columns and fix defaults
  await query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS tile_x INTEGER DEFAULT NULL`).catch(() => {});
  await query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS tile_y INTEGER DEFAULT NULL`).catch(() => {});
  await query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS rerolls_used INTEGER DEFAULT 0`).catch(() => {});

  // Force column defaults to NULL (fixes any lingering 4,3 default from old schema)
  await query(`ALTER TABLE settlements ALTER COLUMN tile_x SET DEFAULT NULL`).catch(() => {});
  await query(`ALTER TABLE settlements ALTER COLUMN tile_y SET DEFAULT NULL`).catch(() => {});

  // Reset any settlements with bogus 4,3 coordinates that were never real placements
  await query(`
    UPDATE settlements SET tile_x = NULL, tile_y = NULL, rerolls_used = 0
    WHERE tile_x = 4 AND tile_y = 3
  `).catch(e => console.log('Reset cleanup:', e.message));





  await query(`
    CREATE TABLE IF NOT EXISTS expeditions (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES settlements(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      target_x INTEGER NOT NULL,
      target_y INTEGER NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completes_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'travelling',
      path JSONB DEFAULT '[]',
      citizen_id INTEGER DEFAULT NULL
    )
  `);

  await query(`ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS citizen_id INTEGER DEFAULT NULL`).catch(()=>{});

  console.log('Database initialised');
}

module.exports = { query, initDB };
