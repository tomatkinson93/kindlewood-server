# Clan quests — how they work (built)

Code: `lib/clan_quests.js` (definitions + rules), `routes/clan_quests.js`
(`/api/clan-quests`), `migrations/0NN_clan_quests.sql`,
`scripts/clan_quests_test.js`. UI: the Clan panel's **Quests** tab.

## Kinds

- **Solo** — any member (recruits included) sends one of their citizens.
  Starts at once. Each member can run each solo quest once per UTC day.
- **Party** — several roles. Member rank and up post a party and take a
  role; anyone in the clan fills the rest with **one citizen per member
  per party**. It sets out when the last role is filled. One forming or
  active party per quest per clan; one completion per quest per clan per
  UTC day.

## Decisions on the open questions

| Question | Decision |
|---|---|
| Who can post? | Solo: anyone. Party: Member+ (recruits can join). |
| Forming expiry | 24 h (`FORMING_HOURS`); lapses with nothing lost. |
| Level gates | Solo quests from level 1 (some at 2–3); parties from level 2 (harder ones at 3 and 4). |
| Rewards | Every participant gets the quest's full resource rewards. |
| Prestige | Per participant: solo counts toward the daily cap; party is a milestone outside it. |
| Failure | No penalty — citizens come home, nothing is lost. |
| Calling off | The poster, or anyone with `moderate` (officer+), while forming. |
| Leaving the clan | Frees your spot in forming parties; parties underway finish with you. |

## Mechanics

- Success: `min(95%, base + (skill − 1) × 4%)`; party uses the average of
  each role's own skill.
- Citizens in a live run (`clan_quest_slots.active`) are busy everywhere:
  personal quests, parties, expeditions and envoys refuse them, and
  `/api/citizens` reports `active_quest.clan = true`.
- Resolution runs in the quest worker tick (and on `GET /api/clan-quests`
  as a safety net) with `FOR UPDATE SKIP LOCKED`. Events after COMMIT:
  `clan_quest_updated` (clan channel), `clan_quest_resolved` (each
  participant's settlement), a clan chat system line, clan activity rows.
- Concurrency: writes lock the clan row; unique indexes stop two members
  taking one role, one member taking two roles, or a citizen being in two
  live runs.
- Dev Tools: `POST /api/clan-quests/cheat/finish` ends your running quests.

## Authoring (Dev Tools → Quests)

Clan quests are rows in `quest_definitions` with `quest_source = 'clan'`.
The quest admin's **Source → Clan** shows the clan fields: minimum clan
level (`clan_min_level`), prestige per participant (`clan_prestige`) and
resource rewards (`rewards`). Party roles are `requires`; combat uses the
existing `combat_chance` / `combat_encounter`. The built-ins
(`SEED_POOL` in `lib/clan_quests.js`) are seeded on first boot only, and
again (missing ones) by the admin's **Seed built-ins**. Archiving takes a
quest out of rotation; runs of it already underway still finish.

## Board rotation

Each clan's board shows `BOARD_SOLO` (3) solo and `BOARD_PARTY` (2) party
quests a day, drawn from what its level has unlocked with an RNG seeded by
clan id + UTC date: every member sees the same board, clans differ, and it
changes at UTC midnight. Only today's board can be started or posted.
Quests above the clan's level are returned as `locked` teasers.

## Combat

When a run sets out it may roll an encounter (`combat_chance` %) that
triggers 10–90% of the way through. Clan battles **auto-resolve** — a
party spans several players, so nobody plays it by hand. Victory: the
quest carries on (and participants earn the usual battle prestige).
Defeat: the run fails on the spot. In keeping with "failing costs nothing",
clan battles never roll injuries. Encounters stay hidden until they
happen; afterwards the run shows the foes, outcome and battle log.

## Later

- Weekly clan-wide goals.
- Optional manual battles for solo clan runs.
