const express  = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const mapgen = require('../mapgen');
const { hexDistanceWrapped } = mapgen;

const router = express.Router();

const SECONDS_PER_TILE = 12;  // diplomacy travel — slower than scouting
const TRUST_LEVELS = [
  { min: 0,  max: 0,   status: 'unknown',   label: 'Unknown',   color: '#888' },
  { min: 1,  max: 20,  status: 'contacted', label: 'Contacted', color: '#8ecf7e' },
  { min: 21, max: 40,  status: 'familiar',  label: 'Familiar',  color: '#5ec4b0' },
  { min: 41, max: 70,  status: 'friendly',  label: 'Friendly',  color: '#4a90d9' },
  { min: 71, max: 100, status: 'allied',    label: 'Allied',    color: '#9b59b6' },
];

function getTrustLevel(trust) {
  return TRUST_LEVELS.slice().reverse().find(l => trust >= l.min) || TRUST_LEVELS[0];
}

function hexLinePath(q0, r0, q1, r1) {
  // Read MAP_W/MAP_H live so resizing the map doesn't break travel paths.
  const W = mapgen.MAP_W, H = mapgen.MAP_H;
  let dq = q1 - q0, dr = r1 - r0;
  if (Math.abs(dq) > W / 2) dq = dq > 0 ? dq - W : dq + W;
  if (Math.abs(dr) > H / 2) dr = dr > 0 ? dr - H : dr + H;
  const tq1 = q0 + dq, tr1 = r0 + dr;
  const s0 = -q0 - r0, s1 = -tq1 - tr1;
  const N = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  const path = [];
  for (let i = 0; i <= N; i++) {
    const t = N === 0 ? 0 : i / N;
    const fq = q0 + (tq1 - q0) * t, fr = r0 + (tr1 - r0) * t, fs = s0 + (s1 - s0) * t;
    let rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
    if (Math.abs(rq-fq)>Math.abs(rr-fr)&&Math.abs(rq-fq)>Math.abs(rs-fs)) rq=-rr-rs;
    else if (Math.abs(rr-fr)>Math.abs(rs-fs)) rr=-rq-rs;
    const wq = ((rq%W)+W)%W, wr = ((rr%H)+H)%H;
    if (!path.length || path[path.length-1].q!==wq || path[path.length-1].r!==wr) path.push({q:wq,r:wr});
  }
  return path;
}

// ── GET /api/diplomacy — all relations for this settlement ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    // Auto-complete any contact missions that have arrived
    await query(`
      UPDATE diplomacy_relations
      SET status='contacted', trust=GREATEST(trust,10), last_interaction=NOW(), citizen_id=NULL
      WHERE settlement_id=$1
        AND status='contact_sent'
        AND contact_arrives_at IS NOT NULL
        AND contact_arrives_at <= NOW()
    `, [sett.id]);

    const rels = await query(`
      SELECT dr.*, n.name as npc_name, n.species as npc_species,
             n.tier as npc_tier, n.disposition, n.faction,
             n.tile_q as npc_q, n.tile_r as npc_r,
             c.name as citizen_name
      FROM diplomacy_relations dr
      JOIN npc_settlements n ON n.id = dr.npc_id
      LEFT JOIN citizens c ON c.id = dr.citizen_id
      WHERE dr.settlement_id = $1
      ORDER BY dr.trust DESC, n.name
    `, [sett.id]);

    res.json({ ok: true, relations: rels.rows.map(r => ({
      ...r,
      trust_level: getTrustLevel(r.trust),
      trust_levels: TRUST_LEVELS,
    })) });
  } catch(e) { console.error('Diplomacy error:', e); res.status(500).json({ error: e.message }); }
});

// ── GET /api/diplomacy/:npcId — single relation ──
router.get('/:npcId', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const npcRes = await query('SELECT * FROM npc_settlements WHERE id=$1', [req.params.npcId]);
    const npc = npcRes.rows[0];
    if (!npc) return res.status(404).json({ error: 'NPC not found.' });
    if (npc.disposition === 'hostile') return res.status(400).json({ error: 'Cannot establish diplomacy with hostile faction.' });

    // Auto-complete arrived contact missions
    await query(`
      UPDATE diplomacy_relations
      SET status='contacted', trust=GREATEST(trust,10), last_interaction=NOW(), citizen_id=NULL
      WHERE settlement_id=$1 AND npc_id=$2
        AND status='contact_sent' AND contact_arrives_at <= NOW()
    `, [sett.id, npc.id]);

    let rel = await query(
      'SELECT * FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2',
      [sett.id, npc.id]
    );

    const relRow = rel.rows[0] || null;

    // Calc travel time preview — guard against unplaced settlement
    const travelSecs = (sett.tile_q != null && npc.tile_q != null)
      ? Math.max(10, hexDistanceWrapped(sett.tile_q, sett.tile_r, npc.tile_q, npc.tile_r) * SECONDS_PER_TILE)
      : 60;

    res.json({
      ok: true,
      npc,
      relation: relRow ? { ...relRow, trust_level: getTrustLevel(relRow.trust) } : null,
      travel_secs: travelSecs,
      trust_levels: TRUST_LEVELS,
    });
  } catch(e) { console.error('Diplomacy route error:', e.message); res.status(500).json({ error: e.message }); }
});

// ── POST /api/diplomacy/:npcId/contact — send a citizen to make contact ──
router.post('/:npcId/contact', requireAuth, async (req, res) => {
  try {
    const { citizen_id } = req.body;
    if (!citizen_id) return res.status(400).json({ error: 'citizen_id required.' });

    const settRes = await query('SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const npcRes = await query('SELECT * FROM npc_settlements WHERE id=$1 AND disposition != $2', [req.params.npcId, 'hostile']);
    const npc = npcRes.rows[0];
    if (!npc) return res.status(400).json({ error: 'Cannot make contact with this settlement.' });

    // Citizen must be free
    const cRes = await query('SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2', [citizen_id, sett.id]);
    const cit = cRes.rows[0];
    if (!cit) return res.status(400).json({ error: 'Citizen not found.' });
    if (cit.life_stage === 'child') return res.status(400).json({ error: 'Cannot send a child.' });
    const onExp = await query("SELECT id FROM expeditions WHERE citizen_id=$1 AND status='travelling'", [citizen_id]);
    if (onExp.rows.length) return res.status(400).json({ error: cit.name + ' is already on an expedition.' });
    const onQuest = await query("SELECT id FROM settlement_quests WHERE (citizen_id=$1 OR party_ids @> $2::jsonb) AND status='active'", [citizen_id, JSON.stringify([citizen_id])]);
    if (onQuest.rows.length) return res.status(400).json({ error: cit.name + ' is already on a quest.' });
    const onDiplo = await query("SELECT id FROM diplomacy_relations WHERE citizen_id=$1 AND status='contact_sent'", [citizen_id]);
    if (onDiplo.rows.length) return res.status(400).json({ error: cit.name + ' is already on a diplomatic mission.' });

    // Check relation status
    const existing = await query('SELECT * FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [sett.id, npc.id]);
    if (existing.rows.length && existing.rows[0].status === 'contact_sent') {
      return res.status(400).json({ error: 'An envoy is already travelling to ' + npc.name + '.' });
    }

    // Calculate travel time
    const path = hexLinePath(sett.tile_q, sett.tile_r, npc.tile_q, npc.tile_r);
    const scouting = cit.skills?.scouting || 1;
    let seconds = path.length * SECONDS_PER_TILE;
    seconds = Math.round(seconds / (1 + (scouting - 1) * 0.06));
    seconds = Math.max(15, seconds);
    const arrivesAt = new Date(Date.now() + seconds * 1000);

    // Upsert relation
    // Try to save path; fall back without it if column missing
    try {
      await query(`
        INSERT INTO diplomacy_relations (settlement_id, npc_id, status, citizen_id, contact_sent_at, contact_arrives_at, path)
        VALUES ($1,$2,'contact_sent',$3,NOW(),$4,$5)
        ON CONFLICT (settlement_id, npc_id)
        DO UPDATE SET status='contact_sent', citizen_id=$3, contact_sent_at=NOW(), contact_arrives_at=$4, path=$5
      `, [sett.id, npc.id, citizen_id, arrivesAt, JSON.stringify(path)]);
    } catch(pathErr) {
      // path column may not exist yet — insert without it
      await query(`
        INSERT INTO diplomacy_relations (settlement_id, npc_id, status, citizen_id, contact_sent_at, contact_arrives_at)
        VALUES ($1,$2,'contact_sent',$3,NOW(),$4)
        ON CONFLICT (settlement_id, npc_id)
        DO UPDATE SET status='contact_sent', citizen_id=$3, contact_sent_at=NOW(), contact_arrives_at=$4
      `, [sett.id, npc.id, citizen_id, arrivesAt]);
    }

    res.json({ ok: true, arrives_at: arrivesAt, seconds, citizen_name: cit.name, npc_name: npc.name });
  } catch(e) { console.error('Diplomacy route error:', e.message); res.status(500).json({ error: e.message }); }
});

// ── POST /api/diplomacy/:npcId/interact — log an interaction (trade, gift, quest) ──
router.post('/:npcId/interact', requireAuth, async (req, res) => {
  try {
    const { type, trust_gain } = req.body; // type: 'gift'|'trade'|'quest'|'visit'
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const rel = await query('SELECT * FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [sett.id, req.params.npcId]);
    if (!rel.rows.length || rel.rows[0].status === 'unknown' || rel.rows[0].status === 'contact_sent') {
      return res.status(400).json({ error: 'Must establish contact first.' });
    }

    const gain = Math.min(trust_gain || 5, 20);
    const newTrust = Math.min(100, rel.rows[0].trust + gain);
    const newLevel = getTrustLevel(newTrust);

    await query(`
      UPDATE diplomacy_relations
      SET trust=$1, status=$2, interactions=interactions+1, last_interaction=NOW()
      WHERE settlement_id=$3 AND npc_id=$4
    `, [newTrust, newLevel.status, sett.id, req.params.npcId]);

    res.json({ ok: true, trust: newTrust, trust_level: newLevel, levelled_up: newLevel.status !== rel.rows[0].status });
  } catch(e) { console.error('Diplomacy route error:', e.message); res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.TRUST_LEVELS = TRUST_LEVELS;
module.exports.getTrustLevel = getTrustLevel;
