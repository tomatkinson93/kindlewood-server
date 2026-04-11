const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const MAP_SIZE = 40;
const SECONDS_PER_TILE_CLEAR = 8;   // revealed tile
const SECONDS_PER_TILE_FOG   = 20;  // fog tile — harder to traverse

// Bresenham line between two points (wrapping-aware shortest path)
function pathBetween(x0, y0, x1, y1, size) {
  // Find shortest wrapped distance
  let dx = x1 - x0;
  let dy = y1 - y0;
  if (Math.abs(dx) > size / 2) dx = dx > 0 ? dx - size : dx + size;
  if (Math.abs(dy) > size / 2) dy = dy > 0 ? dy - size : dy + size;

  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const path = [];
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const px = ((Math.round(x0 + dx * t) % size) + size) % size;
    const py = ((Math.round(y0 + dy * t) % size) + size) % size;
    if (!path.length || path[path.length-1].x !== px || path[path.length-1].y !== py) {
      path.push({ x: px, y: py });
    }
  }
  return path;
}

// Send scout expedition
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { target_x, target_y } = req.body;
    if (target_x === undefined || target_y === undefined)
      return res.status(400).json({ error: 'Target coordinates required.' });

    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    if (settlement.tile_x === null) return res.status(400).json({ error: 'Not placed yet.' });

    // Check scout post exists
    const scoutPost = await query(
      "SELECT level FROM buildings WHERE settlement_id=$1 AND type='scout_post'",
      [settlement.id]
    );
    if (!scoutPost.rows.length)
      return res.status(400).json({ error: 'Build a Scout Post first.' });

    // Check no active expedition to same tile
    const existing = await query(
      "SELECT id FROM expeditions WHERE settlement_id=$1 AND target_x=$2 AND target_y=$3 AND status='travelling'",
      [settlement.id, target_x, target_y]
    );
    if (existing.rows.length)
      return res.status(400).json({ error: 'Scout already heading there.' });

    // Calculate path
    const path = pathBetween(settlement.tile_x, settlement.tile_y, target_x, target_y, MAP_SIZE);

    // Get revealed tiles to calculate travel time
    const revealedRes = await query(
      'SELECT tile_x, tile_y FROM fog_of_war WHERE user_id=$1', [req.user.userId]
    );
    const revealed = new Set(revealedRes.rows.map(r => `${r.tile_x},${r.tile_y}`));

    let seconds = 0;
    for (const tile of path) {
      seconds += revealed.has(`${tile.x},${tile.y}`)
        ? SECONDS_PER_TILE_CLEAR
        : SECONDS_PER_TILE_FOG;
    }

    // Scout post level reduces time
    const scoutLevel = scoutPost.rows[0].level;
    seconds = Math.round(seconds / (1 + (scoutLevel - 1) * 0.25));
    seconds = Math.max(10, seconds); // minimum 10s

    const completesAt = new Date(Date.now() + seconds * 1000);

    const result = await query(
      `INSERT INTO expeditions (settlement_id, user_id, target_x, target_y, completes_at, path)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [settlement.id, req.user.userId, target_x, target_y, completesAt, JSON.stringify(path)]
    );

    res.json({
      ok: true,
      expedition: result.rows[0],
      seconds,
      tiles: path.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send scout.' });
  }
});

// Get active expeditions
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Complete any finished expeditions
    await completeExpeditions(settlement.id, req.user.userId);

    const expeditions = await query(
      "SELECT * FROM expeditions WHERE settlement_id=$1 AND status='travelling' ORDER BY completes_at ASC",
      [settlement.id]
    );

    res.json({ ok: true, expeditions: expeditions.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch expeditions.' });
  }
});

// Complete finished expeditions and reveal tiles
async function completeExpeditions(settlementId, userId) {
  const done = await query(
    `SELECT * FROM expeditions WHERE settlement_id=$1 AND status='travelling' AND completes_at <= NOW()`,
    [settlementId]
  );

  for (const exp of done.rows) {
    const path = exp.path || [];
    // Reveal all path tiles
    for (const tile of path) {
      await query(
        'INSERT INTO fog_of_war (user_id, tile_x, tile_y) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [userId, tile.x, tile.y]
      );
    }
    // Also reveal a small radius around destination
    const tx = exp.target_x, ty = exp.target_y;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const nx = ((tx + dx) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
        const ny = ((ty + dy) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
        await query(
          'INSERT INTO fog_of_war (user_id, tile_x, tile_y) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [userId, nx, ny]
        );
      }
    }
    await query("UPDATE expeditions SET status='complete' WHERE id=$1", [exp.id]);
  }
}

// Cheat — reveal all fog
router.post('/reveal-all', requireAuth, async (req, res) => {
  try {
    const tilesRes = await query('SELECT x, y FROM tiles');
    for (const t of tilesRes.rows) {
      await query(
        'INSERT INTO fog_of_war (user_id, tile_x, tile_y) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [req.user.userId, t.x, t.y]
      );
    }
    res.json({ ok: true, revealed: tilesRes.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reveal.' });
  }
});

// Cheat — reset fog
router.post('/reset-fog', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM fog_of_war WHERE user_id=$1', [req.user.userId]);
    // Re-reveal just around settlement
    const settlementRes = await query(
      'SELECT tile_x, tile_y FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const s = settlementRes.rows[0];
    if (s?.tile_x !== null) {
      for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
          const nx = ((s.tile_x + dx) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
          const ny = ((s.tile_y + dy) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
          await query(
            'INSERT INTO fog_of_war (user_id, tile_x, tile_y) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [req.user.userId, nx, ny]
          );
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset fog.' });
  }
});

module.exports = router;
