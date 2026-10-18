# Spec 021 — Handover to Claude Code

**Read this first, then `docs/021_SPEC_SERVER_TIME_DAY_NIGHT.md`.** Where the two disagree, **this file wins**. It records decisions Scar made after the spec was written.

This file and the spec are identical in both repos (`kindlewood-server/docs/` and `kindlewood-frontend/docs/`).

---

## 1. Status

| Phase | State | Where |
|---|---|---|
| 0 Ground & report | ✅ done | findings in §4 below |
| 1 Seasons 6h → 7h | ✅ merged to `main` (server PR #64, frontend PR #19) + deployed | |
| 2 Clock core | ✅ merged to `main` (server PR #65, frontend PR #20) + deployed + tested live | |
| 3 Map lighting, lit windows, Time dev tab, setting | ✅ merged (frontend PR #22) | |
| 4 HUD dial + ambient audio | ✅ merged (frontend PR #23); ambient beds fail silently until audio files exist | |
| 5 Nocturnal/lunar creatures | ✅ merged (server PR #67, frontend PR #25) | |
| 6 Happenings | 🔍 built on `claude/practical-euler-4x48ig`, awaiting review | |

**Also done alongside (not in the original spec):**
- Settings modal (profile menu → ⚙️) has Audio / Graphics tabs; every map setting moved there from the season panel (`js/settings-panel.js`).
- Season, Time and Settings panels use the modern modal look (ink card, ornate frame).
- Dev Tools are admin-only: `requireAdmin` on every Dev Tools route (`scripts/admin_gates_test.js`), the ⚗ button hidden for non-admins.
- Fishing is server-authoritative (`/api/fishing/cast` + `/land`, `lib/fishing.js`); there is no player-facing "add item" route — items only enter inventories via `lib/inventory.grantItem`.
- Admin "?" tooltips float on `<body>` (`js/kw-tooltip.js`) instead of being clipped by the card.

**Live check, 2026-10-17:**
- `/api/game/time` and `/time/me` respond.
- Scar is admin, so `ADMIN_USER_IDS` is already set on Render.
- `KWClock` overrides work, and the admin offset follows them.

## 2. Setup and workflow

- **Layout:** clone both repos side by side (`kindlewood-server/`, `kindlewood-frontend/`). The parity and byte-identity tests look for the sibling directory. You can also pass its path as the first argument, or set `KW_FRONTEND_DIR` / `KW_SERVER_DIR`.
- **Branch:** `feat/021-server-time` in each repo, currently even with `main`. Scar merges each phase by PR.
- **One commit per phase per repo.** Then stop and report:
  - files changed (always say which repo)
  - proof results
  - deploy notes
  - `[VETO?]` questions

  Wait for Scar's go-ahead before starting the next phase.
- **Deploy:** the server auto-deploys from `main` on Render. The frontend goes up to cPanel by hand. `/assets` is never in the cPanel zip; it's uploaded by FTP.
- **Don't commit `package-lock.json`.** The server repo doesn't track one. `npm install` creates it, so delete it afterwards.
- **Proofs to run every phase:**
  - **frontend:** every `verify/*_proofs.js`
    - `phase1_proofs.js` needs the pre-extraction `main.js` as `argv[2]`. It already failed on `main` before 021. Phases 2–7 still cover the golden.
  - **server:**
    - `node test_famine.js`
    - `node scripts/season_cutover_test.js`
    - `node scripts/daycycle_test.js`
    - `node scripts/briar_cards_proofs.js`
    - `node scripts/room_tick_test.js`
  - **Expected server failures:** the clan, community and moderation tests need a live server and database. `room_disconnect_test.js` already failed on `main`.

## 3. What exists now (Phases 1–2)

**Server**
- **`seasons.js`:** `seasonAt(ms)` is the only server-side season math.
  - Before `SEASON_CUTOVER_MS` (2026-11-02 00:00 UTC) it uses the legacy 6h/24h formula. After it, seasons are 7h and years 28h.
  - The year continues across the cutover, and `dayNumber === year`.
  - `famine.js` imports it.
- **`lib/day_cycle.js`:** pure shared math. Exports:
  - `clockAt`, `phaseAt`, `phaseStartBefore`
  - `phaseMidpoint` (the next occurrence at or after the reference time)
  - `sunAt`, `moonAt`, `moonIndexAt`
  - `lightingAt(ms, {moonIndex})`
  - `overrideOffset`, `windowsBetween`, `parseHHMM`
- **`lib/server_clock.js`:**
  - `wallNow`, `gameplayNow(user)`, `set/clear/getDebugOffset`, `getDebugExpiry`
  - in-memory per-admin offsets with a 2h TTL
  - test helpers `_setClockForTest` / `_resetForTest`
- **`routes/time.js`:** mounted from `routes/game.js` with `router.use(require('./time'))`.
  - `GET /api/game/time`
  - `GET /api/game/time/me`, which adds `isAdmin`, `gameplayNow`, `debugOffsetMs`, `debugExpiresAt` and `gameplay:{phase,moon}`
  - `POST /api/game/time/debug` (admin only), with a body of `{offsetMs}`, `{phase}`, `{moon}` or `{clear}`

**Frontend**
- **`js/day-cycle.js`:** byte-identical to the server's `lib/day_cycle.js`; exposed as `window.KWDayCycle`. **Edit one copy, then copy it to the other.** Tests on both sides compare SHA-256.
- **`js/server-clock.js` → `window.KWClock`:**
  - `wallNow`, `now`, `phase`, `sun`, `moon`
  - `lighting()` (tweened)
  - `onChange`, `setOverride(spec)`, `override()`, `me()`, `sync()`
  - `pin(ms)` / `unpin()` for harnesses
  - setting `window.__KW_NO_AUTOSTART = true` before loading stops it auto-starting
- **`js/seasons.js`:** `calcSeasonAt(ms)` mirrors the server version. `_seasonNow()` returns `KWClock.wallNow()`.
- **Script tags:** `day-cycle.js` and `server-clock.js` load right after `config.js`.

**Tests:** server `scripts/season_cutover_test.js` (12 checks) and `scripts/daycycle_test.js` (41 checks); frontend `verify/daycycle_proofs.js` (22 checks).

## 4. Decisions that override or extend the spec

### Already built in (Phases 1–2)
1. **Moonlight is weighted by a smooth night factor** (`baseDarkness / 0.55`), not a "night only" switch. The silver tint uses the same factor.
2. **A moon day rolls at 11:00 UTC** (the end of dawn), not 00:00.
   - `MOON_EPOCH_MS = 2026-11-02T11:00Z` is new moon; its night is Nov 2 → 3.
   - A whole dusk → night → dawn belongs to one moon.
   - A `{moon:['full'], phases:['dusk','night']}` rule gives one merged 10h window per cycle.
3. **`lightingAt(ms, {moonIndex})`** holds the moon fixed for continuity tests.
4. **Dev override = jump, run, expire.**
   - `phase:` / `hour:` / `moon:` jump the clock forward from the current visual time, so picks combine (Night then `moon:4` gives a full-moon night). Time then keeps running.
   - Both the visual and the gameplay override expire after 2h. `fast` (1 real minute = 24h) also lasts at most 2h.
   - The client always POSTs `{offsetMs}`, so both sides compute the same number.
   - **Reconcile:** if the server lost the offset (restart), the client re-sends it. If the server has an offset the browser doesn't know about, the client adopts it as mode `offset`.
5. **Harnesses pin `KWClock` to noon UTC** (`KWClock.pin(Date.parse('…T12:00:00Z'))`) whenever they render. No golden or proof may depend on the real time of day.
6. **`windowsBetween(rule, from, to)`** returns windows that *overlap* `[from, to)`, unclipped and merged (overlapping or touching). It looks back and ahead 72h.
   - "Active at t" is `windowsBetween(rule, t, t+1).length > 0`.
   - Use this instead of the spec's `now - maxDuration` lookback in §6.4.
7. **`rotating` rules anchor on `ROTATION_EPOCH_MS` = 2026-11-02 (day 0).** Example: `14:00 / +8h` runs 14:00, 22:00, 06:00, then repeats.
8. **`dayNumber === year`** after the fix. Nothing should treat `dayNumber` as a count of real days.
9. **Season panel copy:** "28 real hours = 1 in-game year · each season 7 hours" shows only once the cutover has passed. Before that it says "1 real day = 1 in-game year".

### For the phases ahead
10. **Phase 3, lit windows:** the spec's `hash32/2³²·0.4` threshold would turn every window on eventually. Instead, a fixed share of windows never light: a window stays dark if `hash32(q,r,i)/2³² > 0.85`. The others light when `lightLevel` passes `(hash/2³²)·0.4` (or a similar spread).
11. **Phase 3, the Night lighting setting goes in the season panel's "✦ Map & Atmosphere" block**, next to the clouds and colour-grading toggles. Not the `audio.js` popover. It's stored in localStorage `kw_night_lighting` as `on`/`soft`/`off`.
    - **On:** full lighting.
    - **Soft:** half darkness.
    - **Off:** no shade, no light pools, no halos. Only lit windows at 50% alpha, so the night still reads.
12. **Phase 3 positions:** both renderers keep their visible lists local.
    - Top-down: `visibleTiles` inside `render()`.
    - Iso: tall-buffer drawables plus the blit offset.

    Add a minimal read-only accessor per renderer. Don't duplicate the traversal.
13. **Phase 3, fog of war is binary on the client.** A tile is hidden if it's missing or has `terrain === 'fog'`. There is no "explored but not visible" state. Light comes only from non-fog tiles.
14. **Phase 3, draw order:** the lighting pass goes **after clouds** in both renderers.
    - Top-down: after `_atmo.drawClouds`, at the end of `render()` in `js/kwmap-topdown.js`.
    - Iso: after step 5 in `render()` in `js/kwmap-iso.js`.

    Nameplates and hover/selection are on the uifx canvas, so they stay unshaded automatically.
15. **Phase 4, tooltip example:** the spec's arithmetic is wrong. At 01:42 UTC, night ends in **7h 18m**, not 3h 18m.
16. **Phase 5, random enemy picks happen in exactly two places:**
    - server `routes/quests.js` `_pickFallbackEnemy()` (around line 50, called around line 793)
    - server `lib/clan_quests.js` `fallbackEnemy()` (around line 271, called around line 303)

    The `['marsh_rat']` defaults in server `routes/combat.js` are hardcoded, not random. Leave them alone.
17. **Phase 5, `lib/time_gates.js`:** the helper returns `{ sql, params }` (not a bare `(paramIndex)` string), so Phase 6 can add the Happening pool (`OR id = ANY($k)`) without changing its signature. Use `active_phases @> jsonb_build_array($n::text)` rather than the jsonb `?` operator.
18. **Phase 5, clan quests use real time (`wallNow()`)** for creature picks. They're shared, so admin warps never affect them. Solo quests use the quest owner's `gameplayNow(user)`. For worker-resolved solo runs, load the owner's user id from the settlement.
19. **Phase 5 tests use a stubbed query layer, not pg-mem.** pg-mem would be a new dependency, which the hard rules forbid.
20. **Phase 6, Happening start toasts follow the real clock** (`KWClock.wallNow()`), so a dev time warp never fires toasts. The HUD "Upcoming Happenings" list may show the warped view.

## 5. Gotchas found so far

- **Classic scripts share one global scope.** New top-level `const`/`function` names in frontend files must not collide. `seasons.js` uses `SEASON_*` prefixes. Wrap new files in an IIFE and expose only one `window.KW…` name, as `server-clock.js` does.
- **Loading `seasons.js` in a vm sandbox** needs `document.addEventListener` and `querySelectorAll` stubs. See `scripts/season_cutover_test.js`.
- **The shallow clones have narrow fetch refspecs.** Use `git push -u origin feat/021-server-time` so the branch tracks its remote.
- **Bump `?v=` on every changed script or CSS tag** in `index.html`. Current tags:
  - `seasons.js?v=021c`
  - `day-cycle.js?v=021a`
  - `server-clock.js?v=021a`

## 6. Next step

Start **Phase 3** (spec §3 plus decisions 10–14 above). Its acceptance gate is in the spec. For the visual check, you can't take real screenshots of the logged-in game, so list exactly what Scar should check with the 🕯 Time tab: dawn, day, dusk, night, full moon and new moon, in both renderers. `verify/iso_demo.html` is the no-backend visual harness if you can run a headless browser.
