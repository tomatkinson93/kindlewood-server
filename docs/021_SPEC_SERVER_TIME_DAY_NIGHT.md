# Spec 021 — Server Time, Day/Night, Sun & Moon, Happenings

**Status:** Build-ready. All design decisions resolved (see §0).
**Repos:** `kindlewood-server`, `kindlewood-frontend`
**Builder:** Claude Code. Run the verify harnesses; don't just write them.

---

## How to use this spec (for Claude Code)

Work **one phase at a time**, in order. At the end of each phase:

1. Run every proof listed in that phase's acceptance gate, plus all existing proofs:
   - frontend: `verify/phase*_proofs.js`, `verify/tileactions_proofs.js`
   - server: `test_famine.js` and `scripts/*_test.js` where they run without a live DB
2. Commit to branch `feat/021-server-time` in each repo. One commit per phase.
3. **Stop** and report:
   - files changed
   - proof results
   - deploy notes
   - anything you were unsure about

   Wait for my go-ahead before starting the next phase.

If the code contradicts this spec, or a decision isn't covered here, **stop and ask**. Don't guess. Flag open questions as `[VETO?] <question>` in your report.

### Project-wide hard rules (non-negotiable)

- **Frontend:** vanilla JS only, classic `<script defer>` tags, no bundler, no ES modules.
- **Server:** CommonJS. Add no new npm or CDN dependencies.
- **Determinism:** `Math.random()` is forbidden in render, animation and tick paths.
  - Use `mulberry32` for seeded sequences.
  - Use `fnv1a32`/`hash32` for per-entity seeds.
  - Animated flicker is a deterministic function of `(time, seed)`.
- **Naming:** CSS custom properties use the `--kw-` namespace. Coordinates are axial `(q,r)` only, and screen projection stays inside the renderers.
- **Edits:** make surgical edits to large files and never regenerate a whole file. Bump `?v=` on every changed script or CSS tag in `index.html`.
- **SSE:** publish events post-commit only.
- **Migrations:** DDL goes in `migrations/0NN_<name>.sql` (idempotent, wrapped in BEGIN/COMMIT) and is registered in `db.js` → `applyMigrationFiles([...])`. This follows the existing suffix-matched pattern.
- **Name-collision hazard:**
  - "events" is already taken by `settlement_events`, `lib/game_events.js` and `routes/events.js`. The timed-event system in this spec is called **Happenings** everywhere: files, tables, routes, UI.
  - Several files exist on both sides with the same name (`seasons.js`, `quests.js`, `game.js`). Always state the repo when naming a file in your report.

---

## §0 Decisions (resolved — do not reopen)

| # | Decision |
|---|---|
| D1 | **Seasons move from 6h to 7h**, so a year is 28 real hours. Season and day phase now drift 4h per real day, and every season/phase combination appears within 7 days. Each season keeps a 25% share of time, so per-hour economy pressure is unchanged. |
| D2 | **Server time is UTC.** There is no DST anywhere. All time math goes through the shared `day_cycle.js` (§2.1). |
| D3 | **Phase hours are a tunable table in UTC.** They are set so night falls on North American evenings (see §2.1). |
| D4 | **The dev time override never affects other players.** Visual override is browser-local. Gameplay override is admin-only, per-user, in-memory, and expires (§2.3). |
| D5 | **Wall clock and gameplay clock are separate seams.** Economy, famine, workers, timers and season accrual use `wallNow()` only. Time-gated content (creatures, Happenings) uses `gameplayNow(user)`. |
| D6 | **Happenings are spaced around the clock and use windows** (start → end). Rewarding Happenings get a fairness check (§7.4). |
| D7 | **Happenings v1 has no economy multipliers.** `applyTick` accrues over arbitrary offline spans, so multipliers would need per-window overlap integration. That is deferred and noted in code. |
| D8 | **The moon cycle is 8 real days**, one named phase per UTC day. The sun is a position on the HUD dial and drives lighting warmth. |
| D9 | **Night lighting has a player setting:** On / Soft / Off. The default is On. |
| D10 | **Out of scope:** tavern-at-night, timed quests and fishing time gates. Make sure the hooks exist, but build no content for them. |

---

## Phase 0 — Ground and report (no code changes)

Read these files:

- **server:** `seasons.js`, `famine.js` (its local `seasonAt` duplicate), `simulation.js`, `routes/game.js`, `routes/outposts.js`, `routes/quests.js` (enemy pick at around line 52), `lib/clan_quests.js` (enemy pick at around line 273), `lib/combat_resolver.js`, `routes/combat.js`, `middleware/admin.js`, `lib/event_bus.js`, `lib/briar_engine.js` (dual-export pattern), `db.js` (migration runner), `index.js` (route mounts), `test_famine.js`
- **frontend:** `js/seasons.js`, `js/fishing.js` (calls `calcCurrentSeason`), `js/kwmap-core.js`, `js/kwmap-iso.js` (`_ensureBuffers`, the season-keyed ground buffer), `js/kwmap-topdown.js`, `js/kwmap-settlements.js`, `js/kwmap-atmosphere.js`, `js/season-atmosphere.js`, `js/kwmap-nameplates.js`, `js/audio.js` (settings popover, music volume), `js/welcome-music-guard.js`, `js/enemy_admin.js`, `js/buildings.js` (`openCheatMenu`, `cheatSwitchTab`), `index.html` (`#cheat-modal`, script tags, season badge), `docs/MAP_RENDERER.md`, `verify/_harness.js`

Report in 15 lines or fewer:

1. Every place season math lives.
2. The draw order in both renderers, and exactly where the lighting pass will slot in.
3. How fog-of-war visibility is known per tile on the client.
4. Every place an enemy is chosen at random.
5. Whether anything in this spec conflicts with the code.

---

## Phase 1 — Seasons to 7 hours (seamless cutover)

### 1.1 Single source of season math (server)

- In `seasons.js`, add `seasonAt(ms)` and make `getCurrentSeason()` call `seasonAt(Date.now())`.
- Remove the duplicate in `famine.js` and import `seasonAt` from `seasons.js`. The famine quantum loop must keep calling it per quantum start.
- Constants:
  - `SEASON_DURATION_MS = 7h`
  - `YEAR_DURATION_MS = 28h`
  - `LEGACY_SEASON_MS = 6h`
  - `LEGACY_YEAR_MS = 24h`
  - `SEASON_CUTOVER_MS = Date.parse('2026-11-02T00:00:00Z')`
- **Cutover logic:**
  - For `ms < SEASON_CUTOVER_MS`, use the legacy formula exactly as it is today.
  - For `ms >= SEASON_CUTOVER_MS`, use `idx = floor(((ms - CUT) mod 28h) / 7h)`.
  - The cutover is 00:00 UTC, which is the start of Spring under the legacy formula, so the season does not jump at the boundary. A famine offline window that spans the cutover stays deterministic.
  - `SEASON_CUTOVER_MS` must be any future 00:00 UTC at deploy time. If deploy slips past 2026-11-02, move it to the next 00:00 UTC and say so in your report.
- **Year counter continuity:**
  - Legacy year: `floor((ms - EPOCH_2025) / 24h) + 1`.
  - After cutover: `legacyYearAt(CUT) + floor((ms - CUT) / 28h)`.
  - The year number must **never decrease**.
- Return the same shape as today: `{...season, index, progress, msRemaining, dayNumber, year}`. Fix the `year: Math.ceil(dayNumber / 1)` no-op while you're there, so `year === dayNumber`.

### 1.2 Frontend parity

- Mirror the same logic in `js/seasons.js` `calcCurrentSeason()`.
- In Phase 2, `calcCurrentSeason()` switches to `KWClock.wallNow()`. For now keep `Date.now()`, but isolate it behind a single `_seasonNow()` helper.
- Update the panel copy at line 172: "1 real day = 1 in-game year" becomes "28 real hours = 1 in-game year · each season 7 hours".

### Acceptance gate — Phase 1

Add `scripts/season_cutover_test.js` (server, pure, no DB):

- **Legacy match:** `seasonAt` equals the legacy formula for 10,000 timestamps before the cutover.
- **Seamless boundary:** at `CUT - 1ms` the season is Winter (end of the legacy year), and at `CUT` it is Spring with progress 0.
- **Season lengths:** after the cutover, seasons are exactly 7h. Sweep 4 years and assert each boundary.
- **Year monotonic:** the year is non-decreasing across a sweep from 2026-10-01 to 2027-01-01 in 1-minute steps.
- **Drift:** for each of the 4 seasons and each of the 4 day phases (§2.1), the combination occurs at least once within 7 days after the cutover.
- **Server/client parity:** frontend `calcCurrentSeason` logic equals server `seasonAt` for 10,000 random timestamps. Load the frontend file via `vm` in the test, or extract the shared math into the Phase 2 dual-export file and test that.
- **Famine regression:** `test_famine.js` still passes. Update its `WINTER_MS` fixture only if it assumed 6h, and say so.

---

## Phase 2 — Clock core: day cycle, sun, moon, server clock, client sync

### 2.1 Shared `day_cycle` (dual-export, identical files)

`kindlewood-server/lib/day_cycle.js` and `kindlewood-frontend/js/day-cycle.js` are byte-identical. They use the dual-export pattern from `briar_engine.js` (`module.exports` on the server, `window.KWDayCycle` in the browser). They contain pure functions only, with no DOM, no DB and no `Date.now()` inside. Callers pass `ms`.

```
PHASES (UTC hour ranges, half-open, wrap at 24):
  dawn  09:00–11:00
  day   11:00–23:00
  dusk  23:00–01:00
  night 01:00–09:00
```

Leave a comment at the top of the file:

> UTC. Night ≈ 9pm–5am Eastern (summer) / 8pm–4am (winter). Tune here only.

**Exports:**

- `clockAt(ms)` → `{ hour, minute, second, dayFraction /*0..1 of the UTC day*/, ymd /*'2026-11-02'*/, weekday /*0=Sun*/ }`
- `phaseAt(ms)` → `{ phase, progress /*0..1 within phase*/, nextPhase, msToNext }`
- `sunAt(ms)` → `{ up: bool, elevation /*0..1, 0 at dawn start and dusk end, 1 at the midpoint of day*/, arc /*0..1 position left→right across dawn+day+dusk*/ }`
- `moonAt(ms)`:
  - `MOON_EPOCH_MS = Date.parse('2026-11-02T00:00:00Z')`, which is a New Moon.
  - The cycle is 8 UTC days. Index = `floor((ms - EPOCH) / 24h) mod 8`, using a positive mod so dates before the epoch work.
  - Names: `['new','waxing_crescent','first_quarter','waxing_gibbous','full','waning_gibbous','last_quarter','waning_crescent']`
  - Glyphs: 🌑🌒🌓🌔🌕🌖🌗🌘
  - Returns `{ index, id, name, glyph, illumination /*0..1, 0=new, 1=full, cosine curve*/, up: bool /*true during dusk/night/dawn*/, arc /*0..1 across dusk+night+dawn*/ }`
- `lightingAt(ms)` → `{ darkness, tint:[r,g,b], tintStrength, lightLevel, warmth }`

  This is one continuous curve over `dayFraction`, built from a `KEYFRAMES` table at the top of the file and interpolated with smoothstep. There must be no jumps.

  | Point | darkness | tint | lightLevel |
  |---|---|---|---|
  | day | 0 | none | 0 |
  | dusk (amber, warmth high) | ramps to ~0.35 | amber | starts rising at 40% through dusk |
  | night (cool blue-violet) | 0.55 cap | blue-violet | 1 |
  | dawn (rose-gold) | eases back to 0 | rose-gold | reaches 0 by 50% through dawn |

  - **Moon modifier, night only:** `darkness -= 0.08 * illumination`, so a full moon is brighter. Tint lerps toward silver `[200,210,235]` by `0.3 * illumination`.
  - `warmth` (0..1) follows the sun's low angle, peaking at dawn and dusk. Lighting uses it to tint glows and edges.

- `phaseMidpoint(phase, referenceMs)` → ms of that phase's midpoint on the UTC day of `referenceMs`. The dev override uses this.
- `windowsBetween(rule, fromMs, toMs)` → `[{startMs, endMs}]` for a Happening recurrence rule (§7.1). Rules are pure and shared, so the client can show upcoming windows without a fetch.

### 2.2 Server clock — `lib/server_clock.js`

```js
wallNow()            // Date.now(). Economy, famine, workers, seasons, timers. ONLY this.
gameplayNow(user?)   // wallNow() + debug offset for that admin user, if one is set and unexpired; else wallNow().
setDebugOffset(userId, offsetMs, ttlMs = 2h) / clearDebugOffset(userId) / getDebugOffset(userId)
```

- Debug offsets live in an in-memory `Map`. They are lost on restart, which is fine. They are only settable for `isAdminUser(user)`.
- Header comment: time-gated content must call `gameplayNow(req.user)`. Never route economy through it.

**Routes** (in `routes/game.js`, mounted under `/api/game`):

- `GET /time`, no auth, `Cache-Control: no-store`. Returns:
  `{ now: wallNow(), tz: 'UTC', phase, sun, moon, season: getCurrentSeason() (trimmed: id, index, progress, msRemaining, year) }`
- `GET /time/me`, `requireAuth`. Same as above, plus `gameplayNow` and `debugOffsetMs` for this user. Non-admins always get 0.
- `POST /time/debug`, `requireAuth`, `requireAdmin`. Body is one of:
  - `{ offsetMs }`
  - `{ phase: 'dawn'|'day'|'dusk'|'night' }`, which computes the offset to that phase's next midpoint
  - `{ moon: 0..7 }`, which shifts whole days to reach that moon phase while keeping the time of day
  - `{ clear: true }`

  Returns the new `/time/me` payload.

### 2.3 Client clock — `js/server-clock.js` → `window.KWClock`

**Sync:**

- On load, fetch `/api/game/time`, and also `/time/me` when a `kw_token` exists. Compute `offset = serverNow - (t0 + t1) / 2`.
- Resync every 30 minutes and on `visibilitychange` when the tab becomes visible.
- If a fetch fails, keep the last offset (0 initially) and `console.warn` once.

**API:**

- `wallNow()`
- `now()` (applies the visual override)
- `phase()`, `sun()`, `moon()`, `lighting()`
- `onChange(fn)`. It fires when the phase changes, when the moon changes, and on override changes.

**Visual override** (browser-local, localStorage `kw_dev_clock`, all access wrapped in try/catch). Modes:

- `live`
- `phase:<p>`
- `hour:<0–23.99>`
- `moon:<0–7>`
- `fast`: 1 real minute = 24h, for watching transitions

When the mode changes, **tween the lighting values** (not the clock) over 2.5s. Under `prefers-reduced-motion`, use 0.6s.

**Admin coupling:** when an admin sets `phase:`, `hour:` or `moon:`, also `POST /time/debug` so visuals and gameplay agree. `live` sends `{clear:true}`. Non-admins only get the visual override; the server returns 403, which the client ignores silently.

In `js/seasons.js`, `_seasonNow()` now returns `KWClock.wallNow()` when it's available. This means a player's wrong PC clock no longer shows the wrong season.

### Acceptance gate — Phase 2

Add `verify/daycycle_proofs.js` (frontend harness) and `scripts/daycycle_test.js` (server). They cover:

- **Byte identity:** the two `day_cycle` files are byte-identical. Compare SHA-256.
- **Phase boundaries:** at 08:59, 09:00, 10:59, 11:00, 22:59, 23:00, 00:59, 01:00 UTC, and across 23:59 → 00:00 inside dusk.
- **Continuity:** `lightingAt` is continuous. Across all 1,440 minutes of a day, for every moon index, the step between adjacent minutes is below 0.02 in darkness and lightLevel.
- **Value ranges:**
  - darkness is in [0, 0.55].
  - darkness and lightLevel are exactly 0 for every minute of `day` with ≥30 minutes margin from its edges.
- **Moon:**
  - the epoch is new; +4 days is full; +8 days is new again.
  - dates before the epoch return a valid index.
  - illumination is monotone from 0 to 4.
- **Sun:**
  - `elevation` is 0 at dawn start and dusk end, and 1 at the day midpoint.
  - `sun.up` and `moon.up` are each true during their own phases.
- **Debug offset:**
  - non-admins get 0 from `gameplayNow`.
  - an admin offset expires after its TTL (use an injectable clock in the test).
  - `wallNow` is never affected.
- **Wall-clock seam:** grep-style assertion that `famine.js`, `simulation.js`, `seasons.js` and `routes/outposts.js` do not reference `gameplayNow`.

---

## Phase 3 — Map lighting, lit windows, Dev Tools Time tab, player setting

### 3.1 `js/kwmap-daylight.js` → `window.KWDaylight`

**Pipeline per frame**, in both renderers (top-down and iso):

1. Ground buffer, sprites and clouds draw as they do today.
2. **Shade:** reuse one offscreen canvas at 0.5× device pixels. Fill it with the tint at `darkness`, using multiply-style compositing and a `tintStrength` overlay.
3. **Light pools:** punch holes in the shade with `destination-out` radial-gradient sprites at each light source.
4. Composite the shade over the map canvas.
5. **Glows:** draw additive (`lighter`) warm halos at light sources, scaled by `lightLevel`.
6. **Lit windows** (§3.2), drawn after the shade so they read as emissive.

**Rules:**

- **Never bake lighting into the iso ground buffer.** That buffer is keyed by season and must not rebuild during a fade.
- **Day no-op:** when `darkness === 0 && lightLevel === 0`, the pass returns before touching any canvas, so every existing golden and proof stays byte-identical.
- Nameplates and the uifx canvas (hover/selection) stay **unshaded**.
- **Positions:** use each renderer's already-collected visible-tile screen positions. Never re-project from raw `(q,r)`, which is the wrap-boundary lesson. If a renderer doesn't expose its visible settlement list, add a minimal read-only accessor rather than duplicating its traversal.
- **Fog of war:** only tiles the player can currently see emit light. A glow must never reveal a hidden settlement. Add a proof for this.
- **Caching:** gradient sprites are cached by `(kind, radiusBucket)`, where `radiusBucket` is a 4px step.
- **Flicker:** deterministic. Radius and alpha jitter is `Σ sin(t·fᵢ + seedᵢ)` with `seed = hash32(q, r)`, ±6% radius and ±10% alpha. Under reduced motion there is no flicker.
- Expose `KWDaylight.state()` → the current `lighting()` values (post-tween). `season-atmosphere.js` multiplies its particle alpha by `1 - darkness * 0.6`. That is a one-line, guarded edit.

**Light sources:**

| Source | Radius (× hexW) | Colour | Notes |
|---|---|---|---|
| camp | 0.9 | warm firelight `#ffb35c` | campfire flicker stronger |
| village | 1.1 | `#ffc070` | |
| town | 1.35 | `#ffc878` | |
| city | 1.6 | `#ffd080` | |
| kingdom / annex | 1.9 / 1.2 | gold `#ffd966` | brightest |
| NPC settlement | per tier | same as tier | |
| hostile (Withered) | 1.0 | sickly violet `#9a5cff` | slow pulse instead of flicker; no lit windows |
| player's own settlement | ×1.15 | per tier | |
| outpost | 0.5 | `#ffb35c` at 50% alpha | only if outposts are in the visible set |

Put all values in one `LIGHTS` table at the top of the file.

### 3.2 Lit windows — `js/kwmap-settlements.js`

- Next to each cached sprite, paint a separate **emissive mask** canvas per `(look, pixel size)`. Use the same cache key plus a `:glow` suffix.
  - Small warm rectangles where the procedural windows and doors are.
  - Camps get the campfire core.
  - Hostile settlements get none.
- Add `KWSettlements.drawGlow(ctx, t, cx, baseY, hexW, alpha)`. Its signature mirrors `draw()`.
- The daylight pass calls it with `alpha = lightLevel`.
- Windows "switch on" staggered per building. Each window's on-threshold is `hash32(q, r, i) / 2³²·0.4`, compared against `lightLevel`. Some windows stay dark at random, deterministically.

### 3.3 Player setting

In `audio.js`'s settings popover (that is where settings live today), add **Night lighting: On / Soft / Off**. It is stored in localStorage `kw_night_lighting`.

- **Soft** halves darkness.
- **Off** forces the day no-op for darkness, but keeps lit windows at 50% so the night still reads.

### 3.4 Dev Tools → `🕯 Time` tab

Add it to `#cheat-modal`, following the `cheat-tab` / `cheat-tab-panel` pattern. Contents:

- **Live readout:**
  - UTC time and the player's local time
  - phase and progress
  - sun elevation
  - moon glyph and name
  - season and year
  - active visual override
  - active server gameplay offset (from `/time/me`)
- **Buttons:** Live · Dawn · Day · Dusk · Night · Fast cycle
- **Hour slider:** 0–24
- **Moon picker:** the 8 glyphs
- **Note:** "Visual override is local to this browser. Admin overrides also shift *your* gameplay time (creatures, Happenings) for 2h. Other players are never affected."

### Acceptance gate — Phase 3

Extend `verify/daycycle_proofs.js`, or add `verify/daylight_proofs.js`:

- **Day no-op:** at noon UTC the daylight pass makes zero canvas calls on a spy context, in both renderers.
- **Golden:** all `phase1`–`phase7` proofs and the top-down golden still pass unchanged.
- **Fog of war:** a hidden-tile settlement in the harness world produces no light source.
- **Determinism:** flicker is deterministic. The same `(t, q, r)` gives the same radius, and the file contains no `Math.random`.
- **Settings:**
  - `Off` yields darkness 0.
  - `Soft` yields exactly half.
- **Hostile:** hostile settlements use the violet light and draw no window glow.
- **Visual check:** state that you visually checked dawn, day, dusk, night, full moon and new moon in both renderers using the dev tab. Attach screenshots if your environment can take them; otherwise list what I should check.

---

## Phase 4 — HUD clock and audio beds

### 4.1 HUD sun/moon dial

Add it next to `#season-badge`, in a new `js/hud-clock.js` + `css/hud-clock.css`, matching the storybook/parchment style (Playfair Display / Crimson Pro, `--kw-` palette, `kw-ornate-frame` if it fits at this size).

**Compact dial** (about 56px):

- a semicircular sky arc
- the sun travels the arc during dawn → day → dusk
- the moon travels it during dusk → night → dawn and shows its phase glyph or shape
- the sky fill colour follows `lighting().tint`

**Label:** phase name in-world — "Morning", "Midday", "Evening", "Night", "Small hours" — derived from `phase` + `progress`. Keep the mapping table in `hud-clock.js`.

**Tooltip:**

> Hearth time · 01:42 UTC · your time 9:42 PM
> 🌔 Waxing gibbous · Night ends in 3h 18m

**Click** opens a small panel, styled like the season panel:

- the next 6 phase changes in player-local time
- this moon cycle (8 glyphs, today highlighted)
- an "Upcoming Happenings" list, filled in Phase 6. Leave the hook and an empty-state line now.

Updates come from `KWClock.onChange` plus a 30s tick. Don't run a per-frame loop.

### 4.2 Ambient audio beds

Extend `audio.js` with an **ambient channel**:

- **Volume:** key `kindlewood_ambient_vol`, with a slider in the settings popover next to Music.
- **Beds:**
  - `/assets/audio/ambient/day.mp3` (birdsong, woodland)
  - `dusk.mp3`
  - `night.mp3` (crickets, owl)
  - `dawn.mp3` (dawn chorus)
- **Behaviour:**
  - Crossfade over 8s on phase change. Use `KWClock.onChange`.
  - Play only while the world map or settlement view is visible.
  - Duck to 20% under battle, tavern or menu music, and restore afterwards.
  - Respect the existing autoplay/user-gesture guard (`welcome-music-guard.js`).
- **Missing files fail silently.** Warn once per file in the console. The assets don't exist yet, and I'll supply them.

### Acceptance gate — Phase 4

- **Dial geometry:**
  - The dial's sun position equals `sunAt().arc` at 5 sample times.
  - The moon glyph equals `moonAt().glyph` for all 8 indices.
- **Audio:** with stubbed `Audio`, a phase change triggers exactly one crossfade, and battle music ducks the ambient bed.
- **Assets:** list the exact asset filenames and durations you assumed (loopable, about 60–120s, normalized quieter than music).

---

## Phase 5 — Nocturnal (and lunar) creatures

### 5.1 Schema

Migration `migrations/0NN_time_gated_enemies.sql`, registered in `applyMigrationFiles`:

```sql
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS active_phases JSONB DEFAULT NULL; -- e.g. ["dusk","night"]; NULL = any time
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS moon_phases   JSONB DEFAULT NULL; -- e.g. ["full"];        NULL = any moon
```

### 5.2 Selection

- Add a helper in `lib/time_gates.js`: `enemyEligibleSql(paramIndex)`. It returns a WHERE fragment that matches when:
  - `active_phases IS NULL OR active_phases ? $n`, and
  - `moon_phases IS NULL OR moon_phases ? $n+1`.
- Use the helper in **every random enemy pick** found in Phase 0:
  - `routes/quests.js` (around line 52)
  - `lib/clan_quests.js` (around line 273)
  - any others found in Phase 0
- Pass phase and moon from `day_cycle` at `gameplayNow(req.user)`. For worker-resolved quests, use the quest owner's user.
- **Explicit encounter lists are not filtered.** If a quest author names a nocturnal enemy in `combat_encounter`, it appears regardless of time. That is author intent; document it in the helper comment.
- **Fallback:** if the filtered pool is empty, fall back to the unfiltered pool. Combat must never fail for lack of an eligible enemy.
- `combat_resolver.js` `_loadEnemyRoster()` stays unfiltered. It is the roster, not the pick.

### 5.3 Admin UI

- In `js/enemy_admin.js`:
  - Add checkboxes for active phases (Dawn / Day / Dusk / Night; none checked means "any time").
  - Add 8 moon toggles (none means "any moon").
- Update `routes/combat.js` insert/update to accept and validate both fields. Only known ids are allowed; empty arrays are stored as NULL.

**Seed no creatures.** I'll author them in Dev Tools.

### Acceptance gate — Phase 5

Add `scripts/time_gates_test.js` (with a pg-mem or stubbed query layer if a live DB isn't available; say which):

- **Phase filter:** a night-only enemy is never picked at noon and is pickable at 03:00 UTC.
- **Moon filter:** a full-moon-only enemy is pickable only on moon index 4.
- **Fallback:** an empty filtered pool falls back to the unfiltered pool.
- **Debug offset:** an admin debug offset to night makes night enemies pickable for that admin only, and a second, non-admin user at the same instant still gets the day pool.

---

## Phase 6 — Happenings (scheduled timed events)

### 6.1 Schema

Migration `migrations/0NN_happenings.sql`:

```sql
CREATE TABLE IF NOT EXISTS happenings (
  id          TEXT PRIMARY KEY,               -- slug, e.g. 'lantern_walk'
  title       TEXT NOT NULL,
  flavour     TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '🏮',
  rule        JSONB NOT NULL,                 -- recurrence, §6.2
  effects     JSONB NOT NULL DEFAULT '[]',    -- §6.3
  rewarding   BOOLEAN NOT NULL DEFAULT FALSE, -- drives the fairness check
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.2 Recurrence rules (evaluated by `day_cycle.windowsBetween`, shared)

All times are UTC. Every rule produces windows: `{startMs, endMs}`.

```jsonc
{ "type": "once",   "start": "2026-12-24T22:00:00Z", "end": "2026-12-25T04:00:00Z" }
{ "type": "daily",  "start": "14:00", "durationMin": 180 }
{ "type": "weekly", "days": [1,4], "start": "14:00", "durationMin": 180 }        // 0=Sun
{ "type": "rotating", "start": "14:00", "durationMin": 120, "shiftHours": 8 }   // start moves +8h each day → covers 3 slots
{ "type": "phase",  "phases": ["night"] }                                        // window = each occurrence of the phase
{ "type": "moon",   "moons": ["full"], "phases": ["dusk","night"] }              // phase windows, only on those moon days
```

- A window that crosses midnight continues into the next day.
- Overlapping windows from the same rule merge.

### 6.3 Effects (v1)

- `{ "type": "banner" }`: shows in the HUD panel, plus a toast when the Happening starts while the player is online.
- `{ "type": "enemy_pool", "add": ["enemy_id", ...] }`: these enemies are eligible during the window **regardless of their own `active_phases`/`moon_phases`**. Integrate this into the `time_gates` helper from Phase 5.
- `{ "type": "map_flourish", "kind": "lanterns" | "fireflies" | "aurora" }`: a cosmetic hook. Only implement `lanterns`, which adds extra warm points around visible settlements in the daylight pass. Stub the others with a console note.

There are **no economy or resource multipliers** in v1 (decision D7). Put a code comment at the effect dispatcher explaining why.

### 6.4 Activation — no background job

Activity is computed, not stored. "Is X active" = `windowsBetween(rule, now - maxDuration, now)` contains `now`. Use `gameplayNow(user)` for gameplay effects.

**Routes:**

- `GET /api/happenings/schedule`, no auth, cached 60s. Returns enabled definitions (id, title, flavour, icon, rule, effects, rewarding). The client computes windows itself with the shared function.
- `GET /api/happenings/active`, `requireAuth`. The server's view at `gameplayNow(req.user)`.
- **Admin CRUD**, behind `requireAuth` + `requireAdmin`:
  - `GET /api/happenings/admin`
  - `POST /api/happenings/admin`
  - `PUT /api/happenings/admin/:id`
  - `POST /api/happenings/admin/:id/archive`
  - Rules are validated by type, the `days` range, the "HH:MM" format, and `durationMin` between 15 and 1440.

The client polls the schedule on load and on clock resync. Toasts fire from client-side window computation, so no SSE is needed.

### 6.5 Fairness check (warning, not a block)

Run this on admin save and in the admin UI for any `rewarding` Happening. Compute the rule's windows over a 7-day span, then build a coverage map of UTC hours (24 buckets). The check **warns** if:

- (a) fewer than **3 distinct UTC start hours** occur across the week, **and**
- (b) the longest window is under **8 hours**.

In other words, a rewarding Happening must either move around the clock or last long enough for most time zones to catch it.

`phase` and `moon` rule types are exempt from (a), because the 4h-per-day phase drift isn't relevant to them. They still get the coverage heatmap shown.

### 6.6 UI

- **HUD panel (from Phase 4)** gets an "Upcoming Happenings" section:
  - next 48h, in player-local time
  - icon, title, starts-in / ends-in
  - the currently active one is highlighted
- **Dev Tools** gets a new `🏮 Happenings` tab:
  - list
  - create/edit form with a rule builder for the six types
  - effects editor (JSON textarea with validation is fine for v1)
  - a 7-day × 24-hour UTC **coverage heatmap** with the fairness warning inline
  - a "preview next 5 windows" list in local time

### Acceptance gate — Phase 6

Add `scripts/happenings_test.js` and `verify/happenings_proofs.js`:

- **Rule windows:** each rule type produces the correct windows over a fixed 14-day span. Use golden fixtures in the test file.
  - Cases include a midnight-crossing daily rule.
  - `rotating` covers 3 distinct start hours.
  - `moon` occurs only on the right moon days.
- **Server/client agreement:** the client and server compute identical windows for every fixture. This is guaranteed by the shared file; assert it.
- **Active pick:** an active `enemy_pool` Happening makes its enemy pickable outside the enemy's own `active_phases`.
- **Fairness check:**
  - `daily 14:00 for 2h, rewarding` gets a warning.
  - `rotating 14:00/2h/+8h` gets none.
  - `daily 14:00 for 9h` gets none.
- **Admin gate:** non-admin CRUD returns 403.

---

## Deploy notes (fill in per phase in your report)

- **Order:** SQL (none until Phase 5) → server → frontend, then hard refresh.
- **Env:** `ADMIN_USER_IDS` must include my user id for the debug clock and Happenings admin.
- **Phase 1:** confirm `SEASON_CUTOVER_MS` is still in the future on deploy day. Players see the season panel copy change. The year number continues without a jump.
- **Phase 4:** ambient audio files go up by FTP to `/assets/audio/ambient/`. List the filenames.
- `/assets` is never in the cPanel zip.

## Explicitly out of scope (hooks only)

- Tavern behaviour by time of day
- Time-gated quests (`quest_definitions` windows). A later spec will reuse `time_gates.js` and the Happening rules.
- Fishing time/moon gates. The Moontrout ("clear winter nights") is the obvious first use, but it waits for the fishing server-auth work.
- Economy multipliers during Happenings (D7)
- Weather
