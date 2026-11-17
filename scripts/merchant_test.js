// ═══════════════════════════════════════════════════════════════════════════
//  merchant_test — a visiting merchant (docs/HOME_SCENE.md Part F, F.13,
//  step 25; lib/merchant.js, /api/merchant).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/merchant_test.js
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}
const DAY = 86400e3, DAWN = 9 * 3600e3;
const noonOf = day => day * DAY + DAWN + 3 * 3600e3;

function pure() {
  const M = require('../lib/merchant');
  console.log('When the merchant comes');
  const days = []; for (let d = 20000; d < 20400; d++) if (M.here(7, d)) days.push(d);
  check(days.length === 100, 'one visit in every four days', days.length);
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  check(Math.min(...gaps) >= 2 && Math.max(...gaps) <= 6, 'never two days running, never a week without', [Math.min(...gaps), Math.max(...gaps)]);
  check(new Set(gaps).size >= 3, 'and not like clockwork');
  check(M.here(7, days[5]) === true && M.here(7, days[5]) === M.here(7, days[5]), 'the same town and day always give the same answer');
  const other = []; for (let d = 20000; d < 20400; d++) if (M.here(8, d)) other.push(d);
  check(other.join() !== days.join(), 'another town has its own days');
  check(M.nextVisit(7, days[5]) === days[6] && M.nextVisit(7, days[5] + 1) === days[6] && M.nextVisit(7, days[6] - 1) === days[6], 'the next visit is known');

  console.log('What they offer');
  const t = M.trades(7, 20500, 'village');
  check(JSON.stringify(t) === JSON.stringify(M.trades(7, 20500, 'village')), 'a visit\'s trades are the same however often they are asked for');
  let three = 0, four = 0, ok = true, kinds = new Set(), bad = null;
  for (let d = 20000; d < 20600; d++) {
    const list = M.trades(7, d, 'town');
    if (list.length === 3) three++; else if (list.length === 4) four++; else ok = false;
    if (list[0].kind !== 'sell' || list[1].kind !== 'buy' || list[2].kind !== 'swap') ok = false;
    for (const x of list) {
      kinds.add(x.kind);
      const worth = o => Object.entries(o).reduce((s, [k, v]) => s + v * M._price(k), 0);
      const gain = worth(x.get) / worth(x.give);
      if (!(gain > 1.0 && gain < 1.6)) bad = { d, x, gain };
      if (Object.keys(x.give).join() === Object.keys(x.get).join()) bad = { d, x };
      if (![...Object.values(x.give), ...Object.values(x.get)].every(v => v >= 5 && v % 5 === 0)) bad = { d, x };
    }
  }
  check(ok && three > 200 && four > 200, 'three or four trades: a sale, a purchase, a swap, and sometimes one more', { three, four });
  check(!bad, 'every trade is a little better than the going rate, never more than half as much again, in round numbers', bad);
  const size = tier => { let s = 0; for (let d = 20000; d < 20200; d++) s += M.trades(7, d, tier)[0].get.wealth; return s / 200; };
  check(size('camp') < size('village') && size('village') < size('town') && size('town') < size('city'), 'bigger towns are offered bigger trades', [size('camp'), size('city')]);
  check(/^Give \d+ [a-z]+, get \d+ [a-z]+\.$/.test(t[0].line) && !/metal/.test(JSON.stringify(M.trades(7, 20500, 'village').map(x => x.line))), 'each trade reads in plain words (iron, not metal)', t.map(x => x.line));
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const M = require('../lib/merchant');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async (admin) => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `me_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    if (admin) await q('UPDATE users SET is_admin = TRUE WHERE id = $1', [u.id]).catch(() => {});
    const tq = -150000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, food, timber, stone, metal, wealth) VALUES ($1,$2,2,'village',$3,0,NOW(),1000,1000,1000,1000,1000) RETURNING id`, [u.id, username, tq])).rows[0];
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, api };
  };
  const stock = async sid => { const r = (await q('SELECT food, timber, stone, metal, wealth FROM settlements WHERE id = $1', [sid])).rows[0]; return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])); };
  const visitFor = sid => { let d = Math.floor((Date.UTC(2026, 10, 17) - DAWN) / DAY); while (!M.here(sid, d)) d++; return d; };

  console.log('A visit');
  const t = await mkTown(), V = visitFor(t.id), NOW = noonOf(V);
  let st = await M.state(t.id, noonOf(V - 1));
  check(st.here === false && st.trades.length === 0 && st.next_day === V && st.next_at === V * DAY + DAWN, 'the day before: no cart, and it says when they come', st);
  st = await M.state(t.id, NOW);
  check(st.here && st.trades.length >= 3 && st.trades.every(x => !x.taken && x.can) && st.leaves_at === (V + 1) * DAY + DAWN, 'on the day: the cart, its trades, and when it leaves');
  const ev = async () => (await q("SELECT COUNT(*)::int AS n FROM settlement_events WHERE settlement_id = $1 AND type = 'merchant'", [t.id])).rows[0].n;
  await M.state(t.id, NOW + 1000); await Promise.all([M.state(t.id, NOW + 2000), M.state(t.id, NOW + 3000)]);
  check((await ev()) === 1, 'the arrival is in the town\'s news once, however often the cart is looked at');
  check((await q('SELECT COUNT(*)::int AS n FROM merchant_trades WHERE settlement_id = $1', [t.id])).rows[0].n === 1, 'visits and trades are worked out, not stored: only the news marker is kept so far');

  console.log('Trading');
  {
    const before = await stock(t.id), tr = st.trades[0];
    const out = await M.take(t.id, 0, NOW + 5000), after = await stock(t.id);
    const gk = Object.keys(tr.give)[0], rk = Object.keys(tr.get)[0];
    check(out.trade.idx === 0 && before[gk] - after[gk] === tr.give[gk] && after[rk] - before[rk] === tr.get[rk], 'a trade takes what it asks and gives what it offers', { before, after, tr });
    let err = await M.take(t.id, 0, NOW + 6000).then(() => null, e => e);
    check(err instanceof M.MerchantError && err.status === 409 && JSON.stringify(await stock(t.id)) === JSON.stringify(after), 'each trade once: a second try is refused and nothing moves');
    st = await M.state(t.id, NOW + 7000);
    check(st.trades[0].taken && !st.trades[0].can && !st.trades[1].taken, 'the cart shows it as taken');
    err = await M.take(t.id, 9, NOW).then(() => null, e => e);
    check(err && err.status === 404, 'a trade the merchant does not have is refused');
    err = await M.take(t.id, -1, NOW).then(() => null, e => e);
    check(err && err.status === 400, 'and the news marker cannot be "taken"');
    const give = Object.keys(st.trades[1].give)[0];
    await q(`UPDATE settlements SET ${give} = 0 WHERE id = $1`, [t.id]);
    const s0 = await stock(t.id);
    err = await M.take(t.id, 1, NOW).then(() => null, e => e);
    check(err && err.status === 402 && /Not enough/.test(err.message) && JSON.stringify(await stock(t.id)) === JSON.stringify(s0), 'not enough to give: refused, nothing moves', err && err.message);
    check((await M.state(t.id, NOW)).trades[1].can === false, 'and the cart shows it cannot be afforded');
    await q(`UPDATE settlements SET ${give} = 1000 WHERE id = $1`, [t.id]);
    const res = await Promise.allSettled([M.take(t.id, 1, NOW), M.take(t.id, 1, NOW)]);
    check(res.filter(r => r.status === 'fulfilled').length === 1, 'two devices at the same moment: one trade is made');
    err = await M.take(t.id, 2, noonOf(V + 1)).then(() => null, e => e);
    check(err && err.status === 409 && /gone/.test(err.message), 'the day after, the merchant has gone');
    check((await M.state(t.id, noonOf(V + 1))).here === false, 'and so has the cart');
  }

  console.log('Dev Tools: call the merchant today');
  {
    const c = await mkTown(); let d = Math.floor((Date.UTC(2026, 10, 17) - DAWN) / DAY); while (M.here(c.id, d)) d++;
    const now = noonOf(d);
    check((await M.state(c.id, now)).here === false, 'not their day');
    await M.call(c.id, true, now);
    const s2 = await M.state(c.id, now);
    check(s2.here && s2.trades.length >= 3, 'called: the cart is here today');
    const out = await M.take(c.id, 0, now);
    check(out.trade.idx === 0, 'and trades as on any visit');
    check((await M.state(c.id, noonOf(d + 1))).here === M.here(c.id, d + 1), 'tomorrow is back to their own days');
    await M.call(c.id, false, now);
    check((await M.state(c.id, now)).here === false, 'and the call can be taken back');
  }

  console.log('Routes');
  {
    const r = await mkTown();
    let x = await r.api('GET', '/api/merchant');
    check(x.status === 200 && typeof x.body.merchant.here === 'boolean' && typeof x.body.merchant.next_day === 'number', 'GET /api/merchant', x.body);
    x = await r.api('POST', '/api/merchant/admin/call', { on: true });
    check(x.status === 403 || x.status === 401, 'calling the merchant is for admins only', x.status);
    if (!x.body.merchant || !x.body.merchant.here) await q('UPDATE settlements SET merchant_day = $2 WHERE id = $1', [r.id, Math.floor((Date.now() - DAWN) / DAY)]);
    x = await r.api('GET', '/api/merchant');
    check(x.status === 200 && x.body.merchant.here === true, 'the cart, through the route');
    x = await r.api('POST', '/api/merchant/take', { idx: 0 });
    check(x.status === 200 && x.body.trade.idx === 0 && x.body.merchant.trades[0].taken === true, 'POST /api/merchant/take');
    x = await r.api('POST', '/api/merchant/take', { idx: 0 });
    check(x.status === 409, 'a second take is refused');
    x = await r.api('POST', '/api/merchant/take', {});
    check(x.status === 400, 'a take with no trade is refused');
    const anon = await fetch(BASE + '/api/merchant'); check(anon.status === 401, 'signed-out callers are refused');
  }

  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
