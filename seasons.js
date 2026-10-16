// ── Season system ──
// Spec 021 D1: 28 real hours = 1 in-game year, 4 seasons of 7 hours each.
// Before SEASON_CUTOVER_MS the legacy 6h/24h formula applies unchanged, so
// any offline window that spans the cutover stays deterministic. The
// cutover is 00:00 UTC — the start of Spring under the legacy formula — so
// the season does not jump at the boundary.
//
// This is the ONLY server-side season math. famine.js imports seasonAt from
// here. The frontend mirror is js/seasons.js calcSeasonAt — keep in step
// (scripts/season_cutover_test.js asserts parity).

const HOUR_MS = 60 * 60 * 1000;
const SEASON_DURATION_MS = 7 * HOUR_MS;        // 7 hours
const YEAR_DURATION_MS   = 28 * HOUR_MS;       // 28 hours
const LEGACY_SEASON_MS   = 6 * HOUR_MS;        // pre-cutover
const LEGACY_YEAR_MS     = 24 * HOUR_MS;       // pre-cutover
// Must be a future 00:00 UTC on deploy day. Moving it: any later 00:00 UTC.
const SEASON_CUTOVER_MS  = Date.parse('2026-11-02T00:00:00Z');
const YEAR_EPOCH_MS      = Date.parse('2025-01-01T00:00:00Z');

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

// Legacy year counter: one year per real UTC day since 2025-01-01.
function legacyYearAt(ms) {
  return Math.floor((ms - YEAR_EPOCH_MS) / LEGACY_YEAR_MS) + 1;
}

// Season at an arbitrary timestamp. Pure: no Date.now() inside.
// dayNumber is kept for callers that already read it; it now always equals
// year (the in-game year count), which is what the badge has always shown.
function seasonAt(ms) {
  let msIntoYear, seasonLen, year;
  if (ms < SEASON_CUTOVER_MS) {
    // Legacy formula, exactly as before the cutover.
    msIntoYear = ms % LEGACY_YEAR_MS;
    seasonLen  = LEGACY_SEASON_MS;
    year       = legacyYearAt(ms);
  } else {
    const since = ms - SEASON_CUTOVER_MS;
    msIntoYear = since % YEAR_DURATION_MS;
    seasonLen  = SEASON_DURATION_MS;
    year       = legacyYearAt(SEASON_CUTOVER_MS) + Math.floor(since / YEAR_DURATION_MS);
  }
  const index = Math.floor(msIntoYear / seasonLen);
  const season = SEASONS[index] || SEASONS[0];
  const msIntoSeason = msIntoYear % seasonLen;
  return {
    ...season,
    index,
    progress: msIntoSeason / seasonLen,   // 0-1 through current season
    msRemaining: seasonLen - msIntoSeason,
    dayNumber: year,
    year,
  };
}

function getCurrentSeason() {
  return seasonAt(Date.now());
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

module.exports = {
  SEASONS, getCurrentSeason, seasonAt, legacyYearAt, applySeasonModifiers,
  SEASON_DURATION_MS, YEAR_DURATION_MS, LEGACY_SEASON_MS, LEGACY_YEAR_MS,
  SEASON_CUTOVER_MS, YEAR_EPOCH_MS,
};
