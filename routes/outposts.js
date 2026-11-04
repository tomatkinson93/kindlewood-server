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
//    POST   /:id/assign   — { citizen_id, post: worker|garrison|hauler } (workers +25%/+50%; garrison defends;
//                            a hauler carries the store home, run after run)
//    POST   /:id/haul     — { citizen_id } one porter run: out, load up, home (lib/outpost_store)
//    POST   /:id/buildings — { key } raise a building inside it (lib/outpost_buildings)
//    DELETE /:id/buildings/:key — pull one down (frees the slot, nothing back)
//    PATCH  /:id/settings  — { haul_filter, haul_threshold } what porters carry, when haulers go
//    POST   /:id/road      — the next road level to town (lib/outpost_roads)
//    POST   /:id/events/:eid — { choice } answer an outpost event (lib/outpost_events)
//    POST   /:id/help      — { citizen_id } a clanmate's porter fetches for the owner
//    POST   /admin/:action — Dev Tools: finish | arrive | porters | fill | event | events-clear
//  Workers and garrison walk out to a new post and home again from one
//  (outpost_hauls kind 'post' / 'return'); they count once they arrive.
//    POST   /:id/unassign — { citizen_id } bring them home
//    POST   /:id/fortify  — the next fort level (lib/defences FORT; research-gated)
//    DELETE /:id       — dismantle, clears the tile claim, refunds half of what was paid;
//                         the crew carry its store home
//
//  Contested-tile arbiter: UNIQUE (tile_q, tile_r) on outposts — the DB, not
//  this handler, decides races. Unique violation → 409.
//  No Math.random() anywhere. Production fills each outpost's own store on
//  its own clock (lib/outpost_store, outposts.store_tick).
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
const OS = require('../lib/outpost_store');
const OB = require('../lib/outpost_buildings');

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
// Everything the panel shows for one of my outposts: decorate + next level +
// crew (workers, garrison, their slots) + fort (level, next, research lock)
// + its own defence (lib/defences).
const FORT_RESEARCH = { 1: 'palisades', 2: 'stone_forts', 3: 'bastions' };
async function present(settlement, o, discMult) {
  const D = require('../lib/defences');
  const RS = require('../lib/research_defs');
  if (discMult == null) discMult = (await require('./buildings').buildDiscount(settlement.id)).mult;
  const done = await require('../lib/research').doneSet(null, settlement.id).catch(() => new Set());
  const fx = RS.effectsOf(done);
  const def = await D.outpostDefence(settlement, o, null, fx);
  const lvl = Math.min(3, Number(o.fort_level) || 0);
  const nl = lvl + 1;
  const next = D.FORT[nl] ? {
    level: nl, name: D.FORT[nl].name, icon: D.FORT[nl].icon, defence: D.FORT[nl].defence, slots: D.FORT[nl].slots,
    cost: Object.fromEntries(Object.entries(D.FORT[nl].cost).map(([r, v]) => [r, Math.ceil(v * discMult)])),
    researchMet: D.fortAllowed(fx) >= nl, research: RS.labelFor(FORT_RESEARCH[nl], done),
  } : null;
  // Its store, the porters on the road to or from it, and a trip estimate.
  const hauls = await OS.activeHauls(settlement.id, o.id);
  let trip = null;
  try { const t = await OS.tripFor(null, settlement, o, { id: 0 }); trip = { leg_seconds: t.leg, carry: t.carry, tiles: t.tiles }; } catch (e) { /* estimate only */ }
  return {
    ...decorate(o), next: nextLevel(o, settlement.tier, discMult),
    workers: o.workers || [], garrison: o.garrison || [], haulers: o.haulers || [],
    worker_slots: workerSlots(o), hauler_slots: OS.HAULER_SLOTS,
    store: OS.present(o), rates: OS.ratesFor(o, done), hauls, trip,
    buildings: OB.present(o, discMult),
    settings: { haul_filter: OS.filterOf(o), haul_threshold: Number(o.haul_threshold) || 0 },
    road: require('../lib/outpost_roads').present(o, trip ? trip.tiles : 1, discMult),
    events: await require('../lib/outpost_events').openFor(settlement.id, o.id),
    on_clan_land: !!o.on_clan_land,
    fort: { level: lvl, name: lvl ? D.FORT[lvl].name : null, icon: lvl ? D.FORT[lvl].icon : null, defence: def.fort, slots: lvl ? D.FORT[lvl].slots : 0, next },
    defence: { own: def.own, fort: def.fort, garrison: def.garrison },
  };
}
// Workers an outpost has room for: its level, plus a Bunkhouse.
const workerSlots = o => Math.max(1, Number(o.level) || 1) + Math.round((o.bfx && o.bfx.worker_slots) || 0);
const presentById = async (settlement, id) => present(settlement, (await outpostState.load(null, settlement)).find(x => x.id === id));

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
  const [sRes, uRes, bRes, cRows] = await Promise.all([
    query(`SELECT ${require('../lib/resource_defs').KEYS.join(', ')} FROM settlements WHERE id=$1`, [settlementId]),
    query('SELECT species FROM users WHERE id=$1', [userId]),
    query('SELECT type, level FROM buildings WHERE settlement_id=$1', [settlementId]),
    require('../lib/careers').loadWorkforce(null, settlementId).catch(async () =>
      (await query("SELECT role FROM citizens WHERE settlement_id=$1 AND COALESCE(life_stage, 'adult') = 'adult'", [settlementId])).rows),
  ]);
  const { calculateRates } = require('../buildings');
  const { getCurrentSeason, applySeasonModifiers } = require('../seasons');
  const species = uRes.rows[0]?.species || 'Mice';
  // Outposts fill their own stores (lib/outpost_store), not the town's rates.
  const baseRates = calculateRates(bRes.rows, cRows, species, [], { research: await require('../lib/research').doneSet(null, settlementId) });
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
    let settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    // Porters home, stores up to now, idle haulers out (lib/outpost_store).
    await OS.sync(settlement);
    settlement = await loadUserSettlement(req.user.userId);

    const oRes = { rows: await outpostState.load(null, settlement) };   // annotated: worker, unfed, raided

    const tier = settlement.tier || 'camp';
    const mult = (await require('./buildings').buildDiscount(settlement.id)).mult;
    res.json({
      ok: true,
      outposts: await Promise.all(oRes.rows.map(o => present(settlement, o, mult))),
      used: oRes.rows.length,
      cap: capForTier(tier),
      range: rangeForTier(tier),
      tier,
      cost: OUTPOST_COST,
      claim_cost: CLAIM_COST,
      upkeep_food_per_hr: OUTPOST_FOOD_UPKEEP_PER_HR,
      unfed: !!settlement.outposts_unfed_since,
      worker_bonus: { base: outpostState.WORKER_BONUS, fit: outpostState.FIT_BONUS, fit_class: outpostState.FIT },
      store_per_level: OS.STORE_PER_LEVEL,
      haul: { seconds_per_tile: OS.SECONDS_PER_TILE, min_leg_seconds: OS.MIN_LEG_SECONDS, porter_carry: require('../lib/market').PORTER_CARRY },
      resources: (await freshResourcesAndRates(settlement.id, req.user.userId)).resources,
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
    res.json({ ok: true, outpost: await present(settlement, up, mult), spent: next.cost, resources, rates });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[outposts] upgrade', err);
    res.status(500).json({ error: 'Failed to upgrade the outpost.' });
  } finally {
    client.release();
  }
});

// Crew leaving a post walk home (haulers live in town between runs). Anyone
// still on the way out turns round where they are.
async function walkHome(settlement, outpostId, rows, db = null) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const o = (await run('SELECT * FROM outposts WHERE id=$1', [outpostId])).rows[0];
  if (!o) return;
  for (const c of rows || []) {
    if (c.post === 'hauler') continue;
    const out = (await run("UPDATE outpost_hauls SET status = 'done' WHERE citizen_id=$1 AND kind = 'post' AND status IN ('outbound','returning') RETURNING departs_at", [c.citizen_id])).rows[0];
    const leg = out ? Date.now() - new Date(out.departs_at).getTime() : null;
    try { await OS.startWalk(db, settlement, o, { id: c.citizen_id }, 'return', leg); } catch (e) { if (e.code !== '23505') throw e; }
  }
}

// ── POST /:id/assign — post a citizen: { citizen_id, post: worker|garrison|hauler }
// Workers: up to the outpost's level. Garrison: Guards and Archers, up to the
// fort's slots (lib/defences FORT). Hauler: OS.HAULER_SLOTS, any adult; they
// set straight off for the store. One post per citizen (outpost_crew PK).
router.post('/:id/assign', requireAuth, async (req, res) => {
  try {
    const D = require('../lib/defences');
    const id = parseInt(req.params.id, 10), cid = parseInt(req.body && req.body.citizen_id, 10);
    const post = ['garrison', 'hauler'].includes(req.body && req.body.post) ? req.body.post : 'worker';
    if (!Number.isFinite(id) || !Number.isFinite(cid)) return res.status(400).json({ error: 'outpost id and citizen_id required.' });
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const o = (await query('SELECT * FROM outposts WHERE id=$1 AND settlement_id=$2', [id, settlement.id])).rows[0];
    if (!o) return res.status(404).json({ error: 'Outpost not found.' });
    const c = (await query('SELECT id, name, settlement_id, life_stage, role FROM citizens WHERE id=$1', [cid])).rows[0];
    const here = (await query('SELECT post FROM outpost_crew WHERE citizen_id=$1 AND outpost_id=$2', [cid, id])).rows[0];
    if (here) return res.status(400).json({ error: here.post === post ? 'They are already posted here.' : 'They already have a post here.' });
    const why = await outpostState.busyReason(c, settlement.id);
    if (why) return res.status(400).json({ error: why });
    if (post === 'garrison' && !D.GARRISON_ROLES.includes(c.role)) return res.status(400).json({ error: 'Only Guards and Archers can garrison an outpost.' });
    const n = (await query('SELECT COUNT(*)::int AS n FROM outpost_crew WHERE outpost_id=$1 AND post=$2', [id, post])).rows[0].n;
    o.bfx = await OB.fxFor(o.id);
    const cap = post === 'garrison' ? ((D.FORT[Number(o.fort_level) || 0] || {}).slots || 0) : post === 'hauler' ? OS.HAULER_SLOTS : workerSlots(o);
    if (n >= cap) return res.status(400).json({ error: post === 'garrison'
      ? (cap ? `The ${D.FORT[o.fort_level].name} holds ${cap} — raise the fort for more.` : 'Build a palisade first — there is nowhere for a garrison to stand.')
      : post === 'hauler' ? 'This outpost already has its hauler.'
      : `This outpost has room for ${cap} worker${cap === 1 ? '' : 's'}${o.bfx.worker_slots ? '' : ' — a Bunkhouse makes room for one more'}.` });
    // Workers and garrison walk out first (a hauler's first run is their walk).
    const leg = post === 'hauler' ? 0 : (await OS.tripFor(null, settlement, o, c)).leg * 1000;
    const r = await query(`INSERT INTO outpost_crew (citizen_id, outpost_id, post, arrives_at) VALUES ($1,$2,$3, ${leg ? 'NOW() + make_interval(secs => $4)' : 'NULL'})
                           ON CONFLICT DO NOTHING RETURNING citizen_id`, leg ? [cid, id, post, leg / 1000] : [cid, id, post]);
    if (!r.rows.length) return res.status(409).json({ error: `${c.name} already has a post at an outpost.` });
    if (leg) await OS.startWalk(null, settlement, o, c, 'post', leg);
    if (post === 'hauler') await OS.sync(settlement);   // off to the store right away
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outpost: await presentById(settlement, id), resources, rates });
  } catch (err) {
    console.error('[outposts] assign', err);
    res.status(500).json({ error: 'Failed to post the citizen.' });
  }
});

// ── POST /:id/unassign — { citizen_id } home (no citizen_id: everyone) ─────
router.post('/:id/unassign', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10), cid = parseInt(req.body && req.body.citizen_id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad outpost id.' });
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const own = (await query('SELECT id FROM outposts WHERE id=$1 AND settlement_id=$2', [id, settlement.id])).rows[0];
    if (!own) return res.status(404).json({ error: 'Outpost not found.' });
    const gone = Number.isFinite(cid)
      ? (await query('DELETE FROM outpost_crew WHERE outpost_id=$1 AND citizen_id=$2 RETURNING *', [id, cid])).rows
      : (await query("DELETE FROM outpost_crew WHERE outpost_id=$1 AND post='worker' RETURNING *", [id])).rows;
    await walkHome(settlement, id, gone);
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outpost: await presentById(settlement, id), resources, rates });
  } catch (err) {
    console.error('[outposts] unassign', err);
    res.status(500).json({ error: 'Failed to bring them home.' });
  }
});

// ── POST /:id/haul — { citizen_id } one porter run to the outpost and back ──
// They walk out, load up to their carry weight from its store and bring it
// home to the town's stores (lib/outpost_store).
router.post('/:id/haul', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10), cid = parseInt(req.body && req.body.citizen_id, 10);
    if (!Number.isFinite(id) || !Number.isFinite(cid)) return res.status(400).json({ error: 'outpost id and citizen_id required.' });
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    await OS.sync(settlement);
    const o = (await query('SELECT * FROM outposts WHERE id=$1 AND settlement_id=$2', [id, settlement.id])).rows[0];
    if (!o) return res.status(404).json({ error: 'Outpost not found.' });
    const c = (await query('SELECT id, name, settlement_id, life_stage, role FROM citizens WHERE id=$1', [cid])).rows[0];
    const why = await outpostState.busyReason(c, settlement.id);
    if (why) return res.status(400).json({ error: why });
    if (!Object.values(OS.storeOf(o)).some(v => v >= 1)) return res.status(400).json({ error: 'Its store is empty — nothing to carry yet.' });
    if (!Object.values(OS.wanted(o)).some(v => v >= 1)) return res.status(400).json({ error: 'Nothing in the store that porters are set to carry (see its haul settings).' });
    let haul;
    try { haul = await OS.startHaul(null, settlement, o, c, false); }
    catch (e) { if (e.code === '23505') return res.status(409).json({ error: `${c.name} is already on the road.` }); throw e; }
    res.json({ ok: true, haul: { id: haul.id, name: c.name, arrives_at: haul.arrives_at, returns_at: haul.returns_at, carry: Number(haul.carry) }, outpost: await presentById(settlement, id) });
  } catch (err) {
    console.error('[outposts] haul', err);
    res.status(500).json({ error: 'Failed to send the porter.' });
  }
});

// ── POST /:id/buildings — { key } raise a building inside the outpost ──────
router.post('/:id/buildings', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10), key = String((req.body && req.body.key) || '');
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad outpost id.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settlement = (await client.query('SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [req.user.userId])).rows[0];
    const o = settlement && (await client.query('SELECT * FROM outposts WHERE id=$1 AND settlement_id=$2 FOR UPDATE', [id, settlement.id])).rows[0];
    const fail = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };
    if (!o) return fail(404, 'Outpost not found.');
    if (!OB.DEFS[key]) return fail(400, 'No such building.');
    const onLand = OB.DEFS[key] && OB.DEFS[key].clan ? await require('../lib/clan_treasury').onClanLand(client, req.user.userId, o.tile_q, o.tile_r) : true;
    if (OB.DEFS[key] && OB.DEFS[key].clan && !onLand) return fail(400, `A ${OB.DEFS[key].name} can only stand on your clan's land.`);
    if (!OB.allowed(key, o.terrain, onLand)) return fail(400, `A ${OB.DEFS[key].name} doesn't belong on this land.`);
    const have = (await client.query('SELECT key FROM outpost_buildings WHERE outpost_id=$1', [id])).rows.map(r => r.key);
    if (have.includes(key)) return fail(400, `It already has a ${OB.DEFS[key].name}.`);
    const slots = OB.slotsFor(o.level);
    if (have.length >= slots) return fail(400, `No room: a level ${o.level || 1} outpost has ${slots} building plots. Upgrade it, or pull something down.`);
    const mult = (await require('./buildings').buildDiscount(settlement.id)).mult;
    const cost = OB.costOf(key, mult);
    for (const [r, v] of Object.entries(cost)) if (v > (Number(settlement[r]) || 0)) return fail(400, `Not enough ${RD.label(r).toLowerCase()}. Need ${v}.`);
    const keys = Object.keys(cost).filter(r => RD.isResource(r) && cost[r] > 0);
    await client.query(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} - $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(r => cost[r]), settlement.id]);
    const hours = OB.DEFS[key].hours * mult;
    await client.query('INSERT INTO outpost_buildings (outpost_id, key, ready_at) VALUES ($1, $2, NOW() + make_interval(secs => $3))', [id, key, Math.round(hours * 3600)]);
    await client.query('COMMIT');
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outpost: await presentById(settlement, id), spent: cost, resources, rates });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[outposts] build', err);
    res.status(500).json({ error: 'Failed to build.' });
  } finally {
    client.release();
  }
});

// ── DELETE /:id/buildings/:key — pull it down (frees the plot) ─────────────
router.delete('/:id/buildings/:key', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const own = (await query('SELECT id FROM outposts WHERE id=$1 AND settlement_id=$2', [id, settlement.id])).rows[0];
    if (!own) return res.status(404).json({ error: 'Outpost not found.' });
    const r = await query('DELETE FROM outpost_buildings WHERE outpost_id=$1 AND key=$2 RETURNING key', [id, String(req.params.key)]);
    if (!r.rows.length) return res.status(404).json({ error: 'No such building here.' });
    res.json({ ok: true, outpost: await presentById(settlement, id) });
  } catch (err) {
    console.error('[outposts] pull down', err);
    res.status(500).json({ error: 'Failed to pull it down.' });
  }
});

// ── PATCH /:id/settings — { haul_filter: [res]|null, haul_threshold: % } ───
// What porters bring home from here, and how full the store gets before a
// standing hauler sets out (0 = whenever there's anything).
router.patch('/:id/settings', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const own = (await query('SELECT id FROM outposts WHERE id=$1 AND settlement_id=$2', [id, settlement.id])).rows[0];
    if (!own) return res.status(404).json({ error: 'Outpost not found.' });
    const b = req.body || {};
    if ('haul_filter' in b) {
      const f = Array.isArray(b.haul_filter) ? [...new Set(b.haul_filter.map(String).filter(k => RD.isResource(k)))] : null;
      await query('UPDATE outposts SET haul_filter = $2 WHERE id = $1', [id, f && f.length ? JSON.stringify(f) : null]);
    }
    if ('haul_threshold' in b) {
      const t = Math.round(Number(b.haul_threshold));
      if (![0, 25, 50, 75, 90].includes(t)) return res.status(400).json({ error: 'Threshold must be 0, 25, 50, 75 or 90.' });
      await query('UPDATE outposts SET haul_threshold = $2 WHERE id = $1', [id, t]);
    }
    await OS.sync(settlement);
    res.json({ ok: true, outpost: await presentById(settlement, id) });
  } catch (err) {
    console.error('[outposts] settings', err);
    res.status(500).json({ error: 'Failed to save.' });
  }
});

// ── POST /:id/road — lay the next stretch of road (Track, then Paved) ──────
router.post('/:id/road', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad outpost id.' });
  const client = await pool.connect();
  try {
    const ROADS = require('../lib/outpost_roads');
    await client.query('BEGIN');
    const settlement = (await client.query('SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [req.user.userId])).rows[0];
    const o = settlement && (await client.query('SELECT * FROM outposts WHERE id=$1 AND settlement_id=$2 FOR UPDATE', [id, settlement.id])).rows[0];
    const fail = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };
    if (!o) return fail(404, 'Outpost not found.');
    if (ROADS.levelOf(o) < (Number(o.road_level) || 0)) return fail(400, 'The road crew are still at work.');
    const { W, H } = await loadWorldDims();
    const tiles = settlement.tile_q == null ? 1 : hexDistWrapped(settlement.tile_q, settlement.tile_r, o.tile_q, o.tile_r, W, H);
    const mult = (await require('./buildings').buildDiscount(settlement.id)).mult;
    const next = ROADS.nextOf(o, tiles, mult);
    if (!next) return fail(400, 'It already has a paved road all the way.');
    for (const [r, v] of Object.entries(next.cost)) if (v > (Number(settlement[r]) || 0)) return fail(400, `Not enough ${RD.label(r).toLowerCase()}. Need ${v}.`);
    const keys = Object.keys(next.cost);
    await client.query(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} - $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(r => next.cost[r]), settlement.id]);
    await client.query('UPDATE outposts SET road_level = $2, road_ready_at = NOW() + make_interval(secs => $3) WHERE id = $1', [id, next.level, Math.round(next.hours * 3600)]);
    await client.query('COMMIT');
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outpost: await presentById(settlement, id), spent: next.cost, resources, rates });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[outposts] road', err);
    res.status(500).json({ error: 'Failed to lay the road.' });
  } finally {
    client.release();
  }
});

// ── POST /:id/events/:eid — { choice } answer something that happened ──────
router.post('/:id/events/:eid', requireAuth, async (req, res) => {
  try {
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const r = await require('../lib/outpost_events').choose(settlement.id, parseInt(req.params.eid, 10), String((req.body && req.body.choice) || ''));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outcome: r.outcome, joined: r.joined, outpost: await presentById(settlement, parseInt(req.params.id, 10)).catch(() => null), resources, rates });
  } catch (err) {
    console.error('[outposts] event', err);
    res.status(500).json({ error: 'Failed.' });
  }
});

// ── POST /:id/help — { citizen_id } a clanmate's porter fetches from this
// outpost; the goods go to its owner. Owner and helper must share a clan.
router.post('/:id/help', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10), cid = parseInt(req.body && req.body.citizen_id, 10);
    if (!Number.isFinite(id) || !Number.isFinite(cid)) return res.status(400).json({ error: 'outpost id and citizen_id required.' });
    const me = await loadUserSettlement(req.user.userId);
    if (!me) return res.status(404).json({ error: 'No settlement.' });
    const o = (await query('SELECT o.*, s.user_id AS owner_user_id, s.name AS owner_name FROM outposts o JOIN settlements s ON s.id = o.settlement_id WHERE o.id=$1', [id])).rows[0];
    if (!o) return res.status(404).json({ error: 'Outpost not found.' });
    if (o.settlement_id === me.id) return res.status(400).json({ error: 'It\'s your own outpost — send a porter from its window.' });
    const same = (await query(`SELECT 1 FROM clan_members a JOIN clan_members b ON a.clan_id = b.clan_id WHERE a.user_id = $1 AND b.user_id = $2`, [req.user.userId, o.owner_user_id]).catch(() => ({ rows: [] }))).rows.length;
    if (!same) return res.status(403).json({ error: 'Only clanmates can help carry from someone\'s outpost.' });
    const c = (await query('SELECT id, name, settlement_id, life_stage, role FROM citizens WHERE id=$1', [cid])).rows[0];
    const why = await outpostState.busyReason(c, me.id);
    if (why) return res.status(400).json({ error: why });
    if (!Object.values(OS.wanted(o)).some(v => v >= 1)) return res.status(400).json({ error: 'Its store has nothing to carry.' });
    let haul;
    try { haul = await OS.startHaul(null, me, o, c, false, Date.now(), o.settlement_id); }
    catch (e) { if (e.code === '23505') return res.status(409).json({ error: `${c.name} is already on the road.` }); throw e; }
    res.json({ ok: true, haul: { id: haul.id, name: c.name, owner: o.owner_name, arrives_at: haul.arrives_at, returns_at: haul.returns_at, carry: Number(haul.carry) } });
  } catch (err) {
    console.error('[outposts] help', err);
    res.status(500).json({ error: 'Failed to send help.' });
  }
});

// ── Dev Tools (admins): finish things, fill stores, start an event ─────────
const { requireAdmin } = require('../middleware/admin');
router.post('/admin/:action', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settlement = await loadUserSettlement(req.user.userId);
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const sid = settlement.id, act = req.params.action, b = req.body || {};
    const mine = 'SELECT id FROM outposts WHERE settlement_id = $1';
    let msg = 'Done.';
    if (act === 'finish') {
      const a = await query(`UPDATE outpost_buildings SET ready_at = NOW() WHERE outpost_id IN (${mine}) AND ready_at > NOW()`, [sid]);
      const r2 = await query(`UPDATE outposts SET road_ready_at = NOW() WHERE settlement_id = $1 AND road_ready_at > NOW()`, [sid]);
      msg = `${a.rowCount} building(s) and ${r2.rowCount} road(s) finished.`;
    } else if (act === 'arrive') {
      const a = await query(`UPDATE outpost_crew SET arrives_at = NULL WHERE outpost_id IN (${mine}) AND arrives_at IS NOT NULL`, [sid]);
      await query(`UPDATE outpost_hauls SET arrives_at = LEAST(arrives_at, NOW()), returns_at = LEAST(returns_at, NOW()) WHERE settlement_id = $1 AND kind IN ('post','return') AND status IN ('outbound','returning')`, [sid]);
      msg = `${a.rowCount} crew member(s) arrived.`;
    } else if (act === 'porters') {
      const a = await query(`UPDATE outpost_hauls SET arrives_at = LEAST(arrives_at, NOW() - interval '2 seconds'), returns_at = LEAST(returns_at, NOW() - interval '1 second') WHERE settlement_id = $1 AND status IN ('outbound','returning')`, [sid]);
      msg = `${a.rowCount} run(s) brought home.`;
    } else if (act === 'fill') {
      for (const o of await outpostState.load(null, settlement)) {
        const cap = OS.capOf(o), keys = Object.keys(OS.ratesFor(o, new Set()));
        if (keys.length) await query(`UPDATE outposts SET store = COALESCE(store, '{}'::jsonb) || jsonb_build_object(${keys.map(k => `'${k}', ${cap}::float8`).join(', ')}) WHERE id = $1`, [o.id]);
      }
      msg = 'Every outpost store is full.';
    } else if (act === 'event') {
      const list = await outpostState.load(null, settlement);
      const o = list.find(x => x.id === Number(b.outpost_id)) || list[0];
      if (!o) return res.status(400).json({ error: 'No outposts.' });
      await query('UPDATE outpost_events SET resolved_at = NOW(), outcome = $2 WHERE outpost_id = $1 AND resolved_at IS NULL', [o.id, 'Cleared by Dev Tools']);
      const KINDS = require('../lib/outpost_events').KINDS;
      const kind = b.kind && KINDS[b.kind] ? b.kind : null;
      const e = await require('../lib/outpost_events').start(o, settlement, kind);
      if (!e) return res.status(400).json({ error: 'That event can\'t happen there right now (a trader needs something in the store).' });
      msg = `${e.icon} ${e.title} at the ${o.name || 'outpost'}.`;
    } else if (act === 'events-clear') {
      const a = await query(`UPDATE outpost_events SET resolved_at = NOW(), outcome = 'Cleared by Dev Tools' WHERE settlement_id = $1 AND resolved_at IS NULL`, [sid]);
      msg = `${a.rowCount} event(s) cleared.`;
    } else return res.status(404).json({ error: 'Unknown action.' });
    await OS.sync(settlement);
    res.json({ ok: true, message: msg });
  } catch (err) {
    console.error('[outposts] admin', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/fortify — the next fort level (Palisade → Stockade → Stone Tower)
router.post('/:id/fortify', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad outpost id.' });
  const client = await pool.connect();
  try {
    const D = require('../lib/defences');
    await client.query('BEGIN');
    const settlement = (await client.query('SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [req.user.userId])).rows[0];
    const o = settlement && (await client.query('SELECT * FROM outposts WHERE id=$1 AND settlement_id=$2 FOR UPDATE', [id, settlement.id])).rows[0];
    const fail = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };
    if (!o) return fail(404, 'Outpost not found.');
    const nl = (Number(o.fort_level) || 0) + 1;
    if (!D.FORT[nl]) return fail(400, 'Its stone tower is as strong as an outpost fort gets.');
    const done = await require('../lib/research').doneSet(null, settlement.id);
    const RS = require('../lib/research_defs');
    if (D.fortAllowed(RS.effectsOf(done)) < nl) return fail(400, `A ${D.FORT[nl].name} needs ${RS.labelFor(FORT_RESEARCH[nl], done)} — study it at a Library first.`);
    const mult = (await require('./buildings').buildDiscount(settlement.id)).mult;
    const cost = Object.fromEntries(Object.entries(D.FORT[nl].cost).map(([r, v]) => [r, Math.ceil(v * mult)]));
    for (const [r, v] of Object.entries(cost)) if (v > (Number(settlement[r]) || 0)) return fail(400, `Not enough ${RD.label(r).toLowerCase()}. Need ${v}.`);
    const keys = Object.keys(cost).filter(r => RD.isResource(r) && cost[r] > 0);
    await client.query(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} - $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(r => cost[r]), settlement.id]);
    await client.query('UPDATE outposts SET fort_level = $2 WHERE id = $1', [id, nl]);
    await client.query('COMMIT');
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({ ok: true, outpost: await presentById(settlement, id), spent: cost, resources, rates });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[outposts] fortify', err);
    res.status(500).json({ error: 'Failed to fortify the outpost.' });
  } finally {
    client.release();
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
      'DELETE FROM outposts WHERE id=$1 AND settlement_id=$2 RETURNING tile_q, tile_r, level, store',
      [id, settlement.id]
    );
    if (!oRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Outpost not found.' }); }

    const { tile_q, tile_r, level } = oRes.rows[0];
    // The crew carry whatever was stored home with them.
    const carried = Object.fromEntries(Object.entries(OS.storeOf(oRes.rows[0])).map(([k, v]) => [k, Math.floor(v)]).filter(([, v]) => v > 0));
    const ck = Object.keys(carried);
    if (ck.length) await client.query(`UPDATE settlements SET ${ck.map((r, i) => `${r} = ${r} + $${i + 1}`).join(', ')} WHERE id = $${ck.length + 1}`, [...ck.map(r => carried[r]), settlement.id]);
    // The crew walk home from the empty tile; its buildings come down with it.
    const crewRows = (await client.query('DELETE FROM outpost_crew WHERE outpost_id=$1 RETURNING *', [id])).rows;
    await client.query('DELETE FROM outpost_buildings WHERE outpost_id=$1', [id]);
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
    for (const c of crewRows) {
      if (c.post === 'hauler') continue;
      await query("UPDATE outpost_hauls SET status = 'done' WHERE citizen_id=$1 AND kind = 'post' AND status IN ('outbound','returning')", [c.citizen_id]).catch(() => {});
      await OS.startWalk(null, settlement, { id, tile_q, tile_r, bfx: {} }, { id: c.citizen_id }, 'return').catch(() => {});
    }

    const cnt = await query('SELECT COUNT(*)::int AS n FROM outposts WHERE settlement_id=$1', [settlement.id]);
    const { resources, rates } = await freshResourcesAndRates(settlement.id, req.user.userId);
    res.json({
      ok: true,
      removed: { tile_q, tile_r },
      refund,
      carried,
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
