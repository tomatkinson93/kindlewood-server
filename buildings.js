// ── Building definitions ──

const BUILDINGS = {
  forager_hut: {
    id: 'forager_hut',
    label: 'Forager Hut',
    desc: 'Sends citizens into the woodland to gather food.',
    icon: '🍄',
    cost: { timber: 50, stone: 20 },
    maxLevel: 3,
    effect: (level) => ({ food: level * 8 }),
    citizenSlots: (level) => level * 2,
    requires: [],
  },
  lumber_camp: {
    id: 'lumber_camp',
    label: 'Lumber Camp',
    desc: 'Organised timber felling. Feeds the settlement\'s building needs.',
    icon: '🪓',
    cost: { food: 40, stone: 30 },
    maxLevel: 3,
    effect: (level) => ({ timber: level * 10 }),
    citizenSlots: (level) => level * 2,
    requires: [],
  },
  housing: {
    id: 'housing',
    label: 'Housing',
    desc: 'Simple dwellings that allow your settlement to grow.',
    icon: '🏠',
    cost: { timber: 80, stone: 40 },
    maxLevel: 5,
    effect: (level) => ({ population_cap: level * 5 }),
    citizenSlots: () => 0,
    requires: [],
  },
  scout_post: {
    id: 'scout_post',
    label: 'Scout Post',
    desc: 'Trains scouts to push back the fog of war.',
    icon: '🗺',
    cost: { timber: 60, food: 40 },
    maxLevel: 3,
    effect: (level) => ({ reveal_radius: level * 2 }),
    citizenSlots: (level) => level,
    requires: [],
  },
  granary: {
    id: 'granary',
    label: 'Granary',
    desc: 'Stores surplus food and reduces spoilage.',
    icon: '🌾',
    cost: { timber: 60, stone: 20 },
    maxLevel: 3,
    effect: (level) => ({ food: level * 4 }),
    citizenSlots: () => 1,
    requires: [],
  },
  farm: {
    id: 'farm',
    label: 'Farm',
    desc: 'Cultivated fields that reliably feed your people.',
    icon: '🌱',
    cost: { timber: 40, food: 20 },
    maxLevel: 3,
    effect: (level) => ({ food: level * 12 }),
    citizenSlots: (level) => level * 3,
    requires: ['granary'],
  },
  tavern: {
    id: 'tavern',
    label: 'Tavern',
    desc: 'A warm gathering place. Boosts happiness and unlocks the Innkeeper role.',
    icon: '🍺',
    cost: { timber: 80, food: 60, wealth: 40 },
    maxLevel: 3,
    effect: (level) => ({ happiness: level * 10 }),
    citizenSlots: (level) => level,  // innkeeper slots = tavern level
    requires: ['housing'],
  },
  market: {
    id: 'market',
    label: 'Market',
    desc: 'Traders bring wealth from distant settlements.',
    icon: '⚖️',
    cost: { timber: 60, food: 30 },
    maxLevel: 3,
    effect: (level) => ({ wealth: level * 8 }),
    citizenSlots: (level) => level,
    requires: [],
  },
};

// Citizen role → building it contributes to
const ROLE_BUILDING_MAP = {
  farmer:      ['farm', 'granary', 'forager_hut'],
  woodcutter:  ['lumber_camp'],
  scout:       ['scout_post'],
  miner:       [],
  crafter:     [],
  fisher:      ['forager_hut'],
  soldier:     [],
  idle:        [],
  innkeeper:   ['tavern'],
};

// Calculate total resource rates for a settlement
function calculateRates(buildings, citizens, species) {
  const BASE_RATES = {
    Mice:    { food:20, timber:10, stone:5,  metal:3,  wealth:8  },
    Badgers: { food:12, timber:15, stone:12, metal:8,  wealth:5  },
    Otters:  { food:18, timber:8,  stone:4,  metal:3,  wealth:14 },
    Moles:   { food:10, timber:12, stone:10, metal:15, wealth:4  },
    Foxes:   { food:12, timber:10, stone:5,  metal:4,  wealth:12 },
    Hares:   { food:16, timber:12, stone:6,  metal:5,  wealth:8  },
  };

  const rates = { ...(BASE_RATES[species] || BASE_RATES.Mice) };

  // Building effects
  for (const b of buildings) {
    const def = BUILDINGS[b.type];
    if (!def) continue;
    const effect = def.effect(b.level);
    for (const [res, val] of Object.entries(effect)) {
      if (rates[res] !== undefined) rates[res] += val;
    }
  }

  // Citizen role bonuses — each assigned citizen in a relevant role adds a small boost
  const CITIZEN_ROLE_BONUS = {
    farmer:     { food: 3 },
    woodcutter: { timber: 4 },
    fisher:     { food: 2 },
    miner:      { stone: 3, metal: 2 },
    crafter:    { wealth: 2 },
    scout:      {},
    soldier:    {},
    idle:       {},
  };

  for (const c of citizens) {
    const bonus = CITIZEN_ROLE_BONUS[c.role] || {};
    for (const [res, val] of Object.entries(bonus)) {
      if (rates[res] !== undefined) rates[res] += val;
    }
  }

  return rates;
}

module.exports = { BUILDINGS, ROLE_BUILDING_MAP, calculateRates };
