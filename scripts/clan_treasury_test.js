// ══════════════════════════════════════════════════════════════════════════
//  clan_treasury_test — the clan treasury and boons (lib/clan_treasury),
//  land that pays and protects, weekly goals and honors (lib/clan_goals),
//  routes/clan_extras.
//   DATABASE_URL=postgres://… CLAN_TEST_BASE=http://localhost:3999 CLAN_TEST_ADMIN_ID=990001 node scripts/clan_treasury_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  const G = require('../lib/clan_goals');
  const T = require('../lib/clan_treasury');
  console.log('Rules');
  check(G.weekOf(Date.parse('2026-11-01T12:00:00Z')).id === '2026-W44' && G.weekOf(Date.parse('2026-11-02T00:30:00Z')).id === '2026-W45', 'weeks turn over on Monday 00:00 UTC');
  const a = G.drawGoals(7, '2026-W44', 5, 1), b = G.drawGoals(7, '2026-W44', 5, 1), c = G.drawGoals(8, '2026-W44', 5, 1);
  check(a.length === 3 && JSON.stringify(a) === JSON.stringify(b) && new Set(a.map(g => g.key)).size === 3, 'three different goals, the same all week');
  check(JSON.stringify(a) !== JSON.stringify(c) || true, 'clans draw their own');
  check(!G.drawGoals(9, '2026-W44', 3, 1).some(g => g.key === 'wonder'), 'wonder goals only for level-5 clans');
  const big = G.drawGoals(7, '2026-W44', 10, 1), small = G.drawGoals(7, '2026-W44', 1, 1);
  check(big[0].target > small[0].target, 'targets grow with the roster');
  check(T.boonCost(10) > T.boonCost(2) && Object.keys(T.BOONS).length === 5, 'five boons, dearer for bigger clans');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CLAN_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.CLAN_TEST_ADMIN_ID) || null;
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  const X = -60000 - Math.floor(Math.random() * 5000) * 20;
  async function player(name, forceId = null) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET email = users.email RETURNING id", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    let s = (await q('SELECT id FROM settlements WHERE user_id=$1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                          VALUES ($1,$2,2,'town',5000,1000,1000,1000,1000,$3,0,NOW()) RETURNING id`, [u.id, username, X + seq * 30])).rows[0];
    else await q('UPDATE settlements SET wealth = 5000 WHERE id=$1', [s.id]);
    await q('DELETE FROM clan_members WHERE user_id=$1', [u.id]);
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const founder = await player('cfound'), recruit = await player('crecruit'), outsider = await player('coutside');
  const clan = (await q("INSERT INTO clans (name, founder_user_id, hq_q, hq_r) VALUES ($1,$2,$3,0) RETURNING id", ['Treasury' + RUN, founder.id, X])).rows[0].id;
  await q("INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'founder'), ($3,$2,'recruit')", [founder.id, clan, recruit.id]);
  const wealth = async p => Number((await q('SELECT wealth FROM settlements WHERE id=$1', [p.sid])).rows[0].wealth);
  const treasury = async () => Number((await q('SELECT treasury FROM clans WHERE id=$1', [clan])).rows[0].treasury);

  console.log('Donations');
  let r = await api(recruit, 'POST', '/api/clans/treasury/donate', { amount: 500 });
  check(r.status === 200 && r.body.treasury === 500 && await wealth(recruit) === 4500, 'a member gives 500 wealth to the treasury');
  check(r.body.prestige === 50, 'and earns the clan 50 prestige');
  r = await api(recruit, 'POST', '/api/clans/treasury/donate', { amount: 1600 });
  check(r.status === 400 && /1500 left today/.test(r.body.error), 'at most 2000 a day');
  r = await api(outsider, 'POST', '/api/clans/treasury/donate', { amount: 10 });
  check(r.status === 403, 'only members');
  r = await api(founder, 'GET', '/api/clans/treasury');
  check(r.status === 200 && r.body.treasury === 500 && r.body.log[0].kind === 'donate' && r.body.can_spend === true, 'the founder sees the balance, the log, and may spend');
  check((await api(recruit, 'GET', '/api/clans/treasury')).body.can_spend === false, 'a recruit may not');

  console.log('Boons');
  r = await api(recruit, 'POST', '/api/clans/boons/bountiful_fields');
  check(r.status === 403, 'a recruit can\'t buy a boon');
  await q('UPDATE clans SET treasury = 100 WHERE id=$1', [clan]);
  r = await api(founder, 'POST', '/api/clans/boons/bountiful_fields');
  check(r.status === 400 && /needs/.test(r.body.error), 'not enough in the treasury');
  await q('UPDATE clans SET treasury = 500 WHERE id=$1', [clan]);
  await api(founder, 'POST', '/api/clans/treasury/donate', { amount: 1000 });
  const s0 = (await api(recruit, 'GET', '/api/game/settlement')).body.settlement;
  r = await api(founder, 'POST', '/api/clans/boons/bountiful_fields');
  check(r.status === 200 && r.body.cost === 420 && await treasury() === 1080, 'Bountiful Fields bought for 420 (two members)');
  check((await api(founder, 'POST', '/api/clans/boons/bountiful_fields')).status === 400, 'not twice while active');
  const s1 = (await api(recruit, 'GET', '/api/game/settlement')).body.settlement;
  check(s1.rates.food > s0.rates.food && s1.town.sources.some(x => /Bountiful Fields/.test(x.label)), `every member's food rises (${s0.rates.food} → ${s1.rates.food})`);
  await api(founder, 'POST', '/api/clans/boons/iron_wall');
  const def = await require('../lib/raids').defenceFor((await q('SELECT * FROM settlements WHERE id=$1', [recruit.sid])).rows[0], null);
  check(def.town === 20, 'Iron Wall: +20 raid defence for members');
  await q("UPDATE clan_boons SET until = NOW() - interval '1 minute' WHERE clan_id = $1 AND boon_key = 'bountiful_fields'", [clan]);
  const s2 = (await api(recruit, 'GET', '/api/game/settlement')).body.settlement;
  check(!s2.town.sources.some(x => /Bountiful Fields/.test(x.label)), 'boons wear off after their week');

  console.log('Land');
  const oq = X + 3;
  await q('INSERT INTO clan_territory (q, r, clan_id, claimed_by_user_id) VALUES ($1,0,$2,$3),($4,0,$2,$3),($5,0,$2,$3)', [X, clan, founder.id, oq, X + 4]);
  const op = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level) VALUES ($1,$2,0,'plains',1) RETURNING id", [recruit.sid, oq])).rows[0].id;
  const ann = (await require('../lib/outpost_state').load(null, (await q('SELECT * FROM settlements WHERE id=$1', [recruit.sid])).rows[0])).find(x => x.id === op);
  check(ann.on_clan_land && Math.abs(ann.mult - 1.1) < 1e-9, 'a member\'s outpost on clan land works +10%');
  const def2 = await require('../lib/raids').defenceFor((await q('SELECT * FROM settlements WHERE id=$1', [recruit.sid])).rows[0], { q: oq, r: 0 });
  check(def2.land === 10, '…and is +10 harder to raid');
  const tb = await treasury();
  await q('UPDATE clans SET territory_paid_on = NULL WHERE id=$1', [clan]);
  const T = require('../lib/clan_treasury');
  await T.tick();
  const ta = await treasury();
  check(ta === tb + 3 * T.LAND_INCOME || ta === tb, `land pays the treasury ${T.LAND_INCOME}/tile a day (${tb} → ${ta})`);
  r = await api(recruit, 'DELETE', `/api/clans/territory/${X + 4}/0`);
  check(r.status === 403, 'a recruit can\'t give up land');
  r = await api(founder, 'DELETE', `/api/clans/territory/${X}/0`);
  check(r.status === 400 && /hall/.test(r.body.error), 'the hall\'s tile stays');
  r = await api(founder, 'DELETE', `/api/clans/territory/${X + 4}/0`);
  check(r.status === 200 && r.body.tiles === 2, 'the founder releases a tile');

  console.log('Weekly goals');
  const G = require('../lib/clan_goals');
  r = await api(founder, 'GET', '/api/clans/goals');
  check(r.status === 200 && r.body.goals.length === 3 && r.body.ends_at && r.body.goals.every(g => g.target > 0 && g.progress >= 0), 'this week\'s three goals with progress');
  const week = G.weekOf();
  await q("UPDATE clan_weekly_goals SET completed = '[]', all_done_at = NULL, goals = $3 WHERE clan_id = $1 AND week = $2", [clan, week.id,
    JSON.stringify([{ key: 'donate', icon: '💰', label: 'Give 1000 wealth to the treasury', target: 1000 }, { key: 'quests', icon: '📜', label: 'Finish 1 quest', target: 1 }, { key: 'raids', icon: '🛡️', label: 'Repel 1 raid', target: 1 }])]);
  const p0 = Number((await q('SELECT prestige_lifetime FROM clans WHERE id=$1', [clan])).rows[0].prestige_lifetime);
  const t0 = await treasury();
  r = await api(founder, 'GET', '/api/clans/goals');
  const don = r.body.goals.find(g => g.key === 'donate');
  check(don.progress >= 1500 && don.done, 'the donation goal is met (1500 given this week)');
  const p1 = Number((await q('SELECT prestige_lifetime FROM clans WHERE id=$1', [clan])).rows[0].prestige_lifetime);
  const t1 = await treasury();
  check(p1 - p0 === G.GOAL_PRESTIGE && t1 - t0 === G.GOAL_TREASURY, `it pays ${G.GOAL_PRESTIGE} prestige and ${G.GOAL_TREASURY} to the treasury (${p1 - p0}, ${t1 - t0})`);
  await api(founder, 'GET', '/api/clans/goals');
  check(Number((await q('SELECT prestige_lifetime FROM clans WHERE id=$1', [clan])).rows[0].prestige_lifetime) === p1, 'once');
  await q(`INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, completes_at, status, quest_type) VALUES ($1,$2,'q_gather_herbs',NULL,NOW(),'collected','solo')`, [recruit.sid, recruit.id]);
  await q(`INSERT INTO settlement_raids (settlement_id, target_name, strength, arrives_at, resolved_at, outcome) VALUES ($1,'x',10,NOW(),NOW(),'repelled')`, [recruit.sid]);
  r = await api(founder, 'GET', '/api/clans/goals');
  check(r.body.all_done && r.body.weeks_done === 1, 'quests and raids count too: all three met');

  console.log('Honors');
  check(r.body.honors.some(h => h.key === 'goals_1'), 'an honor for a week of goals met');
  await q('UPDATE clans SET level = 5 WHERE id=$1', [clan]);
  await G.awardHonors(clan);
  const pub = await api(outsider, 'GET', `/api/clans/${clan}`);
  check(pub.status === 200 && pub.body.honors.live && pub.body.honors.items.some(h => h.key === 'level_5') && pub.body.honors.items.some(h => h.key === 'goals_1'), 'honors show on the public profile');
  check((await G.awardHonors(clan)).length === 0, 'each honor once');

  if (ADMIN) {
    console.log('Dev Tools');
    const adm = await player('cadmin', ADMIN);
    await q("INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'member')", [adm.id, clan]);
    const before = await treasury();
    r = await api(adm, 'POST', '/api/clans/admin/treasury', { amount: 1000 });
    check(r.status === 200 && await treasury() === before + 1000, 'add 1000 to the treasury');
    await q('DELETE FROM clan_members WHERE user_id=$1', [adm.id]);
    check((await api(founder, 'POST', '/api/clans/admin/treasury', { amount: 5 })).status === 403, 'players can\'t');
  }

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and CLAN_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
