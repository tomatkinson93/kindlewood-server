// ══════════════════════════════════════════════════════════════════════════
//  COMBAT ENGINE — Kindlewood
//
//  Pure logic only. No DOM, no fetches. The renderer (combat-ui.js) drives
//  this module by calling intent functions and subscribing to events.
//
//  Design notes:
//   - Battle state is plain data; renderable, serialisable, testable.
//   - Actions are first-class objects with a stamina cost, target type, and
//     a perform() method that returns a list of events. Adding a new ability
//     later means defining a new action — no engine changes required.
//   - The engine emits events ('battle-started', 'turn-started', 'damage',
//     'unit-fell', 'battle-ended') so the renderer can animate without the
//     engine knowing what an animation is.
//   - Future-proofing hooks (status effects, traits, relationships,
//     positioning) are deliberately left as TODOs rather than half-built —
//     the data model leaves them room without committing to a shape yet.
// ══════════════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // ── Tunables ─────────────────────────────────────────────────────────────
  // Damage formula breaks down small enough to read at a glance:
  //   raw = strength + skills.combat * 0.5 + ability_bonus + jitter
  //   final = max(1, raw - target_defense)
  // Defense from Defending halves incoming damage and grants stamina.
  const DAMAGE_VARIANCE   = 0.25;   // +/- 25%
  const DEFEND_DAMAGE_MUL = 0.5;
  const DEFEND_STAMINA    = 2;
  const SKILL_STAMINA     = 2;
  const SKILL_DAMAGE_BONUS= 4;      // flat extra damage on most skills
  const HP_BASE           = 30;
  const HP_PER_ENDURANCE  = 3;
  const HP_PER_COMBAT     = 2;

  // ── Random helpers (centralised so a future seedable RNG slots in cleanly) ──
  // Default to Math.random; a caller can replace it with a seeded function for
  // deterministic auto-resolution. setRng(null) restores the default.
  // For per-battle determinism, pass `seed` to createBattle — the battle
  // gets its own RNG isolated from this module-level setting.
  let _rng = Math.random;
  function setRng(fn) { _rng = (typeof fn === 'function') ? fn : Math.random; }
  // _activeRng() returns the battle-scoped RNG if there's a current battle
  // with one, else the module-level RNG. It's set by createBattle and
  // performAction wraps engine calls in a setter so all internal helpers
  // see the right RNG without needing to be threaded explicitly.
  let _battleRng = null;
  function rand(min, max) {
    const r = _battleRng || _rng;
    return r() * (max - min) + min;
  }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

  // mulberry32 seedable PRNG. Exposed so callers can build a seeded generator
  // without bringing in a dependency. Returns a function() -> [0,1).
  function makeSeededRng(seed) {
    let a = (seed | 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Stat derivation from a citizen ──────────────────────────────────────
  // Citizens already have stats {strength, agility, endurance, intelligence,
  // charisma} and skills {combat, ...}. We translate those into combat stats.
  // Pure function: same input → same output → easy to test.
  function statsFromCitizen(c) {
    const stats  = c.stats  || {};
    const skills = c.skills || {};
    const traits = [].concat(c.visible_traits || [], c.hidden_traits || [], c.traits || []);

    let str = stats.strength     ?? 8;
    let agi = stats.agility      ?? 8;
    let end = stats.endurance    ?? 8;
    let intl = stats.intelligence?? 8;
    const cmb = skills.combat    ?? 1;

    // Tiny trait nudges so traits matter without becoming a system in themselves.
    if (traits.includes('strong'))  str += 2;
    if (traits.includes('frail'))   end -= 1;
    if (traits.includes('quick'))   agi += 2;
    if (traits.includes('hardy'))   end += 2;

    const maxHp = Math.max(15, HP_BASE + end * HP_PER_ENDURANCE + cmb * HP_PER_COMBAT);
    return {
      maxHp,
      hp: maxHp,
      maxStamina: 5 + Math.floor(end / 2),
      stamina:    5 + Math.floor(end / 2),
      strength: str,
      agility:  agi,
      endurance: end,
      intelligence: intl,
      combatSkill: cmb,
    };
  }

  // ── Action registry ──────────────────────────────────────────────────────
  // Each action is a self-contained little machine. Keep them small.
  // perform(state, actor, target) returns a list of events to emit.
  const ACTIONS = {
    attack: {
      key: 'attack',
      label: 'Attack',
      icon: '⚔',
      description: 'A measured strike.',
      stamina_cost: 0,
      target_type: 'enemy',
      perform(state, actor, target) {
        return [_resolveDamage(actor, target, 0, 'attack')];
      },
    },

    defend: {
      key: 'defend',
      label: 'Defend',
      icon: '🛡',
      description: 'Brace and recover stamina. Halves the next hit taken.',
      stamina_cost: 0,
      target_type: 'self',
      perform(state, actor) {
        actor.flags.defending = true;
        actor.stamina = Math.min(actor.maxStamina, actor.stamina + DEFEND_STAMINA);
        return [{
          type: 'defend',
          actor_id: actor.id,
          stamina_gained: DEFEND_STAMINA,
          log: actor.name + ' braces, recovering ' + DEFEND_STAMINA + ' stamina.',
        }];
      },
    },

    skill: {
      key: 'skill',
      label: 'Skill',     // overridden per-citizen at battle creation
      icon: '✦',
      description: 'A trained technique.',
      stamina_cost: SKILL_STAMINA,
      target_type: 'enemy',
      perform(state, actor, target) {
        return [_resolveDamage(actor, target, SKILL_DAMAGE_BONUS, actor.skill_label || 'skill')];
      },
    },
  };

  // ── Role-keyed skill flavour ────────────────────────────────────────────
  // Each role-skill is just a thin re-skinning of the generic 'skill' action
  // for now. Bonus damage is the same; the label and flavour text change so
  // the player connects citizen role to combat identity.
  const ROLE_SKILLS = {
    fisher:     { label: 'Hook Strike',      icon: '🎣', flavour: 'lashes out with a barbed hook' },
    woodcutter: { label: 'Heavy Swing',      icon: '🪓', flavour: 'brings their axe down hard' },
    farmer:     { label: 'Herbal Toss',      icon: '🌿', flavour: 'flings a stinging brew' },
    miner:      { label: 'Crushing Blow',    icon: '⛏',  flavour: 'swings their pick like a hammer' },
    crafter:    { label: 'Improvised Strike',icon: '🔨', flavour: 'lands an awkward but solid hit' },
    scout:      { label: 'Precise Shot',     icon: '🏹', flavour: 'looses a careful shot' },
    soldier:    { label: 'Power Strike',     icon: '⚔',  flavour: 'unleashes a trained strike' },
    tavernkeep: { label: 'Bottle Smash',     icon: '🍺', flavour: 'breaks a bottle over them' },
    idle:       { label: 'Wild Swing',       icon: '👊', flavour: 'swings without much grace' },
  };

  function skillForRole(role) {
    return ROLE_SKILLS[role] || ROLE_SKILLS.idle;
  }

  // ── Damage calc ──────────────────────────────────────────────────────────
  // Returns a single 'damage' event. Factored out so attack, skills, and
  // (future) status-effect damage all flow through the same place.
  function _resolveDamage(actor, target, abilityBonus, sourceLabel) {
    const variance = 1 + rand(-DAMAGE_VARIANCE, DAMAGE_VARIANCE);
    const raw = (actor.strength + actor.combatSkill * 0.5 + abilityBonus) * variance;
    let dmg = Math.max(1, Math.round(raw));
    let mitigated = 0;

    if (target.flags.defending) {
      const before = dmg;
      dmg = Math.max(1, Math.round(dmg * DEFEND_DAMAGE_MUL));
      mitigated = before - dmg;
    }

    target.hp = Math.max(0, target.hp - dmg);
    const fell = target.hp === 0;

    return {
      type: 'damage',
      actor_id: actor.id,
      target_id: target.id,
      amount: dmg,
      mitigated,
      source: sourceLabel,
      fell,
      log: _damageLogLine(actor, target, dmg, mitigated, sourceLabel, fell),
    };
  }

  function _damageLogLine(actor, target, dmg, mitigated, source, fell) {
    let s = actor.name + ' ';
    if (source === 'attack') s += 'strikes ' + target.name;
    else                     s += '— ' + (actor.skill_label || source) + ' — hits ' + target.name;
    s += ' for ' + dmg + ' damage';
    if (mitigated > 0) s += ' (defended, ' + mitigated + ' absorbed)';
    s += '.';
    if (fell) s += ' ' + target.name + ' falls.';
    return s;
  }

  // ── Battle state shape ───────────────────────────────────────────────────
  // {
  //   id, scene, round, current_index,
  //   units: [Unit, ...],          // both sides in one array, .side='player'|'enemy'
  //   turn_order: [unit_id, ...],  // computed once per round
  //   status: 'active' | 'victory' | 'defeat',
  //   log: [string, ...],
  //   reward: { wealth: number },  // computed at battle creation
  // }
  //
  // Unit: {
  //   id, side, name, role, icon, archetype,
  //   stats... (maxHp/hp/maxStamina/stamina/strength/agility/endurance/intelligence/combatSkill)
  //   skill_label, skill_icon, skill_flavour,
  //   citizen_id (player units), enemy_key (enemy units),
  //   flags: { defending, downed }
  // }

  // Stable, deterministic IDs. We previously used a module-global counter,
  // but that broke replay (the same battle replayed got fresh IDs each time,
  // so an action log referencing 'p_1' on the original wouldn't match 'p_5'
  // on replay). Citizens carry their own ids; enemies are positional.
  function _playerId(citizen) {
    if (citizen && citizen.id != null) return 'p_' + citizen.id;
    return 'p_' + Math.floor(Math.random() * 1e9);   // anon player (test battles)
  }

  // ── Public: build a unit from a citizen ──────────────────────────────────
  function unitFromCitizen(c) {
    const skill = skillForRole(c.role);
    const stats = statsFromCitizen(c);
    return {
      id: _playerId(c),
      side: 'player',
      name: c.name,
      role: c.role || 'idle',
      icon: '🧑',
      archetype: 'citizen',
      citizen_id: c.id,
      ...stats,
      skill_label:   skill.label,
      skill_icon:    skill.icon,
      skill_flavour: skill.flavour,
      flags: { defending: false, downed: false },
    };
  }

  // ── Public: enemy roster ─────────────────────────────────────────────────
  // The engine ships a hardcoded fallback. At runtime the UI calls
  // CombatEngine.loadEnemies() which fetches admin-edited definitions from
  // /api/combat/enemies and overrides this map. If the fetch fails or the
  // table is empty, the fallback remains in effect — battles always work.
  const DEFAULT_ENEMIES = {
    marsh_rat: {
      key: 'marsh_rat',
      name: 'Marsh Rat',
      icon: '🐀',
      flavour: 'A scrappy biter, quick on its feet.',
      stats: { maxHp: 22, strength: 5, agility: 9,  endurance: 4, combatSkill: 2 },
      reward_weight: 1,
      attack_verb: 'bites',
    },
    wild_fox: {
      key: 'wild_fox',
      name: 'Wild Fox',
      icon: '🦊',
      flavour: 'Cunning. Will harry the weakest.',
      stats: { maxHp: 30, strength: 7, agility: 11, endurance: 5, combatSkill: 3 },
      reward_weight: 2,
      attack_verb: 'lunges at',
    },
    fungal_toad: {
      key: 'fungal_toad',
      name: 'Fungal Toad',
      icon: '🐸',
      flavour: 'Slow and bloated, but surprisingly tough.',
      stats: { maxHp: 42, strength: 8, agility: 4,  endurance: 9, combatSkill: 2 },
      reward_weight: 3,
      attack_verb: 'slams into',
    },
  };

  // Mutable working copy. Cloned from defaults at load time so future calls
  // can mutate it without poisoning the originals.
  let _enemies = JSON.parse(JSON.stringify(DEFAULT_ENEMIES));
  let _enemiesLoaded = false;

  // Public alias for legacy code that read CombatEngine.ENEMIES directly.
  // Returns the live working copy.
  function ENEMIES() { return _enemies; }

  // Async: pull admin-edited enemies from the server. Idempotent — calling
  // twice does no extra work after the first success. Returns the active map
  // either way so callers can `await` confidently.
  async function loadEnemies(force) {
    if (_enemiesLoaded && !force) return _enemies;
    if (typeof apiFetch !== 'function') {
      _enemiesLoaded = true;
      return _enemies;
    }
    try {
      const r = await apiFetch('/api/combat/enemies');
      if (!r.ok) throw new Error('status ' + r.status);
      const d = await r.json();
      const rows = (d && d.enemies) || [];
      if (rows.length) {
        const fresh = {};
        for (const row of rows) {
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
        _enemies = fresh;
      } else {
        // Empty table — keep the bundled defaults so test battles still work.
        _enemies = JSON.parse(JSON.stringify(DEFAULT_ENEMIES));
      }
    } catch (e) {
      console.warn('CombatEngine.loadEnemies failed; using bundled defaults.', e);
      _enemies = JSON.parse(JSON.stringify(DEFAULT_ENEMIES));
    }
    _enemiesLoaded = true;
    return _enemies;
  }

  function unitFromEnemy(enemyKey, index) {
    const e = _enemies[enemyKey];
    if (!e) throw new Error('Unknown enemy: ' + enemyKey);
    const maxHp = e.stats.maxHp;
    // Position-prefixed id makes duplicates in an encounter unique while
    // staying deterministic across replays. If `index` is omitted, fall
    // back to a random suffix (used by the dev test-battle entry point
    // where determinism doesn't matter).
    const idPos = (index != null) ? String(index) : 'r' + Math.floor(Math.random() * 1e6);
    return {
      id: 'e_' + idPos + '_' + enemyKey,
      side: 'enemy',
      name: e.name,
      role: 'enemy',
      icon: e.icon,
      archetype: e.key,
      enemy_key: e.key,
      maxHp,
      hp: maxHp,
      maxStamina: 5,
      stamina: 5,
      strength:    e.stats.strength,
      agility:     e.stats.agility,
      endurance:   e.stats.endurance,
      intelligence: 5,
      combatSkill: e.stats.combatSkill,
      attack_verb: e.attack_verb,
      flags: { defending: false, downed: false },
    };
  }

  // ── Build a battle ───────────────────────────────────────────────────────
  function createBattle({ players, enemies, scene, seed }) {
    // If a seed was supplied, build a battle-local RNG and use it for the
    // initial turn-order roll too. The battle stores the seed so callers can
    // replay or resume.
    if (seed != null) _battleRng = makeSeededRng((seed | 0) || 1);
    try {
      const playerUnits = players.map(p => p.archetype ? p : unitFromCitizen(p));
      const enemyUnits  = enemies.map((e, i) => typeof e === 'string' ? unitFromEnemy(e, i) : e);

      const reward = enemyUnits.reduce((sum, u) => {
        const def = _enemies[u.enemy_key];
        return sum + (def?.reward_weight || 1) * 8;
      }, 0);

      const units = [...playerUnits, ...enemyUnits];
      const state = {
        id: 'battle_' + Date.now(),
        scene: scene || 'forest',
        round: 1,
        current_index: 0,
        units,
        turn_order: _computeTurnOrder(units),
        status: 'active',
        log: [],
        reward: { wealth: reward, citizen_ids: playerUnits.map(u => u.citizen_id).filter(Boolean) },
        events: [],
        _listeners: [],
        _seed: (seed != null) ? ((seed | 0) || 1) : null,
        _actionsApplied: 0,  // for tracking how many actions the engine has consumed
      };
      state.log.push('A battle begins!');
      return state;
    } finally {
      _battleRng = null;
    }
  }

  function _computeTurnOrder(units) {
    return units
      .filter(u => !u.flags.downed)
      .map(u => ({ id: u.id, agi: u.agility + rand(0, 0.99) }))
      .sort((a, b) => b.agi - a.agi)
      .map(x => x.id);
  }

  // ── Events / listeners ───────────────────────────────────────────────────
  function on(state, fn) {
    state._listeners.push(fn);
    return () => {
      const i = state._listeners.indexOf(fn);
      if (i >= 0) state._listeners.splice(i, 1);
    };
  }
  function emit(state, evt) {
    state.events.push(evt);
    if (evt.log) state.log.push(evt.log);
    state._listeners.forEach(fn => { try { fn(evt, state); } catch(e) { console.error('combat listener error', e); } });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function getUnit(state, id) {
    return state.units.find(u => u.id === id);
  }
  // currentUnit is read-only — it does NOT mutate state.current_index. Round
  // rollover and downed-skipping live exclusively in _advanceTurn. (Earlier
  // versions of this function advanced current_index in place, which could
  // wedge the battle if the last unit in a round's turn order died from
  // another unit's action: the index would be parked at end-of-array with no
  // code path to roll the round over. Keeping this pure means there is exactly
  // one place where the index moves.)
  function currentUnit(state) {
    if (state.status !== 'active') return null;
    if (state.current_index >= state.turn_order.length) return null;
    const u = getUnit(state, state.turn_order[state.current_index]);
    if (u && !u.flags.downed && u.hp > 0) return u;
    return null;
  }
  function aliveOnSide(state, side) {
    return state.units.filter(u => u.side === side && !u.flags.downed && u.hp > 0);
  }
  function getAction(key) { return ACTIONS[key]; }
  function listActions() { return Object.values(ACTIONS); }

  // ── Perform an action for the current unit ──────────────────────────────
  // Public API. Returns true if the action was accepted, false otherwise.
  function performAction(state, actionKey, targetId) {
    if (state.status !== 'active') return false;
    // If the battle was created with a seed, activate its RNG for the
    // duration of this action so all internal rolls use the right stream.
    // For battles without a seed (test battles), Math.random remains active.
    const prev = _battleRng;
    if (state._seed != null && _battleRng == null) {
      _battleRng = makeSeededRng(state._seed + (state._actionsApplied || 0) * 17);
    }
    try {
      const result = _performActionInner(state, actionKey, targetId);
      if (result) state._actionsApplied = (state._actionsApplied || 0) + 1;
      return result;
    } finally {
      _battleRng = prev;
    }
  }

  function _performActionInner(state, actionKey, targetId) {
    const actor = currentUnit(state);
    if (!actor) return false;

    const action = ACTIONS[actionKey];
    if (!action) return false;

    if (actor.stamina < action.stamina_cost) {
      emit(state, { type: 'rejected', actor_id: actor.id, reason: 'stamina', log: actor.name + ' is too tired to do that.' });
      return false;
    }

    let target = null;
    if (action.target_type === 'enemy') {
      target = getUnit(state, targetId);
      if (!target || target.side === actor.side || target.flags.downed) {
        emit(state, { type: 'rejected', actor_id: actor.id, reason: 'target', log: 'Invalid target.' });
        return false;
      }
    } else if (action.target_type === 'self') {
      target = actor;
    }

    actor.stamina -= action.stamina_cost;

    // Defending only protects against the very next hit taken — clear it at
    // the start of the unit's own turn (we do that below in _advanceTurn).
    emit(state, { type: 'action-started', actor_id: actor.id, action: action.key });

    const events = action.perform(state, actor, target) || [];
    for (const e of events) emit(state, e);

    // Falls
    for (const u of state.units) {
      if (u.hp <= 0 && !u.flags.downed) {
        u.flags.downed = true;
        emit(state, { type: 'unit-fell', unit_id: u.id, log: '' /* damage event already logged this */ });
      }
    }

    if (_checkBattleEnd(state)) return true;

    _advanceTurn(state);
    emit(state, { type: 'action-ended', actor_id: actor.id });
    return true;
  }

  // ── Enemy AI ─────────────────────────────────────────────────────────────
  // Prefer the lowest-HP living player about 50% of the time, otherwise pick
  // randomly. Deliberately simple — first pass.
  function chooseAITargetAndAction(state, enemy) {
    const players = aliveOnSide(state, 'player');
    if (!players.length) return null;
    const sorted = players.slice().sort((a, b) => a.hp - b.hp);
    const target = (rand(0, 1) < 0.5) ? sorted[0] : pick(players);
    // Enemies just attack; skill use can be added later by giving them an action key.
    return { actionKey: 'attack', targetId: target.id };
  }

  // ── Turn flow ────────────────────────────────────────────────────────────
  // Loops until it lands on a live unit. Handles two ways the index can run
  // off the end of turn_order:
  //   (a) plain end-of-round (last slot acted) — roll over to next round.
  //   (b) the last slot(s) were downed by an earlier unit's action, so the
  //       skip-past loop walks off the end. Same fix: roll over.
  // The earlier version handled (a) but not (b), which froze battles when a
  // mid-round kill removed the final unit in turn order.
  function _advanceTurn(state) {
    let safety = 0;
    while (safety++ < 50) {
      state.current_index++;
      if (state.current_index >= state.turn_order.length) {
        // Round end — recompute order, clear defending flags.
        state.units.forEach(u => { u.flags.defending = false; });
        state.round++;
        state.turn_order = _computeTurnOrder(state.units);
        state.current_index = -1;       // becomes 0 on next loop iteration
        emit(state, { type: 'round-started', round: state.round, log: '— Round ' + state.round + ' —' });
        continue;
      }
      const next = getUnit(state, state.turn_order[state.current_index]);
      if (next && !next.flags.downed && next.hp > 0) {
        emit(state, { type: 'turn-started', unit_id: next.id });
        return;
      }
      // Slot is downed/dead — try the next one.
    }
    // Should never get here unless every unit is downed; _checkBattleEnd
    // would normally catch that first. Bail safely rather than hang.
    console.warn('combat: _advanceTurn safety bailout');
  }

  function _checkBattleEnd(state) {
    if (!aliveOnSide(state, 'enemy').length) {
      state.status = 'victory';
      emit(state, { type: 'battle-ended', outcome: 'victory', reward: state.reward, log: 'Victory!' });
      return true;
    }
    if (!aliveOnSide(state, 'player').length) {
      state.status = 'defeat';
      emit(state, { type: 'battle-ended', outcome: 'defeat', log: 'Defeat. The party falls back…' });
      return true;
    }
    return false;
  }

  // ── Random encounter generator (used by Test Battle) ────────────────────
  // Picks 2-3 enemies weighted by reward; later this becomes biome-driven.
  function rollRandomEnemyParty() {
    const keys = Object.keys(_enemies);
    if (!keys.length) throw new Error('No enemies defined.');
    const count = randInt(2, 3);
    const out = [];
    for (let i = 0; i < count; i++) out.push(pick(keys));
    return out;
  }

  // Pick up to 3 idle, available adult citizens for a test battle.
  function rollRandomPlayerParty(citizens, n) {
    n = n || 3;
    const eligible = (citizens || []).filter(c =>
      c.life_stage !== 'child' && !c.expedition && !c.active_quest
    );
    // Prefer higher combat skill to make the test less brutal.
    const sorted = eligible.slice().sort((a, b) =>
      (b.skills?.combat || 0) - (a.skills?.combat || 0)
    );
    return sorted.slice(0, Math.min(n, sorted.length));
  }

  // ── Turn-order preview ──────────────────────────────────────────────────
  // Returns up to `count` upcoming turns, starting with the current actor and
  // walking forward through turn_order. When the round ends within the window,
  // synthesises the next round's order using current agility values so the
  // bar can show two rounds smoothly. Pure read.
  function getTurnOrderPreview(state, count) {
    count = count || 8;
    if (!state || state.status !== 'active') return [];
    const out = [];
    let idx = state.current_index;
    let order = state.turn_order.slice();
    let round = state.round;
    let safety = 0;

    while (out.length < count && safety++ < count * 4) {
      // End of current order — peek into the next round.
      if (idx >= order.length) {
        round++;
        order = _computeTurnOrder(state.units);
        idx = 0;
        if (!order.length) break;
      }
      const u = getUnit(state, order[idx]);
      if (u && !u.flags.downed && u.hp > 0) {
        out.push({ unit: u, round });
      }
      idx++;
    }
    return out;
  }

  // ── Public surface ──────────────────────────────────────────────────────
  global.CombatEngine = {
    createBattle,
    performAction,
    chooseAITargetAndAction,
    on,
    currentUnit,
    aliveOnSide,
    getUnit,
    getAction,
    listActions,
    unitFromCitizen,
    unitFromEnemy,
    statsFromCitizen,
    rollRandomEnemyParty,
    rollRandomPlayerParty,
    getTurnOrderPreview,
    loadEnemies,
    setRng,
    makeSeededRng,
    ENEMIES,           // function — returns the live working copy
    DEFAULT_ENEMIES,   // immutable bundled fallback
    ACTIONS,
  };

  // CommonJS export for server-side use (node require()). The IIFE still
  // attaches to globalThis above, so browser consumers are unaffected.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.CombatEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
