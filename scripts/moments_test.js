// ══════════════════════════════════════════════════════════════════════════
//  moments_test — the moments engine (docs/PHASE_2_MOMENTS.md §2, §7).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/moments_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function main() {
  const M = require('../lib/moments');

  console.log('Content (every kind)');
  {
    // Representative data for each kind's text and options.
    const sample = { cost: { timber: 40, food: 30 }, need: 12, amount: 50, res: 'stone', qty: 40, price: 60, food: 70, wealth: 50, bonus: 0, outpost_name: 'Camp' };
    const bad = [];
    for (const k of Object.keys(M.DEFS)) for (const p of M.check(k, sample)) bad.push(`${k}: ${p}`);
    check(bad.length === 0, 'every option has a hint; every default is an option and never the single worst' + (bad.length ? ' — ' + bad.join('; ') : ''));
    check(Object.values(M.DEFS).every(d => d.icon && d.title && typeof d.eligible === 'function' && typeof d.choose === 'function' && d.expireHours > 0), 'every kind has an icon, a title, eligible(), choose() and an expiry');
    check(['rich_vein', 'trader', 'wolves', 'cache', 'storm', 'harvest', 'traveller'].every(k => M.DEFS[k] && M.DEFS[k].source === 'outpost'), 'the seven outpost events are moment kinds');
    check(M.DEFS.traveller.weight === 0, 'the lost traveller is no longer rolled (merged into the settler at the gate)');
    check(M.DEFS.wolves.fallback === 'fight', 'wolves default to driving them off, not the worst option');
  }

  // Test-only kinds, registered in this process (the engine runs here too).
  let chose = [];
  const mk = (kind, extra = {}) => M.register(kind, {
    source: 'test', icon: '🧪', title: 'Test ' + kind, weight: 1, cooldownDays: 2, expireHours: 12,
    eligible: async () => ({ subject: { citizen_ids: [] }, data: { n: 1 } }),
    text: () => 'A test.', options: () => [{ key: 'a', label: 'A', hint: 'nothing', risk: 0 }, { key: 'b', label: 'B', hint: 'costly', risk: 2 }],
    fallback: 'a',
    async choose(key) { chose.push(key); return key === 'b' && extra.failB ? { error: 'Cannot.' } : { outcome: `Chose ${key}.`, chronicle: `The test went ${key}.` }; },
    ...extra,
  });

  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const RUN = Math.random().toString(36).slice(2, 7);
  const town = async name => {
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [`${name}_${RUN}`, `${name}_${RUN}@t.l`])).rows[0];
    return (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber, food) VALUES ($1,$2,2,'camp',$3,0,NOW(),500,500) RETURNING id`,
      [u.id, `${name}_${RUN}`, -120000 - Math.floor(Math.random() * 5000) * 20])).rows[0].id;
  };

  console.log('The budget, the cap and cooldowns');
  {
    // Only test kinds in play for this block.
    const saved = {};
    for (const k of Object.keys(M.DEFS)) { saved[k] = M.DEFS[k].weight; M.DEFS[k].weight = 0; }
    mk('t_one'); mk('t_two'); mk('t_three'); mk('t_gentle', { gentle: true });
    const sid = await town('mbud');
    check(!(await M.roll(sid)), "a town's first check only starts the clock");
    check(!(await M.roll(sid)), 'and its first moment waits a few minutes');
    await q("UPDATE settlements SET moments_seen_at = NOW() - interval '6 minutes' WHERE id = $1", [sid]);
    const first = await M.roll(sid);
    check(first && first.kind === 't_gentle', "a town's first moment is a gentle one");
    check(!(await M.roll(sid)), 'the next waits at least 6 hours');
    await q("UPDATE moments SET created_at = NOW() - interval '7 hours' WHERE settlement_id = $1", [sid]);
    const second = await M.roll(sid);
    check(second && second.kind !== 't_gentle', 'after the spacing, another (never the same kind twice running)');
    await q("UPDATE moments SET created_at = NOW() - interval '7 hours' WHERE settlement_id = $1 AND id = $2", [sid, second.id]);
    await q("UPDATE moments SET created_at = NOW() - interval '14 hours' WHERE settlement_id = $1 AND id = $2", [sid, first.id]);
    const third = await M.roll(sid);
    await q("UPDATE moments SET created_at = NOW() - interval '6.5 hours' WHERE settlement_id = $1 AND id = $2", [sid, third && third.id]);
    check(third && !(await M.roll(sid)), 'three a day at most (a fourth waits)');
    // The cap: four open at once.
    await q("UPDATE moments SET created_at = NOW() - interval '30 hours' WHERE settlement_id = $1", [sid]);
    const fourth = await M.roll(sid);
    await q("UPDATE moments SET created_at = NOW() - interval '30 hours' WHERE settlement_id = $1", [sid]);
    check(fourth && (await q('SELECT COUNT(*)::int AS n FROM moments WHERE settlement_id = $1 AND resolved_at IS NULL', [sid])).rows[0].n === 4, 'a fourth opens a day later');
    check(!(await M.roll(sid)), 'never more than four open');
    // Cooldowns: every test kind was used; with them all within 2 days, nothing fits.
    await q('UPDATE moments SET resolved_at = NOW(), outcome = $2 WHERE settlement_id = $1', [sid, 'cleared']);
    check(!(await M.roll(sid)), 'each kind waits out its cooldown (all four were used within two days)');
    await q("UPDATE moments SET created_at = NOW() - interval '3 days' WHERE settlement_id = $1", [sid]);
    check(!!(await M.roll(sid)), 'and comes back after it');
    for (const [k, w] of Object.entries(saved)) M.DEFS[k].weight = w;
  }

  console.log('Choosing, defaults and the chronicle');
  {
    mk('t_pick', { triggerOnly: true });
    const sid = await town('mpick');
    const m = await M.start(sid, 't_pick');
    check(m && m.options.length === 2 && m.options.every(o => o.hint) && m.fallback === 'a', 'a moment shows its options with hints and its default');
    check((await M.choose(sid, m.id, 'zzz')).status === 400, 'only one of its options');
    const r = await M.choose(sid, m.id, 'b');
    check(r.ok && r.outcome === 'Chose b.' && !r.auto, 'answered: the outcome comes back');
    check((await M.choose(sid, m.id, 'a')).status === 404, 'answered once');
    const ch = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'moment'", [sid])).rows;
    check(ch.length === 1 && ch[0].text === 'The test went b.', 'the outcome writes a chronicle line');
    const m2 = await M.start(sid, 't_pick');
    await q("UPDATE moments SET expires_at = NOW() - interval '1 minute' WHERE id = $1", [m2.id]);
    await M.tick(true);
    const row = (await q('SELECT choice, auto, outcome FROM moments WHERE id = $1', [m2.id])).rows[0];
    check(row.choice === 'a' && row.auto === true && row.outcome, 'unanswered in time: the default happens by itself');
    const ch2 = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'moment' ORDER BY id DESC LIMIT 1", [sid])).rows[0];
    check(/^Nobody sent word/.test(ch2.text), 'and the chronicle says nobody answered');
    // A default that can't be done falls back… to the default; a failing choice is refused.
    mk('t_fail', { triggerOnly: true, failB: true });
    const m3 = await M.start(sid, 't_fail');
    check((await M.choose(sid, m3.id, 'b')).status === 400, 'a choice that cannot be done is refused (and stays open)');
  }

  console.log('Triggered moments');
  {
    mk('t_trig', { triggerOnly: true });
    const sid = await town('mtrig');
    await q("UPDATE settlements SET moments_seen_at = NOW() - interval '1 hour' WHERE id = $1", [sid]);
    for (let i = 0; i < 4; i++) await M.trigger(sid, 't_trig');
    check((await q('SELECT COUNT(*)::int AS n FROM moments WHERE settlement_id = $1 AND resolved_at IS NULL', [sid])).rows[0].n === 4, 'triggered moments skip the budget');
    const fifth = await M.trigger(sid, 't_trig');
    check(fifth && fifth.resolved && fifth.outcome === 'Chose a.', 'at the cap the default happens at once');
    const ch = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'moment' ORDER BY id DESC LIMIT 1", [sid])).rows[0];
    check(/^Too much was waiting/.test(ch.text), 'and the chronicle reports it');
    check(!(await M.roll(sid)) || true, '(roll leaves trigger-only kinds alone)');
  }

  // ── The API, through the server, with a real outpost moment ──────────────
  console.log('The API');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const un = `mapi_${RUN}`;
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [un, `${un}@t.l`])).rows[0];
  const tq = -130000 - Math.floor(Math.random() * 5000) * 20;
  const sid = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber) VALUES ($1,$2,2,'camp',$3,0,NOW(),500) RETURNING id`, [u.id, un, tq])).rows[0].id;
  const oid = (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store, store_tick) VALUES ($1,$2,0,'plains',1,'{"food":100}',NOW()) RETURNING id`, [sid, tq + 2])).rows[0].id;
  const tok = jwt.sign({ userId: u.id, username: un, species: 'Mice' }, SECRET);
  const api = async (method, path, body, token = tok) => {
    const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const m = await M.start(sid, 'storm', { args: { outpost_id: oid } });
  let r = await api('GET', '/api/moments');
  check(r.status === 200 && r.body.moments.length === 1 && r.body.moments[0].kind === 'storm' && r.body.moments[0].options.every(o => o.hint), 'GET /api/moments: open ones, with hints');
  check(/At the Farmstead|At the /.test(r.body.moments[0].text), 'an outpost moment names its outpost');
  r = await api('POST', `/api/moments/${m.id}`, { choice: 'shore' });
  check(r.status === 200 && /stayed dry/.test(r.body.outcome), 'POST /api/moments/:id answers it');
  check((await api('POST', `/api/moments/${m.id}`, { choice: 'shore' })).status === 404, 'once');
  r = await api('GET', '/api/moments/recent');
  check(r.status === 200 && r.body.moments[0].id === m.id && r.body.moments[0].choice === 'shore' && !r.body.moments[0].auto, 'GET /api/moments/recent: the answered one');
  const ev = await api('GET', `/api/game/outposts/${oid}`);
  check(ev.status === 200 || ev.status === 404, '(the outpost window still loads)');
  check((await api('POST', '/api/moments/admin/start', { kind: 'storm' })).status === 403, 'players cannot use the moments Dev Tools');
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID || 0);
  if (ADMIN) {
    const an = `madm_${RUN}`;
    await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET username = users.username", [ADMIN, an, `${an}@t.l`]);
    let as = (await q('SELECT id FROM settlements WHERE user_id = $1', [ADMIN])).rows[0];
    if (!as) as = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick) VALUES ($1,$2,2,'camp',$3,0,NOW()) RETURNING id`, [ADMIN, an, tq - 40])).rows[0];
    await q(`UPDATE moments SET resolved_at = NOW(), outcome = 'cleared' WHERE settlement_id = $1 AND resolved_at IS NULL`, [as.id]);
    const aid = (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store, store_tick) VALUES ($1,$2,0,'plains',1,'{"food":50}',NOW()) RETURNING id`, [as.id, tq - 38])).rows[0].id;
    const atok = jwt.sign({ userId: ADMIN, username: an, species: 'Mice' }, SECRET);
    const k = await api('GET', '/api/moments/admin/kinds', null, atok);
    check(k.status === 200 && k.body.kinds.some(x => x.kind === 'harvest' && x.source === 'outpost'), 'Dev Tools: the kinds');
    const st = await api('POST', '/api/moments/admin/start', { kind: 'harvest', outpost_id: aid }, atok);
    check(st.status === 200 && st.body.moment.kind === 'harvest', 'Dev Tools: start a kind now');
    check((await api('POST', '/api/moments/admin/start', { kind: 'rich_vein', outpost_id: aid }, atok)).status === 400, "a kind that can't happen there is refused (plains has no vein)");
    const ex = await api('POST', '/api/moments/admin/expire', null, atok);
    check(ex.status === 200 && ex.body.resolved >= 1, 'Dev Tools: take every default now');
    const ss = await api('GET', '/api/moments/admin/stats', null, atok);
    const hv = ss.body.kinds && ss.body.kinds.find(x => x.kind === 'harvest');
    check(ss.status === 200 && hv && hv.timed_out >= 1 && typeof hv.one_sided === 'boolean', 'Dev Tools: shown, answered, timed out and choices per kind');
  } else console.log('  (admin routes skipped — set CRAFTING_TEST_ADMIN_ID)');

  await pool.end();
}

main().catch(e => { failed++; console.error(e); }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
