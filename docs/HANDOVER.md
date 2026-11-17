# Kindlewood — handover (after the pre-Phase 1 reviews, 2026-11-12)

Read this first in a new chat. It covers where things stand, what to do next, what exists, and how to work on it.
The same file is in both repos (`kindlewood-server/docs/` and `kindlewood-frontend/docs/`).

---

## 0. Start here

**The direction is set.** Kindlewood is a cosy generational sim, PvE first: *raise a woodland family line through the seasons.* Read these before writing code, in this order:

| Doc | What it is |
|---|---|
| `docs/ROADMAP_1_0.md` | The agreed plan: pillars, phases, onboarding, the owner's decisions |
| `docs/SECURITY_REVIEW.md` | S1–S4 fixed; S5–S8 open |
| `docs/PHASE_1_LIFE_CYCLE.md` | **The next feature work**, as a spec with a build order and tests |
| `docs/LAYOUT_SPEC.md` | The window component (needed from Phase 1) and the five-place navigation (Phase 4) |
| `docs/PHASE_2_MOMENTS.md` | The moments engine and the first thirty moments |
| `docs/OUTPOST_TRIM.md` | What to cut from outposts (Phase 4 unless the owner says sooner) |
| `docs/OUTPOST_SPECIALISATIONS.md` | A design that is **frozen until after 1.0**. Do not build it. |

**Rules of the road** (agreed with the owner):

- **No new systems before 1.0.** Every feature must serve families, the turning year, or gentle stakes. If it only turns resources into resources, fold it in or leave it out.
- **Never punish being away.** Anything that needs tending must have a sensible default that happens by itself.
- **Death ships only together with inheritance and the chronicle** (Phase 1 steps 2–6 are one release).
- **Push back** when a request works against the pitch, and say what you would cut. The owner has asked for this.
- **Build to the specs.** If a spec turns out to be wrong, say so and propose the change; don't quietly build something else.
- **Agreed phase order:** 0 (done) → 1 life cycle → 2 moments → 4 consolidation and layout → 3 onboarding and the guide → 5 species → 6 clan project.

### What to do next, in order

1. ~~Security fixes S1–S4~~ (done 2026-11-13; S5 a file at a time as files are touched).
2. ~~**Phase 1, step 1**~~ (built 2026-11-13; see `PHASE_1_LIFE_CYCLE.md` §9 for what to watch after deploy), shipped on its own:
   - houses hold 4;
   - births need a free bed in town;
   - the population number follows the real count;
   - the kin rule;
   - housing sorts itself;
   - death clears `house_id`.

   This fixes the two live bugs below.
3. ~~**The window component**~~ (built 2026-11-13: `KWWindow`, `css/tokens.css`; `LAYOUT_SPEC.md` §3.3a).
4. ~~**Phase 1 steps 2–7**~~ (built 2026-11-13; steps 1–6 live).
5. **Phase 2: Moments** (`docs/PHASE_2_MOMENTS.md`). Steps 1–4 are built: the engine, outpost events moved in, the dialogue box and card stack, the family moments M1–M8 (settlers and heir choices are now moments with defaults), the year moments M9–M13 with timed town effects, the quest moments M14–M17, and the village and raid moments M18–M20 and M28–M30 (see §6a there). Next: step 6, a tuning pass on the daily budget, which needs real play data (answered against timed out, per kind: admin `GET /api/moments/admin/stats`). A Fable review of Phase 1 is still to come.
6. ~~**Phase 4: Consolidation and the layout rework**~~ (built 2026-11-13 and 14; `docs/LAYOUT_SPEC.md` §2.8): the five places, Home on the settlement scene with the town card, the context panel, the bell as one place for news, the top bar and map controls, Dev Tools for admins only (markup from `GET /api/dev-tools`), Journeys in The Land's panel, one Stores screen, and the outpost trim (`OUTPOST_TRIM.md` § Built). Only the tier pacing pass is left; it waits for real funnel numbers.
7. **Next, in order** (`docs/ROADMAP_1_0.md` §5, updated 2026-11-15):
   1. ~~**The beds cliff**~~ (done 2026-11-15, `lib/beds_cliff.js`; `HOME_SCENE.md` §0): on the first boot after deploy, towns with more people than beds get free Willow Huts until beds ≥ living, and a chronicle line. **After deploy:** check the boot log for `[beds_cliff] raised N homes in M town(s)` and that `migration_marks` has `beds_cliff_homes`. Open question for Phase 3: new towns still arrive with no huts.
   2. **Phase 4b, the living Home scene, core** (`HOME_SCENE.md` §4 steps 2–9): style test, buildings as buttons, Build mode, walking villagers, the radial menu, phones, moment markers. **Step 2 (the style test) is built** and the owner's mouse is packed (`art/villagers/mouse/` → `node scripts/pack_sprites.js`; see it with `?villagers=test`). **Step 3 (buildings as buttons) is built** (`js/home-scene.js`), **step 4 (Build mode)** and **step 5 (the villager engine**, `js/villager-engine.js`: real citizens walk Home for everyone) and **step 6 (behaviour**: errands by time of day, indoors, chat, children, night); and **the new art set** (`docs/ART_GUIDE.md` §4 steps 1–7, §4a: flat meadow, panning, night by tint and lit windows; the mouse-drift parallax is gone); and **step 7 (selecting a villager: the radial menu, with the owner's pop sounds)**; **step 8 (the phone and comfort pass**, plus press-and-release selection, a Names chip and faces in the family tree); and **step 9 (moment markers)**: the core (steps 1–9) is built. Two batches followed on 2026-11-16 (`HOME_SCENE.md` §4 after step 9). **The polish pass** (`ART_GUIDE.md` §4b): a collapsed town card and phone sheet, night as one overlay with glowing windows, dirt paths and an empty props layer, villagers that don't stack, cheaper movement (numbers in §4, Frontend patterns), and a "Make someone a builder" first step behind `construction.on`. **Five Home changes:** phone panning as a native scroll, loading and Home music (§3.11; silent cases in §4), a radial menu on buildings (§2.2a), and villagers keeping a working day (§3.5a). Next on the roadmap: Phase 3, onboarding and the guide (write its spec first), then Phase 4b steps 10–17.
   3. **Phase 3, onboarding and the guide** (`ROADMAP_1_0.md` §6; no build spec yet, so write one first). It also decides when The Road and The Clan unlock for new players (Phase 4 shows all five places from the start).
   3a. **The new look** (`ART_GUIDE.md`, agreed 2026-11-16): a flat meadow, cartoon buildings and a code-drawn sky replace the painted landscape. Eleven buildings and the new backdrop are already in the frontend at `assets/images/scene_v2/` with their own manifest. `ART_GUIDE.md` §4 has the nine steps to put them in; do them before the Neighbourhood scene, which uses the four house images.
   4. **Phase 4b, the rest** (`HOME_SCENE.md` steps 10–17; **steps 10 and 11, the Neighbourhood, are built**, 2026-11-16: houses on plots in two rows of 18, a third scene `js/neighbourhood.js`, tier upgrades count kinds of building; next is step 12, building time): the Neighbourhood; building time with builders (step 12 changes play: its own review, behind `construction.on`); mood, life events and town events; upkeep last. **Part F, the town alive** (`HOME_SCENE.md` §3F, agreed 2026-11-17; steps 18–26): **step 18, Talk to… and Praise, is built** (`lib/social.js`, `/api/social`, `js/social.js`): the player sends one villager to talk to another about a topic, once a day each, and praises three a day; the server rolls and counts everything, so extra devices gain nothing; interests are learned through chats. The rule for all of Part F: anything that changes the game is decided on the server and the scene only shows it. **Step 12, building time on the server, is built and off** (`lib/construction.js`, `/api/construction`, the Builder job; on per town with `settlements.construction_on` or for all with the switch `construction.on`): do not turn it on until step 13 (what the player sees) is built, and move the test suites that build things onto `scripts/_build.js` before turning it on for everyone.
   5. **Phase 5, species identity**, then **Phase 6, the clan project** (outlines in the roadmap; specs to write).
   6. **Dungeons** (`docs/DUNGEONS.md`, `docs/DUNGEON_CONTENT.md`), after the 1.0 phases; three questions still open (`DUNGEON_CONTENT.md` §9).
   - **Waiting on real play data:** the moments budget tuning (Phase 2 step 6), the tier pacing pass (Phase 4), and a Fable review of Phase 1.
   - **Loose ends:**
     - old windows move to `KWWindow` as they are touched (the citizen profile first);
     - the mockup's Defences chip and the counts on chips wait for those screens.
   **Hosting:** the frontend is on Porkbun static hosting, which serves the repo's files as they are. **Version stamps matter again:** every local script and stylesheet in `index.html` carries `?v=<hash of its contents>`; run `node scripts/stamp_versions.js` after changing any file under `js/` or `css/` (the proofs fail on a stale stamp, `assets_proofs` 1c). Without it, phones kept old stylesheets beside new scripts (seen 2026-11-16: no backdrop, oversized buildings, an unstyled villager button). It runs NGINX, so `.htaccess` is ignored: no rewrite, caching or deny rules apply. Caching relies on the `?v=` in each link, and a file is off the site only if it isn't in the repo. Porkbun can't keep a file private; anything admin-only must come from the API (as Dev Tools' markup does).
   **GitHub checks:** the frontend's workflow is a test check only (`.github/workflows/proofs.yml`, every push and pull request; it replaced an unused build-and-FTP deploy, 2026-11-15). It checks out the frontend alone, so proofs that compare with the server (`research_proofs`, the Dev Tools markup checks) skip and say so; the full suite (`kindlewood-server scripts/test_all.sh`, both repos side by side) runs them. The target is `docs/LAYOUT_MOCKUP.pdf`.

All the owner's decisions for Phase 1 are made (`PHASE_1_LIFE_CYCLE.md` §11): the slower life pace, heirlooms with a small bonus, step 1 first.

### Findings from the assessment (2026-11-11 and 12)

(Findings 1, 2, 5, 6, 7 and 8 are fixed as of 2026-11-13.)

1. **Births cannot happen in the live game.** A birth needs a couple sharing a house with a free place, and every house holds 2. Details in `PHASE_1_LIFE_CYCLE.md` §1.1.
2. **No ordinary player can leave Camp.** `settlements.population` is stuck at 10 (only admin tools and the traveller event raise it) and a Village needs 20. Everything gated by tier is unreachable without Dev Tools.
3. **Citizens do not age.** Age is a fixed number; children never grow up; nobody dies of old age.
4. **Adding ageing alone would wipe out every town** within two months (`scripts/population_model.js`, scenario B). Births must need a free bed in town, houses must hold 4, and settlers must arrive as a safety net. With those, towns are stable.
5. **No kin rule:** siblings or a parent and child could become partners once children grow up.
6. **A player can put HTML in a username or town name and it runs in other players' browsers** (confirmed locally). The sign-in token is readable by page scripts, so this allows account takeover. `SECURITY_REVIEW.md` S1.
7. **Other websites can act as a signed-in player** on routes that need no request body, through the sign-in cookie. `SECURITY_REVIEW.md` S2.
8. **The dead still take up a place in their house** (`house_id` is never cleared).
9. **The outpost trickle left haulers, haul settings and three buildings with little purpose.** See `OUTPOST_TRIM.md`.

### Phase 1 is complete

The life cycle (steps 1–6) is live. Step 7 (Dev Tools → 👪 Life, numbers tunable live) is on the branch. What to watch now is in `PHASE_1_LIFE_CYCLE.md` §9a and step 7's notes.

### Merged

Everything up to the pre-Phase 1 reviews is on `main` in both repos (server PR 94, frontend PR 56).

**Check on Render:**

- `JWT_SECRET` is set (16+ characters). With `NODE_ENV=production` the server refuses to start without it.
- After deploying the security fixes, check that sign-in rate limits key on the player's address (`SECURITY_REVIEW.md`, "What was done", S3).

**GitHub secrets for the frontend deploy:** `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` (optional `FTP_DIR`). Without them the workflow only attaches the built site to the run.

### Which model for what

The owner plans to build with Opus and bring Fable back for judgement calls. Good moments to ask for a Fable review: the end of each phase ("does this still serve the pitch, and what should be cut?"), any change to the numbers in `PHASE_1_LIFE_CYCLE.md` §2, and any request for a new system.

---

## 1. Where things stand

- **`main`** holds everything up to the pre-Phase 1 reviews. See "Merged" above.
- **Deploying:**
  - **Server:** `tomatkinson93/kindlewood-server` deploys itself from `main` on Render (`https://kindlewood-api.onrender.com`). The API is on the **Starter** plan ($7 a month), which does not sleep; the database is Basic-256mb ($6.30). The database is the first limit that will be reached.
  - **Frontend:** `tomatkinson93/kindlewood-frontend` serves kindlewood.quest from cPanel. Until the deploy workflow has its FTP secrets, run `npm run build` and upload the contents of `dist/` by hand (including `.htaccess`: turn on "Show hidden files").
  - **`/assets`** is uploaded separately by FTP and is never touched by the build.
- **Migrations:** new SQL files are named `0NN_<name>.sql` and listed in `db.js` `applyMigrationFiles([...])`. They are idempotent and re-run on every boot. See `migrations/README.md`. The latest is `0NN_outpost_trickle.sql`.
- **Tests:** on a fresh database the last full run was 2,730 passed and 3 failed. The 3 were in `npc_requests_test`, which passed 3 of 3 times on its own (also on the previous code); treat it as intermittent and look at it if it recurs. `rankings_test` only passes on its first run against a database.

---

## 2. What has been built (by round)

### Earlier (before R1)
- **Market, phases 1–4:** item search and categories, item stalls with porter pickup, Smithy/Jeweller/Fishing stalls and shopkeepers, buy orders (Wanted).
- **NPC village traders** and the Market ledger (prices, sparklines).
- **Careers:** classes, XP, perks, forks, traits; the career tree UI.
- **Crafting:** Smithy, Jeweller, Workshop and Smelter; quality; schematics; hidden recipes; a recipe book.
- **Resources:**
  - the resource registry (iron, copper, tin, coal, silver, gold ore, gems, obsidian, moonsilver, mithril, bronze, steel);
  - Stores and discoveries;
  - Research (Library, Scholar class; 54 projects now; **hidden names never reach the client**: use `RS.labelFor`, and `research_proofs` 6f checks it);
  - village requests.
- **Outposts:** upgrades, the build queue (with reordering) and request alerts.

### R1 — exploits
- Tavern gold now uses server-side solo tickets and game rooms.
- Removed: the free-trust route and the `award-gold` route.
- Feedback and `reset-placement` are admin-only.
- Weapon and armour stats count in combat (`lib/combat_engine.js`, byte-identical to the frontend copy).

### R2 — broken promises
- Famine banner, with Dev Tools previews.
- Tier upgrades list what they really unlock.
- Player mail with abuse reports (`routes/mail.js`).
- Help panel (`js/help.js`).
- Real rankings boards.
- Deck rename, delete and set active.
- Friends, Achievements and avatar upload are **hidden**.

### R3 — endgame
- Rare-material recipes.
- Per-town modifiers (`lib/town_mods.js`).
- Festivals.
- Building upkeep in Cities, and arrears.
- **Wonders:** 5 wonders × 3 stages (`lib/wonders.js`, `js/wonders.js`), plus a Great Works ranking.

### R4 — systems
- Daily tavern rotation; abandoning a quest; time-gated quests.
- Outposts: workers, refund on dismantle, an unfed penalty, secondary yields.
- **Watchtower:** jobs for Guards and Archers.
- Biome encounters, 8 new enemies, server-side loot, and a card collection (unlocks and drops).
- Trust decay, with a floor; the Allied perk (daily tribute and militia).
- **Soft raids by the Withered** (`lib/raids.js`).
- **Clans:** treasury, boons, territory income and bonuses, weekly goals, honors (clan honors only).

### Defences round
- **Walls** (a building, levels 1–5).
- **Outpost forts** (0–3) and an **outpost crew** table with workers and a garrison (`lib/defences.js`, `lib/outpost_state.js`).
- **Graded raid losses:**
  - an undefended target loses 15% of each resource, capped at 2,000 each;
  - a partly defended target loses part of that;
  - everyone at the raided spot is injured and sent home.
- **Clan-shared defence** (members only).
- **Escalating tribute** for 24 hours of peace.
- **On the map:** a red countdown chip, a raid sheet, and a red trail layer (`js/kwmap-raid.js`).
- **Call to arms and reinforcements;** scouted strength shown as a range.
- **Sally out** (a card battle).
- **Withered camps:** they spawn, can be assaulted, and give 72 hours of peace (`lib/raid_extras.js`, `lib/raid_camps.js`).
- **Festivals:** fireworks on the map instead of a banner, and a festival row in the panel.
- **Wide clan panel** (900px) and chat (1100px).

### R5 — player experience
- **G0 — raid test controls** (Dev Tools → Resources → 🔥 Raids, admins only):
  - choose a target (town, an outpost, or "Nearest"), arrival in minutes, and a strength;
  - buttons: Start, Cancel, Strike now, Clear cooldown & peace, Roll the normal check (×100 or normal odds), Spawn camps, Clear camps;
  - a status line;
  - server: `/api/raids/admin/{send,cancel,resolve,check,clear-cooldown,peace-clear,camps,camps/clear,status}`.
- **G1:** `KWDialog` (`js/dialog.js`) replaces player-facing `alert`/`confirm`. Admin files keep the browser pop-ups, which is allowed by an allow-list in `dialog_proofs`.
- **G2:**
  - 🧭 Journeys (`js/journeys.js`) lists travellers, outpost crews and village requests;
  - scout recall (`POST /api/expeditions/:id/recall`);
  - "While you were away" reopens the last report (stored in localStorage);
  - Crafting is in the settlement panel.
- **G3:**
  - a first-steps checklist (`GET /api/game/first-steps`, `lib/first_steps.js`, `js/first-steps.js`; dismissable);
  - "?" buttons linking to Help (`KWHelp.open(topic)`);
  - new Help topics: expeditions, travel, stores.
- **G4 — mobile:**
  - landscape phones get the phone layouts (`(max-height:560px) and (pointer:coarse)`);
  - full-screen dialogs and Chronicle;
  - the tab bar hides behind every overlay (the id list in `mobile-shell.js` `watchOverlays`);
  - touch wording in fishing.
- **G5 — accessibility:**
  - `aria-label` on icon buttons;
  - `role="dialog"` on modals;
  - one Escape handler (`js/a11y.js`, which closes the top window);
  - `:focus-visible` styles;
  - toasts are announced.

### Live-site loading fixes (after R5)
- **The problem:** the cPanel host answered **503** when the page asked for its ~130 files at once, so scripts like `market.js` silently failed to load.
- **The load guard:** an inline script at the top of `<head>` in `index.html`.
  - It retries failed same-origin scripts and styles (after 0.5s, 1.5s and 4s).
  - `kwWhenReady(fn, target)` holds start-up code until any retries land.
  - `window.KWLoad` exposes `progress()`, `ready()` and `failed`.
- **`.htaccess`:** js and css cached for a year (the built files are named by content hash), html never cached, gzip on.
- **The loading screen waits for everything:**
  - a live file count;
  - a checklist of real steps;
  - "server waking up" retries for a sleeping Render server;
  - names any missing files, with Reload / Carry on.
- (Retired in Phase 0: `verify/versions.json` and `?v=` bumping. The uploaded site is built by `npm run build`.)

### R6 — refinements and outpost stores
- **Loading screen:** on first load it no longer fades out by itself; a big **▶ Start playing** button (`#ls-play`, `lsReadyToPlay()` in `main.js`) appears once everything is in. The away report opens after the click.
- **Festivals and Wonders are separate screens:** `KWTown.open('festival')` shows only the festival; `KWTown.open('wonders')` shows the wonders and the town's upkeep; `KWTown.open('upkeep')` opens Wonders scrolled to Upkeep (the arrears banner uses it).
- **Away placards everywhere:** `citizenAway(c)` in `citizens.js` covers quests, scouting, diplomats, outpost workers, guards and haulers, trading, Market porters and outpost hauls. Both the side list and the All Citizens table grey these citizens out; the settlement panel's pill now reads **Away**.
- **⛺ Outposts tab** beside Settlement and Citizens (`js/outposts.js`, `css/outposts.css`; on phones also in More → Places). It shows every outpost with its store, crew and porters on the road, plus 📍 Map. The outpost's tile panel shows the same store and porter blocks.
- **Outpost stores** (`lib/outpost_store.js`, migration `0NN_outpost_store.sql`):
  - outposts no longer add to the town's rates; each fills `outposts.store` on its own clock (`store_tick`), capped at 300 × level per resource, and stops when full;
  - **porters** carry goods home: one-off runs (`POST /api/game/outposts/:id/haul`) or a standing **hauler** (`outpost_crew.post = 'hauler'`, 1 per outpost) who goes back and forth automatically;
  - trips take 10 min per tile each way (minimum 2 min, faster with travel perks). A load is 20 weight (the Market's caravan capacity once there is a Market) × Porter carry perks, split fairly across what's stored;
  - an **outpost raid loots the outpost's store**, not the town; dismantling carries the store home;
  - `sync(settlement)` runs on `GET /settlement`, `GET /outposts` and in the worker tick (about once a minute): it resolves due runs, fills the stores and sends idle haulers out;
  - haulers who were away catch up run after run (each leaves when the last got home);
  - hauled goods show in the away report as "Carried home from outposts" (`hauled_<res>` in the ledger);
  - citizens on a haul get a `haul` field (`/api/citizens`) and are busy everywhere (`busyReason`, `merchantCitizenIds`, `awayMap`).
- **Tests (R6):** `scripts/outpost_store_test.js` and `verify/outpost_store_proofs.js`.

### R6b — fixes and outpost buildings
- **Held toasts:** toasts that arrive while the loading screen is up are queued (`_holdToast` / `releaseHeldToasts` in `main.js`; `showBuildToast` too) and play after Start playing.
- **Fixed-size windows** (`css/modal-sizes.css`, loaded last):
  - the away report is wider (880px);
  - the citizen profile, mail, inventory and clan panel keep one height across their tabs;
  - a scratch Playwright "measure" script checked every tabbed window; market, leaderboard, decks, settlement view and crafting were already steady.
- **Outpost window** (`KWOutposts.manage(id)`, `#kwop-modal`, 980×720, full screen on phones): Overview, Buildings, People and Defence tabs. It opens from 🏕️ Manage on the tab's cards, the outpost's tile panel, and a journey's card on the map. Worker, garrison, fort, upgrade and dismantle buttons reuse main.js (`_wireOutpostSection`); `selectWorldTile` calls `KWOutposts.refreshModal()`.
- **Outpost buildings** (`lib/outpost_buildings.js`, table `outpost_buildings`, migration `0NN_outpost_buildings.sql`):
  - plots = level + 1;
  - any land: Storehouse (store +50%), Bunkhouse (+1 worker), Waystation (trips −30%), Mule Pen (carry +50%), Watchfire (+8 defence);
  - one land each: Granary, Sawpit, Quarry Crane, Ore Sorter (hills or mountain), Deep Shaft, Smokehouse, Drying Racks, Dig Tent;
  - paid from the town (less the building discount); takes `hours` to finish; pulling one down gives nothing back;
  - routes: `POST /api/game/outposts/:id/buildings {key}`, `DELETE /api/game/outposts/:id/buildings/:key`;
  - effects reach `outpost_state.load` as `o.bfx` (cap, rates, trips, carry, worker slots, defence).
- **Crew walk to and from their posts:**
  - `outpost_hauls.kind` is `haul`, `post` or `return`; `outpost_crew.arrives_at` is set while someone walks out;
  - workers and garrison count only once they arrive;
  - brought home, they walk back, and someone called back just after setting out turns round where they are;
  - dismantling sends the crew home on foot;
  - `lib/travel.js` `outpostJourneys` draws porters and walks on the map (kind `outpost`, and a card button opens the outpost window);
  - the live events are `outpost_walk` and `outpost_haul_home`;
  - citizens get `haul.kind`, and placards read "Walking to/home from".
- **Tests:** both outpost test files grew (53 server checks and 38 proofs); `outposts_test` and `defences_test` now skip the walk out with SQL. On a fresh database the full run was 2,640 passed. `rankings_test` only passes on its first run against a database: it inserts fixed "richest town" rows.

---

### R6c — outpost extras
- **Haul settings:** `outposts.haul_filter` lists the resources porters carry (null = all), and `haul_threshold` is the % full before a standing hauler sets out. Set with `PATCH /api/game/outposts/:id/settings`; edited in the window's People tab.
- **Roads** (`lib/outpost_roads.js`):
  - Track, then Paved Road (trips ×0.75, then ×0.5); cost and time scale with tiles;
  - built with `POST /:id/road`; `road_level` counts from `road_ready_at`;
  - drawn on the map by `js/kwmap-roads.js`, from the map tile's `outpost.road`.
- **Outpost events** (`lib/outpost_events.js`, table `outpost_events`):
  - seven kinds: rich_vein, trader, wolves, traveller, cache, storm, harvest;
  - each outpost rolls hourly (1/36 chance) in the worker tick; an event waits 12 hours, then its fallback choice happens by itself;
  - answered with `POST /:id/events/:eid {choice}`; the live event is `outpost_event`.
- **Clan features:**
  - on clan land the store is +25%;
  - a **Signal Tower** outpost building (clan land only) shares that outpost's defence at twice the rate and reaches 5 tiles (`lib/defences` `clanShare`);
  - the **Outpost Network** boon gives porters +25% carry;
  - a new weekly goal: `haul` (goods carried home);
  - clanmates can send a porter: `POST /:id/help` creates a haul with `owner_settlement_id`, and the goods go to the owner. The map tile's `outpost.clanmate` shows the Help carry panel.
- **Dev Tools → ⛺ Outposts** (`POST /api/game/outposts/admin/{finish,arrive,porters,fill,event,events-clear}`): finish buildings and roads, make crew arrive, bring porters home, fill the stores, start or clear an event.
- **Specialisations:** the design is in `docs/OUTPOST_SPECIALISATIONS.md` and is **waiting for the user's answers** to its questions before it's built.
- **Tests:** `scripts/outpost_r6c_test.js` (39 checks) and `verify/outpost_store_proofs.js` §8. On a fresh database the full run was 2,693 passed, 0 failed.

### Phase 0 of the 1.0 roadmap — foundations (2026-11-10)
The direction is now set in `docs/ROADMAP_1_0.md` (a cosy generational sim, PvE first). **Read it before starting new work.** Phase 0 is built:
- **Frontend build:** `npm run build` (`scripts/build.js`, needs `npm install` once) makes `dist/`: three script bundles, one stylesheet and the config file, named by content hash.
  - Each source file still runs as its own `<script>` inside a bundle, in page order. Pasting files together broke `typeof laterVariable` checks and let one error stop every later file.
  - `@import` lines are hoisted whole (the Google Fonts address contains semicolons).
  - `/assets` is not copied.
  - **`?v=` bumping and `verify/versions.json` are retired.** The `?v=` tags in `index.html` only need to be present.
- **Deploy:** `.github/workflows/deploy.yml` runs proofs, builds and uploads `dist/` by FTP on every push to `main`. It needs the secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` (optional `FTP_DIR`); without them it only attaches the built site to the run.
- **`npm run proofs`** runs every frontend proof (`scripts/run-proofs.js`).
- **Loading counter fix:** the load guard listened for file loads on `window`, where they never arrive, so the count always read 0. It listens on `document` now.
- **JWT secret:** `lib/jwt_secret.js` is the only source. With `NODE_ENV=production` the server **refuses to start** without a `JWT_SECRET` of 16+ characters. Check it is set on Render before merging.
- **`render.yaml`** now says `plan: starter`, matching what is paid for.
- **New-player funnel** (`lib/milestones.js`, table `player_milestones`): a middleware records the first time each player does each step; births are marked from `simulation.js`. Read it at `GET /api/funnel?days=N` (admins) or Dev Tools → 📈 New players.
- **Outposts trickle** (decision 3): a **carter** brings 60% of each outpost's output home by itself (80% along a track, 100% paved; `TRICKLE` in `lib/outpost_store.js`). The rest waits in the store for porters. The town's shown rates include the carter's share; fractions owed are kept in `outposts.trickle`.
- **Testing the bundle:** the scratch script used was a Playwright comparison of the plain site and `dist/` (requests, page errors, globals, computed styles). Rebuild it if the build changes; it caught a broken stylesheet that the script-only check missed.

## 3. What's left

**The roadmap decides the order** (`docs/ROADMAP_1_0.md` §5). The list below is the older backlog; most of it now waits until after 1.0.

Still worth doing along the way:

1. **Proof coverage is missing** for chat, inventory, diplomacy, the tier screen and most of the clan panel. Add proofs as the layout rework touches each.
2. **Reopening the away report works per device only** (localStorage). The chronicle in Phase 1 replaces the need.
3. **Old 404s:** `/assets/kindlewood-logo.png`, `kindlewood-logotype.webp`, `/assets/images/tiles/*.png`, and some audio (`page_turn.mp3`, `ambient/night.mp3`) are referenced but not on the host. The game falls back without them. Upload them or remove the references.
4. **The worker tick** visits every settlement with outposts about once a minute (`lib/outpost_store.js tick`). Fine for hundreds of towns; before thousands, change it to "only towns with something due".
5. **Dev Tools** ships to every player inside `index.html` (about 700 lines). Move it to its own page for admins (layout rework item 10).

Frozen until after 1.0:

- Outpost specialisations and the seven new resources.
- Withered strength creep; the raid log tab in the Watchtower; repair costs for raided outposts.
- Mutual defence treaties.
- Friends, Achievements, avatar upload, player honors (all hidden today); clan emblems.
- New rankings boards.
- Default or seasonal Happenings.
- Multi-species towns (a later expansion) and PvP worlds. To keep both open: read species per citizen, and have raid code take "an attacker", not the Withered specifically.

---

## 4. How to work on it

### Git and pull requests
- Develop on the branch the session names, and push with `git push -u origin <branch>`.
- If that branch's PR is already merged, restart it from `main`:

  ```bash
  git fetch origin main && git checkout -B <branch> origin/main
  ```

- No PR unless asked.
- Commit trailer (from the session's system reminder):

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <session link>
  ```

- No model IDs in code or commits.

### Server patterns (`kindlewood-server`)
- **Routes** live in `routes/*.js`. Admin routes use `requireAuth, requireAdmin` (`middleware/admin`, which reads the `ADMIN_USER_IDS` env var).
- **Background worker:** `lib/quest_worker.js` `_tick` calls each system's self-throttled `tick()`:
  - trust decay;
  - raids (resolving due raids and the 10-minute roll);
  - clan treasury, clan goals;
  - raid camps.
- **Raid rules:** constants at the top of `lib/raids.js`:

  | Constant | Value |
  |---|---|
  | `REACH` | 6 |
  | `NEW_PLAYER_DAYS` | 7 |
  | `COOLDOWN_H` | 48 |
  | `WARN_H` | 6 |
  | `DAYS_PER_RAID` | 5 |
  | `FULL_SHARE` | 0.15 |
  | `STEAL_CAP` | 2000 |

  Raid strength is `25 + 15×outpost level + 25×tier index + 0–15`. `raids.whyNot(s)` explains why a town can't be raided.
- **The `outposts` table** is created by `POST /api/game/migrate` on a fresh DB, after the migration files have run. Migration parts that touch `outposts` must be wrapped in `DO $$ … to_regclass('public.outposts') …`, and the column must also be added in the migrate route.
- **Hidden research names:** use `RS.labelFor`, never raw project names, for anything undiscovered.

### Frontend patterns (`kindlewood-frontend`)
- Plain scripts and IIFEs that attach globals (`window.KWRaids`, `KWJourneys`, `KWDialog`, `KWHelp`, `KWTravel`, `KWRequests`, …). No build step.
- **`worldMapData` and `citizensData` are top-level `let`**, not on `window`. Inside an IIFE use `typeof worldMapData !== 'undefined' ? worldMapData : …`.
- **Every `<script>`/`<link>` is `/js/x.js?v=…` or `/css/x.css?v=…`** (the build reads these tags). The `?v=` value no longer needs bumping.
- **Start-up code:** use `kwWhenReady(fn)` (or a `readyState` check), never a bare `DOMContentLoaded`. `assets_proofs` 3a checks this.
- **Player-facing confirms and alerts:** use `await KWDialog.confirm({title, message, ok, danger})` or `KWDialog.alert(...)`.
- **New full-screen overlays:**
  - add the id to `mobile-shell.js` `watchOverlays` (hides the tab bar);
  - add it to `js/a11y.js` `ROOTS` (Escape);
  - add phone CSS under `body.kw-shell`;
  - give the card `role="dialog" aria-modal="true"`;
  - give its close button `aria-label="Close"`.
  - A modal inside `.game-body` (z-index 5) sits under the top bar on phones, so move it to `<body>` when it opens (see `openDiplomacyModal`).
- **Map layers** (`js/kwmap-*.js`) must not fetch or use randomness, and must leave the canvas untouched when there's nothing to draw (the proofs check this).
- **Dev Tools** is `#cheat-modal` in `index.html`; its buttons call `KW*.dev*()` helpers.
- **Animation loops pause when nothing shows them.** The Home scene covers the map without hiding it, so the map's IntersectionObservers still see it on screen. The map (`kwmap-core.js`), tile actions, the season particles and the welcome screen's embers also stop under Home (`window._svIsOpen()`, and the `kw:home` event on open and close). A new rAF loop needs the same gate. In a per-frame loop, read sizes once at the top, before any style write (`villager-engine.js` `S.size`), and write only values that changed (`villagers.js` `paint`).
- **Signing in and idling** (`js/session.js`, 2026-11-17).
  - **Keep me signed in** is a tick box on the sign-in and register forms, ticked by default. Unticked (a shared computer), the sign-in ends when the browser closes, when the page has been closed for 15 minutes, or after 15 minutes without input; the server also gives a 12-hour token instead of a week's (`routes/auth.js` `tokenLife`).
  - **Away.** After 15 minutes without input, every `fetch` to `/api/` answers at once with status 499 and `{ paused: true }`, so background polling stops. A hidden tab closes its live stream; a showing tab keeps it and keeps animating. Any input, or returning to the tab, resumes and re-reads the stores, moments and citizens. New polling code needs nothing special, but must cope with a non-OK answer quietly.
  - **Two devices at once** are allowed. The server settles who was first (row locks); `moment_resolved` tells the other device. There is no single-session rule.
  - Not built: "Forgot password?" on the sign-in form is still a dead link.
- **Music and when it stays silent** (`js/music.js`, `HOME_SCENE.md` §3.11). Browsers block sound until the player has pressed or typed something on the page. The loading and Home music never show an error: they wait silently and start on the first press or key.

  | Case | What you hear |
  |---|---|
  | Fresh login (the player pressed Log in) | The loading music plays straight away. |
  | Reload with a saved login | The loading music stays silent, unless the player taps the loading screen. Pressing Start playing counts as the first press, so Home's music starts with its 2 s fade. |
  | First visit straight onto Home without a press (not reachable today: Start playing is always pressed first) | Silent until the first press. |
  | Tab in the background | Paused. It resumes when the tab comes back. |
  | Battle, tavern game or menu music playing | Home's music fades out until it stops. |
  | Music volume 0 or muted | Silent. |
  | A file not uploaded yet | Silent; one console note per file. |

  The ambient beds (`assets/audio/ambient/*.mp3`, not uploaded yet) duck to 20 % under Home's music rather than being turned off.
- **Home scene cost, measured 2026-11-16** (the polish pass, item 6). Setup: Playwright Chromium emulating a mid-range phone (390×844, DPR 2.5, CPU throttled 4×), 7–8 villagers out, 8 s windows, Chrome's Performance metrics. Headless Chromium rasterises in software, so treat the absolute frame rates as relative.

  | Phase | Measure | Before | After |
  |---|---|---|---|
  | Day | frames in 8 s | 34 | 293 |
  | Day | villager loop per frame | 3.04 ms | 0.74 ms |
  | Day | script per frame | 17.6 ms | 0.9 ms |
  | Day | style recalcs per frame | 9.2 (3.8 ms) | 2.0 (1.3 ms) |
  | Day | forced layouts per frame | 0.24 | 0.06 |
  | Night | frames in 8 s | 28 | 295 |
  | Night | villager loop per frame | 4.84 ms | 0.67 ms |
  | Night | script per frame | 24.1 ms | 0.9 ms |

  The loop's target is under 2 ms. Most of the gain came from stopping the map drawing under Home. The rest came from:
  - one multiply overlay at night instead of a filter on each element;
  - the villager outline baked into the sheets, replacing four drop-shadows per villager;
  - moving villagers by transform only, with no per-frame size reads.

### Tests
- **Use a fresh test database for the whole suite.** `rankings_test` and `wonders_test` build "the biggest town" and expect it to lead the boards; on a database that has run them before, the older copies tie and they fail (seen 2026-11-16). They don't clean up after themselves; worth fixing when next touched.
- **Frontend proofs:** `cd kindlewood-frontend && for f in verify/*_proofs.js; do node $f | tail -1; done`. There are 44 proofs and all pass. They need no server.
- **Server tests:** 44 `scripts/*_test.js` files, run by `scripts/test_all.sh`. The last full run on a fresh DB was 2,525 passed, 0 failed. The suite needs a throwaway Postgres and the API running:

  ```bash
  # 1. a throwaway database; DATABASE_URL points at it
  createdb kwfresh
  # 2. run the API against it, with a test admin id
  DATABASE_URL=$URL PORT=3998 ALLOWED_ORIGINS=http://localhost:8099 ADMIN_USER_IDS=990001,1 node index.js &
  # 3. once, on the fresh DB (runs /api/game/migrate and the seeds)
  PREPARE_TEST_BASE=http://localhost:3998 PREPARE_TEST_ADMIN_ID=990001 DATABASE_URL=$URL node scripts/prepare_test_db.js
  # 4. everything (also runs the frontend proofs when ../kindlewood-frontend exists)
  DATABASE_URL=$URL TEST_BASE=http://localhost:3998 TEST_ADMIN_ID=990001 ADMIN_USER_IDS=990001,1 bash scripts/test_all.sh
  ```

  To run a single test, use the same environment, e.g. `QUEST_TEST_BASE=… CRAFTING_TEST_ADMIN_ID=990001 node scripts/raids_test.js`. Each test's header comment lists the env vars it reads.
- **In the cloud container:** Postgres 16 isn't running by default. Start it with `pg_ctl` (data dir and socket in the scratchpad). If the scratchpad directory loses its `o+x` permission, Postgres dies. A background `chmod 755` loop kept it alive.
- **Playwright** (Chromium is preinstalled; `require('playwright')`):
  - serve the frontend with `python3 -m http.server 8099`;
  - override `/js/config.js` to point at the local API: `window.KINDLEWOOD_API='http://localhost:3998'`;
  - put a JWT in `localStorage.kw_token`, and set `kw_away_splash='off'`;
  - when also routing `/(js|css)/…?v=`, answer `config.js` inside that same route (later routes take precedence);
  - for an admin, sign a JWT for user 990001 (`JWT_SECRET` defaults to `dev-secret-change-in-production`).
- **Tested viewports:** 1400×900, 390×844 portrait, 844×390 landscape (touch).

### Raid testing (for the user)
- Open Dev Tools → Resources → 🔥 Raids.
- Pick a target, set arrival minutes (e.g. 2) and an optional strength, then press **Start raid**.
- Watch the red chip and the map trail, then use **Strike now** or **Cancel raid**.
- Use **Roll the normal check** to see why a town would or wouldn't be raided.

---

## 5. Key files

**Server**
- `lib/raids.js`, `lib/defences.js`, `lib/raid_extras.js`, `lib/raid_camps.js`, `routes/raids.js`
- `lib/outpost_state.js`, `routes/outposts.js`
- `lib/first_steps.js`, `routes/expeditions.js` (recall), `lib/travel.js`
- `lib/research_defs.js`, `lib/town_mods.js`, `lib/wonders.js`, `lib/clan_treasury.js`
- `db.js` (`applyMigrationFiles`), `routes/game.js` (`/settlement`, `/migrate`, `/first-steps`)

**Frontend**
- `index.html`: the load guard at the top of `<head>`, the early loading-screen ticker after `#loading-screen`, Dev Tools
- `js/main.js`:
  - `loadGame` and the loading checklist (`lsStep`, `lsRun`, `apiFetchWaking`, `lsProblem`);
  - the settlement panel (`_selectWorldTileImpl`, `_gatedAction`);
  - the outpost panel.
- `js/raids.js`, `js/kwmap-raid.js`
- `js/journeys.js`, `js/first-steps.js`, `js/dialog.js`, `js/a11y.js`, `js/help.js`
- `js/mobile-shell.js`, `css/mobile-shell.css`, `css/dialog.css`, `.htaccess`
- `verify/assets_proofs.js`, `verify/versions.json`

**Plan history:** the round-by-round plans (R1–R5 and Defences) were kept in a plan file in the previous session. Section 2 above summarises them.
