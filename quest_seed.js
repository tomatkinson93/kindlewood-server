const { query } = require('./db');
const { QUEST_POOL } = require('./routes/quests');
const { PARTY_QUEST_POOL } = require('./routes/quests');

async function seedQuestDefinitions() {
  let count = 0;
  const all = [
    ...QUEST_POOL.map(q => ({ ...q, quest_type: 'solo' })),
    ...PARTY_QUEST_POOL.map(q => ({ ...q, quest_type: 'party' })),
  ];
  for (const q of all) {
    const exists = await query('SELECT id, reward_gold, archived FROM quest_definitions WHERE id=$1', [q.id]);
    if (exists.rows.length) {
      // Back-fill reward_gold and restore archived built-in quests.
      const storedGold = exists.rows[0].reward_gold;
      const isArchived = exists.rows[0].archived;
      const expectedGold = parseInt(q.reward_gold) || 0;
      const needsGoldFix = (storedGold === null || storedGold === 0) && expectedGold > 0;
      if (needsGoldFix || isArchived) {
        if (needsGoldFix) {
          await query('UPDATE quest_definitions SET reward_gold=$1, archived=FALSE WHERE id=$2', [expectedGold, q.id]);
        } else {
          await query('UPDATE quest_definitions SET archived=FALSE WHERE id=$1', [q.id]);
        }
        count++;
      }
      continue;
    }
    await query(
      `INSERT INTO quest_definitions
         (id, title, description, flavour, icon, category, quest_type, skill_key,
          base_success, duration_s, reward_gold, rewards, reward_label, requires,
          flavour_success, flavour_fail, high_bonus)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        q.id, q.title, q.description||'', q.flavour||q.flavor||'', q.icon||'\u{1F4DC}',
        q.category||'general', q.quest_type||'solo', q.skill_key||null,
        parseFloat(q.base_success)||0.5, parseInt(q.duration_s)||120,
        parseInt(q.reward_gold)||0,
        JSON.stringify(q.rewards||{}),
        q.reward_label||'',
        JSON.stringify(q.requires||[]),
        q.flavour_success||'', q.flavour_fail||'',
        q.high_bonus ? JSON.stringify(q.high_bonus) : null,
      ]
    );
    count++;
  }
  return count;
}

module.exports = { seedQuestDefinitions };
