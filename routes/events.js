const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// GET /api/events — recent settlement events
router.get('/', requireAuth, async (req, res) => {
  try {
    const settRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const events = await query(
      `SELECT * FROM settlement_events
       WHERE settlement_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [settlement.id, limit]
    );

    res.json({ ok: true, events: events.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load events.' });
  }
});

// POST /api/events/dismiss/:id — mark event as seen (optional future use)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const settRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settRes.rows[0];
    await query(
      'DELETE FROM settlement_events WHERE id=$1 AND settlement_id=$2',
      [req.params.id, settlement.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed.' });
  }
});

module.exports = router;
