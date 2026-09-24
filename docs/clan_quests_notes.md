# Clan quests — design notes (not built yet)

Requested during spec 016 work; to be specced and built after the clan
phases. Captured here so the requirements aren't lost.

## What was asked for

- **Solo clan quests.** Any member can accept one and complete it alone
  with their own citizen, like a normal quest.
- **Party clan quests.** A quest with several roles. Clan members each
  assign one of their citizens to a role until every role is filled; then
  it starts. **One citizen per member per quest**, so a single member
  can't fill every slot.
- **Rewards go to everyone who took part:** clan prestige plus each
  participant's own rewards.
- **Failing costs nothing.** No penalty to the clan or the participants.

## How it could hang off what exists

- **Definitions:** reuse `quest_definitions` / the quest pools with a
  `clan: true` flag (or a `clan_quest_definitions` table). The existing
  `requires: [{ skill_key }]` shape of party quests already describes roles.
- **Runs:** a `clan_quest_runs` table keyed by `clan_id`, status
  `forming → active → completed|failed`, plus `clan_quest_slots
  (run_id, role_index, user_id, citizen_id)` with
  `UNIQUE (run_id, user_id)` for the one-citizen-per-member rule and
  `UNIQUE (run_id, role_index)` so two members can't take the same role.
  Joining a slot = Pattern A/B from spec 016 §3 (lock the run row).
- **Citizen availability:** assigned citizens must be marked busy the same
  way `settlement_quests` marks them, so they can't also be on a personal
  quest.
- **Resolution:** the quest worker already resolves `settlement_quests`
  with `FOR UPDATE SKIP LOCKED`; clan runs resolve the same way, then emit
  a `clan_quest_completed` game event after COMMIT.
- **Prestige:** the clan subscriber credits it through `awardPrestige`
  (`source: 'clan_quest'`). Open question: count it toward each member's
  daily cap, or treat party completions as milestones outside the cap.
- **UI:** a "Quests" section in the Clan panel (forming parties with open
  roles, a "Join with…" citizen picker, active runs with timers). SSE on
  `clan:<id>` for slot filled / run started / run resolved.

## Open questions

- Who can post or start a clan quest: any member, or `officer`+?
- Does a forming party expire if roles aren't filled in time?
- Are clan quests unlocked by clan level (e.g. solo at L1, party at L3)?
- Reward split: fixed per participant, or scaled by role/skill?
