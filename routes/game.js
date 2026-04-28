const { getCurrentSeason, applySeasonModifiers } = require('../seasons');
const { runSimulation } = require('../simulation');
const { generateCitizen } = require('../citizens');
const express = require('express');
const { calculateRates } = require('../buildings');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

const SPECIES_RATES = {
  Mice:    { food: 20, timber: 10, stone: 5,  metal: 3, wealth: 8  },
  Badgers: { food: 12, timber: 8,  stone: 10, metal: 6, wealth: 4  },
  Otters:  { food: 15, timber: 6,  stone: 4,  metal: 3, wealth: 14 },
  Moles:   { food: 10, timber: 12, stone: 12, metal: 8, wealth: 5  },
  Foxes:   { food: 14, timber: 10, stone: 4,  metal: 5, wealth: 10 },
  Hares:   { food: 18, timber: 8,  stone: 4,  metal: 3, wealth: 6  },
};

async function applyTick(settlement, species) {
  const now = Date.now();
  const lastTick = new Date(settlement.last_tick).getTime();
  const hoursElapsed = (now - lastTick) / (1000 * 60 * 60);
  if (hoursElapsed < 0.005) return settlement;

  const [bRes, cRes] = await Promise.all([
    query('SELECT type, level FROM buildings WHERE settlement_id=$1', [settlement.id]),
    query('SELECT role FROM citizens WHERE settlement_id=$1', [settlement.id]),
  ]);
  const season = getCurrentSeason();
  const baseRates = calculateRates(bRes.rows, cRes.rows, species);
  const rates = applySeasonModifiers(baseRates, season);
  const updated = {
    food:   Math.floor(settlement.food   + rates.food   * hoursElapsed),
    timber: Math.floor(settlement.timber + rates.timber * hoursElapsed),
    stone:  Math.floor(settlement.stone  + rates.stone  * hoursElapsed),
    metal:  Math.floor(settlement.metal  + rates.metal  * hoursElapsed),
    wealth: Math.floor(settlement.wealth + rates.wealth * hoursElapsed),
  };

  await query(`
    UPDATE settlements
    SET food=$1, timber=$2, stone=$3, metal=$4, wealth=$5, last_tick=NOW()
    WHERE id=$6
  `, [updated.food, updated.timber, updated.stone, updated.metal, updated.wealth, settlement.id]);

  // Run relationship/bonding/breeding simulation (gated by last_sim_tick)
  try {
    const simTickRes = await query(
      'SELECT last_sim_tick FROM settlements WHERE id=$1', [settlement.id]
    );
    const lastSim = simTickRes.rows[0]?.last_sim_tick;
    const simHoursElapsed = lastSim
      ? (Date.now() - new Date(lastSim).getTime()) / (1000 * 60 * 60)
      : 1.0;
    if (simHoursElapsed >= 1.0) {
      await runSimulation({ id: settlement.id }, simHoursElapsed);
    }
  } catch(simErr) {
    console.error('Simulation tick error:', simErr.message);
  }

  return { ...settlement, ...updated };
}

router.get('/settlement', requireAuth, async (req, res) => {
  console.log(`SETTLEMENT fetched: user=${req.user.userId} time=${Date.now()}`);
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let settlementResult = await query('SELECT * FROM settlements WHERE user_id=$1', [user.id]);
    let settlement = settlementResult.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });

    settlement = await applyTick(settlement, user.species);

    const buildingsResult = await query(
      'SELECT type, level FROM buildings WHERE settlement_id=$1',
      [settlement.id]
    );
    const citizensResult = await query(
      'SELECT role FROM citizens WHERE settlement_id=$1',
      [settlement.id]
    );
    const season = getCurrentSeason();
    const baseRates = calculateRates(buildingsResult.rows, citizensResult.rows, user.species);
    const rates = applySeasonModifiers(baseRates, season);

    console.log(`SETTLEMENT returning tile_q=${settlement.tile_q} for user=${req.user.userId}`);
    res.json({
      ok: true,
      settlement: {
        id: settlement.id,
        name: settlement.name,
        tier: settlement.tier,
        tile_q: settlement.tile_q,
        tile_r: settlement.tile_r,
        isNewSettlement: (settlement.tile_q == null),
        needsResettlement: (settlement.world_version || 0) < 2,
        resources: {
          food: settlement.food, timber: settlement.timber,
          stone: settlement.stone, metal: settlement.metal, wealth: settlement.wealth,
        },
        rates,
        baseRates,
        season,
        population: settlement.population,
        population_cap: settlement.population_cap,
        happiness: (() => {
          // Base happiness + 10% per tavernkeep
          const tavernkeepCount = citizensResult.rows.filter(c => c.role === 'tavernkeep').length;
          const base = typeof settlement.happiness === 'number' ? settlement.happiness : 70;
          return Math.min(100, base + tavernkeepCount * 10);
        })(),
        last_tick: settlement.last_tick,
      },
      buildings: buildingsResult.rows,
      species: user.species,
      username: user.username,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settlement.' });
  }
});

router.patch('/settlement/rename', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2)
    return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  try {
    const settlementResult = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementResult.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement found.' });
    await query('UPDATE settlements SET name=$1 WHERE id=$2', [name.trim(), settlement.id]);
    res.json({ ok: true, name: name.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Rename failed.' });
  }
});

// Cheat: add one citizen
router.post('/cheat/citizen', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const settlementRes = await query('SELECT * FROM settlements WHERE user_id=$1', [user.id]);
    if (!settlementRes.rows.length) return res.status(404).json({ error: 'No settlement.' });
    const settlement = settlementRes.rows[0];

    const citizen = generateCitizen(1);
    await query(
      `INSERT INTO citizens (settlement_id, name, gender, generation, role, stats, skills, life, repro, visible_traits, hidden_traits, born_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [settlement.id, citizen.name, citizen.gender, citizen.generation, citizen.role,
       JSON.stringify(citizen.stats), JSON.stringify(citizen.skills),
       JSON.stringify(citizen.life), JSON.stringify(citizen.repro),
       JSON.stringify(citizen.visible_traits), JSON.stringify(citizen.hidden_traits)]
    );
    await query('UPDATE settlements SET population = population + 1 WHERE id=$1', [settlement.id]);
    res.json({ ok: true, name: citizen.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add citizen.' });
  }
});


// Award gold from card games
router.post('/award-gold', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const settlementRes = await query('SELECT * FROM settlements WHERE user_id=$1', [user.id]);
    if (!settlementRes.rows.length) return res.status(404).json({ error: 'No settlement.' });
    const settlement = settlementRes.rows[0];
    const { amount } = req.body;
    if (!amount || amount < 0 || amount > 10) return res.status(400).json({ error: 'Invalid amount.' });
    await query(
      'UPDATE settlements SET wealth = wealth + $1 WHERE id = $2',
      [amount, settlement.id]
    );
    res.json({ ok: true, awarded: amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to award gold.' });
  }
});

// ── Cheat: simulate event ─────────────────────────────────────────────────────
router.post('/cheat/simulate-event', requireAuth, async (req, res) => {
  try {
    const { event_type } = req.body;
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Get two random citizens for the event
    const citizensRes = await query(
      "SELECT id, name, gender, house_id, partner_id, life_stage FROM citizens WHERE settlement_id=$1 AND life_stage='adult' ORDER BY RANDOM() LIMIT 2",
      [settlement.id]
    );
    const citizens = citizensRes.rows;
    if (citizens.length < 2) return res.status(400).json({ error: 'Need at least 2 adult citizens.' });

    const [a, b] = citizens;
    let message = '';
    const ids = [a.id, b.id];

    if (event_type === 'close_bond') {
      message = `${a.name} and ${b.name} have grown close.`;
      // Actually bump their relationship score
      const aId = Math.min(a.id, b.id), bId = Math.max(a.id, b.id);
      await query(`INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state)
        VALUES ($1,$2,$3,60,'close')
        ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score=GREATEST(citizen_relationships.score,60), state='close'`,
        [settlement.id, aId, bId]);

    } else if (event_type === 'bond_formed') {
      message = `${a.name} and ${b.name} share a strong bond. 🤝`;
      const aId = Math.min(a.id, b.id), bId = Math.max(a.id, b.id);
      await query(`INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state)
        VALUES ($1,$2,$3,80,'bonded')
        ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score=GREATEST(citizen_relationships.score,80), state='bonded'`,
        [settlement.id, aId, bId]);

    } else if (event_type === 'partnership') {
      // Pick an unpartnered male + female if possible, else any two
      const unpartneredRes = await query(
        "SELECT id, name, gender FROM citizens WHERE settlement_id=$1 AND partner_id IS NULL AND life_stage='adult' ORDER BY RANDOM() LIMIT 2",
        [settlement.id]
      );
      const pair = unpartneredRes.rows.length >= 2 ? unpartneredRes.rows : citizens;
      const [p1, p2] = pair;
      ids.length = 0; ids.push(p1.id, p2.id);
      // Form the partnership
      await query('UPDATE citizens SET partner_id=$1 WHERE id=$2', [p2.id, p1.id]);
      await query('UPDATE citizens SET partner_id=$1 WHERE id=$2', [p1.id, p2.id]);
      const aId = Math.min(p1.id, p2.id), bId = Math.max(p1.id, p2.id);
      await query(`INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state)
        VALUES ($1,$2,$3,95,'partners')
        ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score=95, state='partners'`,
        [settlement.id, aId, bId]);
      message = `${p1.name} and ${p2.name} have become partners. 💕`;

    } else if (event_type === 'child_born') {
      // Simulate: just create event message, optionally add a child citizen
      const houseRes = await query('SELECT id, name FROM houses WHERE settlement_id=$1 LIMIT 1', [settlement.id]);
      const house = houseRes.rows[0];
      if (!house) return res.status(400).json({ error: 'Need at least one house.' });
      message = `A child has been born to ${a.name} and ${b.name} in ${house.name}. 🍼`;
      ids.push(); // no real child created in cheat — just the event

    } else {
      return res.status(400).json({ error: 'Unknown event_type.' });
    }

    await query(
      'INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
      [settlement.id, event_type, message, JSON.stringify(ids)]
    );

    res.json({ ok: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to simulate event.' });
  }
});

// ── Cheat: set relationship score between two citizens ────────────────────────
router.post('/cheat/relationship', requireAuth, async (req, res) => {
  try {
    const { citizen_a_id, citizen_b_id, score } = req.body;
    if (!citizen_a_id || !citizen_b_id || score === undefined)
      return res.status(400).json({ error: 'citizen_a_id, citizen_b_id, score required.' });

    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const clampedScore = Math.max(0, Math.min(100, parseInt(score)));
    const aId = Math.min(citizen_a_id, citizen_b_id);
    const bId = Math.max(citizen_a_id, citizen_b_id);

    const state = clampedScore >= 90 ? 'bonded'
                : clampedScore >= 75 ? 'bonded'
                : clampedScore >= 60 ? 'close'
                : clampedScore >= 40 ? 'friends'
                : clampedScore >= 20 ? 'acquaintances'
                : 'strangers';

    await query(
      `INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE
         SET score=$4, state=$5, last_updated=NOW()`,
      [settlement.id, aId, bId, clampedScore, state]
    );

    res.json({ ok: true, score: clampedScore, state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to set relationship.' });
  }
});


// ── Cheat: set or remove partnership between two specific citizens ────────────
router.post('/cheat/partnership', requireAuth, async (req, res) => {
  try {
    const { citizen_a_id, citizen_b_id, action } = req.body; // action: 'set' | 'remove'
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const [a, b] = await Promise.all([
      query('SELECT id,name,partner_id FROM citizens WHERE id=$1 AND settlement_id=$2', [citizen_a_id, settlement.id]),
      query('SELECT id,name,partner_id FROM citizens WHERE id=$1 AND settlement_id=$2', [citizen_b_id, settlement.id]),
    ]);
    const ca = a.rows[0], cb = b.rows[0];
    if (!ca || !cb) return res.status(404).json({ error: 'Citizen not found.' });

    if (action === 'remove') {
      // Clear both sides
      await query('UPDATE citizens SET partner_id=NULL WHERE id=$1 OR id=$2', [ca.id, cb.id]);
      // If either had a different partner, clear that too
      if (ca.partner_id && ca.partner_id !== cb.id)
        await query('UPDATE citizens SET partner_id=NULL WHERE id=$1', [ca.partner_id]);
      if (cb.partner_id && cb.partner_id !== ca.id)
        await query('UPDATE citizens SET partner_id=NULL WHERE id=$1', [cb.partner_id]);
      return res.json({ ok: true, message: `Partnership between ${ca.name} and ${cb.name} removed.` });
    }

    // Set — clear existing partners first
    if (ca.partner_id) await query('UPDATE citizens SET partner_id=NULL WHERE id=$1', [ca.partner_id]);
    if (cb.partner_id) await query('UPDATE citizens SET partner_id=NULL WHERE id=$1', [cb.partner_id]);
    await query('UPDATE citizens SET partner_id=$1 WHERE id=$2', [cb.id, ca.id]);
    await query('UPDATE citizens SET partner_id=$1 WHERE id=$2', [ca.id, cb.id]);

    // Upsert relationship at partners level
    const aId = Math.min(ca.id, cb.id), bId = Math.max(ca.id, cb.id);
    await query(
      `INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state)
       VALUES ($1,$2,$3,95,'partners')
       ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score=95, state='partners', last_updated=NOW()`,
      [settlement.id, aId, bId]
    );
    await query('INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
      [settlement.id, 'partnership', `${ca.name} and ${cb.name} have become partners. 💕`, JSON.stringify([ca.id, cb.id])]);

    res.json({ ok: true, message: `${ca.name} and ${cb.name} are now partners.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to set partnership.' });
  }
});

// ── Cheat: trigger a real birth between two specific citizens ─────────────────
router.post('/cheat/trigger-birth', requireAuth, async (req, res) => {
  try {
    const { citizen_a_id, citizen_b_id } = req.body;
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Load full citizen data needed for _createChild
    const pairRes = await query(`
      SELECT
        ca.id as id_a, ca.name as name_a, ca.gender as gender_a,
        ca.stats as stats_a, ca.skills as skills_a, ca.life as life_a,
        ca.visible_traits as traits_a, ca.hidden_traits as hidden_a,
        ca.generation as gen_a, ca.house_id as house_a,
        cb.id as id_b, cb.name as name_b, cb.gender as gender_b,
        cb.stats as stats_b, cb.skills as skills_b, cb.life as life_b,
        cb.visible_traits as traits_b, cb.hidden_traits as hidden_b,
        cb.generation as gen_b,
        COALESCE(h.capacity, 2) as house_cap
      FROM citizens ca
      JOIN citizens cb ON cb.id = $2
      LEFT JOIN houses h ON h.id = ca.house_id
      WHERE ca.id = $1 AND ca.settlement_id = $3`,
      [citizen_a_id, citizen_b_id, settlement.id]
    );
    if (!pairRes.rows[0]) return res.status(404).json({ error: 'Citizens not found.' });
    const pair = pairRes.rows[0];

    const { _createChild } = require('../simulation');
    if (!_createChild) return res.status(500).json({ error: 'Birth function not exported.' });

    await _createChild(settlement.id, pair);
    res.json({ ok: true, message: `A child was born to ${pair.name_a} and ${pair.name_b}!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to trigger birth: ' + err.message });
  }
});

// ── Cheat: edit any citizen field ────────────────────────────────────────────
router.patch('/cheat/citizen/:id', requireAuth, async (req, res) => {
  try {
    const { name, gender, role, life_stage, stats, skills, life, generation } = req.body;
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = settRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const cRes = await query('SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2', [req.params.id, settlement.id]);
    const c = cRes.rows[0];
    if (!c) return res.status(404).json({ error: 'Citizen not found.' });

    const updates = [], vals = [];
    let i = 1;
    if (name       !== undefined) { updates.push(`name=$${i++}`);       vals.push(name); }
    if (gender     !== undefined) { updates.push(`gender=$${i++}`);     vals.push(gender); }
    if (role       !== undefined) { updates.push(`role=$${i++}`);       vals.push(role); }
    if (life_stage !== undefined) { updates.push(`life_stage=$${i++}`); vals.push(life_stage); }
    if (generation !== undefined) { updates.push(`generation=$${i++}`); vals.push(generation); }
    if (stats !== undefined) {
      const merged = { ...(c.stats || {}), ...stats };
      updates.push(`stats=$${i++}`); vals.push(JSON.stringify(merged));
    }
    if (skills !== undefined) {
      const merged = { ...(c.skills || {}), ...skills };
      updates.push(`skills=$${i++}`); vals.push(JSON.stringify(merged));
    }
    if (life !== undefined) {
      const merged = { ...(c.life || {}), ...life };
      updates.push(`life=$${i++}`); vals.push(JSON.stringify(merged));
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

    vals.push(req.params.id, settlement.id);
    await query(`UPDATE citizens SET ${updates.join(',')} WHERE id=$${i++} AND settlement_id=$${i++}`, vals);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update citizen.' });
  }
});


// ── POST /api/game/seed-npcs — seed NPC settlements ──
router.post('/seed-npcs', async (req, res) => {
  try {
    const { seedNpcSettlements } = require('../npc_seed');
    const n = await seedNpcSettlements();
    res.json({ ok: true, seeded: n, message: n > 0 ? `Seeded ${n} NPC settlements.` : 'Already seeded.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ── POST /api/game/migrate — run pending DB migrations ──
router.post('/migrate', async (req, res) => {
  const { query } = require('../db');
  const results = [];
  const run = async (sql, label) => {
    try { await query(sql); results.push('OK: ' + label); }
    catch(e) { results.push('ERR ' + label + ': ' + e.message); }
  };

  await run("ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS path JSONB DEFAULT '[]'", "diplo path");
  await run("ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''", "diplo notes");

  res.json({ ok: true, results });
});


// ── GET /api/game/npc-list — list all NPC settlements ──
router.get('/npc-list', requireAuth, async (req, res) => {
  try {
    const r = await require('../db').query("SELECT id, name, disposition, faction FROM npc_settlements WHERE disposition != 'hostile' ORDER BY name");
    res.json({ ok: true, npcs: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/game/debug-diplomacy — set trust for a relation ──
router.post('/debug-diplomacy', requireAuth, async (req, res) => {
  try {
    const { npc_id, trust } = req.body;
    const db = require('../db');
    const settRes = await db.query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const { getTrustLevel } = require('./diplomacy');
    const level = getTrustLevel(trust);

    await db.query(`
      INSERT INTO diplomacy_relations (settlement_id, npc_id, status, trust, last_interaction)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (settlement_id, npc_id)
      DO UPDATE SET trust=$4, status=$3, last_interaction=NOW()
    `, [sett.id, npc_id, level.status === 'unknown' ? 'unknown' : level.status, trust]);

    res.json({ ok: true, trust, level });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/game/debug-diplomacy-reset — reset all relations ──
router.post('/debug-diplomacy-reset', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const settRes = await db.query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });
    await db.query('DELETE FROM diplomacy_relations WHERE settlement_id=$1', [sett.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

// Dev-only: reset placement for testing
router.post('/reset-placement', requireAuth, async (req, res) => {
  try {
    await query(
      'UPDATE settlements SET tile_q=NULL, tile_r=NULL, world_version=0, rerolls_used=0 WHERE user_id=$1',
      [req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed.' });
  }
});

// ── Cheat menu ──
router.post('/cheat/resources', requireAuth, async (req, res) => {
  try {
    const { food, timber, stone, metal, wealth } = req.body;
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    await query(`
      UPDATE settlements SET
        food   = GREATEST(0, food   + $1),
        timber = GREATEST(0, timber + $2),
        stone  = GREATEST(0, stone  + $3),
        metal  = GREATEST(0, metal  + $4),
        wealth = GREATEST(0, wealth + $5)
      WHERE id = $6
    `, [food||0, timber||0, stone||0, metal||0, wealth||0, settlement.id]);

    const updated = await query('SELECT food,timber,stone,metal,wealth FROM settlements WHERE id=$1', [settlement.id]);
    res.json({ ok: true, resources: updated.rows[0] });
  } catch(err) {
    res.status(500).json({ error: 'Cheat failed.' });
  }
});

// ── Settlement Tier Upgrade ──

const TIER_ORDER = ['camp', 'village', 'town', 'city'];
const TIER_LABELS = { camp: 'Camp', village: 'Village', town: 'Town', city: 'City' };

const TIER_REQUIREMENTS = {
  // To upgrade FROM camp → village
  village: {
    resources: { food: 800, timber: 600, stone: 400, metal: 100, wealth: 200 },
    population: 20,
    buildings: 3,  // must have at least 3 buildings
    label: 'Village',
    unlocks: ['quarry', 'market', 'inn'],
    desc: 'Expand your humble camp into a proper village.',
    popBonus: 50,   // new population cap
  },
  // To upgrade FROM village → town
  town: {
    resources: { food: 2500, timber: 2000, stone: 1500, metal: 400, wealth: 800 },
    population: 40,
    buildings: 6,
    label: 'Town',
    unlocks: ['forge', 'scout_post'],
    desc: 'From village to bustling town — a true settlement.',
    popBonus: 120,
  },
  // To upgrade FROM town → city
  city: {
    resources: { food: 8000, timber: 6000, stone: 5000, metal: 1500, wealth: 3000 },
    population: 80,
    buildings: 9,
    label: 'City',
    unlocks: [],
    desc: 'A great city rises — seat of power in the woodland realm.',
    popBonus: 300,
  },
};

// GET /api/game/tier-info — returns current tier + next tier requirements
router.get('/tier-info', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const s = settlementRes.rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });

    const buildingsRes = await query(
      'SELECT COUNT(*) FROM buildings WHERE settlement_id=$1', [s.id]
    );
    const buildingCount = parseInt(buildingsRes.rows[0].count);

    const currentTierIndex = TIER_ORDER.indexOf(s.tier);
    const nextTier = TIER_ORDER[currentTierIndex + 1];
    const req2 = nextTier ? TIER_REQUIREMENTS[nextTier] : null;

    let canUpgrade = false;
    let requirementsMet = {};
    if (req2) {
      const resOk = Object.entries(req2.resources).every(([r, v]) => (s[r] || 0) >= v);
      const popOk = s.population >= req2.population;
      const bldOk = buildingCount >= req2.buildings;
      canUpgrade = resOk && popOk && bldOk;
      requirementsMet = {
        resources: resOk,
        population: popOk,
        buildings: bldOk,
        current: {
          food: s.food, timber: s.timber, stone: s.stone,
          metal: s.metal, wealth: s.wealth,
          population: s.population,
          buildings: buildingCount,
        },
      };
    }

    res.json({
      ok: true,
      currentTier: s.tier,
      nextTier,
      nextTierLabel: TIER_LABELS[nextTier] || null,
      requirements: req2,
      requirementsMet,
      canUpgrade,
      isMaxTier: s.tier === 'city',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load tier info.' });
  }
});

// POST /api/game/upgrade-tier — perform the upgrade
router.post('/upgrade-tier', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const s = settlementRes.rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });

    const currentTierIndex = TIER_ORDER.indexOf(s.tier);
    if (currentTierIndex < 0 || currentTierIndex >= TIER_ORDER.length - 1) {
      return res.status(400).json({ error: 'Already at maximum tier.' });
    }

    const nextTier = TIER_ORDER[currentTierIndex + 1];
    const reqs = TIER_REQUIREMENTS[nextTier];

    // Check buildings
    const buildingsRes = await query(
      'SELECT COUNT(*) FROM buildings WHERE settlement_id=$1', [s.id]
    );
    const buildingCount = parseInt(buildingsRes.rows[0].count);

    // Validate all requirements
    const errors = [];
    if (s.food   < reqs.resources.food)   errors.push(`Need ${reqs.resources.food} food (have ${s.food})`);
    if (s.timber < reqs.resources.timber) errors.push(`Need ${reqs.resources.timber} timber (have ${s.timber})`);
    if (s.stone  < reqs.resources.stone)  errors.push(`Need ${reqs.resources.stone} stone (have ${s.stone})`);
    if (s.metal  < reqs.resources.metal)  errors.push(`Need ${reqs.resources.metal} metal (have ${s.metal})`);
    if (s.wealth < reqs.resources.wealth) errors.push(`Need ${reqs.resources.wealth} wealth (have ${s.wealth})`);
    if (s.population < reqs.population)   errors.push(`Need ${reqs.population} citizens (have ${s.population})`);
    if (buildingCount < reqs.buildings)    errors.push(`Need ${reqs.buildings} buildings (have ${buildingCount})`);

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0], all: errors });
    }

    // Deduct resources
    await query(`
      UPDATE settlements SET
        food   = food   - $1,
        timber = timber - $2,
        stone  = stone  - $3,
        metal  = metal  - $4,
        wealth = wealth - $5,
        tier   = $6,
        population_cap = $7
      WHERE id = $8
    `, [
      reqs.resources.food, reqs.resources.timber, reqs.resources.stone,
      reqs.resources.metal, reqs.resources.wealth,
      nextTier, reqs.popBonus, s.id,
    ]);

    res.json({
      ok: true,
      newTier: nextTier,
      newTierLabel: TIER_LABELS[nextTier],
      unlocks: reqs.unlocks,
      newPopCap: reqs.popBonus,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upgrade failed.' });
  }
});
