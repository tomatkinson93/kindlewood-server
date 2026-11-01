// ══════════════════════════════════════════════════════════════════════════
//  wonders — a City's Great Works (routes/wonders.js, /api/wonders).
//
//  Five wonders, each built in three stages: pay a stage, it builds for
//  STAGE_HOURS, then the next stage can start. One wonder at a time. The
//  bonus applies once all three stages are done — and only while the town
//  pays its upkeep (lib/town_mods: WONDER_UPKEEP an hour each).
//  Needs a City and the research Monuments; Eternal Works makes stages 25%
//  quicker and halves upkeep. Every final stage needs an Ancient Blueprint.
//
//  townBonuses(db, sid) → { finished: [def], mods, effects, upkeep_mult }  (town_mods)
//  view(sid) · build(sid, key) · adminFinish(sid, key)
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const RD = require('./resource_defs');

const STAGES = 3;
const STAGE_HOURS = [12, 24, 48];
const STAGE_MULT = [1, 1.75, 2.5];
const FINAL_ITEMS = [{ item_key: 'ancient_blueprint', qty: 1, name: 'Ancient Blueprint', icon: '📜' }];
const RESEARCH = 'monuments';

// mods: lib/happening_effects STATS keys (town production, upkeep, happiness);
// effects: research effect keys (crafting, research, Market).
const DEFS = {
  great_forge:     { label: 'Great Forge',     icon: '⚒️', desc: 'A forge the size of a hall, fed by a river of coal.',
                     base: { steel: 40, metal: 400, coal: 60, obsidian: 20 }, effects: { craft_speed: 0.15, quality: 2 },
                     bonus: '+15% crafting speed and +2 quality at every workshop' },
  sky_observatory: { label: 'Sky Observatory', icon: '🔭', desc: 'Lenses of polished gems that bring the stars close.',
                     base: { silver: 40, gems: 25, stone: 600, moonsilver: 10 }, effects: { research: 0.2 },
                     bonus: '+20% research' },
  grand_bazaar:    { label: 'Grand Bazaar',    icon: '⚖️', desc: 'A covered market where every caravan wants to stop.',
                     base: { silver: 50, goldore: 40, timber: 800, wealth: 1500 }, effects: { market_fee: -0.1, carry: 0.2 },
                     bonus: '−10% Market fees and +20% carried' },
  granary_of_ages: { label: 'Granary of Ages', icon: '🌾', desc: 'Cool stone vaults that keep grain for a generation.',
                     base: { stone: 800, timber: 800, bronze: 60, food: 2000 }, mods: { food_production: 0.2, food_upkeep: -0.15 },
                     bonus: '+20% food and citizens eat 15% less' },
  starfall_spire:  { label: 'Starfall Spire',  icon: '✨', desc: 'A tower of starmetal that hums at night.',
                     base: { steel: 60, gems: 30, moonsilver: 15, mithril: 10 }, mods: { all_production: 0.1, happiness: 5 },
                     bonus: '+10% all production and +5 happiness' },
};
const KEYS = Object.keys(DEFS);

class WonderError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function stageCost(key, stage) {   // stage: 0-based (0 = first)
  const d = DEFS[key];
  return Object.fromEntries(Object.entries(d.base).map(([r, v]) => [r, Math.ceil(v * STAGE_MULT[stage])]));
}
function stageItems(stage) { return stage === STAGES - 1 ? FINAL_ITEMS : []; }

async function researchFx(db, sid) {
  const done = await require('./research').doneSet(db, sid);
  return { done, fx: require('./research_defs').effectsOf(done) };
}
function stageHours(stage, fx) { return STAGE_HOURS[stage] * Math.max(0.1, 1 - (fx.wonder_speed || 0)); }

// Finish any stage whose time is up (on read, and in the tick via townBonuses).
async function finishDue(db, sid) {
  const rows = (await db.query(
    `UPDATE settlement_wonders SET stage = stage + 1, building_until = NULL,
            completed_at = CASE WHEN stage + 1 >= $2 THEN NOW() ELSE completed_at END
      WHERE settlement_id = $1 AND building_until IS NOT NULL AND building_until <= NOW()
      RETURNING wonder_key, stage`, [sid, STAGES])).rows;
  for (const r of rows) {
    const d = DEFS[r.wonder_key];
    if (!d) continue;
    const msg = r.stage >= STAGES
      ? `🏛 The ${d.label} is complete! ${d.bonus}.`
      : `${d.icon} Stage ${r.stage} of the ${d.label} is finished.`;
    await db.query("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'wonder',$2)", [sid, msg]);
  }
  return rows;
}

async function rowsOf(db, sid) {
  await finishDue(db, sid);
  return (await db.query('SELECT * FROM settlement_wonders WHERE settlement_id = $1', [sid])).rows;
}

// What town_mods adds: finished wonders' bonuses and the upkeep multiplier.
async function townBonuses(db, sid) {
  db = db || { query };
  const rows = await rowsOf(db, sid);
  const finished = rows.filter(r => r.stage >= STAGES && DEFS[r.wonder_key]).map(r => ({ key: r.wonder_key, ...DEFS[r.wonder_key] }));
  const mods = {}, effects = {};
  for (const f of finished) {
    for (const [k, v] of Object.entries(f.mods || {})) mods[k] = (mods[k] || 0) + v;
    for (const [k, v] of Object.entries(f.effects || {})) effects[k] = (effects[k] || 0) + v;
  }
  const { fx } = finished.length ? await researchFx(db, sid) : { fx: {} };
  return { finished, mods, effects, upkeep_mult: 1 + (fx.wonder_upkeep || 0) };
}

async function view(sid) {
  const s = (await query('SELECT * FROM settlements WHERE id = $1', [sid])).rows[0];
  if (!s) throw new WonderError(404, 'No settlement.');
  const rows = await rowsOf({ query }, sid);
  const { done, fx } = await researchFx({ query }, sid);
  const town = await require('./town_mods').load(null, s);
  const building = rows.find(r => r.building_until);
  const items = Object.fromEntries((await query(
    `SELECT item_key, SUM(quantity)::int AS n FROM inventory_items WHERE settlement_id = $1 AND equipped_to IS NULL AND item_key = ANY($2) GROUP BY item_key`,
    [sid, FINAL_ITEMS.map(i => i.item_key)])).rows.map(r => [r.item_key, r.n]));
  const why = s.tier !== 'city' ? 'Wonders need a City.'
    : !done.has(RESEARCH) ? 'Study Monuments at the Library first.'
    : null;
  const wonders = KEYS.map(key => {
    const d = DEFS[key], r = rows.find(x => x.wonder_key === key) || { stage: 0 };
    const complete = r.stage >= STAGES;
    const next = complete ? null : {
      stage: r.stage + 1, cost: stageCost(key, r.stage), items: stageItems(r.stage).map(i => ({ ...i, have: items[i.item_key] || 0 })),
      hours: Math.round(stageHours(r.stage, fx) * 10) / 10,
    };
    let blocked = why;
    if (!blocked && r.building_until) blocked = 'This stage is still being built.';
    else if (!blocked && building && building.wonder_key !== key && !complete) blocked = `The town is busy with the ${DEFS[building.wonder_key].label}.`;
    else if (!blocked && next) {
      const short = Object.entries(next.cost).find(([res, v]) => (Number(s[res]) || 0) < v);
      const miss = next.items.find(i => i.have < i.qty);
      if (short) blocked = `Not enough ${RD.label(short[0]).toLowerCase()}.`;
      else if (miss) blocked = `Needs an ${miss.name}.`;
    }
    return {
      key, label: d.label, icon: d.icon, desc: d.desc, bonus: d.bonus, stage: r.stage, stages: STAGES, complete,
      building_until: r.building_until || null, next, can_build: !complete && !blocked, why: complete ? null : blocked,
      active: complete && !town.arrears, dormant: complete && town.arrears,
    };
  });
  return { wonders, locked: why, arrears: town.arrears, upkeep_each: Math.round(require('./town_mods').WONDER_UPKEEP * (1 + (fx.wonder_upkeep || 0)) * 100) / 100 };
}

async function build(sid, key, { free = false, instant = false } = {}) {
  if (!DEFS[key]) throw new WonderError(404, 'No such wonder.');
  const v = await view(sid);
  const w = v.wonders.find(x => x.key === key);
  if (!free && !w.can_build) throw new WonderError(400, w.why || (w.complete ? 'Already complete.' : 'Not now.'));
  if (free && (w.complete || w.building_until)) throw new WonderError(400, w.complete ? 'Already complete.' : 'Already building.');
  const { fx } = await researchFx({ query }, sid);
  await withTransaction(async client => {
    if (!free) {
      const keys = Object.keys(w.next.cost).filter(r => RD.isResource(r));
      const r = await client.query(
        `UPDATE settlements SET ${keys.map((k, i) => `${k} = ${k} - $${i + 2}`).join(', ')}
          WHERE id = $1 AND ${keys.map((k, i) => `${k} >= $${i + 2}`).join(' AND ')} RETURNING id`,
        [sid, ...keys.map(k => w.next.cost[k])]);
      if (!r.rowCount) throw new WonderError(409, 'The stores changed — try again.');
      for (const it of w.next.items) await require('./inventory').consumeItemsByKey(client, sid, it.item_key, it.qty);
    }
    const hours = instant ? 0 : stageHours(w.stage, fx);
    const busy = (await client.query('SELECT wonder_key FROM settlement_wonders WHERE settlement_id = $1 AND building_until IS NOT NULL AND wonder_key <> $2 FOR UPDATE', [sid, key])).rows[0];
    if (busy && !free) throw new WonderError(409, 'Another wonder is already being built.');
    await client.query(
      `INSERT INTO settlement_wonders (settlement_id, wonder_key, stage, building_until) VALUES ($1, $2, 0, NOW() + make_interval(secs => $3))
       ON CONFLICT (settlement_id, wonder_key) DO UPDATE SET building_until = NOW() + make_interval(secs => $3)`,
      [sid, key, Math.round(hours * 3600)]);
  });
  if (instant) await finishDue({ query }, sid);
  return view(sid);
}

// Dev Tools: finish the stage being built now, or build the next one free.
async function adminFinish(sid, key) {
  if (!DEFS[key]) throw new WonderError(404, 'No such wonder.');
  const r = await query('UPDATE settlement_wonders SET building_until = NOW() - interval \'1 second\' WHERE settlement_id = $1 AND wonder_key = $2 AND building_until IS NOT NULL RETURNING 1', [sid, key]);
  if (r.rowCount) { await finishDue({ query }, sid); return view(sid); }
  return build(sid, key, { free: true, instant: true });
}

module.exports = { DEFS, KEYS, STAGES, STAGE_HOURS, STAGE_MULT, FINAL_ITEMS, RESEARCH, WonderError, stageCost, townBonuses, view, build, adminFinish, finishDue };
