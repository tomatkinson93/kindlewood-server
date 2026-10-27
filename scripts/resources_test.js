// scripts/resources_test.js — the resource registry (lib/resource_defs.js),
// Iron, discoveries, and every resource reaching the settlement API.
//
// Part 1 is pure (the registry and what is built from it). Part 2 uses the
// database directly (lib/resources) and a running server over HTTP against
// the same DATABASE_URL. Throwaway databases only.
//
//   node scripts/resources_test.js
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/resources_test.js

'use strict';

const fs = require('fs');
const path = require('path');
const RD = require('../lib/resource_defs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}

function part1() {
  console.log('Registry');
  check(new Set(RD.KEYS).size === RD.KEYS.length, 'keys are unique');
  check(RD.KEYS.every(k => /^[a-z]+$/.test(k)), 'keys are plain lowercase words (they are column names)');
  check(RD.BASE.join() === 'food,timber,stone,metal,wealth', 'the base five, in topbar order');
  check(RD.label('metal') === 'Iron', 'metal is shown as Iron');
  check(RD.EXTRA.length === 11 && ['copper', 'tin', 'coal', 'silver', 'goldore', 'gems', 'obsidian', 'mithril', 'moonsilver', 'bronze', 'steel'].every(k => RD.EXTRA.includes(k)),
    'eleven extras: four ores, gold ore, five rare materials, two alloys');
  check(RD.EXTRA.every(k => RD.BASE.includes(RD.def(k).follows)), 'every extra follows a base resource\'s season / Happening multiplier');
  check(RD.EXTRA.every(k => RD.def(k).discovery !== 'start'), 'no extra is known from the start');
  check(RD.DEFS.filter(d => d.discovery === 'research' || d.discovery === 'alloy').every(d => d.research), 'research and alloy resources name their project');
  check(RD.TRADEABLE.every(k => RD.def(k).weight > 0 && RD.def(k).ref_price > 0) && !RD.TRADEABLE.includes('wealth'), 'tradeables have a weight and price; wealth is the currency');

  console.log('Known / ??');
  const kn = RD.knownSet(['copper', { key: 'gems' }, 'nonsense']);
  check(kn.food && kn.metal && kn.copper && kn.gems && !kn.tin && !kn.nonsense, 'knownSet: the base five plus discoveries');
  check(RD.costLabel('tin', 1, kn) === '?? × 1', 'an undiscovered input reads "?? × 1"');
  check(RD.costLabel('copper', 3, kn).endsWith('Copper × 3') && RD.costLabel('metal', 10, kn).endsWith('Iron × 10'), 'known inputs show their name');
  check(/Mine/.test(RD.sourceHint('copper')) && /mountain/.test(RD.sourceHint('silver')) && /Smelter/.test(RD.sourceHint('steel')), 'source hints for the discovery card');

  console.log('Built from the registry');
  const market = require('../lib/market');
  check(market.TRADEABLE.includes('silver') && market.UNIT_WEIGHT.gems === RD.def('gems').weight && market.REFERENCE_PRICE.metal === 2,
    'Market: tradeables, weights and prices come from the registry (iron keeps its price)');
  check(market.maxLotUnits('gems', 100) === 500 && market.maxLotUnits('wealth', 100) === 0, 'Market: light gems carry well; wealth is not a lot');
  const HFX = require('../lib/happening_effects');
  check(HFX.RESOURCES.join() === RD.BASE.join(), 'Happenings still target the base five');
  check(HFX.STATS.metal_production.label === 'Iron production', 'Happening label says Iron');

  const fe = process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend');
  const twin = path.join(fe, 'js', 'resource-defs.js');
  if (fs.existsSync(twin)) {
    check(fs.readFileSync(twin, 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'lib', 'resource_defs.js'), 'utf8'), 'frontend js/resource-defs.js is byte-identical');
    const hfx = path.join(fe, 'js', 'happening-effects.js');
    check(fs.readFileSync(hfx, 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'lib', 'happening_effects.js'), 'utf8'), 'frontend js/happening-effects.js is byte-identical');
  } else console.log('  (frontend checkout not found — twin checks skipped)');

  console.log('Where ores come from');
  const { oreRates, MINE_ORE } = require('../lib/ores');
  const miner = (id, m = 1, effects = {}) => ({ id, name: 'M' + id, role: 'miner', profile: { outputMult: m, effects } });
  check(Object.keys(oreRates([], [miner(1)], [], new Set()).rates).length === 0, 'no Mine, no ore');
  const l1 = oreRates([{ type: 'mine', level: 1 }], [miner(1), miner(2)], [], new Set()).rates;
  check(l1.copper === MINE_ORE.copper * 2 && l1.tin > 0 && l1.coal > 0 && !l1.silver && !l1.gems, 'Lv1 Mine: copper, tin, coal from each miner');
  const l2 = oreRates([{ type: 'mine', level: 2 }], [miner(1)], [], new Set()).rates;
  check(l2.silver > 0 && !l2.goldore, 'Lv2 Mine adds silver');
  const l3 = oreRates([{ type: 'mine', level: 3 }], [miner(1)], [], new Set()).rates;
  check(!l3.goldore && !l3.gems, 'Lv3: gold ore and gems wait for Deep Veins research');
  const l3r = oreRates([{ type: 'mine', level: 3 }], [miner(1)], [], new Set(['deep_veins'])).rates;
  check(l3r.goldore > 0 && l3r.gems > 0, '…and appear once it is studied');
  const seats = oreRates([{ type: 'mine', level: 1 }], [miner(1), miner(2), miner(3)], [], new Set()).rates;
  check(seats.copper === MINE_ORE.copper * 2, 'only seated miners dig (Lv1 Mine: 2 places)');
  const perky = oreRates([{ type: 'mine', level: 3 }], [miner(1, 1.2, { ore: 0.25, 'ore:gems': 1 })], [], new Set(['deep_veins'])).rates;
  check(Math.abs(perky.copper - MINE_ORE.copper * 1.2 * 1.25) < 0.01 && Math.abs(perky.gems - MINE_ORE.gems * 1.2 * 2.25) < 0.01, 'stats and ore perks (all ores, one ore) multiply');
  const hills = oreRates([], [], [{ terrain: 'hills', level: 2 }, { terrain: 'forest', level: 1 }], new Set()).rates;
  check(hills.copper === 1.2 && hills.coal === 1.6 && !hills.silver, 'hills outposts: copper, tin, coal × level');
  const mtn = oreRates([], [], [{ terrain: 'mountain', level: 1 }], new Set()).rates;
  check(mtn.silver > 0 && !mtn.mithril && !mtn.obsidian, 'mountain outposts: silver; legendary metals need research');
  check(oreRates([], [], [{ terrain: 'mountain', level: 1 }], new Set(['starmetal', 'volcanic_lore'])).rates.mithril > 0, 'Starmetal unlocks mithril at mountain outposts');
  const C = require('../lib/careers/classes');
  const minerNodes = JSON.stringify(C.CLASSES.miner);
  check(/"type":"ore"/.test(minerNodes) && /"param":"gems"/.test(minerNodes), 'Miner perks (Ore Nose, Gem Sight, Stone Song…) raise ore finds');
  const { calculateRates } = require('../buildings');
  const cr = calculateRates([{ type: 'mine', level: 1 }], [miner(9)], 'Mice', [{ terrain: 'hills', level: 1 }]);
  check(cr.copper === MINE_ORE.copper + 0.6 && cr.stone > 0, 'calculateRates includes ores alongside the basics');
  const { applySeasonModifiers, SEASONS } = require('../seasons');
  const winter = Object.values(SEASONS).find(x => x.modifiers && x.modifiers.metal && x.modifiers.metal !== 1);
  if (winter) check(applySeasonModifiers({ copper: 1 }, winter).copper === Math.round(winter.modifiers.metal * 100) / 100, 'ores follow iron\'s season multiplier');

  console.log('Villages');
  const npcTrade = require('../lib/npc_trade');
  let ores = [];
  for (let d = 1; d <= 20; d++) for (const sp of ['badger', 'otter', 'weasel', 'mice', 'squirrel'])
    ores.push(...npcTrade.npcOrdersFor({ id: d, species: sp }, `2026-02-${String(d).padStart(2, '0')}`, []).filter(o => o.kind === 'resource' && RD.def(o.resource).group !== 'base'));
  check(ores.some(o => o.resource === 'copper' && o.side === 'sell') && ores.some(o => o.resource === 'silver'), 'villages sell and buy ores (copper, silver…)');
  check(ores.every(o => o.per === 10 && o.qty >= 10 && o.qty <= 200 && o.price >= 10), 'ores come in small lots priced per 10');
  const iron = npcTrade.npcOrdersFor({ id: 3, species: 'badger' }, '2026-02-03', []).filter(o => o.resource === 'metal');
  check(iron.every(o => o.per === 100), 'iron is still priced per 100');

  const mig = fs.readFileSync(path.join(__dirname, '..', 'migrations', fs.readdirSync(path.join(__dirname, '..', 'migrations')).find(f => f.endsWith('_resources.sql'))), 'utf8');
  check(RD.EXTRA.every(k => new RegExp(`ADD COLUMN IF NOT EXISTS ${k}\\s`).test(mig)), 'the migration adds a column for every extra');
}

async function part2() {
  const { pool } = require('../db');
  const resources = require('../lib/resources');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CRAFTING_TEST_BASE || process.env.CAREERS_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.RESOURCES_TEST_ADMIN_ID || process.env.CRAFTING_TEST_ADMIN_ID) || null;
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;

  async function user(name, forceId = null) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET username = users.username RETURNING id", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    let s = (await q('SELECT * FROM settlements WHERE user_id = $1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, wealth, food, timber, stone, metal, last_tick) VALUES ($1,$2,2,1000,500,500,500,500,NOW()) RETURNING *`, [u.id, username])).rows[0];
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  async function api(p, method, pth, body) {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }

  console.log('Columns');
  const cols = new Set((await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'settlements'")).rows.map(r => r.column_name));
  check(RD.KEYS.every(k => cols.has(k)), 'every resource is a settlements column');

  console.log('Discoveries');
  const a = await user('res');
  check((await resources.discoveredKeys(null, a.sid)).length === 0, 'a new town knows only the basics');
  check(await resources.discover(null, a.sid, 'copper', 'mine') === true, 'the first copper is a discovery');
  check(await resources.discover(null, a.sid, 'copper', 'mine') === false, '…the second is not');
  check(await resources.discover(null, a.sid, 'metal', 'mine') === false && await resources.discover(null, a.sid, 'unobtainium') === false, 'base or unknown keys are never "discovered"');
  const ev = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='discovery'", [a.sid])).rows;
  check(ev.length === 1 && /Copper/.test(ev[0].message), 'a discovery writes one settlement event');
  await q('UPDATE settlements SET tin = 5, gems = 1 WHERE id=$1', [a.sid]);
  const held = await resources.discoverHeld(null, (await q('SELECT * FROM settlements WHERE id=$1', [a.sid])).rows[0]);
  check(held.sort().join() === 'gems,tin', 'holding an extra discovers it (gains that skipped discover())');

  console.log('Settlement API');
  const g = await api(a, 'GET', '/api/game/settlement');
  const sr = g.body.settlement || {};
  check(g.status === 200 && RD.KEYS.every(k => typeof (sr.resources || {})[k] === 'number'), 'GET /settlement returns every resource');
  check(sr.resources && sr.resources.tin === 5 && sr.resources.gems === 1, '…with the right amounts');
  check(Array.isArray(sr.discovered) && ['copper', 'tin', 'gems'].every(k => sr.discovered.includes(k)), '…and what the town has discovered');
  check(Array.isArray(sr.new_discoveries) && sr.new_discoveries.length === 3 && sr.new_discoveries[0].label, '…and the unseen discovery cards');
  const seen = await api(a, 'POST', '/api/game/discoveries/seen', { keys: ['copper'] });
  check(seen.status === 200 && (await resources.unseen(null, a.sid)).map(d => d.key).sort().join() === 'gems,tin', 'marking one card seen leaves the others');
  await api(a, 'POST', '/api/game/discoveries/seen', {});
  check((await resources.unseen(null, a.sid)).length === 0, 'marking all seen');

  console.log('Tick');
  await q("UPDATE settlements SET last_tick = NOW() - interval '1 hour' WHERE id=$1", [a.sid]);
  const before = (await q('SELECT * FROM settlements WHERE id=$1', [a.sid])).rows[0];
  await api(a, 'GET', '/api/game/settlement');
  const after = (await q('SELECT * FROM settlements WHERE id=$1', [a.sid])).rows[0];
  check(RD.EXTRA.every(k => after[k] >= before[k]) && after.tin === 5 && after.gems === 1, 'the tick keeps extras (no rate yet → unchanged)');
  check(new Date(after.last_tick) > new Date(before.last_tick), 'the generalised tick UPDATE still advances last_tick');

  console.log('Mine output');
  const m = await user('mine');
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'mine',2)", [m.sid]);
  await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, career_settled_at)
           VALUES ($1,'Dig','miner',$2,'{}','{"happiness":60,"hunger":20}','adult','[]','[]',NOW())`,
    [m.sid, JSON.stringify({ strength: 8, agility: 8, endurance: 8, intelligence: 8, charisma: 8 })]);
  const g1 = await api(m, 'GET', '/api/game/settlement');
  const rt = (g1.body.settlement || {}).rates || {};
  check(rt.copper > 0 && rt.tin > 0 && rt.coal > 0 && rt.silver > 0 && !rt.gems, 'GET /settlement: a Lv2 Mine with a miner shows copper, tin, coal and silver per hour');
  await q("UPDATE settlements SET last_tick = NOW() - interval '10 hours' WHERE id=$1", [m.sid]);
  await api(m, 'GET', '/api/game/settlement');
  const after2 = (await q('SELECT copper, silver FROM settlements WHERE id=$1', [m.sid])).rows[0];
  check(after2.copper >= 2 && after2.silver >= 1, `ten hours at the Mine dig ore (copper ${after2.copper}, silver ${after2.silver})`);
  const disc = await resources.discoveredKeys(null, m.sid);
  check(disc.includes('copper') && disc.includes('silver'), 'the first ore dug is a discovery');
  const ledger = (await q('SELECT away_ledger FROM settlements WHERE id=$1', [m.sid])).rows[0].away_ledger || {};
  check(Number(ledger.produced_copper) > 0, 'the away report ledger counts ore');

  console.log('Expedition samples');
  const e = await user('exp');
  // The server's own worker also finishes due expeditions (with real luck);
  // if it claims ours first, send another.
  let es = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await q("INSERT INTO expeditions (settlement_id, user_id, target_q, target_r, completes_at, path) VALUES ($1,$2,1,1,NOW() - interval '1 minute',$3)",
      [e.sid, e.id, JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ q: i, r: 0 })))]);
    const realRandom = Math.random;
    Math.random = () => 0.001;
    try { await require('../routes/expeditions').completeExpeditions(e.sid, e.id); } finally { Math.random = realRandom; }
    es = (await q('SELECT * FROM settlements WHERE id=$1', [e.sid])).rows[0];
    if (RD.EXTRA.some(k => es[k] > 0)) break;
  }
  const got = RD.EXTRA.filter(k => es[k] > 0);
  check(got.length === 1 && es[got[0]] >= 5 && es[got[0]] <= 15, `a long expedition brought back a sample (${got[0]} ×${es[got[0]]})`);
  check(got.length === 1 && RD.def(got[0]).discovery === 'mining' && (await resources.discoveredKeys(null, e.sid)).includes(got[0]),
    '…of an ore the town can find without research, now discovered');

  console.log('Ore breakdown');
  const bd = await api(m, 'GET', '/api/game/resource-breakdown');
  const cu = (bd.body.breakdown || {}).copper;
  check(bd.status === 200 && cu && Math.abs(cu.total - rt.copper) < 0.01, `the resource breakdown has a copper entry matching its rate (${cu && cu.total}/hr)`);
  check(cu && cu.sources[0].kind === 'citizen_role' && cu.sources[0].citizens[0].name === 'Dig', '…crediting the miner by name');
  check(!(bd.body.breakdown || {}).gems, '…and nothing for ores the Mine is too shallow for');

  console.log('Level costs in metal');
  const lc = await user('lvl');
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'mine',2)", [lc.sid]);
  await q('UPDATE settlements SET timber = 5000, food = 5000, bronze = 0 WHERE id=$1', [lc.sid]);
  const lb = await api(lc, 'GET', '/api/buildings');
  const mineRow = (lb.body.buildings || []).find(b => b.id === 'mine');
  check(mineRow && mineRow.cost.bronze === 15 && mineRow.cost.timber === 180, 'a Mine Lv3 costs 15 bronze on top of timber and food');
  check((lb.body.buildings || []).find(b => b.id === 'smithy').cost.steel === undefined, '…while Lv1 buildings cost no metals');
  let br = await api(lc, 'POST', '/api/buildings/build', { buildingId: 'mine' });
  check(br.status === 400 && /bronze/i.test(br.body.error), 'without bronze the upgrade is refused');
  await q('UPDATE settlements SET bronze = 20 WHERE id=$1', [lc.sid]);
  br = await api(lc, 'POST', '/api/buildings/build', { buildingId: 'mine' });
  const lcs = (await q("SELECT s.bronze, b.level FROM settlements s JOIN buildings b ON b.settlement_id = s.id AND b.type = 'mine' WHERE s.id=$1", [lc.sid])).rows[0];
  check(br.status === 200 && lcs.level === 3 && lcs.bronze === 5, 'with it, the Mine reaches Lv3 and 15 bronze is spent');

  console.log('Tier upgrades in metal');
  const t = await user('tier');
  await q("UPDATE settlements SET tier = 'village', population = 50, food = 9000, timber = 9000, stone = 9000, metal = 9000, wealth = 9000, bronze = 0 WHERE id=$1", [t.sid]);
  for (const b of ['farm', 'lumber_camp', 'granary', 'mine', 'market', 'smithy']) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,1)', [t.sid, b]);
  const ti = await api(t, 'GET', '/api/game/tier-info');
  check(ti.body.requirements.resources.bronze === 40 && ti.body.requirementsMet.current.bronze === 0 && !ti.body.canUpgrade, 'Village → Town needs 40 bronze, and says how much you have');
  let tu = await api(t, 'POST', '/api/game/upgrade-tier', {});
  check(tu.status === 400 && /40 bronze/.test(tu.body.error), 'without it the upgrade is refused');
  await q('UPDATE settlements SET bronze = 45 WHERE id=$1', [t.sid]);
  tu = await api(t, 'POST', '/api/game/upgrade-tier', {});
  const ts = (await q('SELECT tier, bronze, food FROM settlements WHERE id=$1', [t.sid])).rows[0];
  check(tu.status === 200 && ts.tier === 'town' && ts.bronze === 5 && ts.food === 6500, 'with it: a Town, 40 bronze and the usual costs spent');
  const tc = await api(t, 'GET', '/api/game/tier-info');
  check(tc.body.requirements.resources.steel === 100 && tc.body.requirements.resources.silver === 50, 'Town → City needs 100 steel and 50 silver');

  if (ADMIN) {
    console.log('Dev Tools grant');
    const adm = await user('resadm', ADMIN);
    await q("DELETE FROM settlement_discoveries WHERE settlement_id=$1 AND key='mithril'", [adm.sid]);
    await q('UPDATE settlements SET mithril = 0 WHERE id=$1', [adm.sid]);
    const c = await api(adm, 'POST', '/api/game/cheat/resources', { mithril: 7, metal: 1 });
    check(c.status === 200 && c.body.resources.mithril === 7 && c.body.discovered.includes('mithril'), 'granting mithril adds it and discovers it');
    const neg = await api(adm, 'POST', '/api/game/cheat/resources', { mithril: -100 });
    check(neg.status === 200 && neg.body.resources.mithril === 0, 'a negative grant floors at zero');
  } else console.log('  (admin checks skipped — set CRAFTING_TEST_ADMIN_ID)');

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and CRAFTING_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
