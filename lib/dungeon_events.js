// ══════════════════════════════════════════════════════════════════════════
//  dungeon_events — event rooms, and what a run can carry out of them
//  (docs/DUNGEONS.md §5, §5.2, §5.2a, §16; decided by the owner 2026-11-29:
//  "a roll with shown odds", and keepsakes with them).
//
//  An event room is a situation with two or three options. An option is one
//  of three things:
//    certain   it does what it says (`then`)
//    a try     one of the party tries it (`try`): whoever is likeliest to
//              manage it. The chance is shown before it is chosen; the right
//              career makes it far likelier, a good stat a little. It ends
//              in `win` or `lose`, and a miss always costs something.
//    a gamble  plain odds, the same for everyone (`odds`), shown as well.
//  Nothing here ends a run by itself: a hurt leaves 1 health at the least.
//
//  The roll comes from the dungeon's seed, the town and the room, so it is
//  the same whenever it is asked for: there is nothing to try again.
//
//  What a run carries (dungeon_runs.carried), until it ends:
//    marks      blessings and curses: the party's stats, the foes' health or
//               strength, or how the next fight starts (`fights: 1`)
//    keepsakes  found at elites, in some treasure rooms and in events: each
//               changes how every fight starts, or the road between them
//
//    EVENTS, MARKS, KEEPSAKES     the catalogues
//    eventFor(rnd, land, used)    the event a generated room holds
//    options(ev, ctx)             what the screen shows: each option with its
//                                 cost, its chance and who would try
//    resolve(ev, key, ctx)        the option chosen → { won, roll, chance,
//                                 who, outcome }
//    carriedView(list)            marks and keepsakes with their words
//    partyMods / foeBoost / starts(list)   what they do to a fight
//    restBonus / afterFightHeal / luck(list)
//    keepsakeFor(seedParts, held) a keepsake the run does not have yet
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// 0 to 99, the same for the same parts.
const rollOf = parts => { let a = (hash(parts.join('|')) + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 100); };

// ── Blessings and curses ────────────────────────────────────────────────────
// party: added to every citizen's stat for the run. foes: added to every foe's health or strength (0.1 = a tenth more).
// start: statuses a side begins a fight with. fights: how many fights it lasts (left out: the whole run).
const MARKS = {
  keen_edges:   { kind: 'blessing', name: 'Keen Edges', icon: '⚔️', says: 'Strength +2 for the rest of the run.', party: { strength: 2 } },
  woods_favour: { kind: 'blessing', name: 'The Wood\'s Favour', icon: '🌿', says: 'Endurance +2 for the rest of the run.', party: { endurance: 2 } },
  light_step:   { kind: 'blessing', name: 'Light Step', icon: '🍃', says: 'Agility +2 for the rest of the run.', party: { agility: 2 } },
  thorn_blood:  { kind: 'blessing', name: 'Thorn\'s Strength', icon: '🩸', says: 'Strength +3 for the rest of the run.', party: { strength: 3 } },
  warmed:       { kind: 'blessing', name: 'Warmed Through', icon: '🔥', says: 'Endurance +1 for the rest of the run.', party: { endurance: 1 } },
  whisper:      { kind: 'blessing', name: 'The Whisperer\'s Bargain', icon: '👁️', says: 'Strength +2 and agility −1 for the rest of the run.', party: { strength: 2, agility: -1 } },
  sodden:       { kind: 'curse', name: 'Sodden', icon: '💧', says: 'Agility −2 for the rest of the run.', party: { agility: -2 } },
  chilled:      { kind: 'curse', name: 'Chilled', icon: '🥶', says: 'Strength −1 for the rest of the run.', party: { strength: -1 } },
  deep_chill:   { kind: 'curse', name: 'Chilled to the Bone', icon: '🥶', says: 'Strength −2 for the rest of the run.', party: { strength: -2 } },
  slighted:     { kind: 'curse', name: 'Slighted', icon: '🍂', says: 'Agility −1 for the rest of the run.', party: { agility: -1 } },
  alarm:        { kind: 'curse', name: 'The Alarm is Raised', icon: '🔔', says: 'Every foe has a tenth more health for the rest of the run.', foes: { hp: 0.1 } },
  spores:       { kind: 'curse', name: 'Blight Spores', icon: '🍄', says: 'Everyone starts the next fight poisoned.', fights: 1, start: { party: { poison: 2 } } },
};

// ── Keepsakes ───────────────────────────────────────────────────────────────
// A blessing changes a number; a keepsake changes how a fight starts, or the road between fights.
const KEEPSAKES = {
  whetted_edge:      { name: 'Whetted Edge', icon: '🗡️', says: 'Every foe starts each fight Vulnerable (2).', start: { foes: { vulnerable: 2 } } },
  owl_feather:       { name: 'Owl Feather', icon: '🪶', says: 'Every foe starts each fight Weak (2).', start: { foes: { weak: 2 } } },
  old_banner:        { name: 'Old Banner', icon: '🚩', says: 'Everyone\'s first attack in each fight does 4 more.', start: { party: { bold: 4 } } },
  hearthstone:       { name: 'Hearthstone', icon: '🪨', says: 'After every fight won, everyone standing gets back 8% of their health.', after: 0.08 },
  travelling_kettle: { name: 'Travelling Kettle', icon: '🫖', says: 'Every rest gives back 10% more.', rest: 0.10 },
  lucky_acorn:       { name: 'Lucky Acorn', icon: '🌰', says: 'Every try and every gamble in an event is 15% likelier to come off.', luck: 15 },
};

// ── Events ──────────────────────────────────────────────────────────────────
// An outcome: text (what happened), and any of
//   heal: { all | worst | tryer: share }     hurt: { all | tryer | one | healthiest: share }
//   wealth: ±n (into or out of what the run carries)     loot: 'room' (the room's own treasure)
//   mark: a MARKS key     keepsake: true     fight: 'small' | 'hard', and after: an outcome once it is won
// A try: stat (each point above 8 adds 3%), base, and `good`: the careers it suits (+35%), named by `tag`.
const T = (stat, base, good, tag) => ({ stat, base, good: good || [], tag: tag || null });
const EVENTS = {
  clear_spring: { title: 'The Clear Spring', icon: '💧', text: 'Clean water, running out of the rock into a basin somebody cut long ago.', options: [
    { key: 'drink', label: 'Everyone drinks', then: { text: 'Cold, and good. Everyone feels the better for it.', heal: { all: 0.2 } } },
    { key: 'bathe', label: 'Bathe the worst wound', then: { text: 'The water takes the heat out of it.', heal: { worst: 0.5 } } },
  ] },
  old_campfire: { title: 'An Old Campfire', icon: '🔥', text: 'Embers still warm, and a pack left against the wall. Whoever it was did not mean to be gone long.', options: [
    { key: 'rest', label: 'Sit a while', then: { text: 'A quarter of an hour by somebody else\'s fire.', heal: { all: 0.15 } } },
    { key: 'search', label: 'Search the pack', try: T('agility', 50, ['scout', 'forager', 'porter'], 'a Scout, Forager or Porter'),
      win: { text: 'A purse, and something wrapped in oilcloth.', wealth: 20, keepsake: true }, lose: { text: 'The pack was a lure. A wire snaps tight round an ankle.', hurt: { tryer: 0.15 } } },
  ] },
  whetstone: { title: 'The Whetstone', icon: '⚙️', text: 'A grinding wheel on a treadle. It still turns.', options: [
    { key: 'sharpen', label: 'Sharpen everything', then: { text: 'Every edge the party owns comes off the wheel bright.', mark: 'keen_edges' } },
    { key: 'strip', label: 'Take it apart for the iron', try: T('strength', 55, ['blacksmith', 'smelter', 'miner'], 'a Blacksmith, Smelter or Miner'),
      win: { text: 'The fittings come away clean. Good iron.', wealth: 35 }, lose: { text: 'The wheel slips its axle and comes down on a foot.', hurt: { tryer: 0.12 } } },
  ] },
  mossy_shrine: { title: 'The Mossy Shrine', icon: '⛩️', text: 'A shrine to the old wood, green over, with a bowl for offerings.', options: [
    { key: 'offer', label: 'Leave an offering', cost: { wealth: 15 }, then: { text: 'The moss seems greener for it.', mark: 'woods_favour' } },
    { key: 'tend', label: 'Tend it', try: T('charisma', 40, ['hearthkeeper'], 'a Hearthkeeper'),
      win: { text: 'Cleared of dead leaves and set to rights. The place is glad of it.', mark: 'woods_favour', heal: { all: 0.1 } }, lose: { text: 'A clumsy hand cracks the bowl. The wood notices.', mark: 'slighted' } },
    { key: 'pass', label: 'Walk on', then: { text: 'The party leaves the shrine as it found it.' } },
  ] },
  lookouts_cache: { title: 'The Lookout\'s Cache', icon: '🗺️', text: 'A scout\'s marks scratched on the wall, pointing at a ledge above head height.', options: [
    { key: 'climb', label: 'Climb for it', try: T('agility', 45, ['scout', 'archer'], 'a Scout or Archer'),
      win: { text: 'A tin box on the ledge, dry as the day it was left.', keepsake: true }, lose: { text: 'The ledge gives way. Everyone below gets some of it.', hurt: { all: 0.08 } } },
    { key: 'pass', label: 'Leave it', then: { text: 'Whatever is up there stays up there.' } },
  ] },
  rockfall: { title: 'Rockfall', icon: '🪨', text: 'A crack runs across the ceiling, and dust is already coming down.', options: [
    { key: 'run', label: 'Run for it', then: { text: 'Everyone gets through, and everyone gets hit.', hurt: { all: 0.08 } } },
    { key: 'shield', label: 'Hold it while the others pass', try: T('strength', 40, ['soldier', 'builder', 'miner'], 'a Guard, Builder or Miner'),
      win: { text: 'A shoulder under the worst of it, just long enough.' }, lose: { text: 'It comes down on whoever was holding it.', hurt: { tryer: 0.25 } } },
  ] },
  sucking_mire: { title: 'The Sucking Mire', icon: '🟤', text: 'The passage is under a foot of water and nobody knows how much mud.', options: [
    { key: 'wade', label: 'Wade through', then: { text: 'Boots full, legs heavy. It will not dry before the day is out.', mark: 'sodden' } },
    { key: 'round', label: 'Find a way round', try: T('agility', 45, ['scout', 'fisher', 'forager'], 'a Scout, Fisher or Forager'),
      win: { text: 'A dry shelf along the wall, if you know where to put your feet.' }, lose: { text: 'The shelf ends halfway. Somebody goes in to the waist getting back.', hurt: { tryer: 0.15 }, mark: 'sodden' } },
  ] },
  blight_spores: { title: 'Blight Spores', icon: '🍄', text: 'A split log across the way, breathing out a grey cloud.', options: [
    { key: 'push', label: 'Hold your breath and push through', then: { text: 'Nobody held it long enough.', mark: 'spores' } },
    { key: 'burn', label: 'Burn it out', try: T('intelligence', 40, ['wizard', 'hearthkeeper', 'scholar'], 'a Wizard, Hearthkeeper or Scholar'),
      win: { text: 'It goes up clean, and the air clears.' }, lose: { text: 'It goes up all at once.', hurt: { tryer: 0.2 } } },
  ] },
  cold_draught: { title: 'The Cold Draught', icon: '🌬️', text: 'Something old is breathing, further in. The cold comes up the passage in slow waves.', options: [
    { key: 'endure', label: 'Grit your teeth', then: { text: 'It gets into the hands and stays there.', mark: 'chilled' } },
    { key: 'light', label: 'Hold a light against it', try: T('charisma', 40, ['hearthkeeper', 'tavernkeep'], 'a Hearthkeeper or Tavernkeep'),
      win: { text: 'A small flame, and a steady voice. The cold goes round.', mark: 'warmed' }, lose: { text: 'The flame goes out, and the cold comes in properly.', mark: 'deep_chill' } },
  ] },
  sealed_door: { title: 'The Sealed Door', icon: '🚪', text: 'A stone door with runes cut round it. Something is kept behind it, and something keeps it.', options: [
    { key: 'force', label: 'Force it', then: { text: 'The door gives, and so does whatever was set to guard it.', fight: 'hard', after: { text: 'Behind the door: what they were guarding.', loot: 'room', keepsake: true } } },
    { key: 'read', label: 'Read the runes', try: T('intelligence', 35, ['wizard', 'scholar'], 'a Wizard or Scholar'),
      win: { text: 'Three words, said in the right order. The door swings in on an empty room, and a chest.', loot: 'room' }, lose: { text: 'One word wrong. The runes bite, and the door stays shut.', hurt: { all: 0.12 } } },
    { key: 'pass', label: 'Leave it shut', then: { text: 'Some doors are shut for a reason.' } },
  ] },
  brigands_toll: { title: 'The Brigands\' Toll', icon: '🪙', text: 'Stoats across the passage, and a hat on the floor in front of them.', options: [
    { key: 'pay', label: 'Pay the toll', cost: { wealth: 30 }, then: { text: 'They count it twice and stand aside.' } },
    { key: 'talk', label: 'Talk them down', try: T('charisma', 40, ['merchant', 'tavernkeep', 'shopkeeper'], 'a Merchant, Tavernkeep or Shopkeeper'),
      win: { text: 'By the end of it they are apologising, and one of them hands over a keepsake for luck.', keepsake: true }, lose: { text: 'They did not like the tone.', fight: 'small' } },
    { key: 'fight', label: 'Fight them', then: { text: 'The hat gets kicked into the dark.', fight: 'small', after: { text: 'They had been at it a while: the hat was not empty.', wealth: 30 } } },
  ] },
  gambling_crow: { title: 'The Gambling Crow', icon: '🐦‍⬛', text: 'A crow on an upturned bucket, with three acorn cups and a very honest face.', options: [
    { key: 'wager', label: 'Wager 20', cost: { wealth: 20 }, odds: 50, win: { text: 'The acorn is where you said. The crow pays up, sourly.', wealth: 40 }, lose: { text: 'The acorn is somewhere else. It always was.' } },
    { key: 'watch', label: 'Watch its feet, then wager', cost: { wealth: 20 }, try: T('agility', 45, ['scout', 'archer', 'jeweller'], 'a Scout, Archer or Jeweller'),
      win: { text: 'It palms the acorn with its left foot. Called on it, the crow pays double to keep it quiet.', wealth: 60 }, lose: { text: 'Too quick. The crow tips its head and keeps the coin.' } },
    { key: 'pass', label: 'Walk on', then: { text: 'The crow calls something rude after the party.' } },
  ] },
  chained_chest: { title: 'The Chained Chest', icon: '🧰', text: 'Heavy, locked, chained to the floor. It rattles when nobody is touching it.', options: [
    { key: 'smash', label: 'Smash it open', odds: 60, win: { text: 'Only loose coin rattling. The chest gives up what it has.', loot: 'room' }, lose: { text: 'It was not coin rattling.', fight: 'small', after: { text: 'What is left of the chest still holds what it held.', loot: 'room' } } },
    { key: 'pick', label: 'Work the lock', try: T('agility', 40, ['blacksmith', 'carpenter', 'crafter', 'jeweller'], 'a Blacksmith, Carpenter, Crafter or Jeweller'),
      win: { text: 'The lock turns. Whatever was inside leaves by a hole in the back, and leaves everything else.', loot: 'room', keepsake: true }, lose: { text: 'The pick snaps in the lock, and a spring behind it is not kind.', hurt: { tryer: 0.15 } } },
    { key: 'pass', label: 'Leave it rattling', then: { text: 'The party gives it a wide berth.' } },
  ] },
  altar_of_thorns: { title: 'The Altar of Thorns', icon: '🌹', text: 'Black briar grown over a stone table. The thorns lean towards whoever comes near.', options: [
    { key: 'blood', label: 'Give it blood', then: { text: 'The briar drinks, and gives something back.', hurt: { healthiest: 0.2 }, mark: 'thorn_blood' } },
    { key: 'break', label: 'Tear it out by the root', try: T('strength', 40, ['woodcutter', 'farmer', 'soldier'], 'a Woodcutter, Farmer or Guard'),
      win: { text: 'It comes up whole, and something small and bright comes up with it.', keepsake: true }, lose: { text: 'It does not come up. It holds on, and it has thorns.', hurt: { tryer: 0.2 } } },
    { key: 'pass', label: 'Keep your distance', then: { text: 'The thorns turn to watch the party go.' } },
  ] },
  wounded_stranger: { title: 'The Wounded Stranger', icon: '🦡', text: 'A badger, a long way from home, sitting very still with a paw pressed to its side.', options: [
    { key: 'tend', label: 'See to the wound', try: T('intelligence', 45, ['hearthkeeper', 'forager', 'scholar'], 'a Hearthkeeper, Forager or Scholar'),
      win: { text: 'Cleaned, bound, and the badger on its feet. It presses its own keepsake into a paw and will not take it back.', keepsake: true }, lose: { text: 'It takes most of the party\'s bandages to do it badly. The badger thanks you anyway.', hurt: { all: 0.05 } } },
    { key: 'coin', label: 'Leave it coin for the road', cost: { wealth: 15 }, then: { text: 'The badger says a blessing over the party in a tongue nobody knows.', mark: 'light_step' } },
    { key: 'pass', label: 'Walk on', then: { text: 'It watches the party go and says nothing.' } },
  ] },
  whispers: { title: 'Whispers in the Dark', icon: '👁️', text: 'A voice from a crack in the wall, very reasonable, offering a little help for a little something.', options: [
    { key: 'deal', label: 'Take the bargain', then: { text: 'Arms like oak, and feet that do not quite go where they are put.', mark: 'whisper' } },
    { key: 'answer', label: 'Bargain back', try: T('charisma', 35, ['merchant', 'scholar', 'wizard'], 'a Merchant, Scholar or Wizard'),
      win: { text: 'The voice has not been out-argued in a hundred years. It pays up in full, and sulks.', mark: 'keen_edges' }, lose: { text: 'The voice laughs, and tells somebody further in that company is coming.', mark: 'alarm' } },
    { key: 'pass', label: 'Do not answer', then: { text: 'The voice is still talking when the party is out of earshot.' } },
  ] },
};
const EVENT_KEYS = Object.keys(EVENTS);
// The event a generated room holds: one the dungeon has not used yet, while there are any.
function eventFor(rnd, used) {
  const fresh = EVENT_KEYS.filter(k => !(used || []).includes(k)), list = fresh.length ? fresh : EVENT_KEYS;
  return list[Math.floor(rnd() * list.length)];
}

// ── What a run carries ──────────────────────────────────────────────────────
// carried: [{ key, kind: 'mark' | 'keepsake', fights? }]
const defOf = c => (c && c.kind === 'keepsake' ? KEEPSAKES[c.key] : c ? MARKS[c.key] : null);
const live = list => (Array.isArray(list) ? list : []).filter(c => defOf(c));
function carriedView(list) {
  return live(list).map(c => { const d = defOf(c); return { key: c.key, kind: c.kind === 'keepsake' ? 'keepsake' : d.kind, name: d.name, icon: d.icon, says: d.says, ...(c.fights != null ? { fights: c.fights } : {}) }; });
}
// Added to every citizen's stats in a fight: { party_strength, party_agility, party_endurance }.
function partyMods(list) {
  const out = {};
  for (const c of live(list)) for (const [k, v] of Object.entries(defOf(c).party || {})) out['party_' + k] = (out['party_' + k] || 0) + v;
  return out;
}
// Added to every foe's health and strength: { hp, str } (shares).
function foeBoost(list) {
  const out = { hp: 0, str: 0 };
  for (const c of live(list)) { const f = defOf(c).foes || {}; out.hp += f.hp || 0; out.str += f.str || 0; }
  return out;
}
// What each side begins a fight with: { party: { status: n }, foes: { status: n } }.
function starts(list) {
  const out = { party: {}, foes: {} };
  for (const c of live(list)) { const s = defOf(c).start || {}; for (const side of ['party', 'foes']) for (const [k, v] of Object.entries(s[side] || {})) out[side][k] = (out[side][k] || 0) + v; }
  return out;
}
const sumOf = (list, field) => live(list).reduce((n, c) => n + (defOf(c)[field] || 0), 0);
const restBonus = list => sumOf(list, 'rest');
const afterFightHeal = list => sumOf(list, 'after');
const luck = list => sumOf(list, 'luck');
// After a fight: what lasted only so many fights is one fight nearer its end.
function afterFight(list) {
  return live(list).map(c => (c.fights != null ? { ...c, fights: c.fights - 1 } : c)).filter(c => c.fights == null || c.fights > 0);
}
// Add a mark (once: the same blessing twice is still one) or a keepsake.
function carry(list, key, kind) {
  const cur = live(list);
  if (cur.some(c => c.key === key && (c.kind === 'keepsake') === (kind === 'keepsake'))) return cur;
  const d = kind === 'keepsake' ? KEEPSAKES[key] : MARKS[key];
  if (!d) return cur;
  return cur.concat([{ key, kind: kind === 'keepsake' ? 'keepsake' : 'mark', ...(d.fights ? { fights: d.fights } : {}) }]);
}
// A keepsake the run does not hold yet (null when it holds them all).
function keepsakeFor(seedParts, list) {
  const held = new Set(live(list).filter(c => c.kind === 'keepsake').map(c => c.key));
  const free = Object.keys(KEEPSAKES).filter(k => !held.has(k));
  return free.length ? free[rollOf(seedParts.concat(['keepsake'])) % free.length] : null;
}

// ── Trying, and what the screen shows ───────────────────────────────────────
// ctx: { members: [{ id, name, role, stats, hp, max, down }], carried, wealth (what the run carries), seed: [parts] }
const PER_POINT = 3, GOOD = 35, LOW = 5, HIGH = 95;
const ROLE_NAME = { soldier: 'Guard' };
const roleName = r => ROLE_NAME[r] || (r ? r[0].toUpperCase() + r.slice(1) : 'Villager');
function chanceOf(t, m, bonus) {
  const stat = Number((m.stats || {})[t.stat]) || 8, suited = (t.good || []).includes(m.role);
  return { chance: clamp(Math.round(t.base + (stat - 8) * PER_POINT + (suited ? GOOD : 0) + (bonus || 0)), LOW, HIGH), suited };
}
// Whoever is likeliest to manage it, of those on their feet.
function tryer(t, ctx) {
  const up = (ctx.members || []).filter(m => !m.down && m.hp > 0);
  let best = null;
  for (const m of up) { const c = chanceOf(t, m, luck(ctx.carried)); if (!best || c.chance > best.chance) best = { ...c, id: m.id, name: m.name, role: m.role }; }
  return best;
}
function options(ev, ctx) {
  return ev.options.map(o => {
    const out = { key: o.key, label: o.label, kind: o.try ? 'try' : o.odds != null ? 'gamble' : 'certain' };
    if (o.cost && o.cost.wealth) { out.cost = o.cost.wealth; if ((ctx.wealth || 0) < o.cost.wealth) { out.disabled = true; out.why = `The party is carrying ${ctx.wealth || 0} wealth; this takes ${o.cost.wealth}.`; } }
    if (o.try) {
      const who = tryer(o.try, ctx);
      if (!who) { out.disabled = true; out.why = 'Nobody is on their feet to try it.'; }
      else { out.chance = who.chance; out.who = { id: who.id, name: who.name, role: roleName(who.role), suited: who.suited }; }
      out.suits = o.try.tag; out.stat = o.try.stat;
      out.win = says(o.win); out.lose = says(o.lose);
    } else if (o.odds != null) {
      out.chance = clamp(o.odds + luck(ctx.carried), LOW, HIGH);
      out.win = says(o.win); out.lose = says(o.lose);
    } else out.text = says(o.then);
    return out;
  });
}
// An outcome in a few words, for before it is chosen: what it gives and what it costs, not how it reads.
function says(o) {
  if (!o) return '';
  const bits = [], pc = v => Math.round(v * 100) + '%';
  if (o.heal) bits.push(o.heal.all ? `everyone heals ${pc(o.heal.all)}` : o.heal.worst ? `the worst hurt heals ${pc(o.heal.worst)}` : `they heal ${pc(o.heal.tryer)}`);
  if (o.hurt) bits.push(o.hurt.all ? `everyone loses ${pc(o.hurt.all)} health` : o.hurt.tryer ? `they lose ${pc(o.hurt.tryer)} health` : o.hurt.healthiest ? `the healthiest loses ${pc(o.hurt.healthiest)} health` : `one of the party loses ${pc(o.hurt.one)} health`);
  if (o.wealth > 0) bits.push(`${o.wealth} wealth`);
  if (o.loot === 'room') bits.push('the treasure here');
  if (o.keepsake) bits.push('a keepsake');
  if (o.mark && MARKS[o.mark]) bits.push(`${MARKS[o.mark].kind === 'curse' ? 'curse' : 'blessing'}: ${MARKS[o.mark].name} (${MARKS[o.mark].says.replace(/ for the rest of the run\.$/, '').replace(/\.$/, '')})`);
  if (o.fight) bits.push(o.fight === 'hard' ? 'a hard fight' : 'a fight');
  if (o.after) { const a = says(o.after); if (a) bits.push('then ' + a); }
  return bits.length ? bits.join(', ') : 'nothing';
}
// The option chosen. → { option, kind, won, chance, roll, who, outcome } (won: null for a certain option).
function resolve(ev, key, ctx) {
  const o = ev.options.find(x => x.key === key);
  if (!o) return null;
  if (o.cost && o.cost.wealth && (ctx.wealth || 0) < o.cost.wealth) return { refused: `The party is carrying ${ctx.wealth || 0} wealth; this takes ${o.cost.wealth}.` };
  if (o.try) {
    const who = tryer(o.try, ctx);
    if (!who) return { refused: 'Nobody is on their feet to try it.' };
    const roll = rollOf(ctx.seed.concat([key])), won = roll < who.chance;
    return { option: o, kind: 'try', won, chance: who.chance, roll, who: { id: who.id, name: who.name, role: roleName(who.role), suited: who.suited }, outcome: won ? o.win : o.lose };
  }
  if (o.odds != null) {
    const chance = clamp(o.odds + luck(ctx.carried), LOW, HIGH), roll = rollOf(ctx.seed.concat([key])), won = roll < chance;
    return { option: o, kind: 'gamble', won, chance, roll, who: null, outcome: won ? o.win : o.lose };
  }
  return { option: o, kind: 'certain', won: null, chance: null, roll: null, who: null, outcome: o.then };
}

module.exports = { EVENTS, EVENT_KEYS, MARKS, KEEPSAKES, eventFor, options, resolve, says, chanceOf, tryer, rollOf, roleName,
  carriedView, partyMods, foeBoost, starts, restBonus, afterFightHeal, luck, afterFight, carry, keepsakeFor, PER_POINT, GOOD, LOW, HIGH };
