// The tactics battle prototype's server side (lib/tactics_setup.js, routes/tactics.js).
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/tactics_test.js
'use strict';
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const T = require('../lib/tactics_setup');
const CC = require('../lib/class_abilities');
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

console.log('Reading a formula into numbers');
{
  const stats = { strength: 11, agility: 8, endurance: 10, intelligence: 8, charisma: 8, combatSkill: 4 };
  check(T.calc('strength*0.7 + combat*0.8 + 5', stats) === 11 * 0.7 + 4 * 0.8 + 5 && T.calc('(2 + 3) * 4 - 6 / 2', {}) === 17, 'the calculator reads stat names, brackets and the four sums');
  const shove = T.read(CC.ability('g_shove').formula, stats);
  check(shove.dmg === 9 && shove.fx.push === 1 && shove.fx.weak === 2, 'Shove: its damage, the push and the weakness', JSON.stringify(shove));
  const part = T.read(CC.ability('a_part').formula, { agility: 11, combatSkill: 4 });
  check(part.dmg === 11 && part.block === 5 && part.fx.step === 1, 'Parting Shot: damage, block and the step back');
  check(T.read('draw: 1\nenergy: 1\nif target_has weak: damage: 9', stats).dmg === undefined, 'what a board has no use for (drawing, energy, conditions) is left out');
}
console.log('The kits');
{
  const every = Object.keys(T.KITS).every(k => T.KITS[k].abilities.every(a => CC.ability(a.key)) && CC.CLASSES[k]);
  check(Object.keys(T.KITS).join() === 'guard,archer,wizard,hearthkeeper,villager' && every, 'a kit for each class, every ability a real class card');
  check(Object.keys(CC.TRADES).every(kind => T.TRADE_KIT[CC.TRADES[kind]]), 'and a board form of every trade card');
  const guard = T.partyUnit({ id: 1, name: 'G', role: 'soldier' }, 'guard', 'trained', null), wiz = T.partyUnit({ id: 2, name: 'W', role: 'farmer' }, 'wizard', 'trained', null), vil = T.partyUnit({ id: 3, name: 'V', role: 'farmer' }, 'villager', 'villager', 't_ration');
  const ab = (u, k) => u.abilities.find(a => a.key === k);
  check(guard.abilities.length === 5 && ab(guard, 'g_strike').dmg === 16 && ab(guard, 'g_strike').max === 1 && ab(guard, 'g_heavy').cooldown === 3 && ab(guard, 'g_shield').target === 'self', 'a trained Guard: Strike for 16 at reach 1, Heavy Blow every fourth turn');
  check(ab(wiz, 'w_bolt').dmg === 16 && ab(wiz, 'w_bolt').max === 4 && ab(wiz, 'w_burst').shape === 'burst' && wiz.stats.intelligence === 11, 'any citizen can be tried as a Wizard: the level gives the class its stats');
  check(vil.abilities.length === 3 && ab(vil, 't_ration').heal === 7 && ab(vil, 't_ration').uses === 1 && vil.armour === 0, 'a villager has Swing, Duck and their trade card');
  check(guard.maxHp > vil.maxHp && guard.armour === 2, 'a level sets health and armour as the simulator\'s levels do');
  const ogre = T.creatureUnit({ id: 'hill_ogre', name: 'Hill Ogre', icon: '👹', max_hp: 60, strength: 11, agility: 3, endurance: 10, combat_skill: 3, moves: [{ key: 'club', name: 'Club', intent: 'attack', target: 'enemy', weight: 2, formula: 'damage: strength*0.9 + 2' }] }, 0, 'orange', { hp: 0.5 });
  check(ogre.maxHp === Math.round(60 * (1 + T.TIERS.orange.hp + 0.5)) && ogre.abilities[0].dmg === Math.round(Math.round(11 * (1 + T.TIERS.orange.str)) * 0.9 + 2) && ogre.move === 3, 'a creature the board knows only by its row takes the skull\'s health and strength, and a room\'s own boost');
  const rat = T.creatureUnit({ id: 'marsh_rat', name: 'Marsh Rat', max_hp: 22, strength: 5, agility: 9, endurance: 4, combat_skill: 2, moves: [] }, 0, 'green', null);
  check(rat.abilities.length === 1 && rat.abilities[0].dmg > 0 && rat.abilities[0].max === 1, 'a creature with no moves of its own bites');

  console.log('Who the party fights (lib/tactics_foes.js)');
  const F = T.FOES, all = Object.values(F.FOES), units = all.map((f, i) => T.foeUnit(f, i, 'green', null));
  check(all.length >= 28 && all.every(f => F.BANDS[f.band] && F.RANK_ORDER.includes(f.rank) && f.lands.length && f.hp > 0 && f.pow > 0 && f.name && f.icon && f.flavour && f.does.length),
    'every foe has a band, a rank, lands, health, a name, a line about it and something it does', `${all.length} foes in ${Object.keys(F.BANDS).length} bands`);
  check(units.every(u => u.abilities.every(x => x.name && x.icon && x.look && (x.dmg || x.block || x.heal || Object.keys(x.fx).length)) && u.abilities.some(x => x.dmg && !x.cooldown)),
    'everything a foe does does something and has a look, and each has an attack that is always ready');
  {
    // Every look a foe names is one the screen draws (the frontend's js/tactics.js, when it is beside this repo).
    const fs = require('fs'), path = require('path');
    const file = path.join(process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend'), 'js', 'tactics.js');
    if (fs.existsSync(file)) {
      const J = fs.readFileSync(file, 'utf8'), looks = [...new Set(units.flatMap(u => u.abilities.map(x => x.look)))];
      const known = k => new RegExp(`\\b${k}\\(c, f, p, k`).test(J) || new RegExp(`\\b${k}: '[a-z_]+'`).test(J) || new RegExp(`\\b${k}: '#`).test(J);
      check(looks.every(known), 'every look a foe names is one the battle screen draws', looks.filter(k => !known(k)).join(' ') || `${looks.length} looks`);
    }
  }
  const can = (u, f) => u.abilities.some(f);
  const shoots = u => can(u, x => x.dmg && x.max >= 3), heals = u => can(u, x => x.heal && x.target !== 'self'), casts = u => can(u, x => x.shape === 'burst' || (x.max >= 3 && Object.keys(x.fx).length));
  check(Object.keys(F.BANDS).every(b => { const us = units.filter(u => u.band === b && u.rank !== 'boss'); return us.some(shoots) && us.some(u => heals(u) || casts(u)); }),
    'every band has someone who strikes from far off and someone who heals or casts');
  check(units.filter(heals).length >= 3 && units.filter(casts).length >= 6 && units.filter(shoots).length >= 10, 'across the bands: healers, casters and plenty who shoot',
    `${units.filter(heals).length} heal, ${units.filter(casts).length} cast, ${units.filter(shoots).length} shoot`);
  const LANDS = require('../lib/dungeon_gen').LANDS;
  check(LANDS.every(l => F.RANK_ORDER.every(r => all.some(f => f.rank === r && f.lands.includes(l))) && all.filter(f => f.rank === 'boss' && f.lands.includes(l)).length === 1),
    'every land has a minion, a regular, a heavy, an elite and one boss');
  check(['marsh_rat', 'river_pike', 'wild_fox', 'rot_shaman', 'mountain_harpy', 'bog_lurker', 'night_wolf', 'withered_husk', 'fungal_toad', 'thornback_boar', 'hill_ogre'].every(k => F.foe(k)) && F.foe('night_wolf').key === 'wolf_raider' && F.foe('nobody') === null,
    'each creature of the card battles has a foe that stands in its place on the board');
  const cast = F.castFor('forest', 1), again = F.castFor('forest', 1);
  check(cast.band && JSON.stringify(cast) === JSON.stringify(again) && F.RANK_ORDER.every(r => cast.creatures.some(c => c.rank === r))
    && cast.creatures.filter(c => c.rank === 'regular').every(c => F.FOES[c.id].band === cast.band) && LANDS.every(l => [1, 2, 3].every(n => F.castFor(l, n).band)),
    'a dungeon belongs to a band: its ordinary foes are the band\'s, with every rank filled, the same for the same seed', cast.band);
  const cap = T.foeUnit(F.FOES.stoat_captain, 0, 'orange', { hp: 0.5 });
  check(cap.maxHp === Math.round(F.FOES.stoat_captain.hp * (1 + T.TIERS.orange.hp + 0.5)) && cap.armour === 2 && cap.abilities.find(x => x.key === 'rally').fx.bold === 3
    && cap.abilities.find(x => x.key === 'rally').target === 'ally_or_self' && cap.abilities.find(x => x.key === 'rally').shape === 'around'
    && cap.abilities.find(x => x.key === 'twin').dmg === Math.round(Math.round(F.FOES.stoat_captain.pow * (1 + T.TIERS.orange.str)) * 0.9 + 3),
    'a foe takes the skull\'s health and strength and a room\'s boost; a rally reaches its friends around it');
  check(Object.keys(F.SHOWCASE).length === Object.keys(F.BANDS).length && Object.values(F.SHOWCASE).every(sc => ['first', 'hard', 'boss'].every(k => sc[k].length >= 3 && sc[k].every(x => F.FOES[x])) && F.FOES[sc.boss[sc.boss.length - 1]].rank === 'boss'),
    'each band has a showcase fight of each kind, the boss at the back');
  console.log('The class ladder: abilities learned by class level');
  {
    const c = { id: 1, name: 'x', role: 'soldier', unit: null }, keys = u => u.abilities.map(a => a.key).join();
    const at = (cls, lvl) => T.partyUnit(c, cls, null, null, lvl);
    const stub = { maxHp: 40, armour: 0, agility: 8, strength: 8, endurance: 8, intelligence: 8, charisma: 8, combatSkill: 1 };
    c.unit = stub;
    check(['guard', 'archer', 'wizard', 'hearthkeeper'].every(k => T.KITS[k].abilities.map(a => a.at).sort((a, b) => a - b).join() === '1,1,2,4,6,8,10,13,16,20') && T.KITS.villager.abilities.every(a => !a.at || a.at === 1),
      'each class begins with two abilities, learns one more at levels 2, 4 and 6, and five more at 8, 10, 13, 16 and 20; a villager\'s are known from the start');
    check(keys(at('guard', 1)) === 'g_strike,g_shield' && keys(at('guard', 2)) === 'g_strike,g_shield,g_cover' && keys(at('guard', 5)) === 'g_strike,g_shield,g_cover,g_shove' && at('guard', 6).abilities.length === 5 && at('guard', 20).abilities.length === 5,
      'a Guard at level 1 has Strike and Shield Up; Cover at 2, Shove at 4, Heavy Blow at 6');
    const w1 = at('wizard', 1);
    check(w1.class_level === 1 && w1.locked.map(x => `${x.key}@${x.at}`).join() === 'w_bolt@2,w_chill@4,w_burst@6' && w1.locked.every(x => x.name && x.icon) && at('wizard', 6).locked.length === 0,
      'a unit says its class level and what it has yet to learn, in the order it will learn it');
    check(wiz.abilities.length === 5 && wiz.class_level === 6 && T.partyUnit(c, 'archer', 'novice', null, 1).abilities.length === 3 && T.partyUnit(c, 'archer', 'villager', null, 9).abilities.length === 2,
      'a playtest level brings its own class level: novice 3, trained 6, veteran 10');
    check(JSON.stringify(T.learnedBetween('hearthkeeper', 1, 4).map(x => x.key)) === '["h_ward","h_bold"]' && T.learnedBetween('guard', 6, 7).length === 0 && T.learnedBetween('villager', 1, 20).length === 0 && T.learnedBetween('nobody', 1, 9).length === 0,
      'the levels gained say what was learned: a Hearthkeeper from 1 to 4 learns Hearth Ward and Embolden');
    // Knowing and readying: ten to learn, five to bring.
    {
      const keys = u => u.abilities.map(a => a.key).join();
      const vet = T.partyUnit(c, 'guard', null, null, 10), first = 'g_strike,g_shield,g_cover,g_shove,g_heavy';
      check(T.READY === 5 && keys(vet) === first && vet.spare === 2 && vet.locked.length === 0 && vet.next.key === 'g_oath' && vet.next.at === 13,
        'a citizen who knows more than five brings the first five they learned unless they choose otherwise; the rest wait at home, and the next to learn is named');
      const mine = T.partyUnit(c, 'guard', null, null, 10, ['g_shield_bash', 'g_stand_fast', 'g_strike', 'g_heavy', 'g_cover']);
      check(keys(mine) === 'g_strike,g_cover,g_heavy,g_stand_fast,g_shield_bash' && mine.spare === 2, 'what they have readied is what they bring, in the ladder\'s order');
      const stale = T.partyUnit(c, 'guard', null, null, 10, ['g_hammer', 'nonsense', 'g_stand_fast']);
      check(keys(stale) === 'g_strike,g_shield,g_cover,g_shove,g_stand_fast' && !keys(stale).includes('g_hammer'), 'a choice that names something not known, or too few, is filled out from the earliest learned: never fewer than five, never one not known');
      const young = T.partyUnit(c, 'wizard', null, null, 4, ['w_fireball']);
      check(keys(young) === 'w_spark,w_ward,w_bolt,w_chill' && young.locked.map(x => x.key).join() === 'w_burst' && young.next.key === 'w_burst' && young.spare === 0, 'with five or fewer known there is nothing to choose; the row shows the next one to learn');
      check(keys(T.partyUnit(c, 'guard', 'veteran', null, 1, ['g_hammer'])) === first, 'a playtest level always brings the first five: the kit the skulls were tuned with');
      const got = T.learnedBetween('archer', 5, 8);
      check(got.map(x => `${x.key}:${x.spare}`).join() === 'a_pierce:false,a_aimed:true', 'a newly learned ability says whether it waits at home: the fifth is brought, the sixth is spare');
      const top = T.partyUnit(c, 'hearthkeeper', null, null, 20);
      check(top.next === null && top.spare === 5 && ['guard', 'archer', 'wizard', 'hearthkeeper'].every(k => T.KITS[k].abilities.every(a => { const ab = T.abilityOf(a, stub); return ab.name && (ab.dmg || ab.block || ab.heal || Object.keys(ab.fx).length); })),
        'at level 20 a class knows all ten, and every one of them does something on the board');
      // The ten learned from level 8 up, in real battles: each party brings only those, the rules' own mind plays both sides.
      {
        const CE = require('../lib/citizen_unit'), E2 = require('../lib/tactics_engine');
        const NEW = Object.fromEntries(['guard', 'archer', 'wizard', 'hearthkeeper'].map(k => [k, T.KITS[k].abilities.filter(a => a.at >= 8).map(a => a.key)]));
        const used = {}; let refused = 0, ended = 0;
        const N = 12;
        for (let seed = 1; seed <= N; seed++) {
          const party = Object.keys(NEW).map((cls, i) => T.partyUnit({ id: i + 1, name: cls, role: 'idle', unit: CE.unitFromCitizen({ id: i + 1, name: cls, role: 'idle', stats: { strength: 22, agility: 20, endurance: 22, intelligence: 22, charisma: 14 }, skills: { combat: 9 }, armour: 2 }) }, cls, null, null, 20, NEW[cls]));
          const band = Object.keys(F.BANDS)[seed % 5], foes = F.SHOWCASE[band][seed % 3 === 0 ? 'boss' : 'hard'].map((k, i) => T.foeUnit(F.FOES[k], i, 'red', null));
          const st = E2.replay({ seed, land: 'forest', party, enemies: foes }, []).state;      // replay: foes quicker than the party take their turns first
          for (let g = 0; g < 600 && st.status === 'active'; g++) {
            const u = E2.current(st), keep = st.r, plan = E2.plan(st); st.r = keep;
            const acts = [];
            if (plan && plan.to && (plan.to.x !== u.x || plan.to.y !== u.y)) acts.push({ t: 'move', x: plan.to.x, y: plan.to.y });
            if (plan && plan.ability) acts.push({ t: 'use', key: plan.ability, x: plan.x, y: plan.y });
            acts.push({ t: 'end' });
            for (const a of acts) { if (st.status !== 'active') break; if (!E2.apply(st, a)) refused++; else if (a.t === 'use' && u.side === 'player') used[a.key] = (used[a.key] || 0) + 1; }
          }
          if (st.status !== 'active') ended++;
        }
        const never = Object.values(NEW).flat().filter(k => !used[k]);
        check(ended === N && refused === 0 && never.every(k => k === 'h_battle_cry'), 'a party that brings only the ten from the higher rungs fights its battles to the end: nothing is refused, and the mind finds a use for each (Battle Cry it leaves to players)',
          `${ended} of ${N} ended; never used: ${never.join() || 'none'}`);
        // Battle Cry, used by hand: everyone within two is emboldened.
        const mk = (cls, i, r) => T.partyUnit({ id: i + 1, name: cls, role: 'idle', unit: CE.unitFromCitizen({ id: i + 1, name: cls, role: 'idle', stats: { strength: 20, agility: 30 - i, endurance: 20, intelligence: 20, charisma: 14 }, skills: { combat: 9 } }) }, cls, null, null, 20, r);
        const st = E2.createBattle({ seed: 5, land: 'forest', party: [mk('hearthkeeper', 0, ['h_cinder', 'h_kindle', 'h_battle_cry', 'h_hearthlight', 'h_rekindle']), mk('guard', 1), mk('archer', 2), mk('wizard', 3)], enemies: [T.foeUnit(F.FOES.rat_cutpurse, 0, 'green', null)] });
        for (let g = 0; g < 10 && E2.current(st).cls !== 'hearthkeeper'; g++) E2.apply(st, { t: 'end' });
        const hk = E2.current(st);
        check(hk.cls === 'hearthkeeper' && !!E2.apply(st, { t: 'use', key: 'h_battle_cry', x: hk.x, y: hk.y }) && st.units.filter(x => x.side === 'player' && Math.abs(x.x - hk.x) + Math.abs(x.y - hk.y) <= 2).every(x => x.st.bold > 0) && hk.st.bold > 0,
          'Battle Cry emboldens the Hearthkeeper and every friend within two tiles');
      }
      const every = Object.values(T.KITS).flatMap(k => k.abilities).concat(Object.values(T.TRADE_KIT));
      check(every.every(k => T.SAY[k.key] && T.abilityOf(k, stub).desc === T.SAY[k.key]) && !Object.values(T.SAY).some(t => /card|front creature|creature in front|Spent until|Withered|Once a fight/i.test(t)),
        'every ability is described for the board: none speaks of cards, the front of a line, or a rest that brings it back');
    }
  }
  console.log('What a battle teaches (lib/tactics_xp.js)');
  {
    const XP = require('../lib/tactics_xp'), M = require('../lib/career_math');
    check(XP.xpOf(['fox_footpad', 'weasel_slinger', 'polecat_sawbones'], 'green') === 26 && XP.xpOf(['hill_ogre', 'mountain_harpy', 'crow_stormcaller'], 'red') === 79 && XP.xpOf(['grum', 'hill_ogre', 'mountain_harpy'], 'purple') === 258
      && XP.xpOf(['night_wolf'], 'green') === XP.xpOf(['wolf_raider'], 'green') && XP.xpOf(['made_in_the_editor'], 'green') === XP.RANK_XP.regular && XP.xpOf([], 'red') === 0,
      'a fight is worth its foes\' ranks times the skull: 26 for three brigands at green, 79 for an ogre\'s band at red, 258 for Grum at purple');
    const tiers = Object.keys(XP.TIER_XP), ranks = ['minion', 'regular', 'heavy', 'elite', 'boss'];
    check(tiers.every((t, i) => i === 0 || XP.TIER_XP[t] > XP.TIER_XP[tiers[i - 1]]) && ranks.every((k, i) => i === 0 || XP.RANK_XP[k] > XP.RANK_XP[ranks[i - 1]]) && XP.OFF_JOB === 0.5 && XP.FALLEN === 0.5,
      'a harder skull and a higher rank are worth more; a villager and the fallen earn half');
    check(M.levelForXp(M.xpForLevel(5)) === 5 && M.levelForXp(M.xpForLevel(5) - 1) === 4 && Math.abs(M.xpForLevel(5) - 180) <= 2 && M.xpForLevel(10) > 1700 && M.xpForLevel(10) < 1900, 'the levels are the careers\' own: about 180 experience is level 5, about 1,800 is level 10', `${M.xpForLevel(5)}, ${M.xpForLevel(10)}`);
  }
  console.log('A dungeon on the board: what foes leave, and fewer, larger fights');
  {
    const items = [...new Set(all.flatMap(f => (f.drops || []).map(d => d[0])))];
    check(all.every(f => Array.isArray(f.drops) && f.drops.length && f.drops.every(d => d[0] && d[1] > 0 && d[1] <= 1)) && !items.includes('hide'),
      'every foe may leave something it carried, and nobody leaves a hide', items.join(' '));
    const d1 = F.dropsOf(['redtooth', 'fox_footpad', 'polecat_sawbones'], 4242), d2 = F.dropsOf(['redtooth', 'fox_footpad', 'polecat_sawbones'], 4242);
    let n = 0; for (let k = 1; k <= 400; k++) if (F.dropsOf(['fox_footpad'], k * 7919).some(x => x.item === 'wool')) n++;
    check(JSON.stringify(d1) === JSON.stringify(d2) && d1.some(x => x.item === 'ancient_coin') && n > 50 && n < 120 && F.dropsOf([], 5).length === 0,
      'what a fight leaves comes from its seed: the same every time, a sure drop always, a one-in-five drop about one time in five', `${n} of 400`);
    const GEN = require('../lib/dungeon_gen'), DEFS = require('../lib/dungeon_defs');
    const want = { green: [2, 3], yellow: [3, 4], orange: [3, 5], red: [4, 6], purple: [5, 7] };
    let made = 0, bad = 0, safe = 0, wrong = 0, big = 0, fightsN = 0, foesN = 0;
    for (const tier of Object.keys(want)) for (const land of GEN.LANDS) for (let seed = 1; seed <= 25; seed++) {
      const d = GEN.generate({ seed, tier, terrain: land, creatures: F.castFor(land, seed).creatures, items: null });
      made++; if (GEN.check(d).length) bad++; if (d.notes.safe_layout) safe++;
      let lo = 0, hi = 0;
      for (const fl of d.floors) {
        const by = new Map(fl.rooms.map(r => [r.id, r])), memo = new Map();
        const walk = r => { if (memo.has(r.id)) return memo.get(r.id); const here = DEFS.FIGHTS.includes(r.type) ? 1 : 0, nx = (r.next || []).map(x => walk(by.get(x))); const v = [here + (nx.length ? Math.min(...nx.map(x => x[0])) : 0), here + (nx.length ? Math.max(...nx.map(x => x[1])) : 0)]; memo.set(r.id, v); return v; };
        const st = fl.rooms.filter(r => r.step === 1).map(walk); lo += Math.min(...st.map(x => x[0])); hi += Math.max(...st.map(x => x[1]));
        for (const r of fl.rooms) if (r.enemies) { fightsN++; foesN += r.enemies.length; if (r.enemies.length > 4) big++; }
      }
      if (d.combat !== 'board' || lo < want[tier][0] || hi > want[tier][1]) wrong++;
    }
    check(bad === 0 && safe === 0 && wrong === 0 && big === 0, 'a dungeon made for the board obeys every rule, and a route has 2 to 3 fights at green, up to 5 to 7 at purple, boss and all',
      `${made} dungeons, ${(foesN / fightsN).toFixed(1)} foes a fight`);
    const one = GEN.generate({ seed: 7, tier: 'red', terrain: 'forest', creatures: F.list(), items: null });
    check(one.combat === 'board' && one.floors.length === GEN.SHAPES.red.floors && !GEN.check(one).length && !GEN.BOARD_SHAPES && GEN.fightRange([1, 2]).join() === '1,2',
      'there is one shape for a dungeon now, the board\'s: the longer card shapes went with the cards');
    const LK = require('../lib/tuning').LIFE_KEYS;
    check(Object.keys(T.TIERS).every(k => LK['DUNGEON_FOE_HP_' + k.toUpperCase()].default === T.TIERS[k].hp && LK['DUNGEON_FOE_POW_' + k.toUpperCase()].default === T.TIERS[k].str)
      && !LK.DUNGEON_HP_GREEN && !LK.DUNGEON_REST && T.tierNow('orange').hp === T.TIERS.orange.hp && T.tierNow('nonsense').hp === T.TIERS.green.hp,
      'the skull numbers Dev Tools can change are the board\'s own, starting from the same figures; the card skulls\' numbers are gone');
    check(T.TIERS.green.hp < T.TIERS.yellow.hp && T.TIERS.yellow.hp < T.TIERS.orange.hp && T.TIERS.orange.hp < T.TIERS.red.hp && T.TIERS.red.hp < T.TIERS.purple.hp
      && require('../lib/tuning').LIFE_KEYS.DUNGEON_BOARD_REST.default === 0.5, 'each skull is harder than the last, and a rest on the board gives back half');
  }
  // Both sides' minds can play every showcase to an end.
  {
    const party = ['guard', 'hearthkeeper', 'archer', 'wizard'].map((cls, i) => ({ id: 'c' + i, citizen_id: i, name: cls, cls, maxHp: 60, armour: 2, agility: 8, move: 3, jump: 1,
      abilities: [{ key: 'hit', name: 'Hit', icon: '⚔️', kind: 'attack', target: 'enemy', min: 1, max: cls === 'archer' || cls === 'wizard' ? 4 : 1, shape: 'single', radius: 0, dmg: 12, block: 0, heal: 0, fx: {}, cooldown: 0, quick: false, uses: null, falloff: null }] }));
    const E = require('../lib/tactics_engine');
    let done = 0, n = 0;
    for (const b of Object.keys(F.SHOWCASE)) for (const k of ['first', 'hard', 'boss']) {
      n++;
      const st = E.autoplay({ seed: 77 + n, land: 'forest', party: JSON.parse(JSON.stringify(party)), enemies: F.SHOWCASE[b][k].map((x, i) => T.foeUnit(F.FOES[x], i, 'green', null)) }, 900);
      if (st.status !== 'active') done++;
    }
    check(done === n, 'the rules play every showcase fight through to an end', `${done} of ${n}`);
  }
}

async function part2() {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const adminId = Number(process.env.CRAFTING_TEST_ADMIN_ID) || 0;
  const { query } = require('../db');
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const call = async (uid, method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { Authorization: 'Bearer ' + jwt.sign({ userId: uid, username: 't', species: 'Mice' }, secret), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  console.log('The routes');
  const town = (await query(`SELECT s.user_id FROM settlements s WHERE s.user_id = $1`, [adminId])).rows[0];
  if (!adminId || !town) { check(false, 'needs CRAFTING_TEST_ADMIN_ID with a town'); return; }
  const stranger = 987654321;   // nobody's id, and no admin's
  check((await call(stranger, 'POST', '/api/tactics/admin/setup', {})).status === 403 && (await call(stranger, 'GET', '/api/tactics/admin/options')).status === 403, 'only admins may use them');
  const o = await call(adminId, 'GET', '/api/tactics/admin/options');
  check(o.status === 200 && o.body.classes.length === 5 && o.body.tiers.length === 5 && o.body.lands.length === 7 && o.body.fights.length === 3 && o.body.levels.some(l => l.key === 'skull') && o.body.levels.some(l => l.key === 'as_is'), 'the choices: five classes, five skulls, seven lands, three fights, the levels');
  const before = (await query('SELECT COUNT(*)::int AS n FROM dungeons')).rows[0].n + ':' + (await query('SELECT COUNT(*)::int AS n FROM settlement_quests')).rows[0].n;
  const a = await call(adminId, 'POST', '/api/tactics/admin/setup', { classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'trained', tier: 'orange', terrain: 'hills', seed: 42 });
  check(a.status === 200 && a.body.party.length === 4 && a.body.party.map(u => u.cls).join() === 'guard,hearthkeeper,archer,wizard' && a.body.enemies.length >= 2 && a.body.seed === 42 && a.body.land === 'hills',
    'a setup: four citizens in the classes chosen, a group of creatures, the seed and the land', a.body.party.map(u => u.name).join(', '));
  check(a.body.party.every(u => u.abilities.length === 5 && u.maxHp > 0 && u.move >= 1 && u.abilities.every(x => x.name && x.icon && (x.dmg || x.block || x.heal || Object.keys(x.fx).length))) && a.body.enemies.every(u => u.abilities.length >= 1 && u.maxHp > 0),
    'every unit has health, a move and abilities that do something');
  const b = await call(adminId, 'POST', '/api/tactics/admin/setup', { classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'trained', tier: 'orange', terrain: 'hills', seed: 42 });
  check(JSON.stringify(a.body.enemies) === JSON.stringify(b.body.enemies) && JSON.stringify(a.body.party) === JSON.stringify(b.body.party), 'the same choices and seed give the same two sides');
  const boss = await call(adminId, 'POST', '/api/tactics/admin/setup', { tier: 'orange', terrain: 'hills', seed: 42, fight: 'boss', level: 'skull' });
  check(boss.status === 200 && boss.body.fight === 'boss' && boss.body.level === 'trained' && boss.body.enemies.reduce((n, u) => n + u.maxHp, 0) > a.body.enemies.reduce((n, u) => n + u.maxHp, 0) * 0.9, '"the boss" is the dungeon\'s last fight; "what the skull expects" is trained at orange');
  const asIs = await call(adminId, 'POST', '/api/tactics/admin/setup', { level: 'as_is', tier: 'green', terrain: 'forest' });
  check(asIs.status === 200 && asIs.body.level === 'as_is' && asIs.body.party.length === 4 && asIs.body.seed > 0, 'with no classes or level named, the citizens come as they are, in their own classes, on a fresh seed', asIs.body.party.map(u => u.label).join(', '));
  check((await call(adminId, 'POST', '/api/tactics/admin/setup', { tier: 'pink', terrain: 'moon' })).body.tier === 'green', 'an unknown skull or land falls back to green forest');
  const after = (await query('SELECT COUNT(*)::int AS n FROM dungeons')).rows[0].n + ':' + (await query('SELECT COUNT(*)::int AS n FROM settlement_quests')).rows[0].n;
  check(before === after, 'a setup alone stores nothing: no dungeon, no battle row');

  // ── Battles the server keeps ────────────────────────────────────────────
  console.log('Battles the server keeps');
  const E = require('../lib/tactics_engine');
  const fe = path.join(process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend'), 'js', 'tactics-engine.js');
  if (fs.existsSync(fe)) check(fs.readFileSync(fe, 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'lib', 'tactics_engine.js'), 'utf8'), 'the server and the browser run the same rules, byte for byte');
  check((await call(stranger, 'POST', '/api/tactics/battles', {})).status === 403 && [200, 404].includes((await call(stranger, 'GET', '/api/tactics/battles/current')).status), 'a practice battle is for admins; the battle routes themselves are every player\'s (a quest\'s battle is fought there)');
  const opts = { classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'trained', tier: 'green', terrain: 'plains', seed: 77 };
  let r = await call(adminId, 'POST', '/api/tactics/battles', opts);
  let bt = r.body.battle;
  check(r.status === 200 && bt.id > 0 && bt.status === 'active' && bt.count === 0 && bt.setup.party.length === 4 && bt.setup.seed === 77 && typeof bt.check === 'string', 'a battle is created and stored: its two sides, no choices yet, the board\'s fingerprint');
  check((await call(adminId, 'GET', '/api/tactics/battles/current')).body.battle.id === bt.id, 'it is the town\'s open battle');
  // The browser's copy, played alongside.
  const mine = E.replay(bt.setup, []).state;
  check(E.checksum(mine) === bt.check, 'the browser\'s copy starts on the same board');
  const who = E.current(mine), to = [...E.reach(mine, who).values()].filter(nd => nd.stop && nd.cost)[0];
  r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'move', x: 0, y: 0, extra: 'junk' } });
  check(r.status === 400 && r.body.battle && r.body.battle.count === 0, 'a move the rules do not allow is refused, nothing is stored, and the answer says where the battle stands');
  check((await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'teleport' } })).status === 400, 'so is a move the game does not know');
  check((await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 3, action: { t: 'move', x: to.x, y: to.y } })).status === 409, 'a choice out of step is refused (the battle has moved on)');
  r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'move', x: to.x, y: to.y, extra: 'junk' } });
  E.apply(mine, { t: 'move', x: to.x, y: to.y });
  check(r.status === 200 && r.body.battle.count === 1 && r.body.battle.check === E.checksum(mine) && JSON.stringify(r.body.battle.actions[0]) === JSON.stringify({ t: 'move', x: to.x, y: to.y }), 'a good move is stored (and only what a move may hold); both sides agree on the board');
  r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'move', x: to.x, y: to.y } });
  check(r.status === 200 && r.body.battle.repeated === true && r.body.battle.count === 1, 'the same choice sent twice is taken once');
  r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 1, action: { t: 'undo' } }); E.apply(mine, { t: 'undo' });
  check(r.status === 200 && r.body.battle.check === E.checksum(mine), 'a move can be taken back on the server too');
  // Play it out: the mind chooses for the party, every choice goes through the server.
  let n = 2, agree = true, refused = 0;
  for (let g = 0; g < 400 && mine.status === 'active'; g++) {
    const u = E.current(mine), keep = mine.r, p = E.plan(mine); mine.r = keep;
    const acts = [];
    if (p && p.to && (p.to.x !== u.x || p.to.y !== u.y)) acts.push({ t: 'move', x: p.to.x, y: p.to.y });
    if (p && p.ability) acts.push({ t: 'use', key: p.ability, x: p.x, y: p.y });
    acts.push({ t: 'end', face: ['n', 'e', 's', 'w'][g % 4] });
    for (const a of acts) {
      if (mine.status !== 'active') break;
      if (!E.apply(mine, a)) { refused++; continue; }
      r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: n++, action: a });
      if (r.status !== 200 || r.body.battle.check !== E.checksum(mine)) { agree = false; break; }
    }
    if (!agree) break;
  }
  bt = r.body.battle;
  check(agree && mine.status !== 'active', `a whole battle played through the server: ${n} choices, the two sides agree after every one`, `${mine.status}, ${refused} refused locally`);
  check(bt.status === mine.status && bt.result && bt.result.status === mine.status && bt.result.party.length === 4 && bt.result.rounds === mine.round && bt.result.turns === mine.stats.turns
    && JSON.stringify(bt.result.party.map(x => [x.id, x.citizen_id, x.hp, x.maxHp, x.down])) === JSON.stringify(E.resultOf(mine).party.map(x => [x.id, x.citizen_id, x.hp, x.maxHp, x.down])),
    'when it ends the server records how: who won, the rounds, each citizen\'s health and who is down', JSON.stringify(bt.result).slice(0, 110));
  // What the battle taught: shown for a practice field, kept for nobody.
  {
    const rw = r.body.rewards, XP = require('../lib/tactics_xp');
    if (mine.status === 'victory') {
      const worth = XP.xpOf(bt.setup.enemies.map(e => e.key), bt.tier);
      const rows = rw && rw.party || [];
      check(rw && rw.kept === false && rw.xp === worth && rows.length === 4 && rows.every(x => x.name && x.class_label && x.gain > 0 && x.before && x.after && x.after.xp === Math.round((x.before.xp + x.gain) * 100) / 100 && x.levels === x.after.level - x.before.level),
        'the answer to the last choice says what the battle taught each citizen: the class, the gain, where they were and where they would be', rows.map(x => `${x.class_label} +${x.gain}`).join(', '));
      const kept = (await query('SELECT result FROM tactics_battles WHERE id=$1', [bt.id])).rows[0].result;
      const now = (await query('SELECT citizen_id, class_key, xp FROM citizen_classes WHERE citizen_id = ANY($1::int[])', [rows.map(x => x.citizen_id)])).rows;
      check(kept.rewards && kept.rewards.kept === false && kept.rewards.party.length === 4 && rows.every(x => { const row = now.find(y => y.citizen_id === x.citizen_id && y.class_key === x.class_key); return (Number(row && row.xp) || 0) < x.before.xp + Math.min(x.gain, 5); }),
        'a practice field keeps none of it (it is stored with the battle to be read again)');
    } else check(r.body.rewards == null, 'a practice battle that is lost teaches nothing');
  }
  check((await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n, action: { t: 'end' } })).status === 400 && (await call(adminId, 'GET', '/api/tactics/battles/current')).body.battle === null, 'a finished battle takes no more choices, and the town has no open battle');
  const stored = (await query('SELECT actions, status FROM tactics_battles WHERE id=$1', [bt.id])).rows[0];
  const again = E.replay(bt.setup, stored.actions);
  check(again.bad === -1 && E.checksum(again.state) === E.checksum(mine) && stored.actions.length === n, 'played again from what is stored, the battle comes out the same');
  // One open battle a town; leaving.
  const b1 = (await call(adminId, 'POST', '/api/tactics/battles', opts)).body.battle, b2 = (await call(adminId, 'POST', '/api/tactics/battles', { ...opts, seed: 78 })).body.battle;
  check((await call(adminId, 'GET', `/api/tactics/battles/${b1.id}`)).body.battle.status === 'left' && (await call(adminId, 'GET', '/api/tactics/battles/current')).body.battle.id === b2.id, 'starting another ends the one before: a town has one open battle');
  r = await call(adminId, 'POST', `/api/tactics/battles/${b2.id}/leave`);
  check(r.status === 200 && r.body.battle.status === 'left' && (await call(adminId, 'GET', '/api/tactics/battles/current')).body.battle === null && (await call(adminId, 'POST', `/api/tactics/battles/${b2.id}/leave`)).body.battle.status === 'left', 'leaving ends it; leaving twice is no error');
  check((await call(adminId, 'GET', '/api/tactics/battles/999999999')).status === 404, 'another town\'s battle (or none) is not found');
}

(async () => {
  if (process.env.DATABASE_URL) { try { await part2(); } catch (e) { console.error(e); check(false, 'part 2 crashed: ' + e.message); } }
  else console.log('(no DATABASE_URL: the routes are not tested)');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
