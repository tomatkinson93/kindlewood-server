# Art guide: the new look for Home (agreed 2026-11-16)

This says what the owner and the reviewer decided about the look of the Home
scenes, what art already exists, and how to put it in. It goes with
`HOME_SCENE.md` and **overrides it wherever the two differ** (the differences are
listed in §7). The first half is for whoever builds it; §8 is for the owner, who
makes the art.

## 1. The look in one paragraph

A cosy cartoon town seen from the front and slightly above, like a farming game.
A **flat, plain meadow** fills most of the screen. Everything that is a thing (a
building, a tree, a rock) is its own image standing on that meadow. Villagers are
the owner's pixel sprites. Buildings are clean cartoon drawings with a thick
deep-brown outline and flat shading. The old painted landscape, with its slopes,
river and fences baked in, goes.

## 2. What was decided

| Question | Decision |
|---|---|
| View | Front-on from slightly above. Every building shows its front wall and the top of its roof, no side walls. Light from the top left. |
| Ground | One flat meadow, nothing drawn on it. It tiles in both directions. |
| Sky | Drawn by code as a gradient, so day, dusk and night cost no art. A few clouds drift. |
| Far layers | Two strips only: mountains, then a tree line in front of them. Both tile sideways. |
| Horizon | High: the ground gets about three quarters of the scene's height. The old scene gave it about a third. |
| Villager size | **1×**, as built. 2× was tried in mock-ups and five buildings filled the screen. |
| The ruler | A doorway is about **70 px** tall on screen next to a 62 px villager. Every building is sized so its door matches that. Houses are a little smaller (door about 58 px) so that town buildings look more important than homes. |
| Sharpness | Building and backdrop files are made at **twice** their on-screen size and shown at half, so they are crisp on high-density screens. They are drawn smooth. Only villagers use `image-rendering: pixelated`. |
| Day and night | Each building with windows has two images that line up exactly: windows dark, and windows lit. Code tints the whole scene at night and shows the lit one. |
| Shadows | Drawn by code: a soft ellipse under every building and villager. None in the art. |
| Width | The Town and Outskirts scenes pan sideways, the same way the Neighbourhood does. A full town does not fit in one screen at this size. |
| File type | WebP. Lossless for buildings and strips (they have transparency and flat colour, so it is small), lossy for the ground. |
| Pixel-snapping | Dropped. The earlier idea of forcing all art onto one pixel grid and palette is not needed: in the mock-ups the cartoon buildings and pixel villagers sit together well. |

## 3. What exists now

In the frontend repository, `assets/images/scene_v2/`:

```
buildings/manifest.v2.json
buildings/<key>.webp          windows dark (the daytime image)
buildings/<key>_lit.webp      windows lit, where it exists
backdrop/backdrop.v2.json
backdrop/ground.webp          1000 x 363 on screen, tiles both ways
backdrop/trees.webp           tree line, tiles sideways
backdrop/mountains.webp       mountains, tiles sideways
```

| Key | Day image | Lit image | On screen (px) |
|---|---|---|---|
| `tavern` | yes | yes | 331 × 320 |
| `granary` | yes | not needed (a storehouse) | 346 × 342 |
| `market` | yes | yes | 392 × 327 |
| `library` | yes | yes | 333 × 349 |
| `smithy` | yes | yes | 388 × 264 |
| `workshop` | yes | **missing** | 392 × 240 |
| `guild_hall` | yes | yes | 452 × 415 |
| `house_thatch` | yes | yes | 212 × 196 |
| `house_timber` | yes | yes | 219 × 209 |
| `house_stone` | yes | yes | 216 × 208 |
| `house_burrow` | yes | yes | 239 × 159 |
| `jeweller` | yes | yes | 286 × 305 |
| `neighbourhood` (its door in Town) | yes | yes | 440 × 227 |
| `village_green` (a prop, flat, no shadow) | yes | not needed | 320 × 159 |

The four `house_*` images are the four starting house styles (`HOME_SCENE.md`
C.4). Their keys replace the stand-in names there: `thatch`, `timber`, `stone`,
`burrow`.

(Added 2026-11-17: the night images for the Market, Smithy and Guild Hall, the
burrow by day, the Jeweller, the Neighbourhood's door and the village green.
The Workshop's night image is still missing.)

Not yet drawn: `farm`, `lumber_camp`, `fishing_post`, `forager_hut`,
`mine`, `smelter`, `scout_post`, `watchtower`, `walls`, the props (`wonder_site`,
`signpost`), scenery props (trees, rocks, bushes, flowers, a well, fence pieces,
a pond), clouds, construction-site stages, and the other six species of
villager. Keep the placeholders for these.

### The manifest

`manifest.v2.json` uses the fields the current manifest has, plus three:

```json
"tavern": {
  "file": "tavern.webp",        the daytime image
  "lit": "tavern_lit.webp",     the night image; absent if there is none
  "w": 331, "h": 320,           size ON SCREEN at 1x, in CSS pixels
  "door": [162, 316],           the doorstep, in the same on-screen pixels
  "native": true,               sized by w and h, not by the slot
  "smooth": true,               do NOT draw this pixelated
  "scale": 2                    the file is this many times w and h
}
```

The door points were placed by eye from the drawings (the x is a fraction of the
width, the y is 4 px above the bottom). They are right to within a few pixels.
Check each one in the scene and nudge it; a Dev Tools overlay that draws the door
point would pay for itself.

Three more fields say where a building's small life comes from (Part F, step
20; `js/home-ambient.js`). All are optional and in the same on-screen pixels as
`door`, measured from the picture's top-left corner:

```json
"smithy": {
  …
  "smoke": [[262, 14]],         the top of each chimney; a puff rises from each
  "fire": [300, 204],           the forge mouth: a glow and sparks while someone works it
  "dust": [268, 196]            where sawdust puffs while someone works (the Workshop)
}
```

A building with no `smoke` just never smokes. When a new building or house
style arrives, add the chimney tops; if a redrawn picture moves the chimney,
move the point. Set on 2026-11-17: Tavern, Smithy (smoke and fire), Workshop
(smoke and dust), Jeweller, the Neighbourhood's door, and the four house
styles. To add later with their art: the Farm, the Smelter (smoke and fire),
the Forager's Hut, the Fishing Post.

## 4. How to put it in

In this order, each step shippable:

1. **Read the new manifest.** Move the files to where the scene looks for
   building art, or point the loader at `scene_v2/`. Honour `smooth` (no
   `kwh-native` pixelated rule for these; set `width: w px; height: h px`) and
   keep `native` sizing. Old entries without `smooth` behave as today.
2. **The backdrop.** Replace the four painted layers (`SV_LAYER_DEFS`: sky,
   mountains, midground, foreground) with: a CSS gradient sky; `mountains.webp`
   and `trees.webp` as `background-repeat: repeat-x` strips at half their file
   size; `ground.webp` as a `repeat` fill below the horizon. Put the horizon at
   about 25 % of the scene's height. The trees' bottom edge overlaps the top of
   the ground by about 12 px so there is no seam. Lighten the tree line a little
   (mix about 18 % pale sky colour) and the mountains more (about 25 %) so they
   sit back. Parallax: far strips only, and gently.
3. **The walkable ground** (`SV_GROUND`) becomes the whole meadow below the
   horizon, minus a margin. Slots (`SV_SLOTS`) need new positions for a flat
   field: lay buildings out in two or three rows with the back row just under
   the tree line. Depth order by foot position, as now.
4. **Panning.** Make Town and Outskirts as wide as they need to be and pan
   sideways (drag, arrow keys, edge of screen), sharing the Neighbourhood's
   code. Open centred on the middle of the town.
5. **Shadows.** A soft dark-green ellipse under each building (about 92 % of its
   width) and each villager. Remove any shadow filters that assumed the old art.
6. **Night.** Tint ground, strips, unlit buildings and villagers with a
   blue-violet multiply at night (the mock-up used roughly ×0.42, ×0.48, ×0.78
   on red, green, blue); buildings showing their lit image get a much lighter
   tint (about ×0.72, ×0.72, ×0.92) so the windows glow. Cross-fade the day and
   lit images over a few seconds at dusk and dawn; the pairs line up to within
   3 px. Per `HOME_SCENE.md` C.5 a house with nobody living in it stays dark.
   Buildings with no lit image just take the night tint.
7. **Villagers stand out.** Next to the buildings the mouse reads a little dull.
   Give villagers a 1 px dark outline (four `drop-shadow`s of 1 px, or bake it
   into the sheet in `pack_sprites.js`) and a slight brightness lift.
8. **House styles.** `lib/house_styles.js` keys become `thatch`, `timber`,
   `stone`, `burrow`, drawn from `house_<key>.webp`.
9. **Old art.** Leave the old building PNGs and the biome layers in the
   repository until every scene has moved over, then delete them in one commit.
   The other biomes come back later as a ground tint and a different far strip,
   not as four new paintings each.

Check in the browser at 1400 × 900 and 390 × 844, by day and by night. The
reviewer's mock-ups of the target are with the owner.

## 4a. Built (2026-11-16)

§4 steps 1–7 are in, plus the owner's request to drop the mouse-drift effect.
Proofs: `verify/scene_proofs.js` §14 (and §8, §12 updated).

- **Manifest** (`js/home-scene.js`): reads `scene_v2/buildings/manifest.v2.json`
  only. Each building is a `.kwh-art` box at the manifest's `w` × `h` holding
  the day image and, on top, the lit one. Keys with no new art keep the
  placeholder hut (drawn larger, about a house's size); the painted scene's
  PNGs are no longer shown. The Neighbourhood's door in Town is a cluster of
  the three house drawings (timber, stone, thatch at 0.62×) until its own art
  exists; its door is the front house's.
- **Backdrop** (`js/settlement-view.js` `SV_BACKDROP`, `css/home-scene.css`):
  sky by code with a gradient per time of day, mountains and trees as
  `repeat-x` strips with haze (25 %, 18 %), the meadow as a `repeat` fill from
  25 % down; the tree line overlaps it by 12 px.
- **No drift**: the parallax that followed the mouse is gone. The only depth
  effect left is the far strips panning a little slower than the meadow
  (0.45 and 0.75) when the view pans.
- **Layout**: two rows on the flat field, feet at 56 % (just under the tree
  line) and 92 %, staggered; a slot's position is now the foot of what stands
  there. Saved hand-made layouts from the painted scene are not carried over
  (new storage keys).
- **Panning**: Town and the Outskirts are 2600 px wide. Drag (on the meadow or
  a building; a press that moves 6 px pans instead of clicking), sideways
  wheel or Shift+wheel, the arrow keys (the map no longer takes them while
  Home shows), or rest the mouse at the left or right edge. Each area opens
  centred and remembers where it was; a signpost lands you at the matching
  end. Phones pan by touch instead of scrolling an 860 px page. Since
  2026-11-16 the scene is a native horizontal scroller (momentum on phones;
  the mouse still drags; `HOME_SCENE.md` §4 step 8a).
- **Shadows** by code under buildings (92 % wide) and villagers.
- **Night**: first built as SVG colour matrices on each element (×0.42,
  ×0.48, ×0.78; lit ×0.72, ×0.72, ×0.92). The polish pass replaced them with
  one overlay and lightened the night (§4b). Lit images fade in over 3 s at
  dusk and stay through the night; the sky changes with the phase. An empty
  Neighbourhood stays dark.
  `KWCast.preview('night')` (or `'dusk'`, `'dawn'`, `'day'`) in the console
  holds a time of day for a look; `KWCast.preview(null)` goes back to the clock.
- **Villagers** get a 1 px dark outline and a slight lift (with their family
  look) and walk the whole meadow. Since the polish pass both are baked into
  the sheets (§4b).

Not done yet: drifting clouds (no cloud art), §4 step 8 (house styles on the
server waits for the Neighbourhood, `HOME_SCENE.md` step 10), a Dev Tools
overlay for door points, `scripts/pack_buildings.js`, and the night tint on
the signposts' painted words. The door points are as estimated; villagers walk
to them and they look right at a glance.

## 4b. The polish pass (2026-11-16)

Proofs: `verify/scene_proofs.js` §14m–14n2 and §20.

### Night and evening

- **One overlay.** A single `mix-blend-mode: multiply` layer (`.sv-night`, z 1050)
  covers the whole world. It tints everything under it in one pass: the meadow,
  the strips, the sky, every building and prop, and the villagers. This
  replaced a filter on each element, and with it the bug where a building with
  no lit image (the Market) stayed in daylight.
- **Strength.** Night is ×0.72, ×0.80, ×1.00 on red, green and blue, about
  1.65× brighter than before by the meadow's luminance. The evening is ×0.92,
  ×0.80, ×0.86. The values live in `KWHome.NIGHT_TINTS`.
- **The sky** is a strip inside the world (`.sv-bd-sky`), under the overlay. Its
  evening and night colours are therefore set brighter than they look.
- **Lit windows.** The overlay would dim them, so their glow is drawn again above
  it (`.sv-glow`, z 1060, screen mode). The glow is the lit image minus the day
  image, worked out once per pair on a canvas (`KWHome.glowFor`; pixels that
  changed by more than 48 in all, with a soft halo). It lines up with the
  building, follows it when the scene redraws, and is hidden in Build mode.
  A glowing building doesn't lift on hover. Known: a villager passing right in
  front of a lit window picks up a little of its glow.
- **Labels** (nameplates, bubbles, villager name tags, "!" markers) take a
  filter that undoes the tint, so they read as they do by day.
- **Stacking.** The foreground layers are no longer stacking contexts, so
  everything sorts in the world's one stacking context:

  | Layer | z |
  |---|---|
  | Backdrop strips | −5 to −2 |
  | Paths | −1 |
  | Depth (buildings, props, villagers) | 1–1000 |
  | Selected villager | 1005 |
  | Hovered or focused building | 1010 |
  | Building being dragged | 1020 |
  | Overlay | 1050 |
  | Glow | 1060 |
  | Radial menu | 1600 |

### Villagers

The 1 px dark outline (#2a180c) and the ×1.07 lift are baked into every frame
by `scripts/pack_sprites.js` (`outlineFrame`). Re-pack after adding GIFs. A
villager has no filter but its family's look. The selected one keeps a light
outline as its one filter.

### Paths

`js/home-ground.js` draws the dirt paths by code:
- **Look:** a band about 28 px wide under everything, as a soft-edged pair of
  strokes in a warm brown at low contrast.
- **Route:** each door has a short path down to its row's lane, 22 px below the
  doors. The lanes are joined where they overlap, and the signpost sits on the
  nearest lane.
- **Redraw:** whenever the engine's survey sees the doors move (build, move,
  remove, resize).
- **Texture later:** when a tiling texture arrives, use it as the stroke's
  pattern in `pathsSvg`.

### Props

Props come from `assets/images/scene_v2/props/manifest.json`, which ships
empty, so nothing is drawn. Each entry looks like:

```json
"oak_1": { "kind": "tree", "file": "oak_1.webp", "w": 70, "h": 80, "foot": [35, 78] }
```

- **Fields:** `w`, `h` and `foot` are on-screen pixels. Files are at 2× (scale
  2) and drawn smooth.
- **Kinds:** `tree`, `bush`, `fence`, `flower`, `tuft`, `rock`, `well`,
  `bench`, `pond`, `lantern`. Several entries of one kind are picked among at
  random. A `lantern` takes a `lit` image as well, which fades in and glows
  like a building's.
- **Placement:** scattered from a seed fixed per town (its id and the area).
  - Trees and bushes go along the tree line and the side edges; fences near
    the back corners.
  - Flowers, tufts and rocks spread thinly across the meadow.
  - The well goes near where the lanes join (town only), benches beside a
    lane, the pond in open meadow, lanterns along the lanes.
  - Nothing lands on a path, a plot (built or not, with its doorstep and
    nameplate) or a building.
- **Behaviour:** props are depth-sorted with buildings and villagers and are
  never clickable. The well, benches and pond become named spots villagers walk
  to. Villagers never stop on trees, the well or the pond (no path-finding:
  they just stand somewhere else).

**The calmer meadow.** When it arrives, point `SV_BACKDROP.ground` in
`js/settlement-view.js` at it, and add the tufts and flowers as props in the
manifest above.

## 5. Adding a new building later

1. The owner makes the image (§8) and a matching lit one.
2. Cut the background off, crop tight, and size it so the door is 140 px tall in
   the file (70 on screen); for a house, 116 px. Save as lossless WebP.
3. Add the manifest entry: on-screen `w` and `h` are half the file's size.
4. Place the door point and check a villager walks to it.

`scripts/pack_buildings.py` does 2 and 3 from a folder of source images
(`python3 scripts/pack_buildings.py SRC_DIR`; it needs Pillow and numpy):
- **Background.** The generator returns four kinds of source: real
  transparency, a white fill, a black fill, and a baked-in grey and white
  checkerboard (most night images arrive this way). For the last three the
  script floods in from the edges, so white flowers and dark outlines inside
  the drawing survive, then pulls the edge in by two pixels. Background seen
  through a hole in a night image (the Guild Hall's belfry) is cleared wherever
  the day image is clear.
- **Size.** A night image is made the same size as its day image; both are
  cropped tight first, so they line up (the script reports how well). A new
  drawing takes its on-screen width from `SIZES` at the top of the script.
- **Output.** Lossless WebP in `assets/images/scene_v2/buildings/`, named
  `<key>.webp` and `<key>_lit.webp`. It prints the manifest's `w` and `h`; the
  door point is still set by eye.
- **Sources** are not kept in the repository (the host serves every file in
  it); keep the PNGs you were sent.

## 6. Known rough edges

- `trees.webp` and `mountains.webp` did not tile as generated. The files in the
  repository are each strip followed by its mirror image, which does tile. If a
  mirrored tree line looks too regular, ask the owner for a longer strip.
- The meadow's yellow patches and tufts are a little strong and repeat visibly
  when tiled. A calmer meadow, with tufts and flowers as separate props scattered
  by code, is on the owner's list. The props layer is ready for it (§4b).
- The first lit houses were drawn in a slightly softer style than everything
  after them. Under the night overlay it does not show.
- The door points are estimates (§3).

## 7. Where this overrides `HOME_SCENE.md`

- §2.6 "transparent PNG … `assets/images/buildings/<key>.png`": now WebP at 2×
  with the manifest fields above.
- §2.6 "most buildings 220 to 320 px wide": town buildings are 330 to 450 px,
  houses about 215 px.
- §3.4 "the band from y 66 % to 94 %": the whole meadow, from about 27 %.
- §3.5 "the tavern's windows glow": every building with a lit image glows.
- §3.4 "a few named spots per area (the well, … a bench by the tavern)": the
  well, benches and pond come from the props layer once their art is in (§4b).
- C.3 "about three screens wide": still true, and now Town and Outskirts pan as
  well.
- C.4 style names, as in §3 above.
- The idea in the first art notes of snapping all art to one pixel grid and
  palette: dropped.

## 8. For the owner: making more art

Start a **new chat for each batch of three or four** and attach the same two
images every time: the unlit Library (the style) and the unlit thatched cottage
(the door and the view). Do not swap in newer buildings as references, or the
style drifts a little further each time.

Paste this first, unchanged:

> Match the attached library image exactly in art style: the same outline
> thickness and deep-brown outline colour, the same flat cel-style shading with
> 3–4 tones per colour, the same level of detail, the same warm palette, the same
> chunky rounded shapes. Do not add texture, gradients, realism or finer detail
> than the reference has. Straight-on front view from slightly above, as in both
> attached images: front wall and top of the roof visible, no side walls. Light
> from the top left. The door must be the same size, shape and style as the door
> in the attached cottage. Small leafy bushes and a few white flowers around the
> base, as in the references. No text or lettering anywhere.

Then this, unchanged:

> Output a PNG with a fully transparent background (real alpha transparency, not
> a white, black or checkerboard fill). One single building, centred, with a
> margin of empty space on all sides. Nothing may touch the edge of the image. No
> ground, no grass, no cast shadow, no glow or halo around the building, no
> characters.

Then describe only what is special about the building: its shape, how big it is
next to the cottage, what it is made of, and **one feature nobody could mistake**
(the Granary's stilts, the Library's turret, the Market's awning, the Smithy's
huge chimney, the Guild Hall's bell). Name labels are hidden until hover, so the
outline has to say what the building is. Give each a roof colour no other town
building has. End with "Windows dark, lanterns unlit."

For the night image, in the same conversation: "The exact same image with the
windows glowing warm yellow and the lanterns lit. Change nothing else. Keep the
transparent background."

Reject a result if the door is a different size or shape from the cottage's, if
the outline is thinner or the colour more textured than the Library's, if a side
wall shows, or if the special feature is not obvious at thumbnail size.

### Props, the calmer meadow and the path

These are for the props layer and backdrop in §4b:
- **Same setup as above:** a new chat per batch, with the same two reference
  images (the unlit Library and the unlit thatched cottage).
- **Exact sizes don't matter:** the files are cut, sized and given their
  manifest entries when they go in.
- **Where they go:** put the PNGs in `art/props/` with the file names given.

Paste this first, unchanged (it replaces the building opener):

> Match the attached library image exactly in art style: the same outline
> thickness and deep-brown outline colour, the same flat cel-style shading with
> 3–4 tones per colour, the same level of detail, the same warm palette, the same
> chunky rounded shapes. Do not add texture, gradients, realism or finer detail
> than the reference has. The same view as both attached images: straight on,
> from slightly above. Light from the top left. Use the attached cottage only to
> judge size: its door is about as tall as a villager. No text or lettering
> anywhere.

Then this, unchanged (not for batches 6 and 7):

> Output a PNG with a fully transparent background (real alpha transparency, not
> a white, black or checkerboard fill). Leave a wide margin of empty space around
> every object; nothing may touch the edge of the image. No ground patch, no
> grass under the objects, no cast shadow, no glow or halo, no characters.

Then one batch:

1. **Trees and bushes**
   - Files: `tree_oak.png`, `tree_pine.png`, `tree_apple.png`,
     `bush_round.png`, `bush_flowers.png`. One combined image is fine; it gets cut.
   - Prompt:
     > Draw five separate scenery objects in one image, in a single row with
     > wide empty gaps between them so each can be cut out on its own: 1. A
     > round leafy oak tree, about one and a half times as tall as the attached
     > cottage, with a short visible trunk. 2. A tall slim pine tree, the same
     > height as the oak. 3. A smaller fruit tree with a few red apples, about
     > as tall as the cottage. 4. A round leafy bush, about as tall as the
     > cottage's door. 5. A wider, lower bush with a few small white flowers.
     > Greens should sit well next to the bushes at the base of the attached
     > buildings, a little darker so they read as scenery behind the town.
2. **Little ground things**
   - Files: `flowers_white.png`, `flowers_yellow.png`, `flowers_pink.png`,
     `tuft_1.png` to `tuft_3.png`, `rock_boulder.png`, `rock_stones.png`,
     `mushrooms.png`, `log.png`.
   - Prompt:
     > Draw ten small separate objects in one image, in two rows with wide
     > empty gaps between them so each can be cut out on its own. Each is
     > small: about a quarter to a half of the height of the attached
     > cottage's door. 1–3. Three small flower clumps: one white, one yellow,
     > one pink-red, each a few flowers on short stems with a couple of leaves.
     > 4–6. Three grass tufts of slightly different shapes, a few chunky blades
     > each, in a calm mid green. 7–8. Two rocks: one rounded grey boulder, one
     > flat cluster of two or three small stones. 9–10. A small mushroom pair
     > and a fallen log with a little moss. Keep them simple and low-contrast:
     > they are scattered thinly across a meadow and must not draw the eye
     > away from the buildings.
3. **Village pieces**
   - Files: `well.png`, `bench.png`, `lantern.png`, `lantern_lit.png`,
     `fence.png`.
   - Prompt:
     > Draw four separate village objects in one image, in a single row with
     > wide empty gaps between them so each can be cut out on its own: 1. A
     > round stone well with a little wooden roof, a crank and a bucket, about
     > as tall as the attached cottage's door frame plus its roof. 2. A wooden
     > bench with a back, seen from the front, sized for two villagers (a
     > villager is about as tall as the cottage's door). 3. A wooden lantern
     > post, about one and a half times as tall as the cottage's door, with a
     > small iron lantern hanging from the top. The lantern is unlit: dark
     > glass. 4. A short section of wooden rail fence, two posts and two rails,
     > about as wide as the cottage's door is tall. Windows dark, lanterns
     > unlit.
   - Then, in the same chat:
     > The exact same image with the lantern lit: warm yellow glass and a soft
     > warm glow just around the glass. Change nothing else. Keep the
     > transparent background.
4. **The pond**
   - File: `pond.png`.
   - Prompt:
     > Draw a small village pond seen from slightly above, as one separate
     > object: an irregular rounded shape about twice as wide as the attached
     > cottage and much flatter than it is wide. Calm blue-green water with two
     > or three lily pads, a few reeds and cattails at one end, and a thin edge
     > of earth and small stones around the rim. It lies flat on the ground, so
     > nothing on it stands much taller than the reeds.
5. **A fence end and a signpost** (optional)
   - Files: `fence_end.png`, `signpost.png`.
   - Prompt:
     > Draw two separate objects with a wide gap between them: 1. A single
     > wooden fence end post with one rail stub, matching a simple two-rail
     > wooden fence. 2. A small wooden crossroads signpost with two blank arrow
     > boards (no text) on one post, about as tall as the attached cottage's
     > door.
6. **The calmer meadow** (no transparency opener)
   - File: `meadow_calm.png`. Tile it 3×3 in an image viewer to check; if the
     tile shows, ask for "softer, with less variation".
   - Prompt:
     > A seamless tiling grass texture, square, 1024 × 1024, that repeats in
     > both directions with no visible seam. It is the ground of a flat village
     > meadow seen from slightly above, in the same flat cel-style as the
     > attached images. A calm, even mid green with very gentle variation: soft
     > darker patches, a few faint short strokes. No flowers, no tufts, no
     > yellow patches, no stones, no paths, nothing that would show as a
     > repeating pattern. Fully opaque, no transparency. Keep the contrast low:
     > buildings and villagers stand on it and must stand out.
7. **Dirt path texture** (no transparency opener)
   - File: `path_dirt.png`.
   - Prompt:
     > A seamless tiling texture, square, 512 × 512, that repeats in both
     > directions with no visible seam: a packed dirt footpath seen from
     > slightly above, in the same flat cel-style as the attached images. Warm
     > light brown with a few small pebbles and faint wheel or foot marks. Low
     > contrast and even, so it can be repeated along a long winding path.
     > Fully opaque, no transparency, no grass edges.

Reject a result if:
- the outline is thinner than the Library's, or the colours are textured,
  glossy or have gradients;
- something is drawn from the side or from straight above (the pond is the
  only flat one);
- there is a ground patch, grass base or shadow under a transparent object, or
  anything touches the image edge;
- the objects in a combined image touch (ask for "wider gaps");
- the lit lantern changes anything besides the glass and its glow;
- the meadow or path shows a seam or an obvious repeat when tiled.

Batches 1 and 2 matter most: they fill the meadow straight away.

### The rest of the Home scene (written 2026-11-16)

Buildings use the two building openers at the top of this section, with the
same two reference images, unless a batch says otherwise. Put the PNGs in
`art/buildings/` (buildings and their night images), `art/sites/` and
`art/backdrop/`, with the file names given.

**A. Night images for buildings that have none.** New chat each; attach **that
building's own image** only.
- Files: `market_lit.png`, `smithy_lit.png`, `workshop_lit.png`,
  `guild_hall_lit.png`.
- Prompt:
  > The exact same image, pixel for pixel, with every window glowing warm
  > yellow from inside and every lantern lit. Change nothing else: the same
  > outline, colours, size and position. Keep the fully transparent
  > background. No glow or halo outside the windows and lanterns.
- For the Smithy add: "The forge mouth glows orange as well."
- **The burrow by day** (`house_burrow.png`): attach the lit burrow and ask:
  > The exact same image, pixel for pixel, by day: the windows dark and the
  > lantern unlit. Change nothing else. Keep the fully transparent background.

**B. The Jeweller** (`jeweller.png`, then `jeweller_lit.png`).
> A small, neat jeweller's shop, a little taller than the attached cottage and
> about as wide. Pale plastered walls with dark timber, and a steep roof of
> deep teal slate (no other building in town has a teal roof). The feature
> nobody could mistake: a large faceted gem on a hanging sign over the door,
> and a bay window showing gems and rings on cushions. A small lantern by the
> door. Windows dark, lanterns unlit.

**C. The Outskirts** (one new chat per building; then the night line for any
with windows, a lantern or a fire). Each is about one and a half times as wide
as the attached cottage unless it says otherwise.

| File | Describe it as |
|---|---|
| `farm.png` | A farmhouse barn: red-brown board walls, a big double barn door with a hayloft door above it, hay bales and a pitchfork by the wall, a weathervane. Roof of weathered grey shingles. Unmistakable feature: the hayloft door with hay spilling out. |
| `lumber_camp.png` | An open-sided log shed with a roof of dark green bark shingles, stacked logs on both sides, a sawhorse with a half-cut log, and an axe stuck in a stump. Unmistakable feature: the big neat log piles. |
| `fishing_post.png` | A small wooden fishing hut on a low plank deck, nets hung to dry along the wall, a rack of drying fish, a barrel of fish, and a little rowing boat leaning upturned against the side. Roof of pale silver-grey reed. Unmistakable feature: the nets and the boat. |
| `forager_hut.png` | A small round hut of woven branches with a mossy dome roof, baskets of berries and mushrooms by the door, and bunches of herbs drying under the eaves. Smaller than the cottage. Unmistakable feature: the baskets and hanging herbs. |
| `mine.png` | A timber-framed mine entrance set into a mound of grey rock: a dark tunnel mouth with heavy beams, a little ore cart on short rails, a pickaxe, a hanging lantern. The rock mound is part of the object. Unmistakable feature: the tunnel mouth and cart. |
| `smelter.png` | A squat stone furnace house with a very tall brick chimney, a round furnace mouth (dark and cold), big bellows at the side, and a neat stack of metal ingots. Roof of dark iron-grey plates. Unmistakable feature: the furnace mouth and bellows. Night image: the furnace mouth glows orange. |
| `scout_post.png` | A tall, narrow wooden lookout on four stilts with a ladder, a small roofed platform at the top, a spyglass on a stand and a pennant flag. About two and a half times as tall as the cottage and narrower than it. Unmistakable feature: the height and the ladder. |
| `watchtower.png` | A stout round stone tower with arrow slits, a wooden roofed fighting platform on top, and an iron beacon basket above it (unlit). About two and a half times as tall as the cottage. Roof of dark red tiles. Unmistakable feature: the beacon basket. Night image: the beacon burns. |
| `walls.png` | A town gate: a stone gatehouse with heavy wooden double doors (closed), a walkway and battlements above, a lantern each side, and a short stretch of pointed wooden palisade on both sides. About twice as wide as the cottage. Unmistakable feature: the big gate. |

**D. Scene props you can click** (use the props opener, not the building one).
- `village_green.png`:
  > A village green as one object: a neat oval of short mown grass with a ring
  > of small flowers round its edge, a tall maypole in the middle with four
  > coloured ribbons, and two short poles with bunting. About as wide as the
  > attached cottage is wide twice over; the maypole about twice as tall as
  > the cottage's door. The grass oval is part of the object; nothing else on
  > the ground.
- `wonder_site.png`:
  > A grand building site as one object, about as big as two cottages side by
  > side: pale stone foundations and the first course of a great wall, tall
  > wooden scaffolding with ladders, a wooden crane with a rope and a hanging
  > stone block, stacked cut stones, and a table with a rolled plan. No
  > workers.
- `neighbourhood.png`, then `neighbourhood_lit.png` (the Neighbourhood's door in
  Town):
  > A cosy cluster of four small cottages standing close together as one
  > object, seen from the same view: one with a yellow thatched roof, one with
  > red tiles, one with blue slate and one low turf-roofed burrow, overlapping
  > a little like a tiny village, with a wooden arch and a lantern at the
  > front where a path would enter. About as wide as the attached cottage is
  > wide twice over. Windows dark, lanterns unlit.

**E. Construction sites** (building time, `HOME_SCENE.md` D.8; props opener).
Two images, each a row of three stages with wide gaps:
- `site_small.png` (each stage about the size of the attached cottage):
  > Draw three stages of one small building site in a row, left to right,
  > with wide empty gaps so each can be cut out. Bare timber and grey stone
  > only, so it suits any building. 1. Staked ground: four corner stakes with
  > a rope between them, a pile of timber, a small pile of stone and a
  > wheelbarrow. 2. A bare timber frame of a cottage with no walls or roof,
  > simple scaffolding and a ladder. 3. Nearly done: plain walls up, the roof
  > half covered, scaffolding on one side, a bucket and tools by the door.
- `site_large.png`: the same prompt, replacing "small building site" with
  "large building site", and "about the size of the attached cottage" with
  "about twice as wide and half as tall again as the attached cottage".

**F. Clouds** (`clouds.png`; props opener, but ask for a pale outline):
> Draw four separate clouds in one image with wide empty gaps: one long and
> flat, one tall and puffy, one small, one made of three lumps. Flat cel
> shading in white with a pale blue-grey underside, in the same chunky rounded
> style as the attached images, but with a thin soft outline in pale
> blue-grey instead of deep brown, because they sit far away in the sky.

**G. Smoke** (`smoke.png`; props opener, pale outline as for clouds):
> Draw three small separate puffs of chimney smoke in a row with wide gaps:
> small, medium and large round puffs, soft grey-white with a slightly darker
> underside. Each no bigger than the attached cottage's chimney is wide twice
> over.

**H. A villager at work** (PixelLab, not ChatGPT; `art/villagers/mouse/work_e.gif`):
animate the existing mouse facing east, "hammering: raises a small wooden
mallet above the head and strikes down in front, then lifts again", 6 frames,
the same frame size as the walk. West is mirrored.

### Part F, the town alive: what stands in today and what to make (written 2026-11-17)

Everything in Part F works today with stand-ins drawn by code, so nothing
here blocks anything. Each batch below says what the stand-in is, the file to
make, and the prompt. Put the PNGs in the folder named and run the packer as
for any other art; code picks a file up when it is there and keeps the
stand-in when it is not.

**I. Sounds of work** (step 20; no art, four short sound loops).
The Smithy, Tavern, Market and Workshop each play a quiet loop while someone
is inside, louder as the view pans near. Until the files exist the scene is
silent (nothing breaks).

| File (in `assets/audio/ambient/`) | What it should be |
|---|---|
| `forge.mp3` | A hammer on an anvil at a slow steady pace, a low fire roar, the odd hiss of quenching. |
| `tavern.mp3` | Low friendly chatter with no words you can make out, mugs set down, a chair, a soft lute far off. |
| `market.mp3` | Outdoor bustle: light chatter, a cart wheel, coins, a stall bell now and then. |
| `workshop.mp3` | A handsaw through wood, a plane, a few light mallet taps. |

Each: 15 to 30 seconds, loops with no click at the join, mono, about 96 kbps
MP3, no music with a tune (it would clash with the Home music), and even
loudness (the game sets the volume). Free sources that allow use in games:
freesound.org (filter by the CC0 licence) and pixabay.com/sound-effects. Search
words: "blacksmith loop", "tavern ambience loop", "medieval market ambience",
"carpenter sawing loop". If you use a sound generator, a prompt that works:
> A seamless 20 second loop of [the description above]. Cosy, soft, no music,
> no voices you can understand, no sudden loud sounds.

**J. Smoke, sparks and sawdust** (step 20). Stand-in: soft round puffs drawn by
code. Batch G above (`smoke.png`) replaces the smoke; the sparks and sawdust
are fine as code and need no art.

**K. Fireflies, butterflies, leaves and seeds** (step 20). Stand-in: small
shapes drawn by code (a glowing dot, two yellow wings, an orange leaf, a white
seed). Optional art, `art/props/smalllife.png` (props opener, wide gaps):
> Draw six tiny separate things in a row with wide empty gaps, each no bigger
> than the attached cottage's door knob is wide four times over: 1. a yellow
> butterfly with wings open; 2. the same butterfly with wings half closed;
> 3. a white-and-blue butterfly with wings open; 4. the same with wings half
> closed; 5. an orange autumn leaf; 6. a fluffy white dandelion seed.
No birds, cats or other pets: the villagers are animals themselves.

**L. Weather** (step 21). Everything is drawn by code today. In order of how
much each would add:
- **Clouds** (`art/backdrop/clouds.png`): batch F above. Stand-in: white
  rounded shapes with a blue-grey underside. Code greys them itself on a wet
  day, so draw them white.
- **Puddles** (`art/props/puddles.png`; props opener). Stand-in: pale blue
  ovals. Cut into three and add to the props manifest as `puddle_1`,
  `puddle_2` and `puddle_3` (`file`, `w`, `h`; about 64 × 18 on screen); the
  game uses whichever of the three are there.
  > Draw three separate rain puddles in a row with wide empty gaps, seen from
  > the same high three-quarter view as the attached cottage's doorstep, so
  > each is a flat, wide oval lying on the ground: one small, one medium, one
  > long and irregular. Pale sky-blue water with one or two lighter streaks
  > of reflection and a thin darker rim, no grass, no splashes, no ripples.
  > The medium one about as wide as the attached cottage's door.
- **Snow on roofs.** Stand-in: code finds the top outline of each picture and
  lays a white band along it, so every building, present and future, gets a
  cap with no art. It reads well; proper snowy pictures would be one extra
  image per building (`<key>_snow.png`) and are **not worth making** unless
  winter becomes a long part of play. If you ever do, the prompt is:
  > The exact same image, pixel for pixel, with a thick layer of fresh white
  > snow lying on the roof, the chimney top, the window sills and the sign.
  > Change nothing else: the same outline, colours, size and position. Keep
  > the fully transparent background. No falling snow and no snow on the
  > ground.
- **Rain and snow falling**: fine as code; no art.
- **Blossom, leaves and seeds on the wind**: batch K.

**M. Lost things** (step 22; `art/props/lost.png`; props opener). Stand-in:
four emoji (a basket, a ribbon, a purse, a yo-yo), which look out of place
next to the painted buildings and differ from phone to phone. Worth making
early: it is one small image.
> Draw four small separate things lying on the ground in a row, with wide
> empty gaps so each can be cut out, each about as big as the attached
> cottage's door is wide: 1. a small woven wicker basket tipped on its side
> with two apples spilling out; 2. a red hair ribbon tied in a bow, lying
> flat; 3. a small brown leather coin purse with a drawstring and one gold
> coin beside it; 4. a child's wooden toy, a little painted horse on four
> wheels with a pull string. Seen from the same high three-quarter view as
> the attached images. No grass and no ground under them.

Cut into `lost_basket.png`, `lost_ribbon.png`, `lost_purse.png` and
`lost_toy.png`. They go in the props manifest under the keys `lost_basket`,
`lost_ribbon`, `lost_purse` and `lost_toy` (`file`, `w`, `h`); the game uses
each as soon as its entry is there, with no change to code. In the scene
each is drawn at most 34 px wide.

**N. Decorations the player places** (step 23; `art/props/`; props opener).
Stand-in: simple drawings made by code (flat colours and a brown outline),
which read clearly but look plainer than the buildings. These six are what
the player chooses and pays for, so they are the art most worth making after
the buildings. Two chats of three.

Chat 1 (`decor_bench.png`, `decor_flower_bed.png`, `decor_fence.png`):
> Draw three separate small things in a row with wide empty gaps so each can
> be cut out, seen from the same high three-quarter view as the attached
> cottage: 1. a wooden garden bench with a slatted back, about as wide as
> the attached cottage's door is wide twice over; 2. a low wooden planter
> box full of flowers in pink, yellow, white and purple, the same width as
> the bench; 3. one straight piece of low wooden picket fence with four
> pointed pickets and two rails, the same width as the bench, drawn so that
> several placed side by side would join up. Nothing on the ground under
> them.

Chat 2 (`decor_well.png`, `decor_pond.png`, `decor_lantern.png`):
> Draw three separate things in a row with wide empty gaps so each can be
> cut out, seen from the same high three-quarter view as the attached
> cottage: 1. a round stone well with a small red-tiled roof on two wooden
> posts, a rope and a hanging wooden bucket, about as tall as the attached
> cottage's door and as wide as the door is wide twice over; 2. a small
> garden pond seen from above at the same angle, so it is a wide flat oval
> about as wide as the attached cottage is wide by half, with a rim of
> grass and small stones, pale blue water, two lily pads and a few reeds at
> one end; 3. a tall wooden lantern post with an iron lantern on top, the
> lantern unlit with dark glass, the post about as tall as the attached
> cottage's door and very thin. Nothing on the ground under them.

Then, in the same chat as the lantern, its night image
(`decor_lantern_lit.png`):
> The exact same lantern post, pixel for pixel, with the lantern lit: warm
> yellow glass. Change nothing else. Keep the fully transparent background.
> No glow or halo outside the glass (the game adds the glow itself).

How they go in: add each to the props manifest
(`assets/images/scene_v2/props/manifest.json`) under the key `decor_<kind>`
(`decor_bench`, `decor_lantern`, `decor_flower_bed`, `decor_fence`,
`decor_well`, `decor_pond`) with `file`, `w`, `h` and, for the lantern, `lit`
and `lamp: [x, y]` (the middle of the glass, in on-screen pixels from the
picture's top-left, where the glow is drawn). Sizes on screen today, as a
guide: bench 58 × 36, lantern 26 × 64, flower bed 56 × 28, fence 62 × 32,
well 68 × 74, pond 116 × 46. An entry named `decor_…` is never scattered
automatically; the scenery's own bench, lantern, fence, well and pond (the
"Props" batch above) can be the same pictures under their own keys.

**O. The town crier's bell** (step 24). Stand-in: a bell emoji in a speech
bubble over the crier's head, which swings. It reads well and needs nothing.
If you want the crier to look the part, the nicer version is an animation
(PixelLab, as batch H; `art/villagers/mouse/bell_e.gif`): animate the
existing mouse facing east, "ringing a hand bell: holds a small brass hand
bell up beside the head and swings it side to side twice, then lowers it a
little", 6 frames, the same frame size as the walk. West is mirrored. The
bubble then goes and only the mark for news stays.

**P. Photo mode** (step 24). Needs no art. One thing to know when adding
art: pictures (PNG/WebP in an `<img>`), sprite sheets and drawings are picked
up by the photo painter by themselves, so new buildings, props and villagers
appear in saved pictures with no extra work.

**Q. The merchant's cart** (step 25; `art/props/merchant_cart.png`; props
opener). Stand-in: a cart drawn by code (a brown box on two wheels with a
red-and-cream striped awning and a few coloured goods). One image.
> A travelling merchant's market cart as one object, seen from the same high
> three-quarter view as the attached cottage and about as wide as the
> cottage's door is wide three times over: a sturdy wooden hand cart on two
> big spoked wheels with a red-and-cream striped cloth awning on four thin
> posts, its top loaded with goods for sale: a basket of apples, a round of
> cheese, bolts of coloured cloth, a few clay jars, a hanging lantern
> (unlit) and a small set of brass scales. Two wooden handles at one end
> resting on a short prop. No merchant, no animal, nothing on the ground.

Add it to the props manifest under the key `merchant_cart` with `file`, `w`
and `h` (today's stand-in is 104 × 86 on screen). A merchant character to
stand beside it would be a villager of another species (when those exist),
not a new kind of art.

**R. Events in the scene** (step 26; `art/props/`; props opener). Stand-ins:
flames, a bush with eyes and a small cart, all drawn by code. They are on
screen for a few hours every few days, so they are the last props worth
making. One chat:
> Draw three separate small things in a row with wide empty gaps so each can
> be cut out, seen from the same high three-quarter view as the attached
> cottage: 1. a cluster of three cartoon flames for a roof fire, orange with
> yellow hearts and a deep-brown outline, about as wide as the attached
> cottage's door is wide twice over, with no smoke; 2. a round leafy green
> bush about as wide as the attached cottage's door, with two wide white
> cartoon eyes peeping out of the leaves and nothing else of the creature
> showing; 3. a small two-wheeled wooden hand cart loaded with a few apples
> and cabbages, tipped slightly forward as if rolling, about as wide as the
> attached cottage's door is wide by one and a half. Nothing on the ground.

Files: `event_fire.png`, `event_bush.png`, `event_cart.png`. They go in the
props manifest under the keys `event_fire`, `event_bush` and `event_cart`
(`file`, `w`, `h`); the game uses each as soon as its entry is there. On
screen today: flames 70 × 60, bush 54 × 40, cart 66 × 46.

**S. Stand-ins from the earlier steps** (steps 13 to 17), listed here so the
whole set is in one place.
- **Emotes over heads** (step 14). Stand-in: emoji in a small bubble (a
  smile, a note, a heart, a frown, a rain cloud, a bowl, a house with a
  question mark, a lantern, three dots). They differ from phone to phone and
  sit oddly beside pixel villagers. `assets/sprites/emotes.png`, a strip of
  eleven 16 × 16 pixel-art icons (PixelLab, or any pixel editor; ChatGPT
  does not hold a 16 px grid well):
  > A sprite strip of eleven 16×16 pixel-art emote icons on a transparent
  > background, in a row with no gaps, each with a 1-pixel deep-brown
  > outline and at most four flat colours, in the same palette as the
  > attached mouse sprite: 1 a smiling face, 2 a musical note, 3 a red
  > heart, 4 a sad face, 5 a small rain cloud, 6 an empty bowl, 7 a tiny
  > house with a question mark, 8 a paper lantern, 9 three dots, 10 a hand
  > bell, 11 a wooden bucket.
- **Dancing and cheering** (steps 13 and 16: a festival ring on the green,
  builders cheering). Stand-in: the idle animation with a little hop.
  PixelLab, as batch H (`art/villagers/mouse/cheer_s.gif`): the existing
  mouse facing the viewer, "cheering: both arms thrown up, a small jump, and
  down again", 6 frames, the same frame size as the walk. One direction is
  enough.
- **Worn and broken buildings** (step 17, upkeep). Stand-in: code dulls a
  worn building's colours and lays faint cracks over it, and greys a broken
  one with boards across it. It reads clearly. Proper pictures would be two
  more images per building (`<key>_worn.png`, `<key>_broken.png`), about
  fifty images in all, and are **not worth making** now. If one building
  ever deserves it (the Tavern, say), attach that building and ask:
  > The exact same image, pixel for pixel, but in poor repair: a few roof
  > tiles missing, one cracked window pane, the paint faded and a plank
  > hanging loose. Change nothing else: the same outline, size and position.
  > Keep the fully transparent background.
  and for broken: "…but derelict: holes in the roof, the door off one hinge
  and boarded across, the windows dark and broken, weeds at the foot."
- **A repair under way** (step 17). Stand-in: the building's site sign. The
  construction-site art (batch E) covers it.

**T. The six elders** (Phase 3, the guide; `assets/images/guide/`). Stand-in:
the species' emoji in a round badge. These are the characters who greet every
new player, shown large at the lower left with the dialogue box across the
bottom (the layout of the owner's reference picture), so they are worth doing
well. One chat per elder; attach the unlit Library for the palette and
outline, and say the character is to stand beside it in the same world.

What the game needs from each picture:
- **File:** `mice.webp`, `badgers.webp`, `otters.webp`, `moles.webp`,
  `foxes.webp`, `hares.webp` (PNG is fine to hand over; it is converted).
- **Framing:** from the waist up, cut off straight at the bottom edge (the
  bottom of the picture sits on the bottom of the screen). The figure fills
  the height. Body turned a little to the viewer's right, towards where the
  dialogue box is, face to the viewer.
- **Size:** portrait, about 900 wide by 1100 tall or larger. On screen it is
  up to 62 % of the screen's height and at most 520 px wide.
- **Background:** fully transparent. No ground, no shadow, no frame, no text.
- **Keep the lower right quiet:** the dialogue box overlaps that corner, so no
  hands, props or detail that matters there.

The opener, for every elder:
> A character illustration for a cosy storybook village game: an elderly
> anthropomorphic [ANIMAL], shown from the waist up, body turned slightly to
> the right and face to the viewer, standing as if greeting a newcomer. Warm,
> friendly and full of character. Clean deep-brown outlines and flat
> cel-style shading in 3 to 4 tones per colour, in the same warm palette and
> chunky rounded style as the attached building, but drawn with more care in
> the face and hands, as a main character would be. Simple woodland-village
> clothes in muted natural colours. Portrait format, the figure filling the
> height and cut off straight at the waist by the bottom edge. Output a PNG
> with a fully transparent background (real alpha, not white or checkerboard):
> no ground, no shadow, no frame, no text.

Then one of these:

| File | [ANIMAL] and the rest of the description |
|---|---|
| `mice.webp` | "mouse. Old Bramble: small and round, grey whiskers, tiny round spectacles on the end of the nose, a knitted shawl, and an abacus or a little notebook tucked under one arm. Fussy and kind; one finger raised as if counting." |
| `badgers.webp` | "badger. Gran Holt: broad and sturdy, a striped face gone grey at the muzzle, rolled sleeves, a leather work apron, arms folded. Blunt and proud; the smallest of smiles." |
| `otters.webp` | "otter. Uncle Reedy: sleek and cheerful, a floppy fishing hat with a hook stuck in it, a patched waistcoat, a net over one shoulder. Mid-laugh, glancing off to one side as if he has just seen the river." |
| `moles.webp` | "mole. Deepa Loam: small, velvety and calm, half-closed eyes behind thick round glasses, a miner's cloth cap, big soft digging hands folded in front. Patient and still." |
| `foxes.webp` | "fox. Aunt Russet: lean and elegant, a white-tipped ear, a fine embroidered scarf, a single earring, one eyebrow raised. Sly and amused, holding a coin between two fingers (held high, near the shoulder)." |
| `hares.webp` | "hare. Thistle the Elder: tall and wiry, long ears with one bent, a runner's short cloak pinned at the shoulder, leaning forward a little as if about to dash off. Brisk and a little out of breath." |

When the first one is right, attach it to the other five chats and add "in
exactly the same style, line weight and level of detail as the attached
character", so the six look like one cast.

They go in `assets/images/guide/` under those names and the game uses each
as soon as the file is there (`js/guide.js` `characterUrl`); nothing else
changes. Later, if wanted: a second and third expression per elder
(`<species>_happy.webp`, `<species>_worried.webp`) for the lines that call
for them. Those are not wired yet.

### How a picture replaces a drawing

For everything in Part F the rule is the same: the picture goes in
`assets/images/scene_v2/props/` and gets an entry in that folder's
`manifest.json` under the key given in its batch, with `file`, `w` and `h`
(on-screen pixels). The code asks the manifest for that key
(`KWGround.picture(key)`), and draws the picture when it is there and its own
drawing when it is not. No code changes when art arrives. Keys in use:
`decor_bench`, `decor_lantern` (with `lit` and `lamp`), `decor_flower_bed`,
`decor_fence`, `decor_well`, `decor_pond`, `merchant_cart`, `lost_basket`,
`lost_ribbon`, `lost_purse`, `lost_toy`, `event_fire`, `event_bush`,
`event_cart`, `puddle_1` to `puddle_3`. An entry with no `kind` is never
scattered as scenery. Clouds, smoke and the emote strip are not wired yet
(they are low on the list below).

### What to make, in order (updated 2026-11-17)

Everything on this list has a stand-in in the game today, so the order is by
how much each improves what the player sees.

| # | Batch | What | Tool | Why now |
|---|---|---|---|---|
| 1 | A | The Workshop's night image | ChatGPT | finishes the lit set for Town |
| 2 | N | The six decorations and the lit lantern | ChatGPT | the player chooses and pays for these |
| 3 | E | Construction sites, small and large | ChatGPT | every building passes through them once building time is on |
| 4 | C, B | The Outskirts buildings and the Jeweller | ChatGPT | the last placeholder huts |
| 5 | — | Scenery props, the calmer meadow and the path texture ("Props" above) | ChatGPT | the ground is bare without them |
| 6 | M | Lost things (one image of four) | ChatGPT | replaces emoji seen every day |
| 7 | Q | The merchant's cart | ChatGPT | one image; seen one day in four |
| 8 | S | The emote strip | PixelLab | replaces emoji seen all the time |
| 9 | H, S | Work and cheer animations for the mouse | PixelLab | builders and festivals |
| 10 | I | The four sound loops | freesound or a generator | the scene is silent without them |
| 11 | D | Village green, Wonder site, Neighbourhood door | ChatGPT | props you can click |
| 12 | F, G, L | Clouds, smoke, puddles | ChatGPT | weather reads well without them |
| 13 | R, K, O | Fire, bush and small cart; butterflies and leaves; the bell animation | ChatGPT, PixelLab | rare or tiny |
| 14 | — | The other six species of villager | PixelLab | the largest job; last |

Ahead of all of these, now that the guide is built: **batch T, the six elders** (ChatGPT). Every new player meets one in their first minute.

Not worth making (code does it well enough): snowy buildings, worn and broken
buildings, rain and snow, sparks and sawdust.
