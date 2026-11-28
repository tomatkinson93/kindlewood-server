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
    check(r.status === 200 && pg.cls === 'guard' && pg.label === 'Guard' && pg.level === 1 && pg.school.key === 'arms' && pg.school.name === 'Arms' && keys(pg.abilities) === 'g_shield' && pg.attack.key === 'g_strike' && pg.attack.attack === true
      && pg.abilities.every(x => x.known && x.school === 'arms') && keys(pg.ahead) === 'g_cover,g_shove,g_heavy,g_stand_fast,g_shield_bash,g_oath,g_hold_line,g_hammer' && pg.ahead[0].at === 2,
    'a new Guard: the school is Arms, Strike for an Attack, one ability known, and the eight still to learn with their levels', keys(pg.ahead || []));
    check(pg.abilities.concat(pg.ahead).every(x => x.name && x.desc && x.kind && (x.dmg || x.block || x.heal || Object.keys(x.fx).length)) && pg.second.max === 5 && pg.second.strength === 0.75 && pg.second.options.length === 0 && pg.second.cls === null,
      'each says what it does in her hands; with no other class behind her there is no second school');
    await setLevel(a, guard, 'soldier', 10);
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    check(pg.level === 10 && keys(pg.abilities) === 'g_shield,g_cover,g_shove,g_heavy,g_stand_fast,g_shield_bash' && pg.attack.key === 'g_strike' && pg.ahead.length === 3 && pg.second.busy === false, 'at level 10 she brings her Attack and all six abilities she knows: nothing is left at home');
    r = await api(a, 'GET', `/api/tactics/abilities/${wiz}`);
    check(keys(r.body.abilities) === 'w_spark,w_ward' && r.body.attack.key === 'v_knock' && r.body.attack.name === 'Knock' && r.body.attack.dmg < r.body.abilities[0].dmg && r.body.school.name === 'Wild magic', 'a Wizard has her Wild magic, and for an Attack only a feeble knock', `Knock ${r.body.attack.dmg}, Spark ${r.body.abilities[0].dmg}`);
    r = await api(a, 'GET', `/api/tactics/abilities/${farmer}`);
    check(r.status === 200 && r.body.cls === 'villager' && r.body.career === null && r.body.abilities.length === 2 && r.body.abilities.map(x => x.school).join() === 'basics,field' && r.body.attack.key === 'v_swing' && r.body.ahead.length === 0,
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
      && keys(opt('archer').abilities) === 'a_side,a_part,a_mark' && !keys(opt('hearthkeeper').abilities).includes('v_knock'), 'the page offers each other class she has levels in, the furthest along first, with what it taught her');
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
    r = await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'archer', keys: ['a_side', 'a_mark'] });
    check(r.status === 200 && r.body.second.cls === 'archer' && keys(r.body.second.options.find(o => o.cls === 'archer').abilities.filter(x => x.ready)) === 'a_side,a_mark' && r.body.second.options[0].abilities.every(x => !x.ready),
      'or changes to another of her old classes: one second school at a time');
    check((await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'hearthkeeper', keys: ['h_rekindle'] })).status === 400, 'one that class has not taught her yet cannot be brought');
    check((await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'hearthkeeper', keys: ['h_cinder', 'h_kindle', 'h_ward', 'h_bold', 'h_steady', 'h_banish'] })).status === 400
      && (await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'hearthkeeper', keys: [] })).status === 400, 'nor six, nor none without saying so');
    check((await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'wizard', keys: ['w_spark'] })).status === 400 && (await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'guard', keys: ['g_shield'] })).status === 400
      && (await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'archer', keys: ['a_shoot'] })).status === 400
      && (await api(b, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'archer', keys: ['a_side'] })).status === 404, 'nor from a class she has never been, nor her own, nor another class\'s Attack, nor by another town');
    check(keys((await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body.second.options.find(o => o.cls === 'archer').abilities.filter(x => x.ready)) === 'a_side,a_mark', 'a refused choice changes nothing');
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
    check(w.abilities.map(x => x.key).join() === 'v_knock,w_spark,w_ward,w_bolt,w_chill' && w.abilities[0].attack === true && g.abilities[0].attack === true && g.abilities.filter(x => x.attack).length === 1 && w.second === null && w.next.key === 'w_burst' && v.abilities.map(x => x.school).join() === 'basics,basics,field',
      'the Wizard at level 4 brings her Attack (a knock) and all four she knows; a villager their three');
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    check(pg.second.busy === true && (await api(a, 'POST', `/api/tactics/abilities/${guard}/second`, { cls: 'archer', keys: ['a_side'] })).status === 400, 'abilities are chosen at home: not from inside a dungeon');
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
    check(pg.cls === 'villager' && pg.second.cls === 'guard' && keys(pg.second.options[0].abilities.filter(x => x.ready)) === 'g_shield,g_cover,g_shove', 'a villager who has trained as a Guard brings Arms as their second school');

    console.log('Mastery: an ability used enough in battle');
    const MA = require('../lib/tactics_mastery'), E = require('../lib/tactics_engine'), T = require('../lib/tactics_setup');
    check(MA.USES === 25 && MA.EDGE === 1.2, 'twenty-five uses master an ability; mastered, it is a fifth stronger');
    const stub = { maxHp: 40, armour: 0, agility: 8, strength: 12, endurance: 8, intelligence: 8, charisma: 8, combatSkill: 3 };
    const plain = T.abilityOf(T.KITS.guard.abilities[0], stub), star = T.abilityOf(T.KITS.guard.abilities[0], stub, { star: true }), both = T.abilityOf(T.KITS.guard.abilities[0], stub, { off: true, star: true });
    check(star.dmg === Math.round(plain.dmg * 1.2) && star.star === true && !plain.star && both.dmg === Math.round(Math.max(1, Math.round(plain.dmg * 0.75)) * 1.2) && star.cooldown === plain.cooldown && star.max === plain.max,
      'the edge is on its numbers only, and on top of the second school\'s three-quarters', `${plain.dmg} → ${star.dmg}; brought ${both.dmg}`);
    // One use short of mastering everything she brings; then a fight, played by the rules' own mind through the routes.
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    const everything = p2 => [p2.attack].concat(p2.abilities, ...p2.second.options.map(o => o.abilities));
    check(pg.mastery.uses === 25 && pg.mastery.edge === 1.2 && everything(pg).every(x => x.used === 0 && x.star === false) && pg.attack.uses === null && pg.attack.used === 0
      && pg.second.options.find(o => o.cls === 'hearthkeeper').abilities.find(x => x.key === 'h_kindle').uses === 2, 'the page says how many times each ability has been used in battle (none yet), and keeps an ability\'s own limit of times a battle');
    for (const x of everything(pg)) await q(`INSERT INTO citizen_ability_uses (citizen_id, ability_key, uses) VALUES ($1,$2,24) ON CONFLICT (citizen_id, ability_key) DO UPDATE SET uses = 24`, [guard, x.key]);
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    const was = Object.fromEntries(everything(pg).map(x => [x.key, x]));
    check(everything(pg).every(x => x.used === 24 && x.star === false), 'twenty-four uses is not yet mastery');
    await D.startTest(a.id, 'test_green', [guard, c4, c5]);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const bid = r.body.board_battle_id;
    let bt2 = (await api(a, 'GET', '/api/tactics/battles/' + bid)).body.battle, last = null;
    const st = E.replay(bt2.setup, bt2.actions).state;
    let n = bt2.count;
    // Every played battle begins with the party being placed; the bot keeps the places it was given.
    if (st.status === 'placing') { E.apply(st, { t: 'place', at: {} }); last = await api(a, 'POST', `/api/tactics/battles/${bid}/act`, { n: n++, action: { t: 'place', at: {} } }); }
    for (let g = 0; g < 500 && st.status === 'active'; g++) {
      const u = E.current(st), keep = st.r, plan = E.plan(st); st.r = keep;
      const acts = [];
      if (plan && plan.to && (plan.to.x !== u.x || plan.to.y !== u.y)) acts.push({ t: 'move', x: plan.to.x, y: plan.to.y });
      if (plan && plan.ability) acts.push({ t: 'use', key: plan.ability, x: plan.x, y: plan.y });
      acts.push({ t: 'end' });
      for (const act of acts) { if (st.status !== 'active' || !E.apply(st, act)) continue; last = await api(a, 'POST', `/api/tactics/battles/${bid}/act`, { n: n++, action: act }); }
    }
    bt2 = (await api(a, 'GET', '/api/tactics/battles/' + bid)).body.battle;
    const used = MA.usesIn(bt2.setup, bt2.actions), mine = used[guard] || {};
    const rowsU = (await q('SELECT citizen_id, ability_key, uses FROM citizen_ability_uses WHERE citizen_id = ANY($1::int[])', [[guard, c4, c5]])).rows;
    const stored = (cid, key) => (rowsU.find(x => x.citizen_id === cid && x.ability_key === key) || {}).uses || 0;
    const hers = Object.keys(mine);
    check(st.status !== 'active' && hers.length >= 1 && Object.keys(used).every(cid => Object.keys(used[cid]).every(key => stored(Number(cid), key) === used[cid][key] + (Number(cid) === guard ? 24 : 0))),
      'every use of an ability in a kept battle is counted for the citizen who used it', JSON.stringify(used));
    const told = (last.body.mastered || []).filter(m => m.citizen_id === guard), onRow = ((last.body.rewards || {}).party || []).find(x => x.citizen_id === guard);
    check(told.map(m => m.key).sort().join() === hers.slice().sort().join() && told.every(m => m.name && m.icon && m.name === was[m.key].name) && (!onRow || (onRow.mastered || []).length === hers.length) && hers.every(k => bt2.result.mastered.some(m => m.key === k))
      && !(last.body.mastered || []).some(m => m.citizen_id !== guard),
      'the battle that takes her past twenty-five says what she has mastered, on her row and in the battle\'s record; nobody else has', told.map(m => m.name).join(', '));
    pg = (await api(a, 'GET', `/api/tactics/abilities/${guard}`)).body;
    const now = Object.fromEntries(everything(pg).map(x => [x.key, x])), num = x => x.dmg || x.heal || x.block || 0;
    check(hers.every(k => now[k].star === true && now[k].used === 25 && num(now[k]) === Math.round(num(was[k]) * 1.2)) && Object.keys(now).filter(k => !hers.includes(k)).every(k => !now[k].star && num(now[k]) === num(was[k])),
      'her page shows them mastered and a fifth stronger; what she did not use is as it was', hers.map(k => `${now[k].name} ${num(was[k])} → ${num(now[k])}`).join(', '));
    // The run goes on: the next fight has it.
    let run = (await api(a, 'GET', '/api/dungeons/run')).body.run;
    if (run && run.status === 'active' && run.moves.length) {
      r = await api(a, 'POST', '/api/dungeons/run/move', { room: run.moves[0] });
      const next = r.body.board_battle_id ? (await api(a, 'GET', '/api/tactics/battles/' + r.body.board_battle_id)).body.battle : null;
      const g2 = next && next.setup.party.find(u => u.citizen_id === guard);
      check(!next || g2.abilities.every(x => !!x.star === hers.includes(x.key) && (!hers.includes(x.key) || num(x) === num(now[x.key]))), 'and she takes it into the next fight');
    }
    await api(a, 'POST', '/api/dungeons/run/flee'); await api(a, 'POST', '/api/dungeons/run/leave');
    const again = await MA.record(bt2.setup, bt2.actions);
    check(again.length === 0, 'an ability is mastered once');

    console.log('Gear on the page');
    pg = (await api(a, 'GET', `/api/tactics/abilities/${wiz}`)).body;
    const sparkBare = pg.abilities.find(x => x.key === 'w_spark').dmg;
    check(pg.gear === null && pg.kinds.length === 8 && pg.kinds.find(k => k.key === 'staff').hands === 2 && pg.kinds.find(k => k.key === 'lantern').hands === 1 && pg.kinds.every(k => k.name && k.says) && pg.move === 3, 'the page says what she carries (nothing yet) and what each kind of weapon does');
    await q(`INSERT INTO inventory_items (settlement_id, item_key, name, icon, category, rarity, quantity, equip_slot, stat_bonuses, equipped_to, metadata)
             VALUES ($1,'oak_staff','Oak Staff','🪄','equipment','common',1,'weapon','{}',$2,'{}')`, [a.sid, wiz]);
    pg = (await api(a, 'GET', `/api/tactics/abilities/${wiz}`)).body;
    check(pg.gear && pg.gear.weapon.kind === 'staff' && pg.gear.weapon.kind_name === 'Staff' && /a fifth stronger/.test(pg.gear.weapon.says) && pg.abilities.find(x => x.key === 'w_spark').dmg === Math.round(sparkBare * 1.2)
      && pg.attack.key === 'v_knock' && pg.gear.weapon.hands === 2, 'with a staff in hand the page shows it, and her Wild magic a fifth stronger', `Spark ${sparkBare} → ${pg.abilities.find(x => x.key === 'w_spark').dmg}`);
  } finally { await TU.setSwitch('dungeons.on', wasOn); await pool.end(); }
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(no DATABASE_URL: skipped)'); process.exit(0); }
  try { await main(); } catch (e) { console.error(e); check(false, 'crashed: ' + e.message); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
