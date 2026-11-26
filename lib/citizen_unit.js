// ══════════════════════════════════════════════════════════════════════════
//  citizen_unit — a citizen as a fighter: the numbers a battle starts from.
//
//  A citizen has stats { strength, agility, endurance, intelligence,
//  charisma } and skills { combat }. A battle on the board
//  (lib/tactics_setup.js) reads an ability's damage, block and healing from
//  those, and takes full health and armour from here. These are the same
//  formulas the card battles used (this was part of lib/combat_engine.js
//  until the card battler was removed, 2026-11-26), so nobody's health or
//  strength changed when the fights moved to the board.
//
//  Pure: the same citizen always gives the same unit.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const HP_BASE = 30;
const HP_PER_ENDURANCE = 3;
const HP_PER_COMBAT = 2;

function statsFromCitizen(c) {
  const stats = c.stats || {}, skills = c.skills || {};
  const traits = [].concat(c.visible_traits || [], c.hidden_traits || [], c.traits || []);
  let str = stats.strength ?? 8;
  let agi = stats.agility ?? 8;
  let end = stats.endurance ?? 8;
  const intl = stats.intelligence ?? 8;
  const cmb = skills.combat ?? 1;
  // Small nudges, so a trait matters in a fight without being a system of its own.
  if (traits.includes('strong')) str += 2;
  if (traits.includes('frail')) end -= 1;
  if (traits.includes('quick')) agi += 2;
  if (traits.includes('hardy')) end += 2;
  const maxHp = Math.max(15, HP_BASE + end * HP_PER_ENDURANCE + cmb * HP_PER_COMBAT);
  return { maxHp, hp: maxHp, strength: str, agility: agi, endurance: end, intelligence: intl, combatSkill: cmb };
}

// c: { id, name, role, stats, skills, traits…, armour?, weapon? } (lib/combat_resolver.js partyUnits fills in
// worn armour and a weapon from the party's frozen modifiers).
function unitFromCitizen(c) {
  return {
    id: 'p_' + c.id, side: 'player', name: c.name, role: c.role || 'idle', citizen_id: c.id,
    ...statsFromCitizen(c),
    armour: Number(c.armour) || 0,
    weapon: c.weapon || null,
    gear: c.gear || null,       // { weapon, shield, armour }: what they hold and wear (lib/gear_kinds.js)
  };
}

module.exports = { statsFromCitizen, unitFromCitizen, HP_BASE, HP_PER_ENDURANCE, HP_PER_COMBAT };
