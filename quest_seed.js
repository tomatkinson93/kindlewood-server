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
    const exists = await query('SELECT id FROM quest_definitions WHERE id=$1', [q.id]);
    if (exists.rows.length) continue; // skip if already seeded
    await query(
      `INSERT INTO quest_definitions
         (id, title, description, flavour, icon, category, quest_type, skill_key,
          base_success, duration_s, reward_gold, rewards, reward_label, requires,
          flavour_success, flavour_fail, high_bonus)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        q.id, q.title, q.description||'', q.flavour||q.flavor||'', q.icon||'📜',
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
