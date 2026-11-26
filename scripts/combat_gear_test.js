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

// What each kind of weapon does on the board (lib/gear_kinds.js; docs/TACTICS.md §6 stage C).
function part1b() {
  console.log('Kinds of weapon');
  const G = require('../lib/gear_kinds');
  const wear = (cls, gear, lvl = 10, second = null) => { const c = cit({ gear }); return T.partyUnit({ id: 1, name: 'x', role: 'soldier', unit: U.unitFromCitizen(c) }, cls, null, null, lvl, second); };
  const ab = (u, k) => u.abilities.find(a => a.key === k), W = (key, name) => ({ weapon: { key, name } });
  check(['iron_sword:sword', 'war_hammer:hammer', 'halberd:halberd', 'iron_dagger:dagger', 'shortbow:shortbow', 'composite_bow:shortbow', 'longbow:longbow', 'heartwood_bow:longbow', 'oak_staff:staff'].every(x => G.kindOf({ key: x.split(':')[0] }) === x.split(':')[1])
    && G.kindOf({ name: 'Test Blade' }) === 'sword' && G.kindOf({ name: 'Elder Longbow' }) === 'longbow' && G.kindOf({ name: 'Crooked Staff' }) === 'staff' && G.kindOf({ name: 'Fisher\'s Rod' }) === null && G.kindOf(null) === null,
  'every weapon has a kind, by its key or else by its name; a thing that is no weapon has none');
  const bare = wear('guard', null), sword = wear('guard', W('iron_sword', 'Iron Sword'));
  check(ab(sword, 'g_shove').cooldown === ab(bare, 'g_shove').cooldown - 1 && ab(sword, 'g_heavy').cooldown === ab(bare, 'g_heavy').cooldown - 1 && ab(sword, 'g_shield').cooldown === ab(bare, 'g_shield').cooldown && ab(sword, 'g_strike').cooldown === 0
    && ab(sword, 'g_strike').dmg === ab(bare, 'g_strike').dmg && sword.move === bare.move, 'a sword: Arms abilities are ready a turn sooner (never those that wait only one), and nothing else changes');
  const hammer = wear('guard', W('war_hammer', 'War Hammer'));
  check(ab(hammer, 'g_strike').dmg === Math.round(ab(bare, 'g_strike').dmg * 1.25) && ab(hammer, 'g_heavy').dmg === Math.round(ab(bare, 'g_heavy').dmg * 1.25) && ab(hammer, 'g_shield').block === ab(bare, 'g_shield').block
    && hammer.move === bare.move - 1 && ab(wear('archer', W('war_hammer')), 'v_swing').dmg === Math.round(ab(wear('archer', null), 'v_swing').dmg * 1.25) && ab(wear('archer', W('war_hammer')), 'a_shoot').dmg === ab(wear('archer', null), 'a_shoot').dmg,
  'a hammer: Arms blows (and the plain blow of Basics) land a quarter harder, and its wielder walks one tile less', `${ab(bare, 'g_strike').dmg} → ${ab(hammer, 'g_strike').dmg}, move ${bare.move} → ${hammer.move}`);
  const pole = wear('guard', W('halberd', 'Halberd'));
  check(ab(pole, 'g_strike').max === 2 && ab(pole, 'g_strike').min === 1 && ab(pole, 'g_shove').max === 2 && ab(pole, 'g_heavy').max === 2 && ab(pole, 'g_cover').max === ab(bare, 'g_cover').max && ab(pole, 'g_shield').max === 0 && ab(pole, 'g_strike').dmg === ab(bare, 'g_strike').dmg,
    'a polearm: melee Arms blows reach two tiles; blocks and what already reaches further are as they were');
  const knife = wear('guard', W('iron_dagger', 'Iron Dagger'));
  const from = (g, face) => {       // one Strike at a dummy facing `face`, from the tile south of it
    const foe = { id: 'e0', key: 'dummy', name: 'Dummy', cls: 'creature', maxHp: 900, armour: 0, agility: 1, move: 0, jump: 0, abilities: [] };
    const flat = { w: 6, h: 6, tiles: Array.from({ length: 36 }, () => ({ h: 0, t: 'grass' })) };
    const st = E.createBattle({ seed: 5, land: 'plains', map: flat, party: [{ ...g, agility: 99 }], enemies: [foe] });
    const me = st.units[0], it = st.units[1];
    me.x = 2; me.y = 3; me.face = 'n'; it.x = 2; it.y = 2; it.face = face;
    const ev = E.apply(st, { t: 'use', key: 'g_strike', x: 2, y: 2 });
    return ev && ev.find(x => x.type === 'hit');
  };
  const front = from(bare, 's').dmg, back = from(bare, 'n').dmg, stab = from(knife, 'n').dmg;
  check(ab(knife, 'g_strike').back === 2 && !ab(bare, 'g_strike').back && !ab(knife, 'g_shield').back && back === Math.round(front * 1.5) && stab === Math.round(front * 2) && from(knife, 's').dmg === front
    && E.forecast, 'a dagger: a blow from behind does double, where any other does half as much again; from the front it is as any blow', `front ${front}, behind ${back}, a dagger behind ${stab}`);
  const arch = wear('archer', null), long = wear('archer', W('longbow', 'Longbow')), short = wear('archer', W('shortbow', 'Shortbow'));
  check(ab(long, 'a_shoot').max === ab(arch, 'a_shoot').max + 1 && ab(long, 'a_part').max === ab(arch, 'a_part').max + 1 && ab(long, 'a_shoot').min === ab(arch, 'a_shoot').min && ab(long, 'a_side').max === 0 && ab(long, 'v_swing').max === 1
    && ab(wear('guard', W('longbow'), 13), 'g_oath').max === ab(wear('guard', null, 13), 'g_oath').max, 'a longbow: Archery reaches one tile further; nothing of another school does');
  check(ab(arch, 'a_shoot').min === 2 && ab(short, 'a_shoot').min === 1 && ab(short, 'a_shoot').max === ab(arch, 'a_shoot').max && ab(short, 'a_part').min === ab(arch, 'a_part').min, 'a short bow: a shot can be loosed at a foe standing next to you');
  const hk = wear('hearthkeeper', null), hs = wear('hearthkeeper', W('oak_staff', 'Oak Staff')), wz = wear('wizard', null), ws = wear('wizard', W('rowan_staff', 'Rowan Staff'));
  check(ab(hs, 'h_kindle').heal === Math.round(ab(hk, 'h_kindle').heal * 1.2) && ab(hs, 'h_ward').block === Math.round(ab(hk, 'h_ward').block * 1.2) && ab(hs, 'h_cinder').dmg === Math.round(ab(hk, 'h_cinder').dmg * 1.2)
    && ab(ws, 'w_spark').dmg === Math.round(ab(wz, 'w_spark').dmg * 1.2) && ab(hs, 'v_swing').dmg === ab(hk, 'v_swing').dmg && ab(wear('guard', W('oak_staff')), 'g_strike').dmg === ab(bare, 'g_strike').dmg,
  'a staff: Wild and Hearth magic is a fifth stronger; a blow is not', `Kindle ${ab(hk, 'h_kindle').heal} → ${ab(hs, 'h_kindle').heal}`);
  const second = { cls: 'hearthkeeper', level: 6, keys: null }, gPlain = wear('guard', null, 6, second), gStaff = wear('guard', W('oak_staff', 'Oak Staff'), 6, second);
  check(ab(gStaff, 'h_kindle').off && ab(gStaff, 'h_kindle').heal === Math.max(1, Math.round(Math.round(ab(hk, 'h_kindle').heal * 1.2) * 0.75)) && ab(gStaff, 'h_kindle').heal > ab(gPlain, 'h_kindle').heal,
    'gear reads the school, not the class: a Guard with a staff heals better with the Hearth magic of an old career', `${ab(gPlain, 'h_kindle').heal} → ${ab(gStaff, 'h_kindle').heal} (a Hearthkeeper with one: ${ab(hs, 'h_kindle').heal})`);
  const tower = wear('guard', { shield: { key: 'tower_shield', name: 'Tower Shield' } }), odd = wear('guard', { shield: { key: 'pot_lid', name: 'Pot Lid' } });
  check(ab(tower, 'g_shield').block === ab(bare, 'g_shield').block + 8 && ab(tower, 'g_cover').block === ab(bare, 'g_cover').block + 8 && ab(odd, 'g_shield').block === ab(bare, 'g_shield').block + 3 && ab(tower, 'g_strike').dmg === ab(bare, 'g_strike').dmg
    && ab(wear('hearthkeeper', { shield: { key: 'tower_shield' } }), 'h_ward').block === ab(hk, 'h_ward').block && G.shieldWorth({ key: 'wooden_buckler' }) === 3 && G.shieldWorth({ key: 'iron_shield' }) === 5,
  'a shield: Arms blocks are stronger by its worth (3, 5 or 8); a Hearth ward is not');
  const both = wear('guard', { weapon: { key: 'iron_sword', name: 'Iron Sword', icon: '⚔️' }, shield: { key: 'iron_shield', name: 'Iron Shield' }, armour: { key: 'chainmail', name: 'Chainmail' } });
  check(both.gear.weapon.kind === 'sword' && both.gear.weapon.key === 'iron_sword' && both.gear.weapon.icon === '⚔️' && /ready a turn sooner/.test(both.gear.weapon.says) && both.gear.shield.block === 5 && both.gear.armour.key === 'chainmail' && bare.gear === null
    && wear('guard', W('fishers_rod', 'Fisher\'s Rod')).gear.weapon.kind === null && ab(wear('guard', W('fishers_rod', 'Fisher\'s Rod')), 'g_heavy').cooldown === ab(bare, 'g_heavy').cooldown,
  'a unit carries what it holds and wears, by slot, with its key (for the day the board draws it); a thing with no kind changes nothing');
  check(Object.keys(G.KINDS).join() === 'sword,hammer,halberd,dagger,shortbow,longbow,staff' && Object.values(G.KINDS).every(k => k.name && k.says), 'seven kinds, each with one thing to say');
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
  // A staff and a shield, by their real keys: the kind comes with the citizen into the battle.
  const h = (await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, career_settled_at)
      VALUES ($1,'Wren','hearthkeeper',$2,'{"combat":3}','{"happiness":60,"hunger":20}','adult','[]','[]',NOW()) RETURNING id`,
    [s.id, JSON.stringify({ strength: 8, agility: 8, endurance: 9, intelligence: 12, charisma: 9 })])).rows[0];
  const bareH = (await T.partyFor([h.id], { mods: null }))[0];
  const giveKey = (key, name, slot, icon) => q(`INSERT INTO inventory_items (settlement_id, item_key, name, icon, category, rarity, quantity, equip_slot, stat_bonuses, equipped_to, metadata)
      VALUES ($1,$2,$3,$4,'equipment','common',1,$5,'{}',$6,'{}')`, [s.id, key, name, icon, slot, h.id]);
  await giveKey('oak_staff', 'Oak Staff', 'weapon', '🪄'); await giveKey('tower_shield', 'Tower Shield', 'shield', '🧱');
  const dh = (await careers.combatDeltas(s.id, [h.id]))[h.id] || {};
  check(dh.gear && dh.gear.weapon.key === 'oak_staff' && dh.gear.weapon.name === 'Oak Staff' && dh.gear.weapon.icon === '🪄' && dh.gear.shield.key === 'tower_shield' && dh.gear.armour === null,
    'combatDeltas says what is held and worn, by slot');
  const wornH = (await T.partyFor([h.id], { mods: R.withParty(null, { [h.id]: dh }) }))[0], heal = u => u.abilities.find(a => a.key === 'h_kindle').heal;
  check(wornH.gear.weapon.kind === 'staff' && wornH.gear.shield.block === 8 && bareH.gear === null && heal(wornH) === Math.round(heal(bareH) * 1.2), 'in a battle she carries the staff, and her Kindle is a fifth stronger for it', `${heal(bareH)} → ${heal(wornH)}`);
  const tpl = (await q(`SELECT item_key FROM item_templates WHERE item_key = ANY($1::text[])`, [['oak_staff', 'rowan_staff', 'heartwood_staff']])).rows.length;
  const rec = (await q(`SELECT recipe_key, class_key, station FROM recipes WHERE recipe_key = ANY($1::text[])`, [['oak_staff', 'rowan_staff', 'heartwood_staff']])).rows;
  check(tpl === 3 && rec.length === 3 && rec.every(x => x.class_key === 'carpenter' && x.station === 'workshop'), 'three staffs exist, and a carpenter makes them at the workshop');
  await pool.end();
}

(async () => {
  part1();
  part1b();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
