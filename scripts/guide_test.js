// ═══════════════════════════════════════════════════════════════════════════
//  guide_test — the guide's tour (docs/PHASE_3_ONBOARDING.md; lib/guide.js,
//  /api/guide).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/guide_test.js
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}

function pure() {
  const G = require('../lib/guide');
  console.log('The script');
  const off = G.beatsFor({ building_time: false }).map(b => b.key), on = G.beatsFor({ building_time: true }).map(b => b.key);
  check(off.join() === 'arrival,look,family,homes_gift,first_home,more_homes,move_in,scout_post,scout_job,send,families,away,back,moment,goodbye', 'the first session, beat by beat', off);
  check(on.length === off.length + 1 && on[3] === 'builder' && !off.includes('builder'), 'with building time on, "make someone a builder" comes before any building');
  check(G.BEATS.every(b => b.say.length <= 3 && b.say.every(l => l.length <= 140)) && G.BEATS.filter(b => !b.say.length).map(b => b.key).join() === 'away', 'every beat is one to three short lines; one is a quiet wait with none');
  check(G.BEATS.filter(b => b.until).every(b => b.hint && (b.point || !b.say.length)), 'every beat with something to do says what, and what to ring; a wait says what is being waited for');
  check(G.BEATS.filter(b => b.area).map(b => b.key + ':' + b.area).join() === 'first_home:neighbourhood,more_homes:neighbourhood,move_in:neighbourhood,scout_post:town', 'the beats that happen in one part of Home say which, so the screen can lead there');
  check(G.BEATS.filter(b => b.until && b.until.startsWith('client:')).map(b => b.key).join() === 'look,family,homes_gift,families,back', 'only looking, opening and walking are left to the screen to report; the rest the server checks');
  check(G.nextBeat(null, {}).key === 'arrival' && G.nextBeat('arrival', {}).key === 'look' && G.nextBeat('family', {}).key === 'homes_gift' && G.nextBeat('family', { building_time: true }).key === 'builder' && G.nextBeat('goodbye', {}) === null, 'each beat leads to the next, and the last to none');
  check(G.fill('Press {b}, {town}.', { b: 'Ash', town: 'Oakmere' }) === 'Press Ash, Oakmere.' && G.fill('Press {b}.', {}) === 'Press one of them.' && G.fill('{scout} is back.', { scout: '' }) === 'Your scout is back.', 'lines name real villagers, and read plainly when there is nobody to name');
  check(Object.keys(G.ELDERS).join() === 'Mice,Badgers,Otters,Moles,Foxes,Hares' && Object.values(G.ELDERS).every(e => e.name && e.hello && e.roofs && e.bye && !/roof|homes/i.test(e.hello)) && G.elderOf('Dragons').name === 'Old Bramble', 'an elder for each species, each with their own greeting and goodbye');
  check(JSON.stringify(G.owed(['homes'], { homes: { timber: 100 }, scout: { wealth: 30, food: 40 }, parting: { wealth: 100, food: 100 } })) === '{"wealth":130,"food":140}' && JSON.stringify(G.owed(['homes', 'scout', 'parting'], { homes: { timber: 1 }, scout: { wealth: 1 }, parting: { food: 1 } })) === '{}', 'a skip gives exactly what has not been given yet');
  check(Object.values(G.LATER).every(l => l.length === 1 && l[0].length <= 140), 'the later one-off lines are a line each');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const G = require('../lib/guide'), N = require('../lib/neighbourhoods');
  const putBack = await require('./_build').withoutBuildingTime();
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async ({ species = 'Mice', bt = false } = {}) => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `gd_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x',$3) RETURNING id", [username, `${username}@t.l`, species])).rows[0];
    const tq = -170000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, food, timber, stone, wealth, construction_on) VALUES ($1,$2,2,'camp',$3,0,NOW(),500,300,150,100,$4) RETURNING id`, [u.id, 'Oakmere', tq, bt])).rows[0];
    const ids = [];
    for (const [n, st] of [['Ash Oak', 'adult'], ['Bea Oak', 'adult'], ['Cob Elm', 'adult'], ['Dot Elm', 'adult'], ['Eve Ash', 'child']]) ids.push((await q(`INSERT INTO citizens (settlement_id, name, gender, role, life_stage, life) VALUES ($1,$2,'female','forager',$3,'{"happiness":60}') RETURNING id`, [s.id, n, st])).rows[0].id);
    await q('UPDATE citizens SET partner_id = $2 WHERE id = $1', [ids[0], ids[1]]); await q('UPDATE citizens SET partner_id = $2 WHERE id = $1', [ids[1], ids[0]]);
    const token = jwt.sign({ userId: u.id, username, species }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, user: u.id, ids, api };
  };
  const stock = async sid => { const r = (await q('SELECT food, timber, stone, wealth FROM settlements WHERE id = $1', [sid])).rows[0]; return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])); };
  const hood = async sid => { const l = await N.list({ id: sid, tier: 'camp' }); return { nid: l.neighbourhoods[0].id, open: l.neighbourhoods[0].open }; };

  console.log('A new town');
  const t = await mkTown();
  check((await G.view(t.user)).state === 'none' && (await G.view(t.user)).unlock.road === true, 'a town from before the tour has none, and nothing is hidden from it');
  let v = await G.start(t.user);
  check(v.state === 'active' && v.beat.key === 'arrival' && v.beat.n === 1 && v.beat.of === 15 && v.elder.name === 'Old Bramble', 'founding a town starts the tour at the first beat', v.beat);
  check(/Welcome, welcome/.test(v.beat.say[0]) && !/roof/.test(v.beat.say.join(' ')) && /This is Oakmere\. I am Old Bramble/.test(v.beat.say[1]), 'the elder welcomes the player in their own voice, by the town\'s name, before any talk of roofs', v.beat.say);
  check(v.unlock.road === false && v.unlock.clan === false, 'a town founded with the tour sees The Road and The Clan when it has a Tavern and a Guild Hall');
  check((await G.start(t.user)).beat.key === 'arrival', 'starting twice changes nothing');

  console.log('Beats the screen reports');
  v = await G.advance(t.user, 'look');
  check(v.beat.key === 'arrival', 'a beat cannot be passed by naming a later one');
  v = await G.advance(t.user, 'arrival');
  check(v.beat.key === 'look' && v.beat.client === true && v.beat.point === 'villager:any' && v.beat.hint === 'Press a villager', 'next, on to "press a villager"', v.beat);
  v = await G.advance(t.user, 'look');
  check(v.beat.key === 'look', 'a beat with something to do is not passed by pressing next');
  v = await G.advance(t.user, 'look', 'opened:families');
  check(v.beat.key === 'look', 'nor by reporting the wrong thing');
  v = await G.advance(t.user, 'look', 'selected:villager');
  v = await G.advance(t.user, 'family', 'opened:families');
  check(v.beat.key === 'homes_gift' && /not one roof/.test(v.beat.say[0]), 'the screen reports a villager pressed and their family opened; now the elder speaks of roofs', v.beat.say);

  console.log('Homes: the gift, the building, the moving in');
  {
    const before = await stock(t.id);
    const cost = { timber: 0, stone: 0 };
    for (let i = 0; i < 3; i++) for (const [r, n] of Object.entries(await N.nextCost(t.id, i))) cost[r] += n;
    check(v.just.length === 1 && v.just[0].beat === 'homes_gift' && v.just[0].given.timber === cost.timber && v.just[0].given.stone === cost.stone, 'the elder gives timber and stone for exactly three homes', v.just);
    check(v.beat.gift_at === 1 && /my gift/.test(v.beat.say[1]) && v.beat.gift && v.beat.gift.timber === cost.timber && v.beat.gift.stone === cost.stone && (await G.view(t.user)).beat.gift.timber === cost.timber, 'the beat says what was received, and still does when asked again', v.beat.gift);
    const now = await stock(t.id);
    check(now.timber === 300 + cost.timber && now.stone === 150 + cost.stone && before.timber === now.timber, 'and it is in the stores');
    v = await G.check(t.user);
    check(v.beat.key === 'homes_gift', 'walking to the Neighbourhood is for the screen to report; a check does not pass it');
    v = await G.advance(t.user, 'homes_gift', 'area:neighbourhood');
    check(v.beat.key === 'first_home' && v.just.length === 0 && !v.beat.gift, 'the gift is given once', v.just);
    const h = await hood(t.id);
    await N.place(t.id, { neighbourhoodId: h.nid, plot: h.open[0] });
    v = await G.check(t.user);
    check(v.beat.key === 'more_homes', 'a home stands: on to "two more"');
    await N.place(t.id, { neighbourhoodId: h.nid, plot: h.open[1] }); await N.place(t.id, { neighbourhoodId: h.nid, plot: h.open[2] });
    v = await G.check(t.user);
    check(v.beat.key === 'move_in' && (await stock(t.id)).timber === 300 && (await stock(t.id)).stone === 150, 'three homes: the gift is spent and the town\'s own stores are untouched', await stock(t.id));
    const housed = async sid => (await q("SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1 AND house_id IS NOT NULL", [sid])).rows[0].n;
    check(await G.holdsBeds(t.id) === true && await housed(t.id) === 0, 'while the tour teaches moving in, the new homes are left empty for the player', await housed(t.id));
    check((await require('../lib/life').autoHouse(t.id)).length === 0, 'and nothing else fills them meanwhile');
    v = await G.check(t.user);
    check(v.beat.key === 'move_in' && /nobody under them yet/.test(v.beat.say[0]), 'moving someone in has to be done; it is not passed by asking', v.beat.say);
    const house = (await q('SELECT id FROM houses WHERE settlement_id = $1 ORDER BY id DESC LIMIT 1', [t.id])).rows[0].id;
    const x = await t.api('POST', '/api/housing/assign', { citizen_id: t.ids[2], house_id: house });
    check(x.status === 200 && await G.holdsBeds(t.id) === false, 'someone is moved in by hand, through the house\'s own window');
    v = await G.check(t.user);
    check(v.beat.key === 'scout_post' && /found beds of their own/.test(v.beat.say[0]) && await housed(t.id) === 5, 'on to the Scout Post, and the rest have found their own beds', [v.beat.key, await housed(t.id)]);
    const old = await mkTown(); await N.place(old.id, { neighbourhoodId: (await hood(old.id)).nid, plot: (await hood(old.id)).open[0] });
    check(await G.holdsBeds(old.id) === false && await housed(old.id) > 0, 'a town without the tour fills its homes as it always did');
    const stale = await mkTown(); await G.start(stale.user);
    await q("UPDATE guide_progress SET started_at = NOW() - INTERVAL '3 days' WHERE user_id = $1", [stale.user]);
    check(await G.holdsBeds(stale.id) === false, 'a tour left half-way does not hold the beds for ever');
  }

  console.log('The Scout Post, the scout, and The Land');
  {
    await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'scout_post',1)", [t.id]);
    v = await G.check(t.user);
    check(v.beat.key === 'scout_job' && /Press Cob, choose Work/.test(v.beat.say[0]) && v.beat.who.b === t.ids[2], 'the elder names a real forager for the job (not the couple it introduced)', v.beat.say);
    await q("UPDATE citizens SET role = 'scout' WHERE id = $1", [t.ids[2]]);
    v = await G.check(t.user);
    check(v.beat.key === 'send' && v.beat.point === 'land:fog' && !v.beat.client, 'someone is a scout: on to The Land, and the server checks that a scout really went');
    v = await G.check(t.user);
    check(v.beat.key === 'send', 'it waits for a scout to be sent');
    const ex = (await q(`INSERT INTO expeditions (settlement_id, user_id, target_q, target_r, completes_at, path, citizen_id) VALUES ($1,$2,$3,0,NOW() + INTERVAL '40 seconds','[]',$4) RETURNING id`, [t.id, t.user, 3, t.ids[2]])).rows[0].id;
    v = await G.check(t.user);
    check(v.beat.key === 'families' && /Cob is on the way/.test(v.beat.say[0]), 'a scout sent through the game\'s own map: the elder names them', v.beat.say);
    v = await G.advance(t.user, 'families', 'place:families');
    check(v.beat.key === 'away' && v.beat.say.length === 0 && v.beat.hint === 'Cob is out scouting' && v.beat.wait_until && new Date(v.beat.wait_until).getTime() > Date.now(), 'while the scout is out the elder says nothing: the chip says who is out and until when', v.beat);
    const before = await stock(t.id);
    v = await G.check(t.user);
    check(v.beat.key === 'away' && JSON.stringify(await stock(t.id)) === JSON.stringify(before), 'nothing is said or given before they are back');
    await q("UPDATE expeditions SET completes_at = NOW() - INTERVAL '1 second' WHERE id = $1", [ex]);
    v = await G.check(t.user);
    const after = await stock(t.id);
    check(v.beat.key === 'back' && /Cob is back/.test(v.beat.say[0]) && after.wealth - before.wealth === 30 && after.food - before.food === 40 && v.beat.gift.wealth === 30, 'back: only now does the elder say so, with what they brought', [v.beat.key, v.beat.gift]);
    check((await q("SELECT status FROM expeditions WHERE id = $1", [ex])).rows[0].status === 'complete' && (await q('SELECT COUNT(*)::int AS n FROM fog_of_war WHERE user_id = $1', [t.user])).rows[0].n > 0, 'the trip was finished by the game\'s own rules: the mist has lifted there');
    v = await G.check(t.user);
    check(v.beat.key === 'back', 'seeing it on The Land is for the screen to report');
    v = await G.advance(t.user, 'back', 'place:land');
    check(v.beat.key === 'moment', 'on to the first moment');
  }

  console.log('The first moment, and goodbye');
  {
    const open = (await q('SELECT id, kind FROM moments WHERE settlement_id = $1 AND resolved_at IS NULL', [t.id])).rows;
    check(open.length === 1 && open[0].kind === 'guide_first_evening', 'reaching the beat starts the tour\'s own gentle moment at once, if none was waiting', open);
    const shown = (await require('../lib/moments').open(t.id))[0];
    check(shown && shown.options.length === 3 && shown.fallback === 'early' && /Our first evening here/.test(shown.text) && shown.subject.citizen_ids[0] === t.ids[0], 'it is asked by the villager the tour introduced, with three answers and none of them wrong', shown && shown.text);
    v = await G.check(t.user);
    check(v.beat.key === 'moment', 'it waits for the player\'s answer');
    await q("UPDATE moments SET resolved_at = NOW(), choice = 'x', outcome = 'x', auto = TRUE WHERE id = $1", [open[0].id]);
    check((await G.check(t.user)).beat.key === 'moment', 'a default taken for them does not count');
    const again = (await q('SELECT id, kind FROM moments WHERE settlement_id = $1 AND resolved_at IS NULL', [t.id])).rows;
    check(again.length === 1 && again[0].kind === 'guide_first_evening', 'and another is waiting at once: there is always one to answer', again);
    const ans = await require('../lib/moments').choose(t.id, again[0].id, 'stories');
    check(ans && /Stories until the fire burned low/.test(ans.outcome), 'answered through the moments system itself', ans);
    const before = await stock(t.id);
    v = await G.check(t.user);
    const after = await stock(t.id);
    check(v.beat.key === 'goodbye' && after.wealth - before.wealth === 100 && after.food - before.food === 100, 'answered: goodbye, with a parting gift', v.beat.say);
    check(/I do like a tidy day/.test(v.beat.say[0]) && /^By tomorrow: .+\.$/.test(v.beat.say[1]) && /a Lumber Camp would fill them faster/.test(v.beat.say[1]), 'the goodbye says what will have happened by tomorrow, from the real town', v.beat.say);
    v = await G.advance(t.user, 'goodbye');
    check(v.state === 'done' && v.finished === true && !v.beat, 'and the tour is done');
    check((await G.advance(t.user, 'goodbye')).state === 'done' && (await G.check(t.user)).state === 'done', 'a finished tour stays finished');
    const ms = (await q("SELECT key FROM player_milestones WHERE user_id = $1 AND key LIKE 'guide%'", [t.user])).rows.map(r => r.key);
    check(['guide_started', 'guide_homes', 'guide_done', 'guide:arrival', 'guide:goodbye'].every(k => ms.includes(k)), 'each beat reached is a funnel row', ms.length);
  }

  console.log('Skipping gives every gift');
  {
    const s = await mkTown(); await G.start(s.user);
    const before = await stock(s.id);
    const cost = { timber: 0, stone: 0 };
    for (let i = 0; i < 3; i++) for (const [r, n] of Object.entries(await N.nextCost(s.id, i))) cost[r] += n;
    v = await G.skip(s.user);
    const after = await stock(s.id);
    check(v.state === 'skipped' && v.skipped === true && after.timber - before.timber === cost.timber && after.stone - before.stone === cost.stone && after.wealth - before.wealth === 130 && after.food - before.food === 140, 'skipped at the first beat: the homes\' timber and stone, the scout\'s reward and the parting gift are all given', { before, after });
    check(JSON.stringify(await stock(s.id)) === JSON.stringify((await G.skip(s.user), await stock(s.id))), 'skipping twice gives nothing more');
    const m = await mkTown(); await G.start(m.user);
    await G.advance(m.user, 'arrival'); await G.advance(m.user, 'look', 'selected:villager'); await G.advance(m.user, 'family', 'opened:families');
    const mid = await stock(m.id);
    v = await G.skip(m.user);
    const end = await stock(m.id);
    check(end.timber === mid.timber && end.stone === mid.stone && end.wealth - mid.wealth === 130, 'skipped after the homes gift: that one is not given again', { mid, end });
    const e = await mkTown(); await G.start(e.user);
    await N.place(e.id, { neighbourhoodId: (await hood(e.id)).nid, plot: (await hood(e.id)).open[0] });
    const none = (await q('SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1 AND house_id IS NOT NULL', [e.id])).rows[0].n;
    await G.skip(e.user);
    const some = (await q('SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1 AND house_id IS NOT NULL', [e.id])).rows[0].n;
    check(none === 0 && some === 4, 'homes held for the player are filled when the tour is skipped', [none, some]);
  }

  console.log('Replay');
  {
    const before = await stock(t.id);
    v = await G.replay(t.user);
    check(v.state === 'active' && v.beat.key === 'arrival', 'from Help: the tour again from the start');
    await G.advance(t.user, 'arrival'); await G.advance(t.user, 'look', 'selected:villager');
    v = await G.advance(t.user, 'family', 'opened:families');
    v = await G.advance(t.user, 'homes_gift', 'area:neighbourhood');
    check(v.beat.key === 'move_in', 'what the town has already done is passed as it comes (the homes), stopping at what must be done again', v.beat.key);
    check(JSON.stringify(await stock(t.id)) === JSON.stringify(before), 'and no gift is given twice');
    const old = await mkTown();
    v = await G.replay(old.user);
    check(v.state === 'active' && v.unlock.road === true, 'an older town can ask for the tour too, and still has every place');
  }

  console.log('Building time: a builder first, and Finish now');
  {
    const b = await mkTown({ bt: true }); v = await G.start(b.user);
    check(v.beat.of === 16, 'sixteen beats with building time on');
    await G.advance(b.user, 'arrival'); await G.advance(b.user, 'look', 'selected:villager');
    v = await G.advance(b.user, 'family', 'opened:families');
    check(v.beat.key === 'builder' && /Press Ash/.test(v.beat.say[1]), 'the first thing to do is make someone a builder', v.beat.say);
    await q("UPDATE citizens SET role = 'builder' WHERE id = $1", [b.ids[0]]);
    v = await G.check(b.user);
    v = await G.advance(b.user, 'homes_gift', 'area:neighbourhood');
    const h = await hood(b.id);
    const placed = await N.place(b.id, { neighbourhoodId: h.nid, plot: h.open[0] });
    v = await G.check(b.user);
    check(placed.queued === true && v.beat.key === 'first_home' && v.finish.left === 6 && v.finish.sites.length === 1 && v.finish.sites[0].kind === 'house', 'a home is ordered, not built: the elder offers to finish it now', v.finish);
    v = await G.finishNow(b.user, v.finish.sites[0].id);
    check(v.beat.key === 'more_homes' && v.finish.left === 5 && v.finish.sites.length === 0 && (await q('SELECT COUNT(*)::int AS n FROM houses WHERE settlement_id = $1', [b.id])).rows[0].n === 1, 'finished at once, free, and the tour moves on', v.finish);
    let e = await G.finishNow(b.user, null).then(() => null, x => x);
    check(e instanceof G.GuideError && (await G.view(b.user)).finish.left === 5, 'with nothing being built there is nothing to finish, and the help is not used up', e && e.message);
    await q("UPDATE guide_progress SET data = jsonb_set(data, '{finish_used}', '6') WHERE user_id = $1", [b.user]);
    await N.place(b.id, { neighbourhoodId: h.nid, plot: h.open[1] });
    e = await G.finishNow(b.user, null).then(() => null, x => x);
    check(e && e.status === 409 && /last of my help/.test(e.message), 'six times, then the builders see to the rest');
    await G.skip(b.user);
    e = await G.finishNow(b.user, null).then(() => null, x => x);
    check(e && e.status === 409, 'and not once the tour has ended');
  }

  console.log('Later, and the routes');
  {
    let l = await G.later(t.user, 'merchant');
    check(l.say === null, 'no one-off lines while the tour is running');
    await G.skip(t.user);
    l = await G.later(t.user, 'merchant');
    check(l.say && /travelling merchant/.test(l.say[0]) && l.elder.name === 'Old Bramble' && (await G.later(t.user, 'merchant')).say === null, 'the first time a merchant comes the elder says a line; never twice');
    const r = await mkTown({ species: 'Foxes' });
    let x = await r.api('GET', '/api/guide');
    check(x.status === 200 && x.body.guide.state === 'none' && x.body.guide.elder.name === 'Aunt Russet', 'GET /api/guide', x.body);
    x = await r.api('POST', '/api/guide/replay');
    check(x.status === 200 && x.body.guide.beat.key === 'arrival' && /clever new leader/.test(x.body.guide.beat.say[0]), 'POST /api/guide/replay, in the fox elder\'s voice');
    x = await r.api('POST', '/api/guide/advance', { key: 'arrival' });
    check(x.status === 200 && x.body.guide.beat.key === 'look', 'POST /api/guide/advance');
    x = await r.api('POST', '/api/guide/check');
    check(x.status === 200 && x.body.guide.beat.key === 'look', 'POST /api/guide/check');
    x = await r.api('POST', '/api/guide/errand', { citizen_id: r.ids[0] });
    check(x.status === 404, 'the stand-in errand is gone: scouting is done on The Land');
    x = await r.api('POST', '/api/guide/later', { key: 'nope' });
    check(x.status === 404, 'an unknown later line is refused');
    x = await r.api('POST', '/api/guide/skip');
    check(x.status === 200 && x.body.guide.state === 'skipped' && x.body.guide.just[0].given.wealth === 130, 'POST /api/guide/skip gives the gifts');
    const anon = await fetch(BASE + '/api/guide'); check(anon.status === 401, 'signed-out callers are refused');
  }

  await putBack();
  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
