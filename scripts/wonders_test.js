// ══════════════════════════════════════════════════════════════════════════
//  wonders_test — a City's Great Works (lib/wonders.js, routes/wonders.js),
//  their bonuses and upkeep (lib/town_mods.js), and the Great Works board.
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/wonders_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const W = require('../lib/wonders');
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  console.log('Definitions');
  check(W.KEYS.length === 5 && W.STAGES === 3, 'five wonders, three stages each');
  const c1 = W.stageCost('starfall_spire', 0), c3 = W.stageCost('starfall_spire', 2);
  check(c1.mithril === 10 && c3.mithril === 25 && c3.moonsilver > c1.moonsilver, 'later stages cost more (mithril 10 → 25 for the Spire)');
  check(W.KEYS.every(k => Object.keys(W.DEFS[k].base).some(r => ['steel', 'silver', 'gems', 'goldore', 'obsidian', 'moonsilver', 'mithril', 'bronze'].includes(r))), 'every wonder needs metals or rare materials');
  const RS = require('../lib/research_defs');
  check(RS.PROJECTS.monuments.tier === 6 && RS.PROJECTS.eternal_works.tier === 8 && RS.PROJECTS.monuments.branch === 'building', 'the Building path fills eras 6 and 8 (Monuments, Eternal Works)');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const research = require('../lib/research');
  const BASE = process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID) || null;
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function town(name, tier, forceId = null) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET email = users.email RETURNING id", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    let s = (await q('SELECT id FROM settlements WHERE user_id=$1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick) VALUES ($1,$2,2,$3,-60000-$4,-60000,NOW()) RETURNING id`, [u.id, username, tier, seq])).rows[0];
    await q(`UPDATE settlements SET tier=$2, wealth=99999, food=99999, timber=99999, stone=99999, metal=99999, steel=9999, silver=9999, gems=9999,
               goldore=9999, coal=9999, obsidian=9999, moonsilver=9999, mithril=9999, bronze=9999, arrears_since=NULL WHERE id=$1`, [s.id, tier]);
    return { id: u.id, sid: s.id, username, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const res = async p => (await q('SELECT * FROM settlements WHERE id=$1', [p.sid])).rows[0];
  const due = (p, key) => q("UPDATE settlement_wonders SET building_until = NOW() - interval '1 second' WHERE settlement_id=$1 AND wonder_key=$2", [p.sid, key]);

  console.log('Who may build');
  const t = await town('wtown', 'town');
  let r = await api(t, 'GET', '/api/wonders');
  check(r.status === 200 && r.body.wonders.length === 5 && /City/.test(r.body.locked) && r.body.wonders.every(w => !w.can_build), 'a Town sees the wonders but can\'t start one');
  const c = await town('wcity', 'city');
  r = await api(c, 'GET', '/api/wonders');
  check(/scholars must learn more|Monuments/.test(r.body.locked), 'a City still needs the research (named only once its scholars can see it)');
  await research.adminComplete(c.sid, 'architecture');
  check(/Study Monuments/.test((await api(c, 'GET', '/api/wonders')).body.locked), '…then it says which');
  await research.adminComplete(c.sid, 'monuments');
  r = await api(c, 'GET', '/api/wonders');
  check(!r.body.locked && r.body.wonders.every(w => w.can_build) && r.body.wonders[0].next.hours === 12, 'with Monuments: every wonder can start; stage 1 takes 12h');

  console.log('Building');
  let before = await res(c);
  r = await api(c, 'POST', '/api/wonders/starfall_spire/build');
  let after = await res(c);
  const spire = r.body.wonders.find(w => w.key === 'starfall_spire');
  check(r.status === 200 && spire.building_until && before.mithril - after.mithril === 10 && before.gems - after.gems === 30, 'stage 1 of the Spire: paid (10 mithril, 30 gems) and building');
  check(r.body.wonders.find(w => w.key === 'great_forge').why && /busy/.test(r.body.wonders.find(w => w.key === 'great_forge').why), 'one wonder at a time');
  check((await api(c, 'POST', '/api/wonders/great_forge/build')).status === 400, '…the server refuses a second');
  check((await api(c, 'POST', '/api/wonders/starfall_spire/build')).status === 400, 'a stage can\'t be paid twice');
  await due(c, 'starfall_spire');
  r = await api(c, 'GET', '/api/wonders');
  check(r.body.wonders.find(w => w.key === 'starfall_spire').stage === 1 && !r.body.wonders.find(w => w.key === 'starfall_spire').building_until, 'when the time is up, the stage is done');
  r = await api(c, 'POST', '/api/wonders/starfall_spire/build');
  await due(c, 'starfall_spire');
  r = await api(c, 'GET', '/api/wonders');
  let sp = r.body.wonders.find(w => w.key === 'starfall_spire');
  check(sp.stage === 2 && sp.next.items[0].item_key === 'ancient_blueprint' && /Ancient Blueprint/.test(sp.why), 'the last stage needs an Ancient Blueprint');
  await q("INSERT INTO inventory_items (settlement_id,item_key,name,icon,category,quantity) VALUES ($1,'ancient_blueprint','Ancient Blueprint','📜','quest_item',1)", [c.sid]);
  const s0 = (await api(c, 'GET', '/api/game/settlement')).body.settlement;
  r = await api(c, 'POST', '/api/wonders/starfall_spire/build');
  check(r.status === 200 && Number((await q("SELECT COUNT(*)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key='ancient_blueprint'", [c.sid])).rows[0].n) === 0, 'the blueprint is used up');
  await due(c, 'starfall_spire');
  r = await api(c, 'GET', '/api/wonders');
  sp = r.body.wonders.find(w => w.key === 'starfall_spire');
  check(sp.complete && sp.active, 'the Starfall Spire is complete and working');
  const ev = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='wonder' ORDER BY id", [c.sid])).rows.map(x => x.message);
  check(ev.length === 3 && /complete/.test(ev[2]), 'each stage, and the finish, is announced');

  console.log('Bonus and upkeep');
  const s1 = (await api(c, 'GET', '/api/game/settlement')).body.settlement;
  check(s1.rates.timber > s0.rates.timber && s1.town.upkeep.wonders === 12 && s1.town.sources.some(x => /Starfall Spire/.test(x.label)), `+10% production (${s0.rates.timber} → ${s1.rates.timber} timber/hr) and 12 wealth/hr upkeep`);
  check(s1.happiness >= s0.happiness + 5 || s1.happiness === 100, 'and +5 happiness');
  await research.adminComplete(c.sid, 'eternal_works');
  check((await api(c, 'GET', '/api/game/settlement')).body.settlement.town.upkeep.wonders === 6, 'Eternal Works halves the upkeep');
  await q("UPDATE settlements SET arrears_since = NOW() WHERE id=$1", [c.sid]);
  const s2 = (await api(c, 'GET', '/api/game/settlement')).body.settlement;
  r = await api(c, 'GET', '/api/wonders');
  check(r.body.wonders.find(w => w.key === 'starfall_spire').dormant && !s2.town.sources.some(x => /Starfall/.test(x.label)), 'in arrears the wonder lies dormant');
  await q("UPDATE settlements SET arrears_since = NULL WHERE id=$1", [c.sid]);

  console.log('Effects beyond production');
  await q("INSERT INTO settlement_wonders (settlement_id, wonder_key, stage, completed_at) VALUES ($1,'sky_observatory',3,NOW()), ($1,'grand_bazaar',3,NOW()), ($1,'great_forge',3,NOW())", [c.sid]);
  const fx = await research.effectsFor(null, c.sid);
  check(Math.abs(fx.research - (require('../lib/research_defs').effectsOf(await research.doneSet(null, c.sid)).research || 0) - 0.2) < 1e-9, 'the Sky Observatory speeds research');
  check(fx.market_fee <= -0.1 && fx.carry >= 0.2 && fx.craft_speed >= 0.15 && fx.quality >= 2, 'the Grand Bazaar and Great Forge reach the Market and the workshops');

  console.log('Great Works board');
  r = await fetch(`${BASE}/api/stats/board/greatworks`).then(x => x.json());
  check(r.rows && r.rows[0].name === c.username && r.rows[0].values[0] === 4, 'the board ranks finished wonders');

  if (ADMIN) {
    console.log('Dev Tools');
    const adm = await town('wadm', 'city', ADMIN);
    await q('DELETE FROM settlement_wonders WHERE settlement_id=$1', [adm.sid]);
    r = await api(adm, 'POST', '/api/wonders/admin/finish', { key: 'great_forge' });
    check(r.status === 200 && r.body.wonders.find(w => w.key === 'great_forge').stage === 1, 'Dev Tools: finish a stage now');
    check((await api(c, 'POST', '/api/wonders/admin/finish', { key: 'great_forge' })).status === 403, 'players can\'t');
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
