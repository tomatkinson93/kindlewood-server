const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const HOUSED_HAPPINESS_BONUS  =  10; // applied when citizen is housed
const UNHOUSED_HAPPINESS_CAP  =  50; // max happiness for unhoused citizens
const HOUSING_CAPACITY = { starter_house: 2 };

// ── GET /api/housing — all houses + residents for this settlement ──────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const settRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const housesRes = await query(
      `SELECT h.*, 
              json_agg(
                json_build_object('id', c.id, 'name', c.name, 'gender', c.gender, 'role', c.role)
                ORDER BY c.born_at
              ) FILTER (WHERE c.id IS NOT NULL) AS residents
       FROM houses h
       LEFT JOIN citizens c ON c.house_id = h.id
       WHERE h.settlement_id = $1
       GROUP BY h.id
       ORDER BY h.created_at ASC`,
      [settlement.id]
    );

    // Unhoused citizens
    const unhousedRes = await query(
      `SELECT id, name, gender, role FROM citizens
       WHERE settlement_id=$1 AND (house_id IS NULL)
       ORDER BY born_at ASC`,
      [settlement.id]
    );

    res.json({
      ok: true,
      houses: housesRes.rows.map(h => ({
        id: h.id,
        name: h.name,
        building_type: h.building_type,
        capacity: h.capacity,
        residents: h.residents || [],
      })),
      unhoused: unhousedRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load housing.' });
  }
});

// ── POST /api/housing/assign — assign citizen to house ────────────────────────
router.post('/assign', requireAuth, async (req, res) => {
  try {
    const { citizen_id, house_id } = req.body;
    if (!citizen_id || !house_id)
      return res.status(400).json({ error: 'citizen_id and house_id required.' });

    const settRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Validate house belongs to settlement
    const houseRes = await query(
      'SELECT * FROM houses WHERE id=$1 AND settlement_id=$2',
      [house_id, settlement.id]
    );
    const house = houseRes.rows[0];
    if (!house) return res.status(404).json({ error: 'House not found.' });

    // Check capacity
    const occupantRes = await query(
      'SELECT COUNT(*) FROM citizens WHERE house_id=$1', [house_id]
    );
    const occupants = parseInt(occupantRes.rows[0].count);
    if (occupants >= house.capacity)
      return res.status(400).json({ error: `${house.name} is full (${house.capacity}/${house.capacity}).` });

    // Validate citizen belongs to settlement
    const citizenRes = await query(
      'SELECT id, name FROM citizens WHERE id=$1 AND settlement_id=$2',
      [citizen_id, settlement.id]
    );
    if (!citizenRes.rows[0]) return res.status(404).json({ error: 'Citizen not found.' });

    // Assign
    await query('UPDATE citizens SET house_id=$1 WHERE id=$2', [house_id, citizen_id]);

    // Apply happiness bonus
    await query(
      `UPDATE citizens SET life = jsonb_set(life, '{happiness}',
        to_jsonb(LEAST(100, COALESCE((life->>'happiness')::int, 70) + $1))
       ) WHERE id=$2`,
      [HOUSED_HAPPINESS_BONUS, citizen_id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assign citizen.' });
  }
});

// ── POST /api/housing/unassign — remove citizen from house ───────────────────
router.post('/unassign', requireAuth, async (req, res) => {
  try {
    const { citizen_id } = req.body;
    if (!citizen_id) return res.status(400).json({ error: 'citizen_id required.' });

    const settRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Verify citizen
    const citizenRes = await query(
      'SELECT id, house_id FROM citizens WHERE id=$1 AND settlement_id=$2',
      [citizen_id, settlement.id]
    );
    if (!citizenRes.rows[0]) return res.status(404).json({ error: 'Citizen not found.' });

    await query('UPDATE citizens SET house_id=NULL WHERE id=$1', [citizen_id]);

    // Cap happiness at UNHOUSED_HAPPINESS_CAP if they were housed
    await query(
      `UPDATE citizens SET life = jsonb_set(life, '{happiness}',
        to_jsonb(LEAST($1, COALESCE((life->>'happiness')::int, 70)))
       ) WHERE id=$2`,
      [UNHOUSED_HAPPINESS_CAP, citizen_id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to unassign citizen.' });
  }
});

// ── PATCH /api/housing/:id/name — rename a house ─────────────────────────────
router.patch('/:id/name', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required.' });

    const settRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const result = await query(
      'UPDATE houses SET name=$1 WHERE id=$2 AND settlement_id=$3 RETURNING id',
      [name.trim().slice(0, 40), req.params.id, settlement.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'House not found.' });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to rename house.' });
  }
});

// ── Internal: create a house row when a starter_house building is built ───────
// Called from buildings route after successful build
async function createHouseForSettlement(settlementId, buildingType) {
  const capacity = HOUSING_CAPACITY[buildingType] || 2;
  // Count existing houses of this type to auto-name
  const countRes = await query(
    "SELECT COUNT(*) FROM houses WHERE settlement_id=$1 AND building_type=$2",
    [settlementId, buildingType]
  );
  const num = parseInt(countRes.rows[0].count) + 1;
  const name = `Willow Hut #${num}`;
  await query(
    'INSERT INTO houses (settlement_id, name, building_type, capacity) VALUES ($1,$2,$3,$4)',
    [settlementId, name, buildingType, capacity]
  );
}

// ── Internal: remove the most recently built house of a type (on demolish) ───
async function removeHouseForSettlement(settlementId, buildingType) {
  // Free residents first
  const houseRes = await query(
    `SELECT id FROM houses WHERE settlement_id=$1 AND building_type=$2 ORDER BY created_at DESC LIMIT 1`,
    [settlementId, buildingType]
  );
  if (!houseRes.rows.length) return;
  const houseId = houseRes.rows[0].id;
  await query('UPDATE citizens SET house_id=NULL WHERE house_id=$1', [houseId]);
  await query('DELETE FROM houses WHERE id=$1', [houseId]);
}

module.exports = router;
module.exports.createHouseForSettlement = createHouseForSettlement;
module.exports.removeHouseForSettlement = removeHouseForSettlement;
