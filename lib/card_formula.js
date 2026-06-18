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
      ops.push({ verb: verb, param: param, eval: ev });
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
      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        var amount = Math.round(op.eval(actor));
        switch (op.verb) {
          case 'damage':
            if (target) events = events.concat(ctx.dealDamage(actor, target, Math.max(1, amount), 'card'));
            break;
          case 'block':
            // block applies to the target if the card targets self/ally, else actor
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
      '// multi-effect card:\ndamage: strength*0.5 + 3\npoison: 2',
    ],
    notes: [
      'damage / heal / poison: amount of HP. poison is damage-over-time, ticking at the start of the target\u2019s turns.',
      'block: temporary shield absorbed before HP. block_bonus (buff) adds to future Defend cards.',
      'buff/debuff need a name. Known: damage_bonus, block_bonus, weak (deals less), vulnerable (takes more), slow.',
      'energy: gain energy this turn. draw: draw N cards. discard: discard N random from hand.',
      'gold: add wealth to the settlement. stun: skip the target\u2019s next N turns. slow: lower initiative.',
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
