// ══════════════════════════════════════════════════════════════════════════
//  CAREER TRAITS — what work reveals about a citizen, and what it leaves.
//
//  Hidden (citizens.hidden_traits, rolled at birth; revealed_traits once
//  found out). Effects apply from day one; revealing just tells you.
//    aptitudes  +50% XP in their classes, plus effects. Revealed after 48h
//               worked in a matching class (hint at 24h).
//    aversions  −25% XP in their classes, plus effects. Revealed after 12h
//               (hint at 6h): bad fits show quickly.
//    legacy     the original five hidden traits, each with its own reveal.
//  Earned (citizens.earned_traits [{ id, class?, at }]):
//    veteran    720h in one class; quirk 1,440h (good or bad); old hand 2,160h
//    deeds      counters (porter runs, injuries survived, battles won…)
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const fx = (type, value, param) => (param ? { type, param, value } : { type, value });

const APTITUDES = {
  green_thumb:  { label: 'Green Thumb',  icon: '🌱', classes: ['farmer', 'forager'], effects: [fx('output', 0.1), fx('season', 0.25, 'winter')],
    hint: 'seems to know exactly where things want to grow…', desc: 'Plants thrive around them.' },
  woodwise:     { label: 'Woodwise',     icon: '🌳', classes: ['woodcutter', 'carpenter'], effects: [fx('output', 0.1), fx('find', 0.3, 'timber_bundle'), fx('quality', 5)],
    hint: 'runs a hand along every trunk as if reading it…', desc: 'Understands wood like an old friend.' },
  stone_sense:  { label: 'Stone-Sense',  icon: '🪨', classes: ['miner'], effects: [fx('find', 0.3, 'iron_ore'), fx('find', 0.05, 'gemstone')],
    hint: 'stops sometimes in the tunnels, listening to the rock…', desc: 'Hears where the good seams run.' },
  river_kin:    { label: 'River-Kin',    icon: '🌊', classes: ['fisher'], effects: [fx('output', 0.1), fx('find', 0.3, 'fish')],
    hint: 'is happiest with their feet in the water…', desc: 'The river gives them its best.' },
  silver_tongue:{ label: 'Silver Tongue',icon: '🗣️', classes: ['merchant', 'shopkeeper'], effects: [fx('fee', -0.1)],
    hint: 'talks the other side into a better deal every time…', desc: 'Could sell sand to a mole.' },
  eagle_eye:    { label: 'Eagle Eye',    icon: '🦅', classes: ['scout', 'archer'], effects: [fx('reveal', 1), fx('skill', 1, 'combat')],
    hint: 'spots things on the horizon nobody else can see…', desc: 'Sharper eyes than anyone in the settlement.' },
  tireless:     { label: 'Tireless',     icon: '🏃', classes: ['porter', 'soldier'], effects: [fx('travel', 0.1), fx('stat', 1, 'endurance')],
    hint: 'never seems to need a rest…', desc: 'Goes all day and asks for more.' },
  born_host:    { label: 'Born Host',    icon: '🤗', classes: ['tavernkeep'], effects: [fx('happiness', 2)],
    hint: 'remembers every regular\'s name and drink…', desc: 'Makes everyone feel at home.' },
  steady_hands: { label: 'Steady Hands', icon: '✋', classes: ['jeweller', 'archer', 'crafter'], effects: [fx('skill', 1, 'combat'), fx('output', 0.05), fx('quality', 8)],
    hint: 'has the steadiest hands anyone has seen…', desc: 'Never shakes, never slips.' },
  forge_born:   { label: 'Forge-Born',   icon: '🔥', classes: ['blacksmith'], effects: [fx('quality', 8), fx('craft_speed', 0.1)],
    hint: 'seems oddly at home at the anvil…', desc: 'Born to work metal.' },
};

const AVERSIONS = {
  seasick:        { label: 'Seasick',        icon: '🤢', classes: ['fisher'], effects: [fx('output', -0.2), fx('mood', -5)],
    hint: 'looks a little green after every trip on the water…', desc: 'The rocking boat is torture.' },
  claustrophobic: { label: 'Claustrophobic', icon: '😰', classes: ['miner'], effects: [fx('output', -0.15), fx('mood', -8)],
    hint: 'goes pale at the mouth of the mine…', desc: 'Hates tight, dark places.' },
  hay_fever:      { label: 'Hay Fever',      icon: '🤧', classes: ['farmer', 'forager'], effects: [fx('output', -0.15)],
    hint: 'sneezes all the way through every harvest…', desc: 'Pollen is their sworn enemy.' },
  homebody:       { label: 'Homebody',       icon: '🏠', classes: ['porter', 'scout', 'merchant'], effects: [fx('travel', -0.15), fx('mood', -5)],
    hint: 'keeps glancing back toward home on the road…', desc: 'Miserable away from home.' },
  faint_of_heart: { label: 'Faint of Heart', icon: '😨', classes: ['soldier', 'archer'], effects: [fx('skill', -1, 'combat'), fx('injury', 8)],
    hint: 'flinches at every clash of steel in practice…', desc: 'Not cut out for fighting.' },
  butterfingers:  { label: 'Butterfingers',  icon: '🫳', classes: ['crafter', 'blacksmith', 'jeweller', 'carpenter'], effects: [fx('output', -0.15), fx('quality', -10)],
    hint: 'drops their tools more than seems normal…', desc: 'Things slip through their fingers.' },
};

// The original hidden traits (citizens.js HIDDEN_TRAITS), now with reveals.
const LEGACY = {
  latent_strength: { label: 'Latent Strength', icon: '💪', reveal: { rule: 'physical_hours', hours: 72 }, bakeStats: { strength: 3 },
    hint: 'is getting noticeably stronger with hard work…', desc: 'Hard work woke a hidden strength (+3 strength).' },
  natural_leader:  { label: 'Natural Leader', icon: '⭐', reveal: { rule: 'level', level: 10 },
    desc: 'Others follow without knowing why: everyone in their class here learns 10% faster.' },
  sickly:          { label: 'Sickly', icon: '🤒', reveal: { rule: 'event', event: 'injury' }, desc: 'Prone to illness and injury.' },
  fertile:         { label: 'Fertile', icon: '🍼', reveal: { rule: 'event', event: 'child' }, desc: 'Exceptionally likely to have children.' },
  long_lived:      { label: 'Long-lived', icon: '⏳', reveal: { rule: 'never' }, desc: 'Time treats them gently.' },
};

const APTITUDE_REVEAL_HOURS = 48;
const AVERSION_REVEAL_HOURS = 12;
const HINT_SHARE = 0.5;

// Long service in one class (real hours worked; ×1/28 for Kindlewood years).
const SERVICE = {
  veteran:  { hours: 720,  effects: [fx('output', 0.05), fx('mentor', 0.1)] },
  quirk:    { hours: 1440 },
  old_hand: { hours: 2160, effects: [fx('mentor', 0.2)] },
};
const LOYAL_SERVICE_MULT = 0.8;   // loyal citizens reach milestones 20% sooner

// Occupational quirks: one rolled at 1,440h. Effects apply always.
const QUIRKS = {
  farmer:     { good: [['sun_weathered', 'Sun-Weathered', '🌞', [fx('stat', 1, 'endurance')]]],
                bad:  [['bad_back', 'Bad Back', '🦴', [fx('stat', -1, 'strength')]]] },
  forager:    { good: [['forest_sense', 'Forest Sense', '🌲', [fx('find', 0.2, 'blightbane_herb')]]],
                bad:  [['bramble_scars', 'Bramble Scars', '🩹', [fx('stat', -1, 'charisma')]]] },
  woodcutter: { good: [['oak_grip', 'Oak Grip', '✊', [fx('stat', 1, 'strength')]]],
                bad:  [['splinters', 'Splinter-Riddled', '🪵', [fx('stat', -1, 'agility')]]] },
  miner:      { good: [['barrel_chested', 'Barrel-Chested', '🫁', [fx('stat', 1, 'endurance')]], ['dark_sight', 'Dark-Sight', '🔦', [fx('find', 0.15, 'iron_ore')]]],
                bad:  [['miners_lung', 'Miner\'s Lung', '😷', [fx('stat', -1, 'endurance'), fx('mood', -3)]], ['stooped', 'Stooped', '🧎', [fx('stat', -1, 'agility')]]] },
  fisher:     { good: [['weatherproof', 'Weatherproof', '🧥', [fx('season', 0.5, 'winter')]], ['salt_hardy', 'Salt-Hardy', '🧂', [fx('stat', 1, 'endurance')]]],
                bad:  [['rheumatic', 'Rheumatic', '🦵', [fx('stat', -1, 'agility')]]] },
  scout:      { good: [['hawk_eyed', 'Hawk-Eyed', '🦅', [fx('reveal', 1)]]],
                bad:  [['restless', 'Restless', '🌀', [fx('mood', -3)]]] },
  soldier:    { good: [['battle_hardened', 'Battle-Hardened', '⚔️', [fx('injury', -5)]]],
                bad:  [['old_wounds', 'Old Wounds', '🩹', [fx('stat', -1, 'agility')]]] },
  archer:     { good: [['steady_breath', 'Steady Breath', '🌬️', [fx('skill', 1, 'combat')]]],
                bad:  [['bowstring_scar', 'Bowstring Scar', '〰️', [fx('stat', -1, 'charisma')]]] },
  merchant:   { good: [['shrewd', 'Shrewd', '🧐', [fx('fee', -0.05)]]],
                bad:  [['penny_pincher', 'Penny-Pincher', '🪙', [fx('mood', -2)]]] },
  shopkeeper: { good: [['silver_smile', 'Silver Smile', '😁', [fx('stat', 1, 'charisma')]]],
                bad:  [['hoarder', 'Hoarder', '📦', [fx('mood', -2)]]] },
  porter:     { good: [['iron_calves', 'Iron Calves', '🦵', [fx('travel', 0.05)]]],
                bad:  [['worn_knees', 'Worn Knees', '🦿', [fx('travel', -0.05)]]] },
  tavernkeep: { good: [['storyteller', 'Storyteller', '📖', [fx('stat', 1, 'charisma')]]],
                bad:  [['tipsy', 'Tipsy', '🍻', [fx('stat', -1, 'intelligence')]]] },
  blacksmith: { good: [['iron_grip', 'Iron Grip', '✊', [fx('stat', 1, 'strength')]], ['ember_eyed', 'Ember-Eyed', '🔥', [fx('quality', 3)]]],
                bad:  [['burn_scarred', 'Burn-Scarred', '🩹', [fx('stat', -1, 'charisma')]], ['hard_of_hearing', 'Hard of Hearing', '🔇', [fx('mood', -2)]]] },
  jeweller:   { good: [['eagle_loupe', 'Loupe-Eyed', '🔍', [fx('quality', 3)]]],
                bad:  [['squint_lines', 'Squint Lines', '🧐', [fx('stat', -1, 'charisma')]]] },
  carpenter:  { good: [['sure_cut', 'Sure Cut', '🪚', [fx('quality', 3)]]],
                bad:  [['sawdust_lungs', 'Sawdust Lungs', '😷', [fx('stat', -1, 'endurance')]]] },
  crafter:    { good: [['deft_fingers', 'Deft Fingers', '🤏', [fx('stat', 1, 'agility')]]],
                bad:  [['squinting', 'Squinting', '🧐', [fx('stat', -1, 'intelligence')]]] },
};
const QUIRK_GOOD_ODDS = 0.65, QUIRK_GOOD_ODDS_AVERSE = 0.4;

// Deeds: counters on citizens.career_counters.
const DEEDS = {
  well_travelled:   { label: 'Well-Travelled',   icon: '🗺️', counter: 'porter_runs', at: 50, effects: [fx('travel', 0.05)], desc: '50 porter runs: +5% travel speed in any job.' },
  survivor:         { label: 'Survivor',         icon: '❤️‍🩹', counter: 'injuries', at: 3, effects: [fx('injury', -5)], desc: 'Survived three injuries: harder to hurt.' },
  seasoned_fighter: { label: 'Seasoned Fighter', icon: '⚔️', counter: 'battles_won', at: 25, effects: [fx('skill', 1, 'combat')], desc: '25 battles won: +1 combat.' },
  village_friend:   { label: 'Village Friend',   icon: '🏘️', counter: 'npc_trades', at: 25, effects: [fx('npc_trust', 1)], desc: '25 village trades: +1 trust per trade.' },
  perfectionist:    { label: 'Perfectionist',    icon: '💎', counter: 'masterworks', at: 10, effects: [fx('quality', 4)], desc: '10 Superior-or-better crafts: finer work.' },
  famous_shop:      { label: 'Famous Shop',      icon: '🏪', counter: 'shop_sales', at: 100, effects: [fx('fee', -0.05)], desc: '100 shop sales: lower fees.' },
};

// Everything the client may show for a trait id (labels, icons, effects).
function traitInfo(id) {
  if (APTITUDES[id]) return { id, kind: 'aptitude', ...APTITUDES[id] };
  if (AVERSIONS[id]) return { id, kind: 'aversion', ...AVERSIONS[id] };
  if (LEGACY[id]) return { id, kind: 'legacy', ...LEGACY[id] };
  if (DEEDS[id]) return { id, kind: 'deed', ...DEEDS[id] };
  for (const [cls, q] of Object.entries(QUIRKS)) {
    for (const side of ['good', 'bad']) {
      const hit = q[side].find(([qid]) => qid === id);
      if (hit) return { id, kind: 'quirk', good: side === 'good', class: cls, label: hit[1], icon: hit[2], effects: hit[3] };
    }
  }
  return null;
}

// New citizen: 35% an aptitude, 20% an aversion (never for the same class).
// Only traits whose classes exist are rolled. `rand` for tests.
function rollCareerTraits(existingClasses, rand = Math.random, inherited = []) {
  const live = obj => Object.keys(obj).filter(k => obj[k].classes.some(c => existingClasses.includes(c)));
  const out = [];
  const apt = inherited.find(t => APTITUDES[t]) || (rand() < 0.35 ? pick(live(APTITUDES), rand) : null);
  if (apt) out.push(apt);
  if (rand() < 0.2) {
    const clash = new Set(apt ? APTITUDES[apt].classes : []);
    const pool = live(AVERSIONS).filter(a => !AVERSIONS[a].classes.some(c => clash.has(c)));
    const av = pick(pool, rand);
    if (av) out.push(av);
  }
  return out;
}
function pick(arr, rand) { return arr.length ? arr[Math.floor(rand() * arr.length)] : null; }

module.exports = {
  APTITUDES, AVERSIONS, LEGACY, SERVICE, QUIRKS, DEEDS,
  APTITUDE_REVEAL_HOURS, AVERSION_REVEAL_HOURS, HINT_SHARE, LOYAL_SERVICE_MULT,
  QUIRK_GOOD_ODDS, QUIRK_GOOD_ODDS_AVERSE,
  traitInfo, rollCareerTraits,
};
