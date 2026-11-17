'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  Upkeep: building health (docs/HOME_SCENE.md Part E).
//
//  Every building and every home has health, 0 to 100. Builders look after
//  the town: each covers 8 buildings. Buildings nobody covers wear, the least
//  important first, from sound to broken in 5 real days. A broken building
//  (health 0) gives nothing until it is mended; a worn one (under 60) still
//  works. Builders mend the most damaged first whenever their queue is empty,
//  1 health per builder-minute, and the player can put a repair at the front
//  of the queue ("Repair now"). No materials. Nothing is ever destroyed.
//
//  It is the one rule that can take something from a player, so it is slow,
//  said out loud, and fully recoverable; camps are exempt; a broken house
//  keeps its beds. Off unless the town's own switch (settlements.upkeep_on)
//  or the tuning switch `upkeep.on` is on.
//
//    enabled(settlement)         on for this town (never for a Camp)
//    rank(units)                 least important first (pure)
//    plan(units, builders, per)  who is covered and who wears (pure)
//    step(units, o)              wear, then repair, over some minutes (pure)
//    stateOf(health)             'sound' | 'worn' | 'broken' (pure)
//    work(sid, now)              does it for a town (under its row lock)
//    tick()                      every town it is on for, once a minute
//    status(sid)                 the town card's line
//    repairNow(sid, target)      a repair at the front of the builders' queue
//    setTown / setHealth         Dev Tools
// ══════════════════════════════════════════════════════════════════════════
const { query, withTransaction } = require('../db');
const { BUILDINGS } = require('../buildings');
const TU = require('./tuning');

const CONFIG = {
  get PER_BUILDER() { return TU.value('UPKEEP_PER_BUILDER') ?? TU.LIFE_KEYS.UPKEEP_PER_BUILDER.default; },
  get DAYS_TO_BREAK() { return TU.value('UPKEEP_DAYS_TO_BREAK') ?? TU.LIFE_KEYS.UPKEEP_DAYS_TO_BREAK.default; },
  WORN_BELOW: 60,
  REPAIR_PER_MINUTE: 1,      // health per builder-minute
  TICK_MS: 60000,
  // The worker shares one loop with everything else in the game, so each
  // pass does a few towns, the longest-waiting first. Wear takes days, and
  // the work is done from the clock, so a town looked at every hour or two
  // loses nothing (reading the town card does it at once for its own town).
  TICK_TOWNS: 5, TICK_EVERY_MIN: 10,
  // The first to wear when builders are short. Homes come after every
  // building in this list and the Granary last of all, so beds and food are
  // the last things a neglected town loses.
  ORDER: ['jeweller', 'guild_hall', 'library', 'tavern', 'market', 'watchtower', 'walls', 'smelter', 'smithy', 'workshop', 'scout_post', 'mine', 'fishing_post', 'lumber_camp', 'farm', 'forager_hut'],
  LAST: 'granary',
};
const HOUSING = 'starter_house';
const EXEMPT_TIER = 'camp';

class UpkeepError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// ── Pure rules ─────────────────────────────────────────────────────────────
const stateOf = h => (Number(h) <= 0 ? 'broken' : Number(h) < CONFIG.WORN_BELOW ? 'worn' : 'sound');
// Least important first. units: [{ kind: 'building' | 'house', id, type?, … }].
function rank(units) {
  const place = u => {
    if (u.kind === 'house') return CONFIG.ORDER.length + 1;
    if (u.type === CONFIG.LAST) return CONFIG.ORDER.length + 2;
    const i = CONFIG.ORDER.indexOf(u.type);
    return i < 0 ? CONFIG.ORDER.length : i;   // something new: just before the homes
  };
  // Among homes the newest wears first (the highest id).
  return units.slice().sort((a, b) => place(a) - place(b) || (a.kind === 'house' ? b.id - a.id : a.id - b.id));
}
// Builders × per-builder buildings are covered, the most important ones;
// the rest wear. → { covered, total, wearing: [units, least important first] }
function plan(units, builders, perBuilder) {
  const order = rank(units), cover = Math.max(0, Math.floor(builders) * perBuilder);
  const wearing = order.slice(0, Math.max(0, order.length - cover));
  return { covered: order.length - wearing.length, total: order.length, wearing };
}
// What `minutes` do. Wear first: each uncovered building loses
// 100 / (daysToBreak × 1440) a minute. Then repair, when the builders are
// free: `repair` health points (builder-minutes), the most damaged first.
// → { units: [{ …, health }], broke: [units], mended: [units], spent }
function step(units, { wearing = [], minutes = 0, daysToBreak = 5, repair = 0 } = {}) {
  const key = u => u.kind + ':' + u.id;
  const wear = new Set(wearing.map(key));
  const per = minutes > 0 ? 100 / (daysToBreak * 1440) * minutes : 0;
  const out = units.map(u => ({ ...u, was: Number(u.health), health: Number(u.health) }));
  for (const u of out) if (wear.has(key(u)) && per > 0) u.health = Math.max(0, u.health - per);
  let left = Math.max(0, repair), spent = 0;
  for (const u of out.slice().sort((a, b) => a.health - b.health || a.id - b.id)) {
    if (left <= 0) break;
    const need = 100 - u.health;
    if (need <= 0) continue;
    const add = Math.min(need, left);
    u.health += add; left -= add; spent += add;
  }
  for (const u of out) u.health = Math.round(u.health * 100) / 100;
  return { units: out, broke: out.filter(u => u.was > 0 && u.health <= 0), mended: out.filter(u => u.was <= 0 && u.health > 0), spent };
}
const labelOf = u => (u.kind === 'house' ? (u.name || 'A home') : ((BUILDINGS[u.type] || {}).label || u.type));
// "Upkeep: 2 builders look after 16 of 19 buildings".
function line(builders, covered, total) {
  if (!total) return 'Upkeep: nothing to look after yet';
  if (!builders) return `Upkeep: nobody is looking after the town's ${total} building${total === 1 ? '' : 's'}`;
  return `Upkeep: ${builders} builder${builders === 1 ? '' : 's'} look${builders === 1 ? 's' : ''} after ${covered} of ${total} building${total === 1 ? '' : 's'}`;
}

// ── A town ─────────────────────────────────────────────────────────────────
// On for this town? Camps are exempt: a new player learns building first.
async function enabled(s) {
  if (!s || (s.tier || EXEMPT_TIER) === EXEMPT_TIER) return false;
  if (s.upkeep_on) return true;
  return TU.switchOn('upkeep.on').catch(() => false);
}
async function units(q, sid) {
  const [b, h] = await Promise.all([
    q('SELECT id, type, health FROM buildings WHERE settlement_id = $1 AND type <> $2 ORDER BY id', [sid, HOUSING]),
    q('SELECT id, name, health FROM houses WHERE settlement_id = $1 ORDER BY id', [sid]),
  ]);
  return b.rows.map(r => ({ kind: 'building', id: r.id, type: r.type, health: Number(r.health) }))
    .concat(h.rows.map(r => ({ kind: 'house', id: r.id, name: r.name, health: Number(r.health) })));
}
// A broken home keeps its beds; the family in it is a little less happy
// until it is mended (and gets that back when it is).
const HOUSE_MOOD = 3;
const mood = (q, houseId, delta) => q(`UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{happiness}',
    to_jsonb(LEAST(100, GREATEST(0, COALESCE((life->>'happiness')::numeric, 70) + $2)))) WHERE house_id = $1 AND COALESCE(life_stage, 'adult') <> 'deceased'`, [houseId, delta]);
const news = (q, sid, text) => q(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1, 'upkeep', $2, '[]')`, [sid, text]);

// Wear and repair for one town up to `now`. Safe to call any number of
// times: the row lock and upkeep_at make each minute count once.
async function work(sid, now = Date.now()) {
  const CN = require('./construction');
  const events = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid])).rows[0];
    if (!s || !(await enabled(s))) return [];
    const from = s.upkeep_at ? new Date(s.upkeep_at).getTime() : now;
    const minutes = (now - from) / 60000;
    if (!s.upkeep_at) { await q('UPDATE settlements SET upkeep_at = $2 WHERE id = $1', [sid, new Date(now).toISOString()]); return []; }
    if (minutes < 0.25) return [];
    const all = await units(q, sid);
    const crew = await CN.builders(sid);
    const p = plan(all, crew.length, CONFIG.PER_BUILDER);
    // Builders mend when they have nothing to build.
    const busy = (await q("SELECT 1 FROM construction_sites WHERE settlement_id = $1 AND status = 'open' LIMIT 1", [sid])).rows.length > 0;
    const rate = crew.reduce((a, b) => a + b.rate, 0);
    const res = step(all, { wearing: p.wearing, minutes, daysToBreak: CONFIG.DAYS_TO_BREAK, repair: busy ? 0 : rate * minutes * CONFIG.REPAIR_PER_MINUTE });
    for (const u of res.units) {
      if (u.health === u.was) continue;
      await q(`UPDATE ${u.kind === 'house' ? 'houses' : 'buildings'} SET health = $2 WHERE id = $1`, [u.id, u.health]);
    }
    const out = [];
    for (const u of res.broke) {
      const text = u.kind === 'house' ? `${labelOf(u)} has fallen into disrepair. Its family still lives there, unhappily, until a builder mends it.`
        : `The ${labelOf(u)} has fallen into disrepair and gives nothing until a builder mends it.`;
      await news(q, sid, '🏚️ ' + text);
      if (u.kind === 'house') await mood(q, u.id, -HOUSE_MOOD);
      out.push({ type: 'upkeep', what: 'broke', kind: u.kind, id: u.id, building: u.type || null, text });
    }
    for (const u of res.mended) {
      const text = u.kind === 'house' ? `${labelOf(u)} has been mended.` : `The ${labelOf(u)} has been mended and is working again.`;
      await news(q, sid, '🛠️ ' + text);
      if (u.kind === 'house') await mood(q, u.id, HOUSE_MOOD);
      out.push({ type: 'upkeep', what: 'mended', kind: u.kind, id: u.id, building: u.type || null, text });
    }
    // Nobody at all: said once, plainly.
    let warned = s.upkeep_warned;
    if (!crew.length && p.wearing.length && !warned) {
      const text = 'Nobody is looking after the town. Buildings have started to wear. Give a grown-up the Builder job.';
      await news(q, sid, '⏳ ' + text);
      out.push({ type: 'upkeep', what: 'unattended', text });
      warned = true;
    } else if (crew.length && warned) warned = false;
    await q('UPDATE settlements SET upkeep_at = $2, upkeep_warned = $3 WHERE id = $1', [sid, new Date(now).toISOString(), warned]);
    if (out.length || res.spent > 0) out.push({ type: 'upkeep', what: 'changed' });
    return out;
  });
  for (const e of events) { try { require('./event_bus').publish(sid, e); } catch (_) { /* no stream */ } }
  return events;
}

let _last = 0;
// A few of the towns it is on for (Villages and up), once a minute. Never throws.
async function tick(now = Date.now()) {
  if (now - _last < CONFIG.TICK_MS) return 0;
  _last = now;
  let n = 0;
  try {
    const all = await TU.switchOn('upkeep.on').catch(() => false);
    const rows = (await query(`SELECT id FROM settlements WHERE COALESCE(tier, 'camp') <> $1 AND (upkeep_on OR $2)
                                  AND (upkeep_at IS NULL OR upkeep_at < NOW() - ($3 || ' minutes')::interval)
                                ORDER BY upkeep_at NULLS FIRST LIMIT $4`, [EXEMPT_TIER, !!all, CONFIG.TICK_EVERY_MIN, CONFIG.TICK_TOWNS])).rows;
    for (const r of rows) {
      try { await work(r.id, Date.now()); n++; }
      catch (e) { console.error('[upkeep] town %s: %s', r.id, e.message); }
    }
  } catch (e) { console.error('[upkeep] tick:', e.message); }
  return n;
}

// The town card's line, and each building's health for the scenes.
async function status(sid) {
  const s = (await query('SELECT id, tier, upkeep_on FROM settlements WHERE id = $1', [sid])).rows[0];
  if (!s) throw new UpkeepError('No settlement.', 404);
  const on = await enabled(s);
  if (!on) return { on: false, exempt: (s.tier || EXEMPT_TIER) === EXEMPT_TIER };
  await work(sid);
  const all = await units(query, sid);
  const crew = await require('./construction').builders(sid);
  const p = plan(all, crew.length, CONFIG.PER_BUILDER);
  const slim = u => ({ kind: u.kind, id: u.id, type: u.type || HOUSING, label: labelOf(u), health: Math.round(u.health), state: stateOf(u.health) });
  return {
    on: true, builders: crew.length, per_builder: CONFIG.PER_BUILDER, days_to_break: CONFIG.DAYS_TO_BREAK,
    covered: p.covered, total: p.total, short: p.wearing.length > 0,
    line: line(crew.length, p.covered, p.total),
    wearing: p.wearing.map(slim),
    damaged: all.filter(u => u.health < 100).sort((a, b) => a.health - b.health).map(slim),
  };
}

// "Repair now": a repair at the front of the builders' queue, ahead of new
// building. target: { kind: 'building', type } or { kind: 'house', id }.
async function repairNow(sid, target = {}) {
  const CN = require('./construction');
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid])).rows[0];
    if (!s) throw new UpkeepError('No settlement.', 404);
    if (!(await enabled(s))) throw new UpkeepError('Buildings do not wear in this town.');
    let u;
    if (target.kind === 'house') {
      const h = (await q('SELECT id, name, health FROM houses WHERE id = $1 AND settlement_id = $2', [Number(target.id), sid])).rows[0];
      if (h) u = { kind: 'house', id: h.id, name: h.name, type: HOUSING, health: Number(h.health) };
    } else {
      const b = (await q('SELECT id, type, health FROM buildings WHERE settlement_id = $1 AND type = $2 AND type <> $3', [sid, String(target.type || ''), HOUSING])).rows[0];
      if (b) u = { kind: 'building', id: b.id, type: b.type, health: Number(b.health) };
    }
    if (!u) throw new UpkeepError('That is not one of your buildings.', 404);
    if (u.health >= 100) throw new UpkeepError(`${u.kind === 'house' ? labelOf(u) : 'The ' + labelOf(u)} needs no repair.`);
    const open = (await q("SELECT id, kind, building_type, target_id, position FROM construction_sites WHERE settlement_id = $1 AND status = 'open'", [sid])).rows;
    if (open.some(o => o.kind === 'repair' && (u.kind === 'house' ? o.target_id === u.id : o.building_type === u.type && o.target_id == null)))
      throw new UpkeepError('The builders already have that repair in hand.');
    let site;
    try { site = await CN.order(q, s, { kind: 'repair', type: u.type, level: 1, cost: {}, work: Math.max(1, Math.round((100 - u.health) * 10) / 10), targetId: u.kind === 'house' ? u.id : null, front: true }); }
    catch (e) { if (e instanceof CN.SiteError) throw new UpkeepError(e.message, e.status); throw e; }
    return { site: { id: site.id, kind: 'repair', work_needed: Number(site.work_needed) }, label: labelOf(u) };
  });
  try { require('./event_bus').publish(sid, { type: 'construction', what: 'queue' }); } catch (_) { /* no stream */ }
  const crew = await CN.builders(sid).catch(() => []);
  return { ...out, builders: crew.length, no_builder: crew.length === 0 };
}
// A repair site is finished (lib/construction.js complete()): whole again.
async function repaired(q, sid, site) {
  const house = site.target_id != null;
  if (house) {
    const was = (await q('SELECT health FROM houses WHERE id = $1 AND settlement_id = $2', [site.target_id, sid])).rows[0];
    if (was && Number(was.health) <= 0) await mood(q, site.target_id, HOUSE_MOOD);
  }
  const r = house ? (await q('UPDATE houses SET health = 100 WHERE id = $1 AND settlement_id = $2 RETURNING id, name', [site.target_id, sid])).rows[0]
    : (await q('UPDATE buildings SET health = 100 WHERE settlement_id = $1 AND type = $2 RETURNING id, type', [sid, site.building_type])).rows[0];
  return r ? labelOf(house ? { kind: 'house', name: r.name } : { kind: 'building', type: r.type }) : null;
}

// ── Dev Tools ──────────────────────────────────────────────────────────────
// Everything starts at 100 when the switch goes on (and is put back to 100
// when it goes off, so nothing stays broken with nobody able to wear it).
async function fresh(q, sid) {
  await q('UPDATE buildings SET health = 100 WHERE settlement_id = $1 AND health <> 100', [sid]);
  await q('UPDATE houses SET health = 100 WHERE settlement_id = $1 AND health <> 100', [sid]);
  await q('UPDATE settlements SET upkeep_at = NOW(), upkeep_warned = FALSE WHERE id = $1', [sid]);
}
async function setTown(sid, on) {
  await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    await q('UPDATE settlements SET upkeep_on = $2 WHERE id = $1', [sid, !!on]);
    await fresh(q, sid);
  });
  return !!on;
}
async function setAll(on) {
  const v = await TU.setSwitch('upkeep.on', !!on);
  await query('UPDATE buildings SET health = 100 WHERE health <> 100');
  await query('UPDATE houses SET health = 100 WHERE health <> 100');
  await query('UPDATE settlements SET upkeep_at = NOW(), upkeep_warned = FALSE');
  return v;
}
// Set every building's health in a town (to see worn and broken).
async function setHealth(sid, health) {
  const h = Math.max(0, Math.min(100, Number(health)));
  if (!Number.isFinite(h)) throw new UpkeepError('Health is a number from 0 to 100.');
  await query('UPDATE buildings SET health = $2 WHERE settlement_id = $1 AND type <> $3', [sid, h, HOUSING]);
  await query('UPDATE houses SET health = $2 WHERE settlement_id = $1', [sid, h]);
  await query('UPDATE settlements SET upkeep_at = NOW() WHERE id = $1', [sid]);
  return h;
}

module.exports = {
  CONFIG, UpkeepError, stateOf, rank, plan, step, line, labelOf,
  enabled, units, work, tick, status, repairNow, repaired, setTown, setAll, setHealth, HOUSE_MOOD,
  _resetTick() { _last = 0; },
};
