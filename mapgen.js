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

  const riverTiles=new Set();
  const numRivers=2+Math.floor(rand()*2);
  for(let rv=0;rv<numRivers;rv++){
    let q=Math.floor(rand()*W);
    for(let r=0;r<H;r++){
      riverTiles.add(`${q},${r}`);
      const drift=rand();
      if(drift<0.35&&q>1) q--;
      else if(drift<0.7&&q<W-2) q++;
      if(rand()<0.3&&q>0) riverTiles.add(`${q-1},${r}`);
      if(rand()<0.3&&q<W-1) riverTiles.add(`${q+1},${r}`);
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
