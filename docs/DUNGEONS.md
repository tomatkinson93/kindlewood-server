# Dungeons (design spec)

> **Combat is changing (2026-11-20).** Dungeon fights are becoming tactics battles on a board (`docs/TACTICS.md`, Phase 3). From 2026-11-21 a dungeon started from Dev Tools is fought that way by default (`dungeon_runs.combat = 'board'`); a card run is still possible. The run described here stays: the path, rooms, wounds that carry, rests, endings, loot and the generator. The parts about cards and decks are being replaced. **On the board the creatures are replaced too (2026-11-21):** nobody there is a beast on four legs; a dungeon belongs to one of five bands of foes (`lib/tactics_foes.js`, `docs/TACTICS.md` §4), and each creature named in this document has a foe that stands in its place. **Phase 3 is finished (2026-11-22):** a dungeon made for the board has fewer fights (a route has 2 to 3 at green, up to 5 to 7 at purple), a rest there gives back half, a foe leaves what it carried, and the fallen lie on the board until a heal or a rest stands them up; the numbers are in `docs/TACTICS.md` §5. **The card battles left the dungeons on 2026-11-23** (`docs/TACTICS.md` §8, step 2): every run is fought on the board; decks, the door draft, the card after a fight, honing and the Class cards window are deleted, and wherever this document describes them it describes history. The skull numbers under Dev Tools → Life → Dungeons are now the board's (each skull's foe health and foe power), and a rest gives back half.


Status: **design agreed 2026-11-15 (three rounds of answers), with a fourth round on 2026-11-18. Build steps 1 to 4 are built (§12, §13: step 4, dungeons on the map, on 2026-11-25; §14: the first-clear trophy, parties of one to four and bands that stay home; §15: the walk there and home, both on 2026-11-26); the rest is not. On 2026-11-19 the door draft (§3.4) was replaced by a deck for each citizen: `docs/DUNGEON_CLASS_DECKS.md`.** Classes, cards, creatures, events, treasure and the numbers behind the difficulty table are in `docs/DUNGEON_CONTENT.md`. The roadmap placed dungeons after the remaining 1.0 phases; the owner brought them forward on 2026-11-18. They are started from Dev Tools only and stay behind the switch `dungeons.on` until they are ready for players. The same file is in both repos.

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

Decided 2026-11-18 (the fourth round, when building started):

| Question | Decision |
|---|---|
| Leaving a fight | **A Flee button in every dungeon fight.** Fleeing ends the run: the party keeps half the run loot (half the wealth and half of each kind of item, rounded down) and everyone who went down rolls for injury. A run left idle in the middle of a fight ends the same way. This closes a hole: as first written, an idle run kept all its loot even mid-battle, so a losing fight could be waited out. |
| A citizen who went down and was stood back up | Rolls the injury table **without its fatal band** (crippling at worst). A citizen still down when the run ends, and everyone on a defeat, rolls the full table. Reviving then protects the family, not only the fight. This replaced "the full table for anyone who went down". |
| Event options that test a citizen | **The right citizen is certain.** With the career, trait or stat in the party, the option always works. Without it the option is still offered where it makes sense, with its chance shown as a percentage. No hidden rolls. |
| How the skull's scaling is stored | **One creature list, a multiplier per skull.** Creatures keep one set of stats; each skull's health and strength are tunable numbers (Dev Tools → Life → Dungeons), frozen on each battle. |
| Weak, vulnerable and Focus | **Changed everywhere, for new battles**: weak and vulnerable wear off by 1 each turn, and Focus can be played once per battle. Battles already stored replay under the old rules. Not built yet (§12). |
| Keepsakes | **Yes** (§5.2a): six to eight run-only items that change how a fight starts. Built with events (step 6). |
| Kin and bonds in a fight | **Yes** (§3.1a). Built with events (step 6). |
| Who has cleared it | **Yes**: the dungeon card shows how many towns have cleared a map dungeon and which was first (§6.3). Built with map dungeons (step 4). |
| The draft and the walk | The party sets out and the player drafts while it walks, so the walk is never dead time. |

Decided 2026-11-19 (`docs/DUNGEON_CLASS_DECKS.md`), after the owner asked players of roguelite card games:

| Question | Decision |
|---|---|
| The deck | **One deck per citizen**, from their class's base pack. This replaces the shared drafted deck, deck size by skull, the "not for drafts" toggle and the rule that set aside class cards a citizen could not play. |
| Citizens with no fighting class | A **Villager pack** with one trade card from their job, so any four adults can still enter a green dungeon. |
| At the door | Each citizen keeps **one card of three**. No draft. |
| Cards found inside | After each fight but the last, **three cards, each for a different citizen; the party keeps one**. |
| Healing | A heal is **spent until the party rests**, and a deck holds one of each healing card. Healing proved worth more than anything else when wounds carry over. |
| Where | Dungeons first; quests, camps and raids later, replacing the home deck. |
| Unlocked cards | They **widen what a citizen can be offered**, and the player ticks which of the town's cards are **prepared** (offered) and which are set aside. |
| The Wizard and Hearthkeeper | **Built now, with their buildings.** The owner lifted the 1.0 freeze on new building types for the Hearth Shrine and the Wizard's Tower. |
| Upgrading a card | **Honing** (the game's own word; a honed card is marked ✦): about a third stronger until the run ends. A rest room rests the party and hones a card; after a fight the party may hone a card in place of the one on offer. |
| The skulls | **Retuned for class decks** (§4): orange, red and purple are harder than first set, because a healer and the class cards made them too easy for the party each is meant for. |

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
- A citizen who went down at any point in the run rolls for injury at the end, even if they were healed back up. Stood back up, they roll **without the fatal band**; still down at the end, they roll the full table (decided 2026-11-18).

### 3.1a Kin and bonds in a fight (decided 2026-11-18; built with step 6)

When a citizen goes down, each partner, relative or friend of theirs in the party gets **one extra energy on their next turn**, once per battle. Sending a family together is stronger and risks more of the family at once. It needs an engine change (both copies of the dual-engine files), frozen on the battle like `revive`.

Today a heal does nothing to a downed unit (`card_combat.heal` returns early), and Mend is a starter card, so every town will be able to do this. Reviving is switched on for dungeon battles only, so quest and raid battles play and replay exactly as before.

### 3.2 How a run ends

| Ending | Loot | Injuries | Dungeon for this town |
|---|---|---|---|
| **Cleared** (boss beaten) | all kept, plus the clear reward | only citizens who went down roll | done |
| **Turned back** (between rooms) | all kept (agreed) | only citizens who went down roll | done: no second attempt |
| **Fled** (left a fight) | **half kept**: half the wealth and half of each kind of item, rounded down | only citizens who went down roll | done |
| **Defeat** (a battle lost) | **all lost** | **every citizen in the party rolls** | done |
| **Timed out** (left paused too long, §3.3) | between rooms as turned back; in a fight as fled | as turned back | done |

Injuries are rolled **once, when the run ends**, never per room. The injury table (`lib/injury_table.js`) has a 2% fatal band, so a defeat with four citizens has about an 8% chance of a death. That is the intended weight of losing, and it applies at every skull colour (agreed). A citizen who went down and was stood back up before the end rolls without that band; one still down rolls with it.

Combat skill: a won battle has a 50% chance to raise each survivor's combat skill by one. In a dungeon this is rolled **once per run**, on a kept ending, for citizens still standing, so a nine-fight dungeon does not raise it nine times. Career experience comes from every won fight, as now.

### 3.3 Leaving and coming back

The run is saved on the server after every action, as battles are now. A player can close the game mid-run and resume later.

A run that is left alone ends by itself as **turned back**:

- 24 hours after the last action, or
- when the map dungeon's 72 hours run out (a run in progress gets 2 extra hours to finish).

If the party is in the middle of a battle when this happens, the battle is forfeited as a retreat, not a defeat, **at the price of fleeing** (half the loot; decided 2026-11-18). Being away never costs more than a deliberate flee, and waiting gains nothing over fleeing. Opening the fight again or playing a card counts as an action.

### 3.4 Drafting the deck

> **Superseded on 2026-11-19 by `docs/DUNGEON_CLASS_DECKS.md`.** Every citizen now brings their own deck, built from their class's base pack (a Villager pack for a citizen with no fighting class). There is no draft: each citizen keeps one card of three at the door, and the party keeps one card of three after each fight. The rest of this section is kept as the record of the earlier design; it was never built.

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

| Skull | Name | Floors | Fights | Of which | Party of four, expected | Creatures' health / strength | Clears in simulation |
|---|---|---|---|---|---|---|---|
| 🟢 green | Easy | 1 | 3 | boss | villagers, nothing built | +50% / +40% | 94% |
| 🟡 yellow | Moderate | 1 | 4 | boss | novices: a Guard, an Archer, two villagers | +75% / +60% | 77% |
| 🟠 orange | Hard | 2 | 6 | 1 elite, boss | trained, with a Hearthkeeper | +125% / +100% | 73% |
| 🔴 deep red | Deadly | 2 | 7 | 1 elite, boss | trained, all four classes, buildings at level 2 to 3 | +150% / +105% | 38% |
| 🟣 purple | Nightmare | 3 | 9 | 2 elites, boss | veterans, all four classes, buildings at their top level | +200% / +150% | 25% |

These come from simulated runs on the real combat engine. The fights, rests, events and playing time are in `docs/DUNGEON_CONTENT.md` §5 and §6; the health and strength were **retuned on 2026-11-19 for class decks** (`docs/DUNGEON_CLASS_DECKS.md` §6.2, which also shows each skull without a healer). Before that orange was +100% / +80%, red +125% / +100% and purple +175% / +140%; the "Deck" column of the shared draft is gone. Two findings shape the table: today's creatures are much too weak for a party playing cards, hence the large modifiers; and a party one citizen short almost never clears, so every dungeon requires exactly four citizens. The simulated player uses no supplies and cannot stand a downed citizen up, so read the clear rates as a floor.

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
- Added when the generator was built (2026-11-18), so that a generated floor is always worth walking:
  - one fight at the door, then two or three rooms at every step, then one last room; links never cross;
  - **never three fights in a row** on any route (so two fights and then the boss never happens either);
  - **treasure is never the safe road:** no two treasure rooms in a row, and two at most on any route through a floor;
  - no step whose rooms are all rests or all treasure (that is no choice; rooms that are all fights still differ in who is in them);
  - an **elite is always a choice**: every room that leads to it leads somewhere else too;
  - the fights on a route through a floor are within one of the skull's figure, and never fewer than two.

### 5.2 Blessings and curses

An event can leave a mark that lasts until the run ends:

- A **blessing** or **curse** is a change to the party's or the enemies' stats (the existing `combat_mods` keys: `party_strength`, `party_agility`, `party_endurance`, `enemy_health`, `enemy_strength`, `enemy_agility`), or a card added to or removed from the drafted deck.
- They are listed on the path screen beside the run loot, so the player always knows what the party carries.
- Typical shape: a shrine offers a blessing at a price in health, or a curse comes with a better find.

### 5.2a Keepsakes (decided 2026-11-18; built with step 6)

A blessing changes a number; a keepsake changes how a fight starts, so the player notices it in play. Six to eight to begin with, found at elites and in treasure rooms, kept until the run ends and listed with the run loot. First proposals:

| Keepsake | At the start of every fight |
|---|---|
| Hearthstone | Everyone has 5 block. |
| Lucky Acorn | The first citizen to act draws one extra card. |
| Whetted Edge | Every creature starts with vulnerable 1. |
| Owl Feather | Every creature starts with weak 1. |
| Travelling Kettle | Each rest gives back 10% more. |
| Old Banner | The first card played costs no energy. |

Each needs a hook where the battle is built, frozen on the battle so replays match.

### 5.3 Generation

Everything comes from one seed stored on the dungeon. The same seed, skull and land always give the same floors, rooms, enemy groups and events, so every town sees the same dungeon. Battle seeds are derived from the dungeon seed, the town and the room, so two towns do not get identical card draws.

As built: the generator's result is **stored on the dungeon row** (`dungeons.layout`) when the dungeon is made, and read from there. Rebuilding from the seed each time would let a later edit to the creature list change a dungeon that towns are already walking through.

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

A row per town per dungeon records the attempt. Any ending (cleared, turned back, fled, defeat, timed out) uses it up. The dungeon card then shows the result and stays greyed out until the dungeon leaves.

Every town sees the same layout, so the card also shows **how many towns have cleared it and which was first** (decided 2026-11-18). The first clear is a chronicle line.

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
- `POST /api/dungeons/run/flee`: leave a fight; the run ends and half the loot is kept. `POST /api/combat/forfeit/:id` on a dungeon fight does the same.

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
4. Map dungeons: spawner, 72-hour cycle, markers, once per town. **Built 2026-11-25 (§13).**
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

- Fleeing: half the wealth and half of each kind of item is kept; only citizens who went down roll. A run idle in a fight ends the same way and never as a defeat.
- A citizen stood back up rolls without the fatal band; one still down, and everyone on a defeat, rolls the full table.

## 11. Open questions

The design questions are answered (§2). What remains is content and balance, in `docs/DUNGEON_CONTENT.md` §9: the costs of the class buildings, and the wealth a fight gives (§12 below, "Found while building").

## 12. Built so far (2026-11-19): steps 1 to 3, class decks, the two class buildings

A party of four can be sent from Dev Tools into a hand-written test dungeon, or into one the generator makes for a skull, a land and a seed, and play it to any ending, every citizen with their own deck. Nothing is offered to players yet.

**What works**

- Wounds and who is down carry from fight to fight; a downed citizen is brought along and takes no turn.
- The path: a floor of rooms by step and lane, the ways on, fights, elites, treasure, rests, a landing between floors, the boss.
- Run loot held until the end; the five endings of §3.2; the single injury roll with the two tables; the chronicle line on a clear and a defeat; a line in the town news for every ending.
- A run left idle for 24 hours ends by itself (§3.3).
- The party is busy from setting out until the run ends, between rooms too.
- **Class decks** (`docs/DUNGEON_CLASS_DECKS.md`, which has its own table of files): a deck for each citizen from their class's pack; one card of three each at the door; one of three for the party after each fight, or a hone; heals spent until the party rests; a rest room that rests and hones a card; the Class cards screen with its Prepared ticks.
- **The Wizard and Hearthkeeper** careers, and the **Hearth Shrine** and **Wizard's Tower** that open them and unlock their cards by level. Both stand in the Home scene (as the placeholder hut until they have art).
- **The generator** (step 3): a dungeon from a seed for each of the five skulls and seven lands. Floors and steps per skull as in §4; room types that obey §5.1; elites as a choice; creature groups from the land's creatures, harder the deeper the room; treasure, an elite's find and the boss chest from the land's materials.

**Where**

| Piece | File |
|---|---|
| Tables `dungeons`, `dungeon_runs`; `settlement_quests.dungeon_run_id`; the quest row `dungeon_room` | server `migrations/0NN_dungeons.sql` |
| Skulls, the two test dungeons, the path rules of §5.1 (`checkFloor`, `checkStory`) | server `lib/dungeon_defs.js` |
| The generator: `generate`, and `check` (every rule a generated dungeon must obey) | server `lib/dungeon_gen.js` |
| The run: start, move, choose, leave, flee, the battle hook, endings, the idle sweep; `createGenerated` (make and store a dungeon) | server `lib/dungeons.js` |
| Routes, and the Dev Tools routes | server `routes/dungeons.js` |
| Carried health (`mods.dungeon.start`, frozen on the battle), the no-fatal roll, the run's injuries | server `lib/combat_resolver.js` |
| A dungeon fight's resolve, forfeit and idle clock | server `routes/combat.js` |
| The path screen, and the Dev Tools tab | frontend `js/dungeons.js`, `css/dungeons.css` |
| Flee and the dungeon wording on the battle screen | frontend `js/combat-ui.js` |
| Aiming a card on the battle screen (rings, the arrow, the line that names the target) | frontend `js/combat-ui.js`, `js/card-hand-ui.js`, `css/card-hand-ui.css` |
| Tests | server `scripts/dungeons_test.js` (177 checks, through board battles), `scripts/dungeon_board_test.js` (41); frontend `verify/dungeons_proofs.js` (74), `verify/aim_proofs.js` (22) |

**How to try it:** Dev Tools → 💀 Dungeons → Start a test dungeon, or choose a skull and a land under "Generated dungeons" (give a seed to get the same dungeon again; the run's line shows its seed). The town needs four free adults. "Win the open fight" walks a path without playing every battle. The numbers (creature health and strength per skull, rest healing, the share kept when fleeing, idle hours) are under Dev Tools → 👪 Life → Dungeons.

**How it differs from §9**

- Carried health needed **no engine change**: the resolver builds the party's units with their starting health before the battle is created, so `lib/combat_engine.js` and its frontend copy are untouched. Reviving in battle (step 6) will change both.
- The two test dungeons are written in the story format of §7 (a list of floors of rooms), so story dungeons already have their shape. A landing is a room, the last of every floor but the deepest.
- A test dungeon is a fresh `dungeons` row each time, so it can be played again; "once per town" is enforced per row.
- Statuses: `active`, `cleared`, `left`, `fled`, `defeat`, `timed_out`. `travelling` arrives with map dungeons.

**What the generator makes, per skull** (2,500 seeds in the tests, 35,000 while building: every one obeys the rules, with no fallback layout):

| Skull | Floors | Steps a floor | Elites | Fights on a way through, boss included (the table in §4) |
|---|---|---|---|---|
| 🟢 green | 1 | 5 | 0 | 3 or 4 (3) |
| 🟡 yellow | 1 | 7 | 0 | 3 to 5 (4) |
| 🟠 orange | 2 | 5 or 6 | 1 | 5 to 8 (6) |
| 🔴 red | 2 | 6 or 7 | 1 | 5 to 9 (7) |
| 🟣 purple | 3 | 5 or 6 | 2, on different floors | 7 to 12 (9) |

The spread is the player's choice of route: a floor's routes hold one fewer or one more fight than the figure, and taking an elite is one of them.

**Not built, in order:** map dungeons and "who has cleared it" (4), events, keepsakes, kin and bonds and reviving in battle (6), quest dungeons (7), content and tuning (8), supplies (9). Step 5 (the draft, and cards found inside) is done, as class decks. The rule changes to weak, vulnerable and Focus are their own piece of work: they touch both engine copies and every kind of battle.

**Found while building**

1. **The wealth from fights does not match the budget.** §8 says a fight gives its usual wealth (8 × reward weight) times the skull's health modifier; `DUNGEON_CONTENT.md` §8.2 budgets 40 wealth from all of a green dungeon's fights. Three green fights at the usual rate give about 200. The build uses a share per skull (`TIERS[…].wealth` in `lib/dungeon_defs.js`: 0.2 at green to 0.4 at purple), which lands near the budget. To be settled in tuning.
2. **On a database with no card rows, cards do nothing in a server battle.** The code-defined fallback cards read `this.scaling`, which the dispatcher in `card_combat.js` does not bind, so every play is a silent no-op. The live game has card rows, so it is not affected; a fresh install or test database is. The class cards are now written to the table at start-up, so dungeons are not affected either; quests on a fresh install or test database still are. Fixing it means changing both engine copies.
3. **The test bosses are stand-ins**: a boosted Hill Ogre and company, from today's eleven creatures. Three of those creatures still have no move list, so block does nothing against them (`DUNGEON_CONTENT.md` §2 row 3); the test dungeons avoid them.
4. **A citizen who dies of old age during a paused run** would still be brought into its fights. The 24-hour idle limit keeps this rare; the run should drop them when map dungeons make runs longer.
5. **Generated dungeons are thin until the content exists** (step 8). No land has an elite or a boss, so its strongest creature stands in with a boost (`standin: true` on the room); when a creature carries `rank: 'elite'` or `'boss'` the generator uses it as it is (there is a test for this, but `enemy_definitions` has no `rank` column yet: rank is read from health). Lands are short of creatures: forest has no heavy, hills has one heavy and no minion, so the same groups come round often.
6. **Event rooms are treasure for now.** The generator has their place; until step 6 builds events it puts treasure there, which is why the route rules keep treasure scarce.
7. **Some of the plan's reward items may not be in a database.** Leather armour, the hunter's dagger and cloak, dragonscale armour, beast horn and dragon tooth are defined in `item_seed.js`, which nothing loads by itself (`seedItemTemplates` has no caller). The generator prefers them and, where the database lacks one, gives the next on its list (an item the migrations create), so a dungeon never promises something that is missing when it is paid. Boss trophies, named gear, cards and titles come with their own steps.
8. **The two-click cards.** On a desktop that reports itself as touch-only (`(hover: none)`: a touch screen, some browsers), every card needed a first click only to lift it, so "click a card, then a creature" did nothing. The hand now follows the pointer in use (`js/card-hand-ui.js` `_isTouchInput`). A card played on oneself still takes a second click by design; its prompt now says so.
9. **Honing in place of a rest is a trap.** The first build of honing offered "rest, or hone a card". Simulated, honing cost 15 to 20 points of clear rate at every skull, because a rest heals the whole party. A rest now hones as well, and the choice is after a fight: a new card, or a hone (`DUNGEON_CLASS_DECKS.md` §4.2 and §6.4).
10. **A citizen with no cards left was handed someone else's hand.** With every heal spent, a deck can be empty; the battle then left that citizen out of its decks. Every citizen now has a deck of their own, even an empty one.
11. **Weak and vulnerable still do not wear off.** The simulator assumes the agreed rule (they drop by 1 each turn); the game does not do it yet, so Mark, Shove and Chill last longer in play than in the numbers. It is the next rule change to make, in both engine copies.

## 13. Built 2026-11-25: step 4, dungeons on the map

Dungeons are in the game itself now, not only in Dev Tools. `dungeons.on` is on by default (there are no players to gate: `TACTICS.md`, status).

**What a player does.** A skull appears on the map near the town, ringed in its colour, and the town's news says "Word has reached the town of a dungeon nearby". Clicking the tile shows the dungeon's card (name, skull, floors, which band lives there, who it is written for, how long it has left, which town cleared it first) and four pickers; **Send them in** opens the path screen at the door. The Land → **Dungeons** lists every dungeon the town knows, nearest first, each with a button that centres the map on it. While the party is inside the ring is gold; once the town has had its go the skull is faint and the card says how it went.

**The rules as built** (`lib/dungeon_map.js`; numbers at the top of the file).

| Rule | Value | Note |
|---|---|---|
| How long a dungeon stays | 72 hours, give or take 4 | so the map never changes all at once (§6.2) |
| Dungeons each town has within reach | 2, one of them green or yellow | the top-up runs every 30 minutes (§6.1) |
| Where a new one is put | a free tile 2 to 6 tiles from the town it is for | no town, village, outpost, camp or other dungeon; its land is the tile's |
| How far a party walks | 8 tiles | the same as a camp assault |
| Which skull | green 30, yellow 26, orange 20, red 14, purple 10 (weights) | after the town's easy one is in place |
| A party inside when the dungeon goes | 2 hours to finish, then it comes home with what it found | `dungeons.sweep` |
| Attempts | one per town per dungeon, any ending | as §6.3 |

**Four things differ from §6, on purpose.**

1. **A town is told; it does not have to scout.** §6 left "how is a dungeon found" open, and the first build used the fog of war, as camps do. Tried, a town could have its two dungeons sitting unseen four tiles away. So word of a dungeon reaches every town near enough to walk there: its tile is lit on that town's map and its news says so, once (`dungeon_sightings`). A town founded later hears of the ones already there. Scouting still finds dungeons further off; they show as too far to walk.
2. ~~**The walk there is not played.**~~ Built on 2026-11-26: §15.
3. **No two dungeons a town can see share a name**, and there are twelve names a land now, not six.
4. **Time-of-day gates (§6.4) are not built.** Nothing has asked for them yet.

**Where it lives.** Server: `lib/dungeon_map.js` (`spawn`, `tell`, `listFor`, `card`, `enter`, `tileMap`, `tick` from the quest worker); `routes/dungeons.js` (`GET /api/dungeons`, `GET /api/dungeons/:id`, `POST /api/dungeons/:id/enter`, `POST /api/dungeons/admin/map`); `routes/map.js` puts `dungeon` on the tile; `lib/dungeons.js` marks the first clear and gives a party the two hours. Browser: `js/kwmap-dungeons.js` (the skull), `js/dungeons.js` (`tileHtml`, `wireTile`, `listOpen`, `onEvent`), a line each in `js/main.js`, `js/kwmap-core.js`, `js/places.js`, `js/realtime.js`. Dev Tools → 💀 Dungeons has **Top the map up now** and **Clear them all and make new ones**. Tests: `scripts/dungeon_map_test.js` (38), `verify/dungeons_proofs.js` §12.

**Found on the way.**

- A boss was worded "an Old Greyfeather grown great and old" on the path screen. A real boss goes by its own name now; only a lesser creature standing in for one is "grown great and old".
- A dungeon's band and its boss could disagree (a forest dungeon of the Redtooth Brigands ended with Old Greyfeather). Settled on 2026-11-26: §14.

**Next for dungeons:** something met on the road (§15); quest dungeons (step 7); events and blessings (step 6, parts of which the card removal took out).

## 14. Built 2026-11-26: the first-clear trophy, smaller parties, bands that stay home

Three decisions the owner made on 2026-11-26, all built.

### 14.1 The first town to clear a dungeon wins a trophy

A map dungeon is every nearby town's. The first to clear it takes a **trophy from its boss** home, and a little wealth. Later towns win the dungeon's ordinary loot as before: the trophy is for the race.

- **One trophy for each boss, on a mount for the skull it was won at.** Seven bosses, five mounts: a full hall is 35.

| Boss (land) | Trophy | | Skull | Mount | Wealth |
|---|---|---|---|---|---|
| Redtooth (plains) | Redtooth's Crown | | Green | oak | 40 |
| Old Greyfeather (forest) | Greyfeather's Pinion | | Yellow | copper | 70 |
| Grum (hills) | Grum's Tusk | | Orange | bronze | 110 |
| The Storm Matriarch (mountain) | The Matriarch's Talon | | Red | silver | 160 |
| Old Snapjaw (river) | Snapjaw's Shell-plate | | Purple | gold | 240 |
| The Bog Mother (marsh) | The Bog Mother's Lantern | | | | |
| The Hollow King (ruins) | The Hollow King's Circlet | | | | |

- **It is not an item.** It hangs in the town's **trophy hall** and cannot be sold, traded or lost. A town can win the same one twice; the hall counts them.
- **Where it shows.** A dungeon nobody has cleared says on its card what the first town wins ("The first wins Greyfeather's Pinion, on silver (+160 wealth)"). The run's last screen shows the trophy. The hall is at the foot of The Land → Dungeons: "3 of 35". The town's news says so, and **every other town that knew of the dungeon is told who got there first**.
- **One a dungeon.** A unique row decides a tie.
- **Shown to others (built the same day):** every town's panel on the map says "🏆 N dungeon trophies", and Rankings has a **Dungeon Trophies** board (trophies, then kinds).
- **Not built:** looking inside another town's hall, a title for a purple first clear (§8).
- **"Keepsake" is taken** (§5.2a: something found on a run that changes how its fights start), so this is a trophy.

Code: `lib/dungeon_trophies.js` (`TROPHIES`, `MOUNTS`, `prize`, `award`, `hall`), table `dungeon_trophies`, `lib/dungeons.js` `afterEnd`, `prize` and `hall` in `lib/dungeon_map.js`; `js/dungeons.js` (`hallHtml`, the end screen, the card's line).

### 14.2 A party is one to four

A small town is never locked out. The dungeon does not shrink for a smaller party, so fewer is harder, and the card says so: with fewer than four chosen, **Send them in** asks once more first. Dev Tools starts a test dungeon with as many free adults as there are, up to four.

### 14.3 Bands stay home

A dungeon's band is now chosen only among bands that have **their own boss in that land** (`castFor` in `lib/tactics_foes.js`). With today's cast that is exactly one band a land:

| Land | Band | Boss |
|---|---|---|
| Plains | The Redtooth Brigands | Redtooth |
| Forest | The Night Pack | Old Greyfeather |
| Hills, mountain | The Crag Reavers | Grum; the Storm Matriarch |
| River, marsh | The Mire Folk | Old Snapjaw; the Bog Mother |
| Ruins | The Withered | The Hollow King |

**The cost, said plainly:** dungeons in a land are now always the same band. Brigands in the forest and hills, the Pack in the hills and mountains, and the Withered in the forest and marsh still turn up on quests, but never run a dungeon there. Variety comes back the day a band gets a second boss: give the Brigands a forest boss and forest dungeons are two bands again, with no code change.

## 15. Built 2026-11-26: the walk there and home

Decided by the owner on 2026-11-26: half a minute a tile, the party walks home too, and what it carries reaches the town when it arrives.

**What a player sees.** **Send them in** no longer puts the party at the door. It sets out on foot: the dungeon's window shows "On the road: they reach the door in 1:32" with **Call them back**, the map draws the party walking from the town to the skull (the travel layer, with the other journeys), and the skull's ring is gold. At the door the path screen takes over. When the run ends, however it ends, the last screen says "Walking home: back in 2:10. What they carry reaches your stores when they arrive", and the map draws them coming back. The four are busy from setting out until they are home.

| Rule | Value |
|---|---|
| Pace | 30 seconds a tile, each way (`DUNGEON_WALK_SECS`, Dev Tools → Life → Dungeons; 0 turns the walk off). A dungeon is 2 to 8 tiles off, so 1 to 4 minutes. |
| On the road there | Status `travelling`. Nothing can be done in the dungeon. The party can be **called back**: it walks home for as long as it had walked, and the dungeon is **not** used up. |
| At the door | The run is as before. It cannot be called back any more: turning back at the door is an ending, and uses the town's go. |
| On the road home | The run has its ending (cleared, left, fled, defeat, timed out). The loot, the wealth, the trophy's wealth, the town's news line and the chronicle are held until arrival. Injuries and combat skill are settled at the ending, so the last screen can show them. |
| The race | The **trophy is won at the moment of the clear**, not on getting home, and the other towns are told then. It goes on the wall, and its wealth into the treasury, when the party is home. |
| While walking home | The town may send another party (other citizens) to another dungeon. |
| A test or Dev Tools dungeon | No walk: it is not on the map. |
| Who sees a party on the road | Its own town, and **its clanmates** (the owner, 2026-11-26): they see "A party from <town>" walking to or from the dungeon. No other town does. |

**Why the nearer town should win a tie.** With a walk, distance is a real head start in the race for the trophy, which is the point of putting dungeons at different distances from different towns.

**Where it lives.** `lib/dungeons.js`: `walkSecs`, `start` (status `travelling`, `arrives_at`), `arrivals` (each pass of the quest worker, and whenever the town's screen asks), `finishTx` (holds what is kept in `owed`, sets `home_at`), `settle` (pays it out, once), `recall`. Columns `arrives_at`, `home_at`, `walk_secs`, `owed` on `dungeon_runs`. `lib/travel.js` `dungeonJourneys` puts the party on the map. Routes: `POST /api/dungeons/run/recall`, `POST /api/dungeons/admin/arrive` (Dev Tools: **Finish the walk now**). Browser: `js/dungeons.js` (`travelHtml`, the countdown, `mapAgain`), `js/kwmap-travel.js` (the party's card opens the dungeon), live events `dungeon_arrived` and `dungeon_home`.

**Found on the way.** Citizens in a dungeon were still offered in the map's pickers (a camp's, an outpost's, a dungeon's); the server refused them, but they should not have been listed. They are left out now.

**Not built, and the obvious next step:** something met on the road. A party walking home loaded with loot is exactly what a brigand ambush, or a neighbour's patrol, is for.
