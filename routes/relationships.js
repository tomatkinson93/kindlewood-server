const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// GET /api/relationships — all relationships for this settlement
router.get('/', requireAuth, async (req, res) => {
  try {
    const settRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const rels = await query(
      `SELECT cr.*,
              ca.name as name_a, ca.gender as gender_a,
              cb.name as name_b, cb.gender as gender_b
       FROM citizen_relationships cr
       JOIN citizens ca ON cr.citizen_a_id = ca.id
       JOIN citizens cb ON cr.citizen_b_id = cb.id
       WHERE cr.settlement_id = $1
       ORDER BY cr.score DESC`,
      [settlement.id]
    );

    res.json({ ok: true, relationships: rels.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed.' });
  }
});

// GET /api/relationships/citizen/:id — relationships for a specific citizen
router.get('/citizen/:id', requireAuth, async (req, res) => {
  try {
    const settRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const cId = parseInt(req.params.id);

    const rels = await query(
      `SELECT cr.*,
              CASE WHEN cr.citizen_a_id = $1 THEN cb.name ELSE ca.name END as other_name,
              CASE WHEN cr.citizen_a_id = $1 THEN cr.citizen_b_id ELSE cr.citizen_a_id END as other_id,
              CASE WHEN cr.citizen_a_id = $1 THEN cb.gender ELSE ca.gender END as other_gender
       FROM citizen_relationships cr
       JOIN citizens ca ON cr.citizen_a_id = ca.id
       JOIN citizens cb ON cr.citizen_b_id = cb.id
       WHERE cr.settlement_id = $2
         AND (cr.citizen_a_id = $1 OR cr.citizen_b_id = $1)
         AND cr.score > 0
       ORDER BY cr.score DESC
       LIMIT 20`,
      [cId, settlement.id]
    );

    res.json({ ok: true, relationships: rels.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed.' });
  }
});

module.exports = router;
