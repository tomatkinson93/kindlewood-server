const { getCurrentSeason, applySeasonModifiers } = require('../seasons');
const { runSimulation } = require('../simulation');
const { generateCitizen } = require('../citizens');
const express = require('express');
const { calculateRates } = require('../buildings');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const SPECIES_RATES = {
  Mice:    { food: 20, timber: 10, stone: 5,  metal: 3, wealth: 8  },
  Badgers: { food: 12, timber: 8,  stone: 10, metal: 6, wealth: 4  },
  Otters:  { food: 15, timber: 6,  stone: 4,  metal: 3, wealth: 14 },
  Moles:   { food: 10, timber: 12, stone: 12, metal: 8, wealth: 5  },
  Foxes:   { food: 14, timber: 10, stone: 4,  metal: 5, wealth: 10 },
  Hares:   { food: 18, timber: 8,  stone: 4,  metal: 3, wealth: 6  },
};

async function applyTick(settlement, species) {
  const now = Date.now();
  const lastTick = new Date(settlement.last_tick).getTime();
  const hoursElapsed = (now - lastTick) / (1000 * 60 * 60);
  if (hoursElapsed < 0.005) return settlement;

  const [bRes, cRes] = await Promise.all([
    query('SELECT type, level FROM buildings WHERE settlement_id=$1', [settlement.id]),
    query('SELECT role FROM citizens WHERE settlement_id=$1', [settlement.id]),
  ]);
  const season = getCurrentSeason();
  const baseRates = calculateRates(bRes.rows, cRes.rows, species);
  const rates = applySeasonModifiers(baseRates, season);
  const updated = {
    food:   Math.floor(settlement.food   + rates.food   * hoursElapsed),
    timber: Math.floor(settlement.timber + rates.timber * hoursElapsed),
    stone:  Math.floor(settlement.stone  + rates.stone  * hoursElapsed),
    metal:  Math.floor(settlement.metal  + rates.metal  * hoursElapsed),
    wealth: Math.floor(settlement.wealth + rates.wealth * hoursElapsed),
  };

  await query(`
    UPDATE settlements
    SET food=$1, timber=$2, stone=$3, metal=$4, wealth=$5, last_tick=NOW()
    WHERE id=$6
  `, [updated.food, updated.timber, updated.stone, updated.metal, updated.wealth, settlement.id]);

  // Run relationship/bonding/breeding simulation (gated by last_sim_tick)
  try {
    const simTickRes = await query(
      'SELECT last_sim_tick FROM settlements WHERE id=$1', [settlement.id]
    );
    const lastSim = simTickRes.rows[0]?.last_sim_tick;
    const simHoursElapsed = lastSim
      ? (Date.now() - new Date(lastSim).getTime()) / (1000 * 60 * 60)
      : 1.0;
    if (simHoursElapsed >= 1.0) {
      await runSimulation({ id: settlement.id }, simHoursElapsed);
    }
  } catch(simErr) {
    console.error('Simulation tick error:', simErr.message);
  }

  return { ...settlement, ...updated };
}

router.get('/settlement', requireAuth, async (req, res) => {
  console.log(`SETTLEMENT fetched: user=${req.user.userId} time=${Date.now()}`);
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let settlementResult = await query('SELECT * FROM settlements WHERE user_id=$1', [user.id]);
    let settlement = settlementResult.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });

    settlement = await applyTick(settlement, user.species);

    const buildingsResult = await query(
      'SELECT type, level FROM buildings WHERE settlement_id=$1',
      [settlement.id]
    );
    const citizensResult = await query(
      'SELECT role FROM citizens WHERE settlement_id=$1',
      [settlement.id]
    );
    const season = getCurrentSeason();
    const baseRates = calculateRates(buildingsResult.rows, citizensResult.rows, user.species);
    const rates = applySeasonModifiers(baseRates, season);

    console.log(`SETTLEMENT returning tile_x=${settlement.tile_x} for user=${req.user.userId}`);
    res.json({
      ok: true,
      settlement: {
        id: settlement.id,
        name: settlement.name,
        tier: settlement.tier,
        tile_x: settlement.tile_x,
        tile_y: settlement.tile_y,
        isNewSettlement: settlement.tile_x === null,
        resources: {
          food: settlement.food, timber: settlement.timber,
          stone: settlement.stone, metal: settlement.metal, wealth: settlement.wealth,
        },
        rates,
        baseRates,
        season,
        population: settlement.population,
        population_cap: settlement.population_cap,
        happiness: (() => {
          // Base happiness + 10% per tavernkeep
          const tavernkeepCount = citizensResult.rows.filter(c => c.role === 'tavernkeep').length;
          const base = typeof settlement.happiness === 'number' ? settlement.happiness : 70;
          return Math.min(100, base + tavernkeepCount * 10);
        })(),
        last_tick: settlement.last_tick,
      },
      buildings: buildingsResult.rows,
      species: user.species,
      username: user.username,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settlement.' });
  }
});

router.patch('/settlement/rename', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2)
    return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  try {
    const settlementResult = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementResult.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });
    await query('UPDATE settlements SET name=$1 WHERE id=$2', [name.trim(), settlement.id]);
    res.json({ ok: true, name: name.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Rename failed.' });
  }
});

// Cheat: add one citizen
router.post('/cheat/citizen', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const settlementRes = await query('SELECT * FROM settlements WHERE user_id=$1', [user.id]);
    if (!settlementRes.rows.length) return res.status(404).json({ error: 'No settlement.' });
    const settlement = settlementRes.rows[0];

    const citizen = generateCitizen(1);
    await query(
      `INSERT INTO citizens (settlement_id, name, gender, generation, role, stats, skills, life, repro, visible_traits, hidden_traits, born_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [settlement.id, citizen.name, citizen.gender, citizen.generation, citizen.role,
       JSON.stringify(citizen.stats), JSON.stringify(citizen.skills),
       JSON.stringify(citizen.life), JSON.stringify(citizen.repro),
       JSON.stringify(citizen.visible_traits), JSON.stringify(citizen.hidden_traits)]
    );
    await query('UPDATE settlements SET population = population + 1 WHERE id=$1', [settlement.id]);
    res.json({ ok: true, name: citizen.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add citizen.' });
  }
});


// Award gold from card games
router.post('/award-gold', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const settlementRes = await query('SELECT * FROM settlements WHERE user_id=$1', [user.id]);
    if (!settlementRes.rows.length) return res.status(404).json({ error: 'No settlement.' });
    const settlement = settlementRes.rows[0];
    const { amount } = req.body;
    if (!amount || amount < 0 || amount > 10) return res.status(400).json({ error: 'Invalid amount.' });
    await query(
      'UPDATE settlements SET wealth = wealth + $1 WHERE id = $2',
      [amount, settlement.id]
    );
    res.json({ ok: true, awarded: amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to award gold.' });
  }
});

module.exports = router;

// Dev-only: reset placement for testing
router.post('/reset-placement', requireAuth, async (req, res) => {
  try {
    await query(
      'UPDATE settlements SET tile_x=NULL, tile_y=NULL, rerolls_used=0 WHERE user_id=$1',
      [req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed.' });
  }
});

// ── Cheat menu ──
router.post('/cheat/resources', requireAuth, async (req, res) => {
  try {
    const { food, timber, stone, metal, wealth } = req.body;
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    await query(`
      UPDATE settlements SET
        food   = GREATEST(0, food   + $1),
        timber = GREATEST(0, timber + $2),
        stone  = GREATEST(0, stone  + $3),
        metal  = GREATEST(0, metal  + $4),
        wealth = GREATEST(0, wealth + $5)
      WHERE id = $6
    `, [food||0, timber||0, stone||0, metal||0, wealth||0, settlement.id]);

    const updated = await query('SELECT food,timber,stone,metal,wealth FROM settlements WHERE id=$1', [settlement.id]);
    res.json({ ok: true, resources: updated.rows[0] });
  } catch(err) {
    res.status(500).json({ error: 'Cheat failed.' });
  }
});

// ── Settlement Tier Upgrade ──

const TIER_ORDER = ['camp', 'village', 'town', 'city'];
const TIER_LABELS = { camp: 'Camp', village: 'Village', town: 'Town', city: 'City' };

const TIER_REQUIREMENTS = {
  // To upgrade FROM camp → village
  village: {
    resources: { food: 800, timber: 600, stone: 400, metal: 100, wealth: 200 },
    population: 20,
    buildings: 3,  // must have at least 3 buildings
    label: 'Village',
    unlocks: ['quarry', 'market', 'inn'],
    desc: 'Expand your humble camp into a proper village.',
    popBonus: 50,   // new population cap
  },
  // To upgrade FROM village → town
  town: {
    resources: { food: 2500, timber: 2000, stone: 1500, metal: 400, wealth: 800 },
    population: 40,
    buildings: 6,
    label: 'Town',
    unlocks: ['forge', 'scout_post'],
    desc: 'From village to bustling town — a true settlement.',
    popBonus: 120,
  },
  // To upgrade FROM town → city
  city: {
    resources: { food: 8000, timber: 6000, stone: 5000, metal: 1500, wealth: 3000 },
    population: 80,
    buildings: 9,
    label: 'City',
    unlocks: [],
    desc: 'A great city rises — seat of power in the woodland realm.',
    popBonus: 300,
  },
};

// GET /api/game/tier-info — returns current tier + next tier requirements
router.get('/tier-info', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const s = settlementRes.rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });

    const buildingsRes = await query(
      'SELECT COUNT(*) FROM buildings WHERE settlement_id=$1', [s.id]
    );
    const buildingCount = parseInt(buildingsRes.rows[0].count);

    const currentTierIndex = TIER_ORDER.indexOf(s.tier);
    const nextTier = TIER_ORDER[currentTierIndex + 1];
    const req2 = nextTier ? TIER_REQUIREMENTS[nextTier] : null;

    let canUpgrade = false;
    let requirementsMet = {};
    if (req2) {
      const resOk = Object.entries(req2.resources).every(([r, v]) => (s[r] || 0) >= v);
      const popOk = s.population >= req2.population;
      const bldOk = buildingCount >= req2.buildings;
      canUpgrade = resOk && popOk && bldOk;
      requirementsMet = {
        resources: resOk,
        population: popOk,
        buildings: bldOk,
        current: {
          food: s.food, timber: s.timber, stone: s.stone,
          metal: s.metal, wealth: s.wealth,
          population: s.population,
          buildings: buildingCount,
        },
      };
    }

    res.json({
      ok: true,
      currentTier: s.tier,
      nextTier,
      nextTierLabel: TIER_LABELS[nextTier] || null,
      requirements: req2,
      requirementsMet,
      canUpgrade,
      isMaxTier: s.tier === 'city',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load tier info.' });
  }
});

// POST /api/game/upgrade-tier — perform the upgrade
router.post('/upgrade-tier', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const s = settlementRes.rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });

    const currentTierIndex = TIER_ORDER.indexOf(s.tier);
    if (currentTierIndex < 0 || currentTierIndex >= TIER_ORDER.length - 1) {
      return res.status(400).json({ error: 'Already at maximum tier.' });
    }

    const nextTier = TIER_ORDER[currentTierIndex + 1];
    const reqs = TIER_REQUIREMENTS[nextTier];

    // Check buildings
    const buildingsRes = await query(
      'SELECT COUNT(*) FROM buildings WHERE settlement_id=$1', [s.id]
    );
    const buildingCount = parseInt(buildingsRes.rows[0].count);

    // Validate all requirements
    const errors = [];
    if (s.food   < reqs.resources.food)   errors.push(`Need ${reqs.resources.food} food (have ${s.food})`);
    if (s.timber < reqs.resources.timber) errors.push(`Need ${reqs.resources.timber} timber (have ${s.timber})`);
    if (s.stone  < reqs.resources.stone)  errors.push(`Need ${reqs.resources.stone} stone (have ${s.stone})`);
    if (s.metal  < reqs.resources.metal)  errors.push(`Need ${reqs.resources.metal} metal (have ${s.metal})`);
    if (s.wealth < reqs.resources.wealth) errors.push(`Need ${reqs.resources.wealth} wealth (have ${s.wealth})`);
    if (s.population < reqs.population)   errors.push(`Need ${reqs.population} citizens (have ${s.population})`);
    if (buildingCount < reqs.buildings)    errors.push(`Need ${reqs.buildings} buildings (have ${buildingCount})`);

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0], all: errors });
    }

    // Deduct resources
    await query(`
      UPDATE settlements SET
        food   = food   - $1,
        timber = timber - $2,
        stone  = stone  - $3,
        metal  = metal  - $4,
        wealth = wealth - $5,
        tier   = $6,
        population_cap = $7
      WHERE id = $8
    `, [
      reqs.resources.food, reqs.resources.timber, reqs.resources.stone,
      reqs.resources.metal, reqs.resources.wealth,
      nextTier, reqs.popBonus, s.id,
    ]);

    res.json({
      ok: true,
      newTier: nextTier,
      newTierLabel: TIER_LABELS[nextTier],
      unlocks: reqs.unlocks,
      newPopCap: reqs.popBonus,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upgrade failed.' });
  }
});
