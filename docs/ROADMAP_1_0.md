# Kindlewood 1.0 — plan (cosy generational sim, PvE first)

Status: **proposal for review**, written 2026-11-10. Nothing in here is built yet.
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

### Phase 0 — Foundations (small)
- **Bundle the frontend** into a few files with a build step, and deploy it automatically (§7).
- **Keep the API awake** (§7).
- **Remove the fallback JWT secret** in four server files, so the server refuses to start without one. Render already generates a real secret, so this only closes the gap.
- **Add funnel logging** (§6.1), so later decisions use real numbers.

### Phase 1 — The life cycle (the heart of 1.0)
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

### Phase 4 — Consolidation
- The five-place navigation (§3.3) on desktop and phone.
- Automatic carters at outposts; the outpost window keeps its tabs but the default state needs no attention.
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

**Hosting.** The repo's `render.yaml` sets the API to `plan: free`, which is the tier that sleeps after about 15 minutes idle. If you are paying Render, it is probably for the database, or the dashboard was changed without the file. Moving the web service to Render's cheapest always-on tier (Starter) stops the sleeping. Please check the Render dashboard for which service is on which plan and the current price; I can then update `render.yaml` to match.

**Bundling.** Today the page loads about 130 separate files, which is what the cPanel host choked on. The change:

- A small build script joins and minifies them into about three files, named by their content so browsers always fetch the right version.
- A GitHub Action runs on every merge to `main`: it runs the proofs, builds, and uploads to cPanel over FTP.
- What that means day to day:
  - no more manual uploads;
  - no more `?v=` bumping or the version manifest;
  - no more "some of the game didn't arrive".
- You would need to add the cPanel FTP login to the repo's GitHub secrets once.
- Development stays as it is (plain files, no build needed to test locally).

## 8. How we'll know it's working

- More than half of new players reach their first quest reward in session one.
- Second-day return rate rises after Phase 3 (baseline from §6.1).
- A returning player's first action is a moment, not a chore.
- A player who has played three weeks can name a citizen and say something that happened to them.

## 9. Decisions I need from you

1. **Pace of a life.** Is "a child grows up in about 11 real days, a starting adult lives roughly 4–6 weeks" right, or should lives be longer or shorter?
2. **Death.** Should citizens die of old age at all (my recommendation, with memorials and inheritance), or only retire?
3. **Automatic carters.** Are you happy to soften the outpost porter rule so untended outposts still trickle goods home?
4. **Navigation.** Is the five-place layout acceptable, given it moves familiar buttons?
5. **Guide character.** One elder per species, or a single shared narrator?
6. **Order.** I recommend Phase 0, then 1, then 3 (onboarding) before 2 if you want new players soon. Otherwise as numbered.
