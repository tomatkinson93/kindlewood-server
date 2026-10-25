const express = require('express');
const { createHouseForSettlement, removeHouseForSettlement } = require('./housing');
const { query } = require('../db');
const RD = require('../lib/resource_defs');
const RS = require('../lib/research_defs');
const requireAuth = require('../middleware/auth');
const { BUILDINGS, TIER_ORDER, calculateRates } = require('../buildings');

// Building-cost discounts: research (Engineering). → { mult, parts: [{ label, pct }] }
// Capped at −20% in all.
const MAX_BUILD_DISCOUNT = 0.2;
async function buildDiscount(sid, done) {
  const parts = [];
  const r = RS.effectsOf(done || await require('../lib/research').doneSet(null, sid)).build_cost || 0;
  if (r) parts.push({ label: 'Engineering', pct: r });
  const total = Math.max(-MAX_BUILD_DISCOUNT, parts.reduce((a, p) => a + p.pct, 0));
  return { mult: 1 + total, parts };
}
const scaledCost = (def, level, mult) => Object.fromEntries(Object.entries(def.cost).map(([r, v]) => [r, Math.ceil(v * level * mult)]));

// True when a settlement at `tier` may build `def` (its optional minTier).
function tierMetFor(def, tier) {
  if (!def.minTier) return true;
  return TIER_ORDER.indexOf(tier || 'camp') >= TIER_ORDER.indexOf(def.minTier);
}
// Tier needed to build `level` of def (levelTierReq), or null.
function levelTierFor(def, level) {
  return (def.levelTierReq && def.levelTierReq[level]) || null;
}
function levelTierMet(def, level, tier) {
  const need = levelTierFor(def, level);
  return !need || TIER_ORDER.indexOf(tier || 'camp') >= TIER_ORDER.indexOf(need);
}
const tierLabel = t => t.charAt(0).toUpperCase() + t.slice(1);

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

    // Finished research (a building can need a project: the Smelter).
    const done = await require('../lib/research').doneSet(null, settlement.id);
    const discount = await buildDiscount(settlement.id, done);

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
      const tierMet = tierMetFor(def, settlement.tier);
      const nextLevelTier = canUpgrade ? levelTierFor(def, currentLevel + 1) : null;
      const nextLevelTierMet = !canUpgrade || levelTierMet(def, currentLevel + 1, settlement.tier);

      // Scale cost with level, less any discount (Engineering…)
      const cost = scaledCost(def, currentLevel + 1, discount.mult);

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
        tierMet,
        research: def.research || null,
        researchLabel: def.research ? RS.label(def.research) : null,
        researchMet: !def.research || done.has(def.research),
        minTier: def.minTier || null,
        nextLevelTier,
        nextLevelTierMet,
        levelTierReq: def.levelTierReq || null,
        cost,
        discount: discount.parts.length ? discount.parts : null,
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

    if (!tierMetFor(def, settlement.tier))
      return res.status(400).json({ error: `Requires a ${tierLabel(def.minTier)} settlement.` });

    if (currentLevel >= def.maxLevel)
      return res.status(400).json({ error: 'Already at max level.' });

    if (!levelTierMet(def, currentLevel + 1, settlement.tier))
      return res.status(400).json({ error: `Level ${currentLevel + 1} ${def.label} requires a ${tierLabel(levelTierFor(def, currentLevel + 1))} settlement.` });

    if (def.research && !(await require('../lib/research').doneSet(null, settlement.id)).has(def.research))
      return res.status(400).json({ error: `Study ${RS.label(def.research)} at a Library first.` });

    // Check requirements
    for (const req of def.requires) {
      const reqCheck = await query(
        'SELECT id FROM buildings WHERE settlement_id=$1 AND type=$2',
        [settlement.id, req]
      );
      if (!reqCheck.rows.length)
        return res.status(400).json({ error: `Requires ${BUILDINGS[req]?.label || req} first.` });
    }

    // Scale cost by level, less any discount (Engineering…)
    const cost = scaledCost(def, currentLevel + 1, (await buildDiscount(settlement.id)).mult);

    // Check resources (any resource in lib/resource_defs.js)
    for (const [r, v] of Object.entries(cost)) {
      if (!RD.isResource(r)) continue;
      if (v > (Number(settlement[r]) || 0)) return res.status(400).json({ error: `Not enough ${RD.label(r).toLowerCase()}. Need ${v}.` });
    }

    // Deduct resources
    const costKeys = Object.keys(cost).filter(r => RD.isResource(r) && cost[r] > 0);
    if (costKeys.length) await query(
      `UPDATE settlements SET ${costKeys.map((r, i) => `${r} = ${r} - $${i + 1}`).join(', ')} WHERE id = $${costKeys.length + 1}`,
      [...costKeys.map(r => cost[r]), settlement.id]);

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
      const keys = Object.keys(refund).filter(r => RD.isResource(r) && refund[r] > 0);
      if (keys.length) await query(
        `UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} + $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`,
        [...keys.map(r => refund[r]), settlement.id]);
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

    // Careers: anyone whose job needed this building goes foraging (their
    // time so far is credited to the old job first).
    if (rolesForBuilding.length) {
      const careers = require('../lib/careers');
      await careers.settle(settlement.id, { force: true });
      await careers.fixRoles(settlement.id);
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
module.exports.buildDiscount = buildDiscount;
