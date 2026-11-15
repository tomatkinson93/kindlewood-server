# Dungeons (design spec)

Status: **design agreed 2026-11-15, not built.** To be built **after the remaining 1.0 phases** (`docs/ROADMAP_1_0.md` §5). The same file is in both repos.

## 1. What a dungeon is

A short chain of rooms that one party of citizens walks through in a single run: fights (the existing card battles), events, rests and treasure, ending in a boss. The party's wounds carry from room to room, and after every room the player chooses to press on or turn back.

Two sources, one engine:

- **Map dungeons** appear on free tiles of the world map, stay for 72 hours and are then replaced by a new one somewhere else. They are generated.
- **Quest dungeons** are started from the quest board. Some are hand-written story dungeons; some use the generator.

Rules that hold everywhere:

1. **Difficulty is shown before the party sets out**, and it is fixed per dungeon. It never scales to the player.
2. **Manual play only.** There is no auto-resolve for dungeon battles.
3. **One player controls the party.** No clan or multiplayer dungeons for now (revisit much later).
4. **The home deck is used as it is.** No card drafting during a run.
5. **It writes back to the family.** Every run leaves chronicle lines, and events test careers and traits, so this is not "combat as a separate game" (roadmap §4).

## 2. Decisions made (2026-11-15)

| Question | Decision |
|---|---|
| Who can clear a map dungeon? | Every town that can reach it, **once per town** per dungeon. All towns see the same layout. |
| Losing a run | **All loot from the run is lost, and every citizen in the party rolls on the injury table.** |
| Deck | The town's active deck. |
| Floors | Depends on the difficulty (§4). |
| Difficulty | Fixed per dungeon, shown as a coloured skull (§4). |
| Farming limit | Once per dungeon per town. No daily cap, no entry cost. |
| Quest dungeons | A mix of story dungeons and generated ones. |
| Clan dungeons | No, for now. |
| Auto-resolve | Never. |
| When | After the remaining 1.0 phases. |

## 3. A run, step by step

1. **Find it.** A map dungeon shows only on a tile the player has scouted (`fog_of_war`), and must be within range of the town (as camps are: `ASSAULT_RANGE` in `lib/raid_camps.js`).
2. **Read the card.** Skull colour, number of floors, the kind of creatures inside, the boss's outline, the suggested party size, and the hours left before it goes.
3. **Choose a party** of 1–4 adults who are not busy (`outpost_state.busyReason`). They are busy until the run ends.
4. **Walk there.** The party appears on the map as a journey (`lib/travel.js`). Travel is short; the dungeon is the content, not the walk.
5. **Play the rooms.** The floor is a small branching path. The player picks the next room from those connected to the current one.
6. **After each room: press on or turn back.** Turning back ends the run and keeps everything found so far.
7. **The end.** Beat the boss (cleared), turn back (left early), or lose a battle (defeat).

### 3.1 Wounds carry over

Today every battle starts each unit at full health. In a dungeon:

- A citizen's health at the end of one battle is their health at the start of the next.
- A citizen who goes down in a battle that the party wins stays **out for the rest of the run**. The party fights on without them.
- Block, buffs, debuffs and the deck's piles reset between battles. Only health and "out" carry.
- Rest rooms and some events restore health.

### 3.2 How a run ends

| Ending | Loot | Injuries | Dungeon for this town |
|---|---|---|---|
| **Cleared** (boss beaten) | all kept, plus the clear reward | only citizens who went down roll | done |
| **Turned back** (between rooms) | all kept | only citizens who went down roll | done: no second attempt |
| **Defeat** (a battle lost) | **all lost** | **every citizen in the party rolls** | done |
| **Timed out** (left paused too long, §3.3) | as turned back | as turned back | done |

Injuries are rolled **once, when the run ends**, never per room. The injury table (`lib/injury_table.js`) has a 2% fatal band, so a defeat with four citizens has about an 8% chance of a death. That is the intended weight of losing; see open question 1.

### 3.3 Leaving and coming back

The run is saved on the server after every action, as battles are now. A player can close the game mid-run and resume later.

A run that is left alone ends by itself as **turned back**:

- 24 hours after the last action, or
- when the map dungeon's 72 hours run out (a run in progress gets 2 extra hours to finish).

If the party is in the middle of a battle when this happens, the battle is forfeited as a retreat, not a defeat. Being away never costs more than the rest of the dungeon.

## 4. Difficulty

Fixed when the dungeon is created. The skull is the map icon and heads the dungeon card.

| Skull | Name | Floors | Rooms per floor | Fights (about) | Suggested party |
|---|---|---|---|---|---|
| 🟢 green | Easy | 1 | 5 | 2 + boss | 1–2 |
| 🟡 yellow | Moderate | 1 | 7 | 3 + boss | 2–3 |
| 🟠 orange | Hard | 2 | 6 | 5 + boss | 3–4 |
| 🔴 deep red | Deadly | 2 | 7 | 6 + elite + boss | 4 |
| 🟣 purple | Nightmare | 3 | 7 | 8 + 2 elites + boss | 4, well geared |

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

### 5.2 Generation

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

## 9. How it is built

### 9.1 Data

| Table | Purpose |
|---|---|
| `dungeons` | One row per dungeon: `id`, `source` (`map` / `quest`), `q`, `r`, `terrain`, `tier`, `seed`, `story_key` (if hand-written), `created_at`, `expires_at`, time gates. |
| `dungeon_runs` | One row per town per dungeon (unique): `party_ids`, `status` (`travelling`, `active`, `cleared`, `left`, `defeat`, `timed_out`), `floor`, `room`, `path_taken`, `party_state` (health and who is out), `loot`, `last_action_at`. |

A battle inside a run is still a `settlement_quests` row with a `combat_encounter`, seed and action log, exactly as `raid_camps.battleRun` makes one, with `auto_resolve_combat` false and a `dungeon_run_id` column. That keeps `/api/combat` and the battle screen unchanged.

### 9.2 Engine changes

- **Starting health.** `combat_resolver` takes a per-citizen starting health (and "out") from the run and freezes it with the battle's mods, so replays stay exact. This is the only change inside combat.
- **After a battle.** A hook like `raid_camps.onBattleEnded`: on victory, save health and loot to the run and return to the path; on defeat, end the run. Skip `applyBattleAftermath` per battle; the run calls it once at the end with the right list of citizens.
- **Busy.** `outpost_state.busyReason` learns "is in a dungeon".

### 9.3 API (sketch)

- `GET /api/dungeons`: live dungeons the player has discovered, with this town's result on each.
- `GET /api/dungeons/:id`: the dungeon card and the floor paths.
- `POST /api/dungeons/:id/enter` `{ citizen_ids }`: start the run.
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
5. Events and rest rooms; chronicle lines.
6. Quest dungeons: story format, rumours.
7. Content and tuning.

## 10. Tests

- Same seed gives the same dungeon; every generated path obeys the rules in §5.1 (run over a few thousand seeds).
- A replayed dungeon battle with carried health matches the stored result exactly.
- Defeat: loot is empty and every party member has an injury roll. Turning back: loot is granted and only downed citizens roll.
- A second `enter` for the same town and dungeon is refused.
- An idle run times out as turned back, including mid-battle.
- The spawner never uses an occupied tile and gives every town an easy dungeon in range.

## 11. Open questions

1. **Turning back.** This spec lets a party turn back between rooms and keep its loot, with injuries only for those who went down. The decision recorded was about *losing*. Is keeping loot on a retreat right, or should a retreat cost something (say, half the loot)?
2. **Deaths.** A four-citizen defeat carries about an 8% chance that someone dies. Keep the normal table, or cap dungeon injuries below fatal on green and yellow dungeons?
3. **Blessings.** "Home deck" rules out drafting. Should events still be able to give a run-only stat blessing or curse (cheap: it rides on `combat_mods`), or nothing at all that changes battles?
4. **Out for the run.** A downed citizen sits out the rest of the run. The alternative is that they stand back up on 1 health in the next battle.
5. **Supplies.** Should a party be able to carry food or bandages from the town's stores to heal between rooms? It would tie dungeons to the economy; it also adds a screen. Suggested: not in the first release.
6. **How many at once.** One run at a time per town, or one per party?
