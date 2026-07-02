// ══════════════════════════════════════════════════════════════════════════
//  INJURY TABLE — the data layer for what happens when defeat (or pyrrhic
//  victory) befalls a citizen. Designed to be retuned without touching the
//  resolver logic.
//
//  How it's used:
//    1. applyBattleAftermath() in combat_resolver computes a base d100 roll
//       per affected citizen.
//    2. It adds modifiers (traits, age, prior injuries) from this file's
//       ROLL_MODIFIERS map.
//    3. The final roll falls into one of BANDS, each of which specifies a
//       severity and a body-part picker.
//    4. The chosen outcome produces both a citizen_event (permanent memory)
//       and possibly a citizen_condition (active effect).
//
//  All numbers here are first-pass and meant to be tuned in playtesting.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

// ── Roll bands ────────────────────────────────────────────────────────────
// Each band has [min, max] inclusive. The roll lands in exactly one band.
// `severity` drives narrative text and which condition (if any) is created.
//
//   scratch    — narrative + short temporary debuff
//   wound      — narrative + larger temporary debuff (~weeks)
//   scar       — PERMANENT narrative, NO stat debuff. The "story scars."
//   crippling  — PERMANENT narrative + permanent debuff
//   fatal      — citizen dies (life_stage becomes 'deceased')
//
// The "none" severity is reserved for the lowest band — narrative-only,
// no event, no condition. It says "they got off lucky this time."
const BANDS = [
  { min: 1,   max: 34,  severity: 'none' },        // 34% — narrow escape
  { min: 35,  max: 64,  severity: 'scratch' },     // 30% — minor temporary
  { min: 65,  max: 82,  severity: 'wound' },       // 18% — major temporary
  { min: 83,  max: 93,  severity: 'scar' },        // 11% — permanent narrative
  { min: 94,  max: 98,  severity: 'crippling' },   //  5% — permanent debuff
  { min: 99,  max: 100, severity: 'fatal' },       //  2% — death
];

// ── Roll modifiers ────────────────────────────────────────────────────────
// Each entry is added to the base d100 roll. Higher = worse outcome.
// Traits not listed here have no effect on the roll.
//
// Modifier sizes are deliberately conservative. A +25 modifier sounds small
// but interacts with the d100 clamp: any base roll above 75 gets pushed to
// 100 (fatal), so big modifiers concentrate outcomes in the worst bands.
// We tuned these in isolation to produce playtest-friendly distributions:
// frail +12 means ~5% death on defeat (vs 2% baseline), not 25%.
const ROLL_MODIFIERS = {
  traits: {
    frail:      +12,
    sickly:     +8,
    hardy:      -10,
    tough:      -7,
    lucky:      -5,
    cursed:     +6,
    veteran:    -6,
    coward:     +4,
  },
  life_stage: {
    child:  +20,
    adult:  0,
    elder:  +10,
    deceased: 0,
  },
  // Prior-injury escalation. Smaller per-injury contribution; the cap
  // remains so a heavily-scarred citizen plateaus rather than spiraling.
  per_prior_permanent_injury: +3,
  max_prior_injury_modifier: +12,
};

// ── Body parts ────────────────────────────────────────────────────────────
// Weighted picker. Drawn each time a non-fatal injury is rolled. The weights
// roughly reflect what's plausibly hit in melee combat (limbs > head etc.).
const BODY_PARTS = [
  { key: 'arm',   weight: 22 },
  { key: 'leg',   weight: 22 },
  { key: 'hand',  weight: 14 },
  { key: 'torso', weight: 18 },
  { key: 'head',  weight: 10 },
  { key: 'eye',   weight: 4  },
  { key: 'ear',   weight: 4  },
  { key: 'face',  weight: 6  },
];

// ── Stat effect templates per severity ───────────────────────────────────
// Each severity has a list of *possible* stat-modifier shapes. We pick one
// at injury time, biased by body part so a head wound affects intelligence
// rather than strength etc.
//
// Modifier values are NEGATIVE (debuffs). The resolver applies a global
// cap on total accumulated debuffs so a citizen never drops below half
// their base — see APPLY_CAP_FLOOR_PCT in combat_resolver.
//
// Healing time (heal_days) is how long the condition stays active before
// auto-expiring. null = permanent. Approximate units are real-world hours
// at the moment; we'll likely scale these alongside the in-game day length.
const SEVERITY_EFFECTS = {
  scratch: {
    heal_days: 1,        // ~1 day
    modifiers_by_part: {
      arm:   { strength: -1 },
      leg:   { agility: -1 },
      hand:  { strength: -1 },
      torso: { endurance: -1 },
      head:  { intelligence: -1 },
      eye:   { agility: -1 },
      ear:   { intelligence: -1 },
      face:  { charisma: -1 },
    },
  },
  wound: {
    heal_days: 5,        // ~5 days
    modifiers_by_part: {
      arm:   { strength: -3, combat: -1 },
      leg:   { agility: -3, combat: -1 },
      hand:  { strength: -2, agility: -1 },
      torso: { endurance: -3 },
      head:  { intelligence: -3, combat: -1 },
      eye:   { agility: -2, combat: -1 },
      ear:   { intelligence: -2 },
      face:  { charisma: -3 },
    },
  },
  scar: {
    heal_days: null,     // permanent narrative — NO stat impact
    modifiers_by_part: {
      // Empty modifiers — the scar is purely narrative. We still record
      // body_part for narrative templating.
      arm: {}, leg: {}, hand: {}, torso: {}, head: {}, eye: {}, ear: {}, face: {},
    },
  },
  crippling: {
    heal_days: null,     // permanent debuff
    modifiers_by_part: {
      arm:   { strength: -4, combat: -2 },
      leg:   { agility: -5 },                    // permanent limp
      hand:  { strength: -3, agility: -2 },
      torso: { endurance: -4 },
      head:  { intelligence: -4, combat: -2 },
      eye:   { agility: -4, combat: -2 },        // half-blind
      ear:   { intelligence: -2 },
      face:  { charisma: -5 },                    // disfigurement
    },
  },
};

// ── Narrative templates ──────────────────────────────────────────────────
// Used to produce the human-readable string stored on each event/condition.
// {name}, {part}, {enemy} are filled by the resolver. Multiple templates
// per severity so we don't see the same sentence twice in a row.
const NARRATIVES = {
  scratch: [
    "{name} took a glancing blow to the {part} from {enemy}.",
    "{name}'s {part} was bruised in the scuffle with {enemy}.",
    "A passing strike from {enemy} grazed {name}'s {part}.",
  ],
  wound: [
    "{name} suffered a deep wound to the {part} fighting {enemy}.",
    "{enemy} caught {name} hard across the {part} — it'll take weeks to mend.",
    "{name}'s {part} was badly hurt in the fight with {enemy}.",
  ],
  scar: [
    "{name} carries a scar across the {part} from the day they fought {enemy}.",
    "A jagged mark from {enemy}'s teeth crosses {name}'s {part} now.",
    "{name} bears a long scar on the {part} — a memory of {enemy}.",
  ],
  crippling: [
    "{name} was crippled in the {part} fighting {enemy}. They will never be the same.",
    "{enemy} cost {name} the full use of their {part}.",
    "{name}'s {part} was permanently broken in the encounter with {enemy}.",
  ],
  fatal: [
    "{name} fell to {enemy}, never to rise again.",
    "{name} was lost in the fight with {enemy}.",
    "{enemy} struck {name} down. The settlement mourned that night.",
  ],
};

// ── Famine narratives ─────────────────────────────────────────────────────
// Used by famine.js for starvation events. Same data-layer philosophy as
// NARRATIVES above: retune the words without touching the resolver/tick.
// Template selection is SEEDED (hash of citizen_id + consumption-quantum
// index), never Math.random() — the famine tick must be deterministic.
// Only {name} is interpolated; there is no {enemy} in a famine.
const FAMINE_NARRATIVES = {
  starving_onset: [
    "{name} has begun to waste away — the stores are empty.",
    "Hunger has hollowed {name}'s cheeks. There is nothing left to share.",
    "{name} goes to sleep with an empty belly, and wakes weaker for it.",
  ],
  recovered: [
    "Color returns to {name}'s face as the granary fills again.",
    "{name} eats a full meal at last, and the shaking stops.",
    "The worst has passed for {name} — food has returned to the settlement.",
  ],
  death: [
    "{name} starved when the food ran out. The settlement will not forget.",
    "{name} grew too weak to rise. The empty granary took them in the end.",
    "The famine claimed {name}. A quiet grave, and a lesson written in sorrow.",
  ],
};

module.exports = {
  BANDS,
  ROLL_MODIFIERS,
  BODY_PARTS,
  SEVERITY_EFFECTS,
  NARRATIVES,
  FAMINE_NARRATIVES,
};
