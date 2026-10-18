// ══════════════════════════════════════════════════════════════════════════
//  day_cycle — Kindlewood's shared day/night, sun, moon and Happening-window
//  math (spec 021 §2.1).
//
//  UTC. Night ≈ 9pm–5am Eastern (summer) / 8pm–4am (winter). Tune here only.
//
//  BYTE-IDENTICAL in two places — edit one, copy to the other:
//    kindlewood-server/lib/day_cycle.js     (module.exports)
//    kindlewood-frontend/js/day-cycle.js    (window.KWDayCycle)
//  Pure functions only: no DOM, no DB, never reads the clock. Callers pass ms.
//  Both repos' tests compare the two files' SHA-256.
// ══════════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  var MIN_MS = 60 * 1000;
  var HOUR_MS = 60 * MIN_MS;
  var DAY_MS = 24 * HOUR_MS;

  // ── Phase table (UTC hour ranges, half-open, wrap at 24) ─────────────────
  var PHASES = [
    { id: 'dawn',  start: 9,  end: 11 },
    { id: 'day',   start: 11, end: 23 },
    { id: 'dusk',  start: 23, end: 25 },   // 23:00–01:00
    { id: 'night', start: 1,  end: 9 },
  ];
  var PHASE_IDS = ['dawn', 'day', 'dusk', 'night'];

  // ── Moon ─────────────────────────────────────────────────────────────────
  // 8-day cycle. A moon day runs 11:00 → 11:00 UTC (end of dawn), so one whole
  // moon-up period (dusk → night → dawn) belongs to a single moon, and the
  // moon index never changes while the moon is up. Day 0 (new) is the moon
  // day that starts 2026-11-02 11:00 UTC — its night is Nov 2 → Nov 3.
  var MOON_EPOCH_MS = Date.parse('2026-11-02T11:00:00Z');
  var MOON_CYCLE_DAYS = 8;
  var MOON_IDS = ['new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
                  'full', 'waning_gibbous', 'last_quarter', 'waning_crescent'];
  var MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
                    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  var MOON_GLYPHS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

  // Anchor for "rotating" Happening rules: day 0 is this UTC date.
  var ROTATION_EPOCH_MS = Date.parse('2026-11-02T00:00:00Z');

  // ── Lighting keyframes (hour of UTC day → values), smoothstep between. ───
  // The table wraps at 24h. Every keyframe is reached with zero slope, so the
  // curve is continuous with no corners. Day (11:00–23:00) is exactly zero.
  //   darkness:     0 day · ~0.35 at end of dusk · 0.55 cap at night
  //   lightLevel:   0 day · rises from 40% through dusk (23:48) · 1 at night
  //                 · back to 0 by 50% through dawn (10:00)
  //   tint:         amber at dusk · blue-violet at night · rose-gold at dawn
  //   warmth:       low-sun glow, peaks at dusk and dawn
  var AMBER = [255, 150, 80];
  var NIGHT = [70, 70, 150];
  var ROSE = [255, 175, 150];
  var SILVER = [200, 210, 235];
  var DARKNESS_CAP = 0.55;

  var KEYFRAMES = {
    darkness:     [[9, 0.35], [10, 0.12], [11, 0], [23, 0], [24, 0.2], [25, 0.35], [26, 0.55], [32, 0.55]],
    lightLevel:   [[8, 1], [10, 0], [23.8, 0], [25.5, 1]],
    tintStrength: [[8, 0.45], [9.5, 0.3], [11, 0], [23, 0], [24, 0.35], [25.5, 0.45]],
    tint:         [[8, NIGHT], [9.5, ROSE], [11, ROSE], [23, AMBER], [24.5, AMBER], [25.75, NIGHT]],
    warmth:       [[8, 0], [9.75, 1], [12, 0], [21.5, 0], [23.75, 1], [26, 0]],
  };

  // ── small helpers ────────────────────────────────────────────────────────
  function pmod(a, n) { return ((a % n) + n) % n; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Interpolate a wrapped keyframe track at hour h (0..24). Values are numbers
  // or [r,g,b] arrays. Keyframe hours may exceed 24 (they wrap).
  function track(keys, h) {
    var n = keys.length, i, k0, k1, h0, h1;
    var pts = [];
    for (i = 0; i < n; i++) pts.push([pmod(keys[i][0], 24), keys[i][1]]);
    pts.sort(function (a, b) { return a[0] - b[0]; });
    for (i = 0; i < n; i++) {
      k0 = pts[i]; k1 = pts[(i + 1) % n];
      h0 = k0[0]; h1 = k1[0] + (i + 1 === n ? 24 : 0);
      var hh = h < h0 ? h + 24 : h;
      if (hh >= h0 && hh < h1) {
        var t = smooth((hh - h0) / (h1 - h0));
        if (typeof k0[1] === 'number') return lerp(k0[1], k1[1], t);
        return [lerp(k0[1][0], k1[1][0], t), lerp(k0[1][1], k1[1][1], t), lerp(k0[1][2], k1[1][2], t)];
      }
    }
    return pts[0][1];
  }

  function hourOf(ms) { return pmod(ms, DAY_MS) / HOUR_MS; }

  // ── clock ────────────────────────────────────────────────────────────────
  function clockAt(ms) {
    var d = new Date(ms);
    return {
      hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
      dayFraction: pmod(ms, DAY_MS) / DAY_MS,
      ymd: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()),
      weekday: d.getUTCDay(),
    };
  }

  // ── phases ───────────────────────────────────────────────────────────────
  function phaseIndexAtHour(h) {
    for (var i = 0; i < PHASES.length; i++) {
      var p = PHASES[i], hh = (h < p.start) ? h + 24 : h;
      if (hh >= p.start && hh < p.end) return i;
    }
    return 1;
  }

  function phaseAt(ms) {
    var h = hourOf(ms);
    var i = phaseIndexAtHour(h), p = PHASES[i];
    var hh = (h < p.start) ? h + 24 : h;
    var len = p.end - p.start;
    var msToNext = Math.round((p.end - hh) * HOUR_MS);
    return {
      phase: p.id,
      progress: (hh - p.start) / len,
      nextPhase: PHASES[(i + 1) % PHASES.length].id,
      msToNext: msToNext,
    };
  }

  // Start ms of the occurrence of `phase` that contains or follows ms.
  function phaseStartBefore(phase, ms) {
    var p = PHASES[PHASE_IDS.indexOf(phase)];
    var dayStart = ms - pmod(ms, DAY_MS);
    var s = dayStart + pmod(p.start, 24) * HOUR_MS;
    if (s > ms) s -= DAY_MS;
    return s;
  }

  // Midpoint of the next occurrence of `phase` at or after referenceMs.
  // (A dusk midpoint is 00:00, which belongs to the next UTC day.)
  function phaseMidpoint(phase, referenceMs) {
    var p = PHASES[PHASE_IDS.indexOf(phase)];
    if (!p) throw new Error('unknown phase ' + phase);
    var dayStart = referenceMs - pmod(referenceMs, DAY_MS);
    var mid = dayStart + pmod((p.start + p.end) / 2, 24) * HOUR_MS;
    while (mid < referenceMs) mid += DAY_MS;
    return mid;
  }

  // ── sun ──────────────────────────────────────────────────────────────────
  // Up across dawn + day + dusk (09:00 → 01:00, 16h). elevation is 0 at dawn
  // start and dusk end, 1 at the midpoint of day (17:00).
  var SUN_START = 9, SUN_LEN = 16;
  function sunAt(ms) {
    var a = pmod(hourOf(ms) - SUN_START, 24) / SUN_LEN;
    var up = a < 1;
    var arc = up ? a : 1;
    return { up: up, elevation: up ? Math.sin(Math.PI * arc) : 0, arc: up ? arc : 0 };
  }

  // ── moon ─────────────────────────────────────────────────────────────────
  function moonIndexAt(ms) {
    return pmod(Math.floor((ms - MOON_EPOCH_MS) / DAY_MS), MOON_CYCLE_DAYS);
  }
  function moonIllumination(index) {
    return (1 - Math.cos(2 * Math.PI * index / MOON_CYCLE_DAYS)) / 2;
  }
  // Up across dusk + night + dawn (23:00 → 11:00, 12h).
  var MOON_START = 23, MOON_LEN = 12;
  function moonInfo(index, ms) {
    var a = pmod(hourOf(ms) - MOON_START, 24) / MOON_LEN;
    var up = a < 1;
    return {
      index: index, id: MOON_IDS[index], name: MOON_NAMES[index], glyph: MOON_GLYPHS[index],
      illumination: moonIllumination(index), up: up, arc: up ? a : 0,
    };
  }
  function moonAt(ms) { return moonInfo(moonIndexAt(ms), ms); }

  // ── lighting ─────────────────────────────────────────────────────────────
  // opts.moonIndex overrides the moon (tests, previews); otherwise derived.
  function lightingAt(ms, opts) {
    var h = hourOf(ms);
    var base = track(KEYFRAMES.darkness, h);
    var tint = track(KEYFRAMES.tint, h);
    var idx = (opts && opts.moonIndex != null) ? pmod(opts.moonIndex, MOON_CYCLE_DAYS) : moonIndexAt(ms);
    var illum = moonIllumination(idx);
    // Moonlight is weighted by a smooth night factor (0 by day, 1 at full
    // night) rather than a phase switch, so it never steps.
    var night = base / DARKNESS_CAP;
    var darkness = Math.max(0, base - 0.08 * illum * night);
    var s = 0.3 * illum * night;
    tint = [lerp(tint[0], SILVER[0], s), lerp(tint[1], SILVER[1], s), lerp(tint[2], SILVER[2], s)];
    return {
      darkness: darkness,
      tint: [Math.round(tint[0]), Math.round(tint[1]), Math.round(tint[2])],
      tintStrength: track(KEYFRAMES.tintStrength, h),
      lightLevel: track(KEYFRAMES.lightLevel, h),
      warmth: track(KEYFRAMES.warmth, h),
    };
  }

  // ── dev time override (shared so client + server compute the same offset)
  // req: { offsetMs } | { phase } | { hour } | { moon } — returns the new
  // offset. phase/hour/moon jump forward from the CURRENT gameplay time
  // (wall + currentOffset), so picks compose: Night then Full moon gives a
  // full-moon night. A moon pick keeps the time of day. Time keeps running
  // afterwards (the caller expires the offset).
  function overrideOffset(req, wallMs, currentOffsetMs) {
    var cur = currentOffsetMs || 0;
    var base = wallMs + cur;
    if (req.offsetMs != null) return Number(req.offsetMs);
    if (req.phase != null) return cur + (phaseMidpoint(req.phase, base) - base);
    if (req.hour != null) return cur + pmod(Number(req.hour) * HOUR_MS - pmod(base, DAY_MS), DAY_MS);
    if (req.moon != null) return cur + pmod(Number(req.moon) - moonIndexAt(base), MOON_CYCLE_DAYS) * DAY_MS;
    return cur;
  }

  // ── Happening windows (spec §6.2) ────────────────────────────────────────
  // Returns every window that OVERLAPS [fromMs, toMs), unclipped, merged
  // where windows of the same rule overlap or touch, sorted by start.
  // "Active at t" = some window with startMs <= t < endMs, i.e.
  //   windowsBetween(rule, t, t + 1).length > 0.
  var LOOKBACK_MS = 3 * DAY_MS;   // longest recurring window is ≤ 24h (+ merges)

  function parseHHMM(s) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return (h * 60 + mi) * MIN_MS;
  }

  function rawWindows(rule, fromMs, toMs) {
    var out = [], d, dayStart, s;
    var startDay = Math.floor((fromMs - LOOKBACK_MS) / DAY_MS) * DAY_MS;
    switch (rule && rule.type) {
      case 'once': {
        var a = Date.parse(rule.start), b = Date.parse(rule.end);
        if (isFinite(a) && isFinite(b) && b > a) out.push({ startMs: a, endMs: b });
        break;
      }
      case 'daily':
      case 'weekly':
      case 'rotating': {
        var off = parseHHMM(rule.start), dur = Number(rule.durationMin) * MIN_MS;
        if (off == null || !(dur > 0)) break;
        for (dayStart = startDay; dayStart < toMs; dayStart += DAY_MS) {
          s = dayStart + off;
          if (rule.type === 'weekly') {
            if (!rule.days || rule.days.indexOf(new Date(dayStart).getUTCDay()) < 0) continue;
          }
          if (rule.type === 'rotating') {
            d = Math.round((dayStart - ROTATION_EPOCH_MS) / DAY_MS);
            s = dayStart + pmod(off + pmod(d * Number(rule.shiftHours || 0), 24) * HOUR_MS, DAY_MS);
          }
          out.push({ startMs: s, endMs: s + dur });
        }
        break;
      }
      case 'phase':
      case 'moon': {
        var phases = rule.phases || [];
        var moons = rule.type === 'moon' ? (rule.moons || []) : null;
        for (dayStart = startDay - DAY_MS; dayStart < toMs; dayStart += DAY_MS) {
          for (var i = 0; i < PHASES.length; i++) {
            var p = PHASES[i];
            if (phases.indexOf(p.id) < 0) continue;
            s = dayStart + p.start * HOUR_MS;
            if (moons && moons.indexOf(MOON_IDS[moonIndexAt(s)]) < 0) continue;
            out.push({ startMs: s, endMs: dayStart + p.end * HOUR_MS });
          }
        }
        break;
      }
    }
    return out;
  }

  function windowsBetween(rule, fromMs, toMs) {
    // Generate a margin past toMs too, so a window that overlaps the range
    // is merged with its neighbours before the filter (unclipped).
    var w = rawWindows(rule, fromMs, toMs + LOOKBACK_MS).sort(function (a, b) { return a.startMs - b.startMs; });
    var merged = [];
    for (var i = 0; i < w.length; i++) {
      var last = merged[merged.length - 1];
      if (last && w[i].startMs <= last.endMs) { if (w[i].endMs > last.endMs) last.endMs = w[i].endMs; }
      else merged.push({ startMs: w[i].startMs, endMs: w[i].endMs });
    }
    return merged.filter(function (x) { return x.endMs > fromMs && x.startMs < toMs; });
  }

  // ── Happening rule validation (spec §6.4) ───────────────────────────────
  // → { ok: true, rule } with only the known fields, or { ok: false, error }.
  // Shared so the admin form and the server reject exactly the same rules.
  function _subset(v, known) {
    if (!Array.isArray(v)) return null;
    var out = known.filter(function (k) { return v.indexOf(k) >= 0; });
    return out.length && out.length === uniq(v).length ? out : null;
  }
  function uniq(v) { return v.filter(function (x, i) { return v.indexOf(x) === i; }); }
  function validateRule(rule) {
    var r = rule || {}, t = r.type, dur = Number(r.durationMin);
    function bad(e) { return { ok: false, error: e }; }
    function needsTime() {
      if (parseHHMM(r.start) == null) return 'start must be "HH:MM" (UTC).';
      if (!(dur === Math.floor(dur) && dur >= 15 && dur <= 1440)) return 'durationMin must be a whole number from 15 to 1440.';
      return null;
    }
    var e;
    switch (t) {
      case 'once': {
        var a = Date.parse(r.start), b = Date.parse(r.end);
        if (!isFinite(a) || !isFinite(b)) return bad('start and end must be ISO date-times (UTC).');
        if (b <= a) return bad('end must be after start.');
        return { ok: true, rule: { type: t, start: new Date(a).toISOString(), end: new Date(b).toISOString() } };
      }
      case 'daily':
        if ((e = needsTime())) return bad(e);
        return { ok: true, rule: { type: t, start: r.start, durationMin: dur } };
      case 'weekly': {
        if ((e = needsTime())) return bad(e);
        var days = Array.isArray(r.days) ? uniq(r.days.map(Number)) : [];
        if (!days.length || days.some(function (d) { return !(d === Math.floor(d) && d >= 0 && d <= 6); }))
          return bad('days must list weekdays 0–6 (0 = Sunday).');
        return { ok: true, rule: { type: t, days: days.sort(), start: r.start, durationMin: dur } };
      }
      case 'rotating': {
        if ((e = needsTime())) return bad(e);
        var sh = Number(r.shiftHours);
        if (!(sh === Math.floor(sh) && sh >= 1 && sh <= 23)) return bad('shiftHours must be a whole number from 1 to 23.');
        return { ok: true, rule: { type: t, start: r.start, durationMin: dur, shiftHours: sh } };
      }
      case 'phase': {
        var ph = _subset(r.phases, PHASE_IDS);
        if (!ph) return bad('phases must list one or more of ' + PHASE_IDS.join(', ') + '.');
        return { ok: true, rule: { type: t, phases: ph } };
      }
      case 'moon': {
        var mo = _subset(r.moons, MOON_IDS), ph2 = _subset(r.phases, PHASE_IDS);
        if (!mo) return bad('moons must list one or more moon ids.');
        if (!ph2) return bad('phases must list one or more of ' + PHASE_IDS.join(', ') + '.');
        return { ok: true, rule: { type: t, moons: mo, phases: ph2 } };
      }
      default:
        return bad('type must be once, daily, weekly, rotating, phase or moon.');
    }
  }

  // ── Fairness check (spec §6.5) — a warning, never a block ────────────────
  // Over the 7 UTC days from fromMs's day: coverage[day][hour] (1 = some
  // window overlaps that hour), the distinct UTC start hours, the longest
  // window. warn when < 3 distinct start hours AND longest < 8h; phase/moon
  // rules are exempt from the start-hour test (so they never warn).
  var FAIR_MIN_START_HOURS = 3, FAIR_LONG_MS = 8 * HOUR_MS;
  function fairnessOf(rule, fromMs) {
    var day0 = fromMs - pmod(fromMs, DAY_MS), end = day0 + 7 * DAY_MS;
    var w = windowsBetween(rule, day0, end);
    var coverage = [], hours = {}, longest = 0, d, h, i;
    for (d = 0; d < 7; d++) {
      var row = [];
      for (h = 0; h < 24; h++) {
        var hs = day0 + d * DAY_MS + h * HOUR_MS, on = 0;
        for (i = 0; i < w.length; i++) if (w[i].startMs < hs + HOUR_MS && w[i].endMs > hs) { on = 1; break; }
        row.push(on);
      }
      coverage.push(row);
    }
    for (i = 0; i < w.length; i++) {
      if (w[i].startMs >= day0 && w[i].startMs < end) hours[new Date(w[i].startMs).getUTCHours()] = 1;
      longest = Math.max(longest, w[i].endMs - w[i].startMs);
    }
    var startHours = Object.keys(hours).length;
    var exempt = !!rule && (rule.type === 'phase' || rule.type === 'moon');
    var fewStarts = !exempt && startHours < FAIR_MIN_START_HOURS;
    return {
      coverage: coverage, startHours: startHours, longestMs: longest, exempt: exempt,
      warn: fewStarts && longest < FAIR_LONG_MS, windows: w.length,
    };
  }

  var API = {
    PHASES: PHASES, PHASE_IDS: PHASE_IDS, KEYFRAMES: KEYFRAMES, DARKNESS_CAP: DARKNESS_CAP,
    MOON_EPOCH_MS: MOON_EPOCH_MS, MOON_IDS: MOON_IDS, MOON_NAMES: MOON_NAMES, MOON_GLYPHS: MOON_GLYPHS,
    ROTATION_EPOCH_MS: ROTATION_EPOCH_MS, SILVER: SILVER,
    clockAt: clockAt, phaseAt: phaseAt, phaseStartBefore: phaseStartBefore, phaseMidpoint: phaseMidpoint,
    sunAt: sunAt, moonAt: moonAt, moonIndexAt: moonIndexAt, lightingAt: lightingAt,
    overrideOffset: overrideOffset, windowsBetween: windowsBetween, parseHHMM: parseHHMM,
    validateRule: validateRule, fairnessOf: fairnessOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.KWDayCycle = API;
})(typeof window !== 'undefined' ? window : null);
