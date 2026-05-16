const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const combatResolver = require('../lib/combat_resolver');
const eventBus = require('../lib/event_bus');

// ── Combat-trigger helpers ──────────────────────────────────────────────
// A quest with combat_chance > 0 may fire a battle mid-flight. At accept
// time we roll once: did combat happen, and if so, when? The trigger time
// sits between 10% and 90% of the quest's duration so it never fires on
// turn 1 or right at the deadline. The seed lets auto-resolve produce a
// deterministic outcome that survives client/server boundaries.

function _rollCombatScheduling(questDef, durationSecs, autoResolve) {
  const chance = Math.max(0, Math.min(100, parseInt(questDef.combat_chance) || 0));
  if (chance === 0) {
    return { combatStatus: 'none', triggerAt: null, seed: null, encounter: [] };
  }
  if (Math.random() * 100 >= chance) {
    return { combatStatus: 'none', triggerAt: null, seed: null, encounter: [] };
  }

  // Combat happens. Pick a trigger offset within the duration window.
  const offsetFrac = 0.10 + Math.random() * 0.80;
  const triggerAt = new Date(Date.now() + durationSecs * 1000 * offsetFrac);

  // Encounter: prefer authored list. If empty, the resolver will roll
  // a single random enemy at trigger time.
  let encounter = [];
  if (Array.isArray(questDef.combat_encounter) && questDef.combat_encounter.length) {
    encounter = questDef.combat_encounter.slice();
  } else if (typeof questDef.combat_encounter === 'string' && questDef.combat_encounter.trim()) {
    try { encounter = JSON.parse(questDef.combat_encounter); } catch(e) {}
  }

  // Seed is a 31-bit positive int — fits in a signed BIGINT comfortably.
  const seed = Math.floor(Math.random() * 0x7fffffff) + 1;
  return {
    combatStatus: 'rolled',
    triggerAt,
    seed,
    encounter,
    autoResolve: !!autoResolve,
  };
}

// Pick a random enemy to fill an empty encounter at trigger time, so quests
// authored without a specific encounter still produce *something*.
async function _pickFallbackEnemy() {
  try {
    const r = await query("SELECT id FROM enemy_definitions WHERE archived = FALSE ORDER BY random() LIMIT 1");
    if (r.rows.length) return [r.rows[0].id];
  } catch (e) {}
  return ['marsh_rat']; // engine bundled fallback
}

const router = express.Router();

// ══════════════════════════════════════════════
//  QUEST DEFINITIONS
//  skill_key: the citizen skill used for success roll
//  base_success: base chance (0–1) before skill modifier
//  duration_s: seconds the quest takes
//  reward_gold: gold awarded on success (partial on near-miss)
// ══════════════════════════════════════════════

const QUEST_POOL = [
  // ── Gathering ──────────────────────────────
  {
    id: 'q_gather_herbs',
    title: 'Gather Healing Herbs',
    description: 'The forest holds rare medicinal plants. Someone needs to know where to look.',
    icon: '🌿',
    category: 'gathering',
    skill_key: 'farming',
    base_success: 0.55,
    duration_s: 120,
    reward_gold: 8,
    flavour_success: 'returns with a bundle of wild herbs and a satisfied grin.',
    flavour_fail: 'comes back empty-handed. The forest gave nothing today.',
  },
  {
    id: 'q_forage_mushrooms',
    title: 'Forage the Dark Wood',
    description: 'Deep in the tangled wood, mushrooms grow. Worth good coin at market — if you know which ones are safe.',
    icon: '🍄',
    category: 'gathering',
    skill_key: 'farming',
    base_success: 0.5,
    duration_s: 90,
    reward_gold: 6,
    flavour_success: 'returns with a fine basket of mushrooms. The market will pay well.',
    flavour_fail: 'comes back shaken. Something in the dark wood unsettled them.',
  },
  {
    id: 'q_fish_silver_river',
    title: 'Fish the Silver River',
    description: 'The river runs silver at dawn. A skilled hand can bring back a haul worth selling.',
    icon: '🎣',
    category: 'gathering',
    skill_key: 'fishing',
    base_success: 0.6,
    duration_s: 100,
    reward_gold: 7,
    flavour_success: 'returns soaked but grinning, a haul of fine fish in tow.',
    flavour_fail: 'returns dry and empty-handed. The fish weren\'t biting.',
  },
  // ── Scouting ───────────────────────────────
  {
    id: 'q_scout_ruins',
    title: 'Investigate Old Ruins',
    description: 'Strange tracks lead to the old ruins north of the settlement. Could be treasure — could be trouble.',
    icon: '🏚',
    category: 'scouting',
    skill_key: 'scouting',
    base_success: 0.5,
    duration_s: 150,
    reward_gold: 12,
    flavour_success: 'returns with a pouch of old coins found beneath the rubble.',
    flavour_fail: 'returns shaken. The ruins were not abandoned after all.',
  },
  {
    id: 'q_map_trade_path',
    title: 'Map a Trade Path',
    description: 'Merchants pay for good maps. Chart a reliable route through the eastern wood.',
    icon: '🗺',
    category: 'scouting',
    skill_key: 'scouting',
    base_success: 0.55,
    duration_s: 130,
    reward_gold: 10,
    flavour_success: 'delivers a clean map. The merchant guild will pay well for this.',
    flavour_fail: 'got turned around in the fog. No usable map this time.',
  },
  // ── Combat ─────────────────────────────────
  {
    id: 'q_drive_off_bandits',
    title: 'Drive Off River Bandits',
    description: 'Traders report bandits at the ford. Drive them off and the trading post will reward you.',
    icon: '⚔️',
    category: 'combat',
    skill_key: 'combat',
    base_success: 0.45,
    duration_s: 180,
    reward_gold: 15,
    flavour_success: 'returns victorious. The bandits scattered into the marsh.',
    flavour_fail: 'comes back bruised. The bandits held their ground — this time.',
  },
  {
    id: 'q_hunt_wolf_pack',
    title: 'Hunt the Wolf Pack',
    description: 'A wolf pack has been raiding nearby farmsteads. Track them down before more are lost.',
    icon: '🐺',
    category: 'combat',
    skill_key: 'combat',
    base_success: 0.5,
    duration_s: 160,
    reward_gold: 12,
    flavour_success: 'returns with wolf pelts. The farmsteads are safe again.',
    flavour_fail: 'returns scratched and wary. The wolves were cleverer than expected.',
  },
  {
    id: 'q_guard_merchant_convoy',
    title: 'Guard a Merchant Convoy',
    description: 'A travelling merchant needs a capable guard for a short journey. Pay on safe delivery.',
    icon: '🛡',
    category: 'combat',
    skill_key: 'combat',
    base_success: 0.6,
    duration_s: 140,
    reward_gold: 10,
    flavour_success: 'kept the convoy safe all the way. The merchant paid in full.',
    flavour_fail: 'the convoy was ambushed. No payment this time.',
  },
  // ── Crafting ───────────────────────────────
  {
    id: 'q_craft_tools_order',
    title: 'Fulfil a Craftwork Order',
    description: 'A mason across the river needs fine tools. Complete the commission for a tidy sum.',
    icon: '🔨',
    category: 'crafting',
    skill_key: 'crafting',
    base_success: 0.55,
    duration_s: 110,
    reward_gold: 9,
    flavour_success: 'delivers fine work. The mason pays the full price without haggling.',
    flavour_fail: 'the tools didn\'t meet the standard. Commission rejected.',
  },
  {
    id: 'q_repair_mill',
    title: 'Repair the Water Mill',
    description: 'The miller\'s wheel is broken. Fix it by nightfall and earn the miller\'s gratitude — and coin.',
    icon: '⚙️',
    category: 'crafting',
    skill_key: 'crafting',
    base_success: 0.6,
    duration_s: 100,
    reward_gold: 8,
    flavour_success: 'has the wheel turning again before sundown. The miller pays promptly.',
    flavour_fail: 'couldn\'t identify the fault in time. The miller found someone else.',
  },
];


// ══════════════════════════════════════════════
//  PARTY QUEST DEFINITIONS
//  requires: array of { role_label, skill_key, description }
//  Each member contributes their skill to the overall success roll
// ══════════════════════════════════════════════

const PARTY_QUEST_POOL = [
  {
    id: 'pq_fallen_watchtree',
    title: 'The Fallen Watchtree',
    description: 'A massive ancient tree has collapsed near the settlement, blocking paths and attracting strange wildlife.',
    icon: '🌳',
    category: 'expedition',
    flavour: '"The old giants of the forest do not fall quietly…"',
    duration_s: 300,
    base_success: 0.45,
    requires: [
      { role_label: 'Woodworker', skill_key: 'woodcutting', desc: 'Clear the debris' },
      { role_label: 'Scout',      skill_key: 'scouting',    desc: 'Identify safe routes' },
      { role_label: 'Fighter',    skill_key: 'combat',      desc: 'Defend from creatures' },
    ],
    rewards: { timber: 40, wealth: 15 },
    reward_label: '+40 timber, +15 gold',
    flavour_success: 'The party returns laden with timber. The path is clear, and something ancient hums in the heartwood.',
    flavour_fail: 'The creatures drove them back. The path remains blocked — for now.',
    high_bonus: { item: 'Ancient Heartwood', desc: 'A rare crafting material from the fallen giant.' },
  },
  {
    id: 'pq_whispers_water',
    title: 'Whispers Beneath the Water',
    description: 'Fishers report something strange in the river — shadows moving against the current.',
    icon: '🌊',
    category: 'expedition',
    flavour: '"The river remembers things long forgotten…"',
    duration_s: 280,
    base_success: 0.5,
    requires: [
      { role_label: 'Fisher',    skill_key: 'fishing',    desc: 'Interact with the water' },
      { role_label: 'Scholar',   skill_key: 'crafting',   desc: 'Identify the anomaly' },
      { role_label: 'Scout',     skill_key: 'scouting',   desc: 'Track the source upstream' },
    ],
    rewards: { food: 35, wealth: 20 },
    reward_label: '+35 food, +20 gold',
    flavour_success: 'They return with strange glimmering fish and a secret they dare not speak aloud.',
    flavour_fail: 'The shadows retreated. Equipment came back waterlogged and ruined.',
    high_bonus: { item: 'Luminous Scale', desc: 'Shimmers even in darkness. Purposes unknown.' },
  },
  {
    id: 'pq_ruins_thicket',
    title: 'Ruins in the Thicket',
    description: 'Overgrown ruins have been discovered — possibly from an old civilisation buried beneath the forest floor.',
    icon: '🏚',
    category: 'expedition',
    flavour: '"Stone remembers what the forest has tried to hide."',
    duration_s: 360,
    base_success: 0.42,
    requires: [
      { role_label: 'Scout',   skill_key: 'scouting', desc: 'Locate the entrance' },
      { role_label: 'Crafter', skill_key: 'crafting', desc: 'Dismantle structures safely' },
      { role_label: 'Fighter', skill_key: 'combat',   desc: 'Deal with lurking threats' },
    ],
    rewards: { wealth: 35, stone: 20 },
    reward_label: '+35 gold, +20 stone',
    flavour_success: 'They return bearing old coins and stranger relics. The ruins gave up their secrets.',
    flavour_fail: 'A trap triggered in the dark. They escaped, but not unscathed.',
    high_bonus: { item: 'Ancient Blueprint', desc: 'Plans for a building long forgotten.' },
  },
  {
    id: 'pq_spreading_blight',
    title: 'The Spreading Blight',
    description: 'A creeping fungal rot is spreading through nearby vegetation, threatening the food supply.',
    icon: '🍄',
    category: 'expedition',
    flavour: '"Not all things that grow are meant to flourish…"',
    duration_s: 320,
    base_success: 0.48,
    requires: [
      { role_label: 'Forager',  skill_key: 'farming',   desc: 'Identify affected plants' },
      { role_label: 'Scholar',  skill_key: 'crafting',  desc: 'Determine the cure' },
      { role_label: 'Worker',   skill_key: 'combat',    desc: 'Clear infected areas' },
    ],
    rewards: { food: 25, wealth: 12 },
    reward_label: '+25 food, +12 gold',
    flavour_success: 'The blight is contained. The party returns with rare herbs and weary hands.',
    flavour_fail: 'The rot spread further. Gathering will be harder for a time.',
    high_bonus: { item: 'Blightbane Herb', desc: 'A rare herb that drives away rot and sickness.' },
  },
  {
    id: 'pq_hunters_request',
    title: "A Hunter's Request",
    description: 'A wandering hunter seeks help tracking a powerful beast that has been terrorising the woodland roads.',
    icon: '🏹',
    category: 'expedition',
    flavour: '"Some creatures are meant to be feared… others, respected."',
    duration_s: 340,
    base_success: 0.44,
    requires: [
      { role_label: 'Scout',   skill_key: 'scouting', desc: 'Track the beast' },
      { role_label: 'Fighter', skill_key: 'combat',   desc: 'Engage it' },
      { role_label: 'Crafter', skill_key: 'crafting', desc: 'Prepare bait and traps' },
    ],
    rewards: { food: 20, wealth: 25 },
    reward_label: '+20 food, +25 gold',
    flavour_success: 'The beast is felled. The hunter pays in full and buys a round at the tavern.',
    flavour_fail: 'The beast was clever. It escaped, and so did they — barely.',
    high_bonus: { item: "Hunter's Cloak", desc: 'Woven from the beast hide. Grants an air of quiet menace.' },
  },
];

// Load all active (non-archived) quests from DB
// Falls back to hardcoded pools if DB has none.
// IMPORTANT: This powers the *tavern noticeboard* — NPC-village quests
// (quest_source='settlement') are deliberately filtered out and surfaced via
// /api/diplomacy/:npcId/quests instead.
async function getDailyQuests(userId) {
  try {
    const r = await query(`
      SELECT * FROM quest_definitions
      WHERE archived=FALSE
        AND COALESCE(quest_source,'tavern') = 'tavern'
      ORDER BY sort_order ASC, created_at ASC
    `);
    if (r.rows.length > 0) {
      // Return ALL non-archived tavern quests — rotation/filtering added later
      const soloAll  = r.rows.filter(q => q.quest_type === 'solo');
      const partyAll = r.rows.filter(q => q.quest_type === 'party');
      return { solo: soloAll, party: partyAll };
    }
  } catch(e) {
    console.error('getDailyQuests DB error, falling back to hardcoded:', e.message);
  }

  // Fallback: hardcoded pools (before first seed)
  return {
    solo:  QUEST_POOL.map(q => ({ ...q, quest_type: 'solo' })),
    party: PARTY_QUEST_POOL.map(q => ({ ...q, quest_type: 'party' })),
  };
}

// ── GET /api/quests — notice board + active quests ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Safety net: if the quest worker has failed for some reason (silent
    // crash, network blip, deploy mid-process), the HTTP-triggered path
    // still catches up. The frontend coalesces concurrent refreshActiveQuests
    // calls into a single fetch, so the multi-request race that previously
    // caused UI flicker (three SSE handlers each firing their own GET, each
    // running its own resolveCompletedQuests, each racing the others' UPDATEs
    // through the outer SELECT) is no longer possible — at most one inflight
    // /api/quests fetch at a time.
    try { await resolveCompletedQuests(settlement.id); }
    catch (e) { console.error('[GET /quests] resolveCompletedQuests failed', e); }

    // Active quests for this settlement
    const activeRes = await query(
      `SELECT q.*, c.name as citizen_name, c.skills as citizen_skills
       FROM settlement_quests q
       LEFT JOIN citizens c ON q.citizen_id = c.id
       WHERE q.settlement_id=$1 AND q.status IN ('active','completed','failed')
       ORDER BY q.started_at DESC
       LIMIT 10`,
      [settlement.id]
    );

    const dailyQuests = await getDailyQuests(req.user.userId);

    // For party quests, load party member names
    const activeWithDefs = await Promise.all(activeRes.rows.map(async row => {
      let questDef = QUEST_POOL.find(q => q.id === row.quest_id)
                  || PARTY_QUEST_POOL.find(q => q.id === row.quest_id)
                  || null;
      if (!questDef) {
        const dbQ = await query('SELECT * FROM quest_definitions WHERE id=$1', [row.quest_id]);
        if (dbQ.rows.length) questDef = dbQ.rows[0];
      }
      let partyNames = [];
      if (row.party_ids && row.party_ids.length > 0) {
        const pRes = await query('SELECT id, name FROM citizens WHERE id = ANY($1)', [row.party_ids]);
        partyNames = pRes.rows;
      }
      return { ...row, quest_def: questDef, party_members: partyNames };
    }));

    res.json({
      ok: true,
      available: dailyQuests.solo,
      available_party: dailyQuests.party,
      active: activeWithDefs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load quests.' });
  }
});

// ── POST /api/quests/accept — assign citizen and start quest ──
router.post('/accept', requireAuth, async (req, res) => {
  try {
    const { quest_id, citizen_id } = req.body;
    if (!quest_id || !citizen_id)
      return res.status(400).json({ error: 'quest_id and citizen_id required.' });

    // Look up the quest definition: hardcoded pool first, then DB.
    // DB lookup is required for NPC-village quests, which only exist in quest_definitions.
    let quest = QUEST_POOL.find(q => q.id === quest_id);
    let questFromDb = null;
    if (!quest) {
      const dbQ = await query('SELECT * FROM quest_definitions WHERE id=$1 AND archived=FALSE', [quest_id]);
      if (dbQ.rows.length) {
        questFromDb = dbQ.rows[0];
        quest = questFromDb;
      }
    }
    if (!quest) return res.status(400).json({ error: 'Unknown quest.' });
    if (quest.quest_type === 'party') return res.status(400).json({ error: 'Use /accept-party for party quests.' });

    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Validate citizen belongs to this settlement
    const citizenRes = await query(
      'SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2',
      [citizen_id, settlement.id]
    );
    const citizen = citizenRes.rows[0];
    if (!citizen) return res.status(400).json({ error: 'Citizen not found.' });

    // Check citizen isn't already on a quest
    const busyRes = await query(
      "SELECT id FROM settlement_quests WHERE citizen_id=$1 AND status='active'",
      [citizen_id]
    );
    if (busyRes.rows.length)
      return res.status(400).json({ error: `${citizen.name} is already on a quest.` });

    // Also check party_ids JSONB overlap so a citizen on a party run can't double-up.
    const partyBusy = await query(
      "SELECT id FROM settlement_quests WHERE settlement_id=$1 AND status='active' AND quest_type='party' AND party_ids @> $2::jsonb",
      [settlement.id, JSON.stringify([parseInt(citizen_id)])]
    );
    if (partyBusy.rows.length)
      return res.status(400).json({ error: `${citizen.name} is already in a party.` });

    // Check citizen isn't on a scouting expedition
    const scoutRes = await query(
      "SELECT id FROM expeditions WHERE citizen_id=$1 AND status='travelling'",
      [citizen_id]
    );
    if (scoutRes.rows.length)
      return res.status(400).json({ error: `${citizen.name} is out scouting.` });

    // Check citizen isn't on a diplomatic mission.
    const onDiplo = await query(
      "SELECT id FROM diplomacy_relations WHERE citizen_id=$1 AND (status='contact_sent' OR pending_action IS NOT NULL)",
      [citizen_id]
    );
    if (onDiplo.rows.length)
      return res.status(400).json({ error: `${citizen.name} is on a diplomatic mission.` });

    // Check this quest isn't already active for this settlement
    const dupeRes = await query(
      "SELECT id FROM settlement_quests WHERE settlement_id=$1 AND quest_id=$2 AND status='active'",
      [settlement.id, quest_id]
    );
    if (dupeRes.rows.length)
      return res.status(400).json({ error: 'This quest is already underway.' });

    // For NPC-village quests, also re-check trust at accept time so a relation
    // that drops below the threshold can't accept any more.
    if (questFromDb?.quest_source === 'settlement' && questFromDb.given_by_npc_id) {
      const relCheck = await query(
        'SELECT trust FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2',
        [settlement.id, questFromDb.given_by_npc_id]
      );
      const trust = relCheck.rows[0]?.trust || 0;
      if (trust < (questFromDb.min_trust || 0)) {
        return res.status(400).json({ error: 'Your relations with this settlement no longer meet the requirement.' });
      }
    }

    const completesAt = new Date(Date.now() + quest.duration_s * 1000);
    const auto = req.body.auto_resolve_combat === true;
    const combat = _rollCombatScheduling(quest, quest.duration_s, auto);

    const result = await query(
      `INSERT INTO settlement_quests
         (settlement_id, user_id, quest_id, citizen_id, completes_at, status, quest_type,
          combat_status, combat_trigger_at, combat_seed, combat_encounter, auto_resolve_combat)
       VALUES ($1,$2,$3,$4,$5,'active','solo',$6,$7,$8,$9,$10) RETURNING *`,
      [settlement.id, req.user.userId, quest_id, citizen_id, completesAt,
       combat.combatStatus, combat.triggerAt, combat.seed,
       JSON.stringify(combat.encounter), auto && combat.combatStatus !== 'none']
    );

    res.json({
      ok: true,
      quest: result.rows[0],
      citizen_name: citizen.name,
      completes_at: completesAt,
      duration_s: quest.duration_s,
      combat_scheduled: combat.combatStatus === 'rolled',
      combat_trigger_at: combat.triggerAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to accept quest.' });
  }
});

// ── POST /api/quests/accept-party — assign party and start party quest ──
router.post('/accept-party', requireAuth, async (req, res) => {
  try {
    const { quest_id, citizen_ids } = req.body;
    if (!quest_id || !Array.isArray(citizen_ids) || citizen_ids.length === 0)
      return res.status(400).json({ error: 'quest_id and citizen_ids array required.' });

    let quest = PARTY_QUEST_POOL.find(q => q.id === quest_id);
    if (!quest) {
      const dbQ = await query('SELECT * FROM quest_definitions WHERE id=$1 AND archived=FALSE', [quest_id]);
      if (dbQ.rows.length) quest = dbQ.rows[0]; else return res.status(400).json({ error: 'Unknown party quest.' });
    }

    if (citizen_ids.length !== quest.requires.length)
      return res.status(400).json({ error: `This quest requires exactly ${quest.requires.length} citizens.` });

    const settlementRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Validate all citizens belong to this settlement and are available
    const citizenRes = await query(
      'SELECT * FROM citizens WHERE id = ANY($1) AND settlement_id=$2',
      [citizen_ids, settlement.id]
    );
    if (citizenRes.rows.length !== citizen_ids.length)
      return res.status(400).json({ error: 'One or more citizens not found.' });

    // Check none are busy — in solo quests (citizen_id) OR party quests (party_ids JSONB)
    const busyRes = await query(
      "SELECT citizen_id FROM settlement_quests WHERE citizen_id = ANY($1) AND status='active'",
      [citizen_ids]
    );
    if (busyRes.rows.length) {
      const busyId = busyRes.rows[0].citizen_id;
      const busy = citizenRes.rows.find(c => c.id === busyId);
      return res.status(400).json({ error: `${busy?.name || 'A citizen'} is already on a quest.` });
    }
    // Also check party_ids JSONB overlap
    const partyBusyRes = await query(
      "SELECT party_ids FROM settlement_quests WHERE settlement_id=$1 AND status='active' AND quest_type='party'",
      [settlement.id]
    );
    for (const row of partyBusyRes.rows) {
      const overlap = (row.party_ids || []).find(id => citizen_ids.includes(id));
      if (overlap) {
        const busy = citizenRes.rows.find(c => c.id === overlap);
        return res.status(400).json({ error: `${busy?.name || 'A citizen'} is already on a party expedition.` });
      }
    }

    // Check none are scouting
    const scoutRes = await query(
      "SELECT citizen_id FROM expeditions WHERE citizen_id = ANY($1) AND status='travelling'",
      [citizen_ids]
    );
    if (scoutRes.rows.length)
      return res.status(400).json({ error: 'A citizen in this party is out scouting.' });

    // Check none are on a diplomatic mission
    const onDiploRes = await query(
      "SELECT citizen_id FROM diplomacy_relations WHERE citizen_id = ANY($1) AND (status='contact_sent' OR pending_action IS NOT NULL)",
      [citizen_ids]
    );
    if (onDiploRes.rows.length) {
      const dId = onDiploRes.rows[0].citizen_id;
      const dCit = citizenRes.rows.find(c => c.id === dId);
      return res.status(400).json({ error: `${dCit?.name || 'A citizen'} is on a diplomatic mission.` });
    }

    // Check quest not already active
    const dupeRes = await query(
      "SELECT id FROM settlement_quests WHERE settlement_id=$1 AND quest_id=$2 AND status='active'",
      [settlement.id, quest_id]
    );
    if (dupeRes.rows.length)
      return res.status(400).json({ error: 'This quest is already underway.' });

    // Re-check trust at accept time for NPC-village party quests.
    if (quest.quest_source === 'settlement' && quest.given_by_npc_id) {
      const relCheck = await query(
        'SELECT trust FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2',
        [settlement.id, quest.given_by_npc_id]
      );
      const trust = relCheck.rows[0]?.trust || 0;
      if (trust < (quest.min_trust || 0)) {
        return res.status(400).json({ error: 'Your relations with this settlement no longer meet the requirement.' });
      }
    }

    const completesAt = new Date(Date.now() + quest.duration_s * 1000);
    const auto = req.body.auto_resolve_combat === true;
    const combat = _rollCombatScheduling(quest, quest.duration_s, auto);

    const result = await query(
      `INSERT INTO settlement_quests
         (settlement_id, user_id, quest_id, citizen_id, party_ids, quest_type, completes_at, status,
          combat_status, combat_trigger_at, combat_seed, combat_encounter, auto_resolve_combat)
       VALUES ($1,$2,$3,$4,$5,'party',$6,'active',$7,$8,$9,$10,$11) RETURNING *`,
      [settlement.id, req.user.userId, quest_id, citizen_ids[0], JSON.stringify(citizen_ids), completesAt,
       combat.combatStatus, combat.triggerAt, combat.seed,
       JSON.stringify(combat.encounter), auto && combat.combatStatus !== 'none']
    );

    res.json({
      ok: true,
      quest: result.rows[0],
      completes_at: completesAt,
      combat_scheduled: combat.combatStatus === 'rolled',
      combat_trigger_at: combat.triggerAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to accept party quest.' });
  }
});

// ── POST /api/quests/collect/:id — collect resolved quest reward ──
router.post('/collect/:id', requireAuth, async (req, res) => {
  try {
    const questRunRes = await query(
      `SELECT q.*, c.skills as citizen_skills, c.name as citizen_name
       FROM settlement_quests q
       LEFT JOIN citizens c ON q.citizen_id = c.id
       WHERE q.id=$1 AND q.user_id=$2`,
      [req.params.id, req.user.userId]
    );
    const run = questRunRes.rows[0];
    if (!run) {
      console.warn('[collect] 404 — no row for id=%s user=%s', req.params.id, req.user.userId);
      return res.status(404).json({ error: 'Quest not found.' });
    }
    if (run.status === 'active') {
      console.warn('[collect] 400 still-active — id=%s status=%s combat_status=%s completes_at=%s now=%s',
        run.id, run.status, run.combat_status, run.completes_at, new Date().toISOString());
      return res.status(400).json({ error: 'Quest still in progress.' });
    }
    if (run.status === 'collected') {
      console.warn('[collect] 400 already-collected — id=%s', run.id);
      return res.status(400).json({ error: 'Already collected.' });
    }

    // Resolve quest definition: hardcoded pools first, then DB.
    let quest = QUEST_POOL.find(q => q.id === run.quest_id)
             || PARTY_QUEST_POOL.find(q => q.id === run.quest_id);
    if (!quest) {
      const dbQ = await query('SELECT * FROM quest_definitions WHERE id=$1', [run.quest_id]);
      if (dbQ.rows.length) quest = dbQ.rows[0];
    }

    let goldAwarded = 0;
    let bonusReward = null;
    if (run.status === 'completed' && quest) {
      const isPartyRun = run.quest_type === 'party' || quest.quest_type === 'party';

      if (isPartyRun) {
        // Party rewards live in `rewards` JSONB. Apply each resource delta.
        const rewards = quest.rewards || {};
        const sets = Object.entries(rewards).map(([k,v]) => `${k} = ${k} + ${v}`).join(', ');
        if (sets) await query(`UPDATE settlements SET ${sets} WHERE id=$1`, [run.settlement_id]);
        goldAwarded = rewards.wealth || 0;

        // Award high_bonus item if roll was high
        if (quest.high_bonus && (run.success_roll || 0) > (run.success_chance || 0.8)) {
          const hb = quest.high_bonus;
          await query(
            `INSERT INTO inventory_items (settlement_id, item_key, name, description, icon, category, rarity, quantity, source)
             VALUES ($1,$2,$3,$4,$5,'quest_item','rare',1,$6)
             ON CONFLICT DO NOTHING`,
            [run.settlement_id, hb.item?.toLowerCase().replace(/\s+/g,'_') || 'quest_item',
             hb.item || 'Quest Item', hb.desc || '', '✨', run.quest_id]
          );
          bonusReward = hb;
        }
      } else {
        // Solo: flat gold reward.
        goldAwarded = quest.reward_gold ?? 10;
        if (goldAwarded > 0) {
          await query('UPDATE settlements SET wealth = wealth + $1 WHERE id=$2', [goldAwarded, run.settlement_id]);
        }
      }

      // Item drops (DB-defined). Each drop has an item_key, optional roll_chance (0-1, default 1).
      if (Array.isArray(quest.drops) && quest.drops.length) {
        for (const drop of quest.drops) {
          const chance = drop.roll_chance ?? 1;
          if (Math.random() > chance) continue;
          await query(
            `INSERT INTO inventory_items (settlement_id, item_key, name, description, icon, category, rarity, quantity, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT DO NOTHING`,
            [
              run.settlement_id,
              drop.item_key || ('drop_' + (drop.name || 'item').toLowerCase().replace(/\s+/g,'_')),
              drop.name || 'Quest Drop',
              drop.description || '',
              drop.icon || '📦',
              drop.category || 'misc',
              drop.rarity || 'common',
              drop.quantity || 1,
              run.quest_id,
            ]
          );
        }
      }
    }

    await query(
      "UPDATE settlement_quests SET status='collected' WHERE id=$1",
      [run.id]
    );

    res.json({ ok: true, gold_awarded: goldAwarded, status: run.status, bonus: bonusReward });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to collect quest.' });
  }
});

// Process any quests whose combat trigger time has elapsed.
//   - auto_resolve=true → simulate and apply outcome immediately.
//   - auto_resolve=false → mark as pending and pause the quest clock.
// Should be called BEFORE resolveCompletedQuests so a battle that's about to
// trigger doesn't get bypassed by completion happening first.
async function processCombatTriggers(settlementId) {
  // Same race-protection pattern as resolveCompletedQuests. Two concurrent
  // pollers without locking would both see status='rolled' for the same
  // run and both kick off auto-resolution — that's how duplicate combat_log
  // / event rows / aftermath rolls used to slip through.
  const { pool } = require('../db');
  const client = await pool.connect();
  // Buffer events here and publish after COMMIT. Publishing during the
  // transaction creates a race: subscribers re-fetch /api/quests in
  // response to the event, and that fetch can land BEFORE the commit
  // visible to it, returning stale rows. With the worker driving
  // resolution out-of-band (rather than the HTTP handler returning post-
  // commit state in its response), the race becomes routinely observable.
  const pendingEvents = [];
  try {
    await client.query('BEGIN');

    const due = await client.query(
      `SELECT * FROM settlement_quests
       WHERE settlement_id=$1 AND status='active'
         AND combat_status='rolled'
         AND combat_trigger_at IS NOT NULL
         AND combat_trigger_at <= NOW()
       FOR UPDATE SKIP LOCKED`,
      [settlementId]
    );

    for (const run of due.rows) {
      let encounter = run.combat_encounter || [];
      if (typeof encounter === 'string') {
        try { encounter = JSON.parse(encounter); } catch(e) { encounter = []; }
      }
      if (!encounter.length) {
        encounter = await _pickFallbackEnemy();
      }

      if (run.auto_resolve_combat) {
        const partyIds = (run.quest_type === 'party' && Array.isArray(run.party_ids))
          ? run.party_ids
          : [run.citizen_id];

        let battleResult;
        try {
          battleResult = await combatResolver.autoResolveBattle({
            citizenIds: partyIds,
            enemyKeys: encounter,
            seed: parseInt(run.combat_seed) || 1,
          });
        } catch (e) {
          console.error('auto-resolve crashed for quest run', run.id, e);
          battleResult = { outcome: 'defeat', log: ['Auto-resolve failed: ' + e.message], reward: { wealth: 0 }, rounds: 0 };
        }

        if (battleResult.outcome === 'victory') {
          // Quest continues; combat reward will be added at quest collection.
          // We persist the full battle snapshot so the "View Battle" report
          // later can show end-of-fight unit HPs, who fell, etc.
          const stateJson = JSON.stringify(
            combatResolver.serializeBattle(battleResult.battle)
          );
          await client.query(
            `UPDATE settlement_quests
             SET combat_status='resolved', combat_outcome='victory',
                 combat_resolved_at=NOW(), combat_log=$1, combat_state=$2
             WHERE id=$3`,
            [JSON.stringify(battleResult.log || []), stateJson, run.id]
          );
          // Pyrrhic victory? Roll injuries for any citizens who fell mid-fight.
          try {
            await combatResolver.applyBattleAftermath({
              battle: battleResult.battle,
              outcome: 'victory',
              settlementId,
              questRunId: run.id,
              encounter,
            });
          } catch (e) {
            console.error('auto-resolve aftermath (victory) failed for run', run.id, e);
          }
          // Buffer: combat finished. The quest keeps ticking, so we don't
          // publish quest_resolved here — that'll come from resolveCompletedQuests
          // when the quest's clock runs out. Flushed after COMMIT.
          pendingEvents.push({
            type: 'combat_resolved',
            quest_run_id: run.id,
            outcome: 'victory',
          });
        } else {
          const stateJson = JSON.stringify(
            combatResolver.serializeBattle(battleResult.battle)
          );
          await client.query(
            `UPDATE settlement_quests
             SET combat_status='resolved', combat_outcome='defeat',
                 combat_resolved_at=NOW(), combat_log=$1, combat_state=$2,
                 status='failed', completes_at=NOW()
             WHERE id=$3`,
            [JSON.stringify(battleResult.log || []), stateJson, run.id]
          );
          try {
            await combatResolver.applyBattleAftermath({
              battle: battleResult.battle,
              outcome: 'defeat',
              settlementId,
              questRunId: run.id,
              encounter,
            });
          } catch (e) {
            console.error('auto-resolve aftermath (defeat) failed for run', run.id, e);
          }
          // Buffer: defeat ends the quest right now, so both events fire.
          // Frontend coalesces these into one refresh by re-fetching.
          // Flushed after COMMIT.
          pendingEvents.push({
            type: 'combat_resolved',
            quest_run_id: run.id,
            outcome: 'defeat',
          });
          pendingEvents.push({
            type: 'quest_resolved',
            quest_run_id: run.id,
            outcome: 'failed',
          });
        }
      } else {
        // Manual battle: pause the quest clock and flag for player attention.
        await client.query(
          `UPDATE settlement_quests
           SET combat_status='pending', combat_clock_paused_at=NOW(),
               combat_encounter=$1
           WHERE id=$2`,
          [JSON.stringify(encounter), run.id]
        );
        // Buffer: a new battle awaits. Frontend refreshes battles badge +
        // freezes the quest's countdown. Flushed after COMMIT.
        pendingEvents.push({
          type: 'combat_pending',
          quest_run_id: run.id,
        });
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Publish AFTER commit. By the time a subscriber's handler reads the DB,
  // the new row state is visible. Each publish is wrapped so one bad
  // subscriber can't stop the rest from firing — though the bus's publish
  // is already synchronous and catches subscriber errors itself, this is
  // belt-and-braces.
  for (const ev of pendingEvents) {
    try { eventBus.publish(settlementId, ev); }
    catch (e) { console.error('[processCombatTriggers] publish failed', e); }
  }
}

// ── Internal: resolve quests whose timer has elapsed ──
async function resolveCompletedQuests(settlementId) {
  // Combat triggers run first so a quest can transition from 'rolled' to
  // 'pending' before completion is checked. A quest with a pending or
  // in-progress battle must NOT complete: the player needs to engage.
  await processCombatTriggers(settlementId);

  // We wrap the whole select-then-process loop in a transaction with
  // FOR UPDATE SKIP LOCKED. Without the transaction, FOR UPDATE releases
  // its row locks as soon as the SELECT statement finishes, leaving the
  // critical section unprotected. Inside a transaction the lock is held
  // until COMMIT, which is exactly what we want: concurrent pollers see
  // the row as locked and skip it.
  //
  // Background: the quest poller fires every 15s (or every 5s during
  // combat-pending), and the active-quests endpoint also resolves on demand.
  // Without this lock, two concurrent requests would both decide a random
  // outcome for the same row and both INSERT chronicle events — which is
  // exactly the duplicate-bell bug we saw.
  const { pool } = require('../db');
  const client = await pool.connect();
  // See processCombatTriggers for the same pattern: buffer events, publish
  // after COMMIT so subscribers' re-fetches see post-commit state.
  const pendingEvents = [];
  try {
    await client.query('BEGIN');

    const dueRes = await client.query(
      `SELECT q.*, c.skills as citizen_skills
       FROM settlement_quests q
       LEFT JOIN citizens c ON q.citizen_id = c.id
       WHERE q.settlement_id=$1 AND q.status='active' AND q.completes_at <= NOW()
         AND COALESCE(q.combat_status,'none') NOT IN ('pending','in_progress')
       FOR UPDATE OF q SKIP LOCKED`,
      [settlementId]
    );

    for (const run of dueRes.rows) {
      const isParty = run.quest_type === 'party';
      // Look up def: hardcoded pool first, then DB. NPC quests live only in DB.
      let quest = isParty
        ? PARTY_QUEST_POOL.find(q => q.id === run.quest_id)
        : QUEST_POOL.find(q => q.id === run.quest_id);
      if (!quest) {
        const dbQ = await client.query('SELECT * FROM quest_definitions WHERE id=$1', [run.quest_id]);
        if (dbQ.rows.length) quest = dbQ.rows[0];
      }

      if (!quest) {
        await client.query("UPDATE settlement_quests SET status='failed' WHERE id=$1", [run.id]);
        continue;
      }

      let successChance, roll, outcome;

      if (isParty) {
        const partyIds = run.party_ids || [];
        let totalSkill = 0, count = 0;
        if (partyIds.length > 0) {
          const pRes = await client.query('SELECT skills FROM citizens WHERE id = ANY($1)', [partyIds]);
          quest.requires.forEach((req, i) => {
            const member = pRes.rows[i];
            if (member) {
              totalSkill += (member.skills?.[req.skill_key] ?? 1);
              count++;
            }
          });
        }
        const avgSkill = count > 0 ? totalSkill / count : 1;
        successChance = Math.min(0.95, quest.base_success + (avgSkill - 1) * 0.04);
        roll = Math.random();
        outcome = roll < successChance ? 'completed' : 'failed';

        const relDelta = outcome === 'completed' ? 8 : -3;
        const partyIdArr = run.party_ids || [];
        for (let i = 0; i < partyIdArr.length; i++) {
          for (let j = i + 1; j < partyIdArr.length; j++) {
            const aId = Math.min(partyIdArr[i], partyIdArr[j]);
            const bId = Math.max(partyIdArr[i], partyIdArr[j]);
            await client.query(
              `INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state)
               VALUES ($1,$2,$3,GREATEST(0,LEAST(100,50+$4)),'acquaintances')
               ON CONFLICT (citizen_a_id, citizen_b_id)
               DO UPDATE SET score = GREATEST(0, LEAST(100, citizen_relationships.score + $4)),
                             last_updated = NOW()`,
              [settlementId, aId, bId, relDelta]
            );
          }
        }

        const partyNamesRes = await client.query('SELECT name FROM citizens WHERE id = ANY($1)', [partyIdArr]);
        const names = partyNamesRes.rows.map(r => r.name).join(', ');
        const evtMsg = outcome === 'completed'
          ? `The party — ${names} — returned triumphant from "${quest.title}". 🎉`
          : `The party — ${names} — failed their quest: "${quest.title}". 😔`;
        await client.query(
          'INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
          [settlementId, outcome === 'completed' ? 'quest_success' : 'quest_fail', evtMsg, JSON.stringify(partyIdArr)]
        );

      } else {
        const skills = run.citizen_skills || {};
        const skillVal = skills[quest.skill_key] ?? 1;
        successChance = Math.min(0.95, quest.base_success + (skillVal - 1) * 0.04);
        roll = Math.random();
        outcome = roll < successChance ? 'completed' : 'failed';
      }

      await client.query(
        "UPDATE settlement_quests SET status=$1, resolved_at=NOW(), success_roll=$2, success_chance=$3 WHERE id=$4",
        [outcome, roll, successChance, run.id]
      );
      // Buffer: quest concluded. Frontend reloads quests + toasts. Flushed
      // after COMMIT so subscribers' re-fetches see the new status.
      pendingEvents.push({
        type: 'quest_resolved',
        quest_run_id: run.id,
        outcome,
      });
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Publish AFTER commit. Same reasoning as processCombatTriggers.
  for (const ev of pendingEvents) {
    try { eventBus.publish(settlementId, ev); }
    catch (e) { console.error('[resolveCompletedQuests] publish failed', e); }
  }
}

module.exports = router;
module.exports.QUEST_POOL = QUEST_POOL;
module.exports.PARTY_QUEST_POOL = PARTY_QUEST_POOL;
module.exports.resolveCompletedQuests = resolveCompletedQuests;
module.exports.processCombatTriggers = processCombatTriggers;
