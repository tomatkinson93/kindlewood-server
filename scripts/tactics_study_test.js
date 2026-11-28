// Study at a class building, and the passive slot (docs/TACTICS.md §6, stage
// D; lib/tactics_study.js): extra abilities and passives, each for hours and
// a fee, with a class level, a building level and a seat; one passive at a
// time; Brace and Counter on the board.
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 node scripts/tactics_study_test.js
'use strict';
const jwt = require('jsonwebtoken');
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const T = require('../lib/tactics_setup'), S = require('../lib/tactics_study'), E = require('../lib/tactics_engine'), CC = require('../lib/class_abilities');

function pure() {
  console.log('What the buildings teach');
  const all = Object.values(S.LESSONS), abil = all.filter(l => l.kind === 'ability'), pas = all.filter(l => l.kind === 'passive');
  check(abil.length === 8 && pas.length === 10 && ['arms', 'archery', 'wild', 'hearth'].every(sc => abil.filter(l => l.school === sc).length === 2 && pas.filter(l => l.school === sc).length === 2) && pas.filter(l => l.school === null).length === 2,
    'two extra abilities and two passives for each school, and two passives any fighter can learn');
  const stub = { maxHp: 60, armour: 0, agility: 12, strength: 12, endurance: 10, intelligence: 12, charisma: 8, combatSkill: 4 };
  check(abil.every(l => CC.ability(l.key) && l.name && l.says && l.kit.key === l.key && (a => a.school === l.school && (a.dmg || a.heal || a.block || Object.keys(a.fx).length))(T.abilityOf({ ...l.kit, school: l.school }, stub, { school: l.school }))),
    'every extra ability is in the catalogue, in its school, and does something on the board');
  check(all.every(l => S.TIERS[l.tier] && l.level >= 1 && l.building >= 1 && l.building <= 3) && S.TIERS[1].hours === 2 && S.TIERS[1].wealth === 50 && S.TIERS[2].hours === 6 && S.TIERS[2].wealth === 150 && S.TIERS[3].hours === 12 && S.TIERS[3].wealth === 400
    && pas.every(l => l.name && l.icon && l.says) && ['brace', 'counter', 'sure_footed'].every(k => S.LESSONS[k].kind === 'passive'),
  'a lesson takes 2, 6 or 12 hours and 50, 150 or 400 wealth; Brace, Counter and Sure-footed are among the passives');
  check(S.BUILDING.guard === 'watchtower' && S.BUILDING.archer === 'watchtower' && S.BUILDING.wizard === 'wizard_tower' && S.BUILDING.hearthkeeper === 'hearth_shrine' && S.BUILDING.villager === undefined,
    'a Guard and an Archer study at the Watchtower, a Wizard at the Wizard\'s Tower, a Hearthkeeper at the Hearth Shrine; a villager nowhere');

  console.log('Into battle');
  const mk = (cls, lvl, more, second) => T.partyUnit({ id: 1, name: 'x', role: 'idle', unit: { ...stub } }, cls, null, null, lvl, second || null, null, more || null);
  const keys = u => u.abilities.map(a => a.key + (a.off ? '*' : '')).join(), ab = (u, k) => u.abilities.find(a => a.key === k);
  const g = mk('guard', 3, { lessons: new Set(['c_second_wind', 'c_cleave', 'a_venom']) });
  check(keys(g) === 'g_strike,g_shield,g_cover,c_second_wind,c_cleave' && ab(g, 'c_cleave').school === 'arms' && ab(g, 'c_second_wind').heal > 0 && ab(g, 'c_second_wind').uses === 1 && ab(g, 'c_cleave').shape === 'around',
    'an extra ability learned in one\'s own school comes to every battle, after what the levels taught; one of another school does not', keys(g));
  const two = mk('guard', 2, { lessons: new Set(['h_mend', 'h_brand']) }, { cls: 'hearthkeeper', level: 2, keys: ['h_mend', 'h_kindle'] });
  check(keys(two) === 'g_strike,g_shield,g_cover,h_kindle*,h_mend*' && ab(two, 'h_mend').school === 'hearth' && ab(two, 'h_mend').off === true
    && T.secondKits({ cls: 'hearthkeeper', level: 2, keys: null }, 'guard', new Set(['h_mend', 'h_brand'])).map(k => k.key).join() === 'h_cinder,h_kindle,h_ward,h_brand,h_mend',
  'what was studied in an old class is among what that class taught: it can be one of the five brought', keys(two));
  const plain = mk('archer', 6), keen = mk('archer', 6, { passive: 'keen_eye' }), feet = mk('archer', 6, { passive: 'light_feet' }), sure = mk('archer', 6, { passive: 'sure_footed' });
  check(ab(keen, 'a_shoot').max === ab(plain, 'a_shoot').max + 1 && ab(keen, 'a_side').max === ab(plain, 'a_side').max && feet.move === plain.move + 1 && sure.jump === plain.jump + 1 && feet.jump === plain.jump
    && keen.passive === 'keen_eye' && keen.passive_info.name === 'Keen Eye' && plain.passive === undefined, 'Keen Eye: Archery reaches a tile further. Light Feet: a tile more walked. Sure-footed: a step higher jumped');
  const wz = mk('wizard', 6), foc = mk('wizard', 6, { passive: 'focus' }), qh = mk('wizard', 6, { passive: 'quick_hands' });
  check(ab(foc, 'w_spark').dmg === Math.round(ab(wz, 'w_spark').dmg * 1.1) && ab(foc, 'v_knock').dmg === ab(wz, 'v_knock').dmg && wz.abilities.filter(a => a.cooldown >= 2).length > 0
    && wz.abilities.filter(a => a.school === 'wild').every(a => ab(qh, a.key).cooldown === (a.cooldown >= 2 ? a.cooldown - 1 : a.cooldown)), 'Focus: Wild magic a tenth stronger. Quick Hands: Wild magic ready a turn sooner');
  const hk = mk('hearthkeeper', 6), warm = mk('hearthkeeper', 6, { passive: 'warm_hands' }), deep = mk('hearthkeeper', 6, { passive: 'deep_embers' });
  check(ab(warm, 'h_kindle').heal === Math.round(ab(hk, 'h_kindle').heal * 1.15) && ab(warm, 'h_cinder').dmg === ab(hk, 'h_cinder').dmg && ab(deep, 'h_kindle').uses === ab(hk, 'h_kindle').uses + 1 && ab(deep, 'h_cinder').uses === null,
    'Warm Hands: healing 15% stronger. Deep Embers: one more use of what is counted a battle');
  check(mk('guard', 6, { passive: 'warm_hands' }, { cls: 'hearthkeeper', level: 2, keys: null }).abilities.find(a => a.key === 'h_kindle').heal > mk('guard', 6, null, { cls: 'hearthkeeper', level: 2, keys: null }).abilities.find(a => a.key === 'h_kindle').heal,
    'a passive is the citizen\'s, whatever class they are now: Warm Hands helps a Guard\'s borrowed healing');

  console.log('Brace and Counter on the board');
  // A Guard next to a dummy foe that hits; the party is quick, so the citizen acts, then the foe.
  const flat = { w: 6, h: 6, tiles: Array.from({ length: 36 }, () => ({ h: 0, t: 'grass' })) };
  const foeHit = { key: 'bite', name: 'Bite', icon: '•', kind: 'attack', target: 'enemy', min: 1, max: 1, shape: 'single', dmg: 30, block: 0, heal: 0, fx: {}, cooldown: 0, quick: false, uses: null };
  const battle = (passive, foes = 1, far = false) => {
    const unit = { ...mk('guard', 1, passive ? { passive } : null), agility: 99, maxHp: 400 };
    const enemies = Array.from({ length: foes }, (_, i) => ({ id: 'e' + i, key: 'dummy', name: 'Dummy' + i, cls: 'creature', maxHp: 300, armour: 0, agility: 1, move: 0, jump: 0, abilities: [far ? { ...foeHit, min: 1, max: 4 } : foeHit] }));
    const st = E.createBattle({ seed: 5, land: 'plains', map: flat, party: [unit], enemies });
    const me = st.units[0];
    me.x = 2; me.y = 3; me.face = 'n';
    st.units.slice(1).forEach((it, i) => { it.x = far ? 2 : [2, 1, 3][i]; it.y = far ? 0 : [2, 3, 3][i]; it.face = 's'; });
    return st;
  };
  const round = st => E.apply(st, { t: 'end', face: 'n' }) || [];     // the citizen ends their turn; the foes take theirs
  const hits = ev => ev.filter(x => x.type === 'hit');
  const bare = hits(round(battle(null, 2))), braced = hits(round(battle('brace', 2)));
  check(bare.length === 2 && braced.length === 2 && braced[0].dmg === Math.round(bare[0].dmg * 2 / 3) && braced[0].braced === true && braced[1].dmg === bare[1].dmg && !braced[1].braced,
    'Brace: the first hit of the round does a third less, the second its full weight', `${bare.map(h => h.dmg).join()} → ${braced.map(h => h.dmg).join()}`);
  const stB = battle('brace', 1), r1 = hits(round(stB)), r2 = hits(round(stB));
  check(r1[0].braced === true && r2[0].braced === true && stB.units[0].braced === false, 'and it is ready again each round');
  const stC = battle('counter', 2), evC = round(stC), back = evC.filter(x => x.type === 'hit' && x.counter), strike = stC.units[0].abilities.find(a => a.attack);
  const lone = E.createBattle({ seed: 5, land: 'plains', map: flat, party: [{ ...mk('guard', 1), agility: 99 }], enemies: [{ id: 'e0', key: 'd', name: 'D', cls: 'creature', maxHp: 300, armour: 0, agility: 1, move: 0, jump: 0, abilities: [] }] });
  lone.units[0].x = 2; lone.units[0].y = 3; lone.units[0].face = 'n'; lone.units[1].x = 2; lone.units[1].y = 2; lone.units[1].face = 's';
  const full = E.apply(lone, { t: 'use', key: 'g_strike', x: 2, y: 2 }).find(x => x.type === 'hit').dmg;
  check(evC.filter(x => x.type === 'counter').length === 1 && back.length === 1 && back[0].by === stC.units[0].id && back[0].dmg === Math.round(full / 2) && strike.key === 'g_strike' && hits(evC).filter(h => !h.counter).length === 2,
    'Counter: struck by a foe beside them, they strike back with their Attack at half strength, once a round', `a full Strike ${full}, the counter ${back[0] && back[0].dmg}`);
  check(round(stC).filter(x => x.type === 'counter').length === 1, 'and it is ready again each round');
  check(round(battle('counter', 1, true)).filter(x => x.type === 'counter').length === 0, 'a foe that strikes from a distance is not countered');
  const weak = battle('counter', 1); weak.units[1].hp = 3;
  const evW = round(weak);
  check(evW.some(x => x.type === 'counter') && weak.units[1].hp === 1 && !weak.units[1].down && weak.status === 'active', 'a counter never fells: the striker is left with 1');
  check(hits(round(battle(null, 1))).every(h => !h.counter && !h.braced) && E.RULES && E.RULES.BRACE === 2 / 3 && E.RULES.COUNTER === 0.5, 'with no passive nothing of the kind happens');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('\n(no DATABASE_URL: the rest skipped)'); return; }
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const M = require('../lib/career_math'), D = require('../lib/dungeons'), CR = require('../lib/combat_resolver');
  const RUN = Date.now().toString(36);
  let seq = 0;
  async function player(name, wealth = 1000) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',$3,1000,1000,1000,1000,$4,0,NOW()) RETURNING id`, [u.id, username, wealth, 29000 + (Date.now() % 100000) + seq * 40])).rows[0];
    const roles = ['soldier', 'soldier', 'archer', 'wizard', 'hearthkeeper', 'farmer', 'idle'], cits = [];
    for (let i = 0; i < roles.length; i++) cits.push((await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage) VALUES ($1,$2,'female',$3,$4,$5,'adult') RETURNING id`,
      [s.id, `${name}${i}${RUN}`, roles[i], JSON.stringify({ strength: 16, agility: 14, endurance: 14, intelligence: 14, charisma: 10 }), JSON.stringify({ combat: 5 })])).rows[0].id);
    return { id: u.id, sid: s.id, cits, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const setLevel = (p, cid, cls, level) => q(
    `INSERT INTO citizen_classes (citizen_id, settlement_id, class_key, xp, level) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (citizen_id, class_key) DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level`, [cid, p.sid, cls, M.xpForLevel(level), level]);
  const wealth = async p => Number((await q('SELECT wealth FROM settlements WHERE id=$1', [p.sid])).rows[0].wealth);
  const build = (p, type, level) => q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,$3)', [p.sid, type, level]);
  try {
    console.log('The Study page');
    const a = await player('Study'), b = await player('Other');
    const [g1, g2, arch, wiz, hk, farmer] = a.cits;
    let r = await api(a, 'GET', `/api/tactics/study/${g1}`), pg = r.body;
    const L = k => pg.lessons.find(x => x.key === k);
    check(r.status === 200 && pg.building.type === 'watchtower' && pg.building.name === 'Watchtower' && pg.building.level === 0 && pg.lessons.map(x => x.key).join() === 'c_second_wind,c_cleave,brace,counter,sure_footed,tough'
      && pg.lessons.every(x => x.state === 'locked') && /has no Watchtower/.test(L('brace').why) && pg.studying === null && pg.passive === null && pg.passives.length === 0,
    'a Guard is shown the Watchtower\'s lessons: Arms, and the two any fighter can learn; with no Watchtower none can be begun', pg.lessons && pg.lessons.map(x => x.key).join());
    check(L('brace').hours === 2 && L('brace').wealth === 50 && L('counter').hours === 6 && L('counter').wealth === 150 && L('c_cleave').need_level === 8 && L('c_cleave').need_building === 2 && L('brace').kind === 'passive' && L('c_cleave').kind === 'ability' && L('brace').says && L('brace').icon,
      'each lesson says what it is, how long it takes, what it costs and what it needs');
    r = await api(a, 'GET', `/api/tactics/study/${farmer}`);
    check(r.status === 200 && r.body.building === null && r.body.lessons.length === 0, 'a villager has nothing to study');
    check((await api(a, 'GET', `/api/tactics/study/${wiz}`)).body.lessons.map(x => x.key).join() === 'c_weaken,w_deep_freeze,focus,quick_hands,sure_footed,tough' && (await api(a, 'GET', `/api/tactics/study/${hk}`)).body.building.type === 'hearth_shrine'
      && (await api(a, 'GET', `/api/tactics/study/${arch}`)).body.lessons.map(x => x.key).join() === 'a_venom,c_expose,light_feet,keen_eye,sure_footed,tough', 'a Wizard is shown Wild magic at the Tower, an Archer Archery at the Watchtower, a Hearthkeeper the Shrine');
    check((await api(b, 'GET', `/api/tactics/study/${g1}`)).status === 404, 'another town\'s citizen is not found');

    console.log('Studying');
    await build(a, 'watchtower', 1);
    await setLevel(a, g1, 'soldier', 3); await setLevel(a, g2, 'soldier', 6);
    pg = (await api(a, 'GET', `/api/tactics/study/${g1}`)).body;
    check(pg.building.level === 1 && pg.building.seats === 1 && pg.building.used === 0 && L('brace').state === 'open' && L('c_second_wind').state === 'open' && L('sure_footed').state === 'open' && L('tough').state === 'locked' && /class level 4/.test(L('tough').why)
      && L('counter').state === 'locked' && /Watchtower at level 2/.test(L('counter').why), 'with a Watchtower at level 1 and class level 3: Brace, Second Wind and Sure-footed are open; the rest say what they need');
    const had = await wealth(a);
    r = await api(a, 'POST', `/api/tactics/study/${g1}`, { lesson: 'brace' });
    pg = r.body;
    let left = pg.studying ? (new Date(pg.studying.done_at) - Date.now()) / 3600e3 : 0;
    check(r.status === 200 && pg.studying.key === 'brace' && pg.studying.name === 'Brace' && Math.abs(left - 2) < 0.05 && (await wealth(a)) === had - 50 && pg.building.used === 1 && L('brace').state === 'studying' && L('c_second_wind').state === 'locked'
      && /Already studying/.test(L('c_second_wind').why), 'beginning a lesson takes the fee and a seat, and is done in two hours', r.body.error);
    r = await api(a, 'POST', `/api/tactics/study/${g2}`, { lesson: 'brace' });
    check(r.status === 400 && /Every seat at the Watchtower is taken/.test(r.body.error) && (await wealth(a)) === had - 50, 'a level 1 building has one seat: a second citizen must wait', r.body.error);
    check((await api(a, 'POST', `/api/tactics/study/${g1}`, { lesson: 'sure_footed' })).status === 400 && (await api(a, 'POST', `/api/tactics/study/${g1}`, { lesson: 'nonsense' })).status === 400
      && (await api(a, 'POST', `/api/tactics/study/${arch}`, { lesson: 'brace' })).status === 400 && (await api(a, 'POST', `/api/tactics/study/${farmer}`, { lesson: 'sure_footed' })).status === 400
      && (await api(b, 'POST', `/api/tactics/study/${g1}`, { lesson: 'sure_footed' })).status === 404, 'one lesson at a time; not one of another class; not a villager; not by another town');
    // The citizen carries on as normal: she can still be sent into a dungeon.
    check((await D.busyCitizenIds([g1])).length === 0, 'a citizen who is studying is not busy: she can still be sent out');
    r = await api(a, 'POST', `/api/tactics/study/${g1}/cancel`);
    check(r.status === 200 && r.body.studying === null && r.body.building.used === 0 && (await wealth(a)) === had && r.body.lessons.find(x => x.key === 'brace').state === 'open', 'stopping gives the seat and the fee back');
    r = await api(a, 'POST', `/api/tactics/study/${g1}`, { lesson: 'brace' });
    await q(`UPDATE citizen_study SET done_at = NOW() - interval '1 second' WHERE citizen_id=$1`, [g1]);
    pg = (await api(a, 'GET', `/api/tactics/study/${g1}`)).body;
    const news = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='study' ORDER BY id DESC LIMIT 1", [a.sid])).rows[0];
    check(pg.studying === null && L('brace').state === 'known' && pg.building.used === 0 && pg.passive === 'brace' && pg.passives.map(x => x.key).join() === 'brace' && news && /has finished studying Brace \(a passive\)/.test(news.message),
      'when the time is up the lesson is learned, the seat is free, the town is told, and a first passive goes into the empty slot', news && news.message);
    check((await api(a, 'POST', `/api/tactics/study/${g1}`, { lesson: 'brace' })).status === 400, 'what is known cannot be studied again');

    console.log('The passive slot, and into battle');
    await api(a, 'POST', `/api/tactics/study/${g1}`, { lesson: 'sure_footed' });
    await api(a, 'POST', `/api/tactics/admin/study/finish`);      // not an admin: refused
    await q(`UPDATE citizen_study SET done_at = NOW() - interval '1 second' WHERE citizen_id=$1`, [g1]);
    pg = (await api(a, 'GET', `/api/tactics/study/${g1}`)).body;
    check(pg.passives.map(x => x.key).join() === 'brace,sure_footed' && pg.passive === 'brace', 'a second passive is known, and the slot keeps the first');
    r = await api(a, 'POST', `/api/tactics/study/${g1}/passive`, { key: 'sure_footed' });
    check(r.status === 200 && r.body.passive === 'sure_footed', 'she chooses which passive to carry');
    check((await api(a, 'POST', `/api/tactics/study/${g1}/passive`, { key: 'counter' })).status === 400 && (await api(a, 'POST', `/api/tactics/study/${g1}/passive`, { key: 'c_cleave' })).status === 400
      && (await api(b, 'POST', `/api/tactics/study/${g1}/passive`, { key: 'brace' })).status === 404, 'only one she has learned, and only a passive');
    r = await api(a, 'POST', `/api/tactics/study/${g1}/passive`, { key: null });
    check(r.status === 200 && r.body.passive === null && (await S.passiveFor([g1])).size === 0, 'or none');
    await api(a, 'POST', `/api/tactics/study/${g1}`, { lesson: 'c_second_wind' });
    await q(`UPDATE citizen_study SET done_at = NOW() - interval '1 second' WHERE citizen_id=$1`, [g1]);
    await api(a, 'POST', `/api/tactics/study/${g1}/passive`, { key: 'brace' });
    const ab = (await api(a, 'GET', `/api/tactics/abilities/${g1}`)).body;
    check(ab.abilities.map(x => x.key).join() === 'g_shield,g_cover,c_second_wind' && ab.abilities.find(x => x.key === 'c_second_wind').studied === true && ab.abilities.find(x => x.key === 'c_second_wind').school === 'arms'
      && ab.passive && ab.passive.key === 'brace' && ab.passive.name === 'Brace', 'the Abilities page shows the studied ability among her Arms, and her passive', ab.abilities && ab.abilities.map(x => x.key).join());
    await D.startTest(a.id, 'test_green', [g1, g2, arch, wiz]);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const bt = (await api(a, 'GET', '/api/tactics/battles/' + r.body.board_battle_id)).body.battle, u1 = bt.setup.party.find(u => u.citizen_id === g1), u2 = bt.setup.party.find(u => u.citizen_id === g2);
    check(u1.passive === 'brace' && u1.passive_info.name === 'Brace' && u1.abilities.some(x => x.key === 'c_second_wind' && x.school === 'arms') && u2.passive === undefined && !u2.abilities.some(x => x.key === 'c_second_wind'),
      'in a battle she has her passive and what she studied; a citizen who studied nothing has neither');
    check((await api(a, 'POST', `/api/tactics/study/${g1}/passive`, { key: 'sure_footed' })).status === 400, 'a passive is chosen at home: not from inside a dungeon');
    await api(a, 'POST', '/api/dungeons/run/flee');

    console.log('Tough, and what it costs');
    await setLevel(a, g2, 'soldier', 6);
    const hp0 = (await CR.partyHealth([g2], null))[0].maxHp;
    await q(`INSERT INTO citizen_lessons (citizen_id, lesson_key) VALUES ($1,'tough')`, [g2]);
    await q(`UPDATE citizens SET passive='tough' WHERE id=$1`, [g2]);
    const hp1 = (await CR.partyHealth([g2], null))[0].maxHp, unit = (await T.partyFor([g2], {}))[0];
    check(hp1 === Math.round(hp0 * 1.1) && unit.maxHp === hp1 && unit.passive === 'tough', 'Tough: a tenth more health, wherever her health is worked out', `${hp0} → ${hp1}`);
    const poor = await player('Poor', 40);
    await build(poor, 'watchtower', 3);
    await setLevel(poor, poor.cits[0], 'soldier', 9);
    r = await api(poor, 'POST', `/api/tactics/study/${poor.cits[0]}`, { lesson: 'brace' });
    check(r.status === 400 && /Costs 50 wealth/.test(r.body.error) && (await wealth(poor)) === 40, 'a town that cannot pay the fee cannot begin', r.body.error);
    await q('UPDATE settlements SET wealth = 1000 WHERE id=$1', [poor.sid]);
    await setLevel(poor, poor.cits[1], 'soldier', 9);
    r = await api(poor, 'POST', `/api/tactics/study/${poor.cits[0]}`, { lesson: 'c_cleave' });
    const r2 = await api(poor, 'POST', `/api/tactics/study/${poor.cits[1]}`, { lesson: 'counter' });
    check(r.status === 200 && r2.status === 200 && r2.body.building.used === 2 && r2.body.building.seats === 3 && (await wealth(poor)) === 1000 - 150 - 150 && Math.abs((new Date(r.body.studying.done_at) - Date.now()) / 3600e3 - 6) < 0.05,
      'a level 3 building seats three, and teaches what a level 2 lesson needs: six hours and 150 wealth each', r.body.error || r2.body.error);
    check((await S.finishDue(poor.sid)) === 0 && (await api(poor, 'GET', `/api/tactics/study/${poor.cits[0]}`)).body.studying.key === 'c_cleave', 'nothing is learned before its time');
  } finally { await pool.end(); }
}

(async () => {
  try { await main(); } catch (e) { console.error(e); check(false, 'crashed: ' + e.message); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
