# Layout rework — navigation and the window component (build spec)

Status: **§3 and §4 built (2026-11-13); §2 steps 1–2, the five places and the context panel, built (2026-11-13)**; the rest of §2 ready to build (see §2.8). Written 2026-11-12. It turns the rework list in `docs/ROADMAP_1_0.md` §10 into a concrete design.
The window component (§3) is needed from **Phase 1**, for the new Families screens. The navigation change (§2) is **Phase 4**.

## 1. Principles

1. **One of everything:** one window, one button set, one tab style, one close button, one palette. Today there are 32 close-button classes, 127 button classes and 598 distinct colours.
2. **New work first, old work as it is touched.** Nothing is rewritten for its own sake. Each old window moves to the new component when a phase changes it.
3. **Build on what exists.** `css/hud-storybook.css` already defines a palette (`--kw-ink`, `--kw-wood`, `--kw-gold`, `--kw-cream`…) and `index.html` has a sprite of 14 line icons (`#kw-i-…`). Both become the standard.
4. **Phone and desktop from the same markup.** A window is a centred card on desktop and a full-screen sheet on a phone, with no per-window phone CSS.

## 2. Navigation: five places

### 2.1 What replaces what

| Today | After |
|---|---|
| Community bar (13 buttons) | A **place bar** with 5 buttons |
| Sidebar tabs (Settlement, Citizens, Outposts) | Gone. The sidebar becomes a context panel (§2.4). |
| Sidebar's 11-button action grid | Gone. Each action lives inside its place. |
| Phone tab bar (Map, Settlement, Citizens, Battles, More) | The same 5 places |
| Bell, Events button, events panel | The bell only (§2.5) |

### 2.2 The five places and what is inside each

| Place | Opens on | Inside (as tabs or buttons within it) |
|---|---|---|
| 🏡 **Home** | the painted settlement scene | Build · Stores · Crafting · Research · Festival · Wonders · Tier · Tavern games · Fishing |
| 👪 **Families** | family cards | Citizens (the list) · Family trees · Chronicle · Careers |
| 🌲 **The Land** | the world map | Outposts · Scouting · Journeys · Raids and defences |
| 🧺 **The Road** | the notice board | Quests · Battles · Decks · Market · Villages |
| 🛡 **The Clan** | the clan hall | Members · Chat · Goals · Treasury · the shared project |

Under the **profile menu** (top right): Messages, Rankings, Online, Help, Feedback, Settings, Sign out. Unread dots on Messages and Chat also light a dot on the profile button or the Clan place.

### 2.3 Behaviour

- **Home and The Land are full-screen views**, not windows: the scene and the map. Switching between them is instant and keeps each one's state.
- **Families, The Road and The Clan are large windows** (§3, size L) over whichever view is showing.
- The game **opens on Home**. A new player's first sight is their town, not a mostly fogged map.
- A place **appears when it is unlocked** (roadmap §6.3): Home, Families and The Land from the start; The Road with the Tavern; The Clan with a Guild Hall. Before then its button is absent, not greyed.
- The current place is marked in the bar; keyboard shortcuts 1–5.
- The address bar gets a hash per place (`#home`, `#families/tree/12`), so the back button and links work.

### 2.4 The context panel (replaces the sidebar)

- It shows **only what is selected**: a tile, a building, a citizen, an outpost, a traveller.
- Nothing selected means no panel: the view uses the full width. On Home it can show the town summary instead.
- The tier card's art shrinks to a 72px header strip with the town's name and tier.
- On phones it is the bottom sheet that exists today.

### 2.5 One place for news

The bell opens a single list: open moments first, then the chronicle (newest first), with a filter for "raids", "family", "trade". The Events button and the separate events panel are removed. Timed world events (Happenings) get a line in the season badge's pop-up, where the clock already lives.

### 2.6 Top bar

- Left: the five basic resources, then a **⛏ +N** chip that opens Stores.
- Right: season badge, clock, bell, profile.
- The version string moves into Settings.
- Phones: resources sit in one row that scrolls sideways, with wealth pinned at the end so it is always visible.

### 2.7 Phone map controls

One vertical stack at the lower right (centre on town, paths, zoom if added), never overlapping. The joystick becomes an option in Settings, off by default: dragging already pans.

### 2.8 Build order and what was built

**The target is `docs/LAYOUT_MOCKUP.pdf`** (Fable, 2026-11-13): Home, The Land, Families on desktop, and Home on a phone. What it shows, by step:
- the places as a centred row, the one on screen underlined; the view's tools as chips at its top left (Build · Stores · Crafting · Research · Festival · Tavern on Home; Map · Outposts 2/2 · Journeys 1 · Defences on The Land): **step 1**;
- the panel on the right: on Home the town's summary (name, tier, species, beds; children, youths, adults, elders; what is going up; today's chronicle lines), on The Land whatever is selected (an outpost here): **step 2**;
- the bell with a count, and moments as the dialogue box with a portrait and two choices: **step 3** (the dialogue box itself is built, Phase 2);
- the top bar: the five resources with their rates, a "+7 in Stores" chip, the season and the time of day; on phones two rows, wealth always visible: **step 4**;
- the map's own controls, "Centre on town" and "Paths: on", as a stack at the lower left: **step 4**.

Phase 4 is built a step at a time, each one shippable:

1. **The five places** (built 2026-11-13; below).
2. **The context panel** (§2.4; built 2026-11-13, below): the sidebar shows only what is selected; the tier card becomes a header strip; the sidebar tabs and the 11-button action grid go (each action already has a place); Home's town card.
3. **One place for news** (§2.5): the bell opens moments and the chronicle with filters; the Events button and panel go; Happenings move to the season badge's pop-up.
4. **The top bar and phone map controls** (§2.6, §2.7): the version string into Settings, a stores chip, a sideways-scrolling resource row on phones with wealth pinned; one stack of floating map buttons; the joystick an option in Settings, off by default.
5. **Dev Tools on its own page** (§6), loaded only for admins.
6. **Merging the small duplicates and the outpost trim** (`docs/OUTPOST_TRIM.md`): Journeys into The Land, the old Stores into Home, then the trim itself.
7. Windows move onto `KWWindow` as each step touches them (§5).

The tier pacing pass in the roadmap needs the funnel numbers from real play, so it waits, like the moments budget tuning.

**Step 1, the five places (`js/places.js` `KWPlaces`, `css/places.css`):**
- **A place bar** replaces the community bar on desktop (a centred row, the place on screen underlined, as in the mockup), and is the tab bar on phones (the phone shell no longer builds its own). Each place has a line icon (five added to the sprite), a label and an unread dot. Keys 1–5, and `#home`, `#families`, `#land`, `#road`, `#clan` in the address, so back and forward work.
- **Home** is the painted settlement scene. The game opens on it once the player presses Start playing, or on the address's place. Its tools (Stores, Upgrade, Tavern, Fishing, then Research, Crafting, Festival and Wonders when unlocked) are chips at the top left of the scene, on desktop and phones, as in the mockup. They live on the game screen, outside the place row, whose own layer would keep them under the scene.
  - The scene's back button and title are hidden (the places do that). Its Town / Outskirts and Edit sit under the chips, and so do the moment cards on desktop. The scene is a view, not an overlay, and on phones it stops above the places.
  - "Build" in the mockup is the scene itself (its plots); a Build chip comes with the build list in a later step.
  - The tavern and the fishing post open over the map, so their tools leave the scene first.
- **The Land** is the map. Its tools: Scout, Outposts, Journeys, Centre, as chips; the old floating Scout and Centre buttons on phones are hidden.
- **The Road** and **The Clan** are hub windows (size M), each entry opening the screen it always had: Quests, Battles, Decks and Market; the clan hall and Chat. Villages has no screen of its own yet, so it is not listed.
- **Families** opens the Families window.
- **The profile menu** takes Messages, Rankings, Online (with the count), World events and Feedback. Unread messages light the profile button. "Your Kingdom" is gone: it is Home.
- **Dots:**
  - the old community-bar buttons stay in the page, hidden, because features light their dots there;
  - the places read them: a waiting battle lights The Road, a clan request The Clan;
  - `KWShell.syncBadges()` and a watcher on the old buttons keep the dots current.
- A one-time note, "Where things moved", on first sight.
- **Fixed after the first look on a phone:** the bell broke the layout. Its list and the profile menu opened under the Home scene: the phone top bar is its own layer (40), the scene 800. While one of its drop-downs is open the top bar now rises above it. Closing the bell also left the page marked "covered", hiding the places: the panel fades out, so it still read as visible when its class changed. The phone shell now checks again when a fade ends.
- `KWWindow` now announces `kww:open` and `kww:close`, so the marker follows windows opened from anywhere.
- **Changes from §2.3:** places don't appear on unlock yet. The Road and The Clan show from the start, because hiding Quests until a Tavern exists would change the game for current players. Unlock pacing belongs to Phase 3 (onboarding), where the first hour is designed.
- Tests:
  - `verify/nav_proofs.js` (36 checks); the style check now covers `css/places.css`;
  - a browser pass at 1400×900, 390×844 and 844×390 against a local API (55 checks; scratch script): opening on Home, every place by click and key, back and forward, Escape, a hub entry, the Stores and Tavern tools on top, the chips placed under the bars, the profile menu, the bell's list on top and the places back after it closes, the old bar hidden, no page errors.

**Step 2, the context panel and the town card (`js/context.js` `KWContext`, `css/context.css`):**
- **Desktop: the sidebar is a panel floating at the right of the view**, as in the mockup.
  - It shows only what the player chose: a tile or fog on the map, the outposts list (The Land's Outposts chip), the build list (Home's new Build chip), the tier.
  - It closes with ✕ or Escape, and when switching place. With nothing chosen the map has the whole width.
  - The game's own calls never open it (boot, refreshes, going to The Land re-selecting the home tile). It opens only within 1.5 seconds of the player's own click, tap or key. Other scripts also wrap `selectWorldTile` and `switchTab`, so the panel wraps them last, when the game starts and on each place switch.
  - It moved out of the game body. That body is its own layer (5, over the decorative guards), which kept the panel under the Home scene. Phone and desktop rules both key off `#screen-game`, so nothing else moved.
- **Phones keep their bottom sheet**, now above the Home scene when open.
- **Gone:**
  - the sidebar's tabs (Settlement, Citizens, Outposts, Build: each has a place or a chip);
  - the 11-button grid on your own town;
  - the old map action bar (Scout, Build, Citizens, Centre: chips).
- **The tier card shrinks to a header strip**: the tier's emoji, the town's name and tier, and Upgrade on your own town.
- **Home's town card**, top right of the scene with no panel open (a Town chip opens it as a window on phones):
  - the name, tier, species and beds;
  - children, youths, adults and elders;
  - happiness and food;
  - **first steps** (moved here from the panel);
  - **under way**: a raid coming, outpost buildings going up, citizens on quests;
  - **today**: the latest three chronicle lines;
  - a link to the families and the whole chronicle.
- **Change from the mockup:** its "Going up" lists town buildings under construction, but town buildings finish instantly; there are no construction timers. "Under way" shows the things that do take time instead.
- Tests:
  - `verify/context_proofs.js` (20 checks); the style check covers `css/context.css`;
  - the browser pass adds 18 checks (73 in all, at the three sizes): the card on Home, Build in the panel with the card stepping aside, ✕ and Escape, no panel on going to The Land, the map's full width, a real map click opening the panel, your town as a strip without the grid, Outposts in the panel, the phone Town window and Build sheet.

## 3. The window component

### 3.1 What it is

`js/window.js` exposes `KWWindow`; `css/window.css` styles it. It replaces the per-feature overlay code and absorbs `js/dialog.js` (`KWDialog.confirm` and `alert` stay as thin wrappers, so nothing that calls them changes).

```js
const w = KWWindow.open({
  id: 'families',            // one per id; opening again focuses it
  title: 'Families',
  icon: 'families',          // a sprite id, or an emoji for flavour windows
  size: 'L',                 // S 420px · M 680px · L 980px × 720px · full
  tabs: [{ key: 'lines', label: 'Family lines' }, { key: 'tree', label: 'Tree' }],
  tab: 'lines',
  render(body, state) { … }, // called on open, on tab change and on w.refresh()
  onClose() { … },
});
w.refresh(); w.setTab('tree'); w.close();
```

### 3.2 What it guarantees

- **Fixed size per window:** the body scrolls; switching tabs never resizes it. (This replaces `css/modal-sizes.css`.)
- **One header:** icon, title, optional subtitle, optional help "?", one close button with `aria-label="Close"`.
- **Accessibility built in:**
  - `role="dialog"` and `aria-modal`;
  - focus moves in and returns to the opener on close;
  - Tab stays inside the window;
  - Escape closes the top window.

  `js/a11y.js`'s list of overlay ids is no longer needed for windows that use it.
- **Phones:** every size becomes a full-screen sheet below 760px wide or in landscape on a touch screen. The place bar hides behind it, so `mobile-shell.js`'s `watchOverlays` list is no longer needed for these windows either.
- **Stacking:** windows stack in the order opened, in one z-index layer (§4.3). A confirm always sits above its window.
- **Scroll position and tab** are remembered per window id for the session.
- **No inline `onclick`:** windows use `data-action` attributes and one click listener, as `js/outposts.js` does.

### 3.3 Shared pieces inside windows

Small, named, and used everywhere: `kw-btn` (primary, quiet, danger; sizes regular and small), `kw-tabs` (buttons `kw-tabs-item`), `kw-box`, `kw-chip` (with a `short` state for costs you can't afford), `kw-bar` (progress), `kw-list-row` (a list row with an icon, text and an action), `kw-empty`, `kw-note` (good, warn, bad).

**Built with three names changed:** `kw-card`, `kw-tab`, `kw-row` and `kw-item` already belong to the battle cards, the phone tab bar and the sidebar, so the pieces are `kw-box`, `kw-tabs-item` and `kw-list-row`.

### 3.3a What was built (2026-11-13)

- `css/tokens.css` (loaded first) holds the palette, moved from `hud-storybook.css`, plus the new roles, the type and space scales and the seven layers. Windows sit at 100200, above every old overlay (old screens go up to 100030). Confirms are at 100400; they were at 100000, below Help.
- `js/window.js` and `css/window.css` implement §3.1–3.3.
- `KWDialog` keeps its own code: it already met §3.2 and has its proofs. It now sits in the confirm layer and gives way to windows correctly. Absorbing it fully can wait until its look moves to tokens.
- Old overlays are untouched. `a11y.js` stands aside while a window is open, and `mobile-shell.js` treats any open window as an overlay.
- Tests:
  - `verify/window_proofs.js` covers markup, stacking and memory, the CSS sizes and phone sheet, and the style check;
  - `scripts/window_browser_check.js` is the browser pass at the three viewports (45 checks).

### 3.4 The dialogue box

One component, `KWSay`, for the guide, moments and envoys (roadmap §6.4): a portrait at the lower left, a speaker name, up to two lines of text, a "next" arrow or up to three option buttons, and an optional spotlight on a target element. It sits above views and below windows.

## 4. Design tokens

All in a new `css/tokens.css`, loaded first.

### 4.1 Colour
Keep the existing `--kw-*` names and add the few missing roles: `--kw-bad` (errors, raids), `--kw-warn`, `--kw-panel` (window background), `--kw-panel-2` (cards inside windows), `--kw-line` (hairlines). New code uses only these. The target is **under 40 colours** in new and migrated CSS.

### 4.2 Type and space
- Two families, as now: Playfair Display for titles, Crimson Pro for everything else.
- A five-step type scale: 12, 13.5, 15, 18 and 22px.
- A spacing scale of 4, 8, 12, 16 and 24px.
- Touch targets at least 40px on phones.

### 4.3 Layers
Seven named z-index layers replace today's 69 values:

| Token | Use |
|---|---|
| `--z-view` | the scene and the map |
| `--z-hud` | top bar, place bar, context panel |
| `--z-float` | banners, map controls, toasts |
| `--z-say` | the dialogue box |
| `--z-window` | windows |
| `--z-confirm` | confirms and alerts |
| `--z-system` | the loading screen and load-failure banner |

### 4.4 Icons
Navigation and actions use the line-icon sprite. It needs about 12 more icons (the five places, close, help, back, settings, profile, bell, search). Emoji stay in flavour text, resource chips and moment cards.

## 5. Migration order

| When | What moves to `KWWindow` |
|---|---|
| Phase 1 | Families (new, built), the memorial notice (new, built), confirms and alerts (moved to the confirm layer). **The citizen profile moves in Phase 4 instead** (decided 2026-11-13: large, many proofs, not needed for the release). |
| Phase 2 | Moments and the dialogue box (new), the away report, the bell list |
| Phase 4 | The place bar and context panel; Stores, Crafting, Research, Festival and Wonders into Home; Quests, Battles, Decks, Market and Villages into The Road; the clan panel and chat into The Clan; the outpost window |
| After | Mail, Rankings, Help, Feedback, Settings, tavern games |

When a window moves:

1. Delete its old overlay CSS and its entries in `a11y.js` and `mobile-shell.js`.
2. Replace its colours and sizes with tokens.
3. Update its proofs. Most assert on markup, so expect each migrated window to need its proof file revised.

`main.css` (11,756 lines) is split as areas move: `views.css`, `hud.css`, `map.css`, and the rest deleted with the windows they styled.

## 6. Dev Tools

Move the Dev Tools markup (about 700 lines in `index.html`) into `dev.html` plus `js/dev-tools.js`, loaded only when the server says the player is an admin. It opens as a `KWWindow` of size L.

## 7. Tests

- `verify/window_proofs.js`:
  - sizes;
  - one close button;
  - focus in and out;
  - Escape closes only the top window;
  - a tab change keeps the size;
  - the phone sheet;
  - stacking;
  - `KWDialog` still works.
- `verify/nav_proofs.js`: five places, unlock rules, hash routes, unread dots, nothing from the old community bar left.
- A style check that fails when new CSS uses a raw colour, a raw z-index or `!important`.
- A browser pass at 1400×900, 390×844 and 844×390 for each migrated window (the scratch comparison script from Phase 0 is the model).

## 8. Risks

- **This is the most expensive item in the roadmap.** Doing it window by window keeps each step small and shippable; a single big rewrite would stall everything else.
- **Players lose their bearings.** Ship the place bar with a one-time "where things moved" note, and keep the old keyboard shortcuts working.
- **Two systems side by side for a while.** Accept it; old windows keep working untouched until their turn.
