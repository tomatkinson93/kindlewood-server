// ══════════════════════════════════════════════
//  HAPPINESS MODIFIERS
//  Returns a breakdown of factors affecting a citizen's happiness
//  Used by GET /api/citizens and rendered as a tooltip in the frontend
// ══════════════════════════════════════════════

const HAPPINESS_FACTORS = {
  housed:        { label: 'Has housing',        value: +10, icon: '🏡' },
  unhoused:      { label: 'No housing',          value: -15, icon: '🚶' },
  partnered:     { label: 'Has a partner',       value: +8,  icon: '💕' },
  same_house_partner: { label: 'Lives with partner', value: +5, icon: '🏠' },
  child_in_house:{ label: 'Child in household', value: +6,  icon: '🍼' },
  role_farmer:   { label: 'Productive role',    value: +3,  icon: '🌾' },
  role_idle:     { label: 'Idle (no work)',      value: -5,  icon: '💤' },
  on_expedition: { label: 'On expedition',       value: -3,  icon: '🗺' },
  trait_greedy:  { label: 'Greedy trait',        value: -4,  icon: '🍖' },
  trait_loyal:   { label: 'Loyal trait',         value: +3,  icon: '❤️' },
  trait_charming:{ label: 'Charming trait',      value: +2,  icon: '✨' },
  trait_frail:   { label: 'Frail (low health)',  value: -6,  icon: '🩹' },
  low_food:      { label: 'Settlement low on food', value: -8, icon: '🍽' },
  hungry:        { label: 'Hungry',              value: -6,  icon: '🥣' },
  season_spring: { label: 'Spring cheer',        value: +4,  icon: '🌸' },
  season_winter: { label: 'Winter blues',        value: -5,  icon: '❄️' },
};

/**
 * Calculate happiness factors for a citizen given their current state.
 * Returns array of { key, label, value, icon } and a computed total.
 */
function calculateHappinessFactors(citizen, context = {}) {
  const factors = [];

  // Housing
  if (citizen.house_id) {
    factors.push(HAPPINESS_FACTORS.housed);
    // Living with partner?
    if (citizen.partner_id && context.partnerHouseId === citizen.house_id) {
      factors.push(HAPPINESS_FACTORS.same_house_partner);
    }
    // Child in house?
    if (context.houseChildCount > 0) {
      factors.push(HAPPINESS_FACTORS.child_in_house);
    }
  } else {
    factors.push(HAPPINESS_FACTORS.unhoused);
  }

  // Partner
  if (citizen.partner_id) {
    factors.push(HAPPINESS_FACTORS.partnered);
  }

  // Role
  if (citizen.role === 'idle') {
    factors.push(HAPPINESS_FACTORS.role_idle);
  } else if (['farmer','woodcutter','fisher','crafter'].includes(citizen.role)) {
    factors.push(HAPPINESS_FACTORS.role_farmer);
  }

  // On expedition
  if (context.onExpedition) {
    factors.push(HAPPINESS_FACTORS.on_expedition);
  }

  // Traits
  const traits = citizen.visible_traits || [];
  if (traits.includes('greedy'))   factors.push(HAPPINESS_FACTORS.trait_greedy);
  if (traits.includes('loyal'))    factors.push(HAPPINESS_FACTORS.trait_loyal);
  if (traits.includes('charming')) factors.push(HAPPINESS_FACTORS.trait_charming);
  if (traits.includes('frail') || (citizen.life?.health ?? 100) < 30) {
    factors.push(HAPPINESS_FACTORS.trait_frail);
  }

  // Settlement food
  if (context.lowFood) {
    factors.push(HAPPINESS_FACTORS.low_food);
  }

  // Personal hunger (famine ladder stage b′ — spec Q2). Reads the citizen
  // row directly; no new context plumbing needed. Threshold matches
  // famine.js HUNGRY_THRESHOLD.
  if ((citizen.life?.hunger ?? 0) >= 70) {
    factors.push(HAPPINESS_FACTORS.hungry);
  }

  // Season
  const season = context.season;
  if (season === 'spring') factors.push(HAPPINESS_FACTORS.season_spring);
  if (season === 'winter') factors.push(HAPPINESS_FACTORS.season_winter);

  // Compute base + sum of modifiers, clamped 0–100
  const base = 70;
  const delta = factors.reduce((sum, f) => sum + f.value, 0);
  const computed = Math.max(0, Math.min(100, base + delta));

  return { factors, base, delta, computed };
}

module.exports = { calculateHappinessFactors };
