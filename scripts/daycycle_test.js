// Spec 021 Phase 2 — day cycle, sun, moon, server clock, /time routes.
// Pure + an in-process express app on an ephemeral port; never touches the DB.
// Run from the server root: node scripts/daycycle_test.js [frontendDir]
// frontendDir defaults to $KW_FRONTEND_DIR, then ../kindlewood-frontend; the
// byte-identity check is SKIPPED (reported) if no frontend checkout is found.
'use strict';
process.env.ADMIN_USER_IDS = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const D = require('../lib/day_cycle');
const clock = require('../lib/server_clock');

const MIN = 60 * 1000, H = 60 * MIN, DAY = 24 * H;
const DAY0 = Date.parse('2026-11-05T00:00:00Z');
const at = (hh, mm = 0, day = DAY0) => day + hh * H + mm * MIN;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
}

// ── 1. Byte identity ───────────────────────────────────────────────────────
{
  const dir = process.argv[2] || process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend');
  const fe = path.join(dir, 'js', 'day-cycle.js');
  if (!fs.existsSync(fe)) console.log('  ⚠ 1. SKIPPED byte identity — frontend not found at ' + fe);
  else {
    const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const a = sha(path.join(__dirname, '..', 'lib', 'day_cycle.js')), b = sha(fe);
    check('1. lib/day_cycle.js and frontend js/day-cycle.js are byte-identical', a === b, a.slice(0, 12) + ' vs ' + b.slice(0, 12));
  }
  check('1b. day_cycle.js has no Date.now() / Math.random',
        !/Date\.now\(|Math\.random/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'day_cycle.js'), 'utf8')));
}

// ── 2. Phase boundaries ────────────────────────────────────────────────────
{
  const cases = [[8, 59, 'night'], [9, 0, 'dawn'], [10, 59, 'dawn'], [11, 0, 'day'], [22, 59, 'day'],
                 [23, 0, 'dusk'], [23, 59, 'dusk'], [24, 0, 'dusk'], [24, 59, 'dusk'], [25, 0, 'night']];
  const bad = cases.filter(([h, m, p]) => D.phaseAt(at(h, m)).phase !== p).map(([h, m]) => `${h}:${m}`);
  check('2. phase boundaries incl. 23:59 → 00:00 inside dusk', bad.length === 0, bad.join(' '));
  const p = D.phaseAt(at(24, 0));
  check('2b. dusk at 00:00 has progress 0.5, next night in 1h', Math.abs(p.progress - 0.5) < 1e-9 && p.nextPhase === 'night' && p.msToNext === H);
  const c = D.clockAt(at(13, 7));
  check('2c. clockAt fields', c.hour === 13 && c.minute === 7 && c.ymd === '2026-11-05' && c.weekday === 4 &&
        Math.abs(c.dayFraction - (13 * 60 + 7) / 1440) < 1e-12);
}

// ── 3. Continuity (every moon index) + moon-roll continuity ────────────────
{
  let worst = 0, where = '';
  for (let m = 0; m < 8; m++) {
    let prev = D.lightingAt(DAY0, { moonIndex: m });
    for (let i = 1; i <= 1440; i++) {
      const L = D.lightingAt(DAY0 + i * MIN, { moonIndex: m });
      for (const k of ['darkness', 'lightLevel']) {
        const d = Math.abs(L[k] - prev[k]);
        if (d > worst) { worst = d; where = `moon ${m} min ${i} ${k}`; }
      }
      prev = L;
    }
  }
  check('3. lightingAt step < 0.02/min in darkness & lightLevel, all 8 moon indices', worst < 0.02, worst.toFixed(4) + ' @ ' + where);
  // Derived moon across 8 consecutive days — covers the 11:00 moon-day roll.
  worst = 0;
  let prev = D.lightingAt(DAY0);
  for (let i = 1; i <= 8 * 1440; i++) {
    const L = D.lightingAt(DAY0 + i * MIN);
    worst = Math.max(worst, Math.abs(L.darkness - prev.darkness), Math.abs(L.lightLevel - prev.lightLevel));
    prev = L;
  }
  check('3b. continuous across 8 consecutive real days (moon rolls)', worst < 0.02, worst.toFixed(4));
}

// ── 4. Value ranges ────────────────────────────────────────────────────────
{
  let lo = Infinity, hi = -Infinity, dayBad = null;
  for (let m = 0; m < 8; m++) for (let i = 0; i < 1440; i++) {
    const t = DAY0 + i * MIN, L = D.lightingAt(t, { moonIndex: m });
    lo = Math.min(lo, L.darkness); hi = Math.max(hi, L.darkness);
    if (i >= (11 * 60 + 30) && i <= (22 * 60 + 30) && (L.darkness !== 0 || L.lightLevel !== 0)) dayBad = `m${m} min ${i}`;
  }
  check('4a. darkness within [0, 0.55]', lo >= 0 && hi <= 0.55, `${lo.toFixed(3)}..${hi.toFixed(3)}`);
  check('4b. darkness & lightLevel exactly 0 through day (30-min margin)', !dayBad, dayBad || '');
  const full = D.lightingAt(at(5), { moonIndex: 4 }), nw = D.lightingAt(at(5), { moonIndex: 0 });
  check('4c. full moon night is brighter and silvered vs new moon',
        full.darkness < nw.darkness && Math.abs(nw.darkness - full.darkness - 0.08) < 0.01 && full.tint[0] > nw.tint[0]);
}

// ── 5. Moon ────────────────────────────────────────────────────────────────
{
  const E = D.MOON_EPOCH_MS;
  check('5a. epoch is new, +4 days full, +8 days new',
        D.moonAt(E).id === 'new' && D.moonAt(E + 4 * DAY).id === 'full' && D.moonAt(E + 8 * DAY).id === 'new');
  const old = D.moonAt(Date.parse('2020-03-01T05:00:00Z'));
  check('5b. dates before the epoch return a valid index', Number.isInteger(old.index) && old.index >= 0 && old.index < 8 && !!old.glyph, old.id);
  let mono = true;
  for (let i = 1; i <= 4; i++) if (!(D.moonAt(E + i * DAY).illumination > D.moonAt(E + (i - 1) * DAY).illumination)) mono = false;
  check('5c. illumination monotone 0 → 4 (0 at new, 1 at full)',
        mono && D.moonAt(E).illumination === 0 && Math.abs(D.moonAt(E + 4 * DAY).illumination - 1) < 1e-12);
  // One moon-up period (dusk 23:00 → dawn end 11:00) never changes moon.
  let same = true;
  for (let d = 0; d < 8; d++) {
    const i0 = D.moonIndexAt(at(23, 0, DAY0 + d * DAY));
    for (let m = 0; m < 12 * 60; m += 5) if (D.moonIndexAt(at(23, 0, DAY0 + d * DAY) + m * MIN) !== i0) same = false;
  }
  check('5d. moon index constant across each dusk → night → dawn', same);
  check('5e. moon day rolls at 11:00 UTC', D.moonIndexAt(at(11) - 1) !== D.moonIndexAt(at(11)));
}

// ── 6. Sun / moon up ───────────────────────────────────────────────────────
{
  check('6a. sun elevation 0 at dawn start and dusk end, 1 at day midpoint',
        D.sunAt(at(9)).elevation === 0 && D.sunAt(at(25)).elevation === 0 && Math.abs(D.sunAt(at(17)).elevation - 1) < 1e-12);
  let ok = true;
  for (let i = 0; i < 1440; i += 7) {
    const t = DAY0 + i * MIN, ph = D.phaseAt(t).phase;
    if (D.sunAt(t).up !== (ph !== 'night')) ok = false;
    if (D.moonAt(t).up !== (ph !== 'day')) ok = false;
  }
  check('6b. sun.up during dawn/day/dusk, moon.up during dusk/night/dawn', ok);
  check('6c. sun.arc runs 0→1 left→right', D.sunAt(at(9)).arc === 0 && Math.abs(D.sunAt(at(17)).arc - 0.5) < 1e-12);
}

// ── 7. phaseMidpoint + overrideOffset ──────────────────────────────────────
{
  check('7a. phaseMidpoint(dusk) is the next 00:00 at/after ref', D.phaseMidpoint('dusk', at(14)) === at(24));
  check('7b. phaseMidpoint(night, 06:00) → tomorrow 05:00', D.phaseMidpoint('night', at(6)) === at(29));
  check('7c. phaseMidpoint(day, 17:00 exactly) → same instant', D.phaseMidpoint('day', at(17)) === at(17));
  const w = at(14);
  let off = D.overrideOffset({ phase: 'night' }, w, 0);
  off = D.overrideOffset({ moon: 4 }, w, off);
  check('7d. Night then Full moon composes to a full-moon night',
        D.phaseAt(w + off).phase === 'night' && D.moonAt(w + off).id === 'full');
  const h = D.overrideOffset({ hour: 21.5 }, w, 0);
  check('7e. hour override lands on the next 21:30', D.clockAt(w + h).hour === 21 && D.clockAt(w + h).minute === 30 && h < DAY);
}

// ── 8. Server clock debug offsets (injectable clock) ───────────────────────
{
  let fake = DAY0;
  clock._setClockForTest(() => fake);
  const admin = { userId: 1 }, player = { userId: 2 };
  clock.setDebugOffset(1, 5 * H);
  clock.setDebugOffset(2, 5 * H);   // even if set, a non-admin never gets it
  check('8a. non-admin gameplayNow === wallNow', clock.gameplayNow(player) === fake && clock.gameplayNow(null) === fake);
  check('8b. admin gameplayNow = wall + offset', clock.gameplayNow(admin) === fake + 5 * H);
  check('8c. wallNow never affected', clock.wallNow() === fake);
  fake += 2 * H - 1;
  check('8d. offset still active just before TTL', clock.gameplayNow(admin) === fake + 5 * H);
  fake += 1;
  check('8e. offset expired at TTL (2h)', clock.gameplayNow(admin) === fake && clock.getDebugOffset(1) === 0);
  clock._resetForTest();
}

// ── 9. Wall-clock seam ─────────────────────────────────────────────────────
{
  const files = ['famine.js', 'simulation.js', 'seasons.js', 'routes/outposts.js'];
  const hits = files.filter(f => /gameplayNow/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
  check('9. economy files never reference gameplayNow', hits.length === 0, hits.join(','));
}

// ── 10. Window sanity (full golden fixtures land in Phase 6) ───────────────
{
  const from = at(0), to = at(0, 0, DAY0 + 3 * DAY);
  const daily = D.windowsBetween({ type: 'daily', start: '22:00', durationMin: 180 }, from, to);
  check('10a. daily 22:00/3h crosses midnight', daily.length >= 3 && daily.every(x => x.endMs - x.startMs === 3 * H) &&
        D.clockAt(daily[0].endMs).hour === 1);
  const dn = D.windowsBetween({ type: 'phase', phases: ['dusk', 'night'] }, at(5), at(5) + 1);
  check('10b. dusk+night merge into one 10h window; overlap query is unclipped',
        dn.length === 1 && dn[0].startMs === at(-1) && dn[0].endMs === at(9));
  const rot = D.windowsBetween({ type: 'rotating', start: '14:00', durationMin: 120, shiftHours: 8 },
                               D.ROTATION_EPOCH_MS, D.ROTATION_EPOCH_MS + 6 * DAY);
  check('10c. rotating 14:00/+8h covers 3 distinct start hours',
        new Set(rot.map(x => D.clockAt(x.startMs).hour)).size === 3 && D.clockAt(rot[0].startMs).hour === 14);
  const mw = D.windowsBetween({ type: 'moon', moons: ['full'], phases: ['dusk', 'night'] },
                              D.MOON_EPOCH_MS, D.MOON_EPOCH_MS + 16 * DAY);
  check('10d. moon rule only on full-moon days (one 10h window per cycle)',
        mw.length === 2 && mw.every(x => D.moonAt(x.startMs).id === 'full' && D.moonAt(x.endMs - 1).id === 'full'
                                         && x.endMs - x.startMs === 10 * H));
}

// ── 11. Routes (in-process express, no DB) ─────────────────────────────────
async function routes() {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const jwt = require('jsonwebtoken');
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/game', require('../routes/time'));
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/game';
  const tok = id => jwt.sign({ userId: id }, process.env.JWT_SECRET);
  const call = async (p, opts = {}) => {
    const r = await fetch(base + p, opts);
    let body = null; try { body = await r.json(); } catch (_) {}
    return { status: r.status, cc: r.headers.get('cache-control'), body };
  };
  const auth = id => ({ Authorization: 'Bearer ' + tok(id), 'Content-Type': 'application/json' });
  try {
    const t = await call('/time');
    check('11a. GET /time: no auth, no-store, full payload', t.status === 200 && t.cc === 'no-store' && t.body.tz === 'UTC' &&
          t.body.phase && t.body.sun && t.body.moon && t.body.season && 'year' in t.body.season && !('flavor' in t.body.season));
    check('11b. GET /time/me needs auth', (await call('/time/me')).status === 401);
    const deny = await call('/time/debug', { method: 'POST', headers: auth(2), body: JSON.stringify({ phase: 'night' }) });
    check('11c. POST /time/debug is 403 for non-admins', deny.status === 403);
    const set = await call('/time/debug', { method: 'POST', headers: auth(1), body: JSON.stringify({ phase: 'night' }) });
    check('11d. admin {phase:night} → gameplay is night, expiry ~2h',
          set.status === 200 && set.body.gameplay.phase.phase === 'night' && set.body.debugOffsetMs > 0 &&
          Math.abs(set.body.debugExpiresAt - set.body.now - 2 * H) < 5000 && set.body.isAdmin === true);
    const other = await call('/time/me', { headers: auth(2) });
    check('11e. a non-admin at the same instant still has offset 0', other.body.debugOffsetMs === 0 &&
          Math.abs(other.body.gameplayNow - other.body.now) < 1);
    const moon = await call('/time/debug', { method: 'POST', headers: auth(1), body: JSON.stringify({ moon: 4 }) });
    check('11f. admin {moon:4} keeps night and lands on full', moon.body.gameplay.moon.id === 'full' &&
          moon.body.gameplay.phase.phase === 'night');
    const bad = await call('/time/debug', { method: 'POST', headers: auth(1), body: JSON.stringify({ moon: 9 }) });
    check('11g. invalid body → 400', bad.status === 400);
    const clr = await call('/time/debug', { method: 'POST', headers: auth(1), body: JSON.stringify({ clear: true }) });
    check('11h. {clear:true} resets to 0', clr.body.debugOffsetMs === 0);
  } finally { srv.close(); clock._resetForTest(); }
}

routes().catch(e => { console.error(e); fail++; }).finally(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
