// Dungeons on the world map (docs/DUNGEONS.md §6; lib/dungeon_map.js): they
// appear near every town, word of them reaches the towns near enough to walk
// there, a party of four is sent in from the map, each town goes in once, the
// first town to clear one is remembered, and after three days it is gone.
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 node scripts/dungeon_map_test.js
'use strict';
const jwt = require('jsonwebtoken');
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

async function main() {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const M = require('../lib/dungeon_map');
  const D = require('../lib/dungeons');
  const TU = require('../lib/tuning');
  const LANDS = require('../lib/dungeon_gen').LANDS;
  const dist = (a, b) => require('../mapgen').hexDistanceWrapped(a.q, a.r, b.q, b.r);
  const RUN = Date.now().toString(36);
  let seq = 0;
  // A town with six strong grown-ups, standing on the tile given (or parked off the map).
  async function player(name, at) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',1000,1000,1000,1000,1000,$3,$4,NOW()) RETURNING id`, [u.id, username, at ? at.q : 9000 + (Date.now() % 100000) + seq * 40, at ? at.r : 0])).rows[0];
    const roles = ['soldier', 'archer', 'idle', 'idle', 'idle', 'idle'], cits = [];
    for (let i = 0; i < 6; i++) cits.push((await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage) VALUES ($1,$2,'female',$3,$4,$5,'adult') RETURNING id`,
      [s.id, `${name}${i}${RUN}`, roles[i], JSON.stringify({ strength: 30, agility: 14, endurance: 20, intelligence: 12, charisma: 10 }), JSON.stringify({ combat: 8 })])).rows[0].id);
    return { id: u.id, sid: s.id, q: at ? at.q : null, r: at ? at.r : null, cits, username, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // The walk is over: a party on the road is at the door; a party walking home is home.
  const arrive = async p => { await q(`UPDATE dungeon_runs SET arrives_at = NOW() - interval '1 second' WHERE settlement_id=$1 AND status='travelling'`, [p.sid]); return D.arrivals(p.sid); };
  const walkHome = async p => { await q(`UPDATE dungeon_runs SET home_at = NOW() - interval '1 second' WHERE settlement_id=$1 AND owed IS NOT NULL`, [p.sid]); return D.arrivals(p.sid); };
  const wealthOf = async p => Number((await q('SELECT wealth FROM settlements WHERE id=$1', [p.sid])).rows[0].wealth);
  const away = async (p, ids) => (await D.busyCitizenIds(ids)).length;
  // Walk a run to its end, every fight won outright (Dev Tools' "win the open fight").
  async function clear(p) {
    let v = (await D.current(p.id)).run;
    for (let g = 0; g < 80 && v && v.status === 'active'; g++) {
      if (v.pending && v.pending.kind === 'battle') { const r = await D.adminWin(p.id); v = r.run; continue; }
      if (v.pending) { v = (await D.choose(p.id, (v.pending.options || []).some(o => o.key === 'deeper') ? 'deeper' : 'rest')).run; continue; }
      if (!v.moves.length) break;
      v = (await D.move(p.id, v.moves[0])).run;
    }
    return v;
  }
  // Two free tiles for the test's towns, two apart, with land around them.
  const free = (await q(
    `SELECT t.q, t.r FROM tiles t
      WHERE NOT EXISTS (SELECT 1 FROM settlements s WHERE s.tile_q=t.q AND s.tile_r=t.r)
        AND NOT EXISTS (SELECT 1 FROM npc_settlements n WHERE n.tile_q=t.q AND n.tile_r=t.r)
        AND NOT EXISTS (SELECT 1 FROM outposts o WHERE o.tile_q=t.q AND o.tile_r=t.r)
      ORDER BY md5(t.q::text || ',' || t.r::text || $1)`, [RUN])).rows;
  const wasOn = await TU.switchOn('dungeons.on');
  await TU.setSwitch('dungeons.on', true);
  const mine = [];
  try {
    console.log('Where dungeons appear');
    const rng = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
    const easy = Array.from({ length: 200 }, () => M._pickTier(rng, true)), any = Array.from({ length: 2000 }, () => M._pickTier(rng, false));
    check(easy.every(t => t === 'green' || t === 'yellow') && ['green', 'yellow', 'orange', 'red', 'purple'].every(t => any.includes(t))
      && any.filter(t => t === 'green').length > any.filter(t => t === 'purple').length * 1.5,
    'a town with no easy dungeon in reach gets a green or yellow one; otherwise any skull, the hard ones less often');
    const ring = M._ring({ q: 1, r: 38 }, 2, 6, 40, 40);
    check(ring.length === 3 * 6 * 7 - 3 * 1 * 2 && ring.every(s => s.q >= 0 && s.q < 40 && s.r >= 0 && s.r < 40 && dist({ q: 1, r: 38 }, s) >= 2 && dist({ q: 1, r: 38 }, s) <= 6),
      'a new dungeon is put two to six tiles from the town, and the world wraps', String(ring.length));

    const home = free[0], a = await player('MapA', home);
    const b = await player('MapB', free.find(t => dist(t, home) >= 1 && dist(t, home) <= 2) || free[1]);
    const far = await player('MapFar');
    mine.push(a, b, far);
    await M.expireAll();
    check((await M.live()).length === 0, 'Dev Tools can send every map dungeon away');
    const made = await M.spawn(rng);
    const live = await M.live(), near = live.filter(d => dist(a, d) <= M.REACH);
    check(made > 0 && near.length >= M.PER_TOWN && near.some(d => d.tier === 'green' || d.tier === 'yellow'),
      'after a top-up a town has two dungeons within reach, one of them green or yellow', `${made} made, ${near.length} near`);
    const towns = (await q('SELECT tile_q AS q, tile_r AS r FROM settlements WHERE tile_q >= 0 AND tile_q < 40 AND tile_r >= 0 AND tile_r < 40')).rows;
    check(towns.every(t => live.filter(d => dist(t, d) <= M.REACH).length >= M.PER_TOWN), 'and so has every other town on the map');
    const tiles = new Map((await q('SELECT q, r, terrain FROM tiles')).rows.map(t => [`${t.q},${t.r}`, t.terrain]));
    const busy = new Set((await q(`SELECT tile_q AS q, tile_r AS r FROM settlements UNION SELECT tile_q, tile_r FROM npc_settlements UNION SELECT tile_q, tile_r FROM outposts
                                   UNION SELECT q, r FROM withered_camps WHERE cleared_at IS NULL`)).rows.map(t => `${t.q},${t.r}`));
    check(live.every(d => !busy.has(`${d.q},${d.r}`)) && new Set(live.map(d => `${d.q},${d.r}`)).size === live.length,
      'each is on a tile of its own: no town, village, outpost, camp or other dungeon there');
    check(live.every(d => LANDS.includes(d.terrain) && tiles.get(`${d.q},${d.r}`) === d.terrain && d.layout && d.layout.terrain === d.terrain && d.layout.combat === 'board'),
      'its land is the tile\'s land, so its foes are that land\'s, and it is fought on the board');
    check(towns.every(t => { const names = live.filter(d => dist(t, d) <= M.REACH).map(d => d.layout.name); return new Set(names).size === names.length; }),
      'no town sees two dungeons of the same name');
    const hrs = live.map(d => (new Date(d.expires_at) - Date.now()) / 3600e3);
    check(hrs.every(h => h > M.LIFE_H - 4.1 && h < M.LIFE_H + 4.1) && new Set(hrs.map(h => Math.round(h * 10))).size > 1, 'each stays three days, give or take a few hours, so they do not all change at once');
    check((await M.spawn(rng)) === 0, 'a second top-up straight after makes none');

    console.log('Word reaches the towns near enough to walk there');
    let r = await api(a, 'GET', '/api/dungeons');
    check(r.status === 200 && r.body.dungeons.length === 0 && r.body.in_dungeon === null && r.body.rules.reach === M.REACH && r.body.rules.party === 4 && r.body.rules.hours === 72,
      'a town that has heard of none has an empty list, and is told the rules');
    r = await api(a, 'POST', `/api/dungeons/${near[0].id}/enter`, { citizen_ids: a.cits.slice(0, 4) });
    check(r.status === 400 && /scout/i.test(r.body.error), 'and cannot send a party to one it has not found', r.body.error);
    const told = await M.tell();
    r = await api(a, 'GET', '/api/dungeons');
    const list = r.body.dungeons;
    check(told > 0 && list.length === near.length && list.every(d => d.in_reach && d.distance <= M.REACH && d.mine === null && d.cleared_by === 0) && list.every((d, i) => !i || d.distance >= list[i - 1].distance),
      'once word is out, the town lists every dungeon within reach, nearest first', `${list.length} listed`);
    const fog = (await q('SELECT tile_q, tile_r FROM fog_of_war WHERE user_id=$1', [a.id])).rows.map(t => `${t.tile_q},${t.tile_r}`);
    const news = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='dungeon'", [a.sid])).rows.map(e => e.message);
    check(near.every(d => fog.includes(`${d.q},${d.r}`)) && news.length === near.length && news.every(m => /Word has reached the town of a dungeon nearby: .+ \(.+\)\. It will be gone in 3 days\./.test(m)),
      'its tile is lit on the town\'s map and the town\'s news says so', news[0]);
    check((await M.tell()) === 0 && (await q("SELECT 1 FROM settlement_events WHERE settlement_id=$1 AND type='dungeon'", [a.sid])).rows.length === near.length, 'a town is told of each dungeon once');
    const g = list.find(d => d.tier === 'green' || d.tier === 'yellow'), other = list.find(d => d.id !== g.id);
    check(g.name && g.skull && g.tier_name && g.floors >= 1 && g.intro && g.suggested_party && g.band && g.hours_left > 60 && g.terrain && g.q != null,
      'a dungeon\'s card names it, its skull, its floors, who lives there, who it is written for and how long it has', `${g.name}, ${g.skull} ${g.tier_name}, ${g.band}`);
    r = await api(a, 'GET', '/api/dungeons/' + g.id);
    check(r.status === 200 && r.body.dungeon.id === g.id && r.body.dungeon.name === g.name, 'one card can be read by itself');
    r = await api(far, 'GET', '/api/dungeons/' + g.id);
    check(r.status === 404 && (await api(far, 'GET', '/api/dungeons')).body.dungeons.length === 0, 'a town far away has not heard of it');
    r = await api(a, 'GET', '/api/map/world');
    const tile = (r.body.tiles || []).find(t => t.q === g.q && t.r === g.r);
    check(tile && tile.revealed && tile.dungeon && tile.dungeon.id === g.id && tile.dungeon.tier === g.tier && tile.dungeon.busy === false && tile.dungeon.in_reach === true
      && (r.body.tiles || []).filter(t => t.dungeon).length === list.length, 'the map carries the card on the dungeon\'s tile, for the skull and the tile\'s panel');

    console.log('Sending a party');
    await q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [far.id, g.q, g.r]);
    r = await api(far, 'GET', '/api/dungeons');
    check(r.body.dungeons.length === 1 && r.body.dungeons[0].in_reach === false, 'a town that has scouted the tile but stands off the map sees it, out of reach');
    r = await api(far, 'POST', `/api/dungeons/${g.id}/enter`, { citizen_ids: far.cits.slice(0, 4) });
    check(r.status === 400 && /too far/i.test(r.body.error), 'and cannot walk there', r.body.error);
    r = await api(a, 'POST', `/api/dungeons/${g.id}/enter`, { citizen_ids: a.cits.slice(0, 5) });
    const none = await api(a, 'POST', `/api/dungeons/${g.id}/enter`, { citizen_ids: [] });
    check(r.status === 400 && /one to 4/.test(r.body.error) && none.status === 400, 'a party is one to four', r.body.error);
    const WALK = D.CONFIG.WALK_SECS, there = dist(a, g) * WALK;
    r = await api(a, 'GET', '/api/dungeons/' + g.id);
    check(WALK === 30 && r.body.dungeon.walk_secs === there && there > 0, 'the card says how long the walk is: half a minute a tile', `${dist(a, g)} tiles, ${there}s`);
    r = await api(a, 'POST', `/api/dungeons/${g.id}/enter`, { citizen_ids: a.cits.slice(0, 4) });
    let left = r.body.run ? (new Date(r.body.run.arrives_at) - Date.now()) / 1000 : 0;
    check(r.status === 200 && r.body.run.status === 'travelling' && r.body.run.can_recall && r.body.run.moves.length === 0 && !r.body.run.can_leave && r.body.run.walk_secs === there && Math.abs(left - there) < 5
      && r.body.run.dungeon.name === g.name && r.body.run.party.length === 4, 'four citizens sent from the map set out on foot: on the road until they reach the door', r.body.error || `${Math.round(left)}s to go`);
    r = await api(a, 'GET', '/api/dungeons');
    check(r.body.in_dungeon === g.id && r.body.dungeons.find(d => d.id === g.id).mine === 'travelling' && (await away(a, a.cits)) === 4, 'the list knows the party is on its way, and the four are busy');
    r = await api(a, 'GET', '/api/map/world');
    const tl = (r.body.tiles || []).filter(t => t.dungeon);
    check(tl.find(t => t.dungeon.id === g.id).dungeon.busy === false && tl.filter(t => t.dungeon.id !== g.id).every(t => t.dungeon.busy === true), 'and every other dungeon on the map says the town is busy');
    r = await api(a, 'POST', `/api/dungeons/${other.id}/enter`, { citizen_ids: a.cits.slice(4, 6) });
    check(r.status === 400 && /already has a party/.test(r.body.error), 'one party out at a time', r.body.error);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'a' });
    check(r.status === 404, 'nothing can be done in the dungeon until they are there');
    const T2 = require('../lib/travel');
    let roads = (await T2.journeysFor({ id: a.sid, tile_q: a.q, tile_r: a.r }, 'mice')).filter(j => j.kind === 'dungeon');
    check(roads.length === 1 && roads[0].from.q === a.q && roads[0].from.r === a.r && roads[0].to.q === g.q && roads[0].to.r === g.r && roads[0].returns_at === null && roads[0].can_recall
      && /^Walking to /.test(roads[0].title) && / and 3 more$/.test(roads[0].citizen.name), 'the map draws the party walking from the town to the dungeon', roads[0] && `${roads[0].citizen.name}: ${roads[0].title}`);

    console.log('Called back on the road');
    await q(`UPDATE dungeon_runs SET started_at = NOW() - interval '20 seconds' WHERE settlement_id=$1 AND status='travelling'`, [a.sid]);
    r = await api(a, 'POST', '/api/dungeons/run/recall');
    left = r.body.run ? (new Date(r.body.run.home_at) - Date.now()) / 1000 : 0;
    check(r.status === 200 && r.body.run.status === 'recalled' && r.body.run.walking_home && Math.abs(left - 20) < 4, 'a party called back walks home the way it came: as long as it had walked', r.body.error || `${Math.round(left)}s`);
    r = await api(a, 'GET', '/api/dungeons');
    roads = (await T2.journeysFor({ id: a.sid, tile_q: a.q, tile_r: a.r }, 'mice')).filter(j => j.kind === 'dungeon');
    check(r.body.in_dungeon === null && r.body.dungeons.find(d => d.id === g.id).mine === 'recalled' && (await away(a, a.cits)) === 4 && roads.length === 1 && roads[0].to.q === a.q && roads[0].recalled
      && (await api(a, 'POST', '/api/dungeons/run/recall')).status === 400, 'they are busy until they are home, and drawn walking back');
    check((await walkHome(a)) === 1 && (await away(a, a.cits)) === 0 && (await api(a, 'GET', '/api/dungeons')).body.dungeons.find(d => d.id === g.id).mine === null
      && /were called back on the road to/.test((await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='dungeon' ORDER BY id DESC LIMIT 1", [a.sid])).rows[0].message),
    'once home they are free, the town is told, and the dungeon is not used up');

    console.log('At the door, and home again');
    r = await api(a, 'POST', `/api/dungeons/${g.id}/enter`, { citizen_ids: a.cits.slice(0, 4) });
    check(r.status === 200 && r.body.run.status === 'travelling', 'the town sends a party again', r.body.error);
    await q(`UPDATE dungeon_runs SET arrives_at = NOW() - interval '1 second' WHERE settlement_id=$1 AND status='travelling'`, [a.sid]);
    r = await api(a, 'GET', '/api/dungeons/run');
    check(r.body.run && r.body.run.status === 'active' && r.body.run.moves.length > 0 && r.body.run.can_leave && !r.body.run.can_recall && r.body.run.arrives_at === null
      && (await api(a, 'GET', '/api/dungeons')).body.dungeons.find(d => d.id === g.id).mine === 'active', 'when the time is up they are at the door, and the way in is open');
    r = await api(a, 'POST', '/api/dungeons/run/recall');
    check(r.status === 400, 'a party at the door cannot be called back: it turns back instead');
    r = await api(a, 'POST', '/api/dungeons/run/leave');
    left = r.body.run ? (new Date(r.body.run.home_at) - Date.now()) / 1000 : 0;
    check(r.status === 200 && r.body.run.status === 'left' && r.body.run.walking_home && Math.abs(left - there) < 5 && (await away(a, a.cits)) === 4, 'turning back at the door, the party walks home and is busy until it is there', `${Math.round(left)}s`);
    r = await api(a, 'POST', `/api/dungeons/${g.id}/enter`, { citizen_ids: a.cits.slice(4, 6) });
    check(r.status === 400 && /already been/.test(r.body.error) && (await api(a, 'GET', '/api/dungeons')).body.dungeons.find(d => d.id === g.id).mine === 'left',
      'each town goes into a dungeon once', r.body.error);
    r = await api(a, 'POST', `/api/dungeons/${other.id}/enter`, { citizen_ids: a.cits.slice(0, 2) });
    check(r.status === 400 && /busy|away|dungeon/i.test(r.body.error || ''), 'and those walking home cannot be sent again yet', r.body.error);
    await walkHome(a);
    check((await away(a, a.cits)) === 0 && !(await api(a, 'GET', '/api/dungeons/run')).body.last.walking_home, 'home, they are free');

    console.log('The first to clear it');
    r = await api(b, 'POST', `/api/dungeons/${g.id}/enter`, { citizen_ids: b.cits.slice(0, 2) });
    check(r.status === 200 && r.body.run.party.length === 2, 'another town has its own go at the same dungeon, with a party of two', r.body.error);
    const T = require('../lib/dungeon_trophies');
    const gRow = (await q('SELECT * FROM dungeons WHERE id=$1', [g.id])).rows[0], want = T.prize(gRow);
    r = await api(b, 'GET', '/api/dungeons/' + g.id);
    check(want && T.TROPHIES[want.foe] && require('../lib/tactics_foes').FOES[want.foe].lands.includes(gRow.terrain) && r.body.dungeon.prize && r.body.dungeon.prize.title === want.title
      && r.body.dungeon.prize.wealth === T.MOUNTS[g.tier].wealth && / on (oak|copper)$/.test(want.title),
    'a dungeon nobody has cleared shows what the first town wins: its boss\'s trophy, on the mount of its skull', want && want.title);
    await arrive(b);
    const hadWealth = await wealthOf(b), newsBefore = (await q("SELECT COUNT(*)::int AS n FROM settlement_events WHERE settlement_id=$1 AND type='dungeon'", [a.sid])).rows[0].n;
    let v = await clear(b);
    const res1 = (await q("SELECT result FROM dungeon_runs WHERE settlement_id=$1 AND dungeon_id=$2", [b.sid, g.id])).rows[0].result;
    const lastNews = async p => (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='dungeon' ORDER BY id DESC LIMIT 1", [p.sid])).rows[0].message;
    const onRoad = await lastNews(b);
    r = await api(b, 'GET', '/api/dungeons/run');
    check(v && v.status === 'cleared' && res1 && res1.first_clear === true && res1.trophy && res1.trophy.title === want.title && r.body.last.walking_home && r.body.last.result.kept.wealth === res1.kept.wealth,
      'the first town to clear it wins the trophy there and then, and sets off home with it', res1.trophy && res1.trophy.title);
    check((await wealthOf(b)) === hadWealth && !/cleared/.test(onRoad) && (await api(b, 'GET', '/api/dungeons')).body.hall.total === 0 && (await away(b, b.cits)) === 2
      && (await q('SELECT COUNT(*)::int AS n FROM inventory WHERE settlement_id=$1', [b.sid]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n >= 0,
    'while they walk, the town has neither the wealth, the news nor the trophy on its wall');
    const homeRoad = (await require('../lib/travel').journeysFor({ id: b.sid, tile_q: b.q, tile_r: b.r }, 'mice')).filter(j => j.kind === 'dungeon');
    check(homeRoad.length === 1 && homeRoad[0].from.q === g.q && homeRoad[0].to.q === b.q && homeRoad[0].to.r === b.r && /^Coming home from /.test(homeRoad[0].title) && !homeRoad[0].can_recall, 'the map draws them coming home');
    await walkHome(b);
    const line = await lastNews(b);
    check(/the first of any town to do it/.test(line) && (await wealthOf(b)) === hadWealth + res1.kept.wealth + want.wealth && line.includes(`🏆 ${want.title} hangs in the trophy hall (+${want.wealth} wealth)`)
      && (await away(b, b.cits)) === 0 && (await walkHome(b)) === 0 && (await wealthOf(b)) === hadWealth + res1.kept.wealth + want.wealth,
      'home: the loot and the trophy\'s wealth reach the town, once, and its news says so', line);
    r = await api(b, 'GET', '/api/dungeons');
    const hall = r.body.hall;
    check(hall && hall.total === 1 && hall.have === 1 && hall.kinds === 35 && hall.trophies[0].title === want.title && hall.trophies[0].count === 1 && hall.trophies[0].last.dungeon === g.name && hall.trophies[0].last.party.length === 2,
      'the trophy hangs in the town\'s hall: one of thirty-five');
    await q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [a.id, b.q, b.r]);
    const bTile = ((await api(a, 'GET', '/api/map/world')).body.tiles || []).find(t => t.q === b.q && t.r === b.r);
    const brd = await fetch(`${BASE}/api/stats/board/trophies`).then(x => x.json());
    const bRow = (brd.rows || []).concat(brd.you ? [brd.you] : []).find(x => x.name === b.username) || ((await q('SELECT 1')).rows && null);
    const standing = (await T.standings()).find(x => x.username === b.username);
    check(bTile && bTile.settlement && bTile.settlement.trophies === 1 && brd.columns && brd.columns.join() === 'Trophies,Kinds' && standing && standing.n === 1 && standing.kinds === 1
      && (!bRow || (bRow.values[0] === 1 && bRow.values[1] === '1 of 35')),
    'other towns see the trophy count on the town, and the Dungeon Trophies board ranks it', JSON.stringify(brd.columns));
    const heard = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='dungeon' ORDER BY id DESC LIMIT 1", [a.sid])).rows[0].message;
    check((await q("SELECT COUNT(*)::int AS n FROM settlement_events WHERE settlement_id=$1 AND type='dungeon'", [a.sid])).rows[0].n === newsBefore + 1 && heard === `💀 ${b.username} was the first town to clear ${g.name}, and took ${want.name} home.`,
      'the other towns that knew of the dungeon hear who got there first', heard);
    r = await api(a, 'GET', '/api/dungeons/' + g.id);
    check(r.body.dungeon.cleared_by === 1 && r.body.dungeon.first_clear === b.username && r.body.dungeon.prize === null && (await api(a, 'GET', '/api/dungeons')).body.hall.total === 0,
      'and the dungeon\'s card names that town to everyone; the prize is gone');
    const c = await player('MapC', free.find(t => dist(t, g) <= 3 && dist(t, home) >= 1 && !(t.q === b.q && t.r === b.r) && !(t.q === g.q && t.r === g.r)) || free[2]);
    mine.push(c);
    await M.tell();
    r = await api(c, 'POST', `/api/dungeons/${g.id}/enter`, { citizen_ids: c.cits.slice(0, 4) });
    await arrive(c);
    v = r.status === 200 ? await clear(c) : null;
    await walkHome(c);
    const res2 = v ? (await q("SELECT result FROM dungeon_runs WHERE settlement_id=$1 AND dungeon_id=$2", [c.sid, g.id])).rows[0].result : null;
    check(v && v.status === 'cleared' && res2 && !res2.first_clear && !res2.trophy && (await api(a, 'GET', '/api/dungeons/' + g.id)).body.dungeon.cleared_by === 2
      && (await api(a, 'GET', '/api/dungeons/' + g.id)).body.dungeon.first_clear === b.username && (await api(c, 'GET', '/api/dungeons')).body.hall.total === 0
      && (await q('SELECT COUNT(*)::int AS n FROM dungeon_trophies WHERE dungeon_id=$1', [g.id])).rows[0].n === 1, 'a town founded later hears of it too, and clears it second: the loot, but no trophy', r.body.error);
    check(T.KINDS === 35 && Object.keys(T.TROPHIES).every(k => require('../lib/tactics_foes').FOES[k].rank === 'boss') && Object.values(require('../lib/tactics_foes').FOES).filter(f => f.rank === 'boss').every(f => T.TROPHIES[f.key || Object.keys(require('../lib/tactics_foes').FOES).find(k => require('../lib/tactics_foes').FOES[k] === f)]),
      'every boss of the board has a trophy, on five mounts');

    console.log('Gone after three days');
    r = await api(a, 'POST', `/api/dungeons/${other.id}/enter`, { citizen_ids: a.cits.slice(0, 4) });
    await arrive(a);
    check(r.status === 200, 'a party goes into another dungeon', r.body.error);
    await q(`UPDATE dungeons SET expires_at = NOW() - interval '10 minutes' WHERE id=$1`, [other.id]);
    await D.sweep();
    r = await api(a, 'GET', '/api/dungeons');
    check(!r.body.dungeons.some(d => d.id === other.id) && (await api(a, 'GET', '/api/dungeons/' + other.id)).status === 404 && (await api(a, 'GET', '/api/dungeons/run')).body.run.status === 'active',
      'when its time is up it leaves the list and the map, and a party inside has a little while to finish');
    r = await api(b, 'POST', `/api/dungeons/${other.id}/enter`, { citizen_ids: b.cits.slice(0, 4) });
    check(r.status === 404 && /gone/.test(r.body.error), 'nobody new can go in', r.body.error);
    await q(`UPDATE dungeons SET expires_at = NOW() - make_interval(hours => $2) WHERE id=$1`, [other.id, M.GRACE_H + 1]);
    await D.sweep();
    r = await api(a, 'GET', '/api/dungeons/run');
    check(!r.body.run && r.body.last && r.body.last.status === 'timed_out', 'two hours on, the party comes home with what it found');
    const before = (await M.live()).filter(d => dist(a, d) <= M.REACH).length;
    await M.spawn(rng);
    const after = (await M.live()).filter(d => dist(a, d) <= M.REACH);
    check(before < M.PER_TOWN ? after.length >= M.PER_TOWN : after.length >= before, 'and another dungeon opens somewhere near in its place', `${before} → ${after.length}`);

    console.log('Dev Tools');
    r = await api(a, 'POST', '/api/dungeons/admin/map', {});
    check(r.status === 403, 'only an admin can make the map\'s dungeons come and go');
  } finally {
    await TU.setSwitch('dungeons.on', wasOn);
    // The test's towns go, so the map is as it was (their dungeons stay: they are every town's).
    for (const p of mine) {
      await q('DELETE FROM dungeon_runs WHERE settlement_id=$1', [p.sid]).catch(() => {});
      await q('UPDATE settlements SET tile_q=$2, tile_r=0 WHERE id=$1', [p.sid, 9000 + p.sid * 40]).catch(() => {});
    }
    await M.tell().catch(() => {});
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
