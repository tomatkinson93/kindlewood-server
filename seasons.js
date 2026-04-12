// ── Season system ──
// 1 real day = 1 in-game year, split into 4 seasons of 6 hours each

const SEASON_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
const YEAR_DURATION_MS = 24 * 60 * 60 * 1000;  // 24 hours

const SEASONS = [
  {
    id: 'spring',
    name: 'Spring',
    emoji: '🌸',
    flavor: 'New growth stirs in the woodland.',
    modifiers: {
      food: 1.20,
      timber: 1.0,
      stone: 1.0,
      metal: 1.0,
      wealth: 1.0,
    },
    foodConsumption: 1.0,
    timberConsumption: 1.0,
    birthChanceBonus: 0.10,
  },
  {
    id: 'summer',
    name: 'Summer',
    emoji: '☀️',
    flavor: 'Long days and warm sun — peak harvest.',
    modifiers: {
      food: 1.30,
      timber: 1.0,
      stone: 1.0,
      metal: 1.0,
      wealth: 1.10,
    },
    foodConsumption: 1.0,
    timberConsumption: 1.0,
    birthChanceBonus: 0,
  },
  {
    id: 'autumn',
    name: 'Autumn',
    emoji: '🍂',
    flavor: 'The harvest is in. Prepare for the cold.',
    modifiers: {
      food: 1.10,
      timber: 1.10,
      stone: 1.0,
      metal: 1.0,
      wealth: 1.0,
    },
    foodConsumption: 1.0,
    timberConsumption: 1.0,
    birthChanceBonus: 0,
  },
  {
    id: 'winter',
    name: 'Winter',
    emoji: '❄️',
    flavor: 'Harsh cold grips the realm. Guard your stores.',
    modifiers: {
      food: 0.40,
      timber: 1.0,
      stone: 0.90,
      metal: 1.0,
      wealth: 0.90,
    },
    foodConsumption: 1.20,
    timberConsumption: 1.50,
    birthChanceBonus: -0.05,
  },
];

function getCurrentSeason() {
  const now = Date.now();
  // Season is based on time-of-day UTC, cycling every 6 hours
  const msIntoDay = now % YEAR_DURATION_MS;
  const seasonIndex = Math.floor(msIntoDay / SEASON_DURATION_MS);
  const season = SEASONS[seasonIndex];
  const msIntoSeason = msIntoDay % SEASON_DURATION_MS;
  const msRemaining = SEASON_DURATION_MS - msIntoSeason;
  const progress = msIntoSeason / SEASON_DURATION_MS;

  // Day number: days since a fixed epoch (Jan 1 2025)
  const epoch = new Date('2025-01-01T00:00:00Z').getTime();
  const dayNumber = Math.floor((now - epoch) / YEAR_DURATION_MS) + 1;

  return {
    ...season,
    index: seasonIndex,
    progress,           // 0-1 through current season
    msRemaining,
    dayNumber,
    year: Math.ceil(dayNumber / 1),
  };
}

function applySeasonModifiers(rates, season) {
  const modified = { ...rates };
  for (const [res, mult] of Object.entries(season.modifiers)) {
    if (modified[res] !== undefined) {
      modified[res] = Math.round(modified[res] * mult);
    }
  }
  return modified;
}

module.exports = { SEASONS, getCurrentSeason, applySeasonModifiers };
