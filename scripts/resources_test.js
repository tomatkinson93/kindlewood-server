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
