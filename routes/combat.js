// ══════════════════════════════════════════════════════════════════════════
//  /api/combat — what stands around a battle: the creatures a quest can
//  meet, the list of battles that wait on the player, giving one up, the
//  report of one that is over, and a citizen's injuries.
//
//    GET    /enemies, POST/PATCH/DELETE /enemies…   the creature editor (Dev Tools)
//    GET    /pending                  battles waiting on the player (the Battles list)
//    POST   /forfeit/:questRunId      give one up: the quest fails
//    GET    /report/:questRunId       how a battle went ("View Battle")
//    GET    /citizen/:id/events       a citizen's scars and memories
//    POST   /admin/inflict, /admin/heal
//
//  The battle itself is fought on the board: POST /api/tactics/quest/:id
//  opens it (lib/tactics_quests.js) and /api/tactics/battles/:id/act plays
//  it. Until 2026-11-26 it was fought here with cards (/engage, /action,
//  /resolve); those routes went with the card battler (docs/TACTICS.md §8).
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const combatResolver = require('../lib/combat_resolver');
const eventBus = require('../lib/event_bus');

const router = express.Router();

// ── Enemy definitions ────────────────────────────────────────────────────
// Default seed roster — kept in sync with the engine's hardcoded fallback so
// that an admin who hits "Seed Defaults" gets back to the original three
// without needing a fresh DB. Add new entries here when introducing new
// stock enemies.
const DEFAULT_ENEMIES = [
  { id: 'marsh_rat',   name: 'Marsh Rat',   icon: '🐀', flavour: 'A scrappy biter, quick on its feet.',
    max_hp: 22, strength: 5, agility: 9,  endurance: 4, combat_skill: 2, attack_verb: 'bites',     reward_weight: 1, sort_order: 10 },
  { id: 'wild_fox',    name: 'Wild Fox',    icon: '🦊', flavour: 'Cunning. Will harry the weakest.',
    max_hp: 30, strength: 7, agility: 11, endurance: 5, combat_skill: 3, attack_verb: 'lunges at', reward_weight: 2, sort_order: 20 },
  { id: 'fungal_toad', name: 'Fungal Toad', icon: '🐸', flavour: 'Slow and bloated, but surprisingly tough.',
    max_hp: 42, strength: 8, agility: 4,  endurance: 9, combat_skill: 2, attack_verb: 'slams into', reward_weight: 3, sort_order: 30 },
];

// ── GET /api/combat/enemies — list all (non-archived by default) ────────
router.get('/enemies', requireAuth, async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === '1';
    const r = await query(
      'SELECT * FROM enemy_definitions' +
      (includeArchived ? '' : ' WHERE archived = FALSE') +
      ' ORDER BY sort_order ASC, id ASC'
    );
    res.json({ ok: true, enemies: r.rows });
  } catch (e) {
    console.error('list enemies error', e);
    res.status(500).json({ error: e.message });
  }
});

const timeGates = require('../lib/time_gates');
const _jsonOrNull = (v) => (v == null ? null : JSON.stringify(v));

// Validate + sanitise an enemy payload coming from the admin form. Returns
// the cleaned object or throws an Error explaining what's wrong.
function _validateEnemy(body, isNew) {
  if (!body) throw new Error('Empty body.');
  const id = (body.id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (isNew && !id) throw new Error('id is required.');
  const name = (body.name || '').trim();
  if (!name) throw new Error('name is required.');

  const intIn = (v, lo, hi, dflt) => {
    const n = parseInt(v);
    if (isNaN(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  };

  // Sanitise the moves array. Each move: key, name, formula, target, hit,
  // pierce params, intent, weight. Formula is validated lightly here (full
  // validation lives in the formula module; the engine also guards at runtime).
  const VALID_HITS = ['choose', 'front', 'pierce', 'aoe'];
  const VALID_TARGETS = ['enemy', 'self', 'ally', 'all_enemies', 'all_allies', 'choose'];
  const VALID_INTENTS = ['attack', 'block', 'buff', 'debuff', 'move', 'special'];
  const moves = Array.isArray(body.moves) ? body.moves.slice(0, 12).map((m, i) => {
    const key = (m.key || ('move_' + (i + 1))).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return {
      key,
      name: (m.name || 'Move').toString().slice(0, 40),
      formula: (m.formula || '').toString().slice(0, 500),
      target: VALID_TARGETS.includes(m.target) ? m.target : 'enemy',
      hit: VALID_HITS.includes(m.hit) ? m.hit : 'choose',
      pierce_count: (m.pierce_count != null && m.pierce_count !== '') ? intIn(m.pierce_count, 1, 10, null) : null,
      pierce_falloff: (m.pierce_falloff != null && m.pierce_falloff !== '') ? Math.max(0, Math.min(1, Number(m.pierce_falloff))) : 1.0,
      intent: VALID_INTENTS.includes(m.intent) ? m.intent : 'attack',
      weight: intIn(m.weight, 1, 100, 1),
      sfx: (m.sfx || '').toString().slice(0, 80),
    };
  }) : [];

  const drops = Array.isArray(body.drops) ? body.drops.slice(0, 20).map((d) => ({
    item: (d.item || '').toString().slice(0, 60),
    chance: Math.max(0, Math.min(1, Number(d.chance != null ? d.chance : 1))),
    min: intIn(d.min, 0, 999, 1),
    max: intIn(d.max, 0, 999, 1),
  })).filter(d => d.item) : [];

  const move_mode = (body.move_mode === 'weighted') ? 'weighted' : 'sequence';
  let hp_min = (body.hp_min != null && body.hp_min !== '') ? intIn(body.hp_min, 1, 500, null) : null;
  let hp_max = (body.hp_max != null && body.hp_max !== '') ? intIn(body.hp_max, 1, 500, null) : null;
  if (hp_min != null && hp_max != null && hp_min > hp_max) { const t = hp_min; hp_min = hp_max; hp_max = t; }

  return {
    id,
    name,
    icon:      (body.icon || '👹').slice(0, 8),
    flavour:   (body.flavour || '').slice(0, 280),
    max_hp:        intIn(body.max_hp,        1,   500, 20),
    strength:      intIn(body.strength,      0,   50,  5),
    agility:       intIn(body.agility,       0,   50,  5),
    endurance:     intIn(body.endurance,     0,   50,  5),
    combat_skill:  intIn(body.combat_skill,  0,   20,  1),
    attack_verb:   (body.attack_verb || 'strikes').trim().slice(0, 40),
    reward_weight: intIn(body.reward_weight, 0,   10,  1),
    sort_order:    intIn(body.sort_order,    0,   9999, 100),
    moves, move_mode, hp_min, hp_max, drops,
    // Time gates (spec 021): known ids only; none selected → NULL ("any").
    active_phases: timeGates.cleanPhases(body.active_phases),
    moon_phases:   timeGates.cleanMoons(body.moon_phases),
  };
}

// ── POST /api/combat/enemies — create new ───────────────────────────────
router.post('/enemies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const e = _validateEnemy(req.body, /*isNew=*/true);
    const dupe = await query('SELECT id FROM enemy_definitions WHERE id=$1', [e.id]);
    if (dupe.rows.length) return res.status(400).json({ error: 'An enemy with that id already exists.' });

    await query(
      `INSERT INTO enemy_definitions
       (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order, moves, move_mode, hp_min, hp_max, drops, active_phases, moon_phases)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [e.id, e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility, e.endurance,
       e.combat_skill, e.attack_verb, e.reward_weight, e.sort_order,
       JSON.stringify(e.moves), e.move_mode, e.hp_min, e.hp_max, JSON.stringify(e.drops),
       _jsonOrNull(e.active_phases), _jsonOrNull(e.moon_phases)]
    );
    res.json({ ok: true, enemy: e });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/combat/enemies/:id — update ──────────────────────────────
router.patch('/enemies/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await query('SELECT id FROM enemy_definitions WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Enemy not found.' });

    const e = _validateEnemy({ ...req.body, id }, /*isNew=*/false);

    await query(
      `UPDATE enemy_definitions SET
         name=$1, icon=$2, flavour=$3, max_hp=$4, strength=$5, agility=$6,
         endurance=$7, combat_skill=$8, attack_verb=$9, reward_weight=$10,
         sort_order=$11, moves=$12, move_mode=$13, hp_min=$14, hp_max=$15,
         drops=$16, active_phases=$17, moon_phases=$18, updated_at=NOW()
       WHERE id=$19`,
      [e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility,
       e.endurance, e.combat_skill, e.attack_verb, e.reward_weight,
       e.sort_order, JSON.stringify(e.moves), e.move_mode, e.hp_min, e.hp_max,
       JSON.stringify(e.drops), _jsonOrNull(e.active_phases), _jsonOrNull(e.moon_phases), id]
    );
    res.json({ ok: true, enemy: { ...e, id } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /api/combat/enemies/:id — soft delete (archive) ──────────────
// We never hard-delete: an enemy id may be referenced in old battle logs or
// future encounter tables, so flipping `archived` keeps history intact while
// hiding it from the active roster. A second DELETE call hard-deletes if the
// enemy was already archived (escape hatch for cleanup).
router.delete('/enemies/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const r = await query('SELECT archived FROM enemy_definitions WHERE id=$1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Enemy not found.' });
    if (r.rows[0].archived) {
      await query('DELETE FROM enemy_definitions WHERE id=$1', [id]);
      return res.json({ ok: true, deleted: true });
    }
    await query('UPDATE enemy_definitions SET archived=TRUE WHERE id=$1', [id]);
    res.json({ ok: true, archived: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/combat/enemies/seed — insert defaults (idempotent) ────────
// Only inserts rows whose id isn't already present, so an admin who has
// customised an existing enemy won't have their changes overwritten. Use
// `?force=1` to re-overwrite all defaults (resets to the bundled stats).
router.post('/enemies/seed', requireAuth, requireAdmin, async (req, res) => {
  try {
    const force = req.query.force === '1';
    let inserted = 0, updated = 0;
    for (const e of DEFAULT_ENEMIES) {
      if (force) {
        await query(
          `INSERT INTO enemy_definitions
           (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order, archived)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, icon=EXCLUDED.icon, flavour=EXCLUDED.flavour,
             max_hp=EXCLUDED.max_hp, strength=EXCLUDED.strength, agility=EXCLUDED.agility,
             endurance=EXCLUDED.endurance, combat_skill=EXCLUDED.combat_skill,
             attack_verb=EXCLUDED.attack_verb, reward_weight=EXCLUDED.reward_weight,
             sort_order=EXCLUDED.sort_order, archived=FALSE, updated_at=NOW()`,
          [e.id, e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility, e.endurance,
           e.combat_skill, e.attack_verb, e.reward_weight, e.sort_order]
        );
        updated++;
      } else {
        const exists = await query('SELECT id FROM enemy_definitions WHERE id=$1', [e.id]);
        if (exists.rows.length) continue;
        await query(
          `INSERT INTO enemy_definitions
           (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [e.id, e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility, e.endurance,
           e.combat_skill, e.attack_verb, e.reward_weight, e.sort_order]
        );
        inserted++;
      }
    }
    res.json({ ok: true, inserted, updated, total: DEFAULT_ENEMIES.length });
  } catch (e) {
    console.error('enemy seed error', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/combat/pending — list battles awaiting player engagement ──
//    Polled by the Battles menu in the nav bar. Returns lightweight rows;
//    full encounter spec is fetched at engage time.
router.get('/pending', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.json({ ok: true, battles: [] });

    // Run trigger processing so any auto-resolves complete and any new
    // pending battles surface here on the next request after their trigger.
    try {
      const quests = require('./quests');
      if (quests.processCombatTriggers) await quests.processCombatTriggers(sett.id);
    } catch (e) { /* non-fatal */ }

    const r = await query(
      `SELECT sq.id, sq.quest_id, sq.quest_type, sq.party_ids, sq.citizen_id,
              sq.combat_status, sq.combat_encounter, sq.combat_trigger_at,
              sq.completes_at, sq.combat_clock_paused_at,
              c.name as citizen_name,
              qd.title as quest_title, qd.icon as quest_icon
       FROM settlement_quests sq
       LEFT JOIN citizens c ON c.id = sq.citizen_id
       LEFT JOIN quest_definitions qd ON qd.id = sq.quest_id
       WHERE sq.settlement_id=$1 AND sq.status='active'
         AND sq.combat_status IN ('pending','in_progress')
       ORDER BY sq.combat_trigger_at ASC NULLS LAST`,
      [sett.id]
    );

    // Pull party member names so the UI can show "Petra & Wren" without an extra round-trip.
    const battles = await Promise.all(r.rows.map(async row => {
      let partyNames = [];
      if (Array.isArray(row.party_ids) && row.party_ids.length) {
        const p = await query('SELECT id, name FROM citizens WHERE id = ANY($1)', [row.party_ids]);
        partyNames = p.rows;
      }
      return { ...row, party_members: partyNames };
    }));

    // `board_battle`: the quest's battle on the board, if it has been begun (lib/tactics_quests.js).
    const begun = battles.length ? (await query(`SELECT id, quest_run_id FROM tactics_battles WHERE settlement_id=$1 AND status='active' AND quest_run_id = ANY($2::int[])`, [sett.id, battles.map(b => b.id)])).rows : [];
    for (const b of battles) { const on = begun.find(x => Number(x.quest_run_id) === Number(b.id)); b.board_battle = on ? Number(on.id) : null; }
    // Who a creature is on the board (lib/tactics_foes.js), for the list to name once battles are fought there.
    { const F = require('../lib/tactics_foes'); for (const b of battles) { const enc = Array.isArray(b.combat_encounter) ? b.combat_encounter : []; b.board_foes = enc.map(k => (F.foe(k) || {}).name || null).filter(Boolean); } }
    res.json({ ok: true, battles, count: battles.length, board: 'on' });
  } catch (e) {
    console.error('combat pending error', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/forfeit/:questRunId', requireAuth, async (req, res) => {
  try {
    const runId = parseInt(req.params.questRunId);
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const r = await query(
      'SELECT id, combat_status, dungeon_run_id FROM settlement_quests WHERE id=$1 AND settlement_id=$2',
      [runId, sett.id]
    );
    const run = r.rows[0];
    if (!run) return res.status(404).json({ error: 'Quest not found.' });
    if (!['rolled', 'pending', 'in_progress'].includes(run.combat_status)) {
      return res.status(400).json({ error: 'No battle to forfeit on that quest.' });
    }
    await query(
      `UPDATE settlement_quests
       SET combat_status='resolved', combat_outcome='defeat',
           combat_resolved_at=NOW(),
           combat_log=$1,
           status='failed', completes_at=NOW(),
           combat_clock_paused_at=NULL
       WHERE id=$2`,
      [JSON.stringify(['The party forfeited.']), runId]
    );
    // Its battle on the board, if it was being fought there, is closed with it.
    await require('../lib/tactics_quests').closeFor(runId);

    // Push: forfeit ends both the battle and the quest.
    eventBus.publish(sett.id, {
      type: 'combat_resolved',
      quest_run_id: runId,
      outcome: 'defeat',
    });
    eventBus.publish(sett.id, {
      type: 'quest_resolved',
      quest_run_id: runId,
      outcome: 'failed',
    });

    res.json({ ok: true, quest_failed: true });
  } catch (e) {
    console.error('forfeit error', e);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  INJURY ENDPOINTS — read citizen history, manually inflict/heal (admin)
// ══════════════════════════════════════════════════════════════════════════

// GET /api/combat/report/:questRunId — after-action report for a battle
//    Returns: outcome, encounter, party (with hp end-states), log, rewards,
//    injuries that resulted from this battle.
//    Used by the "View Battle" button on collectible quest cards.
router.get('/report/:questRunId', requireAuth, async (req, res) => {
  try {
    const runId = parseInt(req.params.questRunId);
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const r = await query(
      `SELECT sq.*, qd.title as quest_title, qd.icon as quest_icon, qd.reward_gold
       FROM settlement_quests sq
       LEFT JOIN quest_definitions qd ON qd.id = sq.quest_id
       WHERE sq.id=$1 AND sq.settlement_id=$2`,
      [runId, sett.id]
    );
    const run = r.rows[0];
    if (!run) return res.status(404).json({ error: 'Quest run not found.' });
    if (!run.combat_outcome) {
      return res.status(404).json({ error: 'No battle on this quest.' });
    }

    // Pull party + citizen names
    const partyIds = (run.quest_type === 'party' && Array.isArray(run.party_ids))
      ? run.party_ids
      : [run.citizen_id].filter(Boolean);
    const partyRes = partyIds.length
      ? await query('SELECT id, name, life_stage FROM citizens WHERE id = ANY($1)', [partyIds])
      : { rows: [] };

    // Pull any citizen_events that came out of this battle (the
    // source_battle_id column is the quest_run_id we just queried).
    const eventsRes = await query(
      `SELECT id, citizen_id, event_type, severity, body_part, narrative, occurred_at
       FROM citizen_events WHERE source_battle_id=$1
       ORDER BY occurred_at ASC`,
      [runId]
    );

    // Battle state (the engine snapshot) tells us final HPs and who fell.
    let battleState = run.combat_state;
    if (typeof battleState === 'string') {
      try { battleState = JSON.parse(battleState); } catch(e) { battleState = null; }
    }
    let combatLog = run.combat_log;
    if (typeof combatLog === 'string') {
      try { combatLog = JSON.parse(combatLog); } catch(e) { combatLog = []; }
    }
    let encounter = run.combat_encounter;
    if (typeof encounter === 'string') {
      try { encounter = JSON.parse(encounter); } catch(e) { encounter = []; }
    }

    res.json({
      ok: true,
      quest_run_id: runId,
      quest_title: run.quest_title || run.quest_id,
      quest_icon:  run.quest_icon || '⚔',
      outcome:     run.combat_outcome,
      encounter:   encounter || [],
      log:         combatLog || [],
      battle_state: battleState,
      // Fought on the board (lib/tactics_quests.js): who they fought there, by name.
      foes: (battleState && battleState.board && Array.isArray(battleState.foes)) ? battleState.foes : null,
      party:       partyRes.rows,
      injury_events: eventsRes.rows,
      reward_wealth: run.combat_outcome === 'victory' ? (run.reward_gold || 0) : 0,
      resolved_at: run.combat_resolved_at,
    });
  } catch (e) {
    console.error('combat report error', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/combat/citizen/:id/events — full event log for a citizen
//    Used by the citizen profile to show "Scars & Memories". Permission:
//    citizen must belong to the requesting user's settlement.
router.get('/citizen/:id/events', requireAuth, async (req, res) => {
  try {
    const citId = parseInt(req.params.id);
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const own = await query('SELECT id FROM citizens WHERE id=$1 AND settlement_id=$2', [citId, sett.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'Citizen not found.' });

    const events = await query(
      `SELECT id, event_type, severity, body_part, narrative, source_battle_id, occurred_at
       FROM citizen_events
       WHERE citizen_id=$1 AND event_type IN ('injury','death')   -- career history lives in the Career tab
       ORDER BY occurred_at DESC`,
      [citId]
    );
    const conditions = await query(
      `SELECT id, condition_type, body_part, severity, stat_modifiers, acquired_at, expires_at
       FROM citizen_conditions
       WHERE citizen_id=$1
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY acquired_at DESC`,
      [citId]
    );

    res.json({
      ok: true,
      citizen_id: citId,
      events: events.rows,
      conditions: conditions.rows,
    });
  } catch (e) {
    console.error('citizen events fetch error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/combat/admin/inflict — DEV ONLY. Manually inflict an injury.
// Body: { citizen_id, severity?, body_part? } — any omitted field is rolled.
router.post('/admin/inflict', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { citizen_id, severity, body_part } = req.body || {};
    const cid = parseInt(citizen_id);
    if (!cid) return res.status(400).json({ error: 'citizen_id required.' });
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const cit = await query(
      'SELECT id, name, life_stage, born_at FROM citizens WHERE id=$1 AND settlement_id=$2',
      [cid, sett.id]
    );
    if (!cit.rows.length) return res.status(404).json({ error: 'Citizen not found.' });
    const citizen = cit.rows[0];

    // Use the same roll machinery so admin injuries look like normal ones.
    // If severity/body_part overrides are provided, splice them in afterwards.
    const rolled = combatResolver.rollInjuryFor({ life_stage: citizen.born_at ? require('../lib/life').stageOf(citizen) : citizen.life_stage });
    if (severity) {
      rolled.severity = severity;
      // Recompute stat modifiers & heal_days for the overridden severity
      const INJURY_TABLE = require('../lib/injury_table');
      const cfg = INJURY_TABLE.SEVERITY_EFFECTS[severity];
      if (cfg) {
        rolled.stat_modifiers = { ...(cfg.modifiers_by_part[rolled.body_part] || {}) };
        rolled.heal_days = cfg.heal_days;
      }
    }
    if (body_part) {
      rolled.body_part = body_part;
      const INJURY_TABLE = require('../lib/injury_table');
      const cfg = INJURY_TABLE.SEVERITY_EFFECTS[rolled.severity];
      if (cfg) rolled.stat_modifiers = { ...(cfg.modifiers_by_part[body_part] || {}) };
    }

    // Write directly using the resolver's internal flow. We synthesize a
    // minimal "battle" stub with one player + one enemy so narrative templates
    // have an antagonist to name.
    const fakeBattle = {
      units: [
        { side: 'player', citizen_id: citizen.id, name: citizen.name, flags: { downed: true } },
        { side: 'enemy', name: 'a Dev Tools incident' },
      ],
    };
    const events = await combatResolver.applyBattleAftermath({
      battle: fakeBattle,
      outcome: 'defeat',     // force the roll path
      settlementId: sett.id,
      questRunId: null,
      encounter: [],
    });

    res.json({ ok: true, events });
  } catch (e) {
    console.error('admin inflict error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/combat/admin/heal — DEV ONLY. Clear all active conditions on a citizen.
router.post('/admin/heal', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { citizen_id } = req.body || {};
    const cid = parseInt(citizen_id);
    if (!cid) return res.status(400).json({ error: 'citizen_id required.' });
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const own = await query('SELECT id FROM citizens WHERE id=$1 AND settlement_id=$2', [cid, sett.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'Citizen not found.' });

    const r = await query('DELETE FROM citizen_conditions WHERE citizen_id=$1', [cid]);
    res.json({ ok: true, conditions_removed: r.rowCount });
  } catch (e) {
    console.error('admin heal error', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
