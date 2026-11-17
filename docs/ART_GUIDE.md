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

Still to make, in a sensible order: the Workshop's night image (the rest of
batch A is in); the scenery props, calmer meadow and path texture above; batch E (building
time is the next thing built); the Outskirts (C) and the Jeweller (B); the
scene props (D); clouds and smoke; then the other species.
