// scripts/crafting_test.js — crafting (careers Phase 2): recipes, queues,
// quality, the crafter's mark, capstones.
//
// Part 1 is pure (quality maths, crafted items, recipe/tree integrity).
// Part 2 uses the database directly (lib/crafting) and a running server over
// HTTP against the same DATABASE_URL. Throwaway databases only.
//
//   node scripts/crafting_test.js
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/crafting_test.js

'use strict';

const M = require('../lib/career_math');
const C = require('../lib/careers/classes');
const { BUILDINGS } = require('../buildings');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

function part1() {
  const crafting = require('../lib/crafting');
  const market = require('../lib/market');
  console.log('Quality');
  for (const s of [-40, 0, 25, 60, 120]) check(near(sum(M.qualityOdds(s, 'legendary', 20)), 1), `odds sum to 1 (score ${s})`);
  check(M.qualityOdds(200, 'legendary', 14).legendary === 0 && M.qualityOdds(200, 'legendary', 15).legendary > 0, 'legendary needs level 15');
  const capped = M.qualityOdds(200, 'superior', 20);
  check(capped.legendary === 0 && near(capped.superior, 1), 'a recipe\'s quality cap holds (overflow lands on the cap)');
  check(M.qualityOdds(0, 'basic', 20).basic === 1, 'basic-only recipes (Cut Gem) are always basic');
  const novice = M.qualityOdds(M.qualityScore({ level: 1, minLevel: 1, primary: 8, quality: 0, tool: 0, station: 1 }), 'legendary', 1);
  check(novice.basic > 0.4 && novice.sturdy > 0 && novice.superior === 0, 'a Lv1 novice: mostly basic, some sturdy, never superior');
  const master = M.qualityOdds(M.qualityScore({ level: 20, minLevel: 1, primary: 16, quality: 12, tool: 3, station: 3 }), 'legendary', 20);
  check(master.basic === 0 && master.legendary > 0 && master.superior > 0.2, 'a Lv20 master: no basic, a real shot at legendary');
  check(M.rollQuality(0, 'legendary', 1, 0.9999999999) !== 'basic' || M.qualityOdds(0, 'legendary', 1).basic === 1, 'rounding never drops a top roll to basic');
  check(M.craftSeconds(1200, 0.25, 1) === 960 && M.craftSeconds(10, 5, 5) === 30, 'craft time: speed shortens it, never below 30s');

  console.log('Crafted items');
  const tpl = { item_key: 'iron_sword', name: 'Iron Sword', icon: '⚔️', category: 'equipment', rarity: 'common', equip_slot: 'weapon', stat_bonuses: { combat: 2 }, sell_value: 20 };
  const cit = { id: 7, name: 'Fenn' };
  const fine = crafting.craftedItem(tpl, 'fine', { citizen: cit, settlementName: 'Oakhollow', recipeKey: 'iron_sword' });
  check(fine.name === 'Fine Iron Sword' && fine.metadata.quality === 'fine', 'quality goes in the name');
  check(fine.stat_bonuses.combat === Math.max(1, Math.round(2 * M.QUALITY_STAT_MULT.fine)), 'bonuses scale with quality');
  check(fine.metadata.sell_value === Math.round(20 * M.QUALITY_VALUE_MULT.fine), 'value scales with quality');
  check(fine.metadata.crafted_by.name === 'Fenn' && fine.metadata.crafted_by.settlement_name === 'Oakhollow', 'the crafter\'s mark: who and where');
  const basic = crafting.craftedItem(tpl, 'basic', { citizen: cit, settlementName: 'X' });
  check(basic.name === 'Iron Sword', 'basic: no prefix');
  const named = crafting.craftedItem(tpl, 'superior', { citizen: cit, named: 'Dawnbreaker' });
  check(named.name === 'Dawnbreaker' && named.metadata.named && named.metadata.base_name === 'Iron Sword'
    && named.stat_bonuses.combat === Math.round(2 * M.QUALITY_STAT_MULT.superior) + 1, 'a Named Blade: its own name and an extra edge');
  const midas = crafting.craftedItem(tpl, 'basic', { citizen: cit, midas: true });
  check(midas.metadata.sell_value === Math.round(20 * 1.15), 'Midas Touch: +15% value');
  const mat = crafting.craftedItem({ item_key: 'cut_gem', name: 'Cut Gem', sell_value: 90 }, 'fine', { citizen: cit });
  check(mat.name === 'Cut Gem' && mat.metadata.quality === 'basic' && mat.metadata.sell_value === 90, 'materials have no quality');
  check(market.itemValue(fine.metadata, 20) === fine.metadata.sell_value, 'Market: a crafted item is worth its own value');
  check(market.itemValue({ sell_value: 999 }, 20) === 20 && market.itemValue({ sell_value: 7 }, null) === 7, 'Market: others use the template value');

  console.log('Shields & effects');
  const shield = crafting.craftedItem({ item_key: 'iron_shield', name: 'Iron Shield', equip_slot: 'shield', stat_bonuses: { combat: 2 }, sell_value: 50,
    item_effects: [{ type: 'injury', value: -4 }] }, 'superior', { citizen: cit });
  check(shield.metadata.item_effects[0].value === Math.round(-4 * M.QUALITY_STAT_MULT.superior) && shield.name === 'Superior Iron Shield',
    'a crafted shield\'s lower injury risk scales with quality');
  const cart = crafting.craftedItem({ item_key: 'sledge', name: 'Sledge', equip_slot: 'tool', stat_bonuses: {}, sell_value: 80,
    item_effects: [{ type: 'carry', value: 0.2 }] }, 'fine', { citizen: cit });
  check(cart.metadata.item_effects[0].value === Math.round(0.2 * M.QUALITY_STAT_MULT.fine * 100) / 100, 'percentage effects keep their decimals');
  check(market.categoryOf({ equip_slot: 'shield' }) === 'armour' && market.ITEM_SLOT_WEIGHT.shield === 4, 'shields trade as armour (Smithy stalls)');

  console.log('Village schematics');
  const npcTrade = require('../lib/npc_trade');
  const tpls = [{ item_key: 'trout', name: 'Trout', category: 'fish', rarity: 'common', sell_value: 3, tradeable: true },
    { item_key: 'schematic_x', name: 'Schematic: X', category: 'schematic', rarity: 'epic', sell_value: 100, tradeable: true },
    { item_key: 'schematic_y', name: 'Schematic: Y', category: 'schematic', rarity: 'uncommon', sell_value: 50, tradeable: true }];
  let withS = null, days = 0;
  for (let d = 1; d <= 60 && !withS; d++) {
    const day = `2026-01-${String(((d - 1) % 28) + 1).padStart(2, '0')}`;
    const os = npcTrade.npcOrdersFor({ id: d, species: 'mice' }, day, tpls);
    if (os.some(o => o.schematic)) { withS = { day, id: d, os }; days++; }
  }
  check(withS && JSON.stringify(npcTrade.npcOrdersFor({ id: withS.id, species: 'mice' }, withS.day, tpls)) === JSON.stringify(withS.os),
    'villages sometimes sell a schematic — the same one all day');
  const sOrder = withS && withS.os.find(o => o.schematic);
  check(sOrder && sOrder.qty === 1 && sOrder.key === 's9' && sOrder.price === Math.round((sOrder.item.item_key === 'schematic_x' ? 100 : 50) * 1.2),
    'one schematic, at 120% of its value');
  check(!npcTrade.npcOrdersFor({ id: 3, species: 'mice' }, '2026-02-02', tpls).some(o => !o.schematic && o.item && o.item.item_key.startsWith('schematic_')),
    'schematics never turn up as ordinary goods');
  const epicOrder = { key: 's9', side: 'sell', kind: 'item', schematic: true, min_tier: 'allied', qty: 1, price: 120, per: 1, item: {} };
  check(npcTrade.forTier([epicOrder], npcTrade.tierFor(50)).length === 0 && npcTrade.forTier([epicOrder], npcTrade.tierFor(80))[0].qty === 1,
    'rare schematics only for towns the village trusts most (and still just one)');

  console.log('Stations & classes');
  for (const [st, cls] of Object.entries(crafting.STATIONS)) {
    check(C.CLASSES[cls] && C.CLASSES[cls].station === st && BUILDINGS[st] && BUILDINGS[st].craftSlots(2) === 2, `${st}: ${cls} works there, one place per level`);
  }
  check(C.CLASSES.crafter.assignedBy === 'retired', 'the old Artisan job is retired');
}

async function part2() {
  const { pool } = require('../db');
  const crafting = require('../lib/crafting');
  const careers = require('../lib/careers');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CRAFTING_TEST_BASE || process.env.CAREERS_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;

  async function user(name, buildings = [], forceId = null) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET username = users.username RETURNING id", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    let s = (await q('SELECT * FROM settlements WHERE user_id = $1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, wealth, food, timber, stone, metal, last_tick) VALUES ($1,$2,2,1000,500,500,500,500,NOW()) RETURNING *`, [u.id, username])).rows[0];
    for (const [type, level] of buildings) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,$3)', [s.id, type, level]);
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  async function citizen(p, role, extra = {}) {
    return (await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, career_settled_at)
                     VALUES ($1,$2,$3,$4,$5,$6,'adult',$7,$8,NOW()) RETURNING id`,
      [p.sid, extra.name || 'Cit' + seq++, role, JSON.stringify(extra.stats || { strength: 8, agility: 8, endurance: 8, intelligence: 8, charisma: 8 }),
       JSON.stringify({ crafting: 1, combat: 1 }), JSON.stringify({ happiness: 60, hunger: 20 }),
       JSON.stringify(extra.hidden || []), JSON.stringify(extra.visible || [])])).rows[0].id;
  }
  async function api(p, method, pth, body) {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const res = async sid => (await q('SELECT food, timber, stone, metal, wealth FROM settlements WHERE id = $1', [sid])).rows[0];
  const itemCount = async (sid, key) => Number((await q('SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [sid, key])).rows[0].n);
  const jobsOf = async cid => (await q('SELECT * FROM craft_jobs WHERE citizen_id = $1 ORDER BY id', [cid])).rows;
  const due = id => q("UPDATE craft_jobs SET started_at = NOW() - interval '2 hours', completes_at = NOW() - interval '1 hour' WHERE id = $1", [id]);
  const ore = (sid, n) => q("INSERT INTO inventory_items (settlement_id,item_key,name,icon,category,quantity) VALUES ($1,'iron_ore','Iron Ore','⚫','material',$2)", [sid, n]);

  console.log('Recipes');
  const all = await crafting.recipes();
  const keys = new Set((await q('SELECT item_key FROM item_templates')).rows.map(r => r.item_key));
  const errs = [];
  for (const r of all) {
    const cls = C.CLASSES[r.class_key];
    if (!cls || cls.station !== r.station) errs.push('class/station ' + r.recipe_key);
    if (r.spec && !C.specOf(cls, r.spec)) errs.push('spec ' + r.recipe_key);
    if (r.unlock_node && !(cls && cls.tree.some(n => n.id === r.unlock_node))) errs.push('unlock ' + r.recipe_key);
    if (!keys.has(r.output_key) && !require('../lib/resource_defs').isResource(r.output_key)) errs.push('output ' + r.recipe_key);
    for (const it of (r.inputs.items || [])) if (!keys.has(it.item_key)) errs.push('input ' + r.recipe_key + ':' + it.item_key);
    if (r.spec && r.min_level < M.FORK_LEVEL) errs.push('spec level ' + r.recipe_key);
  }
  check(all.length >= 29 && !errs.length, `${all.length} seeded recipes are consistent${errs.length ? ' — ' + errs.join(', ') : ''}`);

  console.log('Jobs & slots');
  const a = await user('smith', [['smithy', 1]]);
  const s1 = await citizen(a, 'forager', { name: 'Fenn' }), s2 = await citizen(a, 'forager', { name: 'Bram' });
  let r = await api(a, 'PATCH', `/api/citizens/${s1}/role`, { role: 'blacksmith' });
  check(r.status === 200, 'a Smithy takes a Blacksmith');
  r = await api(a, 'PATCH', `/api/citizens/${s2}/role`, { role: 'blacksmith' });
  check(r.status === 400 && /1 working place/.test(r.body.error), 'a level 1 Smithy has one place');
  r = await api(a, 'PATCH', `/api/citizens/${s2}/role`, { role: 'carpenter' });
  check(r.status === 400 && /Workshop/.test(r.body.error), 'a Carpenter needs a Workshop');
  r = await api(a, 'PATCH', `/api/citizens/${s2}/role`, { role: 'crafter' });
  check(r.status === 400, 'the retired Artisan job can\'t be picked');

  console.log('Queue & refunds');
  r = await api(a, 'GET', '/api/crafting/station/smithy');
  check(r.status === 200 && r.body.slots === 1 && r.body.crafters.length === 1 && r.body.crafters[0].can.iron_dagger === null
    && /level 3/.test(r.body.crafters[0].can.iron_sword) && /level 5/.test(r.body.crafters[0].can.miners_pick), 'station view: who can make what, and why not');
  r = await api(a, 'GET', '/api/crafting/station/kitchen');
  check(r.status === 404, 'unknown stations 404');
  const r0 = await res(a.sid);
  r = await api(a, 'POST', '/api/crafting/jobs', { citizen_id: s1, recipe_key: 'iron_dagger', qty: 3 });
  const r1 = await res(a.sid);
  check(r.status === 200 && r.body.ids.length === 3 && r0.metal - r1.metal === 24 && r0.timber - r1.timber === 6, 'queue 3 daggers: 24 metal and 6 timber reserved');
  let jobs = await jobsOf(s1);
  check(jobs[0].status === 'active' && jobs[1].status === 'queued' && jobs[2].status === 'queued' && jobs[1].started_at === null, 'one at the bench, two waiting');
  r = await api(a, 'POST', '/api/crafting/jobs', { citizen_id: s1, recipe_key: 'iron_dagger', qty: 3 });
  check(r.status === 400 && /at most 5/.test(r.body.error) && (await res(a.sid)).metal === r1.metal, 'five per crafter; a refused queue takes nothing');
  r = await api(a, 'DELETE', `/api/crafting/jobs/${jobs[2].id}`);
  check(r.status === 200 && (await res(a.sid)).metal === r1.metal + 8 && (await res(a.sid)).timber === r1.timber + 2, 'cancel a waiting job: exact refund');
  r = await api(a, 'DELETE', `/api/crafting/jobs/${jobs[2].id}`);
  check(r.status === 404, 'a job can only be cancelled once');
  r = await api(a, 'DELETE', `/api/crafting/jobs/${jobs[0].id}`);
  jobs = await jobsOf(s1);
  check(r.status === 200 && jobs[1].status === 'active' && jobs[1].completes_at, 'cancel the active job: the next one starts');
  r = await api(a, 'PATCH', `/api/citizens/${s1}/role`, { role: 'forager' });
  check(r.status === 400 && /crafting queued/.test(r.body.error), 'no changing jobs with crafting queued');
  check((await require('../lib/market').merchantCitizenIds([s1])).includes(s1), 'a crafter at work is busy (no quests, envoys, Market)');

  console.log('Materials');
  await careers.adminGrant(a.sid, s1, 'blacksmith', { level: 3 });
  await q('UPDATE settlements SET metal = 10 WHERE id = $1', [a.sid]);
  r = await api(a, 'POST', '/api/crafting/jobs', { citizen_id: s1, recipe_key: 'iron_sword', qty: 1 });
  check(r.status === 400 && /iron/.test(r.body.error), 'not enough iron: refused');
  await q('UPDATE settlements SET metal = 500 WHERE id = $1', [a.sid]);
  r = await api(a, 'POST', '/api/crafting/jobs', { citizen_id: s1, recipe_key: 'iron_sword', qty: 1 });
  check(r.status === 400 && /Iron Ore|iron_ore|enough/i.test(r.body.error) && (await res(a.sid)).metal === 500, 'no Iron Ore: refused, metal untouched');
  await ore(a.sid, 2);
  r = await api(a, 'POST', '/api/crafting/jobs', { citizen_id: s1, recipe_key: 'iron_sword', qty: 2 });
  check(r.status === 200 && (await itemCount(a.sid, 'iron_ore')) === 0, 'two swords: both ores reserved');
  jobs = await jobsOf(s1);
  const sw = jobs.filter(j => j.recipe_key === 'iron_sword');
  await api(a, 'DELETE', `/api/crafting/jobs/${sw[1].id}`);
  check((await itemCount(a.sid, 'iron_ore')) === 1, 'cancel one: its ore comes back');

  console.log('Finishing & offline chaining');
  // Queue: dagger (active), dagger, sword. Back-date the active one: it
  // finishes, the next starts from its completes_at, not from now.
  jobs = (await jobsOf(s1)).filter(j => j.status === 'active' || j.status === 'queued');
  check(jobs.length === 2, 'two left: a dagger at the bench and a sword waiting');
  await q("UPDATE craft_jobs SET started_at = NOW() - interval '10 hours', completes_at = NOW() - interval '9 hours' WHERE id = $1", [jobs[0].id]);
  const before = await itemCount(a.sid, 'iron_dagger');
  await crafting.resolveDue(a.sid, { rand: () => 0.5 });
  let after = await jobsOf(s1);
  const d1 = after.find(j => j.id === jobs[0].id), sNext = after.find(j => j.id === jobs[1].id);
  check(d1.status === 'done' && d1.quality && (await itemCount(a.sid, 'iron_dagger')) === before + 1, 'finished while away: the dagger is in the stores');
  check(sNext.status === 'done', 'the sword chained from the dagger\'s finish and was done long ago too');
  check(Math.abs(Date.parse(sNext.started_at) - Date.parse(d1.completes_at)) < 1000, 'the next job starts when the last one finished');
  const made = (await q("SELECT * FROM inventory_items WHERE settlement_id=$1 AND item_key='iron_sword' ORDER BY id DESC LIMIT 1", [a.sid])).rows[0];
  check(made && made.metadata.crafted_by && made.metadata.crafted_by.name === 'Fenn' && made.metadata.quality === sNext.quality, 'the sword bears Fenn\'s mark and its quality');
  check(Number(sNext.xp_awarded) === 30 * M.QUALITY_XP_MULT[sNext.quality] * 2, 'first sword: double XP');
  const cr = (await q('SELECT count FROM citizen_recipes WHERE citizen_id=$1 AND recipe_key=$2', [s1, 'iron_sword'])).rows[0];
  check(cr && cr.count === 1, 'recipe book: one sword made');
  r = await api(a, 'PATCH', `/api/citizens/${s1}/role`, { role: 'forager' });
  check(r.status === 200, 'queue empty: free to change jobs again');
  await api(a, 'PATCH', `/api/citizens/${s1}/role`, { role: 'blacksmith' });

  console.log('Races');
  await api(a, 'POST', '/api/crafting/jobs', { citizen_id: s1, recipe_key: 'iron_dagger', qty: 1 });
  jobs = (await jobsOf(s1)).filter(j => j.status === 'active');
  await due(jobs[0].id);
  const n0 = (await q('SELECT COUNT(*)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [a.sid, 'iron_dagger'])).rows[0].n;
  await Promise.all([crafting.resolveDue(a.sid), crafting.tick(), crafting.resolveDue(null), api(a, 'GET', '/api/crafting/station/smithy')]);
  const n1 = (await q('SELECT COUNT(*)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [a.sid, 'iron_dagger'])).rows[0].n;
  check(n1 === n0 + 1 && (await jobsOf(s1)).find(j => j.id === jobs[0].id).status === 'done', 'worker and readers racing: made exactly once');
  // Cancel vs finish: cancelling a job that just finished is refused, no double refund.
  await api(a, 'POST', '/api/crafting/jobs', { citizen_id: s1, recipe_key: 'iron_dagger', qty: 1 });
  jobs = (await jobsOf(s1)).filter(j => j.status === 'active');
  await due(jobs[0].id);
  const m0 = (await res(a.sid)).metal;
  const [, cancel] = await Promise.all([crafting.resolveDue(a.sid), api(a, 'DELETE', `/api/crafting/jobs/${jobs[0].id}`)]);
  const fin = (await jobsOf(s1)).find(j => j.id === jobs[0].id);
  check((fin.status === 'done' && cancel.status === 404 && (await res(a.sid)).metal === m0)
    || (fin.status === 'cancelled' && cancel.status === 200 && (await res(a.sid)).metal === m0 + 8), 'cancel racing the finish: one or the other, never both');

  console.log('Quality spread');
  const tally = { basic: 0, sturdy: 0, fine: 0, superior: 0, legendary: 0 };
  let u = 0;
  for (let i = 0; i < 400; i++) tally[M.rollQuality(30, 'legendary', 20, (u = (u + 0.0025) % 1))]++;
  const odds = M.qualityOdds(30, 'legendary', 20);
  check(Object.keys(tally).every(k => Math.abs(tally[k] / 400 - odds[k]) < 0.01), 'rolls follow the shown odds');

  console.log('Traits & capstones');
  const b = await user('master', [['smithy', 3], ['jeweller', 2]]);
  const ws = await citizen(b, 'blacksmith', { name: 'Ysolde' });
  const bf = await citizen(b, 'blacksmith', { name: 'Clod', hidden: ['butterfingers'] });
  await careers.adminGrant(b.sid, ws, 'blacksmith', { level: 20 });
  await q("UPDATE citizen_classes SET spec = 'weaponsmith' WHERE citizen_id = $1 AND class_key = 'blacksmith'", [ws]);
  r = await api(b, 'GET', '/api/crafting/station/smithy');
  check(r.body.slots === 3 && r.body.crafters.find(c => c.id === ws).named_ready === true, 'a Lv20 Weaponsmith may name a blade');
  r = await api(b, 'POST', '/api/crafting/jobs', { citizen_id: ws, recipe_key: 'iron_dagger', qty: 2, name: 'Twinfang' });
  check(r.status === 400 && /one blade/.test(r.body.error), 'one named blade at a time');
  r = await api(b, 'POST', '/api/crafting/jobs', { citizen_id: ws, recipe_key: 'iron_dagger', qty: 1, name: '<b>' });
  check(r.status === 400, 'names are letters, digits, spaces, apostrophes and hyphens');
  r = await api(b, 'POST', '/api/crafting/jobs', { citizen_id: ws, recipe_key: 'iron_dagger', qty: 1, name: 'Dawn<script>breaker' });
  check(r.status === 200, 'name a blade (markup stripped)');
  r = await api(b, 'POST', '/api/crafting/jobs', { citizen_id: ws, recipe_key: 'iron_dagger', qty: 1, name: 'Again' });
  check(r.status === 400 && /once a week/.test(r.body.error), '…once a week');
  jobs = await jobsOf(ws);
  await due(jobs[0].id);
  await crafting.resolveDue(b.sid, { rand: () => 0 });
  const blade = (await q("SELECT * FROM inventory_items WHERE settlement_id=$1 AND name = 'Dawnscriptbreaker'", [b.sid])).rows[0];
  check(blade && blade.metadata.named && ['superior', 'legendary'].includes(blade.metadata.quality), 'Dawnbreaker: Superior or better, whatever the roll');
  const masterworks = (await q('SELECT career_counters FROM citizens WHERE id=$1', [ws])).rows[0].career_counters;
  check(Number((masterworks || {}).masterworks) >= 1, 'Superior+ counts toward Perfectionist');
  await api(b, 'POST', '/api/crafting/jobs', { citizen_id: bf, recipe_key: 'iron_dagger', qty: 1 });
  jobs = await jobsOf(bf);
  await due(jobs[0].id);
  const bd0 = await itemCount(b.sid, 'iron_dagger');
  await crafting.resolveDue(b.sid, { rand: () => 0 });
  check((await jobsOf(bf))[0].status === 'ruined' && (await itemCount(b.sid, 'iron_dagger')) === bd0, 'Butterfingers: now and then the piece is ruined');
  // Armorer Bulwark → a Guardian piece.
  const ar = await citizen(b, 'blacksmith', { name: 'Hild' });
  await careers.adminGrant(b.sid, ar, 'blacksmith', { level: 20 });
  await q("UPDATE citizen_classes SET spec = 'armorer' WHERE citizen_id = $1 AND class_key = 'blacksmith'", [ar]);
  await ore(b.sid, 6);
  r = await api(b, 'POST', '/api/crafting/jobs', { citizen_id: ar, recipe_key: 'chainmail', qty: 1 });
  check(r.status === 200, 'an Armorer makes chainmail');
  jobs = await jobsOf(ar);
  await due(jobs[0].id);
  await crafting.resolveDue(b.sid, { rand: () => 0.999 });   // top quality; guardian roll needs < 0.5
  let mail = (await q("SELECT * FROM inventory_items WHERE settlement_id=$1 AND item_key='chainmail' ORDER BY id DESC LIMIT 1", [b.sid])).rows[0];
  check(mail && !mail.metadata.guardian, 'the Guardian roll can miss');
  await api(b, 'POST', '/api/crafting/jobs', { citizen_id: ar, recipe_key: 'chainmail', qty: 1 });
  jobs = (await jobsOf(ar)).filter(j => j.status === 'active');
  await due(jobs[0].id);
  let k = 0; const seqR = [0.5, 0.999, 0.1, 0.9];       // ruin n/a; quality roll 0.999; guardian 0.1; refund 0.9
  await crafting.resolveDue(b.sid, { rand: () => seqR[k++ % seqR.length] });
  mail = (await q("SELECT * FROM inventory_items WHERE settlement_id=$1 AND item_key='chainmail' ORDER BY id DESC LIMIT 1", [b.sid])).rows[0];
  check(mail && (M.QUALITIES.indexOf(mail.metadata.quality) < 3 || mail.metadata.guardian === true), 'Bulwark: Superior+ armour can be a Guardian');
  // Jeweller: Midas and recipe unlocks through a capstone.
  const jw = await citizen(b, 'jeweller', { name: 'Opal' });
  await careers.adminGrant(b.sid, jw, 'jeweller', { level: 20 });
  await q("UPDATE citizen_classes SET spec = 'goldsmith' WHERE citizen_id = $1 AND class_key = 'jeweller'", [jw]);
  r = await api(b, 'GET', '/api/crafting/station/jeweller');
  const opal = r.body.crafters.find(c => c.id === jw);
  check(opal.can.gold_ring === null && /Gemcutter/.test(opal.can.cut_gem), 'Goldsmiths make gold, not cut gems');
  check(/level 3/.test(opal.can.heart_of_the_mountain) || /Gemcutter/.test(opal.can.heart_of_the_mountain), 'the Heart of the Mountain needs its own path and station');
  await q('UPDATE settlements SET goldore = 10 WHERE id = $1', [b.sid]);
  r = await api(b, 'POST', '/api/crafting/jobs', { citizen_id: jw, recipe_key: 'gold_ring', qty: 1 });
  jobs = await jobsOf(jw);
  await due(jobs[0].id);
  await crafting.resolveDue(b.sid, { rand: () => 0.5 });
  const ring = (await q("SELECT * FROM inventory_items WHERE settlement_id=$1 AND item_key='gold_ring' ORDER BY id DESC LIMIT 1", [b.sid])).rows[0];
  check(ring && ring.metadata.sell_value === Math.round(160 * M.QUALITY_VALUE_MULT[ring.metadata.quality] * 1.15), 'Midas Touch: the ring is worth 15% more');

  console.log('Guardian');
  const g = await citizen(b, 'guard', { name: 'Tor' });
  const gi = (await q(`INSERT INTO inventory_items (settlement_id,item_key,name,category,quantity,equip_slot,stat_bonuses,metadata,equipped_to)
                      VALUES ($1,'chainmail','Superior Chainmail','equipment',1,'armour','{"combat":3}','{"guardian":true,"quality":"superior"}',$2) RETURNING id`, [b.sid, g])).rows[0].id;
  const resolver = require('../lib/combat_resolver');
  if (typeof resolver._writeInjury === 'function') {
    await resolver._writeInjury({ citizen: { id: g, name: 'Tor' }, settlementId: b.sid, questRunId: null, battle: null, encounter: ['wolf'], injury: { severity: 'fatal', body_part: 'chest' } });
    const alive = (await q('SELECT life_stage FROM citizens WHERE id=$1', [g])).rows[0].life_stage;
    check(alive !== 'deceased' && !(await q('SELECT 1 FROM inventory_items WHERE id=$1', [gi])).rowCount, 'a Guardian piece saves its wearer from death and breaks');
  } else console.log('  (combat_resolver._writeInjury not exported — Guardian covered by its own tests)');

  console.log('Market value');
  r = await api(a, 'GET', '/api/market/ironhaven');
  const iv = (r.body.items || r.body.sell || []).find && (r.body.items || r.body.sell || []).find(x => x.id === made.id);
  if (iv) check(Number(iv.value || iv.unit_price) > 0, 'Ironhaven prices the crafted sword');

  console.log('Smelter');
  const RD = require('../lib/resource_defs');
  const sm = await user('smelt', [['mine', 1], ['smelter', 2]]);
  const fur = await citizen(sm, 'smelter', { name: 'Ember' });
  await q('UPDATE settlements SET copper = 20, tin = 10, coal = 10, metal = 50 WHERE id = $1', [sm.sid]);
  r = await api(sm, 'GET', '/api/crafting/station/smelter');
  const bz = r.body.recipes && r.body.recipes.find(x => x.recipe_key === 'bronze');
  check(r.status === 200 && r.body.slots === 2 && bz && bz.output && bz.output.resource && bz.output.name === 'Bronze', 'the Smelter panel: two furnaces, Bronze makes a resource');
  check(/Needs research: Smelting/.test((r.body.crafters[0] || { can: {} }).can.bronze || ''), 'bronze needs the Smelting research');
  r = await api(sm, 'POST', '/api/crafting/jobs', { citizen_id: fur, recipe_key: 'bronze', qty: 1 });
  check(r.status === 400 && /Smelting/.test(r.body.error), '…and the server refuses it before then');
  await q("INSERT INTO settlement_research (settlement_id, project, progress, done_at) VALUES ($1,'smelting',150,NOW())", [sm.sid]);
  r = await api(sm, 'POST', '/api/crafting/jobs', { citizen_id: fur, recipe_key: 'bronze', qty: 2 });
  const sres = (await q('SELECT copper, tin FROM settlements WHERE id=$1', [sm.sid])).rows[0];
  check(r.status === 200 && sres.copper === 16 && sres.tin === 8, 'two batches of bronze take 4 copper and 2 tin');
  for (const j of await jobsOf(fur)) await due(j.id);
  await crafting.resolveDue(sm.sid, { rand: () => 0.99 });
  await crafting.resolveDue(sm.sid, { rand: () => 0.99 });
  const bres = (await q('SELECT bronze FROM settlements WHERE id=$1', [sm.sid])).rows[0];
  const sj = await jobsOf(fur);
  check(bres.bronze === 4 && sj.every(j => j.status === 'done' && j.quality === 'basic' && j.result_item_id === null), 'each batch puts 2 bronze in the stores (no item)');
  check((await require('../lib/resources').discoveredKeys(null, sm.sid)).includes('bronze'), 'the first bronze is a discovery');
  check(Number(sj[0].xp_awarded) > 0, 'smelting earns Smelter XP');
  check(!(await api(sm, 'POST', '/api/crafting/jobs', { citizen_id: fur, recipe_key: 'steel', qty: 1 })).status.toString().startsWith('2'), 'steel waits for Steelworking (and level 3)');
  await q('UPDATE settlements SET copper = 3 WHERE id = $1', [sm.sid]);
  r = await api(sm, 'POST', '/api/crafting/jobs', { citizen_id: fur, recipe_key: 'bronze', qty: 5 });
  check(r.status === 400 && /copper/i.test(r.body.error), 'not enough copper: the error names it');

  console.log('Recipes on the new metals');
  const recs = Object.fromEntries((await crafting.recipes()).map(x => [x.recipe_key, x]));
  check(recs.steel_sword.inputs.resources.steel > 0 && recs.plate_armour.inputs.resources.steel > 0 && recs.tower_shield.inputs.resources.steel > 0, 'steel sword, plate and the tower shield need steel');
  check(recs.scale_mail.inputs.resources.bronze > 0 && recs.caravan_wagon.inputs.resources.bronze > 0, 'scale mail and caravan wagons use bronze');
  check(recs.gold_ring.inputs.resources.goldore > 0 && recs.gem_pendant.inputs.resources.silver > 0 && recs.cut_gem.inputs.resources.gems === 2, 'jewellers use gold ore, silver and gems');
  check(recs.heart_of_the_mountain.inputs.resources.mithril === 2, 'the Heart of the Mountain needs mithril');
  check(Object.values(recs).every(x => Object.keys((x.inputs || {}).resources || {}).every(k => RD.isResource(k))), 'every recipe input is a known resource');
  check(Object.values(recs).filter(x => x.station === 'smelter').every(x => RD.isResource(x.output_key) && x.research), 'Smelter recipes make resources and name their research');

  console.log('Gem finds');
  const gm = await user('gem', [['mine', 1]]);
  const gmc = await citizen(gm, 'miner', { name: 'Glint' });
  const careersLib = require('../lib/careers');
  const gf = await require('../db').withTransaction(c => careersLib._grantFind ? careersLib._grantFind(c, gm.sid, 'gemstone', 'spring') : null);
  if (gf) {
    const gs = (await q('SELECT gems FROM settlements WHERE id=$1', [gm.sid])).rows[0];
    check(gf.resource === 'gems' && gs.gems === 1, 'a miner\'s gemstone find goes into the stores as Gems');
  } else check(false, 'grantFind is exported for tests');
  void gmc;

  console.log('Dev Tools');
  const adminId = Number(process.env.CRAFTING_TEST_ADMIN_ID || 0);
  if (adminId) {
    const ad = await user('admin', [], adminId);
    const key = 'test_' + RUN;
    r = await api(a, 'POST', '/api/crafting/admin/recipes', { recipe_key: key });
    check(r.status === 403, 'recipes: admins only');
    r = await api(ad, 'POST', '/api/crafting/admin/recipes', { recipe_key: key, name: 'Test Nail', class_key: 'blacksmith', station: 'smithy', output_key: 'iron_dagger',
      inputs: { resources: { metal: 1 } }, base_seconds: 60, base_xp: 1 });
    check(r.status === 200, 'add a recipe');
    r = await api(ad, 'POST', '/api/crafting/admin/recipes', { recipe_key: key, name: 'x', class_key: 'blacksmith', station: 'smithy', output_key: 'iron_dagger' });
    check(r.status === 409, 'keys are unique');
    r = await api(ad, 'PATCH', `/api/crafting/admin/recipes/${key}`, { inputs: { resources: { mana: 2 } } });
    check(r.status === 400, 'unknown resources refused');
    r = await api(ad, 'PATCH', `/api/crafting/admin/recipes/${key}`, { output_key: 'nope_nope' });
    check(r.status === 400, 'output must be a real item');
    r = await api(ad, 'PATCH', `/api/crafting/admin/recipes/${key}`, { min_level: 2, name: 'Test Nails' });
    check(r.status === 200 && (await q('SELECT min_level, name FROM recipes WHERE recipe_key=$1', [key])).rows[0].min_level === 2, 'edit a recipe');
    r = await api(ad, 'DELETE', `/api/crafting/admin/recipes/${key}`);
    r = await api(a, 'GET', '/api/crafting/station/smithy');
    check(!r.body.recipes.some(x => x.recipe_key === key), 'archived recipes leave the station');
    await q('DELETE FROM recipes WHERE recipe_key=$1', [key]);
  } else console.log('  (CRAFTING_TEST_ADMIN_ID not set — skipping Dev Tools checks)');

  console.log('Recipes to learn');
  const HID = /Not known yet/;
  const L1 = await user('learn', [['jeweller', 2]]);
  const jA = await citizen(L1, 'jeweller', { name: 'Amber' }), jB = await citizen(L1, 'jeweller', { name: 'Beryl' });
  await careers.adminGrant(L1.sid, jA, 'jeweller', { level: 6 });
  await careers.adminGrant(L1.sid, jB, 'jeweller', { level: 6 });
  r = await api(L1, 'GET', '/api/crafting/station/jeweller');
  const amulet = r.body.recipes.find(x => x.recipe_key === 'miners_amulet');
  check(amulet && amulet.hidden && !amulet.known && HID.test(r.body.crafters.find(c => c.id === jA).can.miners_amulet), 'a hidden recipe is locked until the town learns it');
  r = await api(L1, 'POST', '/api/crafting/jobs', { citizen_id: jA, recipe_key: 'miners_amulet', qty: 1 });
  check(r.status === 400 && HID.test(r.body.error), '…and can\'t be queued');
  const sch = async (p, key, n = 1) => (await q(`INSERT INTO inventory_items (settlement_id,item_key,name,icon,category,rarity,quantity) VALUES ($1,$2,'Schematic','📜','schematic','uncommon',$3) RETURNING id`, [p.sid, key, n])).rows[0].id;
  const schA = await sch(L1, 'schematic_miners_amulet', 2);
  r = await api(L1, 'POST', `/api/crafting/schematics/${schA}/study`);
  check(r.status === 200 && r.body.recipe === 'Miner\'s Amulet' && (await q('SELECT quantity FROM inventory_items WHERE id=$1', [schA])).rows[0].quantity === 1,
    'studying a schematic uses one up');
  r = await api(L1, 'GET', '/api/crafting/station/jeweller');
  check(r.body.crafters.every(c => c.can.miners_amulet === null) && r.body.recipes.find(x => x.recipe_key === 'miners_amulet').known,
    'the whole town knows it now: both jewellers can make it');
  r = await api(L1, 'POST', `/api/crafting/schematics/${schA}/study`);
  check(r.status === 409 && (await q('SELECT quantity FROM inventory_items WHERE id=$1', [schA])).rows[0].quantity === 1, 'a known recipe: refused, the schematic is kept to sell');
  await ore(L1.sid, 1);
  const oreId = (await q("SELECT id FROM inventory_items WHERE settlement_id=$1 AND item_key='iron_ore' LIMIT 1", [L1.sid])).rows[0].id;
  r = await api(L1, 'POST', `/api/crafting/schematics/${oreId}/study`);
  check(r.status === 400, 'only schematics can be studied');
  const otherTown = await user('other');
  const schB = await sch(otherTown, 'schematic_harvest_brooch');
  r = await api(L1, 'POST', `/api/crafting/schematics/${schB}/study`);
  check(r.status === 404, 'not someone else\'s');
  await q('UPDATE settlements SET silver = 10 WHERE id = $1', [L1.sid]);
  r = await api(L1, 'POST', '/api/crafting/jobs', { citizen_id: jB, recipe_key: 'miners_amulet', qty: 1 });
  check(r.status === 200, 'a learned recipe queues like any other');

  console.log('Discovery while crafting');
  const D1 = await user('disc', [['smithy', 3]]);
  const ws12 = await citizen(D1, 'blacksmith', { name: 'Garnet', stats: { strength: 8, agility: 8, endurance: 8, intelligence: 8, charisma: 8 } });
  await careers.adminGrant(D1.sid, ws12, 'blacksmith', { level: 12 });
  await q("UPDATE citizen_classes SET spec = 'weaponsmith' WHERE citizen_id = $1 AND class_key = 'blacksmith'", [ws12]);
  const finish = async (p, cid, rand) => {
    await api(p, 'POST', '/api/crafting/jobs', { citizen_id: cid, recipe_key: 'iron_dagger', qty: 1 });
    const jobsNow = (await jobsOf(cid)).filter(x => x.status === 'active');
    await due(jobsNow[0].id);
    await crafting.resolveDue(p.sid, { rand });
    return (await q('SELECT * FROM craft_jobs WHERE id=$1', [jobsNow[0].id])).rows[0];
  };
  let jobRow = await finish(D1, ws12, () => 0.99);
  check(!jobRow.roll.discovered && !(await crafting.knownSet(null, D1.sid)).size, 'most pieces teach nothing new');
  jobRow = await finish(D1, ws12, () => 0);
  const knownNow = await crafting.knownSet(null, D1.sid);
  check(jobRow.roll.discovered === 'Falchion' && knownNow.has('falchion') && !knownNow.has('tower_shield'), 'a Lv12 Weaponsmith discovers the Falchion (Lv14) — never the Armorer\'s Tower Shield');
  const howLearned = (await q('SELECT source, citizen_id FROM settlement_recipes WHERE settlement_id=$1 AND recipe_key=$2', [D1.sid, 'falchion'])).rows[0];
  check(howLearned && howLearned.source === 'discovery' && howLearned.citizen_id === ws12, 'recorded as Garnet\'s discovery');
  jobRow = await finish(D1, ws12, () => 0);
  check(!jobRow.roll.discovered && knownNow.size === 1, 'nothing left on their path to discover');
  const D2 = await user('disc2', [['smithy', 3]]);
  const ws11 = await citizen(D2, 'blacksmith', { name: 'Flint' });
  await careers.adminGrant(D2.sid, ws11, 'blacksmith', { level: 11 });
  await q("UPDATE citizen_classes SET spec = 'weaponsmith' WHERE citizen_id = $1 AND class_key = 'blacksmith'", [ws11]);
  jobRow = await finish(D2, ws11, () => 0);
  check(!jobRow.roll.discovered, 'no more than two levels beyond the crafter');

  console.log('Shields');
  const S1 = await user('shield', [['workshop', 1]]);
  const carpId = await citizen(S1, 'carpenter', { name: 'Ash' });
  await careers.adminGrant(S1.sid, carpId, 'carpenter', { level: 4 });
  jobRow = await (async () => {
    await api(S1, 'POST', '/api/crafting/jobs', { citizen_id: carpId, recipe_key: 'wooden_buckler', qty: 1 });
    const jobsNow = (await jobsOf(carpId)).filter(x => x.status === 'active');
    await due(jobsNow[0].id);
    await crafting.resolveDue(S1.sid, { rand: () => 0.999 });
    return (await q('SELECT * FROM craft_jobs WHERE id=$1', [jobsNow[0].id])).rows[0];
  })();
  const buckler = (await q("SELECT * FROM inventory_items WHERE settlement_id=$1 AND item_key='wooden_buckler'", [S1.sid])).rows[0];
  check(buckler && buckler.equip_slot === 'shield' && buckler.metadata.item_effects[0].type === 'injury'
    && buckler.metadata.item_effects[0].value === Math.round(-2 * M.QUALITY_STAT_MULT[buckler.metadata.quality]), 'a carpenter makes a Wooden Buckler; its protection follows its quality');
  const guardId = await citizen(S1, 'soldier', { name: 'Tor' });
  const sw2 = (await q("INSERT INTO inventory_items (settlement_id,item_key,name,category,quantity,equip_slot,stat_bonuses) VALUES ($1,'iron_sword','Iron Sword','equipment',1,'weapon','{\"combat\":2}') RETURNING id", [S1.sid])).rows[0].id;
  const ar2 = (await q("INSERT INTO inventory_items (settlement_id,item_key,name,category,quantity,equip_slot,stat_bonuses) VALUES ($1,'chainmail','Chainmail','equipment',1,'armour','{\"combat\":2}') RETURNING id", [S1.sid])).rows[0].id;
  const injBefore = ((await careers.profilesFor(null, S1.sid)).get(guardId) || { effects: {} }).effects.injury || 0;
  for (const id of [sw2, ar2, buckler.id]) await api(S1, 'PATCH', `/api/inventory/${id}`, { equipped_to: guardId });
  const wornSlots = (await q('SELECT equip_slot FROM inventory_items WHERE equipped_to=$1 ORDER BY equip_slot', [guardId])).rows.map(x => x.equip_slot);
  check(wornSlots.join() === 'armour,shield,weapon', 'a shield is worn alongside a weapon and armour');
  const injAfter = (await careers.profilesFor(null, S1.sid)).get(guardId).effects.injury;
  check(injAfter === injBefore + buckler.metadata.item_effects[0].value, `the guard is harder to hurt (injury risk ${injBefore} → ${injAfter})`);

  console.log('Straight to a stall');
  const M1 = await user('stall', [['smithy', 1]]);
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'market',1)", [M1.sid]);
  const sm1 = await citizen(M1, 'blacksmith', { name: 'Cole' });
  r = await api(M1, 'POST', '/api/crafting/jobs', { citizen_id: sm1, recipe_key: 'iron_dagger', qty: 1, list: { markup: 0.3 } });
  check(r.status === 400 && /Markup/.test(r.body.error), 'markup is 0, 10, 25 or 50%');
  r = await api(M1, 'POST', '/api/crafting/jobs', { citizen_id: sm1, recipe_key: 'iron_dagger', qty: 1, list: { markup: 0.1 } });
  check(r.status === 200, 'queue a dagger to sell at +10%');
  let jobsNow = (await jobsOf(sm1)).filter(x => x.status === 'active');
  check(jobsNow[0].options.list && jobsNow[0].options.list.markup === 0.1, 'the job remembers to list it');
  await due(jobsNow[0].id);
  await crafting.resolveDue(M1.sid, { rand: () => 0.5 });
  jobRow = (await q('SELECT * FROM craft_jobs WHERE id=$1', [jobsNow[0].id])).rows[0];
  const dagListing = (await q("SELECT * FROM market_orders WHERE seller_settlement_id=$1 AND item_key='iron_dagger' AND status='active'", [M1.sid])).rows[0];
  const dagVal = dagListing && dagListing.item_snapshot.metadata.sell_value;
  check(dagListing && jobRow.roll.listed && dagListing.lot_price === Math.round(dagVal * 1.1) && jobRow.roll.listed.price === dagListing.lot_price,
    `listed at its value +10% (no trades yet): ${dagListing && dagListing.lot_price}`);
  check(!(await q("SELECT 1 FROM inventory_items WHERE settlement_id=$1 AND item_key='iron_dagger'", [M1.sid])).rowCount, 'it left the stores for the stall');
  check(dagListing && dagListing.item_snapshot.metadata.crafted_by.name === 'Cole', 'the stall shows the crafter\'s mark');
  // Fill the remaining stalls, then the next piece can't be listed.
  const stallsNow = await require('../lib/market').stallState({ query: q }, M1.sid);
  const freeStalls = Object.values(stallsNow).reduce((n, v) => n + Math.max(0, v.free || 0), 0);
  for (let i = 0; i < freeStalls; i++) {
    await q(`INSERT INTO market_orders (seller_settlement_id, kind, item_key, item_snapshot, venue, lot_size, lot_price, qty_total, qty_escrowed, expires_at)
             VALUES ($1,'item','iron_ore','{"name":"Iron Ore","item_key":"iron_ore","category":"material"}','market',1,5,1,1,NOW() + interval '1 day')`, [M1.sid]);
  }
  await api(M1, 'POST', '/api/crafting/jobs', { citizen_id: sm1, recipe_key: 'iron_dagger', qty: 1, list: { markup: 0 } });
  jobsNow = (await jobsOf(sm1)).filter(x => x.status === 'active');
  await due(jobsNow[0].id);
  await crafting.resolveDue(M1.sid, { rand: () => 0.5 });
  jobRow = (await q('SELECT * FROM craft_jobs WHERE id=$1', [jobsNow[0].id])).rows[0];
  check(jobRow.status === 'done' && !jobRow.roll.listed && /full/.test(jobRow.roll.list_failed || '') && (await q("SELECT 1 FROM inventory_items WHERE settlement_id=$1 AND item_key='iron_dagger'", [M1.sid])).rowCount === 1,
    `stalls full: kept in the stores, and says why ("${jobRow.roll.list_failed}")`);
  const N1 = await user('nomkt', [['smithy', 1]]);
  const sm2 = await citizen(N1, 'blacksmith', { name: 'Dell' });
  jobRow = await finish(N1, sm2, () => 0.5);
  await api(N1, 'POST', '/api/crafting/jobs', { citizen_id: sm2, recipe_key: 'iron_dagger', qty: 1, list: { markup: 0.25 } });
  jobsNow = (await jobsOf(sm2)).filter(x => x.status === 'active');
  await due(jobsNow[0].id);
  await crafting.resolveDue(N1.sid, { rand: () => 0.5 });
  jobRow = (await q('SELECT * FROM craft_jobs WHERE id=$1', [jobsNow[0].id])).rows[0];
  check(/shopkeeper|Market/.test(jobRow.roll.list_failed || '') && (await q("SELECT COUNT(*)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key='iron_dagger'", [N1.sid])).rows[0].n === 2,
    'no Market: the piece stays home');

  console.log('Catching up');
  const C1 = await user('catchup', [['smithy', 1]]);
  const cu = await citizen(C1, 'blacksmith', { name: 'Hale' });
  await api(C1, 'POST', '/api/crafting/jobs', { citizen_id: cu, recipe_key: 'iron_dagger', qty: 5 });
  // Away for a day: the whole queue is long overdue.
  const first = (await jobsOf(cu)).find(x => x.status === 'active');
  await q("UPDATE craft_jobs SET started_at = NOW() - interval '1 day', completes_at = NOW() - interval '23 hours' WHERE id = $1", [first.id]);
  const loads0 = careers._loadStats.loads;
  await crafting.resolveDue(C1.sid, { rand: () => 0.5 });
  const loadsUsed = careers._loadStats.loads - loads0;
  check((await jobsOf(cu)).filter(x => x.status === 'done').length === 5, 'a day away: all five pieces made, one after another');
  check(loadsUsed <= 2, `…loading the town's careers ${loadsUsed}× for the whole catch-up (was 2 per piece)`);
  await api(C1, 'GET', '/api/crafting/station/smithy');
  const l2 = careers._loadStats.loads;
  await crafting.stationState(C1.sid, 'smithy');
  check(careers._loadStats.loads - l2 === 1, 'the workshop view loads careers once');

  console.log('Schematic loot');
  const G1 = await user('loot');
  const gotSch = await crafting.grantRandomSchematic({ query: q }, G1.sid, () => 0, 'quest');
  const gotRow = gotSch && (await q('SELECT * FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [G1.sid, gotSch.item_key])).rows[0];
  check(gotRow && gotRow.category === 'schematic' && gotRow.item_key.startsWith('schematic_'), `loot can be a schematic (${gotSch && gotSch.name})`);
  r = await api(G1, 'POST', `/api/crafting/schematics/${gotRow.id}/study`);
  check(r.status === 200, '…which can be studied');
  const pickCount = {};
  for (let i = 0; i < 200; i++) { const t = await crafting.randomSchematic({ query: q }, (() => { const u = (i + 0.5) / 200; return () => u; })()); pickCount[t.min_level] = (pickCount[t.min_level] || 0) + 1; }
  const lvls = Object.keys(pickCount).map(Number).sort((a, b) => a - b);
  check(pickCount[lvls[0]] > pickCount[lvls[lvls.length - 1]], 'lower-level schematics turn up more often');
  if (process.env.CRAFTING_TEST_ADMIN_ID) {
    const adm = await user('admin2', [], Number(process.env.CRAFTING_TEST_ADMIN_ID));
    r = await api(adm, 'POST', '/api/crafting/admin/recipes/sledge/teach');
    check(r.status === 200 && (await crafting.knownSet(null, adm.sid)).has('sledge'), 'Dev Tools: teach my town a recipe');
    await q("DELETE FROM settlement_recipes WHERE settlement_id=$1 AND recipe_key='sledge'", [adm.sid]);
  }

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
