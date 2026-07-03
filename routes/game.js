const { getCurrentSeason, applySeasonModifiers } = require('../seasons');
const { runSimulation } = require('../simulation');
const { applyConsumption, getFamineSummary, buildUpkeepBreakdownSource } = require('../famine');
const { generateCitizen } = require('../citizens');
const express = require('express');
const { calculateRates, calculateRatesBreakdown, applyBreakdownSeasonModifiers } = require('../buildings');
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

  const [bRes, cRes, oRes] = await Promise.all([
    query('SELECT type, level FROM buildings WHERE settlement_id=$1', [settlement.id]),
    query('SELECT role FROM citizens WHERE settlement_id=$1', [settlement.id]),
    // Outposts (010) — yields ride this same last_tick accrual; no separate
    // clock. .catch → [] so pre-migration DBs keep ticking.
    query('SELECT id, tile_q, tile_r, terrain, level FROM outposts WHERE settlement_id=$1', [settlement.id]).catch(() => ({ rows: [] })),
  ]);
  const season = getCurrentSeason();
  const baseRates = calculateRates(bRes.rows, cRes.rows, species, oRes.rows);
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

  // ── Consumption & famine tick ──
  // MUST run AFTER the production write above: applyConsumption deducts food
  // in the DB, and the production UPDATE writes an in-memory-computed food
  // value that would clobber a deduction made before it. Internally gated by
  // last_consumption_at (15-min quanta) + compare-and-swap, so calling it on
  // every tick from any endpoint is safe and cheap (one SELECT when there's
  // nothing to do). When a window actually applied, re-read food so the
  // value we return reflects the deduction.
  try {
    const famineResult = await applyConsumption(settlement.id);
    if (famineResult) {
      const freshFood = await query('SELECT food FROM settlements WHERE id=$1', [settlement.id]);
      if (freshFood.rows[0]) updated.food = freshFood.rows[0].food;
    }
  } catch (famineErr) {
    console.error('[famine] consumption tick error:', famineErr.message);
  }

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
    // Outposts (010) — same rows feed the rate calc so the topbar +N/hr
    // reflects them the moment one is founded.
    const outpostsResult = await query(
      'SELECT id, tile_q, tile_r, terrain, level FROM outposts WHERE settlement_id=$1',
      [settlement.id]
    ).catch(() => ({ rows: [] }));
    const season = getCurrentSeason();
    const baseRates = calculateRates(buildingsResult.rows, citizensResult.rows, user.species, outpostsResult.rows);
    const rates = applySeasonModifiers(baseRates, season);

    // Famine status for the warning banner (spec Q5). rates.food is the
    // post-season production side of hours-to-empty; upkeep is computed
    // inside from the citizen roster + season foodConsumption.
    let famine = null;
    try {
      famine = await getFamineSummary(settlement.id, rates.food);
    } catch (famineErr) {
      console.error('[famine] summary error:', famineErr.message);
    }

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
        famine,
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

// ── Resource breakdown ──
// Returns the per-source decomposition that drives the resource modal /
// hover tooltip. Same data inputs as GET /settlement, but with id+name on
// citizens (so the modal can show "Wren, Pip" and link to the citizen
// modal) and the breakdown structured per-resource rather than as flat
// totals. Cheap: two indexed selects + a synchronous compute. Called once
// per modal open / hover-tooltip prime.
router.get('/resource-breakdown', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const settlementResult = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [user.id]
    );
    const settlement = settlementResult.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const buildingsResult = await query(
      'SELECT id, type, level FROM buildings WHERE settlement_id=$1',
      [settlement.id]
    );
    const citizensResult = await query(
      'SELECT id, name, role FROM citizens WHERE settlement_id=$1',
      [settlement.id]
    );

    // Outposts (010) — one source row per outpost in the modal.
    const outpostsResult = await query(
      'SELECT id, tile_q, tile_r, terrain, level FROM outposts WHERE settlement_id=$1',
      [settlement.id]
    ).catch(() => ({ rows: [] }));

    const season = getCurrentSeason();
    const base = calculateRatesBreakdown(buildingsResult.rows, citizensResult.rows, user.species, outpostsResult.rows);
    const breakdown = applyBreakdownSeasonModifiers(base, season);

    // Citizen food upkeep — negative source row (🍽 in the modal, "Upkeep"
    // in the tooltip). Pushed AFTER the season multiplier on purpose: the
    // production season modifier scales output, while upkeep applies its
    // own seasonal foodConsumption internally (winter ×1.20).
    try {
      const upkeepSrc = await buildUpkeepBreakdownSource(settlement.id);
      breakdown.food.sources.push(upkeepSrc);
      breakdown.food.total = Math.round((breakdown.food.total + upkeepSrc.value) * 10) / 10;
    } catch (famineErr) {
      console.error('[famine] upkeep breakdown error:', famineErr.message);
    }

    // Outpost food upkeep (010) — sibling negative row. Season-FLAT by
    // design (spec §5): winter already squeezes outpost yields via the
    // production modifier, so upkeep stays constant year-round.
    try {
      const { buildOutpostUpkeepBreakdownSource } = require('../famine');
      const opSrc = await buildOutpostUpkeepBreakdownSource(settlement.id);
      if (opSrc) {
        breakdown.food.sources.push(opSrc);
        breakdown.food.total = Math.round((breakdown.food.total + opSrc.value) * 10) / 10;
      }
    } catch (opErr) {
      console.error('[outposts] upkeep breakdown error:', opErr.message);
    }

    res.json({
      ok: true,
      breakdown,
      season: { id: season.id, name: season.name, emoji: season.emoji },
    });
  } catch (err) {
    console.error('[resource-breakdown]', err);
    res.status(500).json({ error: 'Failed to load resource breakdown.' });
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
  await run("ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS pending_action TEXT DEFAULT NULL", "diplo pending_action");
  await run("ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS pending_sent_at TIMESTAMPTZ DEFAULT NULL", "diplo pending_sent_at");
  await run("ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS pending_arrives_at TIMESTAMPTZ DEFAULT NULL", "diplo pending_arrives_at");
  await run("ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS pending_trust_gain INTEGER DEFAULT 0", "diplo pending_trust_gain");
  await run("ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS pending_meta JSONB DEFAULT '{}'", "diplo pending_meta");
  await run("ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS last_gift_at TIMESTAMPTZ DEFAULT NULL", "diplo last_gift_at");
  await run("ALTER TABLE quest_definitions ADD COLUMN IF NOT EXISTS quest_source TEXT NOT NULL DEFAULT 'tavern'", "quest source");
  await run("ALTER TABLE quest_definitions ADD COLUMN IF NOT EXISTS given_by_npc_id INTEGER", "quest npc id");
  await run("ALTER TABLE quest_definitions ADD COLUMN IF NOT EXISTS min_trust INTEGER NOT NULL DEFAULT 0", "quest min trust");
  await run("ALTER TABLE quest_definitions ADD COLUMN IF NOT EXISTS drops JSONB DEFAULT '[]'", "quest drops");

  // 009_consumption_famine — quantized consumption clock, fractional food
  // carry, death-cause discriminator, condition lookup index.
  await run("ALTER TABLE settlements ADD COLUMN IF NOT EXISTS last_consumption_at TIMESTAMPTZ NOT NULL DEFAULT NOW()", "famine last_consumption_at");
  await run("ALTER TABLE settlements ADD COLUMN IF NOT EXISTS consumption_carry NUMERIC(8,4) NOT NULL DEFAULT 0", "famine consumption_carry");
  await run("ALTER TABLE citizen_events ADD COLUMN IF NOT EXISTS cause TEXT DEFAULT NULL", "famine citizen_events.cause");
  await run("CREATE INDEX IF NOT EXISTS idx_citizen_conditions_type ON citizen_conditions (citizen_id, condition_type)", "famine conditions index");
  await run(`CREATE TABLE IF NOT EXISTS item_templates (
    item_key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '📦', category TEXT NOT NULL DEFAULT 'misc',
    rarity TEXT NOT NULL DEFAULT 'common', rarity_order INTEGER NOT NULL DEFAULT 1,
    quality TEXT NOT NULL DEFAULT 'basic', equip_slot TEXT DEFAULT NULL,
    stat_bonuses JSONB DEFAULT '{}', metadata JSONB DEFAULT '{}',
    sell_value INTEGER NOT NULL DEFAULT 0, food_value INTEGER NOT NULL DEFAULT 0,
    fish_seasons JSONB DEFAULT NULL, fish_difficulty INTEGER DEFAULT NULL,
    fish_weight INTEGER DEFAULT NULL, fish_value INTEGER DEFAULT NULL, fish_flavour TEXT DEFAULT NULL,
    armor_class INTEGER DEFAULT NULL, damage_dice TEXT DEFAULT NULL,
    damage_bonus INTEGER DEFAULT 0, item_effects JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`, "item_templates table");

  // 010_tiles_outposts — tile claims + outposts. Yields go through
  // calculateRates (production/last_tick path); food upkeep goes through
  // famine consumption (quantized carry) — see outposts_v1_spec.md §5.
  // level + assigned_citizen_id are reserved for future upgrades/workers.
  await run("ALTER TABLE tiles ADD COLUMN IF NOT EXISTS claimed_by INTEGER DEFAULT NULL REFERENCES settlements(id) ON DELETE SET NULL", "tiles claimed_by");
  await run("ALTER TABLE tiles ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ DEFAULT NULL", "tiles claimed_at");
  await run(`CREATE TABLE IF NOT EXISTS outposts (
    id SERIAL PRIMARY KEY,
    settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
    tile_q INTEGER NOT NULL,
    tile_r INTEGER NOT NULL,
    terrain TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    assigned_citizen_id INTEGER DEFAULT NULL REFERENCES citizens(id) ON DELETE SET NULL,
    built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tile_q, tile_r)
  )`, "outposts table");
  await run("CREATE INDEX IF NOT EXISTS idx_outposts_settlement ON outposts (settlement_id)", "outposts settlement index");
  await run("CREATE INDEX IF NOT EXISTS idx_tiles_claimed_by ON tiles (claimed_by) WHERE claimed_by IS NOT NULL", "tiles claimed_by index");
  await run("ALTER TABLE archive_meta ADD COLUMN IF NOT EXISTS outposts JSONB DEFAULT '[]'", "archive outposts snapshot");

  res.json({ ok: true, results });
});


// ── GET /api/game/preview-map — generate a map preview without touching DB ──
//   Query params:
//     seed — optional integer; defaults to Date.now() so reroll is "random"
//   Returns { ok, seed, mapW, mapH, tiles: [{q, r, terrain}, ...], counts }
//   Used by Dev Tools → World → Preview Map Generation. Does NOT write to DB.
router.get('/preview-map', async (req, res) => {
  try {
    const mapgen = require('../mapgen');
    let seed = parseInt(req.query.seed, 10);
    if (!Number.isFinite(seed)) seed = Date.now();
    // Optional dimension overrides for previewing future map sizes without
    // touching live module state.
    const w = parseInt(req.query.w, 10);
    const h = parseInt(req.query.h, 10);
    const opts = {};
    if (Number.isFinite(w) && w >= 4 && w <= 200) opts.w = w;
    if (Number.isFinite(h) && h >= 4 && h <= 200) opts.h = h;
    const tiles = mapgen.generateMap(seed, opts);
    const counts = {};
    for (const t of tiles) counts[t.terrain] = (counts[t.terrain] || 0) + 1;
    res.json({
      ok: true, seed,
      mapW: opts.w || mapgen.MAP_W,
      mapH: opts.h || mapgen.MAP_H,
      tiles, counts
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── GET /api/game/world/info — current world dims + archive availability ──
router.get('/world/info', async (req, res) => {
  try {
    const { query } = require('../db');
    const mapgen = require('../mapgen');
    const meta = await query('SELECT map_w, map_h, current_seed, generated_at FROM world_meta WHERE id=1').catch(() => ({ rows: [] }));
    const arc  = await query('SELECT map_w, map_h, seed, archived_at FROM archive_meta WHERE id=1').catch(() => ({ rows: [] }));
    res.json({
      ok: true,
      current: meta.rows[0] || { map_w: mapgen.MAP_W, map_h: mapgen.MAP_H },
      archive: arc.rows[0] || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── POST /api/game/world/regenerate — archive current world, generate new ──
//   Body: { w, h, seed? }
//   Effects (transactional):
//     1. Snapshot tiles, settlement placements, npc placements, fog → archive
//     2. Wipe tiles, fog_of_war, expeditions, settlement placements
//     3. Generate new map at new dimensions
//     4. Update world_meta
//   Note: NPC seeding is NOT re-run automatically — call /seed-npcs after.
router.post('/world/regenerate', async (req, res) => {
  const { pool, query } = require('../db');
  const mapgen = require('../mapgen');

  const w = parseInt(req.body && req.body.w, 10);
  const h = parseInt(req.body && req.body.h, 10);
  if (!Number.isFinite(w) || w < 4 || w > 200) return res.status(400).json({ error: 'Invalid w (4–200).' });
  if (!Number.isFinite(h) || h < 4 || h > 200) return res.status(400).json({ error: 'Invalid h (4–200).' });

  let seed = parseInt(req.body && req.body.seed, 10);
  if (!Number.isFinite(seed)) seed = Date.now();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Archive — snapshot of the current world.
    //    Read settlement placements, NPC placements, fog as JSON aggregates.
    const curTiles = await client.query('SELECT q, r, terrain FROM tiles');
    const curSetts = await client.query("SELECT id, tile_q, tile_r FROM settlements WHERE tile_q IS NOT NULL AND tile_r IS NOT NULL");
    const curNpcs  = await client.query('SELECT * FROM npc_settlements');
    const curFog   = await client.query('SELECT user_id, tile_q, tile_r FROM fog_of_war');
    // Outposts (010) — snapshot before the wipe. .catch → [] pre-migration.
    const curOutposts = await client.query('SELECT * FROM outposts').catch(() => ({ rows: [] }));
    const curMeta  = await client.query('SELECT map_w, map_h, current_seed FROM world_meta WHERE id=1');
    const curW = curMeta.rows[0]?.map_w || mapgen.MAP_W;
    const curH = curMeta.rows[0]?.map_h || mapgen.MAP_H;

    await client.query('DELETE FROM tiles_archive');
    if (curTiles.rows.length) {
      // Chunk inserts to avoid huge query strings on big maps.
      const CHUNK = 500;
      for (let i = 0; i < curTiles.rows.length; i += CHUNK) {
        const batch = curTiles.rows.slice(i, i + CHUNK);
        const vals = batch.map((_, j) => `($${j*3+1},$${j*3+2},$${j*3+3})`).join(',');
        const bp = [];
        batch.forEach(t => bp.push(t.q, t.r, t.terrain));
        await client.query(`INSERT INTO tiles_archive (q, r, terrain) VALUES ${vals}`, bp);
      }
    }

    await client.query('DELETE FROM archive_meta');
    await client.query(
      `INSERT INTO archive_meta (id, map_w, map_h, seed, settlements, npc_settlements, fog, outposts, archived_at)
       VALUES (1, $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW())`,
      [
        curW, curH, curMeta.rows[0]?.current_seed || null,
        JSON.stringify(curSetts.rows),
        JSON.stringify(curNpcs.rows),
        JSON.stringify(curFog.rows),
        JSON.stringify(curOutposts.rows),
      ]
    );

    // 2. Wipe live world state.
    await client.query('DELETE FROM fog_of_war');
    await client.query('DELETE FROM expeditions').catch(()=>{});
    // Outposts (010) — must go with the tiles they sit on; claims live in
    // the tiles table and vanish with it.
    await client.query('DELETE FROM outposts').catch(()=>{});
    await client.query('DELETE FROM tiles');
    await client.query('UPDATE settlements SET tile_q=NULL, tile_r=NULL, rerolls_used=0');
    // NPC settlements are kept in DB but their tile_q/tile_r values now point
    // at the wiped tile space — they'll need re-seeding via /seed-npcs.
    await client.query('DELETE FROM npc_settlements');

    // 3. Set dimensions on mapgen, generate, insert.
    mapgen.setMapDimensions(w, h);
    const newTiles = mapgen.generateMap(seed);
    const CHUNK = 500;
    for (let i = 0; i < newTiles.length; i += CHUNK) {
      const batch = newTiles.slice(i, i + CHUNK);
      const vals = batch.map((_, j) => `($${j*3+1},$${j*3+2},$${j*3+3})`).join(',');
      const bp = [];
      batch.forEach(t => bp.push(t.q, t.r, t.terrain));
      await client.query(`INSERT INTO tiles (q, r, terrain) VALUES ${vals}`, bp);
    }

    // 4. Update world_meta.
    await client.query(
      `INSERT INTO world_meta (id, map_w, map_h, current_seed, generated_at)
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET map_w=$1, map_h=$2, current_seed=$3, generated_at=NOW()`,
      [w, h, seed]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      mapW: w, mapH: h, seed,
      tiles_inserted: newTiles.length,
      archived: { mapW: curW, mapH: curH, tile_count: curTiles.rows.length, settlement_count: curSetts.rows.length },
      message: 'Regenerated. NPC settlements were cleared — run "Seed NPC Settlements" to repopulate.',
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});


// ── POST /api/game/world/restore — restore archived world (one snapshot) ──
//   Restores: tiles, dimensions, settlement placements, NPC placements, fog.
//   Discards: in-flight expeditions (cancelled — too messy to migrate).
router.post('/world/restore', async (req, res) => {
  const { pool, query } = require('../db');
  const mapgen = require('../mapgen');

  const arc = await query('SELECT * FROM archive_meta WHERE id=1').catch(() => ({ rows: [] }));
  if (!arc.rows.length) return res.status(404).json({ error: 'No archive found.' });
  const a = arc.rows[0];

  const archTiles = await query('SELECT q, r, terrain FROM tiles_archive');
  if (!archTiles.rows.length) return res.status(404).json({ error: 'Archive tiles missing — cannot restore.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Wipe current.
    await client.query('DELETE FROM fog_of_war');
    await client.query('DELETE FROM expeditions').catch(()=>{});
    await client.query('DELETE FROM outposts').catch(()=>{});
    await client.query('DELETE FROM tiles');
    await client.query('UPDATE settlements SET tile_q=NULL, tile_r=NULL');
    await client.query('DELETE FROM npc_settlements');

    // Restore tiles.
    const CHUNK = 500;
    for (let i = 0; i < archTiles.rows.length; i += CHUNK) {
      const batch = archTiles.rows.slice(i, i + CHUNK);
      const vals = batch.map((_, j) => `($${j*3+1},$${j*3+2},$${j*3+3})`).join(',');
      const bp = [];
      batch.forEach(t => bp.push(t.q, t.r, t.terrain));
      await client.query(`INSERT INTO tiles (q, r, terrain) VALUES ${vals}`, bp);
    }

    // Restore settlement placements (only for settlements that still exist).
    const setts = Array.isArray(a.settlements) ? a.settlements : [];
    for (const s of setts) {
      await client.query(
        'UPDATE settlements SET tile_q=$1, tile_r=$2 WHERE id=$3',
        [s.tile_q, s.tile_r, s.id]
      );
    }

    // Restore NPC settlements from archive. We re-insert with archived ids so
    // diplomacy_relations rows (which reference npc_id) still resolve.
    const npcs = Array.isArray(a.npc_settlements) ? a.npc_settlements : [];
    for (const n of npcs) {
      // Build dynamic insert from whichever columns the archive captured.
      const keys = Object.keys(n);
      const cols = keys.join(',');
      const placeholders = keys.map((_, i) => `$${i+1}`).join(',');
      const vals = keys.map(k => {
        const v = n[k];
        // pg expects strings or null for jsonb columns; objects need stringifying.
        return (v && typeof v === 'object') ? JSON.stringify(v) : v;
      });
      try {
        await client.query(
          `INSERT INTO npc_settlements (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          vals
        );
      } catch(_) { /* skip individual rows that fail rather than abort restore */ }
    }
    // Re-sync the npc_settlements id sequence so future inserts don't clash
    // with restored ids.
    await client.query(
      `SELECT setval(pg_get_serial_sequence('npc_settlements','id'),
        COALESCE((SELECT MAX(id) FROM npc_settlements), 1), true)`
    ).catch(()=>{});

    // Restore fog.
    const fog = Array.isArray(a.fog) ? a.fog : [];
    if (fog.length) {
      for (let i = 0; i < fog.length; i += CHUNK) {
        const batch = fog.slice(i, i + CHUNK);
        const vals = batch.map((_, j) => `($${j*3+1},$${j*3+2},$${j*3+3})`).join(',');
        const bp = [];
        batch.forEach(f => bp.push(f.user_id, f.tile_q, f.tile_r));
        await client.query(`INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ${vals} ON CONFLICT DO NOTHING`, bp);
      }
    }

    // Restore outposts (010) + their tile claims. The archived tiles were
    // just restored, so coordinates resolve; settlements that no longer
    // exist are skipped row-by-row rather than aborting the restore.
    const archOutposts = Array.isArray(a.outposts) ? a.outposts : [];
    for (const o of archOutposts) {
      try {
        await client.query(
          `INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, built_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [o.settlement_id, o.tile_q, o.tile_r, o.terrain, o.level || 1, o.built_at || new Date().toISOString()]
        );
        await client.query(
          'UPDATE tiles SET claimed_by=$1, claimed_at=NOW() WHERE q=$2 AND r=$3',
          [o.settlement_id, o.tile_q, o.tile_r]
        );
      } catch(_) { /* skip individual rows that fail rather than abort restore */ }
    }

    // Update dimensions on mapgen + world_meta.
    mapgen.setMapDimensions(a.map_w, a.map_h);
    await client.query(
      `INSERT INTO world_meta (id, map_w, map_h, current_seed, generated_at)
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET map_w=$1, map_h=$2, current_seed=$3, generated_at=NOW()`,
      [a.map_w, a.map_h, a.seed]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      mapW: a.map_w, mapH: a.map_h,
      tiles_restored: archTiles.rows.length,
      settlements_restored: setts.length,
      fog_rows_restored: fog.length,
      message: 'Restored. In-flight expeditions were cancelled.',
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
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


// ── /api/game/items — inline item admin (fallback if item_admin route missing) ──
router.get('/items', requireAuth, async (req, res) => {
  try {
    const r = await require('../db').query('SELECT * FROM item_templates ORDER BY category, rarity_order, name');
    res.json({ ok: true, items: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/items', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    if (!d.item_key || !d.name) return res.status(400).json({ error: 'item_key and name required.' });
    const db = require('../db');
    const rarityOrder = { common:1, uncommon:2, rare:3, epic:4, legendary:5 }[d.rarity] || 1;
    await db.query(`INSERT INTO item_templates
      (item_key,name,description,icon,category,rarity,rarity_order,quality,equip_slot,
       stat_bonuses,sell_value,food_value,fish_seasons,fish_difficulty,fish_weight,
       fish_value,fish_flavour,armor_class,damage_dice,damage_bonus)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (item_key) DO NOTHING`,
    [d.item_key,d.name,d.description||'',d.icon||'📦',d.category||'misc',
     d.rarity||'common',rarityOrder,d.quality||'basic',d.equip_slot||null,
     JSON.stringify(d.stat_bonuses||{}),d.sell_value||0,d.food_value||0,
     d.fish_seasons?JSON.stringify(d.fish_seasons):null,
     d.fish_difficulty||null,d.fish_weight||null,d.fish_value||null,d.fish_flavour||null,
     d.armor_class||null,d.damage_dice||null,d.damage_bonus||0]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/items/:key', requireAuth, async (req, res) => {
  try {
    await require('../db').query('DELETE FROM item_templates WHERE item_key=$1', [req.params.key]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/items/:key/spawn', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const settRes = await db.query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });
    const t = (await db.query('SELECT * FROM item_templates WHERE item_key=$1', [req.params.key])).rows[0];
    if (!t) return res.status(404).json({ error: 'Item not found.' });
    await db.query(`INSERT INTO inventory_items
      (settlement_id,item_key,name,description,icon,category,rarity,quantity,equip_slot,stat_bonuses,source,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'admin',$11) ON CONFLICT DO NOTHING`,
      [sett.id,t.item_key,t.name,t.description,t.icon,t.category,t.rarity,
       parseInt(req.body.quantity)||1,t.equip_slot,JSON.stringify(t.stat_bonuses||{}),
       JSON.stringify({sell_value:t.sell_value,food_value:t.food_value,
                       armor_class:t.armor_class,damage_dice:t.damage_dice})]);
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
