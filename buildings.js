// ── Building definitions ──
//
// Optional fields: requires (building ids that must exist), levelTierReq
// ({ level: tier } — the tier needed to build that level), tierCaps
// (per-tier count cap for housing), minTier (lowest settlement tier that may
// build it — compared through TIER_ORDER).

// Settlement tiers, lowest first. Shared by routes/game.js (tier upgrades)
// and routes/buildings.js (minTier gating).
const TIER_ORDER = ['camp', 'village', 'town', 'city'];

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
    desc: 'Traders bring wealth from distant settlements. Unlocks player trading — each level carries more per caravan and adds a merchant.',
    icon: '⚖️',
    cost: { timber: 60, food: 30 },
    maxLevel: 5,
    // Settlement tier needed to build each level (lib/market.js caps).
    levelTierReq: { 2: 'village', 3: 'town', 4: 'city', 5: 'city' },
    effect: (level) => ({ wealth: level * 8 }),
    citizenSlots: (level) => level,  // merchant slots = market level
    stallSlots: (level) => level + 1,  // item stalls (one listing each)
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
    stallSlots: (level) => Math.min(10, level * 2),   // fish & food stall
    requires: [],
  },
  guild_hall: {
    id: 'guild_hall',
    label: 'Guild Hall',
    desc: 'A hall of banners and long tables. Required to found a clan.',
    icon: '🏛️',
    cost: { timber: 400, stone: 400, wealth: 300 },
    maxLevel: 1,                 // HQ visual tiers are Future (spec 016)
    effect: () => ({}),
    citizenSlots: () => 0,
    requires: [],
    minTier: 'town',             // enforced in routes/buildings.js
  },
  // Miners' workplace (careers): miners need one. Badger quarries and Mole
  // starter mines are this building.
  mine: {
    id: 'mine',
    label: 'Mine',
    desc: 'Shafts into the hillside. Miners dig stone and ore here — they need a Mine to work.',
    icon: '⛏️',
    cost: { timber: 60, food: 30 },
    maxLevel: 3,
    effect: (level) => ({ stone: level * 4, metal: level * 2 }),
    citizenSlots: (level) => level * 2,
    requires: [],
  },
  // Shops (Market v2): item stalls run by a shopkeeper citizen. Storefronts
  // for now — crafting arrives with advanced jobs on these same buildings.
  smithy: {
    id: 'smithy',
    label: 'Smithy',
    desc: 'An anvil and a counter. Sells weapons, armour and tools to other towns while a shopkeeper minds it.',
    icon: '⚒️',
    cost: { timber: 120, stone: 80, metal: 40 },
    maxLevel: 3,
    effect: () => ({}),
    citizenSlots: () => 1,           // the shopkeeper
    stallSlots: (level) => level * 4,
    requires: [],
    minTier: 'village',
  },
  jeweller: {
    id: 'jeweller',
    label: 'Jeweller',
    desc: 'Glass cases and a careful eye. Sells trinkets and trophies while a shopkeeper minds it.',
    icon: '💍',
    cost: { stone: 60, metal: 30, wealth: 120 },
    maxLevel: 3,
    effect: () => ({}),
    citizenSlots: () => 1,
    stallSlots: (level) => level * 4,
    requires: [],
    minTier: 'town',
  },
};

// Citizen role → building it contributes to
// (Careers: lib/careers/classes.js `needs` is the source of truth — a
// class whose building is gone falls back to Forager.)
const ROLE_BUILDING_MAP = {
  farmer:      ['farm'],
  woodcutter:  ['lumber_camp'],
  scout:       ['scout_post'],
  miner:       ['mine'],
  crafter:     [],
  fisher:      ['fishing_post'],
  soldier:     [],
  idle:        [],
  tavernkeep:   ['tavern'],
};

// Per-citizen production (careers). Lazy require: profiles → classes, no cycle.
function citizenContributions(buildings, citizens) {
  return require('./lib/careers/profiles').citizenContributions(buildings, citizens, BUILDINGS);
}

// Calculate total resource rates for a settlement
// `outposts` (010): [{ terrain, level }, ...] — optional 4th param so the
// two pre-outpost call sites keep working unchanged. Yields are integer /hr
// by config, so the production floor in applyTick gains no new residue.
function calculateRates(buildings, citizens, species, outposts = []) {
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

  // Citizens at work (careers: per-citizen output from stats, perks, traits
  // and gear — lib/careers/profiles.js; no profile = the flat role bonus).
  const contrib = citizenContributions(buildings, citizens);
  for (const out of contrib.perCitizen.values()) {
    for (const [res, val] of Object.entries(out)) {
      const r = res.startsWith('crew_') ? res.slice(5) : res;
      if (rates[r] !== undefined) rates[r] += val;
    }
  }
  for (const r of Object.keys(rates)) rates[r] = Math.round(rates[r] * 100) / 100;

  // Outpost yields (010) — primary × level per outpost (secondaries are a
  // config flip in outposts_config.js, no change needed here).
  if (Array.isArray(outposts) && outposts.length) {
    const { outpostYields } = require('./outposts_config');
    for (const o of outposts) {
      const y = outpostYields(o.terrain, o.level);
      for (const [res, val] of Object.entries(y)) {
        if (rates[res] !== undefined) rates[res] += val;
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
// `outposts` (010): [{ id, tile_q, tile_r, terrain, level }, ...] — one
// source row per outpost per resource (kind: 'outpost'), pushed BEFORE the
// season multiplier so applyBreakdownSeasonModifiers scales it like every
// other production source.
function calculateRatesBreakdown(buildings, citizens, species, outposts = []) {
  const BASE_RATES = {
    Mice:    { food:20, timber:10, stone:5,  metal:3,  wealth:8  },
    Badgers: { food:12, timber:15, stone:12, metal:8,  wealth:5  },
    Otters:  { food:18, timber:8,  stone:4,  metal:3,  wealth:14 },
    Moles:   { food:10, timber:12, stone:10, metal:15, wealth:4  },
    Foxes:   { food:12, timber:10, stone:5,  metal:4,  wealth:12 },
    Hares:   { food:16, timber:12, stone:6,  metal:5,  wealth:8  },
  };
  const baseSpeciesRates = BASE_RATES[species] || BASE_RATES.Mice;

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

  // Citizen contributions, one row per role per resource with the citizens
  // who made it (each citizen's own share rides along). Careers make shares
  // differ: stats, perks, traits and gear. "Skilled crews" is the extra a
  // better-than-average crew gets out of its building.
  const contrib = citizenContributions(buildings, citizens);
  const ROLE_LABEL = { soldier: 'Guard', crafter: 'Artisan' };
  for (const [role, members] of contrib.byRole) {
    const totals = {};
    for (const m of members) {
      for (const [res, val] of Object.entries(contrib.perCitizen.get(m.id) || {})) {
        if (res.startsWith('crew_')) continue;
        (totals[res] = totals[res] || []).push({ m, val });
      }
    }
    for (const [res, rows] of Object.entries(totals)) {
      if (breakdown[res] === undefined) continue;
      const total = Math.round(rows.reduce((a, r) => a + r.val, 0) * 100) / 100;
      let labelExtra = '';
      if (role === 'fisher' && res === 'food' && contrib.fishingBonus > 0) labelExtra = `, with Fishing Post +${Math.round(contrib.fishingBonus * 100)}%`;
      if (role === 'forager' && contrib.hutBonus > 0) labelExtra = `, with Forager Hut +${Math.round(contrib.hutBonus * 100)}%`;
      const name = ROLE_LABEL[role] || (role.charAt(0).toUpperCase() + role.slice(1));
      breakdown[res].sources.push({
        kind: 'citizen_role',
        role,
        label: `${name}s (×${members.length}${labelExtra})`,
        per_citizen: Math.round(total / members.length * 100) / 100,
        count: members.length,
        value: total,
        citizens: rows.map(r => ({ id: r.m.id, name: r.m.name, value: r.val })),
      });
      breakdown[res].total += total;
    }
  }
  for (const [res, val] of Object.entries(contrib.crew)) {
    if (breakdown[res] === undefined || !val) continue;
    const cits = [];
    for (const m of citizens) { const v = (contrib.perCitizen.get(m.id) || {})['crew_' + res]; if (v) cits.push({ id: m.id, name: m.name, value: Math.round(v * 100) / 100 }); }
    breakdown[res].sources.push({ kind: 'citizen_crew', label: val > 0 ? 'Skilled crews' : 'Unskilled crews', value: val, citizens: cits });
    breakdown[res].total += val;
  }
  for (const res of Object.keys(breakdown)) breakdown[res].total = Math.round(breakdown[res].total * 100) / 100;

  // Outpost contributions (010). One row per outpost per resource so the
  // player sees exactly what each stands for — "Farmstead (12·30): +6".
  // tile coords ride along for a future deep-link (pan map to tile).
  if (Array.isArray(outposts) && outposts.length) {
    const { OUTPOST_CONFIG, outpostYields } = require('./outposts_config');
    for (const o of outposts) {
      const cfg = OUTPOST_CONFIG[o.terrain] || {};
      const y = outpostYields(o.terrain, o.level);
      for (const [res, val] of Object.entries(y)) {
        if (breakdown[res] === undefined) continue;
        breakdown[res].sources.push({
          kind: 'outpost',
          terrain: o.terrain,
          outpost_id: o.id != null ? o.id : null,
          tile_q: o.tile_q,
          tile_r: o.tile_r,
          level: o.level || 1,
          label: `${cfg.name || 'Outpost'} (${o.tile_q}·${o.tile_r})${(o.level || 1) > 1 ? ` lvl ${o.level}` : ''}`,
          value: val,
        });
        breakdown[res].total += val;
      }
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

module.exports = { BUILDINGS, TIER_ORDER, ROLE_BUILDING_MAP, calculateRates, calculateRatesBreakdown, applyBreakdownSeasonModifiers, citizenContributions };
