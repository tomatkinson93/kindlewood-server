const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { BUILDINGS, calculateRates } = require('../buildings');

const router = express.Router();

// Get all buildings for player's settlement + what can be built
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const userRes = await query('SELECT species FROM users WHERE id=$1', [req.user.userId]);
    const species = userRes.rows[0]?.species || 'Mice';

    const buildingsRes = await query(
      'SELECT * FROM buildings WHERE settlement_id=$1', [settlement.id]
    );
    const built = buildingsRes.rows;

    // Map built buildings
    const builtMap = {};
    for (const b of built) {
      builtMap[b.type] = b;
    }

    // Determine what can be built / upgraded
    const available = Object.values(BUILDINGS).map(def => {
      const existing = builtMap[def.id];
      const currentLevel = existing ? existing.level : 0;
      const canUpgrade = currentLevel < def.maxLevel;

      // Check requirements met
      const requiresMet = def.requires.every(req => builtMap[req]);

      // Scale cost with level
      const levelMultiplier = currentLevel + 1;
      const cost = {};
      for (const [r, v] of Object.entries(def.cost)) {
        cost[r] = v * levelMultiplier;
      }

      return {
        id: def.id,
        label: def.label,
        desc: def.desc,
        icon: def.icon,
        currentLevel,
        maxLevel: def.maxLevel,
        canUpgrade,
        requiresMet,
        cost,
        effect: def.effect(Math.max(1, currentLevel)),
        nextEffect: canUpgrade ? def.effect(currentLevel + 1) : null,
        citizenSlots: def.citizenSlots(Math.max(1, currentLevel)),
      };
    });

    res.json({ ok: true, buildings: available, builtIds: Object.keys(builtMap) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch buildings.' });
  }
});

// Construct or upgrade a building
router.post('/build', requireAuth, async (req, res) => {
  try {
    const { buildingId } = req.body;
    const def = BUILDINGS[buildingId];
    if (!def) return res.status(400).json({ error: 'Unknown building.' });

    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const userRes = await query('SELECT species FROM users WHERE id=$1', [req.user.userId]);
    const species = userRes.rows[0]?.species || 'Mice';

    // Check existing level
    const existingRes = await query(
      'SELECT * FROM buildings WHERE settlement_id=$1 AND type=$2',
      [settlement.id, buildingId]
    );
    const existing = existingRes.rows[0];
    const currentLevel = existing ? existing.level : 0;

    if (currentLevel >= def.maxLevel)
      return res.status(400).json({ error: 'Already at max level.' });

    // Check requirements
    for (const req of def.requires) {
      const reqCheck = await query(
        'SELECT id FROM buildings WHERE settlement_id=$1 AND type=$2',
        [settlement.id, req]
      );
      if (!reqCheck.rows.length)
        return res.status(400).json({ error: `Requires ${BUILDINGS[req]?.label || req} first.` });
    }

    // Scale cost by level
    const levelMultiplier = currentLevel + 1;
    const cost = {};
    for (const [r, v] of Object.entries(def.cost)) {
      cost[r] = v * levelMultiplier;
    }

    // Check resources
    if ((cost.food   || 0) > settlement.food)   return res.status(400).json({ error: `Not enough food. Need ${cost.food}.` });
    if ((cost.timber || 0) > settlement.timber) return res.status(400).json({ error: `Not enough timber. Need ${cost.timber}.` });
    if ((cost.stone  || 0) > settlement.stone)  return res.status(400).json({ error: `Not enough stone. Need ${cost.stone}.` });
    if ((cost.metal  || 0) > settlement.metal)  return res.status(400).json({ error: `Not enough metal. Need ${cost.metal}.` });
    if ((cost.wealth || 0) > settlement.wealth) return res.status(400).json({ error: `Not enough wealth. Need ${cost.wealth}.` });

    // Deduct resources
    await query(`
      UPDATE settlements SET
        food   = food   - $1,
        timber = timber - $2,
        stone  = stone  - $3,
        metal  = metal  - $4,
        wealth = wealth - $5
      WHERE id = $6
    `, [cost.food||0, cost.timber||0, cost.stone||0, cost.metal||0, cost.wealth||0, settlement.id]);

    // Build or upgrade
    if (existing) {
      await query('UPDATE buildings SET level=$1 WHERE id=$2', [currentLevel + 1, existing.id]);
    } else {
      await query(
        'INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,1)',
        [settlement.id, buildingId]
      );
    }

    // Apply housing population cap increase
    if (buildingId === 'housing') {
      const effect = def.effect(currentLevel + 1);
      await query(
        'UPDATE settlements SET population_cap=$1 WHERE id=$2',
        [20 + (effect.population_cap || 0), settlement.id]
      );
    }

    // Apply scout post fog reveal
    if (buildingId === 'scout_post') {
      const newRadius = 5 + def.effect(currentLevel + 1).reveal_radius;
      const revealRes = await query(
        'SELECT x, y FROM tiles WHERE x BETWEEN $1 AND $2 AND y BETWEEN $3 AND $4',
        [settlement.tile_x - newRadius, settlement.tile_x + newRadius,
         settlement.tile_y - newRadius, settlement.tile_y + newRadius]
      );
      for (const t of revealRes.rows) {
        await query(
          'INSERT INTO fog_of_war (user_id, tile_x, tile_y) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [req.user.userId, t.x, t.y]
        );
      }
    }

    res.json({ ok: true, building: buildingId, newLevel: currentLevel + 1, cost });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Construction failed.' });
  }
});

// Remove (demolish) a building
router.post('/remove', requireAuth, async (req, res) => {
  const { buildingId } = req.body;
  if (!buildingId) return res.status(400).json({ error: 'Missing buildingId.' });
  try {
    const user = await getUser(req);
    const settlementRes = await query('SELECT * FROM settlements WHERE user_id=$1', [user.id]);
    if (!settlementRes.rows.length) return res.status(404).json({ error: 'No settlement.' });
    const settlement = settlementRes.rows[0];

    // Check building exists
    const existing = await query(
      'SELECT * FROM buildings WHERE settlement_id=$1 AND type=$2',
      [settlement.id, buildingId]
    );
    if (!existing.rows.length || existing.rows[0].level < 1) {
      return res.status(400).json({ error: 'Building not found or not built.' });
    }

    // Remove from DB
    await query('DELETE FROM buildings WHERE settlement_id=$1 AND type=$2', [settlement.id, buildingId]);

    // Unassign any citizens working this building
    const { ROLE_BUILDING_MAP } = require('../buildings');
    const rolesForBuilding = Object.entries(ROLE_BUILDING_MAP)
      .filter(([, buildings]) => buildings.includes(buildingId))
      .map(([role]) => role);

    if (rolesForBuilding.length) {
      await query(
        `UPDATE citizens SET role='idle' WHERE settlement_id=$1 AND role=ANY($2::text[])`,
        [settlement.id, rolesForBuilding]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Demolition failed.' });
  }
});


// Get building definitions for frontend
router.get('/definitions', async (req, res) => {
  res.json({ ok: true, buildings: BUILDINGS });
});

module.exports = router;
