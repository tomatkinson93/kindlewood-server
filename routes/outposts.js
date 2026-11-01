// ══════════════════════════════════════════════════════════════════════════
//  OUTPOSTS — routes (mount at /api/game/outposts in server index.js:
//      app.use('/api/game/outposts', require('./routes/outposts'));
//  (Built from outposts_v1_spec.md, which isn't in the repo; outposts_config.js
//  is the reference.)
//
//  Endpoints:
//    GET    /          — my outposts + cap/used/range + display config
//    POST   /build     — { q, r } claim + build in ONE transaction (the button)
//    POST   /claim     — { q, r } territory only (10 wealth; API completeness)
//    POST   /:id/upgrade — next level (max 3): more yield and ores, more upkeep
//    POST   /:id/assign   — { citizen_id } post a worker (+25%, +50% if they know the land)
//    POST   /:id/unassign — bring the worker home
//    DELETE /:id       — dismantle, clears the tile claim, refunds half of what was paid
//
//  Contested-tile arbiter: UNIQUE (tile_q, tile_r) on outposts — the DB, not
//  this handler, decides races. Unique violation → 409.
//  No Math.random() anywhere; production accrues via the existing last_tick
//  path in routes/game.js, so nothing here touches clocks.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const gameEvents = require('../lib/game_events');
const { pool, query } = require('../db');
const requireAuth = require('../middleware/auth');
const mapgen = require('../mapgen');
const {
  OUTPOST_CONFIG, OUTPOST_COST, CLAIM_COST,
  rangeForTier, capForTier, outpostYields, publicConfig, dismantleRefund,
  OUTPOST_FOOD_UPKEEP_PER_HR, OUTPOST_MAX_LEVEL, OUTPOST_LEVEL_TIER, upgradeCost,
} = require('../outposts_config');
const { TIER_ORDER } = require('../buildings');
const RD = require('../lib/resource_defs');
const outpostState = require('../lib/outpost_state');

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
  const mult = o.mult ?? 1;
  return {
    id: o.id,
    tile_q: o.tile_q,
    tile_r: o.tile_r,
    terrain: o.terrain,
    level: o.level,
    name: cfg.name || 'Outpost',
    icon: cfg.icon || '⛺',
    yields: outpostYields(o.terrain, o.level, mult),
    ores: oresAt(o.terrain, o.level, mult),
    mult,
    worker: o.worker || null,
    notes: o.notes || [],
    raided_until: o.raided_until || null,
    refund: dismantleRefund(o.level),
    upkeep_food_per_hr: OUTPOST_FOOD_UPKEEP_PER_HR * Math.max(1, o.level || 1),
    max_level: OUTPOST_MAX_LEVEL,
    built_at: o.built_at,
  };
}
// Ores per hour at a level (before research, which can gate or raise them).
function oresAt(terrain, level, mult = 1) {
  const cfg = OUTPOST_CONFIG[terrain] || {};
  const lvl = Math.max(1, Math.floor(level) || 1);
  return Object.fromEntries(Object.entries(cfg.ores || {}).map(([k, v]) => [k, Math.round(v * lvl * mult * 100) / 100]));
}
// The next level for one of my outposts: { level, cost, yields, ores, upkeep,
// tier (needed), tierMet } or null at the top.
function nextLevel(o, tier, mult) {
  const level = (o.level || 1) + 1;
  if (level > OUTPOST_MAX_LEVEL) return null;
  const need = OUTPOST_LEVEL_TIER[level] || null;
  return {
    level, cost: upgradeCost(level, mult),
    yields: outpostYields(o.terrain, level, o.mult ?? 1), ores: oresAt(o.terrain, level, o.mult ?? 1),
    upkeep_food_per_hr: OUTPOST_FOOD_UPKEEP_PER_HR * level,
    tier: need, tierMet: !need || TIER_ORDER.indexOf(tier || 'camp') >= TIER_ORDER.indexOf(need),
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
  const [sRes, uRes, bRes, cRows, oRes] = await Promise.all([
    query(`SELECT ${require('../lib/resource_defs').KEYS.join(', ')} FROM settlements WHERE id=$1`, [settlementId]),
    query('SELECT species FROM users WHERE id=$1', [userId]),
    query('SELECT type, level FROM buildings WHERE settlement_id=$1', [settlementId]),
    require('../lib/careers').loadWorkforce(null, settlementId).catch(async () =>
      (await query("SELECT role FROM citizens WHERE settlement_id=$1 AND COALESCE(life_stage, 'adult') = 'adult'", [settlementId])).rows),
    outpostState.load(null, settlementId).then(rows => ({ rows })),
  ]);
  const { calculateRates } = require('../buildings');
  const { getCurrentSeason, applySeasonModifiers } = require('../seasons');
  const species = uRes.rows[0]?.species || 'Mice';
  const baseRates = calculateRates(bRes.rows, cRows, species, oRes.rows, { research: await require('../lib/research').doneSet(null, settlementId) });
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

    const oRes = { rows: await outpostState.load(null, settlement) };   // annotated: worker, unfed, raided

    const tier = settlement.tier || 'camp';
    const mult = (await require('./buildings').buildDiscount(settlement.id)).mult;
    res.json({
      ok: true,
      outposts: oRes.rows.map(o => ({ ...decorate(o), next: nextLevel(o, tier, mult) })),
      used: oRes.rows.length,
      cap: capForTier(tier),
      range: rangeForTier(tier),
      tier,
      cost: OUTPOST_COST,
      claim_cost: CLAIM_COST,
      upkeep_food_per_hr: OUTPOST_FOOD_UPKEEP_PER_HR,
      unfed: !!settlement.outposts_unfed_since,
      worker_bonus: { base: outpostState.WORKER_BONUS, fit: outpostState.FIT_BONUS, fit_class: outpostState.FIT },
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
    gameEvents.emit('outpost_established', { settlementId: settlement.id, userId: req.user.userId });

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

// ── POST /:id/upgrade — next level ─────────────────────────────────────────
router.post('/:id/upgrade', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad outpost id.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settlement = (await client.query('SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [req.user.userId])).rows[0];
    const o = settlement && (await client.query('SELECT * FROM outposts WHERE id=$1 AND settlement_id=$2 FOR UPDATE', [id, settlement.id])).rows[0];
    const fail = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };
    if (!o) return fail(404, 'Outpost not found.');
    const mult = (await require('./buildings').buildDiscount(settlement.id)).mult;
    const next = nextLevel(o, settlement.tier, mult);
    if (!next) return fail(400, `This outpost is already level ${OUTPOST_MAX_LEVEL}.`);
    if (!next.tierMet) return fail(400, `A level ${next.level} outpost needs a ${next.tier.charAt(0).toUpperCase() + next.tier.slice(1)}.`);
    for (const [r, v] of Object.entries(next.cost)) {
      if (v > (Number(settlement[r]) || 0)) return fail(400, `Not enough ${RD.label(r).toLowerCase()}. Need ${v}.`);
    }
    const keys = Object.keys(next.cost).filter(r => RD.isResource(r) && next.cost[r] > 0);
    await client.query(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} - $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`,
      [...keys.map(r => next.cost[r]), settlement.id]);
    await client.query('UPDATE outposts SET level = $2 WHERE id = $1', [id, next.level]);
    await client.query('COMMIT');
    const up = (await outpostState.load(null, settlement)).find(x => x.id === id);

    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outpost: { ...decorate(up), next: nextLevel(up, settlement.tier, mult) }, spent: next.cost, resources, rates });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[outposts] upgrade', err);
    res.status(500).json({ error: 'Failed to upgrade the outpost.' });
  } finally {
    client.release();
  }
});

// ── POST /:id/assign — post a worker ──────────────────────────────────────
router.post('/:id/assign', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10), cid = parseInt(req.body && req.body.citizen_id, 10);
    if (!Number.isFinite(id) || !Number.isFinite(cid)) return res.status(400).json({ error: 'outpost id and citizen_id required.' });
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const o = (await query('SELECT * FROM outposts WHERE id=$1 AND settlement_id=$2', [id, settlement.id])).rows[0];
    if (!o) return res.status(404).json({ error: 'Outpost not found.' });
    if (o.assigned_citizen_id === cid) return res.status(400).json({ error: 'They already work here.' });
    const c = (await query('SELECT id, name, settlement_id, life_stage, role FROM citizens WHERE id=$1', [cid])).rows[0];
    const why = await outpostState.busyReason(c, settlement.id);
    if (why) return res.status(400).json({ error: why });
    // The citizen-unique arbiter is this conditional update: it only posts
    // them when no other outpost has them.
    const r = await query(
      `UPDATE outposts SET assigned_citizen_id=$1 WHERE id=$2 AND settlement_id=$3
         AND NOT EXISTS (SELECT 1 FROM outposts WHERE assigned_citizen_id=$1) RETURNING id`, [cid, id, settlement.id]);
    if (!r.rows.length) return res.status(409).json({ error: `${c.name} is already working an outpost.` });
    const out = (await outpostState.load(null, settlement)).find(x => x.id === id);
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outpost: { ...decorate(out), next: nextLevel(out, settlement.tier, (await require('./buildings').buildDiscount(settlement.id)).mult) }, resources, rates });
  } catch (err) {
    console.error('[outposts] assign', err);
    res.status(500).json({ error: 'Failed to post the worker.' });
  }
});

// ── POST /:id/unassign — bring the worker home ─────────────────────────────
router.post('/:id/unassign', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad outpost id.' });
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const r = await query('UPDATE outposts SET assigned_citizen_id=NULL WHERE id=$1 AND settlement_id=$2 RETURNING id', [id, settlement.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Outpost not found.' });
    const out = (await outpostState.load(null, settlement)).find(x => x.id === id);
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outpost: { ...decorate(out), next: nextLevel(out, settlement.tier, (await require('./buildings').buildDiscount(settlement.id)).mult) }, resources, rates });
  } catch (err) {
    console.error('[outposts] unassign', err);
    res.status(500).json({ error: 'Failed to bring the worker home.' });
  }
});

// ── DELETE /:id — dismantle, half of what was paid comes back ──────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad outpost id.' });

    await client.query('BEGIN');
    const settlement = (await client.query('SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [req.user.userId])).rows[0];
    if (!settlement) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No settlement.' }); }

    const oRes = await client.query(
      'DELETE FROM outposts WHERE id=$1 AND settlement_id=$2 RETURNING tile_q, tile_r, level',
      [id, settlement.id]
    );
    if (!oRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Outpost not found.' }); }

    const { tile_q, tile_r, level } = oRes.rows[0];
    await client.query(
      'UPDATE tiles SET claimed_by=NULL, claimed_at=NULL WHERE q=$1 AND r=$2 AND claimed_by=$3',
      [tile_q, tile_r, settlement.id]
    );
    const refund = dismantleRefund(level);
    const keys = Object.keys(refund).filter(r => RD.isResource(r));
    if (keys.length) {
      await client.query(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} + $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`,
        [...keys.map(r => refund[r]), settlement.id]);
    }
    await client.query('COMMIT');

    const cnt = await query('SELECT COUNT(*)::int AS n FROM outposts WHERE settlement_id=$1', [settlement.id]);
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({
      ok: true,
      removed: { tile_q, tile_r },
      refund,
      used: cnt.rows[0].n,
      cap: capForTier(settlement.tier || 'camp'),
      resources,
      rates,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[outposts] dismantle', err);
    res.status(500).json({ error: 'Failed to dismantle outpost.' });
  } finally {
    client.release();
  }
});

module.exports = router;
