// ══════════════════════════════════════════════════════════════════════════
//  rankings_test — the Rankings boards (lib/rankings.js, GET /api/stats/board/:id).
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 node scripts/rankings_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function main() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const R = require('../lib/rankings');
  const BASE = process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  // Far above any real player: the boards are global, so these must top them.
  async function town(name, { tier = 'camp', wealth = 0, citizens = 0, levels = [] } = {}) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, tile_q, tile_r, last_tick) VALUES ($1,$2,2,$3,$4,-90000-$5,-90000,NOW()) RETURNING id`,
      [u.id, username + ' Hollow', tier, wealth, seq])).rows[0];
    const cits = [];
    for (let i = 0; i < citizens; i++) cits.push((await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, born_at)
        VALUES ($1,$2,'farmer','{}','{}','{}','adult','[]','[]', NOW() - make_interval(days => $3)) RETURNING id`, [s.id, `Cit${i}_${RUN}`, 10 + i])).rows[0].id);
    for (const [type, level] of levels) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,$3)', [s.id, type, level]);
    return { id: u.id, sid: s.id, username, cits, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const get = async (id, p) => {
    const r = await fetch(`${BASE}/api/stats/board/${id}`, { headers: p ? { Authorization: 'Bearer ' + p.token } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const big = await town('rkbig', { tier: 'city', wealth: 99999999, citizens: 300, levels: [['farm', 5], ['market', 5]] });
  const small = await town('rksmall', { tier: 'village', wealth: 99999998, citizens: 299 });

  console.log('Settlement boards');
  let r = await get('score', big);
  const topScore = r.body.rows[0];
  check(r.status === 200 && topScore.name === big.username && topScore.you === true && topScore.values[1] === 'City', 'Overall Score: the biggest town leads, and you see it\'s you');
  check(Number(topScore.values[0].replace(/,/g, '')) === R.score({ tier: 'city', building_levels: 10, citizens: 300, research: 0 }), `the score follows the documented formula (${topScore.values[0]})`);
  r = await get('wealth');
  check(r.body.rows[0].name === big.username && r.body.rows[1].name === small.username && r.body.rows.every(x => x.you === false), 'Wealth: richest first; signed out, no row is "you"');
  r = await get('population');
  check(r.body.rows[0].name === big.username && r.body.rows[0].values[0] === 300, 'Population counts living citizens');
  check(r.body.rows.length <= R.TOP && JSON.stringify(r.body).indexOf('user_id') < 0 && JSON.stringify(r.body).indexOf('"id"') < 0, `top ${R.TOP}, and no ids leak`);

  console.log('Citizen boards');
  await q("INSERT INTO citizen_classes (citizen_id, settlement_id, class_key, level, xp) VALUES ($1,$2,'farmer',20,999999)", [big.cits[0], big.sid]).catch(async () => {
    await q("INSERT INTO citizen_classes (citizen_id, class_key, level, xp) VALUES ($1,'farmer',20,999999)", [big.cits[0]]);
  });
  r = await get('skilled');
  check(r.body.rows[0].name === `Cit0_${RUN}` && r.body.rows[0].values[1] === 'Lv 20' && /Farmer/.test(r.body.rows[0].values[0]) && /Hollow/.test(r.body.rows[0].sub), 'Most Skilled: the citizen, their career and level, their town');
  await q("UPDATE citizens SET born_at = '1990-01-01' WHERE id = $1", [small.cits[5]]);
  r = await get('oldest');
  check(r.body.rows[0].name === `Cit5_${RUN}` && /days/.test(r.body.rows[0].values[0]), 'Oldest: the longest-lived citizen');
  await q(`INSERT INTO settlement_quests (settlement_id, user_id, citizen_id, quest_id, status, party_ids, completes_at)
           SELECT $1, $2, $3, 'x', 'completed', $4::jsonb, NOW() FROM generate_series(1, 500)`, [big.sid, big.id, big.cits[1], JSON.stringify([big.cits[1]])]).catch(e => console.log('   (quest insert:', e.message + ')'));
  r = await get('adventurous');
  check(r.status === 200 && (r.body.rows[0] || {}).name === `Cit1_${RUN}`, 'Most Adventurous: the citizen with the most quests won');

  console.log('Fishing and the tavern');
  for (let i = 0; i < 400; i++) await R.recordCatch(small.id, { id: 'minnow', name: 'Minnow', value: 2 });
  await R.recordCatch(big.id, { id: 'moontrout', name: 'Moontrout', value: 9999 });
  r = await get('biggest');
  check(r.body.rows[0].name === big.username && r.body.rows[0].values[0] === 'Moontrout', 'Biggest Fish: the most valuable catch');
  r = await get('mostfish');
  check(r.body.rows[0].name === small.username && r.body.rows[0].values[0] === 400, 'Most Fish: the most landed');
  await require('../lib/game_stats_store').record(small.id, 'squirrel', true);
  r = await get('squirrel');
  check(r.status === 200 && r.body.rows.some(x => x.name === small.username), 'Squirrel\'s Stash wins have a board');
  check((await get('achpoints')).status === 404, 'no board for things that don\'t exist yet');

  await pool.end();
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(skipped — set DATABASE_URL and CRAFTING_TEST_BASE)'); console.log('\n0 passed, 0 failed'); return; }
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
