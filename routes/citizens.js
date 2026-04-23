const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { VISIBLE_TRAITS, HIDDEN_TRAITS } = require('../citizens');
const { calculateHappinessFactors } = require('../happiness');
const { getCurrentSeason } = require('../seasons');

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

    // Get active expeditions for this settlement
    const expRes = await query(
      "SELECT citizen_id, target_q, target_r, completes_at FROM expeditions WHERE settlement_id=$1 AND status='travelling'",
      [settlement.id]
    );
    const expByCitizen = {};
    expRes.rows.forEach(e => { expByCitizen[e.citizen_id] = e; });

    // Build lookup maps for happiness context
    const season = getCurrentSeason();
    const settRes = await query('SELECT food FROM settlements WHERE id=$1', [settlement.id]);
    const lowFood = (settRes.rows[0]?.food ?? 999) < 50;

    // House residents map: house_id -> [citizen_ids]
    const houseResidents = {};
    citizensRes.rows.forEach(c => {
      if (c.house_id) {
        if (!houseResidents[c.house_id]) houseResidents[c.house_id] = [];
        houseResidents[c.house_id].push(c.id);
      }
    });

    // Partner house lookup
    const partnerHouseMap = {};
    citizensRes.rows.forEach(c => { if (c.house_id) partnerHouseMap[c.id] = c.house_id; });

    // Children per house
    const houseChildCount = {};
    citizensRes.rows.filter(c => c.life_stage === 'child' && c.house_id).forEach(c => {
      houseChildCount[c.house_id] = (houseChildCount[c.house_id] || 0) + 1;
    });

    const citizens = citizensRes.rows.map(c => {
      const context = {
        season,
        lowFood,
        onExpedition: !!expByCitizen[c.id],
        partnerHouseId: c.partner_id ? partnerHouseMap[c.partner_id] : null,
        houseChildCount: houseChildCount[c.house_id] || 0,
      };
      const { factors, base, delta, computed } = calculateHappinessFactors(c, context);
      return {
        id: c.id,
        name: c.name,
        gender: c.gender,
        generation: c.generation,
        role: c.role,
        stats: c.stats || {},
        skills: c.skills || {},
        life: c.life || {},
        visible_traits: c.visible_traits || [],
        revealed_hidden_traits: [],
        born_at: c.born_at,
        house_id: c.house_id || null,
        partner_id: c.partner_id || null,
        life_stage: c.life_stage || 'adult',
        parent_ids: c.parent_ids || [],
        expedition: expByCitizen[c.id] || null,
        happiness_factors: factors,
        happiness_computed: computed,
      };
    });

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
    const VALID_ROLES = ['farmer','woodcutter','fisher','miner','crafter','scout','soldier','idle','tavernkeep'];
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];

    // Block if on active expedition
    const expedition = await query(
      "SELECT id, target_q, target_r FROM expeditions WHERE citizen_id=$1 AND status='travelling'",
      [req.params.id]
    );
    if (expedition.rows.length) {
      const exp = expedition.rows[0];
      return res.status(400).json({
        error: `This citizen is currently scouting (${exp.target_q}, ${exp.target_r}) and cannot be reassigned.`
      });
    }

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


// ── Family tree for a citizen ──────────────────
router.get('/:id/family', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Get the citizen
    const cRes = await query('SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2', [req.params.id, settlement.id]);
    const c = cRes.rows[0];
    if (!c) return res.status(404).json({ error: 'Citizen not found.' });

    // Get all citizens in settlement (for resolving names/relations)
    const allRes = await query('SELECT id, name, gender, life_stage, generation, parent_ids, partner_id, house_id FROM citizens WHERE settlement_id=$1', [settlement.id]);
    const all = allRes.rows;
    const byId = Object.fromEntries(all.map(x => [x.id, x]));

    // Parents
    const parentIds = c.parent_ids || [];
    const parents = parentIds.map(pid => byId[pid]).filter(Boolean);

    // Grandparents
    const grandparents = [];
    for (const p of parents) {
      const gpIds = p.parent_ids || [];
      gpIds.forEach(gpid => { const gp = byId[gpid]; if (gp) grandparents.push({ ...gp, via: p.id }); });
    }

    // Siblings (share at least one parent)
    const siblings = all.filter(x => {
      if (x.id === c.id) return false;
      const xParents = x.parent_ids || [];
      return xParents.some(pid => parentIds.includes(pid));
    });

    // Children (this citizen is in their parent_ids)
    const children = all.filter(x => (x.parent_ids || []).includes(c.id));

    // Grandchildren
    const grandchildren = [];
    children.forEach(child => {
      all.filter(x => (x.parent_ids || []).includes(child.id)).forEach(gc => {
        grandchildren.push({ ...gc, via: child.id });
      });
    });

    // Partner
    const partner = c.partner_id ? byId[c.partner_id] : null;

    const slim = (x) => x ? { id: x.id, name: x.name, gender: x.gender, life_stage: x.life_stage, generation: x.generation } : null;

    res.json({
      ok: true,
      subject: slim(c),
      partner: slim(partner),
      parents: parents.map(slim),
      grandparents: grandparents.map(x => ({ ...slim(x), via: x.via })),
      siblings: siblings.map(slim),
      children: children.map(slim),
      grandchildren: grandchildren.map(x => ({ ...slim(x), via: x.via })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch family tree.' });
  }
});

module.exports = router;
