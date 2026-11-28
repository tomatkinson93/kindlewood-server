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

  console.log('Research at the Library: Battlecraft');
  const RS = require('../lib/research_defs'), bp = RS.KEYS.filter(k => RS.PROJECTS[k].branch === 'battle');
  check(RS.BRANCHES.battle.label === 'Battlecraft' && bp.join() === 'fletching,field_medicine,stone_wards,sparring_rings' && RS.PROJECTS.fletching.tier === 1 && RS.PROJECTS.fletching.requires.length === 0
    && RS.PROJECTS.sparring_rings.requires.join() === 'field_medicine' && bp.every(k => RS.PROJECTS[k].desc && Object.keys(RS.PROJECTS[k].effects).every(t => t.startsWith('battle:'))),
  'a Battlecraft path at the Library: Fletching, then Field Medicine and Stone Wards, then Sparring Rings');
  const withR = (cls, research, second) => T.partyUnit({ id: 1, name: 'x', role: 'idle', unit: { ...stub } }, cls, null, null, 6, second || null, null, { research });
  const none = c => withR(c, null), aR = withR('archer', { archery_reach: 1 });
  check(ab(aR, 'a_shoot').max === ab(none('archer'), 'a_shoot').max + 1 && ab(aR, 'a_part').max === ab(none('archer'), 'a_part').max + 1 && ab(aR, 'a_side').max === 0 && ab(withR('guard', { archery_reach: 1 }), 'g_strike').max === 1,
    'Fletching: Archery reaches one tile further, for everyone in the town; nothing else does');
  const hR = withR('hearthkeeper', { heal_uses: 1 }), hN = none('hearthkeeper');
  check(ab(hR, 'h_kindle').uses === ab(hN, 'h_kindle').uses + 1 && ab(hR, 'h_cinder').uses === null && ab(hR, 'h_kindle').heal === ab(hN, 'h_kindle').heal
    && ab(withR('guard', { heal_uses: 1 }, { cls: 'hearthkeeper', level: 2, keys: null }), 'h_kindle').uses === ab(hN, 'h_kindle').uses + 1, 'Field Medicine: counted healing can be used once more, a borrowed Kindle too');
  const wR = withR('wizard', { ward: 0.25 }), hW = withR('hearthkeeper', { ward: 0.25 });
  check(ab(wR, 'w_ward').block === Math.round(ab(none('wizard'), 'w_ward').block * 1.25) && ab(hW, 'h_ward').block === Math.round(ab(hN, 'h_ward').block * 1.25) && ab(withR('guard', { ward: 0.25 }), 'g_shield').block === ab(none('guard'), 'g_shield').block,
    'Stone Wards: the wards of Wild and Hearth magic block a quarter more; a shield does not');
  const gR = withR('guard', { attack: 0.1 }), zR = withR('wizard', { attack: 0.1 });
  check(ab(gR, 'g_strike').dmg === Math.round(ab(none('guard'), 'g_strike').dmg * 1.1) && ab(gR, 'g_heavy').dmg === ab(none('guard'), 'g_heavy').dmg && ab(zR, 'v_knock').dmg === Math.round(ab(none('wizard'), 'v_knock').dmg * 1.1)
    && ab(zR, 'w_spark').dmg === ab(none('wizard'), 'w_spark').dmg, 'Sparring Rings: every citizen\'s Attack is a tenth stronger; their abilities are not');

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

    console.log('A town that has done the research');
    const RES = require('../lib/research');
    const town = await player('Lore');
    const [lg, , la, , lh] = town.cits;
    check((await T.researchOf(town.sid)) === null && (await api(town, 'GET', `/api/tactics/abilities/${la}`)).body.research.length === 0, 'a town that has researched none of it brings nothing extra');
    const shoot0 = (await api(town, 'GET', `/api/tactics/abilities/${la}`)).body.attack.max, kindle0 = (await api(town, 'GET', `/api/tactics/abilities/${lh}`)).body.abilities.find(x => x.key === 'h_kindle').uses;
    await RES.adminComplete(town.sid, 'fletching'); await RES.adminComplete(town.sid, 'field_medicine');
    const got = await T.researchOf(town.sid);
    check(got && got.archery_reach === 1 && got.heal_uses === 1 && got.ward === undefined, 'finished projects are what the town brings', JSON.stringify(got));
    const pa = (await api(town, 'GET', `/api/tactics/abilities/${la}`)).body, ph = (await api(town, 'GET', `/api/tactics/abilities/${lh}`)).body;
    check(pa.attack.max === shoot0 + 1 && ph.abilities.find(x => x.key === 'h_kindle').uses === kindle0 + 1 && pa.research.map(x => x.key).join() === 'fletching,field_medicine' && pa.research[0].name === 'Fletching' && pa.research[0].says,
      'the Abilities page shows it: the Archer\'s shot reaches further, the Hearthkeeper\'s Kindle has one more use, and the research is named');
    await D.startTest(town.id, 'test_green', [lg, la, lh]);
    r = await api(town, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const bt2 = (await api(town, 'GET', '/api/tactics/battles/' + r.body.board_battle_id)).body.battle;
    check(bt2.setup.party.find(u => u.citizen_id === la).abilities.find(x => x.attack).max === shoot0 + 1 && bt2.setup.party.find(u => u.citizen_id === lh).abilities.find(x => x.key === 'h_kindle').uses === kindle0 + 1,
      'and the battle is built with it');
    await api(town, 'POST', '/api/dungeons/run/flee');
    check((await T.researchOf(b.sid)) === null, 'another town has none of it');

    console.log('A family signature');
    const SG = require('../lib/tactics_signature'), LIFE = require('../lib/life');
    check(SG.kitOf('g_heavy').school === 'arms' && SG.kitOf('h_mend').school === 'hearth' && SG.kitOf('g_strike') === null && SG.kitOf('v_swing') === null && SG.kitOf('nonsense') === null && SG.kitOf('brace') === null,
      'a signature is an ability of a class ladder or a building\'s lessons: not an Attack, not a passive');
    check(SG.best([{ key: 'a', at: 6, used: 0 }, { key: 'b', at: 2, used: 9 }, { key: 'c', at: 8, used: 9 }]).key === 'c' && SG.best([{ key: 'a', at: 6, used: 0 }, { key: 'b', at: 2, used: 0 }]).key === 'a' && SG.best([]) === null,
      'a parent teaches the ability they have used most in battle; with none used, the furthest along');
    const fam = await player('Kin');
    const [mum, dad] = fam.cits;       // two soldiers
    await setLevel(fam, mum, 'soldier', 6);            // knows Shield Up, Cover, Shove, Heavy Blow
    await setLevel(fam, dad, 'soldier', 2);
    await q(`INSERT INTO citizen_ability_uses (citizen_id, ability_key, uses) VALUES ($1,'g_shove',12), ($1,'g_strike',40)`, [mum]);
    const kid = async (name, parents, born) => (await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage, parent_ids, born_at) VALUES ($1,$2,'female','idle',$3,'{"combat":1}','child',$4,$5) RETURNING id`,
      [fam.sid, name + RUN, JSON.stringify({ strength: 9, agility: 9, endurance: 9, intelligence: 9, charisma: 9 }), JSON.stringify(parents), born])).rows[0].id;
    const old = new Date(Date.now() - (LIFE.CONFIG.ADULT_FROM + 1) * LIFE.YEAR_MS).toISOString();
    const child = await kid('Pip', [mum, dad], old), orphan = await kid('Tam', [], old);
    const grown = await LIFE.comeOfAge(fam.sid);
    const row = (await q('SELECT signature, signature_from, signature_from_name, life_stage, role FROM citizens WHERE id=$1', [child])).rows[0];
    const line = (await q(`SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='came_of_age' AND citizen_ids @> $2::jsonb`, [fam.sid, JSON.stringify([child])])).rows[0];
    check(grown.some(x => x.id === child && x.signature === 'g_shove') && row.life_stage === 'adult' && row.signature === 'g_shove' && row.signature_from === mum && /^Kin0/.test(row.signature_from_name),
      'a child who comes of age is taught one ability by a parent: the one that parent has used most (her Attack is not hers to teach)', JSON.stringify(row));
    check(line && /taught them Shove, to carry all their life\./.test(line.message), 'the town\'s news says who taught them what', line && line.message);
    check((await q('SELECT signature FROM citizens WHERE id=$1', [orphan])).rows[0].signature === null && grown.some(x => x.id === orphan && x.signature === null), 'a child with nobody to teach them has none');
    const pgS = (await api(fam, 'GET', `/api/tactics/abilities/${child}`)).body, sAb = pgS.abilities.find(x => x.key === 'g_shove');
    check(pgS.signature && pgS.signature.key === 'g_shove' && pgS.signature.name === 'Shove' && sAb && sAb.signature === true && !sAb.off && sAb.school === 'arms' && /^Kin0/.test(sAb.taught_by),
      'whatever work they take up, they bring it to battle at full strength, and the Abilities page says who taught it', pgS.abilities && pgS.abilities.map(x => x.key).join());
    const unitS = (await T.partyFor([child], {}))[0];
    check(unitS.abilities.some(x => x.key === 'g_shove' && x.signature) && unitS.abilities.filter(x => x.key === 'g_shove').length === 1, 'and it is on the board');
    // A signature is handed on in its turn; a class that already teaches it does not double it.
    const grand = await kid('Bee', [child], old);
    await LIFE.comeOfAge(fam.sid);
    check((await q('SELECT signature, signature_from FROM citizens WHERE id=$1', [grand])).rows[0].signature === 'g_shove', 'she hands it on in her turn: it runs in the family');
    await q(`UPDATE citizens SET role='soldier' WHERE id=$1`, [child]); await setLevel(fam, child, 'soldier', 6);
    const asGuard = (await T.partyFor([child], {}))[0];
    check(asGuard.abilities.filter(x => x.key === 'g_shove').length === 1 && !asGuard.abilities.find(x => x.key === 'g_shove').signature, 'when her own class has taught it too, it is not there twice');
    await q('UPDATE citizens SET signature=NULL, signature_from=NULL WHERE id=$1', [grand]);
    check((await SG.assignMissing(fam.sid)) >= 1 && (await q('SELECT signature FROM citizens WHERE id=$1', [grand])).rows[0].signature === 'g_shove' && (await api(fam, 'POST', '/api/tactics/admin/signatures')).status === 403,
      'Dev Tools can hand signatures down to grown citizens who have none (admins only)');

    console.log('Village lore: what an Allied village teaches');
    const LO = require('../lib/tactics_lore');
    check(Object.keys(LO.LORE).join() === 'mice,badger,squirrel,otter,weasel' && Object.values(LO.LORE).every(l => CC.ability(l.key) && l.says && LO.kitOf(l.key).school === 'lore')
      && !Object.values(LO.LORE).some(l => ['guard', 'archer', 'wizard', 'hearthkeeper'].some(c => T.KITS[c].abilities.some(a => a.key === l.key)) || S.LESSONS[l.key]) && LO.FEE === 200 && LO.EVERY_DAYS === 7 && LO.ofSpecies('Otter').key === 'l_riptide',
    'each kind of village folk has one ability of its own, on no class ladder and in no building\'s lessons');
    const lt = await player('Ally');
    const [lz] = lt.cits;
    const mkVillage = async species => (await q(`INSERT INTO npc_settlements (name, species, tier, tile_q, tile_r, disposition) VALUES ($1,$2,'village',$3,0,'friendly') RETURNING id, name`, [`Lore ${species} ${RUN}`, species, 39000 + (Date.now() % 100000) + (seq++) * 7])).rows[0];
    const otters = await mkVillage('Otter'), mice = await mkVillage('Mice');
    await q(`INSERT INTO diplomacy_relations (settlement_id, npc_id, status, trust) VALUES ($1,$2,'friendly',60), ($1,$3,'allied',80)`, [lt.sid, otters.id, mice.id]);
    r = await api(lt, 'GET', `/api/diplomacy/${otters.id}`);
    check(r.status === 200 && r.body.teaching && r.body.teaching.allied === false && r.body.teaching.available === false && r.body.teaching.ability.key === 'l_riptide' && r.body.teaching.ability.name === 'Riptide' && r.body.teaching.fee === 200,
      'a village\'s window says what it would teach; below Allied it will not', r.body.error);
    r = await api(lt, 'POST', `/api/diplomacy/${otters.id}/teach`, { citizen_id: lz });
    check(r.status === 400 && /Only an Allied village/.test(r.body.error), 'a village that is not Allied refuses', r.body.error);
    const w0 = await wealth(lt);
    r = await api(lt, 'POST', `/api/diplomacy/${mice.id}/teach`, { citizen_id: lz });
    const cz = (await q('SELECT lore, lore_from FROM citizens WHERE id=$1', [lz])).rows[0];
    check(r.status === 200 && r.body.ability.key === 'c_rally' && r.body.replaced === null && r.body.wealth === w0 - 200 && (await wealth(lt)) === w0 - 200 && cz.lore === 'c_rally' && cz.lore_from === mice.name
      && r.body.teaching.available === false && r.body.teaching.next_at && /was taught Rally at/.test(r.body.message), 'an Allied village teaches one citizen its lore for 200 wealth, and then not again for a week', r.body.error || r.body.message);
    r = await api(lt, 'POST', `/api/diplomacy/${mice.id}/teach`, { citizen_id: lt.cits[1] });
    check(r.status === 400 && /taught one of yours this week/.test(r.body.error) && (await wealth(lt)) === w0 - 200, 'a second lesson in the same week is refused', r.body.error);
    const uL = (await T.partyFor([lz], {}))[0], aL = uL.abilities.find(x => x.lore);
    check(aL && aL.key === 'c_rally' && aL.school === 'lore' && !aL.off && aL.quick === true && aL.taught_by === mice.name && (await api(lt, 'GET', `/api/tactics/abilities/${lz}`)).body.abilities.some(x => x.key === 'c_rally' && x.lore && x.school_name === 'Village lore'),
      'the citizen brings it to every battle at full strength, as Village lore, and the Abilities page shows where it came from');
    await q(`UPDATE diplomacy_relations SET trust=80 WHERE settlement_id=$1 AND npc_id=$2`, [lt.sid, otters.id]);
    r = await api(lt, 'POST', `/api/diplomacy/${otters.id}/teach`, { citizen_id: lz });
    check(r.status === 200 && r.body.replaced === 'Rally' && (await q('SELECT lore FROM citizens WHERE id=$1', [lz])).rows[0].lore === 'l_riptide' && (await T.partyFor([lz], {}))[0].abilities.filter(x => x.lore).length === 1,
      'a citizen carries one piece of village lore: being taught another replaces it', r.body.error);
    await q(`UPDATE diplomacy_relations SET taught_at = NOW() - interval '8 days' WHERE settlement_id=$1`, [lt.sid]);
    r = await api(lt, 'POST', `/api/diplomacy/${otters.id}/teach`, { citizen_id: lz });
    check(r.status === 400 && /already knows Riptide/.test(r.body.error), 'what a citizen already knows is not taught again', r.body.error);
    await q('UPDATE settlements SET wealth = 50 WHERE id=$1', [lt.sid]);
    r = await api(lt, 'POST', `/api/diplomacy/${mice.id}/teach`, { citizen_id: lt.cits[1] });
    check(r.status === 400 && /costs 200 wealth/.test(r.body.error) && (await api(b, 'POST', `/api/diplomacy/${mice.id}/teach`, { citizen_id: lz })).status === 400, 'a town that cannot pay, or is no ally, is refused', r.body.error);
  } finally { await pool.end(); }
}

(async () => {
  try { await main(); } catch (e) { console.error(e); check(false, 'crashed: ' + e.message); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
