const express  = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const mapgen = require('../mapgen');
const { hexDistanceWrapped } = mapgen;
// Lazy-loaded to avoid the circular import at module-load time
// (routes/quests.js may require this file too in future).
let _resolveCompletedQuests = null;
function resolveCompletedQuests(...args) {
  if (!_resolveCompletedQuests) {
    try { _resolveCompletedQuests = require('./quests').resolveCompletedQuests; } catch(e) {}
  }
  if (typeof _resolveCompletedQuests === 'function') return _resolveCompletedQuests(...args);
  return Promise.resolve();
}

const router = express.Router();

const SECONDS_PER_TILE = 12;  // diplomacy travel — slower than scouting
const TRUST_LEVELS = [
  { min: 0,  max: 0,   status: 'unknown',   label: 'Unknown',   color: '#888' },
  { min: 1,  max: 20,  status: 'contacted', label: 'Contacted', color: '#8ecf7e' },
  { min: 21, max: 40,  status: 'familiar',  label: 'Familiar',  color: '#5ec4b0' },
  { min: 41, max: 70,  status: 'friendly',  label: 'Friendly',  color: '#4a90d9' },
  { min: 71, max: 100, status: 'allied',    label: 'Allied',    color: '#9b59b6' },
];

// Trust required to unlock NPC-village quest offers.
// Matches the diplo-friendly tier; client should also gate the UI accordingly.
const QUEST_UNLOCK_TRUST = 41;

// Gift tiers — flat rewards, single per-day budget per NPC village.
// trust_gain is the reputation added once the courier arrives.
const GIFT_TIERS = [
  { key: 'small',   label: 'Small Gift',   gold: 100, trust_gain: 3,  icon: '🎁', desc: 'A modest token of friendship.' },
  { key: 'medium',  label: 'Medium Gift',  gold: 250, trust_gain: 5,  icon: '🎀', desc: 'A respectable parcel of goods.' },
  { key: 'large',   label: 'Large Gift',   gold: 500, trust_gain: 8,  icon: '🛍', desc: 'A generous chest worth boasting about.' },
  { key: 'lavish',  label: 'Lavish Gift',  gold: 750, trust_gain: 10, icon: '👑', desc: 'A truly princely offering.' },
];

const GOODWILL_TRUST_CAP = 5;       // max trust gain from a single goodwill envoy
const GIFT_COOLDOWN_HOURS = 24;     // once per day per NPC

function getTrustLevel(trust) {
  return TRUST_LEVELS.slice().reverse().find(l => trust >= l.min) || TRUST_LEVELS[0];
}

// Goodwill gain scales with charisma. Aim: low-charisma citizens still useful (~+2),
// high-charisma citizens close to the cap. Stats are 1-20-ish, with charming trait giving +3.
// Curve: floor(2 + charisma/4), capped at GOODWILL_TRUST_CAP.
function computeGoodwillGain(charisma) {
  const ch = Math.max(0, charisma || 0);
  return Math.min(GOODWILL_TRUST_CAP, Math.max(1, Math.floor(2 + ch / 4)));
}

// Citizen charisma = stats.charisma + trait bonuses (mirrors frontend logic so previews match).
function citizenCharisma(citizen) {
  if (!citizen) return 0;
  const stats = citizen.stats || {};
  const fromStats = stats.charisma || 0;
  const traits = [].concat(citizen.visible_traits || [], citizen.hidden_traits || []);
  let traitBonus = 0;
  for (const t of traits) {
    if (t === 'charming') traitBonus += 3;
    else if (t === 'loyal') traitBonus += 1;
  }
  return fromStats + traitBonus;
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

// Auto-complete any in-flight envoy missions (contact / goodwill / gift) for the
// given settlement (or single relation) whose timer has elapsed. Idempotent.
async function resolvePendingEnvoys(settlementId, npcId) {
  const params = npcId ? [settlementId, npcId] : [settlementId];
  const filter = npcId ? 'AND npc_id=$2' : '';

  // Initial-contact arrivals — same as before.
  await query(`
    UPDATE diplomacy_relations
    SET status='contacted', trust=GREATEST(trust,10), last_interaction=NOW(),
        citizen_id=NULL
    WHERE settlement_id=$1 ${filter}
      AND status='contact_sent'
      AND contact_arrives_at IS NOT NULL
      AND contact_arrives_at <= NOW()
  `, params);

  // Goodwill / gift envoy arrivals — apply pending trust, capped at 100, then clear.
  // RETURNING the affected rows lets us reconcile status without scanning every relation.
  const arrived = await query(`
    UPDATE diplomacy_relations
    SET trust = LEAST(100, trust + COALESCE(pending_trust_gain,0)),
        interactions = interactions + 1,
        last_interaction = NOW(),
        citizen_id = NULL,
        pending_action = NULL,
        pending_sent_at = NULL,
        pending_arrives_at = NULL,
        pending_trust_gain = 0,
        pending_meta = '{}'::jsonb
    WHERE settlement_id=$1 ${filter}
      AND pending_action IS NOT NULL
      AND pending_arrives_at IS NOT NULL
      AND pending_arrives_at <= NOW()
    RETURNING id, trust
  `, params);

  // Recompute the status text for any rows that just resolved and may have
  // crossed a tier threshold. Scoped to those rows only — not the whole table.
  for (const r of arrived.rows) {
    const lvl = getTrustLevel(r.trust);
    await query(
      `UPDATE diplomacy_relations SET status=$1 WHERE id=$2 AND status NOT IN ('contact_sent')`,
      [lvl.status, r.id]
    );
  }
}

// Validate a citizen for an envoy mission. Returns { ok, citizen, error }.
async function loadAvailableCitizen(citizenId, settlementId) {
  const cRes = await query('SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2', [citizenId, settlementId]);
  const cit = cRes.rows[0];
  if (!cit) return { ok: false, error: 'Citizen not found.' };
  if (cit.life_stage === 'child') return { ok: false, error: 'Cannot send a child.' };

  const onExp = await query("SELECT id FROM expeditions WHERE citizen_id=$1 AND status='travelling'", [citizenId]);
  if (onExp.rows.length) return { ok: false, error: cit.name + ' is already on an expedition.' };

  const onQuest = await query(
    "SELECT id FROM settlement_quests WHERE (citizen_id=$1 OR party_ids @> $2::jsonb) AND status='active'",
    [citizenId, JSON.stringify([citizenId])]
  );
  if (onQuest.rows.length) return { ok: false, error: cit.name + ' is already on a quest.' };

  const onDiplo = await query(
    "SELECT id FROM diplomacy_relations WHERE citizen_id=$1 AND (status='contact_sent' OR pending_action IS NOT NULL)",
    [citizenId]
  );
  if (onDiplo.rows.length) return { ok: false, error: cit.name + ' is already on a diplomatic mission.' };

  return { ok: true, citizen: cit };
}

// ── GET /api/diplomacy — all relations for this settlement ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    await resolvePendingEnvoys(sett.id);

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

    await resolvePendingEnvoys(sett.id, npc.id);

    let rel = await query(
      'SELECT dr.*, c.name as citizen_name FROM diplomacy_relations dr LEFT JOIN citizens c ON c.id=dr.citizen_id WHERE dr.settlement_id=$1 AND dr.npc_id=$2',
      [sett.id, npc.id]
    );

    const relRow = rel.rows[0] || null;

    // Calc travel time preview — guard against unplaced settlement
    const travelSecs = (sett.tile_q != null && npc.tile_q != null)
      ? Math.max(10, hexDistanceWrapped(sett.tile_q, sett.tile_r, npc.tile_q, npc.tile_r) * SECONDS_PER_TILE)
      : 60;

    // Compute gift cooldown info
    let giftAvailableAt = null;
    if (relRow?.last_gift_at) {
      const candidate = new Date(new Date(relRow.last_gift_at).getTime() + GIFT_COOLDOWN_HOURS * 3600 * 1000);
      if (candidate > new Date()) giftAvailableAt = candidate;
    }

    res.json({
      ok: true,
      npc,
      relation: relRow ? { ...relRow, trust_level: getTrustLevel(relRow.trust) } : null,
      travel_secs: travelSecs,
      trust_levels: TRUST_LEVELS,
      gift_tiers: GIFT_TIERS,
      gift_available_at: giftAvailableAt,
      goodwill_cap: GOODWILL_TRUST_CAP,
      quest_unlock_trust: QUEST_UNLOCK_TRUST,
    });
  } catch(e) { console.error('Diplomacy route error:', e.message); res.status(500).json({ error: e.message }); }
});

// ── POST /api/diplomacy/:npcId/contact — send a citizen to make first contact ──
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

    const av = await loadAvailableCitizen(citizen_id, sett.id);
    if (!av.ok) return res.status(400).json({ error: av.error });
    const cit = av.citizen;

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

    // Upsert relation. Try with path column; fall back if missing.
    try {
      await query(`
        INSERT INTO diplomacy_relations (settlement_id, npc_id, status, citizen_id, contact_sent_at, contact_arrives_at, path)
        VALUES ($1,$2,'contact_sent',$3,NOW(),$4,$5)
        ON CONFLICT (settlement_id, npc_id)
        DO UPDATE SET status='contact_sent', citizen_id=$3, contact_sent_at=NOW(), contact_arrives_at=$4, path=$5
      `, [sett.id, npc.id, citizen_id, arrivesAt, JSON.stringify(path)]);
    } catch(pathErr) {
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

// ── POST /api/diplomacy/:npcId/goodwill — send a citizen as a goodwill envoy ──
//    Trust gain scales with charisma, capped at GOODWILL_TRUST_CAP.
//    Requires existing contact (status >= contacted).
router.post('/:npcId/goodwill', requireAuth, async (req, res) => {
  try {
    const { citizen_id } = req.body;
    if (!citizen_id) return res.status(400).json({ error: 'citizen_id required.' });

    const settRes = await query('SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const npcRes = await query('SELECT * FROM npc_settlements WHERE id=$1 AND disposition != $2', [req.params.npcId, 'hostile']);
    const npc = npcRes.rows[0];
    if (!npc) return res.status(400).json({ error: 'No such settlement.' });

    // Resolve any in-flight first so we don't stack envoys against stale state.
    await resolvePendingEnvoys(sett.id, npc.id);

    const relRes = await query('SELECT * FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [sett.id, npc.id]);
    const rel = relRes.rows[0];
    if (!rel || rel.status === 'unknown' || rel.status === 'contact_sent') {
      return res.status(400).json({ error: 'You must first establish contact with ' + npc.name + '.' });
    }
    if (rel.pending_action) {
      return res.status(400).json({ error: 'An envoy is already on the way to ' + npc.name + '.' });
    }
    if (rel.trust >= 100) {
      return res.status(400).json({ error: 'Relations with ' + npc.name + ' are already at their peak.' });
    }

    const av = await loadAvailableCitizen(citizen_id, sett.id);
    if (!av.ok) return res.status(400).json({ error: av.error });
    const cit = av.citizen;

    // Compute trust gain from charisma
    const charisma = citizenCharisma(cit);
    const trustGain = computeGoodwillGain(charisma);

    // Travel time — same formula as contact, scouting helps a little.
    const path = hexLinePath(sett.tile_q, sett.tile_r, npc.tile_q, npc.tile_r);
    const scouting = cit.skills?.scouting || 1;
    let seconds = path.length * SECONDS_PER_TILE;
    seconds = Math.round(seconds / (1 + (scouting - 1) * 0.06));
    seconds = Math.max(15, seconds);
    const arrivesAt = new Date(Date.now() + seconds * 1000);

    await query(`
      UPDATE diplomacy_relations
      SET citizen_id=$1,
          pending_action='goodwill',
          pending_sent_at=NOW(),
          pending_arrives_at=$2,
          pending_trust_gain=$3,
          pending_meta=$4,
          path=$5
      WHERE id=$6
    `, [
      citizen_id, arrivesAt, trustGain,
      JSON.stringify({ charisma, citizen_name: cit.name }),
      JSON.stringify(path),
      rel.id,
    ]);

    res.json({
      ok: true,
      arrives_at: arrivesAt,
      seconds,
      trust_gain: trustGain,
      charisma,
      citizen_name: cit.name,
      npc_name: npc.name,
    });
  } catch(e) {
    console.error('Diplomacy goodwill error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/diplomacy/:npcId/gift — send a gold gift via courier ──
//    Once per day per NPC. Tier sets gold cost + reputation gain.
router.post('/:npcId/gift', requireAuth, async (req, res) => {
  try {
    const { citizen_id, tier_key } = req.body;
    if (!citizen_id) return res.status(400).json({ error: 'citizen_id required.' });
    if (!tier_key) return res.status(400).json({ error: 'tier_key required.' });

    const tier = GIFT_TIERS.find(t => t.key === tier_key);
    if (!tier) return res.status(400).json({ error: 'Unknown gift tier.' });

    const settRes = await query('SELECT * FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const npcRes = await query('SELECT * FROM npc_settlements WHERE id=$1 AND disposition != $2', [req.params.npcId, 'hostile']);
    const npc = npcRes.rows[0];
    if (!npc) return res.status(400).json({ error: 'No such settlement.' });

    await resolvePendingEnvoys(sett.id, npc.id);

    const relRes = await query('SELECT * FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [sett.id, npc.id]);
    const rel = relRes.rows[0];
    if (!rel || rel.status === 'unknown' || rel.status === 'contact_sent') {
      return res.status(400).json({ error: 'You must first establish contact with ' + npc.name + '.' });
    }
    if (rel.pending_action) {
      return res.status(400).json({ error: 'An envoy is already on the way to ' + npc.name + '.' });
    }

    // Daily cooldown
    if (rel.last_gift_at) {
      const since = (Date.now() - new Date(rel.last_gift_at).getTime()) / 3600000;
      if (since < GIFT_COOLDOWN_HOURS) {
        const hoursLeft = Math.ceil(GIFT_COOLDOWN_HOURS - since);
        return res.status(400).json({
          error: 'You have already sent a gift today. Try again in ' + hoursLeft + 'h.'
        });
      }
    }

    // Gold check — re-read settlement so we don't race wealth updates.
    if ((sett.wealth || 0) < tier.gold) {
      return res.status(400).json({ error: 'Not enough gold for a ' + tier.label + '. Need ' + tier.gold + '.' });
    }

    const av = await loadAvailableCitizen(citizen_id, sett.id);
    if (!av.ok) return res.status(400).json({ error: av.error });
    const cit = av.citizen;

    // Travel time — couriers don't get a charisma bonus, but scouting still helps.
    const path = hexLinePath(sett.tile_q, sett.tile_r, npc.tile_q, npc.tile_r);
    const scouting = cit.skills?.scouting || 1;
    let seconds = path.length * SECONDS_PER_TILE;
    seconds = Math.round(seconds / (1 + (scouting - 1) * 0.06));
    seconds = Math.max(15, seconds);
    const arrivesAt = new Date(Date.now() + seconds * 1000);

    // Deduct gold and lock the cooldown atomically with the envoy state.
    // Conditional update prevents going negative on a race.
    const goldRes = await query(
      'UPDATE settlements SET wealth = wealth - $1 WHERE id=$2 AND wealth >= $1 RETURNING wealth',
      [tier.gold, sett.id]
    );
    if (!goldRes.rows.length) {
      return res.status(400).json({ error: 'Not enough gold for a ' + tier.label + '.' });
    }

    await query(`
      UPDATE diplomacy_relations
      SET citizen_id=$1,
          pending_action='gift',
          pending_sent_at=NOW(),
          pending_arrives_at=$2,
          pending_trust_gain=$3,
          pending_meta=$4,
          last_gift_at=NOW(),
          path=$5
      WHERE id=$6
    `, [
      citizen_id, arrivesAt, tier.trust_gain,
      JSON.stringify({ tier_key: tier.key, tier_label: tier.label, gold: tier.gold, citizen_name: cit.name, icon: tier.icon }),
      JSON.stringify(path),
      rel.id,
    ]);

    res.json({
      ok: true,
      arrives_at: arrivesAt,
      seconds,
      tier,
      citizen_name: cit.name,
      npc_name: npc.name,
      gold_spent: tier.gold,
      trust_gain: tier.trust_gain,
    });
  } catch(e) {
    console.error('Diplomacy gift error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/diplomacy/:npcId/quests — quests this NPC offers at the current trust level ──
router.get('/:npcId/quests', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const npcId = parseInt(req.params.npcId);
    const npcRes = await query('SELECT * FROM npc_settlements WHERE id=$1', [npcId]);
    const npc = npcRes.rows[0];
    if (!npc) return res.status(404).json({ error: 'NPC not found.' });

    await resolvePendingEnvoys(sett.id, npcId);
    // Also resolve any of this player's quests whose timers expired so the
    // diplomacy panel reflects completed/failed status without forcing a
    // round-trip through the noticeboard.
    await resolveCompletedQuests(sett.id);

    const relRes = await query('SELECT * FROM diplomacy_relations WHERE settlement_id=$1 AND npc_id=$2', [sett.id, npcId]);
    const rel = relRes.rows[0];
    const trust = rel?.trust || 0;

    if (trust < QUEST_UNLOCK_TRUST) {
      return res.json({
        ok: true,
        locked: true,
        unlock_trust: QUEST_UNLOCK_TRUST,
        current_trust: trust,
        available: [],
        active: [],
      });
    }

    // Quests for this NPC at <= current trust.
    const qRes = await query(`
      SELECT * FROM quest_definitions
      WHERE archived = FALSE
        AND quest_source = 'settlement'
        AND given_by_npc_id = $1
        AND COALESCE(min_trust, 0) <= $2
      ORDER BY sort_order ASC, created_at ASC
    `, [npcId, trust]);

    // Active runs of this NPC's quests for this player. We tag runs by quest_id;
    // since NPC quest IDs are unique, that's enough — but we also re-join to the
    // quest definitions to make sure we only return runs whose def is still owned
    // by *this* NPC (in case admins reassign IDs later).
    const activeRes = await query(`
      SELECT sq.*, c.name as citizen_name, qd.given_by_npc_id, qd.title as def_title,
             qd.icon as def_icon, qd.duration_s as def_duration_s
      FROM settlement_quests sq
      LEFT JOIN citizens c ON c.id = sq.citizen_id
      LEFT JOIN quest_definitions qd ON qd.id = sq.quest_id
      WHERE sq.settlement_id=$1
        AND qd.given_by_npc_id=$2
        AND sq.status IN ('active','completed','failed')
      ORDER BY sq.started_at DESC
    `, [sett.id, npcId]);

    // Also pull party member names for active party runs.
    const active = await Promise.all(activeRes.rows.map(async row => {
      let partyNames = [];
      if (row.party_ids && row.party_ids.length > 0) {
        const pRes = await query('SELECT id, name FROM citizens WHERE id = ANY($1)', [row.party_ids]);
        partyNames = pRes.rows;
      }
      return { ...row, party_members: partyNames };
    }));

    res.json({
      ok: true,
      locked: false,
      unlock_trust: QUEST_UNLOCK_TRUST,
      current_trust: trust,
      available: qRes.rows,
      active,
    });
  } catch(e) {
    console.error('Diplomacy quests error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/diplomacy/:npcId/interact — legacy log endpoint ──
//    Kept for backward compatibility; the new UI uses /goodwill and /gift.
//    No envoy is sent, no gold is deducted; effect is immediate. Frontend does
//    not call this anymore but a tool/admin script might.
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
module.exports.GIFT_TIERS = GIFT_TIERS;
module.exports.QUEST_UNLOCK_TRUST = QUEST_UNLOCK_TRUST;
