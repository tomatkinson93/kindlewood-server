// ══════════════════════════════════════════════════════════════════════════
//  population_model — will a town die out, stall or overflow once citizens
//  age and die? A Monte Carlo model of the Phase 1 life cycle
//  (docs/PHASE_1_LIFE_CYCLE.md), built on the game's real numbers:
//    simulation.js CFG   births: 4% an hour, +10% in spring, −5% in winter,
//                        +4% per 10 happiness over 60, capped at 35%
//    seasons.js          a year is 28 real hours (4 seasons of 7)
//    buildings.js        houses per tier: camp 5, village 15, town 30, city 60
//    citizens.js         a town starts with 10 adults aged 16–35
//
//   node scripts/population_model.js            the scenarios below, 300 runs each
//   node scripts/population_model.js --runs 50  fewer runs (faster)
//
//  It is a planning tool, not a test: nothing in the game reads it. Simplified
//  on purpose: happiness is a flat 70, couples form at a daily chance (the
//  game's bonding takes about 5–10 days for workmates or housemates), and
//  housing sorts itself (a couple takes an empty house when there is one).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const YEAR_H = 28, DAY_H = 24;
const SEASON_BONUS = [0.10, 0, 0, -0.05];             // spring, summer, autumn, winter

const BASE = {
  days: 180,
  founders: 10, founderAge: [16, 35],
  houses: 5, capacity: 2,                              // today's camp
  ageing: true,
  youthAt: 6, adultAt: 10, elderAt: 45,
  deathFrom: 50, deathBase: 0.08, deathRise: 0.04,     // chance per year from deathFrom, rising each year
  fertileFrom: 10, fertileTo: 999,                     // both partners
  birthChance: h => Math.min(0.35, Math.max(0, 0.04 + SEASON_BONUS[Math.floor((h % YEAR_H) / 7)] + 0.04)),  // per hour, at happiness 70
  cooldownYears: 0,                                    // years a couple waits after a birth
  maxChildren: 99,                                     // per couple
  pairChancePerDay: 0.12,                              // an eligible pair becomes a couple
  kinRule: false,                                      // no parent–child, sibling or half-sibling couples
  remarry: true,
  newcomerEveryDays: 0,                                // 0 = none; else an adult arrives when there is room
  pairFromDay: 4,                                      // bonding takes a few days before anyone can pair up
  beds: false,                                         // true: a birth needs a free bed anywhere in town (houses × capacity),
                                                       //       not a free place in the couple's own house
  rescueBelowAdults: 0,                                // fewer working adults than this: a settler arrives next day, if there is a bed
};

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function run(cfg, seed) {
  const R = rng(seed), ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  let nextId = 1;
  const mk = (age, parents = []) => ({ id: nextId++, female: R() < 0.5, bornH: -age * YEAR_H, parents, partner: null, house: null, kids: 0, lastBirthH: -1e9, dead: false });
  const people = Array.from({ length: cfg.founders }, () => mk(ri(cfg.founderAge[0], cfg.founderAge[1])));
  const houses = Array.from({ length: cfg.houses }, (_, i) => ({ id: i, n: 0 }));
  const age = (p, h) => (cfg.ageing ? (h - p.bornH) / YEAR_H : -p.bornH / YEAR_H);
  const alive = () => people.filter(p => !p.dead);
  const moveTo = (p, hs) => { if (p.house) p.house.n--; p.house = hs; if (hs) hs.n++; };
  const emptyHouse = () => houses.find(x => x.n === 0);
  const roomiest = () => houses.filter(x => x.n < cfg.capacity).sort((a, b) => a.n - b.n)[0];
  for (const p of people) moveTo(p, roomiest() || null);   // founders: spread across the huts
  const kin = (a, b) => a.parents.includes(b.id) || b.parents.includes(a.id) || a.parents.some(x => b.parents.includes(x));
  const out = { pop: [], adults: [], births: 0, deaths: 0, firstBirthDay: null, day20: null, extinctDay: null, minAdults: 1e9, newcomers: 0 };

  const H = cfg.days * DAY_H;
  for (let h = 0; h < H; h++) {
    const live = alive();
    // Deaths (checked once a game year per person, on their birthday hour).
    if (cfg.ageing) for (const p of live) {
      const a = age(p, h);
      if (a >= cfg.deathFrom && (h - p.bornH) % YEAR_H === 0) {
        const chance = Math.min(0.6, cfg.deathBase + cfg.deathRise * (Math.floor(a) - cfg.deathFrom));
        if (R() < chance) { p.dead = true; out.deaths++; moveTo(p, null); if (p.partner) { p.partner.partner = null; p.partner = null; } }
      }
    }
    // Once a day: couples form; newcomers; housing sorts itself.
    if (h % DAY_H === 0 && h / DAY_H >= cfg.pairFromDay) {
      const singles = alive().filter(p => !p.partner && age(p, h) >= cfg.adultAt && (cfg.remarry || p.kids === 0));
      for (const a of singles) {
        if (a.partner) continue;
        const cands = singles.filter(b => b !== a && !b.partner && b.female !== a.female && (!cfg.kinRule || !kin(a, b)));
        if (!cands.length) continue;
        if (R() < 1 - Math.pow(1 - cfg.pairChancePerDay, Math.min(3, cands.length))) {
          const b = cands.sort((x, y) => Math.abs(age(x, h) - age(a, h)) - Math.abs(age(y, h) - age(a, h)))[0];
          a.partner = b; b.partner = a;
          const hs = emptyHouse();                        // a new couple takes an empty house if there is one
          if (hs) { moveTo(a, hs); moveTo(b, hs); } else if (a.house && a.house.n < cfg.capacity) moveTo(b, a.house); else if (b.house && b.house.n < cfg.capacity) moveTo(a, b.house);
        }
      }
      for (const p of alive()) if (!p.house) { const hs = roomiest(); if (hs) moveTo(p, hs); }
    }
    if (h % DAY_H === 0 && h > 0) {
      const now = alive(), room = cfg.beds ? now.length < cfg.houses * cfg.capacity : !!roomiest();
      const working = now.filter(p => { const x = age(p, h); return x >= cfg.adultAt && x < cfg.elderAt; }).length;
      const due = (cfg.newcomerEveryDays && (h / DAY_H) % cfg.newcomerEveryDays === 0) || working < cfg.rescueBelowAdults;
      if (due && room) { const p = mk(ri(12, 24)); people.push(p); moveTo(p, roomiest() || null); out.newcomers++; }
    }
    // Births: a couple sharing a house with a free place.
    for (const a of alive()) {
      const b = a.partner;
      if (!b || !a.female) continue;
      if (cfg.beds ? alive().length >= cfg.houses * cfg.capacity : (a.house !== b.house || !a.house || a.house.n >= cfg.capacity)) continue;
      const aa = age(a, h), ab = age(b, h);
      if (aa < cfg.fertileFrom || ab < cfg.fertileFrom || aa > cfg.fertileTo || ab > cfg.fertileTo) continue;
      if (a.kids >= cfg.maxChildren || h - a.lastBirthH < cfg.cooldownYears * YEAR_H) continue;
      if (R() < cfg.birthChance(h)) {
        const c = mk(0, [a.id, b.id]); c.bornH = h; people.push(c); moveTo(c, cfg.beds ? (roomiest() || null) : a.house);
        a.kids++; b.kids++; a.lastBirthH = h; out.births++;
        if (out.firstBirthDay == null) out.firstBirthDay = h / DAY_H;
      }
    }
    if (h % DAY_H === 0) {
      const now = alive(), ad = now.filter(p => { const x = age(p, h); return x >= cfg.adultAt && x < cfg.elderAt; }).length;
      out.pop.push(now.length); out.adults.push(ad);
      out.minAdults = Math.min(out.minAdults, ad);
      if (out.day20 == null && now.length >= 20) out.day20 = h / DAY_H;
      if (out.extinctDay == null && now.length === 0) out.extinctDay = h / DAY_H;
    }
  }
  return out;
}

const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
function scenario(name, over, runs) {
  const cfg = { ...BASE, ...over };
  const rs = Array.from({ length: runs }, (_, i) => run(cfg, 1000 + i));
  const at = d => med(rs.map(r => r.pop[Math.min(d, r.pop.length - 1)]));
  const adAt = d => med(rs.map(r => r.adults[Math.min(d, r.adults.length - 1)]));
  const pct = f => Math.round(rs.filter(f).length / runs * 100);
  return {
    name, cap: cfg.houses * cfg.capacity,
    pop: [30, 60, 90, 120, 179].map(at), adults: [30, 60, 90, 120, 179].map(adAt),
    extinct: pct(r => r.pop[r.pop.length - 1] === 0), under5: pct(r => r.pop[r.pop.length - 1] < 5),
    worstAdults: med(rs.map(r => r.minAdults)), firstBirth: med(rs.map(r => r.firstBirthDay)),
    reach20: pct(r => r.day20 != null), day20: med(rs.map(r => r.day20)),
    births: med(rs.map(r => r.births)), deaths: med(rs.map(r => r.deaths)),
  };
}

const P = { capacity: 4, kinRule: true, fertileFrom: 12, fertileTo: 40, cooldownYears: 3, maxChildren: 4 };   // the Phase 1 family rules
// The recommended pace (docs/PHASE_1_LIFE_CYCLE.md §2).
const LONG = { ...P, beds: true, newcomerEveryDays: 7, rescueBelowAdults: 6, youthAt: 7, adultAt: 12, elderAt: 60, deathFrom: 70, deathBase: 0.06, deathRise: 0.03, fertileFrom: 14, fertileTo: 55, cooldownYears: 2 };
const SCENARIOS = [
  ['A. Today, no ageing (the live game)',                      { ageing: false, pairFromDay: 0 }],
  ['B. Ageing and death added, nothing else',                  {}],
  ['C. B + houses hold 4',                                     { capacity: 4 }],
  ['D. Family rules (kin rule, fertile 12–40, 3-year gap, 4 children), a place in the couple\'s own house', { ...P }],
  ['E. D, but a birth needs a free bed anywhere in town',      { ...P, beds: true }],
  ['F. E + a settler every 10 days while there is a bed',      { ...P, beds: true, newcomerEveryDays: 10 }],
  ['G. F + a settler the next day whenever working adults drop below 4', { ...P, beds: true, newcomerEveryDays: 10, rescueBelowAdults: 4 }],
  ['H. G at a Village (15 houses, 60 beds)',                   { ...P, beds: true, newcomerEveryDays: 10, rescueBelowAdults: 4, houses: 15 }],
  ['I. G with a 2-year gap and no limit on children',          { ...P, beds: true, newcomerEveryDays: 10, rescueBelowAdults: 4, cooldownYears: 2, maxChildren: 99 }],
  ['J. G with longer lives (elder at 55, deaths from 60)',     { ...P, beds: true, newcomerEveryDays: 10, rescueBelowAdults: 4, elderAt: 55, deathFrom: 60, fertileTo: 45 }],
  ['K. Recommended pace: adult at 12, elder at 60, deaths from 70; fertile 14–55; 2-year gap; settlers', { ...LONG }],
  ['L. K at a Village (60 beds)',                              { ...LONG, houses: 15 }],
  ['M. K at a Town (120 beds)',                                { ...LONG, houses: 30 }],
];

if (require.main === module) {
  const i = process.argv.indexOf('--runs');
  const runs = i > 0 ? Number(process.argv[i + 1]) : 300;
  console.log(`Population model: ${runs} runs each, ${BASE.days} days. Medians unless stated.\n`);
  for (const [name, over] of SCENARIOS) {
    const s = scenario(name, over, runs);
    console.log(name);
    console.log(`  room ${s.cap} · people at day 30/60/90/120/180: ${s.pop.join(' / ')} · working adults: ${s.adults.join(' / ')}`);
    console.log(`  first birth day ${s.firstBirth == null ? 'never' : Math.round(s.firstBirth)} · births ${s.births}, deaths ${s.deaths} (a death every ${s.deaths ? (BASE.days / s.deaths).toFixed(1) : '—'} days) · fewest working adults ${s.worstAdults}`);
    console.log(`  reaches 20 people in ${s.reach20}% of runs${s.day20 != null ? ` (day ${Math.round(s.day20)})` : ''} · died out ${s.extinct}% · under 5 left ${s.under5}%\n`);
  }
}

module.exports = { run, scenario, BASE, SCENARIOS };
