// scripts/careers_test.js — citizen careers: classes, perks, traits, gear.
//
// Part 1 is pure (curve, rates, trees, profiles, production) — no database.
// Part 2 uses the database directly (lib/careers) and a running server over
// HTTP against the same DATABASE_URL. Throwaway databases only.
//
//   node scripts/careers_test.js
//   DATABASE_URL=postgres://… CAREERS_TEST_BASE=http://localhost:3999 node scripts/careers_test.js

'use strict';

const fs = require('fs'), path = require('path');
const M = require('../lib/career_math');
const C = require('../lib/careers/classes');
const T = require('../lib/careers/traits');
const P = require('../lib/careers/profiles');
const { BUILDINGS, calculateRates, calculateRatesBreakdown } = require('../buildings');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function part1() {
  console.log('Levels & XP');
  check(M.xpForLevel(1) === 0 && M.xpForLevel(10) === 1795 && M.xpForLevel(20) === 14987, 'curve: Lv10 1,795 XP, Lv20 14,987 XP');
  check(M.levelForXp(1794) === 9 && M.levelForXp(1795) === 10 && M.levelForXp(1e9) === 20, 'level boundaries; capped at 20');
  check(M.perkPoints(1) === 0 && M.perkPoints(20) === 19, 'one perk point per level after the first');
  const base = M.passiveRate({ intelligence: 8, happiness: 60 });
  check(base.perHour === 10, '10 XP/hr for an average, content worker');
  check(near(M.passiveRate({ intelligence: 18, happiness: 60 }).perHour, 13), 'intelligence 18: +30%');
  check(near(M.passiveRate({ intelligence: 8, happiness: 60, traits: ['genius'], aptitude: true }).perHour, 18.75), 'genius ×1.25 and a hidden talent ×1.5');
  check(M.passiveRate({ intelligence: 8, happiness: 60, starving: true }).perHour === 0, 'starving: no learning');
  check(near(M.nightHours(Date.UTC(2026, 0, 1, 0), Date.UTC(2026, 0, 1, 12)), 8), 'night is 01–09 UTC');
  check(M.syncedSkill(3, 10) === 5 && M.syncedSkill(7, 4) === 7 && M.syncedSkill(9, 20) === 10, 'class level lifts the old skill, never lowers it, max 10');
  check(M.outputMult({ strength: 8, endurance: 8 }, C.CLASSES.miner) === 1 && M.outputMult({ strength: 18, endurance: 13 }, C.CLASSES.miner) === 1.25,
    'output scales from the class\'s stats, centred on 8');

  console.log('Trees');
  for (const [k, c] of Object.entries(C.CLASSES)) {
    const errs = [], pos = new Set(), ids = new Set();
    for (const nd of c.tree) {
      if (ids.has(nd.id)) errs.push('dup ' + nd.id); ids.add(nd.id);
      if (!nd.id.startsWith(k + '.')) errs.push('namespace ' + nd.id);
      const p = `${nd.branch}|${nd.tier}|${nd.lane}`; if (pos.has(p)) errs.push('overlap ' + nd.id); pos.add(p);
      nd.effects.forEach(e => { if (!M.EFFECTS[e.type]) errs.push('effect ' + e.type); });
      nd.requires.forEach(r => { const q = c.tree.find(x => x.id === r); if (!q || q.tier > nd.tier) errs.push('requires ' + nd.id); });
      if (c.fork && nd.branch !== 'trunk' && !nd.capstone && nd.tier < 11) errs.push('spec tier ' + nd.id);
      if (c.fork && nd.branch === 'trunk' && nd.tier > 10) errs.push('trunk tier ' + nd.id);
      if (c.fork && nd.branch !== 'trunk' && !c.fork.some(f => f.key === nd.branch)) errs.push('branch ' + nd.id);
      if (nd.capstone && nd.tier !== 20) errs.push('capstone ' + nd.id);
      if (nd.secret && !T.APTITUDES[nd.secret]) errs.push('secret ' + nd.id);
    }
    const caps = c.tree.filter(n => n.capstone).length;
    if (caps !== (c.fork ? 2 : 1)) errs.push('capstones ' + caps);
    check(!errs.length, `${k}: tree is well-formed${errs.length ? ' — ' + errs.join(', ') : ''}`);
  }

  console.log('Buying perks');
  const tree = C.CLASSES.farmer.tree;
  const row = (level, extra = {}) => ({ level, spec: null, nodes: {}, ...extra });
  check(M.buyBlocker(tree, row(1), 'farmer.furrow') === 'Needs level 2.', 'level gate');
  check(M.buyBlocker(tree, row(2), 'farmer.furrow') === null, 'Lv2: first trunk perk');
  check(/earlier perk/.test(M.buyBlocker(tree, row(9, { nodes: { 'farmer.furrow': 0 } }), 'farmer.early_riser')), 'prerequisites first');
  check(/Choose a path/.test(M.buyBlocker(tree, row(12), 'farmer.crop_rotation')), 'spec perks need the fork');
  check(/not chosen/.test(M.buyBlocker(tree, row(12, { spec: 'rancher' }), 'farmer.crop_rotation')), 'the other path is closed for good');
  check(/hidden talent/.test(M.buyBlocker(tree, row(7), 'farmer.green_fingers')) && M.buyBlocker(tree, row(7), 'farmer.green_fingers', { revealed: ['green_thumb'] }) === null,
    'secret perk needs its revealed talent');
  check(/No perk points/.test(M.buyBlocker(tree, row(3, { nodes: { 'farmer.furrow': 2 } }), 'farmer.weather_wise')), 'points run out');
  check(/retraining/i.test(M.buyBlocker(tree, row(5, { retrain_until: new Date(Date.now() + 1e6).toISOString() }), 'farmer.furrow', { now: Date.now() })), 'no buying while retraining');
  const capFx = M.nodeEffects(tree, { level: 20, spec: 'agronomist', nodes: { 'farmer.furrow': 3 } });
  check(capFx.some(e => e.source === 'Golden Fields') && !capFx.some(e => e.source === 'Prize Herd') && near(capFx.filter(e => e.source === 'Furrow & Seed')[0].value, 0.18),
    'effects: ranks multiply, capstone free at Lv20 on the chosen path only');
  check(M.aggregate([{ type: 'output', value: 0.4 }, { type: 'output', value: 0.4 }]).output === 0.5, 'effects clamp to their cap');

  console.log('Profiles');
  const cit = (id, role, extra = {}) => ({ id, name: 'C' + id, role, stats: { strength: 8, agility: 8, endurance: 8, intelligence: 8, charisma: 8 },
    skills: { farming: 2, combat: 3, mining: 1, fishing: 1 }, visible_traits: [], hidden_traits: [], revealed_traits: [], earned_traits: [], parent_ids: [], ...extra });
  const rows = [
    { citizen_id: 1, class_key: 'farmer', level: 14, xp: M.xpForLevel(14), spec: 'agronomist', nodes: { 'farmer.furrow': 3 } },
    { citizen_id: 2, class_key: 'farmer', level: 3, xp: M.xpForLevel(3), nodes: {} },
    { citizen_id: 4, class_key: 'forager', level: 20, xp: M.xpForLevel(20), nodes: {} },
  ];
  const gear = [{ equipped_to: 3, name: 'Steel Sword', stat_bonuses: { combat: 4 } }, { equipped_to: 3, name: 'Chainmail', stat_bonuses: { combat: 2 } },
    { equipped_to: 5, name: 'Fisher\'s Rod', stat_bonuses: { fishing: 3 } }];
  const cits = [cit(1, 'farmer'), cit(2, 'farmer', { hidden_traits: ['hay_fever'] }), cit(3, 'soldier'), cit(4, 'forager'), cit(5, 'fisher'), cit(6, 'forager')];
  const { byId, aura } = P.buildProfiles(cits, rows, gear);
  check(near(byId.get(1).outputMult, 1.18), 'perks: Furrow & Seed ×3 → +18% output');
  check(byId.get(2).mentor && byId.get(2).mentorName === 'C1' && !byId.get(1).mentor, 'a Lv10+ classmate 5+ levels up mentors');
  check(near(byId.get(2).outputMult, 0.85), 'a hidden aversion bites before anyone knows (−15%)');
  check(byId.get(3).skills.combat === 8, 'gear adds skills, at most +5 per skill (3 + 5)');
  check(near(byId.get(5).effects.output, 0.09), 'a tool for the job: +3% output per point');
  check(near(aura.forager, 0.1) && near(byId.get(6).outputMult, 1.1), 'capstone aura lifts every forager');

  console.log('Production');
  const b = [{ type: 'farm', level: 2 }, { type: 'fishing_post', level: 2 }];
  const flat = calculateRates(b, cits.map(c => ({ id: c.id, role: c.role })), 'Mice');
  const withCareers = calculateRates(b, cits.map(c => ({ id: c.id, role: c.role, profile: byId.get(c.id) })), 'Mice');
  check(withCareers.food > flat.food, 'careers raise output above the flat role numbers');
  const bd = calculateRatesBreakdown(b, cits.map(c => ({ id: c.id, name: c.name, role: c.role, profile: byId.get(c.id) })), 'Mice');
  check(near(bd.food.total, withCareers.food, 0.02), 'breakdown total matches the rate');
  check(bd.food.sources.some(s => s.kind === 'citizen_crew'), 'skilled crews show as their own row');
  const forager = calculateRates([], [{ id: 1, role: 'forager' }], 'Mice'), noOne = calculateRates([], [], 'Mice');
  check(forager.food - noOne.food === 1, 'a Forager brings +1 food with no building');
  const hut = calculateRates([{ type: 'forager_hut', level: 2 }], [{ id: 1, role: 'forager' }], 'Mice'), hutOnly = calculateRates([{ type: 'forager_hut', level: 2 }], [], 'Mice');
  check(near(hut.food - hutOnly.food, 1.5), 'a Forager Hut lifts foragers +25% per level');
  const contrib = P.citizenContributions([], [{ id: 1, role: 'farmer', profile: { outputMult: 1, effects: { 'season:winter': 0.5 } } }], BUILDINGS);
  check(near(contrib.seasonal.winter.food, 1.5), 'season know-how: extra output in that season');

  console.log('Traits');
  let i = 0; const seq = [0.1, 0, 0.1, 0.99];
  const rolled = T.rollCareerTraits(Object.keys(C.CLASSES), () => seq[i++ % seq.length]);
  check(rolled.length === 2 && T.APTITUDES[rolled[0]] && T.AVERSIONS[rolled[1]], 'a talent and an aversion can both roll');
  check(!T.AVERSIONS[rolled[1]].classes.some(c => T.APTITUDES[rolled[0]].classes.includes(c)), '…never for the same job');
  check(T.rollCareerTraits(['farmer'], () => 0.9, ['river_kin'])[0] === 'river_kin', 'an inherited talent is kept');
  check(T.traitInfo('miners_lung').kind === 'quirk' && T.traitInfo('miners_lung').good === false, 'quirks are known, good or bad');

  console.log('Shared file');
  const fe = path.join(process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend'), 'js', 'career-math.js');
  if (fs.existsSync(fe)) check(fs.readFileSync(fe, 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'lib', 'career_math.js'), 'utf8'), 'career_math.js is byte-identical to the frontend copy');
  else console.log('  ⚠ skipped byte identity — no frontend checkout');
}

async function part2() {
  const { pool } = require('../db');
  const careers = require('../lib/careers');
  const gameEvents = require('../lib/game_events');
  require('../lib/career_subscriber').register();
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CAREERS_TEST_BASE || process.env.MARKET_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let seq = 0;

  async function user(name, buildings = []) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, wealth, food, last_tick) VALUES ($1,$2,2,1000,500,NOW()) RETURNING *`, [u.id, username])).rows[0];
    for (const [type, level] of buildings) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,$3)', [s.id, type, level]);
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  async function citizen(p, role, extra = {}) {
    return (await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, career_settled_at)
                     VALUES ($1,$2,$3,$4,$5,$6,'adult',$7,$8,NOW()) RETURNING id`,
      [p.sid, extra.name || 'Cit' + seq++, role, JSON.stringify(extra.stats || { strength: 8, agility: 8, endurance: 8, intelligence: 8, charisma: 8 }),
       JSON.stringify(extra.skills || { farming: 1, mining: 1, combat: 1, scouting: 1 }), JSON.stringify({ happiness: 60, hunger: 20 }),
       JSON.stringify(extra.hidden || []), JSON.stringify(extra.visible || [])])).rows[0].id;
  }
  async function api(p, method, pth, body) {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const rowOf = async (cid, k) => (await q('SELECT * FROM citizen_classes WHERE citizen_id=$1 AND class_key=$2', [cid, k])).rows[0];
  const cOf = async cid => (await q('SELECT * FROM citizens WHERE id=$1', [cid])).rows[0];
  const ago = (cid, h) => q(`UPDATE citizens SET career_settled_at = NOW() - make_interval(secs => $2) WHERE id=$1`, [cid, h * 3600]);

  console.log('Passive XP');
  const a = await user('farm', [['farm', 1]]);
  const f1 = await citizen(a, 'farmer');
  await ago(f1, 10);
  await careers.settle(a.sid);
  let r = await rowOf(f1, 'farmer');
  check(r && near(Number(r.hours_worked), 10, 0.05) && near(Number(r.xp), 100, 1), '10 hours farming → ~100 XP and 10 hours of service');
  await ago(f1, 5);
  await Promise.all([1, 2, 3, 4, 5].map(() => careers.settle(a.sid)));
  r = await rowOf(f1, 'farmer');
  check(near(Number(r.hours_worked), 15, 0.05), 'five settles at once credit the hours once');
  await ago(f1, 2);
  await careers.settle(a.sid);
  check(near(Number((await rowOf(f1, 'farmer')).hours_worked), 15, 0.05) || Number((await rowOf(f1, 'farmer')).hours_worked) > 15, 'settling again is gated or credits only new time');
  const quester = await citizen(a, 'farmer');
  await q("INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, status, completes_at) VALUES ($1,$2,'x',$3,'active',NOW() + interval '1 hour')", [a.sid, a.id, quester]);
  await ago(quester, 6);
  await careers.settle(a.sid);
  check(!(await rowOf(quester, 'farmer')), 'away on a quest: no passive XP (the quest pays its own)');

  console.log('Jobs');
  r = await api(a, 'PATCH', `/api/citizens/${f1}/role`, { role: 'miner' });
  check(r.status === 400 && /Mine/.test(r.body.error), 'a Miner needs a Mine');
  await ago(f1, 3);
  r = await api(a, 'PATCH', `/api/citizens/${f1}/role`, { role: 'forager' });
  check(r.status === 200 && (await cOf(f1)).role === 'forager', 'anyone can forage');
  check(Number((await rowOf(f1, 'farmer')).hours_worked) >= 17.9, 'time before the switch is credited to the old job');
  r = await api(a, 'PATCH', `/api/citizens/${f1}/role`, { role: 'merchant' });
  check(r.status === 400, 'merchants are assigned from the Market, not the job list');
  r = await api(a, 'PATCH', `/api/citizens/${f1}/role`, { role: 'farmer' });
  check(r.status === 200 && Number((await rowOf(f1, 'farmer')).xp) >= 100, 'switching back: farming XP was kept');

  console.log('Levels, perks, the fork');
  await careers.adminGrant(a.sid, f1, 'farmer', { level: 10 });
  r = await rowOf(f1, 'farmer');
  check(r.level === 10 && Number((await cOf(f1)).skills.farming) === 5, 'Lv10 farmer: farming skill lifted to 5');
  const ev = (await q("SELECT narrative FROM citizen_events WHERE citizen_id=$1 AND event_type='career_level' ORDER BY id", [f1])).rows.map(x => x.narrative);
  check(ev.length === 2 && /Lv 5/.test(ev[0]) && /Lv 10/.test(ev[1]), 'milestone levels 5 and 10 go in the citizen\'s history');
  r = await api(a, 'POST', `/api/careers/citizen/${f1}/nodes`, { class_key: 'farmer', node_id: 'farmer.furrow' });
  check(r.status === 200 && r.body.nodes['farmer.furrow'] === 1 && r.body.free === 8, 'buy a trunk perk (8 points left)');
  r = await api(a, 'POST', `/api/careers/citizen/${f1}/nodes`, { class_key: 'farmer', node_id: 'farmer.crop_rotation' });
  check(r.status === 400 && /path/.test(r.body.error), 'path perks wait for the fork');
  r = await api(a, 'GET', `/api/careers/citizen/${f1}`);
  check(r.status === 200 && r.body.career.classes.find(x => x.class_key === 'farmer').fork_ready === true, 'the Career view says the fork is ready');
  r = await api(a, 'POST', `/api/careers/citizen/${f1}/fork`, { class_key: 'farmer', spec: 'agronomist' });
  check(r.status === 200, 'choose Agronomist');
  r = await api(a, 'POST', `/api/careers/citizen/${f1}/fork`, { class_key: 'farmer', spec: 'rancher' });
  check(r.status === 409, 'the path is for life');
  await careers.adminGrant(a.sid, f1, 'farmer', { level: 12 });
  r = await api(a, 'POST', `/api/careers/citizen/${f1}/nodes`, { class_key: 'farmer', node_id: 'farmer.crop_rotation' });
  check(r.status === 200, 'Lv12 Agronomist: Crop Rotation');
  r = await api(a, 'GET', '/api/citizens');
  const me = (r.body.citizens || []).find(c => c.id === f1);
  check(me && me.career.level === 12 && me.career.title === 'Agronomist' && me.class_levels.farmer === 12, 'citizen list: level and title');
  const w0 = Number((await q('SELECT wealth FROM settlements WHERE id=$1', [a.sid])).rows[0].wealth);
  r = await api(a, 'POST', `/api/careers/citizen/${f1}/retrain`, { class_key: 'farmer' });
  r = { r, row: await rowOf(f1, 'farmer'), w: Number((await q('SELECT wealth FROM settlements WHERE id=$1', [a.sid])).rows[0].wealth) };
  check(r.r.status === 200 && r.r.body.gold === 50 && r.w === w0 - 50 && Object.keys(r.row.nodes).length === 0 && r.row.spec === 'agronomist',
    'retrain: 25 gold a point, perks refunded, the path stays');
  r = await api(a, 'POST', `/api/careers/citizen/${f1}/nodes`, { class_key: 'farmer', node_id: 'farmer.furrow' });
  check(r.status === 400 && /retrain/i.test(r.body.error), 'no new perks for 2h while retraining');

  console.log('Hidden traits & service');
  const g = await citizen(a, 'farmer', { hidden: ['green_thumb', 'latent_strength'], stats: { strength: 8, agility: 8, endurance: 8, intelligence: 8, charisma: 8 } });
  await careers.adminGrant(a.sid, g, 'farmer', { hours: 30 });
  let gc = await cOf(g);
  check(gc.trait_hints.includes('green_thumb') && !gc.revealed_traits.includes('green_thumb'), '24h+: a hint, not yet a reveal');
  await careers.adminGrant(a.sid, g, 'farmer', { hours: 20 });
  gc = await cOf(g);
  check(gc.revealed_traits.includes('green_thumb'), '48h: talent revealed');
  await careers.adminGrant(a.sid, g, 'farmer', { hours: 30 });
  gc = await cOf(g);
  check(gc.revealed_traits.includes('latent_strength') && gc.stats.strength === 11, '72h of hard work: latent strength revealed, +3 strength baked in');
  await careers.adminGrant(a.sid, g, 'farmer', { hours: 30 });
  check((await cOf(g)).stats.strength === 11, '…exactly once');
  await careers.adminGrant(a.sid, g, 'farmer', { hours: 650 });
  gc = await cOf(g);
  check(gc.earned_traits.some(e => e.id === 'veteran' && e.class === 'farmer'), '720h: Veteran Farmer');
  await careers.adminGrant(a.sid, g, 'farmer', { hours: 800 });
  gc = await cOf(g);
  check(gc.earned_traits.some(e => e.class === 'farmer' && e.quirk), '1,440h: an occupational quirk');
  r = await api(a, 'GET', `/api/careers/citizen/${g}`);
  check(r.body.career.revealed_traits.some(t => t.id === 'green_thumb') && r.body.career.classes[0].years >= 50, 'Career view: revealed traits, years of service');

  console.log('Deeds, events');
  const por = await citizen(a, 'porter');
  for (let k = 0; k < 50; k++) gameEvents.emit('porter_home', { settlementId: a.sid, citizenId: por, kind: 'ironhaven', hours: 0.2 });
  await sleep(1500);
  const pc = await cOf(por);
  check(Number(pc.career_counters.porter_runs) === 50 && pc.earned_traits.some(e => e.id === 'well_travelled'), '50 porter runs: Well-Travelled');
  check(Number((await rowOf(por, 'porter')).xp) >= 50 * 7, 'porter runs pay Porter XP');
  const q1 = await citizen(a, 'forager');
  gameEvents.emit('quest_completed', { settlementId: a.sid, citizenIds: [q1], skillKeys: ['farming'], durationS: 3600, success: true });
  await sleep(400);
  r = await rowOf(q1, 'forager');
  check(r && near(Number(r.xp), 25, 0.1), 'a farming quest by a forager: full XP (foraging trains farming)');
  const sc = await citizen(a, 'scout');
  gameEvents.emit('quest_completed', { settlementId: a.sid, citizenIds: [sc], skillKeys: ['farming'], durationS: 3600, success: true });
  await sleep(400);
  r = await rowOf(sc, 'farmer');
  check(r && near(Number(r.xp), 12.5, 0.1), 'a farming quest by a scout: half XP to Farmer');
  const guard = await citizen(a, 'soldier');
  gameEvents.emit('battle_won', { settlementId: a.sid, citizenIds: [guard], enemyCount: 2 });
  await sleep(400);
  check(near(Number((await rowOf(guard, 'soldier')).xp), 20), 'a won battle pays the Guard 12 + 4 per enemy');

  console.log('Finds');
  await q("INSERT INTO item_templates (item_key,name,icon,category,rarity,sell_value) VALUES ('iron_ore','Iron Ore','⚫','material','common',8) ON CONFLICT DO NOTHING");
  const mm = await user('mine', [['mine', 1]]);
  const miner = await citizen(mm, 'miner');
  await careers.adminGrant(mm.sid, miner, 'miner', { level: 3 });
  await q("UPDATE citizen_classes SET nodes = '{\"miner.ore_nose\": 2}' WHERE citizen_id=$1", [miner]);
  await ago(miner, 24);
  await careers.settle(mm.sid);
  const ore = (await q("SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key='iron_ore'", [mm.sid])).rows[0].n;
  check(ore === 1, 'Ore Nose ×2: one iron ore a day');

  console.log('Gear');
  const tplOk = (await q("SELECT 1 FROM item_templates WHERE item_key='iron_sword'")).rowCount;
  if (!tplOk) await q("INSERT INTO item_templates (item_key,name,category,rarity,equip_slot,stat_bonuses,sell_value) VALUES ('iron_sword','Iron Sword','equipment','common','weapon','{\"combat\":2}',20)");
  const s1 = (await q("INSERT INTO inventory_items (settlement_id,item_key,name,category,quantity,equip_slot,stat_bonuses) VALUES ($1,'iron_sword','Iron Sword','equipment',1,'weapon','{\"combat\":2}') RETURNING id", [a.sid])).rows[0].id;
  const s2 = (await q("INSERT INTO inventory_items (settlement_id,item_key,name,category,quantity,equip_slot,stat_bonuses) VALUES ($1,'iron_sword','Old Sword','equipment',1,'weapon','{\"combat\":1}') RETURNING id", [a.sid])).rows[0].id;
  r = await api(a, 'PATCH', `/api/inventory/${s1}`, { equipped_to: guard });
  check(r.status === 200, 'equip a sword');
  r = await api(a, 'PATCH', `/api/inventory/${s2}`, { equipped_to: guard });
  const eq = (await q('SELECT id FROM inventory_items WHERE equipped_to=$1', [guard])).rows.map(x => x.id);
  check(r.status === 200 && r.body.replaced === 'Iron Sword' && eq.length === 1 && eq[0] === s2, 'one weapon at a time: the old one goes back');
  let dup = false;
  try { await q('UPDATE inventory_items SET equipped_to=$1 WHERE id=$2', [guard, s1]); } catch (e) { dup = e.code === '23505'; }
  check(dup, 'the database refuses two weapons on one citizen');
  const deltas = await careers.combatDeltas(a.sid, [guard]);
  check(deltas[guard] && deltas[guard].combat === 1, 'battle deltas carry gear (frozen per battle)');

  console.log('Production');
  const dead = await citizen(a, 'farmer');
  await q("UPDATE citizens SET life_stage='deceased' WHERE id=$1", [dead]);
  const kid = await citizen(a, 'farmer');
  await q("UPDATE citizens SET life_stage='child' WHERE id=$1", [kid]);
  const wf = await careers.loadWorkforce(null, a.sid);
  check(!wf.some(c => c.id === dead || c.id === kid), 'the dead and children don\'t work');
  r = await api(a, 'GET', '/api/game/settlement');
  check(r.status === 200 && typeof r.body.settlement.rates.food === 'number', 'settlement loads with career production');
  r = await api(a, 'GET', '/api/game/resource-breakdown');
  check(r.status === 200 && r.body.breakdown.food.sources.some(s => s.kind === 'citizen_role' && s.role === 'farmer'), 'breakdown lists farmers');

  console.log('Loose ends');
  r = await api(a, 'GET', `/api/combat/citizen/${f1}/events`);
  check(r.status === 200 && !(r.body.events || []).some(e => /^career|trait_/.test(e.event_type)), 'Scars tab shows injuries and deaths only, not career history');
  const kidG = (await q(`INSERT INTO citizens (settlement_id, name, gender, role, life_stage, parent_ids, hidden_traits) VALUES ($1,'Sprout','female','idle','child',$2,'["green_thumb"]') RETURNING id`,
    [a.sid, JSON.stringify([g])])).rows[0].id;
  r = await api(a, 'GET', '/api/citizens');
  const kidRow = (r.body.citizens || []).find(c => c.id === kidG);
  check(kidRow && kidRow.family_hint && kidRow.family_hint.trait === 'green_thumb', 'a child carrying a parent\'s known talent shows a family likeness');
  const away = require('../lib/away_report').eventFromCitizenEvent({ event_type: 'career_level', narrative: 'Fenn became Farmer (Lv 10).', occurred_at: new Date(), citizen_id: 1 }, 'Fenn');
  check(away.category === 'citizens' && away.icon === '🎓', 'away report files career news under Citizens');

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and CAREERS_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
