// ── Building definitions ──

const BUILDINGS = {
  forager_hut: {
    id: 'forager_hut',
    imgFile: 'foragerhut.png',
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
    imgFile: 'lumbercamp.png',
    label: 'Lumber Camp',
    desc: 'Organised timber felling. Feeds the settlement\'s building needs.',
    icon: '🪓',
    cost: { food: 40, stone: 30 },
    maxLevel: 3,
    effect: (level) => ({ timber: level * 10 }),
    citizenSlots: (level) => level * 2,
    requires: [],
  },

  scout_post: {
    id: 'scout_post',
    imgFile: 'scoutpost.png',
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
    imgFile: 'granary.png',
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
    imgFile: 'farm.png',
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
    imgFile: 'tavern.png',
    label: 'Tavern',
    desc: 'A warm gathering place. Boosts happiness and unlocks the Innkeeper role.',
    icon: '🍺',
    cost: { timber: 80, food: 60, wealth: 40 },
    maxLevel: 3,
    effect: (level) => ({ happiness: level * 10 }),
    citizenSlots: (level) => level,  // tavernkeep slots = tavern level
    requires: [],
  },
  market: {
    id: 'market',
    imgFile: 'market.png',
    label: 'Market',
    desc: 'Traders bring wealth from distant settlements.',
    icon: '⚖️',
    cost: { timber: 60, food: 30 },
    maxLevel: 3,
    effect: (level) => ({ wealth: level * 8 }),
    citizenSlots: (level) => level,
    requires: [],
  },
  starter_house: {
    id: 'starter_house',
    imgFile: 'willowhut.png',
    label: 'Willow Hut',
    desc: 'A simple home for two citizens. Housed citizens are happier and more productive.',
    icon: '🏡',
    cost: { timber: 40, stone: 20 },
    maxLevel: 60,
    effect: () => ({}),
    citizenSlots: () => 0,
    requires: [],
    capacity: 2,  // citizens per house instance
    isHousing: true,
    // Soft cap per tier (enforced in route) — camp:5, village:15, town:30, city:60
    tierCaps: { camp: 5, village: 15, town: 30, city: 60 },
  },
  fishing_post: {
    id: 'fishing_post',
    imgFile: 'fishingpost.png',
    label: 'Fishing Post',
    desc: 'A riverside dock that improves fishing yields and lets you cast a line yourself.',
    icon: '🎣',
    cost: { timber: 50, stone: 20 },
    maxLevel: 5,
    effect: (level) => ({ food: level * 3 }),
    citizenSlots: (level) => level * 2,
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
  fisher:      ['forager_hut', 'fishing_post'],
  soldier:     [],
  idle:        [],
  tavernkeep:   ['tavern'],
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

  // Fishing Post passive bonus — scales per level, applied as % multiplier to fisher citizen food
  const FISHING_POST_BONUS = [0, 0.10, 0.20, 0.35, 0.50, 0.70];
  const fishingPost = buildings.find(b => b.type === 'fishing_post');
  const fishingPostLevel = fishingPost ? Math.min(fishingPost.level, 5) : 0;
  const fishingBonus = FISHING_POST_BONUS[fishingPostLevel] || 0;

  for (const c of citizens) {
    const bonus = CITIZEN_ROLE_BONUS[c.role] || {};
    for (const [res, val] of Object.entries(bonus)) {
      if (rates[res] !== undefined) {
        // Apply fishing post multiplier to fisher food output
        if (c.role === 'fisher' && res === 'food' && fishingBonus > 0) {
          rates[res] += Math.round(val * (1 + fishingBonus));
        } else {
          rates[res] += val;
        }
      }
    }
  }

  return rates;
}

// ── Per-source rate breakdown ──
// Returns the same totals as calculateRates() but structured as a list of
// contributing sources per resource. The modal renders this directly:
// one row per source, with category icon, label, value, and citizen
// drill-down where applicable. Building IDs and citizen IDs are included
// so the UI can deep-link into the building/citizen modals.
//
// Buildings parameter expected shape: [{ id?, type, level, ... }, ...] —
// id is optional in case the caller's query didn't select it.
// Citizens parameter expected shape: [{ id, name, role }, ...].
//
// The arithmetic mirrors calculateRates exactly. Both functions could
// share a single internal pass — but I'd rather have two readable
// functions than one clever one, given how often these get touched.
function calculateRatesBreakdown(buildings, citizens, species) {
  const BASE_RATES = {
    Mice:    { food:20, timber:10, stone:5,  metal:3,  wealth:8  },
    Badgers: { food:12, timber:15, stone:12, metal:8,  wealth:5  },
    Otters:  { food:18, timber:8,  stone:4,  metal:3,  wealth:14 },
    Moles:   { food:10, timber:12, stone:10, metal:15, wealth:4  },
    Foxes:   { food:12, timber:10, stone:5,  metal:4,  wealth:12 },
    Hares:   { food:16, timber:12, stone:6,  metal:5,  wealth:8  },
  };
  const baseSpeciesRates = BASE_RATES[species] || BASE_RATES.Mice;

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

  const FISHING_POST_BONUS = [0, 0.10, 0.20, 0.35, 0.50, 0.70];
  const fishingPost = buildings.find(b => b.type === 'fishing_post');
  const fishingPostLevel = fishingPost ? Math.min(fishingPost.level, 5) : 0;
  const fishingBonus = FISHING_POST_BONUS[fishingPostLevel] || 0;

  // Initialise the per-resource buckets with the species base as the first
  // source. Every resource always has at least this one row, so the modal
  // never has to handle the "empty list" case.
  const breakdown = {};
  for (const res of ['food', 'timber', 'stone', 'metal', 'wealth']) {
    breakdown[res] = {
      total: baseSpeciesRates[res] || 0,
      sources: [
        { kind: 'species_base', label: `${species || 'Mice'} base`, value: baseSpeciesRates[res] || 0 },
      ],
    };
  }

  // Building contributions, grouped by type+level. Multiple Granaries at
  // level 1 collapse into one row ("Granary ×3 (lvl 1): +12"); a Granary
  // at level 1 and one at level 2 produce two rows so the player can still
  // see per-level numbers. Grouping inside the breakdown rather than the
  // UI because the API response should already be clean — UI is a render
  // layer, not a normalisation layer.
  //
  // We accumulate per-(type, level) into temp maps so the additive math
  // matches the flat calculateRates exactly, then push grouped rows to
  // the breakdown. building_ids array carries every contributing building
  // for potential future deep-link UI; building_id stays null on grouped
  // rows since there's no single one to point at.
  const buildingGroups = new Map(); // key = `${type}|${level}|${res}` → { def, level, count, perBuilding, total, ids }
  for (const b of buildings) {
    const def = BUILDINGS[b.type];
    if (!def) continue;
    const effect = def.effect(b.level);
    for (const [res, val] of Object.entries(effect)) {
      if (breakdown[res] === undefined) continue; // skip non-economic effects like reveal_radius
      const key = `${b.type}|${b.level}|${res}`;
      let g = buildingGroups.get(key);
      if (!g) {
        g = { def, type: b.type, level: b.level, res, count: 0, perBuilding: val, total: 0, ids: [] };
        buildingGroups.set(key, g);
      }
      g.count += 1;
      g.total += val;
      if (b.id != null) g.ids.push(b.id);
    }
  }
  for (const g of buildingGroups.values()) {
    const countLabel = g.count > 1 ? ` ×${g.count}` : '';
    breakdown[g.res].sources.push({
      kind: 'building',
      label: `${g.def.label}${countLabel} (lvl ${g.level})`,
      building_type: g.type,
      level: g.level,
      count: g.count,
      per_building: g.perBuilding,
      building_ids: g.ids,
      value: g.total,
    });
    breakdown[g.res].total += g.total;
  }

  // Citizen role contributions. Group by role (one row per role per resource)
  // and attach the contributing citizens. The Fishing-Post bonus is folded
  // into the fisher row's value and surfaced in the label so the player can
  // see why fishers are producing more than the base 2 food.
  const citizensByRole = new Map();
  for (const c of citizens) {
    if (!citizensByRole.has(c.role)) citizensByRole.set(c.role, []);
    citizensByRole.get(c.role).push(c);
  }
  for (const [role, members] of citizensByRole) {
    const bonus = CITIZEN_ROLE_BONUS[role];
    if (!bonus) continue;
    for (const [res, val] of Object.entries(bonus)) {
      if (breakdown[res] === undefined) continue;
      let perCitizen = val;
      let labelExtra = '';
      if (role === 'fisher' && res === 'food' && fishingBonus > 0) {
        perCitizen = Math.round(val * (1 + fishingBonus));
        labelExtra = `, with Fishing Post +${Math.round(fishingBonus * 100)}%`;
      }
      const total = perCitizen * members.length;
      breakdown[res].sources.push({
        kind: 'citizen_role',
        role,
        label: `${role.charAt(0).toUpperCase() + role.slice(1)}s (×${members.length}${labelExtra})`,
        per_citizen: perCitizen,
        count: members.length,
        value: total,
        citizens: members.map(m => ({ id: m.id, name: m.name })),
      });
      breakdown[res].total += total;
    }
  }

  return breakdown;
}

// Apply season modifiers to a breakdown structure, adding a final
// multiplier source per resource and updating the total. Mirrors what
// applySeasonModifiers does to the flat calculateRates output. Kept
// separate from calculateRatesBreakdown so consumers can choose to
// display pre- or post-season totals (the modal always shows post-season
// since that's what the player actually receives).
function applyBreakdownSeasonModifiers(breakdown, season) {
  if (!season || !season.modifiers) return breakdown;
  const out = {};
  for (const [res, data] of Object.entries(breakdown)) {
    const mult = season.modifiers[res] ?? 1.0;
    if (mult === 1.0) {
      out[res] = data;
      continue;
    }
    // Multiplier sources are additive *after* the sum, not per-source —
    // the season applies to the running total. We model it as one
    // multiplier row appended at the end of the sources list, with the
    // post-multiplier total reflecting the rounding done by
    // applySeasonModifiers (Math.round on the final sum).
    const preTotal = data.total;
    const postTotal = Math.round(preTotal * mult);
    out[res] = {
      total: postTotal,
      sources: [
        ...data.sources,
        {
          kind: 'season_multiplier',
          label: `${season.name} ${mult > 1 ? 'bonus' : 'penalty'} (×${mult.toFixed(2)})`,
          multiplier: mult,
          delta: postTotal - preTotal,  // the visible change vs pre-season total
        },
      ],
    };
  }
  return out;
}

module.exports = { BUILDINGS, ROLE_BUILDING_MAP, calculateRates, calculateRatesBreakdown, applyBreakdownSeasonModifiers };
