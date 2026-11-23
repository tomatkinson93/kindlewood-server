# Tactics battles: art, sound and music to make

For `docs/TACTICS.md`. Written 2026-11-20; the cast, the icons and the effect art reworked 2026-11-21. The same file is in both repos.

Everything here has a stand-in today, so nothing blocks anything: foes are drawn as an emoji, abilities show an emoji, effects are drawn by code, older sounds fill in, and the card battles' music plays.

**How a file gets into the game.** Four kinds of file are wired up now: foe pictures (§1), ability icons (§4.1), sounds (§5) and music (§6). Put the file in the folder named, with the name given, then run this in the frontend repo:

```bash
node scripts/pack_tactics.js
```

It lists what is there in `assets/tactics/manifest.json`, and the game uses it from the next load. A half-finished set is fine. Everything else in this document is not wired yet; make it when you like and it will be put in when it exists. Each section says which it is.

## What to make, in order

| # | What | Tool | Why now |
|---|---|---|---|
| 1 | Sounds: the nineteen in §5 | freesound, Kenney, pixabay | an afternoon's work; the battle is nearly silent without them |
| 2 | ~~Music~~ | | **In (2026-11-23):** thirteen pieces. Still wanted: the hills, the ruins, a second for the meadows, winter (§6) |
| 3 | The Stoat Captain and Redtooth (§1) | PixelLab | **Five Brigands are in (2026-11-23)**; these two finish the band. Then walking for the four diagonals |
| 4 | Ability icons: the villager's and the trades' eight (§4.1) | the same generator as the classes' | **The four classes' twenty are in (2026-11-23).** These eight finish the set |
| 5 | The mouse's battle animations (§2) | PixelLab | attacks read as a nudge until these exist |
| 6 | Class looks for the mouse (§2) | PixelLab | a Guard and a Wizard look the same |
| 7 | The other four bands (§1), then the seven bosses | PixelLab | a band at a time: each is a dungeon's worth |
| 8 | Icons for what foes do (§4.1): 21 shared icons | PixelLab or a pixel editor | one set covers every foe |
| 9 | Portraits, band emblems, backdrops (§4.4) | PixelLab or ChatGPT | polish that makes it look finished. **The six status pips are in (2026-11-23)** |
| 10 | Trees, rocks and ground (§3) | PixelLab or ChatGPT | the code-drawn ones are decent |
| 11 | Effect art (§4.3) | PixelLab | last: the code-drawn effects already work, and only a few would gain |
| 12 | The other six species | PixelLab | the largest job in the game; last |

## 1. Foes

**Wired. Folder:** `assets/sprites/creatures/`

**Who they are.** Everyone in Kindlewood walks on two legs and wears clothes, and so do those who mean it harm. No animal here walks on four legs: a foe is an outlaw, a raider, one of the marsh folk, a villager the blight has hollowed out, or something out of a story (an ogre, a harpy; the owner's rule is "no four-legged animals", and anything mythical is welcome). There are 30, in five bands, and every band has someone who fights up close, someone who strikes from far off, and someone who heals or casts. The list, with what each does, is `lib/tactics_foes.js` on the server.

**In the game (2026-11-23): five of the Brigands**, from the owner's PixelLab exports: the Rat Cutpurse, Weasel Slinger, Fox Footpad, Polecat Sawbones and Boar Bruiser. They turn to face all four ways, stand at their own height beside a citizen, and show their faces in the row of who acts next. **Next to make:** the Stoat Captain and Redtooth, which finishes the band; then a band at a time.

**How a foe gets in.** Export the character from PixelLab with its **eight rotations** (that is what the five came as), unzip it into `art/tactics/foes/<key>/` in the frontend repo so that it has a `rotations` folder (`south-east.png` and the other seven), then:

```bash
python3 scripts/pack_foes.py
```

```bash
node scripts/pack_tactics.js
```

The first makes, for each foe, a sheet of the four views the board uses (south-east, south-west, north-east, north-west: a unit on the board always faces one of them, so nothing is mirrored) and a 64 × 64 face. The second lists them for the game.

**How tall it stands** is set in `art/tactics/foes/sizes.json`, in mouse-heights (a citizen is 1): the Rat Cutpurse 0.85, the Boar Bruiser 1.3, a boss about 1.9. The art can be drawn at any size; the game scales it to that height. Add a line there for each new foe (the "Small / as tall as / twice the mouse's height" in the tables below).

**Walking.** PixelLab's walking comes facing north, east, south and west, and the board needs the four diagonals, so today a foe hops along in its standing pose. **Export walking for south-east, south-west, north-east and north-west** (PixelLab offers all eight) and it can be wired; the cardinal walks that came with the five are kept in `art/tactics/foes/<key>/walking/` and not used.

**Size and style:** a 128 × 128 canvas, transparent background, the foe standing in the middle. Pixel art in the same style as the mouse villager: a 1-pixel dark brown outline, flat shading in three or four tones, a warm storybook palette. The size it is drawn at does not matter: its height on the board is set in `sizes.json` (above).

**Tone:** fierce, never gory. Rogues from a picture book, not monsters. The Withered are sad more than frightening.

**Telling friend from foe.** Some foes are of a kind a player can be (a fox, a rat). So each band has one thing every member wears, in a colour no citizen's class uses, and it should be the first thing the eye finds:

| Band | Its mark | Where they are met |
|---|---|---|
| The Redtooth Brigands | a **red neckerchief** or red sash; patched brown leather | plains, forest, hills; stragglers by rivers and in ruins |
| The Night Pack | **blue war paint** on the face and arms; grey hide and bone | forest, hills, mountain |
| The Crag Reavers | a **black leather harness** with brass rings; storm-grey cloth | mountain, hills |

For an ogre or a harpy, change the opener's "An anthropomorphic woodland animal standing upright on two legs like a person, wearing clothes" to "A storybook [ogre / harpy], standing upright, wearing clothes" and keep the rest.
| The Mire Folk | a **cloak of woven green reeds**; a small glowing fungus lantern | marsh, river |
| The Withered | **grey, dull fur and hollow eyes with a dim green glow**; the torn, faded clothes of a villager | ruins, marsh, the deep forest |

**In PixelLab**, attach the mouse's idle sheet as the style reference every time, make the character at a three-quarter top-down ("high top-down") view with **eight directions**, and export the whole character. Start each with this, unchanged:

> Pixel art game sprite for a tactics battle, three-quarter top-down view from above and in front. An anthropomorphic woodland animal standing upright on two legs like a person, wearing clothes, the same build and proportions as the attached mouse villager. Full body, standing still, weapon in hand, facing down and to the left towards the viewer. Chunky, readable silhouette. One-pixel dark brown outline (#2a180c), flat cel shading with three or four tones per colour, warm storybook palette, the same style and pixel size as the attached mouse villager. A storybook rogue: fierce but charming, not gory. Transparent background, no ground, no shadow, no text.

Then the foe's own line from the tables.

"Stands in for" is the creature of the card battles whose place the foe takes on the board, so a dungeon written for cards still works.

### The Redtooth Brigands

| File key | Foe | What it does | Its line |
|---|---|---|---|
| `rat_cutpurse` | Rat Cutpurse (minion; stands in for the Marsh Rat) | quick; a shiv | A scrawny brown rat in a patched hooded jerkin, a red neckerchief pulled up over the nose, a short curved knife in one paw and a small coin purse on the belt. Long pink tail, one notched ear. Small: three quarters of the mouse's height. |
| `weasel_slinger` | Weasel Slinger (minion) | **ranged**: sling stones | A long thin weasel in a sleeveless leather vest and a red neckerchief, whirling a leather sling over one shoulder, a pouch of stones at the hip. Narrow sly eyes. As tall as the mouse, and slimmer. |
| `fox_footpad` | Fox Footpad (stands in for the Wild Fox) | a cutlass; throws sand (weakens) | A lean red fox with a black cloth mask over the eyes, a red sash round the waist, a patched brown coat with the collar up, a notched cutlass in one paw and the other paw closed on a fistful of sand. A sly grin. A little taller than the mouse. |
| `polecat_sawbones` | Polecat Sawbones | **heals** its friends; throws stinging tonic | A dark-masked polecat in a stained leather apron over a shirt with rolled sleeves, a red neckerchief, round spectacles, a leather satchel of bottles and bandages, holding a small corked green bottle ready to throw. As tall as the mouse. |
| `boar_bruiser` | Boar Bruiser (heavy; stands in for the Thornback Boar) | a maul; a charge that knocks back; braces | A stocky wild boar standing upright, in a leather jerkin studded with iron spikes along the shoulders and back, a red sash, two curved tusks, small angry eyes, a heavy wooden maul over one shoulder. One and a third times the mouse's height, and broad. |
| `stoat_captain` | Stoat Captain (elite) | two blades; a low blow; **rallies** the band | A proud stoat in a long faded blue coat with brass buttons, a wide hat with a red feather, a red sash, a slim sword in each paw. Chin up, a scar across the muzzle. One and a quarter times the mouse's height. |
| `redtooth` | Redtooth, the Brigand King (boss, plains) | twin cutlasses; throwing knives; barks orders | A big scarred stoat in a stolen crimson coat with gold braid, far too fine for him, a dented gold circlet tipped over one ear, one front tooth capped in red metal, a broad cutlass in each paw, knives across the chest. Fills the frame: twice the mouse's height. |

### The Night Pack

| File key | Foe | What it does | Its line |
|---|---|---|---|
| `wolf_raider` | Wolf Raider (stands in for the Night Wolf) | a hatchet; a howl that **emboldens** the pack | A charcoal-grey wolf standing upright in rough hide armour laced with bone toggles, blue war paint in stripes across the muzzle and forearms, a hatchet in one paw, head thrown slightly back. Pale blue eyes. One and a third times the mouse's height. |
| `wolf_bowhunter` | Wolf Bowhunter | **ranged**: a shortbow; a shot that slows | A lean grey wolf in a hooded hide cloak, blue war paint across the eyes like a band, a short horn bow drawn half back, a quiver of grey-feathered arrows on the back. One and a quarter times the mouse's height. |
| `pack_chieftain` | Pack Chieftain (elite) | a greataxe; cleaves all round; howls | A huge dark wolf in a mantle of pale fur and a necklace of teeth, a bone pauldron on one shoulder, blue war paint over half the face, a long two-handed axe held across the body. One and two thirds times the mouse's height. |
| `greyfeather` | Old Greyfeather (boss, forest) | talons; **casts** moonbolts; a swoop on everyone near | A vast grey owl standing upright in a long midnight-blue cloak stitched with small silver stars, a tall staff of twisted wood topped with a crescent moon, huge round amber eyes, wings half open under the cloak. Fills the frame: twice the mouse's height. |

### The Crag Reavers

| File key | Foe | What it does | Its line |
|---|---|---|---|
| `mountain_harpy` | Mountain Harpy | fast and leaps high; talons; a shriek that weakens | A harpy: a fierce bird-woman with brown-grey wings for arms, a feathered body, a sharp hooked nose like a beak and wild feathered hair, in a black leather harness with brass rings and a short storm-grey kilt, a hooked knife strapped to each taloned heel, wings half spread. One and a third times the mouse's height. |
| `crow_stormcaller` | Crow Stormcaller | **casts**: a spark lash; a gale that slows a whole row | A black crow in a ragged storm-grey cloak and a black leather harness, a copper rod with a forked tip raised in one wing-hand, small sparks at its tip, a string of copper charms round the neck. As tall as the mouse. |
| `hill_ogre` | Hill Ogre (heavy) | slow; a club; a ground slam that stuns | A big pot-bellied ogre with mossy green-grey skin, in a patched hide kilt and a black leather shoulder strap, a tree-branch club over one shoulder, a small head with one tusk and a bored look. Fills most of the frame: one and three quarters times the mouse's height. |
| `stormcrow` | Stormcrow (elite) | dives; **casts** lightning and a thunderclap over an area | A great raven in a high-collared mantle of black feathers over a black harness, wingtips crackling with pale blue sparks, a crown of copper wire, eyes glowing white-blue. One and a half times the mouse's height. |
| `storm_matriarch` | The Storm Matriarch (boss, mountain) | dives; a gale; a shriek | A harpy queen: a tall bird-woman with great storm-grey wings spread wide, wind lines curling off them, a mantle trimmed with white feathers, a silver circlet in wild feathered hair, a black harness set with a blue stone, a fierce golden glare. Fills the frame: twice the mouse's height. |
| `grum` | Grum, the Ogre Chief (boss, hills) | a great club; **throws boulders** over an area; a roar | An enormous ogre with grey-green skin, a breastplate made from a cart wheel strapped on with black leather, a necklace of brass rings, a whole young tree for a club, one ear torn, two tusks, small bright eyes. Fills the frame: twice the mouse's height and very broad. |

### The Mire Folk

| File key | Foe | What it does | Its line |
|---|---|---|---|
| `newt_darter` | Newt Darter (stands in for the Bog Lurker) | **ranged**: a blowpipe of venom darts (poison); a bone knife | A slim dark green newt with an orange belly, standing upright in a short cloak of woven green reeds, a long reed blowpipe raised to its mouth, a bandolier of small feathered darts, bulging eyes. As tall as the mouse. |
| `toad_sporecaller` | Toad Sporecaller (stands in for the Fungal Toad) | **casts** a spore cloud over an area (poison); a staff | A fat brown toad standing upright in a reed cloak and a wide hat with red-and-white toadstools growing on it, a gnarled staff with a glowing green puffball on top, half-closed eyes, a wide flat mouth. As tall as the mouse and twice as wide. |
| `heron_lancer` | Heron Lancer (stands in for the River Pike) | a long spear that reaches two tiles and through a row | A tall grey heron standing upright in a short reed cape and a rope belt, a long fishing spear held level in both wing-hands, a black crest feather, a thin yellow beak, cold patient eyes. One and a half times the mouse's height, and thin. |
| `snapper_shellback` | Snapper Shellback (heavy) | a bite; pulls into its shell (a lot of block) | A snapping turtle standing upright, its shell studded with iron and hung with reed netting, a hooked beak, thick scaly arms, a small green lantern hanging from the shell's rim. One and a quarter times the mouse's height, and wide. |
| `bog_witch` | Bog Witch (elite) | **casts** hex bolts and a curse over an area; **heals** with a foul brew | An old warty toad standing upright in a tall hat of woven reeds and a ragged shawl, a lantern with a purple flame on a crooked pole in one hand and a small steaming black pot in the other. One and a quarter times the mouse's height. |
| `old_snapjaw` | Old Snapjaw (boss, river) | a snap; a thrash; an anchor on a chain that stuns | An ancient snapping turtle standing upright, its mossy shell hung with old toll-chains and a brass bell, a rusted anchor on a heavy chain swung in one hand, one eye clouded white, a jaw like a trap. Fills the frame: twice the mouse's height and broad. |
| `bog_mother` | The Bog Mother (boss, marsh) | a slam; a tongue lash; a spore storm; heals herself | An enormous pale green toad queen sitting upright on a low throne of roots, a crown of red toadstools, a reed robe spread round her, heavy-lidded golden eyes, a glowing puffball sceptre. Fills the frame: twice the mouse's height and wider than tall. |

### The Withered

For every Withered, add to the opener: "A villager hollowed out by a blight: dull grey fur, hollow eye sockets with a dim green glow, dead leaves and small pale fungus on the shoulders, clothes faded and torn. Sad more than frightening."

| File key | Foe | What it does | Its line |
|---|---|---|---|
| `hollow_thrall` | Hollow Thrall (stands in for the Withered Husk) | slow; claws; a rotting touch (vulnerable) | A withered vole villager in a torn apron and one remaining boot, arms hanging, one paw reaching forward, head tilted. A little taller than the mouse. |
| `hollow_bowman` | Hollow Bowman (minion) | **ranged**: bone arrows | A thin withered shrew in the rotted tabard of a town watch, a cracked longbow in hand, an arrow of pale bone on the string, a dented kettle helm. As tall as the mouse. |
| `rot_shaman` | Rot Shaman | **casts** hexes; **heals** its kin | A hunched withered shrew in a ragged moss-green hood and mouldering robes, a crooked staff hung with small bones and a lantern of sickly green light; its face in shadow except the glow of the eyes. As tall as the mouse. |
| `husk_brute` | Husk Brute (heavy) | a smash; rot breath down a row (poison) | A withered badger blacksmith twice the size it was, a scorched leather apron, a cracked anvil-hammer in one swollen arm, pale mould breathing out of its mouth like mist. One and two thirds times the mouse's height. |
| `husk_knight` | Husk Knight (elite) | a cleaver; a shield; reaps all round | A withered hare in rusted plate armour over grey fur, a torn green surcoat, a notched cleaver in one hand and a round shield furred with mould in the other, a helm with one broken ear-guard. One and a half times the mouse's height. |
| `hollow_king` | The Hollow King (boss, ruins) | a rusted blade; a wail; a crown of rot over an area | The tall, thin, withered figure of a long-dead mouse king: a rusted crown, the rags of a purple royal cloak trailing, a long pitted sword point-down in both hands, the green glow strongest in the chest. Solemn, bowed head. Fills the frame: twice the mouse's height. |

**A good first batch:** the six Brigands. They are the commonest foes, they are what the practice box shows first, and they prove the style (an upright animal in clothes with a band mark) before the other twenty-four are made.

**Later:** a short attack pose and a flinch for each foe (two more pictures per view), so a foe swings its weapon in place of sliding forward. Not wired; say when the stills are in and it will be.

## 2. Citizens in a battle

**Not wired yet.** Citizens are drawn from the villager sheets (`assets/sprites/villagers/`), which have standing and walking in eight directions for the mouse. Made the same way as the mouse's other animations (PixelLab; GIFs into `art/villagers/mouse/`, then the sprite packer; `docs/ART_GUIDE.md`).

**Battle animations**, each for the mouse facing **south-east** and **north-east** (the other two diagonals are mirrored), 6 frames, the same frame size as the walk:

| File (`art/villagers/mouse/`) | Ask for |
|---|---|
| `strike_se.gif`, `strike_ne.gif` | "attacking: draws a short blade back and swings it forward in one cut, then returns to standing" |
| `shoot_se.gif`, `shoot_ne.gif` | "shooting a bow: raises a short bow, draws the string, looses, lowers it" |
| `cast_se.gif`, `cast_ne.gif` | "casting a spell: lifts both paws, a small glow gathers between them, thrusts it forward" |
| `guard_se.gif`, `guard_ne.gif` | "bracing: crouches slightly and raises one arm across the body as if behind a shield, holds" (4 frames) |
| `hurt_se.gif`, `hurt_ne.gif` | "taking a hit: flinches backward, then recovers" (4 frames) |
| `down_se.gif` | "collapsing: staggers, drops to the knees and lies down" (6 frames; one direction is enough). **Needed more now:** a citizen who goes down stays on the board, lying, until healed. Today the standing sprite is turned on its side and greyed; the last frame of this would replace it. |
| `cheer_s.gif` | already asked for in the art guide; reused for a victory |

**Class looks.** Today a class is a coloured dot beside the health bar. The real answer is the mouse dressed for each class, as its own set of sheets: standing and walking first, the animations above after.

| Folder | The look |
|---|---|
| `art/villagers/mouse_guard/` | A round wooden shield on the left arm, a short blade, a simple iron cap. Steel blue. |
| `art/villagers/mouse_archer/` | A short bow in hand, a quiver on the back, a green hood. |
| `art/villagers/mouse_wizard/` | A pointed soft hat with a bent tip, a long robe, a staff with a small crystal. Violet. |
| `art/villagers/mouse_hearthkeeper/` | A warm orange shawl and a small hanging lantern on a short crook. |

The opener for each: "The attached mouse villager, unchanged in size, proportions and colours, now wearing and carrying: [the look]. Same pixel art style, same outline, same eight directions."

## 3. The ground, trees and rocks

**Not wired yet.** The board is drawn by code: flat diamond tiles in three shades of a ground colour, a round-topped tree and a grey rock. They are decent; this is polish.

If made, for PixelLab or ChatGPT with the mouse attached for style:

> Pixel art for an isometric tactics board, viewed from above at the classic two-to-one angle. [The thing.] One-pixel dark brown outline, flat cel shading, warm storybook palette, matching the attached mouse sprite. Transparent background, no shadow.

| File (`assets/sprites/tactics/`) | The thing |
|---|---|
| `tile_grass.png`, `tile_mud.png`, `tile_stone.png`, `tile_water.png` | "One ground tile as a flat diamond 64 pixels wide and 32 tall with a 16-pixel earth edge below it: [meadow grass with a few darker tufts / wet brown mud with a puddle / grey flagstones with moss in the cracks / still blue water with two pale ripples]." Three variants of each if possible. |
| `tree_1.png`, `tree_2.png` | "A small round-crowned woodland tree on a short trunk, about 64 pixels tall, standing on nothing." One leafy, one a pine. |
| `rock_1.png`, `rock_2.png` | "A mossy grey boulder about 36 pixels wide and 28 tall." |
| `reeds.png`, `stump.png`, `pillar.png` | "A clump of marsh reeds", "a tree stump with an axe cut", "a broken stone pillar from a ruin". |

## 4. Icons, effects and the rest of the board's art

### 4.1 Ability icons

**Wired. Folder:** `assets/tactics/icons/`. One PNG for each ability, **named by the ability's key** (`g_strike.png`). It replaces the emoji on the ability's button and in the list of what a unit can do.

**In the game (2026-11-23):** all twenty of the Guard's, Archer's, Wizard's and Hearthkeeper's, from the owner's four sheets. Still to make: the eight for a villager and the trades, and the twenty-one for what foes do (both below).

**From a sheet to icons.** A generator gives a row of icons on white. This cuts the row into one PNG each, takes the white away from around each icon (and only from around it: a snowflake keeps its white), and sets each square at 64 pixels:

```bash
python3 scripts/cut_icons.py the-sheet.png assets/tactics/icons g_strike g_shield g_cover g_shove g_heavy
```

```bash
node scripts/pack_tactics.js
```

The names are the icons from left to right. The sheets themselves are kept in `art/tactics/icons/`. (Status pips: the same, into `assets/tactics/status`, with `--size=48`.)

**Size and style:** drawn large and cut down to 64 × 64 (the sheets that worked were about 350 pixels an icon), on plain white, which the cutter removes. One bold shape that reads at a glance, a 1-pixel dark brown outline (#2a180c), flat shading in two or three tones, and one main colour for each class so a kit reads as a set: **steel blue** for the Guard, **leaf green** for the Archer, **violet** for the Wizard, **warm orange** for the Hearthkeeper, **straw yellow** for a Villager, **red-brown** for what foes do. No letters or numbers.

Make them five to a sheet and cut them apart. The opener:

> A sheet of five pixel-art ability icons in a row with clear gaps between them, each 32 × 32 pixels, for a cosy storybook tactics game. Each is one bold, simple object or gesture that reads at small size, centred, with a one-pixel dark brown outline (#2a180c) and flat cel shading in two or three tones. Main colour: [the class colour]. Transparent background, no frame, no text, no numbers. The five, left to right: [the five lines].

**The Guard** (steel blue)

| File | Ability | What the icon shows |
|---|---|---|
| `g_strike.png` | Strike | a short sword swung in a downward cut, a white arc behind the blade |
| `g_shield.png` | Shield Up | a round wooden shield with an iron boss, raised, facing the viewer |
| `g_cover.png` | Cover | a shield held out in front of a small second figure's outline |
| `g_shove.png` | Shove | an open paw pushing forward, with three short speed lines |
| `g_heavy.png` | Heavy Blow | a sword held high in both paws, a starburst where it will land |

**The Archer** (leaf green)

| File | Ability | What the icon shows |
|---|---|---|
| `a_shoot.png` | Shoot | a bow drawn back with one arrow on the string |
| `a_side.png` | Sidestep | a pair of boots mid-hop to one side, a curved arrow showing the dodge |
| `a_part.png` | Parting Shot | an arrow flying one way and a small footprint stepping the other |
| `a_pierce.png` | Piercing Arrow | one long arrow passing through two rings in a line |
| `a_mark.png` | Mark | a red target ring with a small cross in the centre |

**The Wizard** (violet)

| File | Ability | What the icon shows |
|---|---|---|
| `w_spark.png` | Spark | a small jagged bolt of yellow-white light |
| `w_ward.png` | Ward | a thin glowing dome over a small star |
| `w_bolt.png` | Firebolt | a streak of orange fire with a bright head, flying up and to the right |
| `w_burst.png` | Ember Burst | a ring of five embers bursting outward from a bright centre |
| `w_chill.png` | Chill | a pale blue six-pointed snowflake with a cold mist curl |

**The Hearthkeeper** (warm orange)

| File | Ability | What the icon shows |
|---|---|---|
| `h_cinder.png` | Cinder | a glowing coal in flight with a short trail of sparks |
| `h_ward.png` | Hearth Ward | a shield shape made of a warm flame |
| `h_kindle.png` | Kindle | a small heart with a flame inside it |
| `h_steady.png` | Steady Now | a lantern with soft rings of light spreading from it |
| `h_bold.png` | Embolden | a small banner on a pole with an upward arrow of light behind it |

**A Villager and their trade** (straw yellow)

| File | Ability | What the icon shows |
|---|---|---|
| `v_swing.png` | Swing | a wooden rolling pin or stick mid-swing |
| `v_duck.png` | Duck | a small figure crouched low with a line passing over its head |
| `t_tool.png` | Tool of the Trade | a crossed pickaxe and pitchfork |
| `t_spot.png` | Spot the Weakness | an eye with a small red target mark beside it |
| `t_shore.png` | Shore Up | two planks nailed across each other |
| `t_ration.png` | Share Rations | a loaf of bread torn in two |
| `t_drink.png` | Strong Drink | a wooden tankard with foam on top |
| `t_signs.png` | Read the Signs | an open book with a paw-print on the page |

**What foes do** (red-brown). A foe's ability with no icon of its own takes the one for how it looks, so these twenty-one cover all thirty foes. Each is named `look_<look>.png`:

| File | Used by | What the icon shows |
|---|---|---|
| `look_slash.png` | cutlasses, hatchets, cleavers | a curved blade with a white cut-arc |
| `look_claw.png` | talons, claws, bites | three red parallel claw marks |
| `look_smash.png` | mauls, clubs, cleaving swings | a heavy hammer head striking, with a shock ring |
| `look_quake.png` | Ground Slam | a fist on cracked ground with two small stars |
| `look_thrust.png` | spears, the tongue lash | a spear point thrust straight forward, speed lines behind |
| `look_arrow.png` | bows | a grey-feathered arrow in flight |
| `look_stone.png` | Sling Stone | a sling with a stone leaving it |
| `look_dart.png` | venom darts, throwing knives | a small dart with a red feather and a green drop on its tip |
| `look_vial.png` | Stinging Tonic | a round corked bottle of green liquid, tumbling |
| `look_boulder.png` | Boulder, Anchor Chain | a large grey rock in the air with a shadow below |
| `look_sand.png` | Pocket Sand | an open paw scattering a fan of sand |
| `look_spark.png` | Spark Lash, Lightning | a forked blue-white lightning bolt |
| `look_thunder.png` | Thunderclap | a dark cloud with a bolt striking down |
| `look_gale.png` | Gale | three curling lines of wind |
| `look_hex.png` | Hex, Hex Bolt, Moonbolt | a purple orb with a small crescent inside |
| `look_curse.png` | Curse, Rotting Touch, Crown of Rot | a dark candle with a purple flame and a drooping line |
| `look_spores.png` | Spore Cloud, Rot Breath | a red toadstool puffing a green cloud |
| `look_wail.png` | howls, shrieks, wails | an open muzzle with three spreading sound rings |
| `look_cheer.png` | Rally, Bark Orders | a raised fist in front of a small red flag |
| `look_shield.png` | Brace, Mantle, shells | a battered round shield, braced |
| `look_heal.png` | Patch Up, Dark Mend, Foul Brew | a bandage roll with a small green cross |

### 4.2 Status pips

**Wired, and in (2026-11-23).** A unit under an effect shows its pip above the health bar with how much of it, and beside its name in the unit's card. **Folder:** `assets/tactics/status/<status>.png` (`weak`, `vulnerable`, `slow`, `poison`, `stun`, `bold`), cut from one sheet with `scripts/cut_icons.py`. A status with no picture keeps its glyph. For a new set: 16 × 16 pixels as drawn on the board, transparent, readable on any ground colour, so each has a dark outline and one bright colour.

> A sheet of six pixel-art status icons in a row with gaps, each 16 × 16 pixels, for a storybook tactics game. Very simple, one shape each, one-pixel dark brown outline, one bright flat colour each, transparent background, no text. Left to right: [the six].

| File | Status | What it shows |
|---|---|---|
| `weak.png` | Weak (hits softer) | a drooping purple arrow pointing down |
| `vulnerable.png` | Vulnerable (hit harder) | a red cracked ring |
| `slow.png` | Slowed | a pale blue boot stuck in ice |
| `poison.png` | Poisoned | a green drop with a small skull's two eyes |
| `stun.png` | Stunned | three yellow stars in a small arc |
| `bold.png` | Emboldened | a gold arrow pointing up with a spark |

### 4.3 Effect art

**Drawn by code today, so nothing is missing**: arrows, stones, darts, bottles and boulders fly in an arc; fire, frost, hexes, spores and curses fly as glowing orbs; lightning leaps or strikes from the sky; wind curls down a row; blades slash, claws rake, spears poke, clubs thud; bursts bloom over an area; wards, heals, cheers and howls show on those they touch. Forty-odd looks, listed in `docs/TACTICS.md` §3.

**Not wired yet.** Drawn art would be polish, and only some looks would gain much. If you make any, make these, in this order. **Folder (when wired):** `assets/tactics/fx/`.

**Things in flight**: one picture each, 32 × 32, transparent, the thing **pointing to the right** (the game turns it to face where it flies):

> A single small pixel-art projectile for a storybook tactics game, 32 × 32 pixels, pointing and travelling to the right, centred. One-pixel dark brown outline where it is solid, flat cel shading, a short bright trail behind it. Transparent background, nothing else. It is: [the thing].

| File | The thing |
|---|---|
| `fly_fire.png` | a ball of orange fire with a white-yellow core and a tail of flame |
| `fly_frost.png` | a pale blue shard of ice with a mist trail |
| `fly_hex.png` | a purple orb with a darker swirl inside and violet wisps behind |
| `fly_arrow.png` | a wooden arrow with white fletching and an iron head |
| `fly_boulder.png` | a rough grey rock, tumbling |
| `fly_vial.png` | a round corked bottle of green liquid, tumbling |

**Things that land or surround**: a strip of six frames side by side, each 48 × 48 (so 288 × 48), transparent, the effect centred, growing and fading across the six:

> A pixel-art effect animation for a storybook tactics game as one horizontal strip of six frames, each 48 × 48 pixels, side by side with no gaps. The effect is centred in every frame, starts small in the first, is largest in the third or fourth and fades by the sixth. Flat cel shading, bright clear colours, no outline on glows. Transparent background, no ground, no characters, no text. The effect: [the effect].

| File | The effect |
|---|---|
| `hit_boom.png` | a fire explosion: a white flash, an orange ring, sparks flying out, then smoke |
| `hit_slash.png` | a white curved sword cut that sweeps and fades |
| `aura_heal.png` | soft green light rising from the ground with small plus-shaped motes |
| `aura_shield.png` | a pale blue shield that pops into place, shines once and fades |
| `hit_thunder.png` | a blue-white bolt striking down from the top of the frame, a flash at the bottom |
| `hit_cloud.png` | a green spore cloud puffing up and thinning, with small bubbles |
| `hit_murk.png` | a dark purple haze curling up with a drooping wisp |
| `hit_ice.png` | pale ice crystals bursting outward and falling |

### 4.4 Portraits, emblems, the board's frame and its sky

**Not wired yet.** Each is small, and together they are what make the screen look finished.

**Portraits.** The row of turn-order chips along the top shows an emoji for each unit. A head-and-shoulders portrait would replace it: 48 × 48, transparent, facing a little to the left, for each foe (file `portrait_<key>.png`) and one for each class of citizen (`portrait_guard.png` and so on). Same style and palette as the full sprite.

> A pixel-art portrait for a game's turn-order bar, 48 × 48 pixels: head and shoulders only, facing slightly left, of the attached character. Same colours and outfit, the band's mark clearly visible. One-pixel dark brown outline, flat cel shading. Transparent background, no frame, no text.

**Band emblems.** The title card that names a battle would show the band's emblem beside its name. Five, 64 × 64, transparent, each a simple badge in two or three colours:

| File | Emblem |
|---|---|
| `band_brigand.png` | a red neckerchief knotted round two crossed cutlasses |
| `band_pack.png` | a wolf's head in profile, howling, in a blue crescent moon |
| `band_crag.png` | a black feather over a jagged grey peak with a small lightning bolt |
| `band_mire.png` | a green reed circle round a red toadstool and a single water drop |
| `band_withered.png` | a cracked, rusted crown with a small green flame inside it |

> A pixel-art emblem for a storybook game, 64 × 64 pixels, a simple badge that reads at small size: [the emblem]. One-pixel dark brown outline, flat shading in two or three colours, transparent background, no text.

**The board's own marks** (drawn by code today as coloured tiles and lines; each a flat diamond 64 wide and 32 tall to lie on a tile, transparent):

| File | What it is |
|---|---|
| `mark_move.png` | where a unit can walk: a soft blue diamond with a lighter rim |
| `mark_target.png` | where an ability can reach: a soft red diamond with a dashed rim |
| `mark_area.png` | what an area ability will cover: an orange diamond with a brighter centre |
| `mark_cursor.png` | the tile chosen: a white-gold diamond outline with four small corner ticks |
| `mark_turn.png` | whose turn it is: a gold ring to lie under a unit's feet |
| `arrow_face.png` | the facing chooser's arrow: a gold chevron pointing up and to the right, 32 × 24 |

> Pixel art for an isometric tactics board at the classic two-to-one angle: a flat marker that lies on one ground tile, a diamond 64 pixels wide and 32 tall. [What it is.] Clean and bright, slightly see-through, no outline heavier than one pixel. Transparent background.

**A sky for each land.** Behind the board is a plain dark gradient. A painted backdrop for each land would set the place: 960 × 540, no characters, soft and low in contrast so the board stands out, darker towards the bottom where the panel sits. Seven: `sky_plains.png` (rolling barley and a far windmill at dusk), `sky_forest.png` (tall trunks and green gloom, shafts of light), `sky_hills.png` (heather hills and standing stones), `sky_mountain.png` (snow peaks and driven cloud), `sky_river.png` (a wide slow river, reeds, a far bridge), `sky_marsh.png` (mist, dead trees, a few fungus lights), `sky_ruins.png` (broken arches against a pale moon).

> A soft painted pixel-art background for a storybook tactics game, 960 × 540: [the place]. Seen from a height, far away and out of focus, muted colours and low contrast, no characters, no text, darker at the bottom edge. It sits behind a game board, so nothing in it should draw the eye.

**For the ways in** (the five transitions, `docs/TACTICS.md` §3; each battle picks one). Two of them would look better with a little art: a **parchment texture** for the page that turns (`way_page.png`, 512 × 512, old cream paper with faint fibres and a darker edge, seamless), and **four leaves** for the gust of leaves (`way_leaf_1.png` to `way_leaf_4.png`, 32 × 32 each, transparent: an oak leaf, a beech leaf, a maple leaf and a birch leaf in autumn colours, each drawn flat as if seen from above).

## 5. Sounds

**Wired. Folder:** `assets/audio/tactics/`. **The file name is what matters**: `melee.mp3` plays for a melee hit. MP3, OGG or WAV. Short, clean, no music behind it, and no long tail of silence.

**After adding or changing a file, run `node scripts/pack_tactics.js`** (in the frontend repo) and commit `assets/tactics/manifest.json` with it. The game plays only what that list names: a sound in the folder that is not in the list is silent.

**In the game now (2026-11-22, the owner's first set):** `start`, `select`, `confirm`, `cancel`, `step`, `melee`, `sword`, `arrow`, `magic`, `bite`, `block`, `heal`, `buff`, `push`, `down_foe`, `victory`, `defeat`. **Still to find:** `turn`, `debuff`, `down_friend`. What was done to that set on the way in: the list was made (it had not been, so nothing played); `shove` was renamed `push`, the name the game plays; `step` was all but silent and two and a half seconds long, so it was cut to the first steps and made louder; `sword`, `buff`, `melee` and `push` lost the silence before and after them (a silent start makes a hit land late); `cancel` and `confirm` were the same file, so `cancel` is now that click a little lower. The originals are in the repository's history.

**Where to look** (all allow use in a game; check each file's licence line):

- **kenney.nl** (everything is CC0, no credit needed): the packs "RPG Audio", "Impact Sounds", "Interface Sounds" and "Music Jingles" cover nearly all of this list.
- **freesound.org**: search, then filter by licence "Creative Commons 0".
- **pixabay.com/sound-effects**: free for games, no credit needed.
- **opengameart.org**: filter by CC0.

The example file names are from memory of those packs: go by the sound, not the name.

| Save as | When it plays | What it should be | Search words; Kenney names to try |
|---|---|---|---|
| `start` | Going into a battle | A rising whoosh into a soft drum hit, about a second | "battle start whoosh", "encounter sting", "swoosh rise". Silent until this file exists |
| `select` | An ability is chosen | A soft, short tick | "ui select", "soft click"; Interface Sounds `select_00x`, `click_00x` |
| `confirm` | Confirm, and choosing a facing | A firmer, slightly lower click | "ui confirm"; Interface Sounds `confirmation_00x` |
| `cancel` | Cancel or Back | A short falling blip | "ui back", "ui cancel"; Interface Sounds `back_00x` |
| `turn` | Your citizen's turn begins | A small bright chime, under half a second | "notification chime soft", "bell ting"; Interface Sounds `pluck_00x`, `glass_00x` |
| `step` | A unit starts walking | Two or three quick footsteps on grass | "footsteps grass short"; Impact Sounds `footstep_grass_00x`, RPG Audio `footstep0x` |
| `sword` | A blade or a spear lands (a Guard's strike, a brigand's cutlass). Without this file, `melee` plays | A ring of steel and a cut | "sword slash", "blade hit metal"; RPG Audio `knifeSlice`, `drawKnife` |
| `melee` | A club, a tool, a fist or a boulder lands (a Villager's swing, an ogre's club) | A swish and a solid thud | "sword hit", "blade slash impact"; RPG Audio `knifeSlice`, `chop`; Impact Sounds `impactPunch_heavy_00x` |
| `arrow` | An Archer's shot; a foe's arrow, sling stone or dart | A bowstring twang, a whistle, a thunk | "bow shot", "arrow impact"; freesound "arrow whoosh hit" |
| `magic` | A Wizard's or Hearthkeeper's attack; a foe's spell | A quick whoosh of flame or a crackle | "fire spell", "magic bolt short", "fireball whoosh" |
| `bite` | A claw, talon or bite lands; a howl or a shriek | A snarl and a snap | "animal bite", "monster snap", "growl short" |
| `block` | Block is gained (Shield Up, Ward) | A wooden or metal clack, braced | "shield block", "wood impact"; Impact Sounds `impactWood_heavy_00x`, `impactPlate_medium_00x` |
| `heal` | Kindle, Share Rations | A warm rising shimmer, under a second | "heal spell", "magic chime warm", "sparkle rise" |
| `buff` | Embolden, Rally | A short bright rising tone | "power up soft", "buff"; Interface Sounds `maximize_00x` |
| `debuff` | Mark, Chill, a hex | A short dark falling tone | "debuff", "curse short"; Interface Sounds `minimize_00x` |
| `push` | A Shove sends someone back | A grunt-less shove and a skid | "body shove", "cloth scuffle"; RPG Audio `cloth_x`, Impact Sounds `impactSoft_medium_00x` |
| `down_foe` | A creature falls | A heavy thump and a small puff | "body fall thud", "creature defeated" |
| `down_friend` | A citizen falls. Without this file, `down_foe` plays | A softer thump with a sad falling note | "fall down soft", "lose life" |
| `victory` | The battle is won | A three-second cheerful fanfare, folk instruments | "victory jingle", "win fanfare short"; Music Jingles `jingles_PIZZI_x`, `jingles_STEEL_x` |
| `defeat` | The battle is lost | A three-second gentle sad phrase, not grim | "defeat jingle soft", "game over gentle"; Music Jingles `jingles_SAX_x` |

Until a file is there: `select`, `confirm`, the four attack sounds, both falls and the two endings borrow older sounds from the game; the rest are silent.

**Two more the end of a battle could use** (not wired; say when they exist): `levelup` (a bright rising chime for "Level up!"; `buff` plays today) and `roll` (a soft rattle or tick for an injury roll spinning; `select` ticks today).

If you use a sound generator, a line that works: "A [length] sound effect for a cosy storybook tactics game: [the description]. Clean, dry, no music, no voice."

## 6. Music

**Wired. Folder:** `assets/audio/tactics/music/`. **A file is named `<place>-<title-in-words>.mp3`**, and the name is everything the game knows about it:

- **The place** is a land (`plains`, `forest`, `hills`, `mountain`, `river`, `marsh`, `ruins`), or `boss`, or `boss-withered`. A battle plays a piece of its own land; a boss fight plays a `boss` piece, and a boss of the Withered a `boss-withered` one. A land with no piece of its own borrows a neighbour's: the hills the mountains', the ruins the marsh's, and so on.
- **The title** is the rest of the name, read as words: `forest-under-the-old-oaks.mp3` is "Under the Old Oaks". To rename a piece, rename its file.

After adding, renaming or removing one, run `node scripts/pack_tactics.js`.

**In the game (2026-11-23), thirteen pieces:**

| Place | Pieces |
|---|---|
| The meadows (`plains`) | The Meadow Gambit |
| The deep wood (`forest`) | Under the Old Oaks · Lanterns in the Deep Wood |
| The mountains (`mountain`; the hills borrow these) | The High Pass · Stormcrow Ridge |
| The river (`river`) | The Ford at Dawn · Reeds and Rapids |
| The marsh (`marsh`; the ruins borrow these) | Mist on the Fen · The Sunken Road |
| A boss (`boss`) | The Last Door · No Way but Through |
| The Withered's boss (`boss-withered`) | The Hollow King · A Crown of Rot |

The owner's twelve new files were given these names (they came as `deep_wood-1`, `boss-wither-2` and the like; the titles are placeholders chosen by place, not by ear: rename any that do not fit) and encoded again at 96 kbps: 73 MB became 29 MB, about 2 MB a piece. **Still wanted:** a piece each for the hills and the ruins, a second for the meadows, and winter (prompts 3, 4 and 8 below).

**The jukebox** (`jukebox.html` on the site: a page of its own, with nothing to sign in to) plays every piece over the kind of battle it is for, the battle playing itself, and takes stars and a comment from anyone with the link. It is for asking friends which pieces work. The stars' averages show to everyone; the comments show only to an admin of the game, signed in on the same browser, at the foot of that page.

**For every track:** instrumental, no singing; 90 seconds to two and a half minutes; the same tempo and energy from start to end so it loops without a lurch; ends as it began; MP3 at about 96 kbps (the game's own were made at that; `ffmpeg -i in.mp3 -codec:a libmp3lame -b:a 96k out.mp3`). Battle music here should feel like a game of chess in a meadow with something at stake, not a war film.

Prompts for a music generator (Suno, Udio or the like). Make two or three takes of each and keep the one that loops best.

**1. The meadow skirmish** (the everyday battle):
> Instrumental battle theme for a cosy storybook tactics game. Brisk and determined, around 120 bpm. Plucked strings, fiddle and tin whistle carry a bright, catchy melody over hand drums and a walking upright bass. Folk and Celtic colour, light and nimble, a little mischievous. No vocals. Steady energy throughout, loopable.

**2. The deep wood** (forest, a little darker):
> Instrumental tactics battle music, woodland at dusk. About 110 bpm. A low clarinet and cello trade a wary minor-key melody over pizzicato strings, soft frame drum and wooden percussion. Tense but warm, like creeping through tall trees. Small bursts of fiddle. No vocals, even intensity, loopable.

**3. The high pass** (hills and mountains, heroic):
> Instrumental battle theme, windswept mountain pass. Around 126 bpm. French horn and strings play a bold rising melody over driving snare, tambourine and low strings. Heroic and open, with a folk fiddle answering the horns. Not grim, not epic-film bombast: brave small heroes. No vocals, loopable.

**4. Marsh and ruin** (eerie):
> Instrumental tactics battle music for a misty marsh and old ruins. About 100 bpm. Bass clarinet, bowed dulcimer and soft marimba over a slow, lurching drum pattern; a music-box phrase drifts in and out. Uneasy and curious, a little spooky, never horror. No vocals, steady mood, loopable.

**5. The river crossing** (light, quick):
> Instrumental battle music, a fight at a river ford. Around 132 bpm. Mandolin and accordion in a quick dancing rhythm, wooden flute melody, light brushes on snare, playful bass. Lively and bouncing, like a reel that has turned serious. No vocals, loopable.

**6. The boss** (save as `boss-1.mp3`):
> Instrumental boss battle theme for a storybook tactics game. Around 138 bpm. Urgent low strings and timpani, a strong brass motif, fast fiddle runs, pounding hand drums. Dramatic and dangerous but still tuneful and folk-coloured, with a short hopeful phrase that keeps returning. No vocals, loopable, high energy throughout.

**7. A second boss, for the Withered** (save as `boss-2.mp3`):
> Instrumental boss battle music, an ancient hollow king in a ruined hall. About 116 bpm in a heavy three-four. Low choir-like pads without words, church organ pedal, cello ostinato, rattling bone-like percussion, a cracked bell. Solemn, cold and grand; sorrowful more than evil. No vocals, loopable.

**8. Winter** (for when the seasons reach the board):
> Instrumental tactics battle music in deep snow. Around 108 bpm. Celesta and glockenspiel over muted strings and soft sleigh-bell percussion, a lone oboe melody, brave and a little melancholy. Crisp and quiet at heart with steady forward motion. No vocals, loopable.

The two short endings (`victory`, `defeat`) are sounds, in §5.
