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
//
//  Hidden recipes (recipes.discovery = 'hidden') must be learned by the
//  town first (settlement_recipes): a crafter discovers one now and then
//  while working, or someone studies its schematic (item schematic_<key>,
//  from villages, quests and expeditions). Once learned, every crafter of
//  that class in the town can make it.
//
//  Auto-listing: a job queued with options.list = { markup } goes on a
//  stall when it's done, at the 7-day average for that item and quality
//  (3+ trades) else its crafted value, plus the markup. If no stall can
//  take it, it stays in the stores and craft_done says why.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query, withTransaction } = require('../db');
const eventBus = require('./event_bus');
const M = require('./career_math');
const C = require('./careers/classes');
const careers = require('./careers');
const inventory = require('./inventory');
const RD = require('./resource_defs');
const RS = require('./research_defs');
const { T } = require('./tuning');
const research = require('./research');

const STATIONS = { smithy: 'blacksmith', jeweller: 'jeweller', workshop: 'carpenter', smelter: 'smelter' };
const STATION_OF = Object.fromEntries(Object.entries(STATIONS).map(([s, c]) => [c, s]));
const MAX_QUEUE = 5;
const RESOURCES = RD.KEYS;
const RUIN_CHANCE = 0.03;          // Butterfingers
const GUARDIAN_CHANCE = 0.5;       // Bulwark, on Superior+ armour
const MIDAS = 0.15;
const MARKUPS = [0, 0.1, 0.25, 0.5];
const HIDDEN_MSG = 'Not known yet — study its schematic or discover it while crafting.';
// Discovery while crafting: base, per intelligence point over 8, Genius, cap.
const DISCOVER = { base: 0.02, perInt: 0.0025, genius: 0.01, max: 0.06, levelsAhead: 2 };
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
// known: Set of the hidden recipes this town has learned; done: Set of
// finished research projects (recipes.research).
function blocker(recipe, cit, row, stLevel, known, done) {
  if (recipe.research && !(done && done.has(recipe.research))) return `Needs ${RS.labelFor(recipe.research, done) === RS.UNKNOWN_RESEARCH ? RS.UNKNOWN_RESEARCH : 'research: ' + RS.label(recipe.research)}.`;
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
  if (recipe.discovery === 'hidden' && !(known && known.has(recipe.recipe_key))) return HIDDEN_MSG;
  return null;
}

// ── Recipes the town has learned ───────────────────────────────────────────

async function knownSet(db, sid) {
  const r = await (db || { query }).query('SELECT recipe_key FROM settlement_recipes WHERE settlement_id = $1', [sid]).catch(() => ({ rows: [] }));
  return new Set(r.rows.map(x => x.recipe_key));
}
// → true when the town didn't know it before.
async function learnRecipe(db, sid, recipeKey, source, citizenId = null) {
  const r = await db.query(
    `INSERT INTO settlement_recipes (settlement_id, recipe_key, source, citizen_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (settlement_id, recipe_key) DO NOTHING`, [sid, recipeKey, source, citizenId]);
  return r.rowCount > 0;
}
const SCHEMATIC_PREFIX = 'schematic_';
// The schematic item for a hidden recipe (same rule as the migration).
async function ensureSchematic(db, recipe) {
  const lv = Number(recipe.min_level) || 1;
  const rarity = lv < 8 ? 'uncommon' : lv < 14 ? 'rare' : 'epic';
  await db.query(
    `INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value)
     VALUES ($1, $2, $3, '📜', 'schematic', $4, $5, 'basic', NULL, '{}', $6) ON CONFLICT (item_key) DO NOTHING`,
    [SCHEMATIC_PREFIX + recipe.recipe_key, 'Schematic: ' + recipe.name, `Study it and your town's crafters can make ${recipe.name}.`,
     rarity, { uncommon: 2, rare: 3, epic: 4 }[rarity], 20 + 6 * lv]);
}

// Study a schematic from the inventory: the whole town learns its recipe.
async function studySchematic(sid, invId) {
  const events = [];
  const out = await withTransaction(async client => {
    const it = (await client.query('SELECT * FROM inventory_items WHERE id = $1 AND settlement_id = $2 FOR UPDATE', [invId, sid])).rows[0];
    if (!it) throw new CraftError(404, 'That item is not in your stores.');
    if (!String(it.item_key).startsWith(SCHEMATIC_PREFIX)) throw new CraftError(400, 'Only schematics can be studied.');
    const recipe = (await client.query("SELECT * FROM recipes WHERE recipe_key = $1 AND NOT archived", [it.item_key.slice(SCHEMATIC_PREFIX.length)])).rows[0];
    if (!recipe) throw new CraftError(404, 'Nobody can make sense of this schematic any more.');
    if (recipe.discovery !== 'hidden' || (await knownSet(client, sid)).has(recipe.recipe_key)) {
      throw new CraftError(409, `Your town already knows how to make ${recipe.name} — sell the schematic instead.`);
    }
    if (it.quantity > 1) await client.query('UPDATE inventory_items SET quantity = quantity - 1 WHERE id = $1', [it.id]);
    else await client.query('DELETE FROM inventory_items WHERE id = $1', [it.id]);
    await learnRecipe(client, sid, recipe.recipe_key, 'schematic');
    const cls = C.CLASSES[recipe.class_key] || {};
    events.push({ type: 'recipe_learned', recipe: recipe.name, recipe_key: recipe.recipe_key, station: recipe.station, source: 'schematic' });
    return { recipe: recipe.name, recipe_key: recipe.recipe_key, class_label: cls.label, station: recipe.station, spec: recipe.spec };
  });
  careers.publish(sid, events);
  return out;
}

// A random schematic for loot (quests, expeditions): lower levels likelier.
async function randomSchematic(db, rand = Math.random) {
  const rows = (await (db || { query }).query(
    `SELECT r.recipe_key, r.min_level, t.* FROM recipes r JOIN item_templates t ON t.item_key = 'schematic_' || r.recipe_key
      WHERE r.discovery = 'hidden' AND NOT r.archived ORDER BY r.recipe_key`).catch(() => ({ rows: [] }))).rows;
  if (!rows.length) return null;
  const w = rows.map(r => 1 / Math.max(1, Number(r.min_level) || 1));
  let u = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rows.length; i++) { u -= w[i]; if (u <= 0) return rows[i]; }
  return rows[rows.length - 1];
}
// Grant one random schematic → its template (or null).
async function grantRandomSchematic(db, sid, rand = Math.random, source = 'loot') {
  const t = await randomSchematic(db, rand);
  if (!t) return null;
  await inventory.grantItem((q, p) => db.query(q, p), sid, {
    item_key: t.item_key, name: t.name, description: t.description, icon: t.icon, category: t.category, rarity: t.rarity,
    quantity: 1, source, metadata: { sell_value: t.sell_value }, tradeable: true,
  });
  return t;
}
const STATION_LABEL = s => { const { BUILDINGS } = require('../buildings'); return (BUILDINGS[s] && BUILDINGS[s].label) || s; };

// What a crafter brings to the bench: { score parts, speed, statMult }.
// town: the town's research for this workshop (townCraft): + speed, quality, xp.
function benchOf(p, cls, row, stLevel, town) {
  const eff = (p && p.classKey === cls.key) ? p.effects : {};
  const t = town || {};
  return {
    level: row ? row.level : 1,
    primary: p ? p.stats[cls.primary] : M.STAT_CENTRE,
    quality: M.eff(eff, 'quality') + (t.quality || 0),
    tool: Math.max(0, M.eff(p ? p.effects : {}, 'skill', 'crafting')),
    station: stLevel,
    speed: M.eff(eff, 'craft_speed') + (t.speed || 0),
    statMult: p ? p.statMult : 1,
    refund: M.eff(eff, 'refund'),
    xp: M.eff(eff, 'xp') + (t.xp || 0),
  };
}
// Research effects on crafting at one workshop (Hotter Furnaces, Swift
// Benches, Guild Marks, Apprenticeship…). done: Set of finished projects.
function townCraft(done, station) {
  const e = RS.effectsOf(done);
  return { speed: (e.craft_speed || 0) + (e['craft_speed:' + station] || 0), quality: e.quality || 0, xp: e.craft_xp || 0 };
}
const scoreFor = (bench, recipe) => M.qualityScore({ ...bench, minLevel: recipe.min_level });
const secondsFor = (bench, recipe) => M.craftSeconds(recipe.base_seconds, bench.speed, bench.statMult);

// ── Station view ───────────────────────────────────────────────────────────

async function stationState(sid, station) {
  const classKey = STATIONS[station];
  if (!classKey) throw new CraftError(404, 'No such workshop.');
  await resolveDue(sid);
  return careers.withStateCache(() => stationView(sid, station, classKey));
}
async function stationView(sid, station, classKey) {
  const { BUILDINGS } = require('../buildings');
  const level = await stationLevel(null, sid, station);
  const state = await careers.loadState(null, sid);
  const profiles = await careers.profilesFor(null, sid);
  const cls = C.CLASSES[classKey];
  const crafters = state.citizens.filter(c => c.role === classKey && (c.life_stage || 'adult') === 'adult');
  const rowOf = cid => state.classRows.find(r => r.citizen_id === cid && r.class_key === classKey) || null;
  const all = (await recipes()).filter(r => r.class_key === classKey);
  const known = await knownSet(null, sid);
  const done = await research.doneSet(null, sid);
  const jobs = (await query(
    `SELECT j.*, c.name AS citizen_name FROM craft_jobs j JOIN citizens c ON c.id = j.citizen_id
      WHERE j.settlement_id = $1 AND j.station = $2 AND (j.status IN ('queued','active') OR j.finished_at > NOW() - interval '24 hours')
      ORDER BY (j.status = 'active') DESC, (j.status = 'queued') DESC, j.position, j.id DESC LIMIT 60`, [sid, station])).rows;
  const res = (await query(`SELECT ${RD.KEYS.join(', ')} FROM settlements WHERE id = $1`, [sid])).rows[0];
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
    discovered: await require('./resources').discoveredKeys(null, sid),
    research_done: [...done].filter(k => RS.project(k)),
    templates: tpl,
    // A recipe's research is named only once the town can see that project.
    recipes: all.map(r => ({ ...r, research: r.research && RS.labelFor(r.research, done) === RS.UNKNOWN_RESEARCH ? null : r.research,
      research_label: r.research && !done.has(r.research) ? RS.labelFor(r.research, done) : null,
      output: tpl[r.output_key] || resourceOutput(r) || null, hidden: r.discovery === 'hidden', known: r.discovery !== 'hidden' || known.has(r.recipe_key) })),
    crafters: crafters.map(c => {
      const row = rowOf(c.id), bench = benchOf(profiles.get(c.id), cls, row, level, townCraft(done, station));
      return {
        id: c.id, name: c.name, level: bench.level, spec: row ? row.spec : null,
        bench, named_ready: namedReady(c, row),
        can: Object.fromEntries(all.map(r => [r.recipe_key, blocker(r, c, row, level, known, done)])),
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
    listed: (j.roll && j.roll.listed) || null, list_failed: (j.roll && j.roll.list_failed) || null, discovered: (j.roll && j.roll.discovered) || null,
  };
}

// Named Blade: a Lv20 Weaponsmith, once a week.
function namedReady(c, row) {
  return !!(row && row.spec === 'weaponsmith' && row.level >= M.MAX_LEVEL && Number((row.counters || {}).named_week) !== weekNo());
}

// ── Queue ──────────────────────────────────────────────────────────────────

// list: { markup } — put each piece on a stall when it's done.
async function queueJobs(sid, { citizenId, recipeKey, qty = 1, name = null, list = null }) {
  qty = Math.floor(Number(qty) || 0);
  if (qty < 1 || qty > MAX_QUEUE) throw new CraftError(400, `Queue 1–${MAX_QUEUE} at a time.`);
  if (list && !MARKUPS.includes(Number(list.markup))) throw new CraftError(400, 'Markup must be 0, 10, 25 or 50%.');
  const events = [];
  const out = await withTransaction(async client => {
    await client.query('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [sid]);
    const c = (await client.query('SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2 FOR UPDATE', [citizenId, sid])).rows[0];
    if (!c || (c.life_stage || 'adult') !== 'adult') throw new CraftError(404, 'Crafter not found.');
    const recipe = (await client.query('SELECT * FROM recipes WHERE recipe_key = $1 AND NOT archived', [recipeKey])).rows[0];
    if (!recipe) throw new CraftError(404, 'Unknown recipe.');
    const row = (await client.query('SELECT * FROM citizen_classes WHERE citizen_id = $1 AND class_key = $2 FOR UPDATE', [c.id, recipe.class_key])).rows[0] || null;
    const stLevel = await stationLevel(client, sid, recipe.station);
    const done = await research.doneSet(client, sid);
    const why = blocker(recipe, c, row, stLevel, await knownSet(client, sid), done);
    if (why) throw new CraftError(400, why);
    if (list) {
      const out = (await client.query('SELECT equip_slot FROM item_templates WHERE item_key = $1', [recipe.output_key])).rows[0];
      if (!out || !out.equip_slot) throw new CraftError(400, 'Only equipment can go straight to a stall.');
    }
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
      if (!took.rowCount) throw new CraftError(400, `Not enough ${RD.label(k).toLowerCase()} — ${v * qty} needed.`);
    }
    const usedItems = [];
    for (const it of arr(inputs.items)) {
      try { usedItems.push({ item_key: it.item_key, per: Number(it.qty) || 1, used: await inventory.consumeItemsByKey(client, sid, it.item_key, (Number(it.qty) || 1) * qty) }); }
      catch (e) { throw new CraftError(e.status || 400, e.message); }
    }
    const profile = (await careers.profilesFor(null, sid)).get(c.id);
    const bench = benchOf(profile, C.CLASSES[recipe.class_key], row, stLevel, townCraft(done, recipe.station));
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
         JSON.stringify({ resources: resNeed, items }),
         JSON.stringify({ ...(named ? { named } : {}), ...(list ? { list: { markup: Number(list.markup) } } : {}) }), ...(active ? [secs] : [])]);
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
  const bench = benchOf(c && c.role === snap.class_key ? profile : null, C.CLASSES[snap.class_key], row, await stationLevel(client, sid, snap.station),
    townCraft(await research.doneSet(client, sid), snap.station));
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
    // One careers load per settlement for the whole pass (see withStateCache).
    await careers.withStateCache(() => withTransaction(async client => {
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
    }));
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
  const bench = benchOf(profile, cls, row, stLevel, townCraft(await research.doneSet(client, sid), snap.station));
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
  // The Smelter makes resources (bronze, steel), not items.
  if (RD.isResource(snap.output_key)) return finishResourceJob(client, j, events, rand, { c, row, bench, working, profile });
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
  const xp = (snap.base_xp || 0) * M.QUALITY_XP_MULT[quality] * (first ? 2 : 1) * (1 + (bench.xp || 0)) * T('craft_xp');
  if (c && (c.life_stage || 'adult') !== 'deceased') {
    await careers.grantXp(client, sid, [{ citizenId: c.id, classKey: snap.class_key, xp }], events);
    if (M.QUALITIES.indexOf(quality) >= 3) await careers.bumpCounter(client, sid, c.id, 'masterworks', 1, events);
  }
  // Straight to a stall, if asked.
  let listed = null, listFailed = null;
  const L = j.options && j.options.list;
  if (L && tpl.equip_slot && granted && granted.item) {
    const unit = await autoPrice(item, quality, L.markup);
    await client.query('SAVEPOINT craft_list');
    try {
      const o = await require('./market').listItemStallIn(client, sid, { item, invId: granted.item.id, qty: 1, unit });
      await client.query('RELEASE SAVEPOINT craft_list');
      listed = { price: unit, venue: o.venue, order_id: o.id };
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT craft_list');
      listFailed = (e && e.message) || 'No stall could take it.';
    }
  }
  // Now and then a crafter works out a recipe the town didn't know.
  const discovered = working && profile ? await maybeDiscover(client, sid, c, row, profile, rand) : null;
  if (discovered) events.push({ type: 'recipe_discovered', citizen_id: c.id, name: c.name, recipe: discovered.name, recipe_key: discovered.recipe_key, station: discovered.station });
  await client.query(
    `UPDATE craft_jobs SET status = 'done', finished_at = NOW(), quality = $2, roll = $3, result_item_id = $4, xp_awarded = $5 WHERE id = $1`,
    [j.id, quality, JSON.stringify({ score, item: { name: item.name, icon: item.icon, quality }, saved, first, listed, list_failed: listFailed,
      discovered: discovered ? discovered.name : null }),
     granted && granted.item ? granted.item.id : null, Math.round(xp * 100) / 100]);
  events.push({ type: 'craft_done', citizen_id: j.citizen_id, name: c ? c.name : 'A crafter', station: snap.station,
    item: { name: item.name, icon: item.icon, quality }, first, saved, named: !!named, guardian: !!item.metadata.guardian,
    listed, list_failed: listFailed });
}

// A resource recipe (the Smelter): no quality roll — the yield goes to the
// stores, the first batch of a new alloy is a discovery, XP as usual.
async function finishResourceJob(client, j, events, rand, { c, row, bench, working, profile }) {
  const sid = j.settlement_id, snap = j.recipe_snapshot, key = snap.output_key;
  const qty = Math.max(1, Number(snap.output_qty) || 1);
  await client.query(`UPDATE settlements SET ${key} = ${key} + $2 WHERE id = $1`, [sid, qty]);
  const isNew = await require('./resources').discover(client, sid, key, 'smelter');
  let saved = false;
  if (bench.refund > 0 && rand() < bench.refund) {
    saved = true;
    await refund(client, sid, { resources: (j.reserved || {}).resources });
  }
  const first = (await client.query(
    `INSERT INTO citizen_recipes (citizen_id, recipe_key, count) VALUES ($1, $2, 1)
     ON CONFLICT (citizen_id, recipe_key) DO UPDATE SET count = citizen_recipes.count + 1 RETURNING (xmax = 0) AS fresh`,
    [j.citizen_id, j.recipe_key])).rows[0].fresh;
  const xp = (snap.base_xp || 0) * (first ? 2 : 1) * (1 + (bench.xp || 0)) * T('craft_xp');
  if (c && (c.life_stage || 'adult') !== 'deceased') await careers.grantXp(client, sid, [{ citizenId: c.id, classKey: snap.class_key, xp }], events);
  const discovered = working && profile ? await maybeDiscover(client, sid, c, row, profile, rand) : null;
  if (discovered) events.push({ type: 'recipe_discovered', citizen_id: c.id, name: c.name, recipe: discovered.name, recipe_key: discovered.recipe_key, station: discovered.station });
  const item = { name: `${qty} ${RD.label(key).toLowerCase()}`, icon: RD.icon(key), quality: 'basic' };
  await client.query(
    `UPDATE craft_jobs SET status = 'done', finished_at = NOW(), quality = 'basic', roll = $2, xp_awarded = $3 WHERE id = $1`,
    [j.id, JSON.stringify({ item, resource: key, qty, saved, first, new_resource: isNew, discovered: discovered ? discovered.name : null }), Math.round(xp * 100) / 100]);
  events.push({ type: 'craft_done', citizen_id: j.citizen_id, name: c ? c.name : 'A smelter', station: snap.station,
    item, resource: key, qty, first, saved, new_resource: isNew });
}

// What a resource recipe makes, shaped like an item template for the panel.
function resourceOutput(r) {
  if (!RD.isResource(r.output_key)) return null;
  return { item_key: r.output_key, name: RD.label(r.output_key), icon: RD.icon(r.output_key), resource: true, rarity: 'common', stat_bonuses: {} };
}

// Stall price for a freshly made piece: the 7-day average for this item at
// this quality once there are enough trades, else its own value; + markup.
async function autoPrice(item, quality, markup) {
  let base = Number(item.metadata && item.metadata.sell_value) || 1;
  try {
    const ledger = require('./market_ledger');
    const key = `item:${item.item_key}:${quality || 'basic'}`;
    const p = (await ledger.priceHistory(ledger.parseGoods(key), 7))[key];
    if (p && p.week && p.week.n >= ledger.GUIDE_MIN_TRADES && p.week.avg) base = p.week.avg;
  } catch (_) { /* no price history: its value */ }
  return Math.max(1, Math.round(base * (1 + (Number(markup) || 0))));
}

// Roll for a discovery: a hidden recipe of this class the town doesn't know,
// on this crafter's path (or trunk), at most a couple of levels beyond them.
async function maybeDiscover(client, sid, c, row, profile, rand) {
  const level = row ? row.level : 1;
  const pool = (await client.query(
    `SELECT * FROM recipes r WHERE r.class_key = $1 AND r.discovery = 'hidden' AND NOT r.archived AND r.min_level <= $2
        AND (r.spec IS NULL OR r.spec = $3)
        AND NOT EXISTS (SELECT 1 FROM settlement_recipes k WHERE k.settlement_id = $4 AND k.recipe_key = r.recipe_key)
      ORDER BY r.recipe_key`, [c.role, level + DISCOVER.levelsAhead, row ? row.spec : null, sid])).rows;
  if (!pool.length) return null;
  const intel = Number(profile.stats && profile.stats.intelligence) || M.STAT_CENTRE;
  const chance = Math.min(DISCOVER.max, DISCOVER.base + DISCOVER.perInt * Math.max(0, intel - M.STAT_CENTRE)
    + (arr(c.visible_traits).includes('genius') ? DISCOVER.genius : 0)) * T('discovery');
  if (rand() >= chance) return null;
  const r = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  await learnRecipe(client, sid, r.recipe_key, 'discovery', c.id);
  return r;
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
  // Effects (a shield's lower injury risk, a cart's carry) scale with quality too.
  if (tpl.equip_slot && Array.isArray(tpl.item_effects) && tpl.item_effects.length) {
    metadata.item_effects = tpl.item_effects.map(e => {
      const def = M.EFFECTS[e.type] || {};
      const v = Number(e.value) * sm;
      return { ...e, value: def.kind === 'pct' ? Math.round(v * 100) / 100 : Math.round(v) };
    });
  }
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
  'base_seconds', 'base_xp', 'unlock_node', 'quality_cap', 'archived', 'sort_order', 'discovery', 'research'];
function cleanRecipe(b, partial) {
  const out = {};
  for (const f of RECIPE_FIELDS) if (b[f] !== undefined) out[f] = b[f];
  if (!partial) for (const f of ['name', 'class_key', 'station', 'output_key']) if (!out[f]) throw new CraftError(400, `${f} is required.`);
  if (out.class_key && !STATION_OF[out.class_key]) throw new CraftError(400, `class_key must be ${Object.keys(STATION_OF).join(', ')}.`);
  if (out.station && !STATIONS[out.station]) throw new CraftError(400, `station must be ${Object.keys(STATIONS).join(', ')}.`);
  if (out.research === '') out.research = null;
  if (out.research && !RS.project(out.research)) throw new CraftError(400, `research must be one of ${RS.KEYS.join(', ')}.`);
  if (out.quality_cap && !M.QUALITIES.includes(out.quality_cap)) throw new CraftError(400, 'Bad quality cap.');
  if (out.discovery !== undefined && !['known', 'hidden'].includes(out.discovery)) throw new CraftError(400, 'discovery must be known or hidden.');
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
  if (r.output_key && !RD.isResource(r.output_key)) {
    const t = await query('SELECT 1 FROM item_templates WHERE item_key = $1', [r.output_key]);
    if (!t.rowCount) throw new CraftError(400, 'No item or resource with that key.');
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
  // A hidden recipe needs its schematic.
  const saved = (await query('SELECT * FROM recipes WHERE recipe_key = $1', [key])).rows[0];
  if (saved && saved.discovery === 'hidden') await ensureSchematic({ query }, saved);
}

// Dev Tools: teach a hidden recipe to a town.
async function teachRecipe(sid, key) {
  const r = (await query('SELECT * FROM recipes WHERE recipe_key = $1', [key])).rows[0];
  if (!r) throw new CraftError(404, 'No such recipe.');
  return learnRecipe({ query }, sid, key, 'admin');
}

module.exports = {
  STATIONS, STATION_OF, MAX_QUEUE, CraftError, weekNo,
  recipes, blocker, benchOf, townCraft, stationState, queueJobs, cancelJob, resolveDue, craftedItem, busyCitizenIds, tick, saveRecipe,
  MARKUPS, DISCOVER, SCHEMATIC_PREFIX, knownSet, learnRecipe, ensureSchematic, studySchematic, randomSchematic, grantRandomSchematic,
  teachRecipe, autoPrice,
};
