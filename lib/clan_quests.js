// ══════════════════════════════════════════════════════════════════════════
//  CLAN QUESTS — definitions, citizen availability, resolution
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

const CLAN_QUEST_POOL = [
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
    rewards: { wealth: 20 }, prestige: 15,
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
    rewards: { wealth: 45, metal: 10 }, prestige: 40,
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
    rewards: { food: 60, wealth: 40 }, prestige: 80,
    flavour_success: 'The great boar is felled — the clan feasts for days.',
    flavour_fail: 'The boar slipped the snares and vanished into the deep wood.',
  },
];

const byKey = key => CLAN_QUEST_POOL.find(q => q.key === key) || null;
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
        ORDER BY completes_at FOR UPDATE SKIP LOCKED LIMIT 50`)).rows;
    for (const run of due) {
      const def = byKey(run.quest_key);
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
  let resolved = 0, expired = 0;
  try { resolved = await resolveDue(); } catch (e) { console.error('[clan_quests] resolve failed', e.message); }
  try { expired = await expireForming(); } catch (e) { console.error('[clan_quests] expire failed', e.message); }
  return { resolved, expired };
}

module.exports = {
  CLAN_QUEST_POOL, FORMING_HOURS, SOLO_UNLOCK_LEVEL, PARTY_UNLOCK_LEVEL,
  byKey, utcDay, roleCount, skillFor, chanceFor,
  busyCitizenIds, availableCitizen, publishClan, resolveDue, expireForming, tick,
};
