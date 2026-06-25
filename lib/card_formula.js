/**
 * card_formula.js  —  DUAL ENGINE (server + client)
 *
 * Deploys to BOTH:
 *   server: lib/card_formula.js   (require)
 *   client: js/card-formula.js    (window.CARD_FORMULA)
 *
 * Parses a card's effect "formula" string into a runnable effect. Cards are now
 * data (DB rows), so their behaviour can't be a JS function — instead each card
 * carries a formula like:
 *
 *     damage: strength*0.6 + combat*0.8 + 4
 *     block: endurance*0.7 + 4
 *     buff damage_bonus: charisma*0.4 + 2
 *     debuff weak: intelligence*0.3 + 2
 *     heal: intelligence*0.6 + 4
 *     energy: 2
 *
 * Each line is  <verb> [param]: <expression>.  Multiple lines run in order.
 * The expression is evaluated with a SAFE recursive-descent parser (NO eval):
 * it allows numbers, the stat identifiers below, + - * /, and parentheses.
 *
 * Verbs:
 *   damage              deal damage to the target (AoE loops handled upstream)
 *   block               grant block to the actor (or target for 'self' cards)
 *   heal                heal the target
 *   energy              grant energy to the actor's side
 *   buff <name>         add a positive status to the target (e.g. damage_bonus)
 *   debuff <name>       add a negative status to the target (weak, vulnerable…)
 *
 * Stat identifiers available in expressions (read off the unit, flattened):
 *   strength agility endurance intelligence charisma combat
 *   (combat maps to the unit's combatSkill)
 *
 * Anything the parser can't read is reported via parseFormula().errors so the
 * editor can show validation. A card with errors still loads but does nothing.
 */
(function (root) {
  'use strict';

  var STAT_KEYS = ['strength', 'agility', 'endurance', 'intelligence', 'charisma', 'combat'];
  var SKILL_ALIAS = { combat: 'combatSkill' };
  var VERBS = [
    'damage', 'block', 'heal', 'energy',
    'buff', 'debuff',
    'draw', 'discard', 'gold',
    'stun', 'slow', 'poison',
    'push', 'move',
  ];

  function statValue(unit, key) {
    if (!unit) return 0;
    var flatKey = SKILL_ALIAS[key] || key;
    if (typeof unit[flatKey] === 'number') return unit[flatKey];
    if (unit.stats && typeof unit.stats[key] === 'number') return unit.stats[key];
    if (unit.skills && typeof unit.skills[key] === 'number') return unit.skills[key];
    return 0;
  }

  // ── Safe expression evaluator (recursive descent) ────────────────────────
  // Grammar:  expr = term (('+'|'-') term)*
  //           term = factor (('*'|'/') factor)*
  //           factor = number | ident | '(' expr ')' | '-' factor
  function tokenize(src) {
    var tokens = [];
    var i = 0;
    while (i < src.length) {
      var ch = src[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if ('+-*/()'.indexOf(ch) !== -1) { tokens.push({ t: ch }); i++; continue; }
      if (/[0-9.]/.test(ch)) {
        var num = '';
        while (i < src.length && /[0-9.]/.test(src[i])) { num += src[i++]; }
        tokens.push({ t: 'num', v: parseFloat(num) });
        continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        var id = '';
        while (i < src.length && /[a-zA-Z_]/.test(src[i])) { id += src[i++]; }
        tokens.push({ t: 'id', v: id });
        continue;
      }
      throw new Error('Unexpected character "' + ch + '"');
    }
    return tokens;
  }

  function makeEvaluator(exprSrc) {
    var tokens = tokenize(exprSrc);
    var pos = 0;
    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }

    function parseExpr() {
      var v = parseTerm();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        var op = next().t;
        var r = parseTerm();
        v = (function (a, b, o) { return function (u) { return o === '+' ? a(u) + b(u) : a(u) - b(u); }; })(v, r, op);
      }
      return v;
    }
    function parseTerm() {
      var v = parseFactor();
      while (peek() && (peek().t === '*' || peek().t === '/')) {
        var op = next().t;
        var r = parseFactor();
        v = (function (a, b, o) { return function (u) { var d = b(u); return o === '*' ? a(u) * d : (d === 0 ? 0 : a(u) / d); }; })(v, r, op);
      }
      return v;
    }
    function parseFactor() {
      var tk = peek();
      if (!tk) throw new Error('Unexpected end of expression');
      if (tk.t === '-') { next(); var f = parseFactor(); return function (u) { return -f(u); }; }
      if (tk.t === '(') {
        next();
        var e = parseExpr();
        if (!peek() || peek().t !== ')') throw new Error('Missing ")"');
        next();
        return e;
      }
      if (tk.t === 'num') { next(); var n = tk.v; return function () { return n; }; }
      if (tk.t === 'id') {
        next();
        if (STAT_KEYS.indexOf(tk.v) === -1) throw new Error('Unknown stat "' + tk.v + '"');
        var key = tk.v;
        return function (u) { return statValue(u, key); };
      }
      throw new Error('Unexpected token');
    }

    var fn = parseExpr();
    if (pos < tokens.length) throw new Error('Trailing tokens in expression');
    return fn; // (unit) => number
  }

  // ── Parse a full multi-line formula into a list of effect ops ────────────
  // Returns { ops: [{verb, param, eval}], errors: [string] }.
  // ── Conditional prefixes ─────────────────────────────────────────────────
  // A line may be prefixed with "if <condition>:" to gate its effect. Multiple
  // conditions can be chained with "and"/"&&". The condition is evaluated at
  // runtime against a rich context (cctx) built by the engine. Supported forms:
  //
  //   Position:  if self_front | if self_back | if self_mid
  //              if target_front | if target_back | if target_mid
  //   HP %:      if self_hp > 50 | if self_hp < 30 | if self_hp >= 50 ...
  //              if target_hp < 40 | if enemy_hp > 50   (enemy_hp = frontmost foe)
  //   Status:    if target_has poison | if target_has bleed | if self_has weak
  //   Block:     if target_block | if self_block | if target_block > 5
  //   Hand/pile: if hand_empty | if draw < 3 | if discard > 10 | if hand >= 4
  //   Energy:    if energy = 2 | if energy >= 1 | if energy_spent > 0
  //   Lethal:    if lethal           (this attack would kill the target)
  //   Adjacency: if adjacent_partner | if adjacent_family | if adjacent_friend
  //   Species:   if hare | if fox | if badger | if mouse | if otter | if mole
  //              (also: if self_species fox | if target_species mouse)
  //   Traits:    if trait strong | if self_trait quick | if target_trait frail
  //
  // Legacy "if_front"/"if_back" still work (alias for self_front/self_back).
  var STATUS_WORDS = ['poison','bleed','weak','vulnerable','slow','stun','burn','curse','frail','block_bonus','damage_bonus','regen','shield','strength_down'];
  var SPECIES_WORDS = ['hare','fox','badger','mouse','otter','mole','human','rat','toad','frog'];

  function pct(unit) {
    if (!unit || !unit.maxHp) return 100;
    return (unit.hp / unit.maxHp) * 100;
  }
  function cmp(a, op, b) {
    switch (op) {
      case '>':  return a >  b;
      case '<':  return a <  b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '=':
      case '==': return a === b;
      case '!=': return a !== b;
    }
    return false;
  }
  function hasStatus(unit, name) {
    if (!unit) return false;
    var n = String(name).toLowerCase();
    if (unit.buffs && unit.buffs[n]) return true;
    if (unit.conditions && unit.conditions[n]) return true;
    if (unit.statuses && unit.statuses[n]) return true;
    if (typeof unit[n] === 'number' && unit[n] > 0) return true; // e.g. unit.poison
    return false;
  }
  function unitSpecies(unit) {
    return String((unit && (unit.species || unit.race)) || '').toLowerCase();
  }
  function unitTraits(unit) {
    if (!unit) return [];
    return (unit.visible_traits || unit.traits || unit.hidden_traits || []).map(function (t) {
      return String(t).toLowerCase();
    });
  }

  // Parse a single condition token-group into a predicate(cctx) -> bool.
  function parseCondition(src) {
    var raw = src.trim();
    if (!raw) return function () { return true; };
    // Split on "and" / "&&" — all must pass.
    var parts = raw.split(/\s+and\s+|\s*&&\s*/i);
    var preds = parts.map(parseSingleCondition);
    return function (cctx) {
      for (var i = 0; i < preds.length; i++) if (!preds[i](cctx)) return false;
      return true;
    };
  }

  function parseSingleCondition(token) {
    var t = token.trim().toLowerCase();
    // Comparison form: "<lhs> <op> <number>"
    var cm = t.match(/^(\S+(?:\s+\S+)??)\s*(>=|<=|==|!=|=|>|<)\s*(-?\d+(?:\.\d+)?)$/);
    if (cm) {
      var lhs = cm[1].trim(), op = cm[2], num = parseFloat(cm[3]);
      return function (c) { return cmp(lhsValue(lhs, c), op, num); };
    }
    // Boolean / keyword forms.
    return function (c) { return boolCondition(t, c); };
  }

  // Numeric left-hand-side resolvers for comparison conditions.
  function lhsValue(lhs, c) {
    switch (lhs) {
      case 'self_hp':   return pct(c.actor);
      case 'target_hp': return pct(c.target);
      case 'enemy_hp':  return pct(c.frontmostEnemy);
      case 'self_block':   return (c.actor && c.actor.block) || 0;
      case 'target_block': return (c.target && c.target.block) || 0;
      case 'hand':    return c.handCount || 0;
      case 'draw':    return c.drawCount || 0;
      case 'discard': return c.discardCount || 0;
      case 'energy':  return c.energy || 0;
      case 'energy_spent': return c.energySpent || 0;
      case 'self_pos': return (c.actor && c.actor.pos) || 0;
      case 'target_pos': return (c.target && c.target.pos) || 0;
    }
    return 0;
  }

  // Boolean keyword conditions.
  function boolCondition(t, c) {
    // two-word forms: "target_has poison", "trait strong", "self_species fox"
    var sp = t.split(/\s+/);
    if (sp.length === 2) {
      var key = sp[0], val = sp[1];
      switch (key) {
        case 'target_has': return hasStatus(c.target, val);
        case 'self_has':   return hasStatus(c.actor, val);
        case 'enemy_has':  return hasStatus(c.frontmostEnemy, val);
        case 'trait':      return unitTraits(c.actor).indexOf(val) !== -1;
        case 'self_trait': return unitTraits(c.actor).indexOf(val) !== -1;
        case 'target_trait': return unitTraits(c.target).indexOf(val) !== -1;
        case 'self_species':   return unitSpecies(c.actor) === val;
        case 'target_species': return unitSpecies(c.target) === val;
      }
    }
    switch (t) {
      // Position
      case 'if_front': case 'self_front': return !!(c.isFront && c.isFront(c.actor));
      case 'if_back':  case 'self_back':  return !!(c.isBack && c.isBack(c.actor));
      case 'self_mid':   return !(c.isFront && c.isFront(c.actor)) && !(c.isBack && c.isBack(c.actor));
      case 'target_front': return !!(c.isFront && c.isFront(c.target));
      case 'target_back':  return !!(c.isBack && c.isBack(c.target));
      case 'target_mid':   return c.target && !(c.isFront && c.isFront(c.target)) && !(c.isBack && c.isBack(c.target));
      // Block presence
      case 'self_block':   return ((c.actor && c.actor.block) || 0) > 0;
      case 'target_block': return ((c.target && c.target.block) || 0) > 0;
      // Hand / piles
      case 'hand_empty': return (c.handCount || 0) === 0;
      // Lethal
      case 'lethal': return c.isLethal ? c.isLethal() : false;
      // Adjacency
      case 'adjacent_partner': return c.adjacent ? c.adjacent('partner') : false;
      case 'adjacent_family':  return c.adjacent ? c.adjacent('family')  : false;
      case 'adjacent_friend':  return c.adjacent ? c.adjacent('friend')  : false;
    }
    // Bare species word → actor species check ("if fox").
    if (SPECIES_WORDS.indexOf(t) !== -1) return unitSpecies(c.actor) === t;
    // Bare status word → actor has status ("if poison" = self has poison)? Too
    // ambiguous; require self_has/target_has. Unknown → false (fails closed).
    return false;
  }

  function parseFormula(formula) {
    var ops = [];
    var errors = [];
    if (!formula || !String(formula).trim()) {
      errors.push('Formula is empty.');
      return { ops: ops, errors: errors };
    }
    var lines = String(formula).split(/\n|;/);
    lines.forEach(function (raw, idx) {
      var line = raw.trim();
      if (!line) return;
      if (line.indexOf('//') === 0) return; // comment line
      // Optional condition prefix. Two accepted spellings:
      //   "if <condition>: verb: expr"   (general, condition ends at first ':')
      //   "if_front verb: expr" / "if_back verb: expr"   (legacy positional)
      var cond = null;       // legacy string form (kept for back-compat display)
      var predicate = null;  // compiled predicate(cctx) -> bool
      var legacy = line.match(/^(if_front|if_back)\s+/i);
      if (legacy) {
        cond = legacy[1].toLowerCase();
        predicate = parseCondition(cond === 'if_front' ? 'self_front' : 'self_back');
        line = line.slice(legacy[0].length);
      } else {
        var gen = line.match(/^if\s+([^:]+):\s*/i);
        if (gen) {
          var condSrc = gen[1].trim();
          cond = 'if ' + condSrc;
          try { predicate = parseCondition(condSrc); }
          catch (e) { errors.push('Line ' + (idx + 1) + ': bad condition "' + condSrc + '".'); return; }
          line = line.slice(gen[0].length);
        }
      }
      var colon = line.indexOf(':');
      if (colon === -1) { errors.push('Line ' + (idx + 1) + ': missing ":" (use "verb: expression").'); return; }
      var head = line.slice(0, colon).trim();
      var exprSrc = line.slice(colon + 1).trim();
      var parts = head.split(/\s+/);
      var verb = (parts[0] || '').toLowerCase();
      var param = parts[1] || null;
      if (VERBS.indexOf(verb) === -1) { errors.push('Line ' + (idx + 1) + ': unknown verb "' + verb + '". Allowed: ' + VERBS.join(', ') + '.'); return; }
      if ((verb === 'buff' || verb === 'debuff') && !param) { errors.push('Line ' + (idx + 1) + ': "' + verb + '" needs a status name, e.g. "' + verb + ' weak: ...".'); return; }
      var ev;
      try { ev = makeEvaluator(exprSrc); }
      catch (e) { errors.push('Line ' + (idx + 1) + ': ' + e.message); return; }
      ops.push({ verb: verb, param: param, eval: ev, cond: cond, predicate: predicate });
    });
    if (!ops.length && !errors.length) errors.push('No effect lines found.');
    return { ops: ops, errors: errors };
  }

  // ── Build a runnable effect(state, actor, target, ctx) from a formula ────
  // Mirrors the signature the engine expects from code-defined cards. Uses the
  // same ctx helpers (dealDamage/addBlock/applyBuff/applyDebuff/heal/grantEnergy).
  function compileEffect(formula) {
    var parsed = parseFormula(formula);
    var ops = parsed.ops;
    return function (state, actor, target, ctx) {
      var events = [];
      // Build the condition context once per effect run. It exposes everything
      // the condition predicates may read. ctx (from the engine) provides the
      // position/lethal/adjacency helpers and deck counts where available.
      var cctx = {
        actor: actor, target: target, state: state,
        frontmostEnemy: ctx.frontmostEnemy ? ctx.frontmostEnemy(actor) : null,
        isFront: ctx.isFront, isBack: ctx.isBack,
        handCount: ctx.handCount ? ctx.handCount() : 0,
        drawCount: ctx.drawCount ? ctx.drawCount() : 0,
        discardCount: ctx.discardCount ? ctx.discardCount() : 0,
        energy: ctx.energy ? ctx.energy() : 0,
        energySpent: ctx.energySpent ? ctx.energySpent() : 0,
        isLethal: null,
        adjacent: ctx.adjacent || null,
      };
      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        if (op.predicate) {
          // For "lethal", the predicate needs the current op's damage amount, so
          // wire isLethal lazily against this op's evaluated value.
          cctx.isLethal = function () {
            if (!target) return false;
            var dmg = Math.round(op.eval(actor));
            return (target.hp - Math.max(1, dmg)) <= 0;
          };
          if (!op.predicate(cctx)) continue;
        }
        var amount = Math.round(op.eval(actor));
        switch (op.verb) {
          case 'damage':
            if (target) events = events.concat(ctx.dealDamage(actor, target, Math.max(1, amount), 'card'));
            break;
          case 'block':
            events = events.concat(ctx.addBlock(target && target.side === actor.side ? target : actor, Math.max(0, amount), 'card'));
            break;
          case 'heal':
            events = events.concat(ctx.heal(target || actor, Math.max(0, amount), 'card'));
            break;
          case 'energy':
            events = events.concat(ctx.grantEnergy(actor, amount, 'card'));
            break;
          case 'buff':
            events = events.concat(ctx.applyBuff(target || actor, op.param, Math.max(0, amount), 'card'));
            break;
          case 'debuff':
            if (target) events = events.concat(ctx.applyDebuff(target, op.param, Math.max(0, amount), 'card'));
            break;
          case 'draw':
            events = events.concat(ctx.drawCards(Math.max(0, amount), 'card'));
            break;
          case 'discard':
            events = events.concat(ctx.discardCards(Math.max(0, amount), 'card'));
            break;
          case 'gold':
            events = events.concat(ctx.gainGold(amount, 'card'));
            break;
          case 'stun':
            if (target) events = events.concat(ctx.applyStun(target, Math.max(1, amount), 'card'));
            break;
          case 'slow':
            if (target) events = events.concat(ctx.applyDebuff(target, 'slow', Math.max(1, amount), 'card'));
            break;
          case 'poison':
            if (target) events = events.concat(ctx.applyPoison(target, Math.max(1, amount), 'card'));
            break;
          case 'push':
            // Push the target back (positive) / pull forward (negative).
            if (target && ctx.push) events = events.concat(ctx.push(target, amount));
            break;
          case 'move':
            // Move the actor: negative = toward front, positive = toward back.
            if (ctx.moveSelf) events = events.concat(ctx.moveSelf(amount));
            break;
        }
      }
      return events;
    };
  }

  // Reference text for the editor's (?) help.
  var HELP = {
    verbs: VERBS,
    stats: STAT_KEYS,
    examples: [
      'damage: strength*0.6 + combat*0.8 + 4',
      'block: endurance*0.7 + combat*0.5 + 4',
      'buff damage_bonus: charisma*0.4 + 2',
      'buff block_bonus: endurance*0.3 + 2',
      'debuff weak: intelligence*0.3 + 2',
      'debuff vulnerable: agility*0.3 + 2',
      'heal: intelligence*0.6 + 4',
      'energy: 2',
      'draw: 2',
      'discard: 1',
      'gold: 25',
      'stun: 1',
      'slow: 2',
      'poison: intelligence*0.4 + 3',
      'push: 1',
      'move: -1',
      'if_front block: 6',
      'if_back damage: strength*0.4',
      'if self_hp < 50: damage: 20',
      'if target_hp < 40: damage: 30',
      'if target_has poison: damage: 25',
      'if self_front: block: 8',
      'if hand_empty: energy: 2',
      'if draw < 3: draw: 2',
      'if lethal: gold: 50',
      'if fox: damage: 8',
      'if trait strong: damage: 12',
      '// multi-effect card:\ndamage: strength*0.5 + 3\npoison: 2',
    ],
    notes: [
      'damage / heal / poison: amount of HP. poison is damage-over-time, ticking at the start of the target\u2019s turns.',
      'block: temporary shield absorbed before HP. block_bonus (buff) adds to future Defend cards.',
      'buff/debuff need a name. Known: damage_bonus, block_bonus, weak (deals less), vulnerable (takes more), slow.',
      'energy: gain energy this turn. draw: draw N cards. discard: discard N random from hand.',
      'gold: add wealth to the settlement. stun: skip the target\u2019s next N turns. slow: lower initiative.',
      'push: shove the target back N positions (negative pulls forward). move: reposition the actor (negative = toward front).',
      'if_front / if_back prefix a line so it only applies when the actor is at the front or back of its formation, e.g. "if_front block: 6".',
      'CONDITIONS: prefix any line with "if <condition>:" to gate it. Chain with "and".',
      '  Position: self_front, self_back, self_mid, target_front, target_back, target_mid',
      '  HP %:    self_hp < 50, target_hp >= 40, enemy_hp > 50  (compare to a percentage)',
      '  Status:  target_has poison, self_has weak, enemy_has bleed',
      '  Block:   self_block, target_block (true if >0), or target_block > 5',
      '  Cards:   hand_empty, hand >= 4, draw < 3, discard > 10',
      '  Energy:  energy = 2, energy >= 1, energy_spent > 0',
      '  Lethal:  lethal  (true if this line\u2019s damage would kill the target)',
      '  Kin:     adjacent_partner, adjacent_family, adjacent_friend',
      '  Species: if fox / if hare / ... or self_species fox, target_species mouse',
      '  Traits:  trait strong, self_trait quick, target_trait frail',
      '  Example: "if target_hp < 30: damage: 100"  or  "if self_back and energy >= 2: draw: 2".',
    ],
  };

  // Human-readable preview of what a card's formula will do for a given actor
  // unit, e.g. "Deal 14 damage · Poison 3". Used by the hand UI hover tooltip.
  function previewEffect(formula, actor) {
    var parsed = parseFormula(formula);
    if (parsed.errors.length) return '';
    var verbLabel = {
      damage: 'Deal {n} damage', block: 'Gain {n} block', heal: 'Heal {n}',
      energy: 'Gain {n} energy', draw: 'Draw {n}', discard: 'Discard {n}',
      gold: 'Gain {n} gold', stun: 'Stun {n} turn(s)', slow: 'Slow {n}',
      poison: 'Poison {n}',
    };
    var parts = [];
    parsed.ops.forEach(function (op) {
      var n = Math.round(op.eval(actor || {}));
      if (op.verb === 'damage' || op.verb === 'poison') n = Math.max(1, n);
      if (op.verb === 'buff') { parts.push(op.param.replace(/_/g, ' ') + ' +' + Math.max(0, n)); return; }
      if (op.verb === 'debuff') { parts.push(op.param.replace(/_/g, ' ') + ' ' + Math.max(0, n)); return; }
      var lbl = verbLabel[op.verb] || (op.verb + ' {n}');
      parts.push(lbl.replace('{n}', n));
    });
    return parts.join(' \u00b7 ');
  }

  var API = {
    parseFormula: parseFormula,
    compileEffect: compileEffect,
    previewEffect: previewEffect,
    statValue: statValue,
    STAT_KEYS: STAT_KEYS,
    VERBS: VERBS,
    HELP: HELP,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.CARD_FORMULA = API;
})(typeof window !== 'undefined' ? window : null);
