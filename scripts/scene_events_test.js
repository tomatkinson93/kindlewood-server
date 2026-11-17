// ═══════════════════════════════════════════════════════════════════════════
//  scene_events_test — events in the scene (docs/HOME_SCENE.md Part F, F.12,
//  step 26; lib/moments_scene.js): a fire, a lost child, a runaway cart.
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/scene_events_test.js
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}
const KINDS = ['scene_fire', 'scene_lost_child', 'scene_cart'];

function pure() {
  const M = require('../lib/moments'), S = require('../lib/moments_scene');
  console.log('The three kinds');
  check(KINDS.every(k => M.DEFS[k] && M.DEFS[k].source === 'scene'), 'a fire, a lost child and a runaway cart are moments like any other');
  check(KINDS.every(k => M.DEFS[k].weight > 0 && !M.DEFS[k].triggerOnly && M.DEFS[k].cooldownDays >= 4), 'they are rolled within the daily budget, each with a cooldown of days');
  check(KINDS.every(k => M.DEFS[k].gentle === false), 'none of them is a new town\'s first moment');
  check(KINDS.every(k => M.DEFS[k].expireHours >= 2 && M.DEFS[k].expireHours <= 6), 'they are short: two to six hours');
  const full = { speaker: 'Ash Oak', building: 'Tavern', building_id: 1, timber: 15, helpers: [1, 2], child: { id: 9, name: 'Dot Oak' }, parents: [1], grown: [1, 2], hero: { id: 2, name: 'Bea Oak' }, food: 25 };
  check(KINDS.every(k => M.check(k, full).length === 0 && M.check(k, {}).length === 0), 'every option has a hint, and the default is an option and never the worst', KINDS.map(k => M.check(k, full)));
  const reads = KINDS.map(k => M.DEFS[k].text(full) + ' ' + M.DEFS[k].options(full).map(o => o.label + ' ' + o.hint).join(' ') + ' ' + M.DEFS[k].text({}) + ' ' + M.DEFS[k].options({}).map(o => o.label + ' ' + o.hint).join(' '));
  check(reads.every(t => !/undefined|null|NaN|\[object/.test(t)), 'they read cleanly with and without their details');
  const p = M.present({ id: 1, kind: 'scene_lost_child', subject: { scene: 'lost_child', seed: 5 }, data: full, created_at: new Date(), expires_at: new Date() });
  check(p.options.find(o => o.key === 'found').scene === true && p.options.filter(o => o.scene).length === 1 && p.subject.scene === 'lost_child' && p.fallback === 'search', 'finding the child is marked as something done in the scene; the default is the safe search');
  const f = M.present({ id: 2, kind: 'scene_fire', subject: { scene: 'fire', building: 'tavern' }, data: full, created_at: new Date(), expires_at: new Date() });
  check(f.options.every(o => !o.scene) && f.fallback === 'buckets' && f.subject.building === 'tavern', 'a fire says which building, and its default is the bucket chain');
  check(S.CONFIG.BUCKETS_SAVE >= 0.7 && S.CONFIG.WAIT_HOME >= 0.6 && S.CONFIG.CART_BRUISE <= 0.3 && S.CONFIG.FIRE_DAMAGE <= 40, 'the odds lean kind, and the harm is small');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const M = require('../lib/moments'), S = require('../lib/moments_scene');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async () => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `se_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const tq = -160000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, food, timber, stone, wealth) VALUES ($1,$2,2,'village',$3,0,NOW(),500,500,500,500) RETURNING id`, [u.id, username, tq])).rows[0];
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, api };
  };
  const mk = async (sid, name, stage = 'adult', parents = []) => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, life_stage, parent_ids, visible_traits, life)
      VALUES ($1,$2,'female','idle',$3,$4,'[]','{"happiness":60}') RETURNING id`, [sid, name, stage, JSON.stringify(parents)])).rows[0].id;
  const happyOf = async id => Number((await q("SELECT life->>'happiness' AS h FROM citizens WHERE id = $1", [id])).rows[0].h);
  const stock = async sid => { const r = (await q('SELECT food, timber FROM settlements WHERE id = $1', [sid])).rows[0]; return { food: Number(r.food), timber: Number(r.timber) }; };
  // The dice, held: the same number every time while `fn` runs.
  const withDice = async (v, fn) => { const real = Math.random; Math.random = () => v; try { return await fn(); } finally { Math.random = real; } };
  const fresh = async (sid, kind) => { await q('DELETE FROM moments WHERE settlement_id = $1', [sid]); return M.start(sid, kind, { force: true }); };

  console.log('A fire');
  {
    const t = await mkTown();
    check((await M.start(t.id, 'scene_fire')) === null, 'no villagers, no buildings: no fire');
    const a = await mk(t.id, 'Ash Oak'), b = await mk(t.id, 'Bea Oak');
    await q(`INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'guild_hall',1)`, [t.id]);
    await q(`INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'starter_house',1)`, [t.id]);
    check((await M.start(t.id, 'scene_fire')) === null, 'the Guild Hall never burns, and housing is not a building in the scene');
    const tav = (await q(`INSERT INTO buildings (settlement_id, type, level, health) VALUES ($1,'tavern',1,100) RETURNING id`, [t.id])).rows[0].id;
    let m = await fresh(t.id, 'scene_fire');
    check(m && m.subject.scene === 'fire' && m.subject.building === 'tavern' && m.subject.building_id === tav && [a, b].includes(m.subject.citizen_ids[0]) && Number.isInteger(m.subject.seed), 'it names the building and who raised the alarm', m && m.subject);
    check(/Tavern is on fire/.test(m.text) && m.options.map(o => o.key).join() === 'buckets,roof', 'two choices: a bucket chain or the roof', m.text);
    const hours = (new Date(m.expires_at) - new Date(m.created_at)) / 3600e3;
    check(Math.abs(hours - S.CONFIG.FIRE_HOURS) < 0.01, 'it lasts three hours');
    let before = await stock(t.id), h0 = await happyOf(a);
    let r = await withDice(0.1, () => M.choose(t.id, m.id, 'buckets'));
    check(r.ok && /safe/.test(r.outcome) && (await stock(t.id)).timber === before.timber && (await happyOf(a)) === h0 + S.CONFIG.FIRE_HELP_HAPPY, 'the chain works: nothing lost, and the helpers are prouder');
    m = await fresh(t.id, 'scene_fire'); before = await stock(t.id);
    r = await withDice(0.99, () => M.choose(t.id, m.id, 'buckets'));
    check(r.ok && /too slow/.test(r.outcome) && before.timber - (await stock(t.id)).timber === 15 && Number((await q('SELECT health FROM buildings WHERE id = $1', [tav])).rows[0].health) === 100, 'the chain is too slow: a little timber goes into mending it (upkeep off: no wear)', r.outcome);
    await q('UPDATE settlements SET upkeep_on = TRUE WHERE id = $1', [t.id]);
    m = await fresh(t.id, 'scene_fire');
    await withDice(0.99, () => M.choose(t.id, m.id, 'buckets'));
    check(Number((await q('SELECT health FROM buildings WHERE id = $1', [tav])).rows[0].health) === 100 - S.CONFIG.FIRE_DAMAGE, 'with upkeep on, the building is the worse for wear');
    await q('UPDATE buildings SET health = 5 WHERE id = $1', [tav]);
    m = await fresh(t.id, 'scene_fire');
    await withDice(0.99, () => M.choose(t.id, m.id, 'buckets'));
    check(Number((await q('SELECT health FROM buildings WHERE id = $1', [tav])).rows[0].health) === 1, 'a fire never breaks a building outright');
    m = await fresh(t.id, 'scene_fire'); before = await stock(t.id);
    r = await M.choose(t.id, m.id, 'roof');
    check(r.ok && before.timber - (await stock(t.id)).timber === 15 && /roof came down/.test(r.outcome), 'pulling down the roof always works and costs its timber');
    await q('UPDATE settlements SET timber = 4 WHERE id = $1', [t.id]);
    m = await fresh(t.id, 'scene_fire');
    r = await M.choose(t.id, m.id, 'roof');
    check(r.ok && (await stock(t.id)).timber === 0 && /4 timber/.test(r.outcome), 'short of timber: it takes what there is, never below nothing');
    const ch = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'moment' ORDER BY id DESC LIMIT 1", [t.id])).rows[0];
    check(ch && /Fire at the Tavern/.test(ch.text), 'the chronicle keeps it', ch && ch.text);
    await q('UPDATE buildings SET health = 0 WHERE id = $1', [tav]);
    check((await fresh(t.id, 'scene_fire')) === null, 'a broken building does not catch fire');
  }

  console.log('A lost child');
  {
    const t = await mkTown();
    const mum = await mk(t.id, 'Mum Elm'), other = await mk(t.id, 'Nan Elm');
    check((await M.start(t.id, 'scene_lost_child')) === null, 'no children: nobody to lose');
    const kid = await mk(t.id, 'Dot Elm', 'child', [mum]);
    let m = await fresh(t.id, 'scene_lost_child');
    check(m && m.subject.scene === 'lost_child' && m.subject.child_id === kid && m.subject.citizen_ids[0] === mum && m.subject.citizen_ids[1] === kid && /Mum cannot find Dot/.test(m.text), 'a parent asks (and carries the mark), and the scene is told which child', m && m.text);
    check(m.options.map(o => o.key).join() === 'found,search,wait' && m.options[0].scene === true, 'find them yourself (in the scene), call a search, or wait');
    let r = await M.choose(t.id, m.id, 'found');
    check(r.ok && (await happyOf(kid)) === 60 + S.CONFIG.FOUND_HAPPY && (await happyOf(mum)) === 60 + S.CONFIG.FOUND_PARENT_HAPPY && (await happyOf(other)) === 60, 'found in the scene: the child and the parent are happier');
    m = await fresh(t.id, 'scene_lost_child');
    r = await M.choose(t.id, m.id, 'search');
    check(r.ok && (await happyOf(other)) === 59 && (await happyOf(kid)) === 65, 'a search always finds them; every grown villager is a little tired');
    m = await fresh(t.id, 'scene_lost_child');
    r = await withDice(0.1, () => M.choose(t.id, m.id, 'wait'));
    check(r.ok && /supper/.test(r.outcome) && (await happyOf(kid)) === 65, 'waiting: usually they come home');
    m = await fresh(t.id, 'scene_lost_child');
    r = await withDice(0.99, () => M.choose(t.id, m.id, 'wait'));
    check(r.ok && /cold and frightened/.test(r.outcome) && (await happyOf(kid)) === 65 + S.CONFIG.WAIT_FRIGHT, 'sometimes cold and frightened');
    m = await fresh(t.id, 'scene_lost_child');
    await q('UPDATE moments SET expires_at = NOW() - interval \'1 minute\' WHERE id = $1', [m.id]);
    await M.tick(true);
    const done = (await q('SELECT choice, auto FROM moments WHERE id = $1', [m.id])).rows[0];
    check(done.choice === 'search' && done.auto === true, 'nobody answers: the town searches (the safe default)', done);
  }

  console.log('A runaway cart');
  {
    const t = await mkTown();
    check((await M.start(t.id, 'scene_cart')) === null, 'nobody grown: no cart');
    const hero = await mk(t.id, 'Cob Ash');
    let m = await fresh(t.id, 'scene_cart');
    check(m && m.subject.scene === 'cart' && m.subject.citizen_ids[0] === hero && /Cob is nearest/.test(m.text) && m.options.map(o => o.key).join() === 'stop,let_go' && m.fallback === 'let_go', 'stop it or let it go; left alone, it is let go', m && m.text);
    let before = await stock(t.id);
    let r = await withDice(0.9, () => M.choose(t.id, m.id, 'stop'));
    check(r.ok && (await stock(t.id)).food - before.food === 25 && (await happyOf(hero)) === 60 + S.CONFIG.CART_HERO_HAPPY, 'stopped: its load is saved and the catcher is pleased');
    m = await fresh(t.id, 'scene_cart'); before = await stock(t.id);
    r = await withDice(0.05, () => M.choose(t.id, m.id, 'stop'));
    check(r.ok && /bruised/.test(r.outcome) && (await stock(t.id)).food - before.food === 25 && (await happyOf(hero)) === 63 + S.CONFIG.CART_BRUISE_HAPPY, 'one time in four the catcher is bruised; the load is still saved');
    m = await fresh(t.id, 'scene_cart'); before = await stock(t.id);
    r = await M.choose(t.id, m.id, 'let_go');
    check(r.ok && before.timber - (await stock(t.id)).timber === 8 && (await stock(t.id)).food === before.food, 'let go: the cart is lost (a little timber), nobody hurt');
    r = await M.choose(t.id, m.id, 'stop');
    check(r.status === 404, 'a settled moment cannot be answered again');
  }

  console.log('The budget, and the route');
  {
    const t = await mkTown(); await mk(t.id, 'Eve Yew'); await mk(t.id, 'Fay Yew'); await mk(t.id, 'Gil Yew', 'child');
    await q(`INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'tavern',1)`, [t.id]);
    for (let i = 0; i < M.CONFIG.CAP; i++) await q(`INSERT INTO moments (settlement_id, kind, subject, data, expires_at) VALUES ($1,'scene_cart','{}','{}', NOW() + interval '1 hour')`, [t.id]);
    check((await M.roll(t.id)) === null, 'at the cap, nothing new starts');
    await q('DELETE FROM moments WHERE settlement_id = $1', [t.id]);
    await q(`INSERT INTO moments (settlement_id, kind, subject, data, expires_at, created_at, resolved_at) VALUES ($1,'scene_fire','{}','{}', NOW(), NOW() - interval '2 days', NOW() - interval '2 days')`, [t.id]);
    const seen = new Set();
    for (let i = 0; i < 40; i++) { const m = await M.roll(t.id, Date.now(), Math.random); if (m) { seen.add(m.kind); await q('DELETE FROM moments WHERE id = $1', [m.id]); } }
    check(!seen.has('scene_fire'), 'a fire two days ago: no second fire inside its cooldown', [...seen]);
    const m = await fresh(t.id, 'scene_lost_child');
    let x = await t.api('GET', '/api/moments');
    const got = (x.body.moments || []).find(y => y.id === m.id);
    check(x.status === 200 && got && got.subject.scene === 'lost_child' && got.options[0].scene === true, 'GET /api/moments carries the scene and the scene-only option');
    x = await t.api('POST', `/api/moments/${m.id}`, { choice: 'found' });
    check(x.status === 200 && /found/i.test(x.body.outcome), 'POST /api/moments/:id { choice: "found" }', x.body);
    x = await t.api('POST', `/api/moments/${m.id}`, { choice: 'found' });
    check(x.status === 404, 'once only');
  }

  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
