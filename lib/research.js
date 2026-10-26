// ══════════════════════════════════════════════════════════════════════════
//  research — the Library: Scholars earn research points for the town's
//  project (lib/research_defs.js holds the tree).
//
//  Points per hour: each seated Scholar (Library level = seats) earns
//  BASE_PER_HOUR × their output multiplier (stats) × (1 + `research` perks
//  + `research:<field>` perks for the active project's field), and the
//  whole Library ×(1 + 10% per level above 1).
//  Points flow into the active project, then down the town's queue (up to
//  QUEUE_MAX); with nothing left to study they bank (up to BANK_CAP, more
//  with Quills & Ink / Archives) for the next project. Projects more than
//  HIDE_BEYOND steps from what the town knows are sent as ?? (no name, cost
//  or unlocks) and can't be studied or queued. A finished project
//  unlocks its resources, buildings, recipes (the town learns them) and
//  town-wide effects, and writes a settlement event.
//
//    doneSet(db, sid)             Set of finished project keys
//    settle(sid)                  credit points since the last settle
//    view(sid)                    the Library panel's state
//    start(sid, project)          study it now (the old one goes back to the queue)
//    queueAdd(sid, project)       plan it (and its missing prerequisites) next
//    queueRemove(sid, project)    drop it (and what needed it) from the plan
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

const QUEUE_MAX = 10;
const bankCap = done => BANK_CAP + (RS.effectsOf(done).bank || 0);
const arr = v => (Array.isArray(v) ? v : []);

// Pour `pts` research points into the active project, then on down the
// queue: each finished project starts the next valid entry with what's left
// (several can finish in one long catch-up). With nothing left to study the
// rest banks. st: { active, queue, bank, done } — updated in place.
async function pour(client, sid, st, pts, events) {
  for (let guard = 0; guard < 64; guard++) {
    if (!st.active) {
      // Next valid entry; anything finished or no longer studyable drops out.
      while (st.queue.length && !st.active) {
        const k = st.queue.shift();
        if (RS.project(k) && !st.done.has(k) && !RS.blockedBy(k, st.done)) st.active = k;
      }
      if (!st.active) { st.bank = Math.min(bankCap(st.done), st.bank + pts); return st; }
    }
    if (!(pts > 0)) return st;
    const row = (await client.query('SELECT progress FROM settlement_research WHERE settlement_id=$1 AND project=$2 FOR UPDATE', [sid, st.active])).rows[0];
    const progress = (row ? Number(row.progress) : 0) + pts;
    const cost = RS.project(st.active).cost;
    if (progress < cost) {
      await client.query(`INSERT INTO settlement_research (settlement_id, project, progress) VALUES ($1,$2,$3)
                          ON CONFLICT (settlement_id, project) DO UPDATE SET progress = $3`, [sid, st.active, progress]);
      return st;
    }
    await completeIn(client, sid, st.active, events);
    st.done.add(st.active);
    st.active = null;
    pts = progress - cost;
  }
  return st;
}

async function loadState(client, sid) {
  const s = (await client.query('SELECT research_active, research_bank, research_settled_at, research_queue FROM settlements WHERE id=$1 FOR UPDATE', [sid])).rows[0];
  if (!s) throw new ResearchError(404, 'No settlement.');
  const done = await doneSet(client, sid);
  return { row: s, st: {
    active: s.research_active && RS.project(s.research_active) && !done.has(s.research_active) ? s.research_active : null,
    queue: arr(s.research_queue).filter(k => RS.project(k)), bank: Number(s.research_bank) || 0, done } };
}
async function saveState(client, sid, st) {
  await client.query('UPDATE settlements SET research_active = $2, research_bank = $3, research_queue = $4 WHERE id=$1',
    [sid, st.active, st.bank, JSON.stringify(st.queue)]);
}
const publishEvents = (sid, events) => {
  if (events.length) require('./event_bus').publish(sid, events.length === 1 ? events[0] : { type: 'research_done', many: events });
};

// Credit points since research_settled_at. Inside its own transaction;
// returns events (also published).
async function settle(sid, { force = false, now = Date.now() } = {}) {
  const events = [];
  await withTransaction(async client => {
    const { row, st } = await loadState(client, sid).catch(() => ({}));
    if (!row) return;
    const last = row.research_settled_at ? Date.parse(row.research_settled_at) : null;
    if (last && !force && now - last < SETTLE_GATE_MS) return;
    await client.query('UPDATE settlements SET research_settled_at = $2 WHERE id=$1', [sid, new Date(now)]);
    if (!last) return;   // first visit starts the clock
    const hours = Math.max(0, (now - last) / 3600000);
    const { perHour } = await scholarsOf(sid, st.active);
    const pts = hours * perHour;
    if (!(pts > 0)) return;
    await pour(client, sid, st, pts, events);
    await saveState(client, sid, st);
  });
  publishEvents(sid, events);
  return events;
}

// A project the town can't see yet (more than HIDE_BEYOND steps away).
function isHidden(key, dist) { return dist[key] > RS.HIDE_BEYOND; }

async function view(sid) {
  await settle(sid).catch(e => console.error('[research] settle failed:', e.message));
  const s = (await q(null, 'SELECT research_active, research_bank, research_queue FROM settlements WHERE id=$1', [sid])).rows[0] || {};
  const rows = (await q(null, 'SELECT project, progress, done_at FROM settlement_research WHERE settlement_id=$1', [sid])).rows;
  const by = Object.fromEntries(rows.map(r => [r.project, r]));
  const done = new Set(rows.filter(r => r.done_at).map(r => r.project));
  const dist = RS.distances(done);
  const queue = arr(s.research_queue).filter(k => RS.project(k) && !done.has(k));
  const planned = new Set([s.research_active, ...queue].filter(Boolean));
  // Distant projects travel as ?? — an opaque id, where they sit, their
  // arrows; never their name, cost or what they unlock.
  const idOf = {};
  RS.KEYS.forEach((k, i) => { idOf[k] = isHidden(k, dist) ? 'unknown_' + i : k; });
  const sch = await scholarsOf(sid, s.research_active);
  const projects = RS.KEYS.map(k => {
    const p = RS.project(k), row = by[k];
    const base = { key: idOf[k], branch: p.branch, tier: p.tier, slot: p.slot || 0, requires: p.requires.map(r => idOf[r]) };
    if (isHidden(k, dist)) return { ...base, hidden: true, status: 'hidden', label: '??', icon: '❔', distance: dist[k] };
    const progress = row ? Math.min(p.cost, Number(row.progress)) : 0;
    const status = done.has(k) ? 'done' : s.research_active === k ? 'active' : RS.blockedBy(k, done) ? 'locked' : 'open';
    const qi = queue.indexOf(k);
    return { ...base, label: p.label, icon: p.icon, field: p.field, cost: p.cost, desc: p.desc, distance: dist[k],
      unlocks: { resources: p.resources || [], buildings: p.buildings || [], recipes: p.recipes || [], effects: p.effects || {} },
      progress: r1(progress), status, blocked: status === 'locked' ? RS.blockedBy(k, done) : null,
      queued: qi >= 0 ? qi + 1 : null,
      // Queueing it also queues what it still needs (shown as "adds N first").
      queue_adds: status === 'done' ? 0 : RS.pathTo(k, done).filter(x => x !== k && !planned.has(x)).length,
      done_at: row && row.done_at ? row.done_at : null };
  });
  const active = projects.find(p => p.status === 'active') || null;
  const left = active ? active.cost - active.progress : 0;
  return {
    library_level: sch.level, seats: sch.seats, scholars: sch.scholars, per_hour: sch.perHour,
    bank: r1(Number(s.research_bank) || 0), bank_cap: bankCap(done),
    active: active ? active.key : null, queue, queue_max: QUEUE_MAX,
    eta_hours: active && sch.perHour > 0 ? Math.round(left / sch.perHour * 10) / 10 : null,
    projects, effects: RS.effectsOf(done), branches: RS.BRANCHES, eras: RS.ERAS, hide_beyond: RS.HIDE_BEYOND,
  };
}

// Shared checks for study / queue: a Library, a real project the town can see.
async function checkStudyable(client, sid, key, done) {
  if (!RS.project(key)) throw new ResearchError(400, 'Unknown project.');
  if (!(await libraryLevel(client, sid))) throw new ResearchError(400, 'Build a Library first.');
  if (done.has(key)) throw new ResearchError(400, 'Already studied.');
  if (isHidden(key, RS.distances(done))) throw new ResearchError(400, 'You don\'t understand that yet — research more of what leads to it.');
}

// Study now: it becomes the active project; whatever was active goes back to
// the front of the queue (progress kept). Banked points go straight in.
async function start(sid, key) {
  const events = [];
  await settle(sid, { force: true });
  await withTransaction(async client => {
    const { st } = await loadState(client, sid);
    await checkStudyable(client, sid, key, st.done);
    const why = RS.blockedBy(key, st.done);
    if (why) throw new ResearchError(400, why);
    st.queue = st.queue.filter(k => k !== key);
    if (st.active && st.active !== key) st.queue.unshift(st.active);
    st.active = key;
    const bank = st.bank; st.bank = 0;
    await pour(client, sid, st, bank, events);
    await saveState(client, sid, st);
  });
  publishEvents(sid, events);
  return view(sid);
}

// Add to the end of the queue — with whatever it still needs first, in
// order. With nothing being studied, the first entry starts now.
async function queueAdd(sid, key) {
  const events = [];
  await settle(sid, { force: true });
  await withTransaction(async client => {
    const { st } = await loadState(client, sid);
    await checkStudyable(client, sid, key, st.done);
    const adds = RS.pathTo(key, st.done).filter(k => k !== st.active && !st.queue.includes(k));
    if (!adds.length) throw new ResearchError(409, 'Already planned.');
    if (st.queue.length + adds.length > QUEUE_MAX) throw new ResearchError(400, `The queue holds ${QUEUE_MAX} projects${adds.length > 1 ? ` (this needs ${adds.length})` : ''}.`);
    st.queue.push(...adds);
    if (!st.active) { const bank = st.bank; st.bank = 0; await pour(client, sid, st, bank, events); }
    await saveState(client, sid, st);
  });
  publishEvents(sid, events);
  return view(sid);
}

// Take it out of the plan (the active one stops; its progress is kept), and
// with it anything queued that needed it. The next entry starts.
async function queueRemove(sid, key) {
  await settle(sid, { force: true });
  await withTransaction(async client => {
    const { st } = await loadState(client, sid);
    if (st.active !== key && !st.queue.includes(key)) throw new ResearchError(404, 'That isn\'t planned.');
    if (st.active === key) st.active = null;
    st.queue = st.queue.filter(k => k !== key && !RS.pathTo(k, st.done).includes(key));
    await pour(client, sid, st, 0, []);
    await saveState(client, sid, st);
  });
  return view(sid);
}

async function adminComplete(sid, key) {
  if (!RS.project(key)) throw new ResearchError(400, 'Unknown project.');
  const events = [];
  await withTransaction(async client => {
    const { st } = await loadState(client, sid);
    await completeIn(client, sid, key, events);
    st.done.add(key);
    if (st.active === key) st.active = null;
    st.queue = st.queue.filter(k => k !== key);
    await pour(client, sid, st, 0, []);
    await saveState(client, sid, st);
  });
  if (events.length) require('./event_bus').publish(sid, events[0]);
  return view(sid);
}

async function adminReset(sid) {
  await q(null, 'DELETE FROM settlement_research WHERE settlement_id=$1', [sid]);
  await q(null, "UPDATE settlements SET research_active = NULL, research_bank = 0, research_queue = '[]'::jsonb WHERE id=$1", [sid]);
  return view(sid);
}

module.exports = { BASE_PER_HOUR, BANK_CAP, LEVEL_BONUS, QUEUE_MAX, ResearchError, doneSet, scholarsOf, settle, view, start, queueAdd, queueRemove, adminComplete, adminReset };
