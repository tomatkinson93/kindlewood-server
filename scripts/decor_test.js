// ═══════════════════════════════════════════════════════════════════════════
//  decor_test — decorating and charm (docs/HOME_SCENE.md Part F, F.9, step 23;
//  lib/decor.js, /api/decor).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/decor_test.js
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}

function pure() {
  const D = require('../lib/decor');
  console.log('Charm');
  check(D.charmOf({}).score === 0 && D.charmOf({}).bonus === 0 && /No charm yet/.test(D.charmOf({}).line), 'nothing placed: no charm');
  const one = D.charmOf({ bench: 1 }), two = D.charmOf({ bench: 2 }), ten = D.charmOf({ bench: 10 });
  check(one.score === 3 && two.score === 5.1 && ten.score < 10 && ten.score > 9.5, 'each further bench counts for less: 3, then 2.1, and ten are worth under 10', [one.score, two.score, ten.score]);
  const each = D.charmOf(Object.fromEntries(D.KINDS.map(k => [k.key, 1])));
  check(each.score === 21 && each.bonus === 2, 'one of every kind: 21 charm, +2 happiness', each);
  check(D.charmOf({ bench: 6 }).score < D.charmOf({ bench: 2, lantern: 2, flower_bed: 2 }).score, 'variety beats a row of the same thing');
  const full = D.charmOf(Object.fromEntries(D.KINDS.map(k => [k.key, k.max])));
  check(full.bonus === D.CONFIG.MAX_BONUS && full.next === null && D.charmOf({ bench: 999, well: 999, pond: 999, lantern: 999, fence: 999, flower_bed: 999 }).bonus === 5, 'the bonus stops at +5 whatever is placed', full);
  check(D.charmOf({ bench: 1 }, 1).score === 13 && D.charmOf({ bench: 1 }, 0.5).score === 8 && D.charmOf({ bench: 1 }, null).score === 3 && D.charmOf({}, 1).bonus === 1, 'with upkeep on, buildings kept sound add up to 10; with it off, nothing');
  check(/\+2 happiness for everyone/.test(each.line) && /9 more for \+3/.test(each.line) && /not enough for a bonus yet \(7 more for \+1\)/.test(one.line), 'the line says what it gives and what is needed for more', [each.line, one.line]);
  check(D.nextWorth('bench', 0) === 3 && D.nextWorth('bench', 1) === 2.1 && D.nextWorth('well', 0) === 6 && D.nextWorth('nope', 0) === 0, 'what one more would add');

  console.log('Places and prices');
  check(JSON.stringify(D.spot({ area: 'town', x: 50.123, y: 70.456 })) === JSON.stringify({ area: 'town', x: 50.12, y: 70.46 }), 'a place is kept to two decimals');
  check(D.spot({ area: 'outskirts', x: -5, y: 10 }).x === 0 && D.spot({ area: 'outskirts', x: -5, y: 10 }).y === 40 && D.spot({ area: 'town', x: 140, y: 140 }).x === 100, 'and inside the picture, below the sky');
  let err = null; try { D.spot({ area: 'moon', x: 1, y: 50 }); } catch (e) { err = e; }
  check(err instanceof D.DecorError, 'an unknown area is refused');
  err = null; try { D.spot({ area: 'town', x: 'a', y: 50 }); } catch (e) { err = e; }
  check(err instanceof D.DecorError, 'and a place that is not a number');
  check(D.spot({ x: 5, y: 60 }, 'neighbourhood').area === 'neighbourhood', 'a move with no area stays in its own');
  check(D.KINDS.every(k => Object.keys(k.cost).every(r => r === 'timber' || r === 'stone') && Object.values(k.cost).every(v => v > 0 && v <= 30)), 'everything costs a little timber or stone');
  check(JSON.stringify(D.refundOf({ timber: 5 })) === JSON.stringify({ timber: 2 }) && JSON.stringify(D.refundOf({ stone: 30, timber: 10 })) === JSON.stringify({ stone: 15, timber: 5 }), 'removing gives half back, rounded down');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const D = require('../lib/decor');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async (stock = { timber: 100, stone: 100 }) => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `de_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const tq = -140000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber, stone) VALUES ($1,$2,2,'village',$3,0,NOW(),$4,$5) RETURNING id`, [u.id, username, tq, stock.timber, stock.stone])).rows[0];
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, api };
  };
  const stock = async sid => { const r = (await q('SELECT timber, stone FROM settlements WHERE id = $1', [sid])).rows[0]; return { timber: Number(r.timber), stone: Number(r.stone) }; };

  console.log('Placing');
  const t = await mkTown();
  let out = await D.place(t.id, { kind: 'bench', area: 'town', x: 40, y: 80 });
  check(out.placed.kind === 'bench' && out.placed.x === 40 && out.placed.y === 80 && (await stock(t.id)).timber === 88, 'a bench is placed and 12 timber is paid', out);
  const bench = out.placed.id;
  let st = await D.state(t.id);
  check(st.decorations.length === 1 && st.charm.score === 3 && st.kinds.find(k => k.key === 'bench').have === 1 && st.kinds.find(k => k.key === 'bench').next_charm === 2.1, 'the town shows it, its charm, and what another would add');
  let err = null; try { await D.place(t.id, { kind: 'throne', area: 'town', x: 1, y: 50 }); } catch (e) { err = e; }
  check(err instanceof D.DecorError, 'an unknown thing is refused');
  await q('UPDATE settlements SET stone = 5 WHERE id = $1', [t.id]);
  err = null; try { await D.place(t.id, { kind: 'pond', area: 'town', x: 50, y: 85 }); } catch (e) { err = e; }
  check(err && err.status === 402 && /Not enough stone/.test(err.message) && (await stock(t.id)).stone === 5 && (await D.state(t.id)).decorations.length === 1, 'not enough stone: refused, nothing paid, nothing placed', err && err.message);
  await q('UPDATE settlements SET stone = 100 WHERE id = $1', [t.id]);
  await D.place(t.id, { kind: 'well', area: 'town', x: 50, y: 85 }); await D.place(t.id, { kind: 'well', area: 'outskirts', x: 50, y: 85 });
  err = null; try { await D.place(t.id, { kind: 'well', area: 'town', x: 60, y: 85 }); } catch (e) { err = e; }
  check(err && err.status === 409 && /can have 2/.test(err.message), 'a town can have two wells and no more');

  console.log('Moving and removing');
  out = await D.move(t.id, bench, { x: 45.5, y: 20 });
  check(out.moved.x === 45.5 && out.moved.y === 40 && out.moved.area === 'town', 'a move is free and kept below the sky');
  out = await D.move(t.id, bench, { area: 'neighbourhood', x: 10, y: 70 });
  check(out.moved.area === 'neighbourhood', 'it can go to another part of Home');
  const before = await stock(t.id);
  out = await D.remove(t.id, bench);
  const after = await stock(t.id);
  check(out.refund.timber === 6 && after.timber - before.timber === 6 && (await D.state(t.id)).decorations.every(d => d.id !== bench), 'removing gives half the cost back');
  err = null; try { await D.remove(t.id, bench); } catch (e) { err = e; }
  check(err && err.status === 404, 'it cannot be removed twice');
  const other = await mkTown();
  const theirs = (await D.place(other.id, { kind: 'bench', area: 'town', x: 1, y: 60 })).placed.id;
  err = null; try { await D.move(t.id, theirs, { x: 2, y: 60 }); } catch (e) { err = e; }
  const e2 = await D.remove(t.id, theirs).then(() => null, e => e);
  check(err && err.status === 404 && e2 && e2.status === 404, 'another town\'s things cannot be moved or removed');

  console.log('Two devices at once, and the limit');
  {
    const u = await mkTown({ timber: 12, stone: 0 });
    const res = await Promise.allSettled([D.place(u.id, { kind: 'bench', area: 'town', x: 10, y: 70 }), D.place(u.id, { kind: 'bench', area: 'town', x: 20, y: 70 })]);
    check(res.filter(r => r.status === 'fulfilled').length === 1 && (await stock(u.id)).timber === 0 && (await D.state(u.id)).decorations.length === 1, 'timber for one bench buys one bench, however fast the clicks');
    const big = await mkTown({ timber: 100000, stone: 100000 });
    await q(`INSERT INTO decorations (settlement_id, kind, area, x, y) SELECT $1, 'fence', 'town', g, 70 FROM generate_series(1, $2) g`, [big.id, 24]);
    await q(`INSERT INTO decorations (settlement_id, kind, area, x, y) SELECT $1, 'lantern', 'town', g, 70 FROM generate_series(1, $2) g`, [big.id, 16]);
    await q(`INSERT INTO decorations (settlement_id, kind, area, x, y) SELECT $1, 'flower_bed', 'town', g, 70 FROM generate_series(1, $2) g`, [big.id, 16]);
    for (let i = 0; i < 4; i++) await D.place(big.id, { kind: 'bench', area: 'town', x: i, y: 70 });
    const e = await D.place(big.id, { kind: 'bench', area: 'town', x: 9, y: 70 }).then(() => null, x => x);
    check(e && e.status === 409 && /all 60/.test(e.message), 'a town holds 60 decorations');
  }

  console.log('Charm reaches the town');
  {
    const TM = require('../lib/town_mods');
    const c = await mkTown({ timber: 1000, stone: 1000 });
    const row = async () => (await q('SELECT * FROM settlements WHERE id = $1', [c.id])).rows[0];
    let m = await TM.load(null, await row());
    check((m.mods.happiness || 0) === 0 && m.charm && m.charm.score === 0 && !m.sources.some(s => s.key === 'charm'), 'no decorations: no bonus');
    for (const k of D.KINDS) await D.place(c.id, { kind: k.key, area: 'town', x: 10, y: 70 });
    m = await TM.load(null, await row());
    check(m.mods.happiness === 2 && m.charm.bonus === 2 && m.sources.some(s => s.key === 'charm' && s.happiness === 2), 'one of each: +2 happiness for the town, shown in its sources', m.charm);
    await q('UPDATE settlements SET upkeep_on = TRUE WHERE id = $1', [c.id]);
    await q(`INSERT INTO buildings (settlement_id, type, level, health) VALUES ($1,'tavern',1,100), ($1,'farm',1,30)`, [c.id]);
    m = await TM.load(null, await row());
    check(m.charm.score === 26 && m.charm.bonus === 2, 'with upkeep on, half the buildings sound adds 5 charm', m.charm);
    await q('UPDATE buildings SET health = 100 WHERE settlement_id = $1', [c.id]);
    m = await TM.load(null, await row());
    check(m.charm.score === 31 && m.mods.happiness === 3, 'every building sound: 10 charm, and here that tips it to +3', m.charm);
  }

  console.log('Routes');
  {
    const r = await mkTown();
    let x = await r.api('GET', '/api/decor');
    check(x.status === 200 && x.body.decor.decorations.length === 0 && x.body.decor.kinds.length === D.KINDS.length && x.body.decor.max === 60, 'GET /api/decor');
    x = await r.api('POST', '/api/decor', { kind: 'lantern', area: 'town', x: 30, y: 75 });
    check(x.status === 200 && x.body.placed.kind === 'lantern' && x.body.decor.decorations.length === 1 && x.body.decor.charm.score === 3, 'POST /api/decor');
    const id = x.body.placed.id;
    x = await r.api('POST', `/api/decor/${id}/move`, { x: 31, y: 76 });
    check(x.status === 200 && x.body.moved.x === 31 && x.body.decor.decorations[0].y === 76, 'POST /api/decor/:id/move');
    x = await r.api('DELETE', `/api/decor/${id}`);
    check(x.status === 200 && x.body.refund.timber === 4 && x.body.decor.decorations.length === 0, 'DELETE /api/decor/:id');
    x = await r.api('POST', '/api/decor', { kind: 'pond', area: 'sky', x: 30, y: 75 });
    check(x.status === 400, 'a bad place is refused');
    const anon = await fetch(BASE + '/api/decor'); check(anon.status === 401, 'signed-out callers are refused');
  }

  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
