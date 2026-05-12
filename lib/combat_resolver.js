// ══════════════════════════════════════════════════════════════════════════
//  COMBAT RESOLVER (server-side)
//
//  Headlessly simulates a battle for auto-resolution. Used by:
//    - settlement_quests with auto_resolve_combat=true and combat_status='rolled'
//      whose trigger time has passed.
//
//  The result is deterministic given the seed: the same {party, encounter,
//  seed} always produces the same outcome. This means we can replay battles
//  for inspection, or move the simulation between client and server without
//  the result changing.
// ══════════════════════════════════════════════════════════════════════════

const E = require('./combat_engine');
const { query } = require('../db');

// Build a player citizen unit shape compatible with engine.unitFromCitizen.
// settlement_quests stores citizen ids; we resolve them here so the engine
// gets the same shape it would in the browser.
//
// NB: this re-fetches the live citizen rows on every replay. If a citizen's
// stats were changed mid-battle (e.g. through admin tools), determinism
// would break — turn order recomputes from agility, so a different agility
// produces a different turn_order and the action log's actor_ids fail to
// align. Treating this as acceptable: in normal play stats don't mutate
// during an active battle. If that assumption ever loosens, snapshot the
// citizen rows into combat_state at engage time and read from there.
async function _loadCitizens(citizenIds) {
  if (!citizenIds || !citizenIds.length) return [];
  const r = await query(
    'SELECT id, name, role, life_stage, stats, skills, visible_traits, hidden_traits FROM citizens WHERE id = ANY($1)',
    [citizenIds]
  );
  const citizens = r.rows;

  // Fold in active condition modifiers so injured citizens fight worse.
  // We do this once per battle load (not per replay frame) — the conditions
  // are presumed stable for the duration of a single combat. For long-lived
  // manual battles, this means an injury that expires mid-battle won't kick
  // in until the next fight. Acceptable for now.
  const condRows = await query(
    `SELECT citizen_id, stat_modifiers FROM citizen_conditions
     WHERE citizen_id = ANY($1)
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [citizenIds]
  ).catch(() => ({ rows: [] }));

  // Group by citizen
  const modsByCit = {};
  for (const row of condRows.rows) {
    const m = row.stat_modifiers || {};
    if (!modsByCit[row.citizen_id]) modsByCit[row.citizen_id] = {};
    for (const [k, v] of Object.entries(m)) {
      modsByCit[row.citizen_id][k] = (modsByCit[row.citizen_id][k] || 0) + v;
    }
  }

  // Apply: stats fields are { strength, agility, endurance, intelligence, charisma }
  // Skills fields include 'combat'. The injury table can hit either; we apply
  // to whichever side the key belongs to. APPLY_CAP_FLOOR_PCT floors stats so
  // a heavily-scarred citizen never drops below 50% of their base.
  for (const cit of citizens) {
    const mods = modsByCit[cit.id];
    if (!mods) continue;
    const stats = { ...(cit.stats || {}) };
    const skills = { ...(cit.skills || {}) };
    for (const [key, delta] of Object.entries(mods)) {
      if (key in stats) {
        const base = stats[key];
        const floor = Math.floor(base * APPLY_CAP_FLOOR_PCT);
        stats[key] = Math.max(floor, base + delta);
      } else if (key in skills) {
        // Skills floor at 1 — losing combat down to 0 makes the citizen
        // useless and the math edge-cases compound.
        skills[key] = Math.max(1, (skills[key] || 1) + delta);
      }
    }
    cit.stats = stats;
    cit.skills = skills;
  }

  return citizens;
}

// Override the engine's enemy roster with whatever's in the DB right now,
// matching what the client does at the start of a battle.
async function _loadEnemyRoster() {
  try {
    const r = await query('SELECT * FROM enemy_definitions WHERE archived = FALSE');
    if (!r.rows.length) return; // engine keeps its bundled defaults
    const fresh = {};
    for (const row of r.rows) {
      fresh[row.id] = {
        key: row.id,
        name: row.name,
        icon: row.icon,
        flavour: row.flavour || '',
        stats: {
          maxHp:       row.max_hp,
          strength:    row.strength,
          agility:     row.agility,
          endurance:   row.endurance,
          combatSkill: row.combat_skill,
        },
        reward_weight: row.reward_weight,
        attack_verb: row.attack_verb,
      };
    }
    // Overwrite the engine's _enemies via the public API. The engine doesn't
    // expose a setter, so we cheat-patch via the function form: ENEMIES()
    // returns the live working copy, and Object.assign mutates it.
    const live = E.ENEMIES();
    for (const k of Object.keys(live)) delete live[k];
    Object.assign(live, fresh);
  } catch (e) { /* fall back to defaults silently */ }
}

// Run a full headless battle. Returns the final state's outcome metadata.
// The engine itself is the source of truth — we just drive it turn by turn
// using a small heuristic for the player side (same logic as our test
// harness): attack the lowest-HP enemy each turn unless stamina lets us
// use a skill, in which case ~30% chance to use it.
async function autoResolveBattle({ citizenIds, enemyKeys, seed }) {
  await _loadEnemyRoster();

  const citizens = await _loadCitizens(citizenIds);
  if (!citizens.length) {
    return { outcome: 'defeat', log: ['No party.'], reward: { wealth: 0 }, rounds: 0 };
  }

  E.setRng(E.makeSeededRng(seed | 0 || 1));

  // Local tactical-choice RNG, derived from the same seed so the whole
  // simulation is reproducible from {party, encounter, seed}. We use a
  // separate stream so engine damage-rolls aren't perturbed when we change
  // tactics later.
  const tacticalRng = E.makeSeededRng((seed | 0 || 1) ^ 0xdecaf);

  try {
    const battle = E.createBattle({
      players: citizens,
      enemies: enemyKeys || [],
    });

    let safety = 0;
    while (battle.status === 'active' && safety++ < 500) {
      const cur = E.currentUnit(battle);
      if (!cur) break;
      if (cur.side === 'player') {
        const targets = E.aliveOnSide(battle, 'enemy');
        if (!targets.length) break;
        const weakest = targets.slice().sort((a, b) => a.hp - b.hp)[0];
        const skill = E.getAction('skill');
        const useSkill = cur.stamina >= skill.stamina_cost && tacticalRng() < 0.3;
        E.performAction(battle, useSkill ? 'skill' : 'attack', weakest.id);
      } else {
        const choice = E.chooseAITargetAndAction(battle, cur);
        if (!choice) break;
        E.performAction(battle, choice.actionKey, choice.targetId);
      }
    }

    return {
      outcome: battle.status === 'victory' ? 'victory' :
               battle.status === 'defeat'  ? 'defeat'  : 'incomplete',
      log: battle.log.slice(),
      reward: battle.reward || { wealth: 0 },
      rounds: battle.round,
      survivors: E.aliveOnSide(battle, 'player').map(u => ({ id: u.citizen_id, name: u.name, hp: u.hp })),
      fallen: battle.units
        .filter(u => u.side === 'player' && u.flags.downed)
        .map(u => ({ id: u.citizen_id, name: u.name })),
      // Battle object is exposed so callers (e.g. processCombatTriggers)
      // can pass it through to applyBattleAftermath without re-running.
      battle,
    };
  } finally {
    E.setRng(null);
  }
}

module.exports = {
  autoResolveBattle,
  replayBattle,
  serializeBattle,
  applyBattleAftermath,
  // Exposed for tests/dev tools — lets callers compute injury without a real battle.
  rollInjuryFor,
};

// ──────────────────────────────────────────────────────────────────────────
//  REPLAY: reconstruct a battle deterministically from {party, encounter,
//  seed, actions[]}. Used by /engage (resume) to produce current state, by
//  /action to compute new state after a fresh action, and by /resolve to
//  verify the client's claimed outcome.
//
//  AI turns are interleaved automatically: any time the current actor is
//  enemy, the engine's chooseAITargetAndAction picks the move and we apply
//  it. Player turns wait for an explicit action from the actions[] list.
//
//  Returns { state, expectedNextActor }. State is engine-shaped + log.
// ──────────────────────────────────────────────────────────────────────────
async function replayBattle({ citizenIds, enemyKeys, seed, actions }) {
  await _loadEnemyRoster();
  const citizens = await _loadCitizens(citizenIds);
  if (!citizens.length) throw new Error('No party.');

  E.setRng(E.makeSeededRng((seed | 0) || 1));
  try {
    const battle = E.createBattle({ players: citizens, enemies: enemyKeys || [] });

    let actionIdx = 0;
    let safety = 0;
    while (battle.status === 'active' && safety++ < 1000) {
      const cur = E.currentUnit(battle);
      if (!cur) break;
      if (cur.side === 'enemy') {
        const choice = E.chooseAITargetAndAction(battle, cur);
        if (!choice) break;
        E.performAction(battle, choice.actionKey, choice.targetId);
        continue;
      }
      // Player turn — pull next action from the log.
      if (actionIdx >= actions.length) break; // waiting for player input
      const a = actions[actionIdx++];
      if (a.actor_id !== cur.id) {
        // Action submitted out of turn. Surface a recoverable error so the
        // server knows the log is corrupt — this should NEVER happen with a
        // synced client; if it does, /resolve will reject the battle.
        throw new Error('action_actor_mismatch:expected=' + cur.id + ',got=' + a.actor_id);
      }
      const ok = E.performAction(battle, a.action_key, a.target_id);
      if (!ok) throw new Error('action_invalid:' + a.action_key + '->' + a.target_id);
    }

    return { battle, nextActor: E.currentUnit(battle) };
  } finally {
    E.setRng(null);
  }
}

// Pull the engine state down to a JSON-friendly snapshot. The engine state
// already mostly is JSON-friendly; we strip the listener array which can't
// serialize.
function serializeBattle(battle) {
  if (!battle) return null;
  const { _listeners, ...snap } = battle;
  return snap;
}

// (The autoResolveBattle export above stays; the module.exports up top
// already lists everything in one place.)

// ══════════════════════════════════════════════════════════════════════════
//  AFTERMATH — injuries, deaths, scars
//
//  Called by both /resolve (manual battles) and processCombatTriggers
//  (auto-resolves) after a battle's outcome is locked in. Decides who rolls,
//  what they roll, and writes the resulting events + conditions.
//
//  Design notes:
//    - Defeat: every PARTICIPATING citizen rolls. Even survivors get hit
//      because the party was driven from the field.
//    - Pyrrhic victory: only FALLEN (downed) citizens roll. Healthy
//      survivors walk away clean.
//    - Clean victory: nobody rolls.
//    - The roll uses Math.random — not the seeded battle RNG — so injury
//      results don't accidentally become deterministic from the seed.
//      Cosmetically: a player who restarts hoping for a "better death" can't.
// ══════════════════════════════════════════════════════════════════════════

const INJURY_TABLE = require('./injury_table');

// Total accumulated stat-modifier debuffs are capped so a heavily-scarred
// citizen never goes below this fraction of their base stats. Without a
// floor, six crippling injuries would zero them out and make them a
// permanent burden — narratively interesting in small doses, frustrating
// in large ones. Tune in playtesting.
const APPLY_CAP_FLOOR_PCT = 0.5;

// Weighted random pick from an array of { weight, ... } objects.
function _pickWeighted(items) {
  const total = items.reduce((s, it) => s + (it.weight || 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= (it.weight || 1);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function _findBand(roll) {
  for (const band of INJURY_TABLE.BANDS) {
    if (roll >= band.min && roll <= band.max) return band;
  }
  return INJURY_TABLE.BANDS[INJURY_TABLE.BANDS.length - 1];
}

function _interpolate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? vars[k] : '');
}

// Public: compute a single injury roll for one citizen, given the trait
// modifiers and prior injury count. Returns the rolled band + body part +
// modifier choice but does NOT touch the DB. Useful for previewing or for
// dev-tool admin inflictions.
//
// Modifier handling note: we deliberately clamp the modified roll into
// [1, 98] so modifiers can push citizens toward crippling but cannot push
// them into the fatal band. Death requires an UNMODIFIED roll of 99-100.
// Without this carve-out, even a small +12 modifier (a frail citizen) ends
// up with ~14% death rate because all rolls of 88+ would clamp to 100.
// This way, frail/elder/prior-injury status make every other outcome more
// likely (crippling, scar, wound) without making death a near-certainty.
function rollInjuryFor({ traits = [], life_stage = 'adult', prior_permanent_injuries = 0 } = {}) {
  const baseRoll = 1 + Math.floor(Math.random() * 100);

  // Natural-fatal carve-out: an unmodified roll of 99 or 100 is fatal
  // regardless of any negative modifiers. This makes death an act of fate,
  // not a function of accumulated misfortune.
  const naturalFatal = baseRoll >= 99;

  let modifier = 0;
  for (const t of traits) {
    const m = INJURY_TABLE.ROLL_MODIFIERS.traits[t];
    if (m) modifier += m;
  }
  const ageMod = INJURY_TABLE.ROLL_MODIFIERS.life_stage[life_stage];
  if (ageMod) modifier += ageMod;
  const priorMod = Math.min(
    INJURY_TABLE.ROLL_MODIFIERS.max_prior_injury_modifier,
    prior_permanent_injuries * INJURY_TABLE.ROLL_MODIFIERS.per_prior_permanent_injury
  );
  modifier += priorMod;

  // Clamp final roll. The upper bound is 98 (top of crippling) unless this
  // is a natural-fatal roll; in that case we let it reach 99-100.
  const upperCap = naturalFatal ? 100 : 98;
  const finalRoll = Math.max(1, Math.min(upperCap, baseRoll + modifier));
  const band = _findBand(finalRoll);

  const part = _pickWeighted(INJURY_TABLE.BODY_PARTS).key;
  const severityCfg = INJURY_TABLE.SEVERITY_EFFECTS[band.severity];
  const modifiers = severityCfg ? (severityCfg.modifiers_by_part[part] || {}) : {};
  const heal_days = severityCfg ? severityCfg.heal_days : null;

  return {
    base_roll: baseRoll,
    modifier,
    final_roll: finalRoll,
    severity: band.severity,
    body_part: part,
    stat_modifiers: { ...modifiers },
    heal_days,
  };
}

// Look up how many *permanent* injuries a citizen already carries. Used to
// escalate roll modifiers. Permanent = severity in ('scar','crippling').
async function _countPriorPermanentInjuries(citizenId) {
  const r = await query(
    `SELECT COUNT(*)::int AS c FROM citizen_events
     WHERE citizen_id=$1 AND event_type='injury'
       AND severity IN ('scar','crippling')`,
    [citizenId]
  );
  return (r.rows[0] && r.rows[0].c) || 0;
}

// Pick one enemy name from the battle for narrative templating. We prefer
// the enemy that landed the killing blow if we can identify them in the
// log, otherwise fall back to the first enemy in the encounter.
function _narrativeEnemyName(battle, encounterKeys) {
  if (battle && Array.isArray(battle.units)) {
    const e = battle.units.find(u => u.side === 'enemy');
    if (e && e.name) return e.name;
  }
  if (Array.isArray(encounterKeys) && encounterKeys.length) {
    return encounterKeys[0].replace(/_/g, ' ');
  }
  return 'the enemy';
}

// Write a single injury to the DB. Returns the inserted event row (for the
// frontend resolution screen to show).
async function _writeInjury({ citizen, settlementId, questRunId, battle, encounter, injury }) {
  // 'none' severity = no event, no condition. The citizen walked away clean.
  if (injury.severity === 'none') {
    return null;
  }

  const enemyName = _narrativeEnemyName(battle, encounter);
  const narrative = _interpolate(
    _pickWeighted(
      INJURY_TABLE.NARRATIVES[injury.severity].map(t => ({ text: t, weight: 1 }))
    ).text,
    { name: citizen.name, part: injury.body_part, enemy: enemyName }
  );

  // ── Fatal: mark citizen deceased and write a death event. No condition.
  if (injury.severity === 'fatal') {
    await query(
      `UPDATE citizens SET life_stage='deceased' WHERE id=$1`,
      [citizen.id]
    );
    const ev = await query(
      `INSERT INTO citizen_events (citizen_id, settlement_id, event_type, severity, body_part, narrative, source_battle_id)
       VALUES ($1,$2,'death',$3,$4,$5,$6) RETURNING *`,
      [citizen.id, settlementId, injury.severity, injury.body_part, narrative, questRunId]
    );
    return ev.rows[0];
  }

  // ── All other severities: write the event log first.
  const evRes = await query(
    `INSERT INTO citizen_events (citizen_id, settlement_id, event_type, severity, body_part, narrative, source_battle_id)
     VALUES ($1,$2,'injury',$3,$4,$5,$6) RETURNING *`,
    [citizen.id, settlementId, injury.severity, injury.body_part, narrative, questRunId]
  );
  const event = evRes.rows[0];

  // ── For scratches/wounds/cripplings, create the active condition. Scars
  //    are permanent narrative with no stat impact — no condition row.
  const hasStatImpact = Object.keys(injury.stat_modifiers || {}).length > 0;
  if (hasStatImpact) {
    const expiresAt = injury.heal_days != null
      ? new Date(Date.now() + injury.heal_days * 86400 * 1000).toISOString()
      : null;
    await query(
      `INSERT INTO citizen_conditions (citizen_id, condition_type, body_part, severity, stat_modifiers, expires_at, source_event_id)
       VALUES ($1,'injury',$2,$3,$4,$5,$6)`,
      [citizen.id, injury.body_part, injury.severity, JSON.stringify(injury.stat_modifiers), expiresAt, event.id]
    );
  }

  return event;
}

// ── Main entry: process an entire battle's aftermath. ────────────────────
//
// Arguments:
//   battle       — engine-state of the resolved battle (post-final-turn)
//   outcome      — 'victory' | 'defeat'
//   settlementId — for event-row foreign keys
//   questRunId   — references settlement_quests.id; nullable for test battles
//   encounter    — array of enemy keys, used to pick a narrative villain
//
// Returns: array of inserted citizen_events rows (for the resolution screen).
async function applyBattleAftermath({ battle, outcome, settlementId, questRunId, encounter }) {
  if (!battle || !Array.isArray(battle.units)) return [];

  const playerUnits = battle.units.filter(u => u.side === 'player');
  // Decide who rolls based on outcome shape.
  let toRoll;
  if (outcome === 'defeat') {
    // All participants. The party was routed; everyone took hits.
    toRoll = playerUnits;
  } else if (outcome === 'victory') {
    // Only the fallen. Clean survivors walk away unscathed.
    toRoll = playerUnits.filter(u => u.flags && u.flags.downed);
    if (toRoll.length === 0) return [];   // clean victory, nobody rolls
  } else {
    return [];
  }

  // Fetch fresh citizen rows (need traits + life_stage). The unit on the
  // battle has stats but not traits.
  const citIds = toRoll.map(u => u.citizen_id).filter(Boolean);
  if (!citIds.length) return [];
  const citRes = await query(
    `SELECT id, name, life_stage, visible_traits, hidden_traits
     FROM citizens WHERE id = ANY($1)`,
    [citIds]
  );
  const citizens = citRes.rows;
  const events = [];

  for (const cit of citizens) {
    // Skip citizens who are already deceased (shouldn't happen, but defensive)
    if (cit.life_stage === 'deceased') continue;

    const traits = [...(cit.visible_traits || []), ...(cit.hidden_traits || [])];
    const priorCount = await _countPriorPermanentInjuries(cit.id);
    const injury = rollInjuryFor({
      traits,
      life_stage: cit.life_stage || 'adult',
      prior_permanent_injuries: priorCount,
    });

    const event = await _writeInjury({
      citizen: cit,
      settlementId,
      questRunId,
      battle,
      encounter,
      injury,
    });
    if (event) events.push(event);
  }

  return events;
}

// ── Active-conditions helper for the engine ─────────────────────────────
// Given a citizen id, return the sum of all currently-active condition
// stat modifiers, with the APPLY_CAP_FLOOR_PCT floor applied. The engine's
// statsFromCitizen sums this in so injured citizens fight worse next time.
//
// This is exposed via module.exports so the engine — and admin tools —
// can use the same calculation.
async function getActiveStatModifiersForCitizen(citizenId, baseStats = {}) {
  const r = await query(
    `SELECT stat_modifiers FROM citizen_conditions
     WHERE citizen_id=$1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [citizenId]
  );

  const totals = {};
  for (const row of r.rows) {
    const mods = row.stat_modifiers || {};
    for (const [key, val] of Object.entries(mods)) {
      totals[key] = (totals[key] || 0) + val;
    }
  }

  // Apply the floor cap per-stat. The cap is: (final stat) cannot go below
  // baseStats[key] * APPLY_CAP_FLOOR_PCT. Find the maximum debuff allowed.
  for (const key of Object.keys(totals)) {
    const base = baseStats[key];
    if (base != null) {
      const floor = Math.floor(base * APPLY_CAP_FLOOR_PCT);
      const minDebuff = floor - base;     // most-negative allowed delta
      if (totals[key] < minDebuff) totals[key] = minDebuff;
    }
  }

  return totals;
}

module.exports.getActiveStatModifiersForCitizen = getActiveStatModifiersForCitizen;
