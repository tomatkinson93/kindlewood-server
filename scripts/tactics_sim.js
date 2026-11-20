#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════
//  tactics_sim — numbers for the tactics battle prototype
//  (docs/TACTICS_PROTOTYPE.md). Builds real setups (lib/tactics_setup.js:
//  the town's citizens at a playtest level, a generated fight for a skull and
//  a land) and lets the engine's own mind play both sides, on the frontend's
//  js/tactics-engine.js. Needs DATABASE_URL and a town with four adults.
//
//    node scripts/tactics_sim.js [runs] [fight]      fight: first | hard | boss
//    TACTICS_TIERS='{"orange":{"hp":0.6,"str":0.3}}' node scripts/tactics_sim.js
//
//  "your turns" is what a player decides: at about 12 seconds a turn, 25 turns
//  is five minutes. "health lost" is what the party carries into the next room.
// ═════════════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const T = require('../lib/tactics_setup');
const { query } = require('../db');
const E = require(path.join(process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend'), 'js', 'tactics-engine.js'));
if (process.env.TACTICS_TIERS) Object.assign(T.TIERS, JSON.parse(process.env.TACTICS_TIERS));

const PARTIES = {
  green:  [['villager', 'villager', 'villager', 'villager'], '4 villagers'],
  yellow: [['guard', 'villager', 'archer', 'villager'], 'guard, archer, 2 villagers'],
  orange: [['guard', 'hearthkeeper', 'archer', 'archer'], 'guard, hearthkeeper, 2 archers'],
  red:    [['guard', 'hearthkeeper', 'archer', 'wizard'], 'all four classes'],
  purple: [['guard', 'hearthkeeper', 'archer', 'wizard'], 'all four classes'],
};
const LANDS = ['forest', 'plains', 'hills', 'mountain', 'river', 'marsh', 'ruins'];
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const runs = parseInt(process.argv[2], 10) || 140, fight = process.argv[3] || 'first';
  const town = (await query(`SELECT s.user_id FROM settlements s WHERE (SELECT COUNT(*) FROM citizens c WHERE c.settlement_id = s.id AND COALESCE(c.life_stage,'adult') IN ('adult','elder')) >= 4 ORDER BY s.id LIMIT 1`)).rows[0];
  if (!town) throw new Error('No town with four adults.');
  console.log(`Tactics battles, the mind on both sides. ${runs} battles a skull, fight: ${fight}.\n`);
  console.log(pad('', 44) + pad('wins', 7) + pad('your turns', 12) + pad('rounds', 8) + pad('downed', 8) + pad('health lost', 13) + 'foes (health)');
  for (const tier of Object.keys(PARTIES)) {
    const [classes, label] = PARTIES[tier];
    let win = 0, turns = 0, rounds = 0, down = 0, lost = 0, foes = 0, foeHp = 0, stuck = 0;
    for (let k = 0; k < runs; k++) {
      const s = await T.build(town.user_id, { classes, level: 'skull', tier, terrain: LANDS[k % LANDS.length], seed: 1000 + k * 7919, fight });
      const st = E.autoplay({ seed: s.seed, land: s.land, party: s.party, enemies: s.enemies }, 800);
      if (st.status === 'victory') win++; if (st.status === 'active') stuck++;
      const mine = st.units.filter(u => u.side === 'player');
      turns += st.stats.turns; rounds += st.round; down += mine.filter(u => u.down).length;
      lost += 1 - mine.reduce((n, u) => n + Math.max(0, u.hp), 0) / mine.reduce((n, u) => n + u.maxHp, 0);
      foes += s.enemies.length; foeHp += s.enemies.reduce((n, u) => n + u.maxHp, 0);
    }
    const t = T.TIERS[tier];
    console.log(pad(`${tier} (+${Math.round(t.hp * 100)}% / +${Math.round(t.str * 100)}%): ${label}`, 44) + pad(Math.round(100 * win / runs) + '%', 7) + pad((turns / runs).toFixed(1), 12)
      + pad((rounds / runs).toFixed(1), 8) + pad((down / runs).toFixed(1), 8) + pad(Math.round(100 * lost / runs) + '%', 13) + `${(foes / runs).toFixed(1)} (${Math.round(foeHp / runs)})` + (stuck ? `  unfinished ${stuck}` : ''));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
