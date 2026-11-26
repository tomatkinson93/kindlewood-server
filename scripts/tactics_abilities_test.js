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
    const a = await player('Know'), b = await player('Other');
    const [guard, wiz, farmer, child, c4, c5] = a.cits;
    check((await api(a, 'GET', `/api/tactics/abilities/${guard}`)).status === 200, 'the Abilities page is every player\'s, whether or not dungeons are open: every battle is fought on the board');
    await TU.setSwitch('dungeons.on', true);
    let r = await api(a, 'GET', `/api/tactics/abilities/${guard}`);
    let pg = r.body;
    const keys = list => list.map(x => x.key).join();
    check(r.status === 200 && pg.cls === 'guard' && pg.label === 'Guard' && pg.level === 1 && pg.school.key === 'arms' && pg.school.name === 'Arms' && keys(pg.abilities) === 'g_strike,g_shield'
      && pg.abilities.every(x => x.known && x.school === 'arms') && keys(pg.ahead) === 'g_cover,g_shove,g_heavy,g_stand_fast,g_shield_bash,g_oath,g_hold_line,g_hammer' && pg.ahead[0].at === 2,
    'a new Guard: the school is Arms, two abilities known, and the eight still to learn with their levels', keys(pg.ahead || []));
    check(pg.abilities.concat(pg.ahead).every(x => x.name && x.desc && x.kind && (x.dmg || x.block || x.heal || Object.keys(x.fx).length)) && pg.second.max === 5 && pg.second.strength === 0.75 && pg.second.options.length === 0 && pg.second.cls === null,
      'each says what it does in her hands; with no other class behind her there is no second school');
    await setLevel(a, guard, 'soldier', 10);
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    check(pg.level === 10 && keys(pg.abilities) === 'g_strike,g_shield,g_cover,g_shove,g_heavy,g_stand_fast,g_shield_bash' && pg.ahead.length === 3 && pg.second.busy === false, 'at level 10 she brings all seven she knows: nothing is left at home');
    r = await api(a, 'GET', `/api/tactics/abilities/${wiz}`);
    check(keys(r.body.abilities) === 'v_swing,w_spark,w_ward' && r.body.abilities[0].school === 'basics' && r.body.school.name === 'Wild magic', 'a Wizard has the plain blow of Basics and her Wild magic');
    r = await api(a, 'GET', `/api/tactics/abilities/${farmer}`);
    check(r.status === 200 && r.body.cls === 'villager' && r.body.career === null && r.body.abilities.length === 3 && r.body.abilities.map(x => x.school).join() === 'basics,basics,field' && r.body.ahead.length === 0,
      'a villager has Basics and their trade\'s trick');
    check((await api(a, 'GET', `/api/tactics/abilities/${child}`)).status === 400, 'a child has no abilities page');
    check((await api(b, 'GET', `/api/tactics/abilities/${guard}`)).status === 404 && (await api(a, 'GET', '/api/tactics/abilities/abc')).status === 404, 'another town\'s citizen, or no citizen, is not found');

    console.log('A second school: abilities from an old career');
    // She was a Hearthkeeper to level 10 and an Archer to level 4 before she took up the shield.
    await setLevel(a, guard, 'hearthkeeper', 10);
    await setLevel(a, guard, 'archer', 4);
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    const opt = c => pg.second.options.find(o => o.cls === c);
    check(pg.second.options.map(o => `${o.cls}:${o.level}`).join() === 'hearthkeeper:10,archer:4' && opt('hearthkeeper').school.name === 'Hearth magic' && keys(opt('hearthkeeper').abilities) === 'h_cinder,h_kindle,h_ward,h_bold,h_steady,h_ember_ward,h_banish'
      && keys(opt('archer').abilities) === 'a_shoot,a_side,a_part,a_mark', 'the page offers each other class she has levels in, the furthest along first, with what it taught her');
    check(pg.second.cls === 'hearthkeeper' && pg.second.chosen === null && keys(opt('hearthkeeper').abilities.filter(x => x.ready)) === 'h_cinder,h_kindle,h_ward,h_bold,h_steady' && opt('archer').abilities.every(x => !x.ready),
      'with nothing chosen she brings the first five of the class she is furthest along in');
    const hk = (await api(a, 'GET', `/api/tactics/abilities/${wiz}`)).body;
    await setLevel(a, wiz, 'hearthkeeper', 1);
    check(opt('hearthkeeper').abilities.every(x => x.off === true) && opt('hearthkeeper').abilities.find(x => x.key === 'h_kindle').heal > 0 && hk.second.options.length === 0, 'they are shown at the three-quarter strength they will have');
    const want = ['h_kindle', 'h_banish', 'h_ward'];
    r = await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'hearthkeeper', keys: want });
    const saved = (await q('SELECT second_class, second_ready FROM citizens WHERE id=$1', [guard])).rows[0];
    check(r.status === 200 && r.body.second.cls === 'hearthkeeper' && r.body.second.chosen === 'hearthkeeper' && keys(r.body.second.options[0].abilities.filter(x => x.ready)) === 'h_kindle,h_ward,h_banish'
      && saved.second_class === 'hearthkeeper' && saved.second_ready.join() === want.join(), 'she chooses which to bring: up to five, kept on the citizen', r.body.error);
    r = await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'archer', keys: ['a_shoot', 'a_mark'] });
    check(r.status === 200 && r.body.second.cls === 'archer' && keys(r.body.second.options.find(o => o.cls === 'archer').abilities.filter(x => x.ready)) === 'a_shoot,a_mark' && r.body.second.options[0].abilities.every(x => !x.ready),
      'or changes to another of her old classes: one second school at a time');
    check((await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'hearthkeeper', keys: ['h_rekindle'] })).status === 400, 'one that class has not taught her yet cannot be brought');
    check((await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'hearthkeeper', keys: ['h_cinder', 'h_kindle', 'h_ward', 'h_bold', 'h_steady', 'h_banish'] })).status === 400
      && (await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'hearthkeeper', keys: [] })).status === 400, 'nor six, nor none without saying so');
    check((await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'wizard', keys: ['w_spark'] })).status === 400 && (await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'guard', keys: ['g_strike'] })).status === 400
      && (await api(b, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'archer', keys: ['a_shoot'] })).status === 404, 'nor from a class she has never been, nor her own, nor by another town');
    check(keys((await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body.second.options.find(o => o.cls === 'archer').abilities.filter(x => x.ready)) === 'a_shoot,a_mark', 'a refused choice changes nothing');
    r = await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'none' });
    check(r.status === 200 && r.body.second.cls === null && r.body.second.chosen === 'none' && r.body.second.options.length === 2 && r.body.second.options.every(o => o.abilities.every(x => !x.ready)), 'she can bring nothing from another class');
    await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'hearthkeeper', keys: want });

    console.log('Into battle');
    await setLevel(a, wiz, 'wizard', 4);
    await D.startTest(a.id, 'test_green', [guard, wiz, c4, c5]);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const bt = (await api(a, 'GET', '/api/tactics/battles/' + r.body.board_battle_id)).body.battle;
    const g = bt.setup.party.find(u => u.citizen_id === guard), w = bt.setup.party.find(u => u.citizen_id === wiz), v = bt.setup.party.find(u => u.citizen_id === c4);
    check(g.abilities.map(x => x.key + (x.off ? '*' : '')).join() === 'g_strike,g_shield,g_cover,g_shove,g_heavy,g_stand_fast,g_shield_bash,h_kindle*,h_ward*,h_banish*' && g.school === 'arms' && g.second.cls === 'hearthkeeper' && g.second.school === 'hearth'
      && g.next.key === 'g_oath', 'in a dungeon the Guard fights with all seven of her own and the three she chose from her second school');
    const pgK = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body.second.options[0].abilities.find(x => x.key === 'h_kindle');
    check(g.abilities.find(x => x.key === 'h_kindle').heal === pgK.heal && g.abilities.find(x => x.key === 'h_kindle').off === true, 'the page and the board agree on what a brought ability does');
    check(w.abilities.map(x => x.key).join() === 'v_swing,w_spark,w_ward,w_bolt,w_chill' && w.second === null && w.next.key === 'w_burst' && v.abilities.map(x => x.school).join() === 'basics,basics,field',
      'the Wizard at level 4 brings Swing and all four she knows; a villager their three');
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    check(pg.second.busy === true && (await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'archer', keys: ['a_shoot'] })).status === 400, 'abilities are chosen at home: not from inside a dungeon');
    // A fight won at level 7 that carries her to 8 teaches Stand Fast, and it comes to the next battle.
    await api(a, 'POST', '/api/dungeons/run/flee');
    const XP = require('../lib/tactics_xp');
    await q('UPDATE citizen_classes SET xp=$3, level=7 WHERE citizen_id=$1 AND class_key=$2', [guard, 'soldier', M.xpForLevel(8) - 5]);
    const rows = await XP.award(a.sid, [{ citizen_id: guard, cls: 'guard' }], 40);
    check(rows.length === 1 && rows[0].after.level === 8 && rows[0].learned.map(x => `${x.key}:${x.spare}`).join() === 'g_stand_fast:false', 'a level that teaches an ability says so, and nothing waits at home');
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    check(pg.level === 8 && keys(pg.abilities).endsWith('g_heavy,g_stand_fast') && pg.ahead[0].key === 'g_shield_bash', 'and the page shows it among what she brings');
    // A villager who has fought has Guard levels (battle pays them as Guard training): Arms is their second school.
    await setLevel(a, farmer, 'soldier', 4);
    pg = (await api(a, 'GET', `/api/tactics/abilities/${farmer}`)).body;
    check(pg.cls === 'villager' && pg.second.cls === 'guard' && keys(pg.second.options[0].abilities.filter(x => x.ready)) === 'g_strike,g_shield,g_cover,g_shove', 'a villager who has trained as a Guard brings Arms as their second school');
  } finally { await TU.setSwitch('dungeons.on', wasOn); await pool.end(); }
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(no DATABASE_URL: skipped)'); process.exit(0); }
  try { await main(); } catch (e) { console.error(e); check(false, 'crashed: ' + e.message); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
