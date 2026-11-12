# Kindlewood — handover (after the pre-Phase 1 reviews, 2026-11-12)

Read this first in a new chat. It covers where things stand, what to do next, what exists, and how to work on it.
The same file is in both repos (`kindlewood-server/docs/` and `kindlewood-frontend/docs/`).

---

## 0. Start here

**The direction is set.** Kindlewood is a cosy generational sim, PvE first: *raise a woodland family line through the seasons.* Read these before writing code, in this order:

| Doc | What it is |
|---|---|
| `docs/ROADMAP_1_0.md` | The agreed plan: pillars, phases, onboarding, the owner's decisions |
| `docs/SECURITY_REVIEW.md` | **Fix S1 and S2 first.** Two high-severity holes in the live game |
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

1. **Security fixes S1 and S2** (`SECURITY_REVIEW.md`): validate and escape usernames and town names; stop using the sign-in cookie. Both are small. Then S4 and S3.
2. **Phase 1, step 1** (`PHASE_1_LIFE_CYCLE.md` §9), shipped on its own:
   - houses hold 4;
   - births need a free bed in town;
   - the population number follows the real count;
   - the kin rule;
   - housing sorts itself;
   - death clears `house_id`.

   This fixes the two live bugs below.
3. **The window component** (`LAYOUT_SPEC.md` §3), then **Phase 1 steps 2–7** as one release, with the Families screens built on it.
4. Then Phase 2, and so on down the roadmap.

All the owner's decisions for Phase 1 are made (`PHASE_1_LIFE_CYCLE.md` §11): the slower life pace, heirlooms with a small bonus, step 1 first.

### Findings from the assessment (2026-11-11 and 12)

1. **Births cannot happen in the live game.** A birth needs a couple sharing a house with a free place, and every house holds 2. Details in `PHASE_1_LIFE_CYCLE.md` §1.1.
2. **No ordinary player can leave Camp.** `settlements.population` is stuck at 10 (only admin tools and the traveller event raise it) and a Village needs 20. Everything gated by tier is unreachable without Dev Tools.
3. **Citizens do not age.** Age is a fixed number; children never grow up; nobody dies of old age.
4. **Adding ageing alone would wipe out every town** within two months (`scripts/population_model.js`, scenario B). Births must need a free bed in town, houses must hold 4, and settlers must arrive as a safety net. With those, towns are stable.
5. **No kin rule:** siblings or a parent and child could become partners once children grow up.
6. **A player can put HTML in a username or town name and it runs in other players' browsers** (confirmed locally). The sign-in token is readable by page scripts, so this allows account takeover. `SECURITY_REVIEW.md` S1.
7. **Other websites can act as a signed-in player** on routes that need no request body, through the sign-in cookie. `SECURITY_REVIEW.md` S2.
8. **The dead still take up a place in their house** (`house_id` is never cleared).
9. **The outpost trickle left haulers, haul settings and three buildings with little purpose.** See `OUTPOST_TRIM.md`.

### Nothing since R5 is merged

Everything from R6 onwards is on the branch `claude/vigilant-feynman-npuc6r` in both repos: four rounds of outpost work, Phase 0, and these docs. No pull requests are open. The owner has been advised to merge and play before Phase 1 goes far.

**Before that branch is merged:**

- **Render must have `JWT_SECRET` set** (16+ characters). With `NODE_ENV=production` the server now refuses to start without it.
- **GitHub secrets for the frontend deploy:** `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` (optional `FTP_DIR`). Without them the workflow only attaches the built site to the run.
- The first deploy after merging turns the trickle on: the top bar's rates change for anyone with outposts.

### Which model for what

The owner plans to build with Opus and bring Fable back for judgement calls. Good moments to ask for a Fable review: the end of each phase ("does this still serve the pitch, and what should be cut?"), any change to the numbers in `PHASE_1_LIFE_CYCLE.md` §2, and any request for a new system.

---

## 1. Where things stand

- **`main`** holds everything up to R5 and the loading fixes. See "Nothing since R5 is merged" above.
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

### Tests
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
