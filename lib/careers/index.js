// ══════════════════════════════════════════════════════════════════════════
//  CAREERS — citizens get better at their jobs (classes, perks, traits).
//
//  Passive XP: every hour a citizen works their job at home earns XP for
//  that class (lib/career_math passiveRate). settle() credits the time since
//  citizens.career_settled_at; it runs lazily (settlement and citizen reads)
//  and from the worker sweep (tick), and before any role change so time is
//  credited to the job it was spent in. Citizens away on a side job (quest,
//  someone else's porter run, an envoy…) earn nothing passively — the side
//  job pays its own XP when it completes (lib/career_subscriber.js).
//
//  grantXp() is the one write path for XP: it locks the citizen rows,
//  upserts the class row and runs level-up side effects once (guarded
//  `level < $n`). Lock order: settlements → citizens → citizen_classes →
//  inventory_items. Events are published after commit.
//
//  Kill switch: CAREERS_EFFECTS=0 keeps XP flowing but drops every effect
//  (production, market, combat…) back to the flat pre-career numbers.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query, withTransaction } = require('../../db');
const eventBus = require('../event_bus');
const M = require('../career_math');
const C = require('./classes');
const T = require('./traits');
const P = require('./profiles');

const SETTLE_GATE_MS = 2 * 60 * 1000;
const MAX_CATCHUP_H = 168;
const SWEEP_STALE_MIN = 15;
const SWEEP_LIMIT = 5;
const RETRAIN_GOLD_PER_POINT = 25;
const RETRAIN_HOURS = 2;
const LOGGED_LEVELS = [5, 10, 15, 20];
const PHYSICAL = Object.keys(C.CLASSES).filter(k => C.CLASSES[k].physical);
// Away on the job itself (still working): scouts exploring, porters
// carrying, merchants trading.
const WORK_AWAY = { scout: 'expedition', porter: 'porter', merchant: 'trade' };

const effectsOn = () => process.env.CAREERS_EFFECTS !== '0';
const arr = v => (Array.isArray(v) ? v : []);
// Reads always go through the pool, never a caller's transaction client:
// they run in parallel and some tables are optional (a failed read must not
// abort the caller's transaction). Plain reads never wait on row locks.
const runQ = () => query;

// ── Loading ────────────────────────────────────────────────────────────────

// A cache scope (withStateCache): inside it, each settlement's state is
// loaded once. Safe because reads go through the pool (runQ), which never
// sees the caller's own uncommitted writes anyway — so within one crafting
// pass or one station view nothing is lost by reusing the first load.
// Outside a scope every call loads fresh, as before.
const { AsyncLocalStorage } = require('async_hooks');
const _scope = new AsyncLocalStorage();
const _loadStats = { loads: 0 };
function withStateCache(fn) {
  if (_scope.getStore()) return fn();   // nested: share the outer scope
  return _scope.run(new Map(), fn);
}

async function loadState(db, sid) {
  const cache = _scope.getStore();
  if (cache) {
    if (!cache.has(sid)) cache.set(sid, loadStateFresh(sid).catch(e => { cache.delete(sid); throw e; }));
    return cache.get(sid);
  }
  return loadStateFresh(sid);
}

async function loadStateFresh(sid) {
  _loadStats.loads++;
  const q = runQ();
  const [cits, rows, gear, keepers, blds] = await Promise.all([
    q(`SELECT id, name, gender, role, stats, skills, life, visible_traits, hidden_traits, revealed_traits, trait_hints,
              earned_traits, career_counters, parent_ids, life_stage, settlement_id
         FROM citizens WHERE settlement_id = $1 AND COALESCE(life_stage, 'adult') <> 'deceased'`, [sid]),
    q('SELECT * FROM citizen_classes WHERE settlement_id = $1', [sid]),
    q(`SELECT i.id, i.equipped_to, i.name, i.equip_slot, i.stat_bonuses, i.metadata,
              COALESCE(i.metadata->'item_effects', t.item_effects) AS item_effects   -- crafted: quality-scaled
         FROM inventory_items i JOIN citizens c ON c.id = i.equipped_to
         LEFT JOIN item_templates t ON t.item_key = i.item_key
        WHERE c.settlement_id = $1 AND i.equipped_to IS NOT NULL AND i.equip_slot IS NOT NULL`, [sid])
      .catch(() => ({ rows: [] })),
    q('SELECT citizen_id, venue FROM shop_keepers WHERE settlement_id = $1', [sid]).catch(() => ({ rows: [] })),
    q('SELECT type, level FROM buildings WHERE settlement_id = $1', [sid]),
  ]);
  return { citizens: cits.rows, classRows: rows.rows, gear: gear.rows, keepers: keepers.rows, buildings: blds.rows };
}

const isAdult = c => (c.life_stage || 'adult') === 'adult';

function profilesFrom(state, now) {
  const adults = state.citizens.filter(isAdult);
  return P.buildProfiles(adults, state.classRows, state.gear, { now, keepers: state.keepers });
}

// Living adults with their career profile, for production and anything
// else that needs "what does this citizen bring". `.town` rides along.
async function loadWorkforce(db, sid, now = Date.now()) {
  const state = await loadState(db, sid);
  const adults = state.citizens.filter(isAdult);
  if (!effectsOn()) {
    const out = adults.map(c => ({ ...c, profile: null }));
    out.town = { happiness: 0, market: { fee: 0, carry: 0, travel: 0, max_orders: 0, merchants: 0 }, shops: {} };
    out.buildings = state.buildings;
    return out;
  }
  const { byId, town } = profilesFrom(state, now);
  const out = adults.map(c => ({ ...c, profile: byId.get(c.id) }));
  out.town = town;
  out.buildings = state.buildings;
  return out;
}

// Profiles for a few citizens (quests, combat, porters) — whole settlement
// so mentors and auras are right. Map(id → profile).
async function profilesFor(db, sid, now = Date.now()) {
  if (!effectsOn()) return new Map();
  return profilesFrom(await loadState(db, sid), now).byId;
}

// Settlement-wide career bonuses (best merchant, each shop's keeper,
// happiness) and the best porter's carry multiplier.
async function townBonuses(db, sid) {
  if (!sid || !effectsOn()) return { happiness: 0, market: { fee: 0, carry: 0, travel: 0, max_orders: 0, merchants: 0 }, shops: {}, porterCarry: 1 };
  const state = await loadState(db, sid);
  const { byId, town } = profilesFrom(state, Date.now());
  let carry = 0;
  for (const c of state.citizens) if (c.role === 'porter' && byId.get(c.id)) carry = Math.max(carry, byId.get(c.id).effects.carry || 0);
  return { ...town, porterCarry: 1 + carry };
}

// Food eaten: each citizen's upkeep perks (Light Eater…) as upkeep_mult.
async function attachUpkeep(sid, rows) {
  if (!effectsOn() || !rows || !rows.length) return rows;
  try {
    const byId = await profilesFor(null, sid);
    for (const c of rows) { const p = byId.get(c.id); if (p) c.upkeep_mult = Math.max(0.5, 1 + (p.effects.upkeep || 0)); }
  } catch (_) { /* pre-migration: flat upkeep */ }
  return rows;
}

// Envoy travel: the envoy's own travel perks × the settlement's envoy
// know-how (tavern gossip, pathfinders). Returns a speed multiplier.
async function envoySpeed(sid, cit) {
  if (!effectsOn() || !cit) return { mult: 1, scouting: Number(cit && cit.skills && cit.skills.scouting) || 1 };
  const t = await travelCitizen(sid, cit);
  const town = await townBonuses(null, sid);
  return { mult: (1 + (t.travel || 0)) * (1 + (town.envoy || 0)), scouting: Number(t.skills && t.skills.scouting) || 1 };
}

// A citizen row as travel sees them: effective scouting, travel and carry.
async function travelCitizen(sid, cit) {
  if (!cit || !effectsOn()) return cit;
  const p = (await profilesFor(null, sid)).get(Number(cit.id));
  if (!p) return cit;
  return { ...cit, skills: { ...(cit.skills || {}), scouting: p.skills.scouting }, travel: p.effects.travel || 0, carry: p.effects.carry || 0 };
}

// Career stat/skill changes for a battle, frozen by the caller with the
// battle's other modifiers: { citizenId: { strength, agility, endurance, combat } }.
async function combatDeltas(sid, citizenIds) {
  const out = {};
  if (!sid || !effectsOn()) return out;
  const state = await loadState(null, sid);
  const { byId } = profilesFrom(state, Date.now());
  for (const id of (citizenIds || []).map(Number)) {
    const p = byId.get(id), c = state.citizens.find(x => x.id === id);
    if (!p || !c) continue;
    const d = {};
    for (const s of ['strength', 'agility', 'endurance']) {
      const v = p.stats[s] - (Number((c.stats || {})[s]) || 0);
      if (v) d[s] = v;
    }
    const cv = p.skills.combat - (Number((c.skills || {}).combat) || 1);
    if (cv) d.combat = cv;
    if (Object.keys(d).length) out[id] = d;
  }
  return out;
}

// An injury: reveals 'sickly', counts toward Survivor. Own transaction.
async function recordInjury(sid, citizenId) {
  await revealOnEvent(sid, citizenId, 'injury').catch(() => {});
  const events = [];
  await withTransaction(client => bumpCounter(client, sid, citizenId, 'injuries', 1, events)).catch(() => {});
  publish(sid, events);
}

// Who is away on what, right now. Map(citizenId → kind).
async function awayMap(db, sid) {
  const q = runQ(db);
  const out = new Map();
  const mark = (rows, kind) => rows.forEach(r => { if (r.citizen_id && !out.has(Number(r.citizen_id))) out.set(Number(r.citizen_id), kind); });
  const safe = p => p.catch(() => ({ rows: [] }));
  const [qs, cq, ex, runs, trips, dip] = await Promise.all([
    safe(q("SELECT citizen_id, party_ids FROM settlement_quests WHERE settlement_id = $1 AND status = 'active'", [sid])),
    safe(q('SELECT citizen_id FROM clan_quest_slots WHERE settlement_id = $1 AND active', [sid])),
    safe(q("SELECT citizen_id FROM expeditions WHERE settlement_id = $1 AND status = 'travelling'", [sid])),
    safe(q("SELECT citizen_id FROM market_runs WHERE settlement_id = $1 AND status IN ('outbound','returning')", [sid])),
    safe(q("SELECT citizen_id FROM market_trips WHERE seller_settlement_id = $1 AND status IN ('outbound','returning')", [sid])),
    safe(q("SELECT citizen_id FROM diplomacy_relations WHERE settlement_id = $1 AND citizen_id IS NOT NULL AND (status = 'contact_sent' OR pending_action IS NOT NULL)", [sid])),
  ]);
  qs.rows.forEach(r => { if (r.citizen_id) out.set(Number(r.citizen_id), 'quest'); arr(r.party_ids).forEach(id => out.set(Number(id), 'quest')); });
  mark(cq.rows, 'clan_quest');
  mark(ex.rows, 'expedition');
  mark(runs.rows, 'porter');
  mark(trips.rows, 'trade');
  mark(dip.rows, 'envoy');
  return out;
}

// ── XP ─────────────────────────────────────────────────────────────────────

// grants: [{ citizenId, classKey, xp, hours? }]. Caller is in a transaction.
// Returns Map(citizenId → { classKey → updated row }).
async function grantXp(client, sid, grants, events) {
  const out = new Map();
  const list = (grants || []).filter(g => g && C.CLASSES[g.classKey] && ((Number(g.xp) || 0) > 0 || (Number(g.hours) || 0) > 0));
  if (!list.length) return out;
  const ids = [...new Set(list.map(g => Number(g.citizenId)))].sort((a, b) => a - b);
  const cits = (await client.query(
    `SELECT id, name, skills, life_stage, revealed_traits, hidden_traits FROM citizens
      WHERE id = ANY($1::int[]) AND settlement_id = $2 ORDER BY id FOR UPDATE`, [ids, sid])).rows;
  const byId = new Map(cits.map(c => [c.id, c]));
  for (const g of list) {
    const c = byId.get(Number(g.citizenId));
    if (!c || c.life_stage === 'deceased') continue;
    const row = (await client.query(
      `INSERT INTO citizen_classes (citizen_id, settlement_id, class_key, xp, hours_worked)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (citizen_id, class_key) DO UPDATE
         SET xp = citizen_classes.xp + EXCLUDED.xp, hours_worked = citizen_classes.hours_worked + EXCLUDED.hours_worked, updated_at = NOW()
       RETURNING *`,
      [c.id, sid, g.classKey, Math.max(0, Math.round((Number(g.xp) || 0) * 100) / 100), Math.max(0, Math.round((Number(g.hours) || 0) * 100) / 100)])).rows[0];
    const want = M.levelForXp(Number(row.xp));
    if (want > row.level) {
      const up = (await client.query(
        'UPDATE citizen_classes SET level = $3 WHERE citizen_id = $1 AND class_key = $2 AND level < $3 RETURNING level',
        [c.id, g.classKey, want])).rows[0];
      if (up) {
        await onLevelUp(client, sid, c, g.classKey, row.level, want, row, events);
        row.level = want;
      }
    }
    if (!out.has(c.id)) out.set(c.id, {});
    out.get(c.id)[g.classKey] = row;
  }
  return out;
}

async function onLevelUp(client, sid, c, classKey, from, to, row, events) {
  const cls = C.CLASSES[classKey];
  // Class level lifts the matching old skill (quests, combat, expeditions).
  if (cls.skill) {
    const cur = Number((c.skills || {})[cls.skill]) || 1;
    const next = M.syncedSkill(cur, to);
    if (next > cur) {
      await client.query(`UPDATE citizens SET skills = jsonb_set(COALESCE(skills, '{}'::jsonb), $2::text[], to_jsonb($3::int)) WHERE id = $1`,
        [c.id, [cls.skill], next]);
      c.skills = { ...(c.skills || {}), [cls.skill]: next };
    }
  }
  const spec = C.specOf(cls, row.spec);
  const title = M.titleFor(to, cls.label, spec && spec.label);
  const forkReady = !!(cls.fork && to >= M.FORK_LEVEL && !row.spec);
  events.push({ type: 'career_level_up', citizen_id: c.id, name: c.name, class_key: classKey, class_label: cls.label, level: to, title, fork_ready: forkReady });
  for (const l of LOGGED_LEVELS) {
    if (from < l && to >= l) {
      await logEvent(client, sid, c.id, 'career_level', `${c.name} became ${M.titleFor(l, cls.label, spec && spec.label)} (Lv ${l}).`, { class: classKey, level: l });
    }
  }
}

async function logEvent(client, sid, cid, type, narrative, meta) {
  await client.query(
    `INSERT INTO citizen_events (citizen_id, settlement_id, event_type, narrative, meta) VALUES ($1, $2, $3, $4, $5)`,
    [cid, sid, type, narrative, JSON.stringify(meta || {})]).catch(e => console.error('[careers] log failed:', e.message));
}

// ── Hidden traits, service milestones ──────────────────────────────────────

// c: citizen row (locked by caller). rows: { classKey → class row }.
// Reveals and hints from hours worked, levels; service milestones. Writes
// the citizen and pushes events. Returns true if anything changed.
async function checkTraits(client, sid, c, rows, events, rand = Math.random) {
  const revealed = arr(c.revealed_traits).slice(), hints = arr(c.trait_hints).slice(), earned = arr(c.earned_traits).slice();
  let stats = c.stats ? { ...c.stats } : null, changed = false;
  const hoursIn = keys => keys.reduce((a, k) => a + (rows[k] ? Number(rows[k].hours_worked) || 0 : 0), 0);
  const maxLevel = Object.values(rows).reduce((m, r) => Math.max(m, r.level || 1), 1);
  const reveal = async (t, info) => {
    revealed.push(t); changed = true;
    events.push({ type: 'trait_revealed', citizen_id: c.id, name: c.name, trait: t, label: info.label, icon: info.icon, desc: info.desc, kind: info.kind });
    await logEvent(client, sid, c.id, 'trait_revealed', `${c.name} discovered something about themselves: ${info.label}.`, { trait: t });
  };
  for (const t of arr(c.hidden_traits)) {
    if (revealed.includes(t)) continue;
    const info = T.traitInfo(t);
    if (!info) continue;
    let need = null, have = 0;
    if (T.APTITUDES[t]) { need = T.APTITUDE_REVEAL_HOURS; have = hoursIn(info.classes); }
    else if (T.AVERSIONS[t]) { need = T.AVERSION_REVEAL_HOURS; have = hoursIn(info.classes); }
    else if (t === 'latent_strength') { need = T.LEGACY.latent_strength.reveal.hours; have = hoursIn(PHYSICAL); }
    else if (t === 'natural_leader') { if (maxLevel >= 10) await reveal(t, info); continue; }
    else continue;   // event reveals (sickly, fertile) and long_lived
    if (have >= need) {
      await reveal(t, info);
      if (t === 'latent_strength' && stats) {
        for (const [s, v] of Object.entries(T.LEGACY.latent_strength.bakeStats)) stats[s] = Math.min(20, (Number(stats[s]) || 0) + v);
      }
    } else if (have >= need * T.HINT_SHARE && !hints.includes(t) && info.hint) {
      hints.push(t); changed = true;
      events.push({ type: 'trait_hint', citizen_id: c.id, name: c.name, trait: t, hint: `${c.name} ${info.hint}` });
    }
  }
  // Service: real hours worked in one class (loyal citizens 20% sooner).
  const loyal = arr(c.visible_traits).includes('loyal');
  const has = (id, cls) => earned.some(e => e.id === id && e.class === cls) || (id === 'quirk' && earned.some(e => e.class === cls && e.quirk));
  for (const [k, r] of Object.entries(rows)) {
    if (!C.CLASSES[k]) continue;
    const h = (Number(r.hours_worked) || 0) / (loyal ? T.LOYAL_SERVICE_MULT : 1);
    const label = C.CLASSES[k].label;
    const now = new Date().toISOString();
    if (h >= T.SERVICE.veteran.hours && !has('veteran', k)) {
      earned.push({ id: 'veteran', class: k, at: now }); changed = true;
      events.push({ type: 'career_milestone', citizen_id: c.id, name: c.name, trait: 'veteran', class_key: k, label: `Veteran ${label}`, icon: '🎖️' });
      await logEvent(client, sid, c.id, 'career_milestone', `${c.name} is now a Veteran ${label} — ${M.serviceYears(r.hours_worked)} years of service.`, { class: k, trait: 'veteran' });
    }
    if (h >= T.SERVICE.quirk.hours && !has('quirk', k) && T.QUIRKS[k]) {
      const averse = arr(c.hidden_traits).some(t => T.AVERSIONS[t] && T.AVERSIONS[t].classes.includes(k));
      const good = rand() < (averse ? T.QUIRK_GOOD_ODDS_AVERSE : T.QUIRK_GOOD_ODDS);
      const pool = T.QUIRKS[k][good ? 'good' : 'bad'];
      const [qid, qlabel, qicon] = pool[Math.floor(rand() * pool.length)];
      earned.push({ id: qid, class: k, quirk: true, at: now }); changed = true;
      events.push({ type: 'career_milestone', citizen_id: c.id, name: c.name, trait: qid, class_key: k, label: qlabel, icon: qicon, good });
      await logEvent(client, sid, c.id, 'career_milestone', `Years as a ${label} left their mark on ${c.name}: ${qlabel}.`, { class: k, trait: qid, good });
    }
    if (h >= T.SERVICE.old_hand.hours && !has('old_hand', k)) {
      earned.push({ id: 'old_hand', class: k, at: now }); changed = true;
      events.push({ type: 'career_milestone', citizen_id: c.id, name: c.name, trait: 'old_hand', class_key: k, label: `Elder ${label}`, icon: '🧓' });
      await logEvent(client, sid, c.id, 'career_milestone', `${c.name} is an Elder ${label} now — an old hand everyone learns from.`, { class: k, trait: 'old_hand' });
    }
  }
  if (!changed) return false;
  await client.query(
    'UPDATE citizens SET revealed_traits = $2, trait_hints = $3, earned_traits = $4, stats = COALESCE($5, stats) WHERE id = $1',
    [c.id, JSON.stringify(revealed), JSON.stringify(hints), JSON.stringify(earned), stats ? JSON.stringify(stats) : null]);
  c.revealed_traits = revealed; c.trait_hints = hints; c.earned_traits = earned; if (stats) c.stats = stats;
  return true;
}

// Event reveals: 'injury' → sickly, 'child' → fertile. Own transaction.
async function revealOnEvent(sid, citizenId, event) {
  const want = event === 'injury' ? 'sickly' : event === 'child' ? 'fertile' : null;
  if (!want) return;
  const events = [];
  await withTransaction(async client => {
    const c = (await client.query(
      `SELECT id, name, hidden_traits, revealed_traits FROM citizens WHERE id = $1 AND settlement_id = $2
          AND hidden_traits @> $3::jsonb AND NOT revealed_traits @> $3::jsonb FOR UPDATE`,
      [citizenId, sid, JSON.stringify([want])])).rows[0];
    if (!c) return;
    const info = T.traitInfo(want);
    await client.query('UPDATE citizens SET revealed_traits = revealed_traits || $2::jsonb WHERE id = $1', [c.id, JSON.stringify([want])]);
    events.push({ type: 'trait_revealed', citizen_id: c.id, name: c.name, trait: want, label: info.label, icon: info.icon, desc: info.desc, kind: 'legacy' });
    await logEvent(client, sid, c.id, 'trait_revealed', `${c.name} discovered something about themselves: ${info.label}.`, { trait: want });
  });
  publish(sid, events);
}

// Deed counters (porter runs, injuries survived…) and the deeds they earn.
async function bumpCounter(client, sid, citizenId, counter, by, events) {
  const c = (await client.query(
    `UPDATE citizens SET career_counters = COALESCE(career_counters, '{}'::jsonb)
        || jsonb_build_object($2::text, COALESCE((career_counters->>$2)::int, 0) + $3::int)
      WHERE id = $1 AND settlement_id = $4 RETURNING id, name, career_counters, earned_traits`,
    [citizenId, counter, by || 1, sid])).rows[0];
  if (!c) return;
  const n = Number(c.career_counters[counter]) || 0;
  for (const [id, d] of Object.entries(T.DEEDS)) {
    if (d.counter !== counter || n < d.at || arr(c.earned_traits).some(e => e.id === id)) continue;
    const up = await client.query(
      `UPDATE citizens SET earned_traits = earned_traits || $2::jsonb WHERE id = $1 AND NOT earned_traits @> $3::jsonb RETURNING id`,
      [c.id, JSON.stringify([{ id, at: new Date().toISOString() }]), JSON.stringify([{ id }])]);
    if (up.rowCount) {
      events.push({ type: 'career_milestone', citizen_id: c.id, name: c.name, trait: id, label: d.label, icon: d.icon, desc: d.desc });
      await logEvent(client, sid, c.id, 'career_milestone', `${c.name} earned a reputation: ${d.label}.`, { trait: id });
    }
  }
}

// ── Finds ──────────────────────────────────────────────────────────────────

const FISH_PARAMS = { fish: ['common', 'uncommon'], fish_rare: ['rare'], fish_legendary: ['legendary'] };

// Finds that are resources now: a miner's gemstone goes into the stores as
// Gems (lib/resource_defs.js) — the first one is a discovery.
const FIND_AS_RESOURCE = { gemstone: 'gems' };

async function grantFind(client, sid, key, season, rand = Math.random) {
  if (FIND_AS_RESOURCE[key]) {
    const RD = require('../resource_defs'), res = FIND_AS_RESOURCE[key];
    await client.query(`UPDATE settlements SET ${res} = ${res} + 1 WHERE id = $1`, [sid]);
    await require('../resources').discover(client, sid, res, 'mine');
    return { name: RD.label(res), icon: RD.icon(res), rarity: 'rare', resource: res };
  }
  let tpl;
  if (FISH_PARAMS[key]) {
    const fish = (await client.query(
      `SELECT * FROM item_templates WHERE category = 'fish' AND rarity = ANY($1::text[])
          AND (fish_seasons IS NULL OR fish_seasons::jsonb @> $2::jsonb)`,
      [FISH_PARAMS[key], JSON.stringify([season])])).rows;
    if (!fish.length) return null;
    const total = fish.reduce((a, f) => a + (Number(f.fish_weight) || 1), 0);
    let r = rand() * total;
    tpl = fish.find(f => (r -= Number(f.fish_weight) || 1) < 0) || fish[0];
  } else {
    tpl = (await client.query('SELECT * FROM item_templates WHERE item_key = $1', [key])).rows[0];
  }
  if (!tpl) return null;
  await require('../inventory').grantItem((t, p) => client.query(t, p), sid, {
    item_key: tpl.item_key, name: tpl.name, description: tpl.description || '', icon: tpl.icon || '📦',
    category: tpl.category || 'material', rarity: tpl.rarity || 'common', quantity: 1, equip_slot: tpl.equip_slot || null,
    stat_bonuses: tpl.stat_bonuses || {}, source: 'work', metadata: { sell_value: tpl.sell_value }, tradeable: tpl.tradeable !== false,
  });
  return tpl;
}

// ── Settling ───────────────────────────────────────────────────────────────

// Credit passive XP since each citizen's clock. Inside a transaction.
// opts: { citizenIds, force, now, rand }. Pushes events.
async function settleIn(client, sid, events, opts = {}) {
  const now = opts.now || Date.now();
  const nowTs = new Date(now);
  const ids = opts.citizenIds && opts.citizenIds.length ? opts.citizenIds.map(Number) : null;
  const claimed = (await client.query(
    `WITH c AS (
       SELECT id, career_settled_at FROM citizens
        WHERE settlement_id = $1 AND COALESCE(life_stage, 'adult') <> 'deceased'
          ${ids ? 'AND id = ANY($3::int[])' : ''}
          ${opts.force ? '' : `AND career_settled_at < $2::timestamptz - interval '${Math.round(SETTLE_GATE_MS / 1000)} seconds'`}
        ORDER BY id
        ${ids ? 'FOR UPDATE' : 'FOR UPDATE SKIP LOCKED'})
     UPDATE citizens x SET career_settled_at = GREATEST(x.career_settled_at, $2::timestamptz) FROM c WHERE x.id = c.id
     RETURNING x.id, c.career_settled_at AS prev`,
    ids ? [sid, nowTs, ids] : [sid, nowTs])).rows;
  if (!claimed.length) return;
  const prevOf = new Map(claimed.map(r => [r.id, Date.parse(r.prev)]));
  const state = await loadState(client, sid);
  const { byId } = profilesFrom(state, now);
  const away = await awayMap(client, sid);
  const season = require('../../seasons').seasonAt(now).id;
  const grants = [], finds = [];
  for (const c of state.citizens) {
    if (!prevOf.has(c.id) || !isAdult(c)) continue;
    const prev = prevOf.get(c.id);
    const rawH = Math.max(0, (now - prev) / 3600000);
    const hours = Math.min(MAX_CATCHUP_H, rawH);
    const p = byId.get(c.id);
    if (!hours || !p || !p.classKey || p.retraining) continue;
    const where = away.get(c.id);
    if (where && WORK_AWAY[p.classKey] !== where) continue;   // on a side job
    const rate = M.passiveRate(passiveCtx(c, p, rawH ? M.nightHours(prev, now) / rawH : 0));
    grants.push({ citizenId: c.id, classKey: p.classKey, xp: hours * rate.perHour * require('../tuning').T('passive_xp'), hours });
    if (effectsOn()) {
      for (const [k, perDay] of Object.entries(p.effects)) {
        if (k.startsWith('find:') && perDay > 0) finds.push({ c, classKey: p.classKey, item: k.slice(5), add: perDay * hours / 24 });
      }
    }
  }
  const updated = await grantXp(client, sid, grants, events);
  // Finds: progress lives on the class row; whole units become items.
  for (const f of finds) {
    const row = (updated.get(f.c.id) || {})[f.classKey];
    if (!row) continue;
    const counters = row.counters || {};
    const prog = (Number((counters.finds || {})[f.item]) || 0) + f.add;
    const whole = Math.floor(prog);
    counters.finds = { ...(counters.finds || {}), [f.item]: Math.round((prog - whole) * 1000) / 1000 };
    await client.query('UPDATE citizen_classes SET counters = $3 WHERE citizen_id = $1 AND class_key = $2', [f.c.id, f.classKey, JSON.stringify(counters)]);
    row.counters = counters;
    for (let i = 0; i < Math.min(whole, 10); i++) {
      const tpl = await grantFind(client, sid, f.item, season, opts.rand);
      if (tpl) events.push({ type: 'career_find', citizen_id: f.c.id, name: f.c.name, item: { name: tpl.name, icon: tpl.icon, rarity: tpl.rarity } });
    }
  }
  // Reveals and milestones for everyone who worked.
  const rowsBy = {};
  for (const r of state.classRows) (rowsBy[r.citizen_id] = rowsBy[r.citizen_id] || {})[r.class_key] = r;
  for (const [cid, rows] of updated) {
    const c = state.citizens.find(x => x.id === cid);
    await checkTraits(client, sid, c, { ...(rowsBy[cid] || {}), ...rows }, events, opts.rand);
  }
}

function passiveCtx(c, p, nightShare) {
  const hidden = arr(c.hidden_traits), known = arr(c.revealed_traits);
  const apt = hidden.find(t => T.APTITUDES[t] && T.APTITUDES[t].classes.includes(p.classKey));
  const avr = hidden.find(t => T.AVERSIONS[t] && T.AVERSIONS[t].classes.includes(p.classKey));
  const life = c.life || {};
  return {
    intelligence: p.stats.intelligence, traits: arr(c.visible_traits), nightShare,
    aptitude: !!apt, aptitudeKnown: !!apt && known.includes(apt),
    aversion: !!avr, aversionKnown: !!avr && known.includes(avr),
    happiness: Number(life.happiness), starving: (Number(life.hunger) || 0) >= 90,
    mentor: p.mentor, mentorBonus: p.mentorBonus, leaderAura: p.leaderAura, familyTrade: p.familyTrade,
    xp: effectsOn() ? M.eff(p.effects, 'xp') : 0,
  };
}

// Public: settle a settlement (or a few citizens) in its own transaction.
async function settle(sid, opts = {}) {
  if (!sid) return;
  const events = [];
  try {
    await withTransaction(async client => {
      await ensureRolledIn(client, sid, events);
      await settleIn(client, sid, events, opts);
    });
  } catch (e) {
    if (e && e.code === '42P01') return;   // pre-migration
    console.error('[careers] settle failed:', e.message);
    return;
  }
  publish(sid, events);
}

function publish(sid, events) {
  for (const ev of events || []) {
    try { eventBus.publish(sid, ev); } catch (_) { /* best effort */ }
  }
}

// Pre-career citizens: roll career traits once; jobs without their
// building fall back to Forager.
async function ensureRolledIn(client, sid, events) {
  const rows = (await client.query(
    `UPDATE citizens SET career_rolled = TRUE WHERE settlement_id = $1 AND NOT career_rolled
        AND COALESCE(life_stage, 'adult') <> 'deceased' RETURNING id, hidden_traits`, [sid])).rows;
  if (!rows.length) return;
  const classes = Object.keys(C.CLASSES);
  for (const r of rows) {
    const add = T.rollCareerTraits(classes).filter(t => !arr(r.hidden_traits).includes(t));
    if (add.length) await client.query('UPDATE citizens SET hidden_traits = COALESCE(hidden_traits, \'[]\'::jsonb) || $2::jsonb WHERE id = $1', [r.id, JSON.stringify(add)]);
  }
  await fixRolesIn(client, sid);
}

// Anyone in a job whose building is missing becomes a Forager.
async function fixRolesIn(client, sid) {
  const types = (await client.query('SELECT DISTINCT type FROM buildings WHERE settlement_id = $1', [sid])).rows.map(r => r.type);
  const bad = Object.keys(C.CLASSES).filter(k => !C.needsMet(C.CLASSES[k], types) && !C.CLASSES[k].assignedBy);
  if (!bad.length) return 0;
  const r = await client.query(
    `UPDATE citizens SET role = $3 WHERE settlement_id = $1 AND role = ANY($2::text[]) AND COALESCE(life_stage, 'adult') <> 'deceased' RETURNING id`,
    [sid, bad, C.FALLBACK_ROLE]);
  return r.rowCount;
}
async function fixRoles(sid) {
  return withTransaction(client => fixRolesIn(client, sid));
}

// ── Roles ──────────────────────────────────────────────────────────────────

class CareerError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// Change jobs. Credits time so far to the old job first. Throws CareerError
// when the job needs a building the settlement lacks (unless opts.fallback,
// which sends them foraging instead). Caller handles busy checks.
async function setRole(client, sid, citizenIds, role, events, opts = {}) {
  if (!C.VALID_ROLES.includes(role)) throw new CareerError(400, 'Invalid role.');
  const ids = (citizenIds || []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  await settleIn(client, sid, events, { citizenIds: ids, force: true });
  let target = role;
  const cls = C.CLASSES[role];
  if (cls && cls.needs && !opts.skipNeeds) {
    const types = (await client.query('SELECT DISTINCT type FROM buildings WHERE settlement_id = $1', [sid])).rows.map(r => r.type);
    if (!C.needsMet(cls, types)) {
      if (!opts.fallback) {
        const { BUILDINGS } = require('../../buildings');
        const names = cls.needs.map(t => (BUILDINGS[t] && BUILDINGS[t].label) || t).join(' or ');
        throw new CareerError(400, `A ${cls.label} needs a ${names} to work at.`);
      }
      target = C.FALLBACK_ROLE;
    }
  }
  // Crafting stations: one working slot per building level.
  let over = [];
  if (target === role && cls && cls.station && !opts.skipNeeds) {
    const { BUILDINGS } = require('../../buildings');
    const b = BUILDINGS[cls.station];
    const lvl = Number((await client.query('SELECT COALESCE(MAX(level), 0)::int AS l FROM buildings WHERE settlement_id = $1 AND type = $2',
      [sid, cls.station])).rows[0].l);
    const slots = b && b.craftSlots ? b.craftSlots(lvl) : Infinity;
    const taken = Number((await client.query(
      `SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1 AND role = $2 AND NOT (id = ANY($3::int[]))
          AND COALESCE(life_stage, 'adult') = 'adult'`, [sid, role, ids])).rows[0].n);
    const room = Math.max(0, slots - taken);
    if (ids.length > room) {
      if (!opts.fallback) {
        throw new CareerError(400, `The ${(b && b.label) || cls.station} has ${slots} working ${slots === 1 ? 'place' : 'places'}, all taken — upgrade it for more.`);
      }
      over = ids.slice(room);
    }
  }
  const keep = ids.filter(id => !over.includes(id));
  const r = await client.query(
    `UPDATE citizens SET role = $3 WHERE settlement_id = $1 AND id = ANY($2::int[])
        AND COALESCE(life_stage, 'adult') = 'adult' RETURNING id`, [sid, keep, target]);
  if (over.length) {
    await client.query(
      `UPDATE citizens SET role = $3 WHERE settlement_id = $1 AND id = ANY($2::int[]) AND COALESCE(life_stage, 'adult') = 'adult'`,
      [sid, over, C.FALLBACK_ROLE]);
  }
  return r.rows.map(x => x.id);
}

// Settle these citizens now (inside the caller's transaction) — call before
// any role write that doesn't go through setRole.
async function beforeRoleChange(client, sid, citizenIds, events) {
  await settleIn(client, sid, events, { citizenIds, force: true });
}

// ── Perks, forks, retraining ───────────────────────────────────────────────

async function lockRow(client, sid, citizenId, classKey) {
  const c = (await client.query(
    `SELECT id, name, role, revealed_traits, life_stage FROM citizens WHERE id = $1 AND settlement_id = $2 FOR UPDATE`,
    [citizenId, sid])).rows[0];
  if (!c) throw new CareerError(404, 'Citizen not found.');
  const row = (await client.query(
    'SELECT * FROM citizen_classes WHERE citizen_id = $1 AND class_key = $2 FOR UPDATE', [citizenId, classKey])).rows[0];
  return { c, row: row || { citizen_id: c.id, class_key: classKey, xp: 0, level: 1, spec: null, nodes: {}, retrain_until: null } };
}

async function buyNode(sid, citizenId, classKey, nodeId) {
  const cls = C.CLASSES[classKey];
  if (!cls) throw new CareerError(400, 'Unknown class.');
  const events = [];
  const res = await withTransaction(async client => {
    await settleIn(client, sid, events, { citizenIds: [citizenId], force: true });
    const { c, row } = await lockRow(client, sid, citizenId, classKey);
    const why = M.buyBlocker(cls.tree, row, nodeId, { revealed: arr(c.revealed_traits), now: Date.now() });
    if (why) throw new CareerError(400, why);
    const nodes = { ...(row.nodes || {}), [nodeId]: (Number((row.nodes || {})[nodeId]) || 0) + 1 };
    await client.query(
      `INSERT INTO citizen_classes (citizen_id, settlement_id, class_key, nodes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (citizen_id, class_key) DO UPDATE SET nodes = EXCLUDED.nodes, updated_at = NOW()`,
      [c.id, sid, classKey, JSON.stringify(nodes)]);
    return { nodes, free: M.freePoints(cls.tree, { ...row, nodes }) };
  });
  publish(sid, events);
  return res;
}

async function chooseFork(sid, citizenId, classKey, specKey) {
  const cls = C.CLASSES[classKey];
  if (!cls || !cls.fork) throw new CareerError(400, 'This job has no paths to choose.');
  if (!C.specOf(cls, specKey)) throw new CareerError(400, 'Unknown path.');
  const events = [];
  const res = await withTransaction(async client => {
    await settleIn(client, sid, events, { citizenIds: [citizenId], force: true });
    const { c, row } = await lockRow(client, sid, citizenId, classKey);
    if (row.level < M.FORK_LEVEL) throw new CareerError(400, `Paths open at level ${M.FORK_LEVEL}.`);
    if (row.spec) throw new CareerError(409, 'The path is already chosen — it is for life.');
    const up = await client.query(
      'UPDATE citizen_classes SET spec = $3, updated_at = NOW() WHERE citizen_id = $1 AND class_key = $2 AND spec IS NULL RETURNING spec',
      [c.id, classKey, specKey]);
    if (!up.rowCount) throw new CareerError(409, 'The path is already chosen.');
    const spec = C.specOf(cls, specKey);
    events.push({ type: 'career_fork', citizen_id: c.id, name: c.name, class_key: classKey, spec: specKey, label: spec.label, icon: spec.icon });
    await logEvent(client, sid, c.id, 'career_fork', `${c.name} chose the path of the ${spec.label}.`, { class: classKey, spec: specKey });
    return { spec: specKey };
  });
  publish(sid, events);
  return res;
}

// Refund every perk point for gold; the citizen can't work for 2h.
async function retrain(sid, citizenId, classKey) {
  const cls = C.CLASSES[classKey];
  if (!cls) throw new CareerError(400, 'Unknown class.');
  const events = [];
  const res = await withTransaction(async client => {
    await client.query('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [sid]);
    await settleIn(client, sid, events, { citizenIds: [citizenId], force: true });
    const { c, row } = await lockRow(client, sid, citizenId, classKey);
    const spent = M.spentPoints(cls.tree, row.nodes);
    if (!spent) throw new CareerError(400, 'No perks to unlearn.');
    if (row.retrain_until && Date.parse(row.retrain_until) > Date.now()) throw new CareerError(409, 'Already retraining.');
    const gold = spent * RETRAIN_GOLD_PER_POINT;
    const paid = await client.query('UPDATE settlements SET wealth = wealth - $2 WHERE id = $1 AND wealth >= $2 RETURNING wealth', [sid, gold]);
    if (!paid.rowCount) throw new CareerError(400, `Retraining costs ${gold} gold.`);
    const until = new Date(Date.now() + RETRAIN_HOURS * 3600000);
    await client.query(
      `UPDATE citizen_classes SET nodes = '{}'::jsonb, retrain_until = $3, retrains = retrains + 1, updated_at = NOW()
        WHERE citizen_id = $1 AND class_key = $2`, [c.id, classKey, until]);
    return { gold, until: until.toISOString(), refunded: spent, wealth: paid.rows[0].wealth };
  });
  publish(sid, events);
  return res;
}

// ── Reading ────────────────────────────────────────────────────────────────

// Everything the Career tab shows for one citizen.
async function citizenCareer(sid, citizenId) {
  await settle(sid, { citizenIds: [citizenId], force: true });
  const state = await loadState(null, sid);
  const c = state.citizens.find(x => x.id === Number(citizenId));
  if (!c) throw new CareerError(404, 'Citizen not found.');
  const now = Date.now();
  const { byId } = profilesFrom(state, now);
  const p = byId.get(c.id) || null;
  const rows = state.classRows.filter(r => r.citizen_id === c.id);
  const view = r => {
    const cls = C.CLASSES[r.class_key];
    const prog = M.levelProgress(Number(r.xp));
    return {
      class_key: r.class_key, xp: Number(r.xp), level: r.level, spec: r.spec, nodes: r.nodes || {},
      hours_worked: Number(r.hours_worked), years: M.serviceYears(r.hours_worked),
      into: prog.into, need: prog.need, pct: prog.pct,
      free_points: cls ? M.freePoints(cls.tree, r) : 0, retrain_until: r.retrain_until,
      fork_ready: !!(cls && cls.fork && r.level >= M.FORK_LEVEL && !r.spec),
      title: cls ? M.titleFor(r.level, cls.label, (C.specOf(cls, r.spec) || {}).label) : r.class_key,
      retrain_cost: cls ? M.spentPoints(cls.tree, r.nodes) * RETRAIN_GOLD_PER_POINT : 0,
    };
  };
  const away = await awayMap(null, sid);
  const rate = p && p.classKey ? M.passiveRate(passiveCtx(c, p, 0)) : null;
  const events = (await query(
    `SELECT event_type, narrative, meta, occurred_at FROM citizen_events
      WHERE citizen_id = $1 AND event_type IN ('career_level','career_fork','career_milestone','trait_revealed')
      ORDER BY occurred_at DESC LIMIT 12`, [c.id])).rows;
  return {
    citizen_id: c.id, name: c.name, role: c.role, life_stage: c.life_stage,
    classes: rows.map(view),
    active: p && p.classKey ? {
      class_key: p.classKey,
      effects: p.effects, sources: p.sources, stats: p.stats, skills: p.skills,
      output_mult: p.outputMult, stat_mult: p.statMult,
      mentor: p.mentor ? p.mentorName : null, mentor_bonus: p.mentor ? 0.2 + (p.mentorBonus || 0) : 0, apprentices: p.apprentices || 0,
      leader_aura: p.leaderAura, family_trade: p.familyTrade, retraining: p.retraining,
      xp_rate: rate, away: away.get(c.id) || null,
    } : null,
    revealed_traits: arr(c.revealed_traits).map(t => ({ id: t, ...(T.traitInfo(t) || { label: t }) })),
    hints: arr(c.trait_hints).filter(t => !arr(c.revealed_traits).includes(t)).map(t => ({ id: t, hint: `${c.name} ${(T.traitInfo(t) || {}).hint || '…'}` })),
    earned_traits: arr(c.earned_traits).map(e => ({ ...e, ...(e.id === 'veteran' || e.id === 'old_hand'
      ? { label: (e.id === 'veteran' ? 'Veteran ' : 'Elder ') + ((C.CLASSES[e.class] || {}).label || e.class), icon: e.id === 'veteran' ? '🎖️' : '🧓',
          effects: T.SERVICE[e.id].effects } : (T.traitInfo(e.id) || {})) })),
    counters: c.career_counters || {},
    history: events,
  };
}

// "Has her mother's hands": a child carrying a talent a parent has revealed.
function familyHint(c, all) {
  if ((c.life_stage || 'adult') !== 'child') return null;
  for (const pid of arr(c.parent_ids)) {
    const p = all.find(x => x.id === Number(pid));
    if (!p) continue;
    const t = arr(c.hidden_traits).find(h => T.APTITUDES[h] && arr(p.revealed_traits).includes(h));
    if (t) {
      const rel = p.gender === 'female' ? 'mother' : p.gender === 'male' ? 'father' : 'parent';
      return { trait: t, label: T.APTITUDES[t].label, icon: T.APTITUDES[t].icon, text: `Shows a touch of their ${rel}'s ${T.APTITUDES[t].label.toLowerCase()} already.` };
    }
  }
  return null;
}

// Compact per-citizen career info for GET /api/citizens.
function summaries(state, now = Date.now()) {
  const { byId } = profilesFrom(state, now);
  const out = new Map();
  for (const c of state.citizens) {
    const rows = state.classRows.filter(r => r.citizen_id === c.id);
    const cls = C.CLASSES[c.role];
    const row = rows.find(r => r.class_key === c.role);
    const p = byId.get(c.id);
    const lvl = row ? row.level : 1;
    out.set(c.id, {
      career: cls ? {
        class_key: c.role, level: lvl, spec: row ? row.spec : null,
        title: M.titleFor(lvl, cls.label, (C.specOf(cls, row && row.spec) || {}).label),
        pct: M.levelProgress(row ? Number(row.xp) : 0).pct,
        points_free: row ? M.freePoints(cls.tree, row) : 0,
        fork_ready: !!(cls.fork && row && row.level >= M.FORK_LEVEL && !row.spec),
        years: M.serviceYears(row ? row.hours_worked : 0),
      } : null,
      class_levels: Object.fromEntries(rows.map(r => [r.class_key, r.level])),
      effective_skills: p ? p.skills : null,
      job_mood: p ? Math.round(p.effects.mood || 0) : 0,
      revealed_hidden_traits: arr(c.revealed_traits),
      trait_hints: arr(c.trait_hints).filter(t => !arr(c.revealed_traits).includes(t)),
      // Children: a talent a parent is known to have shows as a family likeness.
      family_hint: familyHint(c, state.citizens),
      earned_traits: arr(c.earned_traits),
    });
  }
  return out;
}

// ── Definitions for the client ─────────────────────────────────────────────

let _defs = null;
function defs() {
  if (_defs) return _defs;
  const { BUILDINGS } = require('../../buildings');
  const classes = {};
  for (const [k, c] of Object.entries(C.CLASSES)) {
    classes[k] = {
      key: k, label: c.label, icon: c.icon, kind: c.kind, primary: c.primary, secondary: c.secondary, skill: c.skill,
      needs: c.needs, needs_labels: (c.needs || []).map(t => (BUILDINGS[t] && BUILDINGS[t].label) || t),
      assignable: !c.assignedBy, desc: c.desc, fork: c.fork || null, base: c.base || {}, physical: !!c.physical, station: c.station || null,
      tree: c.tree.filter(n => !n.retired),
    };
  }
  const pub = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { label: v.label, icon: v.icon, desc: v.desc, classes: v.classes, effects: v.effects }]));
  _defs = {
    classes, effects: M.EFFECTS, fork_level: M.FORK_LEVEL, max_level: M.MAX_LEVEL,
    curve: Array.from({ length: M.MAX_LEVEL }, (_, i) => M.xpForLevel(i + 1)),
    traits: {
      aptitudes: pub(T.APTITUDES), aversions: pub(T.AVERSIONS),
      legacy: Object.fromEntries(Object.entries(T.LEGACY).map(([k, v]) => [k, { label: v.label, icon: v.icon, desc: v.desc }])),
      deeds: T.DEEDS,
      quirks: Object.fromEntries(Object.entries(T.QUIRKS).map(([k, q]) => [k, {
        good: q.good.map(([id, label, icon, effects]) => ({ id, label, icon, effects })),
        bad: q.bad.map(([id, label, icon, effects]) => ({ id, label, icon, effects })),
      }])),
      reveal_hours: { aptitude: T.APTITUDE_REVEAL_HOURS, aversion: T.AVERSION_REVEAL_HOURS },
    },
    service: { veteran: T.SERVICE.veteran.hours, quirk: T.SERVICE.quirk.hours, old_hand: T.SERVICE.old_hand.hours, hours_per_year: M.HOURS_PER_YEAR },
    retrain: { gold_per_point: RETRAIN_GOLD_PER_POINT, hours: RETRAIN_HOURS },
    mentor: { min_level: P.MENTOR_MIN_LEVEL, gap: P.MENTOR_GAP },
  };
  return _defs;
}

// ── Worker sweep ───────────────────────────────────────────────────────────

async function tick() {
  try {
    const due = (await query(
      `SELECT settlement_id FROM citizens
        WHERE COALESCE(life_stage, 'adult') <> 'deceased'
          AND (career_settled_at < NOW() - interval '${SWEEP_STALE_MIN} minutes' OR NOT career_rolled)
        GROUP BY settlement_id ORDER BY MIN(career_settled_at) LIMIT ${SWEEP_LIMIT}`)).rows;
    for (const r of due) await settle(r.settlement_id);
  } catch (e) {
    if (e && e.code === '42P01' || e && e.code === '42703') return;   // pre-migration
    console.error('[careers] tick failed:', e.message);
  }
}

// ── Dev Tools ──────────────────────────────────────────────────────────────

async function adminGrant(sid, citizenId, classKey, { xp, level, hours }) {
  if (!C.CLASSES[classKey]) throw new CareerError(400, 'Unknown class.');
  const events = [];
  await withTransaction(async client => {
    const cur = (await client.query('SELECT xp FROM citizen_classes WHERE citizen_id = $1 AND class_key = $2', [citizenId, classKey])).rows[0];
    let add = Number(xp) || 0;
    if (level) {
      const target = M.xpForLevel(Math.max(1, Math.min(M.MAX_LEVEL, Number(level))));
      const have = cur ? Number(cur.xp) : 0;
      if (target < have) {
        await client.query('UPDATE citizen_classes SET xp = $3, level = $4 WHERE citizen_id = $1 AND class_key = $2',
          [citizenId, classKey, target, M.levelForXp(target)]);
        add = 0;
      } else add += target - have;
    }
    const updated = await grantXp(client, sid, [{ citizenId, classKey, xp: Math.max(0, add) + 0.0001, hours: Number(hours) || 0 }], events);
    const c = (await client.query('SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2', [citizenId, sid])).rows[0];
    if (c) {
      const rows = {};
      (await client.query('SELECT * FROM citizen_classes WHERE citizen_id = $1', [citizenId])).rows.forEach(r => { rows[r.class_key] = r; });
      await checkTraits(client, sid, c, { ...rows, ...(updated.get(c.id) || {}) }, events);
    }
  });
  publish(sid, events);
}

async function adminReveal(sid, citizenId, trait) {
  const info = T.traitInfo(trait);
  if (!info) throw new CareerError(400, 'Unknown trait.');
  const events = [];
  await withTransaction(async client => {
    const c = (await client.query('SELECT id, name, hidden_traits, revealed_traits FROM citizens WHERE id = $1 AND settlement_id = $2 FOR UPDATE', [citizenId, sid])).rows[0];
    if (!c) throw new CareerError(404, 'Citizen not found.');
    const hidden = arr(c.hidden_traits).includes(trait) ? arr(c.hidden_traits) : [...arr(c.hidden_traits), trait];
    const revealed = arr(c.revealed_traits).includes(trait) ? arr(c.revealed_traits) : [...arr(c.revealed_traits), trait];
    await client.query('UPDATE citizens SET hidden_traits = $2, revealed_traits = $3 WHERE id = $1', [c.id, JSON.stringify(hidden), JSON.stringify(revealed)]);
    events.push({ type: 'trait_revealed', citizen_id: c.id, name: c.name, trait, label: info.label, icon: info.icon, desc: info.desc, kind: info.kind });
  });
  publish(sid, events);
}

async function adminReset(sid, citizenId, classKey) {
  await query('DELETE FROM citizen_classes WHERE citizen_id = $1 AND settlement_id = $2 AND ($3::text IS NULL OR class_key = $3)', [citizenId, sid, classKey || null]);
  if (!classKey) {
    await query(`UPDATE citizens SET revealed_traits = '[]', trait_hints = '[]', earned_traits = '[]', career_counters = '{}' WHERE id = $1 AND settlement_id = $2`, [citizenId, sid]);
  }
}

module.exports = {
  CareerError, RETRAIN_GOLD_PER_POINT, RETRAIN_HOURS, SETTLE_GATE_MS,
  loadState, loadWorkforce, profilesFor, awayMap, withStateCache, _loadStats,
  grantXp, settle, settleIn, setRole, beforeRoleChange, fixRoles, fixRolesIn,
  checkTraits, revealOnEvent, bumpCounter, combatDeltas, recordInjury, townBonuses, travelCitizen, attachUpkeep, envoySpeed,
  buyNode, chooseFork, retrain, citizenCareer, summaries, defs, publish, tick,
  adminGrant, adminReveal, adminReset, effectsOn,
  _grantFind: grantFind,
};
