'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  Neighbourhoods (docs/HOME_SCENE.md Part C).
//
//  A town's houses stand on numbered plots in a neighbourhood: 36 plots, two
//  rows of 18 (row 0 at the back). Plots open from the middle outwards with
//  the town's tier: Camp 6, Village 12, Town 24, City 36. A town that already
//  has more houses than its tier allows keeps them all; it just can't place
//  more. Modelled for several neighbourhoods per town; a town has one for now
//  (a second is only made when old houses don't fit in the first).
//
//  The houses table is the truth about homes. One `buildings` row of the
//  housing type is kept per house, because the rest of the game counts those
//  (rankings, city upkeep); seat() keeps the two in step.
//
//    seat(settlementId, q)        every house gets a neighbourhood, a plot and a style
//    list(settlement)             what the scene draws
//    place / move / setStyle / demolish
//    raise(q, sid, { … })         the house itself, with no cost or rules (a
//                                 finished construction site)
//
//  With building time on (lib/construction.js) place() pays and starts a
//  site; the site holds its plot until the builders finish it.
//
//  Beds are counted across the whole town (lib/life.js), never per
//  neighbourhood. A style never changes beds (lib/house_styles.js).
// ══════════════════════════════════════════════════════════════════════════
const { query, withTransaction } = require('../db');
const STYLES = require('./house_styles');

const ROWS = 2, COLS = 18, PLOTS = ROWS * COLS;
const TIER_PLOTS = require('../buildings').BUILDINGS.starter_house.tierCaps;   // camp 6, village 12, town 24, city 36
const TIER_ORDER = ['camp', 'village', 'town', 'city'];
const HOUSING_TYPE = 'starter_house';
const NAMES = ['The Old Quarter', 'The New Quarter', 'The Far Quarter'];
const LIVING = "COALESCE(life_stage, 'adult') <> 'deceased'";

// The order plots open in: from the middle column outwards, the back row
// before the front. So six plots are a 2 × 2 block and one more each side, and
// each tier is a wider block of whole columns.
const colOf = p => p % COLS, rowOf = p => Math.floor(p / COLS);
const PLOT_ORDER = Array.from({ length: PLOTS }, (_, p) => p)
  .sort((a, b) => Math.abs(colOf(a) - (COLS - 1) / 2) - Math.abs(colOf(b) - (COLS - 1) / 2) || rowOf(a) - rowOf(b) || colOf(a) - colOf(b));
const tierPlots = tier => TIER_PLOTS[tier] || TIER_PLOTS.camp;
// The plots a town of this tier may build on. Pure.
const openPlots = tier => PLOT_ORDER.slice(0, tierPlots(tier));
const validPlot = p => Number.isInteger(p) && p >= 0 && p < PLOTS;
// The first free plot among `open`, given the plots taken. Pure.
const firstFree = (open, taken) => { const t = new Set(taken); const p = open.find(x => !t.has(x)); return p === undefined ? null : p; };

class HouseError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// ── Seating ───────────────────────────────────────────────────────────────
// Every house of the town gets a neighbourhood and a plot (in the order it
// was built, filling plots in the order they open) and a style; the town has
// at least one neighbourhood; and there is one housing `buildings` row per
// house. Safe to call any time; does nothing when all is in place.
async function seat(settlementId, q = query) {
  let hoods = (await q('SELECT id, position FROM neighbourhoods WHERE settlement_id = $1 ORDER BY position, id', [settlementId])).rows;
  const addHood = async () => {
    const pos = hoods.length ? Math.max(...hoods.map(h => h.position)) + 1 : 0;
    await q('INSERT INTO neighbourhoods (settlement_id, name, position) VALUES ($1, $2, $3) ON CONFLICT (settlement_id, position) DO NOTHING',
      [settlementId, NAMES[pos] || `Quarter ${pos + 1}`, pos]);
    hoods = (await q('SELECT id, position FROM neighbourhoods WHERE settlement_id = $1 ORDER BY position, id', [settlementId])).rows;
  };
  if (!hoods.length) await addHood();

  const loose = (await q('SELECT id FROM houses WHERE settlement_id = $1 AND (neighbourhood_id IS NULL OR plot IS NULL) ORDER BY created_at, id', [settlementId])).rows;
  let seated = 0;
  if (loose.length) {
    const taken = {};
    for (const r of (await q('SELECT neighbourhood_id, plot FROM houses WHERE settlement_id = $1 AND neighbourhood_id IS NOT NULL AND plot IS NOT NULL', [settlementId])).rows)
      (taken[r.neighbourhood_id] = taken[r.neighbourhood_id] || []).push(r.plot);
    for (const h of loose) {
      let hood = null, plot = null;
      for (let guard = 0; guard < 50 && plot === null; guard++) {
        hood = hoods.find(n => firstFree(PLOT_ORDER, taken[n.id] || []) !== null);
        if (!hood) { await addHood(); continue; }
        plot = firstFree(PLOT_ORDER, taken[hood.id] || []);
      }
      if (plot === null) break;
      await q('UPDATE houses SET neighbourhood_id = $1, plot = $2 WHERE id = $3', [hood.id, plot, h.id]);
      (taken[hood.id] = taken[hood.id] || []).push(plot);
      seated++;
    }
  }
  // Houses from before styles: a mix, by id, so it never changes.
  await q(`UPDATE houses SET style = ($2::text[])[1 + (id % $3)] WHERE settlement_id = $1 AND style IS NULL`, [settlementId, STYLES.MIXED, STYLES.MIXED.length]);

  // One housing `buildings` row per house (an old demolish could leave them
  // out of step).
  const n = (await q(`SELECT (SELECT COUNT(*) FROM houses WHERE settlement_id = $1 AND building_type = $2)::int AS houses,
                             (SELECT COUNT(*) FROM buildings WHERE settlement_id = $1 AND type = $2)::int AS rows`, [settlementId, HOUSING_TYPE])).rows[0];
  for (let i = n.rows; i < n.houses; i++) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1, $2, 1)', [settlementId, HOUSING_TYPE]);
  if (n.rows > n.houses) await q(`DELETE FROM buildings WHERE id IN (SELECT id FROM buildings WHERE settlement_id = $1 AND type = $2 ORDER BY id DESC LIMIT $3)`,
    [settlementId, HOUSING_TYPE, n.rows - n.houses]);
  return { seated, neighbourhoods: hoods.length };
}

// At boot: seat every town that has a house without a plot, or no
// neighbourhood. Cheap when there is nothing to do.
async function seatAll() {
  const ids = (await query(
    `SELECT s.id FROM settlements s
      WHERE NOT EXISTS (SELECT 1 FROM neighbourhoods n WHERE n.settlement_id = s.id)
         OR EXISTS (SELECT 1 FROM houses h WHERE h.settlement_id = s.id AND (h.neighbourhood_id IS NULL OR h.plot IS NULL OR h.style IS NULL))
      ORDER BY s.id`)).rows.map(r => r.id);
  let failed = 0;
  for (const id of ids) {
    try { await withTransaction(async c => { await c.query('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [id]); await seat(id, (t, p) => c.query(t, p)); }); }
    catch (e) { failed++; console.error(`[neighbourhoods] town ${id}:`, e.message); }
  }
  if (ids.length) console.log(`[neighbourhoods] seated ${ids.length - failed} town(s)`);
  return { towns: ids.length, failed };
}

// ── Reading ───────────────────────────────────────────────────────────────
// A house's name as shown: the player's own name for it; else the family
// living in it ("The Brightburrow home"); an empty one says so; a house
// shared by more than one family keeps its given name. Pure.
function displayName(house, residents, familyNames) {
  if (house.custom_name) return house.name;
  if (!residents.length) return 'Empty home';
  const fams = [...new Set(residents.map(r => r.family_id || 0))];
  if (fams.length === 1 && fams[0] && familyNames[fams[0]]) return `The ${familyNames[fams[0]]} home`;
  return house.name;
}

// The cost of the town's next house: the base cost times (houses + 1), less
// any building discount, as before.
async function nextCost(settlementId, count) {
  const B = require('../routes/buildings');
  const { BUILDINGS } = require('../buildings');
  return B.scaledCost(BUILDINGS[HOUSING_TYPE], count + 1, (await B.buildDiscount(settlementId)).mult);
}

// Everything the scene needs. `settlement`: { id, tier }.
async function list(settlement, q = query) {
  const sid = settlement.id;
  const check = (await q(`SELECT (SELECT COUNT(*) FROM neighbourhoods WHERE settlement_id = $1)::int AS hoods,
                                 (SELECT COUNT(*) FROM houses WHERE settlement_id = $1 AND (neighbourhood_id IS NULL OR plot IS NULL OR style IS NULL))::int AS loose`, [sid])).rows[0];
  if (!check.hoods || check.loose) await seat(sid, q);
  const [hoods, houses, people, fams] = await Promise.all([
    q('SELECT id, name, position FROM neighbourhoods WHERE settlement_id = $1 ORDER BY position, id', [sid]),
    q('SELECT id, name, custom_name, neighbourhood_id, plot, style, state, capacity FROM houses WHERE settlement_id = $1 ORDER BY plot', [sid]),
    q(`SELECT id, name, gender, role, family_id, house_id, life_stage FROM citizens WHERE settlement_id = $1 AND ${LIVING} ORDER BY born_at, id`, [sid]),
    q('SELECT id, name FROM families WHERE settlement_id = $1', [sid]).catch(() => ({ rows: [] })),
  ]);
  // Homes being built (lib/construction.js): each holds its plot.
  const sites = (await q("SELECT id, neighbourhood_id, plot, style, work_needed, work_done FROM construction_sites WHERE settlement_id = $1 AND kind = 'house' AND status = 'open' ORDER BY position, id", [sid]).catch(() => ({ rows: [] }))).rows;
  const familyNames = Object.fromEntries(fams.rows.map(f => [f.id, f.name]));
  const byHouse = {};
  for (const c of people.rows) if (c.house_id) (byHouse[c.house_id] = byHouse[c.house_id] || []).push(c);
  const open = openPlots(settlement.tier);
  const slim = c => ({ id: c.id, name: c.name, gender: c.gender, role: c.role, family_id: c.family_id, life_stage: c.life_stage || 'adult' });
  const out = hoods.rows.map(n => {
    const mine = houses.rows.filter(h => h.neighbourhood_id === n.id);
    return {
      id: n.id, name: n.name, position: n.position, open,
      free: open.filter(p => !mine.some(h => h.plot === p) && !sites.some(x => x.neighbourhood_id === n.id && x.plot === p)).length,
      sites: sites.filter(x => x.neighbourhood_id === n.id).map(x => ({ id: x.id, plot: x.plot, style: x.style, pct: Number(x.work_needed) > 0 ? Math.min(1, Math.round(Number(x.work_done) / Number(x.work_needed) * 1000) / 1000) : 1 })),
      houses: mine.map(h => {
        const res = byHouse[h.id] || [];
        return { id: h.id, plot: h.plot, style: h.style, state: h.state, capacity: h.capacity, name: h.name, custom_name: h.custom_name,
          display: displayName(h, res, familyNames), residents: res.map(slim) };
      }),
    };
  });
  const count = houses.rows.length;
  const beds = houses.rows.filter(h => h.state === 'built').reduce((a, h) => a + h.capacity, 0);
  const next = TIER_ORDER[TIER_ORDER.indexOf(settlement.tier || 'camp') + 1] || null;
  return {
    rows: ROWS, cols: COLS, plots: PLOTS, tier: settlement.tier || 'camp', tier_plots: tierPlots(settlement.tier), next_tier: next,
    next_tier_plots: next ? tierPlots(next) : null,
    neighbourhoods: out,
    unhoused: people.rows.filter(c => !c.house_id).map(slim),
    beds, living: people.rows.length, houses: count,
    styles: STYLES.catalogue(),
    cost: await nextCost(sid, count + sites.length),
    building: sites.length,
  };
}

// ── Changing ──────────────────────────────────────────────────────────────
const RD = () => require('./resource_defs');
async function hoodOf(q, sid, nid) {
  const r = nid != null
    ? await q('SELECT id FROM neighbourhoods WHERE id = $1 AND settlement_id = $2', [nid, sid])
    : await q('SELECT id FROM neighbourhoods WHERE settlement_id = $1 ORDER BY position, id', [sid]);
  return r.rows.map(x => x.id);
}

// Builds a house on a plot (or, with no plot given, the first free one that
// is open), paying its cost. → { house, cost }.
async function place(settlementId, { neighbourhoodId = null, plot = null, style = null } = {}) {
  if (plot !== null && !validPlot(plot)) throw new HouseError('No such plot.');
  if (style !== null && !STYLES.owns(style)) throw new HouseError('Your town does not have that style.');
  return withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [settlementId])).rows[0];
    if (!s) throw new HouseError('No settlement.', 404);
    await seat(settlementId, q);
    const hoods = await hoodOf(q, settlementId, neighbourhoodId);
    if (!hoods.length) throw new HouseError('No such neighbourhood.', 404);
    const open = openPlots(s.tier);
    const all = (await q('SELECT id, neighbourhood_id, plot, name FROM houses WHERE settlement_id = $1', [settlementId])).rows;
    // A home being built holds its plot (and counts toward the next one's cost).
    const going = (await q("SELECT neighbourhood_id, plot FROM construction_sites WHERE settlement_id = $1 AND kind = 'house' AND status = 'open'", [settlementId])).rows;
    const takenIn = id => all.concat(going).filter(h => h.neighbourhood_id === id).map(h => h.plot);
    let hood = hoods[0];
    if (plot === null) {
      hood = hoods.find(id => firstFree(open, takenIn(id)) !== null);
      plot = hood != null ? firstFree(open, takenIn(hood)) : null;
      if (plot === null) {
        const next = TIER_ORDER[TIER_ORDER.indexOf(s.tier || 'camp') + 1];
        throw new HouseError(next ? `Every plot has a home. A ${next.charAt(0).toUpperCase() + next.slice(1)} has room for ${tierPlots(next)}.` : 'Every plot has a home.');
      }
    } else {
      if (!open.includes(plot)) throw new HouseError('That plot is not open yet. A bigger town has room for more homes.');
      if (going.some(g => g.neighbourhood_id === hood && g.plot === plot)) throw new HouseError('A home is already being built on that plot.');
      if (takenIn(hood).includes(plot)) throw new HouseError('A home already stands on that plot.');
    }
    const cost = await nextCost(settlementId, all.length + going.length);
    const rd = RD();
    for (const [r, v] of Object.entries(cost)) {
      if (rd.isResource(r) && v > (Number(s[r]) || 0)) throw new HouseError(`Not enough ${rd.label(r).toLowerCase()}. Need ${v}.`);
    }
    const keys = Object.keys(cost).filter(r => rd.isResource(r) && cost[r] > 0);
    if (keys.length) await q(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} - $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(r => cost[r]), settlementId]);
    // Building time: the builders raise it (lib/construction.js). Else at once.
    const CN = require('./construction');
    if (await CN.enabled(s)) {
      let site;
      try { site = await CN.order(q, s, { kind: 'house', type: HOUSING_TYPE, cost, neighbourhoodId: hood, plot, style: style || STYLES.DEFAULT }); }
      catch (e) { if (e instanceof CN.SiteError) throw new HouseError(e.message, e.status); throw e; }
      return { site: { id: site.id, plot, neighbourhood_id: hood }, cost, queued: true };
    }
    const house = await raise(q, settlementId, { neighbourhoodId: hood, plot, style });
    await require('./life').autoHouse(settlementId, {}, q);
    return { house, cost };
  });
}

// The house itself: its row and its `buildings` row. No cost, no rules (the
// caller has dealt with both). If its plot was taken meanwhile it goes on the
// first free one, open or not, so a finished home is never lost.
async function raise(q, settlementId, { neighbourhoodId, plot, style = null }) {
  const all = (await q('SELECT id, neighbourhood_id, plot, name FROM houses WHERE settlement_id = $1', [settlementId])).rows;
  let hood = neighbourhoodId != null ? (await hoodOf(q, settlementId, neighbourhoodId))[0] : null;
  if (!hood) { await seat(settlementId, q); hood = (await hoodOf(q, settlementId, null))[0]; }
  const taken = all.filter(h => h.neighbourhood_id === hood).map(h => h.plot);
  if (plot == null || taken.includes(plot)) plot = firstFree(PLOT_ORDER, taken);
  // "Willow Hut #n": the next number not in use.
  const used = new Set(all.map(h => h.name));
  let n = all.length + 1;
  while (used.has(`Willow Hut #${n}`)) n++;
  await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1, $2, 1)', [settlementId, HOUSING_TYPE]);
  return (await q(`INSERT INTO houses (settlement_id, name, building_type, capacity, neighbourhood_id, plot, style)
                   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, neighbourhood_id, plot, style, state, capacity`,
    [settlementId, `Willow Hut #${n}`, HOUSING_TYPE, require('./life').CONFIG.HOUSE_BEDS, hood, plot, style || STYLES.DEFAULT])).rows[0];
}
async function ownHouse(q, sid, houseId) {
  const h = (await q('SELECT id, neighbourhood_id, plot, style, name FROM houses WHERE id = $1 AND settlement_id = $2 FOR UPDATE', [houseId, sid])).rows[0];
  if (!h) throw new HouseError('House not found.', 404);
  return h;
}

// Moves a house to another plot, free and at once. Onto a home, the two swap.
async function move(settlementId, houseId, { neighbourhoodId = null, plot } = {}) {
  if (!validPlot(plot)) throw new HouseError('No such plot.');
  return withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await q('SELECT id, tier FROM settlements WHERE id = $1 FOR UPDATE', [settlementId])).rows[0];
    if (!s) throw new HouseError('No settlement.', 404);
    const h = await ownHouse(q, settlementId, houseId);
    const hood = neighbourhoodId != null ? (await hoodOf(q, settlementId, neighbourhoodId))[0] : h.neighbourhood_id;
    if (!hood) throw new HouseError('No such neighbourhood.', 404);
    if (hood === h.neighbourhood_id && plot === h.plot) return { house: h, swapped: null };
    const there = (await q('SELECT id FROM houses WHERE neighbourhood_id = $1 AND plot = $2 FOR UPDATE', [hood, plot])).rows[0];
    // An empty plot must be one the town's tier has opened; a swap between
    // two standing homes is always allowed.
    if (!there && !openPlots(s.tier).includes(plot)) throw new HouseError('That plot is not open yet.');
    if (!there && (await q("SELECT 1 FROM construction_sites WHERE neighbourhood_id = $1 AND plot = $2 AND kind = 'house' AND status = 'open'", [hood, plot])).rows.length)
      throw new HouseError('A home is being built on that plot.');
    await q('UPDATE houses SET plot = NULL WHERE id = $1', [h.id]);
    if (there) await q('UPDATE houses SET neighbourhood_id = $1, plot = $2 WHERE id = $3', [h.neighbourhood_id, h.plot, there.id]);
    await q('UPDATE houses SET neighbourhood_id = $1, plot = $2 WHERE id = $3', [hood, plot, h.id]);
    return { house: { ...h, neighbourhood_id: hood, plot }, swapped: there ? there.id : null };
  });
}

// A house's style: looks only, free and at once.
async function setStyle(settlementId, houseId, style) {
  if (!STYLES.isStyle(style)) throw new HouseError('Unknown style.');
  if (!STYLES.owns(style)) throw new HouseError('Your town does not have that style.');
  const r = await query('UPDATE houses SET style = $1 WHERE id = $2 AND settlement_id = $3 RETURNING id, style', [style, houseId, settlementId]);
  if (!r.rows.length) throw new HouseError('House not found.', 404);
  return { house: r.rows[0] };
}

// Pulls one house down: its residents lose their bed first (housing then
// sorts itself), half its base cost comes back.
async function demolish(settlementId, houseId = null) {
  return withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [settlementId])).rows[0];
    if (!s) throw new HouseError('No settlement.', 404);
    // No id: the most recently built (the old Buildings route).
    const h = houseId != null ? await ownHouse(q, settlementId, houseId)
      : (await q('SELECT id FROM houses WHERE settlement_id = $1 AND building_type = $2 ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE', [settlementId, HOUSING_TYPE])).rows[0];
    if (!h) throw new HouseError('House not found.', 404);
    const { BUILDINGS } = require('../buildings');
    const rd = RD(), refund = {};
    for (const [r, v] of Object.entries(BUILDINGS[HOUSING_TYPE].cost || {})) if (rd.isResource(r) && Math.floor(v * 0.5) > 0) refund[r] = Math.floor(v * 0.5);
    const keys = Object.keys(refund);
    if (keys.length) await q(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} + $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(r => refund[r]), settlementId]);
    await q('UPDATE citizens SET house_id = NULL WHERE house_id = $1', [h.id]);
    await q('DELETE FROM houses WHERE id = $1', [h.id]);
    await q('DELETE FROM buildings WHERE id = (SELECT id FROM buildings WHERE settlement_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1)', [settlementId, HOUSING_TYPE]);
    await require('./life').autoHouse(settlementId, {}, q);
    return { removed: h.id, refund };
  });
}

module.exports = {
  ROWS, COLS, PLOTS, TIER_PLOTS, PLOT_ORDER, HOUSING_TYPE, HouseError,
  openPlots, tierPlots, firstFree, validPlot, displayName,
  seat, seatAll, list, place, raise, move, setStyle, demolish,
};
