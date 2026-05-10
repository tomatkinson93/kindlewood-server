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
  return r.rows;
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
    };
  } finally {
    E.setRng(null);
  }
}

module.exports = {
  autoResolveBattle,
  replayBattle,
  serializeBattle,
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
