// Knowing and readying (docs/TACTICS.md §6; lib/tactics_abilities.js): what a
// citizen has learned in their class, and which five they bring to a battle.
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 node scripts/tactics_abilities_test.js
'use strict';
const jwt = require('jsonwebtoken');
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

async function main() {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const D = require('../lib/dungeons');
  const TU = require('../lib/tuning');
  const M = require('../lib/career_math');
  const RUN = Date.now().toString(36);
  let seq = 0;
  // A town with a Guard, a Wizard, a farmer, a child and three more grown-ups.
  async function player(name) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',1000,1000,1000,1000,1000,$3,0,NOW()) RETURNING id`, [u.id, username, 19000 + (Date.now() % 100000) + seq * 40])).rows[0];
    const roles = ['soldier', 'wizard', 'farmer', 'idle', 'idle', 'idle', 'idle'], cits = [];
    for (let i = 0; i < roles.length; i++) cits.push((await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage) VALUES ($1,$2,'female',$3,$4,$5,$6) RETURNING id`,
      [s.id, `${name}${i}${RUN}`, roles[i], JSON.stringify({ strength: 20, agility: 14, endurance: 18, intelligence: 16, charisma: 10 }), JSON.stringify({ combat: 6 }), i === 3 ? 'child' : 'adult'])).rows[0].id);
    return { id: u.id, sid: s.id, cits, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const setLevel = (p, cid, cls, level) => q(
    `INSERT INTO citizen_classes (citizen_id, settlement_id, class_key, xp, level) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (citizen_id, class_key) DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level`, [cid, p.sid, cls, M.xpForLevel(level), level]);
  const wasOn = await TU.switchOn('dungeons.on');
  try {
    console.log('What a citizen knows');
    await TU.setSwitch('dungeons.on', false);
    const a = await player('Know');
    const [guard, wiz, farmer, child, c4, c5] = a.cits;
    check((await api(a, 'GET', `/api/tactics/abilities/${guard}`)).status === 200, 'the Abilities page is every player\'s, whether or not dungeons are open: every battle is fought on the board');
    await TU.setSwitch('dungeons.on', true);
    let r = await api(a, 'GET', `/api/tactics/abilities/${guard}`);
    let pg = r.body;
    const keys = (p, f) => p.abilities.filter(f).map(x => x.key).join();
    check(r.status === 200 && pg.cls === 'guard' && pg.label === 'Guard' && pg.level === 1 && pg.max === 5 && pg.abilities.length === 10 && keys(pg, x => x.known) === 'g_strike,g_shield' && keys(pg, x => x.ready) === 'g_strike,g_shield'
      && pg.can_choose === false, 'a new Guard: ten abilities on the ladder, two known and brought, nothing to choose yet');
    check(pg.abilities.map(x => x.at).join() === '1,1,2,4,6,8,10,13,16,20' && pg.abilities.every(x => x.name && x.desc && x.kind && (x.dmg || x.block || x.heal || Object.keys(x.fx).length)) && pg.abilities[4].dmg > pg.abilities[0].dmg,
      'each is listed in the order learned, with the level that brings it and what it does in this citizen\'s hands', pg.abilities.map(x => `${x.name} (${x.at})`).join(', '));
    await setLevel(a, guard, 'soldier', 10);
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    check(pg.level === 10 && keys(pg, x => x.known).split(',').length === 7 && keys(pg, x => x.ready) === 'g_strike,g_shield,g_cover,g_shove,g_heavy' && pg.can_choose === true && pg.busy === false && pg.xp.need > 0,
      'at class level 10 a Guard knows seven: the first five are brought until the player chooses, and now there is a choice');
    r = await api(a, 'GET', `/api/tactics/abilities/${farmer}`);
    check(r.status === 200 && r.body.cls === 'villager' && r.body.career === null && r.body.abilities.length === 3 && r.body.abilities.every(x => x.known && x.ready) && r.body.can_choose === false,
      'someone with no class fights with a villager\'s three, their trade\'s among them, and has nothing to choose', r.body.abilities.map(x => x.name).join(', '));
    check((await api(a, 'GET', `/api/tactics/abilities/${child}`)).status === 400, 'a child has no abilities page');
    const b = await player('Other');
    check((await api(b, 'GET', `/api/tactics/abilities/${guard}`)).status === 404 && (await api(a, 'GET', '/api/tactics/abilities/abc')).status === 404, 'another town\'s citizen, or no citizen, is not found');

    console.log('Choosing five to bring');
    const want = ['g_strike', 'g_cover', 'g_heavy', 'g_stand_fast', 'g_shield_bash'];
    r = await api(a, 'POST', `/api/tactics/abilities/${guard}/ready`, { keys: want });
    check(r.status === 200 && keys(r.body, x => x.ready) === want.join() && (await q('SELECT ready FROM citizen_classes WHERE citizen_id=$1 AND class_key=$2', [guard, 'soldier'])).rows[0].ready.join() === want.join(),
      'five of what they know are chosen, and kept');
    check((await api(a, 'POST', `/api/tactics/abilities/${guard}/ready`, { keys: ['g_strike', 'g_cover', 'g_heavy', 'g_stand_fast', 'g_hammer'] })).status === 400, 'one they have not learned yet cannot be chosen');
    check((await api(a, 'POST', `/api/tactics/abilities/${guard}/ready`, { keys: want.slice(0, 4) })).status === 400 && (await api(a, 'POST', `/api/tactics/abilities/${guard}/ready`, { keys: want.concat('g_shield') })).status === 400
      && (await api(a, 'POST', `/api/tactics/abilities/${guard}/ready`, { keys: ['g_strike', 'g_strike', 'g_cover', 'g_heavy', 'g_shove'] })).status === 400 && (await api(a, 'POST', `/api/tactics/abilities/${guard}/ready`, {})).status === 400,
      'four, six, one named twice or none at all are refused: five go');
    check((await api(a, 'POST', `/api/tactics/abilities/${farmer}/ready`, { keys: ['v_swing'] })).status === 400 && (await api(b, 'POST', `/api/tactics/abilities/${guard}/ready`, { keys: want })).status === 404, 'a villager has nothing to choose, and nobody chooses for another town');
    check(keys((await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body, x => x.ready) === want.join(), 'a refused choice changes nothing');

    console.log('Into battle');
    await setLevel(a, wiz, 'wizard', 4);
    await D.startTest(a.id, 'test_green', [guard, wiz, c4, c5]);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const bt = (await api(a, 'GET', '/api/tactics/battles/' + r.body.board_battle_id)).body.battle;
    const g = bt.setup.party.find(u => u.citizen_id === guard), w = bt.setup.party.find(u => u.citizen_id === wiz);
    check(g.abilities.map(x => x.key).join() === want.join() && g.spare === 2 && g.locked.length === 0 && g.next.key === 'g_oath', 'in a dungeon the Guard fights with the five she readied; two wait at home, and the next to learn is named', g.abilities.map(x => x.name).join(', '));
    check(w.abilities.map(x => x.key).join() === 'w_spark,w_ward,w_bolt,w_chill' && w.locked.map(x => x.key).join() === 'w_burst' && w.spare === 0, 'the Wizard at level 4 brings all four she knows, and the row shows the one to come');
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    check(pg.busy === true && (await api(a, 'POST', `/api/tactics/abilities/${guard}/ready`, { keys: ['g_strike', 'g_shield', 'g_cover', 'g_shove', 'g_heavy'] })).status === 400, 'abilities are readied at home: not from inside a dungeon');
    // A fight won at level 7 that carries her to 8 teaches Stand Fast, which waits at home.
    await api(a, 'POST', '/api/dungeons/run/flee');
    const XP = require('../lib/tactics_xp');
    await q('UPDATE citizen_classes SET xp=$3, level=7, ready=NULL WHERE citizen_id=$1 AND class_key=$2', [guard, 'soldier', M.xpForLevel(8) - 5]);
    const rows = await XP.award(a.sid, [{ citizen_id: guard, cls: 'guard' }], 40);
    check(rows.length === 1 && rows[0].after.level === 8 && rows[0].learned.map(x => `${x.key}:${x.spare}`).join() === 'g_stand_fast:true', 'a level that teaches a sixth ability says so, and that it waits to be readied', JSON.stringify(rows[0] && rows[0].learned));
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    check(pg.level === 8 && pg.can_choose === true && keys(pg, x => x.known && !x.ready) === 'g_stand_fast', 'and the page shows it known and not brought');
  } finally { await TU.setSwitch('dungeons.on', wasOn); await pool.end(); }
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(no DATABASE_URL: skipped)'); process.exit(0); }
  try { await main(); } catch (e) { console.error(e); check(false, 'crashed: ' + e.message); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
