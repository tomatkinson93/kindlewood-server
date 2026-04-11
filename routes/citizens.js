const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { VISIBLE_TRAITS, HIDDEN_TRAITS } = require('../citizens');

const router = express.Router();

// Get all citizens for the player's settlement
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const citizensRes = await query(
      `SELECT * FROM citizens WHERE settlement_id=$1 ORDER BY born_at ASC`,
      [settlement.id]
    );

    const citizens = citizensRes.rows.map(c => ({
      id: c.id,
      name: c.name,
      gender: c.gender,
      generation: c.generation,
      role: c.role,
      stats: c.stats || {},
      skills: c.skills || {},
      life: c.life || {},
      visible_traits: c.visible_traits || [],
      // Hidden traits revealed based on conditions — for now return none
      revealed_hidden_traits: [],
      born_at: c.born_at,
    }));

    res.json({ ok: true, citizens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch citizens.' });
  }
});

// Get a single citizen
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];

    const citizenRes = await query(
      'SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2',
      [req.params.id, settlement.id]
    );
    const c = citizenRes.rows[0];
    if (!c) return res.status(404).json({ error: 'Citizen not found.' });

    res.json({
      ok: true,
      citizen: {
        id: c.id, name: c.name, gender: c.gender, generation: c.generation,
        role: c.role, stats: c.stats || {}, skills: c.skills || {},
        life: c.life || {}, repro: c.repro || {},
        visible_traits: c.visible_traits || [],
        revealed_hidden_traits: [],
        born_at: c.born_at,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch citizen.' });
  }
});

// Update citizen role
router.patch('/:id/role', requireAuth, async (req, res) => {
  try {
    const { role } = req.body;
    const VALID_ROLES = ['farmer','woodcutter','fisher','miner','crafter','scout','soldier','idle'];
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];

    await query(
      'UPDATE citizens SET role=$1 WHERE id=$2 AND settlement_id=$3',
      [role, req.params.id, settlement.id]
    );
    res.json({ ok: true, role });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

// Export trait data for frontend reference
router.get('/meta/traits', async (req, res) => {
  res.json({ ok: true, visible: VISIBLE_TRAITS, hidden: HIDDEN_TRAITS.map(t => ({ id: t.id, label: '???' })) });
});

module.exports = router;
