const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');

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

// Pick fresh quests for the notice board (deterministic per day per user)
function getDailyQuests(userId) {
  const dayKey = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  const seed = (userId * 31337 + dayKey * 7919) % 999983;

  // 2 solo quests
  const soloShuffled = [...QUEST_POOL];
  for (let i = soloShuffled.length - 1; i > 0; i--) {
    const j = (seed * (i + 1) * 1103515245) % (i + 1);
    [soloShuffled[i], soloShuffled[j]] = [soloShuffled[j], soloShuffled[i]];
  }

  // 2 party quests
  const partySeed = (seed + 42) % 999983;
  const partyShuffled = [...PARTY_QUEST_POOL];
  for (let i = partyShuffled.length - 1; i > 0; i--) {
    const j = (partySeed * (i + 1) * 1103515245) % (i + 1);
    [partyShuffled[i], partyShuffled[j]] = [partyShuffled[j], partyShuffled[i]];
  }

  return {
    solo:  soloShuffled.slice(0, 2).map(q => ({ ...q, quest_type: 'solo' })),
    party: partyShuffled.slice(0, 2).map(q => ({ ...q, quest_type: 'party' })),
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

    // Auto-resolve any completed quests
    await resolveCompletedQuests(settlement.id);

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

    const dailyQuests = getDailyQuests(req.user.userId);

    // For party quests, load party member names
    const activeWithDefs = await Promise.all(activeRes.rows.map(async row => {
      const questDef = QUEST_POOL.find(q => q.id === row.quest_id)
                    || PARTY_QUEST_POOL.find(q => q.id === row.quest_id)
                    || null;
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

    const quest = QUEST_POOL.find(q => q.id === quest_id);
    if (!quest) return res.status(400).json({ error: 'Unknown quest.' });

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

    // Check citizen isn't on a scouting expedition
    const scoutRes = await query(
      "SELECT id FROM expeditions WHERE citizen_id=$1 AND status='travelling'",
      [citizen_id]
    );
    if (scoutRes.rows.length)
      return res.status(400).json({ error: `${citizen.name} is out scouting.` });

    // Check this quest isn't already active for this settlement
    const dupeRes = await query(
      "SELECT id FROM settlement_quests WHERE settlement_id=$1 AND quest_id=$2 AND status='active'",
      [settlement.id, quest_id]
    );
    if (dupeRes.rows.length)
      return res.status(400).json({ error: 'This quest is already underway.' });

    const completesAt = new Date(Date.now() + quest.duration_s * 1000);

    const result = await query(
      `INSERT INTO settlement_quests
         (settlement_id, user_id, quest_id, citizen_id, completes_at, status)
       VALUES ($1,$2,$3,$4,$5,'active') RETURNING *`,
      [settlement.id, req.user.userId, quest_id, citizen_id, completesAt]
    );

    res.json({
      ok: true,
      quest: result.rows[0],
      citizen_name: citizen.name,
      completes_at: completesAt,
      duration_s: quest.duration_s,
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

    const quest = PARTY_QUEST_POOL.find(q => q.id === quest_id);
    if (!quest) return res.status(400).json({ error: 'Unknown party quest.' });

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

    // Check none are busy
    const busyRes = await query(
      "SELECT citizen_id FROM settlement_quests WHERE citizen_id = ANY($1) AND status='active'",
      [citizen_ids]
    );
    if (busyRes.rows.length) {
      const busyId = busyRes.rows[0].citizen_id;
      const busy = citizenRes.rows.find(c => c.id === busyId);
      return res.status(400).json({ error: `${busy?.name || 'A citizen'} is already on a quest.` });
    }

    // Check none are scouting
    const scoutRes = await query(
      "SELECT citizen_id FROM expeditions WHERE citizen_id = ANY($1) AND status='travelling'",
      [citizen_ids]
    );
    if (scoutRes.rows.length)
      return res.status(400).json({ error: 'A citizen in this party is out scouting.' });

    // Check quest not already active
    const dupeRes = await query(
      "SELECT id FROM settlement_quests WHERE settlement_id=$1 AND quest_id=$2 AND status='active'",
      [settlement.id, quest_id]
    );
    if (dupeRes.rows.length)
      return res.status(400).json({ error: 'This quest is already underway.' });

    const completesAt = new Date(Date.now() + quest.duration_s * 1000);

    const result = await query(
      `INSERT INTO settlement_quests
         (settlement_id, user_id, quest_id, citizen_id, party_ids, quest_type, completes_at, status)
       VALUES ($1,$2,$3,$4,$5,'party',$6,'active') RETURNING *`,
      [settlement.id, req.user.userId, quest_id, citizen_ids[0], JSON.stringify(citizen_ids), completesAt]
    );

    res.json({ ok: true, quest: result.rows[0], completes_at: completesAt });
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
    if (!run) return res.status(404).json({ error: 'Quest not found.' });
    if (run.status === 'active')
      return res.status(400).json({ error: 'Quest still in progress.' });
    if (run.status === 'collected')
      return res.status(400).json({ error: 'Already collected.' });

    const quest = QUEST_POOL.find(q => q.id === run.quest_id);

    let goldAwarded = 0;
    if (run.status === 'completed') {
      if (quest?.quest_type === 'party' || PARTY_QUEST_POOL.find(q => q.id === run.quest_id)) {
        // Party quest rewards
        const pq = PARTY_QUEST_POOL.find(q => q.id === run.quest_id);
        const rewards = pq?.rewards || {};
        const sets = Object.entries(rewards).map(([k,v]) => `${k} = ${k} + ${v}`).join(', ');
        if (sets) await query(`UPDATE settlements SET ${sets} WHERE id=$1`, [run.settlement_id]);
        goldAwarded = rewards.wealth || 0;
      } else {
        goldAwarded = quest?.reward_gold ?? 10;
        await query('UPDATE settlements SET wealth = wealth + $1 WHERE id=$2', [goldAwarded, run.settlement_id]);
      }
    }

    await query(
      "UPDATE settlement_quests SET status='collected' WHERE id=$1",
      [run.id]
    );

    res.json({ ok: true, gold_awarded: goldAwarded, status: run.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to collect quest.' });
  }
});

// ── Internal: resolve quests whose timer has elapsed ──
async function resolveCompletedQuests(settlementId) {
  const dueRes = await query(
    `SELECT q.*, c.skills as citizen_skills
     FROM settlement_quests q
     LEFT JOIN citizens c ON q.citizen_id = c.id
     WHERE q.settlement_id=$1 AND q.status='active' AND q.completes_at <= NOW()`,
    [settlementId]
  );

  for (const run of dueRes.rows) {
    const isParty = run.quest_type === 'party';
    const quest = isParty
      ? PARTY_QUEST_POOL.find(q => q.id === run.quest_id)
      : QUEST_POOL.find(q => q.id === run.quest_id);

    if (!quest) {
      await query("UPDATE settlement_quests SET status='failed' WHERE id=$1", [run.id]);
      continue;
    }

    let successChance, roll, outcome;

    if (isParty) {
      // Party quest: average skill across all party members' relevant skills
      const partyIds = run.party_ids || [];
      let totalSkill = 0, count = 0;
      if (partyIds.length > 0) {
        const pRes = await query('SELECT skills FROM citizens WHERE id = ANY($1)', [partyIds]);
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

      // Award relationship points between all party members
      const relDelta = outcome === 'completed' ? 8 : -3;
      const partyIdArr = run.party_ids || [];
      for (let i = 0; i < partyIdArr.length; i++) {
        for (let j = i + 1; j < partyIdArr.length; j++) {
          const aId = Math.min(partyIdArr[i], partyIdArr[j]);
          const bId = Math.max(partyIdArr[i], partyIdArr[j]);
          await query(
            `INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state)
             VALUES ($1,$2,$3,GREATEST(0,LEAST(100,50+$4)),'acquaintances')
             ON CONFLICT (citizen_a_id, citizen_b_id)
             DO UPDATE SET score = GREATEST(0, LEAST(100, citizen_relationships.score + $4)),
                           last_updated = NOW()`,
            [settlementId, aId, bId, relDelta]
          );
        }
      }

      // Chronicle event
      const partyNamesRes = await query('SELECT name FROM citizens WHERE id = ANY($1)', [partyIdArr]);
      const names = partyNamesRes.rows.map(r => r.name).join(', ');
      const evtMsg = outcome === 'completed'
        ? `The party — ${names} — returned triumphant from "${quest.title}". 🎉`
        : `The party — ${names} — failed their quest: "${quest.title}". 😔`;
      await query(
        'INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
        [settlementId, outcome === 'completed' ? 'quest_success' : 'quest_fail', evtMsg, JSON.stringify(partyIdArr)]
      );

    } else {
      // Solo quest
      const skills = run.citizen_skills || {};
      const skillVal = skills[quest.skill_key] ?? 1;
      successChance = Math.min(0.95, quest.base_success + (skillVal - 1) * 0.04);
      roll = Math.random();
      outcome = roll < successChance ? 'completed' : 'failed';
    }

    await query(
      "UPDATE settlement_quests SET status=$1, resolved_at=NOW(), success_roll=$2, success_chance=$3 WHERE id=$4",
      [outcome, roll, successChance, run.id]
    );
  }
}

module.exports = router;
module.exports.QUEST_POOL = QUEST_POOL;
module.exports.PARTY_QUEST_POOL = PARTY_QUEST_POOL;
