# Tactics battles: art, sound and music to make

For `docs/TACTICS.md`. Written 2026-11-20. The same file is in both repos.

Everything here has a stand-in today, so nothing blocks anything: creatures are drawn as their icons, older sounds fill in, and the card battles' music plays.

**How a file gets into the game.** Three kinds of file are wired up now: creature pictures (§1), sounds (§5) and music (§6). Put the file in the folder named, with the name given, then run this in the frontend repo:

```bash
node scripts/pack_tactics.js
```

It lists what is there in `assets/tactics/manifest.json`, and the game uses it from the next load. A half-finished set is fine. Everything else in this document (§2 to §4) is not wired yet; make it when you like and it will be put in when it exists.

## What to make, in order

| # | What | Tool | Why now |
|---|---|---|---|
| 1 | Sounds: the eighteen in §5 | freesound, Kenney, pixabay | an afternoon's work; the battle is nearly silent without them |
| 2 | Music: two or three of the tracks in §6 | a music generator | sets the mood at once |
| 3 | The eleven creatures in §1 | PixelLab | the foes are emoji today, and emoji cannot face anywhere |
| 4 | The mouse's battle animations in §2 | PixelLab | attacks read as a nudge until these exist |
| 5 | Class looks for the mouse (§2) | PixelLab | a Guard and a Wizard look the same |
| 6 | The seven bosses and the rest of the creature list (§1) | PixelLab | needed when Phase 6 builds them |
| 7 | Ability icons (§4) | PixelLab or a pixel editor | emoji do the job meanwhile |
| 8 | Trees, rocks and ground (§3) | PixelLab or ChatGPT | the code-drawn ones are decent |
| 9 | The other six species | PixelLab | the largest job in the game; last |

## 1. Creatures

**Wired. Folder:** `assets/sprites/creatures/`

**Two pictures for each creature:**

| File | The view |
|---|---|
| `<key>_front.png` | Seen from the front and a little above, **looking down and to the left**, towards the viewer. |
| `<key>_back.png` | The same creature seen from behind, **looking up and to the right**, away from the viewer. |

The game mirrors each for the other two directions, so two pictures give all four facings. With only a front picture the creature still appears (it just never turns its back).

**Size and style:** 128 × 128 pixels, transparent background, the creature standing in the middle with its **feet about nine tenths of the way down** the picture. Pixel art in the same style as the mouse villager: a 1-pixel dark brown outline, flat shading in three or four tones, a warm storybook palette. **Draw at the mouse's pixel size**: the mouse is about 60 pixels tall in its sheet, and the game draws a creature's pixels the same size as the mouse's. So a creature "as tall as the mouse" is about 60 pixels tall in its picture, and the Hill Ogre, twice that, fills the frame.

**Tone:** fierce, never gory. These are the foes of a cosy woodland story.

**In PixelLab**, attach the mouse's idle sheet as the style reference every time, make the character at a three-quarter top-down ("high top-down" or "isometric") view, and export the south-west and north-east views. Start each with this, unchanged:

> Pixel art game sprite for a tactics battle, three-quarter top-down view from above and in front. Full body, standing still, facing down and to the left towards the viewer. Chunky, readable silhouette. One-pixel dark brown outline (#2a180c), flat cel shading with three or four tones per colour, warm storybook palette, the same style and pixel size as the attached mouse villager. Fierce but charming, not gory. Transparent background, no ground, no shadow, no text.

Then the creature's own line from the table. For the back view, in the same conversation:

> The exact same creature, same size and colours, seen from behind and a little above, facing up and to the right, away from the viewer. Transparent background.

| File key | Creature | Its line |
|---|---|---|
| `marsh_rat` | Marsh Rat | A scrawny marsh rat on all fours, mud-brown fur, a long pink tail, one notched ear, yellow teeth showing. Small: two thirds of the mouse's height. |
| `river_pike` | River Pike | A big pike rearing half out of a splash of water, olive green with pale spots, a long jaw full of needle teeth. As tall as the mouse. |
| `wild_fox` | Wild Fox | A lean red fox on all fours, white chest and tail tip, black legs, ears back, a sly snarl. A little taller than the mouse. |
| `rot_shaman` | Rot Shaman | A hunched figure in a ragged moss-green hood and robe, a crooked staff topped with a small skull, sickly green light in its eyes; its face in shadow. As tall as the mouse. |
| `mountain_harpy` | Mountain Harpy | A fierce grey-brown hawk-woman, wings half spread, taloned feet, a sharp hooked beak, a few bright feathers in her crest. One and a third times the mouse's height. |
| `bog_lurker` | Bog Lurker | A squat newt-like lizard, slick dark green with an orange belly, wide mouth, bulging eyes, a strand of weed on its back. As tall as the mouse. |
| `night_wolf` | Night Wolf | A big charcoal-grey wolf on all fours, pale blue eyes, hackles up, teeth bared. One and a third times the mouse's height. |
| `withered_husk` | Withered Husk | A shambling dried-out figure of grey bark and dead leaves in the shape of a villager, hollow eyes with a dull green glow, one arm longer than the other. A little taller than the mouse. |
| `fungal_toad` | Fungal Toad | A fat brown toad with red-and-white toadstools growing from its back, half-closed eyes, a wide flat mouth. As tall as the mouse and twice as wide. |
| `thornback_boar` | Thornback Boar | A stocky wild boar on all fours, dark brown bristles standing up along its spine like thorns, two curved tusks, small angry eyes. One and a third times the mouse's height. |
| `hill_ogre` | Hill Ogre | A huge pot-bellied ogre in a patched hide kilt, mossy green-grey skin, a tree-trunk club over one shoulder, a small head with one tusk. Fills the frame: twice the mouse's height. |

**Later, for Phase 6** (the keys will be these names in lower case with underscores): Stoat Cutpurse, Stoat Bruiser and Stoat Captain (brigands in patched leather, each bigger than the last); Reed Snapper (a snapping turtle); Cave Spider; Husk Brute and Husk Knight (larger Withered, the Knight in rusted armour); Bog Hulk; Bog Witch (a toad-witch with a hex lantern); Stormcrow (a great black bird crackling with sparks). **The seven bosses**, each to fill the frame: Redtooth the Brigand King (a scarred stoat with twin cutlasses), Old Greyfeather (a vast grey owl), the Storm Matriarch (a harpy queen), Old Snapjaw (a giant pike), Grum the Ogre Chief, the Bog Mother (an enormous toad), the Hollow King (a Withered in a rusted crown).

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
| `down_se.gif` | "collapsing: staggers, drops to the knees and lies down" (6 frames; one direction is enough) |
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

## 4. Ability icons and effects

**Not wired yet.** Abilities show an emoji. A set of 32 × 32 pixel icons would replace them, one per ability, named by the ability's key (`g_strike.png`, `w_bolt.png`, and so on; the keys are in `lib/class_cards.js`). Twenty are in play today:

Guard: Strike, Shield Up, Cover, Shove, Heavy Blow. Archer: Shoot, Sidestep, Parting Shot, Piercing Arrow, Mark. Wizard: Spark, Ward, Firebolt, Ember Burst, Chill. Hearthkeeper: Cinder, Hearth Ward, Kindle, Steady Now, Embolden.

> A sheet of five 32 × 32 pixel-art icons in a row with gaps, for a storybook tactics game: [five names, each with three words of what it shows]. Bold simple shapes that read at small size, one-pixel dark brown outline, a different main colour for each, transparent background, no text.

Effects (a slash, an arrow in flight, a burst of flame, a frost shard, a ring of healing light, a shield flash) would be short strips of four to six frames, 48 × 48. Numbers and a flash do this work today.

## 5. Sounds

**Wired. Folder:** `assets/audio/tactics/`. **The file name is what matters**: `melee.mp3` plays for a melee hit. MP3, OGG or WAV. Short, clean, no music behind it, and no long tail of silence.

**Where to look** (all allow use in a game; check each file's licence line):

- **kenney.nl** (everything is CC0, no credit needed): the packs "RPG Audio", "Impact Sounds", "Interface Sounds" and "Music Jingles" cover nearly all of this list.
- **freesound.org**: search, then filter by licence "Creative Commons 0".
- **pixabay.com/sound-effects**: free for games, no credit needed.
- **opengameart.org**: filter by CC0.

The example file names are from memory of those packs: go by the sound, not the name.

| Save as | When it plays | What it should be | Search words; Kenney names to try |
|---|---|---|---|
| `select` | An ability is chosen | A soft, short tick | "ui select", "soft click"; Interface Sounds `select_00x`, `click_00x` |
| `confirm` | Confirm, and choosing a facing | A firmer, slightly lower click | "ui confirm"; Interface Sounds `confirmation_00x` |
| `cancel` | Cancel or Back | A short falling blip | "ui back", "ui cancel"; Interface Sounds `back_00x` |
| `turn` | Your citizen's turn begins | A small bright chime, under half a second | "notification chime soft", "bell ting"; Interface Sounds `pluck_00x`, `glass_00x` |
| `step` | A unit starts walking | Two or three quick footsteps on grass | "footsteps grass short"; Impact Sounds `footstep_grass_00x`, RPG Audio `footstep0x` |
| `melee` | A blade or club lands (Guard, Villager) | A swish and a solid thud | "sword hit", "blade slash impact"; RPG Audio `knifeSlice`, `chop`; Impact Sounds `impactPunch_heavy_00x` |
| `arrow` | An Archer's shot | A bowstring twang, a whistle, a thunk | "bow shot", "arrow impact"; freesound "arrow whoosh hit" |
| `magic` | A Wizard's or Hearthkeeper's attack | A quick whoosh of flame or a crackle | "fire spell", "magic bolt short", "fireball whoosh" |
| `bite` | A creature attacks | A snarl and a snap | "animal bite", "monster snap", "growl short" |
| `block` | Block is gained (Shield Up, Ward) | A wooden or metal clack, braced | "shield block", "wood impact"; Impact Sounds `impactWood_heavy_00x`, `impactPlate_medium_00x` |
| `heal` | Kindle, Share Rations | A warm rising shimmer, under a second | "heal spell", "magic chime warm", "sparkle rise" |
| `buff` | Embolden, Rally | A short bright rising tone | "power up soft", "buff"; Interface Sounds `maximize_00x` |
| `debuff` | Mark, Chill, a hex | A short dark falling tone | "debuff", "curse short"; Interface Sounds `minimize_00x` |
| `push` | A Shove sends someone back | A grunt-less shove and a skid | "body shove", "cloth scuffle"; RPG Audio `cloth_x`, Impact Sounds `impactSoft_medium_00x` |
| `down_foe` | A creature falls | A heavy thump and a small puff | "body fall thud", "creature defeated" |
| `down_friend` | A citizen falls | A softer thump with a sad falling note | "fall down soft", "lose life" |
| `victory` | The battle is won | A three-second cheerful fanfare, folk instruments | "victory jingle", "win fanfare short"; Music Jingles `jingles_PIZZI_x`, `jingles_STEEL_x` |
| `defeat` | The battle is lost | A three-second gentle sad phrase, not grim | "defeat jingle soft", "game over gentle"; Music Jingles `jingles_SAX_x` |

Until a file is there: `select`, `confirm`, the four attack sounds, both falls and the two endings borrow older sounds from the game; the rest are silent.

If you use a sound generator, a line that works: "A [length] sound effect for a cosy storybook tactics game: [the description]. Clean, dry, no music, no voice."

## 6. Music

**Wired. Folder:** `assets/audio/tactics/music/`. Any file names. The game picks one at random for each battle and loops it. **A file whose name starts with `boss`** (`boss-1.mp3`) is kept for boss fights; the others play for the rest.

**For every track:** instrumental, no singing; 90 seconds to two and a half minutes; the same tempo and energy from start to end so it loops without a lurch; ends as it began; MP3 at 128 to 160 kbps. Battle music here should feel like a game of chess in a meadow with something at stake, not a war film.

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
