// ══════════════════════════════════════════════════════════════════════════
//  combat_gear_test — what a citizen carries counts in battle.
//
//  Part 1 (pure): weapon dice and worn armour in combat_engine and the card
//  system's dealDamage; the frozen `party` mods survive combat_resolver.
//  Part 2 (database): careers combatDeltas freezes the equipped weapon and
//  armour, and a quest battle's citizens fight with them.
//   node scripts/combat_gear_test.js
//   DATABASE_URL=postgres://… node scripts/combat_gear_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const E = require('../lib/combat_engine');
const R = require('../lib/combat_resolver');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const cit = (over) => Object.assign({ id: 1, name: 'Bram', role: 'guard', stats: { strength: 10, agility: 8, endurance: 10, intelligence: 8 }, skills: { combat: 4 } }, over || {});
function hit(actor, target, seed) {
  E.setRng(E.makeSeededRng(seed));
  target.hp = target.maxHp; target.flags.defending = false;
  return E.getAction('attack').perform({}, actor, target)[0];
}

function part1() {
  console.log('Weapons');
  E.setRng(E.makeSeededRng(3));
  const rolls = Array.from({ length: 200 }, () => E.rollDice('2d4+1'));
  check(Math.min(...rolls) === 3 && Math.max(...rolls) === 9, 'dice roll in range: 2d4+1 → 3–9');
  check(E.rollDice('nonsense') === 0 && E.rollDice(null) === 0, 'no dice, no roll');
  const bare = E.unitFromCitizen(cit()), armed = E.unitFromCitizen(cit({ weapon: { dice: '1d6', bonus: 2, name: 'Iron Sword' } }));
  const foe = E.unitFromCitizen(cit({ id: 2, name: 'Dummy', stats: { strength: 8, agility: 8, endurance: 40, intelligence: 8 } }));
  let more = 0, total = 0;
  for (let s = 1; s <= 50; s++) { const a = hit(bare, foe, s).amount, b = hit(armed, foe, s).amount; if (b > a) more++; total += b - a; }
  check(more === 50, `a 1d6+2 weapon hits harder every time (+${(total / 50).toFixed(1)} on average)`);
  check(/with Iron Sword/.test(hit(armed, foe, 9).log), 'the log names the weapon');
  check(hit(bare, foe, 4).amount === hit(bare, foe, 4).amount && hit(armed, foe, 4).amount === hit(armed, foe, 4).amount, 'same seed, same damage (replays stay true)');

  console.log('Armour');
  const plate = E.unitFromCitizen(cit({ id: 3, name: 'Plated', armour: 7 }));
  const cloth = E.unitFromCitizen(cit({ id: 4, name: 'Cloth' }));
  const a1 = hit(bare, cloth, 11), a2 = hit(bare, plate, 11);
  check(E.armourReduction({ armour: 7 }) === 3 && a1.amount - a2.amount === 3 && a2.armoured === 3 && /armour turns 3/.test(a2.log), 'armour class 7 turns 3 damage off a hit');
  const weak = Object.assign(E.unitFromCitizen(cit({ id: 5, stats: { strength: 1, agility: 8, endurance: 8 }, skills: { combat: 1 } })), {});
  const tank = E.unitFromCitizen(cit({ id: 6, armour: 40 }));
  check(hit(weak, tank, 2).amount === 1, 'never below 1 damage');
  const C = require('../lib/card_combat');
  const cardOn = t => { t.hp = t.maxHp; t.block = 0; return C.dealDamage({}, bare, t, 10, 'strike')[0]; };
  const c1 = cardOn(cloth), c2 = cardOn(plate);
  check(c1.amount === 10 && c2.amount === 7 && c2.armoured === 3 && /armour turns 3/.test(c2.log), 'card hits are turned by armour the same way');

  console.log('Frozen with the battle');
  const party = { 7: { strength: 2, combat: 1, weapon: { dice: '1d8', bonus: 0, name: 'Steel Sword' }, armour: 4 } };
  const mods = R.withParty({ enemy_health: 3 }, party);
  check(mods.party_v === 2 && JSON.stringify(R.combatModsOf(mods).party) === JSON.stringify(party), 'perks and gear survive to the battle (they used to be dropped)');
  check(R.combatModsOf({ party }) === null, 'battles stored before keep replaying exactly as they were fought');
  const fs = require('fs'), path = require('path');
  const fe = path.join(__dirname, '..', '..', 'kindlewood-frontend', 'js');
  if (fs.existsSync(fe)) {
    check(fs.readFileSync(path.join(fe, 'combat-engine.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'lib', 'combat_engine.js'), 'utf8')
      && fs.readFileSync(path.join(fe, 'card-combat.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'lib', 'card_combat.js'), 'utf8'),
      'frontend combat-engine.js and card-combat.js are byte-identical');
  }
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
      VALUES ($1,'Bram','guard',$2,'{"combat":3}','{"happiness":60,"hunger":20}','adult','[]','[]',NOW()) RETURNING id`,
    [s.id, JSON.stringify({ strength: 9, agility: 8, endurance: 9, intelligence: 8, charisma: 8 })])).rows[0];
  const give = (name, slot, meta, bonuses) => q(`INSERT INTO inventory_items (settlement_id, item_key, name, category, rarity, quantity, equip_slot, stat_bonuses, equipped_to, metadata)
      VALUES ($1,$2,$3,'equipment','common',1,$4,$5,$6,$7)`, [s.id, 'gear_' + slot + RUN, name, slot, JSON.stringify(bonuses), c.id, JSON.stringify(meta)]);
  await give('Iron Sword', 'weapon', { damage_dice: '1d6' }, { combat: 2 });
  await give('Chainmail', 'armour', { armor_class: 4 }, { combat: 2 });
  const d = (await careers.combatDeltas(s.id, [c.id]))[c.id] || {};
  check(d.weapon && d.weapon.dice === '1d6' && d.weapon.name === 'Iron Sword' && d.armour === 4, 'combatDeltas freezes the sword\'s dice and the mail\'s armour');
  check(d.combat >= 4, `…alongside the gear's combat bonus (+${d.combat})`);
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
