#!/usr/bin/env node
// tactics_quest_sim — how a quest's fight goes on the board (lib/tactics_quests.js): small parties of ordinary
// citizens against one to three of the foes that stand in for a quest's creatures, the rules' own mind on both
// sides. It set the 'quest' tier (QUEST in lib/tactics_setup.js). No database.
//   node scripts/tactics_quest_sim.js                 with the numbers in the game
//   QHP=0.5 QSTR=0.4 node scripts/tactics_quest_sim.js   to try others
const T = require('../lib/tactics_setup'), E = require('../lib/tactics_engine'), F = T.FOES;
const HP = process.env.QHP != null ? Number(process.env.QHP) : T.QUEST.hp, STR = process.env.QSTR != null ? Number(process.env.QSTR) : T.QUEST.str;
T.QUEST.hp = HP; T.QUEST.str = STR;
const OLD = Object.entries(F.OLD).map(([k, v]) => [k, typeof v === 'string' ? v : v.key]);
function run(level, classes, foeKeys, seeds) {
  let wins = 0, downs = 0, rounds = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const party = classes.map((cls, i) => { const u = T.partyUnit({ id: i + 1, name: 'c' + i, role: 'idle' }, cls, level, 't_tool', 1); return u; });
    const foes = foeKeys.map((k, i) => T.foeUnit(F.FOES[k], i, 'quest', null));
    const st = E.replay({ seed: seed * 7 + 3, land: 'forest', party, enemies: foes }, []).state;
    for (let g = 0; g < 400 && st.status === 'active'; g++) {
      const u = E.current(st), keep = st.r, plan = E.plan(st); st.r = keep;
      const acts = [];
      if (plan && plan.to && (plan.to.x !== u.x || plan.to.y !== u.y)) acts.push({ t: 'move', x: plan.to.x, y: plan.to.y });
      if (plan && plan.ability) acts.push({ t: 'use', key: plan.ability, x: plan.x, y: plan.y });
      acts.push({ t: 'end' });
      for (const a of acts) { if (st.status !== 'active') break; E.apply(st, a); }
    }
    if (st.status === 'victory') wins++;
    downs += st.units.filter(u => u.side === 'player' && (u.down || u.fell)).length; rounds += st.round;
  }
  return `${Math.round(wins / seeds * 100)}% won, ${(downs / seeds).toFixed(1)} down, ${(rounds / seeds).toFixed(1)} rounds`;
}
const N = 40;
console.log(`quest tier hp +${HP} str +${STR}`);
for (const [old, k] of OLD) console.log(' 1 villager  vs', k.padEnd(18), run('villager', ['villager'], [k], N), '| 1 novice guard:', run('novice', ['guard'], [k], N));
console.log(' 2 villagers vs fox+rat      ', run('villager', ['villager', 'villager'], ['fox_footpad', 'rat_cutpurse'], N));
console.log(' 2 villagers vs wolf+wolf    ', run('villager', ['villager', 'villager'], ['wolf_raider', 'wolf_raider'], N));
console.log(' 4 villagers vs boar+2 wolves', run('villager', ['villager', 'villager', 'villager', 'villager'], ['boar_bruiser', 'wolf_raider', 'wolf_raider'], N));
console.log(' guard+archer(novice) vs 2 wolves', run('novice', ['guard', 'archer'], ['wolf_raider', 'wolf_raider'], N));
console.log(' 4 novices vs boar+2 wolves  ', run('novice', ['guard', 'archer', 'wizard', 'hearthkeeper'], ['boar_bruiser', 'wolf_raider', 'wolf_raider'], N));
// A camp assault or a sally (lib/raid_camps.js): up to three citizens against one to four of the Withered and their like.
const CAMP = ['hollow_thrall', 'rot_shaman', 'hollow_thrall', 'newt_darter'];
console.log(' camp, 2 foes: 3 villagers', run('villager', ['villager', 'villager', 'villager'], CAMP.slice(0, 2), N), '| 3 novices:', run('novice', ['guard', 'archer', 'hearthkeeper'], CAMP.slice(0, 2), N));
console.log(' camp, 4 foes: 3 villagers', run('villager', ['villager', 'villager', 'villager'], CAMP, N), '| 3 novices:', run('novice', ['guard', 'archer', 'hearthkeeper'], CAMP, N), '| 3 trained:', run('trained', ['guard', 'archer', 'hearthkeeper'], CAMP, N));
