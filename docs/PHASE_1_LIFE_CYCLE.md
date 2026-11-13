# Phase 1 — the life cycle (build spec)

Status: **steps 1–3 built (2026-11-13)**; steps 4–7 ready to build. **Steps 2–6 ship together:** do not merge the branch until step 6 is done. Decisions in §11 are made. Written 2026-11-11, updated 2026-11-13. Part of `docs/ROADMAP_1_0.md`.
Read §1 first: it lists two bugs in the live game that block progress today.

## 1. Findings from the assessment

I read the real rules (`simulation.js`, `buildings.js`, `routes/game.js`, `routes/housing.js`) and modelled them (`scripts/population_model.js`).

### 1.1 Two bugs in the live game

| # | Bug | Evidence | Effect |
|---|---|---|---|
| B1 | **Births cannot happen.** A birth needs a couple sharing a house that has a free place (`_hourBreeding`). Every house holds 2 (`HOUSING_CAPACITY`), so the couple fills it. | Model scenario A: 0 births in 180 days, every run. The only test that gets births uses a made-up house of 4. | No player has ever had a child born under the real rules. Admins can force one from Dev Tools. |
| B2 | **The population number never changes.** `settlements.population` starts at 10 and only two things raise it: the admin "add citizen" cheat and the new traveller event. Births and deaths don't touch it. | `grep population` across the server. | Growing to a Village needs population 20, so **no ordinary player can leave Camp**. Everything gated by tier is unreachable: more outposts, the Watchtower, the Guild Hall and clans, Wonders. |

If testers have been progressing, they were using admin tools. Both are fixed by step 1 of the build order (§9), and I recommend shipping that step on its own, straight away.

### 1.2 Other gaps the life cycle exposes

- **No kin rule.** Any two adults can become partners. Once children grow up, siblings and parents could pair with each other.
- **Housing is manual.** The player assigns each citizen to a house. With births and deaths that becomes a chore, and births depend on it.
- **`life_stage = 'adult'` is checked in dozens of places** (workforce, quests, markets, outposts). Adding new stored stages would touch all of them, so this spec does not add any (§3).

### 1.3 What the model says

All figures are medians of 200 runs over 180 real days.

| Scenario | People at day 30 / 90 / 180 | Died out | A death every |
|---|---|---|---|
| A. The live game | 10 / 10 / 10 | 0% | never |
| B. Add ageing and death, change nothing else | 7 / 0 / 0 | **100%** | — |
| D. Family rules, but a birth still needs room in the couple's own house | 13 / 4 / 0 | **82%** | — |
| E. Same, but a birth needs a free bed anywhere in town | 20 / 20 / 20 | 9% | 3.6 days |
| G. E plus settlers (agreed pace: adult at 10, elder 45, deaths from 50) | 20 / 20 / 20 | 0% | **3.3 days** (camp), **1.5 days** (village) |
| **K. Recommended pace** (§2) | 20 / 20 / 20 | 0% | 4.6 days (camp), 2.1 days (village) |

Conclusions:

1. **Ageing must never ship without the birth fixes.** Scenario B wipes out every town within two months.
2. **Births should need a free bed in town, not room in one house.** This is the single change that makes towns stable (D against E), and it removes the housing chore.
3. **Settlers are the safety net.** Without them about one town in ten still dies out from bad luck (too few couples of the right ages).
4. **The kin rule costs nothing** once settlers exist: results with and without it are the same.
5. **Slowing births doesn't help.** I tested birth chances down to 5% of today's; towns shrank and the workforce swings stayed. The current chance stays.
6. **The workforce will swing.** A new town's founders are all 16–35, so they age out together and a wave of children replaces them. At a Camp the count of working adults moves between about 9 and 19 of 20. Youths and elders working at part strength (§4.2, §4.3) soften this.

## 2. Numbers

**Build the "Recommended" column.** The owner chose it on 2026-11-12 over the faster pace first agreed ("grown up in about 11 days, adult life of 4–6 weeks"). At the faster pace a 60-bed Village has a death every day and a half, and the ten founders are all gone inside six weeks. The recommended pace cuts deaths by about 30% and keeps the founders for 6–10 weeks. Every number lives in one config file and can be changed from Dev Tools (§8), so it can still be tuned during the beta.

One game year is 28 real hours (unchanged).

| Setting | First agreed (not used) | **Recommended (build this)** | Real time (recommended) |
|---|---|---|---|
| Child | 0–5 | 0–6 | 8 days |
| Youth | 6–9 | 7–11 | 6 days |
| Adult from | 10 | **12** | grown up at 14 days |
| Elder from | 45 | **60** | 56 days as a working adult |
| Deaths begin | 50 | **70** | — |
| Chance of death, per year | 8%, +4% each year | 6% at 70, +3% each year (at most 60%) | most die at 74–82: a life of about 3 months |
| Fertile (both partners) | 12–40 | 14–55 | — |
| Gap between a couple's children | 3 years | 2 years | 56 hours |
| Children per couple | 4 | 4 | — |
| House holds | — | **4** (was 2) | — |
| Settler arrives | — | every 7 days while a bed is free; the next day whenever working adults drop below 6 | — |

The birth chance per hour is unchanged (4%, +10% in spring, −5% in winter, +4% per 10 happiness over 60, at most 35%).

Beds by tier follow from the existing house limits: Camp 20, Village 60, Town 120, City 240. The tier requirements (20, 40 and 80 people) fit under those.

## 3. Data model

**No new stored life stages.** `citizens.life_stage` keeps its three values: `child`, `adult`, `deceased`. "Youth" and "elder" are worked out from age, so the many existing `life_stage = 'adult'` checks keep working: a youth is a `child` who is 7 or older, and an elder is an `adult` who is 60 or older.

New module `lib/life.js` owns the rules and numbers: `ageOf(c, now)`, `stageOf(c, now)` (child, youth, adult, elder, deceased), `deathChance(age)`, `fertile(c, now)`, `kin(a, b)`, `CONFIG`.

Migration `0NN_life_cycle.sql` (idempotent, like the others):

| Change | Purpose |
|---|---|
| `citizens.family_id` | the family line the citizen belongs to |
| `citizens.died_at`, `citizens.death_cause` | memorials and the chronicle |
| `citizens.apprentice_class`, `citizens.mentor_id` | a youth's chosen trade and teacher |
| `citizens.last_birthday_year` | the last game year whose death roll was made (so catch-up never rolls twice) |
| `citizens.last_child_at` | the gap between births |
| table `families` (id, settlement_id, name, founded_at, head_citizen_id) | family lines |
| table `chronicle` (id, settlement_id, family_id, citizen_ids, kind, text, at) | the family record |
| `inventory_items.metadata.heirloom` (JSON, no new column) | `{ from_id, from_name, since, generations }` |
| `houses.capacity` set to 4 for every house; `HOUSING_CAPACITY.starter_house = 4` | beds |
| `settlements.population` kept in step by a helper (§4.6) | fixes B2 |

**Existing towns** (one-off, in the same migration):

- Age starts moving from each citizen's shown age: `born_at = NOW() − life.age × 28 hours` for living adults, capped at 45 years so nobody is suddenly elderly or dead.
- Children keep their real `born_at`. Any who are already 12 or older become adults at the next tick (their owners get one "came of age" line each, not a moment).
- One family per distinct surname in each town; `family_id` set from the citizen's surname.
- `settlements.population` is set to the count of living citizens.

## 4. Rules

### 4.1 Ageing
Age is always computed (`(now − born_at) / 28h`), so nothing needs to tick for it. The client shows age and stage from the same rule. The static `life.age` field is no longer read.

### 4.2 Children and youths
- **Child (0–6):** as now. Eats half; does not work.
- **Youth (7–11):** still stored as `child`, so they are not in the workforce and cannot quest. They learn:
  - At 7 the player chooses a trade (a **moment** once Phase 2 exists; until then a prompt in the citizen's profile). The default is a parent's trade.
  - A youth earns class XP in that trade at half the passive rate. With a **mentor**, an adult or elder of that trade in the same town, they earn the full rate. One mentor teaches up to two youths.
  - A youth adds a quarter of an adult's basic output to the town, so the workforce dip is softened.
  - A youth's hidden aptitude may not match the chosen trade. The profile hints at it ("seems restless at the forge").
- **Coming of age (12):** `life_stage` becomes `adult`, `role` is set to the apprenticed trade, and they keep the XP they earned. One chronicle line and a toast.

### 4.3 Elders
- **From 60:** still `adult` in storage, so they keep working, at 60% output.
- They can mentor (§4.2) and count for a small happiness bonus in their household.
- They can still be sent on quests or posted as guards. Their injury chance is higher (`rollInjuryFor` already takes `life_stage`; pass `'elder'`).
- They are no longer fertile after 55.

### 4.4 Death
- Each citizen aged 70 or more gets one roll per game year, on their birthday, inside the existing hourly simulation catch-up (`runSimulation`). `last_birthday_year` guards against double rolls.
- The catch-up is capped at a week (`SIM_MAX_CATCHUP_HOURS`), and the cap stays. A player away for a month does not come back to a graveyard: rolls for the skipped hours are simply not made.
- A citizen who is away (on a quest, at an outpost, on the road) does not die of old age until they are home.
- `deaths.js writeDeathEvent` gains `cause: 'old_age'`. It no longer unequips everything first: inheritance (§4.8) decides where the gear goes.
- Death clears the citizen's `house_id`. Today it does not, so the dead still take up a place in their house (`docs/SECURITY_REVIEW.md`, last section). Bed counts use living citizens only.
- **How much ceremony:**
  - the head of a family, or anyone with a title or a class level of 10 or more, gets a moment-style notice with a memorial line the player can read;
  - everyone else gets one gentle chronicle line and a toast.

  This keeps a 120-bed Town readable.

### 4.5 Partners and kin
- Partnerships form as now (bond score 90, both happy enough), with two new conditions: both are adults by age, and they are **not kin**. Kin means parent and child, siblings or half-siblings (`parent_ids`).
- Same-gender partnerships still form, as they do today; they have no births. (Adoption could come later as a moment.)
- A widowed citizen can partner again.

### 4.6 Births and beds
- A birth needs:
  - a partnered, opposite-gender couple;
  - both fertile (14–55);
  - at least 2 game years since their last child, and fewer than 4 children;
  - **a free bed in town**: living citizens fewer than the sum of house capacities.

  The couple no longer has to share a house with room.
- The newborn joins a family (§4.7) and is housed automatically.
- `lib/life.js recount(settlementId)` sets `settlements.population` to the count of living citizens. It is called after every birth, death, settler and admin change. Tier checks read the live count directly.

### 4.7 Families, houses and settlers
- **Families:** a child joins the family of whichever parent's line has fewer living members, and takes that surname. This keeps small lines alive. The head of a family is its oldest living adult.
- **Housing sorts itself:** partners share; children live with their parents; a new couple takes an empty house when there is one. The player can still move people by hand, and a manual choice is kept until that citizen's circumstances change. Unhoused citizens keep their existing happiness penalty, so building homes still matters.
- **Settlers:**
  - while a bed is free, one adult settler (aged 12–24, random trade aptitudes, a new surname and so a new family) arrives every 7 days;
  - if working adults fall below 6, one arrives the next day;
  - until Phase 2 they simply arrive with a toast and a chronicle line. With moments, the player is asked and the default is yes.

### 4.8 Inheritance
When a citizen dies (of any cause):

1. **The heir** is chosen by the player from the living family. The default is the eldest adult child, then the partner, then the family head. With no family left, their things go to the town's stores.
2. **Heirlooms:** each piece of gear they had equipped is renamed with their name ("Hazel's Pick") and tagged as an heirloom. Carried by a member of the same family, an heirloom gives +5% to that tool's output or quality, +1% more for each generation it has been passed down, up to +10%. It can be sold or lost like any item, but the tag stays.
3. **Knowledge:** if the heir works the same trade, they gain a quarter of the deceased's XP in it.
4. **Headship** of the family passes to the oldest living adult.

### 4.9 The chronicle
- A `chronicle` row is written for: births, coming of age, partnerships, deaths, inheritances, settlers arriving, quests won or lost, raids survived, named discoveries, and crafted items of fine quality or better.
- Most of these already write to `settlement_events` or `citizen_events`. Chronicle writing hooks into those same places (and `lib/game_events`), so it is one small function called from each.
- The Families screen shows a family tree per line (a family-tree endpoint already exists in `routes/citizens.js`), the chronicle beside it, and memorials for the dead.

## 5. API

| Route | Purpose |
|---|---|
| `GET /api/families` | lines, heads, living members, heirlooms |
| `GET /api/families/:id/chronicle` | the record, newest first, paged |
| `POST /api/citizens/:id/apprentice { class, mentor_id? }` | choose a youth's trade |
| `POST /api/citizens/:id/heir { heir_id }` | answer an inheritance (until moments exist) |
| `GET /api/citizens` | gains `age`, `stage`, `family`, `apprentice`, `fertile`, `heirlooms` |
| `GET /api/game/settlement` | `population` and `beds` from live counts |

## 6. Screens

Built on the new window component from the layout rework (roadmap §10, item 4), since these are new screens:

- **Families** (the second of the five places): a card per family line with its head, members by stage, and heirlooms; opens the tree and chronicle.
- **Citizen profile:** age and stage at the top; an Apprenticeship block for youths; an Heirlooms line; "Remembered" for the dead.
- **Settlement panel:** Children, Youths, Adults, Elders counts, and "Beds 18/20".
- **Away report:** births, comings of age, deaths and settlers grouped under Families.

## 7. What changes elsewhere

- `routes/game.js` tier checks: live citizen count, not the stored number.
- `lib/careers` profiles: output ×0.6 for elders; youth XP and the quarter-output contribution.
- `famine.js UPKEEP_BY_STAGE` already has `child`, `adult` and `elder` rates. Pass the computed stage.
- `routes/housing.js`: capacity 4; automatic placement.
- `lib/first_steps.js`: no change.
- `lib/milestones.js`: `first_birth` already exists; add `first_coming_of_age` and `first_inheritance`.
- `scripts/away_report_test.js` test 3d (births never overfill a house) changes to "never overfill the town".

## 8. Dev Tools and tuning

- Every number in §2 lives in `lib/life.js CONFIG`, overridable through the existing Dev Tools tuning (`lib/tuning.js`).
- New admin buttons: age everyone by N years; make a chosen citizen a youth, an adult or an elder; trigger a death of old age; send a settler; show beds and fertile couples.

## 9. Build order

Each step ends with tests passing. **Steps 2–6 ship together**: death without inheritance and the chronicle is only loss.

1. **Unblock the live game** (can ship alone, today's rules otherwise):
   - houses hold 4;
   - births need a free bed in town;
   - the population number is recounted on every change, and tier checks use the live count;
   - the kin rule;
   - housing sorts itself.

   This fixes B1 and B2.

   **Built (2026-11-13):**
   - `lib/life.js` has `kin`, `recount`, `livingCount`, `beds`, `planHousing` and `autoHouse`. Step 2 adds ages and stages to the same file.
   - `0NN_life_beds.sql` sets huts to 4, takes the dead out of houses and fixes the stuck population.
   - `simulation.js` applies the bed rule and the kin rule. The baby sleeps in a parent's house with room, otherwise another house with room.
   - `autoHouse` runs after each simulation run, after a hut is built or pulled down, and after a death or a new arrival. It moves a housed citizen only when they have just found a partner.
   - Tier checks and `GET /settlement` use the live count; the settlement also returns `beds`.
   - Tests: `scripts/life_test.js`.
   - **Watch after deploy:**
     - every town's huts double in size at once, so towns with partners will fill their free beds within days;
     - until step 2, children never grow up: they eat half a ration and do not work. A Camp of 10 adults can gain 10 children and about 5 more food an hour of upkeep.

   Step 2 should follow soon.
2. **`lib/life.js`** with ages from `born_at`, the migration for existing towns, and stages shown in the client.

   **Built (2026-11-13, not merged):**
   - `lib/life.js` gains `CONFIG` (the §2 numbers), `ageOf`, `stageOf`, `deathChance`, `fertile`, `bornAtFor`, `birthBlockers` and `assignFamilies`.
   - `0NN_life_cycle.sql` adds the §3 columns, `families` and `chronicle`. As a one-off (`migration_marks` key `life_cycle_ages`) it moves living adults' `born_at` to their shown age, capped at 45, and sets `last_birthday_year` so no death rolls are owed. On every boot it gives any citizen without a family the one named for their surname.
   - Births also need: both partners fertile (14–55), two years since the couple's last child, fewer than four children. A child counts towards its parents' total even after it dies. These rules were in §4.6 but not in a step; they live here because they need ages.
   - A child's `born_at` is the hour it was born, and it joins the parent's family line with fewer living members (§4.7, from step 4: it needed the families table).
   - Arrivals, the traveller and admin citizens get a `born_at` that matches their rolled age, and a family. Typing an age in the Dev Tools citizen editor moves `born_at`.
   - `GET /api/citizens` adds `age`, `stage` and `family_id`; `life.age` is the computed age, so every existing display moves with time and the stored value is never read.
   - The "can they have a child" box uses the current rules: a free bed in town, fertility, the gap and at most four children. It used to say "Not living together", which has been wrong since step 1 went live.
   - Client: stage tags in the profile and lists. The settlement panel shows Children, Youths, Adults, Elders and "Beds n/m"; it used to count dead citizens as adults.
   - The Oldest ranking shows game years.
   - Tests: `scripts/life_test.js` (step 2 sections), `verify/life_proofs.js`.
3. **Youths and elders:** apprenticeship, mentors, part-strength work, coming of age.

   **Built (2026-11-13, not merged):**
   - `lib/life.js` gains `apprenticeships` (each youth's trade, mentor and rate), `defaultTrade`, `aptitudeHint` and `comeOfAge`.
   - `lib/chronicle.js` `write()` is the one chronicle writer; step 6 calls it from everything else.
   - Youths:
     - The trade is the player's choice (`POST /api/citizens/:id/apprentice { class, mentor_id? }`) or, by default, a parent's.
     - A mentor is chosen, or else the best free adult or elder of that trade; each mentor takes two pupils at most.
     - XP is paid in `careers.settleIn` at half the passive rate, or the full rate with a mentor, counting only the hours since they turned 7.
     - Output: a quarter of an adult's basic output, as `loadWorkforce().youths`, added in `calculateRates` and shown as its own row in the breakdown. It brings no crew share.
     - A hidden aversion or knack shows as a hint.
     - Choosing happens in the citizen profile until moments exist.
   - Coming of age at 12: atomic, run from `GET /settlement` and at the start of the simulation. The new adult takes their trade, or Forager if the town lacks its building, and keeps their XP. It writes one chronicle line and one `came_of_age` event (a toast), and the `first_coming_of_age` milestone. Children of 12+ in existing towns come of age on the first tick.
   - Elders: output ×0.6 in `buildProfiles`; the elder injury modifier in combat and admin injuries; famine upkeep by computed stage (elders 0.75, youths as children); an "elder at home" happiness factor (+3) for the household.
   - Client: the Apprenticeship block in the profile (trade and mentor pickers, progress, rate, hint) and an elder note.
   - Tests: `life_test` step 3 sections, `verify/life_proofs.js` §3.
4. **Death, families and inheritance:** death rolls, heirs, heirlooms, headship.
5. **Settlers.**
6. **The chronicle and the Families screen.**
7. **Dev Tools and a tuning pass** using `scripts/population_model.js` and the funnel.

## 10. Tests

- `scripts/life_test.js`: ages and stages at the boundaries; death chance by age; kin; fertility; the bed rule; one death roll per year under catch-up; nobody dies while away; migration of an existing town.
- `scripts/families_test.js`: family assignment; heir defaults; heirloom tagging and bonus; XP passed on; settlers arrive on both triggers.
- `scripts/population_model.js` stays as the planning tool. Re-run it whenever a number in §2 changes; a town should never die out, and "a death every N days" should stay near the figures in §1.3.
- Frontend proofs for the Families screen, the profile blocks and the away report.

## 11. Decisions made (2026-11-12)

1. **Pace: the slower, recommended one** (§2, the "Recommended" column). The "Agreed pace" column is kept only for comparison.
2. **Step 1 ships first, on its own**, built by the next model.
3. **Heirlooms carry the small bonus**: +5%, rising by 1% a generation to +10%, within the family.
