// ══════════════════════════════════════════════════════════════════════════
//  tactics-engine — a tactical battle on a small isometric map
//  (docs/TACTICS.md). A prototype, started from Dev Tools.
//
//  Pure: no DOM, no clock, no Math.random. A battle is a plain object and
//  every change goes through move / use / endTurn, so the same seed and the
//  same choices always give the same battle. That is what a server replay
//  needs, should this replace the card battles.
//
//  The board: w × h tiles, each with a height and a kind of ground. x runs
//  east, y runs south. A unit stands on a tile and faces n, e, s or w.
//
//  A turn: the unit may move once and act once, in either order, and may use
//  any "quick" abilities besides. Then the turn ends.
//
//  The rules, in one place:
//    Move      up to `move` steps; a step climbs at most `jump` levels and
//              drops at most jump + 1; not through foes, water, trees, rocks.
//    Range     counted in steps (no diagonals). A ranged attack reaches one
//              tile further for each level it stands above its target (two
//              at most). A melee attack needs the target within one level.
//    Facing    a hit from the side does a quarter more, from behind half as
//              much again. A unit ends its turn facing the way its player
//              chooses; a creature (or a unit left to itself) the nearest foe.
//    Height    a hit from higher ground does 15% more.
//    Block     soaks damage until the start of the bearer's next turn.
//    Weak / vulnerable / slow  drop by one at the start of the bearer's turn.
//    Cooldown  an ability with cooldown 2 is ready again two turns later.
//
//  Exports (node and browser): KWTacticsEngine.
// ══════════════════════════════════════════════════════════════════════════
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KWTacticsEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  const DIR_KEYS = ['n', 'e', 's', 'w'];
  const RULES = { FLANK: 1.25, BACK: 1.5, HIGH: 1.15, RANGE_UP: 2, LINE_HITS: 3, LINE_FALLOFF: 0.6, STATUS_CAP: 9 };
  const BLOCKED = { water: true, tree: true, rock: true };
  const STATUSES = ['weak', 'vulnerable', 'slow', 'poison', 'stun', 'bold'];

  // ── Seeded numbers ────────────────────────────────────────────────────────
  // The generator's place is kept on the battle (state.r), so a battle can be
  // stored and carried on.
  function next(holder) {
    let a = (holder.r = ((holder.r >>> 0) + 0x6D2B79F5) >>> 0);
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const int = (holder, n) => Math.floor(next(holder) * n);

  // ── The map ───────────────────────────────────────────────────────────────
  const LANDS = {
    plains:   { ground: 'grass', hills: 3, peak: 2, trees: 2, rocks: 1, water: null },
    forest:   { ground: 'grass', hills: 3, peak: 2, trees: 7, rocks: 1, water: null },
    hills:    { ground: 'grass', hills: 4, peak: 2, trees: 2, rocks: 2, water: null },
    mountain: { ground: 'stone', hills: 5, peak: 3, trees: 0, rocks: 4, water: null },
    river:    { ground: 'grass', hills: 2, peak: 2, trees: 2, rocks: 1, water: 'stream' },
    marsh:    { ground: 'mud',   hills: 2, peak: 1, trees: 2, rocks: 0, water: 'pools' },
    ruins:    { ground: 'stone', hills: 3, peak: 2, trees: 1, rocks: 6, water: null },
  };
  const tileAt = (map, x, y) => (x >= 0 && y >= 0 && x < map.w && y < map.h ? map.tiles[y * map.w + x] : null);
  const passable = t => !!t && !BLOCKED[t.t];
  const dist = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

  // Where each side starts: two in front, two behind (then the flanks).
  function starts(w, h) {
    const m = Math.floor(w / 2);
    return {
      player: [[m - 1, h - 2], [m, h - 2], [m - 2, h - 1], [m + 1, h - 1], [m - 3, h - 2], [m + 2, h - 2]],
      enemy:  [[m - 1, 1], [m, 1], [m - 2, 0], [m + 1, 0], [m - 3, 1], [m + 2, 1], [m - 1, 0], [m, 0]],
    };
  }

  function buildMap(holder, land, w, h) {
    const L = LANDS[land] || LANDS.plains;
    const tiles = [];
    for (let i = 0; i < w * h; i++) tiles.push({ h: 0, t: L.ground });
    const at = (x, y) => tiles[y * w + x];
    // Hills: each is a stepped mound, so neighbouring tiles never differ by
    // more than one level and every slope can be walked.
    for (let k = 0; k < L.hills; k++) {
      const cx = int(holder, w), cy = 1 + int(holder, h - 2), peak = 1 + int(holder, L.peak);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) at(x, y).h = Math.max(at(x, y).h, peak - dist(x, y, cx, cy));
    }
    // Water: a stream across the middle with two fords, or a few pools.
    const wet = [];
    if (L.water === 'stream') {
      const row = Math.floor(h / 2) - int(holder, 2), fordA = int(holder, Math.floor(w / 2)), fordB = Math.floor(w / 2) + int(holder, Math.ceil(w / 2));
      for (let x = 0; x < w; x++) if (x !== fordA && x !== fordB) wet.push([x, row]);
    } else if (L.water === 'pools') {
      for (let k = 0; k < 3; k++) {
        const px = int(holder, w), py = 2 + int(holder, h - 4);
        wet.push([px, py]);
        if (next(holder) < 0.6 && px + 1 < w) wet.push([px + 1, py]);
        if (next(holder) < 0.4 && py + 1 < h - 2) wet.push([px, py + 1]);
      }
    }
    for (const [x, y] of wet) at(x, y).t = 'water';
    // Water lies low: the ground slopes down to it.
    if (wet.length) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) at(x, y).h = Math.min(at(x, y).h, Math.min(...wet.map(p => dist(x, y, p[0], p[1]))));
    // Trees and rocks, never on the rows where the two sides start.
    const put = (kind, n) => {
      for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
        const x = int(holder, w), y = 2 + int(holder, h - 4);
        if (at(x, y).t !== L.ground) continue;
        at(x, y).t = kind; k++;
      }
    };
    put('tree', L.trees); put('rock', L.rocks);
    // The starting rows are open ground.
    const S = starts(w, h);
    for (const [x, y] of S.player.concat(S.enemy)) if (x >= 0 && x < w) at(x, y).t = L.ground;
    return { w, h, land, tiles };
  }
  // Can a walker with jump 1 get from the party's start to every foe's?
  function connected(map) {
    const S = starts(map.w, map.h), seen = new Set(), key = (x, y) => x + ',' + y;
    const queue = [S.player[0]];
    seen.add(key(S.player[0][0], S.player[0][1]));
    while (queue.length) {
      const [x, y] = queue.shift(), here = tileAt(map, x, y);
      for (const d of DIR_KEYS) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], t = tileAt(map, nx, ny);
        if (!passable(t) || seen.has(key(nx, ny)) || Math.abs(t.h - here.h) > 1) continue;
        seen.add(key(nx, ny)); queue.push([nx, ny]);
      }
    }
    return S.player.concat(S.enemy).filter(p => p[0] >= 0 && p[0] < map.w).every(p => seen.has(key(p[0], p[1])));
  }
  // A map for a seed and a land. Tries again (same seed, next numbers) until
  // the two sides can reach each other; failing that, open ground.
  function makeMap(seed, land, w, h) {
    w = w || 8; h = h || 8;
    const holder = { r: (Number(seed) >>> 0) || 1 };
    for (let tries = 0; tries < 30; tries++) {
      const map = buildMap(holder, land, w, h);
      if (connected(map)) return map;
    }
    const flat = buildMap({ r: 1 }, 'plains', w, h);
    flat.land = land;
    for (const t of flat.tiles) { t.h = 0; t.t = (LANDS[land] || LANDS.plains).ground; }
    return flat;
  }

  // ── A battle ──────────────────────────────────────────────────────────────
  // party, enemies: unit definitions (server lib/tactics_setup.js):
  //   { id, name, cls, icon, maxHp, armour, agility, move, jump, abilities: [
  //     { key, name, icon, kind, target, min, max, shape, radius, dmg, block,
  //       heal, fx: { weak, vulnerable, slow, stun, poison, bold, push, step },
  //       cooldown, quick, uses, falloff } ] }
  function createBattle(opts) {
    const map = opts.map || makeMap(opts.seed, opts.land, opts.w, opts.h);
    const S = starts(map.w, map.h);
    const place = (defs, side, spots, face) => defs.map((d, i) => {
      const spot = spots[i % spots.length];
      return {
        ...d, side, x: spot[0], y: spot[1], face,
        hp: d.hp != null ? d.hp : d.maxHp, block: 0, st: {}, cd: {}, used: {}, down: false,
        abilities: (d.abilities || []).map(a => ({ ...a, fx: { ...(a.fx || {}) } })),
      };
    });
    const state = {
      seed: (Number(opts.seed) >>> 0) || 1, r: ((Number(opts.seed) >>> 0) || 1) ^ 0x9e3779b9, map,
      units: place(opts.party || [], 'player', S.player, 'n').concat(place(opts.enemies || [], 'enemy', S.enemy, 's')),
      order: [], index: 0, round: 1, status: 'active',
      turn: { moved: false, acted: false, from: null },
      stats: { turns: 0, enemyTurns: 0 },
    };
    state.order = computeOrder(state);
    state.index = -1;
    advance(state, []);
    return state;
  }

  const unit = (state, id) => state.units.find(u => u.id === id) || null;
  const living = (state, side) => state.units.filter(u => !u.down && (!side || u.side === side));
  const current = state => (state.status === 'active' ? unit(state, state.order[state.index]) : null);
  const unitAt = (state, x, y) => state.units.find(u => !u.down && u.x === x && u.y === y) || null;
  const heightOf = (state, x, y) => { const t = tileAt(state.map, x, y); return t ? t.h : 0; };
  const moveOf = u => Math.max(1, (u.move || 3) - ((u.st.slow || 0) > 0 ? 1 : 0));

  // The round's order: quickest first (slow counts against), the party first on a tie.
  function computeOrder(state) {
    return living(state).slice().sort((a, b) => ((b.agility || 0) - (b.st.slow || 0)) - ((a.agility || 0) - (a.st.slow || 0))
      || (a.side === b.side ? 0 : a.side === 'player' ? -1 : 1) || state.units.indexOf(a) - state.units.indexOf(b)).map(u => u.id);
  }

  // ── Moving ────────────────────────────────────────────────────────────────
  // Every tile the unit could walk to now: Map "x,y" → { x, y, cost, prev }.
  // A unit may pass a friend but not stop there.
  function reach(state, u, pointsOverride) {
    const points = pointsOverride != null ? pointsOverride : moveOf(u), jump = u.jump || 1;
    const key = (x, y) => x + ',' + y, out = new Map();
    out.set(key(u.x, u.y), { x: u.x, y: u.y, cost: 0, prev: null });
    const queue = [out.get(key(u.x, u.y))];
    while (queue.length) {
      const here = queue.shift();
      if (here.cost >= points) continue;
      const h0 = heightOf(state, here.x, here.y);
      for (const d of DIR_KEYS) {
        const nx = here.x + DIRS[d][0], ny = here.y + DIRS[d][1], t = tileAt(state.map, nx, ny);
        if (!passable(t) || out.has(key(nx, ny))) continue;
        const dh = t.h - h0;
        if (dh > jump || -dh > jump + 1) continue;
        const there = unitAt(state, nx, ny);
        if (there && there.side !== u.side) continue;
        const node = { x: nx, y: ny, cost: here.cost + 1, prev: key(here.x, here.y), through: !!there };
        out.set(key(nx, ny), node); queue.push(node);
      }
    }
    for (const [k, n] of out) if (n.through) n.stop = false; else n.stop = true;
    return out;
  }
  // The steps from where the unit stands to a tile it can reach: [{ x, y }, …].
  function pathTo(reachMap, x, y) {
    const path = [];
    let node = reachMap.get(x + ',' + y);
    while (node) { path.unshift({ x: node.x, y: node.y }); node = node.prev ? reachMap.get(node.prev) : null; }
    return path;
  }
  const dirOf = (fx, fy, tx, ty, fallback) => {
    const dx = tx - fx, dy = ty - fy;
    if (!dx && !dy) return fallback || 's';
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  };

  function move(state, x, y) {
    const u = current(state);
    if (!u || state.turn.moved) return null;
    const R = reach(state, u), node = R.get(x + ',' + y);
    if (!node || !node.stop || !node.cost) return null;
    const path = pathTo(R, x, y), last = path[path.length - 2];
    state.turn.from = { x: u.x, y: u.y, face: u.face };
    u.x = x; u.y = y; u.face = dirOf(last.x, last.y, x, y, u.face);
    state.turn.moved = true;
    return [{ type: 'move', id: u.id, path, face: u.face }];
  }
  // Take a move back, until the unit has done anything else.
  function undoMove(state) {
    const u = current(state), f = state.turn.from;
    if (!u || !state.turn.moved || state.turn.acted || state.turn.quick || !f) return false;
    u.x = f.x; u.y = f.y; u.face = f.face;
    state.turn.moved = false; state.turn.from = null;
    return true;
  }

  // ── Abilities ─────────────────────────────────────────────────────────────
  const ability = (u, key) => (u.abilities || []).find(a => a.key === key) || null;
  function canUse(state, u, a) {
    if (!a) return { ok: false, why: 'unknown' };
    if ((u.cd[a.key] || 0) > 0) return { ok: false, why: 'cooldown', turns: u.cd[a.key] };
    if (a.uses != null && (u.used[a.key] || 0) >= a.uses) return { ok: false, why: 'spent' };
    if (current(state) === u) {
      if (a.quick ? (state.turn.quickUsed || []).includes(a.key) : state.turn.acted) return { ok: false, why: 'acted' };
    }
    return { ok: true };
  }
  const isRanged = a => (a.max || 0) > 1;
  const foeOf = (u, o) => o.side !== u.side;
  // How far this ability reaches at a target tile, from where the unit stands.
  function reachOf(state, u, a, from, tx, ty) {
    if (!isRanged(a)) return a.max || 0;
    const up = heightOf(state, from.x, from.y) - heightOf(state, tx, ty);
    return (a.max || 0) + Math.max(0, Math.min(RULES.RANGE_UP, up));
  }
  function inBand(state, u, a, from, tx, ty) {
    const d = dist(from.x, from.y, tx, ty);
    if (d < (a.min || 0) || d > reachOf(state, u, a, from, tx, ty)) return false;
    if (a.shape === 'line' && from.x !== tx && from.y !== ty) return false;
    if (!isRanged(a) && d > 0 && Math.abs(heightOf(state, from.x, from.y) - heightOf(state, tx, ty)) > 1) return false;
    return true;
  }
  // Who an ability would touch if aimed at a tile: [{ u, mult }].
  function touched(state, u, a, tx, ty, from) {
    from = from || u;
    const wants = o => (a.target === 'enemy' ? foeOf(u, o) : a.target === 'ally' ? (!foeOf(u, o) && o !== u) : !foeOf(u, o));
    const shape = a.shape || 'single';
    if (shape === 'around') {
      return living(state).filter(o => wants(o) && dist(from.x, from.y, o === u ? from.x : o.x, o === u ? from.y : o.y) <= (a.radius || 1)).map(o => ({ u: o, mult: 1 }));
    }
    if (!inBand(state, u, a, from, tx, ty)) return [];
    if (shape === 'burst') {
      return living(state).filter(o => wants(o) && dist(tx, ty, o === u ? from.x : o.x, o === u ? from.y : o.y) <= (a.radius || 1)).map(o => ({ u: o, mult: 1 }));
    }
    if (shape === 'line') {
      const d = dirOf(from.x, from.y, tx, ty), out = [];
      // Down the line from the unit: the first few it meets, each hit weaker.
      for (let k = 1; out.length < RULES.LINE_HITS; k++) {
        const x = from.x + DIRS[d][0] * k, y = from.y + DIRS[d][1] * k;
        if (!tileAt(state.map, x, y) || k > reachOf(state, u, a, from, x, y)) break;
        if (k < (a.min || 0)) continue;
        const o = unitAt(state, x, y);
        if (o && o !== u && wants(o)) out.push({ u: o, mult: Math.pow(a.falloff != null ? a.falloff : RULES.LINE_FALLOFF, out.length) });
      }
      return out;
    }
    // (Weighing a tile it has not walked to yet, the unit counts as standing there.)
    const here = tx === from.x && ty === from.y;
    const o = here ? u : unitAt(state, tx, ty);
    if (!o || (o === u && !here) || !wants(o)) return [];
    return [{ u: o, mult: 1 }];
  }
  // The tiles worth tapping for this ability: those where it would touch someone.
  function targetTiles(state, u, a, from) {
    from = from || u;
    const out = [];
    if (a.shape === 'around' || a.target === 'self') {
      if (touched(state, u, a, from.x, from.y, from).length || a.target === 'self') out.push({ x: from.x, y: from.y });
      return out;
    }
    for (let y = 0; y < state.map.h; y++) for (let x = 0; x < state.map.w; x++) {
      if (touched(state, u, a, x, y, from).length) out.push({ x, y });
    }
    return out;
  }
  // Every tile inside the ability's reach (for the highlight), touched or not.
  function rangeTiles(state, u, a, from) {
    from = from || u;
    const out = [];
    if (a.shape === 'around') {
      for (let y = 0; y < state.map.h; y++) for (let x = 0; x < state.map.w; x++) if (dist(from.x, from.y, x, y) <= (a.radius || 1)) out.push({ x, y });
      return out;
    }
    if (a.target === 'self') return [{ x: from.x, y: from.y }];
    for (let y = 0; y < state.map.h; y++) for (let x = 0; x < state.map.w; x++) if (inBand(state, u, a, from, x, y)) out.push({ x, y });
    return out;
  }

  // From which side a hit lands: 'front', 'side' or 'back'.
  function sideOfHit(ax, ay, t) {
    const vx = ax - t.x, vy = ay - t.y;
    if (!vx && !vy) return 'front';
    const f = DIRS[t.face] || DIRS.s, dot = vx * f[0] + vy * f[1], cross = Math.abs(vx * f[1] - vy * f[0]);
    if (dot >= cross) return 'front';
    if (-dot > cross) return 'back';
    return 'side';
  }
  // What one hit would do, without doing it.
  function hitOf(state, u, a, t, mult, from, boldLeft) {
    from = from || u;
    let d = (a.dmg || 0) * (mult || 1);
    d = Math.max(1, d + (boldLeft || 0) - (u.st.weak || 0)) + (t.st.vulnerable || 0);
    const side = sideOfHit(from.x, from.y, t), high = heightOf(state, from.x, from.y) > heightOf(state, t.x, t.y);
    d *= side === 'back' ? RULES.BACK : side === 'side' ? RULES.FLANK : 1;
    if (high) d *= RULES.HIGH;
    d = Math.max(1, Math.round(d));
    const armoured = Math.min(Math.floor((t.armour || 0) / 2), d - 1);
    d -= armoured;
    const blocked = Math.min(t.block || 0, d);
    return { dmg: d - blocked, blocked, armoured, side, high, kill: d - blocked >= t.hp };
  }
  // What using the ability on a tile would do: one line per unit touched.
  function forecast(state, u, a, tx, ty, from) {
    from = from || u;
    return touched(state, u, a, tx, ty, from).map((h, i) => {
      const line = { id: h.u.id, name: h.u.name, fx: {} };
      if (a.dmg) Object.assign(line, hitOf(state, u, a, h.u, h.mult, from, i === 0 ? (u.st.bold || 0) : 0));
      if (a.block) line.block = a.block;
      if (a.heal) line.heal = Math.min(a.heal, h.u.maxHp - h.u.hp);
      for (const k of STATUSES) if (a.fx && a.fx[k]) line.fx[k] = a.fx[k];
      if (a.fx && a.fx.push) line.fx.push = a.fx.push;
      return line;
    });
  }

  const addStatus = (t, k, n) => { t.st[k] = Math.min(RULES.STATUS_CAP, (t.st[k] || 0) + n); };
  // One tile straight away from a point, if the mover can stand there.
  function shoveTo(state, mover, awayX, awayY) {
    const d = dirOf(awayX, awayY, mover.x, mover.y, null);
    if (!d || (awayX === mover.x && awayY === mover.y)) return null;
    const nx = mover.x + DIRS[d][0], ny = mover.y + DIRS[d][1], t = tileAt(state.map, nx, ny);
    if (!passable(t) || unitAt(state, nx, ny) || t.h - heightOf(state, mover.x, mover.y) > 1) return null;
    return { x: nx, y: ny };
  }

  function use(state, key, tx, ty) {
    const u = current(state);
    if (!u) return null;
    const a = ability(u, key);
    if (!canUse(state, u, a).ok) return null;
    if (a.shape === 'around' || a.target === 'self') { tx = u.x; ty = u.y; }
    const hits = touched(state, u, a, tx, ty, u);
    if (!hits.length && a.target !== 'self') return null;
    const ev = [{ type: 'use', id: u.id, key: a.key, name: a.name, icon: a.icon, kind: a.kind, x: tx, y: ty }];
    if (tx !== u.x || ty !== u.y) { u.face = dirOf(u.x, u.y, tx, ty, u.face); ev.push({ type: 'face', id: u.id, face: u.face }); }
    let bold = a.dmg ? (u.st.bold || 0) : 0;
    if (a.dmg && bold) u.st.bold = 0;
    const list = hits.length ? hits : [{ u, mult: 1 }];
    for (const h of list) {
      const t = h.u;
      if (t.down) continue;
      if (a.dmg) {
        const r = hitOf(state, u, a, t, h.mult, u, bold);
        bold = 0;
        t.block = Math.max(0, (t.block || 0) - r.blocked);
        t.hp = Math.max(0, t.hp - r.dmg);
        ev.push({ type: 'hit', id: t.id, by: u.id, dmg: r.dmg, blocked: r.blocked, armoured: r.armoured, side: r.side, high: r.high, hp: t.hp });
        if (t.hp <= 0) { t.down = true; ev.push({ type: 'down', id: t.id }); continue; }
      }
      if (a.block) { t.block = (t.block || 0) + a.block; ev.push({ type: 'block', id: t.id, amount: a.block, block: t.block }); }
      if (a.heal) { const n = Math.min(a.heal, t.maxHp - t.hp); t.hp += n; ev.push({ type: 'heal', id: t.id, amount: n, hp: t.hp }); }
      for (const k of STATUSES) if (a.fx && a.fx[k]) { addStatus(t, k, a.fx[k]); ev.push({ type: 'status', id: t.id, name: k, amount: a.fx[k], now: t.st[k] }); }
      if (a.fx && a.fx.push && foeOf(u, t)) {
        const to = shoveTo(state, t, u.x, u.y);
        if (to) { ev.push({ type: 'push', id: t.id, from: { x: t.x, y: t.y }, to }); t.x = to.x; t.y = to.y; }
      }
    }
    if (a.fx && a.fx.step && hits.length) {
      const to = shoveTo(state, u, hits[0].u.x, hits[0].u.y);
      if (to) { ev.push({ type: 'push', id: u.id, from: { x: u.x, y: u.y }, to, step: true }); u.x = to.x; u.y = to.y; }
    }
    if (a.cooldown) u.cd[a.key] = a.cooldown + 1;
    if (a.uses != null) u.used[a.key] = (u.used[a.key] || 0) + 1;
    if (a.quick) { state.turn.quick = true; state.turn.quickUsed = (state.turn.quickUsed || []).concat([a.key]); }
    else state.turn.acted = true;
    finish(state, ev);
    return ev;
  }

  function finish(state, ev) {
    if (state.status !== 'active') return true;
    if (!living(state, 'enemy').length) state.status = 'victory';
    else if (!living(state, 'player').length) state.status = 'defeat';
    if (state.status !== 'active') { ev.push({ type: 'end', status: state.status }); return true; }
    return false;
  }

  // ── Turns ─────────────────────────────────────────────────────────────────
  function nearestFoe(state, u) {
    let best = null;
    for (const o of living(state)) if (foeOf(u, o)) { const d = dist(u.x, u.y, o.x, o.y); if (!best || d < best.d) best = { o, d }; }
    return best ? best.o : null;
  }
  // To the next unit that can take a turn; what happens as its turn starts.
  function advance(state, ev) {
    for (let guard = 0; guard < 200 && state.status === 'active'; guard++) {
      state.index++;
      if (state.index >= state.order.length) {
        state.round += 1;
        state.order = computeOrder(state);
        state.index = 0;
        ev.push({ type: 'round', n: state.round });
      }
      const u = unit(state, state.order[state.index]);
      if (!u || u.down) continue;
      // The turn starts: block is gone, cooldowns tick, lasting effects wear off.
      u.block = 0;
      for (const k of Object.keys(u.cd)) if (u.cd[k] > 0) u.cd[k] -= 1;
      if ((u.st.poison || 0) > 0) {
        const n = u.st.poison;
        u.hp = Math.max(0, u.hp - n); u.st.poison = n - 1;
        ev.push({ type: 'poison', id: u.id, amount: n, hp: u.hp });
        if (u.hp <= 0) { u.down = true; ev.push({ type: 'down', id: u.id }); if (finish(state, ev)) return; continue; }
      }
      for (const k of ['weak', 'vulnerable', 'slow']) if ((u.st[k] || 0) > 0) u.st[k] -= 1;
      if ((u.st.stun || 0) > 0) { u.st.stun -= 1; ev.push({ type: 'skip', id: u.id, why: 'stun' }); continue; }
      state.turn = { moved: false, acted: false, from: null };
      if (u.side === 'player') state.stats.turns++; else state.stats.enemyTurns++;
      ev.push({ type: 'turn', id: u.id });
      return;
    }
  }
  // The way a unit would turn if left to itself: towards the nearest foe.
  function facingFor(state, u) {
    const foe = nearestFoe(state, u);
    return foe ? dirOf(u.x, u.y, foe.x, foe.y, u.face) : u.face;
  }
  // End the turn. `face` (n, e, s, w): the way the unit ends up looking; left
  // out, it watches the nearest foe.
  function endTurn(state, face) {
    const u = current(state);
    if (!u) return null;
    const ev = [];
    const f = DIRS[face] ? face : facingFor(state, u);
    if (f !== u.face) { u.face = f; ev.push({ type: 'face', id: u.id, face: f }); }
    advance(state, ev);
    return ev;
  }

  // ── A mind for creatures (and for the bot that plays the party in tests) ──
  // Walking distance to the nearest of some tiles, ignoring who stands where.
  function distField(state, sources, jump) {
    const key = (x, y) => y * state.map.w + x, field = new Array(state.map.w * state.map.h).fill(Infinity);
    const queue = [];
    for (const s of sources) { field[key(s.x, s.y)] = 0; queue.push(s); }
    while (queue.length) {
      const here = queue.shift(), h0 = heightOf(state, here.x, here.y), c = field[key(here.x, here.y)];
      for (const d of DIR_KEYS) {
        const nx = here.x + DIRS[d][0], ny = here.y + DIRS[d][1], t = tileAt(state.map, nx, ny);
        if (!passable(t) || field[key(nx, ny)] <= c + 1 || Math.abs(t.h - h0) > (jump || 1) + 1) continue;
        field[key(nx, ny)] = c + 1; queue.push({ x: nx, y: ny });
      }
    }
    return (x, y) => field[key(x, y)];
  }
  // What an action is worth to the side taking it.
  function worth(state, u, a, lines, from) {
    let v = 0;
    const threatened = t => living(state).some(o => foeOf(t, o) && dist(o.x, o.y, t === u ? from.x : t.x, t === u ? from.y : t.y) <= moveOf(o) + 1);
    for (const l of lines) {
      const t = unit(state, l.id);
      if (a.dmg) v += l.dmg + l.blocked * 0.3 + (l.kill ? 14 : 0) + (t.hp - l.dmg <= t.maxHp * 0.3 ? 2 : 0);
      if (l.block) v += Math.min(l.block, 18) * (threatened(t) ? 0.55 : 0.08);
      if (l.heal != null) v += l.heal * 1.3 + (t.hp < t.maxHp * 0.4 ? 6 : 0);
      if (l.fx.weak) v += l.fx.weak * 1.6;
      if (l.fx.vulnerable) v += l.fx.vulnerable * 1.8;
      if (l.fx.slow) v += l.fx.slow * 1.2;
      if (l.fx.poison) v += l.fx.poison * 2;
      if (l.fx.stun) v += 12;
      if (l.fx.bold) v += (t.abilities || []).some(x => x.dmg) && !(t.st.bold > 0) ? l.fx.bold * 0.8 : 0;
      if (l.fx.push) v += 1.5;
    }
    return v;
  }
  // The best turn the current unit can see: { to, ability, x, y, quick: [...] }.
  function plan(state) {
    const u = current(state);
    if (!u) return null;
    const R = state.turn.moved ? new Map([[u.x + ',' + u.y, { x: u.x, y: u.y, cost: 0, stop: true }]]) : reach(state, u);
    const foes = living(state).filter(o => foeOf(u, o));
    const toFoe = distField(state, foes, u.jump);
    const ranged = (u.abilities || []).some(a => a.dmg && isRanged(a));
    const want = ranged ? Math.max(2, Math.min(...(u.abilities || []).filter(a => a.dmg && isRanged(a)).map(a => a.max))) : 1;
    let best = null;
    const consider = (o) => { if (!best || o.v > best.v + 1e-9 || (Math.abs(o.v - best.v) <= 1e-9 && next(state) < 0.5)) best = o; };
    for (const node of R.values()) {
      if (!node.stop) continue;
      const from = { x: node.x, y: node.y };
      // Where it stands matters too: near enough to strike next turn, on high
      // ground, and (for those who shoot) not shoulder to shoulder with a foe.
      const near = foes.filter(o => dist(o.x, o.y, from.x, from.y) === 1).length;
      const d = toFoe(from.x, from.y);
      let ground = heightOf(state, from.x, from.y) * 0.6 - (ranged ? near * 2.5 : 0) - Math.abs((isFinite(d) ? d : 20) - want) * (ranged ? 0.8 : 1.1) - node.cost * 0.02;
      consider({ v: ground - 3, to: from, ability: null });
      if (state.turn.acted) continue;
      for (const a of u.abilities || []) {
        if (a.quick || !canUse(state, u, a).ok) continue;
        for (const t of targetTiles(state, u, a, from)) {
          const lines = forecast(state, u, a, t.x, t.y, from);
          const v = worth(state, u, a, lines, from);
          if (v <= 0.5) continue;
          consider({ v: v + ground, to: from, ability: a.key, x: t.x, y: t.y });
        }
      }
    }
    return best;
  }
  // Take the current unit's whole turn. → the events, in order.
  function aiTurn(state) {
    const u = current(state);
    if (!u) return [];
    const ev = [];
    const p = plan(state);
    if (p && p.to && (p.to.x !== u.x || p.to.y !== u.y)) { const m = move(state, p.to.x, p.to.y); if (m) ev.push(...m); }
    // Quick abilities first, where one has someone worth it.
    for (const a of (u.abilities || []).filter(x => x.quick)) {
      if (state.status !== 'active' || !canUse(state, u, a).ok) continue;
      let pick = null;
      for (const t of targetTiles(state, u, a, u)) {
        const lines = forecast(state, u, a, t.x, t.y, u), v = worth(state, u, a, lines, u) + lines.reduce((n, l) => n + unit(state, l.id).hp * 0.01, 0);
        if (v > 1 && (!pick || v > pick.v)) pick = { v, t };
      }
      if (pick) { const r = use(state, a.key, pick.t.x, pick.t.y); if (r) ev.push(...r); }
    }
    if (state.status === 'active' && p && p.ability && !state.turn.acted) {
      const r = use(state, p.ability, p.x, p.y);
      if (r) ev.push(...r);
    }
    if (state.status === 'active') ev.push(...(endTurn(state) || []));
    return ev;
  }

  // ── A battle as a list of the player's choices ────────────────────────────
  // The server stores a battle as its two sides and what the player chose,
  // in order, and gets the whole battle back by playing them again:
  //   { t: 'move', x, y } · { t: 'use', key, x, y } · { t: 'undo' } · { t: 'end', face }
  // Creatures need no entries: their mind is part of the rules, so both sides
  // reach the same turns from the same choices.

  // Creatures act until it is a citizen's turn (or the battle is over). → events.
  function settle(state) {
    const ev = [];
    for (let guard = 0; guard < 200 && state.status === 'active'; guard++) {
      const u = current(state);
      if (!u || u.side === 'player') break;
      ev.push(...aiTurn(state));
    }
    return ev;
  }
  // One of the player's choices. → the events, or null if the rules refuse it.
  function apply(state, a) {
    const u = current(state);
    if (!a || !u || u.side !== 'player' || state.status !== 'active') return null;
    if (a.t === 'move') return move(state, Number(a.x), Number(a.y));
    if (a.t === 'use') return use(state, String(a.key), Number(a.x), Number(a.y));
    if (a.t === 'undo') return undoMove(state) ? [{ type: 'undo', id: u.id }] : null;
    if (a.t === 'end') { const ev = endTurn(state, a.face); return ev ? ev.concat(settle(state)) : null; }
    return null;
  }
  // The battle as it stands after these choices. `bad`: the index of the first
  // choice the rules refused (the battle stops there), or -1.
  function replay(setup, actions) {
    const state = createBattle({ seed: setup.seed, land: setup.land, party: setup.party, enemies: setup.enemies });
    settle(state);
    let bad = -1;
    const list = actions || [];
    for (let i = 0; i < list.length; i++) { if (!apply(state, list[i])) { bad = i; break; } }
    return { state, bad };
  }
  // A fingerprint of the board: who stands where, how hurt, and whose turn.
  // The same on both sides if they agree, which is all it is for.
  function checksum(state) {
    let h = 2166136261;
    const text = [state.status, state.round, state.index, state.turn.moved ? 1 : 0, state.turn.acted ? 1 : 0, state.r >>> 0]
      .concat(state.units.map(u => [u.id, u.x, u.y, u.face, u.hp, u.block, u.down ? 1 : 0, STATUSES.map(k => u.st[k] || 0).join('.')].join(','))).join('|');
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  // How it ended, for the record: the party's health and who is down.
  function resultOf(state) {
    return { status: state.status, rounds: state.round, turns: state.stats.turns,
      party: state.units.filter(u => u.side === 'player').map(u => ({ id: u.id, citizen_id: u.citizen_id || null, hp: Math.max(0, u.hp), maxHp: u.maxHp, down: !!u.down })) };
  }

  // Play a whole battle with the mind on both sides (tests and tuning).
  function autoplay(opts, maxTurns) {
    const state = createBattle(opts);
    for (let g = 0; g < (maxTurns || 400) && state.status === 'active'; g++) aiTurn(state);
    return state;
  }

  return {
    RULES, LANDS, DIRS, DIR_KEYS, STATUSES,
    makeMap, connected, starts, tileAt, passable, dist,
    createBattle, current, unit, unitAt, living, heightOf, moveOf, computeOrder,
    reach, pathTo, move, undoMove,
    ability, canUse, isRanged, targetTiles, rangeTiles, touched, forecast, sideOfHit, hitOf, use,
    endTurn, facingFor, plan, aiTurn, autoplay,
    settle, apply, replay, checksum, resultOf,
  };
});
