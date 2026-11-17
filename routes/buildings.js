const express = require('express');
const { query, withTransaction } = require('../db');
const CN = require('../lib/construction');
const RD = require('../lib/resource_defs');
const RS = require('../lib/research_defs');
const requireAuth = require('../middleware/auth');
const { BUILDINGS, TIER_ORDER, calculateRates } = require('../buildings');

// Building-cost discounts: research (Masonry, Engineering, Architecture) and the best Stonemason's
// perks. → { mult, parts: [{ label, pct }] }
// Capped at −20% in all.
const MAX_BUILD_DISCOUNT = 0.2;
async function buildDiscount(sid, done) {
  const parts = [];
  const r = RS.effectsOf(done || await require('../lib/research').doneSet(null, sid)).build_cost || 0;
  if (r) parts.push({ label: 'Research', pct: r });
  // The town's best Stonemason (careers build_cost perks): theirs alone counts.
  const wf = await require('../lib/careers').loadWorkforce(null, sid).catch(() => []);
  let best = null;
  for (const c of wf) {
    const v = c.profile && c.profile.effects ? Number(c.profile.effects.build_cost) || 0 : 0;
    if (v < 0 && (!best || v < best.pct)) best = { label: `Stonemason ${c.name}`, pct: v };
  }
  if (best) parts.push(best);
  const total = Math.max(-MAX_BUILD_DISCOUNT, parts.reduce((a, p) => a + p.pct, 0));
  return { mult: 1 + total, parts };
}
// Base cost × level, plus that level's levelCost extras (ores and alloys, not scaled
// by level), all less any discount.
function scaledCost(def, level, mult) {
  const out = Object.fromEntries(Object.entries(def.cost).map(([r, v]) => [r, Math.ceil(v * level * mult)]));
  for (const [r, v] of Object.entries((def.levelCost && def.levelCost[level]) || {})) out[r] = (out[r] || 0) + Math.ceil(v * mult);
  return out;
}

// True when a settlement at `tier` may build `def` (its optional minTier).
function tierMetFor(def, tier) {
  if (!def.minTier) return true;
  return TIER_ORDER.indexOf(tier || 'camp') >= TIER_ORDER.indexOf(def.minTier);
}
// Tier needed to build `level` of def (levelTierReq), or null.
function levelTierFor(def, level) {
  return (def.levelTierReq && def.levelTierReq[level]) || null;
}
function levelTierMet(def, level, tier) {
  const need = levelTierFor(def, level);
  return !need || TIER_ORDER.indexOf(tier || 'camp') >= TIER_ORDER.indexOf(need);
}
const tierLabel = t => t.charAt(0).toUpperCase() + t.slice(1);

const router = express.Router();

// Get all buildings for player's settlement + what can be built
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT *, tile_q, tile_r FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    const userRes = await query('SELECT species FROM users WHERE id=$1', [req.user.userId]);
    const species = userRes.rows[0]?.species || 'Mice';

    const buildingsRes = await query(
      'SELECT * FROM buildings WHERE settlement_id=$1', [settlement.id]
    );
    const built = buildingsRes.rows;

    // Map built buildings (housing: count rows, others: use single row)
    const builtMap = {};
    const housingCounts = {};
    for (const b of built) {
      if (BUILDINGS[b.type]?.isHousing) {
        housingCounts[b.type] = (housingCounts[b.type] || 0) + 1;
        if (!builtMap[b.type]) builtMap[b.type] = b; // keep first row as sentinel
      } else {
        builtMap[b.type] = b;
      }
    }

    // Finished research (a building can need a project: the Smelter).
    const done = await require('../lib/research').doneSet(null, settlement.id);
    const discount = await buildDiscount(settlement.id, done);
    // Building time (lib/construction.js): what the builders are working on.
    const queue = await CN.queue(settlement.id).catch(() => ({ on: false, sites: [] }));
    const siteOf = id => queue.sites.find(x => x.type === id && x.kind !== 'house') || null;
    const homesGoing = queue.sites.filter(x => x.kind === 'house').length;

    // Determine what can be built / upgraded
    const available = Object.values(BUILDINGS).map(def => {
      const existing = builtMap[def.id];
      // For housing, currentLevel = number of houses built; for others = building level
      const currentLevel = def.isHousing
        ? (housingCounts[def.id] || 0)
        : (existing ? existing.level : 0);
      // Homes: as many as the tier's plots (a town with more keeps them).
      const maxLevel = def.isHousing ? Math.max(currentLevel, (def.tierCaps && def.tierCaps[settlement.tier || 'camp']) || def.maxLevel) : def.maxLevel;
      // Being built or upgraded already: nothing more to order until it is done.
      const site = def.isHousing ? null : siteOf(def.id);
      const canUpgrade = currentLevel + (def.isHousing ? homesGoing : 0) < maxLevel && !site;

      // Check requirements met
      const requiresMet = def.requires.every(req => builtMap[req]);
      const tierMet = tierMetFor(def, settlement.tier);
      const nextLevelTier = canUpgrade ? levelTierFor(def, currentLevel + 1) : null;
      const nextLevelTierMet = !canUpgrade || levelTierMet(def, currentLevel + 1, settlement.tier);

      // Scale cost with level, less any discount (Engineering…)
      const cost = scaledCost(def, currentLevel + (def.isHousing ? homesGoing : 0) + 1, discount.mult);

      return {
        id: def.id,
        label: def.label,
        desc: def.desc,
        icon: def.icon,
        imgFile: def.imgFile || null,
        currentLevel,
        maxLevel,
        canUpgrade,
        requiresMet,
        tierMet,
        research: def.research || null,
        researchLabel: def.research ? RS.labelFor(def.research, done) : null,
        researchMet: !def.research || done.has(def.research),
        minTier: def.minTier || null,
        nextLevelTier,
        nextLevelTierMet,
        nextLevelResearch: canUpgrade && def.levelResearch && def.levelResearch[currentLevel + 1] ? RS.labelFor(def.levelResearch[currentLevel + 1], done) : null,
        nextLevelResearchMet: !(canUpgrade && def.levelResearch && def.levelResearch[currentLevel + 1]) || done.has(def.levelResearch[currentLevel + 1]),
        levelTierReq: def.levelTierReq || null,
        cost,
        discount: discount.parts.length ? discount.parts : null,
        effect: def.effect(Math.max(1, currentLevel)),
        nextEffect: canUpgrade ? def.effect(currentLevel + 1) : null,
        citizenSlots: def.citizenSlots(Math.max(1, currentLevel)),
        site: site ? { id: site.id, kind: site.kind, level: site.level, pct: site.pct, eta_minutes: site.eta_minutes } : null,
        building: def.isHousing ? homesGoing : 0,
        work: queue.on && canUpgrade ? CN.workFor(def.isHousing ? 'house' : currentLevel > 0 ? 'upgrade' : 'building', def.id, currentLevel + 1, require('../lib/tuning').T('build_work')) : null,
      };
    });

    res.json({ ok: true, buildings: available, builtIds: Object.keys(builtMap),
      construction: { on: queue.on, waiting: !!queue.waiting, builders: (queue.builders || []).length, queued: queue.sites.length, max: queue.max } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch buildings.' });
  }
});

// Construct or upgrade a building
router.post('/build', requireAuth, async (req, res) => {
  try {
    const { buildingId } = req.body;
    const def = BUILDINGS[buildingId];
    if (!def) return res.status(400).json({ error: 'Unknown building.' });

    const settlementRes = await query(
      'SELECT *, tile_q, tile_r FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // A home goes on a plot in the Neighbourhood (lib/neighbourhoods.js): the
    // first free one the town's tier has opened. Its own rules, cost and all.
    if (def.isHousing) {
      const N = require('../lib/neighbourhoods');
      try {
        const out = await N.place(settlement.id, {});
        const count = (await query('SELECT COUNT(*)::int AS n FROM houses WHERE settlement_id=$1 AND building_type=$2', [settlement.id, buildingId])).rows[0].n;
        if (out.queued) return res.json({ ok: true, building: buildingId, newLevel: count, cost: out.cost, queued: true, site: out.site, ...(await crewNote(settlement.id)) });
        return res.json({ ok: true, building: buildingId, newLevel: count, cost: out.cost, house: out.house });
      } catch (e) {
        if (e instanceof N.HouseError) return res.status(e.status).json({ error: e.message });
        throw e;
      }
    }

    const doneSet = await require('../lib/research').doneSet(null, settlement.id);
    const discount = (await buildDiscount(settlement.id, doneSet)).mult;
    const fail = (msg, status = 400) => Object.assign(new Error(msg), { status, said: true });

    // One transaction under the settlement's row lock: two presses (or two
    // devices) cannot both pay, and the level cannot be raised twice.
    const out = await withTransaction(async c => {
      const q = (t, p) => c.query(t, p);
      const st = (await q('SELECT * FROM settlements WHERE id=$1 FOR UPDATE', [settlement.id])).rows[0];
      const existing = (await q('SELECT * FROM buildings WHERE settlement_id=$1 AND type=$2', [st.id, buildingId])).rows[0];
      const currentLevel = existing ? existing.level : 0;

      if (!tierMetFor(def, st.tier)) throw fail(`Requires a ${tierLabel(def.minTier)} settlement.`);
      if (currentLevel >= def.maxLevel) throw fail('Already at max level.');
      if (!levelTierMet(def, currentLevel + 1, st.tier))
        throw fail(`Level ${currentLevel + 1} ${def.label} requires a ${tierLabel(levelTierFor(def, currentLevel + 1))} settlement.`);
      if (def.research && !doneSet.has(def.research)) throw fail(`Study ${RS.labelFor(def.research, doneSet)} at a Library first.`);
      // Some levels need more research than the building itself (Walls 3+).
      const lvlRes = def.levelResearch && def.levelResearch[currentLevel + 1];
      if (lvlRes && !doneSet.has(lvlRes)) throw fail(`Level ${currentLevel + 1} ${def.label} needs ${RS.labelFor(lvlRes, doneSet)} — study it at a Library first.`);
      // What it needs must be standing (a site does not count).
      for (const need of def.requires) {
        if (!(await q('SELECT id FROM buildings WHERE settlement_id=$1 AND type=$2', [st.id, need])).rows.length)
          throw fail(`Requires ${BUILDINGS[need]?.label || need} first.`);
      }

      // Scale cost by level, less any discount (Engineering…)
      const cost = scaledCost(def, currentLevel + 1, discount);
      for (const [r, v] of Object.entries(cost)) {
        if (!RD.isResource(r)) continue;
        if (v > (Number(st[r]) || 0)) throw fail(`Not enough ${RD.label(r).toLowerCase()}. Need ${v}.`);
      }
      const costKeys = Object.keys(cost).filter(r => RD.isResource(r) && cost[r] > 0);
      if (costKeys.length) await q(
        `UPDATE settlements SET ${costKeys.map((r, i) => `${r} = ${r} - $${i + 1}`).join(', ')} WHERE id = $${costKeys.length + 1}`,
        [...costKeys.map(r => cost[r]), st.id]);

      // Building time: paying starts a site, and the builders do the rest.
      if (await CN.enabled(st)) {
        const site = await CN.order(q, st, { kind: existing ? 'upgrade' : 'building', type: buildingId, level: currentLevel + 1, cost });
        return { cost, currentLevel, site };
      }
      if (existing) await q('UPDATE buildings SET level=$1 WHERE id=$2', [currentLevel + 1, existing.id]);
      else await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,1)', [st.id, buildingId]);
      await CN.built(q, st, buildingId, currentLevel + 1);   // a Scout Post lifts the fog
      return { cost, currentLevel };
    });

    if (out.site) {
      try { require('../lib/event_bus').publish(settlement.id, { type: 'construction', what: 'queue' }); } catch (_) { /* no stream */ }
      return res.json({ ok: true, building: buildingId, newLevel: out.currentLevel, cost: out.cost, queued: true,
        site: { id: out.site.id, kind: out.site.kind, level: out.site.level, work_needed: Number(out.site.work_needed) }, ...(await crewNote(settlement.id)) });
    }
    res.json({ ok: true, building: buildingId, newLevel: out.currentLevel + 1, cost: out.cost });
  } catch (err) {
    if (err && err.said) return res.status(err.status || 400).json({ error: err.message });
    if (err instanceof CN.SiteError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Construction failed.' });
  }
});
// With a site ordered: is anyone there to build it? (The client says so at
// once when nobody is: docs/HOME_SCENE.md D.5.)
async function crewNote(sid) {
  const crew = await CN.builders(sid).catch(() => []);
  return { builders: crew.length, no_builder: crew.length === 0 };
}

// Remove (demolish) a building
router.post('/remove', requireAuth, async (req, res) => {
  const { buildingId } = req.body;
  if (!buildingId) return res.status(400).json({ error: 'Missing buildingId.' });
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const settlementRes = await query('SELECT * FROM settlements WHERE user_id=$1', [user.id]);
    if (!settlementRes.rows.length) return res.status(404).json({ error: 'No settlement.' });
    const settlement = settlementRes.rows[0];

    // Check building exists
    const existing = await query(
      'SELECT * FROM buildings WHERE settlement_id=$1 AND type=$2',
      [settlement.id, buildingId]
    );
    if (!existing.rows.length || existing.rows[0].level < 1) {
      return res.status(400).json({ error: 'Building not found or not built.' });
    }

    const { BUILDINGS } = require('../buildings');
    const def = BUILDINGS[buildingId];

    // A home: one house comes down (the newest), not every home in town
    // (lib/neighbourhoods.js). The Neighbourhood scene names the house.
    if (def?.isHousing) {
      const N = require('../lib/neighbourhoods');
      try { const out = await N.demolish(settlement.id); return res.json({ ok: true, refund: out.refund }); }
      catch (e) { if (e instanceof N.HouseError) return res.status(e.status).json({ error: e.message }); throw e; }
    }

    // Refund 50% of base build cost
    const refund = {};
    if (def?.cost) {
      for (const [r, v] of Object.entries(def.cost)) {
        refund[r] = Math.floor(v * 0.5);
      }
      const keys = Object.keys(refund).filter(r => RD.isResource(r) && refund[r] > 0);
      if (keys.length) await query(
        `UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} + $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`,
        [...keys.map(r => refund[r]), settlement.id]);
    }

    // Remove from DB
    await query('DELETE FROM buildings WHERE settlement_id=$1 AND type=$2', [settlement.id, buildingId]);
    // Work on its upgrade stops, refunded as a cancelled site.
    const stopped = await withTransaction(async c => {
      const q = (t, p) => c.query(t, p);
      await q('SELECT id FROM settlements WHERE id=$1 FOR UPDATE', [settlement.id]);
      return CN.cancelFor(q, settlement.id, buildingId);
    }).catch(() => null);
    if (stopped) for (const [r, v] of Object.entries(stopped.refund)) refund[r] = (refund[r] || 0) + v;

    // Unassign any citizens working this building
    const { ROLE_BUILDING_MAP } = require('../buildings');
    const rolesForBuilding = Object.entries(ROLE_BUILDING_MAP)
      .filter(([, buildings]) => buildings.includes(buildingId))
      .map(([role]) => role);

    // Careers: anyone whose job needed this building goes foraging (their
    // time so far is credited to the old job first).
    if (rolesForBuilding.length) {
      const careers = require('../lib/careers');
      await careers.settle(settlement.id, { force: true });
      await careers.fixRoles(settlement.id);
    }

    res.json({ ok: true, refund });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Demolition failed.' });
  }
});


// Get building definitions for frontend
router.get('/definitions', async (req, res) => {
  res.json({ ok: true, buildings: BUILDINGS });
});

// ── Where each building stands in the Home scene ───────────────────────────
// { plot id: building id }, the same on every device (docs/HOME_SCENE.md
// §2.3). The plots themselves are the scene's (the client knows them); the
// server keeps the map and checks its shape.
//   GET /api/buildings/layout          { layout } (null: never saved)
//   PUT /api/buildings/layout { layout }
const LAYOUT_MAX = 80;
// A layout as it may be stored, or null when it is not one. Pure.
function cleanLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > LAYOUT_MAX) return null;
  const out = {}, seen = new Set();
  for (const k of keys) {
    const v = raw[k];
    if (!/^[a-z0-9_-]{1,40}$/i.test(k) || typeof v !== 'string') return null;
    if (!(BUILDINGS[v] || v === 'neighbourhood') || seen.has(v)) return null;   // a known building, standing in one place
    seen.add(v);
    out[k] = v;
  }
  return out;
}
router.get('/layout', requireAuth, async (req, res) => {
  try {
    const s = (await query('SELECT scene_layout FROM settlements WHERE user_id=$1', [req.user.userId])).rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    res.json({ ok: true, layout: s.scene_layout || null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the layout.' }); }
});
router.put('/layout', requireAuth, async (req, res) => {
  try {
    const layout = cleanLayout((req.body || {}).layout);
    if (!layout) return res.status(400).json({ error: 'That is not a layout.' });
    const s = (await query('UPDATE settlements SET scene_layout = $2 WHERE user_id = $1 RETURNING id', [req.user.userId, JSON.stringify(layout)])).rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    try { require('../lib/event_bus').publish(s.id, { type: 'layout' }); } catch (_) { /* no stream */ }
    res.json({ ok: true, layout });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the layout.' }); }
});

module.exports = router;
module.exports.buildDiscount = buildDiscount;
module.exports.scaledCost = scaledCost;
module.exports.cleanLayout = cleanLayout;
