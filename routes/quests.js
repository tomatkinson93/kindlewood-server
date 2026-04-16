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

// Pick 3 fresh quests for the notice board (deterministic per day per user)
function getDailyQuests(userId) {
  const dayKey = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  // Simple seeded shuffle using userId + day
  const seed = (userId * 31337 + dayKey * 7919) % 999983;
  const shuffled = [...QUEST_POOL];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (seed * (i + 1) * 1103515245) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 3);
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

    // Embed quest definition into each active row so the frontend can render without a separate lookup
    const activeWithDefs = activeRes.rows.map(row => ({
      ...row,
      quest_def: QUEST_POOL.find(q => q.id === row.quest_id) || null,
    }));

    res.json({
      ok: true,
      available: dailyQuests,
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
      goldAwarded = quest?.reward_gold ?? 10;
      await query(
        'UPDATE settlements SET wealth = wealth + $1 WHERE id=$2',
        [goldAwarded, run.settlement_id]
      );
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
    const quest = QUEST_POOL.find(q => q.id === run.quest_id);
    if (!quest) {
      await query("UPDATE settlement_quests SET status='failed' WHERE id=$1", [run.id]);
      continue;
    }

    // Roll success: base_success + skill bonus (each skill point above 1 adds 4%)
    const skills = run.citizen_skills || {};
    const skillVal = skills[quest.skill_key] ?? 1;
    const successChance = Math.min(0.95, quest.base_success + (skillVal - 1) * 0.04);
    const roll = Math.random();
    const outcome = roll < successChance ? 'completed' : 'failed';

    await query(
      "UPDATE settlement_quests SET status=$1, resolved_at=NOW(), success_roll=$2, success_chance=$3 WHERE id=$4",
      [outcome, roll, successChance, run.id]
    );
  }
}

module.exports = router;
module.exports.QUEST_POOL = QUEST_POOL;
