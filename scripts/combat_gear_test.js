// ══════════════════════════════════════════════════════════════════════════
//  combat_gear_test — what a citizen carries counts in battle.
//
//  Part 1 (pure): a weapon's dice and worn armour on the board
//  (lib/tactics_setup.js, lib/tactics_engine.js); the frozen `party` mods
//  survive lib/combat_resolver.js.
//  Part 2 (database): careers combatDeltas freezes the equipped weapon and
//  armour, and a battle's citizens fight with them.
//   node scripts/combat_gear_test.js
//   DATABASE_URL=postgres://… node scripts/combat_gear_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const U = require('../lib/citizen_unit');
const T = require('../lib/tactics_setup');
const E = require('../lib/tactics_engine');
const R = require('../lib/combat_resolver');

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg + (extra ? ' — ' + extra : '')); }
}

const cit = (over) => Object.assign({ id: 1, name: 'Bram', role: 'soldier', stats: { strength: 10, agility: 8, endurance: 10, intelligence: 8 }, skills: { combat: 4 } }, over || {});
// A Guard as the board builds her from a citizen (as lib/combat_resolver.js partyUnits hands them over).
const guard = (over) => { const c = cit(over); return T.partyUnit({ id: c.id, name: c.name, role: c.role, unit: U.unitFromCitizen(c) }, 'guard', null, null, 1); };
// One Strike from a Guard at a foe with this much armour, on a flat field. → the hit.
function strike(g, armour) {
  const foe = { id: 'e0', key: 'dummy', name: 'Dummy', cls: 'creature', maxHp: 500, armour, agility: 1, move: 0, jump: 0, abilities: [] };
  const flat = { w: 6, h: 6, tiles: Array.from({ length: 36 }, () => ({ h: 0, t: 'grass' })) };
  const st = E.createBattle({ seed: 5, land: 'plains', map: flat, party: [{ ...g, agility: 99 }], enemies: [foe] });
  const me = st.units[0], it = st.units[1];
  me.x = 2; me.y = 3; me.face = 'n'; it.x = 2; it.y = 2; it.face = 's';       // face to face: no flank
  const ev = E.apply(st, { t: 'use', key: 'g_strike', x: 2, y: 2 });
  return ev && ev.find(x => x.type === 'hit');
}

function part1() {
  console.log('Weapons');
  check(T.weaponEdge({ dice: '1d6', bonus: 2 }) === 6 && T.weaponEdge({ dice: '2d4+1' }) === 6 && T.weaponEdge({ dice: '1d8', bonus: 1 }) === 6 && T.weaponEdge({ dice: '1d10', bonus: 2 }) === 8,
    'a weapon with dice adds their average and its bonus to a blow: 1d6+2 → 6, 1d10+2 → 8');
  check(T.weaponEdge(null) === 0 && T.weaponEdge({ dice: 'nonsense' }) === 0 && T.weaponEdge({ name: 'Iron Sword' }) === 0, 'no dice, nothing added (most weapons count through the combat skill they give)');
  const bare = guard(), armed = guard({ weapon: { dice: '1d6', bonus: 2, name: 'Obsidian Blade' } });
  const dmg = (u, k) => u.abilities.find(a => a.key === k).dmg;
  check(dmg(armed, 'g_strike') === dmg(bare, 'g_strike') + 6 && armed.weapon && armed.weapon.name === 'Obsidian Blade' && armed.weapon.edge === 6 && bare.weapon === null,
    'her Strike is worth that much more, and the unit says what she carries', `${dmg(bare, 'g_strike')} → ${dmg(armed, 'g_strike')}`);
  check(armed.abilities.find(a => a.key === 'g_shield').block === bare.abilities.find(a => a.key === 'g_shield').block, 'a weapon adds nothing to a block');
  const h1 = strike(bare, 0), h2 = strike(armed, 0);
  check(h1 && h2 && h2.dmg - h1.dmg === 6 && strike(armed, 0).dmg === h2.dmg, 'and the blow lands that much harder, the same every time', `${h1 && h1.dmg} → ${h2 && h2.dmg}`);

  console.log('Armour');
  const plated = guard({ id: 3, name: 'Plated', armour: 7 });
  check(plated.armour === 7 && guard().armour === 0, 'worn armour comes onto the board with the citizen');
  const a0 = strike(bare, 0), a7 = strike(bare, 7);
  check(a0.dmg - a7.dmg === 3 && a7.armoured === 3, 'armour class 7 turns 3 damage off a hit', `${a0.dmg} → ${a7.dmg}`);
  const feeble = guard({ id: 5, stats: { strength: 1, agility: 8, endurance: 8 }, skills: { combat: 1 } });
  check(strike(feeble, 400).dmg === 1, 'never below 1 damage');

  console.log('Frozen with the battle');
  const party = { 7: { strength: 2, combat: 1, weapon: { dice: '1d8', bonus: 0, name: 'Steel Sword' }, armour: 4 } };
  const mods = R.withParty({ enemy_health: 3 }, party);
  check(mods.party_v === 2 && JSON.stringify(R.combatModsOf(mods).party) === JSON.stringify(party), 'perks and gear are kept with the battle\'s modifiers');
  check(R.combatModsOf({ party }) === null, 'a `party` that was not stamped is not trusted');
}

async function part2() {
  const { pool } = require('../db');
  const careers = require('../lib/careers');
  const q = (t, p) => pool.query(t, p);
  const RUN = Math.random().toString(36).slice(2, 7);
  console.log('Equipped gear');
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", ['gear_' + RUN, `gear_${RUN}@t.l`])).rows[0];
  const s = (await q("INSERT INTO settlements (user_id, name, world_version, last_tick) VALUES ($1,$2,2,NOW()) RETURNING id", [u.id, 'gear_' + RUN])).rows[0];
  const c = (await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, career_settled_at)
      VALUES ($1,'Bram','soldier',$2,'{"combat":3}','{"happiness":60,"hunger":20}','adult','[]','[]',NOW()) RETURNING id`,
    [s.id, JSON.stringify({ strength: 9, agility: 8, endurance: 9, intelligence: 8, charisma: 8 })])).rows[0];
  const before = (await T.partyFor([c.id], { mods: null }))[0];
  const give = (name, slot, meta, bonuses) => q(`INSERT INTO inventory_items (settlement_id, item_key, name, category, rarity, quantity, equip_slot, stat_bonuses, equipped_to, metadata)
      VALUES ($1,$2,$3,'equipment','common',1,$4,$5,$6,$7)`, [s.id, 'gear_' + slot + RUN, name, slot, JSON.stringify(bonuses), c.id, JSON.stringify(meta)]);
  await give('Obsidian Blade', 'weapon', { damage_dice: '1d6' }, { combat: 2 });
  await give('Chainmail', 'armour', { armor_class: 4 }, { combat: 2 });
  const d = (await careers.combatDeltas(s.id, [c.id]))[c.id] || {};
  check(d.weapon && d.weapon.dice === '1d6' && d.weapon.name === 'Obsidian Blade' && d.armour === 4, 'combatDeltas freezes the blade\'s dice and the mail\'s armour');
  check(d.combat >= 4, `…alongside the gear's combat bonus (+${d.combat})`);
  const after = (await T.partyFor([c.id], { mods: R.withParty(null, { [c.id]: d }) }))[0];
  const dmg = (unit, k) => unit.abilities.find(a => a.key === k).dmg;
  check(after.armour === 4 && before.armour === 0 && after.weapon && after.weapon.name === 'Obsidian Blade' && after.stats.combat === before.stats.combat + d.combat
    && dmg(after, 'g_strike') > dmg(before, 'g_strike') + T.weaponEdge(d.weapon) - 1,
    'on the board she wears the mail, carries the blade and fights with the skill they give: her Strike is worth more by the blade\'s edge and the skill', `${dmg(before, 'g_strike')} → ${dmg(after, 'g_strike')}`);
  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
