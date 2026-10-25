// ══════════════════════════════════════════════════════════════════════════
//  research — the Library: Scholars earn research points for the town's
//  project (lib/research_defs.js holds the tree).
//
//  Points per hour: each seated Scholar (Library level = seats) earns
//  BASE_PER_HOUR × their output multiplier (stats) × (1 + `research` perks
//  + `research:<field>` perks for the active project's field), and the
//  whole Library ×(1 + 10% per level above 1).
//  Points flow into the active project; with nothing to study they bank
//  (up to BANK_CAP) and go into the next project chosen. A finished project
//  unlocks its resources, buildings, recipes (the town learns them) and
//  town-wide effects, and writes a settlement event.
//
//    doneSet(db, sid)             Set of finished project keys
//    settle(sid)                  credit points since the last settle
//    view(sid)                    the Library panel's state
//    start(sid, project)          choose what to study (keeps progress)
//    adminComplete(sid, project)  Dev Tools: finish it now
//    adminReset(sid)              Dev Tools: forget all research
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query: pool, withTransaction } = require('../db');
const RS = require('./research_defs');

const BASE_PER_HOUR = 2;
const BANK_CAP = 100;
const LEVEL_BONUS = 0.1;
const SETTLE_GATE_MS = 60 * 1000;

const q = (db, sql, params) => (db && db.query ? db.query(sql, params) : pool(sql, params));
const r1 = v => Math.round(v * 10) / 10;

class ResearchError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function doneSet(db, sid) {
  const r = await q(db, 'SELECT project FROM settlement_research WHERE settlement_id=$1 AND done_at IS NOT NULL', [sid])
    .catch(() => ({ rows: [] }));
  return new Set(r.rows.map(x => x.project));
}

async function libraryLevel(db, sid) {
  const r = await q(db, "SELECT COALESCE(MAX(level), 0)::int AS l FROM buildings WHERE settlement_id=$1 AND type='library'", [sid]);
  return r.rows[0].l;
}

// Seated scholars and the points per hour each earns on `project`.
async function scholarsOf(sid, project) {
  const level = await libraryLevel(null, sid);
  if (!level) return { level, seats: 0, scholars: [], perHour: 0 };
  const { BUILDINGS } = require('../buildings');
  const seats = BUILDINGS.library.citizenSlots(level);
  const wf = await require('./careers').loadWorkforce(null, sid);
  const field = project && RS.project(project) ? RS.project(project).field : null;
  const scholars = wf.filter(c => c.role === 'scholar')
    .map(c => {
      const fx = (c.profile && c.profile.effects) || {};
      const mult = c.profile ? c.profile.outputMult : 1;
      const perk = (fx.research || 0) + (field ? fx['research:' + field] || 0 : 0);
      return { id: c.id, name: c.name, perHour: BASE_PER_HOUR * mult * (1 + perk) };
    })
    .sort((a, b) => b.perHour - a.perHour).slice(0, seats);
  // Library level, research that speeds research (Scriptorium, Academy),
  // and the Dev Tools multiplier (lib/tuning.js).
  const study = RS.effectsOf(await doneSet(null, sid)).research || 0;
  const lib = (1 + LEVEL_BONUS * (level - 1)) * (1 + study) * require('./tuning').T('research');
  for (const s of scholars) s.perHour = r1(s.perHour * lib);
  return { level, seats, scholars, perHour: r1(scholars.reduce((a, s) => a + s.perHour, 0)) };
}

// Finish a project inside a transaction: unlocks + event. → true when new.
async function completeIn(client, sid, key, events) {
  const p = RS.project(key);
  const prev = (await client.query('SELECT done_at FROM settlement_research WHERE settlement_id=$1 AND project=$2', [sid, key])).rows[0];
  if (prev && prev.done_at) return false;
  await client.query(
    `INSERT INTO settlement_research (settlement_id, project, progress, done_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (settlement_id, project) DO UPDATE SET progress = $3, done_at = NOW()`, [sid, key, p.cost]);
  const crafting = require('./crafting');
  const learned = [];
  for (const rk of p.recipes || []) if (await crafting.learnRecipe(client, sid, rk, 'research')) learned.push(rk);
  await client.query('INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
    [sid, 'research', `📚 Your scholars finished ${p.label}! ${p.desc}`, '[]']);
  events.push({ type: 'research_done', project: key, label: p.label, icon: p.icon, desc: p.desc, recipes: learned });
  return true;
}

// Credit points since research_settled_at. Inside its own transaction;
// returns events (also published).
async function settle(sid, { force = false, now = Date.now() } = {}) {
  const events = [];
  await withTransaction(async client => {
    const s = (await client.query('SELECT research_active, research_bank, research_settled_at FROM settlements WHERE id=$1 FOR UPDATE', [sid])).rows[0];
    if (!s) return;
    const last = s.research_settled_at ? Date.parse(s.research_settled_at) : null;
    if (last && !force && now - last < SETTLE_GATE_MS) return;
    await client.query('UPDATE settlements SET research_settled_at = $2 WHERE id=$1', [sid, new Date(now)]);
    if (!last) return;   // first visit starts the clock
    const hours = Math.max(0, (now - last) / 3600000);
    const { perHour } = await scholarsOf(sid, s.research_active);
    let pts = hours * perHour;
    if (!(pts > 0)) return;
    const done = await doneSet(client, sid);
    let active = s.research_active && RS.project(s.research_active) && !done.has(s.research_active) ? s.research_active : null;
    let bank = Number(s.research_bank) || 0;
    if (active) {
      const row = (await client.query('SELECT progress FROM settlement_research WHERE settlement_id=$1 AND project=$2 FOR UPDATE', [sid, active])).rows[0];
      const progress = (row ? Number(row.progress) : 0) + pts;
      const cost = RS.project(active).cost;
      if (progress >= cost) {
        await completeIn(client, sid, active, events);
        bank = Math.min(BANK_CAP, bank + (progress - cost));
        active = null;
      } else {
        await client.query(`INSERT INTO settlement_research (settlement_id, project, progress) VALUES ($1,$2,$3)
                            ON CONFLICT (settlement_id, project) DO UPDATE SET progress = $3`, [sid, active, progress]);
      }
    } else bank = Math.min(BANK_CAP, bank + pts);
    await client.query('UPDATE settlements SET research_active = $2, research_bank = $3 WHERE id=$1', [sid, active, bank]);
  });
  if (events.length) require('./event_bus').publish(sid, events.length === 1 ? events[0] : { type: 'research_done', many: events });
  return events;
}

async function view(sid) {
  await settle(sid).catch(e => console.error('[research] settle failed:', e.message));
  const s = (await q(null, 'SELECT research_active, research_bank FROM settlements WHERE id=$1', [sid])).rows[0] || {};
  const rows = (await q(null, 'SELECT project, progress, done_at FROM settlement_research WHERE settlement_id=$1', [sid])).rows;
  const by = Object.fromEntries(rows.map(r => [r.project, r]));
  const done = new Set(rows.filter(r => r.done_at).map(r => r.project));
  const sch = await scholarsOf(sid, s.research_active);
  const projects = RS.KEYS.map(k => {
    const p = RS.project(k), row = by[k];
    const progress = row ? Math.min(p.cost, Number(row.progress)) : 0;
    const status = done.has(k) ? 'done' : s.research_active === k ? 'active' : RS.blockedBy(k, done) ? 'locked' : 'open';
    return { key: k, label: p.label, icon: p.icon, field: p.field, branch: p.branch, tier: p.tier, slot: p.slot || 0,
      cost: p.cost, desc: p.desc, requires: p.requires,
      unlocks: { resources: p.resources || [], buildings: p.buildings || [], recipes: p.recipes || [], effects: p.effects || {} },
      progress: r1(progress), status, blocked: status === 'locked' ? RS.blockedBy(k, done) : null,
      done_at: row && row.done_at ? row.done_at : null };
  });
  const active = projects.find(p => p.status === 'active') || null;
  const left = active ? active.cost - active.progress : 0;
  return {
    library_level: sch.level, seats: sch.seats, scholars: sch.scholars, per_hour: sch.perHour,
    bank: r1(Number(s.research_bank) || 0), bank_cap: BANK_CAP,
    active: active ? active.key : null,
    eta_hours: active && sch.perHour > 0 ? Math.round(left / sch.perHour * 10) / 10 : null,
    projects, effects: RS.effectsOf(done), branches: RS.BRANCHES, eras: RS.ERAS,
  };
}

async function start(sid, key) {
  if (!RS.project(key)) throw new ResearchError(400, 'Unknown project.');
  const events = [];
  await settle(sid, { force: true });
  await withTransaction(async client => {
    const s = (await client.query('SELECT research_bank FROM settlements WHERE id=$1 FOR UPDATE', [sid])).rows[0];
    if (!s) throw new ResearchError(404, 'No settlement.');
    if (!(await libraryLevel(client, sid))) throw new ResearchError(400, 'Build a Library first.');
    const why = RS.blockedBy(key, await doneSet(client, sid));
    if (why) throw new ResearchError(400, why);
    // Banked points go straight in.
    const row = (await client.query('SELECT progress FROM settlement_research WHERE settlement_id=$1 AND project=$2 FOR UPDATE', [sid, key])).rows[0];
    const progress = (row ? Number(row.progress) : 0) + (Number(s.research_bank) || 0);
    const cost = RS.project(key).cost;
    if (progress >= cost) {
      await completeIn(client, sid, key, events);
      await client.query('UPDATE settlements SET research_active = NULL, research_bank = $2 WHERE id=$1', [sid, Math.min(BANK_CAP, progress - cost)]);
    } else {
      await client.query(`INSERT INTO settlement_research (settlement_id, project, progress) VALUES ($1,$2,$3)
                          ON CONFLICT (settlement_id, project) DO UPDATE SET progress = $3`, [sid, key, progress]);
      await client.query('UPDATE settlements SET research_active = $2, research_bank = 0 WHERE id=$1', [sid, key]);
    }
  });
  if (events.length) require('./event_bus').publish(sid, events[0]);
  return view(sid);
}

async function adminComplete(sid, key) {
  if (!RS.project(key)) throw new ResearchError(400, 'Unknown project.');
  const events = [];
  await withTransaction(async client => {
    await completeIn(client, sid, key, events);
    await client.query('UPDATE settlements SET research_active = NULL WHERE id=$1 AND research_active = $2', [sid, key]);
  });
  if (events.length) require('./event_bus').publish(sid, events[0]);
  return view(sid);
}

async function adminReset(sid) {
  await q(null, 'DELETE FROM settlement_research WHERE settlement_id=$1', [sid]);
  await q(null, 'UPDATE settlements SET research_active = NULL, research_bank = 0 WHERE id=$1', [sid]);
  return view(sid);
}

module.exports = { BASE_PER_HOUR, BANK_CAP, LEVEL_BONUS, ResearchError, doneSet, scholarsOf, settle, view, start, adminComplete, adminReset };
