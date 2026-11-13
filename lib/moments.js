// ══════════════════════════════════════════════════════════════════════════
//  Moments — one decision system for everything (docs/PHASE_2_MOMENTS.md).
//
//  A small situation about named citizens (or an outpost, a village), with
//  two or three options and a default that happens by itself. Every outcome
//  writes a chronicle line.
//
//    register(kind, def)              add a kind (see DEF below)
//    roll(settlementId, now?)         the daily budget: maybe start one
//    trigger(settlementId, kind, ctx) start one now (a death, a season, a
//                                     raid…): skips the budget, not the cap;
//                                     at the cap the default happens at once
//    start(settlementId, kind, ctx)   start one if eligible (Dev Tools too)
//    choose(sid, id, choice, auto?)   answer one (or the default on expiry)
//    open(sid, filter?) / recent(sid) / present(row)
//    tick()                           worker: expire due ones, roll for towns
//    stats()                          per kind: shown, answered, timed out, choices
//
//  DEF = { source, icon, title, weight, cooldownDays, expireHours, gentle?,
//          eligible: async ctx → { subject, data } | null,
//          text: d → string, options: d → [{ key, label, hint, risk }],
//          fallback, choose: async (key, x) → { outcome, chronicle?, error? } }
//  ctx = { sid, q, rng, now, settlement }; x = { q, sid, subject, d, rng }.
//  `risk` (0 nothing lost … 3 heavy) lets the content check confirm the
//  default is never the worst option.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, withTransaction } = require('../db');

const CONFIG = {
  PER_DAY: 3,               // rolled moments per town per day …
  SPACING_HOURS: 6,         // … at least this far apart
  CAP: 4,                   // never more open at once
  FIRST_WITHIN_MIN: 10,     // a new town's first moment …
  FIRST_AFTER_MIN: 5,       // … comes this long after its first check
  TICK_EVERY_MS: 5 * 60 * 1000,
  ROLL_BATCH: 300,
};

const DEFS = {};
function register(kind, def) {
  DEFS[kind] = Object.assign({ weight: 1, cooldownDays: 3, expireHours: 24, source: 'other' }, def, { kind });
  return DEFS[kind];
}

const subjOf = r => (r && r.subject && typeof r.subject === 'object' ? r.subject : {});

function present(r) {
  const k = DEFS[r.kind];
  if (!k) return null;
  const d = r.data || {};
  let text = '', options = [];
  try { text = k.text(d); options = k.options(d); } catch (e) { return null; }
  return {
    id: r.id, kind: r.kind, source: k.source, icon: k.icon, title: k.title, text,
    speaker: d.speaker || (d.outpost_name ? `Your crew at the ${d.outpost_name}` : null),
    options: options.map(o => ({ key: o.key, label: o.label, hint: o.hint || '' })),
    fallback: k.fallback, subject: subjOf(r), created_at: r.created_at, expires_at: r.expires_at,
    resolved_at: r.resolved_at || null, choice: r.choice || null, outcome: r.outcome || null, auto: !!r.auto,
  };
}

async function openRows(sid, q = query) {
  return (await q(`SELECT * FROM moments WHERE settlement_id = $1 AND resolved_at IS NULL ORDER BY expires_at ASC, id ASC`, [sid])).rows;
}
async function open(sid, filter = null) {
  const rows = await openRows(sid).catch(() => []);
  return rows.filter(r => !filter || filter(r)).map(present).filter(Boolean);
}
async function recent(sid, limit = 20) {
  const r = await query(`SELECT * FROM moments WHERE settlement_id = $1 AND resolved_at IS NOT NULL ORDER BY resolved_at DESC, id DESC LIMIT $2`, [sid, limit]).catch(() => ({ rows: [] }));
  return r.rows.map(present).filter(Boolean);
}

// ── Starting ───────────────────────────────────────────────────────────────
// Insert one, if the kind is eligible now. Returns the presented moment or
// null. `ctx.force` (Dev Tools) skips the cap; nothing skips eligibility.
async function start(sid, kind, ctx = {}) {
  const def = DEFS[kind];
  if (!def) return null;
  const rng = ctx.rng || Math.random;
  const settlement = ctx.settlement || (await query('SELECT * FROM settlements WHERE id = $1', [sid])).rows[0];
  if (!settlement) return null;
  const got = await def.eligible({ sid, q: query, rng, now: ctx.now || Date.now(), settlement, ...(ctx.args || {}) });
  if (!got) return null;
  const r = await query(
    `INSERT INTO moments (settlement_id, kind, subject, data, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5)) RETURNING *`,
    [sid, kind, JSON.stringify(got.subject || {}), JSON.stringify(got.data || {}), def.expireHours]);
  const m = present(r.rows[0]);
  try { require('./event_bus').publish(sid, { type: 'moment', moment: m }); } catch (e) { /* no stream */ }
  // Outpost moments keep the outpost window's live event (js/outposts.js).
  if (def.source === 'outpost' && m) {
    try { require('./event_bus').publish(sid, { type: 'outpost_event', event: { ...m, outpost_id: m.subject.outpost_id }, outpost_name: (r.rows[0].data || {}).outpost_name }); } catch (e) { /* none */ }
  }
  return m;
}

// A triggered moment (a death, a season turning, a raid warning…): skips
// the budget but not the cap. At the cap the default happens at once and the
// chronicle says so.
async function trigger(sid, kind, args = {}) {
  const openNow = (await openRows(sid).catch(() => [])).length;
  const m = await start(sid, kind, { args });
  if (!m) return null;
  if (openNow >= CONFIG.CAP) {
    const res = await choose(sid, m.id, DEFS[kind].fallback, true, { capped: true });
    return { ...m, resolved: true, outcome: res && res.outcome };
  }
  return m;
}

// An event offers a moment (a quest came home, a battle was won): it keeps
// to the daily budget, the cap, the kind's cooldown and never the same kind
// twice running, but not the spacing (the event happened now). Returns the
// moment, or null when it doesn't fit.
async function offer(sid, kind, args = {}, now = Date.now()) {
  const def = DEFS[kind];
  if (!def) return null;
  const rows = (await query(`SELECT kind, created_at, resolved_at FROM moments WHERE settlement_id = $1 AND created_at > NOW() - interval '60 days' ORDER BY created_at DESC`, [sid])).rows;
  if (rows.filter(r => !r.resolved_at).length >= CONFIG.CAP) return null;
  if (rows.filter(r => now - new Date(r.created_at).getTime() < 24 * 3600e3).length >= CONFIG.PER_DAY) return null;
  if (rows[0] && rows[0].kind === kind) return null;
  const last = rows.find(r => r.kind === kind);
  if (last && now - new Date(last.created_at).getTime() < (def.cooldownDays || 0) * 24 * 3600e3) return null;
  return start(sid, kind, { args });
}

// ── The budget ─────────────────────────────────────────────────────────────
// About PER_DAY a day, SPACING_HOURS apart, never more than CAP open, each
// kind off its cooldown and never the same kind twice running. A new town's
// first moment comes within FIRST_WITHIN_MIN minutes and is a gentle one.
async function roll(sid, now = Date.now(), rng = Math.random) {
  const settlement = (await query('SELECT * FROM settlements WHERE id = $1', [sid])).rows[0];
  if (!settlement || settlement.tile_q == null) return null;
  const rows = (await query(`SELECT kind, created_at, resolved_at FROM moments WHERE settlement_id = $1 AND created_at > NOW() - interval '60 days' ORDER BY created_at DESC`, [sid])).rows;
  const openNow = rows.filter(r => !r.resolved_at).length;
  if (openNow >= CONFIG.CAP) return null;
  const day = rows.filter(r => now - new Date(r.created_at).getTime() < 24 * 3600e3).length;
  if (day >= CONFIG.PER_DAY) return null;
  const first = rows.length === 0;
  if (!first && now - new Date(rows[0].created_at).getTime() < CONFIG.SPACING_HOURS * 3600e3) return null;
  // A town's first check starts a clock; its first moment comes FIRST_AFTER_MIN
  // later (so within FIRST_WITHIN_MIN, the worker ticking every 5 minutes).
  if (first) {
    if (!settlement.moments_seen_at) {
      await query('UPDATE settlements SET moments_seen_at = NOW() WHERE id = $1 AND moments_seen_at IS NULL', [sid]);
      return null;
    }
    if (now - new Date(settlement.moments_seen_at).getTime() < CONFIG.FIRST_AFTER_MIN * 60e3) return null;
  }
  const lastKind = rows[0] ? rows[0].kind : null;
  const lastOf = k => { const r = rows.find(x => x.kind === k); return r ? new Date(r.created_at).getTime() : null; };
  const candidates = Object.values(DEFS).filter(d => d.weight > 0 && !d.triggerOnly && (!first || d.gentle !== false) && d.kind !== lastKind
    && (lastOf(d.kind) == null || now - lastOf(d.kind) >= d.cooldownDays * 24 * 3600e3));
  // Gentle kinds first for a new town, if any fit.
  const pool = first && candidates.some(d => d.gentle) ? candidates.filter(d => d.gentle) : candidates;
  // Try in weighted order until one is eligible.
  const bag = pool.slice();
  while (bag.length) {
    const total = bag.reduce((a, d) => a + d.weight, 0);
    let u = rng() * total, i = 0;
    while (i < bag.length - 1 && (u -= bag[i].weight) >= 0) i++;
    const d = bag.splice(i, 1)[0];
    const m = await start(sid, d.kind, { settlement, rng });
    if (m) return m;
  }
  return null;
}

// ── Choosing ───────────────────────────────────────────────────────────────
async function choose(sid, id, choice, auto = false, opts = {}) {
  const result = await withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const r = (await q('SELECT * FROM moments WHERE id = $1 AND settlement_id = $2 AND resolved_at IS NULL FOR UPDATE', [id, sid])).rows[0];
    if (!r) return { status: 404, error: 'That has already been settled.' };
    const def = DEFS[r.kind];
    if (!def) return { status: 400, error: 'Unknown moment.' };
    const keys = def.options(r.data || {}).map(o => o.key);
    if (!keys.includes(choice)) return { status: 400, error: 'Not one of the choices.' };
    const x = { q, sid, subject: subjOf(r), d: r.data || {}, rng: Math.random, client };
    let res = await def.choose(choice, x);
    if (res && res.error && auto) {
      for (const k of [def.fallback, ...keys.filter(k => k !== def.fallback)]) {
        if (k === choice) continue;
        res = await def.choose(k, x);
        choice = k;
        if (res && !res.error) break;
      }
    }
    if (!res || res.error) return { status: 400, error: (res && res.error) || 'That could not be done.' };
    await q('UPDATE moments SET resolved_at = NOW(), choice = $2, outcome = $3, auto = $4 WHERE id = $1', [r.id, choice, res.outcome, !!auto]);
    const prefix = auto ? (opts.capped ? 'Too much was waiting, so the default was taken: ' : 'Nobody sent word, so: ') : '';
    if (res.chronicle !== false) {
      await require('./chronicle').write(sid, { kind: 'moment', text: prefix + (res.chronicle || `${def.title}: ${res.outcome}`),
        citizenIds: subjOf(r).citizen_ids || [], familyId: subjOf(r).family_id || null }, q);
    }
    if (auto) await q(`INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1, 'moment_auto', $2)`, [sid, `${def.icon} ${def.title}: ${prefix}${res.outcome}`]);
    return { ok: true, id: r.id, kind: r.kind, choice, outcome: res.outcome, auto: !!auto, joined: res.joined || null, effects: res.effects || null };
  });
  if (result && result.ok) {
    if (auto) { try { require('./event_bus').publish(sid, { type: 'moment_resolved', id: result.id, kind: result.kind, outcome: result.outcome }); } catch (e) { /* none */ } }
    else require('./milestones').town(sid, 'first_moment').catch(() => {});
  }
  return result;
}

// ── Worker ─────────────────────────────────────────────────────────────────
let _last = 0;
async function tick(force = false) {
  if (!force && Date.now() - _last < CONFIG.TICK_EVERY_MS) return;
  _last = Date.now();
  try {
    const due = (await query(`SELECT id, settlement_id, kind FROM moments WHERE resolved_at IS NULL AND expires_at <= NOW() ORDER BY expires_at LIMIT 200`)).rows;
    for (const m of due) await choose(m.settlement_id, m.id, (DEFS[m.kind] || {}).fallback, true).catch(e => console.error('[moments] expire', e.message));
    const towns = (await query(`SELECT id FROM settlements WHERE tile_q IS NOT NULL ORDER BY id LIMIT $1`, [CONFIG.ROLL_BATCH])).rows;
    for (const t of towns) await roll(t.id).catch(e => console.error('[moments] roll', e.message));
  } catch (e) {
    if (!(e && (e.code === '42P01' || e.code === '42703'))) console.error('[moments] tick', e.message);
  }
}

// Per kind: shown, answered, timed out, and how often each option was chosen
// (docs/PHASE_2_MOMENTS.md §8: one option over 85% means no real trade-off).
async function stats(days = 30) {
  const rows = (await query(
    `SELECT kind, choice, auto, resolved_at IS NOT NULL AS done FROM moments WHERE created_at > NOW() - make_interval(days => $1)`, [days])).rows;
  const out = {};
  for (const r of rows) {
    const k = out[r.kind] || (out[r.kind] = { kind: r.kind, title: (DEFS[r.kind] || {}).title || r.kind, shown: 0, answered: 0, timed_out: 0, open: 0, choices: {} });
    k.shown++;
    if (!r.done) k.open++;
    else if (r.auto) k.timed_out++;
    else { k.answered++; k.choices[r.choice] = (k.choices[r.choice] || 0) + 1; }
  }
  for (const k of Object.values(out)) {
    const top = Object.values(k.choices).reduce((m, n) => Math.max(m, n), 0);
    k.one_sided = k.answered >= 10 && top / k.answered > 0.85;
  }
  return Object.values(out).sort((a, b) => b.shown - a.shown);
}

// Content check (docs/PHASE_2_MOMENTS.md §4, §7): every option has a hint;
// the default is one of the options and never the single worst.
function check(kind, sampleData) {
  const d = DEFS[kind];
  const problems = [];
  const opts = d.options(sampleData || {});
  if (!opts.length) problems.push('no options');
  if (!opts.some(o => o.key === d.fallback)) problems.push(`default "${d.fallback}" is not an option`);
  opts.forEach(o => { if (!o.hint) problems.push(`option "${o.key}" has no hint`); });
  const f = opts.find(o => o.key === d.fallback);
  const others = opts.filter(o => o !== f);
  if (f && others.length && others.every(o => (Number(o.risk) || 0) < (Number(f.risk) || 0))) problems.push('the default is the worst option');
  return problems;
}

module.exports = { CONFIG, DEFS, register, start, trigger, offer, roll, choose, open, recent, present, tick, stats, check };

// The kinds. Outpost ones first (the seven from R6c, kept); the rest arrive
// with Phase 2 steps 3–5.
require('./moments_outpost');
require('./moments_family');
require('./moments_year');
require('./moments_quest');
require('./moments_village');
require('./moments_raid');
