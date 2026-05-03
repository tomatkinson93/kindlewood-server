// ══════════════════════════════════════════════
//  HEX MAP GENERATION — Kindlewood
//  Axial coordinates (q, r)
//
//  MAP_W / MAP_H are RUNTIME-MUTABLE via setMapDimensions(). Other modules
//  must NOT destructure them at import time — they need to read the live
//  values, e.g. require('./mapgen').MAP_W. The getters on module.exports
//  below ensure consumers always see the current dimensions.
// ══════════════════════════════════════════════

let _mapW = 40;
let _mapH = 40;

function setMapDimensions(w, h) {
  if (Number.isFinite(w) && w >= 4 && w <= 200) _mapW = Math.floor(w);
  if (Number.isFinite(h) && h >= 4 && h <= 200) _mapH = Math.floor(h);
  return { w: _mapW, h: _mapH };
}

const TERRAIN = {
  PLAINS:'plains', FOREST:'forest', HILLS:'hills', RIVER:'river',
  RUINS:'ruins', MOUNTAIN:'mountain', MARSH:'marsh',
};

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hexDistance(q1,r1,q2,r2) {
  const dq=q1-q2, dr=r1-r2;
  return (Math.abs(dq)+Math.abs(dq+dr)+Math.abs(dr))/2;
}

function hexDistanceWrapped(q1,r1,q2,r2) {
  let min=Infinity;
  for(let dq=-1;dq<=1;dq++) for(let dr=-1;dr<=1;dr++) {
    const d=hexDistance(q1,r1,q2+dq*_mapW,r2+dr*_mapH);
    if(d<min) min=d;
  }
  return min;
}

function hexDisk(cq,cr,radius) {
  const out=[];
  for(let dq=-radius;dq<=radius;dq++) {
    const r1=Math.max(-radius,-dq-radius), r2=Math.min(radius,-dq+radius);
    for(let dr=r1;dr<=r2;dr++) {
      out.push({ q:((cq+dq)%_mapW+_mapW)%_mapW, r:((cr+dr)%_mapH+_mapH)%_mapH });
    }
  }
  return out;
}

function hexRing(cq,cr,radius) {
  if(radius===0) return [{q:cq,r:cr}];
  const dirs=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
  const out=[];
  let q=cq+radius*dirs[4][0], r=cr+radius*dirs[4][1];
  for(const [dq,dr] of dirs) for(let i=0;i<radius;i++){
    out.push({q:((q%_mapW)+_mapW)%_mapW, r:((r%_mapH)+_mapH)%_mapH});
    q+=dq; r+=dr;
  }
  return out;
}

function generateMap(seed=42, opts={}) {
  // Allow callers (e.g. /preview-map) to override dimensions without mutating
  // module-level state. If not provided, use the live module dimensions.
  const W = Number.isFinite(opts.w) && opts.w >= 4 && opts.w <= 200 ? Math.floor(opts.w) : _mapW;
  const H = Number.isFinite(opts.h) && opts.h >= 4 && opts.h <= 200 ? Math.floor(opts.h) : _mapH;
  const rand=seededRand(seed);
  const tiles=[];

  // ── Two independent noise fields ──────────────────────────────────────
  // Layer 1: elevation — same as before, controls mountain/hills/forest/plains
  // Layer 2: vegetation density — independently smoothed; breaks up forests
  //          with clearings and softens biome boundaries.
  const elevRaw=Array.from({length:W},()=>Array.from({length:H},()=>rand()));
  const vegRaw =Array.from({length:W},()=>Array.from({length:H},()=>rand()));

  // Smooth a noise field with a given radius. Larger radius = larger patches.
  const smoothField=(field,radius)=>(q,r)=>{
    let sum=0,cnt=0;
    for(let dq=-radius;dq<=radius;dq++) for(let dr=-radius;dr<=radius;dr++){
      const nq=q+dq,nr=r+dr;
      if(nq>=0&&nq<W&&nr>=0&&nr<H){sum+=field[nq][nr];cnt++;}
    }
    return sum/cnt;
  };
  const elev = smoothField(elevRaw, 1); // small patches — proper biome variety
  const veg  = smoothField(vegRaw,  3); // larger patches — vegetation density

  // ── River network generation ─────────────────────────────────────────────
  // Old approach drew straight columns with stochastic lateral drift, which
  // produced disconnected snakes (the "knight's move" jumps weren't hex
  // neighbours, leaving visible breaks). New approach:
  //   1. Plant a few high-elevation source points
  //   2. Walk each one downward, always moving to a hex-adjacent neighbour
  //      so the path is continuous, biased toward south + southwest
  //   3. Spawn occasional tributaries that walk in from the side and merge
  //      into the trunk
  //   4. Stop when reaching another river or the south edge
  //   5. Seed a few standalone lakes (3-7 tile clusters) for variety
  // All result in tiles tagged as TERRAIN.RIVER; the renderer treats clusters
  // of 4+ connected river tiles as a "lake" visually.
  const riverTiles=new Set();
  // Hex axial neighbours
  const NEIGHBOURS_ALL = [[+1,0],[-1,0],[0,+1],[0,-1],[+1,-1],[-1,+1]];
  // Downhill-biased directions (south + southwest dominant, with east occasional)
  const FLOW_DIRS_WEIGHTED = [
    [0,+1],[0,+1],[0,+1],[0,+1],   // south x4
    [-1,+1],[-1,+1],[-1,+1],       // southwest x3
    [+1,0],[+1,0],                 // east x2 (occasional drift)
    [-1,0],                        // west x1 (rare drift)
  ];

  // Walk one river path from (sq, sr) downward, marking river tiles as we go.
  // Stops at south edge, when wandering off the map, or on hitting an existing
  // river (natural merge). Returns the list of tiles visited (for tributary
  // spawning).
  const walkRiver = (sq, sr, maxSteps) => {
    const visited = [];
    let q = sq, r = sr;
    for (let i = 0; i < maxSteps; i++) {
      if (q < 0 || q >= W || r < 0 || r >= H) break;
      const key = `${q},${r}`;
      if (riverTiles.has(key) && i > 0) {
        // Reached an existing river — merge in by adding the join tile then stopping
        riverTiles.add(key);
        visited.push({q,r});
        break;
      }
      riverTiles.add(key);
      visited.push({q,r});
      // Pick next step from weighted flow directions
      const [dq,dr] = FLOW_DIRS_WEIGHTED[Math.floor(rand() * FLOW_DIRS_WEIGHTED.length)];
      q += dq; r += dr;
    }
    return visited;
  };

  // 3-5 sources placed across the top quarter of the map.
  const numSources = 3 + Math.floor(rand() * 3);
  const trunkPaths = [];
  for (let s = 0; s < numSources; s++) {
    const sq = Math.floor(rand() * W);
    const sr = Math.floor(rand() * (H * 0.25)); // upper quarter
    trunkPaths.push(walkRiver(sq, sr, H));
  }

  // Tributaries — branch off existing trunk tiles, walk a short distance
  // inward from a side toward the trunk. Adds the "fanning" look.
  const numTributaries = 4 + Math.floor(rand() * 4);
  for (let t = 0; t < numTributaries; t++) {
    if (!trunkPaths.length) break;
    const trunk = trunkPaths[Math.floor(rand() * trunkPaths.length)];
    if (trunk.length < 4) continue;
    // Pick a midpoint of the trunk to be the merge target
    const target = trunk[Math.floor(trunk.length * (0.2 + rand() * 0.6))];
    // Start the tributary 4-8 tiles away from the trunk in a perpendicular
    // direction, then walk toward the target. Walk by greedy-toward-target
    // with hex-adjacency steps so it looks natural.
    const sideOffset = 4 + Math.floor(rand() * 5);
    const side = rand() < 0.5 ? +1 : -1;
    let q = target.q + side * sideOffset;
    let r = target.r - Math.floor(rand() * 3); // start slightly upstream
    for (let step = 0; step < 12; step++) {
      if (q < 0 || q >= W || r < 0 || r >= H) break;
      const key = `${q},${r}`;
      if (riverTiles.has(key) && step > 0) {
        riverTiles.add(key);
        break;
      }
      riverTiles.add(key);
      // Choose the hex neighbour that most reduces axial distance to target
      let bestDir = NEIGHBOURS_ALL[0];
      let bestDist = Infinity;
      for (const [dq,dr] of NEIGHBOURS_ALL) {
        const nq = q + dq, nr = r + dr;
        // Cube-coord distance (axial → cube via s = -q-r)
        const dist = (Math.abs(nq - target.q) + Math.abs(nr - target.r)
          + Math.abs((nq + nr) - (target.q + target.r))) / 2;
        if (dist < bestDist - 0.001) { bestDist = dist; bestDir = [dq,dr]; }
      }
      // Add a small chance to pick a random adjacent direction so the path
      // isn't a perfectly straight line.
      const [dq,dr] = rand() < 0.25
        ? NEIGHBOURS_ALL[Math.floor(rand() * NEIGHBOURS_ALL.length)]
        : bestDir;
      q += dq; r += dr;
    }
  }

  // Standalone lakes — small water clusters not attached to rivers, for
  // variety. Each is a flood-fill blob of 3-7 tiles around a random centre.
  const numLakes = 1 + Math.floor(rand() * 3);
  for (let l = 0; l < numLakes; l++) {
    const cq = 4 + Math.floor(rand() * (W - 8));
    const cr = 4 + Math.floor(rand() * (H - 8));
    const size = 3 + Math.floor(rand() * 5);
    const queue = [{q: cq, r: cr}];
    let placed = 0;
    while (queue.length && placed < size) {
      const {q, r} = queue.shift();
      if (q < 0 || q >= W || r < 0 || r >= H) continue;
      const key = `${q},${r}`;
      if (riverTiles.has(key)) continue;
      riverTiles.add(key);
      placed++;
      // Push hex neighbours in random order so the blob grows organically
      const dirs = NEIGHBOURS_ALL.slice().sort(() => rand() - 0.5);
      for (const [dq,dr] of dirs) {
        if (rand() < 0.6) queue.push({q: q+dq, r: r+dr});
      }
    }
  }

  const ruinTiles=new Set();
  const numRuins=8+Math.floor(rand()*5);
  for(let i=0;i<numRuins;i++){
    ruinTiles.add(`${2+Math.floor(rand()*(W-4))},${2+Math.floor(rand()*(H-4))}`);
  }

  const marshTiles=new Set();
  const numMarsh=2+Math.floor(rand()*2);
  for(let m=0;m<numMarsh;m++){
    const cq=3+Math.floor(rand()*(W-6)), cr=3+Math.floor(rand()*(H-6));
    const sz=3+Math.floor(rand()*4);
    for(const {q,r} of hexDisk(cq,cr,sz)) if(rand()<0.6) marshTiles.add(`${q},${r}`);
  }

  for(let q=0;q<W;q++) for(let r=0;r<H;r++){
    const key=`${q},${r}`;
    let terrain;
    if(riverTiles.has(key))      terrain=TERRAIN.RIVER;
    else if(ruinTiles.has(key))  terrain=TERRAIN.RUINS;
    else if(marshTiles.has(key)) terrain=TERRAIN.MARSH;
    else {
      const e=elev(q,r);
      const v=veg(q,r);
      // Elevation decides the broad biome.
      if(e>0.72) {
        terrain=TERRAIN.MOUNTAIN;
      } else if(e>0.58) {
        // Hills band — vegetation lets some forest creep up, plains creep in.
        if(v>0.62)      terrain=TERRAIN.FOREST;   // wooded hills → forest
        else if(v<0.38) terrain=TERRAIN.PLAINS;   // bare hills → grassland
        else            terrain=TERRAIN.HILLS;
      } else if(e>0.42) {
        // Forest band — vegetation carves natural clearings into the canopy.
        if(v<0.42)      terrain=TERRAIN.PLAINS;   // clearing
        else            terrain=TERRAIN.FOREST;
      } else {
        // Plains band — vegetation lets small wooded copses appear.
        if(v>0.66)      terrain=TERRAIN.FOREST;   // copse
        else            terrain=TERRAIN.PLAINS;
      }
    }
    tiles.push({q,r,terrain,settlement_id:null});
  }
  return tiles;
}

const TERRAIN_BONUSES={
  plains:  {food:3,timber:0,stone:0,metal:0,wealth:1,label:'Fertile ground',  flavor:'Wide open fields — food and growth come easily here.'},
  forest:  {food:1,timber:4,stone:0,metal:0,wealth:0,label:'Dense woodland',  flavor:'Abundant timber surrounds you. Building comes swiftly.'},
  hills:   {food:0,timber:1,stone:3,metal:2,wealth:0,label:'Rocky highlands', flavor:'Stone and ore run deep. A strong defensive position.'},
  river:   {food:2,timber:1,stone:0,metal:0,wealth:4,label:'Riverside',       flavor:'Fresh water draws traders. Commerce will flourish.'},
  ruins:   {food:0,timber:0,stone:2,metal:1,wealth:3,label:'Ancient ruins',   flavor:'Old stones hold secrets — and sometimes treasure.'},
  marsh:   {food:2,timber:2,stone:0,metal:0,wealth:1,label:'Misty marshland', flavor:'Muddy but resourceful. Herbs and game are plentiful.'},
  mountain:{food:0,timber:0,stone:4,metal:4,wealth:0,label:'Mountain base',   flavor:'Rich in ore and stone. A fortress could stand here.'},
};

// Use Object.defineProperty so MAP_W / MAP_H / MAP_SIZE are *getters* —
// consumers that do `const { MAP_W } = require('./mapgen')` will only see the
// value at import time and won't pick up runtime changes; consumers that read
// `mapgen.MAP_W` will always see the current value. After this refactor, all
// in-tree consumers use `mapgen.MAP_W` style.
const _exports = {
  generateMap, TERRAIN_BONUSES, setMapDimensions,
  hexDistance, hexDistanceWrapped, hexDisk, hexRing,
};
Object.defineProperty(_exports, 'MAP_W',    { get: () => _mapW, enumerable: true });
Object.defineProperty(_exports, 'MAP_H',    { get: () => _mapH, enumerable: true });
Object.defineProperty(_exports, 'MAP_SIZE', { get: () => _mapW, enumerable: true });
module.exports = _exports;
