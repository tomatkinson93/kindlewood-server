const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { TERRAIN_BONUSES, MAP_SIZE, MAP_W, MAP_H, hexDistanceWrapped, hexDisk } = require('../mapgen');
const { generateStartingCitizens } = require('../citizens');

const router = express.Router();
const REVEAL_RADIUS = 5;
const SPAWN_RADIUS = 8;
const MIN_PLAYER_DISTANCE = 4;
const SUGGESTED_TILES = 5;
const MAX_REROLLS = 1;

// Get full map with fog of war for this player
router.get('/world', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT *, world_version FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];

    // Get all tiles
    const tilesRes = await query('SELECT * FROM tiles ORDER BY q, r');

    // Get this player's revealed tiles
    const fogRes = await query(
      'SELECT tile_q, tile_r FROM fog_of_war WHERE user_id=$1', [req.user.userId]
    );
    const revealed = new Set(fogRes.rows.map(r => `${r.tile_q},${r.tile_r}`));

    // Get all settlements for display
    const settlementsRes = await query(`
      SELECT s.tile_q, s.tile_r, s.name, s.tier, u.species, u.username
      FROM settlements s JOIN users u ON s.user_id = u.id
      WHERE s.tile_q IS NOT NULL AND s.tile_r IS NOT NULL
    `);
    const settlementMap = {};
    settlementsRes.rows.forEach(s => {
      settlementMap[`${s.tile_q},${s.tile_r}`] = s;
    });

    const tiles = tilesRes.rows.map(t => {
      const key = `${t.q},${t.r}`;
      const isRevealed = revealed.has(key);
      const occupant = settlementMap[key];
      return {
        q: t.q, r: t.r,
        terrain: isRevealed ? t.terrain : 'fog',
        revealed: isRevealed,
        settlement: isRevealed && occupant ? {
          name: occupant.name,
          species: occupant.species,
          username: occupant.username,
          tier: occupant.tier,
          isOwn: settlement && t.q === settlement.tile_q && t.r === settlement.tile_r,
        } : null,
      };
    });

    res.json({
      ok: true,
      mapSize: MAP_SIZE,
      tiles,
      playerSettlement: settlement ? { q: settlement.tile_q, r: settlement.tile_r } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load map.' });
  }
});

// Generate spawn options for new player
router.get('/spawn', requireAuth, async (req, res) => {
  try {
    const settlement = (await query(
      'SELECT tile_q, tile_r, rerolls_used, world_version FROM settlements WHERE user_id=$1',
      [req.user.userId]
    )).rows[0];

    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });
    if (settlement.world_version < 2) {
      await query('UPDATE settlements SET tile_q=NULL, tile_r=NULL WHERE id=$1', [settlement.id]);
      settlement.tile_q = null;
    }
    if (settlement.tile_q !== null) return res.status(400).json({ error: 'Already placed.' });

    const rerollsUsed = settlement.rerolls_used || 0;
    if (rerollsUsed > MAX_REROLLS) {
      return res.status(400).json({ error: 'No rerolls remaining.' });
    }

    // Get all occupied tiles
    const occupiedRes = await query(
      'SELECT tile_q, tile_r FROM settlements WHERE tile_q IS NOT NULL'
    );
    const occupied = new Set(occupiedRes.rows.map(r => `${r.tile_q},${r.tile_r}`));

    // Pick a random spawn centre away from others
    const allTilesRes = await query('SELECT x, y, terrain FROM tiles');
    const allTiles = allTilesRes.rows;

    // Find valid spawn centres
    const validCentres = allTiles.filter(t => {
      if (t.terrain === 'mountain') return false;
      if (t.q < SPAWN_RADIUS || t.q > MAP_W - SPAWN_RADIUS) return false;
      if (t.r < SPAWN_RADIUS || t.r > MAP_H - SPAWN_RADIUS) return false;
      // Check distance from other settlements
      for (const occ of occupiedRes.rows) {
        if (hexDistanceWrapped(t.q, t.r, occ.tile_q, occ.tile_r) < MIN_PLAYER_DISTANCE) return false;
      }
      return true;
    });

    if (validCentres.length === 0) {
      return res.status(400).json({ error: 'Map is full.' });
    }

    // Pick random centre
    const centre = validCentres[Math.floor(Math.random() * validCentres.length)];

    // Get tiles in reveal radius
    const localTiles = allTiles.filter(t => hexDistanceWrapped(t.q, t.r, centre.q, centre.r) <= REVEAL_RADIUS);

    // Pick suggested settlement spots (not mountain, not river edge)
    const candidates = localTiles.filter(t =>
      t.terrain !== 'mountain' && !occupied.has(`${t.x},${t.y}`)
    );

    // Score candidates for variety — pick spread out suggestions
    const suggested = [];
    const minDist = 3;
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    for (const c of shuffled) {
      if (suggested.length >= SUGGESTED_TILES) break;
      const tooClose = suggested.some(s => hexDistanceWrapped(s.q, s.r, c.q, c.r) < minDist);
      if (!tooClose) suggested.push(c);
    }

    // Increment rerolls used
    await query(
      'UPDATE settlements SET rerolls_used=$1 WHERE user_id=$2',
      [rerollsUsed + 1, req.user.userId]
    );

    res.json({
      ok: true,
      centre: { q: centre.q, r: centre.r },
      localTiles: localTiles.map(t => ({
        q: t.q, r: t.r, terrain: t.terrain,
        occupied: occupied.has(`${t.q},${t.r}`),
        bonus: TERRAIN_BONUSES[t.terrain] || null,
      })),
      suggested: suggested.map(t => ({
        q: t.q, r: t.r, terrain: t.terrain,
        bonus: TERRAIN_BONUSES[t.terrain],
      })),
      rerollsRemaining: MAX_REROLLS - rerollsUsed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate spawn.' });
  }
});

// Confirm settlement placement
router.post('/place', requireAuth, async (req, res) => {
  try {
    const { q, r } = req.body;
    if (q === undefined || r === undefined)
      return res.status(400).json({ error: 'Coordinates required.' });

    const settlementRes = await query(
      'SELECT *, world_version FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });
    // If world_version is stale, treat as unplaced regardless of tile_q
    if (settlement.world_version < 2) {
      await query('UPDATE settlements SET tile_q=NULL, tile_r=NULL WHERE id=$1', [settlement.id]);
      settlement.tile_q = null; settlement.tile_r = null;
    }
    if (settlement.tile_q !== null) return res.status(400).json({ error: 'Already placed.' });

    // Check tile exists and is not occupied
    const tileRes = await query('SELECT * FROM tiles WHERE q=$1 AND r=$2', [q, r]);
    const tile = tileRes.rows[0];
    if (!tile) return res.status(400).json({ error: 'Invalid tile.' });

    const occupiedRes = await query(
      'SELECT id FROM settlements WHERE tile_q=$1 AND tile_r=$2', [q, r]
    );
    if (occupiedRes.rows.length > 0)
      return res.status(409).json({ error: 'Tile already occupied.' });

    // Place settlement
    await query(
      'UPDATE settlements SET tile_q=$1, tile_r=$2, world_version=2 WHERE user_id=$3',
      [q, r, req.user.userId]
    );

    // Apply terrain bonus to starting resources
    const bonus = TERRAIN_BONUSES[tile.terrain];
    if (bonus) {
      await query(`
        UPDATE settlements SET
          food = food + $1, timber = timber + $2,
          stone = stone + $3, metal = metal + $4, wealth = wealth + $5
        WHERE user_id = $6
      `, [bonus.food * 50, bonus.timber * 50, bonus.stone * 50,
          bonus.metal * 50, bonus.wealth * 50, req.user.userId]);
    }

    // Reveal tiles in radius
    // Reveal hex disk around placement
    const revealDisk = hexDisk(q, r, REVEAL_RADIUS);
    for (const { q: tq, r: tr } of revealDisk) {
      await query(
        'INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [req.user.userId, tq, tr]
      );
    }

    res.json({ ok: true, q, r, terrain: tile.terrain, bonus: TERRAIN_BONUSES[tile.terrain] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Placement failed.' });
  }
});

module.exports = router;

// Zone definitions - terrain preferences for each starting zone
const ZONE_TERRAINS = {
  forest:    ['forest', 'hills'],
  riverside: ['river', 'plains'],
  highland:  ['hills', 'mountain'],
  heartlands:['plains'],
  marsh:     ['marsh', 'river'],
};

const STARTER_BUILDINGS = {
  Mice:    ['granary', 'farm', 'market'],
  Badgers: ['granary', 'barracks', 'quarry'],
  Otters:  ['granary', 'dock', 'market'],
  Moles:   ['granary', 'mine', 'workshop'],
  Foxes:   ['granary', 'watchtower', 'market'],
  Hares:   ['granary', 'barracks', 'farm'],
};

const SPECIES_VALID = ['Mice', 'Badgers', 'Otters', 'Moles', 'Foxes', 'Hares'];

// Confirm arrival — set species, zone, and auto-place in matching terrain
router.post('/arrive', requireAuth, async (req, res) => {
  try {
    const { species, zone } = req.body;
    console.log(`ARRIVE called: user=${req.user.userId} species=${species} zone=${zone} time=${Date.now()}`);

    if (!species || !SPECIES_VALID.includes(species))
      return res.status(400).json({ error: 'Invalid species.' });
    if (!zone || !ZONE_TERRAINS[zone])
      return res.status(400).json({ error: 'Invalid zone.' });

    // Check settlement exists and isn't placed yet
    const settlementRes = await query(
      'SELECT *, world_version FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });
    // If world_version is stale, treat as unplaced regardless of tile_q
    if (settlement.world_version < 2) {
      await query('UPDATE settlements SET tile_q=NULL, tile_r=NULL WHERE id=$1', [settlement.id]);
      settlement.tile_q = null; settlement.tile_r = null;
    }
    if (settlement.tile_q !== null) return res.status(400).json({ error: 'Already placed.' });

    // Update species on user
    await query('UPDATE users SET species=$1 WHERE id=$2', [species, req.user.userId]);

    // Find a good tile matching the zone terrain, away from other players
    const preferredTerrains = ZONE_TERRAINS[zone];
    const occupiedRes = await query(
      'SELECT tile_q, tile_r FROM settlements WHERE tile_q IS NOT NULL'
    );
    const allTilesRes = await query('SELECT x, y, terrain FROM tiles');
    const allTiles = allTilesRes.rows;

    // Score tiles by zone preference and distance from others
    const candidates = allTiles.filter(t => {
      if (t.q < REVEAL_RADIUS + 1 || t.q > MAP_W - REVEAL_RADIUS - 1) return false;
      if (t.r < REVEAL_RADIUS + 1 || t.r > MAP_H - REVEAL_RADIUS - 1) return false;
      if (!preferredTerrains.includes(t.terrain)) return false;
      for (const occ of occupiedRes.rows) {
        if (hexDistanceWrapped(t.q, t.r, occ.tile_q, occ.tile_r) < MIN_PLAYER_DISTANCE) return false;
      }
      return true;
    });

    // Fallback 1: any terrain in safe zone, ignoring zone preference
    let pool = candidates;
    if (pool.length === 0) {
      pool = allTiles.filter(t => {
        if (t.terrain === 'mountain') return false;
        if (t.x < REVEAL_RADIUS + 1 || t.x > MAP_SIZE - REVEAL_RADIUS - 1) return false;
        if (t.y < REVEAL_RADIUS + 1 || t.y > MAP_SIZE - REVEAL_RADIUS - 1) return false;
        for (const occ of occupiedRes.rows) {
          if (hexDistanceWrapped(t.q, t.r, occ.tile_q, occ.tile_r) < MIN_PLAYER_DISTANCE) return false;
        }
        return true;
      });
    }
    // Fallback 2: ignore distance if really full
    if (pool.length === 0) {
      pool = allTiles.filter(t => {
        if (t.terrain === 'mountain') return false;
        if (t.x < REVEAL_RADIUS + 1 || t.x > MAP_SIZE - REVEAL_RADIUS - 1) return false;
        if (t.y < REVEAL_RADIUS + 1 || t.y > MAP_SIZE - REVEAL_RADIUS - 1) return false;
        return true;
      });
    }

    if (pool.length === 0)
      return res.status(400).json({ error: 'No suitable tiles available.' });

    const tile = pool[Math.floor(Math.random() * Math.min(pool.length, 20))];

    // Place settlement
    await query(
      'UPDATE settlements SET tile_q=$1, tile_r=$2, world_version=2 WHERE user_id=$3',
      [tile.q, tile.r, req.user.userId]
    );

    // Apply terrain bonus
    const bonus = TERRAIN_BONUSES[tile.terrain];
    if (bonus) {
      await query(`
        UPDATE settlements SET
          food=food+$1, timber=timber+$2, stone=stone+$3, metal=metal+$4, wealth=wealth+$5
        WHERE user_id=$6
      `, [bonus.food*50, bonus.timber*50, bonus.stone*50, bonus.metal*50, bonus.wealth*50, req.user.userId]);
    }

    // Reveal fog of war
    const arriveDisk = hexDisk(tile.q, tile.r, REVEAL_RADIUS);
    for (const { q: tq, r: tr } of arriveDisk) {
      await query(
        'INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [req.user.userId, tq, tr]
      );
    }

    // Add starter buildings
    const buildings = STARTER_BUILDINGS[species] || STARTER_BUILDINGS.Mice;
    for (const b of buildings) {
      await query(
        'INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,1)',
        [settlement.id, b]
      );
    }

    // Generate starting citizens
    const existingCitizens = await query(
      'SELECT COUNT(*) FROM citizens WHERE settlement_id=$1', [settlement.id]
    );
    if (parseInt(existingCitizens.rows[0].count) === 0) {
      const citizens = generateStartingCitizens(10);
      for (const c of citizens) {
        await query(
          `INSERT INTO citizens (settlement_id, name, gender, generation, role, stats, skills, life, repro, visible_traits, hidden_traits)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            settlement.id, c.name, c.gender, c.generation, c.role,
            JSON.stringify(c.stats), JSON.stringify(c.skills),
            JSON.stringify(c.life), JSON.stringify(c.repro),
            JSON.stringify(c.visible_traits), JSON.stringify(c.hidden_traits),
          ]
        );
      }
      console.log(`Generated ${citizens.length} citizens for settlement ${settlement.id}`);
    }

    res.json({ ok: true, q: tile.q, r: tile.r, terrain: tile.terrain, species, zone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Arrival failed.' });
  }
});
