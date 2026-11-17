// ══════════════════════════════════════════════════════════════════════════
//  neighbourhood_test — houses on plots (docs/HOME_SCENE.md Part C, step 10;
//  lib/neighbourhoods.js, lib/house_styles.js, /api/neighbourhoods).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/neighbourhood_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function pure() {
  const N = require('../lib/neighbourhoods'), ST = require('../lib/house_styles');
  console.log('Plots');
  check(N.ROWS === 2 && N.COLS === 18 && N.PLOTS === 36 && new Set(N.PLOT_ORDER).size === 36, '36 plots: two rows of 18');
  check(N.TIER_PLOTS.camp === 6 && N.TIER_PLOTS.village === 12 && N.TIER_PLOTS.town === 24 && N.TIER_PLOTS.city === 36, 'plots open with the tier: 6, 12, 24, 36');
  const cols = t => [...new Set(N.openPlots(t).map(p => p % 18))].sort((a, b) => a - b);
  check(cols('camp').join() === '7,8,9,10' && cols('village').join() === '6,7,8,9,10,11' && cols('town').length === 12 && cols('city').length === 18,
    'they open from the middle outwards: each tier is a wider block of columns');
  check(N.openPlots('village').every(p => N.openPlots('town').includes(p)) && N.openPlots('camp').every(p => N.openPlots('village').includes(p)), 'a bigger tier keeps every plot the smaller one had');
  check(N.firstFree([8, 9, 26], [8]) === 9 && N.firstFree([8], [8]) === null, 'the first free open plot');
  check(N.validPlot(0) && N.validPlot(35) && !N.validPlot(36) && !N.validPlot(-1) && !N.validPlot(1.5), 'plot numbers are 0 to 35');

  console.log('Styles');
  check(Object.keys(ST.STYLES).join() === 'thatch,timber,stone,burrow' && ST.DEFAULT === 'thatch' && Object.values(ST.STYLES).every(s => s.source === 'base'), 'four base styles; thatch by default');
  check(ST.owns('stone') && !ST.owns('gold') && !ST.owns('__proto__'), 'a town has the base styles and nothing unknown');
  const shop = { ...ST.STYLES.thatch, key: 'x', source: 'shop' };
  ST.STYLES.x = shop;
  check(!ST.owns('x') && ST.owns('x', ['x']) && ST.catalogue().find(s => s.key === 'x').owned === false, 'a style from elsewhere must be owned (ready for a later shop)');
  delete ST.STYLES.x;

  console.log('Names');
  const fam = { 7: 'Brightburrow', 8: 'Oakpaw' };
  check(N.displayName({ name: 'Willow Hut #3' }, [{ family_id: 7 }, { family_id: 7 }], fam) === 'The Brightburrow home', 'a house is named for the family in it');
  check(N.displayName({ name: 'Willow Hut #3' }, [{ family_id: 7 }, { family_id: 8 }], fam) === 'Willow Hut #3', 'a mixed house keeps its given name');
  check(N.displayName({ name: 'Willow Hut #3' }, [], fam) === 'Empty home', 'an empty one says so');
  check(N.displayName({ name: 'Rose Cottage', custom_name: true }, [{ family_id: 7 }], fam) === 'Rose Cottage', 'a name the player gave stays');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const N = require('../lib/neighbourhoods'), LIFE = require('../lib/life');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async (tier = 'camp', res = 100000) => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `nb_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const tq = -90000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber, stone) VALUES ($1,$2,2,$3,$4,0,NOW(),$5,$5) RETURNING id`, [u.id, username, tier, tq, res])).rows[0];
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, api };
  };
  const oldHut = (sid, n) => q("INSERT INTO houses (settlement_id, name, building_type, capacity, created_at) VALUES ($1,$2,'starter_house',4, NOW() + ($3 || ' seconds')::interval) RETURNING id", [sid, `Willow Hut #${n}`, n]);
  const houses = async sid => (await q('SELECT id, neighbourhood_id, plot, style, name FROM houses WHERE settlement_id = $1 ORDER BY created_at, id', [sid])).rows;
  const rows = async sid => (await q("SELECT COUNT(*)::int AS n FROM buildings WHERE settlement_id = $1 AND type = 'starter_house'", [sid])).rows[0].n;

  console.log('Old towns are seated');
  {
    const t = await mkTown('camp');
    for (let i = 1; i <= 9; i++) await oldHut(t.id, i);
    await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'starter_house',1)", [t.id]);   // out of step, as an old demolish left it
    const r = await N.seatAll();
    const hs = await houses(t.id);
    const hoods = (await q('SELECT id, name, position FROM neighbourhoods WHERE settlement_id = $1', [t.id])).rows;
    check(r.failed === 0 && hoods.length === 1 && hoods[0].name === 'The Old Quarter', 'every town has a neighbourhood after the migration ("The Old Quarter")');
    check(hs.every(h => h.neighbourhood_id === hoods[0].id && N.validPlot(h.plot)) && new Set(hs.map(h => h.plot)).size === 9, 'old houses sit on distinct plots');
    check(hs.map(h => h.plot).join() === N.PLOT_ORDER.slice(0, 9).join(), '…in the order they were built, filling plots from the middle');
    check(hs.every(h => ['thatch', 'timber', 'stone'].includes(h.style)) && new Set(hs.map(h => h.style)).size === 3, '…with a mix of styles, so an old town is not one cottage nine times');
    check(await rows(t.id) === 9, 'one housing row in buildings per house (an old mismatch is repaired)');
    const again = await N.seat(t.id);
    check(again.seated === 0 && (await houses(t.id)).map(h => h.plot).join() === hs.map(h => h.plot).join(), 'seating again changes nothing');
    const x = await t.api('GET', '/api/neighbourhoods');
    check(x.status === 200 && x.body.neighbourhoods.length === 1 && x.body.neighbourhoods[0].houses.length === 9 && x.body.tier_plots === 6 && x.body.neighbourhoods[0].open.length === 6,
      'a camp with nine homes keeps them all; six plots are open');
    check(x.body.neighbourhoods[0].free === 0 && x.body.rows === 2 && x.body.cols === 18 && x.body.styles.length === 4 && x.body.cost.timber === 400, 'the scene is told the grid, the styles and what the next home costs');
    const p = await t.api('POST', `/api/neighbourhoods/${hoods[0].id}/houses`, { plot: N.PLOT_ORDER[9] });
    check(p.status === 400 && /not open yet/.test(p.body.error), '…but it cannot build a tenth until it grows');

    // More houses than one neighbourhood holds: a second is made.
    const big = await mkTown('city');
    for (let i = 1; i <= 38; i++) await oldHut(big.id, i);
    await N.seat(big.id);
    const bh = await houses(big.id);
    const bn = (await q('SELECT id, name FROM neighbourhoods WHERE settlement_id = $1 ORDER BY position', [big.id])).rows;
    check(bn.length === 2 && bn[1].name === 'The New Quarter' && bh.filter(h => h.neighbourhood_id === bn[0].id).length === 36 && bh.filter(h => h.neighbourhood_id === bn[1].id).length === 2,
      'a town with more than 36 old homes gets a second neighbourhood for the rest');
  }

  console.log('Placing a home');
  const t = await mkTown('camp');
  let x = await t.api('GET', '/api/neighbourhoods');
  const nid = x.body.neighbourhoods[0].id, open = x.body.neighbourhoods[0].open;
  check(x.body.neighbourhoods.length === 1 && x.body.houses === 0 && open.join() === N.openPlots('camp').join() && x.body.cost.timber === 40 && x.body.cost.stone === 20, 'a new town has a neighbourhood, six open plots, and the first home costs 40 timber and 20 stone');
  {
    x = await t.api('POST', `/api/neighbourhoods/${nid}/houses`, { plot: open[2], style: 'stone' });
    const h = x.body.house;
    check(x.status === 200 && h.plot === open[2] && h.style === 'stone' && h.capacity === 4 && x.body.town.houses === 1, 'a home goes on the plot asked for, in the style asked for');
    const s = (await q('SELECT timber, stone FROM settlements WHERE id = $1', [t.id])).rows[0];
    check(s.timber === 100000 - 40 && s.stone === 100000 - 20 && await rows(t.id) === 1, 'it is paid for, and counted as a building');
    check(x.body.town.cost.timber === 80, 'the next one costs more, as before');
    x = await t.api('POST', `/api/neighbourhoods/${nid}/houses`, { plot: open[2] });
    check(x.status === 400 && /already stands/.test(x.body.error), 'two houses cannot share a plot');
    const two = await Promise.all([t.api('POST', `/api/neighbourhoods/${nid}/houses`, { plot: open[3] }), t.api('POST', `/api/neighbourhoods/${nid}/houses`, { plot: open[3] })]);
    check(two.filter(r => r.status === 200).length === 1 && two.filter(r => r.status === 400).length === 1, '…even when two requests race for it');
    x = await t.api('POST', `/api/neighbourhoods/${nid}/houses`, { plot: 0 });
    check(x.status === 400 && /not open yet/.test(x.body.error), 'a plot the tier has not opened is refused');
    x = await t.api('POST', `/api/neighbourhoods/${nid}/houses`, { plot: 99 });
    check(x.status === 400, 'so is a plot that does not exist');
    x = await t.api('POST', `/api/neighbourhoods/${nid}/houses`, { plot: open[4], style: 'palace' });
    check(x.status === 400 && /style/.test(x.body.error) && (await houses(t.id)).length === 2, 'a style the town does not own is refused, and nothing is built or paid');
    x = await t.api('POST', '/api/neighbourhoods/999999999/houses', { plot: open[4] });
    check(x.status === 404, "someone else's neighbourhood is not found");
    await q('UPDATE settlements SET timber = 5 WHERE id = $1', [t.id]);
    x = await t.api('POST', `/api/neighbourhoods/${nid}/houses`, { plot: open[4] });
    check(x.status === 400 && /Not enough timber/.test(x.body.error), 'no timber, no home');
    await q('UPDATE settlements SET timber = 100000 WHERE id = $1', [t.id]);
  }

  console.log('The old Build button still works');
  {
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'starter_house' });
    const hs = await houses(t.id);
    check(x.status === 200 && hs.length === 3 && open.includes(hs[2].plot) && hs[2].style === 'thatch', 'it puts the home on the first free open plot, thatched');
    for (let i = 0; i < 3; i++) x = await t.api('POST', '/api/buildings/build', { buildingId: 'starter_house' });
    check(x.status === 200 && (await houses(t.id)).length === 6, 'six homes fill a camp');
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'starter_house' });
    check(x.status === 400 && /Village has room for 12/.test(x.body.error), 'a seventh is refused, and the message says what a Village allows');
    const b = (await t.api('GET', '/api/buildings')).body.buildings.find(d => d.id === 'starter_house');
    check(b.currentLevel === 6 && b.maxLevel === 6 && b.canUpgrade === false, 'the buildings list shows 6 of 6');
  }

  console.log('Moving and styling');
  {
    const hs = await houses(t.id);
    const [a, b] = hs;
    await q('UPDATE settlements SET tier = $2 WHERE id = $1', [t.id, 'village']);
    const free = N.openPlots('village').find(p => !hs.some(h => h.plot === p));
    const before = (await q('SELECT timber FROM settlements WHERE id = $1', [t.id])).rows[0].timber;
    x = await t.api('POST', `/api/neighbourhoods/houses/${a.id}/move`, { plot: free });
    check(x.status === 200 && x.body.house.plot === free && x.body.swapped === null && (await q('SELECT timber FROM settlements WHERE id = $1', [t.id])).rows[0].timber === before, 'a house moves to a free plot, free and at once');
    x = await t.api('POST', `/api/neighbourhoods/houses/${a.id}/move`, { plot: b.plot });
    const now = await houses(t.id);
    check(x.status === 200 && x.body.swapped === b.id && now.find(h => h.id === a.id).plot === b.plot && now.find(h => h.id === b.id).plot === free, 'onto another home, the two swap');
    x = await t.api('POST', `/api/neighbourhoods/houses/${a.id}/move`, { plot: 0 });
    check(x.status === 400, 'not onto a plot that is not open');
    const beds0 = (await LIFE.beds(t.id)).beds;
    x = await t.api('POST', `/api/neighbourhoods/houses/${a.id}/style`, { style: 'burrow' });
    check(x.status === 200 && x.body.house.style === 'burrow' && (await LIFE.beds(t.id)).beds === beds0 && beds0 === 24, 'a style changes the look and never the beds');
    x = await t.api('POST', `/api/neighbourhoods/houses/${a.id}/style`, { style: 'palace' });
    check(x.status === 400, 'an unknown style is refused');
    const other = await mkTown('camp');
    x = await other.api('POST', `/api/neighbourhoods/houses/${a.id}/style`, { style: 'stone' });
    const y = await other.api('POST', `/api/neighbourhoods/houses/${a.id}/demolish`);
    check(x.status === 404 && y.status === 404 && (await houses(t.id)).length === 6, "nobody can touch another town's house");
  }

  console.log('Who lives where');
  {
    const hs = await houses(t.id);
    const f = (await q("INSERT INTO families (settlement_id, name) VALUES ($1,'Brightburrow') RETURNING id", [t.id])).rows[0].id;
    const c = async (name, house, fam) => (await q("INSERT INTO citizens (settlement_id, name, role, house_id, family_id, life) VALUES ($1,$2,'forager',$3,$4,'{\"happiness\":60}') RETURNING id", [t.id, name, house, fam])).rows[0].id;
    const c1 = await c('Poppy', hs[0].id, f); await c('Fenn', hs[0].id, f);
    const loner = await c('Moss', null, null);
    x = await t.api('GET', '/api/neighbourhoods');
    const h0 = x.body.neighbourhoods[0].houses.find(h => h.id === hs[0].id);
    check(h0.display === 'The Brightburrow home' && h0.residents.length === 2 && h0.residents[0].name === 'Poppy', 'a house lists who lives in it and is named for their family');
    check(x.body.unhoused.length === 1 && x.body.unhoused[0].id === loner && x.body.beds === 24 && x.body.living === 3, 'the unhoused, the beds and the living are told for the whole town');
    await t.api('PATCH', `/api/housing/${hs[0].id}/name`, { name: 'Rose Cottage' });
    x = await t.api('GET', '/api/neighbourhoods');
    check(x.body.neighbourhoods[0].houses.find(h => h.id === hs[0].id).display === 'Rose Cottage', 'a name the player gives stays');

    // Moving between houses gave +10 happiness every time.
    const hap = async id => (await q("SELECT (life->>'happiness')::int AS h FROM citizens WHERE id = $1", [id])).rows[0].h;
    await t.api('POST', '/api/housing/assign', { citizen_id: loner, house_id: hs[1].id });
    check(await hap(loner) === 70, 'someone with no home is happier for getting one (+10)');
    for (let i = 0; i < 4; i++) await t.api('POST', '/api/housing/assign', { citizen_id: loner, house_id: hs[i % 2 ? 1 : 2].id });
    check(await hap(loner) === 70, '…but moving from house to house no longer adds happiness each time');
    void c1;
  }

  console.log('Demolishing');
  {
    const hs = await houses(t.id);
    const target = hs[0];   // Poppy and Fenn live here
    const before = (await q('SELECT timber, stone FROM settlements WHERE id = $1', [t.id])).rows[0];
    x = await t.api('POST', `/api/neighbourhoods/houses/${target.id}/demolish`);
    const after = await houses(t.id);
    const s = (await q('SELECT timber, stone FROM settlements WHERE id = $1', [t.id])).rows[0];
    check(x.status === 200 && after.length === 5 && !after.some(h => h.id === target.id) && await rows(t.id) === 5, 'that house comes down, and only that one');
    check(s.timber === before.timber + 20 && s.stone === before.stone + 10, 'half its base cost comes back');
    const homeless = (await q(`SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1 AND house_id IS NULL`, [t.id])).rows[0].n;
    check(homeless === 0, 'its residents lose their bed and housing sorts itself: everyone has another');
    x = await t.api('POST', '/api/buildings/remove', { buildingId: 'starter_house' });
    check(x.status === 200 && (await houses(t.id)).length === 4 && await rows(t.id) === 4, 'the old Demolish removes one home (the newest), not the count of them all');
  }

  console.log('Where buildings stand is kept on the server');
  {
    const B = require('../routes/buildings');
    check(JSON.stringify(B.cleanLayout({ 'town-1': 'tavern', 'outskirts-2': 'farm', 'town-neighbourhood': 'neighbourhood' })) === '{"town-1":"tavern","outskirts-2":"farm","town-neighbourhood":"neighbourhood"}', 'a layout is a map of plot to building');
    check(B.cleanLayout({ 'town-1': 'tavern', 'town-2': 'tavern' }) === null && B.cleanLayout({ 'town-1': 'castle' }) === null && B.cleanLayout({ 'town 1!': 'farm' }) === null
      && B.cleanLayout([]) === null && B.cleanLayout(null) === null && B.cleanLayout({ a: 5 }) === null && B.cleanLayout(Object.fromEntries(Array.from({ length: 81 }, (_, i) => ['p' + i, 'farm']))) === null,
      'a building stands in one place; unknown buildings, odd plot names and oversized maps are refused');
    const a = await mkTown('camp');
    x = await a.api('GET', '/api/buildings/layout');
    check(x.status === 200 && x.body.layout === null, 'a town that never saved one has none (the first device sends its own)');
    x = await a.api('PUT', '/api/buildings/layout', { layout: { 'town-3': 'tavern', 'town-5': 'market' } });
    check(x.status === 200 && x.body.layout['town-3'] === 'tavern', 'PUT saves it');
    x = await a.api('GET', '/api/buildings/layout');
    check(x.body.layout && x.body.layout['town-5'] === 'market' && Object.keys(x.body.layout).length === 2, 'and every device reads the same');
    x = await a.api('PUT', '/api/buildings/layout', { layout: { 'town-3': 'tavern', 'town-4': 'tavern' } });
    check(x.status === 400 && (await a.api('GET', '/api/buildings/layout')).body.layout['town-5'] === 'market', 'a bad one is refused and the saved one stays');
    x = await a.api('PUT', '/api/buildings/layout', { layout: {} });
    check(x.status === 200 && JSON.stringify((await a.api('GET', '/api/buildings/layout')).body.layout) === '{}', 'an empty layout is a layout (everything put back)');
    const b = await mkTown('camp');
    check((await b.api('GET', '/api/buildings/layout')).body.layout === null, 'each town has its own');
  }

  console.log('Tier upgrades count kinds of building');
  {
    const v = await mkTown('camp');
    for (let i = 0; i < 4; i++) await v.api('POST', '/api/buildings/build', { buildingId: 'starter_house' });
    x = await v.api('GET', '/api/game/tier-info');
    const cur = x.body.requirementsMet && x.body.requirementsMet.current;
    check(x.status === 200 && cur && cur.buildings === 1 && x.body.requirementsMet.buildings === false, 'four homes are one building (the Neighbourhood), not four');
    await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'farm',1), ($1,'lumber_camp',2)", [v.id]);
    x = await v.api('GET', '/api/game/tier-info');
    check(x.body.requirementsMet.current.buildings === 3 && x.body.requirementsMet.buildings === true, 'homes and two other buildings make the three a Village needs');
    check((x.body.requirements.unlocks || []).some(u => /Up to 12 Willow Huts/.test(u)), 'the upgrade screen says a Village has room for 12 homes');
  }

  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
