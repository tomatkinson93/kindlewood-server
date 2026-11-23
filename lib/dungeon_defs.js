// ══════════════════════════════════════════════════════════════════════════
//  dungeon_defs — what a dungeon is made of (docs/DUNGEONS.md §4, §5).
//
//  TIERS     the five skulls: their names, what share of a fight's wealth
//            the party finds, and who they expect. (How much tougher the
//            foes are is lib/tactics_setup.js TIERS.)
//  STORIES   hand-written dungeons: a list of floors, each a small branching
//            path of rooms. The two here are TEST dungeons, started from Dev
//            Tools. The generator (lib/dungeon_gen.js) makes the same shape
//            from a seed.
//  check()   the path rules of §5.1, for stories now and the generator later.
//
//  A room: { id, step, lane, type, next: [ids in the next step], … }
//    fight / elite / boss   enemies: [foe keys]; boost: { hp, str } adds
//                           to the skull's modifiers for this room only
//    treasure               loot: { wealth, items: [{ item, qty }] }
//    rest                   heals the party part-way
//    landing                the last room of every floor but the deepest:
//                           rest once, then go deeper or turn back
//    event                  build step 6; not accepted yet
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const TIER_ORDER = ['green', 'yellow', 'orange', 'red', 'purple'];
// wealth: the share of a fight's usual wealth the party finds, set so a clear
// lands near the budget in docs/DUNGEON_CONTENT.md §8.2. party: who the skull
// expects, in words for the path screen (lib/tactics_setup.js LEVEL_OF_TIER
// and LEVELS are the same thing in numbers). How much tougher a skull's foes are is the board's business:
// lib/tactics_setup.js TIERS (changed live from Dev Tools → Life → Dungeons).
const TIERS = {
  green:  { name: 'Easy',      skull: '🟢', wealth: 0.20, party: 'villagers' },
  yellow: { name: 'Moderate',  skull: '🟡', wealth: 0.30, party: 'novices (class level 3)' },
  orange: { name: 'Hard',      skull: '🟠', wealth: 0.30, party: 'trained fighters (class level 6)' },
  red:    { name: 'Deadly',    skull: '🔴', wealth: 0.35, party: 'trained fighters (class level 6)' },
  purple: { name: 'Nightmare', skull: '🟣', wealth: 0.40, party: 'veterans (class level 10)' },
};

// A skull by its key (green when the key is not a skull).
function tier(key) {
  const k = TIERS[key] ? key : 'green';
  return { ...TIERS[k], key: k };
}

const FIGHTS = ['fight', 'elite', 'boss'];
const TYPES = ['fight', 'elite', 'boss', 'treasure', 'rest', 'landing'];
const ICONS = { fight: '⚔', elite: '💀', boss: '👑', treasure: '🎁', rest: '🔥', landing: '🪜', event: '❓' };
const LABELS = { fight: 'Fight', elite: 'Elite', boss: 'Boss', treasure: 'Treasure', rest: 'Rest', landing: 'Landing', event: 'Event' };

// ── Test dungeons ───────────────────────────────────────────────────────────
// Two hand-written dungeons for Dev Tools, with the board's foes
// (lib/tactics_foes.js). They mix bands on purpose, to put many kinds of foe
// in front of a tester; a generated dungeon keeps to one band. The bosses are
// stand-ins: a boosted Hill Ogre and its company.
const STORIES = {
  test_green: {
    name: 'The Hollow under the Oak',
    tier: 'green',
    terrain: 'forest',
    test: true,
    intro: 'Roots, damp earth and something breathing further in. A short dungeon for trying things out.',
    boss: 'an ogre that has made the hollow its den',
    floors: [{
      rooms: [
        { id: 'a',  step: 1, lane: 2, type: 'fight',    enemies: ['wolf_raider', 'boar_bruiser', 'wolf_raider'], next: ['b1', 'b2'] },
        { id: 'b1', step: 2, lane: 1, type: 'treasure', loot: { wealth: 15, items: [{ item: 'hide', qty: 2 }] }, next: ['c1'] },
        { id: 'b2', step: 2, lane: 3, type: 'fight',    enemies: ['boar_bruiser', 'newt_darter', 'boar_bruiser'], next: ['c1', 'c2'] },
        { id: 'c1', step: 3, lane: 1, type: 'fight',    enemies: ['hollow_thrall', 'wolf_raider', 'hollow_thrall'], next: ['d1'] },
        { id: 'c2', step: 3, lane: 3, type: 'rest',     next: ['d2'] },
        { id: 'd1', step: 4, lane: 1, type: 'rest',     next: ['boss'] },
        { id: 'd2', step: 4, lane: 3, type: 'treasure', loot: { wealth: 15, items: [{ item: 'timber_bundle', qty: 2 }] }, next: ['boss'] },
        { id: 'boss', step: 5, lane: 2, type: 'boss',   enemies: ['hollow_thrall', 'hill_ogre', 'rot_shaman'], boost: { hp: 1.0 }, next: [] },
      ],
    }],
    clear: { wealth: 30, items: [{ item: 'rare_sap', qty: 1 }] },
  },

  test_orange: {
    name: 'The Stair below the Crag',
    tier: 'orange',
    terrain: 'hills',
    test: true,
    intro: 'Two floors, a landing between them and an elite on the way down. For trying the longer shape.',
    boss: 'an ogre chief and its guard',
    floors: [{
      rooms: [
        { id: 'a',  step: 1, lane: 2, type: 'fight',    enemies: ['wolf_raider', 'mountain_harpy', 'wolf_raider'], next: ['b1', 'b2'] },
        { id: 'b1', step: 2, lane: 1, type: 'treasure', loot: { wealth: 40, items: [{ item: 'iron_ore', qty: 3 }] }, next: ['c1'] },
        { id: 'b2', step: 2, lane: 3, type: 'fight',    enemies: ['mountain_harpy', 'boar_bruiser', 'mountain_harpy'], next: ['c1', 'c2'] },
        { id: 'c1', step: 3, lane: 1, type: 'elite',    enemies: ['wolf_raider', 'hill_ogre', 'wolf_raider'], boost: { hp: 0.5 },
          loot: { wealth: 30, items: [{ item: 'gemstone', qty: 1 }] }, next: ['d1'] },
        { id: 'c2', step: 3, lane: 3, type: 'rest',     next: ['d2'] },
        { id: 'd1', step: 4, lane: 1, type: 'rest',     next: ['land'] },
        { id: 'd2', step: 4, lane: 3, type: 'fight',    enemies: ['boar_bruiser', 'hill_ogre'], next: ['land'] },
        { id: 'land', step: 5, lane: 2, type: 'landing', next: [] },
      ],
    }, {
      rooms: [
        { id: 'e',  step: 1, lane: 2, type: 'fight',    enemies: ['hollow_thrall', 'rot_shaman', 'hollow_thrall'], next: ['f1', 'f2'] },
        { id: 'f1', step: 2, lane: 1, type: 'rest',     next: ['g1'] },
        { id: 'f2', step: 2, lane: 3, type: 'fight',    enemies: ['hill_ogre', 'mountain_harpy', 'hollow_thrall'], next: ['g2'] },
        { id: 'g1', step: 3, lane: 1, type: 'fight',    enemies: ['hill_ogre', 'wolf_raider', 'wolf_raider'], next: ['h'] },
        { id: 'g2', step: 3, lane: 3, type: 'rest',     next: ['h'] },
        { id: 'h',  step: 4, lane: 2, type: 'treasure', loot: { wealth: 60, items: [{ item: 'iron_ore', qty: 4 }] }, next: ['boss'] },
        { id: 'boss', step: 5, lane: 2, type: 'boss',   enemies: ['hill_ogre', 'hill_ogre', 'rot_shaman'], boost: { hp: 1.0, str: 0.2 }, next: [] },
      ],
    }],
    clear: { wealth: 120, items: [{ item: 'gemstone', qty: 1 }, { item: 'ancient_coin', qty: 1 }, { item: 'chainmail', qty: 1 }] },
  },
};

// ── The path rules (docs/DUNGEONS.md §5.1) ──────────────────────────────────
// Returns a list of problems; an empty list means the floor is sound.
//   last: this is the deepest floor (it ends in the boss, not a landing)
function checkFloor(floor, { last = true } = {}) {
  const out = [];
  const rooms = (floor && floor.rooms) || [];
  if (!rooms.length) return ['no rooms'];
  const byId = new Map(rooms.map(r => [r.id, r]));
  if (byId.size !== rooms.length) out.push('two rooms share an id');
  const steps = [...new Set(rooms.map(r => r.step))].sort((a, b) => a - b);
  const end = steps[steps.length - 1];
  steps.forEach((s, i) => { if (s !== i + 1) out.push(`steps are not 1..N (found ${s})`); });
  for (const s of steps) {
    const here = rooms.filter(r => r.step === s);
    if (here.length < 1 || here.length > 3) out.push(`step ${s} has ${here.length} rooms (1 to 3)`);
    if (new Set(here.map(r => r.lane)).size !== here.length) out.push(`step ${s} has two rooms in one lane`);
  }
  for (const r of rooms) {
    if (!TYPES.includes(r.type)) out.push(`${r.id}: "${r.type}" rooms are not built yet`);
    if (!(r.lane >= 1 && r.lane <= 3)) out.push(`${r.id}: lane must be 1 to 3`);
    if (FIGHTS.includes(r.type) && !(Array.isArray(r.enemies) && r.enemies.length >= 1 && r.enemies.length <= 4)) out.push(`${r.id}: a fight needs 1 to 4 creatures`);
    if (r.type === 'elite' && r.step < 3) out.push(`${r.id}: an elite never comes before step 3`);
    const next = r.next || [];
    if (r.step === end) {
      if (next.length) out.push(`${r.id}: the last room leads nowhere`);
      if (r.type !== (last ? 'boss' : 'landing')) out.push(`${r.id}: the floor must end in a ${last ? 'boss' : 'landing'}`);
    } else {
      if (r.type === 'boss' || r.type === 'landing') out.push(`${r.id}: a ${r.type} is only ever the last room`);
      if (next.length < 1 || next.length > 2) out.push(`${r.id}: links to ${next.length} rooms (1 or 2)`);
      for (const n of next) {
        const t = byId.get(n);
        if (!t) out.push(`${r.id}: links to a room that is not there (${n})`);
        else {
          if (t.step !== r.step + 1) out.push(`${r.id}: ${n} is not in the next step`);
          if (r.type === 'rest' && t.type === 'rest') out.push(`${r.id}: two rests in a row`);
        }
      }
    }
  }
  if (rooms.filter(r => r.step === end).length !== 1) out.push('the floor must end in one room');
  for (const r of rooms.filter(x => x.step === 1)) if (r.type !== 'fight') out.push(`${r.id}: the first room is always a fight`);
  // Every room can be reached, and every route has a rest (or, later, an event).
  const reached = new Set();
  const walk = (r, rested) => {
    reached.add(r.id);
    const now = rested || r.type === 'rest' || r.type === 'event';
    if (r.step === end) { if (!now && !out.includes('a route has no rest on it')) out.push('a route has no rest on it'); return; }
    for (const n of (r.next || [])) { const t = byId.get(n); if (t && t.step === r.step + 1) walk(t, now); }
  };
  rooms.filter(r => r.step === 1).forEach(r => walk(r, false));
  for (const r of rooms) if (!reached.has(r.id)) out.push(`${r.id}: no route leads here`);
  return out;
}

function checkStory(story) {
  const out = [];
  if (!story || !Array.isArray(story.floors) || !story.floors.length) return ['no floors'];
  if (!TIERS[story.tier]) out.push('unknown skull');
  story.floors.forEach((f, i) => checkFloor(f, { last: i === story.floors.length - 1 }).forEach(p => out.push(`floor ${i + 1}: ${p}`)));
  return out;
}

const room = (story, floor, id) => (((story.floors[floor] || {}).rooms) || []).find(r => r.id === id) || null;
const firstRooms = (story, floor) => (((story.floors[floor] || {}).rooms) || []).filter(r => r.step === 1);

// A battle seed from the dungeon's seed, the town and the room, so two towns
// in the same dungeon do not get the same rolls (§5.3).
function battleSeed(dungeonSeed, settlementId, floor, roomId) {
  let h = 2166136261 >>> 0;
  for (const ch of `${dungeonSeed}|${settlementId}|${floor}|${roomId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 0x7ffffffe) + 1;
}

module.exports = { TIER_ORDER, TIERS, tier, FIGHTS, TYPES, ICONS, LABELS, STORIES, checkFloor, checkStory, room, firstRooms, battleSeed };
