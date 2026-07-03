// ══════════════════════════════════════════════════════════════════════════
//  OUTPOSTS — routes (mount at /api/game/outposts in server index.js:
//      app.use('/api/game/outposts', require('./routes/outposts'));
//  Implements outposts_v1_spec.md §6.
//
//  Endpoints:
//    GET    /          — my outposts + cap/used/range + display config
//    POST   /build     — { q, r } claim + build in ONE transaction (the button)
//    POST   /claim     — { q, r } territory only (10 wealth; API completeness)
//    DELETE /:id       — dismantle, clears the tile claim, no refund
//
//  Contested-tile arbiter: UNIQUE (tile_q, tile_r) on outposts — the DB, not
//  this handler, decides races. Unique violation → 409.
//  No Math.random() anywhere; production accrues via the existing last_tick
//  path in routes/game.js, so nothing here touches clocks.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { pool, query } = require('../db');
const requireAuth = require('../middleware/auth');
const mapgen = require('../mapgen');
const {
  OUTPOST_CONFIG, OUTPOST_COST, CLAIM_COST,
  rangeForTier, capForTier, outpostYields, publicConfig,
  OUTPOST_FOOD_UPKEEP_PER_HR,
} = require('../outposts_config');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────

// World dims from world_meta, falling back to live mapgen values. Read per
// request — cheap, and correct across /world/regenerate without a restart.
async function loadWorldDims() {
  try {
    const meta = await query('SELECT map_w, map_h FROM world_meta WHERE id=1');
    if (meta.rows[0]) return { W: meta.rows[0].map_w, H: meta.rows[0].map_h };
  } catch (e) { /* table may not exist yet */ }
  return { W: mapgen.MAP_W, H: mapgen.MAP_H };
}

const norm = (v, m) => ((Math.floor(v) % m) + m) % m;

// Wrap-aware axial hex distance at explicit dims (mapgen.hexDistanceWrapped
// reads module-level dims, which can drift from world_meta until restart —
// compute against the loaded dims instead so the seam math is always right).
function hexDistWrapped(q1, r1, q2, r2, W, H) {
  const dist = (a, b, c, d) => {
    const dq = a - c, dr = b - d;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  };
  let min = Infinity;
  for (let dq = -1; dq <= 1; dq++) {
    for (let dr = -1; dr <= 1; dr++) {
      const d = dist(q1, r1, q2 + dq * W, r2 + dr * H);
      if (d < min) min = d;
    }
  }
  return min;
}

function decorate(o) {
  const cfg = OUTPOST_CONFIG[o.terrain] || {};
  return {
    id: o.id,
    tile_q: o.tile_q,
    tile_r: o.tile_r,
    terrain: o.terrain,
    level: o.level,
    name: cfg.name || 'Outpost',
    icon: cfg.icon || '⛺',
    yields: outpostYields(o.terrain, o.level),
    upkeep_food_per_hr: OUTPOST_FOOD_UPKEEP_PER_HR,
    built_at: o.built_at,
  };
}

async function loadUserSettlement(userId, client = null) {
  const q = client ? client.query.bind(client) : query;
  const sRes = await q('SELECT * FROM settlements WHERE user_id=$1', [userId]);
  return sRes.rows[0] || null;
}

// Fresh resources + post-season rates after a spend, so the client can sync
// the topbar tick immediately (spec §7 spend-sync). Uses the same inputs as
// GET /settlement.
async function freshResourcesAndRates(settlementId, userId) {
  const [sRes, uRes, bRes, cRes, oRes] = await Promise.all([
    query('SELECT food, timber, stone, metal, wealth FROM settlements WHERE id=$1', [settlementId]),
    query('SELECT species FROM users WHERE id=$1', [userId]),
    query('SELECT type, level FROM buildings WHERE settlement_id=$1', [settlementId]),
    query('SELECT role FROM citizens WHERE settlement_id=$1', [settlementId]),
    query('SELECT id, tile_q, tile_r, terrain, level FROM outposts WHERE settlement_id=$1', [settlementId]).catch(() => ({ rows: [] })),
  ]);
  const { calculateRates } = require('../buildings');
  const { getCurrentSeason, applySeasonModifiers } = require('../seasons');
  const species = uRes.rows[0]?.species || 'Mice';
  const baseRates = calculateRates(bRes.rows, cRes.rows, species, oRes.rows);
  const rates = applySeasonModifiers(baseRates, getCurrentSeason());
  return { resources: sRes.rows[0], rates };
}

// Shared eligibility checks for claim + build. Returns { error, status } or
// { tile }. `client` is the transaction client (locks are already held).
async function checkTileEligibility(client, settlement, qn, rn, W, H) {
  if (settlement.tile_q == null || settlement.tile_r == null) {
    return { status: 400, error: 'Your settlement has no home tile yet.' };
  }

  const tRes = await client.query(
    'SELECT q, r, terrain, claimed_by FROM tiles WHERE q=$1 AND r=$2', [qn, rn]
  );
  const tile = tRes.rows[0];
  if (!tile) return { status: 404, error: 'No such tile.' };

  // Must be discovered (fog_of_war rows = revealed; confirmed in routes/map.js)
  const fRes = await client.query(
    'SELECT 1 FROM fog_of_war WHERE user_id=$1 AND tile_q=$2 AND tile_r=$3',
    [settlement.user_id, qn, rn]
  );
  if (!fRes.rows.length) {
    return { status: 400, error: 'This tile is still shrouded in fog. Send scouts first.' };
  }

  // Range by tier
  const range = rangeForTier(settlement.tier || 'camp');
  const d = hexDistWrapped(settlement.tile_q, settlement.tile_r, qn, rn, W, H);
  if (d > range) {
    return { status: 400, error: `Too far from your settlement (needs ≤ ${range}, this is ${d}).` };
  }

  // No settlement on the tile, and none within wrapped distance 1 that isn't ours
  const occ = await client.query(
    `SELECT tile_q, tile_r, id, NULL::int AS npc FROM settlements WHERE tile_q IS NOT NULL
     UNION ALL
     SELECT tile_q, tile_r, NULL::int AS id, id AS npc FROM npc_settlements WHERE tile_q IS NOT NULL`
  ).catch(() => ({ rows: [] }));
  for (const o of occ.rows) {
    const od = hexDistWrapped(o.tile_q, o.tile_r, qn, rn, W, H);
    if (od === 0) {
      return { status: 400, error: 'A settlement already stands here.' };
    }
    if (od <= 1 && o.id !== settlement.id) {
      return { status: 400, error: 'Too close to another settlement.' };
    }
  }

  // Contested: claimed by someone else (soft check — UNIQUE is the arbiter)
  if (tile.claimed_by != null && tile.claimed_by !== settlement.id) {
    const owner = await client.query('SELECT name FROM settlements WHERE id=$1', [tile.claimed_by]);
    return { status: 409, error: `This tile is claimed by ${owner.rows[0]?.name || 'another settlement'}.` };
  }

  return { tile };
}

// ── GET / — my outposts + status ───────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const oRes = await query(
      'SELECT * FROM outposts WHERE settlement_id=$1 ORDER BY built_at',
      [settlement.id]
    ).catch(() => ({ rows: [] })); // table missing pre-migration → empty

    const tier = settlement.tier || 'camp';
    res.json({
      ok: true,
      outposts: oRes.rows.map(decorate),
      used: oRes.rows.length,
      cap: capForTier(tier),
      range: rangeForTier(tier),
      tier,
      cost: OUTPOST_COST,
      claim_cost: CLAIM_COST,
      upkeep_food_per_hr: OUTPOST_FOOD_UPKEEP_PER_HR,
      config: publicConfig(),
    });
  } catch (err) {
    console.error('[outposts] list', err);
    res.status(500).json({ error: 'Failed to load outposts.' });
  }
});

// ── POST /build — claim + build, one transaction ───────────────────────────
router.post('/build', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { W, H } = await loadWorldDims();
    const qRaw = Number(req.body?.q), rRaw = Number(req.body?.r);
    if (!Number.isFinite(qRaw) || !Number.isFinite(rRaw)) {
      return res.status(400).json({ error: 'Missing tile coordinates.' });
    }
    const qn = norm(qRaw, W), rn = norm(rRaw, H);

    await client.query('BEGIN');

    // Lock the settlement row — serialises the resource spend.
    const sRes = await client.query(
      'SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [req.user.userId]
    );
    const settlement = sRes.rows[0];
    if (!settlement) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No settlement.' });
    }
    settlement.user_id = req.user.userId;

    const chk = await checkTileEligibility(client, settlement, qn, rn, W, H);
    if (chk.error) {
      await client.query('ROLLBACK');
      return res.status(chk.status).json({ error: chk.error });
    }
    const tile = chk.tile;

    // Cap by tier
    const cap = capForTier(settlement.tier || 'camp');
    const cnt = await client.query(
      'SELECT COUNT(*)::int AS n FROM outposts WHERE settlement_id=$1', [settlement.id]
    );
    if (cnt.rows[0].n >= cap) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Your ${settlement.tier || 'camp'} can support ${cap} outpost${cap === 1 ? '' : 's'}. Grow your settlement tier to found more.`,
      });
    }

    // One outpost per tile — soft check; UNIQUE is the real arbiter below.
    const existing = await client.query(
      'SELECT id FROM outposts WHERE tile_q=$1 AND tile_r=$2', [qn, rn]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An outpost already stands on this tile.' });
    }

    // Resources
    const need = OUTPOST_COST;
    if ((need.timber || 0) > settlement.timber) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Not enough timber. Need ${need.timber}.` }); }
    if ((need.stone  || 0) > settlement.stone)  { await client.query('ROLLBACK'); return res.status(400).json({ error: `Not enough stone. Need ${need.stone}.` }); }
    if ((need.wealth || 0) > settlement.wealth) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Not enough wealth. Need ${need.wealth}.` }); }

    await client.query(
      `UPDATE settlements SET timber = timber - $1, stone = stone - $2, wealth = wealth - $3 WHERE id = $4`,
      [need.timber || 0, need.stone || 0, need.wealth || 0, settlement.id]
    );

    // Insert — terrain denormalised from the tile row (immutable within a
    // world version; outposts are wiped alongside tiles on regenerate).
    let outpostRow;
    try {
      const ins = await client.query(
        `INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level)
         VALUES ($1, $2, $3, $4, 1) RETURNING *`,
        [settlement.id, qn, rn, tile.terrain]
      );
      outpostRow = ins.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        return res.status(409).json({ error: 'Another settlement claimed this tile first.' });
      }
      throw e;
    }

    // Claim the tile (auto-claim; guarded so a mid-flight foreign claim rolls us back)
    const claim = await client.query(
      `UPDATE tiles SET claimed_by=$1, claimed_at=NOW()
        WHERE q=$2 AND r=$3 AND (claimed_by IS NULL OR claimed_by=$1)`,
      [settlement.id, qn, rn]
    );
    if (claim.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Another settlement claimed this tile first.' });
    }

    await client.query('COMMIT');

    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({
      ok: true,
      outpost: decorate(outpostRow),
      resources,
      rates,
      used: cnt.rows[0].n + 1,
      cap,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[outposts] build', err);
    res.status(500).json({ error: 'Failed to found outpost.' });
  } finally {
    client.release();
  }
});

// ── POST /claim — territory only ───────────────────────────────────────────
router.post('/claim', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { W, H } = await loadWorldDims();
    const qRaw = Number(req.body?.q), rRaw = Number(req.body?.r);
    if (!Number.isFinite(qRaw) || !Number.isFinite(rRaw)) {
      return res.status(400).json({ error: 'Missing tile coordinates.' });
    }
    const qn = norm(qRaw, W), rn = norm(rRaw, H);

    await client.query('BEGIN');
    const sRes = await client.query(
      'SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [req.user.userId]
    );
    const settlement = sRes.rows[0];
    if (!settlement) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No settlement.' }); }
    settlement.user_id = req.user.userId;

    const chk = await checkTileEligibility(client, settlement, qn, rn, W, H);
    if (chk.error) { await client.query('ROLLBACK'); return res.status(chk.status).json({ error: chk.error }); }
    if (chk.tile.claimed_by === settlement.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You already claim this tile.' });
    }

    if ((CLAIM_COST.wealth || 0) > settlement.wealth) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Not enough wealth. Need ${CLAIM_COST.wealth}.` });
    }
    await client.query('UPDATE settlements SET wealth = wealth - $1 WHERE id=$2', [CLAIM_COST.wealth || 0, settlement.id]);

    const claim = await client.query(
      `UPDATE tiles SET claimed_by=$1, claimed_at=NOW()
        WHERE q=$2 AND r=$3 AND claimed_by IS NULL`,
      [settlement.id, qn, rn]
    );
    if (claim.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Another settlement claimed this tile first.' });
    }

    await client.query('COMMIT');
    const { resources } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, claimed: { q: qn, r: rn }, resources });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[outposts] claim', err);
    res.status(500).json({ error: 'Failed to claim tile.' });
  } finally {
    client.release();
  }
});

// ── DELETE /:id — dismantle (no refund, v1) ────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad outpost id.' });

    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const oRes = await query(
      'DELETE FROM outposts WHERE id=$1 AND settlement_id=$2 RETURNING tile_q, tile_r',
      [id, settlement.id]
    );
    if (!oRes.rows.length) return res.status(404).json({ error: 'Outpost not found.' });

    const { tile_q, tile_r } = oRes.rows[0];
    await query(
      'UPDATE tiles SET claimed_by=NULL, claimed_at=NULL WHERE q=$1 AND r=$2 AND claimed_by=$3',
      [tile_q, tile_r, settlement.id]
    );

    const cnt = await query('SELECT COUNT(*)::int AS n FROM outposts WHERE settlement_id=$1', [settlement.id]);
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({
      ok: true,
      removed: { tile_q, tile_r },
      used: cnt.rows[0].n,
      cap: capForTier(settlement.tier || 'camp'),
      resources,
      rates,
    });
  } catch (err) {
    console.error('[outposts] dismantle', err);
    res.status(500).json({ error: 'Failed to dismantle outpost.' });
  }
});

module.exports = router;
