# Phase 2 — Moments (build spec)

Status: **steps 1–2 built (2026-11-13)**; steps 3–6 ready to build. Written 2026-11-12. Part of `docs/ROADMAP_1_0.md`.

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
