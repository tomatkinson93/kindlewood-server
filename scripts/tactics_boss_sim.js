// ══════════════════════════════════════════════════════════════════════════
//  tactics_boss_sim — each boss's fight, with its trick in its lair and
//  without (as it was fought before 2026-11-29), the mind on both sides.
//  For keeping a dungeon as likely to be cleared as it was (TACTICS.md §7b).
//
//    DATABASE_URL=… node scripts/tactics_boss_sim.js [fights a line] [skull …]
//    BOSS_HP=redtooth:0.9,grum:0.85 …      try a boss with that share of its health
//
//  The party walks in at 80% health, as it reaches a boss's door in the run
//  simulator. A line: how often the party wins, and the health it has left
//  when it does.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, pool } = require('../db');
const E = require('../lib/tactics_engine');
const T = require('../lib/tactics_setup');
const F = require('../lib/tactics_foes');
const GEN = require('../lib/dungeon_gen');
const DEFS = require('../lib/dungeon_defs');

const PARTIES = {
  green:  ['villager', 'villager', 'villager', 'villager'],
  yellow: ['guard', 'villager', 'archer', 'villager'],
  orange: ['guard', 'hearthkeeper', 'archer', 'archer'],
  red:    ['guard', 'hearthkeeper', 'archer', 'wizard'],
  purple: ['guard', 'hearthkeeper', 'archer', 'wizard'],
};
const TRICKS = ['riposte', 'sees', 'aloft', 'shell', 'rises', 'trick'];
const SHARE = Object.fromEntries(String(process.env.BOSS_HP || '').split(',').filter(Boolean).map(p => { const [k, v] = p.split(':'); return [k, Number(v)]; }));
const pad = (s, n) => String(s).padEnd(n);

function fight(base, tier, land, seed, tricks) {
  const story = GEN.generate({ seed, tier, terrain: land, creatures: F.castFor(land, seed).creatures, items: null });
  const floor = story.floors[story.floors.length - 1], room = floor.rooms.find(r => r.type === 'boss');
  const party = base.map(u => ({ ...u, hp: Math.round(u.maxHp * 0.8) }));
  let enemies = room.enemies.map((k, i) => T.foeUnit(F.foe(k), i, tier, room.boost));
  const boss = enemies.find(e => e.rank === 'boss');
  if (tricks && boss && SHARE[boss.key]) boss.maxHp = Math.max(1, Math.round(boss.maxHp * SHARE[boss.key]));
  if (!tricks) enemies = enemies.map(e => { const c = { ...e, abilities: e.abilities.map(a => { const fx = { ...a.fx }; delete fx.rubble; delete fx.pull; return { ...a, fx }; }) }; for (const k of TRICKS) delete c[k]; return c; });
  const bSeed = DEFS.battleSeed(seed, 1, story.floors.length - 1, room.id);
  const field = tricks ? T.fieldOf(bSeed, land, enemies) : { w: 8, h: 8 };
  const st = E.autoplay({ seed: bSeed, land, ...field, party, enemies }, 1200);
  const mine = st.units.filter(u => u.side === 'player');
  return { won: st.status === 'victory', left: mine.reduce((n, u) => n + Math.max(0, u.hp), 0) / mine.reduce((n, u) => n + u.maxHp, 0), boss: boss ? boss.key : '?', turns: st.stats.turns };
}

(async () => {
  const runs = parseInt(process.argv[2], 10) || 40, only = process.argv.slice(3).filter(k => PARTIES[k]);
  const town = (await query(`SELECT s.id FROM settlements s WHERE (SELECT COUNT(*) FROM citizens c WHERE c.settlement_id = s.id AND COALESCE(c.life_stage,'adult') IN ('adult','elder')) >= 4 ORDER BY s.id LIMIT 1`)).rows[0];
  const ids = (await query(`SELECT id FROM citizens WHERE settlement_id=$1 AND COALESCE(life_stage,'adult') IN ('adult','elder') ORDER BY id LIMIT 4`, [town.id])).rows.map(r => r.id);
  console.log(`Each boss's fight, ${runs} a line: won, and health left when won. "before": no trick, an ordinary field.\n`);
  console.log(pad('', 18) + (only.length ? only : Object.keys(PARTIES)).map(t => pad(t + ': before → now', 30)).join(''));
  const rows = {};
  for (const tier of (only.length ? only : Object.keys(PARTIES))) {
    const base = await T.partyFor(ids, { classes: PARTIES[tier], level: T.LEVEL_OF_TIER[tier] });
    for (const land of GEN.LANDS) {
      const sum = { a: 0, b: 0, la: 0, lb: 0, boss: '?' };
      for (let k = 0; k < runs; k++) {
        const seed = 5000 + k * 7919, a = fight(base, tier, land, seed, false), b = fight(base, tier, land, seed, true);
        sum.boss = b.boss; if (a.won) { sum.a++; sum.la += a.left; } if (b.won) { sum.b++; sum.lb += b.left; }
      }
      const pc = n => Math.round(100 * n / runs) + '%', hl = (s, n) => (n ? Math.round(100 * s / n) + '%' : '-');
      (rows[sum.boss] = rows[sum.boss] || []).push(pad(`${pc(sum.a)} (${hl(sum.la, sum.a)}) → ${pc(sum.b)} (${hl(sum.lb, sum.b)})`, 30));
    }
  }
  for (const k of Object.keys(rows)) console.log(pad(k + (SHARE[k] ? ' ×' + SHARE[k] : ''), 18) + rows[k].join(''));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
