# Class decks: one deck per citizen

> **Being replaced (2026-11-20).** The owner has chosen tactics battles on a board in place of cards (`docs/TACTICS.md`). What is here still runs dungeons until Phase 3 of that roadmap. What carries over: the classes, the two class buildings and their level ladders, every card's formula (they become abilities), and the healing findings. What does not: decks, the door pick, the card after a fight, honing and prepared cards.

Status: **agreed with the owner on 2026-11-19 and built the same day** (§7 says where). In a dungeon every citizen plays their own deck; the Wizard and Hearthkeeper careers and their two buildings exist; cards can be prepared or set aside, and honed. It replaces the door draft of `docs/DUNGEONS.md` §3.4 and the "Requires Wizard" rules of `docs/DUNGEON_CONTENT.md` §3.3. Quests, camps and raids still use the home deck. The same file is in both repos.

Every number comes from `scripts/class_deck_sim.js` (server repo), which plays whole dungeon runs on the real combat engine. It holds no numbers of its own: the cards, packs and unlock ladders are read from `lib/class_cards.js` and the skulls from `lib/dungeon_defs.js`. It builds on `scripts/dungeon_balance_sim.js` (the same bot, creatures and room plans). To reproduce:

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
node scripts/class_deck_sim.js heal 200
```

```bash
node scripts/class_deck_sim.js skulls 400
```

```bash
node scripts/class_deck_sim.js hone 300
```

```bash
node scripts/class_deck_sim.js sweep 150 red
```

## 1. What was agreed (2026-11-19)

The owner asked players of roguelite card games; most said each class should have its own deck.

| Question | Decision |
|---|---|
| Whose deck? | **One deck per citizen**, built from their class's base pack. Two Guards start with the same pack; what is added goes to a named citizen. |
| Citizens with no fighting class | **A Villager pack**, with one trade card from the citizen's job. Any four adults can still enter a green dungeon. |
| The door draft | **Replaced.** Each citizen keeps one card of three at the door, and the party keeps one card of three after each fight (§4). The owner left this to the numbers: §6.1. |
| Where it applies | **One system everywhere in time:** dungeons first, then quests, camps and raids, replacing the home deck. |
| What unlocks do | **They widen what a citizen can be offered**, and the player chooses which of a town's cards are **prepared** (offered) and which are set aside (§4.1). |
| The Wizard and Hearthkeeper | **Built now**, with their buildings. The owner lifted the 1.0 freeze on new building types for the Hearth Shrine and the Wizard's Tower (§4.3). |
| Trade cards | **One card per kind of job** is enough for now (§3, Villager). |
| Upgrading a card | **Honing.** The owner asked for a word of the game's own; a honed card is marked ✦ (§4.2). |

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

- **At the door: one card each.** Every citizen is shown three cards of their own and keeps one, or passes. Four picks, about half a minute. The offers are seeded per town and dungeon, so reloading shows the same three.
- **After each fight but the last: one card for the party, or a hone.** Three cards are shown, each for a different citizen; the party keeps one. "Firebolt for Hazel, or Cover for Bram?" is the decision. In place of the card, the party may hone a card it already holds (§4.2).
- **At a rest room: the party rests, and hones a card.**
- **What can be offered to a citizen:**
  - their pack's own class cards again (every town has these): Cover, Shove and Heavy Blow for a Guard, and so on. The plain attack and block are never offered;
  - for a villager, their trade card and the plain cards every town starts with (Quick Jab, Cleave, Weaken, Expose, Rally);
  - whatever the town has unlocked for that class (§4.3), less what the player has set aside (§4.1).
- Cards added are for the run.

### 4.1 Preparing cards

Unlocks widen the pool, and a wide pool makes it less likely that the card a player wants turns up among three. So the player chooses.

- **Class cards** (the path screen's "Class cards" button, and Dev Tools → Dungeons) shows every class in a tab: its pack, the cards it can be offered, and the cards the town has not unlocked yet with how to get each.
- Every card that can be offered has a **Prepared** tick. Unticked, the card is set aside and never offered. It can be ticked again at any time, and applies to the next cards offered.
- The plain attack and block of a pack cannot be set aside (they are never offered anyway).
- **With everything set aside, the pack's own cards are offered**, so a citizen is never shown nothing.
- Stored per town (`settlement_card_prefs`). There is no limit on how many are prepared; a limit ("prepare five") is an easy later rule if narrowing proves too strong.

### 4.2 Honing

The game's word for upgrading a card. A honed card is marked ✦ and is honed until the run ends.

- **What it does.** The card's damage, block, healing and lasting effects are about a third greater (×1.3). A card with none of those (it only draws, say) costs one less instead. What else the card does stays as it was: a honed Parting Shot still steps back one place.
- **A rest room** rests the party and hones one card of one citizen ("Rest, and hone a card"; "Rest only" skips the hone).
- **After a fight**, "Hone a card instead" hones one card in place of the card on offer.
- One copy is honed: a Guard with three Strikes who hones one holds two Strikes and a Strike ✦. A honed card cannot be honed again.
- A honed card is a card of its own (`g_strike_honed`), so the combat engine needed no new rule.

**Why a rest hones as well, and is not a choice between the two.** The first build offered the genre's usual choice: rest, or hone in place of resting. The simulator showed nobody should take it: honing one card in place of a rest cost 15 to 20 points of clear rate at every skull, and honing a card for every citizen at +50% was still worse than resting (§6.4). A rest gives the whole party 30% of its health; a third more on one card of forty cannot match that. Against the card after a fight, honing is about even, so that is where the choice was put.

### 4.3 What a town unlocks, and how

A class building's level unlocks cards for its class. The Watchtower does this for Guards and Archers; the two new buildings for their own.

| Building | Level 1 | Level 2 | Level 3 | Level 4 |
|---|---|---|---|---|
| Watchtower (exists) | Stand Fast, Aimed Shot | Guard's Oath, Pin Down | Hammer Blow | Hold the Line, Hail of Arrows |
| Hearth Shrine | Ember Ward | Banish the Blight, Hearthlight | Rekindle | |
| Wizard's Tower | Scorch, Ice Ward | Frost Lance, Thunderclap | Fireball, Deep Freeze, Chain Lightning | |

Eight more cards come with an older general card of the same name, once the town owns it (won in battle, found on a quest, taught by an Allied village): Shield Bash and Bulwark (Guard), Arrow Rain and Hamstring (Archer), Battle Cry (Hearthkeeper), Venom Edge, Second Wind and Smoke Bomb (any villager). A card can also be granted outright (a dungeon find, an admin), which is where boss chests will reach in.

**The two buildings and their careers**

| | Hearth Shrine | Wizard's Tower |
|---|---|---|
| From | Village | Town |
| Cost | 120 timber, 140 stone, 60 wealth | 180 timber, 220 stone, 150 wealth |
| Levels | 3. Level 3 needs a Town and 15 bronze | 3. Level 2 needs 20 bronze; level 3 a City and 20 steel |
| Opens the career | Hearthkeeper (intelligence, charisma) | Wizard (intelligence, agility) |
| Seats | one a level | one a level |
| In the Home scene | Town, front row ("Ember Court") | Outskirts, front row ("Lonely Rise") |

Each career is a fighting class like Guard and Archer: a tree of eleven nodes, a secret node (Star Reader for a bookish Wizard, Old Rites for a Hearthkeeper who is a born host), and experience from battles. A faint-of-heart citizen suits neither. Upgrades are priced as other buildings' are (level 2 is twice the base cost), plus the materials above. These costs are a first setting; nothing has been tuned against them.

## 5. Healing

**The finding that shaped this section: in a dungeon where wounds carry over, healing is worth more than anything else.** Swapping one Guard for a Hearthkeeper takes an orange run from 21% to 60% and a red run from 6% to 44%, with about 80 health healed over the run (§6.3). A Hearthkeeper with the healing taken out is worth the same as the Guard.

The earlier design did not show this, because one or two heal cards were spread through a shared deck of 14. In a healer's own deck they come round every other turn.

So healing gets three rules:

1. **A heal is spent until the party rests.** Once played, the card leaves that citizen's deck until the next rest room or landing. (Withering alone brings it back every fight.)
2. **One of each healing card in a deck.** Offers never show a heal the citizen already holds.
3. **The base pack has one heal** (Kindle). More healing is an unlock.

This also closes the oldest trick in the genre: keeping one harmless creature alive while the party heals to full.

It applies to every heal: the villagers' Share Rations and Strong Drink, and today's Mend and Second Wind.

Even with all three rules a Hearthkeeper is the strongest single addition to a party. That is acceptable (red and purple were always "built to need classes"), and the skulls are now tuned with a healer assumed from orange up (§6.2).

## 6. What the numbers say

150 to 400 runs a line, so read each figure as within about 5 to 8 points. The bot plays sensibly, never uses supplies and cannot stand a downed citizen up, so the clear rates are a floor. Every table uses the skull numbers as retuned in §6.2.

### 6.1 The door, and rewards

Every building at its top level, so the pool is at its widest; no honing.

| | Packs only | One each at the door | Two each at the door | Rewards only | One at the door + rewards | …and nothing unlocked |
|---|---|---|---|---|---|---|
| 🟢 Green, 4 villagers | 64% | 87% | 90% | 83% | 91% | 95% |
| 🟡 Yellow: guard, 2 villagers, archer | 49% | 56% | 71% | 72% | 73% | 80% |
| 🟠 Orange: guard, hearthkeeper, archer, wizard | 48% | 58% | 67% | 55% | 63% | 51% |
| 🔴 Red: the same four | 25% | 45% | 46% | 38% | 47% | 23% |
| 🟣 Purple: the same four, veterans | 7% | 18% | 17% | 19% | 20% | 12% |

- **A door step is worth keeping.** One pick each is worth 7 to 23 points. Without it a green dungeon (three fights, so two rewards) gives too little to build with.
- **One at the door with rewards does as well as two at the door** (91, 73, 63, 47, 20 against 90, 71, 67, 46, 17), and spreads the choosing through the run. A full door draft would cost time for no gain.
- **Unlocks matter most where they should:** from orange up they are worth 8 to 24 points.
- **For villagers a wider pool is slightly worse** (green 91% against 95%, yellow 73% against 80%): the three older cards a town picks up (Venom Edge, Second Wind, Smoke Bomb) are weaker than the plain cards they crowd out. This is what the Prepared ticks are for (§4.1): a player who sets them aside gets the better figure.

Hence §4: one each at the door, one for the party after each fight.

### 6.2 Clear rates by skull, retuned

With a deck each, a healer and the class buildings' cards, the skulls as first set were too easy from orange up: a party with a Hearthkeeper cleared orange 97% of the time, red 61% and purple 48%, against targets of about 70%, 40% and 25%. So creature health and strength were raised at those three (`lib/dungeon_defs.js`, and the defaults under Dev Tools → Life → Dungeons). Green and yellow were already right and are unchanged.

| Skull | Before | Now |
|---|---|---|
| 🟢 Green | +50% health, +40% strength | unchanged |
| 🟡 Yellow | +75% / +60% | unchanged |
| 🟠 Orange | +100% / +80% | **+125% / +100%** |
| 🔴 Red | +125% / +100% | **+150% / +105%** |
| 🟣 Purple | +175% / +140% | **+200% / +150%** |

Each skull is read with the party and buildings a town sending it would really have. The first line of each is the party it is tuned for. One pick each at the door, a card after each fight, a rest that also hones. 400 runs a line.

| Skull | Party, and what the town has built | Clears | Citizen turns a fight | Target |
|---|---|---|---|---|
| 🟢 Green (villagers) | 4 villagers; nothing built | 94% | 10 | about 90% |
| | guard, 2 villagers, archer; Watchtower 1 | 88% | 10 | |
| 🟡 Yellow (novices) | guard, 2 villagers, archer; Watchtower 1 | 77% | 10 | about 75% |
| | 2 guards, 2 archers; Watchtower 2 | 94% | 9 | |
| | 4 villagers; nothing built | 60% | 13 | |
| 🟠 Orange (trained) | guard, hearthkeeper, 2 archers; Watchtower 2, Shrine 1 | 73% | 11 | about 70% |
| | all four classes; Watchtower 2, Shrine 1, Tower 1 | 72% | 13 | |
| | 2 guards, 2 archers; Watchtower 2 (no healer) | 33% | 10 | |
| 🔴 Red (trained) | all four classes; Watchtower 3, Shrine 2, Tower 2 | 38% | 12 | about 40% |
| | guard, hearthkeeper, 2 archers; Watchtower 3, Shrine 2 | 30% | 10 | |
| | 2 guards, 2 archers; Watchtower 3 (no healer) | 6% | 9 | |
| 🟣 Purple (veterans) | all four classes; every building at its top level | 25% | 11 | about 25% |
| | guard, hearthkeeper, 2 archers; top levels | 19% | 10 | |
| | 2 guards, 2 archers; Watchtower 4 (no healer) | 7% | 9 | |

Reading it:

- **Every skull now sits on its target** for the party it is meant for.
- **Fights are the right length:** 9 to 13 citizen turns each.
- **A town without a Hearth Shrine can still try orange** (one run in three), and should not expect red. That is the Shrine's reason to exist; it comes at Village tier so the wall is met early.
- **A Wizard in place of a second Archer** is worth about the same at orange and 6 to 8 points at red and purple, where the Tower's upper cards are.
- **Four villagers at yellow clear 60%:** a town can go one skull up without classes, at a price.
- `node scripts/class_deck_sim.js sweep 150 red` prints a grid of health against strength for one skull, for the next time these are tuned. Strength is the sharper of the two: +20% strength costs about as much clear rate as +50% health.

### 6.3 What healing is worth

Trained citizens; a Hearthkeeper in place of one of two Guards; every building at its top level. 200 runs.

| | 🟠 Orange | 🔴 Red | Health healed a run |
|---|---|---|---|
| 2 guards, 2 archers | 21% | 6% | 0 |
| With a Hearthkeeper, heals spent until a rest (as built) | 60% | 44% | 76 to 82 |
| …heals only wither (back every fight) | 68% | 56% | 99 to 116 |
| …heals never wither | 78% | 71% | 141 to 161 |
| A Hearthkeeper with no healing | 23% | 6% | 0 |

The Hearthkeeper's worth is its healing and nothing else: with the heals taken out it is a Guard. The three rules of §5 halve the health healed and take 18 to 27 points off what unlimited healing would give.

### 6.4 Honing

The party each skull is tuned for; 300 runs. "When healthy" means the party stands at 70% of its health or better when it reaches the rest room.

| Rule | 🟢 | 🟡 | 🟠 | 🔴 | 🟣 |
|---|---|---|---|---|---|
| No honing: a rest room only rests | 94% | 81% | 68% | 38% | 19% |
| Hone one card **in place of** resting, when healthy (first build) | 75% | 54% | 46% | 25% | 15% |
| Hone a card for every citizen in place of resting, when healthy | 77% | 53% | 49% | 29% | 15% |
| …the same, with honing at +50% | 79% | 64% | 51% | 27% | 19% |
| …always, healthy or not | 78% | 52% | 8% | 3% | 1% |
| **Rest and hone one card (as built)** | 94% | 79% | 70% | 39% | 22% |
| After a fight: always hone, never take the card | 93% | 72% | 69% | 40% | 27% |
| After a fight: cards in the first half of the run, hones after | 94% | 72% | 72% | 42% | 25% |
| No cards and no hones after fights (door pick only) | 90% | 62% | 67% | 29% | 20% |

- **Honing in place of a rest loses about 20 points from green to orange** (and most of what there is to lose above), even for a healthy party, even with a card for everyone at +50%. It was a choice with a wrong answer, so it was removed: a rest hones as well.
- **Honing with a rest makes no measurable difference** (−2 to +3 points, inside the noise). It is there for the pleasure of it, not for balance.
- **After a fight, a hone and a card are about even:** a hone is a little worse at yellow (short runs, weak basics), a little better at red and purple (long runs: a honed card is played many times, and it does not thicken the deck). That is a real choice, which is why it sits there.
- At ×1.3 the two are balanced. At ×1.5 honing wins at every skull from orange up, so it stays at ×1.3.

## 7. How it is built

| Piece | File |
|---|---|
| The cards (59, each with a honed form), the packs, trade cards, unlock ladders, what a citizen can be offered, honing, the seed into `card_templates` | server `lib/class_cards.js` |
| A run's decks: the start, the door, rewards, picks, heals spent and restored, honing, the Class cards screen's data, Prepared | server `lib/dungeon_decks.js` |
| The run: the door and reward as pending choices, a rest that hones | server `lib/dungeons.js`, `routes/dungeons.js` |
| A deck per citizen in a battle | server `lib/combat_resolver.js` (`_buildDecks`, `_pointDeck`) |
| `dungeon_runs.deck` and `draft`; `settlement_card_prefs` | server `migrations/0NN_dungeons.sql` |
| The two careers and their traits | server `lib/careers/classes.js`, `lib/careers/traits.js` |
| The two buildings (and their place in building time and upkeep) | server `buildings.js`, `lib/construction.js`, `lib/upkeep.js` |
| The door, the reward, a citizen's deck, honing, Class cards | frontend `js/dungeons.js`, `css/dungeons.css` |
| The buildings' plots and looks in the Home scene | frontend `js/settlement-view.js`, `js/villager-engine.js`, `js/citizens.js` |
| Tests | server `scripts/dungeons_test.js` (243 checks), frontend `verify/dungeons_proofs.js` (96) |

- **The combat engine did not change.** Only the citizen whose turn it is plays cards, so the server keeps a deck for each citizen on the battle (`battle.decks`) and points the battle's deck at the acting citizen's as the turn advances. The engine draws, discards and reshuffles that deck as it did the shared one, and the hand on screen reads the same field as before. Both copies of the engine are untouched.
- **Frozen on the battle**, like the starting health (`combat_mods.dungeon.decks`): a battle replays with the decks it was fought with.
- **Every citizen has a deck, even an empty one.** A citizen whose every card is spent ends their turn; they are never handed someone else's hand. (The tests caught exactly that.)
- **Class cards stay out of the home collection**, its random drops and the deck builder: they are marked `metadata.dungeon` in `card_templates`. They are written once at start-up and an admin's later edit in the card editor is kept.
- **Charisma reaches the battle unit** in a dungeon; the Hearthkeeper's cards and Strong Drink read it.
- **Not built:** the agreed rule change that weak and vulnerable wear off each turn (the simulator assumes it; the game does not do it yet, so marks and weakness last longer in play than in the numbers). Quests, camps and raids keep the home deck until this has been played in dungeons.

## 8. Open

1. **A limit on prepared cards.** Today any number can be set aside, so a town can narrow a class to its three best cards. If that proves too strong: "prepare at least five", or a fixed number of slots.
2. **Signature cards.** Should a citizen keep one or two cards between runs, chosen at home?
3. **Removing a card.** Honing is in; thinning a deck (dropping a basic at a rest) is not. The numbers say deck size matters less than healing, so it has not been missed.
4. **Research for the two buildings.** They need none today. The Library could gate their upper levels, as Stone Forts gates the walls.
5. **A card per career** in place of a card per kind of job (the owner: the kinds will do for now).
6. **The Scout's Ranger fork:** Villager pack with the travel card, or the Archer pack?
7. **Art.** Both buildings stand as the placeholder hut until they have art in `assets/images/buildings`.
8. **The buildings' costs** are untuned (§4.3).
