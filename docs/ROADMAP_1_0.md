# Kindlewood 1.0 — plan (cosy generational sim, PvE first)

Status: **agreed 2026-11-10** (decisions in §9). **Phase 0 is built**; everything else is still to do.
The same file is in both repos (`docs/ROADMAP_1_0.md`).

## 1. The game in one sentence

> **Raise a woodland family line through the seasons.**

Three pillars. Every feature must serve at least one, or it waits.

1. **Families, not workers.** The player cares about named citizens, their households and their children.
2. **The year turns.** Seasons, ageing and generations give time a shape; coming back after a day away should feel like reading the next chapter.
3. **Gentle stakes.** Things can go wrong (a hard winter, a raid, a lost scout), but the game never punishes being away.

## 2. A finding that changes the order of work

**Time does not pass for citizens today.** I searched both repos for it:

- A citizen's age is a fixed number stored at birth (`life.age`); nothing ever increases it.
- Children are born with `life_stage = 'child'`, and no code ever turns a child into an adult.
- Nobody dies of old age. The only deaths are famine and about 2% of combat injuries.
- The "Elderly" count in the settlement panel has no code that ever makes a citizen elderly.

So the game has births, bonds and partnerships, but no generations. A baby born on day one is still a baby a year later. This is the single biggest gap between the game and its pitch, so the life cycle is Phase 1.

## 3. How the systems knit together

### 3.1 The rule

**Every system takes a citizen in and gives a story back.** A system that only takes resources and returns resources gets folded into another one or automated.

| System | Citizen in | Story back |
|---|---|---|
| Jobs and careers | who works where | skills, titles, traits revealed, a trade to hand down |
| Quests and battles | who you risk | loot, scars, bonds between party members, a tale in the family record |
| Outposts | who lives out there | finds, events, a child born at the farmstead |
| Crafting | who makes it | a maker's mark; heirlooms |
| Market and villages | who carries it | friendships with villages, marriages from outside |
| Raids | who stands guard | heroes, wounds, memorials |
| Research | who studies | a named discovery ("Hazel's Deep Veins") |

### 3.2 Three loops

- **A visit (5–10 minutes):** read what happened, answer one to three **moments** (§5.2), set who does what, send someone somewhere.
- **A season (7 hours):** each season has one job. Spring is planting and births, summer is travel and building, autumn is harvest and festival, winter is hardship and stories. At each turn the player makes one seasonal choice.
- **A generation (weeks):** children grow up, learn a trade from a parent or mentor, inherit a house and heirlooms, and the elders retire and die. The family record grows.

### 3.3 Five places instead of 25 systems

The top-level navigation shrinks to five places. Everything else lives inside one of them and appears only once it is unlocked.

| Place | What's inside |
|---|---|
| 🏡 **Home** | buildings, tier, stores, crafting, research, festivals, wonders |
| 👪 **Families** | citizens, households, careers, the family tree, the chronicle |
| 🌲 **The Land** | the map, scouting, outposts, roads, raids and defences |
| 🧺 **The Road** | tavern quests, battles and decks, market, villages and diplomacy |
| 🛡 **The Clan** | clan hall, chat, goals, the shared project |

Mail, rankings, help and settings move under the profile menu. Fishing and the two tavern card games stay as places to visit inside Home and The Road.

## 4. Fixing "breadth has outrun depth"

| Consequence I raised | Fix |
|---|---|
| No core activity | Moments (§5.2): a short hand of real choices each visit, drawn from every system. |
| Choices with one right answer | Trade-offs on citizens: the best miner is also the only parent of a newborn; the gifted child wants a different trade. |
| Punishing absence | Every outpost gets a free, slow **carter** who brings goods home on their own. Porters, haulers, roads and mules become ways to speed that up. Stores still cap, so tending is rewarded, never required. |
| Onboarding overload | Progressive unlock (§6.3): a new player sees three buttons, not twelve. |
| Species is cosmetic | One building, one career and one rule-bending trait per species (Phase 5). |
| Combat is a separate game | Battles write to the family: scars, bonds, titles and heirlooms (Phase 2). Deck building stays optional; a default deck follows the party's careers. |
| Clans only give +5% | One shared seasonal project (Phase 6). |

**Freeze list** (no new work until after 1.0): outpost specialisations, new resources, new minigames, new building types, new market features.

## 5. Phases

Each phase is one or two rounds of work in the style used so far, with tests. The order matters: later phases lean on earlier ones.

**Agreed order:** 0 → 1 → 2 → 4 → 3 → 5 → 6. Consolidation (4) comes before onboarding (3) so the guide is written once, for the final layout.

### Phase 0 — Foundations (built 2026-11-10)
- **Bundle the frontend** into a few files with a build step, and deploy it automatically (§7).
- **Keep the API awake** (§7).
- **Remove the fallback JWT secret** in four server files, so the server refuses to start without one. Render already generates a real secret, so this only closes the gap.
- **Add funnel logging** (§6.1), so later decisions use real numbers.

### Phase 1 — The life cycle (the heart of 1.0)
**The build spec is `docs/PHASE_1_LIFE_CYCLE.md`.** It supersedes the outline below where they differ. The assessment behind it found that births cannot happen in the live game and that no ordinary player can grow past a Camp; both are fixed by its first step. It also recommends a slower life pace than the one in §9, which is waiting on the owner's choice.

- **Ageing:** age is worked out from `born_at`. One game year is 28 real hours, as now.
- **Life stages** (proposed, tunable):

  | Stage | Age | Real time |
  |---|---|---|
  | Child | 0–5 | about 6 days |
  | Youth (apprentice, half output) | 6–9 | about 5 days |
  | Adult | 10–44 | about 41 days |
  | Elder | 45+ | until death |

- **Elders** work at reduced output but teach: an elder in a trade speeds up youths learning it.
- **Natural death** is a rising chance from about 50, softened by health, happiness and the Long-lived trait. Deaths are announced gently, with a memorial entry.
- **Starting citizens** keep their current ages (16–28), so the first elders appear after roughly three weeks.
- **Households and family names:** each house is a family line with a name, a head and a hearth. Children belong to it; marriages join or found lines.
- **Inheritance:** when someone dies, their house, their best tool or weapon (now an **heirloom** with their name on it) and one learned trait pass to an heir the player chooses.
- **Apprenticeship:** at age 6 the player chooses a trade for the youth. A parent or mentor in that trade gives a head start; the youth's hidden aptitudes may pull another way (a moment).
- **The chronicle:** a readable family record per line, written from events that already exist (births, bonds, quests, raids, discoveries).
- **Population balance:** birth rates, housing caps and food upkeep are re-tuned so a town neither dies out nor overflows.

### Phase 2 — Moments (one decision system for everything)
**The build spec is `docs/PHASE_2_MOMENTS.md`**, with the engine design and the first thirty moments.

- The outpost events system (`lib/outpost_events.js`) becomes the general **moments** engine: a situation, two or three options, a named citizen involved, a visible consequence.
- **Sources** of moments:
  - family: a proposal, a quarrel, a child's wish, an elder's last request
  - season turns: one choice per season
  - quests and battles: who to send, what to do with a find
  - villages, outposts and raids
- **Limits:** three to five open at once, each with a default after 12–24 hours, so nothing is lost by being away.
- **Delivery:** moments appear in the away report and as a small stack on the main screen. This becomes the first thing a returning player does.
- Battles, crafting and research start writing to the chronicle (scars, maker's marks, named discoveries).

### Phase 3 — Onboarding and the guide (§6)

### Phase 4 — Consolidation and the layout rework
**The build spec is `docs/LAYOUT_SPEC.md`.** Its window component is needed from Phase 1.

- The layout rework list in §10.
- The five-place navigation (§3.3) on desktop and phone.
- The outpost trim in `docs/OUTPOST_TRIM.md` (the carter itself was built in Phase 0).
- Remove or merge small duplicate screens (Journeys folds into The Land; Stores into Home).
- A pacing pass on tier costs using the funnel numbers. The target is a Village in the first two or three sessions.

### Phase 5 — Species identity
One unique building, one unique career and one rule-bending trait each. First proposals, to be tuned:

| Species | Building | Career | Trait |
|---|---|---|---|
| Mice | Nursery | Midwife | larger families, faster apprenticeships |
| Badgers | Sett Hall | Warden | walls cost less; raids on the town lose 25% strength |
| Otters | Holt Wharf | Ferryman | river tiles count as roads; fishing feeds trade |
| Moles | Deep Warren | Delver | outposts on hills and mountains need no food upkeep |
| Foxes | Den Lookout | Pathfinder | see raids twice as early; scouts move faster |
| Hares | Meadow Course | Runner | messages, calls to arms and porters travel faster |

Multi-species towns stay out of 1.0. To keep that door open, species will be read from each citizen and never from the account.

### Phase 6 — The clan project
- Each season a clan picks one **shared work**: a Great Hall, a beacon chain, a bridge, or holding a **Withered advance** back from clan land.
- Members contribute goods, porters and guards; progress shows on the map; finishing it changes the map for everyone in the clan and is recorded in each family's chronicle.
- Existing boons, goals and Signal Towers feed into it instead of standing alone.

### After 1.0
- Outpost specialisations, cut down to three or four charters and two new resources.
- The multi-species expansion.
- **PvP worlds.** The cheap guardrail now: a settlement belongs to a **world** with a rule set, and raid and defence code takes "an attacker", never "the Withered" specifically. That costs little today and avoids a rewrite later.

## 6. Onboarding plan

### 6.1 Measure first
Log one row when a player first reaches each step, so the drop-off is visible:

registered → placed a town → first building → first job change → first quest sent → first quest collected → first outpost → first birth → second-day return → Village → seventh-day return.

Then run five to ten watched first sessions (friends, a Discord call) before and after the tutorial ships. Watch where they stop, not what they say.

### 6.2 The first hour, scripted
The target for session one is three payoffs within 15 minutes: **build something, send someone on a quest, and meet a family.**

1. Arrival: the guide greets the player by their town's name.
2. Build a Lumber Camp (the build finishes at once, this one time).
3. Give a forager a new job; the guide names the citizen and mentions their partner.
4. Send a named citizen on a short first quest (two minutes); collect the loot.
5. Open that citizen's family; the guide points out a child on the way or an eligible pair.
6. First moment: a small choice with a visible result.
7. The guide says goodbye for now, and tells the player what will have happened by tomorrow.

Later beats arrive when they become relevant: the first season turn, the first birth, the Scout Post, the first outpost, the first raid warning, joining a clan.

### 6.3 Progressive unlock
A new town shows only Home, Families and The Land. A button appears, with a one-line introduction from the guide, when its building or tier exists: The Road with the Tavern, the Market with a Market, The Clan with a Guild Hall. Nothing is locked from experienced players who skip the guide.

### 6.4 The guide (the dialogue system from your screenshot)
- **Who:** an elder of the player's species, named and with a little personality. The species art already in `/assets` (`mouse.png`, `fox.png` and the left/right sprites) serves as the portrait until proper portraits exist.
- **Look:** a portrait at the lower left, overlapping a dialogue box across the bottom of the map, with the speaker's name, a line or two of text and a "next" arrow. The map stays visible behind it.
- **Pointing:** the thing to press is spotlit (the rest dims slightly) with a pulsing ring, and the guide waits until the player does it.
- **How it's built:** one module (`js/guide.js`) driven by a script of steps in data. Each step has the lines, the target to highlight, and the game event that completes it.
- **Progress** is stored on the server, so it survives a reload and follows the player to their phone.
- **Controls:** tap or Enter to advance, "Skip the tour" at any time, and "Replay" in Help. It works with keyboard and screen readers, and is full width on phones.
- **Replaces** the current first-steps checklist, which becomes the guide's "what next?" list.
- The same dialogue box is reused for moments, season turns and village envoys, so the game speaks with one voice.

## 7. Bundling and hosting — what changes for you

**Hosting (checked against the October 2026 bill).** The API is on Render's **Starter** plan ($7 a month, 0.5 CPU, 512 MB) and the database on **Basic-256mb** ($6.30 a month). Starter does not sleep, so the "server waking up" screen should now only appear during a deploy. `render.yaml` said `plan: free`; it now says `starter` to match.

What this means going forward:
- **Now:** nothing to change. This is the right size for a beta.
- **First limit you'll hit:** the database (256 MB memory, 1 GB disk), well before the API. Watch disk use in the Render dashboard; the next tier up is the fix.
- **Second limit:** the API's 512 MB memory, once there are a few hundred players online at once. Signs are slow responses and restarts.
- The worker tick visits every settlement with outposts about once a minute. That is fine for hundreds of towns; at thousands it should move to "only towns with something due", which is a known, contained change.

**Bundling (built in Phase 0).** The page used to load 132 separate files, which is what the cPanel host choked on. Now:

- `npm run build` makes the site in `dist/`: three script bundles, one stylesheet and the small config file. In a side-by-side browser test the bundled site made **5 requests instead of 132**, with identical behaviour and styling on desktop and phone.
- File names carry a hash of their contents, so browsers keep them for a year and still pick up every change. The `?v=` bumping and the version manifest are retired.
- `.github/workflows/deploy.yml` runs on every merge to `main`: proofs, build, then upload `dist/` to cPanel over FTP. It never deletes other files on the host, and `/assets` stays as it is.
- **One-time setup for you:** add `FTP_SERVER`, `FTP_USERNAME` and `FTP_PASSWORD` (and optionally `FTP_DIR`) under the frontend repo's Settings → Secrets and variables → Actions. Until then the upload step is skipped and the built site is attached to each run as a download.
- Development stays as it is: plain files, no build needed to test locally.
- **Is it better for scale?** Yes. The 503s came from the number of requests per visitor, which is now 96% lower, and the files are minified. The longer-term step, if traffic grows, is to put the site behind a CDN, which this layout is ready for.

## 8. How we'll know it's working

- More than half of new players reach their first quest reward in session one.
- Second-day return rate rises after Phase 3 (baseline from §6.1).
- A returning player's first action is a moment, not a chore.
- A player who has played three weeks can name a citizen and say something that happened to them.

## 9. Decisions made (2026-11-10)

1. **Pace of a life:** the slower pace in `docs/PHASE_1_LIFE_CYCLE.md` §2 (changed 2026-11-12): grown up at 14 real days, about 8 weeks as a working adult, a life of about 3 months.
2. **Death:** citizens die of old age, with memorials and inheritance.
3. **Outposts:** goods **trickle** home on their own; no shipments needed. Porters, haulers and roads only speed it up.
4. **Navigation:** the five-place layout, plus a general layout rework (§10).
5. **Guide:** one elder per species.
6. **Order:** the most logical route (see §5). The game is in beta, so there is no rush for new players.
7. **PvP:** optional PvP worlds, well after 1.0. Multi-species towns are a later expansion.
8. **Heirlooms** carry a small bonus within the family (+5%, up to +10% over generations).
9. **Phase 1 step 1** (the two live bugs) ships first, on its own.

## 10. Layout review and rework list

Reviewed from fresh screenshots (desktop 1400×900 and phone 390×844) and from the stylesheets.

### What works
- The **painted settlement scene** (Manage Settlement) is the best-looking screen in the game.
- The **map** has character: parchment, nameplates, paths and fireworks.
- The **phone tab bar** is the right idea and already groups things under More.
- The top bar's resource strip, season badge and clock read well on desktop.

### What doesn't

| # | Problem | Evidence |
|---|---|---|
| 1 | The **community bar** is 13 equal-weight buttons mixing play (Quests, Market), social (Clan, Chat, Messages, Online) and meta (Rankings, Feedback). | Two icon styles side by side: line glyphs and emoji. |
| 2 | The **sidebar** opens on a tier card about 450px tall, so status and actions start below the fold on a 900px screen. | The first-steps list and an 11-button action grid sit under it; several of those buttons repeat the community bar. |
| 3 | The **best screen is hidden.** The settlement scene is one button among eleven in the sidebar; the game opens on the map instead. | — |
| 4 | **Three places for news:** the bell, the Events button and the away report. | — |
| 5 | **Every window is its own design.** | 32 different close-button classes, 127 button classes, 79 full-screen overlay rules, 69 distinct z-index values (the highest is over two billion). |
| 6 | **No shared palette or type scale.** | 598 distinct colours, 698 uses of `!important`, a single 11,756-line `main.css`, 121 inline styles in `index.html`. |
| 7 | **Phone top bar clips.** The fourth resource is cut off ("1,33") and wealth is not visible at all. | Screenshot at 390px. |
| 8 | **Phone floating buttons overlap.** The compass and settlement buttons sit on top of the Paths button; the joystick covers map tiles. | Screenshot at 390px. |
| 9 | **Dev Tools ships to every player.** About 700 lines of admin markup are in `index.html`. | — |
| 10 | The top bar shows a version string in the middle of the play area. | — |

### Rework list (in order)

1. **Five-place navigation** replaces the community bar and the sidebar tabs (§3.3). Social and meta items move under the profile menu, with unread dots carried up to it.
2. **Home opens on the settlement scene.** The map becomes The Land. The scene gains the things you'd expect to find there: citizens walking about, a notice of what's being built, the family houses.
3. **The sidebar becomes a context panel.** It shows whatever is selected (a tile, a building, a citizen, an outpost) and nothing else. The tier card shrinks to a header strip.
4. **One window component** with three sizes and a full-screen phone mode: one header, one close button, one tab style, one scroll area. New screens (Families, moments, the guide) are built on it first; old windows move across as they are touched.
5. **One place for news:** the bell opens the chronicle, with moments at the top. The Events button and the separate events panel go.
6. **Top bar:** drop the version string; add a "more stores" chip beside the five basic resources; on phones, two short rows or a swipeable strip so nothing is clipped.
7. **Phone map controls:** one stack of floating buttons that never overlaps, and an option to hide the joystick (drag to pan already works).
8. **Design tokens:** a small set of named colours, spacing steps, type sizes and z-index layers. `main.css` is split by area; `!important` is removed as each area is touched.
9. **One icon family** for navigation and actions (the line icons already used for resources); emoji stay for flavour text only.
10. **Dev Tools moves to its own page**, loaded only for admins.

Items 1–3 and 5–7 are Phase 4. Item 4 starts in Phase 1 (the Families screens are new, so they are built on the new component). Items 8–10 happen alongside, a piece at a time.
