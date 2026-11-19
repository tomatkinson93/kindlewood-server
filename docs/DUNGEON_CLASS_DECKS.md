# Class decks: one deck per citizen (design proposal)

Status: **agreed in outline with the owner on 2026-11-19; the packs and numbers below are a first proposal. Nothing here is built.** It replaces the door draft of `docs/DUNGEONS.md` §3.4 and the "Requires Wizard" rules of `docs/DUNGEON_CONTENT.md` §3.3. The same file is in both repos.

Every number comes from `scripts/class_deck_sim.js` (server repo), which holds the packs as data and plays whole dungeon runs with them on the real combat engine. It builds on `scripts/dungeon_balance_sim.js` (the same bot, creatures, skull scaling and room plans), so the two designs can be read side by side. To reproduce:

```bash
node scripts/class_deck_sim.js packs
```

```bash
node scripts/class_deck_sim.js door 120
```

```bash
node scripts/class_deck_sim.js tiers 120
```

```bash
node scripts/class_deck_sim.js heal 100
```

## 1. What was agreed (2026-11-19)

The owner asked players of roguelite card games; most said each class should have its own deck.

| Question | Decision |
|---|---|
| Whose deck? | **One deck per citizen**, built from their class's base pack. Two Guards start with the same pack; what is added goes to a named citizen. |
| Citizens with no fighting class | **A Villager pack**, with one trade card from the citizen's job. Any four adults can still enter a green dungeon. |
| The door draft | **Replaced.** Each citizen keeps one card of three at the door, and the party keeps one card of three after each fight (§4). The owner left this to the numbers: §6.1. |
| Where it applies | **One system everywhere in time:** dungeons first, then quests, camps and raids, replacing the home deck. |

## 2. Why, and what it replaces

- **Identity.** A citizen's cards are theirs. A Wizard who goes down takes the spells with them, which raises the stakes of protecting a family member.
- **No dead cards.** The earlier design needed a rule that set aside class cards a citizen could not play. With a deck each, the problem does not exist.
- **Intelligence and charisma get a use in combat.** Class basics scale off the class's own stat.

Gone from `DUNGEONS.md`: the draft of 12 to 16 cards, deck size by skull, the "not for drafts" toggle, the re-roll, and the two guards against a dead deck. The roadmap's line "a default deck follows the party's careers" is now the whole design.

## 3. The packs

Ten cards each. Hand of five and three energy a turn, as now. "Villager" is a citizen with every stat at 8 and combat 1; "trained" is the class's main stat 11, second stat 10, combat 4.

The basics are not the same card with different numbers. Each class has its own, on its own stat, with its own reach: a Guard's Strike is the hardest plain hit but only reaches the front creature; an Archer's Shoot picks any target; a Wizard's Spark is weak and the Wizard's strength is in the other cards.

### Guard (strength / endurance): the wall

| Card | × | Cost | Villager | Trained | Formula |
|---|---|---|---|---|---|
| Strike | 3 | 1 | 11 damage | 16 damage, front creature | `damage: strength*0.7 + combat*0.8 + 5` |
| Shield Up | 3 | 1 | 12 block | 15 block | `block: endurance*0.8 + combat*0.5 + 5` |
| Cover | 2 | 1 | 11 block | 14 block on a friend | `block: endurance*0.7 + combat*0.4 + 5` |
| Shove | 1 | 1 | 7 damage | 9 damage, pushes the front creature back, weak 2 | `damage: strength*0.4 + combat*0.4 + 3` / `push: 1` / `debuff weak: 2` |
| Heavy Blow | 1 | 2 | 19 damage | 26 damage, front creature | `damage: strength*1.2 + combat*1.2 + 8` |

### Archer (agility / strength): any target, from the back

| Card | × | Cost | Villager | Trained | Formula |
|---|---|---|---|---|---|
| Shoot | 3 | 1 | 10 damage | 15 damage, any target | `damage: agility*0.7 + combat*0.8 + 4` |
| Sidestep | 3 | 1 | 9 block | 12 block | `block: agility*0.6 + combat*0.4 + 4` |
| Parting Shot | 2 | 1 | 8 damage, 4 block | 11 damage, 5 block, steps back one place | `damage: agility*0.5 + combat*0.6 + 3` / `block: agility*0.3 + 2` / `move: 1` |
| Piercing Arrow | 1 | 2 | 12 | 17, then 10, then 6 down the line | `damage: agility*0.8 + combat*0.8 + 5`; pierce, falloff 0.6 |
| Mark | 1 | 0 | vulnerable 3 | vulnerable 3 on any target | `debuff vulnerable: 3` |

### Wizard (intelligence / agility): weak basics, real spells, little health

| Card | × | Cost | Villager | Trained | Formula |
|---|---|---|---|---|---|
| Spark | 3 | 1 | 7 damage | 10 damage, any target | `damage: intelligence*0.5 + combat*0.4 + 3` |
| Ward | 3 | 1 | 8 block | 11 block on anyone friendly | `block: intelligence*0.6 + combat*0.3 + 3` |
| Firebolt | 2 | 1 | 12 damage | 16 damage, any target | `damage: intelligence*0.8 + combat*0.6 + 5` |
| Ember Burst | 1 | 2 | 7 | 10 damage to every creature | `damage: intelligence*0.6 + combat*0.4 + 2` |
| Chill | 1 | 1 | 5 damage | 6 damage, slow 3, weak 3 | `damage: intelligence*0.4 + 2` / `slow: 3` / `debuff weak: 3` |

Fireball proper (stronger, every creature) is an unlock, not a base card.

### Hearthkeeper (intelligence / charisma): keeps the others standing

| Card | × | Cost | Villager | Trained | Formula |
|---|---|---|---|---|---|
| Cinder | 3 | 1 | 7 damage | 10 damage, any target | `damage: intelligence*0.5 + combat*0.4 + 3` |
| Hearth Ward | 3 | 1 | 10 block | 13 block on anyone friendly | `block: intelligence*0.6 + charisma*0.3 + 3` |
| Kindle | 1 | 1 | heal 12 | heal 15; **spent until the party rests** (§5) | `heal: intelligence*0.6 + charisma*0.4 + 4` |
| Steady Now | 1 | 1 | 5 block | 6 block on every friend | `block: charisma*0.4 + 2` |
| Embolden | 2 | 0 | +6 | a friend's next attack +7 | `buff damage_bonus: charisma*0.5 + 2` |

### Villager (no fighting class)

| Card | × | Cost | Villager | Formula |
|---|---|---|---|---|
| Swing | 5 | 1 | 11 damage, any target | `damage: strength*0.6 + combat*0.8 + 5` |
| Duck | 3 | 1 | 11 block | `block: endurance*0.7 + combat*0.5 + 5` |
| Trade card | 2 | | by the kind of job, below | |

| Kind of job | Careers today | Trade card | Cost | Effect |
|---|---|---|---|---|
| Gathering | Forager, Farmer, Woodcutter, Miner, Fisher | Tool of the Trade | 2 | 16 damage, front creature |
| Travel | Scout | Spot the Weakness | 0 | vulnerable 2, draw a card |
| Crafting | Builder, Blacksmith, Jeweller, Carpenter, Smelter, Crafter | Shore Up | 1 | 10 block on anyone friendly |
| Trade | Merchant, Shopkeeper, Porter | Share Rations | 1 | heal 7; spent until the party rests |
| Service | Tavernkeep | Strong Drink | 1 | heal 4 and next attack +5 on a friend; spent until the party rests |
| Learning | Scholar | Read the Signs | 1 | weak 3, draw a card |

Guards and Archers (the careers `soldier` and `archer`) take their class pack. A citizen with no job takes one more Swing and one more Duck. One card per kind is the first version; a card per career (a Miner's pick that breaks block, a Fisher's net) is content for later.

A class pack beats the Villager pack through its four class cards and the stats a trained citizen has, not through bigger basics: at equal stats a Guard's Strike is 11 to a villager's 11, but only the Guard has Cover and Heavy Blow.

## 4. How a deck grows

- **At the door: one card each.** Every citizen is shown three cards of their own and keeps one. Four picks, about half a minute, made while the party walks there. The offers are seeded per town and dungeon, as the draft's were.
- **After each fight but the last: one card for the party.** Three cards are shown, each for a different citizen; the party keeps one. "Firebolt for Hazel, or Cover for Bram?" is the decision.
- **What can be offered to a citizen:**
  - their pack's own class cards again (every town has these);
  - for a villager, the plain cards every town starts with (Quick Jab, Cleave, Weaken, Expose, Rally);
  - whatever the town has unlocked for that class. This is where the class buildings, research and dungeon finds pay off.
- Cards added are for the run. Whether a citizen can keep one or two "signature" cards between runs is a question for the unlockables (§8).

## 5. Healing

**The finding that shaped this section: in a dungeon where wounds carry over, healing is worth more than anything else.** Swapping one Guard for a Hearthkeeper took an orange run from 64% to 96% and a red run from 10% to 57%, with about 85 health healed over the run (§6.3). A Hearthkeeper with the healing taken out was worth about the same as the Guard.

The earlier design did not show this, because one or two heal cards were spread through a shared deck of 14. In a healer's own deck they come round every other turn.

So healing gets three rules:

1. **A heal is spent until the party rests.** Once played, the card leaves that citizen's deck until the next rest room or landing. (Withering alone brings it back every fight.)
2. **One of each healing card in a deck.** Offers never show a heal the citizen already holds.
3. **The base pack has one heal** (Kindle). More healing is an unlock.

This also closes the oldest trick in the genre: keeping one harmless creature alive while the party heals to full.

It applies to every heal: the villagers' Share Rations and Strong Drink, and today's Mend and Second Wind.

Even with all three rules a Hearthkeeper is the strongest single addition to a party. That is acceptable (red and purple were always "built to need classes"), but the skulls must be tuned with it in mind (§6.2).

## 6. What the numbers say

120 runs a line, so read each figure as within about 8 points. The bot plays sensibly, never uses supplies and cannot stand a downed citizen up, as before.

### 6.1 The door, and rewards

| | Packs only | One each at the door | Two each at the door | Rewards only | One at the door + rewards |
|---|---|---|---|---|---|
| 🟢 Green, 4 villagers | 64% | 86% | 90% | 85% | 88% |
| 🟡 Yellow: guard, 2 villagers, archer | 52% | 61% | 66% | 52% | 60% |
| 🔴 Red: guard, hearthkeeper, archer, wizard | 34% | 62% | 62% | 46% | 72% |
| 🟣 Purple: the same four, veterans | 28% | 32% | 31% | 37% | 43% |

- **A door step is worth keeping.** One pick each is worth about 20 points at green and at red. Without it a green dungeon (three fights, so two rewards) gives too little to build with.
- **A second door pick adds almost nothing** (+4, +5, 0, −1). A full door draft would cost time for no gain.
- **Rewards and the door pick together are best** at the long skulls.

Hence §4: one each at the door, one for the party after each fight.

### 6.2 Clear rates by skull

One pick each at the door and a pick after each fight. "Shared draft" is the earlier design for the same four citizens.

| Skull | Party | Class decks | Shared draft | Target (`DUNGEON_CONTENT.md` §6.2) |
|---|---|---|---|---|
| 🟢 Green | 4 villagers | 87% | 95% | about 90% |
| 🟢 Green | guard, 2 villagers, archer | 86% | 92% | |
| 🟡 Yellow | 4 villagers | 64% | 85% | |
| 🟡 Yellow | guard, 2 villagers, archer | 67% | 69% | about 75% |
| 🟡 Yellow | 2 guards, 2 archers | 89% | 73% | |
| 🟠 Orange | guard, 2 villagers, archer | 41% | 53% | |
| 🟠 Orange | 2 guards, 2 archers | 73% | 62% | 52% to 69% |
| 🟠 Orange | guard, hearthkeeper, archer, wizard | 96% | 66% | |
| 🔴 Red | 2 guards, 2 archers | 8% | 26% | |
| 🔴 Red | guard, hearthkeeper, archer, wizard | 69% | 38% | 20% to 40% |
| 🟣 Purple | 2 guards, 2 archers | 17% | 17% | |
| 🟣 Purple | guard, hearthkeeper, archer, wizard | 43% | 25% | 3% to 24% |

Reading it:

- **Green and yellow are where they should be** for the parties a town will really send.
- **Fights are the right length:** about 10 to 12 citizen turns each, as before. (An early Villager pack with four blocks in ten cards took 15 to 28; hence five Swings.)
- **A party with a Hearthkeeper is too strong for today's skulls** from orange up. Without one, red is nearly closed. The skull scaling was tuned for the shared draft and needs retuning once the unlockables exist; until then these two columns are the honest picture.
- **Before the class buildings exist** (they are frozen until after 1.0), a town has Guards, Archers and villagers. That is enough for green to orange.

### 6.3 What healing is worth

Trained citizens; a Hearthkeeper in place of one of two Guards.

| | 🟠 Orange | 🔴 Red | Health healed a run |
|---|---|---|---|
| 2 guards, 2 archers | 64% | 10% | 0 |
| With a Hearthkeeper, heals spent until a rest (proposed) | 96% | 57% | 85 |
| …heals only wither (back every fight) | 98% | 66% | 104 to 122 |
| …heals never wither | 99% | 66% | 116 to 133 |
| A Hearthkeeper with no healing | 75% | 9% | 0 |

## 7. What it takes to build

- **The engine change is small.** The simulator runs one deck per citizen on the real engine with no new rule: only the citizen whose turn it is plays cards, so it points the battle's deck at that citizen's own deck as the turn starts, and the engine draws, discards and reshuffles it as it would the shared one. The build keeps a deck per citizen on the battle and makes that switch when the turn advances. Both copies of the engine change together; the hand on screen reads the same field as today.
- **Frozen on the battle**, like the starting health: battles already stored replay with the shared deck they were fought with.
- **The run holds each citizen's deck** (the pack, plus what was added, minus heals spent). `dungeon_runs.deck` was reserved for this.
- **Charisma must reach the battle unit** (`DUNGEON_CONTENT.md` §2 row 1). The Hearthkeeper's cards and Strong Drink read it.
- **Assumes the agreed rule change** that weak and vulnerable wear off each turn.
- **Quests, camps and raids** keep the home deck until this has been played in dungeons; then they move across and the deck builder becomes each citizen's cards.

## 8. Open, for the next round (the unlockables)

1. **What unlocks do.** They widen what a citizen can be offered. Should a citizen also keep one or two signature cards between runs, chosen at home?
2. **Retune the skulls** with unlocks in the pool and a healer assumed at red and purple.
3. **Upgrading or removing a basic at a rest.** Passed over on 2026-11-18 when decks were drafted; starter decks full of basics are what makes it worth having.
4. **Wizard and Hearthkeeper before their buildings.** They are new careers that arrive with the Wizard's Tower and Hearth Shrine. Until then their packs cannot be played. Is a Scholar allowed a part of the Wizard pack?
5. **A card per career** in place of a card per kind of job.
6. **The Scout's Ranger fork:** Villager pack with the travel card, or the Archer pack?
