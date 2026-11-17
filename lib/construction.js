'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  Construction: building time with builders (docs/HOME_SCENE.md Part D).
//
//  With building time on for a town, paying for a building, an upgrade or a
//  house starts a construction site. Builders (the `builder` job) who are in
//  town work on the first site in the queue, around the clock; with no
//  builder nothing moves, and the town is told so once. When the work is
//  done the building stands, the upgrade takes effect or the house gets its
//  beds.
//
//    enabled(settlement)            is building time on for this town
//    workFor(kind, type, level)     builder-minutes a site needs (pure)
//    advance(sites, rate, from, to) the work done between two times (pure)
//    builders(sid)                  the builders in town now, and their pace
//    order(q, s, spec, now)         a new site, inside the caller's transaction
//                                   (the caller has checked the rules and paid)
//    queue(sid, now)                the sites, how far along, and when
//    work(sid, now)                 does the work up to now (the worker's tick,
//                                   and before the queue is read)
//    reorder / cancel               the player's hand on the queue
//    finishNow / setBuilders / setTown   Dev Tools
//    tick()                         every town with an open site
//
//  Everything that changes a town takes the settlement's row lock, so two
//  devices, or a device and the worker, never do the same work twice.
// ══════════════════════════════════════════════════════════════════════════
const { query, withTransaction } = require('../db');
const { BUILDINGS } = require('../buildings');
const TU = require('./tuning');

const CONFIG = {
  QUEUE_MAX: 5,
  WORK_MAX: 120,            // never more than two hours with one builder
  HOUSE: 5,
  // A first-level building, in builder-minutes. The first things a new camp
  // builds are 3 (docs/HOME_SCENE.md D.9: early friction).
  FIRST: {
    forager_hut: 3, lumber_camp: 3, granary: 3, farm: 3, scout_post: 4, fishing_post: 4, mine: 5, market: 5,
    tavern: 6, workshop: 6, smelter: 7, library: 8, smithy: 8, watchtower: 8, jeweller: 9, walls: 10, guild_hall: 10,
  },
  FIRST_DEFAULT: 6,
  UPGRADE_POW: 1.3,         // an upgrade to level n: base × n^1.3
  TICK_MS: 15000,           // how often the worker looks at open sites
};
const HOUSING = 'starter_house';
const MIN = 60000;

class SiteError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// ── Pure rules ─────────────────────────────────────────────────────────────
// Builder-minutes for a site. `mult`: the live "Building work" multiplier.
function workFor(kind, type, level = 1, mult = 1) {
  const base = kind === 'house' ? CONFIG.HOUSE : (CONFIG.FIRST[type] || CONFIG.FIRST_DEFAULT);
  const raw = kind === 'upgrade' ? base * Math.pow(Math.max(2, level), CONFIG.UPGRADE_POW) : base;
  const m = Number.isFinite(mult) ? mult : 1;
  return Math.max(1, Math.min(CONFIG.WORK_MAX, Math.round(raw * m * 10) / 10));
}
// The work done between `from` and `to` (ms) at `rate` builder-minutes a
// minute. `sites`: [{ id, work_needed, work_done }] in queue order. Everyone
// works on the first; what is left over when it finishes carries into the next.
// → { sites: [{ …, work_done, finished_at? }], finished: [ids] }
function advance(sites, rate, from, to) {
  const out = sites.map(s => ({ ...s, work_needed: Number(s.work_needed), work_done: Number(s.work_done) }));
  const finished = [];
  if (!(rate > 0) || !(to > from)) return { sites: out, finished };
  let t = from;
  for (const s of out) {
    const left = Math.max(0, s.work_needed - s.work_done);
    const can = (to - t) / MIN * rate;
    if (can + 1e-9 >= left) { t = Math.min(to, t + left / rate * MIN); s.work_done = s.work_needed; s.finished_at = t; s.worked = true; finished.push(s.id); }
    else { s.work_done += can; s.worked = can > 0; break; }
  }
  return { sites: out, finished };
}
// Minutes until each open site is finished at `rate`, in queue order (null
// while nobody is building).
function etas(sites, rate) {
  let sum = 0;
  return sites.map(s => { sum += Math.max(0, Number(s.work_needed) - Number(s.work_done)); return rate > 0 ? Math.max(1, Math.ceil(sum / rate)) : null; });
}
// "Delia", "Delia and Fenn", "Delia, Fenn and 2 others".
function namesLine(names) {
  const n = names.map(x => String(x).split(' ')[0]);
  if (!n.length) return '';
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} and ${n[2]}`;
  return `${n[0]}, ${n[1]} and ${n.length - 2} others`;
}
// What a cancelled site gives back: all of it before any work, half after.
function refundFor(cost, workDone) {
  const k = Number(workDone) > 0 ? 0.5 : 1;
  return Object.fromEntries(Object.entries(cost || {}).map(([r, v]) => [r, Math.floor(Number(v) * k)]).filter(([, v]) => v > 0));
}
const defOf = type => BUILDINGS[type] || { label: type, icon: '🏗️' };
function labelOf(site) {
  if (site.kind === 'repair') return site.target_id != null ? 'Repair: a home' : `Repair: ${defOf(site.building_type).label}`;
  if (site.kind === 'house') return 'A new home';
  const d = defOf(site.building_type);
  return site.kind === 'upgrade' ? `${d.label} (level ${site.level})` : d.label;
}

// ── Who builds ─────────────────────────────────────────────────────────────
async function enabled(settlement) {
  if (settlement && settlement.construction_on) return true;
  return TU.switchOn('construction.on').catch(() => false);
}
// The builders in town now (alive, grown, not away, not posted at an
// outpost), each with their pace: 1 for an ordinary builder, more or less
// with their strength, perks and age (the same multiplier as any job).
async function builders(sid) {
  const careers = require('./careers');
  const [wf, away] = await Promise.all([careers.loadWorkforce(null, sid), careers.awayMap(null, sid).catch(() => new Map())]);
  return wf.filter(c => c.role === 'builder' && !away.has(c.id))
    .map(c => ({ id: c.id, name: c.name, rate: Math.max(0.2, c.profile && Number.isFinite(c.profile.outputMult) ? c.profile.outputMult : 1) }));
}
const rateOf = crew => Math.round(crew.reduce((a, b) => a + b.rate, 0) * 1000) / 1000;

// ── Sites ──────────────────────────────────────────────────────────────────
const openSites = async (q, sid, lock = '') => (await q(`SELECT * FROM construction_sites WHERE settlement_id = $1 AND status = 'open' ORDER BY position, id ${lock}`, [sid])).rows;

// A new site. Called inside the caller's transaction, which holds the
// settlement's row lock, has checked the building's own rules and has taken
// the cost. Throws SiteError (the caller's transaction rolls the cost back).
// A repair (lib/upkeep.js "Repair now") brings its own `work` (the health to
// make up), names a house by `targetId`, and goes to the `front` of the queue.
async function order(q, s, { kind, type, level = 1, cost = {}, neighbourhoodId = null, plot = null, style = null, work = null, targetId = null, front = false }, now = Date.now()) {
  const open = await openSites(q, s.id);
  if (open.length >= CONFIG.QUEUE_MAX) throw new SiteError(`The builders already have ${CONFIG.QUEUE_MAX} things to build. Wait for one to finish, or cancel one.`);
  // One building or upgrade at a time for a building (a repair is its own thing).
  if (kind !== 'house' && kind !== 'repair' && open.some(o => o.building_type === type && o.kind !== 'repair')) throw new SiteError(`The ${defOf(type).label} is already being worked on.`);
  if (!open.length) await q('UPDATE settlements SET construction_at = $2 WHERE id = $1', [s.id, new Date(now).toISOString()]);
  const position = front ? open.reduce((m, o) => Math.min(m, o.position), 1) - 1 : open.reduce((m, o) => Math.max(m, o.position), 0) + 1;
  const need = work != null ? Math.max(1, Math.min(CONFIG.WORK_MAX, Number(work))) : workFor(kind, type, level, TU.T('build_work'));
  const site = (await q(`INSERT INTO construction_sites (settlement_id, kind, building_type, level, neighbourhood_id, plot, style, cost, work_needed, position, target_id)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [s.id, kind, type, level, neighbourhoodId, plot, style, JSON.stringify(cost), need, position, targetId])).rows[0];
  return site;
}

// How a site is shown.
function view(site, eta) {
  const d = defOf(site.building_type), need = Number(site.work_needed), done = Number(site.work_done);
  return {
    id: site.id, kind: site.kind, type: site.building_type, level: site.level, label: labelOf(site), icon: site.kind === 'repair' ? '🛠️' : site.kind === 'house' ? '🏡' : d.icon || '🏗️',
    target_id: site.target_id == null ? null : site.target_id,
    neighbourhood_id: site.neighbourhood_id, plot: site.plot, style: site.style,
    work_needed: need, work_done: Math.round(done * 100) / 100, pct: need > 0 ? Math.min(1, Math.round(done / need * 1000) / 1000) : 1,
    eta_minutes: eta, position: site.position, refund: refundFor(site.cost, done), started: done > 0,
  };
}
// The queue as the player sees it. Does the work up to now first.
async function queue(sid, now = Date.now()) {
  const s = (await query('SELECT id, construction_on FROM settlements WHERE id = $1', [sid])).rows[0];
  if (!s) throw new SiteError('No settlement.', 404);
  const on = await enabled(s);
  let sites = await openSites(query, sid);
  if (sites.length) { await work(sid, now); sites = await openSites(query, sid); }
  if (!on && !sites.length) return { on: false, max: CONFIG.QUEUE_MAX, sites: [], builders: [], rate: 0, waiting: false };
  const crew = await builders(sid), rate = rateOf(crew), eta = etas(sites, rate);
  return { on, max: CONFIG.QUEUE_MAX, sites: sites.map((x, i) => view(x, eta[i])), builders: crew.map(b => ({ id: b.id, name: b.name })), rate, waiting: sites.length > 0 && rate <= 0 };
}

// ── Finishing ──────────────────────────────────────────────────────────────
// The site's building now stands. → what to tell once the transaction is in.
async function complete(q, s, site, at) {
  const type = site.building_type, def = defOf(type);
  let house = null, mended = null;
  if (site.kind === 'repair') {
    mended = await require('./upkeep').repaired(q, s.id, site);   // whole again
  } else if (site.kind === 'house') {
    house = await require('./neighbourhoods').raise(q, s.id, { neighbourhoodId: site.neighbourhood_id, plot: site.plot, style: site.style });
    await require('./life').autoHouse(s.id, {}, q);
  } else {
    const has = (await q('SELECT id, level FROM buildings WHERE settlement_id = $1 AND type = $2', [s.id, type])).rows[0];
    if (has) await q('UPDATE buildings SET level = GREATEST(level, $2) WHERE id = $1', [has.id, site.level]);
    else await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1, $2, $3)', [s.id, type, site.level]);
    await built(q, s, type, site.level);
  }
  await q("UPDATE construction_sites SET status = 'done', work_done = work_needed, finished_at = $2 WHERE id = $1", [site.id, new Date(at).toISOString()]);
  const ids = (Array.isArray(site.workers) ? site.workers : []).map(Number).filter(Boolean);
  const names = ids.length ? (await q('SELECT id, name FROM citizens WHERE id = ANY($1::int[])', [ids])).rows : [];
  const by = namesLine(ids.map(id => (names.find(n => n.id === id) || {}).name).filter(Boolean));
  const text = site.kind === 'repair' ? `${site.target_id != null ? (mended || 'The home') : 'The ' + (mended || def.label)} has been mended${by ? ` by ${by}` : ''}.`
    : site.kind === 'house' ? `A new home is finished${house ? ` (${house.name})` : ''}${by ? `, built by ${by}` : ''}.`
    : site.kind === 'upgrade' ? `The ${def.label} is now level ${site.level}${by ? `, the work of ${by}` : ''}.`
      : `The ${def.label} is finished${by ? `, built by ${by}` : ''}.`;
  await q(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids, created_at) VALUES ($1, 'construction', $2, $3, $4)`,
    [s.id, `${site.kind === 'repair' ? '🛠️' : site.kind === 'house' ? '🏡' : '🔨'} ${text}`, JSON.stringify(ids), new Date(Math.min(at, Date.now())).toISOString()]);
  if (site.kind !== 'repair') await require('./chronicle').write(s.id, { kind: 'town', text, citizenIds: ids, at }, q);   // a repair is news, not history
  return { type: 'construction', what: 'finished', site: { id: site.id, kind: site.kind, type, level: site.level, label: labelOf(site), house_id: house ? house.id : null }, workers: ids, text };
}
// What a building does the moment it stands (the same for an instant build).
async function built(q, s, type, level) {
  if (type === 'scout_post') {
    const { hexDisk } = require('../mapgen');
    const def = BUILDINGS.scout_post;
    for (const { q: tq, r } of hexDisk(s.tile_q, s.tile_r, 5 + (def.effect(level).reveal_radius || 0))) {
      await q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [s.user_id, tq, r]);
    }
  }
}
function tell(sid, events) {
  for (const e of events) {
    try { require('./event_bus').publish(sid, e); } catch (_) { /* no stream */ }
    if (e.what === 'finished') require('./milestones').town(sid, 'first_built').catch(() => {});
  }
}

// ── The work ───────────────────────────────────────────────────────────────
// Does the work on a town's sites up to `now`. Safe to call from anywhere,
// any number of times: the settlement's row lock and construction_at make
// each minute count once.
async function work(sid, now = Date.now()) {
  const events = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid])).rows[0];
    if (!s) return [];
    const sites = await openSites(q, sid);
    if (!sites.length) {
      if (s.construction_waiting) await q('UPDATE settlements SET construction_waiting = FALSE WHERE id = $1', [sid]);
      return [];
    }
    const from = s.construction_at ? new Date(s.construction_at).getTime() : now;
    if (now <= from) return [];
    const crew = await builders(sid), rate = rateOf(crew);
    const out = [];
    if (rate > 0) {
      const res = advance(sites, rate, from, now), ids = crew.map(b => b.id);
      for (const st of res.sites) {
        if (!st.worked) continue;
        const workers = [...new Set([...(Array.isArray(st.workers) ? st.workers : []), ...ids])];
        st.workers = workers;
        if (res.finished.includes(st.id)) out.push(await complete(q, s, st, st.finished_at));
        else await q('UPDATE construction_sites SET work_done = $2, workers = $3 WHERE id = $1', [st.id, st.work_done, JSON.stringify(workers)]);
      }
      if (s.construction_waiting) out.push({ type: 'construction', what: 'resumed' });
    } else if (!s.construction_waiting) {
      // Nobody is building: said once, until someone is.
      const first = sites[0];
      const text = `Work has stopped on ${first.kind === 'repair' ? 'the repairs' : first.kind === 'house' ? 'the new home' : 'the ' + defOf(first.building_type).label}: nobody in town is a builder. Give a grown-up the Builder job.`;
      await q(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1, 'construction', $2, '[]')`, [sid, `⏳ ${text}`]);
      out.push({ type: 'construction', what: 'waiting', text });
    }
    await q('UPDATE settlements SET construction_at = $2, construction_waiting = $3 WHERE id = $1', [sid, new Date(now).toISOString(), !(rate > 0)]);
    return out;
  });
  tell(sid, events);
  return events;
}

let _last = 0;
// The worker's tick: every town with an open site, at most every TICK_MS.
// Never throws (it shares the tick with everything else in the game).
async function tick(now = Date.now()) {
  if (now - _last < CONFIG.TICK_MS) return 0;
  _last = now;
  let n = 0;
  try {
    const rows = (await query("SELECT DISTINCT settlement_id FROM construction_sites WHERE status = 'open'")).rows;
    for (const r of rows) {
      try { await work(r.settlement_id, Date.now()); n++; }
      catch (e) { console.error('[construction] town %s: %s', r.settlement_id, e.message); }
    }
  } catch (e) { console.error('[construction] tick:', e.message); }
  return n;
}

// ── The player's hand on the queue ─────────────────────────────────────────
async function reorder(sid, ids) {
  if (!Array.isArray(ids)) throw new SiteError('Give the sites in their new order.');
  const want = ids.map(Number);
  await work(sid);
  await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [sid]);
    const open = await openSites(q, sid);
    const have = open.map(o => o.id);
    if (want.length !== have.length || new Set(want).size !== want.length || !want.every(id => have.includes(id))) throw new SiteError('The queue has changed. Look again and try once more.', 409);
    for (let i = 0; i < want.length; i++) await q('UPDATE construction_sites SET position = $2 WHERE id = $1', [want[i], i + 1]);
  });
  try { require('./event_bus').publish(sid, { type: 'construction', what: 'queue' }); } catch (_) { /* no stream */ }
}
// Cancel: everything back before any work is done, half after.
async function cancel(sid, siteId) {
  await work(sid);
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [sid]);
    return cancelIn(q, sid, Number(siteId));
  });
  try { require('./event_bus').publish(sid, { type: 'construction', what: 'queue' }); } catch (_) { /* no stream */ }
  return out;
}
async function cancelIn(q, sid, siteId) {
  const site = (await q("SELECT * FROM construction_sites WHERE id = $1 AND settlement_id = $2 AND status = 'open'", [siteId, sid])).rows[0];
  if (!site) throw new SiteError('That is not being built (it may have just been finished).', 404);
  const RD = require('./resource_defs');
  const refund = refundFor(site.cost, site.work_done);
  const keys = Object.keys(refund).filter(r => RD.isResource(r));
  if (keys.length) await q(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} + $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(r => refund[r]), sid]);
  await q("UPDATE construction_sites SET status = 'cancelled', finished_at = NOW() WHERE id = $1", [site.id]);
  return { refund, label: labelOf(site), full: !(Number(site.work_done) > 0) };
}
// A building came down: work on its upgrade stops (refunded as a cancel).
async function cancelFor(q, sid, type) {
  const sites = (await q("SELECT id FROM construction_sites WHERE settlement_id = $1 AND building_type = $2 AND kind <> 'house' AND target_id IS NULL AND status = 'open'", [sid, type])).rows;
  let out = null;
  for (const st of sites) { const r = await cancelIn(q, sid, st.id); if (!out || Object.keys(r.refund).length) out = r; }   // its upgrade, and any repair
  return out;
}

// ── Dev Tools (admins, on their own town) ──────────────────────────────────
// Finish a site now (the first in the queue when none is named).
async function finishNow(sid, siteId = null) {
  const events = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid])).rows[0];
    if (!s) throw new SiteError('No settlement.', 404);
    const open = await openSites(q, sid);
    const site = siteId == null ? open[0] : open.find(o => o.id === Number(siteId));
    if (!site) throw new SiteError('Nothing is being built.', 404);
    return [await complete(q, s, site, Date.now())];
  });
  tell(sid, events);
  return events[0];
}
// Make exactly `count` of the town's grown-ups builders (foragers and the
// idle first; extra builders go back to foraging).
async function setBuilders(sid, count) {
  const n = Math.max(0, Math.min(50, Math.floor(Number(count)) || 0));
  const careers = require('./careers');
  const events = [];
  await withTransaction(async c => {
    const rows = (await c.query(`SELECT id, role FROM citizens WHERE settlement_id = $1 AND COALESCE(life_stage, 'adult') = 'adult' ORDER BY id`, [sid])).rows;
    const have = rows.filter(r => r.role === 'builder');
    if (have.length > n) await careers.setRole(c, sid, have.slice(n).map(r => r.id), 'forager', events);
    else if (have.length < n) {
      const pool = [...rows.filter(r => r.role === 'idle' || r.role === 'forager'), ...rows.filter(r => !['idle', 'forager', 'builder'].includes(r.role))];
      await careers.setRole(c, sid, pool.slice(0, n - have.length).map(r => r.id), 'builder', events);
    }
  });
  careers.publish(sid, events);
  return (await builders(sid)).length;
}
async function setTown(sid, on) {
  await query('UPDATE settlements SET construction_on = $2 WHERE id = $1', [sid, !!on]);
  return !!on;
}

module.exports = {
  CONFIG, SiteError, HOUSING,
  workFor, advance, etas, namesLine, refundFor, labelOf,
  enabled, builders, order, queue, work, tick, reorder, cancel, cancelFor, built, finishNow, setBuilders, setTown,
  _resetTick() { _last = 0; },
};
