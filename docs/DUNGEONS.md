# Dungeons (design spec)

Status: **design agreed 2026-11-15 (three rounds of answers), not built.** Classes, cards, creatures, events, treasure and the numbers behind the difficulty table are in `docs/DUNGEON_CONTENT.md`. To be built **after the remaining 1.0 phases** (`docs/ROADMAP_1_0.md` §5). The same file is in both repos.

## 1. What a dungeon is

A short chain of rooms that one party of citizens walks through in a single run: fights (the existing card battles), events, rests and treasure, ending in a boss. The party's wounds carry from room to room, and after every room the player chooses to press on or turn back.

Two sources, one engine:

- **Map dungeons** appear on free tiles of the world map, stay for 72 hours and are then replaced by a new one somewhere else. They are generated.
- **Quest dungeons** are started from the quest board. Some are hand-written story dungeons; some use the generator.

Rules that hold everywhere:

1. **Difficulty is shown before the party sets out**, and it is fixed per dungeon. It never scales to the player.
2. **Manual play only.** There is no auto-resolve for dungeon battles.
3. **One player controls the party.** No clan or multiplayer dungeons for now (revisit much later).
4. **The deck is drafted at the door.** Each run starts by drafting a deck from the town's unlocked cards (§3.4). The home deck is not used in dungeons.
5. **It writes back to the family.** Every run leaves chronicle lines, and events test careers and traits, so this is not "combat as a separate game" (roadmap §4).

## 2. Decisions made (2026-11-15)

| Question | Decision |
|---|---|
| Who can clear a map dungeon? | Every town that can reach it, **once per town** per dungeon. All towns see the same layout. |
| Losing a run | **All loot from the run is lost, and every citizen in the party rolls on the injury table.** |
| Deck | **Drafted on entry** from the town's unlocked cards: three random cards are shown, the player keeps one, and this repeats until the deck is full (§3.4). This replaced the earlier answer, "home deck". |
| Floors | Depends on the difficulty (§4). |
| Difficulty | Fixed per dungeon, shown as a coloured skull (§4). |
| Farming limit | Once per dungeon per town. No daily cap, no entry cost. |
| Quest dungeons | A mix of story dungeons and generated ones. |
| Clan dungeons | No, for now. |
| Party size | **Required: exactly four citizens** for every dungeon, to start with. Simulated runs one citizen short almost never clear. |
| Boss resistance to control | Depends on the boss; shown on the dungeon card (`docs/DUNGEON_CONTENT.md` §4). |
| Classes | First release: Guard, Archer, Wizard, Hearthkeeper. Each class has a building (Hearth Shrine from Village tier, Wizard's Tower from Town tier, the Watchtower for Guards and Archers); upgrading and researching it is the most direct way to unlock its cards (`docs/DUNGEON_CONTENT.md` §3.2). |
| Green difficulty | About a 90% clear rate for sensible play, not a certain win. A town always has four free adults, so green needs no tier gate. |
| Auto-resolve | Never. |
| When | After the remaining 1.0 phases. |
| Turning back | Keeps all loot; only citizens who went down roll for injury. |
| Deaths | The normal injury table applies at every skull colour, green included. |
| Blessings and curses | Yes: events can give run-only ones (§5.2). |
| Citizens who go down | They stay down but are **brought into every later fight**, so they can be healed back up (§3.1). |
| Runs at once | One per town. |
| Supplies | Yes: a party can carry items from the town's stores. An extended part of the release, tied to crafting (§8.1). |
| Deck size | Start at 12 and ramp up with the skull: 12 at green and yellow, 14 at orange and red, 16 at purple. |
| Class cards in the draft | Planned for the class release: when the party contains a class, the draft offers that class's cards, and never cards for a class that is not in the party (`docs/DUNGEON_CONTENT.md` §3.3). |
| "Not for drafts" toggle | Yes: the player can leave owned cards out of the draft pool. |
| Skipping the draft | No: the draft is always required, for now. |
| Revive strength | A healed citizen stands up with whatever was healed. No cap. |
| Supplies in battle | As in For the King: an item can be used in a fight, and it takes that citizen's turn. Between rooms items are free to use. |

## 3. A run, step by step

1. **Find it.** A map dungeon shows only on a tile the player has scouted (`fog_of_war`), and must be within range of the town (as camps are: `ASSAULT_RANGE` in `lib/raid_camps.js`).
2. **Read the card.** Skull colour, number of floors, the kind of creatures inside, the boss's outline and how well it resists control, the level the party should be, and the hours left before it goes.
3. **Choose a party of exactly four** adults who are not busy (`outpost_state.busyReason`), and pack supplies (§8.1). They are busy until the run ends. Setting out uses up the town's one attempt.
4. **Draft the deck** (§3.4).
5. **Walk there.** The party appears on the map as a journey (`lib/travel.js`). Travel is short; the dungeon is the content, not the walk.
6. **Play the rooms.** The floor is a small branching path. The player picks the next room from those connected to the current one.
7. **After each room: press on or turn back.** Turning back ends the run and keeps everything found so far.
8. **The end.** Beat the boss (cleared), turn back (left early), or lose a battle (defeat).

### 3.1 Wounds carry over

Today every battle starts each unit at full health. In a dungeon:

- A citizen's health at the end of one battle is their health at the start of the next.
- A citizen who goes down in a battle that the party wins **stays down**. They are still brought into every later fight, lying down at 0 health: they take no turn and cannot be targeted by enemies.
- **Healing a downed citizen stands them back up** with the health healed, and they act from the next round. This works from a card in battle, at a rest room, from an event or from a supply item.
- A battle is lost when no party member is standing.
- Block, buffs, debuffs and the deck's piles reset between battles. Only health and "down" carry.
- A healed citizen comes back with exactly the health that was healed: no cap.
- A citizen who went down at any point in the run rolls for injury at the end, even if they were healed back up.

Today a heal does nothing to a downed unit (`card_combat.heal` returns early), and Mend is a starter card, so every town will be able to do this. Reviving is switched on for dungeon battles only, so quest and raid battles play and replay exactly as before.

### 3.2 How a run ends

| Ending | Loot | Injuries | Dungeon for this town |
|---|---|---|---|
| **Cleared** (boss beaten) | all kept, plus the clear reward | only citizens who went down roll | done |
| **Turned back** (between rooms) | all kept (agreed) | only citizens who went down roll | done: no second attempt |
| **Defeat** (a battle lost) | **all lost** | **every citizen in the party rolls** | done |
| **Timed out** (left paused too long, §3.3) | as turned back | as turned back | done |

Injuries are rolled **once, when the run ends**, never per room. The injury table (`lib/injury_table.js`) has a 2% fatal band, so a defeat with four citizens has about an 8% chance of a death. That is the intended weight of losing, and it applies at every skull colour (agreed).

### 3.3 Leaving and coming back

The run is saved on the server after every action, as battles are now. A player can close the game mid-run and resume later.

A run that is left alone ends by itself as **turned back**:

- 24 hours after the last action, or
- when the map dungeon's 72 hours run out (a run in progress gets 2 extra hours to finish).

If the party is in the middle of a battle when this happens, the battle is forfeited as a retreat, not a defeat. Being away never costs more than the rest of the dungeon.

### 3.4 Drafting the deck

Before the party walks in, the player builds the deck for this run.

- The game shows **three different cards** drawn at random from the cards the town owns (the starter set plus every unlock, `lib/cards.ownedSet`). The player keeps one. This repeats until the deck is full.
- **Deck size: 12 picks** at green and yellow, 14 at orange and red, 16 at purple. Twelve is the current minimum deck; longer dungeons have longer fights and give class cards room. One to two minutes of choosing.
- The same card can be offered again on a later pick, so a deck can hold copies. A new town owns only the nine starter cards, and still gets real choices.
- **Two guards against a dead deck:** the first offer always includes an attack, and the second always includes a block. The player also gets **one re-roll** of an offer per draft.
- **The draft comes after the commitment.** The attempt is used up when the party sets out, so a player cannot look at the offers and back out. The offers come from a seed fixed for this town and dungeon, so reloading the page shows the same three cards.
- **Cards found inside.** Elites, treasure rooms and some events offer "keep one of three" again, adding a card to the deck for the rest of the run.
- The drafted deck lasts for the run and is then gone. The deck builder and the active home deck stay as they are for quests, camps and raids.

Things to watch:

- **Unlocking a weak card would make drafts worse**, because it joins the pool. The "not for drafts" toggle below is the answer to that.
- The draft is a step between "send" and "play". On a green dungeon it is a noticeable share of a 5–10 minute visit. It is always required, for now.

**"Not for drafts".** In the card collection, each owned card has a toggle that leaves it out of draft offers. The pool must keep at least 9 cards, with at least two attacks and two blocks, so the guards above still work.

**Classes (planned).** When combat classes arrive, some cards will need a class ("Requires Wizard"). The draft will offer class cards only for classes in the party, and one card in every offer will be a class card when the party has any. Details and the reasons are in `docs/DUNGEON_CONTENT.md` §3.3.

## 4. Difficulty

Fixed when the dungeon is created. The skull is the map icon and heads the dungeon card.

| Skull | Name | Floors | Fights | Of which | Deck | Party of four, expected level | Creatures' health / strength |
|---|---|---|---|---|---|---|---|
| 🟢 green | Easy | 1 | 3 | boss | 12 | villagers | +50% / +40% |
| 🟡 yellow | Moderate | 1 | 4 | boss | 12 | novices | +75% / +60% |
| 🟠 orange | Hard | 2 | 6 | 1 elite, boss | 14 | trained | +100% / +80% |
| 🔴 deep red | Deadly | 2 | 7 | 1 elite, boss | 14 | trained, with classes | +125% / +100% |
| 🟣 purple | Nightmare | 3 | 9 | 2 elites, boss | 16 | veterans, with classes | +175% / +140% |

These come from simulated runs on the real combat engine (`docs/DUNGEON_CONTENT.md` §5 and §6, which also give rests, events, clear rates and playing time). Two findings shape the table: today's creatures are much too weak for a party playing cards, hence the large modifiers; and a party one citizen short almost never clears, so every dungeon requires exactly four citizens.

All numbers are starting values for tuning.

- Between floors there is always a **landing**: a safe room where the player can rest once and is asked plainly whether to go deeper.
- Higher skulls use stronger enemy groups and enemy modifiers (`combat_mods`: `enemy_health`, `enemy_strength`, `enemy_agility`, which already exist and are frozen per battle).
- A green dungeon should be finishable in one 5–10 minute visit. A purple one is meant to take two or three sittings.

## 5. Rooms

| Room | What happens |
|---|---|
| ⚔ **Fight** | A card battle against a group drawn from the dungeon's creature pool. |
| 💀 **Elite** | A harder battle with a guaranteed better find. Shown on the path, so it is a choice. |
| ❓ **Event** | A situation with two or three options, written like a moment (`docs/PHASE_2_MOMENTS.md` §4). Options can test a career, trait or stat of a named party member ("Hazel, a Scholar, can read the runes"). |
| 🔥 **Rest** | Choose one: heal the party part-way, or let two party members talk (a bond, and a chronicle line). |
| 🎁 **Treasure** | Loot with no fight. Sometimes trapped (an event). |
| 👑 **Boss** | The last room. Always known in advance from the dungeon card. |

Event rooms reuse the moments definition shape (text, options, a `choose` function, a chronicle line) but not the moments table or its daily budget: they belong to the run and are answered on the spot.

### 5.1 The path

- Each floor is a grid of 3 lanes by N steps. Each step has 1–3 rooms; each room links to 1–2 rooms in the next step.
- Rules for the generator: the first room is always a fight; never two rests in a row; an elite never before step 3; at least one rest or event on every route to the boss; every route reaches the boss.
- The whole floor is visible from the start. A party with a scout career sees room contents one floor ahead.

### 5.2 Blessings and curses

An event can leave a mark that lasts until the run ends:

- A **blessing** or **curse** is a change to the party's or the enemies' stats (the existing `combat_mods` keys: `party_strength`, `party_agility`, `party_endurance`, `enemy_health`, `enemy_strength`, `enemy_agility`), or a card added to or removed from the drafted deck.
- They are listed on the path screen beside the run loot, so the player always knows what the party carries.
- Typical shape: a shrine offers a blessing at a price in health, or a curse comes with a better find.

### 5.3 Generation

Everything comes from one seed stored on the dungeon. The same seed always gives the same floors, rooms, enemy groups and events, so every town sees the same dungeon, and the server can rebuild it at any time. Battle seeds are derived from the dungeon seed, the town and the room, so two towns do not get identical card draws.

## 6. Map dungeons

### 6.1 Appearing

- A dungeon sits on a **free tile**: no town, village, outpost, camp or other dungeon (the same check `raid_camps.spawnCamps` uses).
- **Theme comes from the tile's terrain** (plains, forest, hills, mountain, river, marsh, ruins). The creature pool is the enemies whose `biomes` include that terrain.
- **Coverage, not pure chance.** The spawner aims for every town to have at least two live dungeons in range, at least one of them green or yellow. It also keeps a spread of skull colours across the world. On a small or empty world this means few dungeons; it never fills the map.
- A worker tick (every 30 minutes, like camps) retires expired dungeons and tops the world up.

### 6.2 The 72 hours

- A dungeon lives 72 hours from creation, shown as a countdown on its card.
- When it expires it is removed and the spawner places a **new** dungeon (new seed, new tile, possibly another skull). "Moving" means this: the old one goes, a new one appears elsewhere.
- Spawns are staggered so the whole map never changes at once.

### 6.3 Once per town

A row per town per dungeon records the attempt. Any ending (cleared, turned back, defeat, timed out) uses it up. The dungeon card then shows the result and stays greyed out until the dungeon leaves.

### 6.4 Time of day

Enemies already have `active_phases` and `moon_phases`. A dungeon may carry the same gates ("only opens at night", "only under a full moon"). Use sparingly, and never on a town's only reachable dungeon.

## 7. Quest dungeons

- A quest definition can point at a dungeon: either a **story dungeon** (a hand-written list of floors and rooms, with its own events and boss) or a **generator recipe** (skull, theme, seed chosen when accepted).
- Accepted from the tavern board like any party quest. The skull shows on the quest card.
- Story dungeons are done **once per town**, and can form a chain (finishing one unlocks the next quest).
- Generated quest dungeons follow the board's normal rotation.
- **Tavern rumours:** a cheap quest that reveals the tile of a live map dungeon the player has not scouted. This ties the two sources together.
- Clan quests do not get dungeons for now.

## 8. Rewards

No new resources (they are on the roadmap's freeze list). Rewards use what exists:

- Enemy `drops` and wealth from each fight, held as **run loot** until the run ends (`lib/spoils.js` grants them on a kept ending).
- Treasure rooms and elites: rare materials, and card unlocks (`lib/cards.js`).
- **Clear reward** by skull colour: a guaranteed card or rare, and at red and purple a piece of named gear good enough to become an heirloom.
- **Chronicle:** a line for each party member on a clear, on a defeat, and for notable event outcomes. First clear of a purple dungeon earns a title.
- Careers gain experience as they do from battles now.

The run-loot list is always on screen, so the "turn back and keep this, or risk it" choice is visible.

### 8.1 Supplies (extended part of the release)

A party can carry items from the town's stores into the dungeon. This is what ties dungeons to crafting.

- **Packing.** When the party is chosen, the player fills a pack: starting value **two slots per citizen**. Items leave the stores at once.
- **Using between rooms:** free, from the path screen.
- **Using in a fight:** allowed, and it **takes that citizen's turn** (as in For the King). The citizen plays no cards that turn.
- **First items** (made through the existing crafting system, from existing resources):

  | Item | Effect |
  |---|---|
  | Bandage | Heals one citizen part-way; stands a downed citizen up. |
  | Field rations | Heals the whole party a little. |
  | Tonic | A small blessing for the next battle only. |
  | Torch | Shows what is in the rooms of the next floor. |
  | Rope | Lets the party leave a trapped treasure room or a bad event without the penalty. |

- **Afterwards.** Unused items come home on a kept ending. On a defeat they are lost with the loot.
- These are new **items and recipes**, not new resources, so they stay inside the roadmap's freeze list. Later, dungeon finds can become ingredients for better supplies.

Supplies are built last (§9.6) so the core can be tuned without them first. Until they exist, rest rooms are the only healing outside battle.

## 9. How it is built

### 9.1 Data

| Table | Purpose |
|---|---|
| `dungeons` | One row per dungeon: `id`, `source` (`map` / `quest`), `q`, `r`, `terrain`, `tier`, `seed`, `story_key` (if hand-written), `created_at`, `expires_at`, time gates. |
| `dungeon_runs` | One row per town per dungeon (unique): `party_ids`, `status` (`travelling`, `active`, `cleared`, `left`, `defeat`, `timed_out`), `floor`, `room`, `path_taken`, `party_state` (health and who is down), `deck` (the drafted cards), `draft` (offers and picks so far), `effects` (blessings and curses), `pack` (supplies), `loot`, `last_action_at`. At most one unfinished run per town. |

A battle inside a run is still a `settlement_quests` row with a `combat_encounter`, seed and action log, exactly as `raid_camps.battleRun` makes one, with `auto_resolve_combat` false and a `dungeon_run_id` column. That keeps `/api/combat` and the battle screen unchanged.

### 9.2 Engine changes

- **Starting health.** `combat_resolver` takes a per-citizen starting health (and "down") from the run and freezes it with the battle's mods, so replays stay exact.
- **The run's deck.** A battle with a dungeon run uses the run's drafted deck map in place of `getActiveDeckMap`, frozen the same way.
- **Reviving.** With a `revive` flag frozen on the battle, `card_combat.heal` and ally targeting accept a downed ally, and a healed one rejoins the turn order next round. Without the flag nothing changes. Both copies of the dual-engine files change together (`lib/card_combat.js` and `js/card-combat.js`).
- **After a battle.** A hook like `raid_camps.onBattleEnded`: on victory, save health and loot to the run and return to the path; on defeat, end the run. Skip `applyBattleAftermath` per battle; the run calls it once at the end with the right list of citizens.
- **Busy.** `outpost_state.busyReason` learns "is in a dungeon".

### 9.3 API (sketch)

- `GET /api/dungeons`: live dungeons the player has discovered, with this town's result on each.
- `GET /api/dungeons/:id`: the dungeon card and the floor paths.
- `POST /api/dungeons/:id/enter` `{ citizen_ids, pack }`: start the run. Returns the first draft offer.
- `POST /api/dungeons/run/draft` `{ pick }` or `{ reroll: true }`: keep a card; returns the next offer, or the finished deck.
- `POST /api/dungeons/run/use-item` `{ item, citizen_id }`: use a supply between rooms. In a fight, an item is a battle action (`use_item`) through `/api/combat/action`, recorded in the action log so replays match; it ends the citizen's turn.
- `GET /api/dungeons/run`: the current run (for resume).
- `POST /api/dungeons/run/move` `{ room }`: enter a connected room. Returns a battle run id, an event, a rest choice or loot.
- `POST /api/dungeons/run/choose` `{ option }`: answer an event or rest.
- `POST /api/dungeons/run/leave`: turn back.

The server holds all state. The client never decides what is in a room.

### 9.4 Frontend

- Map: a skull marker on the tile (a new `kwmap-` layer beside camps), with the countdown on hover.
- The dungeon card and the path screen are built on the shared window component (`docs/LAYOUT_SPEC.md`).
- Battles open the existing battle screen and return to the path.
- Lives under **The Land** (map dungeons) and **The Road** (quest dungeons), per the five-place layout.

### 9.5 Content needed

This is the larger part of the work.

- **Creatures:** there are 11 today, and only two belong in ruins. Each terrain needs about four regular creatures, one elite and one boss: roughly 20 new entries through the existing enemy editor.
- **Events:** about 20 to start, at least a third of them with a career or trait option.
- **Story dungeons:** two or three for the first release.

### 9.6 Build order

1. Starting health carried into a battle; the run table; a fixed test dungeon of three fights played end to end.
2. The path, room types, turning back, run loot, endings and the single injury roll.
3. The generator and difficulty tiers.
4. Map dungeons: spawner, 72-hour cycle, markers, once per town.
5. The draft, and cards found inside.
6. Events, rest rooms, blessings and curses; reviving; chronicle lines.
7. Quest dungeons: story format, rumours.
8. Content and tuning.
9. Supplies and their crafting recipes (the extended part).

## 10. Tests

- Same seed gives the same dungeon; every generated path obeys the rules in §5.1 (run over a few thousand seeds).
- A replayed dungeon battle with carried health matches the stored result exactly.
- Defeat: loot is empty and every party member has an injury roll. Turning back: loot is granted and only downed citizens roll.
- A second `enter` for the same town and dungeon is refused, as is a second run while one is unfinished.
- The draft: the same town and dungeon always get the same offers; an offer never repeats a card within itself; the first offer has an attack and the second a block; a pick outside the offer is refused; the deck ends at exactly 12.
- Reviving: a heal on a downed ally stands them up in a dungeon battle and does nothing in a quest battle; old stored battles replay unchanged.
- A citizen who went down and was healed still rolls for injury at the end.
- Supplies: items leave the stores when packed, unused ones return on a kept ending, and none return on a defeat. An item used in a fight ends that citizen's turn and replays identically.
- "Not for drafts": a toggled-off card is never offered; the toggle is refused when it would leave the pool too small.
- An idle run times out as turned back, including mid-battle.
- The spawner never uses an occupied tile and gives every town an easy dungeon in range.

## 11. Open questions

The design questions are answered (§2). What remains is about content and balance and is listed in `docs/DUNGEON_CONTENT.md` §9: how the creature scaling is stored, whether weak, vulnerable and Focus change, and the costs of the class buildings.
