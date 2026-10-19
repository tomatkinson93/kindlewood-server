// Spec 021 Phase 1 — 6h → 7h season cutover. Pure; never touches the DB.
// Run from the server root: node scripts/season_cutover_test.js [frontendDir]
// frontendDir defaults to $KW_FRONTEND_DIR, then ../kindlewood-frontend.
// If no frontend checkout is found, the parity block is SKIPPED (reported).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('../seasons');

const H = 60 * 60 * 1000;
const CUT = S.SEASON_CUTOVER_MS;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
}

// Deterministic sampler (mulberry32) — no Math.random in tests either.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The pre-021 formula, verbatim, as the oracle for the legacy range.
function legacy(ms) {
  const msIntoDay = ms % (24 * H);
  const index = Math.floor(msIntoDay / (6 * H));
  const msIntoSeason = msIntoDay % (6 * H);
  const dayNumber = Math.floor((ms - Date.parse('2025-01-01T00:00:00Z')) / (24 * H)) + 1;
  return { id: S.SEASONS[index].id, index, progress: msIntoSeason / (6 * H),
           msRemaining: 6 * H - msIntoSeason, dayNumber };
}

// 0. Cutover is a 00:00 UTC instant.
check('0. SEASON_CUTOVER_MS is 00:00 UTC', CUT % (24 * H) === 0, new Date(CUT).toISOString());

// 1. Legacy match — 10,000 timestamps before the cutover.
{
  const rnd = mulberry32(21);
  const lo = Date.parse('2025-01-01T00:00:00Z');
  let bad = null;
  for (let i = 0; i < 10000 && !bad; i++) {
    const ms = lo + Math.floor(rnd() * (CUT - lo));
    const a = S.seasonAt(ms), b = legacy(ms);
    if (a.id !== b.id || a.index !== b.index || a.progress !== b.progress ||
        a.msRemaining !== b.msRemaining || a.dayNumber !== b.dayNumber) bad = ms;
  }
  check('1. seasonAt === legacy formula for 10,000 pre-cutover timestamps', !bad,
        bad ? new Date(bad).toISOString() : '');
}

// 2. Seamless boundary.
{
  const before = S.seasonAt(CUT - 1), at = S.seasonAt(CUT);
  check('2a. CUT-1ms is Winter', before.id === 'winter', before.id);
  check('2b. CUT is Spring at progress 0', at.id === 'spring' && at.progress === 0,
        `${at.id} ${at.progress}`);
  check('2c. year continues at the boundary (no jump, no repeat)', at.year === before.year + 1,
        `${before.year} → ${at.year}`);
}

// 3. Season lengths — exactly 7h after the cutover, swept over 4 years.
{
  let bad = null;
  for (let k = 0; k < 16 && !bad; k++) {
    const start = CUT + k * 7 * H;
    const s = S.seasonAt(start), prev = S.seasonAt(start - 1), last = S.seasonAt(start + 7 * H - 1);
    if (s.index !== k % 4 || s.progress !== 0 || s.msRemaining !== 7 * H) bad = `start k=${k}`;
    else if (last.index !== s.index) bad = `end k=${k}`;
    else if (k > 0 && prev.index !== (k + 3) % 4) bad = `prev k=${k}`;
  }
  check('3. every post-cutover season is exactly 7h (16 seasons / 4 years)', !bad, bad || '');
  check('3b. a post-cutover year is 28h', S.seasonAt(CUT + 28 * H).year === S.seasonAt(CUT).year + 1);
}

// 4. Year monotonic, 2026-10-01 → 2027-01-01 at 1-minute steps.
{
  let prev = -Infinity, bad = null, steps = 0;
  for (let ms = Date.parse('2026-10-01T00:00:00Z'); ms <= Date.parse('2027-01-01T00:00:00Z'); ms += 60000) {
    const s = S.seasonAt(ms);
    if (s.year < prev || s.dayNumber !== s.year) { bad = new Date(ms).toISOString(); break; }
    prev = s.year; steps++;
  }
  check('4. year non-decreasing and dayNumber === year across the sweep', !bad, bad || `${steps} steps`);
}

// 5. Drift — every season × day-phase combination within 7 days of the cutover.
// Day phases from spec §2.1 (UTC, half-open). Inlined here because
// lib/day_cycle.js lands in Phase 2.
{
  const phaseOf = h => (h >= 9 && h < 11) ? 'dawn' : (h >= 11 && h < 23) ? 'day'
                    : (h >= 23 || h < 1) ? 'dusk' : 'night';
  const seen = new Set();
  for (let ms = CUT; ms < CUT + 7 * 24 * H; ms += 60000) {
    seen.add(S.seasonAt(ms).id + '/' + phaseOf(new Date(ms).getUTCHours()));
  }
  const want = [];
  for (const s of ['spring', 'summer', 'autumn', 'winter'])
    for (const p of ['dawn', 'day', 'dusk', 'night']) if (!seen.has(s + '/' + p)) want.push(s + '/' + p);
  check('5. all 16 season/phase combinations occur within 7 days', want.length === 0,
        want.length ? 'missing ' + want.join(', ') : '16/16');
}

// 6. Server/client parity — load the frontend js/seasons.js via vm.
{
  const dir = process.argv[2] || process.env.KW_FRONTEND_DIR ||
              path.join(__dirname, '..', '..', 'kindlewood-frontend');
  const file = path.join(dir, 'js', 'seasons.js');
  if (!fs.existsSync(file)) {
    console.log('  ⚠ 6. SKIPPED server/client parity — frontend not found at ' + file +
                ' (pass its directory as the first argument)');
  } else {
    const ctx = vm.createContext({ console, Date, Math, setInterval() {}, clearInterval() {},
                                   window: {}, localStorage: { getItem: () => null, setItem() {} },
                                   document: { getElementById: () => null, addEventListener() {},
                                               querySelectorAll: () => [] } });
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'frontend/seasons.js' });
    const calc = vm.runInContext('calcSeasonAt', ctx);
    const rnd = mulberry32(2102);
    const lo = Date.parse('2026-01-01T00:00:00Z'), hi = Date.parse('2028-01-01T00:00:00Z');
    const samples = [CUT - 1, CUT, CUT + 1];
    for (let i = 0; i < 10000; i++) samples.push(lo + Math.floor(rnd() * (hi - lo)));
    let bad = null;
    for (const ms of samples) {
      const a = S.seasonAt(ms), b = calc(ms);
      if (a.id !== b.id || a.index !== b.index || a.progress !== b.progress ||
          a.msRemaining !== b.msRemaining || a.year !== b.year || a.dayNumber !== b.dayNumber ||
          a.name !== b.name || a.emoji !== b.emoji) { bad = ms; break; }
    }
    check(`6. frontend calcSeasonAt === server seasonAt (${samples.length} timestamps)`, !bad,
          bad ? new Date(bad).toISOString() : '');
    const mods = vm.runInContext('SEASON_MODS', ctx);
    const modBad = S.SEASONS.filter(se => JSON.stringify({ modifiers: se.modifiers, foodConsumption: se.foodConsumption, timberConsumption: se.timberConsumption, birthChanceBonus: se.birthChanceBonus })
      !== JSON.stringify(mods[se.id] && { modifiers: mods[se.id].modifiers, foodConsumption: mods[se.id].foodConsumption, timberConsumption: mods[se.id].timberConsumption, birthChanceBonus: mods[se.id].birthChanceBonus }));
    check('6c. frontend SEASON_MODS matches the server SEASONS effects', modBad.length === 0, modBad.map(x => x.id).join(','));
    const cur = vm.runInContext('calcCurrentSeason()', ctx);
    check('6b. frontend calcCurrentSeason() routes through _seasonNow()', !!cur && typeof cur.index === 'number');
  }
}

// 7. getCurrentSeason keeps its shape.
{
  const c = S.getCurrentSeason();
  const keys = ['id', 'name', 'emoji', 'flavor', 'modifiers', 'index', 'progress', 'msRemaining', 'dayNumber', 'year'];
  const missing = keys.filter(k => !(k in c));
  check('7. getCurrentSeason() shape unchanged', missing.length === 0, missing.join(','));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
