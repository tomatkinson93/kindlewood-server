// ══════════════════════════════════════════════════════════════════════════
//  COMBAT — server-side resolution endpoint
//
//  First pass: small, focused. The browser runs the actual battle (state,
//  damage, AI, all of it) and posts the *outcome* here. Server is the keeper
//  of truth for persistent rewards: settlement wealth + a small combat-skill
//  bump on surviving citizens.
//
//  This kept the MVP a one-endpoint problem. When we add status effects,
//  injuries, or proper XP curves, this is where they hook in.
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const combatResolver = require('../lib/combat_resolver');

const router = express.Router();

// Anti-abuse: cap a single battle's reward so a malicious client can't just
// post {wealth_reward: 9999999}. Tunable.
const MAX_BATTLE_WEALTH = 200;
const COMBAT_SKILL_CAP = 10;

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
  };
}

// ── POST /api/combat/enemies — create new ───────────────────────────────
router.post('/enemies', requireAuth, async (req, res) => {
  try {
    const e = _validateEnemy(req.body, /*isNew=*/true);
    const dupe = await query('SELECT id FROM enemy_definitions WHERE id=$1', [e.id]);
    if (dupe.rows.length) return res.status(400).json({ error: 'An enemy with that id already exists.' });

    await query(
      `INSERT INTO enemy_definitions
       (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [e.id, e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility, e.endurance,
       e.combat_skill, e.attack_verb, e.reward_weight, e.sort_order]
    );
    res.json({ ok: true, enemy: e });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/combat/enemies/:id — update ──────────────────────────────
router.patch('/enemies/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await query('SELECT id FROM enemy_definitions WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Enemy not found.' });

    const e = _validateEnemy({ ...req.body, id }, /*isNew=*/false);

    await query(
      `UPDATE enemy_definitions SET
         name=$1, icon=$2, flavour=$3, max_hp=$4, strength=$5, agility=$6,
         endurance=$7, combat_skill=$8, attack_verb=$9, reward_weight=$10,
         sort_order=$11, updated_at=NOW()
       WHERE id=$12`,
      [e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility,
       e.endurance, e.combat_skill, e.attack_verb, e.reward_weight,
       e.sort_order, id]
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
router.delete('/enemies/:id', requireAuth, async (req, res) => {
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
router.post('/enemies/seed', requireAuth, async (req, res) => {
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

    res.json({ ok: true, battles, count: battles.length });
  } catch (e) {
    console.error('combat pending error', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/combat/engage/:questRunId — claim a battle ──
//    First call: rolls initial state from {party, encounter, seed} and stores
//    it on the quest run. Subsequent calls (resume after refresh/close) just
//    return the persisted state. The server is the source of truth — the
//    client never invents state.
router.post('/engage/:questRunId', requireAuth, async (req, res) => {
  try {
    const runId = parseInt(req.params.questRunId);
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const r = await query(
      `SELECT sq.*, qd.title as quest_title, qd.icon as quest_icon
       FROM settlement_quests sq
       LEFT JOIN quest_definitions qd ON qd.id = sq.quest_id
       WHERE sq.id=$1 AND sq.settlement_id=$2 AND sq.status='active'`,
      [runId, sett.id]
    );
    const run = r.rows[0];
    if (!run) return res.status(404).json({ error: 'Quest not found.' });
    if (!['pending', 'in_progress'].includes(run.combat_status)) {
      return res.status(400).json({ error: 'No battle awaiting on that quest.' });
    }

    let encounter = run.combat_encounter || [];
    if (typeof encounter === 'string') {
      try { encounter = JSON.parse(encounter); } catch(e) { encounter = []; }
    }
    if (!encounter.length) encounter = ['marsh_rat'];

    const partyIds = (run.quest_type === 'party' && Array.isArray(run.party_ids))
      ? run.party_ids
      : [run.citizen_id];

    // Mark in_progress (idempotent — re-engage is fine).
    await query(`UPDATE settlement_quests SET combat_status='in_progress' WHERE id=$1`, [runId]);

    // Resume path: persisted state already exists, hand it back. The action
    // log is the canonical history — we replay rather than trusting the
    // stored snapshot, which guards against state-poisoning if the JSON in
    // the DB were ever tampered with.
    let actions = run.combat_actions || [];
    if (typeof actions === 'string') {
      try { actions = JSON.parse(actions); } catch(e) { actions = []; }
    }
    if (!Array.isArray(actions)) actions = [];

    let replay;
    try {
      replay = await combatResolver.replayBattle({
        citizenIds: partyIds,
        enemyKeys: encounter,
        seed: parseInt(run.combat_seed) || 1,
        actions,
      });
    } catch (e) {
      console.error('engage replay failed', e);
      return res.status(500).json({ error: 'Battle state corrupt: ' + e.message });
    }

    const battle = combatResolver.serializeBattle(replay.battle);

    // Persist canonical snapshot so /pending lists can show current HPs.
    await query(
      `UPDATE settlement_quests SET combat_state=$1 WHERE id=$2`,
      [JSON.stringify(battle), runId]
    );

    res.json({
      ok: true,
      quest_run_id: runId,
      quest_title: run.quest_title || run.quest_id,
      quest_icon:  run.quest_icon || '⚔',
      encounter,
      seed: parseInt(run.combat_seed) || 1,
      battle,
      actions,
    });
  } catch (e) {
    console.error('combat engage error', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/combat/action/:questRunId — submit a player action ────────
//    Server replays the full action log + this new action, validates it's
//    the player's turn and the move is legal, and persists the new state.
//    Returns the canonical state. The client's local state is throwaway —
//    if it has drifted, the server's response is the truth.
router.post('/action/:questRunId', requireAuth, async (req, res) => {
  try {
    const runId = parseInt(req.params.questRunId);
    const { action_key, target_id } = req.body || {};
    if (!action_key) return res.status(400).json({ error: 'action_key required.' });

    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const r = await query(
      `SELECT * FROM settlement_quests WHERE id=$1 AND settlement_id=$2 AND status='active'`,
      [runId, sett.id]
    );
    const run = r.rows[0];
    if (!run) return res.status(404).json({ error: 'Quest not found.' });
    if (run.combat_status !== 'in_progress') {
      return res.status(400).json({ error: 'Battle not in progress.' });
    }

    let encounter = run.combat_encounter || [];
    if (typeof encounter === 'string') { try { encounter = JSON.parse(encounter); } catch(e){ encounter = []; } }
    if (!encounter.length) encounter = ['marsh_rat'];

    let actions = run.combat_actions || [];
    if (typeof actions === 'string') { try { actions = JSON.parse(actions); } catch(e){ actions = []; } }
    if (!Array.isArray(actions)) actions = [];

    const partyIds = (run.quest_type === 'party' && Array.isArray(run.party_ids))
      ? run.party_ids
      : [run.citizen_id];

    // Replay current state to find whose turn it is (we don't trust the
    // client's claim of who's acting). The action's actor_id is set server-side.
    let pre;
    try {
      pre = await combatResolver.replayBattle({
        citizenIds: partyIds, enemyKeys: encounter,
        seed: parseInt(run.combat_seed) || 1, actions,
      });
    } catch (e) {
      return res.status(500).json({ error: 'State corrupt: ' + e.message });
    }
    const cur = pre.nextActor;
    if (!cur || cur.side !== 'player') {
      return res.status(400).json({ error: "Not the player's turn." });
    }

    const newAction = { actor_id: cur.id, action_key, target_id: target_id || null };
    const nextActions = actions.concat([newAction]);

    let post;
    try {
      post = await combatResolver.replayBattle({
        citizenIds: partyIds, enemyKeys: encounter,
        seed: parseInt(run.combat_seed) || 1, actions: nextActions,
      });
    } catch (e) {
      return res.status(400).json({ error: 'Invalid move: ' + e.message });
    }

    const battle = combatResolver.serializeBattle(post.battle);

    // Persist new state + log.
    await query(
      `UPDATE settlement_quests SET combat_state=$1, combat_actions=$2 WHERE id=$3`,
      [JSON.stringify(battle), JSON.stringify(nextActions), runId]
    );

    res.json({
      ok: true,
      battle,
      actions: nextActions,
      battle_ended: battle.status !== 'active',
    });
  } catch (e) {
    console.error('combat action error', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/resolve', requireAuth, async (req, res) => {
  try {
    // Note: for *quest-linked* battles we ignore the client's claimed outcome
    // and reward entirely. The server replays the persisted action log and
    // derives the truth. The client's submission acts only as a "I'm done,
    // please tally up" trigger. For non-quest test battles (Dev Tools button)
    // we still trust the client because there's no server state to verify
    // against — but rewards stay capped by MAX_BATTLE_WEALTH so even a bad
    // actor can't print money.
    const { outcome: clientOutcome, wealth_reward, citizen_ids, quest_run_id } = req.body || {};

    const settRes = await query('SELECT id, wealth FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    let questRun = null;
    let serverOutcome = null;
    let serverReward = 0;
    let serverSurvivors = [];
    let serverFallen = [];
    let serverLog = [];

    if (quest_run_id) {
      const r = await query(
        `SELECT * FROM settlement_quests WHERE id=$1 AND settlement_id=$2`,
        [quest_run_id, sett.id]
      );
      questRun = r.rows[0];
      if (!questRun) return res.status(404).json({ error: 'Quest run not found.' });
      if (!['pending', 'in_progress', 'rolled'].includes(questRun.combat_status)) {
        return res.status(400).json({ error: 'No active battle on that quest.' });
      }

      // ── Replay-verify: replay the persisted action log, derive truth.
      let actions = questRun.combat_actions || [];
      if (typeof actions === 'string') { try { actions = JSON.parse(actions); } catch(e){ actions = []; } }
      let encounter = questRun.combat_encounter || [];
      if (typeof encounter === 'string') { try { encounter = JSON.parse(encounter); } catch(e){ encounter = []; } }
      if (!encounter.length) encounter = ['marsh_rat'];
      const partyIds = (questRun.quest_type === 'party' && Array.isArray(questRun.party_ids))
        ? questRun.party_ids
        : [questRun.citizen_id];

      let replay;
      try {
        replay = await combatResolver.replayBattle({
          citizenIds: partyIds, enemyKeys: encounter,
          seed: parseInt(questRun.combat_seed) || 1, actions,
        });
      } catch (e) {
        console.error('resolve replay failed', e);
        return res.status(500).json({ error: 'Could not verify battle: ' + e.message });
      }

      if (replay.battle.status === 'active') {
        return res.status(400).json({ error: 'Battle is not yet finished.' });
      }
      serverOutcome = replay.battle.status;  // 'victory' | 'defeat'
      serverReward  = (replay.battle.reward && replay.battle.reward.wealth) || 0;
      serverLog     = replay.battle.log.slice();
      serverSurvivors = replay.battle.units
        .filter(u => u.side === 'player' && !u.flags.downed)
        .map(u => ({ id: u.citizen_id, name: u.name, hp: u.hp }));
      serverFallen = replay.battle.units
        .filter(u => u.side === 'player' && u.flags.downed)
        .map(u => ({ id: u.citizen_id, name: u.name }));

      // ── Hybrid acceptance: if the client claims worse-than-or-equal,
      //    accept silently; if the client claims better, log a warning.
      //    Either way the SERVER outcome wins.
      if (clientOutcome && clientOutcome !== serverOutcome) {
        const clientClaimedBetter = clientOutcome === 'victory' && serverOutcome === 'defeat';
        if (clientClaimedBetter) {
          console.warn('[anti-cheat] resolve: client claimed victory, server says defeat. quest_run_id=' + quest_run_id);
        }
      }
    }

    // ── Defeat path. Quest fails; nothing for the citizens.
    if ((questRun && serverOutcome === 'defeat') || (!questRun && clientOutcome !== 'victory')) {
      if (questRun) {
        await query(
          `UPDATE settlement_quests
           SET combat_status='resolved', combat_outcome='defeat',
               combat_resolved_at=NOW(), combat_log=$1,
               status='failed', completes_at=NOW(),
               combat_clock_paused_at=NULL
           WHERE id=$2`,
          [JSON.stringify(serverLog), quest_run_id]
        );
      }
      return res.json({
        ok: true,
        wealth_after: sett.wealth,
        outcome: 'defeat',
        quest_failed: !!questRun,
        survivors: serverSurvivors,
        fallen: serverFallen,
      });
    }

    // ── Victory path. Reward comes from server replay (quest battles) or
    //    capped client claim (test battles).
    const claimedWealth = parseInt(wealth_reward) || 0;
    const wealth = questRun
      ? Math.max(0, Math.min(MAX_BATTLE_WEALTH, serverReward))
      : Math.max(0, Math.min(MAX_BATTLE_WEALTH, claimedWealth));

    let wealthAfter = sett.wealth;
    if (wealth > 0) {
      const upd = await query(
        'UPDATE settlements SET wealth = wealth + $1 WHERE id=$2 RETURNING wealth',
        [wealth, sett.id]
      );
      wealthAfter = upd.rows[0]?.wealth ?? sett.wealth + wealth;
    }

    // Bump combat skill on surviving citizens. For quest battles we use the
    // server-derived survivor list; for test battles we still take the
    // client's word (no truth to verify against).
    let upgraded = [];
    const skillBumpIds = questRun
      ? serverSurvivors.map(s => s.id).filter(Boolean)
      : (Array.isArray(citizen_ids) ? citizen_ids.map(Number).filter(Boolean) : []);
    if (skillBumpIds.length) {
      const own = await query(
        'SELECT id, name, skills FROM citizens WHERE id = ANY($1) AND settlement_id=$2',
        [skillBumpIds, sett.id]
      );
      for (const c of own.rows) {
        if (Math.random() > 0.5) continue;
        const skills = c.skills || {};
        const cur = skills.combat || 1;
        if (cur >= COMBAT_SKILL_CAP) continue;
        skills.combat = cur + 1;
        await query('UPDATE citizens SET skills=$1 WHERE id=$2', [skills, c.id]);
        upgraded.push({ id: c.id, name: c.name, combat: skills.combat });
      }
    }

    // Quest clock resumption — extend completes_at by the pause duration so
    // ignoring a battle for hours doesn't shorten the quest.
    if (questRun) {
      const pausedAt = questRun.combat_clock_paused_at;
      let pauseMs = 0;
      if (pausedAt) {
        pauseMs = Date.now() - new Date(pausedAt).getTime();
        if (pauseMs < 0) pauseMs = 0;
      }
      await query(
        `UPDATE settlement_quests
         SET combat_status='resolved', combat_outcome='victory',
             combat_resolved_at=NOW(), combat_log=$1,
             combat_clock_paused_at=NULL,
             completes_at = completes_at + ($2 || ' milliseconds')::interval
         WHERE id=$3`,
        [JSON.stringify(serverLog), String(pauseMs), quest_run_id]
      );
    }

    res.json({
      ok: true,
      outcome: 'victory',
      wealth_awarded: wealth,
      wealth_after: wealthAfter,
      upgraded_citizens: upgraded,
      quest_resumed: !!questRun,
      survivors: serverSurvivors,
      fallen: serverFallen,
    });
  } catch (e) {
    console.error('Combat resolve error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
