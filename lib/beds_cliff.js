// ══════════════════════════════════════════════════════════════════════════
//  The beds cliff (docs/HOME_SCENE.md §0, fix 1).
//
//    run({ only }?)               once, at boot: every town short of beds
//                                 gets plain homes (guarded by migration_marks)
//    grantHomes(settlementId, q)  one town, inside the caller's transaction
//    homesNeeded(living, beds)    pure: how many Willow Huts close the gap
//
//  Towns from before the life cycle have far more people than beds (one had
//  83 people and 24 beds). Births and settlers both need a free bed, so those
//  towns would age together and then empty. Once per town the town raises
//  free Willow Huts (4 beds each, in the Neighbourhood) until beds ≥ the
//  living, writes one chronicle line, and housing sorts itself.
//
//  The huts are ordinary ones: a `buildings` row and a `houses` row each,
//  exactly as a built hut. They may take a town past its tier's hut limit;
//  that limit only stops the player building more until the town grows.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, withTransaction } = require('../db');

const MARK = 'beds_cliff_homes';

const perHouse = () => require('./life').CONFIG.HOUSE_BEDS;

function homesNeeded(living, beds, each = perHouse()) {
  const short = (Number(living) || 0) - (Number(beds) || 0);
  return short > 0 && each > 0 ? Math.ceil(short / each) : 0;
}

// Grants the homes one town needs. Locks the settlement row first, so two
// boots at once can't both grant. Returns { granted, beds, living }.
async function grantHomes(settlementId, q = query) {
  const LIFE = require('./life');
  const locked = await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [settlementId]);
  if (!locked.rows.length) return { granted: 0, beds: 0, living: 0 };
  const { beds, living } = await LIFE.beds(settlementId, q);
  const n = homesNeeded(living, beds);
  if (!n) return { granted: 0, beds, living };

  const each = perHouse();
  const had = (await q("SELECT COUNT(*)::int AS n FROM houses WHERE settlement_id = $1 AND building_type = 'starter_house'", [settlementId])).rows[0].n;
  for (let i = 1; i <= n; i++) {
    await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1, 'starter_house', 1)", [settlementId]);
    await q("INSERT INTO houses (settlement_id, name, building_type, capacity) VALUES ($1, $2, 'starter_house', $3)",
      [settlementId, `Willow Hut #${had + i}`, each]);
  }
  await require('./chronicle').write(settlementId, {
    kind: 'town',
    text: `The town raised homes for everyone: ${n} new Willow Hut${n === 1 ? '' : 's'}, free.`,
  }, q);
  await require('./neighbourhoods').seat(settlementId, q);   // the new homes take plots
  await LIFE.autoHouse(settlementId, {}, q);
  return { granted: n, beds: beds + n * each, living };
}

// Once for the whole game. `only` (ids) limits it to some towns and skips
// the mark, for tests. A failed town is logged and left for the next boot:
// the mark is only written when every town went through.
async function run({ only = null } = {}) {
  if (!only) {
    const done = await query('SELECT 1 FROM migration_marks WHERE key = $1', [MARK]);
    if (done.rows.length) return { skipped: true, towns: [] };
  }
  const short = (await query(
    `SELECT s.id FROM settlements s
      WHERE ($1::int[] IS NULL OR s.id = ANY($1::int[]))
        AND (SELECT COUNT(*) FROM citizens c WHERE c.settlement_id = s.id AND COALESCE(c.life_stage, 'adult') <> 'deceased')
          > (SELECT COALESCE(SUM(h.capacity), 0) FROM houses h WHERE h.settlement_id = s.id)
      ORDER BY s.id`, [only])).rows.map(r => r.id);
  const towns = [];
  let failed = 0;
  for (const id of short) {
    try {
      const r = await withTransaction(async c => {
        // During a deploy the old server is still running: wait a while for
        // its locks, then leave this town for the next boot.
        await c.query("SET LOCAL lock_timeout = '10s'");
        return grantHomes(id, (t, p) => c.query(t, p));
      });
      if (r.granted) towns.push({ id, ...r });
    } catch (e) {
      failed++;
      console.error(`[beds_cliff] town ${id}:`, e.message);
    }
  }
  if (!only && !failed) await query('INSERT INTO migration_marks (key) VALUES ($1) ON CONFLICT DO NOTHING', [MARK]);
  if (towns.length) console.log(`[beds_cliff] raised ${towns.reduce((a, t) => a + t.granted, 0)} homes in ${towns.length} town(s)`);
  return { skipped: false, towns, failed };
}

module.exports = { MARK, homesNeeded, grantHomes, run };
