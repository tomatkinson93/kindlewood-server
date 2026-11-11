// ══════════════════════════════════════════════════════════════════════════
//  outpost_roads — a road between the town and one of its outposts.
//
//  Level 1 Track, level 2 Paved Road. Cost and build time go by the tiles it
//  crosses (lib/outpost_store hexDist), less the town's building discount.
//  Porters and crew on it travel faster (tripMult); the newest level counts
//  once road_ready_at has passed. Drawn on the map (js/kwmap-roads.js).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const ROADS = {
  1: { name: 'Track',      icon: '🟫', desc: 'A cleared, trodden track: trips 25% faster.', trip: 0.75, perTile: { timber: 60, stone: 20 }, hoursPerTile: 0.5 },
  2: { name: 'Paved Road', icon: '🛣️', desc: 'Flagstones all the way: trips 50% faster.',   trip: 0.5,  perTile: { stone: 120, metal: 20 }, hoursPerTile: 1 },
};
const MAX_ROAD = 2;

// The road level that counts now (the newest one only once it's finished).
function levelOf(o, now = Date.now()) {
  const lvl = Math.max(0, Math.min(MAX_ROAD, Number(o && o.road_level) || 0));
  if (!lvl) return 0;
  const ready = !o.road_ready_at || new Date(o.road_ready_at).getTime() <= now;
  return ready ? lvl : lvl - 1;
}
const tripMult = (o, now) => { const l = levelOf(o, now); return l ? ROADS[l].trip : 1; };

// The next level for a road over `tiles` tiles: { level, name, cost, hours } or null.
function nextOf(o, tiles, mult = 1) {
  const lvl = Math.max(0, Number(o && o.road_level) || 0) + 1;
  const def = ROADS[lvl];
  if (!def) return null;
  const n = Math.max(1, Math.ceil(Number(tiles) || 1));
  return {
    level: lvl, name: def.name, icon: def.icon, desc: def.desc,
    cost: Object.fromEntries(Object.entries(def.perTile).map(([r, v]) => [r, Math.ceil(v * n * mult)])),
    hours: Math.round(def.hoursPerTile * n * mult * 100) / 100,
  };
}

// For the panel and the map.
function present(o, tiles, mult = 1, now = Date.now()) {
  const built = Math.max(0, Number(o.road_level) || 0);
  const level = levelOf(o, now);
  return {
    level, built, name: level ? ROADS[level].name : null,
    building: built > level ? { level: built, name: ROADS[built].name, ready_at: o.road_ready_at } : null,
    trip: tripMult(o, now), tiles, next: built > level ? null : nextOf(o, tiles, mult),
  };
}

module.exports = { ROADS, MAX_ROAD, levelOf, tripMult, nextOf, present };
