// ══════════════════════════════════════════════════════════════════════════
//  CRAFTING — careers Phase 2: crafters make items at their station.
//
//  Stations: Smithy (Blacksmith), Jeweller (Jeweller), Workshop (Carpenter).
//  Each station level is one working slot (careers.setRole enforces it).
//  Recipes are DB rows (Dev Tools); a crafter can make one if it's their
//  class (and path), their level, the station's level, and any unlock perk.
//
//  Queue: up to MAX_QUEUE jobs per crafter, one item each. Materials are
//  reserved when queued (exactly what was taken is stored, so cancel refunds
//  it). The active job finishes at completes_at; the next queued job starts
//  from that moment, so queues keep working while nobody is looking.
//  resolveDue() runs lazily (station reads) and from the worker (tick).
//
//  Quality: score (lib/career_math qualityScore) + d100 → Basic … Legendary.
//  The item gets the crafter's mark, a quality prefix, scaled bonuses and
//  value. Capstones: Named Blade (weaponsmith, weekly), Bulwark (armorer:
//  Guardian armour), Midas Touch (goldsmith: +15% value).
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query, withTransaction } = require('../db');
const eventBus = require('./event_bus');
const M = require('./career_math');
const C = require('./careers/classes');
const careers = require('./careers');
const inventory = require('./inventory');

const STATIONS = { smithy: 'blacksmith', jeweller: 'jeweller', workshop: 'carpenter' };
const STATION_OF = Object.fromEntries(Object.entries(STATIONS).map(([s, c]) => [c, s]));
const MAX_QUEUE = 5;
const RESOURCES = ['food', 'timber', 'stone', 'metal', 'wealth'];
const RUIN_CHANCE = 0.03;          // Butterfingers
const GUARDIAN_CHANCE = 0.5;       // Bulwark, on Superior+ armour
const MIDAS = 0.15;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const weekNo = (t = Date.now()) => Math.floor((t - Date.UTC(1970, 0, 5)) / WEEK_MS);

class CraftError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const arr = v => (Array.isArray(v) ? v : []);

async function recipes(db) {
  return (await (db || { query }).query('SELECT * FROM recipes WHERE NOT archived ORDER BY class_key, sort_order, min_level')).rows;
}
async function stationLevel(db, sid, station) {
  const r = await (db || { query }).query('SELECT COALESCE(MAX(level), 0)::int AS l FROM buildings WHERE settlement_id = $1 AND type = $2', [sid, station]);
  return r.rows[0].l;
}

// Why this crafter can't make this recipe right now, or null.
function blocker(recipe, cit, row, stLevel) {
  if (!cit || cit.role !== recipe.class_key) return `Needs a ${(C.CLASSES[recipe.class_key] || {}).label || recipe.class_key}.`;
  const level = row ? row.level : 1;
  if (recipe.spec && (!row || row.spec !== recipe.spec)) {
    const spec = C.specOf(C.CLASSES[recipe.class_key], recipe.spec);
    return `${spec ? spec.label + 's' : 'Specialists'} only.`;
  }
  if (level < recipe.min_level) return `Needs level ${recipe.min_level}.`;
  if (stLevel < recipe.min_station_level) return `Needs a level ${recipe.min_station_level} ${STATION_LABEL(recipe.station)}.`;
  if (recipe.unlock_node) {
    const node = C.CLASSES[recipe.class_key].tree.find(n => n.id === recipe.unlock_node);
    const owned = node && (node.capstone ? level >= M.MAX_LEVEL && (!node.branch || node.branch === 'trunk' || node.branch === (row && row.spec))
      : Number(((row && row.nodes) || {})[recipe.unlock_node]) > 0);
    if (!owned) return `Learn ${node ? node.name : 'a perk'} first.`;
  }
  return null;
}
const STATION_LABEL = s => { const { BUILDINGS } = require('../buildings'); return (BUILDINGS[s] && BUILDINGS[s].label) || s; };

// What a crafter brings to the bench: { score parts, speed, statMult }.
function benchOf(p, cls, row, stLevel) {
  const eff = (p && p.classKey === cls.key) ? p.effects : {};
  return {
    level: row ? row.level : 1,
    primary: p ? p.stats[cls.primary] : M.STAT_CENTRE,
    quality: M.eff(eff, 'quality'),
    tool: Math.max(0, M.eff(p ? p.effects : {}, 'skill', 'crafting')),
    station: stLevel,
    speed: M.eff(eff, 'craft_speed'),
    statMult: p ? p.statMult : 1,
    refund: M.eff(eff, 'refund'),
    xp: M.eff(eff, 'xp'),
  };
}
const scoreFor = (bench, recipe) => M.qualityScore({ ...bench, minLevel: recipe.min_level });
const secondsFor = (bench, recipe) => M.craftSeconds(recipe.base_seconds, bench.speed, bench.statMult);

// ── Station view ───────────────────────────────────────────────────────────

async function stationState(sid, station) {
  const classKey = STATIONS[station];
  if (!classKey) throw new CraftError(404, 'No such workshop.');
  await resolveDue(sid);
  const { BUILDINGS } = require('../buildings');
  const level = await stationLevel(null, sid, station);
  const state = await careers.loadState(null, sid);
  const profiles = await careers.profilesFor(null, sid);
  const cls = C.CLASSES[classKey];
  const crafters = state.citizens.filter(c => c.role === classKey && (c.life_stage || 'adult') === 'adult');
  const rowOf = cid => state.classRows.find(r => r.citizen_id === cid && r.class_key === classKey) || null;
  const all = (await recipes()).filter(r => r.class_key === classKey);
  const jobs = (await query(
    `SELECT j.*, c.name AS citizen_name FROM craft_jobs j JOIN citizens c ON c.id = j.citizen_id
      WHERE j.settlement_id = $1 AND j.station = $2 AND (j.status IN ('queued','active') OR j.finished_at > NOW() - interval '24 hours')
      ORDER BY (j.status = 'active') DESC, (j.status = 'queued') DESC, j.position, j.id DESC LIMIT 60`, [sid, station])).rows;
  const res = (await query('SELECT food, timber, stone, metal, wealth FROM settlements WHERE id = $1', [sid])).rows[0];
  const inputKeys = [...new Set(all.flatMap(r => arr((r.inputs || {}).items).map(i => i.item_key)))];
  const have = Object.fromEntries((await query(
    `SELECT item_key, SUM(quantity)::int AS n FROM inventory_items WHERE settlement_id = $1 AND item_key = ANY($2::text[]) AND equipped_to IS NULL GROUP BY item_key`,
    [sid, inputKeys])).rows.map(r => [r.item_key, r.n]));
  const tpl = Object.fromEntries((await query('SELECT item_key, name, icon, rarity, equip_slot, stat_bonuses, sell_value, item_effects FROM item_templates WHERE item_key = ANY($1::text[])',
    [[...new Set([...all.map(r => r.output_key), ...inputKeys])]])).rows.map(t => [t.item_key, t]));
  return {
    station, label: STATION_LABEL(station), class_key: classKey, class_label: cls.label, class_icon: cls.icon,
    level, slots: level && BUILDINGS[station].craftSlots ? BUILDINGS[station].craftSlots(level) : 0,
    max_queue: MAX_QUEUE, resources: res, have,
    templates: tpl,
    recipes: all.map(r => ({ ...r, output: tpl[r.output_key] || null })),
    crafters: crafters.map(c => {
      const row = rowOf(c.id), bench = benchOf(profiles.get(c.id), cls, row, level);
      return {
        id: c.id, name: c.name, level: bench.level, spec: row ? row.spec : null,
        bench, named_ready: namedReady(c, row),
        can: Object.fromEntries(all.map(r => [r.recipe_key, blocker(r, c, row, level)])),
        queued: jobs.filter(j => j.citizen_id === c.id && (j.status === 'queued' || j.status === 'active')).length,
      };
    }),
    jobs: jobs.map(jobView),
  };
}

function jobView(j) {
  const snap = j.recipe_snapshot || {};
  return {
    id: j.id, citizen_id: j.citizen_id, citizen_name: j.citizen_name, recipe_key: j.recipe_key, name: snap.name,
    status: j.status, started_at: j.started_at, completes_at: j.completes_at, finished_at: j.finished_at,
    quality: j.quality, options: j.options || {}, result: j.roll && j.roll.item ? j.roll.item : null, xp: j.xp_awarded,
  };
}

// Named Blade: a Lv20 Weaponsmith, once a week.
function namedReady(c, row) {
  return !!(row && row.spec === 'weaponsmith' && row.level >= M.MAX_LEVEL && Number((row.counters || {}).named_week) !== weekNo());
}

// ── Queue ──────────────────────────────────────────────────────────────────

async function queueJobs(sid, { citizenId, recipeKey, qty = 1, name = null }) {
  qty = Math.floor(Number(qty) || 0);
  if (qty < 1 || qty > MAX_QUEUE) throw new CraftError(400, `Queue 1–${MAX_QUEUE} at a time.`);
  const events = [];
  const out = await withTransaction(async client => {
    await client.query('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [sid]);
    const c = (await client.query('SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2 FOR UPDATE', [citizenId, sid])).rows[0];
    if (!c || (c.life_stage || 'adult') !== 'adult') throw new CraftError(404, 'Crafter not found.');
    const recipe = (await client.query('SELECT * FROM recipes WHERE recipe_key = $1 AND NOT archived', [recipeKey])).rows[0];
    if (!recipe) throw new CraftError(404, 'Unknown recipe.');
    const row = (await client.query('SELECT * FROM citizen_classes WHERE citizen_id = $1 AND class_key = $2 FOR UPDATE', [c.id, recipe.class_key])).rows[0] || null;
    const stLevel = await stationLevel(client, sid, recipe.station);
    const why = blocker(recipe, c, row, stLevel);
    if (why) throw new CraftError(400, why);
    const pending = Number((await client.query("SELECT COUNT(*)::int AS n FROM craft_jobs WHERE citizen_id = $1 AND status IN ('queued','active')", [c.id])).rows[0].n);
    if (pending + qty > MAX_QUEUE) throw new CraftError(400, `${c.name} can queue at most ${MAX_QUEUE} (${pending} waiting).`);
    // Named Blade: one weapon, once a week.
    let named = null;
    if (name) {
      const tpl = (await client.query('SELECT equip_slot FROM item_templates WHERE item_key = $1', [recipe.output_key])).rows[0];
      if (!namedReady(c, row)) throw new CraftError(400, 'Only a master Weaponsmith can name a blade — once a week.');
      if (!tpl || tpl.equip_slot !== 'weapon') throw new CraftError(400, 'Only weapons can be named.');
      if (qty !== 1) throw new CraftError(400, 'Name one blade at a time.');
      // Names show up in many places as raw text: letters, digits, spaces, ' and - only.
      named = String(name).replace(/[^\p{L}\p{N}' -]/gu, '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (named.length < 2) throw new CraftError(400, 'Give the blade a name.');
      await client.query(`UPDATE citizen_classes SET counters = COALESCE(counters, '{}'::jsonb) || jsonb_build_object('named_week', $3::int)
                           WHERE citizen_id = $1 AND class_key = $2`, [c.id, recipe.class_key, weekNo()]);
    }
    // Reserve materials for every unit.
    const inputs = recipe.inputs || {};
    const resNeed = {};
    for (const [k, v] of Object.entries(inputs.resources || {})) if (RESOURCES.includes(k) && Number(v) > 0) resNeed[k] = Number(v);
    for (const [k, v] of Object.entries(resNeed)) {
      const took = await client.query(`UPDATE settlements SET ${k} = ${k} - $2 WHERE id = $1 AND ${k} >= $2`, [sid, v * qty]);
      if (!took.rowCount) throw new CraftError(400, `Not enough ${k} — ${v * qty} needed.`);
    }
    const usedItems = [];
    for (const it of arr(inputs.items)) {
      try { usedItems.push({ item_key: it.item_key, per: Number(it.qty) || 1, used: await inventory.consumeItemsByKey(client, sid, it.item_key, (Number(it.qty) || 1) * qty) }); }
      catch (e) { throw new CraftError(e.status || 400, e.message); }
    }
    const profile = (await careers.profilesFor(null, sid)).get(c.id);
    const bench = benchOf(profile, C.CLASSES[recipe.class_key], row, stLevel);
    const hasActive = (await client.query("SELECT 1 FROM craft_jobs WHERE citizen_id = $1 AND status = 'active'", [c.id])).rowCount > 0;
    const maxPos = Number((await client.query("SELECT COALESCE(MAX(position), 0)::int AS p FROM craft_jobs WHERE citizen_id = $1 AND status IN ('queued','active')", [c.id])).rows[0].p);
    const snap = { name: recipe.name, class_key: recipe.class_key, spec: recipe.spec, station: recipe.station, min_level: recipe.min_level,
      output_key: recipe.output_key, output_qty: recipe.output_qty, base_seconds: recipe.base_seconds, base_xp: recipe.base_xp, quality_cap: recipe.quality_cap, inputs };
    const ids = [];
    for (let i = 0; i < qty; i++) {
      // Each job keeps exactly its share (item snapshots split per unit).
      const items = usedItems.map(u => ({ item_key: u.item_key, qty: u.per, snap: u.used[0].snap }));
      const active = !hasActive && i === 0;
      const secs = secondsFor(bench, snap);
      const r = await client.query(
        `INSERT INTO craft_jobs (settlement_id, citizen_id, recipe_key, recipe_snapshot, station, status, position, reserved, options, started_at, completes_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${active ? 'NOW()' : 'NULL'}, ${active ? `NOW() + make_interval(secs => $10)` : 'NULL'}) RETURNING id`,
        [sid, c.id, recipe.recipe_key, JSON.stringify(snap), recipe.station, active ? 'active' : 'queued', maxPos + i + 1,
         JSON.stringify({ resources: resNeed, items }), JSON.stringify(named ? { named } : {}), ...(active ? [secs] : [])]);
      ids.push(r.rows[0].id);
    }
    events.push({ type: 'craft_queue_updated', station: recipe.station });
    return { ids, name: c.name, recipe: recipe.name, seconds: secondsFor(bench, snap) };
  });
  careers.publish(sid, events);
  return out;
}

async function cancelJob(sid, jobId) {
  const events = [];
  const out = await withTransaction(async client => {
    const j = (await client.query(
      "SELECT * FROM craft_jobs WHERE id = $1 AND settlement_id = $2 AND status IN ('queued','active') FOR UPDATE", [jobId, sid])).rows[0];
    if (!j) throw new CraftError(404, 'That job is already finished.');
    await refund(client, sid, j.reserved);
    await client.query("UPDATE craft_jobs SET status = 'cancelled', finished_at = NOW() WHERE id = $1", [j.id]);
    if (j.status === 'active') await promoteNext(client, sid, j.citizen_id, Date.now());
    events.push({ type: 'craft_queue_updated', station: j.station });
    return { refunded: j.reserved };
  });
  careers.publish(sid, events);
  return out;
}

async function refund(client, sid, reserved) {
  const r = reserved || {};
  for (const [k, v] of Object.entries(r.resources || {})) {
    if (RESOURCES.includes(k) && Number(v) > 0) await client.query(`UPDATE settlements SET ${k} = ${k} + $2 WHERE id = $1`, [sid, Number(v)]);
  }
  for (const it of arr(r.items)) {
    if (it.snap && Number(it.qty) > 0) await inventory.grantItem((t, p) => client.query(t, p), sid, { ...it.snap, quantity: Number(it.qty), source: 'craft_refund' });
  }
}

// Start the citizen's next queued job at `fromMs`.
async function promoteNext(client, sid, citizenId, fromMs) {
  const next = (await client.query(
    "SELECT * FROM craft_jobs WHERE citizen_id = $1 AND status = 'queued' ORDER BY position, id LIMIT 1 FOR UPDATE", [citizenId])).rows[0];
  if (!next) return null;
  const c = (await client.query('SELECT * FROM citizens WHERE id = $1', [citizenId])).rows[0];
  const snap = next.recipe_snapshot;
  const row = (await client.query('SELECT * FROM citizen_classes WHERE citizen_id = $1 AND class_key = $2', [citizenId, snap.class_key])).rows[0] || null;
  const profile = (await careers.profilesFor(null, sid)).get(citizenId);
  const bench = benchOf(c && c.role === snap.class_key ? profile : null, C.CLASSES[snap.class_key], row, await stationLevel(client, sid, snap.station));
  const start = new Date(fromMs), end = new Date(fromMs + secondsFor(bench, snap) * 1000);
  await client.query("UPDATE craft_jobs SET status = 'active', started_at = $2, completes_at = $3 WHERE id = $1", [next.id, start, end]);
  return { id: next.id, completes_at: end };
}

// ── Finishing ──────────────────────────────────────────────────────────────

// Finish every due job (settlement or all), chaining queues. Never throws.
async function resolveDue(sid = null, opts = {}) {
  const rand = opts.rand || Math.random;
  const bySid = new Map();
  try {
    await withTransaction(async client => {
      for (let pass = 0; pass < 12; pass++) {
        const due = (await client.query(
          `SELECT * FROM craft_jobs WHERE status = 'active' AND completes_at <= NOW() ${sid ? 'AND settlement_id = $1' : ''}
            ORDER BY completes_at LIMIT 50 FOR UPDATE SKIP LOCKED`, sid ? [sid] : [])).rows;
        if (!due.length) break;
        for (const j of due) {
          const events = bySid.get(j.settlement_id) || [];
          bySid.set(j.settlement_id, events);
          await finishJob(client, j, events, rand);
          await promoteNext(client, j.settlement_id, j.citizen_id, Date.parse(j.completes_at));
        }
      }
    });
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return;
    console.error('[crafting] resolve failed:', e.message);
    return;
  }
  for (const [s, events] of bySid) careers.publish(s, events);
}

async function finishJob(client, j, events, rand) {
  const sid = j.settlement_id, snap = j.recipe_snapshot;
  const cls = C.CLASSES[snap.class_key];
  const c = (await client.query('SELECT * FROM citizens WHERE id = $1', [j.citizen_id])).rows[0];
  const row = (await client.query('SELECT * FROM citizen_classes WHERE citizen_id = $1 AND class_key = $2', [j.citizen_id, snap.class_key])).rows[0] || null;
  const working = c && c.role === snap.class_key && (c.life_stage || 'adult') === 'adult';
  const profile = working ? (await careers.profilesFor(null, sid)).get(c.id) : null;
  const stLevel = await stationLevel(client, sid, snap.station);
  const bench = benchOf(profile, cls, row, stLevel);
  // Butterfingers: now and then the piece is ruined (materials lost).
  const butter = c && arr(c.hidden_traits).includes('butterfingers');
  if (butter && rand() < RUIN_CHANCE) {
    await client.query("UPDATE craft_jobs SET status = 'ruined', finished_at = NOW() WHERE id = $1", [j.id]);
    events.push({ type: 'craft_done', citizen_id: j.citizen_id, name: c.name, ruined: true, recipe: snap.name, station: snap.station });
    return;
  }
  const score = scoreFor(bench, snap);
  let quality = M.rollQuality(score, snap.quality_cap, bench.level, rand());
  const named = j.options && j.options.named;
  if (named && M.QUALITIES.indexOf(quality) < 3) quality = 'superior';
  const tpl = (await client.query('SELECT * FROM item_templates WHERE item_key = $1', [snap.output_key])).rows[0];
  if (!tpl) {   // template deleted since queuing: give the materials back
    await refund(client, sid, j.reserved);
    await client.query("UPDATE craft_jobs SET status = 'cancelled', finished_at = NOW() WHERE id = $1", [j.id]);
    return;
  }
  const settlement = (await client.query('SELECT name FROM settlements WHERE id = $1', [sid])).rows[0] || {};
  const item = craftedItem(tpl, quality, {
    citizen: c, settlementName: settlement.name, recipeKey: j.recipe_key, named,
    guardian: tpl.equip_slot === 'armour' && row && row.spec === 'armorer' && row.level >= M.MAX_LEVEL && M.QUALITIES.indexOf(quality) >= 3 && rand() < GUARDIAN_CHANCE,
    midas: row && row.spec === 'goldsmith' && row.level >= M.MAX_LEVEL,
  });
  const granted = await inventory.grantItem((t, p) => client.query(t, p), sid, { ...item, quantity: snap.output_qty || 1, source: 'crafted' });
  // Thrifty Smelting & co.: sometimes the resources go further.
  let saved = false;
  if (bench.refund > 0 && rand() < bench.refund) {
    saved = true;
    await refund(client, sid, { resources: (j.reserved || {}).resources });
  }
  // XP: ×quality, ×2 the first time this citizen makes it.
  const first = (await client.query(
    `INSERT INTO citizen_recipes (citizen_id, recipe_key, count) VALUES ($1, $2, 1)
     ON CONFLICT (citizen_id, recipe_key) DO UPDATE SET count = citizen_recipes.count + 1 RETURNING (xmax = 0) AS fresh`,
    [j.citizen_id, j.recipe_key])).rows[0].fresh;
  const xp = (snap.base_xp || 0) * M.QUALITY_XP_MULT[quality] * (first ? 2 : 1) * (1 + (bench.xp || 0));
  if (c && (c.life_stage || 'adult') !== 'deceased') {
    await careers.grantXp(client, sid, [{ citizenId: c.id, classKey: snap.class_key, xp }], events);
    if (M.QUALITIES.indexOf(quality) >= 3) await careers.bumpCounter(client, sid, c.id, 'masterworks', 1, events);
  }
  await client.query(
    `UPDATE craft_jobs SET status = 'done', finished_at = NOW(), quality = $2, roll = $3, result_item_id = $4, xp_awarded = $5 WHERE id = $1`,
    [j.id, quality, JSON.stringify({ score, item: { name: item.name, icon: item.icon, quality }, saved, first }),
     granted && granted.item ? granted.item.id : null, Math.round(xp * 100) / 100]);
  events.push({ type: 'craft_done', citizen_id: j.citizen_id, name: c ? c.name : 'A crafter', station: snap.station,
    item: { name: item.name, icon: item.icon, quality }, first, saved, named: !!named, guardian: !!item.metadata.guardian });
}

// The item a crafter made: quality in the name, bonuses and value scaled,
// and the crafter's mark.
function craftedItem(tpl, quality, o) {
  const sm = M.QUALITY_STAT_MULT[quality], vm = M.QUALITY_VALUE_MULT[quality] * (o.midas ? 1 + MIDAS : 1);
  const bonuses = {};
  for (const [k, v] of Object.entries(tpl.stat_bonuses || {})) bonuses[k] = Math.max(1, Math.round(Number(v) * sm));
  if (o.named) bonuses.combat = (bonuses.combat || 0) + 1;
  const prefix = quality === 'basic' ? '' : M.QUALITY_LABEL[quality] + ' ';
  const name = o.named ? `${o.named}` : `${tpl.equip_slot ? prefix : ''}${tpl.name}`;
  const metadata = {
    sell_value: Math.round((Number(tpl.sell_value) || 1) * (tpl.equip_slot ? vm : 1)),
    food_value: tpl.food_value, armor_class: tpl.armor_class, damage_dice: tpl.damage_dice,
    quality: tpl.equip_slot ? quality : 'basic', recipe_key: o.recipeKey, crafted_at: new Date().toISOString(),
    crafted_by: o.citizen ? { citizen_id: o.citizen.id, name: o.citizen.name, settlement_name: o.settlementName || '' } : null,
  };
  if (o.named) { metadata.named = true; metadata.base_name = tpl.name; }
  if (o.guardian) metadata.guardian = true;
  return {
    item_key: tpl.item_key, name, description: tpl.description || '', icon: tpl.icon || '📦', category: tpl.category || 'misc',
    rarity: tpl.rarity || 'common', equip_slot: tpl.equip_slot || null, stat_bonuses: tpl.equip_slot ? bonuses : (tpl.stat_bonuses || {}),
    metadata, tradeable: tpl.tradeable !== false,
  };
}

// Who is crafting (busy at the bench): ids with queued or active jobs.
async function busyCitizenIds(ids) {
  if (!ids || !ids.length) return [];
  const r = await query("SELECT DISTINCT citizen_id FROM craft_jobs WHERE status IN ('queued','active') AND citizen_id = ANY($1::int[])",
    [ids.map(Number)]).catch(() => ({ rows: [] }));
  return r.rows.map(x => x.citizen_id);
}

// Worker probe: cheap, resolve only when something is due.
async function tick() {
  try {
    const due = await query("SELECT 1 FROM craft_jobs WHERE status = 'active' AND completes_at <= NOW() LIMIT 1");
    if (due.rowCount) await resolveDue(null);
  } catch (e) {
    if (e && e.code === '42P01') return;
    console.error('[crafting] tick failed:', e.message);
  }
}

// ── Dev Tools: recipes ─────────────────────────────────────────────────────

const RECIPE_FIELDS = ['name', 'class_key', 'spec', 'station', 'min_level', 'min_station_level', 'inputs', 'output_key', 'output_qty',
  'base_seconds', 'base_xp', 'unlock_node', 'quality_cap', 'archived', 'sort_order'];
function cleanRecipe(b, partial) {
  const out = {};
  for (const f of RECIPE_FIELDS) if (b[f] !== undefined) out[f] = b[f];
  if (!partial) for (const f of ['name', 'class_key', 'station', 'output_key']) if (!out[f]) throw new CraftError(400, `${f} is required.`);
  if (out.class_key && !STATION_OF[out.class_key]) throw new CraftError(400, 'class_key must be blacksmith, jeweller or carpenter.');
  if (out.station && !STATIONS[out.station]) throw new CraftError(400, 'station must be smithy, jeweller or workshop.');
  if (out.quality_cap && !M.QUALITIES.includes(out.quality_cap)) throw new CraftError(400, 'Bad quality cap.');
  if (out.inputs !== undefined) {
    const i = typeof out.inputs === 'string' ? JSON.parse(out.inputs || '{}') : out.inputs;
    for (const k of Object.keys(i.resources || {})) if (!RESOURCES.includes(k)) throw new CraftError(400, `Unknown resource ${k}.`);
    out.inputs = JSON.stringify({ resources: i.resources || {}, items: arr(i.items).map(x => ({ item_key: String(x.item_key), qty: Math.max(1, Number(x.qty) || 1) })) });
  }
  for (const f of ['min_level', 'min_station_level', 'output_qty', 'base_seconds', 'base_xp', 'sort_order']) if (out[f] !== undefined) out[f] = Math.max(0, Math.floor(Number(out[f]) || 0));
  if (out.spec === '') out.spec = null;
  if (out.unlock_node === '') out.unlock_node = null;
  return out;
}
async function saveRecipe(key, body, isNew) {
  const r = cleanRecipe(body, !isNew);
  if (r.output_key) {
    const t = await query('SELECT 1 FROM item_templates WHERE item_key = $1', [r.output_key]);
    if (!t.rowCount) throw new CraftError(400, 'No item with that key.');
  }
  const cols = Object.keys(r);
  if (isNew) {
    if (!/^[a-z0-9_]{2,40}$/.test(key || '')) throw new CraftError(400, 'Key: 2–40 lowercase letters, digits, underscores.');
    await query(`INSERT INTO recipes (recipe_key, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => '$' + (i + 2)).join(', ')})`, [key, ...cols.map(c => r[c])]);
  } else {
    if (!cols.length) return;
    const u = await query(`UPDATE recipes SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE recipe_key = $1`, [key, ...cols.map(c => r[c])]);
    if (!u.rowCount) throw new CraftError(404, 'No such recipe.');
  }
}

module.exports = {
  STATIONS, STATION_OF, MAX_QUEUE, CraftError, weekNo,
  recipes, blocker, benchOf, stationState, queueJobs, cancelJob, resolveDue, craftedItem, busyCitizenIds, tick, saveRecipe,
};
