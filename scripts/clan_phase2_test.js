// scripts/clan_phase2_test.js — checks for spec 016 Phase 2 (prestige,
// daily cap, levels, emit sites, clan SSE channel, activity, leaderboard).
//
// Part 1 calls the subscriber and quest resolver in-process against the
// database. Part 2 drives a running server over HTTP/SSE (same
// DATABASE_URL). Run only against a throwaway database.
//
// Usage:
//   DATABASE_URL=postgres://… CLAN_TEST_BASE=http://localhost:3999 \
//     node scripts/clan_phase2_test.js

'use strict';

const { pool } = require('../db');
const sub = require('../lib/clan_subscriber');
const eventBus = require('../lib/event_bus');
const gameEvents = require('../lib/game_events');

const BASE = process.env.CLAN_TEST_BASE || 'http://localhost:3000';
const RUN = Math.random().toString(36).slice(2, 7);
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}
const q = (t, p) => pool.query(t, p);
const tick = ms => new Promise(r => setTimeout(r, ms));

let seq = 0;
async function user(name) {
  const username = `${name}_${RUN}_${seq++}`;
  const u = (await q(
    "INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id",
    [username, `${username}@t.l`])).rows[0];
  const s = (await q(
    `INSERT INTO settlements (user_id, name, tile_q, tile_r, world_version) VALUES ($1,$2,1,1,2) RETURNING id`,
    [u.id, username])).rows[0];
  return { id: u.id, username, settlementId: s.id };
}
async function clanWith(members, { lifetime = 0 } = {}) {
  const c = (await q(
    `INSERT INTO clans (name, founder_user_id, prestige, prestige_lifetime, level)
     VALUES ($1,$2,$3,$3,$4) RETURNING id`,
    [`C ${RUN} ${seq++}`, members[0].id, lifetime, require('../lib/clan_palette').levelForLifetime(lifetime)])).rows[0];
  for (const [i, m] of members.entries()) {
    await q('INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,$3)', [m.id, c.id, i ? 'recruit' : 'founder']);
  }
  return c.id;
}
const clanRow = id => q('SELECT prestige, prestige_lifetime, level FROM clans WHERE id=$1', [id]).then(r => r.rows[0]);
const memberRow = id => q('SELECT prestige_day::text AS day, prestige_today, prestige_contributed FROM clan_members WHERE user_id=$1', [id]).then(r => r.rows[0]);
const award = (userId, raw, extra) => sub.awardPrestige({ userId, raw, source: 'test', ...extra });

async function part1() {
  console.log('Formulas');
  const qp = [[120, 6], [600, 13], [1800, 22], [3600, 31], [7200, 40], [15, 2]];
  for (const [s, v] of qp) check(sub.questPrestige(s) === v, `quest ${s / 60} min → ${v} (got ${sub.questPrestige(s)})`);
  check(sub.battlePrestige(1) === 6 && sub.battlePrestige(3) === 12 && sub.battlePrestige(9) === 18, 'battle 1/3/9 enemies → 6/12/18');
  check(sub.capped(0, 150) === 150 && sub.capped(150, 150) === 75 && sub.capped(300, 50) === 0, 'capped(): bands 100% / 50% / 0%');
  check(sub.capped(140, 20) === 10 + 5, 'capped(): award straddling 150 is split across bands');

  console.log('Daily cap');
  const a = await user('cap'); const ca = await clanWith([a]);
  const r1 = await award(a.id, 100); const r2 = await award(a.id, 100);
  const r3 = await award(a.id, 150); const r4 = await award(a.id, 50);
  check(r1.effective === 100 && r2.effective === 75 && r3.effective === 50 && r4.effective === 0,
    `100/100/150/50 raw → 100/75/50/0 credited (got ${[r1, r2, r3, r4].map(r => r.effective)})`);
  check(Number((await clanRow(ca)).prestige_lifetime) === 225, 'max effective per member-day is 225');
  const tier = await sub.onTierUpgraded({ userId: a.id, tier: 'town' });
  const m = await memberRow(a.id);
  check(tier.effective === 200 && m.prestige_today === 400, 'tier milestone credited in full; daily raw counter untouched');
  await q("UPDATE clan_members SET prestige_day = (NOW() AT TIME ZONE 'UTC')::date - 1 WHERE user_id=$1", [a.id]);
  const r5 = await award(a.id, 10);
  check(r5.effective === 10 && (await memberRow(a.id)).prestige_today === 10, 'UTC day rollover resets the counter');
  check(Number((await memberRow(a.id)).prestige_contributed) === 435, 'roster contribution sums credited points');

  console.log('Events');
  const failedQ = await sub.onQuestCompleted({ userId: a.id, durationS: 600, success: false });
  check(failedQ === null, 'failed quest → no prestige');
  const solo = await user('solo');
  check(await sub.onBattleWon({ userId: solo.id, enemyCount: 2 }) === null, 'clanless player → no-op');
  const viaSettlement = await sub.onOutpostEstablished({ settlementId: a.settlementId });
  check(viaSettlement && viaSettlement.raw === 15, 'settlement id resolves to the member (outpost = 15)');

  console.log('Concurrency');
  const b = await user('par'); await clanWith([b]);
  await q("UPDATE clan_members SET prestige_day = (NOW() AT TIME ZONE 'UTC')::date, prestige_today = 140 WHERE user_id=$1", [b.id]);
  const par = await Promise.all([1, 2, 3, 4, 5].map(() => award(b.id, 10)));
  const credited = par.reduce((n, r) => n + r.effective, 0);
  check(credited === sub.capped(140, 50), `5 parallel grants straddling 150 credit exactly capped(140,50)=${sub.capped(140, 50)} (got ${credited})`);

  const crew = await Promise.all([0, 1, 2, 3, 4].map(i => user('lvl' + i)));
  const cl = await clanWith(crew, { lifetime: 490 });
  const seen = [];
  const unsub = eventBus.subscribe(`clan:${cl}`, ev => seen.push(ev));
  await Promise.all(crew.map(m => award(m.id, 10)));
  unsub();
  const lvl = await clanRow(cl);
  const ups = (await q("SELECT COUNT(*)::int AS n FROM clan_activity WHERE clan_id=$1 AND type='level_up'", [cl])).rows[0].n;
  check(lvl.level === 2 && Number(lvl.prestige_lifetime) === 540, 'parallel grants crossing 500 → level 2');
  check(ups === 1 && seen.filter(e => e.type === 'clan_level_up').length === 1, 'exactly one level-up (activity + SSE)');
  check(seen.filter(e => e.type === 'clan_prestige').length === 5, 'one clan_prestige event per grant on clan:<id>');

  console.log('Spend');
  const sp = await pool.connect();
  try {
    const cs = await clanWith([await user('spend')], { lifetime: 100 });
    const results = await Promise.all([1, 2].map(async () => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const v = await sub.spendPrestige(c, cs, 60); await c.query('COMMIT'); return v; }
      finally { c.release(); }
    }));
    check(results.filter(v => v !== null).length === 1 && Number((await clanRow(cs)).prestige) === 40,
      'two parallel 60-point spends on 100 → one succeeds, balance 40');
    check(Number((await clanRow(cs)).prestige_lifetime) === 100, 'spending never lowers lifetime prestige');
  } finally { sp.release(); }

  console.log('Quest resolution emits once');
  sub.register();
  const qp1 = await user('quest'); const cq = await clanWith([qp1]);
  const run = (await q(
    `INSERT INTO settlement_quests (settlement_id, user_id, quest_id, completes_at)
     VALUES ($1,$2,'q_gather_herbs', NOW() - INTERVAL '1 minute') RETURNING id`,
    [qp1.settlementId, qp1.id])).rows[0];
  const { resolveCompletedQuests } = require('../routes/quests');
  const realRandom = Math.random;
  Math.random = () => 0;                         // force success
  try { await Promise.all([resolveCompletedQuests(qp1.settlementId), resolveCompletedQuests(qp1.settlementId)]); }
  finally { Math.random = realRandom; }
  await tick(500);                               // handlers are fire-and-forget
  const grants = (await q(
    "SELECT COUNT(*)::int AS n FROM clan_activity WHERE clan_id=$1 AND type='prestige_earned' AND payload->>'quest_run_id' = $2",
    [cq, String(run.id)])).rows[0].n;
  check(grants === 1, 'two concurrent resolvers → quest awarded once');
  check(Number((await clanRow(cq)).prestige_lifetime) === 6, '2-minute quest → 6 prestige');

  let threw = false;
  gameEvents.on('quest_completed', () => { throw new Error('boom'); });
  try { gameEvents.emit('quest_completed', { success: false }); } catch (_) { threw = true; }
  check(!threw, 'a throwing listener never reaches the emitter');
}

// ── Part 2: live server ────────────────────────────────────────────────────
async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
async function httpUser(name, tier = 'camp') {
  const username = `${name}${RUN}${seq++}`;
  const r = await api(null, 'POST', '/api/auth/register', { username, email: username + '@t.l', password: 'password123', species: 'Mice' });
  const u = (await q('SELECT id FROM users WHERE username=$1', [username])).rows[0];
  const s = (await q(`UPDATE settlements SET tile_q=2, tile_r=2, world_version=2, tier=$2, food=9000, timber=9000,
    stone=9000, metal=9000, wealth=9000, population=50 WHERE user_id=$1 RETURNING id`, [u.id, tier])).rows[0];
  for (const b of ['granary', 'farm', 'market', 'tavern', 'forager_hut', 'lumber_camp']) await q('INSERT INTO buildings (settlement_id,type,level) VALUES ($1,$2,1)', [s.id, b]);
  return { username, token: r.data.token, id: u.id, settlementId: s.id };
}
function listen(p) {
  const events = [], ctrl = new AbortController();
  const state = { ended: false };
  (async () => {
    try {
      const res = await fetch(`${BASE}/api/stream?token=${encodeURIComponent(p.token)}`, { signal: ctrl.signal });
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const f = buf.slice(0, i); buf = buf.slice(i + 2);
          if (f.startsWith('data: ')) events.push(JSON.parse(f.slice(6)));
        }
      }
    } catch (_) {}
    state.ended = true;
  })();
  return { events, state, close: () => ctrl.abort() };
}

async function part2() {
  console.log('Live server');
  const lead = await httpUser('lead', 'camp');
  const mate = await httpUser('mate');
  const outsider = await httpUser('out');
  const cid = await clanWith([lead, mate]);

  const sm = listen(mate), so = listen(outsider);
  await tick(400);
  check(sm.events[0] && sm.events[0].clan_id === cid, 'connected event carries clan_id');
  const up = await api(lead.token, 'POST', '/api/game/upgrade-tier');
  check(up.status === 200 && up.data.newTier === 'village', 'leader upgrades camp → village');
  await tick(600);
  check(sm.events.some(e => e.type === 'clan_prestige' && e.amount === 100), 'clanmate receives clan_prestige (tier milestone 100)');
  check(!so.events.some(e => String(e.type).startsWith('clan_')), 'non-member receives no clan events');

  const again = await Promise.all([1, 2].map(() => api(lead.token, 'POST', '/api/game/upgrade-tier')));
  const okCount = again.filter(r => r.status === 200).length;
  await tick(600);
  const townAwards = (await q("SELECT COUNT(*)::int AS n FROM clan_activity WHERE clan_id=$1 AND payload->>'tier'='town'", [cid])).rows[0].n;
  check(okCount === 1 && townAwards === 1, 'two parallel tier upgrades → one upgrade, one milestone');

  const act = await api(mate.token, 'GET', '/api/clans/activity');
  check(act.status === 200 && act.data.activity.some(a => a.type === 'prestige_earned'), 'activity feed lists prestige grants');
  const actOut = await api(outsider.token, 'GET', '/api/clans/activity');
  check(actOut.status === 403, 'non-member cannot read the activity feed');
  const lb = await api(null, 'GET', '/api/clans/leaderboard');
  check(lb.status === 200 && lb.data.leaderboard.some(c => c.id === cid && c.prestige === 300), 'leaderboard lists the clan with lifetime prestige');

  // Kick → the kicked member's stream is ended by the server.
  await q("UPDATE clan_members SET rank='founder' WHERE user_id=$1", [lead.id]);
  const kick = await api(lead.token, 'POST', `/api/clans/members/${mate.id}/kick`);
  await tick(600);
  check(kick.status === 200 && sm.state.ended, 'kicked member\'s stream is closed by the server');
  const sm2 = listen(mate);
  await tick(400);
  check(sm2.events[0] && sm2.events[0].clan_id === null, 'on reconnect the kicked member has no clan channel');
  await api(lead.token, 'PATCH', '/api/clans/profile', { description: 'after kick' });
  await tick(400);
  check(!sm2.events.some(e => String(e.type).startsWith('clan_p')), 'kicked member receives no further clan events');
  sm.close(); sm2.close(); so.close();
}

(async () => {
  console.log(`Clan Phase 2 tests (run ${RUN})`);
  try {
    await part1();
    if (process.env.CLAN_TEST_BASE) await part2();
    else console.log('  skip  live-server checks (set CLAN_TEST_BASE)');
  } catch (e) { failed++; console.error(e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
