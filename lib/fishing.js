// ══════════════════════════════════════════════════════════════════════════
//  fishing — server-authoritative catch rules (pure; no DB, no clock reads).
//
//  The client never chooses a fish or builds an item. routes/fishing.js:
//    POST /cast  → rollCatch() here picks the catch and a bite delay; the
//                  server keeps it as the player's one pending catch.
//    POST /land  → landCheck() rules on timing; the item granted is built by
//                  itemFor() from these tables, never from the request.
//  The client only runs the reeling minigame (it can't be verified, so the
//  timing floor + cast rate limit cap what even a scripted player can earn
//  at roughly what a perfect human player lands).
//
//  Tables moved here from the frontend's js/fishing.js (unchanged values).
//  Hook for later time gates (Moontrout "clear winter nights"): a fish may
//  carry phases: [...] / moons: [...] (KWDayCycle ids); rollCatch honours them.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const D = require('./day_cycle');

const FISH_TABLE = [
  { id:'minnow',     name:'Minnow',      icon:'🐟', rarity:'common',    difficulty:1,  seasons:['spring','summer','autumn','winter'], value:2,   weight:60, flavour:'A small, darting thing. Common but plentiful.' },
  { id:'gudgeon',    name:'Gudgeon',     icon:'🐟', rarity:'common',    difficulty:1,  seasons:['spring','summer','autumn'],          value:2,   weight:55, flavour:'Barely worth the trouble, but the river is full of them.' },
  { id:'dace',       name:'Dace',        icon:'🐠', rarity:'common',    difficulty:2,  seasons:['spring','summer','winter'],          value:4,   weight:45, flavour:'Quick and silver-sided. Slips the hook easily.' },
  { id:'perch',      name:'Perch',       icon:'🐠', rarity:'common',    difficulty:2,  seasons:['spring','summer','autumn'],          value:5,   weight:40, flavour:'Spiny and stubborn. Puts up a decent fight.' },
  { id:'roach',      name:'Roach',       icon:'🐟', rarity:'common',    difficulty:2,  seasons:['spring','autumn','winter'],          value:4,   weight:42, flavour:'Red-finned and restless. A staple of the river.' },
  { id:'trout',      name:'Trout',       icon:'🐡', rarity:'uncommon',  difficulty:4,  seasons:['spring','autumn','winter'],          value:10,  weight:22, flavour:'A strong swimmer. Worth the effort.' },
  { id:'chub',       name:'Chub',        icon:'🐡', rarity:'uncommon',  difficulty:3,  seasons:['summer','autumn'],                   value:8,   weight:28, flavour:'Thick-bodied and suspicious. Pulls hard when hooked.' },
  { id:'catfish',    name:'Catfish',     icon:'🐊', rarity:'uncommon',  difficulty:5,  seasons:['summer','autumn'],                   value:14,  weight:18, flavour:'Bottom-dwelling and fierce. Hunts at dusk.' },
  { id:'bream',      name:'Bream',       icon:'🐡', rarity:'uncommon',  difficulty:4,  seasons:['spring','summer'],                   value:11,  weight:20, flavour:'Deep-bodied and slow to start, then suddenly wild.' },
  { id:'pike',       name:'Pike',        icon:'🦷', rarity:'uncommon',  difficulty:6,  seasons:['autumn','winter'],                   value:18,  weight:14, flavour:'Teeth like needles and a temper to match.' },
  { id:'salmon',     name:'Salmon',      icon:'🍣', rarity:'rare',      difficulty:7,  seasons:['autumn'],                            value:28,  weight:8,  flavour:'Runs against the current with furious strength.' },
  { id:'eel',        name:'River Eel',   icon:'〰️', rarity:'rare',     difficulty:7,  seasons:['summer','autumn'],                   value:25,  weight:9,  flavour:'Writhes and twists. Keeping it on the line takes nerve.' },
  { id:'golden_carp',name:'Golden Carp', icon:'✨', rarity:'rare',      difficulty:8,  seasons:['winter'],                            value:35,  weight:5,  flavour:'Gleams beneath the ice. Legends say it brings fortune.' },
  { id:'shadowfin',  name:'Shadowfin',   icon:'🌑', rarity:'legendary', difficulty:9,  seasons:['autumn','winter'],                   value:60,  weight:2,  flavour:'Dark as river-bottom mud. Few have seen one. Fewer have caught one.' },
  { id:'moontrout',  name:'Moontrout',   icon:'🌕', rarity:'legendary', difficulty:10, seasons:['winter'],                            value:100, weight:1,  flavour:'Said to swim only on clear winter nights. Landing one is the stuff of legend.' },
];

const JUNK_TABLE = [
  { id:'old_boot',    name:'Old Boot',     icon:'👢', flavour:'Waterlogged and falling apart. Not yours, hopefully.' },
  { id:'tin_can',     name:'Tin Can',      icon:'🥫', flavour:'Rusted through. Something once lived inside it.' },
  { id:'soggy_hat',   name:'Soggy Hat',    icon:'🎩', flavour:'A fine hat, once. The river has had its way with it.' },
  { id:'tangled_net', name:'Tangled Net',  icon:'🕸',  flavour:'Someone lost this long ago. Easy to see why.' },
  { id:'river_stone', name:'Smooth Stone', icon:'🪨', flavour:'Perfectly round. The river shaped it over centuries.' },
  { id:'broken_rod',  name:'Broken Rod',   icon:'🎣', flavour:"Another fisher's misfortune. Maybe it snapped on a big one." },
  { id:'old_coin',    name:'Old Coin',     icon:'🪙', flavour:'Worn smooth. The face on it is unrecognisable.' },
];

const FISH_FOOD_VALUE = { common: 3, uncommon: 8, rare: 18, legendary: 40, junk: 0 };
const FISH_SELL_VALUE = { common: 2, uncommon: 8, rare: 22, legendary: 55, junk: 1 };
const FISH_SIZE_LABEL = { common: 'Small', uncommon: 'Medium', rare: 'Large', legendary: 'Trophy', junk: 'Junk' };

const JUNK_CHANCE_NORMAL = 0.07;
const JUNK_CHANCE_RIPPLE = 0.03;

// ── Timing (ms) ────────────────────────────────────────────────────────────
const BITE_MIN_MS = 2000, BITE_SPREAD_MS = 3000;   // bite 2–5s after the cast (as before)
const BITE_WINDOW_MS = 1000;                       // time to strike once it bites (as before)
// Fastest possible reel: the minigame starts at 25% and fills 0.32%/frame at
// 60fps while on target → 75 / 0.32 / 60 ≈ 3.9s. The floor leaves slack for
// timer jitter; landing sooner than this is impossible for a real player.
const MIN_REEL_MS = 3000;
const PENDING_TTL_MS = 5 * 60 * 1000;              // an abandoned catch expires
// Cast rate limit (per player): at most CASTS_PER_MIN in any rolling minute.
const CASTS_PER_MIN = 12;
const CAST_MIN_GAP_MS = 2000;

// Fish in season (and, if a fish declares them, in phase / moon) at ms.
function poolAt(ms, seasonId) {
  const ph = D.phaseAt(ms).phase, moon = D.moonAt(ms).id;
  return FISH_TABLE.filter(f => f.seasons.includes(seasonId) &&
    (!f.phases || f.phases.includes(ph)) && (!f.moons || f.moons.includes(moon)));
}

// rng() → [0,1). Returns { kind: 'fish'|'junk', fish, biteDelayMs }.
// mods: Happening modifiers (junk_catch scales the junk chance, rare_fish
// scales the weights of rare + legendary fish).
function rollCatch(rng, ms, seasonId, inRipple, mods) {
  mods = mods || {};
  const biteDelayMs = Math.round(BITE_MIN_MS + rng() * BITE_SPREAD_MS);
  const junkChance = Math.min(0.9, (inRipple ? JUNK_CHANCE_RIPPLE : JUNK_CHANCE_NORMAL) * Math.max(0, 1 + (mods.junk_catch || 0)));
  if (rng() < junkChance) {
    const junk = JUNK_TABLE[Math.floor(rng() * JUNK_TABLE.length)];
    return { kind: 'junk', fish: { ...junk, rarity: 'junk', difficulty: 1, value: 0 }, biteDelayMs };
  }
  const pool = poolAt(ms, seasonId);
  if (!pool.length) return { kind: 'fish', fish: FISH_TABLE[0], biteDelayMs };
  const rareX = Math.max(0, 1 + (mods.rare_fish || 0));
  const w = (f) => (f.rarity === 'rare' || f.rarity === 'legendary') ? f.weight * rareX : f.weight;
  const total = pool.reduce((s, f) => s + w(f), 0);
  let roll = rng() * total;
  for (const f of pool) { roll -= w(f); if (roll <= 0) return { kind: 'fish', fish: f, biteDelayMs }; }
  return { kind: 'fish', fish: pool[pool.length - 1], biteDelayMs };
}

// What the client may see about a pending catch (it can't change it anyway).
function publicCatch(c) {
  const f = c.fish;
  const out = { kind: c.kind, id: f.id, name: f.name, icon: f.icon, rarity: f.rarity, difficulty: f.difficulty, flavour: f.flavour };
  if (c.kind === 'fish') {
    const it = itemFor(f);
    out.foodValue = it.metadata.food_value;
    out.sellValue = it.metadata.sell_value;
    out.sizeLabel = FISH_SIZE_LABEL[f.rarity] || 'Small';
  }
  return out;
}

// The inventory item a landed fish becomes — built only from the tables.
function itemFor(fish) {
  const foodVal = FISH_FOOD_VALUE[fish.rarity] || 3;
  const sellVal = fish.value || FISH_SELL_VALUE[fish.rarity] || 2;
  const size = FISH_SIZE_LABEL[fish.rarity] || 'Small';
  return {
    item_key: 'fish_' + fish.id,
    name: fish.name,
    description: size + ' fish. Worth ' + sellVal + ' gold. Eating it restores ' + foodVal + ' food.',
    icon: fish.icon,
    category: 'food',
    rarity: fish.rarity === 'junk' ? 'common' : fish.rarity,
    quantity: 1,
    source: 'fishing',
    metadata: { food_value: foodVal, sell_value: sellVal, flavour: fish.flavour },
  };
}

// Rule on a landing attempt for pending catch p at time now.
// → { ok: true } or { ok: false, error }.
function landCheck(p, now, outcome) {
  if (!p) return { ok: false, error: 'No catch on the line.' };
  if (now > p.castAt + PENDING_TTL_MS) return { ok: false, error: 'That catch got away long ago.' };
  if (outcome === 'lost') return { ok: true };
  if (now < p.biteAt) return { ok: false, error: 'Nothing has bitten yet.' };
  if (p.kind === 'junk') return { ok: true };
  if (now < p.biteAt + MIN_REEL_MS) return { ok: false, error: 'Too quick — the fish is still fighting.' };
  return { ok: true };
}

// Rolling-minute cast limiter. stamps = this player's recent cast times
// (mutated). → { ok } or { ok: false, retryMs }.
function castAllowed(stamps, now) {
  while (stamps.length && stamps[0] <= now - 60000) stamps.shift();
  const last = stamps[stamps.length - 1];
  if (last != null && now - last < CAST_MIN_GAP_MS) return { ok: false, retryMs: CAST_MIN_GAP_MS - (now - last) };
  if (stamps.length >= CASTS_PER_MIN) return { ok: false, retryMs: stamps[0] + 60000 - now };
  stamps.push(now);
  return { ok: true };
}

module.exports = {
  FISH_TABLE, JUNK_TABLE, FISH_FOOD_VALUE, FISH_SELL_VALUE, FISH_SIZE_LABEL,
  JUNK_CHANCE_NORMAL, JUNK_CHANCE_RIPPLE,
  BITE_MIN_MS, BITE_SPREAD_MS, BITE_WINDOW_MS, MIN_REEL_MS, PENDING_TTL_MS, CASTS_PER_MIN, CAST_MIN_GAP_MS,
  poolAt, rollCatch, publicCatch, itemFor, landCheck, castAllowed,
};
