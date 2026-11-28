// Event rooms, blessings and curses, and keepsakes (docs/DUNGEONS.md §16; lib/dungeon_events.js).
//   node scripts/dungeon_events_test.js                         the catalogue and the rules (no database)
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 node scripts/dungeon_events_test.js      and whole runs through the routes
'use strict';
const jwt = require('jsonwebtoken');
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra != null && extra !== '' ? ' — ' + extra : '')); ok ? pass++ : fail++; };

const EV = require('../lib/dungeon_events');
const E = require('../lib/tactics_engine');
const GEN = require('../lib/dungeon_gen');
const F = require('../lib/tactics_foes');

function part1() {
  console.log('The catalogue');
  const evs = Object.entries(EV.EVENTS), opts = evs.flatMap(([k, e]) => e.options.map(o => ({ ev: k, ...o })));
  check(evs.length >= 16 && evs.every(([, e]) => e.title && e.icon && e.text && e.options.length >= 2 && e.options.length <= 3 && new Set(e.options.map(o => o.key)).size === e.options.length),
    'sixteen events and more, each a situation with two or three options', `${evs.length} events, ${opts.length} options`);
  const kinds = o => [o.then ? 1 : 0, o.try ? 1 : 0, o.odds != null ? 1 : 0].reduce((a, b) => a + b, 0);
  check(opts.every(o => kinds(o) === 1 && (o.then ? !o.win && !o.lose : o.win && o.lose)), 'an option is certain, a try, or a gamble: one of the three, and a try or a gamble has both of its ends');
  const costs = o => !!(o.hurt || o.fight || (o.mark && EV.MARKS[o.mark].kind === 'curse'));
  check(opts.filter(o => o.try).every(o => costs(o.lose) || (o.cost && o.cost.wealth)), 'a try that misses always costs something: health, a curse, a fight, or the stake', opts.filter(o => o.try && !costs(o.lose) && !(o.cost && o.cost.wealth)).map(o => o.ev + '.' + o.key).join());
  const outs = opts.flatMap(o => [o.then, o.win, o.lose].filter(Boolean)).flatMap(o => (o.after ? [o, o.after] : [o]));
  check(outs.every(o => o.text && (!o.mark || EV.MARKS[o.mark]) && (!o.fight || ['small', 'hard'].includes(o.fight))) && outs.some(o => o.keepsake) && outs.some(o => o.fight === 'hard') && outs.some(o => o.loot === 'room'),
    'every outcome says what happened, and names only marks and fights the game has');
  check(opts.filter(o => o.try).every(o => ['strength', 'agility', 'endurance', 'intelligence', 'charisma'].includes(o.try.stat) && o.try.base >= 30 && o.try.base <= 60 && o.try.good.length && o.try.tag)
    && new Set(opts.filter(o => o.try).flatMap(o => o.try.good)).size >= 15, 'every try names a stat and the careers it suits; between them the events have a use for most careers', [...new Set(opts.filter(o => o.try).flatMap(o => o.try.good))].length + ' careers');
  check(evs.every(([, e]) => e.options.some(o => !o.cost)), 'no event can only be answered with coin');
  check(Object.values(EV.MARKS).every(m => ['blessing', 'curse'].includes(m.kind) && m.name && m.icon && m.says && (m.party || m.foes || m.start)) && Object.values(EV.MARKS).some(m => m.kind === 'blessing') && Object.values(EV.MARKS).some(m => m.kind === 'curse') && EV.MARKS.spores.fights === 1,
    'blessings and curses: each changes the party\'s stats, the foes\' numbers or how a fight starts; one lasts a single fight');
  check(Object.keys(EV.KEEPSAKES).length === 6 && Object.values(EV.KEEPSAKES).every(k => k.name && k.icon && k.says && (k.start || k.after || k.rest || k.luck)), 'six keepsakes, each with something it does', Object.values(EV.KEEPSAKES).map(k => k.name).join(', '));

  console.log('Trying');
  const t = { stat: 'charisma', base: 40, good: ['hearthkeeper'], tag: 'a Hearthkeeper' };
  const m = (role, cha, more) => ({ id: 1, name: 'Hazel', role, stats: { charisma: cha }, hp: 10, max: 10, down: false, ...(more || {}) });
  check(EV.chanceOf(t, m('farmer', 8)).chance === 40 && EV.chanceOf(t, m('farmer', 12)).chance === 52 && EV.chanceOf(t, m('hearthkeeper', 8)).chance === 75 && EV.chanceOf(t, m('hearthkeeper', 8)).suited === true
    && EV.chanceOf(t, m('hearthkeeper', 12), 15).chance === 95 && EV.chanceOf(t, m('farmer', 1)).chance === 19 && EV.chanceOf({ ...t, base: 5 }, m('farmer', 1)).chance === 5 && EV.chanceOf(t, m('hearthkeeper', 40)).chance === 95,
    'the chance: the option\'s own, 3% for each point of the stat above 8, 35% for the right career, luck on top; never under 5% or over 95%');
  const ctx = { members: [{ ...m('farmer', 14), id: 1, name: 'Ash' }, { ...m('hearthkeeper', 8), id: 2, name: 'Hazel' }, { ...m('hearthkeeper', 30), id: 3, name: 'Fern', down: true, hp: 0 }], carried: [], wealth: 10, seed: [7, 1, 'event', 0, 'a'] };
  const who = EV.tryer(t, ctx);
  check(who.id === 2 && who.chance === 75 && who.suited, 'whoever is likeliest tries, of those on their feet: a Hearthkeeper before a charming farmer, and never someone who is down');
  const shrine = EV.EVENTS.mossy_shrine, view = EV.options(shrine, ctx);
  const offer = view.find(o => o.key === 'offer'), tend = view.find(o => o.key === 'tend'), pass2 = view.find(o => o.key === 'pass');
  check(offer.kind === 'certain' && offer.cost === 15 && offer.disabled && /carrying 10 wealth/.test(offer.why) && tend.kind === 'try' && tend.chance === 75 && tend.who.name === 'Hazel' && tend.who.role === 'Hearthkeeper' && tend.suits === 'a Hearthkeeper'
    && /blessing: The Wood's Favour \(Endurance \+2\)/.test(tend.win) && /everyone heals 10%/.test(tend.win) && /curse: Slighted/.test(tend.lose) && pass2.kind === 'certain' && pass2.text === 'nothing' && !pass2.disabled,
    'the screen is told, for each option: what it costs, the chance and who would try, and what each end brings', `${tend.win} / ${tend.lose}`);
  check(EV.options(EV.EVENTS.gambling_crow, ctx).find(o => o.key === 'wager').chance === 50 && EV.options(EV.EVENTS.gambling_crow, { ...ctx, carried: [{ key: 'lucky_acorn', kind: 'keepsake' }] }).find(o => o.key === 'wager').chance === 65
    && EV.options(shrine, { ...ctx, carried: [{ key: 'lucky_acorn', kind: 'keepsake' }] }).find(o => o.key === 'tend').chance === 90, 'a gamble shows its plain odds; a Lucky Acorn adds 15% to a gamble and to a try');
  const none = EV.options(shrine, { ...ctx, members: ctx.members.map(x => ({ ...x, down: true })) }).find(o => o.key === 'tend');
  check(none.disabled && /on their feet/.test(none.why), 'with nobody on their feet there is nobody to try');
  // The roll.
  const rolls = Array.from({ length: 4000 }, (_, i) => EV.rollOf([i, 'event', 0, 'a', 'tend']));
  const under50 = rolls.filter(r => r < 50).length / rolls.length;
  check(rolls.every(r => r >= 0 && r <= 99 && Number.isInteger(r)) && under50 > 0.46 && under50 < 0.54 && EV.rollOf([7, 1, 'x']) === EV.rollOf([7, 1, 'x']) && new Set(rolls).size === 100, 'the roll is 0 to 99, even, and the same whenever it is asked for with the same room', `${Math.round(under50 * 100)}% under 50`);
  const r1 = EV.resolve(shrine, 'tend', ctx), r2 = EV.resolve(shrine, 'tend', ctx), roll = EV.rollOf(ctx.seed.concat(['tend']));
  check(r1.kind === 'try' && r1.roll === roll && r1.chance === 75 && r1.won === (roll < 75) && r1.outcome === (r1.won ? shrine.options[1].win : shrine.options[1].lose) && JSON.stringify(r1) === JSON.stringify(r2) && r1.who.name === 'Hazel',
    'a try is won when the roll is under the chance; asked twice, the answer is the same', `roll ${roll} against 75`);
  check(EV.resolve(shrine, 'offer', ctx).refused && EV.resolve(shrine, 'offer', { ...ctx, wealth: 15 }).kind === 'certain' && EV.resolve(shrine, 'pass', ctx).won === null && EV.resolve(shrine, 'nonsense', ctx) === null, 'an option the party cannot pay for is refused; one the event does not have is not an option');

  console.log('What a run carries');
  let c = [];
  c = EV.carry(c, 'keen_edges', 'mark'); c = EV.carry(c, 'keen_edges', 'mark'); c = EV.carry(c, 'thorn_blood', 'mark'); c = EV.carry(c, 'sodden', 'mark'); c = EV.carry(c, 'alarm', 'mark'); c = EV.carry(c, 'spores', 'mark');
  c = EV.carry(c, 'whetted_edge', 'keepsake'); c = EV.carry(c, 'old_banner', 'keepsake'); c = EV.carry(c, 'travelling_kettle', 'keepsake'); c = EV.carry(c, 'hearthstone', 'keepsake'); c = EV.carry(c, 'nonsense', 'keepsake');
  check(c.length === 9 && c.filter(x => x.key === 'keen_edges').length === 1, 'the same blessing twice is still one; what the game does not know is not carried');
  const pm = EV.partyMods(c), fb = EV.foeBoost(c), st = EV.starts(c);
  check(pm.party_strength === 5 && pm.party_agility === -2 && fb.hp === 0.1 && fb.str === 0 && st.foes.vulnerable === 2 && st.party.bold === 4 && st.party.poison === 2 && EV.restBonus(c) === 0.1 && EV.afterFightHeal(c) === 0.08 && EV.luck(c) === 0,
    'together they say what a fight takes from them: the party\'s stats, the foes\' health, what each side starts with, the rest and the walk between');
  const after = EV.afterFight(c);
  check(after.length === 8 && !after.some(x => x.key === 'spores') && EV.starts(after).party.poison === undefined && after.some(x => x.key === 'keen_edges'), 'what lasts one fight is gone after it; the rest stay to the end of the run');
  const v = EV.carriedView(c);
  check(v.length === 9 && v.find(x => x.key === 'spores').fights === 1 && v.find(x => x.key === 'sodden').kind === 'curse' && v.find(x => x.key === 'keen_edges').kind === 'blessing' && v.find(x => x.key === 'old_banner').kind === 'keepsake' && v.every(x => x.name && x.icon && x.says),
    'each is shown with its name and what it does');
  const k1 = EV.keepsakeFor([5, 0, 'x'], c), all = Object.keys(EV.KEEPSAKES).reduce((l, k) => EV.carry(l, k, 'keepsake'), []);
  check(k1 && !c.some(x => x.key === k1) && EV.keepsakeFor([5, 0, 'x'], c) === k1 && EV.keepsakeFor([5, 0, 'x'], all) === null, 'a keepsake found is one the run does not hold yet, the same for the same room; a run that holds them all finds none');

  console.log('The board and the generator');
  const ab = { key: 'hit', name: 'hit', icon: '•', kind: 'attack', target: 'enemy', min: 1, max: 1, shape: 'single', dmg: 20, block: 0, heal: 0, fx: {}, cooldown: 0, quick: false, uses: null };
  const u = (id, o) => ({ id, name: id, cls: 'guard', maxHp: 100, armour: 0, agility: 50, move: 3, jump: 1, abilities: [ab], ...(o || {}) });
  const b = E.createBattle({ seed: 3, land: 'plains', party: [u('a', { st0: { bold: 4, poison: 2 }, agility: 1 }), u('d', { st0: { bold: 4 }, down: true })], enemies: [u('x', { st0: { vulnerable: 2, weak: 2 }, agility: 99 })] });
  const X = E.unit(b, 'x'), A = E.unit(b, 'a');
  check(X.st.vulnerable === 1 && X.st.weak === 1 && A.st.bold === 4 && A.st.poison === 2 && !E.unit(b, 'd').st.bold && E.replay({ seed: 3, land: 'plains', party: [u('a')], enemies: [u('x')] }, []).state.units.every(q => !Object.keys(q.st).length),
    'a unit begins a battle with the statuses it was given (a foe whose turn comes first has already had one wear off); a unit given none begins clean');
  let events = 0, chests = 0, n = 0, bad = 0, without = 0, dupes = 0, groups = true;
  for (const tier of ['green', 'yellow', 'orange', 'red', 'purple']) for (const land of GEN.LANDS) for (let seed = 1; seed <= 8; seed++) {
    const story = GEN.generate({ seed: seed * 7919 + 3, tier, terrain: land, creatures: F.castFor(land, seed).creatures, items: null }), rooms = story.floors.flatMap(f => f.rooms), ev = rooms.filter(r => r.type === 'event');
    n++; if (GEN.check(story).length) bad++; if (!ev.length) without++;
    events += ev.length; chests += rooms.filter(r => r.type === 'treasure').length;
    if (new Set(ev.map(r => r.event)).size !== ev.length && ev.length <= EV.EVENT_KEYS.length) dupes++;
    for (const r of ev) if (!EV.EVENTS[r.event] || !r.loot || !(r.groups && r.groups.small.length && r.groups.hard.length && r.groups.small.concat(r.groups.hard).every(k => F.foe(k)))) groups = false;
    if (JSON.stringify(story) !== JSON.stringify(GEN.generate({ seed: seed * 7919 + 3, tier, terrain: land, creatures: F.castFor(land, seed).creatures, items: null }))) bad++;
  }
  check(GEN.EVENTS_BUILT && bad === 0 && without === 0 && dupes === 0 && groups && events > chests * 0.6 && events < chests * 1.8, 'a generated dungeon has event rooms where treasure might have been: about half, one at least, no event twice, each with its treasure and its foes; every rule still holds',
    `${n} dungeons: ${events} events, ${chests} treasure rooms`);
}

async function part2() {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const D = require('../lib/dungeons');
  const TU = require('../lib/tuning');
  const RUN = Date.now().toString(36);
  let seq = 0;
  // A town with four grown-ups: a Guard, a Hearthkeeper, a Wizard and a Merchant, strong enough to win their fights.
  async function player(name) {
    const username = `${name}_${RUN}_${seq++}`;
    const usr = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',1000,1000,1000,1000,1000,$3,0,NOW()) RETURNING id`, [usr.id, username, 9000 + (Date.now() % 100000) + seq * 40])).rows[0];
    const roles = ['soldier', 'hearthkeeper', 'wizard', 'merchant'], cits = [];
    for (let i = 0; i < 4; i++) cits.push((await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage) VALUES ($1,$2,'female',$3,$4,$5,'adult') RETURNING id`,
      [s.id, `${name}${i}${RUN}`, roles[i], JSON.stringify({ strength: 30, agility: 14, endurance: 20, intelligence: 12, charisma: 10 }), JSON.stringify({ combat: 8 })])).rows[0].id);
    return { id: usr.id, sid: s.id, cits, token: jwt.sign({ userId: usr.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  async function fight(p, battleId) {
    const bt = (await api(p, 'GET', '/api/tactics/battles/' + battleId)).body.battle;
    const st = E.replay(bt.setup, bt.actions).state;
    let n = bt.count, last = null;
    if (st.status === 'placing') { E.apply(st, { t: 'place', at: {} }); last = await api(p, 'POST', `/api/tactics/battles/${battleId}/act`, { n: n++, action: { t: 'place', at: {} } }); }
    for (let g = 0; g < 500 && st.status === 'active'; g++) {
      const cur = E.current(st), keep = st.r, plan = E.plan(st); st.r = keep;
      const acts = [];
      if (plan && plan.to && (plan.to.x !== cur.x || plan.to.y !== cur.y)) acts.push({ t: 'move', x: plan.to.x, y: plan.to.y });
      if (plan && plan.ability) acts.push({ t: 'use', key: plan.ability, x: plan.x, y: plan.y });
      acts.push({ t: 'end' });
      for (const a of acts) { if (st.status !== 'active' || !E.apply(st, a)) continue; last = await api(p, 'POST', `/api/tactics/battles/${battleId}/act`, { n: n++, action: a }); if (last.status !== 200) return { last, st, bt }; }
    }
    return { last, st, bt };
  }
  // A dungeon written for the test: one floor, its rooms in a line, the last one the boss.
  const LOOT = { wealth: 50, items: [] }, GROUPS = { small: ['rat_cutpurse'], hard: ['fox_footpad', 'rat_cutpurse'] };
  const evRoom = (id, key) => ({ id, type: 'event', event: key, loot: LOOT, groups: GROUPS });
  async function dungeon(rooms, seed) {
    const line = rooms.concat([{ id: 'boss', type: 'boss', enemies: ['rat_cutpurse'] }]).map((r, i, all) => ({ ...r, step: i + 1, lane: 2, next: all[i + 1] ? [all[i + 1].id] : [] }));
    const layout = { name: 'A Test of Events', tier: 'green', terrain: 'forest', intro: '', boss: 'a rat', floors: [{ rooms: line }], clear: { wealth: 10, items: [] } };
    return (await q(`INSERT INTO dungeons (source, terrain, tier, seed, layout) VALUES ('test','forest','green',$1,$2) RETURNING *`, [seed, JSON.stringify(layout)])).rows[0];
  }
  const runRow = async p => (await q(`SELECT * FROM dungeon_runs WHERE settlement_id=$1 ORDER BY id DESC LIMIT 1`, [p.sid])).rows[0];
  const move = (p, room) => api(p, 'POST', '/api/dungeons/run/move', { room });
  const choose = (p, option) => api(p, 'POST', '/api/dungeons/run/choose', { option });
  const end = async p => { await q(`UPDATE dungeon_runs SET status='left', ended_at=NOW() WHERE settlement_id=$1 AND status='active'`, [p.sid]); await q(`UPDATE tactics_battles SET status='left' WHERE settlement_id=$1 AND status='active'`, [p.sid]); };
  const hurtAll = async (p, share) => { const r = await runRow(p), st = r.party_state; for (const id of Object.keys(st)) st[id].hp = Math.max(1, Math.round(st[id].max * share)); await q('UPDATE dungeon_runs SET party_state=$2 WHERE id=$1', [r.id, JSON.stringify(st)]); };
  const give = async (p, wealth) => { const r = await runRow(p); await q('UPDATE dungeon_runs SET loot=$2 WHERE id=$1', [r.id, JSON.stringify({ wealth, items: [] })]); };
  const carry = async (p, list) => { const r = await runRow(p); await q('UPDATE dungeon_runs SET carried=$2 WHERE id=$1', [r.id, JSON.stringify(list)]); };

  const wasOn = await TU.switchOn('dungeons.on');
  await TU.setSwitch('dungeons.on', true);
  try {
    console.log('An event room, through the routes');
    const a = await player('Ev');
    let d = await dungeon([evRoom('a', 'clear_spring'), evRoom('b', 'mossy_shrine'), evRoom('c', 'rockfall'), evRoom('e', 'gambling_crow')], 4101);
    await D.start(a.id, d.id, a.cits);
    await hurtAll(a, 0.5);
    let r = await move(a, 'a'), v = r.body.run;
    const p0 = v.pending;
    check(r.status === 200 && v.room_open && p0 && p0.kind === 'event' && p0.title === 'The Clear Spring' && p0.options.length === 2 && p0.options[0].key === 'drink' && p0.options[0].kind === 'certain' && /everyone heals 20%/.test(p0.options[0].text)
      && v.rooms.find(x => x.id === 'a').type === 'event' && v.rooms.find(x => x.id === 'a').icon === '❓' && v.moves.length === 0 && v.happened === null && Array.isArray(v.carried) && v.carried.length === 0,
      'walking into an event room shows the situation and its options, each with what it brings; the party cannot walk on until it has answered');
    check((await move(a, 'b')).status === 400 && (await choose(a, 'rest')).status === 400 && (await choose(a, 'nonsense')).status === 400, 'no walking on, no resting, and no option the event does not have');
    const before = v.party.map(m => m.hp);
    r = await choose(a, 'drink'); v = r.body.run;
    check(r.status === 200 && v.pending === null && !v.room_open && v.moves.join() === 'b' && v.party.every((m, i) => m.hp === Math.min(m.max, before[i] + Math.max(1, Math.round(m.max * 0.2))))
      && v.happened && v.happened.title === 'The Clear Spring' && v.happened.label === 'Everyone drinks' && v.happened.kind === 'certain' && v.happened.won === null && /Cold, and good/.test(v.happened.text) && v.happened.lines.join(' ').includes('20%'),
      'a certain option does what it said: everyone heals a fifth, the way on opens, and the screen is told what happened', v.happened && v.happened.lines.join(' '));
    check((await choose(a, 'bathe')).status === 400 && (await api(a, 'GET', '/api/dungeons/run')).body.run.happened.option === 'drink', 'an event is answered once; a reload still says what came of it');

    // The shrine: a cost the party cannot pay, then can; a try by whoever is likeliest.
    r = await move(a, 'b'); v = r.body.run;
    let offer = v.pending.options.find(o => o.key === 'offer'), tend = v.pending.options.find(o => o.key === 'tend');
    const hk = a.cits[1], expect = 40 + (10 - 8) * 3 + 35;
    check(offer.disabled && offer.cost === 15 && tend.kind === 'try' && tend.chance === expect && tend.who.id === hk && tend.who.role === 'Hearthkeeper' && tend.who.suited && tend.suits === 'a Hearthkeeper' && tend.stat === 'charisma' && tend.win && tend.lose,
      'a try shows its chance and who would try: the Hearthkeeper, at the option\'s 40%, 6% for charisma 10, and 35% for her career', `${tend.chance}%`);
    check((await choose(a, 'offer')).status === 400 && (await runRow(a)).room_open === true, 'an option the party cannot pay for is refused, and the room still waits');
    await give(a, 40);
    v = (await api(a, 'GET', '/api/dungeons/run')).body.run;
    check(!v.pending.options.find(o => o.key === 'offer').disabled, 'with the coin in hand the option opens');
    const roll = EV.rollOf([4101, a.sid, 'event', 0, 'b', 'tend']), wins = roll < expect;
    r = await choose(a, 'tend'); v = r.body.run;
    const h = v.happened, marks = v.carried.map(c => c.key);
    check(r.status === 200 && h.kind === 'try' && h.roll === roll && h.chance === expect && h.won === wins && h.who.id === hk && (wins ? marks.join() === 'woods_favour' && v.carried[0].kind === 'blessing' : marks.join() === 'slighted' && v.carried[0].kind === 'curse')
      && v.loot.wealth === 40 && v.carried[0].name && v.carried[0].says, `the try is rolled once, from the dungeon, the town and the room: ${roll} against ${expect}, so it ${wins ? 'comes off, and the party carries a blessing' : 'misses, and the party carries a curse'}`, h.lines.join(' '));

    // Nothing in an event takes the last of anyone's health.
    await hurtAll(a, 0.001);
    r = await move(a, 'c');
    r = await choose(a, 'run'); v = r.body.run;
    check(r.status === 200 && v.party.every(m => m.hp === 1 && !m.down) && /8%/.test(v.happened.lines.join(' ')), 'a hurt never takes the last of anyone\'s health: a party on 1 each is still on its feet after the rockfall');

    // A gamble: plain odds, paid for.
    r = await move(a, 'e'); v = r.body.run;
    const wager = v.pending.options.find(o => o.key === 'wager'), gRoll = EV.rollOf([4101, a.sid, 'event', 0, 'e', 'wager']);
    r = await choose(a, 'wager'); v = r.body.run;
    check(wager.kind === 'gamble' && wager.chance === 50 && wager.cost === 20 && !wager.who && v.happened.kind === 'gamble' && v.happened.roll === gRoll && v.happened.won === (gRoll < 50) && v.happened.paid === 20 && v.loot.wealth === 40 - 20 + (gRoll < 50 ? 40 : 0),
      `a gamble shows plain odds and takes its stake: ${gRoll} against 50, so the party ${gRoll < 50 ? 'doubles it' : 'loses it'}`, `${v.loot.wealth} wealth`);
    await end(a);

    console.log('An event that wakes a fight');
    const b = await player('Evf');
    d = await dungeon([evRoom('a', 'brigands_toll'), evRoom('b', 'sealed_door')], 4202);
    await D.start(b.id, d.id, b.cits);
    r = await move(b, 'a');
    r = await choose(b, 'fight'); v = r.body.run;
    const bid = r.body.board_battle_id;
    check(r.status === 200 && bid > 0 && v.pending.kind === 'battle' && v.pending.battle_id === bid && v.pending.room === 'event' && v.pending.foes.map(f => f.key).join() === 'rat_cutpurse' && v.room_open && v.can_flee && !v.can_leave && v.happened.fight === true,
      'choosing to fight opens a battle on the board against the room\'s small band; the party cannot walk on until it is won');
    let f = await fight(b, bid);
    const dn = f.last.body.dungeon;
    check(f.bt.setup.enemies.map(e => e.key).join() === 'rat_cutpurse' && f.bt.setup.fight === 'event' && f.st.status === 'victory' && dn && !dn.ended && dn.run.pending === null && dn.run.moves.join() === 'b' && dn.found.wealth >= 30
      && dn.run.happened.won_fight === true && /hat was not empty/.test(dn.run.happened.after_text) && dn.run.loot.wealth === dn.found.wealth,
      'won, the fight pays its own wealth and what the option promised beyond it (the hat), and the way on opens', `+${dn.found.wealth}`);
    // The sealed door, forced: the guard, then the treasure and a keepsake.
    r = await move(b, 'b');
    const read = r.body.run.pending.options.find(o => o.key === 'read');
    check(read.who.id === b.cits[2] && read.who.role === 'Wizard' && read.chance === 35 + (12 - 8) * 3 + 35 && /the treasure here/.test(read.win) && /a hard fight, then the treasure here, a keepsake/.test(r.body.run.pending.options.find(o => o.key === 'force').text),
      'the sealed door: the Wizard would read the runes; forcing it says plainly that it is a hard fight for the treasure and a keepsake');
    const w0 = dn.run.loot.wealth;
    r = await choose(b, 'force');
    f = await fight(b, r.body.board_battle_id);
    const dn2 = f.last.body.dungeon;
    check(f.bt.setup.enemies.map(e => e.key).join() === 'fox_footpad,rat_cutpurse' && f.st.status === 'victory' && dn2.run.loot.wealth >= w0 + 50 && dn2.run.carried.length === 1 && dn2.run.carried[0].kind === 'keepsake' && dn2.found.gained && dn2.found.gained.length === 1
      && dn2.found.gained[0].includes(dn2.run.carried[0].name), 'forced, the door\'s guard is the room\'s hard group; beaten, the room\'s treasure and a keepsake are the party\'s, and the victory screen is told', dn2.found.gained && dn2.found.gained[0]);
    await end(b);

    console.log('Keepsakes, blessings and curses in a fight');
    const c = await player('Evk');
    // A treasure room whose seed holds a keepsake, and one whose seed does not.
    let withK = 0, noK = 0;
    for (let sd = 5000; sd < 5400 && (!withK || !noK); sd++) { if (EV.rollOf([sd, 'chest', 0, 't']) < 34) withK = withK || sd; else noK = noK || sd; }
    d = await dungeon([{ id: 't', type: 'treasure', loot: LOOT }, { id: 'f', type: 'fight', enemies: ['rat_cutpurse'] }, { id: 'r', type: 'rest' }, { id: 'x', type: 'elite', enemies: ['fox_footpad'], loot: { wealth: 5, items: [] } }, { id: 'g', type: 'fight', enemies: ['rat_cutpurse'] }], withK);
    await D.start(c.id, d.id, c.cits);
    r = await move(c, 't'); v = r.body.run;
    check(r.body.found && r.body.found.wealth === 50 && r.body.found.keepsake && v.carried.length === 1 && v.carried[0].kind === 'keepsake' && v.carried[0].key === r.body.found.keepsake.key && r.body.found.keepsake.says, 'one treasure room in three holds a keepsake as well as its treasure (which rooms is the dungeon\'s own)', r.body.found.keepsake && r.body.found.keepsake.name);
    // Carry a chosen set into the fight: a foe-weakening keepsake, the banner, a blessing, two curses.
    await carry(c, [{ key: 'whetted_edge', kind: 'keepsake' }, { key: 'old_banner', kind: 'keepsake' }, { key: 'hearthstone', kind: 'keepsake' }, { key: 'travelling_kettle', kind: 'keepsake' }, { key: 'keen_edges', kind: 'mark' }, { key: 'alarm', kind: 'mark' }, { key: 'spores', kind: 'mark', fights: 1 }]);
    // (The same party as any dungeon fight would have it, without what the run carries: its careers' own changes frozen in.)
    const CRs = require('../lib/combat_resolver'), plain = await require('../lib/tactics_setup').partyFor(c.cits, { mods: CRs.withParty(null, await require('../lib/careers').combatDeltas(c.sid, c.cits).catch(() => ({}))) }), plainFoe = (await require('../lib/tactics_setup').foesFor(['rat_cutpurse'], 'green', null))[0];
    r = await move(c, 'f');
    let bt = (await api(c, 'GET', '/api/tactics/battles/' + r.body.board_battle_id)).body.battle;
    const pu = bt.setup.party, eu = bt.setup.enemies;
    check(pu.every(x => x.st0 && x.st0.bold === 4 && x.st0.poison === 2) && eu.every(x => x.st0 && x.st0.vulnerable === 2), 'the fight is frozen with what the run carries: the party starts emboldened (the banner) and poisoned (the spores), the foes vulnerable (the whetted edge)');
    check(pu[0].stats.strength === plain[0].stats.strength + 2 && eu[0].maxHp === Math.max(1, Math.round(F.FOES.rat_cutpurse.hp * (1 + require('../lib/tactics_setup').tierNow('green').hp + 0.1))) && eu[0].maxHp > plainFoe.maxHp
      && bt.setup.carried.length === 7, 'a blessing is in the party\'s stats (strength +2) and a curse in the foes\' health (a tenth more); the battle names what was carried in', `${plain[0].stats.strength} → ${pu[0].stats.strength}; rat ${plainFoe.maxHp} → ${eu[0].maxHp}`);
    const begun = E.replay(bt.setup, [{ t: 'place', at: {} }]).state;
    check(begun.units.filter(x => x.side === 'enemy').every(x => (x.st.vulnerable || 0) >= 1) && begun.units.filter(x => x.side === 'player').some(x => (x.st.bold || 0) === 4 || x.hp < x.maxHp), 'and the board begins that way');
    f = await fight(c, r.body.board_battle_id);
    v = f.last.body.dungeon.run;
    const endHp = E.resultOf(f.st).party;
    check(f.st.status === 'victory' && !v.carried.some(x => x.key === 'spores') && v.carried.length === 6 && v.party.every(m => { const x = endHp.find(y => y.citizen_id === m.id); return m.hp === Math.min(m.max, Math.max(1, x.hp) + Math.max(1, Math.round(m.max * 0.08))); }),
      'after the fight the spores are spent, the rest is still carried, and the Hearthstone has given everyone standing 8% back', v.party.map(m => `${m.hp}/${m.max}`).join(' '));
    r = await move(c, 'r'); v = r.body.run;
    const pct = Math.round((TU.value('DUNGEON_BOARD_REST') ?? TU.LIFE_KEYS.DUNGEON_BOARD_REST.default) * 100) + 10;
    check(v.pending.kind === 'rest' && v.pending.options[0].text.includes(pct + '%'), 'with the Travelling Kettle a rest gives back 10% more', v.pending.options[0].text);
    await choose(c, 'rest');
    // An elite always carries a keepsake.
    r = await move(c, 'x');
    f = await fight(c, r.body.board_battle_id);
    const dn3 = f.last.body.dungeon;
    check(f.st.status === 'victory' && dn3.run.carried.filter(x => x.kind === 'keepsake').length === 5 && dn3.found.gained && dn3.found.gained.length === 1 && dn3.found.wealth >= 5, 'an elite always carries a keepsake: beaten, the party has one more, and the victory screen says which', dn3.found.gained && dn3.found.gained[0]);
    await end(c);
    // The other seed: treasure, no keepsake.
    const c2 = await player('Evn');
    d = await dungeon([{ id: 't', type: 'treasure', loot: LOOT }], noK);
    await D.start(c2.id, d.id, c2.cits);
    r = await move(c2, 't');
    check(r.body.found.wealth === 50 && !r.body.found.keepsake && r.body.run.carried.length === 0, 'the other two in three hold their treasure and no more');
    // A Lucky Acorn shows in the odds.
    await end(c2);
    const c3 = await player('Evl');
    d = await dungeon([evRoom('a', 'gambling_crow')], 4303);
    await D.start(c3.id, d.id, c3.cits);
    await carry(c3, [{ key: 'lucky_acorn', kind: 'keepsake' }]);
    await give(c3, 20);
    r = await move(c3, 'a');
    check(r.body.run.pending.options.find(o => o.key === 'wager').chance === 65 && r.body.run.carried[0].name === 'Lucky Acorn', 'a Lucky Acorn is in the odds the screen shows: the crow\'s 50% is 65%');
    await end(c3);

    console.log('A generated dungeon');
    const g = await player('Evg');
    const made = await D.createGenerated({ tier: 'green', terrain: 'forest', seed: 7919 * 3 + 3, source: 'test' });
    const rooms = made.layout.floors.flatMap(fl => fl.rooms), evs = rooms.filter(x => x.type === 'event');
    await D.start(g.id, made.id, g.cits);
    v = (await api(g, 'GET', '/api/dungeons/run')).body.run;
    check(evs.length >= 1 && evs.every(x => EV.EVENTS[x.event]) && v.rooms.filter(x => x.type === 'event').length === made.layout.floors[0].rooms.filter(x => x.type === 'event').length && v.rooms.filter(x => x.type === 'event').every(x => x.icon === '❓' && x.label === 'Event'),
      'a dungeon the generator makes has event rooms, and the path shows them', `${evs.length} event room${evs.length === 1 ? '' : 's'}: ${evs.map(x => x.event).join(', ')}`);
    await end(g);
  } finally {
    await TU.setSwitch('dungeons.on', wasOn);
    await pool.end();
  }
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { fail++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL)');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
