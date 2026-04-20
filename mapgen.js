// Procedural map generation for a 40x40 world

const MAP_SIZE = 40;

const TERRAIN = {
  PLAINS:  'plains',
  FOREST:  'forest',
  HILLS:   'hills',
  RIVER:   'river',
  RUINS:   'ruins',
  MOUNTAIN:'mountain',
  MARSH:   'marsh',
};

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateMap(seed = 42) {
  const rand = seededRand(seed);
  const tiles = [];

  // Base noise grid
  const noise = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => rand())
  );

  // Smooth noise (simple box blur)
  const smooth = (x, y) => {
    let sum = 0, count = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < MAP_SIZE && ny >= 0 && ny < MAP_SIZE) {
          sum += noise[nx][ny]; count++;
        }
      }
    }
    return sum / count;
  };

  // Generate river paths (2-3 rivers)
  const riverTiles = new Set();
  const numRivers = 2 + Math.floor(rand() * 2);
  for (let r = 0; r < numRivers; r++) {
    let x = Math.floor(rand() * MAP_SIZE);
    let y = 0;
    const targetY = MAP_SIZE - 1;
    while (y <= targetY) {
      riverTiles.add(`${x},${y}`);
      y++;
      const drift = rand();
      if (drift < 0.35 && x > 1) x--;
      else if (drift < 0.7 && x < MAP_SIZE - 2) x++;
      // Widen occasionally
      if (rand() < 0.3) riverTiles.add(`${x - 1},${y}`);
      if (rand() < 0.3) riverTiles.add(`${x + 1},${y}`);
    }
  }

  // Place ruins (8-12 scattered)
  const ruinTiles = new Set();
  const numRuins = 8 + Math.floor(rand() * 5);
  for (let i = 0; i < numRuins; i++) {
    const rx = 2 + Math.floor(rand() * (MAP_SIZE - 4));
    const ry = 2 + Math.floor(rand() * (MAP_SIZE - 4));
    ruinTiles.add(`${rx},${ry}`);
  }

  // Place marsh clusters (2-3)
  const marshTiles = new Set();
  const numMarsh = 2 + Math.floor(rand() * 2);
  for (let m = 0; m < numMarsh; m++) {
    const cx = 3 + Math.floor(rand() * (MAP_SIZE - 6));
    const cy = 3 + Math.floor(rand() * (MAP_SIZE - 6));
    const size = 3 + Math.floor(rand() * 4);
    for (let dx = -size; dx <= size; dx++) {
      for (let dy = -size; dy <= size; dy++) {
        if (dx*dx + dy*dy <= size*size && rand() < 0.6) {
          marshTiles.add(`${cx+dx},${cy+dy}`);
        }
      }
    }
  }

  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      const key = `${x},${y}`;
      let terrain;

      if (riverTiles.has(key)) {
        terrain = TERRAIN.RIVER;
      } else if (ruinTiles.has(key)) {
        terrain = TERRAIN.RUINS;
      } else if (marshTiles.has(key)) {
        terrain = TERRAIN.MARSH;
      } else {
        const v = smooth(x, y);
        if (v > 0.72) terrain = TERRAIN.MOUNTAIN;
        else if (v > 0.58) terrain = TERRAIN.HILLS;
        else if (v > 0.42) terrain = TERRAIN.FOREST;
        else terrain = TERRAIN.PLAINS;
      }

      tiles.push({ x, y, terrain, settlement_id: null });
    }
  }

  return tiles;
}

// Terrain bonuses for display
const TERRAIN_BONUSES = {
  plains:   { food: 3, timber: 0, stone: 0, metal: 0, wealth: 1, label: 'Fertile ground', flavor: 'Wide open fields — food and growth come easily here.' },
  forest:   { food: 1, timber: 4, stone: 0, metal: 0, wealth: 0, label: 'Dense woodland', flavor: 'Abundant timber surrounds you. Building comes swiftly.' },
  hills:    { food: 0, timber: 1, stone: 3, metal: 2, wealth: 0, label: 'Rocky highlands', flavor: 'Stone and ore run deep. A strong defensive position.' },
  river:    { food: 2, timber: 1, stone: 0, metal: 0, wealth: 4, label: 'Riverside', flavor: 'Fresh water draws traders. Commerce will flourish.' },
  ruins:    { food: 0, timber: 0, stone: 2, metal: 1, wealth: 3, label: 'Ancient ruins', flavor: 'Old stones hold secrets — and sometimes treasure.' },
  marsh:    { food: 2, timber: 2, stone: 0, metal: 0, wealth: 1, label: 'Misty marshland', flavor: 'Muddy but resourceful. Herbs and game are plentiful.' },
  mountain: { food: 0, timber: 0, stone: 4, metal: 4, wealth: 0, label: 'Mountain base', flavor: 'Rich in ore and stone. A fortress could stand here.' },
};

const MAP_SIZE_EXPORT = MAP_SIZE;

module.exports = { generateMap, TERRAIN_BONUSES, MAP_SIZE: MAP_SIZE_EXPORT };
