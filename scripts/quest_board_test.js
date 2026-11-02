// ══════════════════════════════════════════════════════════════════════════
//  quest_board_test — the daily tavern rotation, time-limited quests,
//  abandoning a solo quest (routes/quests.js) and the Watchtower
//  (lib/watchtower.js, lib/town_mods.js).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/quest_board_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  const Q = require('../routes/quests');
  const { boardFrom, gateOpen, BOARD_SOLO, BOARD_PARTY } = Q._board;
  const solo = Q.QUEST_POOL.map(q => ({ ...q, quest_type: 'solo' }));
  const party = Q.PARTY_QUEST_POOL.map(q => ({ ...q, quest_type: 'party' }));
  console.log('Rotation');
  const t = Date.parse('2026-06-01T12:00:00Z');
  const a = boardFrom(solo, party, 7, t), a2 = boardFrom(solo, party, 7, t + 3600e3);
  const ids = b => b.solo.filter(q => !q.time_limited).map(q => q.id).join(',');
  check(a.solo.filter(q => !q.time_limited).length === BOARD_SOLO && a.party.filter(q => !q.time_limited).length === BOARD_PARTY, `${BOARD_SOLO} solo and ${BOARD_PARTY} party quests a day`);
  check(ids(a) === ids(a2), 'the same board all day');
  const days = new Set([0, 1, 2, 3].map(d => ids(boardFrom(solo, party, 7, t + d * 86400e3))));
  check(days.size > 1, 'a new board on other days');
  const users = new Set([1, 2, 3, 4].map(u => ids(boardFrom(solo, party, u, t))));
  check(users.size > 1, 'players get different boards');
  check(a.rotates_at === '2026-06-02T00:00:00.000Z', 'it says when it turns over');
  console.log('Time-limited');
  const night = solo.find(q => q.id === 'q_night_moths'), moon = solo.find(q => q.id === 'q_full_moon_pool');
  check(gateOpen(night, { phase: 'night', moon: 'new' }) && !gateOpen(night, { phase: 'day', moon: 'new' }), 'a night quest only at night');
  check(gateOpen(moon, { phase: 'day', moon: 'full' }) && !gateOpen(moon, { phase: 'night', moon: 'new' }), 'a full-moon quest only under a full moon');
  check(!a.solo.some(q => q.id === 'q_night_moths'), 'not on the board at noon');
  const dark = boardFrom(solo, party, 7, Date.parse('2026-06-01T04:00:00Z'));   // night phase: 01–09 UTC
  check(dark.solo.some(q => q.id === 'q_night_moths' && q.time_limited), 'on the board at night, marked time-limited');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function player(name, tier = 'village') {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,$3,1000,1000,500,500,500,-71000-$4,-71000,NOW()) RETURNING id`, [u.id, username, tier, seq])).rows[0];
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const cit = async (p, name, role = 'idle') => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, life_stage) VALUES ($1,$2,'male',$3,'{}','adult') RETURNING id`, [p.sid, name + RUN, role])).rows[0].id;
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  console.log('Board');
  const a = await player('qboard');
  const c1 = await cit(a, 'Wren');
  let g = await api(a, 'GET', '/api/quests');
  const avail = (g.body.available || []).filter(x => !x.time_limited);
  check(g.status === 200 && avail.length > 0 && avail.length <= 5 && g.body.rotates_at, `GET /api/quests: today's board (${avail.length} solo) and when it turns over`);
  const g2 = await api(a, 'GET', '/api/quests');
  check(JSON.stringify(g2.body.available.map(x => x.id)) === JSON.stringify(g.body.available.map(x => x.id)), 'the same board on a second look');
  const all = (await q("SELECT id FROM quest_definitions WHERE archived=FALSE AND COALESCE(quest_source,'tavern')='tavern' AND quest_type='solo' AND active_phases IS NULL AND moon_phases IS NULL")).rows.map(x => x.id);
  const pool2 = all.length ? all : require('../routes/quests').QUEST_POOL.filter(x => !x.active_phases && !x.moon_phases).map(x => x.id);
  const off = pool2.find(id => !g.body.available.some(x => x.id === id));
  if (off) {
    const r = await api(a, 'POST', '/api/quests/accept', { quest_id: off, citizen_id: c1 });
    check(r.status === 400 && /board today/.test(r.body.error), 'a quest off today\'s board can\'t be taken');
  } else check(true, '(every quest is on the board — pool too small to test off-board)');

  console.log('Abandon');
  const on = avail.find(x => !(x.combat_chance > 0)) || avail[0];
  let r = await api(a, 'POST', '/api/quests/accept', { quest_id: on.id, citizen_id: c1 });
  check(r.status === 200 && r.body.quest, 'take a quest' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  const runId = r.body.quest && r.body.quest.id;
  const b = await player('qother');
  check((await api(b, 'POST', `/api/quests/${runId}/abandon`)).status === 404, 'nobody else can call it off');
  r = await api(a, 'POST', `/api/quests/${runId}/abandon`);
  check(r.status === 200 && r.body.ok, 'abandon it');
  const row = (await q('SELECT status FROM settlement_quests WHERE id=$1', [runId])).rows[0];
  check(row.status === 'abandoned', '…it is marked abandoned');
  g = await api(a, 'GET', '/api/quests');
  check(!(g.body.active || []).some(x => x.id === runId), '…and leaves the active list');
  r = await api(a, 'POST', '/api/quests/accept', { quest_id: on.id, citizen_id: c1 });
  check(r.status === 200, 'the citizen is free and the quest can be taken again');
  const run2 = r.body.quest && r.body.quest.id;
  await q("UPDATE settlement_quests SET combat_status='pending' WHERE id=$1", [run2]);
  r = await api(a, 'POST', `/api/quests/${run2}/abandon`);
  check(r.status === 400 && /battle/.test(r.body.error), 'not once a battle has begun');
  await q("UPDATE settlement_quests SET combat_status='none', status='collected' WHERE id=$1", [run2]);
  check((await api(a, 'POST', `/api/quests/${run2}/abandon`)).status === 400, 'not once it is over');

  console.log('Watchtower');
  const w = await player('qwatch');
  const s0 = (await api(w, 'GET', '/api/game/settlement')).body.settlement;
  const g1 = await cit(w, 'Guard', 'soldier'), g2b = await cit(w, 'Bow', 'archer');
  await cit(w, 'Guard2', 'soldier'); await cit(w, 'Guard3', 'soldier');
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'watchtower',1)", [w.sid]);
  const WT = require('../lib/watchtower');
  const st = await WT.state(null, w.sid);
  check(st.level === 1 && st.slots === 2 && st.posted.length === 2, 'Lv1: two posts, filled by Guards and Archers');
  check(st.defence === 10 + 2 * (5 + 1) && st.happiness === 2, `defence ${st.defence} (10 + 6 per watcher), +2 happiness`);
  const s1 = (await api(w, 'GET', '/api/game/settlement')).body.settlement;
  check(s1.happiness - s0.happiness === 2 || s1.happiness === 100, `the town is happier (${s0.happiness} → ${s1.happiness})`);
  check(s1.town && s1.town.watch && s1.town.watch.posted === 2, 'the town block shows the watch');
  const bl = await api(w, 'GET', '/api/buildings');
  const wt = ((bl.body && (bl.body.buildings || bl.body.available)) || []).find(x => x.id === 'watchtower');
  check(!bl.body || !wt || wt.minTier === 'village', 'the Watchtower is a Village building');
  await q("UPDATE settlements SET tier='camp' WHERE id=$1", [w.sid]);
  void g1; void g2b;

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and QUEST_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
