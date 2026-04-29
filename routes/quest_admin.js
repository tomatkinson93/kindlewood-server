// ══════════════════════════════════════════════
//  QUEST ADMIN ROUTES
//  All endpoints require auth (any logged-in user for now; restrict to admin later)
// ══════════════════════════════════════════════

const express    = require('express');
const { query }  = require('../db');
const requireAuth = require('../middleware/auth');
const { seedQuestDefinitions } = require('../quest_seed');

const router = express.Router();

// ── GET /api/quest-admin — list all quest definitions ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM quest_definitions ORDER BY archived ASC, quest_type ASC, sort_order ASC, created_at ASC');
    res.json({ ok: true, quests: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/quest-admin — create a quest ──
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      id, title, description, flavour, icon, category, quest_type,
      skill_key, base_success, duration_s, reward_gold, rewards,
      reward_label, requires, flavour_success, flavour_fail, high_bonus, sort_order,
      quest_source, given_by_npc_id, min_trust, drops
    } = req.body;

    if (!id || !title) return res.status(400).json({ error: 'id and title required.' });

    // Check duplicate
    const exists = await query('SELECT id FROM quest_definitions WHERE id=$1', [id]);
    if (exists.rows.length) return res.status(400).json({ error: 'Quest ID already exists.' });

    await query(
      `INSERT INTO quest_definitions
         (id, title, description, flavour, icon, category, quest_type, skill_key,
          base_success, duration_s, reward_gold, rewards, reward_label, requires,
          flavour_success, flavour_fail, high_bonus, sort_order,
          quest_source, given_by_npc_id, min_trust, drops)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        id, title, description||'', flavour||'', icon||'📜', category||'general',
        quest_type||'solo', skill_key||null,
        parseFloat(base_success)||0.5, parseInt(duration_s)||120,
        parseInt(reward_gold)||0,
        JSON.stringify(rewards||{}),
        reward_label||'',
        JSON.stringify(requires||[]),
        flavour_success||'', flavour_fail||'',
        high_bonus ? JSON.stringify(high_bonus) : null,
        parseInt(sort_order)||0,
        quest_source||'tavern',
        given_by_npc_id ? parseInt(given_by_npc_id) : null,
        parseInt(min_trust)||0,
        JSON.stringify(drops||[])
      ]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/quest-admin/:id — update a quest ──
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const fields = [
      'title','description','flavour','icon','category','quest_type','skill_key',
      'base_success','duration_s','reward_gold','rewards','reward_label','requires',
      'flavour_success','flavour_fail','high_bonus','sort_order','archived',
      'quest_source','given_by_npc_id','min_trust','drops'
    ];
    const updates = [], vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] === undefined) continue;
      let v = req.body[f];
      if (['rewards','requires','high_bonus','drops'].includes(f)) v = JSON.stringify(v);
      if (['base_success','sort_order','duration_s','reward_gold','min_trust','given_by_npc_id'].includes(f)) v = f === 'base_success' ? parseFloat(v) : parseInt(v);
      updates.push(`${f}=$${i++}`); vals.push(v);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    vals.push(req.params.id);
    await query(`UPDATE quest_definitions SET ${updates.join(',')} WHERE id=$${i}`, vals);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/quest-admin/:id — permanently delete ──
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM quest_definitions WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/quest-admin/seed — seed hardcoded quests into DB ──
router.post('/seed', requireAuth, async (req, res) => {
  try {
    const count = await seedQuestDefinitions();
    res.json({ ok: true, seeded: count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
