# Phase 2 — Moments (build spec)

Status: **steps 1–5 built (2026-11-13)**; step 6 (tuning) to come. Written 2026-11-12. Part of `docs/ROADMAP_1_0.md`.

## 1. What a moment is

A small situation about **named citizens**, with two or three options and a consequence the player can see afterwards. Moments are what the player does on each visit: read what happened, answer a few, carry on.

Three rules, all learned from the outpost events built in R6c:

1. **A real trade-off.** If one option is always right, it is a notification, and should be sent as one.
2. **A default that happens by itself.** Every moment names the option that is taken if the player doesn't answer in time. The default is never the worst outcome. Being away costs nothing more than the choice.
3. **It leaves a mark.** The outcome writes a line in the family chronicle (Phase 1) and usually changes a citizen: a trait, a bond, a scar, a trade, a title.

## 2. The engine

Generalise `lib/outpost_events.js` (245 lines) into `lib/moments.js`. The shape stays the same; only the scope widens from "an outpost" to "anything".

### 2.1 Data

Table `moments` (replaces `outpost_events`; the migration copies open rows across):

| Column | Purpose |
|---|---|
| `id`, `settlement_id` | — |
| `kind` | key into the definitions |
| `subject` | JSON: `{ citizen_ids: [], family_id, outpost_id, npc_id }`, whichever apply |
| `data` | JSON fixed when the moment is created: names, amounts, odds |
| `created_at`, `expires_at` | — |
| `resolved_at`, `choice`, `outcome`, `auto` | `auto` is true when the default was taken |

### 2.2 A definition

```js
apprentice_wish: {
  source: 'family', icon: '🎒', title: 'A child\'s wish',
  weight: 3,                       // how often, against others that are eligible
  cooldownDays: 6,                 // per town, for this kind
  expireHours: 24,
  eligible: async (ctx) => …,      // → subject + data, or null if nothing fits right now
  text: d => `…`,                  // one or two sentences, with names
  options: d => [{ key, label, hint }],   // hint: the cost or risk, in a few words
  fallback: 'parents',
  choose: async (key, x) => ({ outcome, chronicle, effects }),   // inside a transaction
}
```

`choose` returns the sentence shown to the player, the chronicle line, and what changed. It never returns "nothing happened".

### 2.3 When moments appear

- **A budget, not a dice roll per system.** Each town gets about **3 a day**, spaced out, and never more than **4 open at once**. This is the main protection against the game turning into an inbox.
- Once an hour the worker asks, for each town under its budget: which kinds are eligible, off cooldown and not a repeat of yesterday's? It picks one by weight.
- **Triggered moments** bypass the roll but still respect the cap: a death needing an heir, a season turning, a quest party returning, a raid warning. If the cap is reached, the default is applied at once and reported in the chronicle.
- A new town gets its **first moment within ten minutes**, hand-picked to be gentle (M1 below).
- Outposts stop rolling their own events; the seven existing ones become ordinary moment kinds with `source: 'outpost'`.

### 2.4 Where the player sees them

- A small **stack of cards** on the Home screen, and at the top of the bell's list.
- First item in the **away report** ("3 things are waiting for you").
- The **dialogue box** from the guide (roadmap §6.4) presents each one: the citizen's portrait on the left, the text, the options as buttons with their hints.
- After choosing, the outcome replaces the options for a few seconds and the card folds into the chronicle.
- Phones: the same card as a bottom sheet.

### 2.5 API

| Route | Purpose |
|---|---|
| `GET /api/moments` | open moments, soonest to expire first |
| `POST /api/moments/:id { choice }` | answer one; returns the outcome and what changed |
| `GET /api/moments/recent` | the last 20 resolved, for the chronicle view |
| `POST /api/moments/admin/start { kind }` | Dev Tools |

Live event `moment` (new) and `moment_resolved` (when the default fires while the player is online).

## 3. The first set of moments

Thirty, across six sources. Each line gives the options; **bold** marks the default. "→" is the consequence.

### Family (needs Phase 1)

| # | Moment | Options |
|---|---|---|
| M1 | **A name for the baby.** A couple can't agree. | **Her mother's name** → the grandmother gains happiness · His old friend's name → the two men's bond rises · Let the town choose → a small festival mood for a day |
| M2 | **A child's wish.** A youth of 7 wants a different trade from their parent's. | **Follow the parent** → learns faster (mentor at home), unhappy for a while · Follow the wish → learns slower, a good chance of revealing a hidden aptitude |
| M3 | **A proposal across families.** Two citizens want to marry; one's family objects. | **Give your blessing** → the couple forms, the objecting elder loses happiness · Ask them to wait a season → the elder is content, the pair may drift apart |
| M4 | **An elder's last request.** A dying elder asks for something. | **Grant it** (a feast, 150 food) → the family gains a lasting happiness bonus · Decline gently → nothing spent, the heir starts with a small sadness |
| M5 | **Who inherits?** Two children, one heirloom. | **The eldest** → tradition; the younger is put out · The one who works that trade → the heirloom's bonus applies now; the eldest resents it for a while |
| M6 | **A quarrel between neighbours.** Two housemates fall out. | **Let it blow over** → their bond drops · Move one to another house → bond kept, the mover is unhoused or displaces someone · Sit them down (a Charming citizen) → bond rises, that citizen is busy for a day |
| M7 | **A settler at the gate.** A stranger asks to stay. | **Welcome them** → a new adult and a new family line · Welcome them if they'll work the outpost → they go straight to a post, less happy · Turn them away → nothing |
| M8 | **A gifted child.** A youth shows unusual talent. | **Let them be a child** → happier, the trait shows itself later · Start their training early → comes of age with more skill, less happy as an adult |

### The year

| # | Moment | Options |
|---|---|---|
| M9 | **Spring: what to plant.** | **The usual fields** → normal harvest · Flax and herbs → less food, more wealth in autumn · Leave a field fallow → less this year, more next spring |
| M10 | **Summer: the long days.** | **Rest in the evenings** → happiness up · Work late → production up for the season, a small injury risk · Send the young ones exploring → a free scouting reveal, a small chance one gets lost for a day |
| M11 | **Autumn: the harvest feast.** | **A modest supper** → nothing spent · A proper feast (food and wealth) → happiness and bonds up, births more likely in spring |
| M12 | **Winter: short stores.** (only when food is low) | **Ration evenly** → everyone a little hungry · Feed the children and workers first → elders weaken · Buy grain from the village (wealth) → nothing lost |
| M13 | **Winter: stories by the fire.** | **The old tales** → children gain a little XP toward a random trade · Tales of the founders → one founder's family gains happiness · Ghost stories → bonds between youths rise, one child is frightened for a while |

### Quests and the road

| # | Moment | Options |
|---|---|---|
| M14 | **A find on the road.** The party found something. | **Bring it home** → an item for the stores · Give it to the one who found it → theirs to equip, bond with the party rises · Sell it in the next village → wealth, trust with that village |
| M15 | **A wounded stranger.** | **Carry them home** → the quest takes longer; they may become a settler · Leave supplies and go on → quest on time, the party's kindest member is troubled |
| M16 | **A rival party.** Another town's party wants the same prize. | **Share it** → half the reward, trust with their village · Race them → full reward or none · Let them have it → no reward, a favour owed later |
| M17 | **The one who froze.** A citizen panicked in a fight. | **Say nothing** → they recover on their own, slowly · Send them out again soon → may overcome it (gains a brave trait) or lose heart (won't fight for a season) · Give them work at home → safe; they never become a fighter |

### Villages

| # | Moment | Options |
|---|---|---|
| M18 | **A village asks for help.** Their harvest failed. | **Send food** (a set amount) → trust up · Send workers for a few days → trust up more, two citizens away · Decline → trust down a little |
| M19 | **An envoy's offer.** A marriage between your town and theirs. | **Accept** → one of your citizens leaves, one of theirs arrives with a new trait and lasting trust · Decline politely → nothing |
| M20 | **A debt called in.** A village that helped you asks a favour. | **Honour it** → a cost in goods · Put them off → trust drops |

### Outposts (the seven built in R6c, kept)

M21 rich vein · M22 wandering trader · M23 wolves at the store · M24 lost traveller · M25 buried cache · M26 storm · M27 bumper crop.

One change: M24 (lost traveller) merges into M7 when Phase 1's settlers exist.

### Raids and the Withered

| # | Moment | Options |
|---|---|---|
| M28 | **Scouts report movement.** (before a raid) | **Bring the outpost crew home** → they are safe, the outpost is idle · Reinforce it → better defence, more people at risk · Send an offer → pay tribute at today's price |
| M29 | **After the raid.** Someone held the gate. | **A quiet thanks** → that citizen gains happiness · Name them the town's shield → a title in the chronicle; others envy it a little |
| M30 | **A Withered child.** Found near a burned camp. | **Take them in** → a new child with an unusual hidden trait; one family objects · Leave them at the village → trust with that village |

## 4. Writing rules

- **Two sentences at most,** then the options. Names first: "Hazel Ironroot wants…".
- **Each option's hint states its cost or risk** in a few words: "150 food", "two days away", "may not work".
- **No option is a trap.** The player should be able to guess roughly what will happen.
- **Outcomes are one sentence** and say what changed.
- Odds are rolled on the server when the moment is created (stored in `data`), so reloading can't change them.

## 5. What changes elsewhere

- `lib/outpost_events.js` and its routes are replaced by `lib/moments.js`; the outpost window shows moments whose subject is that outpost.
- The Phase 1 prompts become moments: choosing a youth's trade (M2), settlers (M7), heirs (M5).
- Season turns call the engine instead of just changing modifiers.
- The away report lists resolved moments, marking those that were decided automatically.
- `lib/milestones.js`: add `first_moment`.

## 6. Build order

1. The engine, the table, the migration of outpost events, the API and Dev Tools.
2. The card stack, the dialogue presentation and the away-report entry.
3. Family moments (M1–M8), since they depend only on Phase 1.
4. The year (M9–M13), then quests (M14–M17).
5. Villages and raids (M18–M20, M28–M30).
6. A tuning pass on the daily budget, using how many moments are answered against how many time out.

### 6a. What was built (2026-11-13)

**Step 1, the engine:**
- `lib/moments.js`: kinds registered in the §2.2 shape. Each option also has a `risk` rank (0–3), so the content check can confirm the default is never the single worst option.
- The budget:
  - about 3 a day, at least 6 hours apart, never more than 4 open;
  - per-kind cooldowns, and never the same kind twice running;
  - a town's first check starts a clock (`settlements.moments_seen_at`), and its first moment, a gentle kind, follows 5–10 minutes later.
- `trigger()` skips the budget but not the cap; at the cap the default happens at once and the chronicle says so.
- Defaults are taken on expiry (`moment_resolved` live event), and every outcome writes a chronicle line (kind `moment`).
- Also: the `first_moment` milestone, `stats()` (shown, answered, timed out, choices; one-sided over 85% with 10+ answers), and `check()`, the content check.
- The seven outpost events are moment kinds (`lib/moments_outpost.js`); outposts no longer roll their own. The `moments` table took the open outpost events once.
  - The outpost window's routes and Dev Tools go through the engine.
  - Options gained hints.
  - Wolves default to driving them off: the old default, letting them eat, was the worst option.
  - The lost traveller is no longer rolled, merged into M7 as §3 says.
- API: `routes/moments.js` covers §2.5, plus admin `kinds`, `roll`, `expire` and `stats`.
- **Changes from §2.3:**
  - a new town's first moment can't be M1 (a new town has no babies), so it is any kind marked `gentle`;
  - "within ten minutes" is a clock started at the first check, because settlements have no `created_at`. It also keeps short-lived test towns free of moments.

**Step 2, presentation:**
- `js/say.js` `KWSay`, the dialogue box (`LAYOUT_SPEC.md` §3.4):
  - a portrait, the speaker, the title, the text, up to three options with hints and the default marked, and what happens if you don't decide;
  - the outcome replaces the options for a few seconds, then it folds away;
  - it sits above the map and below windows, and is a bottom sheet on phones.
- `js/moments.js` `KWMoments`:
  - a stack of up to four cards (top left; above the tab bar on phones), each with the time left; the stack steps aside for windows and the dialogue box;
  - moments listed on top of the bell's list;
  - live `moment` and `moment_resolved` events.
- The away report puts "N things are waiting for you to decide" first. Moments resolved while away are listed in their source's group, marked "(decided for you)".
- The server adds `speaker` to each moment.
- Tests:
  - `scripts/moments_test.js` (43 checks), `verify/moments_proofs.js` (22);
  - a browser pass of the stack and dialogue box at desktop and phone sizes against a local API (16 checks; scratch script).

**Step 3, the family moments (`lib/moments_family.js`):**
- **M1 A name for the baby.**
  - Asked within 3 days of a birth, once per child, when both parents are living.
  - Choices:
    - after the mother's mother, or her father if she has no mother (default; they gain 8 happiness, or the name honours them if they have died). With no grandparent at all, the mother's own name;
    - after the father's closest friend outside the family (their bond +12);
    - let the town choose (everyone +3).
  - The child keeps the family name.
- **M2 A child's wish.**
  - A youth of 7–8 with no apprenticeship yet wants a trade other than their parent's: their hidden knack's trade if they have one, else another trade the town has.
  - Following the parent is the default (−8 happiness); the wish gives +6 and reveals the knack.
  - This is the "choosing a youth's trade" prompt from Phase 1. Youths nobody is asked about still follow their parent's trade, as before.
- **M3 A proposal across families.**
  - Two unpartnered adults from different families who are not kin, with a bond of 75 or more. The objector is the oldest adult of either family who is older than both.
  - Blessing it is the default: they become partners and are housed together, and the objector loses 10 happiness. Asking them to wait costs their bond 15.
- **M4 An elder's last request.**
  - The oldest elder of the death age or more, once each.
  - Granting it costs 150 food and gives the family +6. If the food isn't there when the default is taken, they are gently refused instead.
- **M5 Who inherits?**
  - Asked at a death (from `lib/inheritance.js` `onDeath`) when there are heirlooms, the eldest adult child doesn't work the trade, and a sibling does.
  - The eldest is the default, the same heir the inheritance already names. If the 24 hours to choose run out first, the moment says the things were already passed on.
- **M6 A quarrel between neighbours.**
  - Two adult housemates who are not partners, parent or child.
  - Letting it blow over is the default (bond −12). Moving the younger to a house with room, and a peacemaker (someone with the visible `charming` trait; bond +10), appear only when possible.
- **M7 A settler at the gate.**
  - `lib/settlers.js` `arrive()` no longer brings settlers in: each due settler is rolled once, kept in the moment's data, and waits at the gate. Welcoming them is the default.
  - "Work the outpost" appears when an outpost has a free worker place. That settler needs no bed in town and starts 10 happiness down.
  - If the beds have filled by the time a settler is welcomed, they go on elsewhere.
  - Dev Tools' "send a settler now" still brings one straight in.
- **M8 A gifted child.**
  - A youth with an unrevealed career knack.
  - Letting them be a child is the default (+8). Early training sets the apprenticeship, reveals the knack and grants 200 XP in the trade, for −8 happiness.
- Gentle (a new town's first moment can be one of these): M1 and M8.
  - A brand-new town has neither babies nor youths, so its first moment comes once something fits; the outpost harvest and cache are gentle too.
  - The year moments in step 4 will give every new town a first moment.
- **Engine changes:**
  - when a default can't be carried out, the other choices are tried in turn, so a moment never stays stuck;
  - a kind can write its own chronicle line (M7 does), returning `chronicle: false` so there aren't two.
- Tests: `scripts/moments_test.js` (82 checks: every family kind's eligibility, choices and outcomes, the settler flow and M5 at a death); `scripts/life_test.js` (181; settlers are now welcomed through M7).

**Step 4, the year and quests (`lib/moments_year.js`, `lib/moments_quest.js`):**
- **Timed town effects** (`town_effects` table, `lib/town_effects.js`): what a moment leaves behind for a while, with a start and an end.
  - `lib/town_mods` counts them in production (only for the hours each overlapped), happiness and food upkeep, and lists each as a source. The resource breakdown's "Town bonuses" row now names what is behind it.
  - `simulation.js` adds their birth chance hour by hour.
- **The year, M9–M13.**
  - Each is asked only in its own season (7 hours) and at most once a game year. They compete with the other kinds for the daily budget rather than being triggered at each season turn: four triggered season moments would nearly fill a 3-a-day budget on their own. This replaces "season turns call the engine" (§5).
  - **M9 Spring: what to plant.** The usual fields (default); flax and herbs (food −15% to autumn, then wealth +30% all autumn); leave a field fallow (food −10% for a year, +30% next spring).
  - **M10 Summer: the long days.** Rest (default; happiness +5 for the summer); work late (production +10% for the summer; the injury, rolled when asked, is a hurt back and −10 happiness); send the young ones exploring (only with youths; six unseen tiles 3–5 away are revealed; the one who may get lost is rolled when asked).
  - **M11 Autumn: the harvest feast.** A modest supper (default); a feast (8 food and 4 wealth a head; happiness +8 for the autumn, every bond +4, birth chance +5% next spring).
  - **M12 Winter: short stores.** Only when the food in store won't last the rest of winter at the town's upkeep.
    - Choices: ration evenly (default; food upkeep −25% and happiness −6 to spring); feed the children and workers first (only with elders; the same saving, elders −15 happiness); buy the shortfall (1 wealth a food, from the most trusted village, whose trust rises).
    - Buying is ranked as a risk too (it costs wealth), so the default is never the single worst.
  - **M13 Winter: stories by the fire.** Only with children. The old tales (default; each child 30 XP in a random trade); tales of the founders (the largest family +6); ghost stories (the children's bonds +8; one, rolled when asked, −10).
  - M9, M10, M11 and M13 are gentle, so a brand-new town's first moment can now always be found.
- **Quests and the road, M14–M17.**
  - These follow events (`quest_completed`, `battle_won`), so they go through `moments.offer()`: the daily budget, the cap, cooldowns and "never the same kind twice running", but not the 6-hour spacing.
  - At most one per event. The odds are in `lib/moments_quest.js` CONFIG.
  - **M14 A find on the road** (20% of successful quests). An item from the templates (equipment worth 10–150). Choices: bring it home (default); let the finder keep it (worn if that slot is free; the party's bonds +5); sell it (its value in wealth; a known village's trust +3).
  - **M15 A wounded stranger** (8% of party quests home).
    - Carry them home (default): the party comes home tired (−3), and the stranger stays as a settler if they choose to (60%, rolled when asked) and there is a bed. Otherwise they go home and send 20 wealth.
    - Leave supplies: 30 food, and the kindest of the party (Loyal or Charming) −6.
  - **M16 A rival party** (10% of successful party quests). Share (default; half the resources, no items; a village's trust +4); race (the whole reward or nothing, rolled when asked); let them have it (nothing; trust +8).
    - The share is applied when the quest is collected. Collecting before answering takes the default first.
  - **M17 The one who froze** (12% of battles won with two or more).
    - Say nothing (default; −5); send them out again (55%, rolled when asked: Brave, +2 strength, or Shaken, −1 strength); work at home (fighters become foragers; +4).
    - Brave and Shaken are new earned traits (`citizens.js` `EARNED_TRAITS`), never rolled at birth.
  - **Changes from §3:** M15 and M16 are mid-quest in the spec. Quests here resolve in one go, so both are asked as the party comes home: carrying the stranger tires the party instead of delaying the quest. "Shaken" doesn't yet stop a citizen being sent to fight; it lowers their strength.
- **Engine and settlers:**
  - `start()` takes an optional `now` (tests ask in any season);
  - `settlers.admitOne` can run on a moment's transaction (`opts.q`). M7 and M15 do, so admitting a settler never waits on locks the moment holds; a test caught M15 deadlocking that way.
- Tests: `scripts/moments_test.js` (118 checks, adding timed effects, the five year moments, the four quest moments, and M16 through the collect route).

**Step 5, villages and raids (`lib/moments_village.js`, `lib/moments_raid.js`):**
- **Villages, M18–M20.** Rolled like the others. Each needs a known, peaceful village at enough trust: 21+ (familiar) for M18, 41+ (friendly) for M19 and M20.
  - **M18 A village asks for help.** Send food (default; 80 a tier; trust +6); send two workers (only if at least two others stay; trust +10; away 2 days); decline (trust −3).
    - Away is a new `citizens.away_until` (migration `moments_away`), which `lib/careers` awayMap reads as `helping`: they can't be reassigned or re-equipped until they are back.
  - **M19 An envoy's offer.** A single adult (16–44) and a free bed. Accept (default): a spouse from the village comes to live here with them and brings a good visible trait; trust +12. Decline politely: nothing.
  - **M20 A debt called in.** Honour it (default; 60 timber, stone or food a tier; trust +4); put them off (trust −8). When the goods aren't there, the default falls back to putting them off.
  - **Change from §3:** M19 in the spec has one of yours leave. There is no "left town" state for a citizen, so the marriage brings a spouse here instead.
- **Raids, M28–M30.** These follow events, offered within the daily budget. `raid_repelled` now carries the raid's id, and burning a Withered camp emits `camp_cleared`.
  - **M28 Scouts report movement** (every raid warning).
    - Bring the outpost crew home (default for an outpost; "bar the gates and wait" for the town itself);
    - reinforce (a timed `raid_defence` +20 until the raid arrives; `town_mods` puts it in `effects`, which `lib/raids` already reads);
    - send an offer (tribute at today's price, as in `lib/raids`, on the moment's transaction; the raid turns back).
  - **M29 After the raid** (60% of raids turned back, when someone was posted). The defender (a Guard or Archer first) gets a quiet thanks (default, +8) or is named the town's shield (the earned trait `shield`, +12; every other adult −2).
  - **M30 A Withered child** (half of camps burned; 15% of raids turned back otherwise).
    - Take them in (default): a child of 4–7 with a hidden career knack and `life.withered_born`, a new family line; the head of the largest family −8.
    - Take them to the most trusted village: trust +6. With no bed, the default falls back to this.
- Tests: `scripts/moments_test.js` (139 checks).

## 7. Tests

- `scripts/moments_test.js`:
  - the budget and the cap;
  - cooldowns;
  - every kind's `eligible`, `options` and `fallback` agree (the fallback is one of the options);
  - each `choose` returns an outcome and a chronicle line;
  - defaults fire on expiry;
  - triggered moments at the cap resolve at once.
- A content check that fails if any moment has an option with no hint, or a default that costs more than the other options.
- Frontend proofs for the card, the dialogue and the away report.

## 8. Measure

Track, per kind: shown, answered, timed out, and which option was chosen. A kind where one option is chosen more than 85% of the time has no real trade-off and should be rewritten or cut.
