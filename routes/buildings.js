const express = require('express');
const { createHouseForSettlement, removeHouseForSettlement } = require('./housing');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { BUILDINGS, calculateRates } = require('../buildings');

const router = express.Router();

// Get all buildings for player's settlement + what can be built
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT *, tile_q, tile_r FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const userRes = await query('SELECT species FROM users WHERE id=$1', [req.user.userId]);
    const species = userRes.rows[0]?.species || 'Mice';

    const buildingsRes = await query(
      'SELECT * FROM buildings WHERE settlement_id=$1', [settlement.id]
    );
    const built = buildingsRes.rows;

    // Map built buildings (housing: count rows, others: use single row)
    const builtMap = {};
    const housingCounts = {};
    for (const b of built) {
      if (BUILDINGS[b.type]?.isHousing) {
        housingCounts[b.type] = (housingCounts[b.type] || 0) + 1;
        if (!builtMap[b.type]) builtMap[b.type] = b; // keep first row as sentinel
      } else {
        builtMap[b.type] = b;
      }
    }

    // Determine what can be built / upgraded
    const available = Object.values(BUILDINGS).map(def => {
      const existing = builtMap[def.id];
      // For housing, currentLevel = number of houses built; for others = building level
      const currentLevel = def.isHousing
        ? (housingCounts[def.id] || 0)
        : (existing ? existing.level : 0);
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
        imgFile: def.imgFile || null,
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
      'SELECT *, tile_q, tile_r FROM settlements WHERE user_id=$1', [req.user.userId]
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

    // Tier-based soft cap for housing buildings
    if (def.tierCaps) {
      const settlementTierRes = await query('SELECT tier FROM settlements WHERE user_id=$1', [req.user.userId]);
      const tier = settlementTierRes.rows[0]?.tier || 'camp';
      const tierCap = def.tierCaps[tier] || def.tierCaps['camp'];
      // For housing, count rows (not level) to get actual house count
      const houseCountRes = await query(
        'SELECT COUNT(*) FROM buildings WHERE settlement_id=$1 AND type=$2',
        [settlement.id, buildingId]
      );
      const houseCount = parseInt(houseCountRes.rows[0].count);
      if (houseCount >= tierCap)
        return res.status(400).json({ error: `Upgrade your settlement tier to build more ${def.label}s. Current limit: ${tierCap}.` });
    }

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
    if (def.isHousing) {
      // Housing: always insert a new row per house (not level-based)
      await query(
        'INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,1)',
        [settlement.id, buildingId]
      );
    } else if (existing) {
      await query('UPDATE buildings SET level=$1 WHERE id=$2', [currentLevel + 1, existing.id]);
    } else {
      await query(
        'INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,1)',
        [settlement.id, buildingId]
      );
    }

    // Apply scout post fog reveal (hex disk)
    if (buildingId === 'scout_post') {
      const { hexDisk } = require('../mapgen');
      const newRadius = 5 + (def.effect(currentLevel + 1).reveal_radius || 0);
      const disk = hexDisk(settlement.tile_q, settlement.tile_r, newRadius);
      for (const { q, r } of disk) {
        await query(
          'INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [req.user.userId, q, r]
        );
      }
    }

    // Create a house record for every housing build
    if (def.isHousing) {
      await createHouseForSettlement(settlement.id, buildingId);
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
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
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

    const { BUILDINGS } = require('../buildings');
    const def = BUILDINGS[buildingId];

    // Refund 50% of base build cost
    const refund = {};
    if (def?.cost) {
      for (const [r, v] of Object.entries(def.cost)) {
        refund[r] = Math.floor(v * 0.5);
      }
      if (Object.keys(refund).length) {
        await query(`
          UPDATE settlements SET
            food   = food   + $1,
            timber = timber + $2,
            stone  = stone  + $3,
            metal  = metal  + $4,
            wealth = wealth + $5
          WHERE id = $6
        `, [refund.food||0, refund.timber||0, refund.stone||0, refund.metal||0, refund.wealth||0, settlement.id]);
      }
    }

    // Remove from DB
    await query('DELETE FROM buildings WHERE settlement_id=$1 AND type=$2', [settlement.id, buildingId]);

    // Remove associated house if this is a housing building
    if (def?.isHousing) {
      await removeHouseForSettlement(settlement.id, buildingId);
    }

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

    res.json({ ok: true, refund });
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
