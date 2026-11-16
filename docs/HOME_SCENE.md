# The living Home scene (build spec)

Status: **agreed with the owner 2026-11-15, not built.** This replaces the Home
part of `LAYOUT_SPEC.md` §2.2 (the chips). Mockup: the first board of the layout
canvas ("Home as a living scene").

The aim: Home should feel like a small town you look into, not a picture with
buttons laid over it. Two changes do that. Buildings become the way into each
screen, and the townsfolk are seen walking about and can be clicked.

Parts A and B are **frontend only and cosmetic**. Nothing a villager does on
screen changes the game, and the server is not told where anyone is standing.
Part C (the Neighbourhood) adds a little server data. **Parts D and E (builders,
building time and upkeep) are real changes to play** and have the server work; treat them with
the same care as Phase 1.

> **The look changed on 2026-11-16.** `docs/ART_GUIDE.md` has the new art direction (a flat meadow, cartoon buildings, WebP at twice size, day and lit pairs), the art that already exists in `assets/images/scene_v2/`, and the steps to put it in. Where it differs from this document, the art guide wins.

---

## 0. Before this: two fixes from the review

Both done (2026-11-15).

1. ~~**The beds cliff.**~~ **Done 2026-11-15** (`lib/beds_cliff.js`, run once at
   boot after the migrations, guarded by `migration_marks` key `beds_cliff_homes`;
   `life_test` "The beds cliff"). Every town with more living people than beds
   gets free Willow Huts (4 beds each: an ordinary `buildings` row and `houses`
   row, so the Neighbourhood shows them) until beds ≥ the living, one `town`
   chronicle line ("The town raised homes for everyone: N new Willow Huts,
   free."), and housing sorts itself. Each town is its own transaction with a
   10-second lock wait, so a deploy beside the old server can't double-grant;
   a town that fails is logged and the mark waits for the next boot. Notes:
   - the grant can take a town past its tier's hut limit (camp 5, village 15,
     town 30); the limit then only stops new huts until the town grows;
   - beds ≥ living leaves 0–3 beds free. The town grows again as soon as
     there is a free bed (or the player builds a hut while under the limit);
   - **new towns still arrive with 10 people and no huts** (`routes/map.js`
     `/arrive`), so a new player must build huts before the first birth or
     settler. That is a design question for Phase 3, not this fix.
   Was: Towns that existed before the life cycle have far more
   people than beds (the owner's: 83 people, 24 beds; a test town: 10 and 0).
   Births and settlers both need a free bed, and the migration capped everyone
   at 45, so these towns age together and then empty. Fix, once per town,
   guarded by `migration_marks`: grant plain homes until beds ≥ living people
   (4 beds each, placed in the Neighbourhood, free), and write one chronicle
   line ("The town raised homes for everyone"). Add a `life_test` case.
2. ~~**The deploy workflow.**~~ **Done 2026-11-15**, differently: the site deploys from Porkbun (the repo's files as they are), so the workflow became a test check (`.github/workflows/proofs.yml`), and proofs that need the server repo skip and say so (the full suite runs them). Was: it fails on every run because
   `verify/research_proofs.js` needs the server repository and the workflow
   checks out the frontend alone. Check out the server repository beside it (or
   skip that one proof in the workflow with a clear log line). Until this is
   green the host serves raw files and none of the bundling is live.

---

## 1. Decisions already made

| Question | Decision |
|---|---|
| Art style | The owner is moving **all** art to a soft, cartoony pixel style with a painterly touch. Villagers come first, then buildings, then backdrops. |
| Villager sprites | One set **per species** (7). Each set: walk and idle, 8 directions. Mouse exists now. |
| Who is shown | Real citizens only: alive, and in town. Not on a quest, at an outpost, scouting, trading on the road, hauling or away as an envoy. |
| Clicking a villager | A **radial menu** around them, not a card: Inspect, Family, Change work, House. |
| Selected villager | Highlighted, and stands idle until the player clicks away. |
| Movement | Purposeful: into and out of buildings, meeting and "talking". |
| Game effect | None: the scene only **shows** the game's state, it never changes it. |
| Moments | In this build: a villager with an open moment stands with an exclamation mark (§3.7). |
| Build mode | One Build mode replaces Build and Edit (§2.3). |
| Outskirts | Have villagers from the start, the same as Town. |
| Sprite delivery | One GIF per direction; a script packs them into sheets (§3.1). |
| Mood, life events, town events | Agreed and in this build (§3.8 to §3.10), after the core. |
| Neighbourhood | Its own scene, for houses only, with villagers. Houses snap to a grid of plots. Built so a town can have **several neighbourhoods later** (Part C). |
| House styles | A few to start, cosmetic only. Paid cosmetics much later. |
| Building time | Buildings are no longer instant. A new **builder** job does the work (Part D). |
| No builders | **Nothing gets built.** (Owner's choice over a slow base rate; §D.5 lists the guard rails this needs.) |
| How long | Short: minutes for early buildings, about 2 hours at most with one builder. |
| Several sites | A queue in the player's order; all builders work on the first. |
| Upkeep | Buildings have **health**. Builders keep it up; with no builders buildings wear down until they stop working, and must be repaired. Repairs cost no materials for now (Part E). |
| Art | The owner will make four new house styles, and later a work animation per species and construction-site art. Placeholders until then. |
| Building art | The owner will generate it. Build with placeholders that swap out. |

---

## 2. Part A: buildings are the buttons

### 2.1 What goes

The chip row on Home (`TOOLS.home` in `js/places.js`) goes, except **Build**.
The Town / Outskirts / Edit toggles in the scene's own header go too.

### 2.2 What each thing opens

A click (or Enter) on a built building opens its main screen:

| Building | Opens | Today's call |
|---|---|---|
| Granary | Stores | `openInventoryModal()` |
| Tavern | The tavern | `visitTavern()` |
| Market | The market | the Market screen (stays in The Road as well) |
| Library | Research | `openLibrary()` |
| Workshop, Smithy, Jeweller | Crafting, on that station | `openCraftingAny()` with the station chosen |
| Guild Hall | Upgrade the town | `openTierUpgradeModal()` |
| Neighbourhood | Homes | `openHousingModal()` |
| Fishing Post | Fishing | `visitFishingPost()` |
| Every other building (farm, mine, lumber camp, …) | Its own panel: workers, output, upgrade | the existing `sv-bp` panel |

Things that are not buildings get a **prop** in the scene:

- **Festival**: a village green with a maypole, shown once festivals unlock.
- **Wonders**: a building site with scaffolding, shown from City tier.
- **Town ↔ Outskirts**: a wooden signpost at the right edge of Town ("To the
  Outskirts →") and at the left edge of the Outskirts ("← To town").

### 2.3 Build mode

One **Build** button remains, top left. It replaces both Build and Edit:

- Off (normal): empty plots are hidden. Buildings open their screens.
- On: empty plots show ("Build here"), buildings can be dragged to another
  plot, and a click on a building opens the manage panel (upgrade, demolish).
  Villagers are hidden. A "Done" button and Esc leave the mode.

A town with nothing built yet starts with Build mode's plots showing, so a new
player is never looking at an empty meadow with no way forward.

### 2.4 Labels and bubbles

- Name labels are **not** shown all the time. Hover or keyboard focus lifts the
  building slightly, adds a warm glow and shows a nameplate: name, and one line
  saying what it opens ("Granary · Open the Stores").
- On touch there is no hover: the first tap opens the screen directly. To keep
  buildings findable, all nameplates show for 4 seconds when Home opens, and a
  "Show names" toggle sits in the profile menu (on by default for a player's
  first 3 days).
- A **bubble** floats over a building when something there is waiting: a craft
  finished, research done, a visitor at the tavern, stores full, a festival
  ready. One bubble per building, the most urgent wins. The bubble text is
  short ("Sickle ready"). These reuse the dots the place bar already tracks.
- Under construction or upgrading: scaffolding overlay and the time left on the
  nameplate.

### 2.5 Every building is a real button

Each is a `<button>` with an `aria-label` that says the name and what it opens.
Tab order follows left to right. The profile menu keeps a plain list of the
same screens as a fallback (it is also what a screen reader user will prefer).

### 2.6 Placeholders and art

Until a building has art it shows a tidy placeholder in the new style: a simple
hut silhouette in the building's colour with its glyph on a hanging sign. No
bare emoji blocks.

Art the owner will supply (transparent PNG, drawn at the **same pixel size as
the villagers**, so a doorway is about 70 px tall next to a 62 px villager;
most buildings 220 to 320 px wide):

`tavern, market, granary, neighbourhood, starter_house, farm, lumber_camp,
fishing_post, forager_hut, guild_hall, smithy, jeweller, workshop, mine,
smelter, library, walls, watchtower, scout_post`, plus props: `village_green,
wonder_site, signpost`.

Files go in `assets/images/buildings/<key>.png`. Add
`assets/images/buildings/manifest.json` with, per key, the image size and the
**door point** (x, y in the image) where villagers go in and out. A missing
entry means "use the placeholder and the bottom centre as the door".

---

## 3. Part B: villagers

### 3.1 Sprites

The owner's sprite: 96 × 96 px frames, 6 frames, 200 ms each, the figure about
47 × 62 px inside the frame. Walk and idle, 8 directions.

- The owner delivers GIFs (as generated). A script, `scripts/pack_sprites.js`,
  packs them into two sheets per species:
  `assets/sprites/villagers/<species>_walk.png` and `<species>_idle.png`.
  Rows are directions in this order: S, SW, W, NW, N, NE, E, SE. Columns are
  frames. The script also writes `villagers.json` (frame size, frame count,
  frame time, the foot point). Source GIFs live in `art/villagers/<species>/`
  named `walk_se.gif`, `idle_s.gif`, and so on.
- If a species has no sheet yet, use the mouse sheet. If a direction is
  missing, mirror its opposite (W from E, NW from NE, SW from SE).
- Draw with `image-rendering: pixelated` at **whole-number scale only** (1× on
  desktop and phone; 2× on very large screens). No depth scaling: pixel art
  shimmers at odd sizes.
- Variety without more art: children are drawn at 0.75× (the one exception to
  the whole-number rule; revisit if it looks soft), elders walk slower, and
  each family gets a cloak tint from a small palette (a CSS `hue-rotate` on the
  sprite, tuned so fur does not turn green; if that looks wrong, drop it).

### 3.2 How they are drawn

Each villager is a DOM element (a `<button>` holding a sprite `<div>` whose
`background-position` steps through the sheet) inside the scene's foreground
layer, the same layer as the building slots. Reasons: clicks, focus and screen
readers come free; and villagers can pass in front of and behind buildings
simply by `z-index = their foot y`. Buildings get `z-index` from their own foot
y the same way.

One `requestAnimationFrame` loop moves everyone with `transform` only. It stops
when Home is not showing, when the tab is hidden, in Build mode, and for
players who ask for reduced motion (they get villagers standing idle in place).

### 3.3 Who is on screen (the cast)

- Eligible: living citizens for whom `citizenAway(c)` is null.
- Shown at once: up to **14** on desktop, **8** on a phone. A city of 83 does
  not put 83 figures on the meadow. The rest count as "indoors".
- Picking: anyone who is the subject of an open moment first (§3.7); then
  spread across families; a child only together with one of its parents;
  at least one elder if the town has one.
- Town shows people who work in town buildings, the unemployed, children and
  elders. The Outskirts show people who work in outskirts buildings.
- The cast changes slowly: every minute or so one villager walks into a
  building and a different one walks out. Nobody pops in or out of thin air,
  except when Home first opens (start them spread out, some indoors).
- When citizen data refreshes: someone who has left (quest, death) walks into
  the nearest building and is dropped; nobody is re-created if still present.

### 3.4 Where they can walk

Positions use the slots' own percent coordinates. Each area has one walkable
ground polygon (`SV_GROUND = { town: [...], outskirts: [...] }`, roughly the
band from y 66 % to 94 %). Villagers walk in straight lines between points
inside it. No obstacle avoidance in the first version: depth sorting makes
walking "behind" a building read correctly.

Points of interest: each built building's door (from the manifest, following
the building if the player moved it), plus a few named spots per area (the
well, the riverbank, the signpost, a bench by the tavern).

Speed about 40 px a second for adults, 30 for elders, 55 for children. The
direction row is chosen from the movement angle (8 ways).

### 3.5 What they do

A small state machine per villager, client-side, with a seeded random source so
tests can replay it:

| State | What happens |
|---|---|
| **Errand** | Pick a place that makes sense (own workplace by day, the tavern in the evening, home at night, otherwise a named spot). Walk there. |
| **Indoors** | At a door: fade out over 300 ms, stay "inside" 20 to 60 s, fade in, pick a new errand. The building gives a tiny bounce when someone enters. |
| **Idle** | Stand with the idle animation for 3 to 10 s, facing the camera or the nearest villager. |
| **Chat** | Two villagers who are both free and within about 200 px walk to each other, stop a step apart facing each other, and take turns showing a small speech bubble (three animated dots, sometimes a tiny picture: fish, heart, acorn, music note) for 4 to 7 s. Then both go on their way. A pair does not chat again for 2 minutes. |
| **Follow** | A child walks a little behind a parent, and now and then runs ahead and waits. Two children near each other may chase for a few seconds. |
| **Selected** | See §3.6. |
| **Waiting** | See §3.7. |

Time of day (the game clock the top bar already shows): by night most of the
cast is indoors and two or three are out; the tavern's windows glow. Morning
sends workers toward their buildings.

### 3.6 Selecting a villager: the radial menu

- Click, tap or Enter on a villager selects them. They stop, switch to idle
  facing the camera, and get a bright outline and a ring on the ground. The
  rest of the town carries on. Nearby villagers will not start a chat with them.
- Their name and one line appear under them ("Poppy Brightburrow · farmer, 20").
- Round buttons fan out in an arc around them (above by default; the arc turns
  to stay on screen near an edge). Each is 44 px (48 on touch) with an icon and
  a short label beneath:

| Button | Does | Call |
|---|---|---|
| Inspect | The full profile | `openCitizenProfile(id)` |
| Family | Their family line | `KWFamilies.open({ family })` |
| Change work | Pick a job | the existing job picker for that citizen |
| House | Where they live, move them | `openHousingModal()` on their home |

- Children have no Change work. Youths show **Apprenticeship** in its place.
- Click elsewhere, Esc, or choosing a button deselects. After a window opened
  from the menu closes, the villager walks on.
- Keyboard: Tab reaches villagers after the buildings; arrow keys move between
  the menu's buttons.
- The menu opens with a quick fan-out (150 ms); none under reduced motion.

### 3.7 Moments

A citizen who is the subject of an open moment is always in the cast. They
stand at a clear spot near the centre with a bobbing **!** bubble. Clicking
them opens that moment in the dialogue box instead of the radial menu. If the
moment payload does not already name its citizen, add `citizen_ids` to it.
This is the first tie between the scene and play, and the cheapest one.

### 3.8 Mood

Small emotes over heads, driven by the town's real state, so the scene reads as a
picture of how the town is doing. An emote is a little bubble with one pixel icon,
shown for 2 to 3 s, on at most two villagers at a time, each villager at most once
a minute. The mix follows the numbers:

| State (from data the client already has) | Emote | Behaviour |
|---|---|---|
| Happiness high (70 % and up) | green smiling face, music note, heart | now and then a villager does a little hop or two dance a few steps together |
| Happiness middling | none, or a plain "…" | normal |
| Happiness low (under 40 %) | grey frowning face, rain cloud | walks slower, idles longer, fewer chats |
| Food short or famine | empty bowl | some stand by the granary |
| No bed (unhoused) | small house with a question mark, on that villager only | idles near the Neighbourhood |
| Festival running | music note, lantern | see §3.10 |

Use the villager's own happiness where the citizen data has it, the town's
otherwise. Colour is never the only signal: the faces differ in shape as well as
colour. Emote icons are one small sheet (`assets/sprites/emotes.png`, 16 × 16 px
each, drawn at 2×); until the owner supplies it, draw simple placeholders.

Dancing needs no new art in the first version: a dance is the idle animation with
a hop and a turn through the directions. If the owner later makes a dance or
cheer animation per species, the packer picks up `dance_*.gif` the same way.

### 3.9 Life events seen happening

Driven by new chronicle entries (the client already loads the chronicle). When
Home is showing and a new entry arrives, or one is under 10 minutes old when Home
opens, play its small scene once. Each lasts under a minute and is skipped under
reduced motion (the news line still appears).

| Chronicle kind | Scene |
|---|---|
| Birth | The parents stand outside their home with a heart bubble; a neighbour walks over and "chats". |
| Coming of age | The new adult walks from home to their workplace with a star bubble; the first villager they pass gives a hop. |
| Partnership | The two walk side by side across the town with hearts. |
| Death | Up to four villagers, family first, gather by the home with a candle bubble, stand a while, and leave slowly. No dancing or happy emotes in town for those minutes. |
| Settler arrives | The newcomer walks in from the edge of the scene with a bundle bubble and goes to their new home; someone meets them on the way. |
| Inheritance | The heir walks to the home and comes out with a small sparkle. |

Only one such scene plays at a time; others wait their turn, newest dropped first
if more than three are waiting. People in a scene join the cast for its length
even if the cast is full.

### 3.10 Town-wide events

| Event | Scene |
|---|---|
| Festival running | Most of the cast gathers on the village green and dances in a loose ring, lanterns and notes above; a few still wander. |
| Raid incoming or under way | Villagers hurry indoors (run speed); guards stand at the gate or walls in the Outskirts; the town is nearly empty until it ends, then people come out, with relieved or sad emotes by the result. |
| Famine | See §3.8: bowls, slow walking, a small crowd at the granary. |
| Night | Most indoors, windows lit (§3.5). |
| Tier upgrade just finished | Everyone out cheers once (hop, star bubbles). |

Priority when several apply: raid, then death, then festival, then the rest.

---

## 3C. Part C: the Neighbourhood

### C.1 What it is

Clicking the Neighbourhood in Town no longer opens the housing window. It opens a
third scene, beside Town and Outskirts, that holds **only houses**. Villagers
walk here too. The old housing window (`js/housing.js`) is retired; what it did
moves into this scene.

In Town, the Neighbourhood stays as one building: a cluster of roofs that is the
door to the scene. Its nameplate shows beds ("Homes · 18 of 20 beds") and its
bubble warns when people have no bed. A signpost in the scene leads back to town.

### C.2 Data (server)

Model it for several neighbourhoods from the first day, even though a town has
one for now.

- New table `neighbourhoods (id, settlement_id, name, position, created_at)`.
  A migration gives every town one ("The Old Quarter").
- `houses` gains `neighbourhood_id`, `plot` (a number), `style` (text, default
  `thatch`) and, for Part D, a state. `(neighbourhood_id, plot)` is unique.
  The migration puts existing houses on plots in the order they were built.
- Every route takes or returns a neighbourhood id. Nothing may assume "the"
  neighbourhood. Beds are still counted across the whole town.
- New routes: place a house on a plot (pays the cost, starts construction),
  move a house to a free plot (free, instant), set its style (free, instant),
  demolish (as now: residents lose their bed first).

### C.3 Plots

- Each neighbourhood is a grid: **3 rows of 12 plots, 36 in all**, along lanes.
  The scene is about three screens wide and pans sideways (drag, arrow keys, or
  the mouse at the edge). It opens centred on the newest house.
- Plots open with the town's tier: Camp 6, Village 12, Town 24, City 36. (36
  houses is 144 beds; when that is not enough, the second neighbourhood is the
  answer, not a bigger grid.) If a town already has more houses than its tier
  allows, it keeps them all.
- In Build mode free plots show as staked ground. Outside it they are plain
  grass, so the place looks like a village, not a form.
- Doors face the lane, so every house can be reached by walking the lanes. That
  is the reason for a grid: no path-finding is needed.

### C.4 Styles

- A style is **looks only**. Every house holds the same beds
  (`LIFE.HOUSE_BEDS`, 4) whatever it looks like. Keep it that way for ever:
  when paid cosmetics arrive they must never be worth beds or happiness.
- Start with four. The owner is making the art; until it arrives use stand-ins
  (thatched cottage, timber-frame house, stone cottage, turf-roof burrow). The catalogue lives on the server (`lib/house_styles.js`): `key`,
  `label`, `source` (`base` for all four now; later `festival`, `shop`, …). The
  server checks a player owns the style they ask for, so the later shop needs no
  redesign.
- Changing a house's style is free and instant. Art: one PNG per style at the
  shared pixel size, door point in the buildings manifest.

### C.5 The scene

- The same engine as Town (§3). The cast is drawn from people who **live** here.
  Errands centre on home: out of their own door in the morning, back at night,
  chats over the fence, children playing in the lane.
- A house with people in it has lit windows at night and chimney smoke. An empty
  house is dark.
- Nameplate on hover: the house's name and who lives there. Houses are named for
  the family in them ("The Brightburrow home") unless the player has renamed it;
  a mixed house keeps its given name. This replaces "Willow Hut #3".
- Clicking a house opens its panel in the context panel: residents (each one
  clickable), free beds, move someone in or out, rename, change style.
- Build mode here: place a house, drag one to another plot, demolish.
- A villager without a bed (§3.8) stands in the lane by a free plot.

### C.6 Later (not now)

- **More neighbourhoods**: a new one opens at a later tier, each with its own
  backdrop (riverside, hillside). A row of signposts picks between them.
- **Decorations** on plots and lanes: wells, gardens, fences, lanterns, washing
  lines. These are the natural paid or festival cosmetics.
- **A family's home growing with the family**: a porch or a second storey as a
  line reaches its third generation. Looks only.

---

## 3D. Part D: builders and building time

### D.1 The change

Today a building, an upgrade or a house is finished the moment it is paid for.
After this, paying starts a **construction site**. Builders work on it and it is
finished when the work is done.

### D.2 The builder job

- A new class, `builder`, in `lib/careers/classes.js`. It **needs no building**
  (`needs: null`), so a brand-new camp can have one. Adults only, like other jobs.
- Each builder who is in town (alive, adult, not away) adds work to the first
  site in the queue. Builders earn career XP from work done. Their tree is short
  for now: faster building at each step, a capstone with a clear number. The
  Stonemason keeps the cost discount; builders are about speed, not price.
- With nothing to build, builders **look after the town** (Part E). They do not
  gather resources.

### D.3 Work and time

- Every site has `work_needed`, in builder-minutes. One builder does one unit a
  minute before perks.
- Sizes, all in `lib/tuning.js` so they can be changed live:
  a house 5; a first-level building 3 to 10 by kind; an upgrade
  `base × level^1.3`; **never more than 120** (2 hours with one builder).
- Three builders finish in a third of the time. No cap on builders for now;
  watch it in play.
- Progress is worked out on the server from the clock, in the worker tick
  (`lib/quest_worker.js`), with a pure function `advance(sites, builders, from,
  to)` that tests can call. It runs while the player is offline. Work left over
  when one site finishes carries on into the next.
- Compare-and-swap the write, as the other ticks do.

### D.4 The queue

- Up to 5 sites. The player can reorder and cancel.
- Cost is paid when the site is ordered. Cancel before any work is done: full
  refund. After: half.
- All present builders work on the first site.

### D.5 No builders means no progress (and the guard rails for that)

The owner chose this over a slow base rate. It is the stricter rule, so the game
must never leave a player wondering why nothing is happening:

- Ordering a building with no builder: the confirm says so, with a button that
  opens the job picker ("Nobody is a builder. Choose one").
- A site with no builder shows a "Waiting for a builder" bubble in the scene and
  in the town card, and one news line (not one per minute).
- If the last builder dies, leaves on a quest or changes job while a site is
  open: a news line and the same bubble.
- The first steps list (`lib/first_steps.js`) and, later, the guide in Phase 3
  teach it: "Make someone a builder" comes before "Build a hut".
- The funnel log gains "first building finished", to see whether new players
  get stuck here. If they do, revisit this rule.

### D.6 What works while building

- A **new** building does nothing until finished.
- An **upgrade** leaves the building working at its present level. Never punish
  a player for improving something.
- A **house** adds no beds until finished. When it finishes, `autoHouse` runs.
- Demolishing is instant.
- The one-off homes granted in §0 are finished at once.
- Outpost buildings and Wonders are **not** changed here. Flag for later.

### D.7 When something is finished

A news line and a chronicle line ("The Library was finished by Delia and Fenn"),
a bubble on the building, and in the scene the builders cheer.

### D.8 In the scenes

- A site is drawn where the building will stand: three stages by work done
  (staked ground and a pile of timber; a frame with scaffolding; nearly done).
  Two sizes of generic site art cover every building; houses use the same.
- Builders are always in the cast (up to 4 shown). They walk to the site and
  play the **work** animation, with rests and the odd trip to the stores.
- Work animation: a new sprite per species, `work_e.gif` (hammering; mirrored
  for west) is enough. Until it exists: the idle animation, a hammer emote and
  puffs of dust at the site.
- Hover or tap the site: what it is, a progress bar, and an honest estimate
  ("about 12 minutes with 2 builders") or "Waiting for a builder".
- The town card's "Going up" list is the queue: drag to reorder, cancel.

### D.9 Things to watch

- **Tests.** Around thirty server suites build things and expect them at once.
  Give tests one clear way through (a helper that orders, then finishes the site
  through the Dev Tools route). Do not add a secret "instant" switch that could
  be left on.
- **Dev Tools**: finish a site now; set builder count; show the queue.
- **Early friction.** This adds a wait to the first minutes of the game. Keep the
  first three buildings at 3 minutes or less with one builder.
- **Never sell speed.** If money enters the game later, it buys looks (C.4),
  not finished buildings. A cosy game that sells skipping its own waits stops
  being cosy.

---

## 3E. Part E: upkeep and building health

### E.1 The idea

Every building has **health**, 0 to 100. Builders look after the town. A town
with too few builders slowly wears down; a building that reaches 0 is **broken**
and gives nothing until it is repaired. Repair costs time, not materials (for
now).

This is the second rule that punishes having no builders (the first is D.5), and
it is the only thing in this document that can take something away from a player.
So it is built to be slow, loud and fully recoverable, and it has **its own
switch** (`upkeep.on`), turned on only after building time has been live for a
while.

### E.2 Health and its three states

| Health | State | Effect | Looks |
|---|---|---|---|
| 60 to 100 | Sound | Works normally | Normal |
| 1 to 59 | Worn | **Still works normally** | Missing tiles, a patched roof, weeds |
| 0 | Broken | Gives nothing: no output, no screen behind it, no jobs | Boarded up, a "needs repair" bubble |

Worn is a warning the player can see for days before anything is lost. Do not
scale output with health: a sliding penalty is hard to read and feels like the
game nibbling at you.

### E.3 Wear

- Each builder in town (alive, adult, not away) looks after **8 buildings**
  (`upkeep.per_builder`, tunable). Houses count as buildings. This holds whether
  or not they are also working on a site: upkeep is not a second job the player
  must schedule.
- If builders × 8 covers every building, nothing wears. Otherwise the buildings
  not covered wear: the least important first (so the Granary and homes go
  last), at a rate that takes a sound building to broken in **5 real days**
  (`upkeep.days_to_break`).
- Worked out on the server in the same tick as construction, from the clock, so
  it is fair while the player is offline.

### E.4 Repair

- Builders mend worn and broken buildings whenever the construction queue is
  empty, the most damaged first, at 1 health per builder-minute (a broken
  building is whole again in under 2 hours with one builder).
- The player can also put a repair at the front of the queue from the building's
  panel ("Repair now"), ahead of new building.
- No materials. A news line when something breaks and when it is mended.

### E.5 Guard rails

- **Camps are exempt.** Wear starts at Village tier. A new player learns
  building first.
- **No grace period.** (Owner, 2026-11-15: there are no active players yet,
  only the owner testing.) Wear starts as soon as buildings are uncovered.
  Losing the last builder still writes a plain news line: "Nobody is looking
  after the town. Buildings have started to wear." Revisit a grace period
  before the game opens to players.
- **Houses never lose their beds.** A broken house keeps its residents and
  still counts for births and settlers; its residents are a little less happy
  until it is mended. Otherwise a builder dying of old age while the player is
  away could stop births and start a second population cliff.
- **Everything starts at 100** when the switch goes on.
- The town card shows upkeep in one line: "Upkeep: 2 builders look after 16 of
  19 buildings", amber when short. The away report says what wore while the
  player was gone.
- Nothing is ever destroyed. Broken is the floor.

### E.6 In the scenes

- Worn and broken looks are an overlay drawn by code for now (cracks, boards,
  weeds), so no new art is needed per building. The owner may add proper worn
  art later.
- A builder with no site walks a round of the buildings they look after and
  taps at each with the work animation. A repair shows as a small scaffold.
- A broken building's bubble opens its panel with "Repair now".

### E.7 Later (not now)

- Repairs that cost a little timber or stone.
- Raids, storms and fires that knock health down, which gives defence and
  builders more to do together.
- A builder perk for looking after more buildings.

---

## 4. Build order

Each step ships on its own and is shown to the owner.

1. **The two fixes** (§0).
2. **Style test.** Sprite packer, and one mouse walking a loop in the real
   scene, all 8 directions. Nothing else. The owner looks at pixel villagers
   against the current backdrop and decides the order of the art move.
   **Built 2026-11-15**, waiting on the owner's GIFs. `scripts/pack_sprites.js`
   (no dependencies; its GIF reader matches Pillow pixel for pixel) packs
   `art/villagers/<species>/<anim>_<dir>.gif` (see `art/villagers/README.md`)
   into sheets and `villagers.json`. `js/villagers.js` draws one mouse walking
   an eight-legged loop (one leg per direction, then 3 s idle facing S) in the
   area that is showing, with a small panel: direction, 1×/2×, pause, off. Turn
   it on with `?villagers=test` (remembered per device; `?villagers=off`). Until
   the sheets exist a placeholder mouse is drawn. It hides in Edit mode, stops
   when the tab is hidden, and stands still under reduced motion. Proofs:
   `verify/scene_proofs.js` (directions, sheet fallbacks, the loop stays on the
   ground at desktop and phone sizes, the packer end to end).
3. **Buildings as buttons** (§2): click routing, nameplates, bubbles, props,
   the placeholder look, the manifest. Remove the chips.
   **Built 2026-11-15** (`js/home-scene.js` `KWHome`, `css/home-scene.css`,
   `assets/images/buildings/manifest.json`; proofs in `verify/scene_proofs.js`
   §6–10). Every built building, prop and empty plot is a `<button>` with a
   label ("Granary, open the Stores"); Tab runs left to right and the hidden
   area is `inert`. Where it differs from the text above, and why:
   - **Smelter** opens Crafting too (it is a crafting station like the three in the table).
   - The phone-only **Town** chip stays beside Build: it is how phones reach the town card.
   - **Edit** stayed in the header until step 4 replaced it with Build mode.
   - **Bubbles** that exist now: research done (Library), "<item> ready" (its
     station), back from a quest (Tavern), famine or food low (Granary), no bed
     for N (Neighbourhood), market news (Market, from the place bar's dot), a
     festival on or ready (the green). There is no "stores full": stores have no
     cap. The quests dot is never lit by anything, so the tavern uses the
     `quest_resolved` event instead. Event bubbles last until the building is
     opened or the page reloads.
   - **Show names**' first 3 days count from the player's first look at Home on
     that device (no account age is sent to the client).
   - **The manifest** has `"native": true` for art drawn on the villagers' pixel
     grid, shown at 1×; today's images are marked `false` and keep the slot
     sizing until they are redrawn (the owner is replacing all art).
   - **Signposts** stand at 70 % (town) and 6 % (outskirts), not the very edges:
     on desktop the town card covers the scene's right quarter. **Flag:** that
     card also hides the Library and Guild Hall plots in Town and the Scout Post
     and Walls in the Outskirts (true before this step). The art and layout
     redo should leave that quarter clear, or the scene should end at the card.
   - On phones the scene is 860 px wide and scrolls sideways (as before); step 8
     looks at that.
   - Scaffolding and time left on the nameplate wait for building time (Part D).
4. **Build mode** (§2.3), replacing Edit.
   **Built 2026-11-16** (`js/settlement-view.js` `_svToggleBuildMode`; the
   Build chip in `js/places.js`; proofs `verify/scene_proofs.js` §11). The
   Build chip turns it on and reads "✓ Done" while on; Done, Esc or leaving
   Home turn it off (Esc closes an open panel first). While on: empty plots
   show, a building opens its manage panel (upgrade, demolish), villagers and
   props step aside (the signposts stay, to reach the other area's plots), and
   the Neighbourhood opens its window, where huts are built. A town with
   nothing built opens in Build mode. Notes:
   - **Dragging moves a building between plots**: onto an empty plot it moves,
     onto a building the two swap, anywhere else it goes back. Same area only;
     the Neighbourhood stays put. A press only becomes a drag after 6 px, so a
     click still opens the panel.
   - **Free placement and resizing are gone.** Positions and sizes a player
     saved earlier still apply, and "Reset layout" shows in Build mode while
     they exist.
   - The side panel's build list is no longer behind the Build chip. First
     steps' "Show me" (and the Market's "Build a Market") open Build mode on
     the right plot with its panel open; the server's hint now says "On Home,
     press Build and choose an empty plot".
   - **No keyboard way to move a building yet** (drag only). A "Move to…" in
     the manage panel would cover it; worth adding with the phone pass (step 8).
5. **Villager engine** (§3.2 to §3.4): the cast, walking, depth, idle.
   **Built 2026-11-16** (`js/villager-engine.js` `KWCast`; drawing from
   `js/villagers.js`; proofs `verify/scene_proofs.js` §12). Real citizens walk
   Home for every player now (the `?villagers=test` loop is still there). The
   cast follows §3.3: up to 14 (8 on phones) from the area showing; moment
   subjects first, then an elder, then one grown-up per family in turn, then
   children only with a parent. They walk straight lines between doors (the
   manifest's door, or the placeholder hut's), named spots and open ground,
   idle 3–10 s, and take depth from their feet (slots too, on one 1–1000
   scale; a hovered building rises above them so its nameplate shows). Every
   minute one walks into a building and someone else comes out; anyone who
   leaves town walks to the nearest door and fades. The loop's own cost
   measured 0.36 ms a frame on desktop and 0.22 ms on a phone-sized screen
   (`KWCast.frameMs`). Notes:
   - **The ground** is one meadow shape for both areas, fitted to today's
     backdrop so nobody walks in the river (`GROUND`, `SPOTS`). Redraw it with
     the new backdrops.
   - **Family looks** are gentle filters (a slight hue turn, saturation or
     brightness). A real hue turn of 20°+ moved the whole sprite and made fur
     pink or green, so it is not used.
   - Species: a citizen's own `species` when the server sends one, else the
     town's (citizens carry none today).
   - Villagers are not clickable yet (step 7 makes them buttons); they let
     clicks through to buildings.
6. **Behaviour** (§3.5): errands, indoors, chat, children, night.
   **Built 2026-11-16** (`js/villager-engine.js`; proofs `verify/scene_proofs.js`
   §13). Grown-ups pick errands by the game clock (`KWClock`, so Dev Tools time
   counts): morning sends workers to their buildings, by day mostly spots and
   open ground with the odd door, the evening the tavern or home, and at night
   home, with the same two or three (lowest ids) staying out. At a door they
   fade, stay 20–60 s (at night until morning) and the building gives a little
   bounce. Two free grown-ups within 200 px may stop for a chat: they meet a
   step apart, face each other and pass a bubble (dots, a fish, a heart, an
   acorn, a note) for 4–7 s; a pair waits 2 minutes before the next. Children
   walk a little behind a parent, go indoors with them, now and then run ahead
   or chase each other. In the evening and at night the tavern glows. Notes:
   - **How often people go indoors** is tuned so about a third of the cast is
     inside by day (measured 36 %); the spec's 20–60 s indoors against ~15 s
     outside made it half with more doors. Night settles to 2–3 outside within
     about a minute.
   - No chats at night, and the cast stops rotating at night.
   - `KWCast._setPhase('night')` in the console shows the night (or `'dusk'`)
     until the next clock check, for a quick look.
7. **Selection and the radial menu** (§3.6).
   **Built 2026-11-16** (`js/villager-engine.js`, `css/home-scene.css`; proofs
   `verify/scene_proofs.js` §15). Each villager is a real button (Tab reaches
   them after the buildings); only a small box round the figure takes clicks,
   so the frame's empty corners never cover a building. Selecting stops them
   facing the camera with a bright outline, a ring on the ground and "Name ·
   job, age" under them; four round buttons fan out above in 150 ms (turned and
   narrowed near an edge of the view so they stay on screen; 48 px on touch).
   Notes:
   - **Sounds** (the owner's): `assets/audio/ui/pop_on.mp3` as the menu opens,
     `pop_off.mp3` as it closes, however it closes (click away, Esc, or a
     button). They play at the effects volume. The WAV was made an MP3 (4 KB).
   - **Change work** and **Apprenticeship** open the citizen's profile scrolled
     to and focused on its job picker (or the youth's trade picker): that is
     where the existing picker lives. **House** opens the Homes window scrolled
     to their house (houses there now carry `data-house`). **Family** opens their
     family line.
   - After a button, the villager stands until the window it opened closes,
     then walks on.
   - Enter on a focused villager opens the menu with the first button focused;
     arrow keys move between buttons; Esc closes it and puts focus back on the
     villager. Arrows inside the menu don't pan the scene.
   - People kept indoors overnight now come out over 20 s in the morning, not
     all at once.
   - Clicking someone with an open moment still opens this menu; step 9 makes
     it open the moment instead.
8. **Phone and comfort pass**: touch sizes, cast of 8, reduced motion, frame
   time on a mid-range phone (target: under 2 ms a frame for the loop).
   **Built 2026-11-16** (proofs `verify/scene_proofs.js` §16, and §15q–s).
   - **Short screens** (a phone on its side) draw the town smaller in whole
     steps: 1× from 600 px of scene height, ¾ from 420, else ½, so pixel art
     stays even; panning and the far strips follow the scale.
   - **Touch**: the villager hit box is 58 × 82 (48 × 70 with a mouse), the
     menu's buttons 48 px, the build panel's buttons at least 44 px.
   - **Build mode's "Move to…"**: the manage panel lists the area's other plots
     as buttons (onto a building, the two swap), so a building moves without
     dragging; focus follows it.
   - **Reduced motion**: villagers stand still (step 5), bubbles and the menu
     don't animate, and lit windows switch instead of fading.
   - **Frame time**: the villager loop measured under 0.1 ms a frame on a
     phone-sized screen with the CPU slowed 4× (`KWCast.frameMs`).
   - The cast of 8 on phones has been in since step 5.
   Also in this round, from the owner's notes:
   - **Selecting a villager is press-and-release**, not the browser's click:
     the villager stops while pressed, a press that moves under 10 px selects,
     and the villager under the pointer is found even just behind a
     building's transparent edge (whose image box used to take the press). In
     a 40-click test on walking villagers, 40 selected (about 1 in 10 missed
     before). The hold after a menu button now tracks the window it opened.
   - **A Names chip** beside Build toggles every nameplate (pressed while on);
     N does the same; it is the profile menu's Show names setting.
   - **Villagers' name plates** (first names, under their feet) show with
     Names on, during the touch peek, or on hover and focus.
   - **Nobody unclickable**: someone walking into a building (the cast
     changing every minute) used to ignore clicks until they were gone; now
     they stop and stay when picked. Someone leaving town who is picked goes
     on after the menu closes.
   - **Faces in the family tree**: each person's box shows their face, cut from
     the idle sheet facing the camera (44 px at 1×, 33 for a child, grey for
     the dead); `KWVillagers.faceHtml(species, size)`.
9. **Moment markers** (§3.7).
   **Built 2026-11-16** (`js/villager-engine.js`; proofs `verify/scene_proofs.js`
   §18). Each open moment is carried by one villager: its first citizen who is
   out (in the moment's own order, its main person first). A town-wide
   question (the season's choices, which name nobody) goes to a messenger: an
   elder if one is out, else the oldest grown-up. They come outdoors (even at
   night), walk to a clear spot near the middle of the view (on the lane
   between the rows where nothing stands in front, else the open meadow at
   the front; others waiting keep 60 px apart) and stand facing the camera
   with a bobbing "!". Clicking (or Enter) opens the moment in the dialogue box
   instead of the menu, with the pop sound; answered, the "!" goes within a
   second and they walk on. Notes:
   - **No server change was needed.** Every moment about townsfolk already
     names them in `subject.citizen_ids`. The season's moments name nobody on
     purpose (they are the town's), hence the messenger. Moments about an
     outpost, a village's envoy or a settler on the road have nobody in town
     and stay in the moment cards only (an envoy walking in is in §7's ideas).
   - A press on a window, panel or card over the scene never picks a villager
     underneath it (found while testing).

   **Steps 1 to 9, the core, are built.**
10. **Neighbourhood data** (C.2): tables, migration, routes, tests. No visible change yet.
11. **Neighbourhood scene** (C.3 to C.5): plots, styles, the house panel; retire the housing window.
12. **Construction on the server** (D.2 to D.7): the builder class, sites, the queue, the tick, the guard rails, Dev Tools, and the test helper. Ship behind the tuning switch `construction.on` so it can be turned on for the owner's town first.
13. **Construction in the scenes** (D.8): sites, working builders, the queue in the town card.
14. **Mood** (§3.8).
15. **Life events** (§3.9).
16. **Town-wide events** (§3.10).
17. **Upkeep** (Part E), server and scene, behind `upkeep.on`. Last on purpose: turn it on only after building time has been live long enough to know that players keep builders.

Steps 1 to 9 are the core. Steps 10 to 13 are the Neighbourhood and building
time; step 12 is the only one that changes how the game plays, so it gets its own
review before it is switched on for everyone. Steps 14 to 16 are layers on the same engine: each is a
reader of state the client already has plus a few scripted errands, so do not let
them leak into the engine as special cases. Give the engine one hook, "play this
script with these villagers", and build all three on it.

## 5. Tests

`verify/scene_proofs.js`, pure logic with a fake clock and seeded randomness:

- The cast never includes anyone away or dead, never exceeds the cap, never
  holds a child without a parent, always holds moment subjects.
- Every errand target lies inside the walkable polygon; a door follows a moved
  building.
- Direction row chosen from an angle, for all 8.
- Chat: two free villagers in range pair up; a selected one never does; the
  cooldown holds.
- Selecting stops movement; deselecting resumes it.
- The building routing table: every key in `SV_VISUALS` opens something.
- Missing sheet → mouse; missing direction → mirrored.
- Mood: the emote mix for high, middling and low happiness; never more than two
  at once; a death scene suppresses happy emotes.
- Life events: each chronicle kind maps to a script; one at a time; the queue
  drops beyond three; an old entry (over 10 minutes) plays nothing.
- Town events: the priority order; a raid sends everyone indoors.

Server, `scripts/neighbourhood_test.js` and `scripts/construction_test.js`:

- Every town has a neighbourhood after the migration; old houses sit on
  distinct plots; two houses cannot share a plot; a style the player does not
  own is refused; a style never changes beds.
- `advance()`: no builders, no progress; one builder, one unit a minute; three
  builders, three; an away builder does not count; leftover work carries into
  the next site; nothing exceeds the cap; the queue order is honoured.
- An upgrade keeps the building working; a new building does nothing until
  done; a house gives beds only when done and then people are housed.
- Cancel refunds in full before work and half after.
- Upkeep (`scripts/upkeep_test.js`): enough builders, nothing wears; too few,
  only the uncovered buildings wear, least important first; 5 days to broken;
  worn still works, broken gives nothing; a camp never wears; wear starts at
  once when the last builder is lost; a broken house keeps its beds; repair
  happens when the queue is empty and "Repair now" jumps the queue; an away
  builder covers nothing; with the switch off, health never moves.

Browser check (Playwright, as for the earlier phases): Home at 1400 × 900 and
390 × 844, no page errors, the chips are gone, a building click opens its
screen, a villager click shows four buttons.

## 6. Things to hold back on (review notes)

- **Do not redraw everything at once.** Villagers, then buildings, then the
  backdrops (there is one set of four layers per biome). The style test in
  step 2 exists so no art is made on a guess.
- **Pixel size must match.** A building drawn at a finer or coarser pixel grid
  than the villagers will look wrong however good it is. Fix the grid first:
  one art pixel is one screen pixel at 1×.
- **Eight directions is more than this scene needs.** The town is seen from
  the side, so most walking is east, west and the four diagonals. For the six
  species still to make, E, NE, SE, N and S (five rows, mirrored for the rest)
  would be enough if generation time matters.
- **No pathfinding, no collisions, no server sync** in the first version. They
  cost a lot and nobody will notice their absence at 14 villagers.
- **Do not make the scene the only way in.** Keep the list in the profile menu.

## 7. Ideas that tie in later (not in this build)

- **Who is inside.** A building's nameplate lists who is in there now.
- **Travellers.** A visiting figure walks to the tavern when a visitor moment
  is open.
- **Seasons and weather**: snow on roofs, lanterns at night, rain.
- **Dance and cheer animations** per species, if the owner wants more than the
  hop-and-turn.
- **Pets and wildlife**: a bird on a roof, a butterfly, a cat by the tavern.

## 8. Answered by the owner (2026-11-15)

1. Moment markers: **in this build.**
2. One Build mode replacing Edit: **yes.**
3. Sprites: **one GIF per direction**; the packer makes the sheets.
4. Outskirts: **villagers from the start.**
5. Mood emotes, dancing, life events and town-wide events: **yes, all in.**
6. House placement: **snap to a grid of plots**, and allow for several
   neighbourhoods later.
7. No builders: **nothing gets built.**
8. Build times: **short** (minutes, to about 2 hours).
9. Several sites: **a queue**, in the player's order.

10. Idle builders: **they maintain the town** (Part E); no gathering. Buildings
    have health and break without upkeep. Repairs cost no materials for now.
11. Work animation and construction-site art: **the owner will make them
    later**; placeholders until then.
12. House styles: **the owner will make four new sets**; the four names in C.4
    are stand-ins.
13. Broken houses keep their beds: **yes.** Worn buildings work fully and only
    broken ones stop: **yes.** 8 buildings per builder and 5 days to break:
    **yes**, as starting numbers.
14. The 3-day grace period for upkeep: **dropped** for now.

Nothing is open. Questions that come up while building go to the owner.
