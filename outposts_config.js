// ══════════════════════════════════════════════════════════════════════════
//  OUTPOSTS — config & tunables (server root, alongside buildings.js)
//  (The original outposts_v1_spec.md isn't in the repo; this file is now
//  the reference for outposts.)
//
//  Single source of truth for yields, costs, caps, ranges, and upkeep.
//  Requires nothing → safe to require from buildings.js, famine.js, and
//  any route without circular-dependency risk.
//
//  Yields: `primary` plus a small `secondary` (SECONDARY_YIELDS_ENABLED),
//    both × level × the outpost's multiplier (lib/outpost_state: a worker
//    +25%/+50%, unfed upkeep ×0.5), rounded to whole units per hour.
//    • level (1–OUTPOST_MAX_LEVEL) scales yields, ores and food upkeep;
//      POST /api/game/outposts/:id/upgrade raises it (routes/outposts.js).
//    • `ores` (per hour × level): extra resources a terrain turns up
//      (lib/ores.js). Research-gated ones (resource_defs) only once studied.
//    • Upkeep is SEASON-FLAT (no winter ×1.20) by design — winter already
//      squeezes outpost YIELDS via the production season modifier; flat
//      upkeep squeezes one end only. See spec §5.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const OUTPOST_CONFIG = {
  plains:   { name: 'Farmstead',      icon: '🌾', primary: { food: 6 },   secondary: { wealth: 1 } },
  forest:   { name: 'Logging Camp',   icon: '🪓', primary: { timber: 6 }, secondary: { food: 1 } },
  hills:    { name: 'Quarry',         icon: '⛏️', primary: { stone: 5 },  secondary: { metal: 1 },
              ores: { copper: 0.6, tin: 0.5, coal: 0.8 } },
  mountain: { name: 'Mine',           icon: '⚒️', primary: { metal: 5 },  secondary: { stone: 1 },
              ores: { silver: 0.4, goldore: 0.25, gems: 0.06, obsidian: 0.2, mithril: 0.03, moonsilver: 0.03 } },
  river:    { name: 'Fishing Wharf',  icon: '🎣', primary: { wealth: 4 }, secondary: { food: 2 } },
  marsh:    { name: "Forager's Camp", icon: '🌿', primary: { food: 4 },   secondary: { timber: 1 } },
  ruins:    { name: 'Excavation',     icon: '🏺', primary: { wealth: 4 }, secondary: { metal: 1 } },
};

const SECONDARY_YIELDS_ENABLED = true;

// One outpost eats like one adult citizen (UPKEEP_BY_STAGE.adult = 1.0 in
// famine.js) — a legible unit. Fallback knob if playtests say it stings: 0.5.
const OUTPOST_FOOD_UPKEEP_PER_HR = 1;

// Flat v1 cost, all terrains. Per-terrain differentiation is a data edit here.
// Payback ≈ 210 resource-units / ~5 net units·hr⁻¹ ≈ 1.75 days.
const OUTPOST_COST = { timber: 120, stone: 60, wealth: 30 };

// Upgrades (POST /api/game/outposts/:id/upgrade): up to Lv3. Going to level
// L costs OUTPOST_COST × L × 1.5 (less building discounts), plus bronze at
// Lv3, which also needs a Town. Yields, ores and food upkeep scale with level.
const OUTPOST_MAX_LEVEL = 3;
const OUTPOST_LEVEL_EXTRA = { 3: { bronze: 15 } };
const OUTPOST_LEVEL_TIER = { 3: 'town' };
function upgradeCost(level, mult = 1) {
  const out = Object.fromEntries(Object.entries(OUTPOST_COST).map(([r, v]) => [r, Math.ceil(v * level * 1.5 * mult)]));
  for (const [r, v] of Object.entries(OUTPOST_LEVEL_EXTRA[level] || {})) out[r] = (out[r] || 0) + Math.ceil(v * mult);
  return out;
}

// Standalone claim (territory without an outpost) — API completeness; the v1
// UI only exposes build-which-auto-claims.
const CLAIM_COST = { wealth: 10 };

const OUTPOST_RANGE_BY_TIER = { camp: 2, village: 3, town: 4, city: 5 };
const OUTPOST_CAP_BY_TIER   = { camp: 1, village: 2, town: 4, city: 6 };

function rangeForTier(tier) {
  return OUTPOST_RANGE_BY_TIER[tier] || OUTPOST_RANGE_BY_TIER.camp;
}
function capForTier(tier) {
  return OUTPOST_CAP_BY_TIER[tier] || OUTPOST_CAP_BY_TIER.camp;
}

// Per-outpost yield table for a terrain at a level. Integer rates only —
// the production tick floors running totals, and integer /hr yields add no
// new fractional residue (spec §5, floor-loss note).
function outpostYields(terrain, level = 1, mult = 1) {
  const cfg = OUTPOST_CONFIG[terrain];
  if (!cfg) return {};
  const lvl = Math.max(1, Math.floor(level) || 1);
  const m = Number.isFinite(mult) ? Math.max(0, mult) : 1;
  const out = {};
  const add = obj => { for (const [res, val] of Object.entries(obj || {})) out[res] = (out[res] || 0) + val * lvl; };
  add(cfg.primary);
  if (SECONDARY_YIELDS_ENABLED) add(cfg.secondary);
  for (const res of Object.keys(out)) out[res] = Math.round(out[res] * m);
  return out;
}

// What a dismantle gives back: half of the build cost and of every upgrade
// paid (at list price — discounts aren't remembered), rounded down.
const DISMANTLE_REFUND = 0.5;
function dismantleRefund(level = 1) {
  const paid = { ...OUTPOST_COST };
  for (let L = 2; L <= Math.max(1, Math.floor(level) || 1); L++) {
    for (const [r, v] of Object.entries(upgradeCost(L))) paid[r] = (paid[r] || 0) + v;
  }
  return Object.fromEntries(Object.entries(paid).map(([r, v]) => [r, Math.floor(v * DISMANTLE_REFUND)]).filter(([, v]) => v > 0));
}

// Public (client-safe) subset for GET /api/game/outposts — display config so
// the frontend never hardcodes yields/costs.
function publicConfig() {
  const cfg = {};
  for (const [terrain, c] of Object.entries(OUTPOST_CONFIG)) {
    cfg[terrain] = { name: c.name, icon: c.icon, yields: outpostYields(terrain, 1), ores: c.ores || {} };
  }
  return cfg;
}

module.exports = {
  OUTPOST_CONFIG,
  SECONDARY_YIELDS_ENABLED,
  OUTPOST_FOOD_UPKEEP_PER_HR,
  OUTPOST_COST,
  OUTPOST_MAX_LEVEL,
  OUTPOST_LEVEL_TIER,
  upgradeCost,
  CLAIM_COST,
  OUTPOST_RANGE_BY_TIER,
  OUTPOST_CAP_BY_TIER,
  rangeForTier,
  capForTier,
  outpostYields,
  dismantleRefund,
  DISMANTLE_REFUND,
  publicConfig,
};
