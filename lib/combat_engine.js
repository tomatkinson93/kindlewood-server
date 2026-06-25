// IMPORTANT: this file is a copy of frontend/js/combat-engine.js.
// Keep them in sync until we have a build step that shares the file.
// The IIFE detects globalThis vs module.exports so the same source runs in both.
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

  // ── Card system modules (optional) ───────────────────────────────────────
  // Dual-engine: on the server we require(); in the browser they're attached
  // to window by their own script tags. All three are optional — if absent,
  // the engine runs exactly as before (classic stamina actions only).
  //
  // IMPORTANT: in the browser we resolve these LAZILY (per call) rather than
  // at IIFE-run time, because this file may load BEFORE the card-*.js scripts.
  // Capturing window.CARD_* once at load time would freeze them as null.
  var _isNodeEnv = (typeof module !== 'undefined' && module.exports);
  var _nodeCards = null;
  if (_isNodeEnv) {
    _nodeCards = { DEFS: null, ENGINE: null, COMBAT: null };
    try { _nodeCards.DEFS   = require('./card_definitions'); } catch (e) { console.error('[combat_engine] card_definitions require FAILED:', e.message); }
    try { _nodeCards.ENGINE = require('./card_engine'); }      catch (e) { console.error('[combat_engine] card_engine require FAILED:', e.message); }
    try { _nodeCards.COMBAT = require('./card_combat'); }      catch (e) { console.error('[combat_engine] card_combat require FAILED:', e.message); }
    console.log('[combat_engine] card system:',
      (_nodeCards.DEFS && _nodeCards.ENGINE && _nodeCards.COMBAT) ? 'ALL OK' : 'INCOMPLETE',
      '(defs:' + !!_nodeCards.DEFS + ' engine:' + !!_nodeCards.ENGINE + ' combat:' + !!_nodeCards.COMBAT + ')');
  }
  function _cards() {
    if (_isNodeEnv) return _nodeCards;
    return { DEFS: global.CARD_DEFS || null, ENGINE: global.CARD_ENGINE || null, COMBAT: global.CARD_COMBAT || null };
  }
  function cardsAvailable() {
    var c = _cards();
    return !!(c.DEFS && c.ENGINE && c.COMBAT);
  }

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
      // Species drives the battle sprite. Not all citizens carry one yet (the
      // settlement only gains multiple species after the opening period), so we
      // default to 'human'. When the users/citizens schema gains a species
      // field, pass it through here and sprites update automatically.
      species: (c.species || c.race || 'human'),
      visible_traits: (c.visible_traits || c.traits || []),
      partner_id: (c.partner_id || null),
      parent_ids: (c.parent_ids || []),
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
            // Formation-aware ability system (007). Moves use the card DSL.
            moves: Array.isArray(row.moves) ? row.moves : [],
            move_mode: row.move_mode || 'sequence',
            hp_min: (row.hp_min != null ? row.hp_min : null),
            hp_max: (row.hp_max != null ? row.hp_max : null),
            drops: Array.isArray(row.drops) ? row.drops : [],
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
    // HP: if a min/max range is set, roll within it using the battle RNG so the
    // result is deterministic for replay; otherwise use the flat maxHp.
    let maxHp = e.stats.maxHp;
    if (e.hp_min != null && e.hp_max != null && e.hp_max >= e.hp_min) {
      const span = e.hp_max - e.hp_min;
      maxHp = e.hp_min + Math.floor(rand(0, 1) * (span + 1));
    }
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
      // Ability system: a copy of the move list, the cycling mode, the current
      // sequence index (for StS-style telegraphed intents), and loot table.
      moves: (e.moves || []).slice(),
      move_mode: e.move_mode || 'sequence',
      _moveIdx: 0,
      drops: (e.drops || []).slice(),
      block: 0,
      buffs: {},
      flags: { defending: false, downed: false },
    };
  }

  // ── Build a battle ───────────────────────────────────────────────────────
  function createBattle({ players, enemies, scene, seed, deck, deckSeed, formation, enemyFormation, species }) {
    // If a seed was supplied, build a battle-local RNG and use it for the
    // initial turn-order roll too. The battle stores the seed so callers can
    // replay or resume.
    if (seed != null) _battleRng = makeSeededRng((seed | 0) || 1);
    try {
      const playerUnits = players.map(p => p.archetype ? p : unitFromCitizen(p));
      const enemyUnits  = enemies.map((e, i) => typeof e === 'string' ? unitFromEnemy(e, i) : e);

      // Stamp the settlement species onto player units (the whole party shares
      // it). Per-unit species, if ever present, takes precedence.
      if (species) {
        playerUnits.forEach(u => { if (!u.species || u.species === 'human') u.species = species; });
      }

      // Card effects use unit.block and unit.buffs. Ensure every unit has them
      // so card and classic actions can coexist on the same battle.
      [...playerUnits, ...enemyUnits].forEach(u => {
        if (u.block == null) u.block = 0;
        if (u.buffs == null) u.buffs = {};
      });

      // ── Formation positions (1 = front, ascending toward the back) ────────
      // Optional `formation` / `enemyFormation` are arrays of unit ids (or
      // citizen ids) giving front-to-back order; anything omitted keeps its
      // natural order after the listed ones. This is the hook the quest system
      // will populate from the formation a party was sent out in.
      _assignPositions(playerUnits, formation);
      _assignPositions(enemyUnits, enemyFormation);

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
        _deckOps: 0,         // monotonic counter for deterministic deck shuffles
        // Deck shuffles derive from _deckSeed. We accept an explicit deckSeed
        // so deck determinism works even when the battle is driven by the
        // module-level seeded RNG (resolver replay) rather than the per-action
        // _seed path. Falls back to _seed, then to a stable constant.
        _deckSeed: (deckSeed != null) ? ((deckSeed | 0) || 1)
                 : (seed != null) ? ((seed | 0) || 1)
                 : null,
      };
      state.log.push('A battle begins!');

      // Initialise the shared player-side battle deck if a deck map was passed
      // and the card modules are present. `deck` is { cardKey: count }, the
      // settlement's active template (server) or the same map echoed to the
      // client. Absent deck => classic stamina-only battle (the fallback).
      if (deck && cardsAvailable()) {
        try {
          _cards().ENGINE.initDeck(state, deck);
          state.uses_cards = true;
        } catch (e) {
          console.warn('combat: deck init failed, falling back to classic actions.', e);
          state.uses_cards = false;
        }
      } else {
        state.uses_cards = false;
      }

      // If the battle opens on an enemy with moves, telegraph its first intent
      // so the UI can show it before the player acts.
      _telegraphCurrent(state);

      return state;
    } finally {
      _battleRng = null;
    }
  }

  // ── Formation positions ────────────────────────────────────────────────
  // Each unit has `pos` (1 = front). Lower pos acts as the front line for
  // targeting and front/back conditionals. Positions are kept contiguous per
  // side via normalizePositions after any change (move/push/death).
  function _assignPositions(sideUnits, order) {
    if (order && order.length) {
      // Order is an array of ids (unit id or citizen_id). Listed ones first,
      // in the given order; the rest keep their natural order after.
      const rank = new Map();
      order.forEach((id, i) => rank.set(String(id), i));
      const keyOf = (u) => rank.has(String(u.id)) ? rank.get(String(u.id))
                      : rank.has(String(u.citizen_id)) ? rank.get(String(u.citizen_id))
                      : (1000 + sideUnits.indexOf(u));
      sideUnits.slice().sort((a, b) => keyOf(a) - keyOf(b)).forEach((u, i) => { u.pos = i + 1; });
    } else {
      sideUnits.forEach((u, i) => { u.pos = i + 1; });
    }
  }

  function sideOf(state, unit) {
    return state.units.filter(u => u.side === unit.side);
  }
  function livingSide(state, side) {
    return state.units.filter(u => u.side === side && !u.flags.downed && u.hp > 0);
  }
  // Living units of a side ordered front→back by pos.
  function orderedSide(state, side) {
    return livingSide(state, side).sort((a, b) => (a.pos || 99) - (b.pos || 99));
  }
  function frontmost(state, side) {
    const o = orderedSide(state, side);
    return o.length ? o[0] : null;
  }
  function backmost(state, side) {
    const o = orderedSide(state, side);
    return o.length ? o[o.length - 1] : null;
  }
  function isFront(state, unit) {
    const f = frontmost(state, unit.side);
    return f && f.id === unit.id;
  }
  function isBack(state, unit) {
    const b = backmost(state, unit.side);
    return b && b.id === unit.id;
  }
  // Re-pack a side's positions to 1..N preserving order (call after death/move).
  function normalizePositions(state, side) {
    orderedSide(state, side).forEach((u, i) => { u.pos = i + 1; });
  }

  // Move a unit forward (delta<0) or back (delta>0) by swapping with neighbours,
  // clamped to the line. Returns events. Deterministic.
  function moveUnit(state, unit, delta) {
    const order = orderedSide(state, unit.side);
    const idx = order.findIndex(u => u.id === unit.id);
    if (idx < 0) return [];
    let target = Math.max(0, Math.min(order.length - 1, idx + delta));
    if (target === idx) return [];
    // Swap stepwise so it reads as moving through the line.
    const moved = order.splice(idx, 1)[0];
    order.splice(target, 0, moved);
    order.forEach((u, i) => { u.pos = i + 1; });
    return [{ type: 'unit-moved', unit_id: unit.id, to_pos: moved.pos,
      log: unit.name + ' moves to position ' + moved.pos + '.' }];
  }
  // Push a unit toward the back (n>0) or pull toward front (n<0). Wrapper over
  // moveUnit used by card/enemy 'push' effects.
  function pushUnit(state, unit, n) {
    if (!n) return [];
    const evs = moveUnit(state, unit, n);
    if (evs.length) evs[0].log = unit.name + (n > 0 ? ' is pushed back.' : ' is pulled forward.');
    return evs;
  }

  // A small stable [0,1) jitter derived from the unit id, used only as a
  // tiebreaker between equal-agility units. It MUST be deterministic: deriving
  // it from a fresh rand() each call made the displayed turn order reshuffle on
  // every re-render (e.g. when spamming the move button), and also wasn't great
  // for replay. A hash of the id is stable and still spreads ties out.
  function _idJitter(id) {
    var s = String(id);
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return (h % 1000) / 1000; // [0, 0.999]
  }
  function _computeTurnOrder(units) {
    return units
      .filter(u => !u.flags.downed)
      // 'slow' debuff lowers effective agility for ordering this round.
      .map(u => ({ id: u.id, agi: (u.agility - ((u.buffs && u.buffs.slow) || 0)) + _idJitter(u.id) }))
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

  // ── Card actions ─────────────────────────────────────────────────────────
  // playCard / endTurn are the deck-system analogues of performAction. They
  // run inside the same per-action seeded-RNG window so any randomness (card
  // effects, and the reshuffle that endTurn may trigger) is deterministic on
  // replay. They share performAction's post-action bookkeeping: fall
  // detection, battle-end check, and turn advance.
  // Move the active player unit forward (delta<0) or back (delta>0) in the
  // formation, spending 1 energy. Replay-safe (no RNG). delta is normally ±1.
  function moveActor(state, delta) {
    if (state.status !== 'active' || !state.uses_cards) return false;
    const actor = currentUnit(state);
    if (!actor || actor.side !== 'player') return false;
    if (!state.deck || state.deck.energy < 1) {
      emit(state, { type: 'rejected', actor_id: actor.id, reason: 'no-energy',
        log: actor.name + ' lacks the energy to reposition.' });
      return false;
    }
    const evs = _cards().COMBAT.moveUnit(state, actor, delta);
    if (!evs.length) return false; // already at the end of the line
    state.deck.energy -= 1;
    emit(state, { type: 'energy-spent', actor_id: actor.id, amount: 1 });
    for (const e of evs) emit(state, e);
    state._actionsApplied = (state._actionsApplied || 0) + 1;
    return true;
  }

  function playCard(state, handIndex, targetId) {
    if (state.status !== 'active') return false;
    if (!state.uses_cards || !cardsAvailable()) return false;
    const prev = _battleRng;
    if (state._seed != null && _battleRng == null) {
      _battleRng = makeSeededRng(state._seed + (state._actionsApplied || 0) * 17);
    }
    try {
      const ok = _playCardInner(state, handIndex, targetId);
      if (ok) state._actionsApplied = (state._actionsApplied || 0) + 1;
      return ok;
    } finally {
      _battleRng = prev;
    }
  }

  function _playCardInner(state, handIndex, targetId) {
    const actor = currentUnit(state);
    if (!actor) return false;
    // Cards are only playable on a player unit's turn in the MVP. Enemy turns
    // still use the classic AI attack path.
    if (actor.side !== 'player') return false;

    const result = _cards().COMBAT.playCard(state, actor, handIndex, targetId);
    if (!result.ok) {
      emit(state, {
        type: 'rejected', actor_id: actor.id, reason: result.error,
        log: result.error === 'no-energy' ? actor.name + ' lacks the energy.' : 'Cannot play that card.',
      });
      return false;
    }

    emit(state, { type: 'action-started', actor_id: actor.id, action: 'card' });
    for (const e of result.events) emit(state, e);

    // Falls — identical to performAction.
    for (const u of state.units) {
      if (u.hp <= 0 && !u.flags.downed) {
        u.flags.downed = true;
        emit(state, { type: 'unit-fell', unit_id: u.id, log: '' });
      }
    }

    if (_checkBattleEnd(state)) return true;

    // NOTE: playing a card does NOT advance the turn — the player may play
    // multiple cards until energy runs out, then ends their turn explicitly.
    emit(state, { type: 'action-ended', actor_id: actor.id });
    return true;
  }

  // End the current player unit's turn: discard hand, refill energy, draw a
  // fresh hand, THEN advance the turn. Mirrors performAction's RNG wrapper.
  function endTurn(state) {
    if (state.status !== 'active') return false;
    if (!state.uses_cards || !cardsAvailable()) {
      // No deck — "end turn" just advances (lets a player pass with classic UI).
      _advanceTurn(state);
      return true;
    }
    const actor = currentUnit(state);
    if (!actor || actor.side !== 'player') return false;

    const prev = _battleRng;
    if (state._seed != null && _battleRng == null) {
      _battleRng = makeSeededRng(state._seed + (state._actionsApplied || 0) * 17);
    }
    try {
      const events = _cards().ENGINE.endTurnCycle(state);
      emit(state, { type: 'turn-ended', actor_id: actor.id });
      for (const e of events) emit(state, e);
      state._actionsApplied = (state._actionsApplied || 0) + 1;
      _advanceTurn(state);
      return true;
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

  // Run the enemy's whole turn. If the enemy has formula-driven moves, it uses
  // the telegraphed (current) move; otherwise it falls back to the classic
  // single-target attack. Handles falls, loot drops, battle-end and turn
  // advance — the unified path for both the UI and the resolver.
  function enemyAct(state) {
    const actor = currentUnit(state);
    if (!actor || actor.side !== 'enemy') return false;

    let events;
    if (actor.moves && actor.moves.length) {
      // Telegraphed move (selected at the start of this enemy's turn).
      const move = actor._intent || _cards().COMBAT.selectNextMove(state, actor);
      const res = _cards().COMBAT.runMove(state, actor, move, null);
      events = res.events || [];
      emit(state, { type: 'action-started', actor_id: actor.id, action: 'move' });
      for (const e of events) emit(state, e);
      _cards().COMBAT.advanceMove(actor);
      // Refresh this enemy's telegraph to show its NEXT move immediately.
      actor._intent = _cards().COMBAT.selectNextMove(state, actor);
      emit(state, { type: 'intent-set', actor_id: actor.id,
        intent: actor._intent ? (actor._intent.intent || 'attack') : 'attack',
        move_name: actor._intent ? actor._intent.name : '' });
    } else {
      // Classic fallback.
      const choice = chooseAITargetAndAction(state, actor);
      if (choice) return performAction(state, choice.actionKey, choice.targetId);
      return false;
    }

    // Falls + loot drops.
    for (const u of state.units) {
      if (u.hp <= 0 && !u.flags.downed) {
        u.flags.downed = true;
        emit(state, { type: 'unit-fell', unit_id: u.id, log: '' });
      }
    }
    if (_checkBattleEnd(state)) return true;
    _advanceTurn(state);
    emit(state, { type: 'action-ended', actor_id: actor.id });
    return true;
  }

  // Pick & stash a visible "intent" (next move) for EVERY living enemy, so the
  // player can see all telegraphs from the start of combat — not just the enemy
  // about to act. Sequence enemies show their current sequence slot; weighted
  // enemies show a representative pick (re-rolled when they act).
  function _telegraphAll(state) {
    for (const u of state.units) {
      if (u.side !== 'enemy' || u.flags.downed || !u.moves || !u.moves.length) continue;
      if (!u._intent) {
        u._intent = _cards().COMBAT.selectNextMove(state, u);
        emit(state, { type: 'intent-set', actor_id: u.id,
          intent: u._intent ? (u._intent.intent || 'attack') : 'attack',
          move_name: u._intent ? u._intent.name : '' });
      }
    }
  }

  // Pick & stash the current enemy's next move as a visible "intent".
  function _telegraphCurrent(state) {
    _telegraphAll(state);
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
        // Poison ticks at the start of the unit's turn (damage over time).
        if (next.buffs && next.buffs.poison > 0) {
          var pd = next.buffs.poison | 0;
          next.hp = Math.max(0, next.hp - pd);
          emit(state, { type: 'poison-tick', unit_id: next.id, amount: pd,
            log: next.name + ' suffers ' + pd + ' poison damage.' });
          // Poison decays by 1 each tick (classic DoT falloff).
          next.buffs.poison = Math.max(0, pd - 1);
          if (next.hp <= 0 && !next.flags.downed) {
            next.flags.downed = true;
            emit(state, { type: 'unit-fell', unit_id: next.id, log: next.name + ' succumbs to poison.' });
            if (_checkBattleEnd(state)) return;
            continue; // unit died to poison; move to next
          }
        }
        // Stun: skip this turn, consuming one stun charge.
        if (next.buffs && next.buffs.stun > 0) {
          next.buffs.stun = (next.buffs.stun | 0) - 1;
          emit(state, { type: 'turn-skipped', unit_id: next.id,
            log: next.name + ' is stunned and loses the turn.' });
          continue; // skip to the next unit
        }
        emit(state, { type: 'turn-started', unit_id: next.id });
        // Telegraph an enemy's chosen move as it becomes their turn.
        if (next.side === 'enemy' && next.moves && next.moves.length && !next._intent) {
          next._intent = _cards().COMBAT.selectNextMove(state, next);
          emit(state, { type: 'intent-set', actor_id: next.id,
            intent: next._intent ? (next._intent.intent || 'attack') : 'attack',
            move_name: next._intent ? next._intent.name : '' });
        }
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
      // Fold any card-granted bonus gold into the reward.
      if (state.bonus_gold && state.reward) {
        state.reward.wealth = (state.reward.wealth || 0) + state.bonus_gold;
      }
      // Roll loot from every defeated enemy (seeded → deterministic). Drops are
      // aggregated by item key and attached to the reward for the reward screen.
      const drops = {};
      for (const u of state.units) {
        if (u.side !== 'enemy' || !u.drops || !u.drops.length) continue;
        for (const d of u.drops) {
          if (!d.item) continue;
          if (rand(0, 1) <= (d.chance != null ? d.chance : 1)) {
            const lo = d.min != null ? d.min : 1;
            const hi = d.max != null ? d.max : lo;
            const qty = lo + Math.floor(rand(0, 1) * (Math.max(lo, hi) - lo + 1));
            if (qty > 0) drops[d.item] = (drops[d.item] || 0) + qty;
          }
        }
      }
      const dropList = Object.keys(drops).map(k => ({ item: k, qty: drops[k] }));
      if (state.reward) state.reward.drops = dropList;
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
    playCard,
    moveActor,
    enemyAct,
    endTurn,
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
