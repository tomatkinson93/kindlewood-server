const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { TERRAIN_BONUSES, MAP_SIZE } = require('../mapgen');

const router = express.Router();
const REVEAL_RADIUS = 5;
const SPAWN_RADIUS = 8;
const MIN_PLAYER_DISTANCE = 6;
const SUGGESTED_TILES = 5;
const MAX_REROLLS = 1;

// Get full map with fog of war for this player
router.get('/world', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];

    // Get all tiles
    const tilesRes = await query('SELECT * FROM tiles ORDER BY x, y');

    // Get this player's revealed tiles
    const fogRes = await query(
      'SELECT tile_x, tile_y FROM fog_of_war WHERE user_id=$1', [req.user.userId]
    );
    const revealed = new Set(fogRes.rows.map(r => `${r.tile_x},${r.tile_y}`));

    // Get all settlements for display
    const settlementsRes = await query(`
      SELECT s.tile_x, s.tile_y, s.name, s.tier, u.species, u.username
      FROM settlements s JOIN users u ON s.user_id = u.id
      WHERE s.tile_x IS NOT NULL AND s.tile_y IS NOT NULL
    `);
    const settlementMap = {};
    settlementsRes.rows.forEach(s => {
      settlementMap[`${s.tile_x},${s.tile_y}`] = s;
    });

    const tiles = tilesRes.rows.map(t => {
      const key = `${t.x},${t.y}`;
      const isRevealed = revealed.has(key);
      const occupant = settlementMap[key];
      return {
        x: t.x, y: t.y,
        terrain: isRevealed ? t.terrain : 'fog',
        revealed: isRevealed,
        settlement: isRevealed && occupant ? {
          name: occupant.name,
          species: occupant.species,
          username: occupant.username,
          tier: occupant.tier,
          isOwn: settlement && t.x === settlement.tile_x && t.y === settlement.tile_y,
        } : null,
      };
    });

    res.json({
      ok: true,
      mapSize: MAP_SIZE,
      tiles,
      playerSettlement: settlement ? { x: settlement.tile_x, y: settlement.tile_y } : null,
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
      'SELECT tile_x, tile_y, rerolls_used FROM settlements WHERE user_id=$1',
      [req.user.userId]
    )).rows[0];

    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });
    if (settlement.tile_x !== null) return res.status(400).json({ error: 'Already placed.' });

    const rerollsUsed = settlement.rerolls_used || 0;
    if (rerollsUsed > MAX_REROLLS) {
      return res.status(400).json({ error: 'No rerolls remaining.' });
    }

    // Get all occupied tiles
    const occupiedRes = await query(
      'SELECT tile_x, tile_y FROM settlements WHERE tile_x IS NOT NULL'
    );
    const occupied = new Set(occupiedRes.rows.map(r => `${r.tile_x},${r.tile_y}`));

    // Pick a random spawn centre away from others
    const allTilesRes = await query('SELECT x, y, terrain FROM tiles');
    const allTiles = allTilesRes.rows;

    // Find valid spawn centres
    const validCentres = allTiles.filter(t => {
      if (t.terrain === 'mountain') return false;
      if (t.x < SPAWN_RADIUS || t.x > MAP_SIZE - SPAWN_RADIUS) return false;
      if (t.y < SPAWN_RADIUS || t.y > MAP_SIZE - SPAWN_RADIUS) return false;
      // Check distance from other settlements
      for (const occ of occupiedRes.rows) {
        const dx = t.x - occ.tile_x, dy = t.y - occ.tile_y;
        if (Math.sqrt(dx*dx + dy*dy) < MIN_PLAYER_DISTANCE) return false;
      }
      return true;
    });

    if (validCentres.length === 0) {
      return res.status(400).json({ error: 'Map is full.' });
    }

    // Pick random centre
    const centre = validCentres[Math.floor(Math.random() * validCentres.length)];

    // Get tiles in reveal radius
    const localTiles = allTiles.filter(t => {
      const dx = t.x - centre.x, dy = t.y - centre.y;
      return Math.abs(dx) <= REVEAL_RADIUS && Math.abs(dy) <= REVEAL_RADIUS;
    });

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
      const tooClose = suggested.some(s => {
        const dx = s.x - c.x, dy = s.y - c.y;
        return Math.sqrt(dx*dx + dy*dy) < minDist;
      });
      if (!tooClose) suggested.push(c);
    }

    // Increment rerolls used
    await query(
      'UPDATE settlements SET rerolls_used=$1 WHERE user_id=$2',
      [rerollsUsed + 1, req.user.userId]
    );

    res.json({
      ok: true,
      centre: { x: centre.x, y: centre.y },
      localTiles: localTiles.map(t => ({
        x: t.x, y: t.y, terrain: t.terrain,
        occupied: occupied.has(`${t.x},${t.y}`),
        bonus: TERRAIN_BONUSES[t.terrain] || null,
      })),
      suggested: suggested.map(t => ({
        x: t.x, y: t.y, terrain: t.terrain,
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
    const { x, y } = req.body;
    if (x === undefined || y === undefined)
      return res.status(400).json({ error: 'Coordinates required.' });

    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });
    if (settlement.tile_x !== null) return res.status(400).json({ error: 'Already placed.' });

    // Check tile exists and is not occupied
    const tileRes = await query('SELECT * FROM tiles WHERE x=$1 AND y=$2', [x, y]);
    const tile = tileRes.rows[0];
    if (!tile) return res.status(400).json({ error: 'Invalid tile.' });

    const occupiedRes = await query(
      'SELECT id FROM settlements WHERE tile_x=$1 AND tile_y=$2', [x, y]
    );
    if (occupiedRes.rows.length > 0)
      return res.status(409).json({ error: 'Tile already occupied.' });

    // Place settlement
    await query(
      'UPDATE settlements SET tile_x=$1, tile_y=$2 WHERE user_id=$3',
      [x, y, req.user.userId]
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
    const revealRes = await query(
      'SELECT x, y FROM tiles WHERE x BETWEEN $1 AND $2 AND y BETWEEN $3 AND $4',
      [x - REVEAL_RADIUS, x + REVEAL_RADIUS, y - REVEAL_RADIUS, y + REVEAL_RADIUS]
    );
    for (const t of revealRes.rows) {
      await query(
        'INSERT INTO fog_of_war (user_id, tile_x, tile_y) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [req.user.userId, t.x, t.y]
      );
    }

    res.json({ ok: true, x, y, terrain: tile.terrain, bonus: TERRAIN_BONUSES[tile.terrain] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Placement failed.' });
  }
});

module.exports = router;
