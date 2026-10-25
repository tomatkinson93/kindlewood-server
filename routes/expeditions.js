const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');

const router = express.Router();

const mapgen = require('../mapgen');
const { hexDistanceWrapped } = mapgen;
const SECONDS_PER_TILE_CLEAR = 8;   // revealed tile
const SECONDS_PER_TILE_FOG   = 20;  // fog tile — harder to traverse

// Hex line between two axial-coord hexes (wrapping-aware)
// Uses cube coordinate lerp — standard hex grid algorithm
function hexLinePath(q0, r0, q1, r1) {
  // Read MAP_W/MAP_H live so resizing doesn't break in-flight expeditions.
  const MAP_W = mapgen.MAP_W, MAP_H = mapgen.MAP_H;
  // Find shortest wrapped target
  let dq = q1 - q0, dr = r1 - r0;
  if (Math.abs(dq) > MAP_W / 2) dq = dq > 0 ? dq - MAP_W : dq + MAP_W;
  if (Math.abs(dr) > MAP_H / 2) dr = dr > 0 ? dr - MAP_H : dr + MAP_H;

  // Convert to cube coords for lerp
  const tq1 = q0 + dq, tr1 = r0 + dr;
  const s0 = -q0 - r0, s1 = -tq1 - tr1;

  const N = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  const path = [];
  for (let i = 0; i <= N; i++) {
    const t = N === 0 ? 0 : i / N;
    // Cube lerp then round
    const fq = q0 + (tq1 - q0) * t;
    const fr = r0 + (tr1 - r0) * t;
    const fs = s0 + (s1 - s0) * t;
    let rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
    const qDiff = Math.abs(rq - fq), rDiff = Math.abs(rr - fr), sDiff = Math.abs(rs - fs);
    if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
    else if (rDiff > sDiff) rr = -rq - rs;
    const wq = ((rq % MAP_W) + MAP_W) % MAP_W;
    const wr = ((rr % MAP_H) + MAP_H) % MAP_H;
    if (!path.length || path[path.length-1].q !== wq || path[path.length-1].r !== wr) {
      path.push({ q: wq, r: wr });
    }
  }
  return path;
}

// Send scout expedition
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { target_q, target_r, citizen_id } = req.body;
    if (target_q === undefined || target_r === undefined)
      return res.status(400).json({ error: 'Target coordinates required.' });

    const settlementRes = await query(
      'SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    if (settlement.tile_q === null) return res.status(400).json({ error: 'Not placed yet.' });

    // Check scout post exists
    const scoutPost = await query(
      "SELECT level FROM buildings WHERE settlement_id=$1 AND type='scout_post'",
      [settlement.id]
    );
    if (!scoutPost.rows.length)
      return res.status(400).json({ error: 'Build a Scout Post first.' });

    // Validate citizen if provided
    let citizenName = 'Unknown Scout';
    let citizenSkillBonus = 1.0;
    let revealBonus = 0;
    if (citizen_id) {
      const citizenRes = await query(
        "SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2",
        [citizen_id, settlement.id]
      );
      const citizen = citizenRes.rows[0];
      if (!citizen) return res.status(400).json({ error: 'Citizen not found.' });
      if (citizen.role !== 'scout') return res.status(400).json({ error: 'Citizen must be assigned as scout.' });
      // Check not already on expedition
      const onExpedition = await query(
        "SELECT id FROM expeditions WHERE citizen_id=$1 AND status='travelling'",
        [citizen_id]
      );
      if (onExpedition.rows.length) return res.status(400).json({ error: `${citizen.name} is already scouting.` });
      if ((await require('../lib/clan_quests').busyCitizenIds([citizen.id])).length) {
        return res.status(400).json({ error: `${citizen.name} is on a clan quest.` });
      }
      citizenName = citizen.name;
      // Careers: effective scouting (perks, gear) and travel perks.
      const prof = (await require('../lib/careers').profilesFor(null, settlement.id)).get(citizen.id);
      const scoutSkill = prof ? prof.skills.scouting : (citizen.skills?.scouting || 1);
      citizenSkillBonus = (1 + (scoutSkill - 1) * 0.04) * (1 + (prof ? (prof.effects.travel || 0) : 0)); // each skill point = 4% faster
      revealBonus = prof ? Math.round(prof.effects.reveal || 0) : 0;
    }

    // Check no active expedition to same tile
    const existing = await query(
      "SELECT id FROM expeditions WHERE settlement_id=$1 AND target_q=$2 AND target_r=$3 AND status='travelling'",
      [settlement.id, target_q, target_r]
    );
    if (existing.rows.length)
      return res.status(400).json({ error: 'Scout already heading there.' });

    // Calculate path
    const path = hexLinePath(settlement.tile_q, settlement.tile_r, target_q, target_r);

    // Get revealed tiles to calculate travel time
    const revealedRes = await query(
      'SELECT tile_q, tile_r FROM fog_of_war WHERE user_id=$1', [req.user.userId]
    );
    const revealed = new Set(revealedRes.rows.map(r => `${r.tile_q},${r.tile_r}`));

    let seconds = 0;
    for (const tile of path) {
      seconds += revealed.has(`${tile.q},${tile.r}`)
        ? SECONDS_PER_TILE_CLEAR
        : SECONDS_PER_TILE_FOG;
    }

    // Scout post level reduces time
    const scoutLevel = scoutPost.rows[0].level;
    seconds = Math.round(seconds / (1 + (scoutLevel - 1) * 0.25));
    // Citizen scout skill bonus
    seconds = Math.round(seconds / citizenSkillBonus);
    seconds = Math.max(10, seconds); // minimum 10s

    const completesAt = new Date(Date.now() + seconds * 1000);

    const result = await query(
      `INSERT INTO expeditions (settlement_id, user_id, target_q, target_r, completes_at, path, citizen_id, reveal_bonus)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [settlement.id, req.user.userId, target_q, target_r, completesAt, JSON.stringify(path), citizen_id || null, revealBonus]
    );

    res.json({
      ok: true,
      expedition: result.rows[0],
      seconds,
      hexes: path.length,
      citizenName,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send scout.' });
  }
});

// Get active expeditions
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Complete any finished expeditions
    await completeExpeditions(settlement.id, req.user.userId);

    const expeditions = await query(
      `SELECT e.*, c.name as citizen_name, c.skills as citizen_skills
       FROM expeditions e
       LEFT JOIN citizens c ON e.citizen_id = c.id
       WHERE e.settlement_id=$1 AND e.status='travelling'
       ORDER BY e.completes_at ASC`,
      [settlement.id]
    );

    res.json({ ok: true, expeditions: expeditions.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch expeditions.' });
  }
});

// Complete finished expeditions and reveal tiles
// Each expedition is claimed first (status → complete), so the lazy read
// and the worker can't both finish it.
const EXPEDITION_SCHEMATIC = { perHex: 0.008, max: 0.12 };
const EXPEDITION_ORE = { perHex: 0.02, max: 0.3, keys: ['copper', 'tin', 'coal', 'silver', 'goldore', 'gems', 'obsidian'] };
async function completeExpeditions(settlementId, userId) {
  const done = await query(
    `UPDATE expeditions SET status='complete' WHERE settlement_id=$1 AND status='travelling' AND completes_at <= NOW() RETURNING *`,
    [settlementId]
  );

  for (const exp of done.rows) {
    const path = exp.path || [];
    // Reveal all path tiles
    for (const tile of path) {
      await query(
        'INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [userId, tile.q, tile.r]
      );
    }
    // Also reveal a small radius around destination
    // Reveal hex disk around destination
    const { hexDisk } = require('../mapgen');
    const destDisk = hexDisk(exp.target_q, exp.target_r, 2 + (Number(exp.reveal_bonus) || 0));
    for (const { q: tq, r: tr } of destDisk) {
      await query(
        'INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [userId, tq, tr]
      );
    }
    // Scouts sometimes bring a schematic back from what they explored:
    // longer trips, better odds (lib/crafting grantRandomSchematic).
    if (Math.random() < Math.min(EXPEDITION_SCHEMATIC.max, EXPEDITION_SCHEMATIC.perHex * path.length)) {
      const t = await require('../lib/crafting').grantRandomSchematic({ query }, settlementId, Math.random, 'expedition').catch(() => null);
      if (t) require('../lib/event_bus').publish(settlementId, { type: 'schematic_found', source: 'expedition', item: { name: t.name, icon: t.icon } });
    }
    // …and sometimes an ore sample: a handful of a resource the town may
    // not have seen yet (that's a discovery). Rarer ones only once studied.
    if (Math.random() < Math.min(EXPEDITION_ORE.max, EXPEDITION_ORE.perHex * path.length)) {
      const done = await require('../lib/research').doneSet(null, settlementId);
      const pool = EXPEDITION_ORE.keys.filter(k => require('../lib/ores').available(k, done));
      const key = pool[Math.floor(Math.random() * pool.length)];
      const qty = 5 + Math.floor(Math.random() * 11);
      if (key) {
        await query(`UPDATE settlements SET ${key} = ${key} + $2 WHERE id = $1`, [settlementId, qty]);
        const isNew = await require('../lib/resources').discover(null, settlementId, key, 'expedition');
        const RD = require('../lib/resource_defs');
        await query('INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
          [settlementId, 'expedition', `${RD.icon(key)} An expedition brought back ${qty} ${RD.label(key).toLowerCase()}${isNew ? ' — something new!' : '.'}`, JSON.stringify(exp.citizen_id ? [exp.citizen_id] : [])]).catch(() => {});
        require('../lib/event_bus').publish(settlementId, { type: 'ore_sample', resource: key, qty, discovered: isNew });
      }
    }
    // citizen is now free (tracked by expedition status)
    if (exp.citizen_id) {
      require('../lib/game_events').emit('expedition_returned', { settlementId, citizenId: exp.citizen_id, hexes: path.length });
    }
  }
}

// Worker: finish due expeditions everywhere (not only when someone looks).
async function completeDueExpeditions() {
  try {
    const due = (await query(
      `SELECT DISTINCT settlement_id, user_id FROM expeditions WHERE status='travelling' AND completes_at <= NOW() LIMIT 10`)).rows;
    for (const d of due) await completeExpeditions(d.settlement_id, d.user_id);
  } catch (e) { console.error('[expeditions] worker completion failed:', e.message); }
}

// Cheat — reveal all fog
router.post('/reveal-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tilesRes = await query('SELECT q, r FROM tiles');
    for (const t of tilesRes.rows) {
      await query(
        'INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [req.user.userId, t.q, t.r]
      );
    }
    res.json({ ok: true, revealed: tilesRes.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reveal.' });
  }
});

// Cheat — reset fog
router.post('/reset-fog', requireAuth, requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM fog_of_war WHERE user_id=$1', [req.user.userId]);
    // Re-reveal just around settlement
    const settlementRes = await query(
      'SELECT tile_q, tile_r FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const s = settlementRes.rows[0];
    if (s?.tile_q !== null) {
      const { hexDisk: hd } = require('../mapgen');
      for (const { q, r } of hd(s.tile_q, s.tile_r, 5)) {
        await query(
          'INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [req.user.userId, q, r]
          );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset fog.' });
  }
});

module.exports = router;
module.exports.completeExpeditions = completeExpeditions;
module.exports.completeDueExpeditions = completeDueExpeditions;
