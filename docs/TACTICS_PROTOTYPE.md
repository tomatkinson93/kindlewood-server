# Tactics battles: a prototype

Status: **a prototype, built 2026-11-20, behind Dev Tools. It replaces nothing.** Card battles, class decks and dungeons are as they were. The same file is in both repos.

## 1. Why this exists

On 2026-11-20 the owner said he was leaning towards moving all combat away from cards and into a tactical battle on a board, in the manner of Final Fantasy Tactics: a childhood favourite, and this is a personal project, so the extra time is not a worry.

The pushback at the time, for the record: such battles run long, a height map is hard to read on a phone, combat sits under quests, camps, raids and dungeons, and it would be the third combat design in a week. The owner's answers: small maps keep a battle to about five minutes; Final Fantasy Tactics Advance ran on a 240 × 160 screen; and it should be tried behind Dev Tools before anything is decided.

So this is that trial: **one real battle, playable on a desktop and a phone, using the town's own citizens and the game's own classes and creatures.** Nothing is saved, paid or lost.

**What is parked until the owner has played it** (all of it is wasted if cards go): the rule change to weak, vulnerable and Focus in the card engine; the full-screen draft scene with floating cards; renaming honing to Enhance and previewing it; a floor on prepared cards; the player's way into dungeons.

## 2. How to try it

Dev Tools → 💀 Dungeons → **Tactics battle (prototype)**, at the bottom.

- **A class for each of the four** (front left, front right, back left, back right): Guard, Archer, Wizard, Hearthkeeper or Villager. Any citizen can be tried as any class.
- **Their level**: what the skull expects (villagers at green, novices at yellow, trained at orange and red, veterans at purple), one of those four by name, or the citizens as they really are (their own stats and gear).
- **Skull, land, seed**: as for generated dungeons. The same three always give the same field and the same creatures.
- **Against**: an ordinary fight, the hardest fight, or the boss of the dungeon the generator makes for that skull, land and seed.

It uses the first four grown-up citizens who are free. What was chosen is remembered for next time.

## 3. The rules

The board is 8 × 8 tiles, each with a height and a kind of ground. Units act one at a time, quickest first.

| | |
|---|---|
| **A turn** | Move once and act once, in either order. "Quick" abilities (Mark, Embolden) do not use up the action. A move can be taken back until the unit does something else. With both done the turn ends by itself. |
| **Moving** | Up to the unit's Move in steps, no diagonals. A step climbs at most the unit's Jump and drops at most Jump + 1. Not through foes, water, trees or rocks; past a friend, but not onto their tile. |
| **Reach** | Counted in steps. A melee blow needs the target on the next tile and within one level. A bow cannot shoot the tile beside it. |
| **Height** | A ranged attack reaches one tile further for each level it stands above its target (two at most). A hit from higher ground does 15% more. |
| **Facing** | A hit from the side does a quarter more, from behind half as much again. A unit ends its turn facing the nearest foe; the arrowhead at its feet shows which way. |
| **Block** | Soaks damage until the start of the bearer's next turn. Armour turns half its class from every hit first. |
| **Weak, vulnerable, slow** | Weak: deals that much less. Vulnerable: takes that much more. Slowed: one step less. Each drops by one at the start of the bearer's turn (the rule agreed for cards on 2026-11-18 and not yet built there). |
| **Cooldowns** | A stronger ability is not ready every turn: "ready in 2". Healing has uses per battle instead. |
| **Shapes** | One target; down a row (Piercing Arrow, weaker each hit); a tile and those beside it (Ember Burst); everyone near the user (Steady Now). Abilities never hurt friends. |
| **Ending** | Every creature down, or every citizen down. |

Deliberately left out of the trial: charge times and magic points, friendly fire, line of sight, misses, choosing a facing by hand, placing the party before the fight, standing a downed citizen up.

### On screen

- The board is drawn at an angle, with the party as their villager sprites and creatures as their icons. **⟲ ⟳ turn the view a quarter** (Q and R): a hill in front hides what stands behind it, and turning is how this kind of game answers that.
- Blue tiles: where the unit can walk. Choosing an ability marks who it can reach.
- **With a mouse** a click acts at once, and hovering shows what it would do. **On a touch screen** the first tap shows what it would do and a second tap, or Confirm, does it.
- Tapping a creature shows its moves and, in red, where it can walk this turn.
- Keys: arrows move the cursor, Enter chooses, Escape cancels, 1 to 5 choose an ability, E ends the turn.
- The end screen gives rounds, the player's turns and the time taken, which is the number to watch.

## 4. What carries over from what is built

- **The classes are the same, and so are their abilities.** Every ability is a class card (`lib/class_cards.js`) and takes its numbers from that card's formula with the citizen's own stats: a trained Guard's Strike is 16 here as it is there. The board only adds how far each reaches, its shape, and how often it can be used.

| Class | Move / Jump | Kit (reach; "every Nth turn" from its cooldown) |
|---|---|---|
| Guard | 3 / 1 | Strike (1) · Shield Up (self, every 2nd) · Cover (a friend within 2, every 2nd) · Shove (1, pushes back, weak; every 3rd) · Heavy Blow (1, every 4th) |
| Archer | 3 / 2 | Shoot (2 to 5) · Sidestep (self, every 2nd) · Parting Shot (1 to 3, then steps back; every 3rd) · Piercing Arrow (down a row to 5, every 4th) · Mark (1 to 5, quick; every 3rd) |
| Wizard | 3 / 1 | Spark (1 to 4) · Ward (anyone within 3, every 2nd) · Firebolt (1 to 4, every 2nd) · Ember Burst (1 to 4, and those beside; every 4th) · Chill (1 to 4, slow and weak; every 3rd) |
| Hearthkeeper | 3 / 1 | Cinder (1 to 3) · Hearth Ward (anyone within 3, every 2nd) · Kindle (heal within 3, twice a battle) · Steady Now (every friend within 2, every 3rd) · Embolden (a friend within 3, quick; every 3rd) |
| Villager | 3 / 1 | Swing (1) · Duck (self, every 2nd) · their trade card |

- **The creatures are the same**, with their own moves; the board adds a Move for each (a Mountain Harpy flies five tiles and three levels; a Hill Ogre trudges two) and a reach for the few that strike from afar.
- **The playtest levels** are the simulator's.
- **Not the skull numbers.** One action a turn is not three cards a turn, so creature health and strength for the board are their own table (`TIERS` in `lib/tactics_setup.js`).

## 5. First numbers

From `scripts/tactics_sim.js`: the engine's own mind plays both sides, 140 battles a line. "Your turns" is what a player decides; at about 12 seconds each, 25 turns is five minutes.

| Skull (creature health / strength) | Party | Ordinary fight: your turns · health lost | Hardest fight | Boss: wins · your turns · health lost |
|---|---|---|---|---|
| 🟢 Green (+40% / +10%) | 4 villagers | 19 · 30% | 19 · 34% | 92% · 29 · 63% |
| 🟡 Yellow (+80% / +30%) | guard, archer, 2 villagers | 15 · 23% | 17 · 32% | 99% · 22 · 44% |
| 🟠 Orange (+140% / +60%) | guard, hearthkeeper, 2 archers | 18 · 29% | 18 · 26% | 99% · 19 · 30% |
| 🔴 Red (+180% / +80%) | all four classes | 17 · 25% | 21 · 44% | 91% · 23 · 44% |
| 🟣 Purple (+240% / +100%) | all four classes | 18 · 23% | 21 · 34% | 94% · 23 · 42% |

So a battle is about four to six minutes for a player at the bot's pace, a little longer with thought. These are first values for one battle, not for a run of them: nothing here has been tuned against wounds carrying from room to room.

**What follows if this is kept.** A purple dungeon has nine fights; at five minutes each that is three quarters of an hour of battles. Dungeons would want fewer, larger fights, or shorter ones.

## 6. How to judge it

Agreed before building: it is worth pursuing if a battle is **about five minutes**, **readable and playable on a phone**, and **the owner prefers it** to the card battle of the same encounter.

Worth watching while playing:

- Is turning the view an irritation or a pleasure?
- Does one action a turn feel like enough, or thin, next to three cards?
- Do the classes feel different on a board? (The Archer's minimum range and the Guard's Shove are the two that change most.)
- On a phone: are the taps reliable, and is two taps to confirm right?
- Do the creatures do anything interesting, or only walk up and bite?

## 7. Where it is

| Piece | File |
|---|---|
| The rules: map, turns, moving, reach, facing, height, abilities, the creatures' mind | frontend `js/tactics-engine.js` |
| The screen: the board, taps and keys, animation, the Dev Tools box | frontend `js/tactics.js`, `css/tactics.css` |
| The two sides: kits, levels, creatures, the board's skull numbers | server `lib/tactics_setup.js` |
| Routes (admins only) | server `routes/tactics.js` |
| Numbers | server `scripts/tactics_sim.js` |
| Tests | frontend `verify/tactics_proofs.js` (55 checks), server `scripts/tactics_test.js` (21) |

- **The engine is pure**: no clock, no `Math.random`, no DOM. A battle is a plain object changed only by `move`, `use` and `endTurn`, and the same seed and choices always give the same battle. That is deliberate: it is what a server replay needs.
- **Today the battle runs in the browser only.** The server says who is on the board and nothing more. That is right for a trial and wrong for the game: a real version replays the player's choices on the server, as card battles do.
- Class names in the stylesheet start `kwtc-` (`kwt-` belongs to travel).

## 8. What adopting it would take

In rough order, should the owner choose it:

1. **Server authority.** Run the same engine on the server from a log of choices (the card battles' pattern), and store the battle.
2. **Into the dungeon run.** Starting health carried in (the engine already takes it), healing limited across a run, and what replaces the door pick, the card after a fight and enhancing: most likely abilities learned or improved.
3. **What the class buildings unlock.** Today, cards by level; on a board, abilities.
4. **The home deck, the card collection and card drops.** Kept for quests and raids, or retired. This is the largest question and the owner's to answer.
5. **Quests, camps and raids.** The same board, or a quicker resolution.
6. **Art.** Creature sprites with facing; one species has villager sprites today, so every party is drawn as mice.
7. **Tuning for runs**, and the dungeon's length (§5).
