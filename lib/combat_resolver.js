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
const { writeDeathEvent } = require('../deaths'); // shared death pipeline (also used by famine.js)

// Card system: resolve the settlement's active battle deck so server-side
// (replayed/auto-resolved) battles use the same cards the client does.
// getActiveDeckMap lives on the decks route module; requiring it here keeps a
// single source of truth for "what is the active deck". CARD_DEFS gives us the
// default deck fallback. Both optional — absent => classic stamina battles.
let CARD_DEFS = null, _getActiveDeckMap = null;
try { CARD_DEFS = require('./card_definitions'); } catch (e) { console.error('[combat_resolver] card_definitions require FAILED:', e.message); }
try { _getActiveDeckMap = require('../routes/decks').getActiveDeckMap; } catch (e) { console.error('[combat_resolver] decks.getActiveDeckMap require FAILED:', e.message); }
console.log('[combat_resolver] card system:',
  CARD_DEFS ? 'card_definitions OK' : 'card_definitions MISSING',
  '|', (typeof _getActiveDeckMap === 'function') ? 'getActiveDeckMap OK' : 'getActiveDeckMap MISSING');

// Card registry: DB-defined cards (card_templates) compiled from formulas. The
// engine looks cards up here first. We refresh it from the DB before each
// battle so replay runs against the current card definitions. (Reading every
// battle is cheap — a handful of rows — and guarantees the registry can't be
// stale across edits or between server instances.)
let CARD_REGISTRY = null;
try { CARD_REGISTRY = require('./card_registry'); } catch (e) { console.error('[combat_resolver] card_registry require FAILED:', e.message); }

async function _loadCardRegistry() {
  if (!CARD_REGISTRY) return;
  try {
    const r = await query('SELECT * FROM card_templates');
    if (r.rows && r.rows.length) CARD_REGISTRY.loadRows(r.rows);
    // If the table is empty, the registry stays empty and getCard falls back
    // to the code-defined seed cards — safe.
  } catch (e) {
    // Table may not exist yet (pre-migration) — fall back to code cards.
    console.warn('[combat_resolver] card_templates load skipped:', e.message);
  }
}

// Resolve the active deck map for a settlement, with graceful fallbacks.
async function _loadDeckMap(settlementId) {
  if (!CARD_DEFS) return null;                 // card system not installed
  if (settlementId != null && _getActiveDeckMap) {
    try {
      const m = await _getActiveDeckMap(settlementId);
      if (m && Object.keys(m).length) return m;
    } catch (e) { /* fall through to default */ }
  }
  return CARD_DEFS.DEFAULT_DECK;               // sane default so cards still work
}

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
// ── Happening combat modifiers (spec 021) ─────────────────────────────────
// Only these stats apply to battles. The caller freezes them when the
// encounter starts (settlement_quests.combat_mods) so every replay of the
// same battle uses the same numbers.
const COMBAT_MOD_KEYS = ['enemy_health', 'enemy_strength', 'enemy_agility', 'party_strength', 'party_agility', 'party_endurance'];
// `party` (careers, below) survives only when stamped PARTY_V: battles stored
// before it was honoured (it used to be dropped here) replay exactly as they
// were fought.
const PARTY_V = 2;
function combatModsOf(mods) {
  const out = {};
  for (const k of COMBAT_MOD_KEYS) if (mods && mods[k]) out[k] = mods[k];
  if (mods && mods.party && Number(mods.party_v) >= PARTY_V) { out.party = mods.party; out.party_v = mods.party_v; }
  // Dungeons (docs/DUNGEONS.md §3.1, §9.2): the health each citizen walks
  // into this room with and who is down, frozen like every other modifier so
  // a replay starts from the same wounds: { start: { citizenId: { hp, down } } }.
  if (mods && mods.dungeon && typeof mods.dungeon === 'object') out.dungeon = mods.dungeon;
  return Object.keys(out).length ? out : null;
}

// A dungeon battle's party as it walks in: wounds carried from the last room,
// and anyone down lying at 0 health (no turn, cannot be targeted). Citizens
// without a starting state, and every other kind of battle, pass through
// untouched and the engine builds them at full health as before.
function _startingUnits(citizens, mods) {
  const start = mods && mods.dungeon && mods.dungeon.start;
  if (!start) return citizens;
  return citizens.map(c => {
    const st = start[c.id] || start[String(c.id)];
    if (!st) return c;
    const u = E.unitFromCitizen(c);
    // Charisma reaches the unit in a dungeon battle (the engine leaves it
    // off; the Hearthkeeper's cards and a villager's Strong Drink read it).
    u.charisma = Number((c.stats || {}).charisma) || 8;
    if (st.down) { u.hp = 0; u.flags.downed = true; }
    else if (st.hp != null) u.hp = Math.max(1, Math.min(u.maxHp, Math.round(Number(st.hp)) || 1));
    return u;
  });
}

// ── Class decks: one deck per citizen (docs/DUNGEON_CLASS_DECKS.md) ────────
// The engine has one deck for the player side. Only the citizen whose turn it
// is plays cards, so a battle that carries `mods.dungeon.decks`
// ({ citizenId: { card: copies } }) gets a deck built for each citizen, and
// the battle's deck is pointed at the acting citizen's own before each of
// their actions. The engine then draws, discards and reshuffles that deck as
// it would the shared one; nothing in the engine changes, and a battle
// without `decks` plays exactly as before.
let CARD_ENGINE = null;
try { CARD_ENGINE = require('./card_engine'); } catch (e) { /* no card system */ }
function _buildDecks(battle, mods) {
  const maps = mods && mods.dungeon && mods.dungeon.decks;
  if (!maps || !CARD_ENGINE || !battle.uses_cards) return;
  battle.decks = {};
  for (const u of battle.units) {
    if (u.side !== 'player') continue;
    // Every citizen gets a deck of their own, even an empty one: a citizen
    // with nothing to play ends their turn; they never borrow another's hand.
    const map = maps[u.citizen_id] || maps[String(u.citizen_id)] || {};
    CARD_ENGINE.initDeck(battle, map);
    battle.decks[u.id] = battle.deck;
  }
  _pointDeck(battle);
}
// The battle's deck is the deck of the citizen about to act.
function _pointDeck(battle, unit) {
  if (!battle.decks) return;
  const cur = unit || E.currentUnit(battle);
  if (cur && cur.side === 'player' && battle.decks[cur.id]) battle.deck = battle.decks[cur.id];
}
// The first deck the battle is created with (the engine wants one to turn cards on).
function _firstDeck(citizens, mods) {
  const maps = mods && mods.dungeon && mods.dungeon.decks;
  if (!maps) return null;
  for (const c of citizens) { const m = maps[c.id] || maps[String(c.id)]; if (m && Object.keys(m).length) return m; }
  return null;
}

// The party as a dungeon battle would build it, for showing what a card does
// in that citizen's hands: [{ id, name, unit }].
async function partyUnits(citizenIds, mods) {
  const citizens = await _loadCitizens(citizenIds, combatModsOf(mods));
  return citizens.map(c => { const u = E.unitFromCitizen(c); u.charisma = Number((c.stats || {}).charisma) || 8; return { id: c.id, name: c.name, role: c.role, unit: u }; });
}

// Full health of each citizen as a battle with these mods would build them:
// [{ id, name, maxHp }]. The dungeon path screen and rest rooms use it.
async function partyHealth(citizenIds, mods) {
  const citizens = await _loadCitizens(citizenIds, combatModsOf(mods));
  return citizens.map(c => ({ id: c.id, name: c.name, maxHp: E.unitFromCitizen(c).maxHp }));
}
// Careers: per-citizen stat/skill changes (perks, gear) and equipped weapon
// and armour, frozen with the battle's mods under `party` so every replay
// uses the same numbers: { citizenId: { strength, agility, endurance, combat,
// weapon: { dice, bonus, name }, armour } }.
function withParty(mods, party) {
  if (!party || !Object.keys(party).length) return mods;
  return { ...(mods || {}), party, party_v: PARTY_V };
}

async function _loadCitizens(citizenIds, mods) {
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

  // Careers (frozen per battle): perks and gear.
  if (mods && mods.party) {
    for (const cit of citizens) {
      const d = mods.party[cit.id] || mods.party[String(cit.id)];
      if (!d) continue;
      const stats = { ...(cit.stats || {}) }, skills = { ...(cit.skills || {}) };
      for (const [k, v] of Object.entries(d)) {
        if (k === 'weapon') cit.weapon = v;
        else if (k === 'armour') cit.armour = Number(v) || 0;
        else if (k === 'combat') skills.combat = Math.max(1, (Number(skills.combat) || 1) + v);
        else stats[k] = Math.max(1, (Number(stats[k]) || 1) + v);
      }
      cit.stats = stats; cit.skills = skills;
    }
  }

  // Happening party_* modifiers: flat, floored at 1.
  if (mods) {
    for (const cit of citizens) {
      const stats = { ...(cit.stats || {}) };
      if (mods.party_strength) stats.strength = Math.max(1, (stats.strength || 1) + mods.party_strength);
      if (mods.party_agility) stats.agility = Math.max(1, (stats.agility || 1) + mods.party_agility);
      if (mods.party_endurance) stats.endurance = Math.max(1, (stats.endurance || 1) + mods.party_endurance);
      cit.stats = stats;
    }
  }

  return citizens;
}

// Override the engine's enemy roster with whatever's in the DB right now,
// matching what the client does at the start of a battle.
let _baseRoster = null;   // last DB roster, unmodified (see _installRoster)
async function _loadEnemyRoster() {
  try {
    const r = await query('SELECT * FROM enemy_definitions WHERE archived = FALSE');
    if (!r.rows.length) { _baseRoster = null; return; } // engine keeps its bundled defaults
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
        // Same shape the browser builds (combat_engine loadEnemies), so a
        // server replay of a battle with moves, an HP range or loot matches.
        moves: Array.isArray(row.moves) ? row.moves : [],
        move_mode: row.move_mode || 'sequence',
        hp_min: (row.hp_min != null ? row.hp_min : null),
        hp_max: (row.hp_max != null ? row.hp_max : null),
        drops: Array.isArray(row.drops) ? row.drops : [],
      };
    }
    _baseRoster = fresh;
  } catch (e) { /* fall back to defaults silently */ }
}

// Install the roster into the engine with Happening enemy_* modifiers
// applied. SYNCHRONOUS and called right before E.createBattle, so another
// battle's modifiers (interleaved at an await) can never leak in.
let _bundledRoster = null;
function _installRoster(mods) {
  // Overwrite the engine's _enemies via the public API. The engine doesn't
  // expose a setter, so we cheat-patch via the function form: ENEMIES()
  // returns the live working copy, and Object.assign mutates it.
  const live = E.ENEMIES();
  if (!_bundledRoster) _bundledRoster = JSON.parse(JSON.stringify(live));
  const base = _baseRoster || _bundledRoster;
  const scale = (v, pct) => Math.max(1, Math.round(v * Math.max(0.1, 1 + (pct || 0))));
  const next = {};
  for (const [k, e] of Object.entries(base)) {
    const stats = { ...e.stats };
    if (mods) {
      if (mods.enemy_health) stats.maxHp = scale(stats.maxHp, mods.enemy_health);
      if (mods.enemy_strength) stats.strength = scale(stats.strength, mods.enemy_strength);
      if (mods.enemy_agility) stats.agility = scale(stats.agility, mods.enemy_agility);
    }
    next[k] = { ...e, stats };
  }
  for (const k of Object.keys(live)) delete live[k];
  Object.assign(live, next);
}

// Run a full headless battle. Returns the final state's outcome metadata.
// The engine itself is the source of truth — we just drive it turn by turn
// using a small heuristic for the player side (same logic as our test
// harness): attack the lowest-HP enemy each turn unless stamina lets us
// use a skill, in which case ~30% chance to use it.
async function autoResolveBattle({ citizenIds, enemyKeys, seed, mods }) {
  mods = combatModsOf(mods);
  await _loadEnemyRoster();

  const citizens = await _loadCitizens(citizenIds, mods);
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
    _installRoster(mods);
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
        // Enemy turn → move-aware (telegraphed move or classic attack).
        if (!E.enemyAct(battle)) break;
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
  combatModsOf,
  withParty,
  _installRosterForTest: (mods) => _installRoster(mods),
  replayBattle,
  serializeBattle,
  applyBattleAftermath,
  // Exposed for tests/dev tools — lets callers compute injury without a real battle.
  rollInjuryFor,
  partyHealth,
  partyUnits,
  applyRunAftermath,
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
async function replayBattle({ citizenIds, enemyKeys, seed, actions, settlementId, mods }) {
  mods = combatModsOf(mods);
  await _loadEnemyRoster();
  await _loadCardRegistry();
  const citizens = await _loadCitizens(citizenIds, mods);
  if (!citizens.length) throw new Error('No party.');

  // A dungeon battle with class decks starts from its first citizen's deck
  // (every citizen's own is built just after); any other battle uses the
  // town's active deck as before.
  const deckMap = _firstDeck(citizens, mods) || await _loadDeckMap(settlementId);
  if (process.env.COMBAT_DEBUG === '1') {
    console.log('[replayBattle] settlementId=', settlementId,
      'deckMap=', deckMap ? Object.keys(deckMap).join(',') : 'NULL');
  }

  E.setRng(E.makeSeededRng((seed | 0) || 1));
  try {
    // Pass the deck so the battle uses cards, and deckSeed so shuffles are
    // deterministic across replays even though this battle is driven by the
    // module-level seeded RNG (we intentionally do NOT pass `seed` to
    // createBattle — doing so would switch the engine to its per-action
    // reseed path and change existing replay outcomes).
    _installRoster(mods);
    const battle = E.createBattle({
      players: _startingUnits(citizens, mods),
      enemies: enemyKeys || [],
      deck: deckMap || undefined,
      deckSeed: (seed | 0) || 1,
    });
    if (process.env.COMBAT_DEBUG === '1') {
      console.log('[replayBattle] uses_cards=', battle.uses_cards,
        'deck.hand=', battle.deck ? battle.deck.hand.join(',') : 'no-deck');
    }
    _buildDecks(battle, mods);

    let actionIdx = 0;
    let safety = 0;
    while (battle.status === 'active' && safety++ < 1000) {
      const cur = E.currentUnit(battle);
      if (!cur) break;
      if (cur.side === 'enemy') {
        // Move-aware enemy turn (telegraphed move or classic attack fallback).
        if (!E.enemyAct(battle)) break;
        continue;
      }
      // Player turn — pull next action from the log.
      _pointDeck(battle, cur);                // class decks: this citizen's own
      if (actionIdx >= actions.length) break; // waiting for player input
      const a = actions[actionIdx++];
      if (a.actor_id !== cur.id) {
        // Action submitted out of turn. Surface a recoverable error so the
        // server knows the log is corrupt — this should NEVER happen with a
        // synced client; if it does, /resolve will reject the battle.
        throw new Error('action_actor_mismatch:expected=' + cur.id + ',got=' + a.actor_id);
      }

      // Dispatch by action kind. Card battles log 'card' / 'end_turn' actions;
      // classic battles log stamina action keys. Both flow through here so a
      // single action log can even mix them (defensive — MVP won't).
      let ok;
      if (a.action_key === 'card') {
        ok = E.playCard(battle, a.hand_index, a.target_id);
      } else if (a.action_key === 'end_turn') {
        ok = E.endTurn(battle);
      } else if (a.action_key === 'move') {
        // Formation reposition: a.delta is ±1 (front/back). Stored in target_id
        // as a small int for log compactness, or in a.delta if present.
        ok = E.moveActor(battle, (a.delta != null ? a.delta : parseInt(a.target_id, 10)) || 0);
      } else {
        ok = E.performAction(battle, a.action_key, a.target_id);
      }
      if (!ok) throw new Error('action_invalid:' + a.action_key + '->' + a.target_id);
    }

    _pointDeck(battle);                        // what the screen shows: the next citizen's hand
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
function rollInjuryFor({ traits = [], life_stage = 'adult', prior_permanent_injuries = 0, extra_modifier = 0, no_fatal = false } = {}) {
  const baseRoll = 1 + Math.floor(Math.random() * 100);

  // Natural-fatal carve-out: an unmodified roll of 99 or 100 is fatal
  // regardless of any negative modifiers. This makes death an act of fate,
  // not a function of accumulated misfortune.
  // no_fatal (a dungeon citizen who went down and was stood back up,
  // docs/DUNGEONS.md §3.2): the roll tops out at crippling.
  const naturalFatal = baseRoll >= 99 && !no_fatal;

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
  modifier += Number(extra_modifier) || 0;   // careers: perks, gear, traits

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
  ).replace(/^./, c => c.toUpperCase());      // a line may begin with the enemy ("a Boar Bruiser caught …")

  // ── Careers: Guardian armour (Armorer's Bulwark) takes a killing blow
  //    once and shatters; the wearer walks away scarred instead.
  if (injury.severity === 'fatal') {
    const guard = (await query(
      `SELECT id, name FROM inventory_items WHERE equipped_to = $1 AND equip_slot = 'armour' AND metadata->>'guardian' = 'true' LIMIT 1`,
      [citizen.id]).catch(() => ({ rows: [] }))).rows[0];
    if (guard) {
      await query('DELETE FROM inventory_items WHERE id = $1', [guard.id]);
      const saved = `${citizen.name}'s ${guard.name} took a killing blow from the ${enemyName} and shattered — ${citizen.name} lives.`;
      const ev = await query(
        `INSERT INTO citizen_events (citizen_id, settlement_id, event_type, severity, body_part, narrative, source_battle_id, meta)
         VALUES ($1,$2,'injury','scar',$3,$4,$5,$6) RETURNING *`,
        [citizen.id, settlementId, injury.body_part, saved, questRunId, JSON.stringify({ guardian: guard.name })]);
      return ev.rows[0];
    }
  }

  // ── Fatal: mark citizen deceased and write a death event. No condition.
  //    Routed through the shared writer (deaths.js) so combat and
  //    starvation deaths use one pipeline; cause='combat' distinguishes
  //    them (famine.js writes cause='starvation').
  if (injury.severity === 'fatal') {
    return await writeDeathEvent({
      citizenId: citizen.id,
      settlementId,
      cause: 'combat',
      narrative,
      severity: injury.severity,
      bodyPart: injury.body_part,
      sourceBattleId: questRunId,
    });
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
    `SELECT id, name, life_stage, born_at, visible_traits, hidden_traits
     FROM citizens WHERE id = ANY($1)`,
    [citIds]
  );
  const citizens = citRes.rows;
  const events = [];
  const careers = require('./careers');
  const profs = await careers.profilesFor(null, settlementId).catch(() => new Map());

  for (const cit of citizens) {
    // Skip citizens who are already deceased (shouldn't happen, but defensive)
    if (cit.life_stage === 'deceased') continue;

    const traits = [...(cit.visible_traits || []), ...(cit.hidden_traits || [])];
    const priorCount = await _countPriorPermanentInjuries(cit.id);
    const injury = rollInjuryFor({
      traits,
      life_stage: cit.born_at ? require('./life').stageOf(cit) : (cit.life_stage || 'adult'),   // 'elder' at 60+
      prior_permanent_injuries: priorCount,
      extra_modifier: (profs.get(cit.id) || { effects: {} }).effects.injury || 0,
    });

    const event = await _writeInjury({
      citizen: cit,
      settlementId,
      questRunId,
      battle,
      encounter,
      injury,
    });
    if (event) {
      events.push(event);
      careers.recordInjury(settlementId, cit.id).catch(() => {});
    }
  }

  return events;
}

// ── A dungeon run's injuries: rolled once, when the run ends ─────────────
// (docs/DUNGEONS.md §3.2). The run decides who rolls and how:
//   rolls: [{ citizenId, noFatal }]   noFatal for a citizen who went down
//                                     and was stood back up before the end.
// `enemy` (a creature key) names the villain in the injury lines. Returns the
// citizen_events rows written, like applyBattleAftermath.
async function applyRunAftermath({ settlementId, questRunId = null, enemy = null, rolls = [] }) {
  const ids = rolls.map(r => Number(r.citizenId)).filter(Boolean);
  if (!ids.length) return [];
  const citizens = (await query(
    `SELECT id, name, life_stage, born_at, visible_traits, hidden_traits FROM citizens WHERE id = ANY($1)`, [ids])).rows;
  const careers = require('./careers');
  const profs = await careers.profilesFor(null, settlementId).catch(() => new Map());
  const events = [];
  for (const r of rolls) {
    const cit = citizens.find(c => c.id === Number(r.citizenId));
    if (!cit || cit.life_stage === 'deceased') continue;
    const injury = rollInjuryFor({
      traits: [...(cit.visible_traits || []), ...(cit.hidden_traits || [])],
      life_stage: cit.born_at ? require('./life').stageOf(cit) : (cit.life_stage || 'adult'),
      prior_permanent_injuries: await _countPriorPermanentInjuries(cit.id),
      extra_modifier: (profs.get(cit.id) || { effects: {} }).effects.injury || 0,
      no_fatal: !!r.noFatal,
    });
    const event = await _writeInjury({ citizen: cit, settlementId, questRunId, battle: null, encounter: enemy ? [enemy] : [], injury });
    if (event) {
      events.push(event);
      careers.recordInjury(settlementId, cit.id).catch(() => {});
    }
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
module.exports._writeInjury = _writeInjury;   // tests (Guardian armour)
