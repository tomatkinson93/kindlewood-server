// ══════════════════════════════════════════════════════════════════════════
//  gear_kinds — what a citizen carries, and the one clear thing each kind of
//  weapon does on the board (docs/TACTICS.md §6, stage C; the owner chose
//  "kinds of weapon matter", 2026-11-26).
//
//  Numbers were always counted: a weapon's combat bonus is in the citizen's
//  combat skill, its dice (the few that have them) add to every blow, armour
//  takes the edge off a hit. This file adds the KIND:
//
//    sword     Arms abilities are ready a turn sooner
//    hammer    Arms blows land a quarter harder; its wielder walks one less
//    halberd   melee Arms blows reach two tiles
//    dagger    a blow from behind does double (not half as much again)
//    shortbow  Archery can be loosed at a foe standing next to you
//    longbow   Archery reaches one tile further
//    staff     Wild and Hearth magic is a fifth stronger
//    a shield  (its own slot) Arms blocks are stronger by the shield's worth
//
//  They read the SCHOOL of an ability, not the class of the citizen, so they
//  hold for a second school too: a Guard who carries a staff heals better
//  with the Hearth magic of an old career, and worse with their own blows.
//
//  A unit in a battle carries `gear`: { weapon, shield, armour }, each
//  { key, name, icon } (weapon also kind and what it does; shield its worth).
//  Nothing draws it yet. It is there so the board can show what a citizen
//  holds and wears when that art exists (the owner, 2026-11-26).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const KINDS = {
  sword:    { name: 'Sword',     says: 'Arms abilities are ready a turn sooner.' },
  hammer:   { name: 'Hammer',    says: 'Arms blows land a quarter harder. Walks one tile less.' },
  halberd:  { name: 'Polearm',   says: 'Melee Arms blows reach two tiles.' },
  dagger:   { name: 'Dagger',    says: 'A blow from behind does double.' },
  shortbow: { name: 'Short bow', says: 'Archery can be loosed at a foe standing next to you.' },
  longbow:  { name: 'Longbow',   says: 'Archery reaches one tile further.' },
  staff:    { name: 'Staff',     says: 'Wild and Hearth magic is a fifth stronger.' },
};
const ICON = { sword: '🗡️', hammer: '🔨', halberd: '🔱', dagger: '🗡️', shortbow: '🏹', longbow: '🏹', staff: '🪄' };
const HAMMER = 1.25, STAFF = 1.2, DAGGER_BACK = 2;

// Which kind an item is: by its key, else by its name (so an item made in Dev Tools counts too).
const BY_KEY = {
  iron_sword: 'sword', steel_sword: 'sword', falchion: 'sword', obsidian_blade: 'sword', mithril_blade: 'sword',
  iron_dagger: 'dagger', war_hammer: 'hammer', halberd: 'halberd',
  shortbow: 'shortbow', composite_bow: 'shortbow', longbow: 'longbow', heartwood_bow: 'longbow',
  oak_staff: 'staff', rowan_staff: 'staff', heartwood_staff: 'staff',
};
function kindOf(item) {
  if (!item) return null;
  if (BY_KEY[item.key]) return BY_KEY[item.key];
  const n = String(item.name || '').toLowerCase();
  if (/staff|stave|wand/.test(n)) return 'staff';
  if (/long ?bow/.test(n)) return 'longbow';
  if (/bow/.test(n)) return 'shortbow';
  if (/dagger|knife|dirk/.test(n)) return 'dagger';
  if (/hammer|maul|mace|club/.test(n)) return 'hammer';
  if (/halberd|spear|pike|glaive|lance/.test(n)) return 'halberd';
  if (/sword|blade|falchion|sabre|saber/.test(n)) return 'sword';
  return null;
}
// What a shield adds to an Arms block.
const SHIELD = { wooden_buckler: 3, iron_shield: 5, tower_shield: 8 };
const shieldWorth = item => (item ? (SHIELD[item.key] != null ? SHIELD[item.key] : 3) : 0);

// What a citizen wears, as a unit carries it. worn: { weapon, shield, armour } of { key, name, icon }.
function describe(worn) {
  if (!worn) return null;
  const out = {};
  if (worn.weapon) { const kind = kindOf(worn.weapon); out.weapon = { key: worn.weapon.key || null, name: worn.weapon.name || 'Weapon', icon: worn.weapon.icon || ICON[kind] || '🗡️', kind, kind_name: kind ? KINDS[kind].name : null, says: kind ? KINDS[kind].says : null }; }
  if (worn.shield) out.shield = { key: worn.shield.key || null, name: worn.shield.name || 'Shield', icon: worn.shield.icon || '🛡️', block: shieldWorth(worn.shield), says: `Arms blocks are ${shieldWorth(worn.shield)} stronger.` };
  if (worn.armour) out.armour = { key: worn.armour.key || null, name: worn.armour.name || 'Armour', icon: worn.armour.icon || '🥋' };
  return Object.keys(out).length ? out : null;
}

// Change one ability for what its user carries. n: { dmg, heal, block } (changed in place); shape: { min, max,
// cooldown } (changed in place); school: the ability's; gear: as describe() gives it. → extra fields for the ability.
function apply(n, shape, school, gear) {
  const extra = {};
  if (!gear) return extra;
  const kind = gear.weapon && gear.weapon.kind, melee = shape.max === 1 && (shape.min || 0) >= 1;
  const blow = school === 'arms' || school === 'basics';
  if (kind === 'sword' && school === 'arms' && shape.cooldown >= 2) shape.cooldown -= 1;
  if (kind === 'hammer' && blow && n.dmg) n.dmg = Math.round(n.dmg * HAMMER);
  if (kind === 'halberd' && blow && melee && n.dmg) shape.max = 2;
  if (kind === 'dagger' && blow && melee && n.dmg) extra.back = DAGGER_BACK;
  if (kind === 'shortbow' && school === 'archery' && shape.min >= 2) shape.min = 1;
  if (kind === 'longbow' && school === 'archery' && shape.max >= 2) shape.max += 1;
  if (kind === 'staff' && (school === 'wild' || school === 'hearth')) for (const k of ['dmg', 'heal', 'block']) if (n[k]) n[k] = Math.round(n[k] * STAFF);
  if (gear.shield && school === 'arms' && n.block) n.block += gear.shield.block || 0;
  return extra;
}
// How far a unit walks with what it carries.
const moveWith = (move, gear) => (gear && gear.weapon && gear.weapon.kind === 'hammer' ? Math.max(1, move - 1) : move);

module.exports = { KINDS, HAMMER, STAFF, DAGGER_BACK, BY_KEY, SHIELD, kindOf, shieldWorth, describe, apply, moveWith };
