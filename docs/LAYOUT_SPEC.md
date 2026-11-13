# Layout rework — navigation and the window component (build spec)

Status: **§3 and §4 built (2026-11-13)**; the rest ready to build. Written 2026-11-12. It turns the rework list in `docs/ROADMAP_1_0.md` §10 into a concrete design.
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
| Phase 1 | Families (new), the citizen profile, confirms and alerts |
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
