// ══════════════════════════════════════════════════════════════════════════
//  CLAN QUESTS — definitions, board rotation, combat, resolution
//
//  Definitions live in quest_definitions with quest_source = 'clan', edited
//  in the Dev Tools quest admin (clan_min_level, clan_prestige, rewards,
//  requires = party roles, combat_chance / combat_encounter). SEED_POOL
//  below seeds them on first boot and from the admin's "Seed built-ins".
//
//  Board rotation: each clan sees BOARD_SOLO solo + BOARD_PARTY party quests
//  a day, drawn from the quests its level has unlocked with an RNG seeded by
//  (clan, UTC day) — every member sees the same board, clans differ, and it
//  changes at UTC midnight. Only today's board can be started; runs already
//  underway finish regardless.
//
//  Combat: when a run sets out it may roll an encounter (combat_chance %),
//  triggering at 10–90% of the way through. Clan battles auto-resolve (a
//  party spans several players, so nobody plays it by hand): victory and
//  the quest carries on; defeat ends the run as a failure. In keeping with
//  "failing costs nothing", clan battles never injure citizens.
//
//  Two kinds, posted on the clan's board (routes/clan_quests.js):
//    solo  — one member sends one of their citizens; starts at once. Each
//            member can run each solo quest once per UTC day.
//    party — several roles. Members each assign ONE of their citizens to one
//            role (one role per member per run); the run starts when every
//            role is filled. One forming/active party per quest per clan,
//            one completion per quest per clan per day. A forming party
//            lapses after FORMING_HOURS with nothing lost.
//
//  Success uses the personal-quest formula: base + (skill − 1) × 4%, capped
//  at 95% (party: the average of each role's skill). On success every
//  participant's settlement gets the quest's rewards and the clan gains
//  prestige per participant — solo through the daily cap, party as a
//  milestone outside it (a whole group's effort). Failure costs nothing.
//
//  Citizens in a live run (clan_quest_slots.active) are busy: the personal
//  quest, expedition and envoy routes check busyCitizenIds(), and
//  /api/citizens reports them via active_quest.
//
//  tick() is called by the quest worker: resolves due runs (FOR UPDATE SKIP
//  LOCKED) and expires stale forming parties; events go out after COMMIT.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query, withTransaction } = require('../db');
const eventBus = require('./event_bus');

const FORMING_HOURS = 24;
const SOLO_UNLOCK_LEVEL = 1;
const PARTY_UNLOCK_LEVEL = 2;
const RESOURCES = ['food', 'timber', 'stone', 'metal', 'wealth'];

const BOARD_SOLO = 3;
const BOARD_PARTY = 2;
const DEFS_TTL_MS = 10 * 1000;

// Seed data only — the live definitions are rows in quest_definitions.
const SEED_POOL = [
  // ── Solo ────────────────────────────────────────────────────────────────
  {
    key: 'cq_hall_provisions', kind: 'solo', min_level: 1, icon: '🧺',
    title: 'Provision the Clan Hall',
    description: 'The hall pantry runs low. Gather what the woods offer and bring it home to share.',
    skill_key: 'farming', base_success: 0.6, duration_s: 180,
    rewards: { food: 30, wealth: 10 }, prestige: 12,
    flavour_success: 'returns with baskets brimming — the hall eats well tonight.',
    flavour_fail: 'finds the thickets picked clean and comes home empty-handed.',
  },
  {
    key: 'cq_border_patrol', kind: 'solo', min_level: 1, icon: '🧭',
    title: 'Walk the Border',
    description: 'Walk the edge of clan land and report anything amiss.',
    skill_key: 'scouting', base_success: 0.55, duration_s: 240,
    rewards: { wealth: 20 }, prestige: 15, combat_chance: 20, combat_encounter: [],
    flavour_success: 'maps a new trail along the border and earns a merchant\'s thanks.',
    flavour_fail: 'loses the trail in the fog and turns back.',
  },
  {
    key: 'cq_mend_banners', kind: 'solo', min_level: 2, icon: '🪡',
    title: 'Mend the Banners',
    description: 'Storm-torn banners hang over the hall. Stitch them whole again.',
    skill_key: 'crafting', base_success: 0.55, duration_s: 240,
    rewards: { timber: 20, wealth: 15 }, prestige: 15,
    flavour_success: 'raises the banners bright and whole — spirits lift across the clan.',
    flavour_fail: 'pricks a paw one too many times and gives up for the day.',
  },
  {
    key: 'cq_river_haul', kind: 'solo', min_level: 3, icon: '🎣',
    title: 'The Clan\'s River Haul',
    description: 'Fish enough for a clan feast before the river turns.',
    skill_key: 'fishing', base_success: 0.5, duration_s: 300,
    rewards: { food: 45, wealth: 15 }, prestige: 20,
    flavour_success: 'hauls in a feast\'s worth of silver fish.',
    flavour_fail: 'watches the river run empty all afternoon.',
  },
  // ── Party ───────────────────────────────────────────────────────────────
  {
    key: 'cp_bandit_ford', kind: 'party', min_level: 2, icon: '⚔️',
    title: 'Clear the Bandit Ford',
    description: 'Bandits have taken the old ford. It will take more than one settlement to drive them out.',
    roles: [
      { label: 'Scout',   skill_key: 'scouting', desc: 'Find their camp' },
      { label: 'Fighter', skill_key: 'combat',   desc: 'Break their line' },
    ],
    base_success: 0.5, duration_s: 480,
    rewards: { wealth: 45, metal: 10 }, prestige: 40, combat_chance: 60, combat_encounter: [],
    flavour_success: 'The ford is clear and the bandits\' strongbox is shared out.',
    flavour_fail: 'The bandits held the ford — everyone made it home, wiser.',
  },
  {
    key: 'cp_raise_watchtower', kind: 'party', min_level: 3, icon: '🗼',
    title: 'Raise a Watchtower',
    description: 'A watchtower on the ridge would guard every member\'s road. Many paws make light work.',
    roles: [
      { label: 'Builder',  skill_key: 'crafting', desc: 'Frame the tower' },
      { label: 'Forager',  skill_key: 'farming',  desc: 'Feed the workers' },
      { label: 'Lookout',  skill_key: 'scouting', desc: 'Choose the site' },
    ],
    base_success: 0.48, duration_s: 600,
    rewards: { stone: 35, timber: 30, wealth: 25 }, prestige: 55,
    flavour_success: 'The watchtower stands tall on the ridge, flying the clan banner.',
    flavour_fail: 'The ridge wind toppled the frame. Another day.',
  },
  {
    key: 'cp_great_hunt', kind: 'party', min_level: 4, icon: '🏹',
    title: 'The Great Hunt',
    description: 'A great boar roams the deep wood. Only a full hunting party will bring it down.',
    roles: [
      { label: 'Tracker',  skill_key: 'scouting', desc: 'Follow the trail' },
      { label: 'Hunter',   skill_key: 'combat',   desc: 'Bring it down' },
      { label: 'Trapper',  skill_key: 'crafting', desc: 'Build the snares' },
      { label: 'Cook',     skill_key: 'farming',  desc: 'Feed the hunt' },
    ],
    base_success: 0.45, duration_s: 900,
    rewards: { food: 60, wealth: 40 }, prestige: 80, combat_chance: 50, combat_encounter: [],
    flavour_success: 'The great boar is felled — the clan feasts for days.',
    flavour_fail: 'The boar slipped the snares and vanished into the deep wood.',
  },
];

// ── Definitions (quest_definitions, quest_source = 'clan') ────────────────

// DB row → the shape the rest of this module uses.
function rowToDef(r) {
  const kind = r.quest_type === 'party' ? 'party' : 'solo';
  let rewards = r.rewards && typeof r.rewards === 'object' ? { ...r.rewards } : {};
  if (!Object.keys(rewards).length && Number(r.reward_gold) > 0) rewards = { wealth: Number(r.reward_gold) };
  const roles = (Array.isArray(r.requires) ? r.requires : [])
    .filter(x => x && (x.skill_key || x.role_label || x.label))
    .map(x => ({ label: x.role_label || x.label || 'Member', skill_key: x.skill_key || null, desc: x.desc || '' }));
  let enc = r.combat_encounter;
  if (typeof enc === 'string') { try { enc = JSON.parse(enc); } catch (_) { enc = []; } }
  return {
    key: r.id, kind, min_level: Math.max(1, Number(r.clan_min_level) || 1), icon: r.icon || '📜',
    title: r.title, description: r.description || '', skill_key: r.skill_key || null,
    base_success: Number(r.base_success) || 0.5, duration_s: Math.max(10, Number(r.duration_s) || 120),
    rewards, prestige: Math.max(0, Number(r.clan_prestige) || 0), roles: kind === 'party' ? roles : null,
    flavour_success: r.flavour_success || '', flavour_fail: r.flavour_fail || '',
    combat_chance: Math.max(0, Math.min(100, Number(r.combat_chance) || 0)),
    combat_encounter: Array.isArray(enc) ? enc : [],
    archived: !!r.archived, sort_order: Number(r.sort_order) || 0,
    valid: kind === 'solo' || roles.length >= 1,
  };
}

let _defs = null, _defsAt = 0;
async function loadDefs(force) {
  if (!force && _defs && Date.now() - _defsAt < DEFS_TTL_MS) return _defs;
  const r = await query("SELECT * FROM quest_definitions WHERE quest_source = 'clan' ORDER BY sort_order, created_at");
  _defs = r.rows.map(rowToDef);
  _defsAt = Date.now();
  return _defs;
}
function invalidateDefs() { _defs = null; }
// Includes archived quests, so runs of a retired quest still resolve.
async function byKey(key) { return (await loadDefs()).find(d => d.key === key) || null; }

// Inserts the built-in clan quests that don't exist yet. Returns the count.
// onlyIfEmpty (boot): skip entirely once any clan quest exists, so quests an
// admin deleted don't come back.
async function seedDefinitions({ onlyIfEmpty = false } = {}) {
  if (onlyIfEmpty) {
    const any = await query("SELECT 1 FROM quest_definitions WHERE quest_source = 'clan' LIMIT 1");
    if (any.rows.length) return 0;
  }
  let n = 0;
  for (const [i, q] of SEED_POOL.entries()) {
    const r = await query(
      `INSERT INTO quest_definitions
         (id, title, description, icon, category, quest_type, skill_key, base_success, duration_s,
          reward_gold, rewards, requires, flavour_success, flavour_fail, sort_order, quest_source,
          clan_min_level, clan_prestige, combat_chance, combat_encounter)
       VALUES ($1,$2,$3,$4,'clan',$5,$6,$7,$8,0,$9,$10,$11,$12,$13,'clan',$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [q.key, q.title, q.description, q.icon, q.kind, q.skill_key || null, q.base_success, q.duration_s,
       JSON.stringify(q.rewards || {}),
       JSON.stringify((q.roles || []).map(x => ({ role_label: x.label, skill_key: x.skill_key, desc: x.desc }))),
       q.flavour_success || '', q.flavour_fail || '', i, q.min_level, q.prestige,
       q.combat_chance || 0, JSON.stringify(q.combat_encounter || [])]);
    n += r.rowCount;
  }
  invalidateDefs();
  return n;
}

// ── Board rotation ───────────────────────────────────────────────────────

const gateFor = d => Math.max(d.min_level, d.kind === 'party' ? PARTY_UNLOCK_LEVEL : SOLO_UNLOCK_LEVEL);

function seededRng(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {   // mulberry32
    h |= 0; h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(list, n, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n).sort((x, y) => x.sort_order - y.sort_order);
}

// Today's board for a clan: { solo, party, locked: [defs above its level],
// rotates_at }.
async function boardFor(clanId, level, day = utcDay()) {
  const live = (await loadDefs()).filter(d => !d.archived && d.valid);
  const open = live.filter(d => gateFor(d) <= level);
  const rng = seededRng(`${clanId}:${day}`);
  const next = new Date(`${day}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return {
    solo: pick(open.filter(d => d.kind === 'solo'), BOARD_SOLO, rng),
    party: pick(open.filter(d => d.kind === 'party'), BOARD_PARTY, rng),
    locked: live.filter(d => gateFor(d) > level).sort((a, b) => gateFor(a) - gateFor(b)),
    rotates_at: next.toISOString(),
  };
}
async function onBoard(clanId, level, key) {
  const b = await boardFor(clanId, level);
  return b.solo.some(d => d.key === key) || b.party.some(d => d.key === key);
}

// ── Combat ───────────────────────────────────────────────────────────────

// Rolls an encounter for a run that is setting out. Returns the columns to
// store, or null for a peaceful trip.
function rollCombat(def) {
  if (!(def.combat_chance > 0) || Math.random() * 100 >= def.combat_chance) return null;
  const frac = 0.10 + Math.random() * 0.80;
  return {
    trigger_at: new Date(Date.now() + def.duration_s * 1000 * frac),
    seed: Math.floor(Math.random() * 0x7fffffff) + 1,
    encounter: def.combat_encounter.slice(),
  };
}
async function setOut(client, runId, def) {
  const c = rollCombat(def);
  await client.query(
    `UPDATE clan_quest_runs SET status = 'active', started_at = NOW(), expires_at = NULL,
            completes_at = NOW() + make_interval(secs => $2),
            combat_status = $3, combat_trigger_at = $4, combat_seed = $5, combat_encounter = $6
      WHERE id = $1`,
    [runId, def.duration_s, c ? 'rolled' : 'none', c ? c.trigger_at : null, c ? c.seed : null,
     JSON.stringify(c ? c.encounter : [])]);
  return !!c;
}

async function fallbackEnemy() {
  try {
    const r = await query('SELECT id FROM enemy_definitions WHERE archived = FALSE ORDER BY random() LIMIT 1');
    if (r.rows.length) return [r.rows[0].id];
  } catch (_) {}
  return ['marsh_rat'];
}
async function enemyNames(keys) {
  if (!keys || !keys.length) return [];
  try {
    const r = await query('SELECT id, name FROM enemy_definitions WHERE id = ANY($1::text[])', [keys]);
    const m = Object.fromEntries(r.rows.map(x => [x.id, x.name]));
    return keys.map(k => m[k] || k.replace(/_/g, ' '));
  } catch (_) { return keys.map(k => k.replace(/_/g, ' ')); }
}

// Fights every due encounter. Victory: the run carries on. Defeat: the run
// fails now (nothing lost). Returns the number of battles fought.
async function resolveCombat() {
  const after = [];
  const n = await withTransaction(async (client) => {
    const due = (await client.query(
      `SELECT * FROM clan_quest_runs WHERE status = 'active' AND combat_status = 'rolled' AND combat_trigger_at <= NOW()
        ORDER BY combat_trigger_at FOR UPDATE SKIP LOCKED LIMIT 20`)).rows;
    const resolver = require('./combat_resolver');
    for (const run of due) {
      const def = await byKey(run.quest_key);
      const slots = (await client.query(
        `SELECT s.*, c.name AS citizen_name FROM clan_quest_slots s JOIN citizens c ON c.id = s.citizen_id
          WHERE s.run_id = $1 ORDER BY s.role_index`, [run.id])).rows;
      let enc = Array.isArray(run.combat_encounter) ? run.combat_encounter : [];
      if (!enc.length) enc = await fallbackEnemy();
      let result;
      try {
        result = await resolver.autoResolveBattle({ citizenIds: slots.map(s => s.citizen_id), enemyKeys: enc, seed: Number(run.combat_seed) || 1 });
      } catch (e) {
        console.error('[clan_quests] battle crashed for run', run.id, e.message);
        result = { outcome: 'victory', log: ['The skirmish broke off before it began.'] };   // never punish a crash
      }
      const outcome = result.outcome === 'defeat' ? 'defeat' : 'victory';
      const log = (result.log || []).slice(-80);
      await client.query(
        `UPDATE clan_quest_runs SET combat_status = 'resolved', combat_outcome = $2, combat_log = $3, combat_encounter = $4
          ${outcome === 'defeat' ? ", status = 'failed', resolved_at = NOW(), success_chance = 0, success_roll = 1" : ''}
          WHERE id = $1`, [run.id, outcome, JSON.stringify(log), JSON.stringify(enc)]);
      const foes = (await enemyNames(enc)).join(', ');
      const title = def ? def.title : run.quest_key;
      if (outcome === 'defeat') {
        await client.query('UPDATE clan_quest_slots SET active = FALSE WHERE run_id = $1', [run.id]);
        for (const s of slots) {
          await client.query(
            'INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
            [s.settlement_id, 'quest_fail', `${s.citizen_name} and the clan party were driven back by ${foes} on "${title}" — everyone made it home.`,
             JSON.stringify([s.citizen_id])]);
        }
        await client.query(
          `INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'clan_quest_failed',NULL,$2)`,
          [run.clan_id, JSON.stringify({ run_id: run.id, quest_key: run.quest_key, title, kind: run.kind, battle: 'defeat', foes })]);
      }
      after.push({ run, def, slots, outcome, foes, title, enemies: enc.length });
    }
    return due.length;
  });
  const { systemLine } = require('./clan_chat');
  const gameEvents = require('./game_events');
  for (const { run, def, slots, outcome, foes, title, enemies } of after) {
    publishClan(run.clan_id, { run_id: run.id, what: outcome === 'defeat' ? 'failed' : 'battle_won' });
    systemLine(run.clan_id, outcome === 'victory'
      ? `⚔️ ${def ? def.icon + ' ' : ''}"${title}": the party fought off ${foes} and presses on!`
      : `⚔️ "${title}": the party was driven back by ${foes}. Everyone made it home.`);
    for (const s of slots) {
      eventBus.publish(s.settlement_id, outcome === 'defeat'
        ? { type: 'clan_quest_resolved', run_id: run.id, outcome: 'failed', title, kind: run.kind, battle: 'defeat', foes }
        : { type: 'clan_quest_battle', run_id: run.id, outcome, title, foes });
      if (outcome === 'victory') gameEvents.emit('battle_won', { settlementId: s.settlement_id, enemyCount: enemies });
    }
  }
  return n;
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const roleCount = def => (def.kind === 'party' ? def.roles.length : 1);
const skillFor = (def, roleIndex) => (def.kind === 'party' ? def.roles[roleIndex].skill_key : def.skill_key);
const chanceFor = (base, skill) => Math.min(0.95, base + ((Number(skill) || 1) - 1) * 0.04);

// ── Citizen availability ─────────────────────────────────────────────────

// Of `ids`, the citizens held by a live clan run.
async function busyCitizenIds(ids, db) {
  const run = db ? (t, p) => db.query(t, p) : query;
  if (!ids || !ids.length) return [];
  const r = await run('SELECT citizen_id FROM clan_quest_slots WHERE active AND citizen_id = ANY($1::int[])',
    [ids.map(Number)]);
  return r.rows.map(x => x.citizen_id);
}

// Loads the citizen for a clan slot and checks it is free for anything.
// Throws { status, message } errors via the `fail` callback.
async function availableCitizen(db, citizenId, settlementId) {
  const c = (await db.query('SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2', [citizenId, settlementId])).rows[0];
  if (!c) return { error: 'That citizen is not yours.' };
  if (c.life_stage === 'child') return { error: 'Children stay home.' };
  const onQuest = await db.query(
    "SELECT 1 FROM settlement_quests WHERE (citizen_id = $1 OR party_ids @> $2::jsonb) AND status = 'active'",
    [citizenId, JSON.stringify([Number(citizenId)])]);
  if (onQuest.rows.length) return { error: `${c.name} is already on a quest.` };
  const onExp = await db.query("SELECT 1 FROM expeditions WHERE citizen_id = $1 AND status = 'travelling'", [citizenId]);
  if (onExp.rows.length) return { error: `${c.name} is out scouting.` };
  const onDiplo = await db.query(
    "SELECT 1 FROM diplomacy_relations WHERE citizen_id = $1 AND (status = 'contact_sent' OR pending_action IS NOT NULL)",
    [citizenId]);
  if (onDiplo.rows.length) return { error: `${c.name} is on a diplomatic mission.` };
  if ((await busyCitizenIds([citizenId], db)).length) return { error: `${c.name} is already on a clan quest.` };
  return { citizen: c };
}

// ── Events ───────────────────────────────────────────────────────────────

function publishClan(clanId, payload) {
  eventBus.publish(`clan:${clanId}`, { type: 'clan_quest_updated', clan_id: clanId, ...payload });
}

// ── Resolution ───────────────────────────────────────────────────────────

// Resolves every due active run. Returns the number resolved.
async function resolveDue() {
  const after = [];   // work to do after COMMIT
  const n = await withTransaction(async (client) => {
    const due = (await client.query(
      `SELECT * FROM clan_quest_runs WHERE status = 'active' AND completes_at <= NOW()
          AND combat_status <> 'rolled'
        ORDER BY completes_at FOR UPDATE SKIP LOCKED LIMIT 50`)).rows;
    for (const run of due) {
      const def = await byKey(run.quest_key);
      const slots = (await client.query(
        `SELECT s.*, c.name AS citizen_name, c.skills, u.username
           FROM clan_quest_slots s
           JOIN citizens c ON c.id = s.citizen_id
           JOIN users u ON u.id = s.user_id
          WHERE s.run_id = $1 ORDER BY s.role_index`, [run.id])).rows;
      let chance = 0, roll = 1, outcome = 'failed';
      if (def && slots.length) {
        const avg = slots.reduce((sum, s) => sum + (Number((s.skills || {})[skillFor(def, s.role_index)]) || 1), 0) / slots.length;
        chance = chanceFor(def.base_success, avg);
        roll = Math.random();
        outcome = roll < chance ? 'completed' : 'failed';
      }
      await client.query(
        `UPDATE clan_quest_runs SET status = $2, resolved_at = NOW(), success_chance = $3, success_roll = $4 WHERE id = $1`,
        [run.id, outcome, chance, roll]);
      await client.query('UPDATE clan_quest_slots SET active = FALSE WHERE run_id = $1', [run.id]);
      const title = def ? def.title : run.quest_key;
      const names = slots.map(s => s.citizen_name).join(', ');
      for (const s of slots) {
        let rewards = null;
        if (outcome === 'completed' && def) {
          rewards = {};
          const sets = [];
          for (const [k, v] of Object.entries(def.rewards || {})) {
            if (!RESOURCES.includes(k) || !(v > 0)) continue;
            rewards[k] = v;
            sets.push(`${k} = ${k} + ${Number(v) | 0}`);
          }
          if (sets.length) await client.query(`UPDATE settlements SET ${sets.join(', ')} WHERE id = $1`, [s.settlement_id]);
          await client.query('UPDATE clan_quest_slots SET rewards = $3 WHERE run_id = $1 AND role_index = $2',
            [run.id, s.role_index, JSON.stringify(rewards)]);
        }
        const msg = outcome === 'completed'
          ? (def && def.kind === 'party' ? `${s.citizen_name} and the clan party (${names}) completed "${title}". 🎉`
                                         : `${s.citizen_name} ${def ? def.flavour_success : 'returned.'}`)
          : (def && def.kind === 'party' ? `The clan party (${names}) could not finish "${title}" — everyone is home safe.`
                                         : `${s.citizen_name} ${def ? def.flavour_fail : 'returned.'}`);
        await client.query(
          'INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
          [s.settlement_id, outcome === 'completed' ? 'quest_success' : 'quest_fail', msg, JSON.stringify([s.citizen_id])]);
      }
      await client.query(
        `INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,$2,$3,$4)`,
        [run.clan_id, outcome === 'completed' ? 'clan_quest_completed' : 'clan_quest_failed',
         def && def.kind === 'solo' && slots[0] ? slots[0].user_id : null,
         JSON.stringify({ run_id: run.id, quest_key: run.quest_key, title, kind: run.kind,
                          members: slots.map(s => s.username) })]);
      after.push({ run, def, slots, outcome, title });
    }
    return due.length;
  });

  const { awardPrestige } = require('./clan_subscriber');
  const { systemLine } = require('./clan_chat');
  for (const { run, def, slots, outcome, title } of after) {
    if (outcome === 'completed' && def) {
      for (const s of slots) {
        try {
          const r = await awardPrestige({
            userId: s.user_id, raw: def.prestige, milestone: def.kind === 'party',
            source: 'clan_quest', detail: { run_id: run.id, quest_key: run.quest_key },
          });
          if (r && r.effective) await query('UPDATE clan_quest_slots SET prestige = $3 WHERE run_id = $1 AND role_index = $2',
            [run.id, s.role_index, r.effective]);
        } catch (e) { console.error('[clan_quests] prestige failed', e); }
      }
    }
    for (const s of slots) {
      eventBus.publish(s.settlement_id, {
        type: 'clan_quest_resolved', run_id: run.id, outcome, title, kind: run.kind,
        rewards: outcome === 'completed' && def ? def.rewards : null,
      });
    }
    publishClan(run.clan_id, { run_id: run.id, what: outcome });
    if (run.kind === 'party' || outcome === 'completed') {
      systemLine(run.clan_id, outcome === 'completed'
        ? `${def ? def.icon : '📜'} ${run.kind === 'party' ? 'The party' : slots[0] ? slots[0].username : 'A member'} completed "${title}"!`
        : `${def ? def.icon : '📜'} The party returned from "${title}" without success.`);
    }
  }
  return n;
}

// Lapses forming parties past their deadline. Returns the number expired.
async function expireForming() {
  const rows = await withTransaction(async (client) => {
    const r = (await client.query(
      `UPDATE clan_quest_runs SET status = 'expired', resolved_at = NOW()
        WHERE status = 'forming' AND expires_at <= NOW() RETURNING id, clan_id, quest_key`)).rows;
    if (r.length) await client.query('UPDATE clan_quest_slots SET active = FALSE WHERE run_id = ANY($1::int[])', [r.map(x => x.id)]);
    return r;
  });
  for (const r of rows) publishClan(r.clan_id, { run_id: r.id, what: 'expired' });
  return rows.length;
}

async function tick() {
  let resolved = 0, expired = 0, battles = 0;
  try { battles = await resolveCombat(); } catch (e) { console.error('[clan_quests] combat failed', e.message); }
  try { resolved = await resolveDue(); } catch (e) { console.error('[clan_quests] resolve failed', e.message); }
  try { expired = await expireForming(); } catch (e) { console.error('[clan_quests] expire failed', e.message); }
  return { resolved, expired, battles };
}

module.exports = {
  SEED_POOL, FORMING_HOURS, SOLO_UNLOCK_LEVEL, PARTY_UNLOCK_LEVEL, BOARD_SOLO, BOARD_PARTY,
  loadDefs, invalidateDefs, byKey, seedDefinitions, boardFor, onBoard, gateFor, setOut, enemyNames,
  resolveCombat, utcDay, roleCount, skillFor, chanceFor,
  busyCitizenIds, availableCitizen, publishClan, resolveDue, expireForming, tick,
};
