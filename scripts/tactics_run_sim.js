#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
//  tactics_run_sim — whole dungeons on the board (docs/TACTICS.md §5).
//  scripts/tactics_sim.js measures one battle; this walks a party through a
//  generated board dungeon from the door to the boss, as lib/dungeons.js runs
//  one: wounds and who is down carry from fight to fight, a rest gives back a
//  share of full health and stands the fallen up, a landing is a rest, a
//  defeat ends it. The engine's own mind plays both sides of every battle.
//  Needs DATABASE_URL and a town with four adults (the party's real stats).
//
//    node scripts/tactics_run_sim.js [runs a skull] [skull …]
//    TACTICS_TIERS='{"red":{"hp":1.6,"str":0.7}}' node scripts/tactics_run_sim.js 60 red
//    DUNGEON_REST=0.4 node scripts/tactics_run_sim.js      (the board's rest; lib/tuning.js DUNGEON_BOARD_REST)
//
//  Two ways of walking: "careful" takes the road with fewest fights and rests
//  whenever it can; "bold" takes every fight and elite it can reach. A real
//  player is somewhere between. "minutes" is the player's turns at 12 seconds
//  each: what the battles of one run cost in playing time.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const T = require('../lib/tactics_setup');
const F = require('../lib/tactics_foes');
const GEN = require('../lib/dungeon_gen');
const DEFS = require('../lib/dungeon_defs');
const { query } = require('../db');
const E = require(path.join(process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend'), 'js', 'tactics-engine.js'));
if (process.env.TACTICS_TIERS) { const over = JSON.parse(process.env.TACTICS_TIERS); for (const k of Object.keys(over)) Object.assign(T.TIERS[k], over[k]); }
const REST = process.env.DUNGEON_REST != null ? Number(process.env.DUNGEON_REST) : require('../lib/tuning').LIFE_KEYS.DUNGEON_BOARD_REST.default;

const PARTIES = {
  green:  [['villager', 'villager', 'villager', 'villager'], '4 villagers'],
  yellow: [['guard', 'villager', 'archer', 'villager'], 'guard, archer, 2 villagers'],
  orange: [['guard', 'hearthkeeper', 'archer', 'archer'], 'guard, hearthkeeper, 2 archers'],
  red:    [['guard', 'hearthkeeper', 'archer', 'wizard'], 'all four classes'],
  purple: [['guard', 'hearthkeeper', 'archer', 'wizard'], 'all four classes'],
};
const pad = (s, n) => String(s).padEnd(n);
const isFight = r => DEFS.FIGHTS.includes(r.type);

// Which room next. careful: fewest fights still ahead, a rest when one is on offer and it is needed.
// bold: the most fights ahead, an elite before a plain fight.
function choose(rooms, byId, policy, hurt) {
  const ahead = new Map();
  const count = r => { if (ahead.has(r.id)) return ahead.get(r.id); const next = (r.next || []).map(n => count(byId.get(n))); const v = (isFight(r) && r.type !== 'boss' ? 1 : 0) + (next.length ? (policy === 'bold' ? Math.max(...next) : Math.min(...next)) : 0); ahead.set(r.id, v); return v; };
  const score = r => {
    const n = count(r);
    if (policy === 'bold') return n * 10 + (r.type === 'elite' ? 3 : 0) + (r.type === 'rest' && hurt ? 25 : 0);
    return -n * 10 + (r.type === 'rest' ? (hurt ? 8 : 2) : 0) + (r.type === 'treasure' ? 1 : 0) - (r.type === 'elite' ? 5 : 0);
  };
  return rooms.slice().sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1))[0];
}

function runOne(base, tier, land, seed, policy) {
  const story = GEN.generate({ seed, tier, terrain: land, creatures: F.castFor(land, seed).creatures, items: null, board: true });
  const state = base.map(u => ({ hp: u.maxHp, max: u.maxHp, down: false, fell: false }));
  const out = { cleared: false, fights: 0, turns: 0, raised: 0, lostAt: null, bossDoor: null, rests: 0 };
  const rest = () => { out.rests++; for (const st of state) { const gain = Math.max(1, Math.round(st.max * REST)); if (st.down) { st.down = false; st.hp = Math.min(st.max, gain); } else st.hp = Math.min(st.max, st.hp + gain); } };
  for (let f = 0; f < story.floors.length; f++) {
    const rooms = story.floors[f].rooms, byId = new Map(rooms.map(r => [r.id, r]));
    let options = rooms.filter(r => r.step === 1);
    while (options.length) {
      const health = state.reduce((n, st) => n + st.hp, 0) / state.reduce((n, st) => n + st.max, 0);
      const room = choose(options, byId, policy, health < 0.65 || state.some(st => st.down));
      if (isFight(room)) {
        if (room.type === 'boss') out.bossDoor = health;
        const party = base.map((u, i) => ({ ...u, ...(state[i].down ? { down: true, hp: 0 } : { hp: state[i].hp }) }));
        const enemies = room.enemies.map((k, i) => T.foeUnit(F.foe(k), i, tier, room.boost));
        const st = E.autoplay({ seed: DEFS.battleSeed(seed, 1, f, room.id), land, party, enemies }, 1200);
        out.fights++; out.turns += st.stats.turns;
        st.units.filter(u => u.side === 'player').forEach((u, i) => {
          if (state[i].down && !u.down) out.raised++;
          if (u.fell && !u.down && !state[i].down) out.raised++;      // went down in this fight and was stood back up in it
          state[i].down = !!u.down || u.hp <= 0; state[i].hp = state[i].down ? 0 : Math.max(1, u.hp); if (u.fell || state[i].down) state[i].fell = true;
        });
        if (st.status !== 'victory') { out.lostAt = room.type; break; }
        if (room.type === 'boss') { out.cleared = true; break; }
      } else if (room.type === 'rest' || room.type === 'landing') rest();
      options = (room.next || []).map(n => byId.get(n));
    }
    if (out.lostAt || out.cleared) break;
  }
  out.down = state.filter(st => st.down).length;
  out.fell = state.filter(st => st.fell).length;
  return out;
}

async function main() {
  const runs = parseInt(process.argv[2], 10) || 60, only = process.argv.slice(3).filter(k => PARTIES[k]);
  const town = (await query(`SELECT s.id, s.user_id FROM settlements s WHERE (SELECT COUNT(*) FROM citizens c WHERE c.settlement_id = s.id AND COALESCE(c.life_stage,'adult') IN ('adult','elder')) >= 4 ORDER BY s.id LIMIT 1`)).rows[0];
  if (!town) throw new Error('No town with four adults.');
  const ids = (await query(`SELECT id FROM citizens WHERE settlement_id=$1 AND COALESCE(life_stage,'adult') IN ('adult','elder') ORDER BY id LIMIT 4`, [town.id])).rows.map(r => r.id);
  console.log(`Whole dungeons on the board, the mind on both sides. ${runs} runs a line; a rest gives back ${Math.round(REST * 100)}%.\n`);
  console.log(pad('', 46) + pad('walk', 9) + pad('cleared', 9) + pad('fights', 8) + pad('your turns', 12) + pad('minutes', 9) + pad('at boss door', 14) + pad('went down', 11) + pad('stood up', 10) + 'lost at');
  for (const tier of (only.length ? only : Object.keys(PARTIES))) {
    const [classes, label] = PARTIES[tier];
    const base = await T.partyFor(ids, { classes, level: T.LEVEL_OF_TIER[tier] });
    const t = T.TIERS[tier];
    for (const policy of ['careful', 'bold']) {
      const sum = { cleared: 0, fights: 0, turns: 0, raised: 0, fell: 0, door: 0, doors: 0, lost: {} };
      for (let k = 0; k < runs; k++) {
        const r = runOne(base, tier, GEN.LANDS[k % GEN.LANDS.length], 3000 + k * 7919, policy);
        if (r.cleared) sum.cleared++; sum.fights += r.fights; sum.turns += r.turns; sum.raised += r.raised; sum.fell += r.fell;
        if (r.bossDoor != null) { sum.door += r.bossDoor; sum.doors++; }
        if (r.lostAt) sum.lost[r.lostAt] = (sum.lost[r.lostAt] || 0) + 1;
      }
      console.log(pad(policy === 'careful' ? `${tier} (+${Math.round(t.hp * 100)}% / +${Math.round(t.str * 100)}%): ${label}` : '', 46) + pad(policy, 9) + pad(Math.round(100 * sum.cleared / runs) + '%', 9) + pad((sum.fights / runs).toFixed(1), 8)
        + pad((sum.turns / runs).toFixed(0), 12) + pad((sum.turns / runs * 12 / 60).toFixed(0), 9) + pad(sum.doors ? Math.round(100 * sum.door / sum.doors) + '% health' : '-', 14)
        + pad((sum.fell / runs).toFixed(1), 11) + pad((sum.raised / runs).toFixed(1), 10) + (Object.keys(sum.lost).map(k => `${k} ${sum.lost[k]}`).join(', ') || '-'));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
