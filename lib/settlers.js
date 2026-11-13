// ══════════════════════════════════════════════════════════════════════════
//  Settlers: newcomers who keep a town from dying out
//  (docs/PHASE_1_LIFE_CYCLE.md §4.7; scripts/population_model.js scenario K).
//
//    arrive(settlementId, now?)   brings whoever is due, called on settlement
//        load and at the start of the hourly simulation
//    plan({ last, now, freeBeds, working })   pure: when they arrive
//
//  While a bed is free, one adult settler arrives every 7 days. If working
//  adults (12–59) fall below 6, one arrives the next day. Each is 12–24 with
//  random hidden trade talents and a surname no family in the town uses, so
//  they found a new family. Until moments exist (Phase 2) they simply arrive
//  with a toast and a chronicle line; with moments the player will be asked,
//  and the default will be yes.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query } = require('../db');

const DAY_MS = 24 * 3600 * 1000;
const CONFIG = {
  EVERY_DAYS: 7,          // while a bed is free
  RESCUE_BELOW: 6,        // fewer working adults than this …
  RESCUE_DAYS: 1,         // … and one arrives the next day
  AGE_FROM: 12,
  AGE_TO: 24,
  MAX_AT_ONCE: 3,         // catching up after an absence
};

// Tunable from Dev Tools (lib/tuning.js LIFE_KEYS).
for (const [k, key] of [['EVERY_DAYS', 'SETTLER_EVERY_DAYS'], ['RESCUE_BELOW', 'SETTLER_RESCUE_BELOW']]) {
  const dflt = CONFIG[k];
  Object.defineProperty(CONFIG, k, { enumerable: true, get() { const v = require('./tuning').value(key); return v == null ? dflt : v; } });
}

// When settlers arrive between `last` and `now` (ms). `working` is the
// working-adult count now; each settler adds one. Returns [ms, …].
function plan({ last, now, freeBeds, working }) {
  const out = [];
  let t = last, beds = freeBeds, w = working;
  while (out.length < CONFIG.MAX_AT_ONCE && beds > 0) {
    const gap = (w < CONFIG.RESCUE_BELOW ? CONFIG.RESCUE_DAYS : CONFIG.EVERY_DAYS) * DAY_MS;
    if (t + gap > now) break;
    t += gap;
    out.push(t);
    beds--; w++;
  }
  return out;
}

// Parts for coining a surname when every one in the list is taken.
const PRE = ['Ash', 'Bramble', 'Elder', 'Hazel', 'Kestrel', 'Linden', 'Marsh', 'Nettle', 'Quill', 'Rowan', 'Sedge', 'Teasel', 'Willow', 'Yarrow'];
const SUF = ['brook', 'dale', 'field', 'ford', 'holt', 'hurst', 'ley', 'mere', 'wick', 'wood'];
function newSurname(taken, rand = Math.random) {
  const { LAST_NAMES } = require('../citizens');
  const lower = new Set([...taken].map(n => String(n).toLowerCase()));
  const free = LAST_NAMES.filter(n => !lower.has(n.toLowerCase()));
  if (free.length) return free[Math.floor(rand() * free.length)];
  const coined = [];
  for (const p of PRE) for (const s of SUF) if (!lower.has((p + s).toLowerCase())) coined.push(p + s);
  return coined.length ? coined[Math.floor(rand() * coined.length)] : 'Newleaf';
}

async function arrive(settlementId, now = Date.now()) {
  const LIFE = require('./life');
  const s = (await query('SELECT id, name, last_settler_at FROM settlements WHERE id = $1', [settlementId])).rows[0];
  if (!s) return [];
  // A town's first check only starts the clock.
  if (!s.last_settler_at) {
    await query('UPDATE settlements SET last_settler_at = $2 WHERE id = $1 AND last_settler_at IS NULL', [settlementId, new Date(now).toISOString()]);
    return [];
  }
  const last = new Date(s.last_settler_at).getTime();
  const beds = await LIFE.beds(settlementId);
  const living = (await query(`SELECT born_at, life_stage FROM citizens WHERE settlement_id = $1 AND ${LIFE.LIVING}`, [settlementId])).rows;
  const working = living.filter(c => LIFE.stageOf(c, now) === 'adult').length;
  const when = plan({ last, now, freeBeds: beds.free, working });
  if (!when.length) return [];
  // Claim the window, so two requests can't both bring settlers.
  const claim = await query(
    `UPDATE settlements SET last_settler_at = $3 WHERE id = $1 AND date_trunc('milliseconds', last_settler_at) = $2 RETURNING id`,
    [settlementId, new Date(last).toISOString(), new Date(when[when.length - 1]).toISOString()]);
  if (!claim.rows.length) return [];

  // Each one waits at the gate as a moment (M7, default: welcome them). If
  // moments can't be used, they come straight in.
  const { types, taken } = await townFor(settlementId);
  const came = [];
  for (const at of when) {
    const t = makeSettler(taken, types, at);
    let m = null;
    try { m = await require('./moments').trigger(settlementId, 'settler_gate', { settler: t }); } catch (e) { m = null; }
    if (!m) came.push(await admitOne(s, t));
    else came.push({ moment: m.id, name: t.name, age: t.age, at, resolved: !!m.resolved });
  }
  return came;
}

// A settler's details, rolled once (M7 keeps them in the moment's data, so a
// reload can't change who is at the gate).
function makeSettler(taken, types, at = Date.now()) {
  const { generateCitizen } = require('../citizens');
  const C = require('./careers/classes');
  const c = generateCitizen(1);
  const surname = newSurname(taken);
  taken.add(surname);
  const age = CONFIG.AGE_FROM + Math.floor(Math.random() * (CONFIG.AGE_TO - CONFIG.AGE_FROM + 1));
  return { name: `${c.name.split(' ')[0]} ${surname}`, surname, gender: c.gender, age, role: C.fallbackRole(c.role, types),
    stats: c.stats, skills: c.skills, life: { ...c.life, age }, repro: c.repro, visible_traits: c.visible_traits, hidden_traits: c.hidden_traits, at };
}
async function townFor(settlementId) {
  const types = (await query('SELECT type FROM buildings WHERE settlement_id = $1', [settlementId])).rows.map(r => r.type);
  const taken = new Set((await query('SELECT name FROM families WHERE settlement_id = $1', [settlementId]).catch(() => ({ rows: [] }))).rows.map(r => r.name));
  return { types, taken };
}

// One settler comes in: a new family, a chronicle line and a toast; then
// housing and the count. Returns { id, name, age, at }. `opts.q` runs it on a
// caller's transaction (a moment's), so it never waits on that transaction's locks.
async function admitOne(s, t, opts = {}) {
  const LIFE = require('./life');
  const query = opts.q || require('../db').query;
  const at = t.at || Date.now();
  const bornAt = new Date(at - t.age * LIFE.YEAR_MS);
  const r = await query(
    `INSERT INTO citizens (settlement_id, name, gender, generation, role, stats, skills, life, repro, visible_traits, hidden_traits, born_at, last_birthday_year)
     VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [s.id, t.name, t.gender, t.role, JSON.stringify(t.stats), JSON.stringify(t.skills), JSON.stringify(t.life), JSON.stringify(t.repro),
     JSON.stringify(t.visible_traits), JSON.stringify(t.hidden_traits), bornAt.toISOString(), Math.floor(LIFE.ageOf({ born_at: bornAt }))]);
  const id = r.rows[0].id;
  await LIFE.assignFamilies(s.id, query);
  const fam = (await query('SELECT family_id FROM citizens WHERE id = $1', [id])).rows[0];
  const text = opts.text || `${t.name}, ${t.age}, has come to settle in ${s.name} and starts the ${t.surname} family.`;
  await require('./chronicle').write(s.id, { kind: 'settler', text, citizenIds: [id], familyId: fam && fam.family_id, at }, query);
  await query(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids, created_at) VALUES ($1, 'settler', $2, $3, $4)`,
    [s.id, `🧳 ${text}`, JSON.stringify([id]), new Date(Math.min(at, Date.now())).toISOString()]);
  if (!opts.noHouse) await LIFE.autoHouse(s.id, {}, query);
  await LIFE.recount(s.id, query);
  return { id, name: t.name, age: t.age, at };
}

// Brings settlers straight in at the given times (ms) (Dev Tools, and towns
// where moments can't be used).
async function admit(s, when, now = Date.now()) {
  const { types, taken } = await townFor(s.id);
  const came = [];
  for (const at of when) came.push(await admitOne(s, makeSettler(taken, types, at)));
  return came;
}

// Dev Tools: one settler now, if there is a free bed; the clock restarts.
async function sendNow(settlementId) {
  const LIFE = require('./life');
  const s = (await query('SELECT id, name FROM settlements WHERE id = $1', [settlementId])).rows[0];
  if (!s) return null;
  if ((await LIFE.beds(settlementId)).free <= 0) { const e = new Error('No free bed: build a Willow Hut first.'); e.status = 400; throw e; }
  const now = Date.now();
  await query('UPDATE settlements SET last_settler_at = $2 WHERE id = $1', [settlementId, new Date(now).toISOString()]);
  return (await admit(s, [now], now))[0];
}

// When the next settler is due (for Dev Tools): { at, reason } or null.
async function nextDue(settlementId, now = Date.now()) {
  const LIFE = require('./life');
  const s = (await query('SELECT last_settler_at FROM settlements WHERE id = $1', [settlementId])).rows[0];
  if (!s || !s.last_settler_at) return { at: null, reason: 'the clock starts on the next update' };
  const living = (await query(`SELECT born_at, life_stage FROM citizens WHERE settlement_id = $1 AND ${LIFE.LIVING}`, [settlementId])).rows;
  const working = living.filter(c => LIFE.stageOf(c, now) === 'adult').length;
  const rescue = working < CONFIG.RESCUE_BELOW;
  const free = (await LIFE.beds(settlementId)).free;
  return { at: new Date(new Date(s.last_settler_at).getTime() + (rescue ? CONFIG.RESCUE_DAYS : CONFIG.EVERY_DAYS) * DAY_MS).toISOString(),
    reason: free <= 0 ? 'no free bed: nobody comes until one is built' : rescue ? `rescue: only ${working} working adults` : 'the weekly settler', working, free };
}

module.exports = { CONFIG, plan, newSurname, arrive, admit, admitOne, makeSettler, townFor, sendNow, nextDue };
