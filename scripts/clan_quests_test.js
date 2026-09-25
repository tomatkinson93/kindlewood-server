// scripts/clan_quests_test.js — clan quests: board, solo runs, party
// forming/joining/racing, resolution + rewards + prestige, expiry, leaving.
// Drives a running server over HTTP (same DATABASE_URL). Throwaway DB only.
//
// Usage:
//   DATABASE_URL=postgres://… CLAN_TEST_BASE=http://localhost:3999 \
//     node scripts/clan_quests_test.js

'use strict';

const { Pool } = require('pg');
const BASE = process.env.CLAN_TEST_BASE || 'http://localhost:3000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (t, p) => pool.query(t, p);
const RUN = Math.random().toString(36).slice(2, 7);
let passed = 0, failed = 0, seq = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}
const tick = ms => new Promise(r => setTimeout(r, ms));
async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
async function player(name, { hall = false } = {}) {
  const username = `${name}${RUN}${seq++}`;
  const r = await api(null, 'POST', '/api/auth/register', { username, email: username + '@t.l', password: 'password123', species: 'Mice' });
  const u = (await q('SELECT id FROM users WHERE username=$1', [username])).rows[0];
  const s = (await q(`UPDATE settlements SET tile_q = $2, tile_r = $3, world_version = 2, tier = 'town', wealth = 9000
    WHERE user_id = $1 RETURNING id`, [u.id, seq % 40, Math.floor(seq / 40) % 40])).rows[0];
  if (hall) await q("INSERT INTO buildings (settlement_id,type,level) VALUES ($1,'guild_hall',1)", [s.id]);
  return { username, token: r.data.token, id: u.id };
}
async function join(founder, p) {
  const i = await api(founder.token, 'POST', '/api/clans/invites', { username: p.username });
  await api(p.token, 'POST', `/api/clans/invites/${i.data.invite_id}/accept`);
}
const setLevel = (clanId, level) => q('UPDATE clans SET level = $2 WHERE id = $1', [clanId, level]);
function listen(p) {
  const events = [], ctrl = new AbortController();
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
  })();
  return { events, close: () => ctrl.abort() };
}

// Test players have no citizens until placed through the map flow; seed two.
async function seedCitizens(p) {
  const sid = (await q('SELECT id FROM settlements WHERE user_id = $1', [p.id])).rows[0].id;
  for (const n of ['Ash', 'Bryn']) {
    await q(`INSERT INTO citizens (settlement_id, name, gender, skills) VALUES ($1, $2, 'female', '{}')`, [sid, `${n}${p.id}`]);
  }
}
const citizensOf = async p => (await q(
  `SELECT c.id, c.name FROM citizens c JOIN settlements s ON s.id = c.settlement_id
    WHERE s.user_id = $1 AND COALESCE(c.life_stage, 'adult') <> 'child' ORDER BY c.id`, [p.id])).rows;
const board = async p => (await api(p.token, 'GET', '/api/clan-quests')).data;
const finish = runId => q("UPDATE clan_quest_runs SET completes_at = NOW() - INTERVAL '1 second' WHERE id = $1", [runId]);

async function main() {
  console.log(`Clan quest tests against ${BASE} (run ${RUN})`);
  const F = await player('founder', { hall: true });
  await q(`UPDATE settlements SET (tile_q, tile_r) = (SELECT t.q, t.r FROM tiles t
      WHERE NOT EXISTS (SELECT 1 FROM settlements x WHERE x.tile_q = t.q AND x.tile_r = t.r)
        AND NOT EXISTS (SELECT 1 FROM clan_territory ct WHERE ct.q = t.q AND ct.r = t.r)
      ORDER BY random() LIMIT 1) WHERE user_id = $1`, [F.id]);
  const founded = await api(F.token, 'POST', '/api/clans', { name: `Quest ${RUN}`, banner: { emblem: 'acorn', primary: 'moss', secondary: 'wheat' } });
  const clanId = founded.data.clan_id;
  const M = await player('member'), R = await player('recruit'), X = await player('outsider');
  for (const p of [M, R]) await join(F, p);
  for (const p of [F, M, R]) await seedCitizens(p);
  await q("UPDATE clan_members SET rank = 'member' WHERE user_id = $1", [M.id]);
  const [fc1, fc2] = await citizensOf(F), [mc1, mc2] = await citizensOf(M), [rc1] = await citizensOf(R);
  if (!fc2 || !mc1 || !rc1) throw new Error('setup: players need starting citizens');

  console.log('Board');
  check((await api(X.token, 'GET', '/api/clan-quests')).status === 403, 'outsiders have no board');
  let b = await board(F);
  const solo = b.board.find(x => x.key === 'cq_hall_provisions'), party = b.board.find(x => x.key === 'cp_bandit_ford');
  check(solo && solo.state === 'available', 'level-1 solo quest available');
  check(party && party.state === 'locked' && party.unlock_level === 2, 'party quests locked below level 2');
  check(b.board.find(x => x.key === 'cp_great_hunt').unlock_level === 4, 'harder parties unlock later');

  console.log('Solo');
  check((await api(F.token, 'POST', '/api/clan-quests/solo', { quest_key: 'cq_hall_provisions', citizen_id: mc1.id })).status === 400, "can't send someone else's citizen");
  const s1 = await api(F.token, 'POST', '/api/clan-quests/solo', { quest_key: 'cq_hall_provisions', citizen_id: fc1.id });
  check(s1.status === 200 && s1.data.run_id, 'founder sends a citizen on a solo clan quest');
  check((await api(F.token, 'POST', '/api/clan-quests/solo', { quest_key: 'cq_border_patrol', citizen_id: fc1.id })).status === 400, 'a busy citizen cannot go twice');
  const cit = (await api(F.token, 'GET', '/api/citizens')).data.citizens.find(c => c.id === fc1.id);
  check(cit && cit.active_quest && cit.active_quest.clan === true, '/api/citizens shows them on a clan quest');
  const personal = await api(F.token, 'POST', '/api/quests/accept', { quest_id: 'q_gather_herbs', citizen_id: fc1.id });
  check(personal.status === 400 && /clan quest/.test(personal.data.error), 'personal quests refuse a citizen on a clan quest');
  b = await board(F);
  check(b.board.find(x => x.key === 'cq_hall_provisions').state === 'active' && b.runs.some(r => r.id === s1.data.run_id), 'board shows it underway');
  await q("UPDATE citizens SET skills = '{\"farming\": 99}' WHERE id = $1", [fc1.id]);   // 95% cap
  const before = (await q('SELECT food, wealth FROM settlements WHERE user_id = $1', [F.id])).rows[0];
  const sF = listen(F);
  await tick(400);
  await finish(s1.data.run_id);
  b = await board(F);   // GET resolves due runs
  const done = b.recent.find(r => r.id === s1.data.run_id);
  check(done && ['completed', 'failed'].includes(done.status), 'solo run resolves');
  const after = (await q('SELECT food, wealth FROM settlements WHERE user_id = $1', [F.id])).rows[0];
  if (done.status === 'completed') {
    check(after.food - before.food === 30 && after.wealth - before.wealth === 10, 'rewards land in the settlement');
    await tick(500);
    const pr = (await q('SELECT prestige_lifetime FROM clans WHERE id = $1', [clanId])).rows[0];
    check(Number(pr.prestige_lifetime) >= 12, 'clan earns prestige');
  } else { check(true, '(95% roll failed — rewards skipped)'); check(true, '(skipped)'); }
  await tick(300);
  check(sF.events.some(e => e.type === 'clan_quest_resolved' && e.run_id === s1.data.run_id), 'participant told live');
  check(sF.events.some(e => e.type === 'clan_quest_updated'), 'clan channel told live');
  sF.close();
  check(b.board.find(x => x.key === 'cq_hall_provisions').state === 'done_today', 'solo quest done for today');
  check((await api(F.token, 'POST', '/api/clan-quests/solo', { quest_key: 'cq_hall_provisions', citizen_id: fc2.id })).status === 409, 'once per member per day');
  check((await api(M.token, 'GET', '/api/clan-quests')).data.board.find(x => x.key === 'cq_hall_provisions').state === 'available', 'other members still can');
  check(!(await q('SELECT 1 FROM clan_quest_slots WHERE citizen_id = $1 AND active', [fc1.id])).rows.length, 'citizen is free again');

  console.log('Party');
  await setLevel(clanId, 2);
  check((await api(R.token, 'POST', '/api/clan-quests/party', { quest_key: 'cp_bandit_ford', role_index: 0, citizen_id: rc1.id })).status === 403, 'recruits cannot post parties');
  const p1 = await api(M.token, 'POST', '/api/clan-quests/party', { quest_key: 'cp_bandit_ford', role_index: 0, citizen_id: mc1.id });
  check(p1.status === 200 && p1.data.started === false, 'member posts a party and takes the Scout role');
  const runId = p1.data.run_id;
  check((await api(F.token, 'POST', '/api/clan-quests/party', { quest_key: 'cp_bandit_ford', role_index: 1, citizen_id: fc2.id })).status === 409, 'one forming party per quest');
  check((await api(M.token, 'POST', `/api/clan-quests/runs/${runId}/join`, { role_index: 1, citizen_id: mc2.id })).status === 409, 'one citizen per member per party');
  check((await api(F.token, 'POST', `/api/clan-quests/runs/${runId}/join`, { role_index: 0, citizen_id: fc2.id })).status === 409, 'a taken role cannot be taken');
  b = await board(R);
  const forming = b.runs.find(r => r.id === runId);
  check(forming && forming.status === 'forming' && forming.slots.length === 1 && forming.expires_at, 'board shows the forming party and its deadline');
  // leave → cancelled when empty; re-post
  const lv = await api(M.token, 'POST', `/api/clan-quests/runs/${runId}/leave`);
  check(lv.status === 200 && lv.data.cancelled === true, 'last member leaving calls the party off');
  const p2 = await api(M.token, 'POST', '/api/clan-quests/party', { quest_key: 'cp_bandit_ford', role_index: 0, citizen_id: mc1.id });
  check(p2.status === 200, 'party posted again');
  // Concurrent joins for the last role: exactly one wins.
  const [j1, j2] = await Promise.all([
    api(F.token, 'POST', `/api/clan-quests/runs/${p2.data.run_id}/join`, { role_index: 1, citizen_id: fc2.id }),
    api(R.token, 'POST', `/api/clan-quests/runs/${p2.data.run_id}/join`, { role_index: 1, citizen_id: rc1.id }),
  ]);
  const wins = [j1, j2].filter(x => x.status === 200);
  check(wins.length === 1 && wins[0].data.started === true, 'racing for the last role: one wins, the party sets out');
  check([j1, j2].some(x => x.status === 409), 'the other is told the role was taken');
  const slots = (await q('SELECT COUNT(*)::int AS n FROM clan_quest_slots WHERE run_id = $1', [p2.data.run_id])).rows[0].n;
  check(slots === 2, 'no overfilled roles');
  b = await board(M);
  check(b.runs.find(r => r.id === p2.data.run_id).status === 'active', 'party is underway');
  check((await api(M.token, 'POST', `/api/clan-quests/runs/${p2.data.run_id}/leave`)).status === 409, "can't leave once it's set out");
  const lifeBefore = Number((await q('SELECT prestige_lifetime FROM clans WHERE id = $1', [clanId])).rows[0].prestige_lifetime);
  await q("UPDATE citizens SET skills = '{\"scouting\": 99, \"combat\": 99}' WHERE id = ANY($1::int[])", [[mc1.id, fc2.id, rc1.id]]);
  await finish(p2.data.run_id);
  b = await board(M);
  const pr2 = b.recent.find(r => r.id === p2.data.run_id);
  check(pr2 && ['completed', 'failed'].includes(pr2.status), 'party resolves');
  if (pr2.status === 'completed') {
    await tick(500);
    const lifeAfter = Number((await q('SELECT prestige_lifetime FROM clans WHERE id = $1', [clanId])).rows[0].prestige_lifetime);
    check(lifeAfter - lifeBefore === 80, 'each of the 2 participants earns 40 prestige (outside the daily cap)');
    check(pr2.slots.every(s => s.rewards && s.rewards.wealth === 45), 'every participant gets the rewards');
    check((await api(M.token, 'POST', '/api/clan-quests/party', { quest_key: 'cp_bandit_ford', role_index: 0, citizen_id: mc1.id })).status === 409, 'one completion per party quest per day');
  } else { check(true, '(roll failed)'); check(true, '(skipped)'); check(true, '(skipped)'); }

  console.log('Expiry, cancel, leaving the clan');
  await setLevel(clanId, 3);
  const p3 = await api(M.token, 'POST', '/api/clan-quests/party', { quest_key: 'cp_raise_watchtower', role_index: 0, citizen_id: mc1.id });
  check(p3.status === 200, 'watchtower party posted at level 3');
  check((await api(R.token, 'POST', `/api/clan-quests/runs/${p3.data.run_id}/cancel`)).status === 403, "only the poster or an officer can call it off");
  await q("UPDATE clan_quest_runs SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [p3.data.run_id]);
  b = await board(M);
  check(b.recent.some(r => r.id === p3.data.run_id && r.status === 'expired'), 'unfilled party lapses after its deadline');
  check(!(await q('SELECT 1 FROM clan_quest_slots WHERE citizen_id = $1 AND active', [mc1.id])).rows.length, 'its citizens are released');
  const p4 = await api(M.token, 'POST', '/api/clan-quests/party', { quest_key: 'cp_raise_watchtower', role_index: 0, citizen_id: mc1.id });
  await api(R.token, 'POST', `/api/clan-quests/runs/${p4.data.run_id}/join`, { role_index: 1, citizen_id: rc1.id });
  await api(R.token, 'POST', '/api/clans/leave');
  const rs = (await q('SELECT 1 FROM clan_quest_slots WHERE run_id = $1 AND user_id = $2', [p4.data.run_id, R.id])).rows;
  check(!rs.length, "a member leaving the clan frees their spot in forming parties");
  check((await api(F.token, 'POST', `/api/clan-quests/runs/${p4.data.run_id}/cancel`)).status === 200, 'founder (moderate) calls a party off');
  check(!(await q('SELECT 1 FROM clan_quest_slots WHERE citizen_id = $1 AND active', [mc1.id])).rows.length, 'called-off party releases citizens');

  console.log('Dev Tools');
  const s5 = await api(M.token, 'POST', '/api/clan-quests/solo', { quest_key: 'cq_border_patrol', citizen_id: mc2.id });
  const ch = await api(M.token, 'POST', '/api/clan-quests/cheat/finish');
  check(s5.status === 200 && ch.status === 200 && ch.data.finished >= 1, 'cheat finishes your running quests');
  check(['completed', 'failed'].includes((await q('SELECT status FROM clan_quest_runs WHERE id = $1', [s5.data.run_id])).rows[0].status), 'and resolves them');

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exitCode = failed ? 1 : 0;
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
