// ══════════════════════════════════════════════════════════════════════════
//  CAREER PROFILES — what a citizen's job, perks, traits and gear add up to.
//
//  Pure (no DB): lib/careers/index.js loads the rows, this turns them into
//  profiles, and production (buildings.js citizenContributions) reads them.
//
//  A profile: { classKey, cls, row, effects (totals), sources, stats (with
//  perk/gear changes), skills (effective, ≤13), outputMult, mentor,
//  mentorBonus, leaderAura, familyTrade }.
//  Settlement-wide pass: class auras, mentors, natural leaders, settlement
//  happiness, market bonuses (best merchant / each shop's keeper).
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const M = require('../career_math');
const { CLASSES } = require('./classes');
const T = require('./traits');

const STATS = ['strength', 'agility', 'endurance', 'intelligence', 'charisma'];
const SKILLS = ['farming', 'woodcutting', 'fishing', 'mining', 'crafting', 'scouting', 'combat'];
const SKILL_CAP = 13;          // base 10 + perks and gear
const GEAR_SKILL_CAP = 5;      // gear adds at most +5 to one skill
const TOOL_OUTPUT_PER_POINT = 0.03, TOOL_OUTPUT_CAP = 0.15;

const MENTOR_MIN_LEVEL = 10, MENTOR_GAP = 5, MENTOR_MAX_APPRENTICES = 5;

const has = (arr, x) => Array.isArray(arr) && arr.includes(x);
const fxv = (type, value, param, source) => ({ type, param, value, source });

// Effects that come with the citizen, not the job: trait job-effects for
// their class, earned traits, gear. `gear`: equipped inventory rows.
function personalEffects(c, cls, row, gear) {
  const out = [];
  const role = c.role;
  const vis = c.visible_traits || [];
  // Visible traits, now with job effects.
  if (cls) {
    if (has(vis, 'strong') && cls.primary === 'strength') out.push(fxv('output', 0.05, null, 'Strong'));
    if (has(vis, 'frail') && cls.physical) out.push(fxv('output', -0.1, null, 'Frail'));
    if (has(vis, 'clumsy') && cls.physical) out.push(fxv('injury', 4, null, 'Clumsy'));
    if (has(vis, 'charming') && (role === 'merchant' || role === 'shopkeeper')) out.push(fxv('fee', -0.05, null, 'Charming'));
    if (has(vis, 'charming') && role === 'tavernkeep') out.push(fxv('happiness', 1, null, 'Charming'));
    if (has(vis, 'greedy') && role === 'merchant') out.push(fxv('fee', -0.05, null, 'Greedy'));
    if (cls.station && has(vis, 'clumsy')) out.push(fxv('quality', -6, null, 'Clumsy'));
    if (cls.station && has(vis, 'genius')) out.push(fxv('quality', 3, null, 'Genius'));
  }
  if (has(vis, 'quick')) out.push(fxv('travel', 0.05, null, 'Quick'));
  if (has(vis, 'wanderer')) out.push(fxv('travel', 0.08, null, 'Wanderer'));
  // Hidden aptitudes/aversions work whether or not anyone knows yet.
  for (const t of c.hidden_traits || []) {
    const a = T.APTITUDES[t] || T.AVERSIONS[t];
    if (a && a.classes.includes(role)) for (const e of a.effects) out.push(fxv(e.type, e.value, e.param, a.label));
  }
  // Earned: service in this class; quirks and deeds always.
  for (const et of c.earned_traits || []) {
    if (et.id === 'veteran' && et.class === role) T.SERVICE.veteran.effects.forEach(e => out.push(fxv(e.type, e.value, e.param, 'Veteran')));
    else if (et.id === 'old_hand' && et.class === role) T.SERVICE.old_hand.effects.forEach(e => out.push(fxv(e.type, e.value, e.param, 'Old Hand')));
    else if (et.id !== 'veteran' && et.id !== 'old_hand') {
      const info = T.traitInfo(et.id);
      if (info && info.effects) info.effects.forEach(e => out.push(fxv(e.type, e.value, e.param, info.label)));
    }
  }
  // Gear: stat_bonuses are skill bonuses; item_effects speak EFFECTS.
  const gearSkill = {};
  for (const g of gear || []) {
    const name = g.name || 'Gear';
    for (const [k, v] of Object.entries(g.stat_bonuses || {})) {
      if (!SKILLS.includes(k) || !Number(v)) continue;
      gearSkill[k] = (gearSkill[k] || 0) + Number(v);
      out.push(fxv('skill', Number(v), k, name));
    }
    for (const e of Array.isArray(g.item_effects) ? g.item_effects : []) {
      if (e && M.EFFECTS[e.type]) out.push(fxv(e.type, Number(e.value) || 0, e.param, name));
    }
  }
  // A tool for the job: +3% output per point of the class's skill.
  if (cls && cls.skill && gearSkill[cls.skill] > 0) {
    out.push(fxv('output', Math.min(TOOL_OUTPUT_CAP, Math.min(GEAR_SKILL_CAP, gearSkill[cls.skill]) * TOOL_OUTPUT_PER_POINT), null, 'Tools of the trade'));
  }
  return { list: out, gearSkill };
}

// One citizen. rows: { class_key: class row } for this citizen.
function profileOf(c, rows, gear, now) {
  const cls = CLASSES[c.role] || null;
  const row = cls ? (rows[c.role] || { class_key: c.role, xp: 0, level: 1, spec: null, nodes: {}, hours_worked: 0, counters: {} }) : null;
  const retraining = !!(row && row.retrain_until && Date.parse(row.retrain_until) > (now || 0));
  const effects = [];
  if (cls && row && !retraining) M.nodeEffects(cls.tree, row).forEach(e => effects.push(e));
  const pers = personalEffects(c, cls, row, gear);
  pers.list.forEach(e => effects.push(e));
  // Gear can't push one skill past +5 on its own.
  for (const [k, v] of Object.entries(pers.gearSkill)) {
    if (v > GEAR_SKILL_CAP) effects.push(fxv('skill', GEAR_SKILL_CAP - v, k, 'Gear limit'));
  }
  const totals = M.aggregate(effects);
  const base = c.stats || {};
  const stats = {};
  for (const s of STATS) stats[s] = Math.max(1, Math.min(20, (Number(base[s]) || 0) + M.eff(totals, 'stat', s)));
  const skills = {};
  for (const s of SKILLS) skills[s] = Math.max(1, Math.min(SKILL_CAP, (Number((c.skills || {})[s]) || 1) + M.eff(totals, 'skill', s)));
  return {
    citizenId: c.id, classKey: cls ? c.role : null, cls, row, retraining,
    effects: totals, sources: effects.filter(e => e.value), stats, skills,
    statMult: M.outputMult(stats, cls),
    outputMult: 1, mentor: false, mentorBonus: 0, leaderAura: false, familyTrade: false,
  };
}

// Whole settlement. citizens: living adults (role, stats, skills, traits,
// earned_traits, parent_ids). classRows: all citizen_classes rows.
// gearRows: equipped items with equipped_to. Returns { byId: Map, town }.
function buildProfiles(citizens, classRows, gearRows, opts = {}) {
  const now = opts.now || 0;
  const rowsBy = new Map();
  for (const r of classRows || []) {
    if (!rowsBy.has(r.citizen_id)) rowsBy.set(r.citizen_id, {});
    rowsBy.get(r.citizen_id)[r.class_key] = { ...r, xp: Number(r.xp) || 0, hours_worked: Number(r.hours_worked) || 0 };
  }
  const gearBy = new Map();
  for (const g of gearRows || []) {
    if (!gearBy.has(g.equipped_to)) gearBy.set(g.equipped_to, []);
    gearBy.get(g.equipped_to).push(g);
  }
  const byId = new Map();
  for (const c of citizens) byId.set(c.id, profileOf(c, rowsBy.get(c.id) || {}, gearBy.get(c.id) || [], now));

  // Class auras (capstones): every citizen in the class gets them.
  const aura = {};
  for (const p of byId.values()) if (p.classKey) aura[p.classKey] = (aura[p.classKey] || 0) + M.eff(p.effects, 'aura');
  for (const k of Object.keys(aura)) aura[k] = Math.min(M.EFFECTS.aura.max, aura[k]);

  // Mentors: per class, the highest level (Lv10+) teaches anyone 5+ below.
  const byClass = {};
  for (const c of citizens) { const p = byId.get(c.id); if (p.classKey) (byClass[p.classKey] = byClass[p.classKey] || []).push({ c, p }); }
  const leaderIn = new Set();
  for (const c of citizens) {
    const p = byId.get(c.id);
    if (p.classKey && has(c.revealed_traits, 'natural_leader')) leaderIn.add(p.classKey);
  }
  const levelOf = p => (p.row ? p.row.level : 1);
  for (const [k, members] of Object.entries(byClass)) {
    const sorted = members.slice().sort((a, b) => levelOf(b.p) - levelOf(a.p));
    const top = sorted[0];
    if (top && levelOf(top.p) >= MENTOR_MIN_LEVEL) {
      const pupils = sorted.filter(x => x !== top && levelOf(x.p) <= levelOf(top.p) - MENTOR_GAP).slice(0, MENTOR_MAX_APPRENTICES);
      for (const x of pupils) { x.p.mentor = true; x.p.mentorBonus = M.eff(top.p.effects, 'mentor'); x.p.mentorName = top.c.name; }
      top.p.apprentices = pupils.length;
    }
    if (leaderIn.has(k)) members.forEach(x => { if (!has(x.c.revealed_traits, 'natural_leader')) x.p.leaderAura = true; });
  }
  // Family trade: a parent at Lv10+ in the same class.
  const lvlIn = (cid, k) => { const r = (rowsBy.get(cid) || {})[k]; return r ? r.level : 0; };
  for (const c of citizens) {
    const p = byId.get(c.id);
    if (p.classKey && (c.parent_ids || []).some(pid => lvlIn(Number(pid), p.classKey) >= 10)) p.familyTrade = true;
  }
  for (const c of citizens) {
    const p = byId.get(c.id);
    // Night Workers do a third of their hours in the night phase (01–09 UTC)
    // and get +25% out of those: about +8% on average.
    p.nightBonus = has(c.visible_traits, 'night_worker') ? NIGHT_WORKER_BONUS * NIGHT_SHARE : 0;
    const out = 1 + M.eff(p.effects, 'output') + (p.classKey ? aura[p.classKey] || 0 : 0) + p.nightBonus;
    p.outputMult = Math.max(0, Math.round(p.statMult * out * 1000) / 1000);
  }

  // Settlement-wide numbers.
  const town = { happiness: 0, envoy: 0, market: { fee: 0, carry: 0, travel: 0, max_orders: 0, merchants: 0 }, shops: {} };
  for (const c of citizens) {
    const p = byId.get(c.id);
    town.happiness += M.eff(p.effects, 'happiness');
    town.envoy += M.eff(p.effects, 'envoy');
    if (c.role === 'merchant') {
      const m = town.market;
      m.fee = Math.min(m.fee, M.eff(p.effects, 'fee'));
      m.carry = Math.max(m.carry, M.eff(p.effects, 'carry'));
      m.travel = Math.max(m.travel, M.eff(p.effects, 'travel'));
      m.max_orders = Math.max(m.max_orders, M.eff(p.effects, 'max_orders'));
      m.merchants = Math.max(m.merchants, M.eff(p.effects, 'merchants'));
    }
  }
  town.happiness = Math.min(M.EFFECTS.happiness.max, town.happiness);
  town.envoy = Math.min(M.EFFECTS.envoy.max, town.envoy);
  for (const k of opts.keepers || []) {
    const p = byId.get(k.citizen_id);
    if (p) town.shops[k.venue] = { stall_slots: M.eff(p.effects, 'stall_slots'), fee: M.eff(p.effects, 'fee'), citizen_id: k.citizen_id };
  }
  return { byId, town, aura };
}

// Production per citizen. buildings: [{ type, level }]; citizens: rows with
// role and optional `profile` (no profile = ×1, today's numbers exactly).
// Returns { perCitizen: Map(id → { res: amount }), byRole, crew, seasonal }.
const FISHING_POST_BONUS = [0, 0.10, 0.20, 0.35, 0.50, 0.70];
const FORAGER_HUT_BONUS = 0.25;
function citizenContributions(buildings, citizens, BUILDINGS) {
  const lvl = t => (buildings || []).filter(b => b.type === t).reduce((m, b) => Math.max(m, Number(b.level) || 0), 0);
  const fishingBonus = FISHING_POST_BONUS[Math.min(lvl('fishing_post'), 5)] || 0;
  const hutBonus = lvl('forager_hut') * FORAGER_HUT_BONUS;
  const perCitizen = new Map(), byRole = new Map(), seasonal = {}, crew = {};
  const crewSeats = {};
  for (const c of citizens || []) {
    const cls = CLASSES[c.role];
    const base = (cls && cls.base) || LEGACY_BONUS[c.role] || {};
    const mult = c.profile ? c.profile.outputMult : 1;
    const out = {};
    for (const [res, val] of Object.entries(base)) {
      let v = val;
      if (c.role === 'fisher' && res === 'food' && fishingBonus > 0) v = Math.round(val * (1 + fishingBonus));
      if (c.role === 'forager' && hutBonus > 0) v = v * (1 + hutBonus);
      out[res] = Math.round(v * mult * 100) / 100;
      // Season know-how (Weather-Wise…): extra in that season, on top.
      if (c.profile) {
        for (const [k, bonus] of Object.entries(c.profile.effects)) {
          if (!k.startsWith('season:') || !bonus) continue;
          const season = k.slice(7);
          seasonal[season] = seasonal[season] || {};
          seasonal[season][res] = (seasonal[season][res] || 0) + v * bonus;
        }
      }
    }
    perCitizen.set(c.id, out);
    if (!byRole.has(c.role)) byRole.set(c.role, []);
    byRole.get(c.role).push(c);
    // Crew share: a better worker gets more from the building itself.
    if (cls && cls.crew && c.profile && BUILDINGS && BUILDINGS[cls.crew]) {
      (crewSeats[cls.crew] = crewSeats[cls.crew] || []).push({ c, m: c.profile.outputMult });
    }
  }
  for (const [type, seats] of Object.entries(crewSeats)) {
    const level = lvl(type);
    if (!level) continue;
    const def = BUILDINGS[type];
    const slots = Math.max(1, def.citizenSlots(level));
    const eff = def.effect(level);
    seats.sort((a, b) => b.m - a.m).slice(0, slots).forEach(({ c, m }) => {
      for (const [res, val] of Object.entries(eff)) {
        if (typeof val !== 'number') continue;
        const extra = (val / slots) * (m - 1);
        if (!extra) continue;
        crew[res] = (crew[res] || 0) + extra;
        const pc = perCitizen.get(c.id);
        pc['crew_' + res] = (pc['crew_' + res] || 0) + extra;
      }
    });
  }
  for (const res of Object.keys(crew)) crew[res] = Math.round(crew[res] * 100) / 100;
  return { perCitizen, byRole, seasonal, crew, fishingBonus, hutBonus };
}
const NIGHT_WORKER_BONUS = 0.25;
const NIGHT_SHARE = 8 / 24;   // the night phase, 01:00–09:00 UTC (career_math nightHours)

// Roles that produce without being a class (none today; kept for safety).
const LEGACY_BONUS = {};

module.exports = {
  STATS, SKILLS, SKILL_CAP, GEAR_SKILL_CAP, MENTOR_MIN_LEVEL, MENTOR_GAP,
  FISHING_POST_BONUS, FORAGER_HUT_BONUS, NIGHT_WORKER_BONUS, NIGHT_SHARE,
  personalEffects, profileOf, buildProfiles, citizenContributions,
};
