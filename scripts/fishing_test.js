// Server-authoritative fishing — the client can't choose a fish, build an
// item, land early, reuse a catch or spam casts; players have no "add item".
// In-process express with a stubbed db module and an injected clock / rng —
// never touches Postgres. Run from the server root: node scripts/fishing_test.js
'use strict';
process.env.ADMIN_USER_IDS = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const http = require('http');

// ── stub ../db: records inventory writes; user 2 owns settlement 20 ────────
const writes = [];
const citizens = { 7: 20, 8: 99 };   // citizen id → settlement id
async function q(sql, params = []) {
  if (/FROM settlements WHERE user_id/.test(sql)) return { rows: [{ id: params[0] * 10 }] };
  if (/FROM citizens WHERE id=\$1 AND settlement_id=\$2/.test(sql)) return { rows: citizens[params[0]] === params[1] ? [{ id: params[0], name: 'C' + params[0], life_stage: 'adult' }] : [] };
  if (/SELECT id, quantity FROM inventory_items/.test(sql)) return { rows: [] };
  if (/INSERT INTO inventory_items/.test(sql)) { writes.push(params); return { rows: [{ id: writes.length, item_key: params[1] }] }; }
  if (/FROM inventory_items WHERE id=\$1 AND settlement_id=\$2/.test(sql)) return { rows: [{ id: params[0], quantity: 1, equip_slot: 'weapon' }] };
  if (/UPDATE inventory_items/.test(sql)) { writes.push(['UPDATE', sql, params]); return { rows: [] }; }
  return { rows: [] };
}
require.cache[require.resolve('../db')] = { id: 'db', filename: require.resolve('../db'), loaded: true,
  exports: { query: q, withTransaction: fn => fn({ query: q }), pool: { connect: async () => ({ query: q, release() {} }) } } };

const F = require('../lib/fishing');
const clock = require('../lib/server_clock');
const { seasonAt } = require('../seasons');

let pass = 0, fail = 0;
function check(name, ok, extra) { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; }

// mulberry32 for reproducible rolls
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

(async () => {
  // ── 1. Pure rules ─────────────────────────────────────────────────────────
  {
    const T0 = Date.parse('2026-11-05T12:00:00Z');
    let seasonal = true, junk = 0, junkR = 0, biteOk = true;
    const rng = mulberry32(42), N = 20000;
    for (const season of ['spring', 'summer', 'autumn', 'winter']) {
      for (let i = 0; i < N / 4; i++) {
        const c = F.rollCatch(rng, T0, season, false);
        if (c.kind === 'junk') junk++; else if (!c.fish.seasons.includes(season)) seasonal = false;
        if (c.biteDelayMs < F.BITE_MIN_MS || c.biteDelayMs > F.BITE_MIN_MS + F.BITE_SPREAD_MS) biteOk = false;
        if (F.rollCatch(rng, T0, season, true).kind === 'junk') junkR++;
      }
    }
    check('1. rolls only in-season fish (20,000 casts across 4 seasons)', seasonal);
    check('1b. junk ≈ 7% normally, ≈ 3% in the ripple zone', Math.abs(junk / N - 0.07) < 0.01 && Math.abs(junkR / N - 0.03) < 0.01,
          (junk / N * 100).toFixed(1) + '% / ' + (junkR / N * 100).toFixed(1) + '%');
    check('1c. bite delay 2–5s', biteOk);
    const it = F.itemFor(F.FISH_TABLE.find(f => f.id === 'moontrout'));
    check('1d. itemFor builds the item from the server table', it.item_key === 'fish_moontrout' && it.quantity === 1 &&
          it.metadata.sell_value === 100 && it.metadata.food_value === 40 && it.source === 'fishing' && it.category === 'food');
    const p = { kind: 'fish', castAt: 0, biteAt: 3000 };
    check('1e. landCheck: before the bite / mid-fight → refused; after the reel floor → ok; expired → refused',
          !F.landCheck(p, 2999, 'caught').ok && !F.landCheck(p, 3000 + F.MIN_REEL_MS - 1, 'caught').ok &&
          F.landCheck(p, 3000 + F.MIN_REEL_MS, 'caught').ok && !F.landCheck(p, F.PENDING_TTL_MS + 1, 'caught').ok &&
          F.landCheck(p, 10, 'lost').ok);
    const st = []; let allowed = 0;
    for (let t = 0; t < 60000; t += 2000) if (F.castAllowed(st, t).ok) allowed++;
    check('1f. cast limiter: 2s gap, at most ' + F.CASTS_PER_MIN + ' casts a minute', allowed === F.CASTS_PER_MIN && !F.castAllowed([0], 1999).ok, allowed + ' allowed');
  }

  // ── 2. Routes ─────────────────────────────────────────────────────────────
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const jwt = require('jsonwebtoken');
  const fishing = require('../routes/fishing');
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/fishing', fishing);
  app.use('/api/inventory', require('../routes/inventory'));
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const tok = id => jwt.sign({ userId: id }, process.env.JWT_SECRET);
  const call = async (m, p, userId, body) => {
    const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(userId) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  let now = Date.parse('2026-11-05T12:00:00Z');
  clock._setClockForTest(() => now);
  const fishRng = () => 0.5;            // never junk (0.5 > 0.07), mid bite delay, mid-pool fish
  fishing._setRngForTest(fishRng);

  // pool
  {
    const r = await call('GET', '/api/fishing/pool', 2);
    const season = seasonAt(now).id;
    check('2. GET /pool → the server season and its in-season fish',
          r.status === 200 && r.body.season.id === season && r.body.fish.length === F.poolAt(now, season).length &&
          r.body.catalogue.length === F.FISH_TABLE.length + F.JUNK_TABLE.length && !('weight' in r.body.fish[0]));
  }

  // happy path + timing + single use + tampering
  {
    const c = await call('POST', '/api/fishing/cast', 2, { ripple: false, fish: 'moontrout', rarity: 'legendary' });
    const pend = c.body;
    check('3. POST /cast → server-rolled catch + bite delay (client hints ignored)',
          c.status === 200 && pend.catchId && pend.catch.kind === 'fish' && pend.catch.id !== 'moontrout' && pend.biteDelayMs >= 2000,
          pend.catch && pend.catch.id);
    const early = await call('POST', '/api/fishing/land', 2, { catchId: pend.catchId, outcome: 'caught' });
    now += pend.biteDelayMs + 1000;
    const midFight = await call('POST', '/api/fishing/land', 2, { catchId: pend.catchId, outcome: 'caught' });
    check('3b. landing before the bite or before the reel floor → 409', early.status === 409 && midFight.status === 409);
    const wrongUser = await call('POST', '/api/fishing/land', 3, { catchId: pend.catchId, outcome: 'caught' });
    check('3c. another player can\'t land your catch', wrongUser.status === 409);
    now += F.MIN_REEL_MS;
    writes.length = 0;
    const landed = await call('POST', '/api/fishing/land', 2, {
      catchId: pend.catchId, outcome: 'caught', item_key: 'fish_moontrout', name: 'Hacked', quantity: 999, metadata: { sell_value: 99999 } });
    const ins = writes.find(w => Array.isArray(w) && w[0] === 20);
    const expected = F.itemFor(F.FISH_TABLE.find(f => f.id === pend.catch.id));
    check('3d. landing after the floor grants the SERVER\'s item (body fields ignored)',
          landed.status === 200 && ins && ins[1] === expected.item_key && ins[2] === expected.name && ins[7] === 1 &&
          JSON.parse(ins[11]).sell_value === expected.metadata.sell_value, ins && ins[1] + ' ×' + ins[7]);
    const again = await call('POST', '/api/fishing/land', 2, { catchId: pend.catchId, outcome: 'caught' });
    check('3e. a catch can only be landed once', again.status === 409);
  }

  // lost / junk / expiry / rate limit
  {
    now += 60000;
    const c1 = await call('POST', '/api/fishing/cast', 2, {});
    writes.length = 0;
    const lost = await call('POST', '/api/fishing/land', 2, { catchId: c1.body.catchId, outcome: 'lost' });
    check('4. outcome "lost" → ok, nothing granted', lost.status === 200 && lost.body.granted === null && !writes.length);

    now += 3000;
    fishing._setRngForTest((() => { const seq = [0.5, 0.01, 0.0]; let i = 0; return () => seq[i++ % seq.length]; })());   // junk
    const cj = await call('POST', '/api/fishing/cast', 2, {});
    now += cj.body.biteDelayMs;
    writes.length = 0;
    const lj = await call('POST', '/api/fishing/land', 2, { catchId: cj.body.catchId, outcome: 'caught' });
    check('4b. junk → ok, nothing granted', cj.body.catch.kind === 'junk' && lj.status === 200 && lj.body.granted === null && !writes.length);
    fishing._setRngForTest(fishRng);

    now += 3000;
    const ce = await call('POST', '/api/fishing/cast', 2, {});
    now += F.PENDING_TTL_MS + 1;
    const le = await call('POST', '/api/fishing/land', 2, { catchId: ce.body.catchId, outcome: 'caught' });
    check('4c. an abandoned catch expires', le.status === 409);

    fishing._resetForTest(); fishing._setRngForTest(fishRng);
    now += 120000;
    const a = await call('POST', '/api/fishing/cast', 4, {});
    now += 500;
    const b = await call('POST', '/api/fishing/cast', 4, {});
    let n = 1, last;
    for (let i = 0; i < 20; i++) { now += 2000; last = await call('POST', '/api/fishing/cast', 4, {}); if (last.status === 200) n++; }
    check('4d. cast rate limit: 2s gap → 429; capped at ' + F.CASTS_PER_MIN + ' a minute',
          a.status === 200 && b.status === 429 && n === F.CASTS_PER_MIN && last.status === 429, n + ' casts in ~42s');
  }

  // inventory: no player add, no quantity edits, equip only own citizens
  {
    const add = await call('POST', '/api/inventory/add', 2, { item_key: 'x', name: 'x' });
    check('5. POST /api/inventory/add no longer exists for anyone', add.status === 404);
    const cheatPlayer = await call('POST', '/api/inventory/cheat/add', 2, { item_key: 'x', name: 'x' });
    const cheatAdmin = await call('POST', '/api/inventory/cheat/add', 1, { item_key: 'x', name: 'x' });
    check('5b. Dev Tools add: 403 for players, works for admins', cheatPlayer.status === 403 && cheatAdmin.status === 200);
    writes.length = 0;
    const qty = await call('PATCH', '/api/inventory/5', 2, { quantity: 9999 });
    check('5c. PATCH can\'t set quantity', qty.status === 400 && !writes.length);
    const foreign = await call('PATCH', '/api/inventory/5', 2, { equipped_to: 8 });
    const own = await call('PATCH', '/api/inventory/5', 2, { equipped_to: 7 });
    check('5d. equip only to your own citizens', foreign.status === 400 && own.status === 200);
  }

  srv.close();
  clock._resetForTest();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
