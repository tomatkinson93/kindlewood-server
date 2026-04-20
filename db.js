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
      tile_q INTEGER DEFAULT NULL,
      tile_r INTEGER DEFAULT NULL,
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
      q INTEGER NOT NULL,
      r INTEGER NOT NULL,
      terrain TEXT NOT NULL,
      settlement_id INTEGER DEFAULT NULL,
      UNIQUE(q, r)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS fog_of_war (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      tile_q INTEGER NOT NULL,
      tile_r INTEGER NOT NULL,
      UNIQUE(user_id, tile_q, tile_r)
    )
  `);

  // Seed map if empty
  const tileCount = await query("SELECT COUNT(*) FROM tiles WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tiles' AND column_name='q')").catch(()=>({rows:[{count:'0'}]}));
  if (parseInt(tileCount.rows[0].count) === 0) {
    console.log('Generating world map...');
    const tiles = generateMap(Date.now());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of tiles) {
        await client.query(
          'INSERT INTO tiles (q, r, terrain) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [t.q, t.r, t.terrain]
        );
      }
      await client.query('COMMIT');
      console.log(`World map generated: ${tiles.length} hex tiles`);
      // Mark all settlements as up to date
      await client.query('UPDATE settlements SET world_version=2').catch(()=>{});
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Add missing columns and fix defaults
  await query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS tile_q INTEGER DEFAULT NULL`).catch(() => {});
  await query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS tile_r INTEGER DEFAULT NULL`).catch(() => {});
  await query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS rerolls_used INTEGER DEFAULT 0`).catch(() => {});

  // Force column defaults to NULL (fixes any lingering 4,3 default from old schema)
  await query(`ALTER TABLE settlements ALTER COLUMN tile_q SET DEFAULT NULL`).catch(() => {});
  await query(`ALTER TABLE settlements ALTER COLUMN tile_r SET DEFAULT NULL`).catch(() => {});

  // Reset any settlements with bogus 4,3 coordinates that were never real placements
  await query(`
    UPDATE settlements SET tile_x = NULL, tile_y = NULL, rerolls_used = 0
    WHERE tile_q = 4 AND tile_r = 3
  `).catch(e => console.log('Reset cleanup:', e.message));





  await query(`
    CREATE TABLE IF NOT EXISTS expeditions (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES settlements(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      target_q INTEGER NOT NULL,
      target_r INTEGER NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completes_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'travelling',
      path JSONB DEFAULT '[]',
      citizen_id INTEGER DEFAULT NULL
    )
  `);

  await query(`ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS citizen_id INTEGER DEFAULT NULL`).catch(()=>{});

  // ── World reset (hex migration) ───────────────────────────────────────────
  // Add world_version column — if it doesn't match, wipe map data and prompt resettlement
  await query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS world_version INTEGER DEFAULT 0`).catch(()=>{});
  const CURRENT_WORLD_VERSION = 2; // increment to force resettlement

  // Check if tiles table needs rebuilding (column rename from x/y to q/r)
  const tileColCheck = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='tiles' AND column_name='x'
  `).catch(()=>({rows:[]}));

  if (tileColCheck.rows.length > 0) {
    // Old x/y schema exists — wipe everything and rebuild
    console.log('Old tile schema detected — wiping for hex migration...');
    await query('DROP TABLE IF EXISTS fog_of_war CASCADE').catch(()=>{});
    await query('DROP TABLE IF EXISTS expeditions CASCADE').catch(()=>{});
    await query('DROP TABLE IF EXISTS tiles CASCADE').catch(()=>{});
    // Reset all settlements to unplaced and old world version
    await query('UPDATE settlements SET tile_q=NULL, tile_r=NULL, world_version=0').catch(()=>{});
    await query('UPDATE users SET species=NULL').catch(()=>{});
    console.log('Hex migration wipe complete — map will be regenerated.');
  }

  // Reset any settlements on old world version
  await query(
    `UPDATE settlements SET tile_q=NULL, tile_r=NULL WHERE world_version < ${CURRENT_WORLD_VERSION}`
  ).catch(()=>{});

  // Housing system
  await query(`
    CREATE TABLE IF NOT EXISTS houses (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES settlements(id),
      name TEXT NOT NULL,
      building_type TEXT NOT NULL DEFAULT 'starter_house',
      capacity INTEGER NOT NULL DEFAULT 2,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS house_id INTEGER DEFAULT NULL REFERENCES houses(id) ON DELETE SET NULL`).catch(()=>{});

  // Add bio column to users if missing
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''`).catch(() => {});

  // Quest system
  await query(`
    CREATE TABLE IF NOT EXISTS settlement_quests (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES settlements(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      quest_id TEXT NOT NULL,
      citizen_id INTEGER DEFAULT NULL,
      status TEXT DEFAULT 'active',
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completes_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ DEFAULT NULL,
      success_roll FLOAT DEFAULT NULL,
      success_chance FLOAT DEFAULT NULL
    )
  `);
  await query(`ALTER TABLE settlement_quests ADD COLUMN IF NOT EXISTS success_roll FLOAT DEFAULT NULL`).catch(()=>{});
  await query(`ALTER TABLE settlement_quests ADD COLUMN IF NOT EXISTS success_chance FLOAT DEFAULT NULL`).catch(()=>{});

  // ── Relationship / Bonding / Breeding system ──────────────────────────────

  // Relationship pairs (canonical: citizen_a_id < citizen_b_id always)
  await query(`
    CREATE TABLE IF NOT EXISTS citizen_relationships (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES settlements(id),
      citizen_a_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
      citizen_b_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
      score INTEGER NOT NULL DEFAULT 0,        -- 0-100
      state TEXT NOT NULL DEFAULT 'strangers', -- strangers/acquaintances/friends/close/bonded/partners
      shared_house_days INTEGER DEFAULT 0,
      shared_quest_count INTEGER DEFAULT 0,
      last_updated TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(citizen_a_id, citizen_b_id)
    )
  `);

  // Events log (births, partnerships, etc.)
  await query(`
    CREATE TABLE IF NOT EXISTS settlement_events (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES settlements(id),
      type TEXT NOT NULL,   -- 'bond_formed','partnership','child_born','close_bond'
      message TEXT NOT NULL,
      citizen_ids JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // New columns on citizens
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS partner_id INTEGER DEFAULT NULL REFERENCES citizens(id) ON DELETE SET NULL`).catch(()=>{});
  await query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS life_stage TEXT DEFAULT 'adult'`).catch(()=>{});

  // Simulation tick tracker on settlements (separate from resource tick)
  await query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS last_sim_tick TIMESTAMPTZ DEFAULT NOW()`).catch(()=>{});

  console.log('Database initialised');
}

module.exports = { query, initDB };
