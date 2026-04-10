const express = require('express');
const db = require('../db');
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

function applyTick(settlement, species) {
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
  db.prepare(`
    UPDATE settlements
    SET food=?, timber=?, stone=?, metal=?, wealth=?, last_tick=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(updated.food, updated.timber, updated.stone, updated.metal, updated.wealth, settlement.id);

  return { ...settlement, ...updated };
}

router.get('/settlement', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  let settlement = db.prepare('SELECT * FROM settlements WHERE user_id = ?').get(user.id);
  if (!settlement) return res.status(404).json({ error: 'No settlement found.' });

  settlement = applyTick(settlement, user.species);
  const buildings = db.prepare('SELECT type, level FROM buildings WHERE settlement_id = ?').all(settlement.id);
  const rates = SPECIES_RATES[user.species] || SPECIES_RATES.Mice;

  res.json({
    ok: true,
    settlement: {
      id: settlement.id,
      name: settlement.name,
      tier: settlement.tier,
      resources: {
        food: settlement.food, timber: settlement.timber,
        stone: settlement.stone, metal: settlement.metal, wealth: settlement.wealth,
      },
      rates,
      population: settlement.population,
      population_cap: settlement.population_cap,
      happiness: settlement.happiness,
    },
    buildings,
    species: user.species,
    username: user.username,
  });
});

router.patch('/settlement/rename', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2)
    return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  const settlement = db.prepare('SELECT id FROM settlements WHERE user_id = ?').get(req.user.userId);
  if (!settlement) return res.status(404).json({ error: 'No settlement found.' });
  db.prepare('UPDATE settlements SET name = ? WHERE id = ?').run(name.trim(), settlement.id);
  res.json({ ok: true, name: name.trim() });
});

module.exports = router;
