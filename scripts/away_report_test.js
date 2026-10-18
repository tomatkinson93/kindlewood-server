// "Since you were gone…" + offline catch-up: season segments, season ×
// Happening production hours, the hourly citizen simulation catch-up, the
// source split and the report endpoint. Stubbed db; never touches Postgres.
// Run from the server root: node scripts/away_report_test.js
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const assert = require('assert');
const http = require('http');

// ── stub ../db ────────────────────────────────────────────────────────────
const DB = { happenings: [], writes: [], handlers: [] };
async function q(sql, params = []) {
  for (const [re, fn] of DB.handlers) if (re.test(sql)) return fn(sql, params);
  if (/FROM happenings WHERE enabled = TRUE/.test(sql)) return { rows: DB.happenings };
  if (/^\s*(UPDATE|INSERT)/.test(sql)) { DB.writes.push({ sql, params }); return { rows: [{ id: 1 }], rowCount: 1 }; }
  return { rows: [] };
}
require.cache[require.resolve('../db')] = { id: 'db', filename: require.resolve('../db'), loaded: true, exports: { query: q, pool: { connect: async () => ({ query: q, release() {} }) } } };

const S = require('../seasons');
const A = require('../lib/away_report');
const SIM = require('../simulation');
const happenings = require('../lib/happenings');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}
const H = 3600e3;
const T0 = Date.parse('2026-11-05T03:00:00Z');   // post-cutover: 7h seasons

(async () => {
  console.log('Seasons over an absence');
  await test('1a seasonSegments cuts at season boundaries and covers the span', () => {
    const segs = S.seasonSegments(T0, T0 + 10 * H);
    assert.deepStrictEqual(segs.map(s => s.season.id), ['autumn', 'winter', 'spring']);
    assert.deepStrictEqual(segs.map(s => (s.toMs - s.fromMs) / H), [2, 7, 1]);
    assert.strictEqual(segs[0].fromMs, T0); assert.strictEqual(segs[2].toMs, T0 + 10 * H);
  });
  await test('1b an empty span has no segments', () => assert.deepStrictEqual(S.seasonSegments(T0, T0), []));

  console.log('Production hours (season × Happening)');
  await test('2a each season multiplies only the hours it covered', () => {
    const e = A.effectiveProductionHours([], T0, T0 + 10 * H);
    // food: autumn 1.10×2 + winter 0.40×7 + spring 1.20×1 = 6.2 (was 10 × the season at login)
    assert.ok(Math.abs(e.food - 6.2) < 1e-9, e.food);
    assert.ok(Math.abs(e.timber - (1.1 * 2 + 1 * 7 + 1 * 1)) < 1e-9, e.timber);
  });
  await test('2b a +20% Happening covering 2h of the absence boosts only those 2h', () => {
    const defs = [{ id: 'fest', enabled: true, archived: false, rule: { type: 'once', start: new Date(T0 + 3 * H).toISOString(), end: new Date(T0 + 5 * H).toISOString() },
      effects: [{ type: 'modifier', stat: 'all_production', value: 0.2 }] }];
    const plain = A.effectiveProductionHours([], T0, T0 + 10 * H);
    const boosted = A.effectiveProductionHours(defs, T0, T0 + 10 * H);
    // The 2 boosted hours are in winter: +0.2 × 0.40 × 2 = +0.16 food hours.
    assert.ok(Math.abs(boosted.food - plain.food - 0.16) < 1e-9, boosted.food - plain.food);
  });
  await test('2c applyTick uses this helper (no single-season shortcut left)', () => {
    const src = require('fs').readFileSync(require.resolve('../routes/game'), 'utf8');
    assert.ok(/awayReport\.effectiveProductionHours\(/.test(src));
    assert.ok(!/applySeasonModifiers\(baseRates, season\);\n\s*\/\/ Happening production/.test(src));
  });

  console.log('Citizen simulation catch-up');
  const mkCit = (id, over = {}) => Object.assign({ id, name: 'C' + id, gender: id % 2 ? 'male' : 'female', life_stage: 'adult', role: 'idle', house_id: 1,
    life: { happiness: 80 }, hidden_traits: [], visible_traits: [], stats: {}, skills: {}, partner_id: null, generation: 1 }, over);
  const ctxAt = (at, hMods = {}) => ({ at, season: S.seasonAt(at), hMods });
  await test('3a relationship gain adds up per hour (24h away ≈ 24 hourly ticks)', () => {
    const a = mkCit(1), b = mkCit(2);
    const sim = { pairs: [[a, b]], rels: {}, houses: { 1: { id: 1, capacity: 2, occupants: 2 } }, newPartners: [], events: [], births: [] };
    for (let h = 0; h < 24; h++) SIM._hourly.relationships(sim, ctxAt(T0 + h * H));
    const gain = sim.rels['1_2'].gain;
    // same house 0.6 + base 0.05, × (1 + 0.4 × 0.8) happiness = 0.858/h
    assert.ok(Math.abs(gain - 24 * 0.858) < 1e-6, gain);
  });
  await test('3b a bonding Happening only boosts the hours it ran', () => {
    const a = mkCit(1), b = mkCit(2);
    const sim = { pairs: [[a, b]], rels: {}, houses: {}, newPartners: [], events: [], births: [] };
    for (let h = 0; h < 10; h++) SIM._hourly.relationships(sim, ctxAt(T0 + h * H, h < 2 ? { bonding: 1 } : {}));
    assert.ok(Math.abs(sim.rels['1_2'].gain - 12 * 0.858) < 1e-6, sim.rels['1_2'].gain);
  });
  await test('3c crossing into "close" during catch-up writes one back-dated event', () => {
    const a = mkCit(1), b = mkCit(2);
    const sim = { pairs: [[a, b]], rels: { '1_2': { id: 9, citizen_a_id: 1, citizen_b_id: 2, score: 59, state: 'friends', gain: 0 } }, houses: {}, newPartners: [], events: [], births: [] };
    for (let h = 0; h < 5; h++) SIM._hourly.relationships(sim, ctxAt(T0 + h * H));
    assert.strictEqual(sim.events.filter(e => e.type === 'close_bond').length, 1);
    assert.strictEqual(sim.events[0].at, T0 + 1 * H);   // 59 + 0.858×2 ≥ 60 on the 2nd hour
  });
  await test('3d breeding rolls every hour but never overfills the house', () => {
    const orig = Math.random; Math.random = () => 0;     // every roll succeeds
    try {
      const a = mkCit(1, { partner_id: 2 }), b = mkCit(2, { partner_id: 1 });
      const sim = { pairs: [[a, b]], rels: {}, houses: { 1: { id: 1, capacity: 4, occupants: 2, name: 'Oak Hut' } }, newPartners: [], events: [], births: [] };
      for (let h = 0; h < 12; h++) SIM._hourly.breeding(sim, ctxAt(T0 + h * H));
      assert.strictEqual(sim.births.length, 2);
      assert.deepStrictEqual(sim.births.map(x => x.at), [T0, T0 + H]);
    } finally { Math.random = orig; }
  });
  await test('3e the season birth bonus is the one in force that hour', () => {
    const orig = Math.random;
    try {
      const a = mkCit(1, { partner_id: 2, life: { happiness: 60 } }), b = mkCit(2, { partner_id: 1, life: { happiness: 60 } });
      // Spring (+0.10) vs winter (−0.05): 0.04 + 0.10 = 0.14 vs 0 (clamped), so a 0.1 roll breeds only in spring.
      Math.random = () => 0.1;
      const spring = T0 + 9.5 * H, winter = T0 + 4 * H;
      assert.strictEqual(S.seasonAt(spring).id, 'spring'); assert.strictEqual(S.seasonAt(winter).id, 'winter');
      const s1 = { pairs: [[a, b]], rels: {}, houses: { 1: { id: 1, capacity: 4, occupants: 2 } }, newPartners: [], events: [], births: [] };
      SIM._hourly.breeding(s1, ctxAt(spring));
      const s2 = { pairs: [[a, b]], rels: {}, houses: { 1: { id: 1, capacity: 4, occupants: 2 } }, newPartners: [], events: [], births: [] };
      SIM._hourly.breeding(s2, ctxAt(winter));
      assert.strictEqual(s1.births.length, 1); assert.strictEqual(s2.births.length, 0);
    } finally { Math.random = orig; }
  });
  await test('3f runSimulation claims whole hours with a compare-and-swap and catches up', async () => {
    DB.writes = []; DB.handlers = [
      [/UPDATE settlements SET last_sim_tick=\$1/, (sql, p) => { DB.writes.push({ sql, params: p }); return { rows: [{ id: 1 }] }; }],
      [/SELECT \* FROM citizens WHERE settlement_id/, () => ({ rows: [mkCit(1), mkCit(2)] })],
      [/FROM citizen_relationships WHERE settlement_id/, () => ({ rows: [] })],
      [/FROM houses WHERE settlement_id/, () => ({ rows: [{ id: 1, capacity: 2, name: 'Oak Hut' }] })],
    ];
    happenings.invalidate();
    const last = new Date(Date.now() - 5.5 * H);
    await SIM.runSimulation({ id: 7 }, 5.5, last);
    const claim = DB.writes.find(w => /last_sim_tick=\$1/.test(w.sql));
    assert.ok(claim && /date_trunc\('milliseconds', last_sim_tick\) = \$3/.test(claim.sql));
    assert.strictEqual(Date.parse(claim.params[0]) - last.getTime(), 5 * H);   // whole hours; the half hour carries over
    const ins = DB.writes.find(w => /INSERT INTO citizen_relationships/.test(w.sql));
    assert.ok(ins, 'relationship written');
    assert.ok(ins.params[3] >= 4 && ins.params[3] <= 5, ins.params[3]);       // 5 × 0.858 = 4.29 → 4 or 5
  });
  await test('3g a lost claim (another request owns the window) simulates nothing', async () => {
    DB.writes = []; DB.handlers = [[/UPDATE settlements SET last_sim_tick=\$1/, () => ({ rows: [] })]];
    await SIM.runSimulation({ id: 7 }, 3, new Date(Date.now() - 3 * H));
    assert.strictEqual(DB.writes.length, 0);
  });

  console.log('Report helpers');
  await test('4z shares always add up to the total (largest remainder)', () => {
    assert.deepStrictEqual(A.roundShares(5, [1, 1]), [3, 2]);
    const r = A.splitBySources(5, [{ label: 'Upkeep', weight: 2, citizens: [{ id: 1, name: 'A', upkeep: 1 }, { id: 2, name: 'B', upkeep: 1 }] }]);
    assert.strictEqual(r[0].citizens.reduce((a, c) => a + c.amount, 0), 5);
    assert.strictEqual(A.splitBySources(100, [{ label: 'x', value: 1 }, { label: 'y', value: 1 }, { label: 'z', value: 1 }]).reduce((a, x) => a + x.amount, 0), 100);
  });
  await test('4a splitBySources shares a total by weight and splits citizens', () => {
    const rows = A.splitBySources(300, [
      { label: 'Mice base', value: 20 },
      { label: 'Farmers (×2)', value: 10, citizens: [{ id: 1, name: 'Wren' }, { id: 2, name: 'Pip' }] },
      { label: 'Nothing', value: 0 },
    ]);
    assert.deepStrictEqual(rows.map(r => [r.label, r.amount]), [['Mice base', 200], ['Farmers (×2)', 100]]);
    assert.deepStrictEqual(rows[1].citizens.map(c => c.amount), [50, 50]);
  });
  await test('4b upkeep splits by each citizen\'s own upkeep', () => {
    const rows = A.splitBySources(30, [{ label: 'Citizen upkeep', weight: 3, citizens: [{ id: 1, name: 'A', upkeep: 2 }, { id: 2, name: 'B', upkeep: 1 }] }]);
    assert.deepStrictEqual(rows[0].citizens.map(c => [c.name, c.amount]), [['A', 20], ['B', 10]]);
  });
  await test('4c event mapping: settlement feed, solo quest, death', () => {
    const e1 = A.eventFromSettlementEvent({ type: 'child_born', message: 'A baby!', citizen_ids: '[1,2,3]', created_at: new Date(T0) });
    assert.deepStrictEqual([e1.category, e1.icon, e1.citizenIds], ['citizens', '🍼', [1, 2, 3]]);
    const e2 = A.eventFromSoloQuest({ status: 'completed', citizen_id: 4, resolved_at: new Date(T0) }, 'Gather Herbs', 'Wren');
    assert.ok(/Wren returned from "Gather Herbs"/.test(e2.text) && e2.category === 'quests');
    const e3 = A.eventFromCitizenEvent({ citizen_id: 5, event_type: 'death', narrative: 'fell in battle.', occurred_at: new Date(T0) }, 'Pip');
    assert.deepStrictEqual([e3.icon, e3.text], ['🪦', 'Pip: fell in battle.']);
  });
  await test('4d happeningsBetween lists overlapping windows with their effects', () => {
    const defs = [{ id: 'fw', title: 'Fireworks', icon: '🎆', enabled: true, archived: false, rule: { type: 'once', start: new Date(T0 + H).toISOString(), end: new Date(T0 + 3 * H).toISOString() },
      effects: [{ type: 'banner' }, { type: 'modifier', stat: 'happiness', value: 10 }] }];
    const list = A.happeningsBetween(defs, T0, T0 + 10 * H);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].effects.length, 1); assert.strictEqual(list[0].effects[0].tone, 'good');
    assert.strictEqual(A.happeningsBetween(defs, T0 + 4 * H, T0 + 10 * H).length, 0);
  });

  console.log('Endpoints');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const app = express(); app.use(express.json()); app.use(require('cookie-parser')()); app.use('/api/game', require('../routes/away'));
  const srv = http.createServer(app).listen(0); const port = srv.address().port;
  const token = jwt.sign({ userId: 1 }, process.env.JWT_SECRET);
  const call = (method, path) => new Promise((resolve, reject) => {
    const r = http.request({ port, path, method, headers: { Authorization: 'Bearer ' + token } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    }); r.on('error', reject); r.end();
  });
  let awaySince = null;
  const baseHandlers = () => [
    [/FROM settlements s JOIN users u/, () => ({ rows: [{ id: 7, species: 'Mice', away_since: awaySince,
      away_ledger: { produced_food: 300, consumed_food: 120, produced_wealth: 40 } }] })],
    [/SELECT id, name, role, life_stage FROM citizens/, () => ({ rows: [{ id: 1, name: 'Wren', role: 'farmer' }, { id: 2, name: 'Pip', role: 'idle' }] })],
    [/FROM settlement_events/, () => ({ rows: [{ type: 'child_born', message: 'Welcome, Bramble!', citizen_ids: [1, 2, 3], created_at: new Date(Date.now() - H) }] })],
    [/FROM settlement_quests\s+WHERE settlement_id=\$1 AND COALESCE\(quest_type/, () => ({ rows: [{ id: 1, quest_id: 'q_gather_herbs', citizen_id: 1, status: 'completed', resolved_at: new Date(Date.now() - 2 * H) }] })],
    [/FILTER \(WHERE status = 'completed'\)/, () => ({ rows: [{ to_collect: 1, battles: 0 }] })],
    [/FROM citizens WHERE settlement_id=\$1 AND life_stage != 'deceased'/, () => ({ rows: [{ id: 1, name: 'Wren', life_stage: 'adult', role: 'farmer', life: {} }, { id: 2, name: 'Pip', life_stage: 'adult', role: 'idle', life: {} }] })],
  ];
  await test('5a no away_since yet → show:false', async () => {
    awaySince = null; DB.handlers = baseHandlers();
    const r = await call('GET', '/api/game/away-report');
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.show, false);
  });
  await test('5b a short absence (<15 min) → show:false', async () => {
    awaySince = new Date(Date.now() - 5 * 60e3); DB.handlers = baseHandlers();
    assert.strictEqual((await call('GET', '/api/game/away-report')).body.show, false);
  });
  await test('5c a long absence → resources with sources, events, waiting', async () => {
    awaySince = new Date(Date.now() - 6 * H); DB.handlers = baseHandlers();
    const r = (await call('GET', '/api/game/away-report')).body;
    assert.strictEqual(r.show, true);
    assert.deepStrictEqual([r.resources.food.produced, r.resources.food.consumed, r.resources.food.net], [300, 120, 180]);
    assert.ok(r.resources.food.sources.some(s => s.citizens && s.citizens[0].name === 'Wren'), JSON.stringify(r.resources.food.sources));
    assert.strictEqual(r.resources.food.consumers[0].citizens.length, 2);
    assert.strictEqual(r.resources.wealth.net, 40);
    assert.deepStrictEqual(r.events.map(e => e.icon), ['✅', '🍼']);      // oldest first
    assert.ok(/Gather Healing Herbs/.test(r.events[0].text));
    assert.strictEqual(r.waiting[0].action, 'quests');
    assert.strictEqual(r.citizens['1'], 'Wren');
  });
  await test('5d POST /seen marks the player online and clears the ledger', async () => {
    DB.writes = []; DB.handlers = [];
    const r = await call('POST', '/api/game/seen');
    assert.strictEqual(r.status, 200);
    assert.ok(/away_since = NOW\(\), away_ledger = '\{\}'::jsonb WHERE user_id = \$1/.test(DB.writes[0].sql));
    assert.deepStrictEqual(DB.writes[0].params, [1]);
  });
  await test('5e both routes require auth', async () => {
    const res = await new Promise(resolve => http.get({ port, path: '/api/game/away-report' }, resolve));
    assert.strictEqual(res.statusCode, 401);
  });
  srv.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
