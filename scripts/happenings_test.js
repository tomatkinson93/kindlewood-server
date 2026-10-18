// Spec 021 Phase 6 — Happenings: rule windows (golden fixtures), client/server
// agreement, the enemy_pool pick, the fairness check, validation and the
// admin gate. In-process express + a stubbed db; never touches Postgres.
// Run from the server root: node scripts/happenings_test.js [frontendDir]
'use strict';
process.env.ADMIN_USER_IDS = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http');

// ── stub ../db: an in-memory happenings table ─────────────────────────────
const TABLE = new Map();
async function q(sql, params = []) {
  if (/FROM happenings WHERE enabled = TRUE AND archived = FALSE/.test(sql))
    return { rows: [...TABLE.values()].filter(h => h.enabled && !h.archived) };
  if (/SELECT .* FROM happenings ORDER BY/.test(sql)) return { rows: [...TABLE.values()] };
  if (/SELECT id FROM happenings WHERE id=\$1/.test(sql)) return { rows: TABLE.has(params[0]) ? [{ id: params[0] }] : [] };
  if (/INSERT INTO happenings/.test(sql)) {
    const [id, title, flavour, icon, rule, effects, rewarding, enabled, sort_order] = params;
    TABLE.set(id, { id, title, flavour, icon, rule: JSON.parse(rule), effects: JSON.parse(effects), rewarding, enabled, archived: false, sort_order });
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE happenings SET title/.test(sql)) {
    const id = params[8]; if (!TABLE.has(id)) return { rows: [], rowCount: 0 };
    Object.assign(TABLE.get(id), { title: params[0], rule: JSON.parse(params[3]), effects: JSON.parse(params[4]), rewarding: params[5], enabled: params[6] });
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE happenings SET archived/.test(sql)) {
    if (!TABLE.has(params[1])) return { rows: [], rowCount: 0 };
    TABLE.get(params[1]).archived = params[0]; return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}
require.cache[require.resolve('../db')] = { id: 'db', filename: require.resolve('../db'), loaded: true, exports: { query: q } };

const D = require('../lib/day_cycle');
const H = require('../lib/happenings');
const TG = require('../lib/time_gates');
const clock = require('../lib/server_clock');

const HOUR = 3600e3, DAY = 24 * HOUR;
let pass = 0, fail = 0;
function check(name, ok, extra) { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; }
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const fmt = (w) => w.map(x => iso(x.startMs) + '→' + iso(x.endMs));

// ── fixtures: windows overlapping 2026-11-02 00:00 → +14 days (UTC) ─────────
const FROM = Date.parse('2026-11-02T00:00:00Z'), TO = FROM + 14 * DAY;
const RULES = {
  once:           { type: 'once', start: '2026-11-08T22:00:00Z', end: '2026-11-09T04:00:00Z' },
  daily_midnight: { type: 'daily', start: '22:00', durationMin: 180 },
  weekly:         { type: 'weekly', days: [1, 4], start: '14:00', durationMin: 180 },
  rotating:       { type: 'rotating', start: '14:00', durationMin: 120, shiftHours: 8 },
  phase_night:    { type: 'phase', phases: ['night'] },
  moon_full:      { type: 'moon', moons: ['full'], phases: ['dusk', 'night'] },
};
const daySeries = (n, startDay, hh, len) => Array.from({ length: n }, (_, i) => {
  const s = Date.parse(startDay + 'T00:00:00Z') + i * DAY + hh * HOUR;
  return iso(s) + '→' + iso(s + len * HOUR);
});
const GOLDEN = {
  once: ['2026-11-08T22:00→2026-11-09T04:00'],
  daily_midnight: daySeries(15, '2026-11-01', 22, 3),                // crosses midnight; Nov 1's window overlaps the span
  weekly: ['2026-11-02T14:00→2026-11-02T17:00', '2026-11-05T14:00→2026-11-05T17:00',
           '2026-11-09T14:00→2026-11-09T17:00', '2026-11-12T14:00→2026-11-12T17:00'],   // Mondays + Thursdays
  rotating: Array.from({ length: 14 }, (_, i) => {
    const s = FROM + i * DAY + [14, 22, 6][i % 3] * HOUR;              // 14:00, 22:00, 06:00, repeat
    return iso(s) + '→' + iso(s + 2 * HOUR);
  }),
  phase_night: daySeries(14, '2026-11-02', 1, 8),
  moon_full: ['2026-11-06T23:00→2026-11-07T09:00', '2026-11-14T23:00→2026-11-15T09:00'],   // moon day 4, dusk+night merged
};

(async () => {
  // 1. Rule windows
  for (const [k, rule] of Object.entries(RULES)) {
    const got = fmt(D.windowsBetween(rule, FROM, TO));
    check('1. ' + k + ' windows match the golden fixture', JSON.stringify(got) === JSON.stringify(GOLDEN[k]), got.length + ' windows');
  }
  {
    const starts = new Set(D.windowsBetween(RULES.rotating, FROM, TO).map(w => new Date(w.startMs).getUTCHours()));
    check('1b. rotating covers 3 distinct start hours', starts.size === 3, [...starts].join(','));
    const moonOk = D.windowsBetween(RULES.moon_full, FROM, TO).every(w => D.moonAt(w.startMs).id === 'full' && D.moonAt(w.endMs - 1).id === 'full');
    check('1c. moon rule windows fall only on full-moon days', moonOk);
  }

  // 2. Server / client agreement
  {
    const dir = process.argv[2] || process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend');
    const fe = path.join(dir, 'js', 'day-cycle.js');
    if (!fs.existsSync(fe)) console.log('  ⚠ 2. SKIPPED client agreement — frontend not found at ' + fe);
    else {
      const ctx = vm.createContext({ window: {}, Date, Math, JSON });
      ctx.window = ctx;
      vm.runInContext(fs.readFileSync(fe, 'utf8'), ctx);
      const C = ctx.KWDayCycle;
      const same = Object.values(RULES).every(r => JSON.stringify(C.windowsBetween(r, FROM, TO)) === JSON.stringify(D.windowsBetween(r, FROM, TO)));
      const fair = Object.values(RULES).every(r => JSON.stringify(C.fairnessOf(r, FROM)) === JSON.stringify(D.fairnessOf(r, FROM)));
      check('2. client day-cycle.js computes identical windows + fairness for every fixture', same && fair);
    }
  }

  // 3. Active pick: an enemy_pool Happening makes its enemy pickable outside its own gates
  {
    const enemies = [{ id: 'wolf' }, { id: 'owl_hag', active_phases: ['night'] }];
    const eq = async (sql, params) => {
      let pool = enemies;
      if (/active_phases/.test(sql)) {
        const [phase, moon, ids] = params;
        pool = enemies.filter(e => ((!e.active_phases || e.active_phases.includes(phase)) && (!e.moon_phases || e.moon_phases.includes(moon))) ||
                                   (ids || []).includes(e.id));
      }
      return { rows: pool.map(e => ({ id: e.id })) };
    };
    const NOON = Date.parse('2026-11-05T12:00:00Z');
    const owlHunt = { id: 'owl_hunt', enabled: true, archived: false, rule: { type: 'daily', start: '11:00', durationMin: 180 },
                      effects: [{ type: 'enemy_pool', add: ['owl_hag'] }] };
    // Every id pickable at ms: the stub rotates through the eligible pool.
    const pickSet = async (ms, defs) => {
      const seen = new Set();
      for (let i = 0; i < 6; i++) {
        const rot = async (sql, p) => { const r = await eq(sql, p); return { rows: [r.rows[i % r.rows.length]] }; };
        (await TG.pickRandomEnemy(ms, rot, defs)).forEach(x => seen.add(x));
      }
      return seen;
    };
    const without = await pickSet(NOON, []), withHap = await pickSet(NOON, [owlHunt]), later = await pickSet(NOON + 4 * HOUR, [owlHunt]);
    check('3. an active enemy_pool Happening makes a night-only enemy pickable at noon', !without.has('owl_hag') && withHap.has('owl_hag'),
          'without: ' + [...without] + ' · with: ' + [...withHap]);
    check('3b. …only during its window', !later.has('owl_hag'), [...later].join(','));
    const g = TG.enemyEligibleSql(1, { phase: 'day', moon: 'new', happeningIds: ['owl_hag'] });
    check('3c. the SQL fragment widens with "OR id = ANY($3::text[])"', /OR id = ANY\(\$3::text\[\]\)/.test(g.sql) && g.params[2][0] === 'owl_hag');
  }

  // 4. Fairness
  {
    const at = FROM;
    const daily2 = D.fairnessOf({ type: 'daily', start: '14:00', durationMin: 120 }, at);
    const rot = D.fairnessOf(RULES.rotating, at);
    const daily9 = D.fairnessOf({ type: 'daily', start: '14:00', durationMin: 540 }, at);
    const phase = D.fairnessOf(RULES.phase_night, at);
    check('4. daily 14:00 for 2h → warning', daily2.warn === true, daily2.startHours + ' start hour(s)');
    check('4b. rotating 14:00 / 2h / +8h → no warning', rot.warn === false && rot.startHours === 3);
    check('4c. daily 14:00 for 9h → no warning', daily9.warn === false && daily9.longestMs === 9 * HOUR);
    check('4d. phase rules are exempt from the start-hour test', phase.exempt && phase.warn === false);
    check('4e. coverage is a 7 × 24 grid', daily2.coverage.length === 7 && daily2.coverage.every(r => r.length === 24) &&
          daily2.coverage[0][14] === 1 && daily2.coverage[0][15] === 1 && daily2.coverage[0][16] === 0);
  }

  // 5. Validation
  {
    const v = (r) => D.validateRule(r);
    check('5. bad rules are rejected (type, HH:MM, durationMin 15–1440, days 0–6, shiftHours)',
          !v({ type: 'hourly' }).ok && !v({ type: 'daily', start: '24:00', durationMin: 60 }).ok &&
          !v({ type: 'daily', start: '10:00', durationMin: 14 }).ok && !v({ type: 'daily', start: '10:00', durationMin: 1441 }).ok &&
          !v({ type: 'weekly', days: [7], start: '10:00', durationMin: 60 }).ok && !v({ type: 'weekly', days: [], start: '10:00', durationMin: 60 }).ok &&
          !v({ type: 'rotating', start: '10:00', durationMin: 60, shiftHours: 0 }).ok && !v({ type: 'once', start: 'x', end: 'y' }).ok &&
          !v({ type: 'moon', moons: ['full'] }).ok);
    check('5b. good rules normalise to known fields only',
          JSON.stringify(v({ type: 'daily', start: '22:00', durationMin: '180', extra: 1 }).rule) === '{"type":"daily","start":"22:00","durationMin":180}');
    check('5c. effects: unknown type / bad enemy ids / bad flourish rejected',
          !H.validateEffects([{ type: 'wealth_x2' }]).ok && !H.validateEffects([{ type: 'enemy_pool', add: [] }]).ok &&
          !H.validateEffects([{ type: 'map_flourish', kind: 'disco_ball' }]).ok &&
          H.validateEffects([{ type: 'banner' }, { type: 'map_flourish', kind: 'lanterns' }]).ok);
  }

  // 6. Routes: admin gate, CRUD, schedule, active at gameplayNow
  {
    const express = require('express'), cookieParser = require('cookie-parser'), jwt = require('jsonwebtoken');
    const app = express(); app.use(express.json()); app.use(cookieParser());
    app.use('/api/happenings', require('../routes/happenings'));
    const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + srv.address().port + '/api/happenings';
    const tok = id => jwt.sign({ userId: id }, process.env.JWT_SECRET);
    const call = async (m, p, userId, body) => {
      const headers = { 'Content-Type': 'application/json' };
      if (userId) headers.Authorization = 'Bearer ' + tok(userId);
      const r = await fetch(base + p, { method: m, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => ({})), cache: r.headers.get('cache-control') };
    };
    const lantern = { id: 'lantern_walk', title: 'Lantern Walk', icon: '🏮', rewarding: true,
                      rule: { type: 'daily', start: '14:00', durationMin: 120 }, effects: [{ type: 'banner' }, { type: 'map_flourish', kind: 'lanterns' }] };
    const gate = [await call('GET', '/admin', 2), await call('POST', '/admin', 2, lantern), await call('PUT', '/admin/lantern_walk', 2, lantern),
                  await call('POST', '/admin/lantern_walk/archive', 2, {})];
    check('6. non-admin CRUD → 403', gate.every(r => r.status === 403), gate.map(r => r.status).join(','));
    const anon = await call('GET', '/admin');
    check('6b. anonymous admin → 401', anon.status === 401);
    const created = await call('POST', '/admin', 1, lantern);
    check('6c. admin create → ok, with the fairness warning (rewarding daily 2h)', created.status === 200 && created.body.fairness.warn === true);
    const badRule = await call('POST', '/admin', 1, { ...lantern, id: 'bad_one', rule: { type: 'daily', start: '9am', durationMin: 60 } });
    check('6d. an invalid rule → 400 with the reason', badRule.status === 400 && /HH:MM/.test(badRule.body.error));
    const updated = await call('PUT', '/admin/lantern_walk', 1, { ...lantern, rule: RULES.rotating });
    check('6e. admin update → fairness clears for a rotating rule', updated.status === 200 && updated.body.fairness.warn === false);
    const sched = await call('GET', '/schedule');
    check('6f. GET /schedule needs no login, is cached 60s and lists enabled definitions',
          sched.status === 200 && /max-age=60/.test(sched.cache) && sched.body.happenings.length === 1 && sched.body.happenings[0].rule.type === 'rotating');
    // /active at gameplayNow: real clock = 03:00 (no window); the admin warps to 14:30 (inside 14:00–16:00 on day 0 of rotation)
    H.invalidate();
    const day0 = D.ROTATION_EPOCH_MS;
    clock._resetForTest();
    clock._setClockForTest(() => day0 + 3 * HOUR);
    clock.setDebugOffset(1, 11.5 * HOUR);
    const adminActive = await call('GET', '/active', 1), playerActive = await call('GET', '/active', 2);
    check('6g. /active uses gameplayNow: the admin\'s warp sees it, another player doesn\'t',
          adminActive.body.active.length === 1 && playerActive.body.active.length === 0);
    const arch = await call('POST', '/admin/lantern_walk/archive', 1, {});
    const after = await call('GET', '/schedule');
    check('6h. archive hides it from the schedule', arch.status === 200 && after.body.happenings.length === 0);
    clock._resetForTest();
    srv.close();
  }

  // 7. The D7 replacement (offline integration) is documented
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'happening_effects.js'), 'utf8');
    check('7. happening_effects.js documents the offline integration that replaced D7', /replaces decision D7/.test(src) && /averageFactor|averageOver/.test(src));
    const db = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
    const mig = fs.readdirSync(path.join(__dirname, '..', 'migrations')).find(f => f.endsWith('_happenings.sql'));
    check('7b. happenings migration exists (BEGIN/COMMIT) and is registered', !!mig &&
          /BEGIN;[\s\S]*CREATE TABLE IF NOT EXISTS happenings[\s\S]*COMMIT;/.test(fs.readFileSync(path.join(__dirname, '..', 'migrations', mig), 'utf8')) && /'happenings'[,\]]/.test(db) && /'happening_modifiers'\]/.test(db));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
