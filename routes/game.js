const express = require('express');
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

  const rates = SPECIES_RATES[species] || SPECIES_RATES.Mice;
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

  return { ...settlement, ...updated };
}

router.get('/settlement', requireAuth, async (req, res) => {
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

    const rates = SPECIES_RATES[user.species] || SPECIES_RATES.Mice;

    res.json({
      ok: true,
      settlement: {
        id: settlement.id,
        name: settlement.name,
        tier: settlement.tier,
        tile_x: settlement.tile_x,
        tile_y: settlement.tile_y,
        isNewSettlement: settlement.name === `${user.username}'s Camp`,
        resources: {
          food: settlement.food, timber: settlement.timber,
          stone: settlement.stone, metal: settlement.metal, wealth: settlement.wealth,
        },
        rates,
        population: settlement.population,
        population_cap: settlement.population_cap,
        happiness: settlement.happiness,
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

module.exports = router;
