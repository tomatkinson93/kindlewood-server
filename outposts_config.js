// ══════════════════════════════════════════════════════════════════════════
//  OUTPOSTS — config & tunables (server root, alongside buildings.js)
//  Implements outposts_v1_spec.md §§3–4.
//
//  Single source of truth for yields, costs, caps, ranges, and upkeep.
//  Requires nothing → safe to require from buildings.js, famine.js, and
//  any route without circular-dependency risk.
//
//  v1 contract:
//    • primary yields only; `secondary` slots are documented and DISABLED.
//      Turning them on later = set the object + flip SECONDARY_YIELDS_ENABLED.
//    • level is read (yield = primary × level) but nothing writes level > 1
//      yet — the upgrade route is reserved, not built.
//    • Upkeep is SEASON-FLAT (no winter ×1.20) by design — winter already
//      squeezes outpost YIELDS via the production season modifier; flat
//      upkeep squeezes one end only. See spec §5.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const OUTPOST_CONFIG = {
  plains:   { name: 'Farmstead',      icon: '🌾', primary: { food: 6 },   secondary: null /* { wealth: 1 } */ },
  forest:   { name: 'Logging Camp',   icon: '🪓', primary: { timber: 6 }, secondary: null /* { food: 1 }   */ },
  hills:    { name: 'Quarry',         icon: '⛏️', primary: { stone: 5 },  secondary: null /* { metal: 1 }  */ },
  mountain: { name: 'Mine',           icon: '⚒️', primary: { metal: 5 },  secondary: null /* { stone: 1 }  */ },
  river:    { name: 'Fishing Wharf',  icon: '🎣', primary: { wealth: 4 }, secondary: null /* { food: 2 }   */ },
  marsh:    { name: "Forager's Camp", icon: '🌿', primary: { food: 4 },   secondary: null /* { timber: 1 } */ },
  ruins:    { name: 'Excavation',     icon: '🏺', primary: { wealth: 4 }, secondary: null /* { metal: 1 }  */ },
};

const SECONDARY_YIELDS_ENABLED = false;

// One outpost eats like one adult citizen (UPKEEP_BY_STAGE.adult = 1.0 in
// famine.js) — a legible unit. Fallback knob if playtests say it stings: 0.5.
const OUTPOST_FOOD_UPKEEP_PER_HR = 1;

// Flat v1 cost, all terrains. Per-terrain differentiation is a data edit here.
// Payback ≈ 210 resource-units / ~5 net units·hr⁻¹ ≈ 1.75 days.
const OUTPOST_COST = { timber: 120, stone: 60, wealth: 30 };

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
function outpostYields(terrain, level = 1) {
  const cfg = OUTPOST_CONFIG[terrain];
  if (!cfg) return {};
  const lvl = Math.max(1, Math.floor(level) || 1);
  const out = {};
  for (const [res, val] of Object.entries(cfg.primary || {})) {
    out[res] = (out[res] || 0) + val * lvl;
  }
  if (SECONDARY_YIELDS_ENABLED && cfg.secondary) {
    for (const [res, val] of Object.entries(cfg.secondary)) {
      out[res] = (out[res] || 0) + val * lvl;
    }
  }
  return out;
}

// Public (client-safe) subset for GET /api/game/outposts — display config so
// the frontend never hardcodes yields/costs.
function publicConfig() {
  const cfg = {};
  for (const [terrain, c] of Object.entries(OUTPOST_CONFIG)) {
    cfg[terrain] = { name: c.name, icon: c.icon, yields: outpostYields(terrain, 1) };
  }
  return cfg;
}

module.exports = {
  OUTPOST_CONFIG,
  SECONDARY_YIELDS_ENABLED,
  OUTPOST_FOOD_UPKEEP_PER_HR,
  OUTPOST_COST,
  CLAIM_COST,
  OUTPOST_RANGE_BY_TIER,
  OUTPOST_CAP_BY_TIER,
  rangeForTier,
  capForTier,
  outpostYields,
  publicConfig,
};
