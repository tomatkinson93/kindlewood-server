# Kindlewood — handover (after R6: refinements and outpost stores, 2026-11-03)

Read this first in a new chat. It covers what exists, what's left, and how to work on it.
The same file is in both repos (`kindlewood-server/docs/` and `kindlewood-frontend/docs/`).

---

## 1. Where things stand

- **Everything below is merged to `main` in both repos.** The frontend went in as PR #90.
- **Deploying:**
  - **Server:** `tomatkinson93/kindlewood-server` deploys itself from `main` on Render (`https://kindlewood-api.onrender.com`). It's on Render's free tier, so it sleeps when idle and takes up to a minute to wake. The loading screen now handles that.
  - **Frontend:** `tomatkinson93/kindlewood-frontend` is uploaded to cPanel **by hand** (site: kindlewood.quest).
  - **`/assets`** is not in the zip; it goes up separately by FTP.
  - **`.htaccess`** is in the frontend root and **must be uploaded**. It starts with a dot, so turn on "Show hidden files" in cPanel File Manager. If the host already has one, merge the rules into it.
- **Migrations:** new SQL files are named `0NN_<name>.sql` and listed in `db.js` `applyMigrationFiles([...])`. They are idempotent and re-run on every boot. The README asks for them to be renumbered at deploy, but `main` currently runs them as `0NN_*`, and that works because only the suffix is matched. See `migrations/README.md`. The latest is `0NN_outpost_store.sql`.
- **The user wanted to suggest "refinements to the new things we've added"** (the R5 features and the defences/raids work) but hasn't said what yet. Ask them.

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
- **`.htaccess`:** js and css cached for a year (they are always `?v=`-versioned), html never cached, gzip on.
- **The loading screen waits for everything:**
  - a live file count;
  - a checklist of real steps;
  - "server waking up" retries for a sleeping Render server;
  - names any missing files, with Reload / Carry on.
- **`verify/versions.json` with `assets_proofs`** fails if a js or css file changes without a new `?v=`. **Always bump `?v=` and run `node verify/assets_proofs.js --update`** when you change a front-end file.

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

## 3. What's left (agreed or deferred)

1. **More refinements** from the user, if they have them. Ideas for outposts: a per-outpost "haul only these resources" filter, and more hauler slots at level 3.
2. **Withered strength creep:** each repelled raid makes the next one ~5% stronger; a loss or a cleared camp resets it. Suggested next, since it finishes the raid system.
3. **Raid log tab in the Watchtower:** past raids with outcome, losses, injuries, and defence vs strength. The data is already in `settlement_raids` (`loot` jsonb, `loss_share`, `defence`). Also suggested next.
4. **Mutual defence treaties** (clan to clan, or with Allied villages), so non-members on clan land can share defence. Today only members share (`lib/defences.js` `clanShare`). This needs a design discussion.
5. **Repair costs for a raided outpost** instead of idle time (`outposts.raided_until`).
6. **Friends and Achievements** (hidden menu items), **avatar upload** (hidden), and **player honors** (hidden; clan honors are live).
7. **Clan emblems** are still emoji placeholders.
8. **Rankings:** boards for research progress and crafting don't exist yet (`routes/game_stats.js`, `js/leaderboard.js`).
9. **Proof coverage is missing** for chat, inventory, diplomacy, the tier screen and most of the clan panel.
10. **Reopening the away report works per device only** (localStorage). A server-stored "last report" would fix that.
11. **Happenings:** no default or seasonal ones exist; admins create them by hand (by choice).
12. **Optional:** bundle the ~100 scripts into ~3 files if 503s come back even with caching. This adds a build step before each cPanel upload, so it was deferred.
13. **Old 404s:**
    - `/assets/kindlewood-logo.png` and `kindlewood-logotype.webp`;
    - `/assets/images/tiles/*.png`;
    - some audio files (`page_turn.mp3`, `ambient/night.mp3`).

    They are referenced in code but not on the host. The game falls back without them. Either upload them by FTP or remove the references.

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
- **Every `<script>`/`<link>` is `/js/x.js?v=…` or `/css/x.css?v=…`.** Bump `?v=` on change, then run `node verify/assets_proofs.js --update`.
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
