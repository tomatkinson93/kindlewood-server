# Tactics battles

Status: **chosen by the owner on 2026-11-20 as the game's combat.** One battle is playable from Dev Tools; nothing else uses it yet. Card battles still run quests, camps, raids and dungeons until the phases in §9 replace them. The same file is in both repos. What art, sound and music it needs is in `docs/TACTICS_ASSETS.md`.

## 1. The decision

The owner had been leaning towards a tactical battle on a board, in the manner of Final Fantasy Tactics, and asked for a trial behind Dev Tools. After playing it on a phone (2026-11-20): "just what I was looking for", "a lot more fun and interactive than our card battler", "fits better with our villager class system".

So:

- **Combat moves to the board**, everywhere, in time.
- **Cards are retired** (§8). In their place **citizens learn abilities**: by levelling in a class, by training and study, through research, and from equipment (§6).
- What was parked for cards is **cancelled**: the weak/vulnerable/Focus change to the card engine, the draft scene, Enhance for cards, a floor on prepared cards. Two of those ideas carry over in another form: a citizen readies some of the abilities they know (§6), and abilities improve with use.

The earlier objections, for the record, and what answered them: battles of this kind run long (small maps keep one to about five minutes); a height map is hard on a phone (Final Fantasy Tactics Advance ran on 240 × 160; the view turns, and now zooms); it is a large rebuild (it is a personal project and the owner is happy to take the time).

## 2. How to try it

Dev Tools → 💀 Dungeons → **Tactics battle**, at the bottom. On a narrow phone, Dev Tools is in the profile menu.

- **A class for each of the four** (front left, front right, back left, back right): Guard, Archer, Wizard, Hearthkeeper or Villager. Any citizen can be tried as any class.
- **Their level**: what the skull expects, one of the four levels by name, or the citizens as they really are.
- **Skull, land, seed**: the same three always give the same field and creatures.
- **Against**: an ordinary fight, the hardest fight, or the boss.

It uses the first four grown-up citizens who are free, costs nothing and changes nothing.

## 3. The rules

The board is 8 × 8 tiles, each with a height and a kind of ground. Units act one at a time, quickest first.

| | |
|---|---|
| **A turn** | Move once and act once, in either order. "Quick" abilities (Mark, Embolden) do not use up the action. A move can be taken back until the unit does something else. |
| **Ending a turn** | The player chooses which way the citizen faces. It is asked when End turn is pressed, and by itself once the move and the action are both used. The way shown first is towards the nearest foe. Creatures always turn to the nearest foe. |
| **Moving** | Up to the unit's Move in steps, no diagonals. A step climbs at most the unit's Jump and drops at most Jump + 1. Not through foes, water, trees or rocks; past a friend, but not onto their tile. |
| **Reach** | Counted in steps. A melee blow needs the target on the next tile and within one level. A bow cannot shoot the tile beside it. |
| **Height** | A ranged attack reaches one tile further for each level it stands above its target (two at most). A hit from higher ground does 15% more. |
| **Facing** | A hit from the side does a quarter more, from behind half as much again. The arrowhead at a unit's feet shows which way it looks. |
| **Block** | Soaks damage until the start of the bearer's next turn. Armour turns half its class from every hit first. |
| **Weak, vulnerable, slow** | Weak: deals that much less. Vulnerable: takes that much more. Slowed: one step less. Each drops by one at the start of the bearer's turn. |
| **Cooldowns** | A stronger ability is not ready every turn. Healing has uses per battle instead. |
| **Shapes** | One target; down a row (weaker each hit); a tile and those beside it; everyone near the user. Abilities never hurt friends. |
| **Ending** | Every creature down, or every citizen down. |

Left out on purpose: charge times and magic points, friendly fire, line of sight, misses. Not yet in: placing the party before the fight, standing a downed citizen up.

### On screen

- Full screen. The party are their villager sprites; creatures are their icons until they have art.
- **Going in:** a dark spiral closes over the screen, the battle's name is shown, and a circle opens onto the board. Nothing acts until it has opened. **Leaving** fades out. With reduced motion the screen goes dark and then shows the board.
- **⟲ ⟳ turn the view a quarter** (Q, R): a hill in front hides what stands behind it.
- **Zoom**: pinch with two fingers, the mouse wheel, or − and ＋. One finger (or the mouse) drags the board once it is zoomed.
- Blue tiles: where the unit can walk. Choosing an ability marks who it can reach.
- **With a mouse** a click acts at once, and hovering shows what it would do. **On a touch screen** the first tap shows what it would do and a second tap, or Confirm, does it.
- Tapping a creature shows its moves and, in red, where it can walk this turn.
- A phone held sideways puts the board on the left at full height and the panel beside it.
- Keys: arrows move the cursor, Enter chooses, Escape cancels, 1 to 5 choose an ability, E ends the turn, + and − zoom.
- The end screen gives rounds, the player's turns and the time taken.

## 4. The classes today

Every ability is a class card (`lib/class_cards.js`) and takes its numbers from that card's formula with the citizen's own stats. The board adds how far each reaches, its shape, and how often it can be used.

| Class | Move / Jump | Kit (reach; "every Nth turn" from its cooldown) |
|---|---|---|
| Guard | 3 / 1 | Strike (1) · Shield Up (self, every 2nd) · Cover (a friend within 2, every 2nd) · Shove (1, pushes back, weak; every 3rd) · Heavy Blow (1, every 4th) |
| Archer | 3 / 2 | Shoot (2 to 5) · Sidestep (self, every 2nd) · Parting Shot (1 to 3, then steps back; every 3rd) · Piercing Arrow (down a row to 5, every 4th) · Mark (1 to 5, quick; every 3rd) |
| Wizard | 3 / 1 | Spark (1 to 4) · Ward (anyone within 3, every 2nd) · Firebolt (1 to 4, every 2nd) · Ember Burst (1 to 4, and those beside; every 4th) · Chill (1 to 4, slow and weak; every 3rd) |
| Hearthkeeper | 3 / 1 | Cinder (1 to 3) · Hearth Ward (anyone within 3, every 2nd) · Kindle (heal within 3, twice a battle) · Steady Now (every friend within 2, every 3rd) · Embolden (a friend within 3, quick; every 3rd) |
| Villager | 3 / 1 | Swing (1) · Duck (self, every 2nd) · their trade card |

The creatures are the game's own, with their own moves; the board gives each a Move (a Mountain Harpy flies five tiles and three levels; a Hill Ogre trudges two) and a reach for the few that strike from afar.

## 5. First numbers

From `scripts/tactics_sim.js`: the engine's own mind plays both sides, 140 battles a line. "Your turns" is what a player decides; at about 12 seconds each, 25 turns is five minutes.

| Skull (creature health / strength) | Party | Ordinary fight: your turns · health lost | Hardest fight | Boss: wins · your turns · health lost |
|---|---|---|---|---|
| 🟢 Green (+40% / +10%) | 4 villagers | 19 · 30% | 19 · 34% | 92% · 29 · 63% |
| 🟡 Yellow (+80% / +30%) | guard, archer, 2 villagers | 15 · 23% | 17 · 32% | 99% · 22 · 44% |
| 🟠 Orange (+140% / +60%) | guard, hearthkeeper, 2 archers | 18 · 29% | 18 · 26% | 99% · 19 · 30% |
| 🔴 Red (+180% / +80%) | all four classes | 17 · 25% | 21 · 44% | 91% · 23 · 44% |
| 🟣 Purple (+240% / +100%) | all four classes | 18 · 23% | 21 · 34% | 94% · 23 · 42% |

These are for one battle. Nothing has been tuned for runs of battles; that is Phase 3.

## 6. Abilities in place of cards

The owner's direction: "instead of unlocking cards we can just allow villagers to train spells or gain abilities as they level up or as they train or study. We could tie technology in, we could tie in equipment."

### The shape of it

- **A citizen knows abilities and readies five for a battle.** Knowing is permanent and belongs to the person; readying is a choice made at home, kept until changed. This is the "prepared" idea, moved from the town's cards to the citizen.
- **The catalogue already exists.** All 59 class cards have formulas; twenty are in the kits above and the rest (Stand Fast, Hammer Blow, Aimed Shot, Hail of Arrows, Fireball, Deep Freeze, Chain Lightning, Banish the Blight, Rekindle and the others) each need only their board facts.

### Five ways to learn, each on a system that exists

| Way | How it works | Stands on |
|---|---|---|
| **Class level** | Each class has a ladder. A new Guard knows Strike, Shield Up and Cover; more come at levels 3, 6, 10, 15 and 20. | Careers and their levels |
| **Study** | A citizen is set to study one ability at their class's building. It takes hours of real time and one of the building's seats. The building's level sets which abilities it can teach. | The Watchtower, Wizard's Tower and Hearth Shrine, and their level ladders (`DUNGEON_CLASS_DECKS.md` §4.3) |
| **Research** | Town-wide improvements from the Library: "Fletching" (bows reach one further), "Field Medicine" (Kindle a third time), "Stone Wards" (Ward lasts two turns). | The research tree |
| **Equipment** | A weapon shapes the basic attack and can carry an ability of its own: a longbow reaches further, a shield strengthens Shield Up, a staff adds to spells, a boss's trophy grants something nobody else has. The weapon's dice finally count (a gap noted in `DUNGEON_CONTENT.md` §2). | Crafting, the smithy, dungeon loot |
| **Family** | When a child comes of age, a parent or mentor passes on one ability of their own: a signature that runs in the family. | Apprenticeships and mentors |

### And three things on top

- **Mastery.** An ability used enough in battle becomes its ✦ form for that citizen, for good. This is what honing was, earned instead of picked.
- **A reaction and a passive.** One slot each: Counter (strike back when hit in melee), Brace (the first hit each round does less), Sure-footed (jump one higher). Traits give passives too: a quick citizen walks a step further.
- **A second class.** A citizen who changes career keeps one ability from the old one. Over generations a town grows Guards who once were Archers.

## 7. Ideas, with a recommendation on each

| Idea | What | Recommend |
|---|---|---|
| **Ground that matters** | Trees give cover from arrows to whoever stands beside them; shallow water and mud cost two steps; high ground already counts. | Yes, three kinds, no more |
| **The year on the board** | Winter freezes rivers (walkable) and snow slows; spring floods the fords; autumn leaves hide a unit that has not moved. | Yes: it is the game's own pillar, and no other tactics game has it |
| **Other ways to win** | Hold the gate for six rounds; get the cart across; protect a villager; break the totem. | Yes, with raids (below) |
| **Raids on your own town** | The raid is fought on a map made from the town: the walls and the Watchtower are the terrain, the defenders are who is on watch. | Yes: it makes walls and guards mean something you can see |
| **Bosses that use the board** | Old Snapjaw drags a citizen into the water; the Storm Matriarch takes the high ground; Grum throws boulders that stay as rocks. | Yes, one trick each |
| **Placing the party** | Choose the four starting tiles before the fight. | Yes, cheap and expected |
| **Kin and bonds** | Kin standing side by side block a little more (decided 2026-11-18 for cards). | Yes, as adjacency |
| **Speed** | A ×2 switch for creature turns; "let them fight" for a battle far below the party's level. | Yes, both, before players see it |
| **Night battles** | Bows reach less in the dark unless someone carries a lantern. | Later |
| **Magic points, charge times** | The genre's bookkeeping. | No: cooldowns do the job and read at a glance |
| **Friendly fire** | Bursts hurt friends. | No: wrong tone for this game |
| **Bigger battles** | Six a side, larger maps. | No: five minutes is the promise. Ten by ten for bosses at most |

## 8. What happens to the cards

**Kept:** the classes, careers and class buildings; the creatures; the formulas; the dungeon run (the path, rooms, wounds that carry, rests, endings, the generator); injuries; loot.

**Retired, in Phase 5:** the card engine (both copies) and the card hand; the home deck and deck builder; the card collection, card drops and unlocks; in dungeons, the door pick, the card after a fight, honing and prepared cards. The card editor in Dev Tools becomes an ability editor.

**Nothing a player earned is lost.** Every card a town has unlocked becomes an ability its class building can teach.

## 9. The roadmap

Each phase ends with something playable behind the switch.

| # | Phase | What it delivers | Size |
|---|---|---|---|
| 0 | The trial | One battle from Dev Tools. **Done.** | |
| 1 | Feel | Choosing a facing, zoom and drag, a phone on its side, hooks for art, sound and music. **Done.** | |
| 2 | **The server decides** | The same engine runs on the server from a log of the player's choices; a battle is stored, survives a reload and cannot be cheated. | Medium |
| 3 | **Dungeons on the board** | A dungeon's fights are tactics battles. Health and who is down carry between them; rests, loot, fleeing and the endings as now. Fewer, larger fights per dungeon. The door pick and the card after a fight go; standing a fallen citizen back up comes in. Tuning for whole runs. | Large |
| 4 | **Abilities** | Knowing and readying; class ladders; study at the class buildings; research; equipment; mastery. An Abilities page on each citizen. | Large |
| 5 | **Everywhere, and the cards go** | Quests, camps and raids on the board, with a quick result for small fights. Raids on a map of the town. The card systems are removed. | Large |
| 6 | **Content** | The full creature list with board behaviour, the seven bosses, ground that matters, the seasons, other ways to win, placing the party. | Large; alongside the art |
| 7 | **The way in, and polish** | Dungeons on the map for players, a first battle that teaches, art and sound in, tuning from real play, slow phones. | Medium |

**Why this order.** Phase 2 first, because everything after it stores results and a battle the browser decides cannot be trusted with them. Phase 3 next, because a single battle is a toy and a dungeon is the game. Abilities (4) before retiring cards (5), so there is something to replace them with. Content (6) can run beside any phase once art starts arriving.

**Decisions the owner will need to make,** none of them yet:

1. **Small fights.** Is a quest's one-creature scuffle a full battle, a quick result, or the player's choice? (Suggested: a quick result by default, "fight it myself" on offer.)
2. **Dungeon length.** Nine five-minute fights is too long. Suggested: 2, 3, 4, 5 and 6 fights for green to purple.
3. **Who owns an ability.** Suggested above: the citizen. The other way (the town knows it and any citizen of the class can ready it) is simpler and loses the family story.
4. **Species.** Only mice have sprites, so every party is drawn as mice. The other six species are the largest art job in the game either way.

## 10. Where it is

| Piece | File |
|---|---|
| The rules: map, turns, moving, reach, facing, height, abilities, the creatures' mind | frontend `js/tactics-engine.js` |
| The screen: the board, taps and keys, zoom, facing, animation, sound, the Dev Tools box | frontend `js/tactics.js`, `css/tactics.css` |
| The list of art and sound that exists | frontend `scripts/pack_tactics.js` → `assets/tactics/manifest.json` |
| The two sides: kits, levels, creatures, the board's skull numbers | server `lib/tactics_setup.js` |
| Routes (admins only) | server `routes/tactics.js` |
| Numbers | server `scripts/tactics_sim.js` |
| Tests | frontend `verify/tactics_proofs.js` (69 checks), server `scripts/tactics_test.js` (21) |

- **The engine is pure**: no clock, no `Math.random`, no DOM. A battle is a plain object changed only by `move`, `use` and `endTurn`, and the same seed and choices always give the same battle. Phase 2 relies on that.
- **Today the battle runs in the browser only**, and the server only says who is on the board.
- Class names in the stylesheet start `kwtc-` (`kwt-` belongs to travel).
