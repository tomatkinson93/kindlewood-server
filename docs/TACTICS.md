# Tactics battles

Status: **the game's combat (chosen by the owner 2026-11-20; the only combat from 2026-11-26).** Every battle is fought or decided on the board: a quest's, a camp's, a sally's, a clan quest's, a dungeon's. The card battler is deleted (§8). Dungeons are on the world map (2026-11-25, `DUNGEONS.md` §13): a party of four is sent from a tile's panel. The abilities redesign (Phase 4, §6) was finished on 2026-11-28, and the first piece of Phase 6 the same day: **the board itself** (§7a: ground that slows, cover, the season, hiding in leaves, placing the party). What is left is the rest of the content (6) and of the way in (7): §9.

**There are no players yet** (the owner, 2026-11-25): it is a test server with one tester. Nothing is gated for players' sake, nothing is bought back or migrated gently, and a switch is only worth having where the owner wants to turn something off while testing.

## 1. The decision

The owner had been leaning towards a tactical battle on a board, in the manner of Final Fantasy Tactics, and asked for a trial behind Dev Tools. After playing it on a phone (2026-11-20): "just what I was looking for", "a lot more fun and interactive than our card battler", "fits better with our villager class system".

So:

- **Combat moves to the board**, everywhere, in time.
- **Cards are retired** (§8). In their place **citizens learn abilities**: by levelling in a class, by training and study, through research, and from equipment (§6).
- What was parked for cards is **cancelled**: the weak/vulnerable/Focus change to the card engine, the draft scene, Enhance for cards, a floor on prepared cards. Two of those ideas carry over in another form: a citizen readies some of the abilities they know (§6), and abilities improve with use.

The earlier objections, for the record, and what answered them: battles of this kind run long (small maps keep one to about five minutes); a height map is hard on a phone (Final Fantasy Tactics Advance ran on 240 × 160; the view turns, and now zooms); it is a large rebuild (it is a personal project and the owner is happy to take the time).

## 2. How to try it

**In the game:** send a citizen or a party on a quest that can meet trouble; when it does, the fight waits in **Battles** (The Road) and **Engage** opens it on the board. A camp assault and a sally open the same way.

**A practice battle** (admins): Dev Tools → 💀 Dungeons → **Tactics battle**, at the bottom. On a narrow phone, Dev Tools is in the profile menu.

- **A class for each of the four** (front left, front right, back left, back right): Guard, Archer, Wizard, Hearthkeeper or Villager. Any citizen can be tried as any class.
- **Their level**: what the skull expects, one of the four levels by name, or the citizens as they really are. A level brings its class level, which decides how much of the kit is known (below): villager 1, novice 3, trained 6, veteran 10. Choose Trained or Veteran to see every ability.
- **Skull, land, seed**: the same three always give the same field and foes.
- **Against**: an ordinary fight, the hardest fight, or the boss.
- **Whose**: whoever lives in that land (the seed picks the band), or one band by name. A band by name gives its showcase: someone who shoots, someone who heals or casts, someone to stand in front; for the boss fight, its boss.
- **Going in**: a different way in each time, or one of the five by name.

It uses the first four grown-up citizens who are free, costs nothing and changes nothing in the town. The battle is stored: if the page is reloaded or closed, the same box offers "Pick up the battle that is open".

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
| **The fallen** | A citizen who goes down **lies where they fell**: no turn, and no foe can strike them. Anyone may step over them; nobody may stop on their tile. **Healing them stands them back up** with the health healed (Kindle, Share Rations, Strong Drink), free of whatever ailed them, and they take their turn again when it comes. A foe that goes down is gone. In a dungeon, whoever is down is carried into the next fight and lies at their place there, until a heal or a rest. |
| **Ending** | Every foe down, or every citizen down. |

Left out on purpose: charge times and magic points, friendly fire, line of sight, misses. Not yet in: placing the party before the fight, standing a downed citizen up.

### On screen

- Full screen. The party are their villager sprites; foes are an emoji each until they have art (`docs/TACTICS_ASSETS.md` §1).
- **Going in:** something closes over the screen, the battle's name is shown on it, and it opens onto the board. Nothing acts until it has opened. **Leaving** fades out. With reduced motion the screen goes dark and then shows the board. There are five ways in: a fade through dark, a page turning, tiles turning over, leaves blowing across, a closing circle. **Each battle picks one at random, never the one before** (the owner liked all five, 2026-11-21). Dev Tools can ask for one by name, or for none. No sound plays until `start` exists in the sounds folder.
- **Things that fly and burst.** Every ability has a look, drawn by code, so none needs art. *In flight:* an arrow, a sling stone, a venom dart, a thrown bottle and a boulder arc to their target; fire, embers, frost, a hex, venom, spores and a curse fly as glowing orbs; a spark leaps the gap, lightning strikes from the sky, and a gale curls down a row. *On landing:* a slash for a blade, three claw marks for talons and teeth, a straight flash for a spear, a dusty thud for a club, a puff, a flare, a splat, shards of ice. *Over an area:* fire blooms, a boulder cracks the ground, spores hang as a green cloud, a curse as a purple murk. *On those it touches:* a shield for a ward, a glow with rising sparks for healing, rising chevrons for a boon, a closing reticle for Mark, bubbles for poison, stars for a stun; a howl, a shriek or a rally spreads as a ring. A heavy blow, or one from behind, jolts the board. A class ability's look is a table in `js/tactics.js`; a foe's ability names its own (`look` in `lib/tactics_foes.js`), and the sound follows the look. With reduced motion none is drawn.
- **When it ends** (2026-11-22, the owner's design). First a big word over the board as the battle left it: **Victory** in gold, **Defeat** in red, for about two seconds, with the win or loss sound. Then the party, one to a row: a face (from the villager sheet), the name, the class, and
  - **won:** an experience bar for each. The bar grows from where the citizen was to where they are while the number beside it counts down from the gain to nothing; crossing a level, the row flashes and says **Level up!**. On a practice field the same is shown and a line says nothing is kept.
  - **lost, or a run that ended with someone fallen:** each citizen's **injury roll, one at a time**: the words spin (Unhurt, A scratch, A wound, A scar, Crippled…), slow, and stop on what the server rolled, coloured by how bad it is, with the line the chronicle keeps. After a won last fight the rolls follow the experience.
  The numbers come with the server's answer to the last choice, so nothing plays until it has come. Once the word has gone, the panel of abilities is hidden so the box has the whole height (it did not fit a phone otherwise). A memorial for someone who died waits until the battle's screen is closed. With reduced motion there is no splash and everything is simply shown.
- **Pictures and music (2026-11-23).** The four classes' abilities show their own icons, a status shows its pip with how much of it, and a battle plays the music of its land (a boss the boss's, a boss of the Withered theirs): `docs/TACTICS_ASSETS.md` §4 and §6.
- **The screen holds still.** The panel below the board is one fixed height. What an action would do, and its Confirm, float over the top of the board.
- **⟲ ⟳ turn the view a quarter** (Q, R): a hill in front hides what stands behind it.
- **Zoom**: pinch with two fingers, the mouse wheel, or − and ＋. One finger (or the mouse) drags the board once it is zoomed.
- Blue tiles: where the unit can walk. Choosing an ability marks who it can reach.
- **With a mouse** a click acts at once, and hovering shows what it would do. **On a touch screen** the first tap shows what it would do and a second tap, or Confirm, does it.
- Tapping a creature shows its moves and, in red, where it can walk this turn.
- A phone held sideways puts the board on the left at full height and the panel beside it.
- Keys: arrows move the cursor, Enter chooses, Escape cancels, 1 to 5 choose an ability, E ends the turn, + and − zoom.
- **Let them fight** (beside End turn): the party fights the rest of the battle by itself, at once.
- The end screen gives rounds, the player's turns and the time taken, and says when the result is recorded.

## 4. The classes today

Every ability is a class card (`lib/class_cards.js`) and takes its numbers from that card's formula with the citizen's own stats. The board adds how far each reaches, its shape, and how often it can be used.

**The ladder (built 2026-11-22):** a class begins with its first two abilities and learns the third at class level 2, the fourth at 4 and the fifth at 6. The order below is the order learned, except that an Archer learns Mark (4) before Piercing Arrow (6), a Wizard Chill (4) before Ember Burst (6), and a Hearthkeeper begins with Cinder and **Kindle** (a healer heals from their first day; changed 2026-11-23, when it was Hearth Ward they began with), learns Hearth Ward at 2, and Embolden (4) before Steady Now (6). What is not learned yet shows greyed in the row of abilities with the level that brings it.

| Class | Move / Jump | Kit (reach; "every Nth turn" from its cooldown) |
|---|---|---|
| Guard | 3 / 1 | Strike (1) · Shield Up (self, every 2nd) · Cover (a friend within 2, every 2nd) · Shove (1, pushes back, weak; every 3rd) · Heavy Blow (1, every 4th) |
| Archer | 3 / 2 | Shoot (2 to 5) · Sidestep (self, every 2nd) · Parting Shot (1 to 3, then steps back; every 3rd) · Piercing Arrow (down a row to 5, every 4th) · Mark (1 to 5, quick; every 3rd) |
| Wizard | 3 / 1 | Spark (1 to 4) · Ward (anyone within 3, every 2nd) · Firebolt (1 to 4, every 2nd) · Ember Burst (1 to 4, and those beside; every 4th) · Chill (1 to 4, slow and weak; every 3rd) |
| Hearthkeeper | 3 / 1 | Cinder (1 to 3) · Hearth Ward (anyone within 3, every 2nd) · Kindle (heal within 3, twice a battle) · Steady Now (every friend within 2, every 3rd) · Embolden (a friend within 3, quick; every 3rd) |

**The higher rungs (built 2026-11-23):** five more for each class, at class levels 8, 10, 13, 16 and 20, from the cards that were never in a kit. A citizen **brings five** to a battle, so from level 8 there is a choice (§6: knowing and readying).

| Class | 8 | 10 | 13 | 16 | 20 |
|---|---|---|---|---|---|
| Guard | Stand Fast (self, more block; every 2nd) | Shield Bash (1, the foe loses a turn; every 4th) | Guard's Oath (a friend within 3, a strong block; every 3rd) | Hold the Line (block for all within 2; once a battle) | Hammer Blow (1, heavy and leaves it weak; every 4th) |
| Archer | Aimed Shot (2 to 6, harder; every 2nd) | Hamstring (1 to 4, weak and slow; every 3rd) | Arrow Rain (2 to 5, and those beside; every 4th) | Pin Down (2 to 5, slow 3 and weak 3; every 3rd) | Hail of Arrows (2 to 5, all within 2 of the target; once a battle) |
| Wizard | Scorch (1 to 4, burns each turn; every 2nd) | Ice Ward (anyone within 3; every 2nd) | Frost Lance (1 to 5, slow and weak; every 3rd) | Chain Lightning (down a row to 5; every 4th) | Fireball (2 to 5, all within 2 of the target; every 5th) |
| Hearthkeeper | Ember Ward (anyone within 3; every 2nd) | Banish the Blight (1 to 4; every 2nd) | Battle Cry (next attack of all within 2 lands harder; every 4th) | Hearthlight (heals all within 2; once a battle) | Rekindle (a great heal within 3; once a battle) |

- **Stronger, not twice as strong.** The same citizens bringing only these five win the same fights in about a fifth fewer turns than with the first five (24 battles at red and at purple, `scripts/tactics_test.js` plays twelve of them on every run). The first five are still what the skulls were tuned with, and what a playtest level brings.
- **Each is described for the board** (`SAY` in `lib/tactics_setup.js`): the cards' own lines spoke of "the creature in front" and "draw a card".
- **Not carried over from the cards:** Banish the Blight's extra against the Withered and the "later blocks hold better" of Guard's Oath and Ember Ward (the board has no rule for either yet). The mind never uses Battle Cry; a player can.
| Villager | 3 / 1 | Swing (1) · Duck (self, every 2nd) · their trade card |

### Who they fight

**Reworked 2026-11-21, at the owner's word:** in a world where every animal walks upright and wears clothes, a wild fox or a boar on four legs does not belong. So no animal on the board walks on four. A foe is an outlaw, a raider, one of the marsh folk, or a villager the blight hollowed out, and **every band has someone who fights up close, someone who strikes from far off, and someone who heals or casts.** Thirty foes in five bands, written for the board in `lib/tactics_foes.js`: how far each walks and jumps, what it does, how far that reaches, its shape, how often.

| Band | Where | Minions and regulars | Heavy | Elite | Boss |
|---|---|---|---|---|---|
| **The Redtooth Brigands** (red neckerchiefs) | plains, forest, hills | Rat Cutpurse (quick) · Weasel Slinger (**shoots** 2 to 4) · Fox Footpad (throws sand: weak) · Polecat Sawbones (**heals** a friend within 3; throws tonic) | Boar Bruiser (charge knocks back; braces) | Stoat Captain (**rallies** the band) | Redtooth, the Brigand King (plains) |
| **The Night Pack** (blue war paint) | forest, hills, mountain | Wolf Raider (a howl **emboldens** the pack) · Wolf Bowhunter (**shoots** 2 to 5; a shot that slows) | the land's | Pack Chieftain (cleaves all round) | Old Greyfeather, an owl warlock (forest; **casts** moonbolts) |
| **The Crag Reavers** (black harness) | mountain, hills | Mountain Harpy (moves 5, leaps 3; a shriek weakens) · Crow Stormcaller (**casts**: spark 1 to 4; a gale down a row slows) | Hill Ogre (slow; a slam stuns) | Stormcrow (**casts** lightning; a thunderclap over an area) | The Storm Matriarch (mountain) · Grum, the Ogre Chief (hills; **throws boulders**) |
| **The Mire Folk** (reed cloaks) | marsh, river | Newt Darter (**shoots** venom darts 2 to 4: poison) · Toad Sporecaller (**casts** a spore cloud over an area) · Heron Lancer (a spear that reaches 2 and through a row) | Snapper Shellback (armour; into its shell) | Bog Witch (**casts** hexes and a curse; **heals**) | Old Snapjaw (river) · The Bog Mother (marsh; heals herself) |
| **The Withered** (grey fur, hollow green eyes) | ruins, marsh, deep forest | Hollow Bowman (**shoots** 2 to 5) · Hollow Thrall (slow; a rotting touch) · Rot Shaman (**casts** hexes; **heals** its kin) | Husk Brute (rot breath down a row) | Husk Knight (armour; reaps all round) | The Hollow King (ruins; a crown of rot over an area) |

- **A dungeon belongs to a band.** The seed picks one of the bands that live in the land; the dungeon's ordinary foes are that band's, and where the band has nobody of a rank, whoever in the land does. The boss is the land's.
- **The eleven creatures of the card battles each have a foe that stands in their place** (Marsh Rat → Rat Cutpurse, Wild Fox → Fox Footpad, Thornback Boar → Boar Bruiser, Night Wolf → Wolf Raider, Bog Lurker → Newt Darter, Fungal Toad → Toad Sporecaller, River Pike → Heron Lancer, Withered Husk → Hollow Thrall; the Rot Shaman, the Mountain Harpy and the Hill Ogre are themselves). So a dungeon written for cards, fought on the board, shows the new cast. A creature made in the enemy editor that the board has never heard of is read from its row as before.
- **A quest still names the old creatures** (it rolls them from the creature list, by land and time of day), and each is met on the board as the foe that stands in its place; the Battles list and the battle report say the foe's name. A creature made in the editor that the board has no foe for is read from its own numbers and moves.
- **The rule is "no animals on four legs", not "animals only"** (the owner, 2026-11-22): an ogre, a harpy, a centaur, anything out of a story is welcome. So the Hill Ogre and the Mountain Harpy are back as themselves, Grum is the Ogre Chief again and the Storm Matriarch a harpy queen. Two stay changed because the old ones could not stand on a board: the River Pike is a Heron Lancer and Old Snapjaw a snapping turtle. More mythical foes are for Phase 6 (§7).
- The mind that plays them (`plan` in the engine) already keeps those who shoot at their distance, heals whoever is hurt, and weighs an area by everyone in it, so the new foes needed no new rules.

## 5. The numbers

Two simulators, both with the engine's own mind playing both sides and the party a skull expects. "Your turns" is what a player decides; at about 12 seconds each, 25 turns is five minutes.

**One battle** (`scripts/tactics_sim.js`, 105 battles a line, the party at full health):

| Skull (foe health / strength) | Party | Ordinary fight: your turns · health lost | Hardest fight | Boss: wins · your turns · health lost |
|---|---|---|---|---|
| 🟢 Green (+30% / +5%) | 4 villagers | 18 · 27% | 19 · 27% | 99% · 22 · 34% |
| 🟡 Yellow (+55% / +18%) | guard, archer, 2 villagers (class level 3: three abilities each) | 16 · 23% | 18 · 34% | 100% · 19 · 29% |
| 🟠 Orange (+140% / +60%) | guard, hearthkeeper, 2 archers | 14 · 15% | 18 · 30% | 100% · 20 · 34% |
| 🔴 Red (+150% / +65%) | all four classes | 16 · 17% | 20 · 32% | 100% · 23 · 41% |
| 🟣 Purple (+170% / +70%) | all four classes | 17 · 18% | 19 · 29% | 100% · 22 · 34% |

**A whole dungeon** (`scripts/tactics_run_sim.js`, 70 runs a line): a generated board dungeon walked from the door to the boss, wounds and the fallen carried from fight to fight, rests taken. "Careful" takes the road with the fewest fights; "bold" takes every fight and elite it can reach. A player is somewhere between. "Minutes" is the battles' playing time.

| Skull | Fights on a route, boss and all | Careful: cleared · fights · minutes · health at the boss's door | Bold: cleared · fights · minutes · health at the boss's door |
|---|---|---|---|
| 🟢 Green | 2 to 3 | 96% · 2.5 · 9 · 89% | 93% · 2.9 · 11 · 83% |
| 🟡 Yellow | 3 to 4 | 90% · 3.0 · 11 · 79% | 73% · 3.7 · 13 · 68% |
| 🟠 Orange | 3 to 5 | 97% · 3.9 · 13 · 91% | 94% · 4.9 · 16 · 83% |
| 🔴 Red | 4 to 6 | 87% · 4.5 · 17 · 90% | 67% · 5.5 · 20 · 81% |
| 🟣 Purple | 5 to 7 | 87% · 5.2 · 19 · 78% | 83% · 6.8 · 24 · 71% |

**How these were reached (2026-11-22, the end of Phase 3).** With the card dungeons' shape (up to nine fights) and the first board numbers, the mind cleared a third of green dungeons and no purple ones: a board fight costs a quarter to a third of the party's health, where a card fight cost a tenth. Four things were changed, each measured:

1. **Fewer fights** (`SHAPES` in `lib/dungeon_gen.js`; the longer card shapes are gone): a route has 2 to 3 at green, rising to 5 to 7 at purple, the boss among them. A dungeon is 10 to 25 minutes of battle.
2. **A rest gives back half** (`DUNGEON_BOARD_REST`, a tunable).
3. **The boss has less company and a little less health**: one minion beside it at green, one regular at yellow, two from orange up.
4. **Gentler skulls at both ends**: green and yellow a little lower (a town's first dungeons, fought by villagers), red and purple a good deal lower than the card numbers they started from. **These are live numbers** (from 2026-11-23): Dev Tools → Life → Dungeons has each skull's foe health and foe power (`DUNGEON_FOE_HP_*`, `DUNGEON_FOE_POW_*` in `lib/tuning.js`, starting from `TIERS` in `lib/tactics_setup.js`), and a change applies to the next fight opened. Until then that page still held the card skulls' numbers, which the board never read.

**Yellow was eased again when the ladder came in** (the same day): a yellow party is at class level 3 and knows three abilities each, not five, and cleared 73% on the careful road at the old numbers. At +55% / +18% it is back to nine in ten. Orange and above are at class level 6 or more and know the whole kit, so nothing else moved.

**Fights are not larger.** The plan said "fewer, larger fights". Groups of four and five were tried at red and purple and the party lost ordinary fights most of the time, so a fight stays at three foes, sometimes four (3.1 on average; a boss with one or two). Fewer is what mattered for the length; larger can come back with ground that matters and smarter placing in Phase 6.

**What to watch in real play:** yellow and red taken boldly (about seven in ten), where most losses are at the boss; and that the mind almost never raises the fallen in these runs (0.1 to 0.2 a run), since only the orange, red and purple parties here have a Hearthkeeper. A real player will do better at both.

## 6. Abilities in place of cards

### Experience from battle (built 2026-11-22)

**A battle on the board that is won pays experience into the class levels the game already has** (`citizen_classes`, levels 1 to 20, `lib/careers`; the curve is `lib/career_math.js`: about 180 experience for level 5, 1,800 for level 10, 15,000 for level 20; a citizen at their job at home earns 10 an hour). It is the first piece of Phase 4: the ladder below climbs these levels. `lib/tactics_xp.js`:

- **How much.** Each foe is worth its rank (minion 6, regular 10, heavy 16, elite 30, boss 60), times the skull (green ×1, yellow ×1.3, orange ×1.7, red ×2.2, purple ×3). Three brigands at green: 26. An ogre's band at red: 79. Grum and two of his at purple: 258. Everyone who fought gets the whole figure; it is not shared out.
- **Who.** A Guard, Archer, Wizard or Hearthkeeper earns it in their own class. Anyone else earns **half, as Guard training**, as card battles already paid them. Whoever **lay fallen when it ended earns half**. A battle that is lost pays nothing.
- **When.** At once, as each fight of a dungeon is won, so the screen can show it. The careers' own listener (`lib/career_subscriber.js`, 12 + 4 a foe for a card battle) is told it has been paid and only counts the battle.
- **A practice field** shows what would have been earned and keeps none of it.
- **What a level does:** it lifts the citizen's combat skill and gives a perk point, as before, and **it teaches abilities** (the ladder, next).
- **Scale, to be watched:** a green dungeon is about 100 experience to each fighter, a purple one about 1,000. From nothing, one green run makes a level 4; about fifteen purple runs make a master. If that is too fast, the two tables at the top of `lib/tactics_xp.js` are the only numbers to change.

The owner's direction: "instead of unlocking cards we can just allow villagers to train spells or gain abilities as they level up or as they train or study. We could tie technology in, we could tie in equipment."

### The ladder: abilities by class level (first rung built 2026-11-22)

- **Built.** Each of the four classes knows two abilities at class level 1 and learns one more at levels 2, 4 and 6 (§4). The level is the citizen's own, in that class (`citizen_classes`); a villager's three are known from the start. On the board the unlearned ones sit greyed in the row with "learned at level N"; tapping anyone lists theirs too. When a battle's experience carries a citizen over one of those levels, the victory screen says **Learned: Cover** under their bar, and the next fight has it. Where: `KITS[…].at` and `learnedBetween` in `lib/tactics_setup.js`; `learned` on the rows of `lib/tactics_xp.js`.
- **Why these levels.** A fresh Guard reaches level 2 in the first fight of a first dungeon and level 4 by the end of it, so the first run already teaches two things; level 6 takes three or four green runs or one orange one. The whole starting kit is known before the skulls that were tuned for it (orange and up).
- **The higher rungs (built 2026-11-23):** levels 8, 10, 13, 16 and 20 teach one more each (§4), ten in all.
- **Knowing and readying (built 2026-11-23; replaced 2026-11-26 by "Schools, the whole kit, and a second school" below: a citizen now brings all their class has taught them).** A citizen knows what their class level has taught and **brings five** to a battle. Until they choose, those are the first five they learned; a level that teaches a sixth says so on the victory screen ("Learned: Stand Fast, ready it on their Abilities page"). The choice is the citizen's own, made at home and kept until changed (`citizen_classes.ready`, a list of keys); it cannot be changed from inside a dungeon. A choice that no longer fits (a class changed, a key gone) is filled out from the earliest learned, so nobody ever goes in with fewer than five or with something they do not know. `lib/tactics_abilities.js`, `GET /api/tactics/abilities/:citizenId`, `POST …/ready { keys }`.
- **The Abilities tab on a citizen (built 2026-11-23).** Beside Career on a citizen's page: the class and level with its bar, what the next level teaches, and the ten in the order learned, each with its picture, what it does in that citizen's hands, its reach and how often it can be used; a tick for each one brought, "5 of 5 chosen", Save. Someone with no class sees a villager's three and is told what a class would teach. Frontend `js/abilities.js`, `css/abilities.css`. **The tab shows only where battles on the board are open:** to admins, and to everyone once `dungeons.on` is switched on.
- **In a battle** the row is still five wide: the readied ones, then (while fewer than five are known) the ones still to learn, greyed. Tapping a citizen also names the next one to come and how many they left at home.
- **Not built:** study at the class buildings, research, equipment, family, mastery, a reaction and a passive (below).

### Schools, the whole kit, and a second school (decided by the owner 2026-11-26)

This replaces "knowing and readying five" above. Built in stages; what is built is marked.

**Schools.** Every ability belongs to a school:

| School | What it is | Whose |
|---|---|---|
| **Basics** | A plain melee blow (Swing). Everyone has it, always. | Everyone |
| **Arms** | Blows, shield work, holding a line. No magic. | Guards |
| **Archery** | Shots, marks, pins, rains of arrows. | Archers |
| **Wild magic** | Fire, frost and lightning: the untamed side of the wood. | Wizards |
| **Hearth magic** | Healing, wards and heart: the homely side. | Hearthkeepers |
| **Fieldcraft** | A villager's trade trick (a tool, a ration, a sign read). | Villagers with a trade |

("White" and "black" magic are another game's words; these are ours.)

**In a battle a citizen brings everything their current class has taught them**, not five of it. The battle's action bar is grouped by school, one tab each.

**And up to five from one other class they have levels in: their second school.** The only way to know another class's abilities is to have been that class (the owner chose "old careers only": no cross-study). Class levels are kept when a citizen changes career, so a Guard who becomes an Archer still knows what the Watchtower drilled into them. A villager who has fought has Guard levels (battle pays them as Guard training), so a veteran farmer can bring five Arms abilities.

**A second-school ability works at three-quarters strength** (damage, healing and block ×0.75), on top of what the citizen's own stats and gear make of it. Healing reads intelligence and a staff; a Guard with neither heals about half what an equipped Hearthkeeper does. That gap is the point.

**How abilities are learned.**

- **Levels teach the core.** The ten on each class ladder, free, as built.
- **Study teaches the rest of the school** at the class's building (Watchtower, Wizard's Tower, Hearth Shrine): extra abilities and **passives**, each needing a class level and a building level, each taking hours and a seat. Only a citizen of that class studies there.
- **A passive slot.** One always-on trait in battle (Counter, Brace, Sure-footed…), learned by study.
- **Mastery.** An ability a citizen has used about 25 times in battle is ✦ for them for good: 20% stronger.
- **Gear.** Kinds of weapon each do one clear thing: a longbow reaches a tile further, a shield adds to Shield Up and Cover, a halberd strikes two tiles away, a war hammer hits harder and slows its wielder a step, a dagger strikes harder from behind, a staff (new) adds to spells.
- **Research.** Town-wide improvements from the Library (Fletching, Field Medicine, Stone Wards).
- **A family signature.** A child coming of age is taught one ability by a parent, whatever class they take.
- **An Allied village** teaches one ability no ladder has (the perk that replaces its card lessons).

**Stages.** A: schools, the whole kit, the second school, the tabbed action bar, the Abilities tab (**built 2026-11-26**: `SCHOOLS`, `partyUnit`, `secondOf` in `lib/tactics_setup.js`; `lib/tactics_abilities.js`; `citizens.second_class`, `second_ready`; `POST /api/tactics/abilities/:id/second`; tabs in `js/tactics.js`; `js/abilities.js`). B: mastery (**built 2026-11-26**: `lib/tactics_mastery.js`, table `citizen_ability_uses`; every use in a kept battle the player played is counted, 25 master it, a mastered ability is 20% stronger wherever it comes from; the end screen says "Mastered: Strike ✦", the Abilities tab shows "12 of 25 uses to ✦"; a practice battle and a battle left to be decided count nothing). C: gear (**built 2026-11-26**, below). D: study and the passive slot (**built 2026-11-27**, below). E: research (**built 2026-11-28**). F: family (**built 2026-11-28**). G: the Allied village's ability (**built 2026-11-28**). All seven stages are built; E to G are described below.

**Stage E as built: research (`lib/research_defs.js`, the Battlecraft path).** A seventh path at the Library. What it gives, every citizen of the town brings to battle (`researchOf` in `lib/tactics_setup.js`):

| Project | Era | Needs | Every citizen… |
|---|---|---|---|
| Fletching | Foundations (120 points) | nothing | …shoots Archery one tile further |
| Field Medicine | Workings (300) | Fletching | …has one more use of healing that is counted by the battle (Kindle, Second Wind, Mending Song) |
| Stone Wards | Workings (300) | Fletching | …blocks a quarter more with the wards of Wild and Hearth magic |
| Sparring Rings | Guilds (650) | Field Medicine | …has an Attack a tenth stronger |

The citizen's Abilities tab names what the town has finished ("Fletching, from the Library"). Four projects to prove the path; more are one line each (`effects: { 'battle:<what>': x }`, read in `abilityOf`).

**Stage F as built: a family signature (`lib/tactics_signature.js`).** When a child comes of age, a parent teaches them **one ability of their own**: the one that parent has used most in battle, or with none used, their own family's signature, or else the furthest along their ladder. With no parent who can, their mentor. The child has it **for life, at full strength, whatever work they take up**, marked ⚜ in battle and on the Abilities tab with who taught it, and hands it on in their turn, so an ability can run in a family for generations. The town's news and chronicle say it ("…Hazel taught them Shove, to carry all their life"). An Attack and a passive cannot be a signature. When a citizen's own class teaches the same ability it is not there twice. Dev Tools → 💀 Dungeons → **Hand down family signatures** does it now for grown citizens who have none.

**Stage G as built: village lore (`lib/tactics_lore.js`).** The perk that replaces an Allied village's card lessons. Each kind of village folk has one ability on no ladder:

| Village | Lore | What it does |
|---|---|---|
| Mice | Rally | A friend's next attack lands harder. Does not end the turn. |
| Badgers | Bulwark | Block for yourself and everyone within two tiles. |
| Squirrels | Quick Jab | A light hit that does not end the turn. |
| Otters | Riptide (new) | Knocks a foe back a tile and slows it. |
| Weasels | Smoke Bomb | A little block for yourself and everyone within two tiles. |

A village at **Allied trust (71)** teaches it to one citizen of the player's choosing for **200 wealth**, and to one of that town's citizens **every 7 days**. The citizen has it for life at full strength, marked 🏡, in a school of its own (Village lore). **A citizen carries one piece of village lore**: being taught another replaces it. The village's window shows the lore whatever the trust, as something to work towards. `POST /api/diplomacy/:npcId/teach { citizen_id }`.

**What a citizen can bring to a battle now, in full:** their Attack; everything their class has taught and what they studied in its school; a family signature; one piece of village lore; up to five from a second school; one passive; and, on all of it, their gear, their town's research and their own mastery.

**Stage D as built: study at the class buildings, and a passive slot (`lib/tactics_study.js`).** The owner's choices (2026-11-27): a lesson costs time and wealth; a small first set; a citizen who is studying carries on as normal.

- **Where.** A Guard or an Archer studies at the Watchtower, a Wizard at the Wizard's Tower, a Hearthkeeper at the Hearth Shrine. A villager studies nowhere.
- **What a lesson takes.** Hours and a fee by how advanced it is: **2 hours and 50 wealth, 6 and 150, or 12 and 400**. It needs a class level and a building level, and one of the building's **seats (one a building level)**. One lesson at a time for each citizen. Stopping gives the seat and the whole fee back. The citizen still works and can be sent out while they study.
- **What is learned is the citizen's for good.** An extra ability joins its school: it comes to every battle while they are that class, and is among what that class taught them when it is their second school. A passive goes in their **one passive slot**, chosen at home among those they know, whatever class they are now (the first one learned goes straight in).

| School (building) | Extra abilities | Passives |
|---|---|---|
| Arms (Watchtower, a Guard) | **Second Wind** (level 3): heal yourself, once a battle. **Cleave** (level 8, building 2): a wide swing at every foe beside you. | **Brace** (level 3): the first hit each round does a third less. **Counter** (level 6, building 2): struck by a foe beside them, they strike back at half strength, once a round. |
| Archery (Watchtower, an Archer) | **Venom Arrow** (3): a barbed arrow that poisons. **Expose** (8, building 2): hits on that foe land harder. | **Light Feet** (3): walks one tile further. **Keen Eye** (6, building 2): Archery reaches one tile further. |
| Wild magic (Wizard's Tower) | **Weaken** (3): a hex, that foe hits less hard. **Deep Freeze** (12, building 3): a foe loses its next turn, once a battle. | **Focus** (3): Wild magic a tenth stronger. **Quick Hands** (6, building 2): Wild magic ready a turn sooner. |
| Hearth magic (Hearth Shrine) | **Searing Brand** (3): it burns, and the foe hits less hard. **Mending Song** (8, building 2): heals everyone near a little, twice a battle. | **Warm Hands** (3): healing 15% stronger. **Deep Embers** (6, building 2): one more use of what is counted a battle. |
| Any of the three, to a citizen of its class | | **Sure-footed** (2): jumps one step higher. **Tough** (4): a tenth more health. |

- **Brace and Counter are rules of the board** (both copies of the engine; a unit carries `passive`). Brace takes a third off the first hit a unit takes each round. Counter answers a hit from a foe standing next to the unit with its Attack at half strength, once a round, and **never fells** (the striker is left with 1): that keeps a unit from being struck down in the middle of its own turn. Both are ready again when the unit's turn starts. Old battles replay the same. Foes can be given either later (a boss that counters).
- **The other eight change the unit as it is built** (reach, a step, health, a tenth of magic, a turn of waiting, a use).
- **Where it shows.** The citizen's Abilities tab has a **Passive** part (the ones learned, and None) and a **Study** part (the building, its level and seats, each lesson with what it is, what it takes, and a button or the reason it is closed; a lesson under way has a countdown and Stop). In a battle the citizen's card names their passive, "Counter!" and "Braced" float over the board, and a studied ability is in its school's tab. The town's news says when a lesson is finished. Dev Tools → 💀 Dungeons → **Finish studies now**.
- **API.** `GET /api/tactics/study/:id`, `POST …/study/:id { lesson }`, `POST …/study/:id/cancel`, `POST …/study/:id/passive { key }`, `POST /api/tactics/admin/study/finish`. Tables `citizen_lessons`, `citizen_study`; `citizens.passive`.
- **Order of the sums on an ability:** the citizen's stats, gear, the passive, three-quarters for a second school, a fifth for mastery.
- **To add a lesson:** one line in `LESSONS` (and, for a new ability, a `def` in `lib/class_abilities.js`). A passive that only changes numbers is two lines in `abilityOf`/`partyUnit`; one that changes the rules is an engine change in both copies.
- **Left for later:** Thunderclap, Bulwark, Quick Jab, Rally and Smoke Bomb are in the catalogue and taught nowhere yet.

**The Attack (the owner, 2026-11-27).** Everyone has one Attack, on a button of its own above their abilities (key A), and it is not an ability: it is on no ladder, in no tab, and cannot be brought as a second school's.

| Class | Attack | At the same stats (12s, combat 4) |
|---|---|---|
| Guard | Strike: a hard melee blow | 17 |
| Archer | Shoot: an arrow, two to five tiles | 16 |
| Villager | Swing: whatever is to hand | 15 |
| Wizard, Hearthkeeper | Knock: a feeble blow with what they hold | 7 |

- **It is the class's, not the weapon's.** A Guard and an Archer are fighters and their Attack hits well; a Wizard or Hearthkeeper swinging a staff or a lantern does less than half that, and less than their own first spell. The weapon then shapes it by kind (a polearm reaches two tiles, a hammer hits harder, a longbow reaches further).
- **So a ladder is an Attack and nine abilities** for a Guard or an Archer (their Strike and Shoot were two of the ten), and ten abilities for a Wizard or Hearthkeeper, whose first spell stays an ability.
- **An Archer has no melee blow** (the plain Swing everyone had since stage A is gone). Standing next to a foe they must step away, use Parting Shot, or carry a short bow, which is what the short bow is for.
- **A villager's Swing is close to a Guard's Strike at equal stats.** In play villagers have less strength and combat skill, so it is weaker; if it reads as too good, lower the formula in `lib/class_abilities.js`.
- Code: `ATTACK`, `attackKit`, `knownAt` in `lib/tactics_setup.js`; the unit's first ability has `attack: true`; `v_knock` in `lib/class_abilities.js`; the button and `attackOf` in `js/tactics.js`.

**Stage C as built: what a citizen carries (`lib/gear_kinds.js`).** The numbers on gear always counted (a weapon's combat bonus, the few with dice, armour). Now the **kind** does one clear thing:

| Kind | Items today | What it does |
|---|---|---|
| Sword | Iron and Steel Sword, Falchion, Obsidian and Mithril Blade | Arms abilities are ready a turn sooner (never below every other turn) |
| Hammer | War Hammer | Arms blows, and the plain blow of Basics, land a quarter harder; its wielder walks one tile less |
| Polearm | Halberd | Melee Arms blows reach two tiles |
| Dagger | Iron Dagger | A blow from behind does double, where any other does half as much again |
| Short bow | Shortbow, Composite Bow | An Archery shot can be loosed at a foe standing next to you |
| Longbow | Longbow, Heartwood Longbow | Archery reaches one tile further |
| Staff | **Oak, Rowan and Heartwood Staff (new; a carpenter makes them at the workshop, levels 3, 10 and 18)** | Wild magic is a fifth stronger (the Wizard's) |
| Lantern | **Ember Lantern, Brass Hearth-lantern, Everburning Lantern (new, 2026-11-27; a blacksmith makes them at the smithy, levels 3, 10 and 18)** | Hearth magic is a fifth stronger (the Hearthkeeper's: a coal from the town's hearth, carried) |
| A shield (its own slot) | Wooden Buckler, Iron Shield, Tower Shield | Arms blocks are stronger by 3, 5 or 8 |

- **They read the school of the ability, not the class of the citizen.** So they hold for a second school: a Guard who carries a lantern heals better with borrowed Hearth magic, and gives up what a sword would do for their own blows. This is the owner's "a guard using heal with no staff… is vastly less effective than a fully trained and equipped healer": in a trial, a Guard's borrowed Kindle is 9, with a lantern 12, and an equipped Hearthkeeper's 17 or more.
- **An item made in Dev Tools gets its kind from its name** (anything with "bow", "staff", "blade"…), so nothing has to be registered.
- **Order of the sums:** the citizen's stats, then gear, then three-quarters for a second school, then a fifth for mastery.
- **Where it shows.** A citizen's Abilities tab has a Gear part: what they hold, what it does, and a guide to every kind. In a battle their card names the weapon and shield. The numbers and reaches on every ability already include it.
- **One change to the rules of the board** (both copies of the engine): an ability may carry its own worth for a blow from behind (`a.back`); with none it is the usual half as much again. Old battles replay the same.
- **Two hands (the owner, 2026-11-27).** A hammer, a polearm, a bow and a staff take both hands, so no shield goes with them; a sword, a dagger and a lantern take one. Equipping a two-handed weapon sends the shield back to the stores, equipping a shield sends a two-handed weapon back, and the game says so (`routes/inventory.js`). A shield somehow still carried with one does nothing in a fight and the Abilities tab says it is on their back.
- **For the day gear is drawn on citizens (the owner, 2026-11-26).** Every unit in a battle's setup carries `gear: { weapon, shield, armour }`, each with the item's `key`, `name` and `icon`, and the weapon its `kind`. The board draws nothing from it today; it is what a sprite layer would read. The kinds are the natural unit of art: seven weapon silhouettes and a shield cover every item, with per-item tints or swaps later. Outside battle, `careers.combatDeltas` gives the same by citizen.

**Known cost.** A level 20 fighter now brings ten abilities and five more; the skulls were tuned for five. More choice is not much more power (one action a turn), but orange and above should be re-simulated once stage C is in.

### The shape of it

- **A citizen knows abilities and readies five for a battle.** Knowing is permanent and belongs to the person; readying is a choice made at home, kept until changed. This is the "prepared" idea, moved from the town's cards to the citizen.
- **The catalogue already exists.** All 59 class cards have formulas; twenty are in the kits above and the rest (Stand Fast, Hammer Blow, Aimed Shot, Hail of Arrows, Fireball, Deep Freeze, Chain Lightning, Banish the Blight, Rekindle and the others) each need only their board facts.

### Five ways to learn, each on a system that exists

| Way | How it works | Stands on |
|---|---|---|
| **Class level** | **Built.** Each class has a ladder of ten: two to begin with, then one at levels 2, 4, 6, 8, 10, 13, 16 and 20. | Careers and their levels |
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
| **Ground that matters** | Trees give cover from arrows to whoever stands beside them; shallow water and mud cost two steps; high ground already counts. | **Built 2026-11-28** (§7a) |
| **The year on the board** | Winter freezes rivers (walkable) and snow slows; spring floods the fords; autumn leaves hide a unit that has not moved. | **Built 2026-11-28** (§7a) |
| **Other ways to win** | Hold the gate for six rounds; get the cart across; protect a villager; break the totem. | Yes, with raids (below) |
| **Raids on your own town** | The raid is fought on a map made from the town: the walls and the Watchtower are the terrain, the defenders are who is on watch. | Yes: it makes walls and guards mean something you can see |
| **Bosses that use the board** | Old Snapjaw drags a citizen into the water; the Storm Matriarch takes the high ground; Grum throws boulders that stay as rocks. | Yes, one trick each |
| **Placing the party** | Choose the four starting tiles before the fight. | **Built 2026-11-28** (§7a) |
| **Foes out of stories** | The owner's rule is only "no animals on four legs". So beside the bands: a centaur lancer who charges in a line, bramble sprites that tangle, a troll under the bridge, a will-o'-the-wisp that lures a citizen a tile. One or two for each land, as elites or events. | Yes, in Phase 6, a few at a time with their art |
| **Kin and bonds** | Kin standing side by side block a little more (decided 2026-11-18 for cards). | Yes, as adjacency |
| **Speed** | A ×2 switch for creature turns; "let them fight" for a battle far below the party's level. | Yes, both, before players see it |
| **Night battles** | Bows reach less in the dark unless someone carries a lantern. | Later |
| **Magic points, charge times** | The genre's bookkeeping. | No: cooldowns do the job and read at a glance |
| **Friendly fire** | Bursts hurt friends. | No: wrong tone for this game |
| **Bigger battles** | Six a side, larger maps. | No: five minutes is the promise. Ten by ten for bosses at most |

## 7a. The board itself (built 2026-11-28)

Decided by the owner on 2026-11-28: the board next, the season on it in all four seasons, and the party placed before every fight. The rules are in the engine (`tactics_engine.js`, its header says each in a line); the proof is `scripts/tactics_ground_test.js` on the server (46 checks, no database) and section 20 of the frontend's `verify/tactics_proofs.js`.

**Ground.** Three things about ground matter, and no more: height (as before), slow ground, and cover.

| Kind | What it does | Where |
|---|---|---|
| Shallows 🌊 | two steps to walk into | the fords of a stream; meltwater on bare stone in spring |
| Mire 🟤 | two steps to walk into | the marsh (four patches), a little by the river; anywhere after the spring thaw |
| Deep snow ❄️ | two steps to walk into | five drifts on every winter map |
| Ice 🧊 | walks as open ground | all water, in winter |
| Fallen leaves 🍂 | walks as open ground; hides (below) | up to six tiles beside the trees, in autumn |
| Tree 🌳, rock 🪨 | cannot be entered; **cover** | as before |
| Water 💧 | cannot be crossed | as before |

*A unit can always take one step,* whatever it is into: slowed, with a hammer, in a marsh, nobody is ever stuck. The two rows each side starts on are always open, ordinary ground, in every season. The creatures' mind counts the same steps.

**Cover.** A unit with a tree or a rock beside it, on the side a shot comes from, takes a quarter less (`RULES.COVER`) from anything ranged that is loosed from more than one tile away. A shot from a diagonal counts cover on either near side. Melee is never stopped by it. The forecast says "in cover (−25%)" and the hit floats "In cover". The mind gives a little weight to standing in cover from whoever is shooting at it. *Not built, on purpose:* trees do not block a line of sight. Range in this game is counted in steps; a shot that could be blocked would need the player to judge lines on an isometric board on a phone.

**The season.** A battle's map is made for the world's season when the battle begins (`setup.season`, so a stored battle plays back on the same map whenever it is opened). Dev Tools can ask for one.

| Season | The map |
|---|---|
| Spring 🌱 | The stream runs high and keeps one ford, not two. Two more patches of mud after the thaw (meltwater shallows on bare stone). |
| Summer ☀️ | The land as it is. |
| Autumn 🍂 | Leaves lie under the trees: stand still on them to hide. |
| Winter ❄️ | All water is ice and can be walked: a river is crossed anywhere, a marsh's pools are open. The mire is frozen hard. Five drifts of snow. |

The screen colours the open ground and the trees for the season (blossom, summer green, autumn orange, snow on the boughs and the rocks) and names it in the title.

**Hidden.** A unit that ends its turn on fallen leaves, having neither moved nor struck that turn, is hidden: no foe further than one tile away can single it out. A burst or a line still catches it, and a foe that walks up to it strikes as ever (the mind does walk up). Moving, striking or being shoved shows it again; blocking, healing and waiting do not. It is drawn half seen and its card says so. It is a way to wait for a foe to come to you, or to keep a healer out of an archer's sight; it does nothing for a unit that is attacking every turn. *Owner's wording was "a unit that has not moved"; "nor struck" is this build's addition,* so an archer cannot stand on leaves and shoot all battle without being shot back.

**Placing the party.** Every battle a player fights (a dungeon's, a quest's, a practice battle) begins with placing: the board is shown with the foes where they will start, and the party may stand on any open tile of its own two rows. Tap one of yours, then a tile; tap two of yours to change places; tap a foe to see what it can do. "As suggested" puts everyone back. Nothing is sent until **Start the battle**, which is the battle's first stored choice (`{ t: 'place', at: { unit id: [x, y] } }`); the rules refuse any other choice first, and a second placing. A battle left before it was started is picked up again at the placing. A battle the game decides by itself (a quest left to be decided, the simulators) is not asked to begin with placing, and the mind keeps the places it was given.

**What it did to the numbers** (2026-11-28, `SEASON=winter node scripts/tactics_run_sim.js`, sixteen runs a line, so ±10): the skulls clear at the same rates in every season as they did before any of this (green and orange above nine in ten, purple near nine in ten). Yellow taken boldly is the weak spot it already was: 63% over forty runs, where it was about seven in ten. Nothing was retuned. The simulator's party does not place itself or use cover or leaves on purpose; a player will.

**Not built yet from this part of §7:** other ways to win, a trick for each boss, bosses that resist a stun or a shove, night battles, kin side by side.

## 8. What happened to the cards

**The owner's word, 2026-11-22:** "we can peel away/archive the card combat system we had originally planned, I am confident in tactics replacing it." And on 2026-11-25: "finish up Phase 5". The cards went in three steps.

| Step | What | State |
|---|---|---|
| 1 | Dungeons with cards could no longer be started. | Done 2026-11-22 |
| 2 | The dungeon card layer deleted (decks, the door draft, honing, the Class cards window); its test ported to board battles. | Done 2026-11-23 |
| 3 | Quest, camp, raid and clan quest battles on the board; the card battler itself deleted. | **Done 2026-11-26** |

### How a battle outside a dungeon works now

- **What it is.** A quest's, camp's or raid's fight is a row in the Battles list. **Engage** opens it on the board: the quest's own citizens, one to four of them, each in their own class with the five abilities they bring, against the foes that stand in for the quest's creatures, on the land the quest is in, with the quest's own seed. A camp assault and a sally open the same way (`startBattleFromQuest` in the frontend's `js/battles.js` is the one way in).
- **When it ends the quest is settled:** won, the quest's clock runs on from where it stopped, the fight's wealth is paid, what the foes carried goes into the stores, survivors may gain combat skill, anyone lying fallen rolls for injury, a camp or a sally is told, and class experience is paid at once and shown on the end screen; lost, the quest fails and everyone rolls.
- **A battle left to be decided** (the "decide it for me" tick when a quest is sent) and **a clan quest's battle** (which nobody plays) are **decided by the board's own mind** playing both sides from the fight's seed, out of sight (`decide`, `autoResolve` in `lib/tactics_quests.js`). No battle is kept for them.
- **How tough.** A quest's fight is a small one, so it has a tier of its own, `quest`: every foe +30% health and +20% power (`QUEST` in `lib/tactics_setup.js`; Dev Tools → Life → Quest battles). With those, the mind playing: a lone villager wins every fight with one ordinary foe in two to five rounds and about three in four with a heavy one (a Boar Bruiser); two villagers beat two Wolf Raiders 98 times in 100; four novices are never troubled. A camp assault or a sally (up to three citizens against one to four of the Withered): against two, three villagers win 98 in 100; against a full four, three villagers win 70 in 100 over a long fight, three novices in classes every time. `scripts/tactics_quest_sim.js` prints the table. A Happening that toughens creatures toughens these too.
- **Beside the rest.** A town may have a quest's battle open for each quest that waits on one, as well as its dungeon or practice battle; none pushes another aside. ✕ only steps away: the quest keeps waiting, and the list then offers "Back to the battle". Forfeiting from the list fails the quest and closes its battle.
- **The record.** A board fight leaves on the quest what the card battles left (`combat_state`, `combat_log`), so "View Battle" works: it names the foes of the board, who stood at the end and the wounds taken.
- **Who may play.** Every player: there is no switch. (Between 2026-11-25 and 2026-11-26 the board stood behind a switch, `tactics.quests`, with cards as the fallback; both are gone.) A dungeon's battle is still only for whoever may enter dungeons.
- **Where:** server `lib/tactics_quests.js` (open, settle, decide), `routes/tactics.js` (`POST /quest/:questRunId`, `GET /open`), `routes/combat.js` (the Battles list, forfeit, the report, injuries, the creature editor); frontend `js/battles.js`, `js/tactics.js`. Tests: server `scripts/tactics_quest_test.js` (39), a sally fought for real in `scripts/raid_extras_test.js`.

### What was deleted

- **Server:** the card engine and its registry (`lib/card_engine.js`, `card_combat.js`, `card_definitions.js`, `card_registry.js`, `card_formula.js`), the card collection (`lib/cards.js`), the old combat engine (`lib/combat_engine.js`, `combat-server.js`), the routes `/api/cards`, `/api/decks`, `/api/card-admin` and, in `/api/combat`, `/engage`, `/action` and `/resolve`; the replaying and deciding of card battles in `lib/combat_resolver.js` (which keeps the party and the injuries); the card editor and the old "test battle" in Dev Tools.
- **Frontend:** the card battle screen (`js/combat-ui.js`), both card engines, the card hand, the deck builder, the card collection, the card editor, their stylesheets and proofs; the Decks button and menu entry.
- **Two small rewards went with them:** a finished quest's small chance of a new card, and an Allied village teaching two cards a week for wealth. **Neither has a replacement yet**: an Allied village has one perk fewer. (A natural one, when study is built: an Allied village teaches an ability no class ladder has.)

### What was kept

- **Kept:** the classes, careers and class buildings; the ability formulas, now a plain catalogue (`lib/class_abilities.js`, which was `class_cards.js`); the citizen-as-fighter (`lib/citizen_unit.js`, the same health and stats as before); the creature list and its editor (a quest still rolls its creatures from it, and each has a foe that stands in for it on the board); injuries; loot; the Battles list; the battle report.
- **A weapon's dice count at last.** The card battles rolled a weapon's dice only for a plain attack and never for a card. On the board a weapon with dice adds their average, and its bonus, to every blow (`weaponEdge` in `lib/tactics_setup.js`). Only two weapons have dice today (the Obsidian Blade and the Mithril Blade); every other weapon counts through the combat skill it gives, as before.
- **Collected cards are simply gone.** A one-time buy-back was built on 2026-11-25 and taken out the same day at the owner's word: there are no players to pay. The card tables are left in the database, unread.
- **A battle left half-played with cards** when the server was updated starts again on the board: nobody is stranded.

## 9. The roadmap

Each phase ends with something playable.

| # | Phase | What it delivers | Size |
|---|---|---|---|
| 0 | The trial | One battle from Dev Tools. **Done.** | |
| 1 | Feel | Choosing a facing, zoom and drag, a phone on its side, hooks for art, sound and music. **Done.** | |
| 2 | The server decides | The same rules run on the server from a list of the player's choices; a battle is stored, survives a reload and cannot be cheated. **Done** (§10). | |
| 3 | **Dungeons on the board** | A dungeon's fights are tactics battles. Health and who is down carry between them; rests, loot, fleeing and the endings as now. The door pick and the card after a fight are gone. A dungeon made for the board has fewer fights; a foe leaves what it carried; the fallen lie on the board and a heal stands them up; the numbers are set for whole runs (§5). **Done (2026-11-22).** | |
| 4 | **Abilities** | Experience from battle and the ladder to level 20; then the owner's redesign of 2026-11-26 (§6): schools, the whole class kit, a second school from an old career, an Attack of its own, mastery, gear by kind, study and a passive slot, research, a family signature, village lore. **Done 2026-11-28.** | |
| 5 | **Everywhere, and the cards go** | Quests, camps, raids and clan quests on the board, with a quick result for a fight left to be decided. The card systems are removed. **Done 2026-11-26** (§8). | |
| 6 | **Content** | **Raids on a map of the town** (moved here from Phase 5: it is new content, and nothing about retiring the cards waited on it; today a raid is met by a sally, which is a battle on the board, or weathered by the town's defences). **Built 2026-11-28 (§7a): ground that matters, the seasons, placing the party.** Still to build: other ways to win; bosses that resist being stunned or pushed; a second form or a trick for each boss. **The cast is in (2026-11-21):** thirty foes in five bands with board behaviour, and the seven bosses (§4). | Large; alongside the art |
| 7 | **The way in, and polish** | Dungeons on the map, a first battle that teaches, art and sound in, tuning from real play, slow phones. **Built so far:** dungeons on the map (2026-11-25, `DUNGEONS.md` §13). | Medium; begun |

**A change of order (2026-11-25).** Phase 5 was begun, and finished, before Phase 4 was. What is left of Phase 4 (study, research, equipment, mastery) is depth; nothing a player did reached the board until Phase 5, and what players find when they fight real quests there should shape that depth. Abilities enough to replace cards existed: ten a class, five brought.

**Why this order.** Phase 2 came first, because everything after it stores results and a battle the browser decides cannot be trusted with them. Phase 3 next, because a single battle is a toy and a dungeon is the game. Abilities (4) before retiring cards (5), so there is something to replace them with. Content (6) can run beside any phase once art starts arriving.

**Decisions the owner will need to make,** none of them yet:

1. ~~**Small fights.**~~ Settled as the game already had it: it is the player's choice when the quest is sent. Left to be decided, the board's mind decides it out of sight; otherwise it waits in the Battles list as a short battle (a one-on-one is two to five rounds).
2. ~~**Dungeon length.**~~ Settled by building it: a route has 2 to 3 fights at green, 3 to 4, 3 to 5, 4 to 6, and 5 to 7 at purple (§5). Say so if a dungeon feels too short or too long in play.
3. **Who owns an ability.** Suggested above: the citizen. The other way (the town knows it and any citizen of the class can ready it) is simpler and loses the family story.
4. **Species.** Only mice have sprites, so every party is drawn as mice. The other six species are the largest art job in the game either way.

## 10. Where it is

| Piece | File |
|---|---|
| The rules: map (and its season), turns, placing, moving, ground, reach, facing, height, cover, hiding, abilities, the creatures' mind | frontend `js/tactics-engine.js` |
| The screen: the board, taps and keys, zoom, facing, animation, sound, the Dev Tools box | frontend `js/tactics.js`, `css/tactics.css` |
| The list of art and sound that exists: foe pictures, ability icons, sounds, music | frontend `scripts/pack_tactics.js` → `assets/tactics/manifest.json` |
| Is what is live what is in the repository? Run after every upload. With `--zip upload.zip` it also packs every file the site lacks into one archive to upload to the site's root and extract there, so no file is left behind | frontend `scripts/check_live.js` (`npm run check-live`) |
| Cutting a sheet of icons into one PNG each | frontend `scripts/cut_icons.py` |
| The jukebox: a public page that plays the battle music over a battle that plays itself, and takes ratings | frontend `jukebox.html`, `js/jukebox.js`, `css/jukebox.css`, `KWTactics.demo` in `js/tactics.js`; server `routes/jukebox.js`, `migrations/0NN_jukebox.sql`, `scripts/make_tactics_demo.js` (writes the frontend's `assets/tactics/demo.json`) |
| Who the party fights: the thirty foes, the bands, a dungeon's cast, the showcase fights | server `lib/tactics_foes.js` |
| The two sides: kits, levels, a foe as a unit, the skull numbers (`TIERS`, and `tierNow` for what Dev Tools has saved) | server `lib/tactics_setup.js` |
| The catalogue of abilities and their formulas; a citizen as a fighter | server `lib/class_abilities.js`, `lib/citizen_unit.js` |
| A quest's, camp's, raid's or clan quest's battle: opened, settled, decided | server `lib/tactics_quests.js` |
| The same rules on the server (kept identical to the browser's; a test compares them) | server `lib/tactics_engine.js` |
| Battles the server keeps: create, each choice, the result, leaving | server `lib/tactics_battles.js`, `migrations/0NN_tactics.sql` |
| Routes | server `routes/tactics.js` (a quest's battle and the Abilities page are every player's; a practice battle is for admins; a dungeon's battle is for whoever may enter dungeons) |
| What a battle teaches: experience by rank and skull, paid into class levels | server `lib/tactics_xp.js` |
| What a citizen knows and brings: the Abilities tab | server `lib/tactics_abilities.js`; frontend `js/abilities.js`, `css/abilities.css` |
| Numbers | server `scripts/tactics_sim.js` (one battle), `scripts/tactics_run_sim.js` (a whole dungeon), `scripts/tactics_quest_sim.js` (a quest's fight) |
| Tests | server `scripts/tactics_ground_test.js` (46: the board itself, §7a); frontend `verify/tactics_proofs.js` (272 checks), `verify/dungeons_proofs.js` (74); server `scripts/tactics_test.js` (the kits, the ladder, readying, the routes), `scripts/tactics_abilities_test.js` (17), `scripts/tactics_quest_test.js` (39), `scripts/combat_gear_test.js` (13: gear on the board), `scripts/dungeon_board_test.js` (41), `scripts/dungeons_test.js` (177: the run itself, through board battles), `scripts/jukebox_test.js` (13) |

- **The engine is pure**: no clock, no `Math.random`, no DOM. A battle is a plain object changed only by `move`, `use` and `endTurn`, and the same seed and choices always give the same battle.
- **How the server decides.** A battle is stored as its two sides, frozen when it begins, and the player's choices in order (`tactics_battles`). Creatures have no entries: their mind is part of the rules, so both sides reach the same turns from the same choices. The browser plays each choice at once, so the screen never waits, and sends it; the server plays it on top of the ones before and refuses what the rules do not allow. Every answer carries a fingerprint of the board; if the browser's differs, or a choice is refused, the screen is put back to the battle as the server has it. A choice sent twice is taken once.
- **When a battle ends** the server records who won, the rounds, and each citizen's health and who is down. Phase 3 reads that to carry wounds through a dungeon.
- **A town has one dungeon or practice battle on a board at a time** (starting a practice battle ends the practice battle before it), **and beside it one for each quest that waits on a fight** (§8).
- **A dungeon's fight keeps its run awake**: every turn taken, and opening the fight again, counts as an action for the run's idle clock (24 hours), so a long battle played in sittings is never swept away.
- **A dungeon on the board** (`lib/dungeons.js`; every run is `combat = 'board'`). The run starts with no decks and no door pick. Entering a fight room opens a tactics battle that names its run: the party as it stands (health carried in; whoever is down is left off the board) against the room's creatures, with the board's own skull numbers and the room's boost, on the dungeon's land. When the battle ends, the transaction that stores the last choice also settles the run: each citizen's health and who is down, the fight's wealth and any find, the way on; the boss clears the dungeon; a defeat ends it. ✕ on the battle only steps away (it stays open and is picked up from the dungeon's Fight button); fleeing is done from the dungeon's screen and ends the run with half the loot. A run started without `combat: 'board'` is a card run as before.
- **What finished Phase 3 (2026-11-22).** *Fewer fights:* the generator's shapes are the board's (from 2026-11-23 its only ones: `SHAPES`), and the dungeon it makes says `combat: 'board'`. *Drops:* each foe has `drops` (`lib/tactics_foes.js`): what it carried, never a part of it, so nobody leaves a hide. They are rolled from the battle's seed when a dungeon fight is won (`dropsOf`), filtered to items the database has, and join the fight's wealth in the run's loot. *The fallen:* the engine's rule (§3); `partyFor` brings a downed citizen in with `down: true`; `syncBoard` marks anyone who fell, even if healed back up, as having gone down (they roll for injury at the end without the fatal band). *The rest:* `DUNGEON_BOARD_REST`.
- **Still open after Phase 3, none of it blocking:** a practice battle gives no drops (it pays nothing by design); the hand-written test dungeons keep their longer shape (four fights on the short road), though they now name the board's foes directly; a supply item that raises the fallen (the Bandage of `DUNGEONS.md`) waits for supplies.
- Class names in the stylesheet start `kwtc-` (`kwt-` belongs to travel).
