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
//  A turn: the unit may walk as far as its steps allow, in as many goes as it
//  likes, and act once, in any order (walk, strike, walk on), and may use any
//  "quick" abilities besides. Then the turn ends.
//
//  The rules, in one place:
//    Move      up to `move` steps a turn, in one walk or several; a step climbs at most `jump` levels and
//              drops at most jump + 1; not through foes, water, trees, rocks.
//    Ground    shallows, mire and snow take two steps to walk into (a unit
//              can always take one step). Ice and fallen leaves walk as
//              open ground.
//    Cover     a unit with a tree or a rock beside it, on the side a shot
//              comes from, takes a quarter less from anything ranged that
//              is loosed from more than one tile away.
//    Season    the map is made for a season. Spring: one ford, not two, and
//              mud after the thaw. Summer: as the land is. Autumn: leaves
//              lie under the trees. Winter: water is ice and can be walked,
//              mire is frozen hard, and drifts of snow lie about.
//    Hidden    a unit that ends its turn on fallen leaves, having neither
//              moved nor struck, is hidden: no foe further than one tile
//              away can single it out (a burst or a line still catches it).
//              Moving, striking or being shoved shows it again.
//    Placing   a battle may begin with the party being placed: any open
//              tile of its own two rows, before anyone takes a turn.
//    Range     counted in steps (no diagonals). A ranged attack reaches one
//              tile further for each level it stands above its target (two
//              at most). A melee attack needs the target within one level.
//    Facing    a hit from the side does a quarter more, from behind half as
//              much again. A unit ends its turn facing the way its player
//              chooses; a creature (or a unit left to itself) the nearest foe.
//    Height    a blow from higher ground does 15% more. A shot does 15% more
//              for each level it is loosed from above its target (three
//              levels at most: +45%).
//    Lands     each land makes its own kind of field: plains are all but
//              flat, a forest is thick with trees, hills roll, mountains have
//              peaks, ridges and shelves, ruins have walls. Fields differ in
//              size (seven to ten tiles each way).
//    Lairs     a boss is fought in its lair: a fixed field, indoors (no
//              season), built around the boss's trick (LAIRS, and "Tricks").
//    Tricks    riposte: struck by a foe beside it, it strikes back at half
//              strength, every time (never the felling blow). aloft: a shot
//              from below it does half. shell: a blow to its front does
//              half. rises: the first time it falls it stands again with
//              part of its health. An ability may leave rubble (a rock on
//              the board) or pull its target to the one using it. A dark
//              lair: nobody aims further than three tiles unless they carry
//              a light, stand beside someone who does, or see in the dark.
//    Block     soaks damage until the start of the bearer's next turn.
//    Weak / vulnerable / slow  drop by one at the start of the bearer's turn.
//    Cooldown  an ability with cooldown 2 is ready again two turns later.
//    Fallen    a citizen who goes down lies where they fell: they take no
//              turn and cannot be struck; anyone may step over them but
//              nobody may stop there. Healing them stands them back up with
//              what was healed. A creature that goes down is gone.
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
  const RULES = { FLANK: 1.25, BACK: 1.5, HIGH: 1.15, RANGE_UP: 2, LINE_HITS: 3, LINE_FALLOFF: 0.6, STATUS_CAP: 9, BRACE: 2 / 3, COUNTER: 0.5, COVER: 0.75, HIDE: 1, ZONE: 2,
    SHOT_UP: 0.15, SHOT_UP_MAX: 3, RIPOSTE: 0.5, DARK: 3, RUBBLE: 6 };
  const BLOCKED = { water: true, tree: true, rock: true, pillar: true, root: true };
  const SLOW = { shallows: 1, mire: 1, snow: 1 };      // steps more than one to walk into
  const COVER = { tree: true, rock: true, pillar: true, root: true };      // what a unit can stand behind
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
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
  // Each land's field (counts are for an 8 × 8 field and grow with its size):
  //   mounds, peak   stepped hills, and how high the highest may be
  //   ridges         lines of high ground; plateaus: flat-topped shelves
  //   trees, rocks   and groves: trees stand in clumps; walls: rocks in rows
  const LANDS = {
    plains:   { ground: 'grass', mounds: 1, peak: 1, trees: 2, rocks: 1, water: null },
    forest:   { ground: 'grass', mounds: 2, peak: 2, trees: 11, groves: true, rocks: 1, water: null },
    hills:    { ground: 'grass', mounds: 4, peak: 2, plateaus: 1, trees: 2, rocks: 2, water: null },
    mountain: { ground: 'stone', mounds: 2, peak: 4, ridges: 2, plateaus: 1, trees: 0, rocks: 4, water: null },
    river:    { ground: 'grass', mounds: 2, peak: 2, trees: 2, rocks: 1, water: 'stream', mire: 1 },
    marsh:    { ground: 'mud',   mounds: 1, peak: 1, trees: 2, rocks: 0, water: 'pools', mire: 4 },
    ruins:    { ground: 'stone', mounds: 2, peak: 2, trees: 1, rocks: 2, walls: 2, water: null },
  };
  // The sizes a land's fields come in (w × h): open country is wide, a mountain pass is long.
  const SIZES = {
    plains:   [[9, 8], [10, 8], [9, 9], [8, 8]],
    forest:   [[8, 8], [7, 8], [8, 9], [9, 8]],
    hills:    [[8, 8], [9, 8], [8, 9], [9, 9]],
    mountain: [[8, 9], [8, 10], [9, 9], [8, 8]],
    river:    [[9, 8], [10, 8], [8, 8], [9, 9]],
    marsh:    [[8, 8], [9, 8], [9, 9], [8, 9]],
    ruins:    [[8, 8], [9, 9], [7, 9], [9, 8]],
  };
  const sizeFor = (seed, land) => { const list = SIZES[land] || SIZES.plains, p = list[((Number(seed) >>> 0) || 1) % list.length]; return { w: p[0], h: p[1] }; };
  const tileAt = (map, x, y) => (x >= 0 && y >= 0 && x < map.w && y < map.h ? map.tiles[y * map.w + x] : null);
  const passable = t => !!t && !BLOCKED[t.t];
  const stepCost = t => 1 + (SLOW[t.t] || 0);
  const dist = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

  // Where each side starts: two in front, two behind (then the flanks).
  function starts(w, h) {
    const m = Math.floor(w / 2);
    return {
      player: [[m - 1, h - 2], [m, h - 2], [m - 2, h - 1], [m + 1, h - 1], [m - 3, h - 2], [m + 2, h - 2]],
      enemy:  [[m - 1, 1], [m, 1], [m - 2, 0], [m + 1, 0], [m - 3, 1], [m + 2, 1], [m - 1, 0], [m, 0]],
    };
  }

  function buildMap(holder, land, w, h, season) {
    const L = LANDS[land] || LANDS.plains;
    season = SEASONS.includes(season) ? season : 'summer';
    const tiles = [];
    for (let i = 0; i < w * h; i++) tiles.push({ h: 0, t: L.ground });
    const at = (x, y) => tiles[y * w + x], inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    const grown = c => (c ? Math.max(1, Math.round(c * w * h / 64)) : 0);      // a count for an 8 × 8 field, at this size
    const each = fn => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(x, y, at(x, y)); };
    // High ground is always stepped: neighbouring tiles never differ by more
    // than one level, so every slope can be walked.
    // Mounds.
    for (let k = grown(L.mounds); k > 0; k--) {
      const cx = int(holder, w), cy = 1 + int(holder, h - 2), peak = 1 + int(holder, L.peak);
      each((x, y, t) => { t.h = Math.max(t.h, peak - dist(x, y, cx, cy)); });
    }
    // Ridges: a line of high ground three to five tiles long, across or along the field.
    for (let k = L.ridges || 0; k > 0; k--) {
      const across = next(holder) < 0.5, len = 3 + int(holder, 3), peak = 2 + int(holder, Math.max(1, L.peak - 1));
      const x0 = int(holder, across ? Math.max(1, w - len + 1) : w), y0 = across ? 2 + int(holder, Math.max(1, h - 4)) : 1 + int(holder, Math.max(1, h - len - 1));
      each((x, y, t) => {
        let d = Infinity;
        for (let i = 0; i < len; i++) d = Math.min(d, dist(x, y, x0 + (across ? i : 0), y0 + (across ? 0 : i)));
        t.h = Math.max(t.h, peak - d);
      });
    }
    // Plateaus: a shelf with a flat top.
    for (let k = L.plateaus || 0; k > 0; k--) {
      const cx = int(holder, w), cy = 1 + int(holder, h - 2), top = 1 + int(holder, 2), r = 1 + int(holder, 2);
      each((x, y, t) => { t.h = Math.max(t.h, Math.min(top, top + r - dist(x, y, cx, cy))); });
    }
    // Water: a stream across the middle with two fords (shallows: one of them is under water in spring), or a few pools.
    const wet = [], fords = [];
    if (L.water === 'stream') {
      const row = Math.floor(h / 2) - int(holder, 2), fordA = int(holder, Math.floor(w / 2)), fordB = Math.floor(w / 2) + int(holder, Math.ceil(w / 2));
      for (let x = 0; x < w; x++) {
        if (x === fordA || (x === fordB && season !== 'spring')) fords.push([x, row]); else wet.push([x, row]);
      }
    } else if (L.water === 'pools') {
      for (let k = grown(3); k > 0; k--) {
        const px = int(holder, w), py = 2 + int(holder, h - 4);
        wet.push([px, py]);
        if (next(holder) < 0.6 && px + 1 < w) wet.push([px + 1, py]);
        if (next(holder) < 0.4 && py + 1 < h - 2) wet.push([px, py + 1]);
      }
    }
    for (const [x, y] of wet) at(x, y).t = 'water';
    for (const [x, y] of fords) if (at(x, y).t !== 'water') at(x, y).t = 'shallows';
    // Water lies low: the ground slopes down to it.
    const low = wet.concat(fords);
    if (low.length) each((x, y, t) => { t.h = Math.min(t.h, Math.min(...low.map(p => dist(x, y, p[0], p[1])))); });
    // Trees, rocks and the rest, never on the rows where the two sides start. Whatever cannot be walked through
    // is only put where the two sides can still reach each other.
    const fits = (x, y, kind) => {
      if (!inside(x, y) || y < 2 || y > h - 3 || at(x, y).t !== L.ground) return false;
      at(x, y).t = kind;
      if (!BLOCKED[kind] || connected({ w, h, tiles })) return true;
      at(x, y).t = L.ground;
      return false;
    };
    const put = (kind, count) => {
      const done = [];
      for (let k = 0, tries = 0; k < count && tries < count * 8 + 40; tries++) {
        const x = int(holder, w), y = 2 + int(holder, h - 4);
        if (fits(x, y, kind)) { done.push([x, y]); k++; }
      }
      return done;
    };
    if (L.groves) {
      // A wood: trees stand in clumps, each new one as likely as not beside one already there.
      const trees = [];
      for (let k = 0, tries = 0, want = grown(L.trees); k < want && tries < want * 10; tries++) {
        let x, y;
        if (trees.length && next(holder) < 0.6) { const from = trees[int(holder, trees.length)]; x = from[0] + int(holder, 3) - 1; y = from[1] + int(holder, 3) - 1; }
        else { x = int(holder, w); y = 2 + int(holder, h - 4); }
        if (fits(x, y, 'tree')) { trees.push([x, y]); k++; }
      }
    } else put('tree', grown(L.trees));
    // Walls: what is left of them, two or three stones in a row.
    for (let k = L.walls || 0; k > 0; k--) {
      const across = next(holder) < 0.5, len = 2 + int(holder, 2), x0 = int(holder, w), y0 = 2 + int(holder, h - 4);
      for (let i = 0; i < len; i++) fits(x0 + (across ? i : 0), y0 + (across ? 0 : i), 'rock');
    }
    put('rock', grown(L.rocks));
    // Slow ground: the mire of a wet land; after the spring thaw, mud anywhere (meltwater on bare stone).
    put('mire', grown(L.mire));
    if (season === 'spring') put(L.ground === 'stone' ? 'shallows' : 'mire', 2);
    // Autumn: leaves lie on the open ground beside the trees.
    if (season === 'autumn') {
      const beside = [];
      for (let y = 2; y < h - 2; y++) for (let x = 0; x < w; x++) {
        if (at(x, y).t === L.ground && DIR_KEYS.some(d => { const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; return inside(nx, ny) && at(nx, ny).t === 'tree'; })) beside.push([x, y]);
      }
      for (let k = Math.min(6, beside.length); k > 0; k--) { const p = beside.splice(int(holder, beside.length), 1)[0]; at(p[0], p[1]).t = 'leaves'; }
    }
    // Winter: water is ice, the mire is frozen hard, and snow lies in drifts.
    if (season === 'winter') {
      for (const t of tiles) { if (t.t === 'water' || t.t === 'shallows') t.t = 'ice'; else if (t.t === 'mire') t.t = L.ground; }
      put('snow', 5);
    }
    // The starting places are open ground.
    const S = starts(w, h);
    for (const [x, y] of S.player.concat(S.enemy)) if (x >= 0 && x < w) at(x, y).t = L.ground;
    return { w, h, land, season, ground: L.ground, tiles };
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
  function makeMap(seed, land, w, h, season) {
    w = w || 8; h = h || 8;
    const holder = { r: (Number(seed) >>> 0) || 1 };
    for (let tries = 0; tries < 30; tries++) {
      const map = buildMap(holder, land, w, h, season);
      if (connected(map)) return map;
    }
    const flat = buildMap({ r: 1 }, 'plains', w, h);
    flat.land = land; flat.season = SEASONS.includes(season) ? season : 'summer'; flat.ground = (LANDS[land] || LANDS.plains).ground;
    for (const t of flat.tiles) { t.h = 0; t.t = flat.ground; }
    return flat;
  }

  // ── Lairs ─────────────────────────────────────────────────────────────────
  // A boss is fought in its lair: a fixed field, drawn here row by row (the
  // foes start at the top, the party at the bottom), turned left to right by
  // the seed. Indoors: no season. Each is built around its boss's trick.
  //   rows  . floor   P pillar   R rock   T root   ~ water   , shallows   m mire
  //   high  the height of each tile, 0 to 4
  const LAIRS = {
    redtooth: { name: 'Redtooth\'s Hall', ground: 'flag', says: 'A robbers\' hall: pillars to shoot from behind, and a dais he fights from.',
      rows: ['.........', '.........', '..P...P..', '.........', '.P..P..P.', '.........', '..P...P..', '.........', '.........'],
      high: ['111111111', '111111111', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000'] },
    greyfeather: { name: 'The Owl\'s Hollow', ground: 'earth', dark: true, says: 'The inside of a great dead tree. It is dark: nobody aims further than three tiles without a lantern beside them. The owl sees well enough.',
      rows: ['.........', '.........', 'T..T.T..T', '.........', '.T.....T.', '...T.T...', 'T.......T', '.........', '.........'],
      high: ['000000000', '000000000', '000000000', '001111100', '011222110', '001111100', '000000000', '000000000', '000000000'] },
    storm_matriarch: { name: 'The Storm Eyrie', ground: 'stone', says: 'A spire of rock open to the sky. She keeps the height: climb to her, or shoot from as high as she stands.',
      rows: ['.........', '.........', '.........', 'R.......R', '.........', '.R.....R.', '....R....', '.........', '.........'],
      high: ['223333322', '122333221', '112222211', '011111110', '001111100', '000000000', '000000000', '000000000', '000000000'] },
    grum: { name: 'Grum\'s Cave', ground: 'stone', says: 'A wide cave with little in it, yet. Every boulder he throws stays where it lands.',
      rows: ['.........', '.........', '...R.....', '.........', '.R.....R.', '.........', '.....R...', '.........', '.........'],
      high: ['111111111', '111111111', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000'] },
    old_snapjaw: { name: 'The Sunken Ford', ground: 'stone', says: 'A flooded cellar of the old bridge. There is room to get round him, if you wade.',
      rows: ['.........', '.........', '~~,...,~~', '.........', '.R..,..R.', '~,.....,~', '.........', '.........', '.........'],
      high: ['000000000', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000'] },
    bog_mother: { name: 'The Sinking Throne', ground: 'mud', says: 'A throne of roots in a ring of mire. Whoever her tongue takes is standing in it.',
      rows: ['.........', '.........', '.mmmmmmm.', 'mm.mmm.mm', '.~.....~.', '..m...m..', '...m.m...', '.........', '.........'],
      high: ['000111000', '000111000', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000'] },
    hollow_king: { name: 'The Hollow Crypt', ground: 'flag', says: 'A crypt of pillars and stone coffins. He has been laid to rest here before.',
      rows: ['.........', '.........', '.P.....P.', '...R.R...', '.P.....P.', '...R.R...', '.P.....P.', '.........', '.........'],
      high: ['111111111', '111111111', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000', '000000000'] },
  };
  const LAIR_KIND = { P: 'pillar', R: 'rock', T: 'root', '~': 'water', ',': 'shallows', m: 'mire' };
  function makeLair(seed, key) {
    const L = LAIRS[key];
    if (!L) return null;
    const h = L.rows.length, w = L.rows[0].length, flip = ((Number(seed) >>> 0) || 1) % 2 === 1, tiles = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = flip ? w - 1 - x : x;
      tiles.push({ h: Number(L.high[y][sx]) || 0, t: LAIR_KIND[L.rows[y][sx]] || L.ground });
    }
    return { w, h, land: 'lair', lair: key, name: L.name, season: null, ground: L.ground, dark: L.dark ? RULES.DARK : 0, tiles };
  }

  // ── A battle ──────────────────────────────────────────────────────────────
  // party, enemies: unit definitions (server lib/tactics_setup.js):
  //   { id, name, cls, icon, maxHp, armour, agility, move, jump, abilities: [
  //     { key, name, icon, kind, target, min, max, shape, radius, dmg, block,
  //       heal, fx: { weak, vulnerable, slow, stun, poison, bold, push, step },
  //       cooldown, quick, uses, falloff } ] }
  //   st0: statuses the unit begins the battle with (a dungeon's keepsake or curse: { vulnerable: 2 }).
  function createBattle(opts) {
    const map = opts.map || makeLair(opts.seed, opts.lair) || makeMap(opts.seed, opts.land, opts.w, opts.h, opts.season);
    const S = starts(map.w, map.h);
    const place = (defs, side, spots, face) => defs.map((d, i) => {
      const spot = spots[i % spots.length];
      return {
        ...d, side, x: spot[0], y: spot[1], face,
        // Carried in from an earlier fight already down: they lie at their place until healed.
        hp: d.down ? 0 : (d.hp != null ? d.hp : d.maxHp), block: 0, st: d.down ? {} : { ...(d.st0 || {}) }, cd: {}, used: {}, down: !!d.down, fell: !!d.down,
        abilities: (d.abilities || []).map(a => ({ ...a, fx: { ...(a.fx || {}) } })),
      };
    });
    const state = {
      seed: (Number(opts.seed) >>> 0) || 1, r: ((Number(opts.seed) >>> 0) || 1) ^ 0x9e3779b9, map,
      units: place(opts.party || [], 'player', S.player, 'n').concat(place(opts.enemies || [], 'enemy', S.enemy, 's')),
      order: [], index: 0, round: 1, status: 'active', dark: map.dark || 0,
      turn: { moved: false, acted: false, from: null },
      stats: { turns: 0, enemyTurns: 0 },
    };
    // A battle that begins with the party being placed waits for that (place, below) before anyone takes a turn.
    if (opts.place && state.units.some(u => u.side === 'player')) { state.status = 'placing'; return state; }
    state.order = computeOrder(state);
    state.index = -1;
    advance(state, []);
    return state;
  }
  // Where the party may be placed: the open tiles of its own rows.
  function zone(state) {
    const out = [], m = state.map;
    for (let y = m.h - RULES.ZONE; y < m.h; y++) for (let x = 0; x < m.w; x++) if (passable(tileAt(m, x, y))) out.push({ x, y });
    return out;
  }
  // Place the party and begin. `at`: { unit id: [x, y] } for those being moved; the rest stay where they are.
  // → the events, or null if a place is outside the party's rows, not open ground, or taken twice.
  function place(state, at) {
    if (state.status !== 'placing') return null;
    const mine = state.units.filter(u => u.side === 'player'), spots = new Map(), want = (at && typeof at === 'object') ? at : {};
    for (const id of Object.keys(want)) if (!mine.some(u => u.id === id)) return null;
    for (const u of mine) {
      const p = want[u.id], x = p ? Number(p[0]) : u.x, y = p ? Number(p[1]) : u.y;
      if (!Number.isInteger(x) || !Number.isInteger(y) || y < state.map.h - RULES.ZONE || !passable(tileAt(state.map, x, y)) || spots.has(x + ',' + y)) return null;
      spots.set(x + ',' + y, u);
    }
    for (const [k, u] of spots) { const [x, y] = k.split(',').map(Number); u.x = x; u.y = y; }
    state.status = 'active';
    state.order = computeOrder(state);
    state.index = -1;
    const ev = [{ type: 'place', at: Object.fromEntries(mine.map(u => [u.id, [u.x, u.y]])) }];
    advance(state, ev);
    return ev;
  }

  const unit = (state, id) => state.units.find(u => u.id === id) || null;
  const living = (state, side) => state.units.filter(u => !u.down && (!side || u.side === side));
  const current = state => (state.status === 'active' ? unit(state, state.order[state.index]) : null);
  const unitAt = (state, x, y) => state.units.find(u => !u.down && u.x === x && u.y === y) || null;
  // A fallen citizen lying on a tile (a creature that goes down leaves nothing).
  const canRise = u => !!u.down && u.side === 'player';
  const bodyAt = (state, x, y) => state.units.find(u => canRise(u) && u.x === x && u.y === y) || null;
  const heightOf = (state, x, y) => { const t = tileAt(state.map, x, y); return t ? t.h : 0; };
  const moveOf = u => Math.max(1, (u.move || 3) - ((u.st.slow || 0) > 0 ? 1 : 0));
  // The steps the unit whose turn it is has walked, and has left.
  const spentOf = state => (state.turn && state.turn.spent) || 0;
  const movesLeft = state => { const u = current(state); return u ? Math.max(0, moveOf(u) - spentOf(state)) : 0; };
  const canUndo = state => !!(current(state) && state.turn.trail && state.turn.trail.length);

  // The round's order: quickest first (slow counts against), the party first on a tie.
  function computeOrder(state) {
    return living(state).slice().sort((a, b) => ((b.agility || 0) - (b.st.slow || 0)) - ((a.agility || 0) - (a.st.slow || 0))
      || (a.side === b.side ? 0 : a.side === 'player' ? -1 : 1) || state.units.indexOf(a) - state.units.indexOf(b)).map(u => u.id);
  }

  // ── Moving ────────────────────────────────────────────────────────────────
  // Every tile the unit could walk to now: Map "x,y" → { x, y, cost, prev }.
  // A unit may pass a friend but not stop there; the same for a fallen citizen, whoever is passing.
  function reach(state, u, pointsOverride) {
    // The unit whose turn it is has what is left of its steps; anyone else is measured at their full walk.
    const spent = pointsOverride == null && state.status === 'active' && current(state) === u ? spentOf(state) : 0, fresh = spent === 0;
    const points = pointsOverride != null ? pointsOverride : Math.max(0, moveOf(u) - spent), jump = u.jump || 1;
    const key = (x, y) => x + ',' + y, out = new Map();
    out.set(key(u.x, u.y), { x: u.x, y: u.y, cost: 0, prev: null });
    const queue = [out.get(key(u.x, u.y))];
    while (queue.length) {
      // The nearest tile not yet walked on from (slow ground makes steps unequal).
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[bi].cost) bi = i;
      const here = queue.splice(bi, 1)[0];
      if (here.cost >= points || out.get(key(here.x, here.y)) !== here) continue;
      const h0 = heightOf(state, here.x, here.y);
      for (const d of DIR_KEYS) {
        const nx = here.x + DIRS[d][0], ny = here.y + DIRS[d][1], t = tileAt(state.map, nx, ny);
        if (!passable(t)) continue;
        // Slow ground takes two steps; a unit can always take one step in its turn, whatever it is into.
        let cost = here.cost + stepCost(t);
        if (cost > points) { if (here.cost > 0 || !fresh) continue; cost = points; }
        const old = out.get(key(nx, ny));
        if (old && old.cost <= cost) continue;
        const dh = t.h - h0;
        if (dh > jump || -dh > jump + 1) continue;
        const there = unitAt(state, nx, ny);
        if (there && there.side !== u.side) continue;
        const node = { x: nx, y: ny, cost, prev: key(here.x, here.y), through: !!there || !!bodyAt(state, nx, ny) };
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
    if (!u) return null;
    const R = reach(state, u), node = R.get(x + ',' + y);
    if (!node || !node.stop || !node.cost) return null;
    const path = pathTo(R, x, y), last = path[path.length - 2];
    // Each walk is remembered until the unit does something else, so it can be taken back.
    (state.turn.trail = state.turn.trail || []).push({ x: u.x, y: u.y, face: u.face, hidden: !!u.hidden, spent: spentOf(state) });
    state.turn.from = state.turn.trail[state.turn.trail.length - 1];
    u.x = x; u.y = y; u.face = dirOf(last.x, last.y, x, y, u.face);
    u.hidden = false;
    state.turn.spent = spentOf(state) + node.cost;
    state.turn.moved = true;
    return [{ type: 'move', id: u.id, path, face: u.face }];
  }
  // Take the last walk back, until the unit has done anything else since it.
  function undoMove(state) {
    const u = current(state), trail = (state.turn && state.turn.trail) || [];
    if (!u || !trail.length) return false;
    const f = trail.pop();
    u.x = f.x; u.y = f.y; u.face = f.face; u.hidden = !!f.hidden && !state.turn.struck;
    state.turn.spent = f.spent; state.turn.moved = f.spent > 0;
    state.turn.from = trail.length ? trail[trail.length - 1] : null;
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
  // Can this unit see to aim, standing there in the dark? It sees in the dark, carries a light, or stands beside a friend who does.
  const lit = (state, u, from) => !!(u.sees || u.light || state.units.some(o => o !== u && !o.down && o.side === u.side && o.light && dist(o.x, o.y, from.x, from.y) <= 1));
  const foeOf = (u, o) => o.side !== u.side;
  // How far this ability reaches at a target tile, from where the unit stands.
  function reachOf(state, u, a, from, tx, ty) {
    if (!isRanged(a)) return a.max || 0;
    const up = heightOf(state, from.x, from.y) - heightOf(state, tx, ty);
    const far = (a.max || 0) + Math.max(0, Math.min(RULES.RANGE_UP, up));
    // In a dark lair nobody aims far without a light to aim by.
    return state.dark && !lit(state, u, from) ? Math.min(far, state.dark) : far;
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
    // Healing reaches the fallen too.
    const all = a.heal ? state.units.filter(o => !o.down || canRise(o)) : living(state);
    if (shape === 'around') {
      return all.filter(o => wants(o) && dist(from.x, from.y, o === u ? from.x : o.x, o === u ? from.y : o.y) <= (a.radius || 1)).map(o => ({ u: o, mult: 1 }));
    }
    if (!inBand(state, u, a, from, tx, ty)) return [];
    if (shape === 'burst') {
      return all.filter(o => wants(o) && dist(tx, ty, o === u ? from.x : o.x, o === u ? from.y : o.y) <= (a.radius || 1)).map(o => ({ u: o, mult: 1 }));
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
    const o = here ? u : (unitAt(state, tx, ty) || (a.heal ? bodyAt(state, tx, ty) : null));
    if (!o || (o === u && !here) || !wants(o)) return [];
    if (o.hidden && foeOf(u, o) && dist(from.x, from.y, o.x, o.y) > RULES.HIDE) return [];      // hidden in the leaves
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
  // Is there something to stand behind beside this unit, on the side the shot comes from?
  function coverFrom(state, fx, fy, t) {
    for (const d of DIR_KEYS) {
      const tile = tileAt(state.map, t.x + DIRS[d][0], t.y + DIRS[d][1]);
      if (tile && COVER[tile.t] && (fx - t.x) * DIRS[d][0] + (fy - t.y) * DIRS[d][1] > 0) return true;
    }
    return false;
  }
  // What one hit would do, without doing it.
  function hitOf(state, u, a, t, mult, from, boldLeft) {
    from = from || u;
    let d = (a.dmg || 0) * (mult || 1);
    d = Math.max(1, d + (boldLeft || 0) - (u.st.weak || 0)) + (t.st.vulnerable || 0);
    const side = sideOfHit(from.x, from.y, t), up = heightOf(state, from.x, from.y) - heightOf(state, t.x, t.y), high = up > 0;
    d *= side === 'back' ? (a.back || RULES.BACK) : side === 'side' ? RULES.FLANK : 1;      // a.back: a dagger's blow from behind is worth more
    // From above: a blow does 15% more; a shot 15% more for each level, three at most.
    const above = !high ? 0 : isRanged(a) ? RULES.SHOT_UP * Math.min(RULES.SHOT_UP_MAX, up) : RULES.HIGH - 1;
    if (high) d *= 1 + above;
    // A boss's trick. Aloft: a shot from below it does that much (half). Shell: a blow to its front does that much.
    const aloft = !!t.aloft && isRanged(a) && up < 0, shell = !!t.shell && side === 'front';
    if (aloft) d *= t.aloft;
    if (shell) d *= t.shell;
    // Cover: a shot from more than a tile away, at someone with a tree or a rock on that side of them.
    const cover = isRanged(a) && dist(from.x, from.y, t.x, t.y) > 1 && coverFrom(state, from.x, from.y, t);
    if (cover) d *= RULES.COVER;
    // Brace (a passive): the first hit a unit takes each round does a third less.
    const braced = t.passive === 'brace' && !t.braced;
    if (braced) d *= RULES.BRACE;
    d = Math.max(1, Math.round(d));
    const armoured = Math.min(Math.floor((t.armour || 0) / 2), d - 1);
    d -= armoured;
    const blocked = Math.min(t.block || 0, d);
    const fells = d - blocked >= t.hp, rises = fells && !!t.rises && !t.risen;      // rises: it would fall, and stand again
    return { dmg: d - blocked, blocked, armoured, side, high, above: Math.round(above * 100), cover, braced, aloft, shell, rises, kill: fells && !rises };
  }
  // What using the ability on a tile would do: one line per unit touched.
  function forecast(state, u, a, tx, ty, from) {
    from = from || u;
    return touched(state, u, a, tx, ty, from).map((h, i) => {
      const line = { id: h.u.id, name: h.u.name, fx: {} };
      if (a.dmg) Object.assign(line, hitOf(state, u, a, h.u, h.mult, from, i === 0 ? (u.st.bold || 0) : 0));
      if (a.block) line.block = a.block;
      if (a.heal) line.heal = Math.min(a.heal, h.u.maxHp - h.u.hp);
      if (a.heal && h.u.down) line.raise = true;
      for (const k of STATUSES) if (a.fx && a.fx[k]) line.fx[k] = a.fx[k];
      if (a.fx && a.fx.push) line.fx.push = a.fx.push;
      if (a.fx && a.fx.pull) line.fx.pull = a.fx.pull;
      return line;
    });
  }

  const addStatus = (t, k, n) => { t.st[k] = Math.min(RULES.STATUS_CAP, (t.st[k] || 0) + n); };
  // One tile straight away from a point, if the mover can stand there.
  function shoveTo(state, mover, awayX, awayY) {
    const d = dirOf(awayX, awayY, mover.x, mover.y, null);
    if (!d || (awayX === mover.x && awayY === mover.y)) return null;
    const nx = mover.x + DIRS[d][0], ny = mover.y + DIRS[d][1], t = tileAt(state.map, nx, ny);
    if (!passable(t) || unitAt(state, nx, ny) || bodyAt(state, nx, ny) || t.h - heightOf(state, mover.x, mover.y) > 1) return null;
    return { x: nx, y: ny };
  }

  // A unit at no health: it is down, unless it is one that rises the first time (a boss's trick). → is it down?
  function fall(t, ev) {
    if (t.rises && !t.risen) {
      t.risen = true; t.hp = Math.max(1, Math.round(t.maxHp * t.rises)); t.st = {}; t.block = 0;
      ev.push({ type: 'rise', id: t.id, hp: t.hp });
      return false;
    }
    t.down = true; t.fell = true; t.hidden = false;
    ev.push({ type: 'down', id: t.id });
    return true;
  }
  // Where a thrown boulder comes to rest: the tile it was thrown at if nobody is there, else an open tile beside it.
  // Never where it would cut anyone off from the rest.
  function rubbleSpot(state, tx, ty) {
    if ((state.rubble || 0) >= RULES.RUBBLE) return null;
    const m = state.map, spots = [[tx, ty]].concat(DIR_KEYS.map(d => [tx + DIRS[d][0], ty + DIRS[d][1]]));
    for (const [x, y] of spots) {
      const t = tileAt(m, x, y);
      if (!t || BLOCKED[t.t] || SLOW[t.t] || state.units.some(o => o.x === x && o.y === y && (!o.down || canRise(o)))) continue;
      const was = t.t;
      t.t = 'rock';
      // Everyone standing can still walk to everyone else (who stands where aside).
      const alive = living(state), field = alive.length ? distField(state, [alive[0]], 1) : null;
      if (!field || alive.every(o => isFinite(field(o.x, o.y)))) { t.t = was; return { x, y }; }
      t.t = was;
    }
    return null;
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
    if (a.dmg) { state.turn.struck = true; if (u.hidden) { u.hidden = false; ev.push({ type: 'show', id: u.id }); } }
    const list = hits.length ? hits : [{ u, mult: 1 }];
    for (const h of list) {
      const t = h.u;
      if (t.down) {
        // Healing stands a fallen citizen back up, with what was healed; what ailed them is gone.
        if (!(a.heal && canRise(t) && !foeOf(u, t))) continue;
        t.down = false; t.block = 0; t.st = {};
        ev.push({ type: 'raise', id: t.id, by: u.id });
      }
      if (a.dmg) {
        const r = hitOf(state, u, a, t, h.mult, u, bold);
        bold = 0;
        t.block = Math.max(0, (t.block || 0) - r.blocked);
        t.hp = Math.max(0, t.hp - r.dmg);
        if (r.braced) t.braced = true;
        ev.push({ type: 'hit', id: t.id, by: u.id, dmg: r.dmg, blocked: r.blocked, armoured: r.armoured, side: r.side, high: r.high, hp: t.hp, ...(r.above ? { above: r.above } : {}), ...(r.cover ? { cover: true } : {}), ...(r.braced ? { braced: true } : {}), ...(r.aloft ? { aloft: true } : {}), ...(r.shell ? { shell: true } : {}) });
        if (t.hp <= 0 && fall(t, ev)) continue;
        // Counter (a passive): struck by a foe standing next to them, they strike back at once with their
        // Attack at half strength, once a round. It never fells: the striker is left with 1 at the least.
        // Riposte (a boss's trick) is the same, every time it is struck.
        if (((t.passive === 'counter' && !t.countered) || t.riposte) && foeOf(u, t) && Math.abs(u.x - t.x) + Math.abs(u.y - t.y) === 1 && !((t.st.stun || 0) > 0) && u.hp > 1) {
          const ca = (t.abilities || []).find(x => x.attack && x.dmg) || (t.abilities || []).find(x => x.dmg && (x.max || 0) <= 1 && x.target !== 'self');
          if (ca) {
            const c = hitOf(state, t, ca, u, t.riposte || RULES.COUNTER, t, 0), n = Math.min(c.dmg, u.hp - 1);
            if (!t.riposte) t.countered = true;
            if (c.braced) u.braced = true;
            u.block = Math.max(0, (u.block || 0) - c.blocked);
            u.hp -= n;
            ev.push({ type: 'counter', id: t.id, target: u.id });
            ev.push({ type: 'hit', id: u.id, by: t.id, dmg: n, blocked: c.blocked, armoured: c.armoured, side: c.side, high: c.high, hp: u.hp, counter: true });
          }
        }
      }
      if (a.block) { t.block = (t.block || 0) + a.block; ev.push({ type: 'block', id: t.id, amount: a.block, block: t.block }); }
      if (a.heal) { const n = Math.min(a.heal, t.maxHp - t.hp); t.hp += n; ev.push({ type: 'heal', id: t.id, amount: n, hp: t.hp }); }
      for (const k of STATUSES) if (a.fx && a.fx[k]) { addStatus(t, k, a.fx[k]); ev.push({ type: 'status', id: t.id, name: k, amount: a.fx[k], now: t.st[k] }); }
      if (a.fx && a.fx.push && foeOf(u, t)) {
        const to = shoveTo(state, t, u.x, u.y);
        if (to) { ev.push({ type: 'push', id: t.id, from: { x: t.x, y: t.y }, to }); t.x = to.x; t.y = to.y; t.hidden = false; }
      }
      // Pull: the target is dragged towards the one using it, until it stands beside them or something is in the way.
      if (a.fx && a.fx.pull && foeOf(u, t) && !t.down) {
        const from = { x: t.x, y: t.y };
        for (let k = 0; k < 6 && dist(u.x, u.y, t.x, t.y) > 1; k++) {
          const dx = Math.sign(u.x - t.x), dy = Math.sign(u.y - t.y);
          const ways = Math.abs(u.x - t.x) >= Math.abs(u.y - t.y) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
          const way = ways.find(([sx, sy]) => {
            if (!sx && !sy) return false;
            const tile = tileAt(state.map, t.x + sx, t.y + sy);
            return passable(tile) && !unitAt(state, t.x + sx, t.y + sy) && !bodyAt(state, t.x + sx, t.y + sy) && tile.h - heightOf(state, t.x, t.y) <= 1;
          });
          if (!way) break;
          t.x += way[0]; t.y += way[1];
        }
        if (t.x !== from.x || t.y !== from.y) { t.hidden = false; ev.push({ type: 'push', id: t.id, from, to: { x: t.x, y: t.y }, pull: true }); }
      }
    }
    if (a.fx && a.fx.step && hits.length) {
      const to = shoveTo(state, u, hits[0].u.x, hits[0].u.y);
      if (to) { ev.push({ type: 'push', id: u.id, from: { x: u.x, y: u.y }, to, step: true }); u.x = to.x; u.y = to.y; u.hidden = false; }
    }
    // Rubble: what was thrown stays on the board as a rock.
    if (a.fx && a.fx.rubble) {
      const spot = rubbleSpot(state, tx, ty);
      if (spot) { tileAt(state.map, spot.x, spot.y).t = 'rock'; state.rubble = (state.rubble || 0) + 1; ev.push({ type: 'rubble', x: spot.x, y: spot.y }); }
    }
    state.turn.trail = []; state.turn.from = null;      // a walk made before this can no longer be taken back
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
      // The turn starts: block is gone, cooldowns tick, lasting effects wear off; Brace and Counter are ready again.
      u.block = 0;
      if (u.braced) u.braced = false;
      if (u.countered) u.countered = false;
      for (const k of Object.keys(u.cd)) if (u.cd[k] > 0) u.cd[k] -= 1;
      if ((u.st.poison || 0) > 0) {
        const n = u.st.poison;
        u.hp = Math.max(0, u.hp - n); u.st.poison = n - 1;
        ev.push({ type: 'poison', id: u.id, amount: n, hp: u.hp });
        if (u.hp <= 0 && fall(u, ev)) { if (finish(state, ev)) return; continue; }
      }
      for (const k of ['weak', 'vulnerable', 'slow']) if ((u.st[k] || 0) > 0) u.st[k] -= 1;
      if ((u.st.stun || 0) > 0) { u.st.stun -= 1; ev.push({ type: 'skip', id: u.id, why: 'stun' }); continue; }
      state.turn = { moved: false, acted: false, from: null, spent: 0, trail: [] };
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
    // Still, on fallen leaves, and no blow struck: hidden until they move, strike or are shoved.
    const on = tileAt(state.map, u.x, u.y);
    if (on && on.t === 'leaves' && !state.turn.moved && !state.turn.struck && !u.hidden) { u.hidden = true; ev.push({ type: 'hide', id: u.id }); }
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
        if (!passable(t)) continue;
        const step = stepCost(t);
        if (field[key(nx, ny)] <= c + step || Math.abs(t.h - h0) > (jump || 1) + 1) continue;
        field[key(nx, ny)] = c + step; queue.push({ x: nx, y: ny });
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
      if (l.heal != null) v += l.heal * 1.3 + (t.hp < t.maxHp * 0.4 ? 6 : 0) + (l.raise ? 10 : 0);
      if (l.fx.weak) v += l.fx.weak * 1.6;
      if (l.fx.vulnerable) v += l.fx.vulnerable * 1.8;
      if (l.fx.slow) v += l.fx.slow * 1.2;
      if (l.fx.poison) v += l.fx.poison * 2;
      if (l.fx.stun) v += 12;
      if (l.fx.bold) v += (t.abilities || []).some(x => x.dmg) && !(t.st.bold > 0) ? l.fx.bold * 0.8 : 0;
      if (l.fx.push) v += 1.5;
      if (l.fx.pull) v += 3;
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
    const shooters = foes.filter(o => (o.abilities || []).some(a => a.dmg && isRanged(a)));
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
      const covered = shooters.some(o => dist(o.x, o.y, from.x, from.y) > 1 && coverFrom(state, o.x, o.y, from)) ? 0.5 : 0;
      let ground = heightOf(state, from.x, from.y) * 0.6 + covered - (ranged ? near * 2.5 : 0) - Math.abs((isFinite(d) ? d : 20) - want) * (ranged ? 0.8 : 1.1) - node.cost * 0.02;
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
  //   { t: 'place', at: { id: [x, y] } }   (first, and only in a battle that begins with placing)
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
    if (a && a.t === 'place') { const ev = place(state, a.at); return ev ? ev.concat(settle(state)) : null; }
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
    const state = createBattle({ seed: setup.seed, land: setup.land, season: setup.season, w: setup.w, h: setup.h, lair: setup.lair, place: setup.place, party: setup.party, enemies: setup.enemies });
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
    const text = [state.status, state.round, state.index, state.turn.moved ? 1 : 0, state.turn.acted ? 1 : 0, state.turn.spent || 0, state.rubble || 0, state.r >>> 0]
      .concat(state.units.map(u => [u.id, u.x, u.y, u.face, u.hp, u.block, u.down ? 1 : 0, u.hidden ? 1 : 0, u.risen ? 1 : 0, STATUSES.map(k => u.st[k] || 0).join('.')].join(','))).join('|');
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  // How it ended, for the record: the party's health and who is down.
  function resultOf(state) {
    return { status: state.status, rounds: state.round, turns: state.stats.turns,
      party: state.units.filter(u => u.side === 'player').map(u => ({ id: u.id, citizen_id: u.citizen_id || null, hp: Math.max(0, u.hp), maxHp: u.maxHp, down: !!u.down, fell: !!u.fell })) };
  }

  // Play a whole battle with the mind on both sides (tests and tuning).
  function autoplay(opts, maxTurns) {
    const state = createBattle(opts);
    if (state.status === 'placing') place(state, {});      // the mind keeps the places it was given
    for (let g = 0; g < (maxTurns || 400) && state.status === 'active'; g++) aiTurn(state);
    return state;
  }

  return {
    RULES, LANDS, SIZES, LAIRS, DIRS, DIR_KEYS, STATUSES, SEASONS, SLOW, COVER, BLOCKED,
    makeMap, makeLair, sizeFor, connected, starts, tileAt, passable, stepCost, dist, zone, place, coverFrom, movesLeft, canUndo, lit, reachOf,
    over: state => state.status === 'victory' || state.status === 'defeat',
    createBattle, current, unit, unitAt, bodyAt, living, heightOf, moveOf, computeOrder,
    reach, pathTo, move, undoMove,
    ability, canUse, isRanged, targetTiles, rangeTiles, touched, forecast, sideOfHit, hitOf, use,
    endTurn, facingFor, plan, aiTurn, autoplay,
    settle, apply, replay, checksum, resultOf,
  };
});
