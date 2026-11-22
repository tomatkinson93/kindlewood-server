// ══════════════════════════════════════════════════════════════════════════
//  dungeons — one party's run through a dungeon (docs/DUNGEONS.md §3).
//
//  Built so far (build order §9.6 steps 1 to 3): a party of exactly four
//  walks a branching path of rooms on each floor. Fights are ordinary card
//  battles (a settlement_quests row that names its run, played through
//  /api/combat like a camp assault); wounds and who is down carry from room
//  to room; loot is held by the run until it ends; injuries are rolled once,
//  at the end.
//
//  How a run ends (§3.2):
//    cleared     boss beaten      all loot kept, plus the clear reward
//    left        turned back      all loot kept
//    fled        left a fight     half the loot kept (FLEE_KEEP)
//    defeat      a battle lost    all loot lost; every citizen rolls
//    timed_out   left idle        as turned back; idle in a fight costs what
//                                 fleeing costs, so waiting gains nothing
//  Injuries: on a defeat all four roll the full table. Otherwise only citizens
//  who went down roll: still down at the end, the full table; stood back up
//  before the end, the table without its fatal band.
//
//  A dungeon's rooms come from a hand-written story (lib/dungeon_defs.js) or
//  from the generator (lib/dungeon_gen.js), whose result is stored on the
//  dungeon row.
//
//  Every citizen brings their own deck (lib/dungeon_decks.js, the cards in
//  lib/class_cards.js): their class's pack, one card of three at the door,
//  and one card of three for the party after each fight but the last. A heal
//  that is played is spent until the party rests; a rest room offers rest or
//  honing a card.
//
//  Not built yet: map dungeons (step 4), the draft (5), events, keepsakes
//  and reviving in battle (6), quest dungeons (7), supplies (9). Dungeons are
//  started from Dev Tools only (startTest, startGenerated), and the run
//  routes are admin-only until the switch `dungeons.on` is turned on.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const DEFS = require('./dungeon_defs');
const TU = require('./tuning');
const DK = require('./dungeon_decks');

const PARTY = 4;
const BATTLE_MIN = 10;       // the battle row's nominal length (its clock is paused while it waits)
const SKILL_CAP = 10;        // as routes/combat.js COMBAT_SKILL_CAP
const err = (status, msg) => Object.assign(new Error(msg), { status });
const num = (k) => TU.value(k) ?? TU.LIFE_KEYS[k].default;
const CONFIG = {
  get REST() { return num('DUNGEON_REST'); },             // share of full health a rest gives back
  get BOARD_REST() { return num('DUNGEON_BOARD_REST'); }, // the same, in a dungeon fought on the board
  get FLEE_KEEP() { return num('DUNGEON_FLEE_KEEP'); },   // share of the run loot kept when fleeing a fight
  get IDLE_HOURS() { return num('DUNGEON_IDLE_HOURS'); }, // a run left alone this long ends by itself
};

// ── Small helpers ───────────────────────────────────────────────────────────
const arr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch (e) { return []; } })() : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const lootOf = (v) => { const l = obj(v); return { wealth: Math.max(0, Math.round(Number(l.wealth) || 0)), items: arr(l.items).filter(i => i && i.item && i.qty > 0).map(i => ({ item: String(i.item), qty: Math.round(i.qty) })) }; };
function addLoot(a, b) {
  const out = lootOf(a), add = lootOf(b);
  out.wealth += add.wealth;
  for (const i of add.items) {
    const have = out.items.find(x => x.item === i.item);
    if (have) have.qty += i.qty; else out.items.push({ ...i });
  }
  return out;
}
// Fleeing: the party keeps `keep` of the wealth and of each kind of item,
// rounded down. → [kept, lost]
function splitLoot(loot, keep) {
  const l = lootOf(loot), kept = { wealth: Math.floor(l.wealth * keep), items: [] }, lost = { wealth: 0, items: [] };
  lost.wealth = l.wealth - kept.wealth;
  for (const i of l.items) {
    const k = Math.floor(i.qty * keep);
    if (k > 0) kept.items.push({ item: i.item, qty: k });
    if (i.qty - k > 0) lost.items.push({ item: i.item, qty: i.qty - k });
  }
  return [kept, lost];
}
function normal(run) {
  run.party_ids = arr(run.party_ids).map(Number);
  run.path_taken = arr(run.path_taken);
  run.party_state = obj(run.party_state);
  run.loot = lootOf(run.loot);
  run.deck = DK.normal(run.deck);                  // each citizen's cards (lib/dungeon_decks.js)
  run.draft = run.draft && run.draft.kind ? run.draft : null;   // a choice of cards that is waiting
  run.board_battle_id = run.board_battle_id == null ? null : Number(run.board_battle_id);
  return run;
}
// A dungeon's floors and rooms: what the generator made for it (stored on
// the row), or the hand-written story it names.
function storyOf(d) {
  const story = d && d.layout && Array.isArray(d.layout.floors) ? d.layout : (d && d.story_key ? DEFS.STORIES[d.story_key] : null);
  if (!story) throw err(500, 'This dungeon has no rooms.');
  return story;
}
const standing = (run) => run.party_ids.filter(id => { const st = run.party_state[id]; return st && !st.down && st.hp > 0; });

async function allowed(user) {
  if (require('../middleware/admin').isAdminUser(user)) return true;
  return TU.switchOn('dungeons.on');
}

// ── Reading a run ───────────────────────────────────────────────────────────
// The town's unfinished run with its dungeon and story; throws 404 if none.
async function liveRun(client, userId, lock = false) {
  const s = (await client.query('SELECT * FROM settlements WHERE user_id=$1', [userId])).rows[0];
  if (!s) throw err(404, 'No settlement.');
  const run = (await client.query(`SELECT * FROM dungeon_runs WHERE settlement_id=$1 AND status = 'active'${lock ? ' FOR UPDATE' : ''}`, [s.id])).rows[0];
  if (!run) throw err(404, 'No party of yours is in a dungeon.');
  const d = (await client.query('SELECT * FROM dungeons WHERE id=$1', [run.dungeon_id])).rows[0];
  return { s, run: normal(run), d, story: storyOf(d) };
}

// What the path screen shows. The server decides everything in it: the
// client never works out what is in a room or where the party may go.
async function view(run, d, q = (t, p) => query(t, p)) {
  normal(run);
  const story = storyOf(d), t = DEFS.tier(story.tier);
  const live = run.status === 'active';
  const floor = story.floors[run.floor] || story.floors[story.floors.length - 1];
  const cur = run.room ? DEFS.room(story, run.floor, run.room) : null;
  const moves = live && !run.room_open && !run.draft ? (cur ? (cur.next || []) : DEFS.firstRooms(story, run.floor).map(r => r.id)) : [];
  const here = run.path_taken.filter(p => p.floor === run.floor);
  const taken = new Set(here.map(p => p.room));

  const names = (await q('SELECT id, name FROM citizens WHERE id = ANY($1)', [run.party_ids])).rows;
  const enemyKeys = [...new Set(floor.rooms.flatMap(r => r.enemies || []))];
  const enemies = enemyKeys.length ? (await q('SELECT id, name, icon FROM enemy_definitions WHERE id = ANY($1::text[])', [enemyKeys]).catch(() => ({ rows: [] }))).rows : [];
  // On the board a room's creatures are the board's foes (lib/tactics_foes.js), whatever the dungeon was written with.
  const FOES = require('./tactics_foes');
  const enemyName = (k) => {
    const f = run.combat === 'board' ? FOES.foe(k) : null;
    if (f) return { key: f.key, name: f.name, icon: f.icon };
    const e = enemies.find(x => x.id === k); return { key: k, name: e ? e.name : k.replace(/_/g, ' '), icon: (e && e.icon) || '👹' };
  };
  const itemKeys = [...new Set(run.loot.items.map(i => i.item))];
  const tpls = itemKeys.length ? (await q('SELECT item_key, name, icon FROM item_templates WHERE item_key = ANY($1::text[])', [itemKeys])).rows : [];

  // What each card does in its holder's hands ("Deal 16 damage").
  const decks = DK.has(run.deck);
  let textFor = () => undefined;
  if (decks) {
    try {
      const FM = require('./card_formula');
      const units = await require('./combat_resolver').partyUnits(run.party_ids, null);
      textFor = (id) => { const u = (units.find(x => x.id === id) || {}).unit; return u ? (formula) => String(FM.previewEffect(formula, u) || '').replace(/\n/g, ' · ') : undefined; };
    } catch (e) { /* the cards still show, without their numbers */ }
  }
  const nameOf = (id) => (names.find(x => x.id === id) || {}).name || 'Citizen';

  let pending = null;
  if (live && run.draft && !run.battle_run_id) {
    // A choice of cards comes before anything else.
    if (run.draft.kind === 'door') {
      const done = run.draft.done || [];
      pending = { kind: 'door', citizens: run.party_ids.filter(id => (run.draft.offers[id] || []).length).map(id => ({
        id, name: nameOf(id), done: done.includes(id), cards: (run.draft.offers[id] || []).map(k => DK.cardView(k, 1, textFor(id))) })) };
    } else {
      // After a fight: keep one of the cards, or hone a card the party already holds in its place.
      pending = { kind: 'reward', can_hone: true, offers: run.draft.offers.map((o, i) => ({ index: i, citizen: o.citizen, name: nameOf(o.citizen), card: DK.cardView(o.card, 1, textFor(o.citizen)) })) };
    }
  } else if (live && run.room_open && cur) {
    const pct = Math.round(restShare(run) * 100);
    const rest = { key: 'rest', label: 'Rest by the fire', text: `Everyone gets back ${pct}% of their full health. Anyone who is down stands up.${decks ? ' Healing cards that were spent come back.' : ''}` };
    // A rest room rests the party and, with it, hones one card. (Honing in place of the rest was tried in
    // scripts/class_deck_sim.js `hone`: it lost 15 to 20 points of clear rate, a choice nobody should make.)
    const hone = { key: 'hone', label: 'Rest, and hone a card', needs: 'card', text: 'The same rest, and one card of one citizen becomes about a third stronger until the run ends.' };
    if (DEFS.FIGHTS.includes(cur.type)) pending = { kind: 'battle', quest_run_id: run.battle_run_id, board: run.combat === 'board', battle_id: run.board_battle_id, room: cur.type };
    else if (cur.type === 'rest') pending = { kind: 'rest', options: decks ? [hone, { ...rest, label: 'Rest only' }] : [rest] };
    else if (cur.type === 'landing') {
      const rested = !!(here.find(p => p.room === cur.id) || {}).rested;
      pending = { kind: 'landing', options: (rested ? [] : [rest]).concat([{ key: 'deeper', label: 'Go deeper', text: `Down to floor ${run.floor + 2} of ${story.floors.length}. Or turn back now and keep everything found so far.` }]) };
    }
  }
  return {
    id: run.id,
    status: run.status,
    combat: run.combat || 'cards',      // 'board': fights are tactics battles
    dungeon: {
      id: d.id, name: story.name, source: d.source, tier: t.key, tier_name: t.name, skull: t.skull, terrain: story.terrain || d.terrain || null,
      floors: story.floors.length, intro: story.intro || '', boss: story.boss || '', test: !!story.test || d.source === 'test',
      generated: !!story.generated, seed: d.seed,
      creatures: { health: t.hp, strength: t.str }, suggested_party: t.party,
    },
    floor: run.floor,
    room: run.room,
    room_open: !!run.room_open,
    rooms: floor.rooms.map(r => ({
      id: r.id, step: r.step, lane: r.lane, type: r.type, icon: DEFS.ICONS[r.type] || '❓', label: DEFS.LABELS[r.type] || r.type,
      next: r.next || [], visited: taken.has(r.id), current: r.id === run.room, can_enter: moves.includes(r.id),
      enemies: (r.enemies || []).map(enemyName),
    })),
    moves,
    party: run.party_ids.map(id => {
      const st = run.party_state[id] || {}, n = names.find(x => x.id === id);
      return { id, name: n ? n.name : 'Citizen', hp: st.hp || 0, max: st.max || 0, down: !!st.down, was_down: !!st.was_down,
        deck: decks ? DK.deckView(run.deck, id, textFor(id)) : null };
    }),
    loot: { wealth: run.loot.wealth, items: run.loot.items.map(i => { const tp = tpls.find(x => x.item_key === i.item); return { item: i.item, name: tp ? tp.name : i.item.replace(/_/g, ' '), icon: (tp && tp.icon) || '📦', qty: i.qty }; }) },
    pending,
    can_leave: live && !run.battle_run_id && !run.board_battle_id,
    can_flee: live && !!(run.battle_run_id || run.board_battle_id),
    flee_keeps: CONFIG.FLEE_KEEP,
    idle_hours: CONFIG.IDLE_HOURS,
    last_action_at: run.last_action_at,
    started_at: run.started_at,
    ended_at: run.ended_at,
    result: run.result || null,
  };
}

// For the screen's first load and for resuming: the unfinished run, or the
// most recent finished one (so its ending can still be read).
async function current(userId) {
  const s = (await query('SELECT id FROM settlements WHERE user_id=$1', [userId])).rows[0];
  if (!s) return { run: null, last: null };
  const row = (await query(`SELECT * FROM dungeon_runs WHERE settlement_id=$1 AND status = 'active'`, [s.id])).rows[0];
  const lastRow = row ? null : (await query(`SELECT * FROM dungeon_runs WHERE settlement_id=$1 AND status <> 'active' ORDER BY ended_at DESC NULLS LAST LIMIT 1`, [s.id])).rows[0];
  const one = async (r) => r ? view(r, (await query('SELECT * FROM dungeons WHERE id=$1', [r.dungeon_id])).rows[0]) : null;
  return { run: await one(row), last: await one(lastRow) };
}

// ── Setting out ─────────────────────────────────────────────────────────────
async function checkParty(client, s, citizenIds) {
  const ids = [...new Set((citizenIds || []).map(Number).filter(Number.isFinite))];
  if (ids.length !== PARTY) throw err(400, `A dungeon takes a party of exactly ${PARTY} citizens.`);
  const life = require('./life');
  for (const id of ids) {
    const c = (await client.query('SELECT id, name, settlement_id, life_stage, born_at, role FROM citizens WHERE id=$1', [id])).rows[0];
    if (!c || c.settlement_id !== s.id || c.life_stage === 'deceased') throw err(400, 'Citizen not found.');
    const stage = c.born_at ? life.stageOf(c) : (c.life_stage || 'adult');
    if (stage !== 'adult' && stage !== 'elder') throw err(400, `${c.name} is too young for a dungeon.`);
    const why = await require('./outpost_state').busyReason({ ...c, life_stage: 'adult' }, s.id);
    if (why) throw err(400, why);
  }
  return ids;
}

// Send four citizens into a dungeon. Setting out uses up the town's one
// attempt at it: there is no way back to "not started".
// opts.combat: 'board' (fights are tactics battles: docs/TACTICS.md, Phase 3) or 'cards' (as before).
async function start(userId, dungeonId, citizenIds, opts = {}) {
  const board = opts.combat === 'board';
  const CR = require('./combat_resolver');
  const out = await withTransaction(async client => {
    const s = (await client.query('SELECT * FROM settlements WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    if (!s) throw err(404, 'No settlement.');
    const d = (await client.query('SELECT * FROM dungeons WHERE id=$1', [dungeonId])).rows[0];
    if (!d || (d.expires_at && new Date(d.expires_at) <= new Date())) throw err(404, 'That dungeon is gone.');
    storyOf(d);
    if ((await client.query(`SELECT 1 FROM dungeon_runs WHERE settlement_id=$1 AND status IN ('travelling','active')`, [s.id])).rows.length) throw err(400, 'Your town already has a party in a dungeon.');
    if ((await client.query('SELECT 1 FROM dungeon_runs WHERE settlement_id=$1 AND dungeon_id=$2', [s.id, d.id])).rows.length) throw err(400, 'Your town has already been to this dungeon.');
    const ids = await checkParty(client, s, citizenIds);
    const deltas = await require('./careers').combatDeltas(s.id, ids).catch(() => ({}));
    const health = await CR.partyHealth(ids, CR.withParty(null, deltas));
    const state = {};
    for (const id of ids) { const h = health.find(x => x.id === id); state[id] = { hp: h ? h.maxHp : 1, max: h ? h.maxHp : 1, down: false, was_down: false }; }
    // Every citizen's own deck, from their job; and the three cards each is shown at the door.
    const CC = require('./class_cards');
    // On the board there are no decks: a citizen fights with their class's abilities.
    const deck = board ? null : await DK.start(client, ids);
    const draft = board ? null : DK.doorOffers(deck, ids, `${d.seed}|${s.id}`, await CC.ownedFor(s.id, client), await CC.unpreparedFor(s.id, client));
    const run = (await client.query(
      `INSERT INTO dungeon_runs (dungeon_id, settlement_id, user_id, party_ids, party_state, deck, draft, combat) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [d.id, s.id, userId, JSON.stringify(ids), JSON.stringify(state), JSON.stringify(deck || {}), draft && draft.done.length < ids.length ? JSON.stringify(draft) : null, board ? 'board' : 'cards'])).rows[0];
    return { run, d, sid: s.id };
  }).catch(e => { if (e && e.code === '23505') throw err(400, 'Your town already has a party in a dungeon.'); throw e; });
  try { require('./event_bus').publish(out.sid, { type: 'dungeon_started', run_id: out.run.id }); } catch (e) { /* offline */ }
  return { run: await view(out.run, out.d) };
}

// ── A fight room: an ordinary card battle that names its run ────────────────
async function openBattle(client, s, run, d, story, room) {
  const CR = require('./combat_resolver');
  const t = DEFS.tier(story.tier), b = room.boost || {};
  const str = t.str + (Number(b.str) || 0);
  // The skull's numbers, frozen with the battle: a dungeon's difficulty is
  // fixed, so Happening modifiers are not added on top.
  let mods = CR.combatModsOf({ enemy_health: t.hp + (Number(b.hp) || 0), enemy_strength: str, enemy_agility: str / 2 }) || {};
  const deltas = await require('./careers').combatDeltas(s.id, run.party_ids).catch(() => ({}));
  mods = CR.withParty(mods, deltas) || mods;
  const startState = {};
  for (const id of run.party_ids) { const st = run.party_state[id] || {}; startState[id] = st.down ? { down: true } : { hp: st.hp }; }
  mods.dungeon = { run: run.id, start: startState };
  // Each citizen's own deck as it stands, frozen with the battle (lib/combat_resolver.js builds one deck apiece).
  if (DK.has(run.deck)) mods.dungeon.decks = DK.forBattle(run.deck);
  const seed = DEFS.battleSeed(d.seed, s.id, run.floor, room.id);
  return (await client.query(
    `INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, party_ids, quest_type, completes_at, status,
                                    combat_status, combat_trigger_at, combat_seed, combat_encounter, combat_clock_paused_at, combat_mods, auto_resolve_combat, dungeon_run_id)
     VALUES ($1,$2,'dungeon_room',$3,$4,'party', NOW() + make_interval(mins => $5), 'active', 'pending', NOW(), $6, $7, NOW(), $8, FALSE, $9) RETURNING *`,
    [s.id, run.user_id, standing(run)[0] || run.party_ids[0], JSON.stringify(run.party_ids), BATTLE_MIN, seed, JSON.stringify(room.enemies), JSON.stringify(mods), run.id])).rows[0];
}

// ── A fight room on the board: a tactics battle that names its run ──────────
// The party as it stands (health carried in; whoever is down lies on the
// board until healed) against the room's creatures, with the board's own skull numbers
// (lib/tactics_setup.js TIERS) and the room's boost. lib/tactics_battles.js
// keeps the battle; when it ends there, boardResolved (below) settles it here.
async function openBoardBattle(client, s, run, d, story, room) {
  const SETUP = require('./tactics_setup'), CR = require('./combat_resolver');
  const q = (t, p) => client.query(t, p);
  const deltas = await require('./careers').combatDeltas(s.id, run.party_ids).catch(() => ({}));
  const start = {};
  for (const id of run.party_ids) { const st = run.party_state[id] || {}; start[id] = st.down ? { down: true } : { hp: st.hp }; }
  const party = await SETUP.partyFor(run.party_ids, { mods: CR.withParty(null, deltas), start });
  const enemies = await SETUP.foesFor(room.enemies, story.tier, room.boost, q);
  const t = DEFS.tier(story.tier);
  const setup = {
    seed: DEFS.battleSeed(d.seed, s.id, run.floor, room.id), land: story.terrain || d.terrain || 'forest', tier: t.key, skull: t.skull,
    name: story.name, fight: room.type === 'fight' ? 'fight' : room.type, level: 'as_is', species: await SETUP.speciesOf(run.user_id, q),
    party, enemies, dungeon: { run: run.id, floor: run.floor, room: room.id },
  };
  // A practice battle left open gives way: a town has one battle on a board at a time.
  await q(`UPDATE tactics_battles SET status='left', ended_at=NOW(), updated_at=NOW() WHERE settlement_id=$1 AND status='active'`, [s.id]);
  return (await q(
    `INSERT INTO tactics_battles (settlement_id, user_id, source, seed, land, tier, fight, setup, dungeon_run_id) VALUES ($1,$2,'dungeon',$3,$4,$5,$6,$7,$8) RETURNING *`,
    [s.id, run.user_id, setup.seed, setup.land, setup.tier, setup.fight, JSON.stringify(setup), run.id])).rows[0];
}

// ── Walking the path ────────────────────────────────────────────────────────
async function move(userId, roomId) {
  const out = await withTransaction(async client => {
    const { s, run, d, story } = await liveRun(client, userId, true);
    if (run.room_open) throw err(400, run.battle_run_id || run.board_battle_id ? 'Finish the fight first.' : 'Decide what to do in this room first.');
    if (run.draft) throw err(400, run.draft.kind === 'door' ? 'Choose a card for each citizen first (or pass).' : 'Choose a card from the fight first (or pass).');
    const cur = run.room ? DEFS.room(story, run.floor, run.room) : null;
    const can = cur ? (cur.next || []) : DEFS.firstRooms(story, run.floor).map(r => r.id);
    const room = can.includes(String(roomId)) ? DEFS.room(story, run.floor, String(roomId)) : null;
    if (!room) throw err(400, 'That room is not connected to where the party stands.');
    const entry = { floor: run.floor, room: room.id };
    let found = null, battle = null, board = null, open = false, loot = run.loot;
    if (DEFS.FIGHTS.includes(room.type)) {
      if (run.combat === 'board') { board = await openBoardBattle(client, s, run, d, story, room); entry.board = Number(board.id); }
      else { battle = await openBattle(client, s, run, d, story, room); entry.battle = battle.id; }
      open = true;
    } else if (room.type === 'treasure') {
      found = lootOf(room.loot);
      loot = addLoot(loot, found);
    } else if (room.type === 'rest' || room.type === 'landing') {
      open = true;
    } else throw err(500, 'That kind of room is not built yet.');
    const up = (await client.query(
      `UPDATE dungeon_runs SET room=$2, room_open=$3, path_taken=$4, loot=$5, battle_run_id=$6, board_battle_id=$7, last_action_at=NOW() WHERE id=$1 RETURNING *`,
      [run.id, room.id, open, JSON.stringify(run.path_taken.concat([entry])), JSON.stringify(loot), battle ? battle.id : null, board ? board.id : null])).rows[0];
    return { run: up, d, sid: s.id, found, battle, board };
  });
  if (out.battle) { try { require('./event_bus').publish(out.sid, { type: 'combat_pending', quest_run_id: out.battle.id }); } catch (e) { /* offline */ } }
  return { run: await view(out.run, out.d), found: out.found ? await named(out.found) : null, quest_run_id: out.battle ? out.battle.id : null, board_battle_id: out.board ? Number(out.board.id) : null };
}

// Rest: everyone gets back REST of their full health; the downed stand up.
// A fight on the board costs more than a card fight did, so a rest there gives more.
const restShare = run => (run.combat === 'board' ? CONFIG.BOARD_REST : CONFIG.REST);
function rest(run) {
  const state = {};
  for (const id of run.party_ids) {
    const st = { ...(run.party_state[id] || {}) };
    const gain = Math.max(1, Math.round((st.max || 1) * restShare(run)));
    if (st.down) { st.down = false; st.hp = Math.min(st.max || gain, gain); }
    else st.hp = Math.min(st.max || 1, (st.hp || 0) + gain);
    state[id] = st;
  }
  return state;
}

// Keep one of the cards on offer (at the door, or after a fight), or pass.
//   door:   { citizen_id, card }   card null to pass for that citizen
//   reward: { index }              index null to pass
async function pick(userId, body) {
  const out = await withTransaction(async client => {
    const { s, run, d } = await liveRun(client, userId, true);
    if (!run.draft) throw err(400, 'There are no cards to choose from.');
    const r = DK.pick(run.deck, run.draft, body || {});
    const up = (await client.query(`UPDATE dungeon_runs SET deck=$2, draft=$3, last_action_at=NOW() WHERE id=$1 RETURNING *`,
      [run.id, JSON.stringify(r.deck), r.draft ? JSON.stringify(r.draft) : null])).rows[0];
    return { run: up, d, sid: s.id, took: r.took };
  });
  return { run: await view(out.run, out.d), took: out.took ? { citizen: out.took.citizen, card: DK.cardView(out.took.card, 1), honed: !!out.took.honed } : null };
}

// Answer a rest room or a landing. `extra` for honing: { citizen_id, card }.
async function choose(userId, option, extra = {}) {
  const out = await withTransaction(async client => {
    const { s, run, d, story } = await liveRun(client, userId, true);
    const cur = run.room ? DEFS.room(story, run.floor, run.room) : null;
    if (!run.room_open || !cur || run.battle_run_id) throw err(400, 'There is nothing to decide here.');
    const idx = run.path_taken.map(p => p.floor === run.floor && p.room === cur.id).lastIndexOf(true);
    let up;
    if (option === 'rest' && (cur.type === 'rest' || cur.type === 'landing')) {
      if (cur.type === 'landing' && idx >= 0 && run.path_taken[idx].rested) throw err(400, 'The party has already rested here.');
      const path = run.path_taken.slice();
      if (idx >= 0) path[idx] = { ...path[idx], rested: true };
      // Resting also brings back every heal the party has spent.
      up = await client.query(`UPDATE dungeon_runs SET party_state=$2, path_taken=$3, room_open=$4, deck=$5, last_action_at=NOW() WHERE id=$1 RETURNING *`,
        [run.id, JSON.stringify(rest(run)), JSON.stringify(path), cur.type === 'landing', JSON.stringify(DK.restore(run.deck))]);
    } else if (option === 'hone' && cur.type === 'rest') {
      // The party rests, and one card of one citizen is honed for the rest of the run.
      if (!DK.has(run.deck)) throw err(400, 'There are no cards to hone.');
      const deck = DK.restore(DK.hone(run.deck, extra.citizen_id, extra.card));
      const path = run.path_taken.slice();
      if (idx >= 0) path[idx] = { ...path[idx], rested: true, honed: { citizen: Number(extra.citizen_id), card: extra.card } };
      up = await client.query(`UPDATE dungeon_runs SET party_state=$2, deck=$3, path_taken=$4, room_open=FALSE, last_action_at=NOW() WHERE id=$1 RETURNING *`,
        [run.id, JSON.stringify(rest(run)), JSON.stringify(deck), JSON.stringify(path)]);
    } else if (option === 'deeper' && cur.type === 'landing') {
      if (run.floor + 1 >= story.floors.length) throw err(400, 'There is no deeper floor.');
      up = await client.query(`UPDATE dungeon_runs SET floor = floor + 1, room = NULL, room_open = FALSE, last_action_at=NOW() WHERE id=$1 RETURNING *`, [run.id]);
    } else throw err(400, 'That is not one of the choices here.');
    return { run: up.rows[0], d, sid: s.id };
  });
  return { run: await view(out.run, out.d) };
}

// ── Endings ─────────────────────────────────────────────────────────────────
// Inside the transaction: settle the loot and close the run. Returns what
// afterEnd needs (injuries are written after the commit: their writers use
// their own connections).
async function finishTx(client, s, run, d, story, ending, { half = false, idle = false } = {}) {
  let kept = lootOf(run.loot), lost = { wealth: 0, items: [] };
  if (ending === 'defeat') { lost = kept; kept = { wealth: 0, items: [] }; }
  else if (half) [kept, lost] = splitLoot(run.loot, CONFIG.FLEE_KEEP);
  const closed = await client.query(
    `UPDATE dungeon_runs SET status=$2, room_open=FALSE, battle_run_id=NULL, board_battle_id=NULL, ended_at=NOW(), last_action_at=NOW() WHERE id=$1 AND status='active' RETURNING id`, [run.id, ending]);
  if (!closed.rowCount) return null;   // someone else ended it first
  let wealthAfter = s.wealth;
  if (kept.wealth > 0) wealthAfter = (await client.query('UPDATE settlements SET wealth = wealth + $2 WHERE id=$1 RETURNING wealth', [s.id, kept.wealth])).rows[0].wealth;
  const items = kept.items.length ? await require('./spoils').grantItems(client, s.id, kept.items, 'dungeon') : [];
  // Who rolls for injury, and how (the header explains the rule).
  const rolls = [];
  for (const id of run.party_ids) {
    const st = run.party_state[id] || {};
    if (ending === 'defeat') rolls.push({ citizenId: id, noFatal: false });
    else if (st.was_down) rolls.push({ citizenId: id, noFatal: !st.down });
  }
  const fights = run.path_taken.filter(p => p.battle || p.board);
  const result = {
    ending, idle: !!idle, half: !!half,
    kept: { wealth: kept.wealth, items },
    lost: await named(lost, (t, p) => client.query(t, p)),
    rooms: run.path_taken.length, fights: fights.length,
    rolled: rolls.map(r => ({ id: r.citizenId, no_fatal: !!r.noFatal })),   // who rolled for injury, and on which table
    injuries: [], upgraded: [],
  };
  await client.query('UPDATE dungeon_runs SET result=$2 WHERE id=$1', [run.id, JSON.stringify(result)]);
  return { runId: run.id, sid: s.id, ending, rolls, result, wealthAfter, d, story, partyIds: run.party_ids, state: run.party_state,
    lastBattle: fights.length ? (fights[fights.length - 1].battle || null) : null, enemy: run.last_enemy || null };
}

// After the commit: the single injury roll, a little combat skill for those
// still on their feet, the chronicle, the news, and the live event.
async function afterEnd(fin) {
  if (!fin) return null;
  const CR = require('./combat_resolver');
  const { result } = fin;
  try {
    result.injuries = await CR.applyRunAftermath({ settlementId: fin.sid, questRunId: fin.lastBattle, enemy: fin.enemy, rolls: fin.rolls });
  } catch (e) { console.error('[dungeons] injuries failed:', e.message); }
  const names = (await query('SELECT id, name, skills, life_stage FROM citizens WHERE id = ANY($1)', [fin.partyIds])).rows;
  // Combat skill, once per run (not once per room): a kept ending, standing citizens.
  if (['cleared', 'left', 'timed_out'].includes(fin.ending) && !result.half) {
    for (const c of names) {
      const st = fin.state[c.id] || {};
      if (st.down || c.life_stage === 'deceased' || Math.random() > 0.5) continue;
      const skills = c.skills || {}, curSkill = skills.combat || 1;
      if (curSkill >= SKILL_CAP) continue;
      skills.combat = curSkill + 1;
      await query('UPDATE citizens SET skills=$1 WHERE id=$2', [skills, c.id]).catch(() => {});
      result.upgraded.push({ id: c.id, name: c.name, combat: skills.combat });
    }
  }
  const party = list(fin.partyIds.map(id => (names.find(n => n.id === id) || {}).name).filter(Boolean));
  const where = fin.story.name, wealth = result.kept.wealth;
  const lines = {
    cleared: `💀 ${party} cleared ${where} and came home with everything they found${wealth ? ` (+${wealth} wealth)` : ''}.`,
    left: `💀 ${party} turned back from ${where} and kept what they had found${wealth ? ` (+${wealth} wealth)` : ''}.`,
    fled: `💀 ${party} fled a fight in ${where} and dropped half of what they carried.`,
    defeat: `💀 ${party} were driven out of ${where}. Everything they had found was lost.`,
    timed_out: result.half
      ? `💀 ${party} waited too long in the middle of a fight in ${where} and came home with half of what they carried.`
      : `💀 ${party} waited too long in ${where} and came home with what they had found.`,
  };
  await query('UPDATE dungeon_runs SET result=$2 WHERE id=$1', [fin.runId, JSON.stringify(result)]).catch(() => {});
  await query("INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,'dungeon',$2,$3)", [fin.sid, lines[fin.ending], JSON.stringify(fin.partyIds)]).catch(() => {});
  if (fin.ending === 'cleared' || fin.ending === 'defeat') {
    await require('./chronicle').write(fin.sid, {
      kind: 'quest', citizenIds: fin.partyIds,
      text: fin.ending === 'cleared' ? `${party} went down into ${where} and came back having cleared it.` : `${party} were driven out of ${where} and came home with nothing.`,
    });
  }
  try { require('./event_bus').publish(fin.sid, { type: 'dungeon_ended', run_id: fin.runId, ending: fin.ending, message: lines[fin.ending] }); } catch (e) { /* offline */ }
  try { require('./game_events').emit('dungeon_ended', { settlementId: fin.sid, runId: fin.runId, ending: fin.ending, citizenIds: fin.partyIds }); } catch (e) { /* none */ }
  return result;
}
const list = (a) => a.length <= 1 ? (a[0] || 'The party') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
// Loot with names and icons, for showing.
async function named(loot, q = (t, p) => query(t, p)) {
  const l = lootOf(loot);
  const tpls = l.items.length ? (await q('SELECT item_key, name, icon FROM item_templates WHERE item_key = ANY($1::text[])', [l.items.map(i => i.item)])).rows : [];
  return { wealth: l.wealth, items: l.items.map(i => { const t = tpls.find(x => x.item_key === i.item); return { item_key: i.item, name: t ? t.name : i.item.replace(/_/g, ' '), icon: (t && t.icon) || '📦', qty: i.qty }; }) };
}
async function ended(runId) {
  const r = (await query('SELECT * FROM dungeon_runs WHERE id=$1', [runId])).rows[0];
  return r ? view(r, (await query('SELECT * FROM dungeons WHERE id=$1', [r.dungeon_id])).rows[0]) : null;
}

// Turn back, between rooms: everything found is kept.
async function leave(userId, { idle = false } = {}) {
  const fin = await withTransaction(async client => {
    const { s, run, d, story } = await liveRun(client, userId, true);
    if (run.battle_run_id || run.board_battle_id) throw err(400, 'The party is in a fight. Win it, or flee.');
    return finishTx(client, s, run, d, story, idle ? 'timed_out' : 'left', { idle });
  });
  await afterEnd(fin);
  return { run: fin ? await ended(fin.runId) : null };
}

// The party's health and who is down, as a battle leaves them.
function syncParty(run, battle) {
  const state = { ...run.party_state };
  for (const u of (battle.units || [])) {
    if (u.side !== 'player' || !u.citizen_id) continue;
    const st = { ...(state[u.citizen_id] || {}) };
    const down = !!(u.flags && u.flags.downed) || u.hp <= 0;
    st.max = u.maxHp || st.max;
    st.down = down;
    st.hp = down ? 0 : Math.max(1, u.hp);
    if (down) st.was_down = true;
    state[u.citizen_id] = st;
  }
  return state;
}

// A foe of the board as words for a sentence: "a Boar Bruiser", "an Ogre"; a boss keeps its own name.
function enemyWords(key) {
  const f = key && require('./tactics_foes').foe(key);
  if (!f) return key || null;
  return f.rank === 'boss' ? f.name : `${/^[aeiou]/i.test(f.name) ? 'an' : 'a'} ${f.name}`;
}
// The party's state after a battle on the board (lib/tactics_engine.js): each
// citizen's health as the battle left it. Whoever came in down lay on the
// board, and is still down unless someone healed them.
function syncBoard(run, battleState) {
  const state = { ...run.party_state };
  for (const u of battleState.units) {
    if (u.side !== 'player' || !u.citizen_id) continue;
    const st = { ...(state[u.citizen_id] || {}) }, down = !!u.down || u.hp <= 0;
    st.max = u.maxHp || st.max;
    st.down = down;
    st.hp = down ? 0 : Math.max(1, u.hp);
    if (down || u.fell) st.was_down = true;      // stood back up in the fight still counts as having gone down
    state[u.citizen_id] = st;
  }
  return state;
}
// A dungeon's battle has ended on the board. Called by lib/tactics_battles.js
// inside the transaction that stored the last choice: wounds and loot go to
// the run and the party is back on the path; the boss falling clears the
// dungeon; a defeat ends the run. → what afterBoard needs once it has committed.
async function boardResolved(client, bt, battleState) {
  const row = (await client.query(`SELECT * FROM dungeon_runs WHERE id=$1 AND status='active' FOR UPDATE`, [bt.dungeon_run_id])).rows[0];
  if (!row || Number(row.board_battle_id) !== Number(bt.id)) return { stale: true, runId: bt.dungeon_run_id };
  const run = normal(row);
  const s = (await client.query('SELECT * FROM settlements WHERE id=$1', [run.settlement_id])).rows[0];
  const d = (await client.query('SELECT * FROM dungeons WHERE id=$1', [run.dungeon_id])).rows[0];
  const story = storyOf(d), room = DEFS.room(story, run.floor, run.room), won = battleState.status === 'victory';
  run.party_state = syncBoard(run, battleState);
  const keys = (room && room.enemies) || [];
  // Who they fought, as an injury's line will name it: "a Boar Bruiser", or a boss by its own name.
  run.last_enemy = enemyWords(keys[0]) || run.last_enemy;
  let found = null;
  if (won) {
    // A fight's wealth: 8 for each point of its foes' reward, at the skull's share.
    const wealth = await require('./tactics_setup').rewardOf(keys, (t, p) => client.query(t, p));
    // And what they carried: each foe's own drops, rolled from the battle's seed.
    const drops = await require('./tactics_setup').dropsFor(keys, bt.seed, (t, p) => client.query(t, p));
    found = { wealth: Math.round(wealth * DEFS.tier(story.tier).wealth), items: drops };
    if (room && room.loot) found = addLoot(found, room.loot);                              // an elite's guaranteed find
    if (room && room.type === 'boss' && story.clear) found = addLoot(found, story.clear);   // the boss chest
    run.loot = addLoot(run.loot, found);
  }
  await client.query(
    `UPDATE dungeon_runs SET party_state=$2, loot=$3, last_enemy=$4, room_open=FALSE, board_battle_id=NULL, last_action_at=NOW() WHERE id=$1`,
    [run.id, JSON.stringify(run.party_state), JSON.stringify(run.loot), run.last_enemy]);
  let fin = null;
  if (!won) fin = await finishTx(client, s, run, d, story, 'defeat');
  else if (room && room.type === 'boss') fin = await finishTx(client, s, run, d, story, 'cleared');
  const standing = battleState.units.filter(u => u.side === 'player' && !u.down).map(u => u.citizen_id).filter(Boolean);
  // For lib/tactics_xp.js: who fought (and who lay fallen at the end), against whom, at which skull.
  const units = battleState.units.filter(u => u.side === 'player' && u.citizen_id).map(u => ({ citizen_id: u.citizen_id, cls: u.cls, down: !!u.down }));
  return { fin, found, runId: run.id, sid: s.id, userId: run.user_id, won, enemyCount: keys.length, standing, units, keys, tier: story.tier };
}
// After that transaction has committed: injuries and the rest of an ending, the
// live event, career experience. → what the battle screen shows.
async function afterBoard(hook) {
  if (!hook) return null;
  if (hook.stale) { const again = await ended(hook.runId); return { run: again, found: null, ended: !!(again && again.status !== 'active'), injuries: (again && again.result && again.result.injuries) || [] }; }
  const result = await afterEnd(hook.fin);
  try { require('./event_bus').publish(hook.sid, { type: 'combat_resolved', outcome: hook.won ? 'victory' : 'defeat' }); } catch (e) { /* offline */ }
  // A fight that is won pays experience, here and now, so the screen can show it (lib/tactics_xp.js).
  // The careers' own listener is told it has been paid and only counts the battle.
  let rewards = null;
  if (hook.won) {
    const XP = require('./tactics_xp'), xp = XP.xpOf(hook.keys, hook.tier);
    try { rewards = { kept: true, xp, party: await XP.award(hook.sid, hook.units, xp) }; } catch (e) { console.error('[dungeons] experience failed:', e.message); }
    try { require('./game_events').emit('battle_won', { settlementId: hook.sid, userId: hook.userId, enemyCount: hook.enemyCount, citizenIds: hook.standing, xpGranted: !!rewards }); } catch (e) { /* no listeners */ }
  }
  // When the run has ended: each citizen who rolled for injury, and what came of it, for the screen to show one by one.
  let rolls = [];
  if (hook.fin && hook.fin.rolls.length) {
    const names = (await query('SELECT id, name FROM citizens WHERE id = ANY($1)', [hook.fin.rolls.map(r => r.citizenId)])).rows;
    rolls = hook.fin.rolls.map(r => {
      const ev = ((result && result.injuries) || []).find(x => Number(x.citizen_id) === Number(r.citizenId));
      return { citizen_id: r.citizenId, name: (names.find(n => n.id === r.citizenId) || {}).name || 'Citizen', no_fatal: !!r.noFatal,
        severity: ev ? (ev.event_type === 'death' ? 'fatal' : ev.severity) : 'none', body_part: ev ? ev.body_part : null, narrative: ev ? ev.narrative : null };
    });
  }
  return { run: await ended(hook.runId), found: hook.found ? await named(hook.found) : null, ended: !!hook.fin, injuries: result ? result.injuries : [], rewards, rolls };
}

// Flee a fight: the run ends, half the loot is dropped, and everyone who
// went down rolls for injury. A run left idle in a fight ends the same way.
async function flee(userId, { idle = false } = {}) {
  const CR = require('./combat_resolver');
  const fin = await withTransaction(async client => {
    const { s, run, d, story } = await liveRun(client, userId, true);
    if (run.board_battle_id) {
      // On the board: the party leaves as it stands now, and the battle is closed.
      const bt = (await client.query('SELECT * FROM tactics_battles WHERE id=$1 FOR UPDATE', [run.board_battle_id])).rows[0];
      if (bt && bt.status === 'active') {
        const { state } = require('./tactics_engine').replay(bt.setup, bt.actions);
        run.party_state = syncBoard(run, state);
        run.last_enemy = enemyWords((bt.setup.enemies[0] || {}).key) || run.last_enemy;
        await client.query(`UPDATE tactics_battles SET status='left', ended_at=NOW(), updated_at=NOW() WHERE id=$1`, [bt.id]);
        await client.query('UPDATE dungeon_runs SET party_state=$2, last_enemy=$3 WHERE id=$1', [run.id, JSON.stringify(run.party_state), run.last_enemy]);
      }
      return finishTx(client, s, run, d, story, idle ? 'timed_out' : 'fled', { half: true, idle });
    }
    if (!run.battle_run_id) throw err(400, 'The party is not in a fight. Turn back instead.');
    const b = (await client.query('SELECT * FROM settlement_quests WHERE id=$1 FOR UPDATE', [run.battle_run_id])).rows[0];
    if (b && ['pending', 'in_progress'].includes(b.combat_status)) {
      const replay = await CR.replayBattle({
        citizenIds: run.party_ids, enemyKeys: arr(b.combat_encounter), seed: parseInt(b.combat_seed) || 1,
        actions: arr(b.combat_actions), settlementId: s.id, mods: b.combat_mods,
      });
      if (replay.battle.status !== 'active' && !idle) throw err(400, 'The fight is already over.');
      if (replay.battle.status === 'defeat') return { defeat: true, s, run, d, story, b, battle: replay.battle };
      run.party_state = syncParty(run, replay.battle);
      run.last_enemy = arr(b.combat_encounter)[0] || run.last_enemy;
      await client.query(
        `UPDATE settlement_quests SET combat_status='resolved', combat_outcome='defeat', combat_resolved_at=NOW(), combat_log=$2,
                status='collected', completes_at=NOW(), combat_clock_paused_at=NULL WHERE id=$1`,
        [b.id, JSON.stringify([idle ? 'The party waited too long and withdrew.' : 'The party fled.'])]);
      await client.query('UPDATE dungeon_runs SET party_state=$2, last_enemy=$3 WHERE id=$1', [run.id, JSON.stringify(run.party_state), run.last_enemy]);
    }
    return finishTx(client, s, run, d, story, idle ? 'timed_out' : 'fled', { half: true, idle });
  });
  // An idle run whose fight had already been lost is a defeat like any other.
  if (fin && fin.defeat) {
    const r = await onBattleResolved({ questRun: fin.b, battle: fin.battle, settlement: fin.s, log: fin.battle.log || [] });
    return { run: r && r.dungeon ? r.dungeon.run : null };
  }
  await afterEnd(fin);
  try { require('./event_bus').publish(fin.sid, { type: 'combat_resolved', quest_run_id: fin.lastBattle, outcome: 'defeat' }); } catch (e) { /* offline */ }
  return { run: fin ? await ended(fin.runId) : null };
}

// ── After a dungeon battle (routes/combat.js /resolve) ──────────────────────
// `battle` is the server's own replay, already finished. Victory: wounds and
// loot go to the run and the party is back on the path (or the dungeon is
// cleared, if that was the boss). Defeat: the run ends.
// Returns the /resolve answer, or null when this is not a dungeon battle.
async function onBattleResolved({ questRun, battle, settlement, log }) {
  if (!questRun || !questRun.dungeon_run_id) return null;
  const outcome = battle.status;   // 'victory' | 'defeat'
  const units = (battle.units || []).filter(u => u.side === 'player');
  const survivors = units.filter(u => !u.flags.downed).map(u => ({ id: u.citizen_id, name: u.name, hp: u.hp }));
  const fallen = units.filter(u => u.flags.downed).map(u => ({ id: u.citizen_id, name: u.name }));
  const tx = await withTransaction(async client => {
    const s = (await client.query('SELECT * FROM settlements WHERE id=$1', [settlement.id])).rows[0];
    const row = (await client.query(`SELECT * FROM dungeon_runs WHERE id=$1 AND status='active' FOR UPDATE`, [questRun.dungeon_run_id])).rows[0];
    // Only the request that closes the battle row settles it (a retry or a double tap gets the same screen, nothing more).
    const closed = await client.query(
      `UPDATE settlement_quests SET combat_status='resolved', combat_outcome=$2, combat_resolved_at=NOW(), combat_log=$3,
              status='collected', completes_at=NOW(), combat_clock_paused_at=NULL
        WHERE id=$1 AND combat_status IN ('pending','in_progress','rolled')`, [questRun.id, outcome, JSON.stringify(log || [])]);
    if (!row || !closed.rowCount || row.battle_run_id !== questRun.id) return { stale: true };
    const run = normal(row);
    const d = (await client.query('SELECT * FROM dungeons WHERE id=$1', [run.dungeon_id])).rows[0];
    const story = storyOf(d), room = DEFS.room(story, run.floor, run.room);
    run.party_state = syncParty(run, battle);
    run.last_enemy = arr(questRun.combat_encounter)[0] || run.last_enemy;
    let found = null;
    if (outcome === 'victory') {
      const t = DEFS.tier(story.tier);
      found = { wealth: Math.round(((battle.reward && battle.reward.wealth) || 0) * t.wealth), items: ((battle.reward && battle.reward.drops) || []).map(x => ({ item: x.item, qty: x.qty })) };
      if (room && room.loot) found = addLoot(found, room.loot);                    // an elite's guaranteed find
      if (room && room.type === 'boss' && story.clear) found = addLoot(found, story.clear);   // the boss chest
      run.loot = addLoot(run.loot, found);
      if (DK.has(run.deck)) {
        // Heals played in this fight are gone until the party rests; and,
        // after any fight but the last, three cards are offered: one for the party to keep.
        run.deck = DK.spendHeals(run.deck, battle);
        if (!(room && room.type === 'boss')) {
          const CC = require('./class_cards');
          run.draft = DK.rewardOffers(run.deck, run.party_ids, `${d.seed}|${s.id}`, `${run.floor}:${run.room}`, await CC.ownedFor(s.id, client), await CC.unpreparedFor(s.id, client));
        }
      }
    }
    await client.query(
      `UPDATE dungeon_runs SET party_state=$2, loot=$3, last_enemy=$4, deck=$5, draft=$6, room_open=FALSE, battle_run_id=NULL, last_action_at=NOW() WHERE id=$1`,
      [run.id, JSON.stringify(run.party_state), JSON.stringify(run.loot), run.last_enemy, JSON.stringify(run.deck), run.draft ? JSON.stringify(run.draft) : null]);
    let fin = null;
    if (outcome !== 'victory') fin = await finishTx(client, s, run, d, story, 'defeat');
    else if (room && room.type === 'boss') fin = await finishTx(client, s, run, d, story, 'cleared');
    return { fin, found, runId: run.id, sid: s.id, wealthAfter: fin ? fin.wealthAfter : s.wealth };
  });
  if (tx.stale) {
    const again = await ended(questRun.dungeon_run_id);
    return { ok: true, outcome, survivors, fallen, injuries: (again && again.result && again.result.injuries) || [], dungeon: { run: again, found: null, ended: !!(again && again.status !== 'active') } };
  }
  const result = await afterEnd(tx.fin);
  try { require('./event_bus').publish(tx.sid, { type: 'combat_resolved', quest_run_id: questRun.id, outcome }); } catch (e) { /* offline */ }
  if (outcome === 'victory') {
    // Career experience as from any won battle (lib/career_subscriber).
    try { require('./game_events').emit('battle_won', { settlementId: tx.sid, userId: questRun.user_id, enemyCount: arr(questRun.combat_encounter).length, citizenIds: survivors.map(x => x.id).filter(Boolean) }); } catch (e) { /* none */ }
  }
  return {
    ok: true, outcome,
    wealth_awarded: 0, wealth_after: tx.wealthAfter, spoils: null,
    survivors, fallen,
    injuries: result ? result.injuries : [],
    upgraded_citizens: result ? result.upgraded : [],
    dungeon: { run: await ended(tx.runId), found: tx.found ? await named(tx.found) : null, ended: !!tx.fin },
  };
}

// A dungeon battle's row was touched (engaged, a card played): the run is not idle.
async function touch(runId) {
  if (runId) await query(`UPDATE dungeon_runs SET last_action_at = NOW() WHERE id=$1 AND status='active'`, [runId]).catch(() => {});
}

// Which of these citizens are in an unfinished dungeon run (they are busy
// from setting out until the run ends, between rooms too).
async function busyCitizenIds(ids, db) {
  const list = (ids || []).map(Number).filter(Number.isFinite);
  if (!list.length) return [];
  const q = db && db.query ? (t, p) => db.query(t, p) : (t, p) => query(t, p);
  const r = await q(
    `SELECT DISTINCT e.value::int AS id FROM dungeon_runs dr, jsonb_array_elements_text(dr.party_ids) e
      WHERE dr.status IN ('travelling','active') AND e.value::int = ANY($1::int[])`, [list]).catch(() => ({ rows: [] }));
  return r.rows.map(x => x.id);
}

// ── Left alone ──────────────────────────────────────────────────────────────
// A run nobody has touched for IDLE_HOURS ends by itself: between rooms as
// turned back; in a fight at the price of fleeing (§3.3).
async function sweep() {
  const rows = (await query(`SELECT id, user_id, COALESCE(battle_run_id, board_battle_id) AS battle_run_id FROM dungeon_runs WHERE status='active' AND last_action_at < NOW() - make_interval(secs => $1)`, [CONFIG.IDLE_HOURS * 3600])).rows;
  let n = 0;
  for (const r of rows) {
    try { if (r.battle_run_id) await flee(r.user_id, { idle: true }); else await leave(r.user_id, { idle: true }); n++; }
    catch (e) { console.error('[dungeons] idle run', r.id, e.message); }
  }
  // Test dungeons nobody is in any more (their town was deleted, or the start failed half-way).
  await query(`DELETE FROM dungeons d WHERE d.source = 'test' AND d.created_at < NOW() - interval '1 day'
                AND NOT EXISTS (SELECT 1 FROM dungeon_runs r WHERE r.dungeon_id = d.id)`).catch(() => {});
  return n;
}
let _last = 0;
async function tick() {
  if (Date.now() - _last < 5 * 60 * 1000) return;
  _last = Date.now();
  try { await sweep(); } catch (e) { console.error('[dungeons]', e.message); }
}

// ── Generated dungeons (lib/dungeon_gen.js; build step 3) ───────────────────
// Make a dungeon from a seed and store it. `source` is 'map', 'quest' or
// 'test'. The creature list is read now and the result kept on the row.
async function createGenerated({ tier, terrain, seed, source = 'map', q = null, r = null, expiresAt = null, combat = 'cards' } = {}) {
  const GEN = require('./dungeon_gen');
  if (!DEFS.TIERS[tier]) throw err(400, 'No such skull.');
  if (!GEN.LANDS.includes(terrain)) throw err(400, 'No such land.');
  const s = Math.max(1, Math.min(0x7ffffffe, Math.floor(Number(seed)) || (Math.floor(Math.random() * 0x7ffffffe) + 1)));
  // For the board, the foes of one band (lib/tactics_foes.js); for cards, the creatures the card battles know.
  const creatures = combat === 'board' ? require('./tactics_foes').castFor(terrain, s).creatures
    : (await query('SELECT id, name, max_hp, biomes, archived FROM enemy_definitions WHERE archived = FALSE')).rows;
  // Loot is chosen from the items this database really has, so nothing a dungeon promises is missing when it is paid.
  const items = (await query('SELECT item_key FROM item_templates WHERE item_key = ANY($1::text[])', [GEN.LOOT_KEYS])).rows.map(x => x.item_key);
  const layout = GEN.generate({ seed: s, tier, terrain, creatures, items, board: combat === 'board' });
  const problems = GEN.check(layout);
  if (problems.length) throw err(500, 'The generator made a dungeon that breaks its own rules: ' + problems.slice(0, 3).join('; '));
  return (await query(
    `INSERT INTO dungeons (source, q, r, terrain, tier, seed, layout, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [source, q, r, terrain, tier, s, JSON.stringify(layout), expiresAt])).rows[0];
}

// ── Dev Tools ───────────────────────────────────────────────────────────────
function stories() {
  return Object.entries(DEFS.STORIES).map(([key, s]) => { const t = DEFS.tier(s.tier); return { key, name: s.name, tier: t.key, tier_name: t.name, skull: t.skull, floors: s.floors.length, intro: s.intro || '' }; });
}
// Four adults with nothing else to do, for "start with whoever is free".
async function freeAdults(s) {
  const life = require('./life'), OS = require('./outpost_state');
  const cits = (await query(`SELECT id, name, settlement_id, life_stage, born_at, role FROM citizens WHERE settlement_id=$1 AND COALESCE(life_stage,'adult') <> 'deceased' ORDER BY id`, [s.id])).rows;
  const out = [];
  for (const c of cits) {
    const stage = c.born_at ? life.stageOf(c) : (c.life_stage || 'adult');
    if (stage !== 'adult' && stage !== 'elder') continue;
    if (await OS.busyReason({ ...c, life_stage: 'adult' }, s.id)) continue;
    out.push(c.id);
    if (out.length === PARTY) break;
  }
  return out;
}
// A fresh copy of a test dungeon, and a party sent into it. Each start makes
// a new dungeon, so a test can be played again and again.
async function startTest(userId, storyKey, citizenIds, opts = {}) {
  const story = DEFS.STORIES[storyKey];
  if (!story) throw err(400, 'No such test dungeon.');
  const s = (await query('SELECT * FROM settlements WHERE user_id=$1', [userId])).rows[0];
  if (!s) throw err(404, 'No settlement.');
  const ids = (citizenIds && citizenIds.length) ? citizenIds : await freeAdults(s);
  if (ids.length !== PARTY) throw err(400, `A dungeon takes a party of exactly ${PARTY} citizens, and only ${ids.length} adult${ids.length === 1 ? ' is' : 's are'} free.`);
  const d = (await query(`INSERT INTO dungeons (source, terrain, tier, seed, story_key) VALUES ('test',$1,$2,$3,$4) RETURNING *`,
    [story.terrain || null, story.tier, Math.floor(Math.random() * 0x7fffffff) + 1, storyKey])).rows[0];
  try { return await start(userId, d.id, ids, opts); }
  catch (e) { await query('DELETE FROM dungeons WHERE id=$1', [d.id]).catch(() => {}); throw e; }
}

// Win the open fight outright, as it stands (Dev Tools: to walk a path without
// playing every battle). The party keeps the health it has in the fight now.
async function adminWin(userId) {
  const CR = require('./combat_resolver');
  const { s, run } = await liveRun({ query: (t, p) => query(t, p) }, userId);
  if (run.board_battle_id) {
    // On the board: the creatures are struck down where they stand, and the battle settles as a win.
    const E = require('./tactics_engine');
    const hook = await withTransaction(async client => {
      const bt = (await client.query(`SELECT * FROM tactics_battles WHERE id=$1 AND status='active' FOR UPDATE`, [run.board_battle_id])).rows[0];
      if (!bt) throw err(400, 'The party is not in a fight.');
      const { state } = E.replay(bt.setup, bt.actions);
      for (const u of state.units) if (u.side === 'enemy') { u.hp = 0; u.down = true; }
      state.status = 'victory';
      await client.query(`UPDATE tactics_battles SET status='victory', result=$2, ended_at=NOW(), updated_at=NOW() WHERE id=$1`, [bt.id, JSON.stringify({ ...E.resultOf(state), by: 'dev tools' })]);
      return boardResolved(client, bt, state);
    });
    const r = await afterBoard(hook);
    return { run: r.run, found: r.found, ended: r.ended };
  }
  if (!run.battle_run_id) throw err(400, 'The party is not in a fight.');
  const b = (await query('SELECT * FROM settlement_quests WHERE id=$1', [run.battle_run_id])).rows[0];
  const replay = await CR.replayBattle({
    citizenIds: run.party_ids, enemyKeys: arr(b.combat_encounter), seed: parseInt(b.combat_seed) || 1,
    actions: arr(b.combat_actions), settlementId: s.id, mods: b.combat_mods,
  });
  const battle = replay.battle;
  if (battle.status === 'defeat') throw err(400, 'That fight is already lost.');
  battle.status = 'victory';
  if (battle.reward && !battle.reward.drops) battle.reward.drops = [];
  const r = await onBattleResolved({ questRun: b, battle, settlement: s, log: (battle.log || []).concat(['(Won from Dev Tools.)']) });
  return { run: r.dungeon.run, found: r.dungeon.found, ended: r.dungeon.ended };
}

// A fresh generated dungeon of this skull and land (and seed, if given), and
// a party sent into it (Dev Tools).
async function startGenerated(userId, { tier, terrain, seed } = {}, citizenIds, opts = {}) {
  const s = (await query('SELECT * FROM settlements WHERE user_id=$1', [userId])).rows[0];
  if (!s) throw err(404, 'No settlement.');
  const ids = (citizenIds && citizenIds.length) ? citizenIds : await freeAdults(s);
  if (ids.length !== PARTY) throw err(400, `A dungeon takes a party of exactly ${PARTY} citizens, and only ${ids.length} adult${ids.length === 1 ? ' is' : 's are'} free.`);
  const d = await createGenerated({ tier, terrain, seed, source: 'test', combat: opts.combat === 'board' ? 'board' : 'cards' });
  try { return await start(userId, d.id, ids, opts); }
  catch (e) { await query('DELETE FROM dungeons WHERE id=$1', [d.id]).catch(() => {}); throw e; }
}

module.exports = {
  PARTY, CONFIG, allowed, current, start, move, pick, choose, leave, flee, onBattleResolved, boardResolved, afterBoard, touch, busyCitizenIds,
  sweep, tick, stories, startTest, freeAdults, adminWin, createGenerated, startGenerated,
  _addLoot: addLoot, _splitLoot: splitLoot, _rest: rest,
};
