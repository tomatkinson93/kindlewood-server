// ══════════════════════════════════════════════════════════════════════════
//  outpost_buildings — small buildings inside an outpost (outpost_buildings).
//
//  Slots: the outpost's level + 1 (2 / 3 / 4). Every outpost can raise the
//  general buildings; each land has its own (`terrains`). One of each.
//  Building costs come out of the town's stores (less the town's building
//  discount) and take `hours` to go up; a building counts once ready_at has
//  passed. Pulling one down frees its slot and gives nothing back.
//
//  Effects (effectsOf → one merged object):
//    cap           store room +x (×(1 + cap))           lib/outpost_store capOf
//    worker_slots  more workers                         routes/outposts assign
//    trip          porters' and crew's legs ×(1 + trip)  lib/outpost_store tripFor
//    carry         porters carry ×(1 + carry) from here  lib/outpost_store tripFor
//    defence       + flat defence                       lib/defences outpostDefence
//    yield         { res: +x } on that resource         lib/outpost_store ratesFor
//    ore           +x on every ore found here            lib/outpost_store ratesFor
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const DEFS = {
  // ── Any land ──
  storehouse: { name: 'Storehouse', icon: '📦', desc: 'Half as much room again in the store.', cost: { timber: 120, stone: 60 }, hours: 1, fx: { cap: 0.5 } },
  bunkhouse:  { name: 'Bunkhouse',  icon: '🛏️', desc: 'Bunks for one more worker.', cost: { timber: 150, wealth: 40 }, hours: 1.5, fx: { worker_slots: 1 } },
  waystation: { name: 'Waystation', icon: '🛤️', desc: 'A cleared track and a rest stop: porters and crew travel 30% faster.', cost: { timber: 100, stone: 80 }, hours: 1, fx: { trip: -0.3 } },
  mule_pen:   { name: 'Mule Pen',   icon: '🫏', desc: 'Pack mules: porters carry half as much again from here.', cost: { timber: 80, food: 150, wealth: 40 }, hours: 1, fx: { carry: 0.5 } },
  watchfire:  { name: 'Watchfire',  icon: '🔥', desc: 'A beacon on a pole and someone to tend it: +8 defence.', cost: { timber: 90, stone: 40 }, hours: 1, fx: { defence: 8 } },
  // ── Clan land only ──
  signal_tower: { clan: true, name: 'Signal Tower', icon: '🗼', desc: 'Clan land only. Its defence reaches clanmates up to 5 tiles away, and they get twice the usual share.', cost: { timber: 150, stone: 150, wealth: 60 }, hours: 2, fx: { clan_signal: 1 } },
  // ── One land each ──
  granary:     { terrains: ['plains'],   name: 'Granary',       icon: '🌾', desc: '+25% food from these fields.', cost: { timber: 150, stone: 80 }, hours: 2, fx: { yield: { food: 0.25 } } },
  sawpit:      { terrains: ['forest'],   name: 'Sawpit',        icon: '🪚', desc: '+25% timber.', cost: { timber: 60, stone: 100, metal: 20 }, hours: 2, fx: { yield: { timber: 0.25 } } },
  crane:       { terrains: ['hills'],    name: 'Quarry Crane',  icon: '🏗️', desc: '+25% stone.', cost: { timber: 160, metal: 30 }, hours: 2, fx: { yield: { stone: 0.25 } } },
  ore_sorter:  { terrains: ['hills', 'mountain'], name: 'Ore Sorter', icon: '🪨', desc: '+40% of every ore found here.', cost: { timber: 120, stone: 80, metal: 40 }, hours: 2, fx: { ore: 0.4 } },
  deep_shaft:  { terrains: ['mountain'], name: 'Deep Shaft',    icon: '⛏️', desc: '+25% iron.', cost: { timber: 200, stone: 120 }, hours: 3, fx: { yield: { metal: 0.25 } } },
  smokehouse:  { terrains: ['river'],    name: 'Smokehouse',    icon: '🐟', desc: '+50% food and +15% wealth from the catch.', cost: { timber: 120, stone: 60 }, hours: 2, fx: { yield: { food: 0.5, wealth: 0.15 } } },
  drying_racks:{ terrains: ['marsh'],    name: 'Drying Racks',  icon: '🌿', desc: '+25% food and +50% timber from reeds and willow.', cost: { timber: 100, wealth: 30 }, hours: 2, fx: { yield: { food: 0.25, timber: 0.5 } } },
  dig_tent:    { terrains: ['ruins'],    name: 'Dig Tent',      icon: '🏺', desc: '+25% wealth and +50% iron from the old stones.', cost: { timber: 100, food: 100, wealth: 60 }, hours: 2, fx: { yield: { wealth: 0.25, metal: 0.5 } } },
};

const slotsFor = level => Math.max(1, Number(level) || 1) + 1;
// `onClanLand`: whether the outpost stands on its owner's clan land (for clan-only buildings).
const allowed = (key, terrain, onClanLand = true) => !!DEFS[key] && (!DEFS[key].terrains || DEFS[key].terrains.includes(terrain)) && (!DEFS[key].clan || !!onClanLand);

// Merged effects of the ready buildings (keys).
function effectsOf(keys) {
  const fx = { cap: 0, worker_slots: 0, trip: 0, carry: 0, defence: 0, ore: 0, clan_signal: 0, yield: {} };
  for (const k of keys || []) {
    const d = DEFS[k];
    if (!d) continue;
    for (const [e, v] of Object.entries(d.fx)) {
      if (e === 'yield') for (const [r, x] of Object.entries(v)) fx.yield[r] = (fx.yield[r] || 0) + x;
      else fx[e] += v;
    }
  }
  return fx;
}

// Rows for some outposts: Map(outpostId → [{ key, built_at, ready_at, ready }]).
async function rowsFor(ids, db, now = Date.now()) {
  const out = new Map();
  if (!ids || !ids.length) return out;
  const run = db ? (t, p) => db.query(t, p) : query;
  const r = await run('SELECT outpost_id, key, built_at, ready_at FROM outpost_buildings WHERE outpost_id = ANY($1::int[]) ORDER BY built_at, key', [ids.map(Number)])
    .catch(() => ({ rows: [] }));
  for (const b of r.rows) {
    const list = out.get(b.outpost_id) || [];
    list.push({ key: b.key, built_at: b.built_at, ready_at: b.ready_at, ready: new Date(b.ready_at).getTime() <= now });
    out.set(b.outpost_id, list);
  }
  return out;
}
// Effects of one outpost's ready buildings.
async function fxFor(outpostId, db) {
  const list = (await rowsFor([outpostId], db)).get(Number(outpostId)) || [];
  return effectsOf(list.filter(b => b.ready).map(b => b.key));
}

// What the panel shows: built (with time left), slots, what could go up.
function present(o, discMult = 1) {
  const built = (o.buildings || []).map(b => ({ ...b, ...pub(b.key) }));
  const have = new Set(built.map(b => b.key));
  const slots = slotsFor(o.level);
  const options = Object.keys(DEFS).filter(k => allowed(k, o.terrain, o.on_clan_land) && !have.has(k)).map(k => ({
    ...pub(k), cost: costOf(k, discMult), hours: DEFS[k].hours, land: !!DEFS[k].terrains, clan: !!DEFS[k].clan,
  }));
  return { slots, used: built.length, built, options };
}
const pub = k => ({ key: k, name: DEFS[k].name, icon: DEFS[k].icon, desc: DEFS[k].desc });
const costOf = (k, mult = 1) => Object.fromEntries(Object.entries(DEFS[k].cost).map(([r, v]) => [r, Math.ceil(v * mult)]));

module.exports = { DEFS, slotsFor, allowed, effectsOf, rowsFor, fxFor, present, costOf };
