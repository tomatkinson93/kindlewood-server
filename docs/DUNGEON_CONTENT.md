# Dungeon content plan: classes, cards, creatures, floors, events and treasure

Status: **proposal, 2026-11-15, with the owner's decisions of the same day and of 2026-11-18 (§9). None of the content here is built;** the run itself is (`docs/DUNGEONS.md` §12). Companion to `docs/DUNGEONS.md`. The same file is in both repos.

Every number below was produced by `scripts/dungeon_balance_sim.js` (server repo), which plays whole dungeon runs on the real combat engine with a card-playing bot. The proposed cards and creatures live as data in that script. To reproduce:

```bash
node scripts/dungeon_balance_sim.js cards
```

```bash
node scripts/dungeon_balance_sim.js monsters
```

```bash
node scripts/dungeon_balance_sim.js tiers 300
```

```bash
node scripts/dungeon_balance_sim.js rules 300
```

## 1. What the numbers say, in short

1. **Today's creatures are far too weak for a dungeon.** With creatures at today's strength or a little above (up to +75% health at purple), the suggested party cleared every skull colour 98–100% of the time. Dungeon creatures need **+50% health at green, rising to +175% at purple** (§5).
2. **Party size decides almost everything.** Each citizen brings their own turn, hand and 3 energy. One citizen short, the clear rate collapses (yellow: 78% with four, 4% with three). **Decided: every dungeon requires a party of exactly four.**
3. **The draft matters more than any card.** In an orange dungeon, a drafted deck cleared 54% of runs; the default home deck (5 Strike, 5 Defend, 2 Quick Jab, 1 Rally) cleared 13%.
4. **Class cards must only be drawn by citizens who can play them.** With that rule a four-class party cleared 67% of orange runs; with class cards landing in anyone's hand it cleared 55%.
5. **Suggested lengths:** green 3 fights, yellow 4, orange 6, red 7, purple 9 (§6). That is 5 to 20 minutes of fighting.

## 2. Things in today's combat this plan depends on

Found while building the simulator. The first four are worth fixing whether or not dungeons are built.

| # | What happens today | Where | Proposed |
|---|---|---|---|
| 1 | **Charisma never reaches a battle.** The battle unit has no charisma, so Rally and Battle Cry scale as if it were 0. | `combat_engine.statsFromCitizen` | Copy charisma onto the unit. Needed before any charisma class exists. |
| 2 | **A weapon's dice do not add to card damage.** Only its stat bonus counts. Weapons as dungeon rewards are worth little until this changes. | `card_combat.dealDamage` | Add the weapon's average roll to attack cards. |
| 3 | **Block does nothing against Marsh Rat, Wild Fox and Fungal Toad.** They have no move list, so they use the old attack, which ignores block. | `combat_engine.enemyAct` | Give all three a move (the simulator does). |
| 4 | **Flat numbers in creature moves do not scale** with the health and strength modifiers. | enemy `moves` | Write damage as a strength or agility formula. |
| 5 | **Weak and vulnerable never wear off, and block never expires.** | `card_combat` | Weak and vulnerable drop by 1 at the start of the bearer's turn. In the simulation this changed clear rates by only a few points, because the bot does not stack them on purpose; a player would. Low urgency. |
| 6 | **Focus is free and gives 2 energy**, so in a draft it is always the right pick. | card `focus` | Make it wither (once per battle). Also a few points in the simulation. |
| 7 | **Cards have no class requirement.** | `card_engine.canPlay` | `requires_class` on the card (§3.3). |
| 8 | **Creatures have no family** (beast, brigand, withered, fey). | `enemy_definitions` | A `family` column: used for themes and for cards such as Banish the Blight. |

## 3. Classes

### 3.1 The list

Three fighting classes are in the game already (Guard, Archer, and the Scout's Ranger fork). The plan adds two fighting classes and four casting classes, each built like Guard and Archer: a career with a skill tree, a main stat and a second stat.

| Class | Usual name | Main / second stat | Role | Schools |
|---|---|---|---|---|
| **Guard** (exists) | fighter | strength / endurance | Holds the front, shields others | — |
| **Archer** (exists) | ranger | agility / strength | Picks any target, hits the whole line | — |
| **Skirmisher** | rogue | agility / intelligence | Poison, free cards, extra loot | — |
| **Wildheart** | berserker | strength / endurance | Hits hardest when hurt | — |
| **Wizard** | wizard | intelligence / agility | Damage and control | Ember, Frost, Storm |
| **Hearthkeeper** | cleric | intelligence / charisma | Healing, raising the fallen, bane of the Withered | Hearth |
| **Greenspeaker** | druid | intelligence / endurance | Thorns, bark, hexes | Growth, Hex |
| **Minstrel** | bard | charisma / agility | Makes everyone else better: energy, cards, courage | Song |

Notes:

- **Schools are research branches** in the class's building (§3.2), so a town can learn all of them in time. Whether a Wizard must also pick one school at the career fork (level 10) is left for the class spec.
- The names avoid the Phase 5 species careers (Warden, Pathfinder and the rest).
- Intelligence and charisma barely matter in combat today. These classes are what give those stats a use.
- **First release: Guard, Archer, Wizard and Hearthkeeper** (decided). Skirmisher, Wildheart, Greenspeaker and Minstrel follow later; their cards stay in this plan and in the simulator so the balance is already checked.

### 3.2 Where classes train, and how a town gets class cards

**Decided: each class has its own building, and upgrading and researching it is the most direct way to unlock that class's cards.** There will be other ways (below), but the building is the main road.

New building types are on the roadmap's freeze list until 1.0; these arrive with the class release, after it.

| Class | Building | Notes |
|---|---|---|
| Guard, Archer | **Watchtower** (exists) | Already their post (`lib/watchtower.js`). Its levels and a new "Drill" research line unlock their cards. |
| Wizard | **Wizard's Tower** (new) | Available from **Town** tier. Three levels. A research branch for each school: Ember, Frost, Storm. |
| Hearthkeeper | **Hearth Shrine** (new) | Available from **Village** tier. Three levels. One research line, "Rites of the Hearth". |

How the cards unlock (a card is owned by the town once unlocked, as now):

| Step | Wizard | Hearthkeeper | Guard | Archer |
|---|---|---|---|---|
| Building level 1 | Firebolt, Ice Ward | Kindle, Ember Ward | Stand Fast | Aimed Shot |
| First research | Scorch (Ember I), Frost Lance (Frost I) | Banish the Blight | Guard's Oath | Pin Down |
| Building level 2 | Thunderclap | Hearthlight | Hammer Blow | Piercing Arrow |
| Second research | Fireball (Ember II), Deep Freeze (Frost II) | — | — | — |
| Building level 3 + last research | Chain Lightning (Storm) | Rekindle | Hold the Line | Hail of Arrows |

So a Wizard's Tower at level 1 gives a town two wizard cards on the day it is built, and a fully upgraded and researched one gives all eight.

Other ways to the same cards, so the building is never the only road:

- **Dungeons:** elites and bosses of orange and above can drop a class card the town does not own yet, including the ★ cards, ahead of the building.
- **Allied villages** teach cards for wealth, as now (`lib/cards.js`).
- **Career levels:** a citizen reaching level 10 in a class could unlock one card for the town. Optional; not needed if the building ladder feels right.

Research uses the existing system (`lib/research_defs.js`: a project has a cost, prerequisites and can name the building it needs), so this is new content, not a new mechanic.

### 3.3 "Requires Wizard"

> **Superseded on 2026-11-19 by `docs/DUNGEON_CLASS_DECKS.md`:** each citizen has their own deck, so a class card is never in the hand of someone who cannot play it, and this section's rules are not needed. The class cards of §3.4 below stand as the pool of **unlockable** cards; the base packs are in the new document.

Earlier design, kept as the record:

- A class card can only be played on the turn of a citizen of that class.
- **In the hand:** when a citizen's hand is drawn, a class card they cannot play is set aside and another is drawn in its place. Nobody ever holds a dead card.
- **In the draft** (the point raised on 2026-11-15, to keep for the class release): class cards are offered **only for classes in the party**, and when the party has classes, **one of the three cards in every offer is a class card** for one of them. A town that owns Fireball but sends no Wizard never sees it.
- A deck should not be mostly one class's cards, or the others have little to draw. The draft's first two offers (an attack, then a block) stay classless.

### 3.4 The cards

**The yardstick.** For a trained citizen (main stat 11, second stat 10, others 8, combat 4), **Strike deals 14 for 1 energy** and Defend blocks 13. "Value" below is the simulator's points per energy against Strike (damage dealt, block that stops a real hit, healing on a wounded ally, with three enemies and four allies on the field). **Class cards aim for 105–125% of Strike**; rare cards (★) may reach 130% and usually wither.

Formulas use the existing card language (`lib/card_formula.js`), so every card here can be entered in the card editor as it stands, apart from the class requirement.

**Guard** (strength / endurance)

| Card | Cost | Effect for a trained Guard | Formula | Value |
|---|---|---|---|---|
| Stand Fast | 1 | 16 block | `block: endurance*0.9 + combat*0.6 + 5` | 114% |
| Guard's Oath | 1 | 15 block on an ally | `block: endurance*0.8 + combat*0.6 + 5` | 107% ¹ |
| Hammer Blow | 2 | 26 damage to the front enemy, weak 2 | `damage: strength*1.2 + combat*1.2 + 8` / `debuff weak: 2` | 107% |
| ★ Hold the Line | 2, withers | 13 block on everyone | `block: endurance*0.7 + combat*0.4 + 4` | strong ¹ |

**Archer** (agility / strength)

| Card | Cost | Effect | Formula | Value |
|---|---|---|---|---|
| Aimed Shot | 1 | 16 damage, any target | `damage: agility*0.8 + combat*0.9 + 4` | 114% |
| Piercing Arrow | 2 | 16, then 10, then 6 down the line | same formula as Aimed Shot with `combat*0.8`; pierce, falloff 0.6 | 114% |
| Pin Down | 1 | 8 damage, slow 3, weak 3 | `damage: agility*0.4 + combat*0.4 + 2` / `slow: 3` / `debuff weak: 3` | 107% |
| ★ Hail of Arrows | 3, withers | 17 damage to every enemy | `damage: agility*0.8 + combat*0.8 + 5` | 121% |

**Skirmisher** (agility / intelligence)

| Card | Cost | Effect | Formula | Value |
|---|---|---|---|---|
| Backstab | 1 | 14 damage, +5 if the target is vulnerable | `damage: agility*0.7 + combat*0.8 + 3` / `if target_has vulnerable: damage: 5` | 100% (136%) |
| Poisoned Blade | 1 | 8 damage, poison 4 | `damage: agility*0.4 + combat*0.4 + 2` / `poison: intelligence*0.2 + 2` | 114% |
| Slip Away | 0 | 6 block, draw a card | `block: agility*0.4 + 2` / `draw: 1` | free |
| ★ Cut Purse | 1 | 12 damage; 15 wealth if it is the killing blow | `damage: agility*0.6 + combat*0.6 + 3` / `if lethal: gold: 15` | 86% + loot |

**Wildheart** (strength / endurance)

| Card | Cost | Effect | Formula | Value |
|---|---|---|---|---|
| Reckless Swing | 1 | 20 damage, discard a card | `damage: strength*1.0 + combat*0.8 + 6` / `discard: 1` | 121% |
| Wounded Fury | 1 | 14 damage, +7 below half health | `damage: strength*0.6 + combat*0.8 + 4` / `if self_hp < 50: damage: strength*0.4 + 3` | 100% (150%) |
| Sweeping Blow | 2 | 11 damage to every enemy | `damage: strength*0.55 + combat*0.4 + 3` | 118% |
| ★ War Cry | 0, withers | +1 energy, draw a card | `energy: 1` / `draw: 1` | free |

**Wizard** (intelligence / agility)

| Card | School | Cost | Effect | Formula | Value |
|---|---|---|---|---|---|
| Firebolt | Ember | 1 | 16 damage | `damage: intelligence*0.8 + combat*0.6 + 5` | 114% |
| Scorch | Ember | 1 | 7 damage, burn 4 (as poison) | `damage: intelligence*0.4 + 3` / `poison: intelligence*0.3 + 1` | 107% |
| ★ Fireball | Ember | 2 | 12 damage to every enemy | `damage: intelligence*0.65 + combat*0.4 + 3` | 129% |
| Frost Lance | Frost | 1 | 12 damage, slow 4, weak 2 | `damage: intelligence*0.6 + combat*0.5 + 3` / `slow: 4` / `debuff weak: 2` | 121% |
| Ice Ward | Frost | 1 | 16 block on anyone | `block: intelligence*0.9 + combat*0.4 + 4` | 114% |
| ★ Deep Freeze | Frost | 2, withers | 14 damage, the target loses its next turn | `damage: intelligence*1.0 + 3` / `stun: 1` | 82% + a turn ² |
| ★ Chain Lightning | Storm | 2 | 15, then 10, then 7 down the line | `damage: intelligence*0.8 + combat*0.5 + 4`; pierce, falloff 0.7 | 118% |
| Thunderclap | Storm | 2 | 6 damage, slow 3 and weak 2 on every enemy | `damage: intelligence*0.4 + 2` / `slow: 3` / `debuff weak: 2` | 118% |

**Hearthkeeper** (intelligence / charisma), school of the Hearth

| Card | Cost | Effect | Formula | Value |
|---|---|---|---|---|
| Kindle | 1 | Heal 15 | `heal: intelligence*0.7 + charisma*0.3 + 4` | 118% |
| Hearthlight | 2 | Heal everyone 8 | `heal: intelligence*0.4 + charisma*0.2 + 2` | 126% |
| Ember Ward | 1 | 14 block on anyone; their later blocks +2 | `block: intelligence*0.6 + charisma*0.3 + 4` / `buff block_bonus: 2` | 121% |
| Banish the Blight | 1 | 13 damage, +7 against the Withered | `damage: intelligence*0.6 + combat*0.5 + 4` / `if target_species withered: damage: intelligence*0.4 + 3` | 93% (143%) |
| ★ Rekindle | 2, withers | Heal 26: the best card for standing a fallen friend up | `heal: intelligence*1.2 + charisma*0.5 + 8` | 98% |

For comparison, Mend (owned by everyone) heals 10. A Hearthkeeper is the difference between a downed citizen coming back on 10 health and on 26.

**Greenspeaker** (intelligence / endurance)

| Card | School | Cost | Effect | Formula | Value |
|---|---|---|---|---|---|
| Thornlash | Growth | 1 | 11 damage, poison 3 | `damage: intelligence*0.5 + combat*0.5 + 3` / `poison: 3` | 113% |
| Barkskin | Growth | 1 | 13 block and heal 3, on anyone | `block: intelligence*0.5 + endurance*0.4 + 3` / `heal: 3` | 116% |
| ★ Wild Growth | Growth | 2, withers | Everyone heals 6 and gains 5 block | `heal: intelligence*0.4 + 2` / `block: intelligence*0.3 + 2` | 120% |
| Wither Hex | Hex | 1 | Weak 5 and vulnerable 3 on one enemy | `debuff weak: intelligence*0.3 + 2` / `debuff vulnerable: 3` | 125% |
| ★ Entangle | Hex | 2 | The target loses its next turn; vulnerable 4 | `stun: 1` / `debuff vulnerable: 4` | 68% + a turn ² |

**Minstrel** (charisma / agility), school of Song

| Card | Cost | Effect | Formula | Value |
|---|---|---|---|---|
| Marching Tune | 1 | Everyone's next attack +5 | `buff damage_bonus: charisma*0.3 + 2` | 114% |
| Lullaby | 1 | Weak 7 and slow 3 on one enemy | `debuff weak: charisma*0.4 + 3` / `slow: 3` | 107% |
| Encore | 1 | Draw 2 cards, +1 energy | `draw: 2` / `energy: 1` | 121% |
| Ballad of Home | 1 | Everyone heals 3 and gains 3 block | `heal: charisma*0.2 + 1` / `block: charisma*0.2 + 1` | 125% |
| ★ Rousing Chorus | 2, withers | +3 energy, draw 2 cards | `energy: 3` / `draw: 2` | 125% |

¹ The simulator's test scene aims every enemy at the caster, so block given to others scores low there. On paper Guard's Oath is 107% and Hold the Line is 52 block for 2 energy, which is why it withers.
² A lost turn is scored against a 9-damage brigand. Against a boss that hits for 30 or more it is worth far more, which is why some bosses resist it (§4).

**Existing cards for comparison** (same citizen): Cleave 107%, Second Wind 99%, Defend 93%, Battle Cry 91%, Expose 89%, Mend 79%, Arrow Rain 75%, Weaken 71%, Venom Edge 70%, Shield Bash 64% + a turn, Hamstring 64%. The class cards sit a clear step above these, as asked, without doubling them.

## 4. Creatures and challenge ratings

**Challenge rating (CR)** = √(health × damage per turn) ÷ 10, to the nearest half. Damage per turn is the average over the creature's move cycle against three targets, with poison, lost turns and weakening counted in. For scale, **a trained citizen is about CR 4** (68 health, about 25 damage a turn).

Families: **beast**, **brigand** (stoats, weasels and crows: no playable species), **withered**, **fey**. Creatures marked * are already in the game with these stats.

### Minions (CR 1–1.5)

| Creature | Health | CR | Land | What it does |
|---|---|---|---|---|
| * Marsh Rat | 22 | 1 | marsh, river, plains | Bites |
| Mire Leech | 20 | 1 | marsh, river | Latches on: 4 damage and poison 2 |
| Bramble Sprite (fey) | 16 | 1 | forest, plains | Thorn darts; tangles (slow) |
| Scree Crab | 28 | 1 | mountain, river | Claws the front; hunkers (10 block) |
| Gloom Bat | 18 | 1.5 | mountain, ruins, forest, hills | Bites; screech weakens the whole party |
| Barrow Beetle | 30 | 1.5 | hills, ruins, plains | Pinches the front; shells up |

### Regulars (CR 1–2)

| Creature | Health | CR | Land | What it does |
|---|---|---|---|---|
| * Rot Shaman (withered) | 30 | 1 | ruins | Hexes; heals its allies |
| * Wild Fox | 30 | 1.5 | forest, plains, hills | Lunges |
| * Bog Lurker | 34 | 1.5 | marsh, river | Bite; venom spit |
| * River Pike | 28 | 1.5 | river, marsh | Snap; drags under (vulnerable) |
| * Withered Husk (withered) | 38 | 1.5 | ruins, marsh | Claw; rotting touch (vulnerable) |
| Weasel Cutpurse (brigand) | 30 | 1.5 | plains, ruins, forest | Stabs anyone; hides in smoke |
| Crow Sentinel (brigand) | 34 | 1.5 | hills, mountain, ruins | Pecks; calls the flock (allies hit harder) |
| * Fungal Toad | 42 | 2 | marsh, forest | Slam; poison spores on everyone |
| * Mountain Harpy | 32 | 2 | mountain, hills | Rake; shriek weakens everyone |
| * Thornback Boar | 44 | 2 | forest, plains | Bristles (block); charges the front |
| * Night Wolf | 34 | 2 | forest, plains, hills | Bite; pack howl hits everyone |
| Stoat Brigand (brigand) | 40 | 2 | plains, forest, hills | Cutlass on the front; dirty trick (vulnerable) |
| Adder | 26 | 2 | plains, hills, marsh | Fangs: 5 damage and poison 4 |
| Blight Hound (withered) | 42 | 2 | ruins, marsh, forest | Mauls; howl weakens everyone |
| Reed Snapper | 50 | 2 | river, marsh | Bites the front; into the shell (14 block) |
| Cave Spider | 32 | 2 | mountain, ruins, hills | Venom bite; web (lose a turn) |

### Heavies (CR 3–3.5)

| Creature | Health | CR | Land | What it does |
|---|---|---|---|---|
| * Hill Ogre | 60 | 3 | hills | Club; ground slam (lose a turn) |
| Stoat Bruiser (brigand) | 66 | 3 | plains, forest, hills, mountain | Mauls; shoves the front citizen to the back |
| Husk Brute (withered) | 70 | 3 | ruins, marsh | Smash; rot breath poisons everyone |
| Bog Hulk | 80 | 3.5 | marsh, river | Slam, slam, then mire grip (lose a turn) |

### Elites (CR 4–5)

| Creature | Health | CR | Land | What it does |
|---|---|---|---|---|
| Stoat Captain (brigand) | 110 | 4 | plains, forest, hills | Flurry (two hits); rallies its band; low blow |
| Bog Witch (fey) | 100 | 4.5 | marsh, river, forest | Hex bolt; curses the whole party; heals an ally |
| Husk Knight (withered) | 130 | 5 | ruins, marsh | Cleaver; shield of rot; reaps the whole party |
| Stormcrow | 100 | 5 | mountain, hills | Dives on anyone; gale hits and slows everyone |

### Bosses (CR 6.5–9), one for each kind of land

**Decided: resistance to control (lost turns, slow, being pushed) depends on the boss.** Three levels:

- **Open:** no resistance. Control cards work in full. These bosses hit hardest, so freezing them is the intended answer.
- **Wary:** can lose at most one turn per battle; slow works.
- **Steadfast:** never loses a turn; slow and push do nothing. Weak and vulnerable still work on every boss.

The level is shown on the dungeon card, so a party knows before the draft whether control cards are worth taking.

| Boss | Health | CR | Land | What it does | Control |
|---|---|---|---|---|---|
| Redtooth, Brigand King | 230 | 6.5 | plains | Twin blades; barks orders (allies hit harder); gouge | Wary |
| Old Greyfeather (owl) | 240 | 7.5 | forest | Talons; silent swoop on everyone; mantles (block) | Wary; cannot be slowed |
| The Storm Matriarch (harpy) | 220 | 7.5 | mountain | Dive; gale; shriek | Open to lost turns; cannot be slowed or pushed |
| Old Snapjaw (pike) | 260 | 8 | river | Snap; thrash; drags a citizen under (lose a turn) | Wary; cannot be pushed |
| Grum, the Ogre Chief | 280 | 8.5 | hills | Great club; boulder; roar | Open |
| The Bog Mother (toad) | 300 | 8.5 | marsh | Slam; spore cloud; bloats (heals herself) | Steadfast |
| The Hollow King (withered) | 270 | 9 | ruins | Rusted blade; hollow wail; crown of rot | Steadfast |

Elites are Wary. Everything else is Open. This needs a `control` field on the creature and a check where lost turns and slow are applied; the simulator does not model it yet, so the two Steadfast bosses will be somewhat harder than the tables in §6 say for parties that lean on control.

That is 26 new creatures and 11 existing ones. Every kind of land has at least two minions, three regulars, a heavy, an elite and a boss. Full move lists and stats are in the simulator script, in the same shape the enemy editor stores.

All move sequences are fixed and shown to the player as intents, as now, so a hard fight is a puzzle and not a surprise.

## 5. How hard each skull is

Health and strength of every creature in the dungeon are raised by the skull's modifier (`combat_mods`: `enemy_health`, `enemy_strength`, which exist today; agility rises by half the strength figure).

| Skull | Health | Strength | Example: Stoat Brigand | Example: boss Grum |
|---|---|---|---|---|
| (a quest today) | +0% | +0% | 40 health, hits for 10 | — |
| 🟢 Green | +50% | +40% | 60 health, hits for 13 | 420 health, club 32 |
| 🟡 Yellow | +75% | +60% | 70, hits for 15 | 490, club 35 |
| 🟠 Orange | +100% | +80% | 80, hits for 16 | 560, club 39 |
| 🔴 Deep red | +125% | +100% | 90, hits for 17 | 630, club 43 |
| 🟣 Purple | +175% | +140% | 110, hits for 20 | 770, club 52 |

Why so much: each citizen plays about three cards a turn from a full hand, so a party of four deals about 100 damage a round. In a first pass with small modifiers (none at green, up to +75% at purple) the suggested party cleared every colour 98–100% of the time.

## 6. Floors, rooms and results

### 6.1 Suggested shape

"Fights" include the elites and the boss. A rest gives back 30% of full health. A landing (between floors) is a rest plus the choice to go deeper.

| Skull | Floors | Fights | Of which | Rests | Events and treasure | Steps per floor | Deck | Party of four, expected level |
|---|---|---|---|---|---|---|---|---|
| 🟢 Green | 1 | 3 | boss | 1 | 1–2 | 5 | 12 | villagers |
| 🟡 Yellow | 1 | 4 | boss | 1 | 2 | 7 | 12 | novices |
| 🟠 Orange | 2 | 6 | 1 elite, boss | 2 + landing | 3 | 5–6 | 14 | trained |
| 🔴 Deep red | 2 | 7 | 1 elite, boss | 2 + landing | 4 | 6–7 | 14 | trained, with classes |
| 🟣 Purple | 3 | 9 | 2 elites, boss | 3 + 2 landings | 5 | 5–6 | 16 | veterans, with classes |

`docs/DUNGEONS.md` §4 now carries these figures. The first guess had up to 11 fights at purple; nine is where the clear rate and the playing time both sit right.

**Deck size ramps with the skull:** 12 cards at green and yellow, 14 at orange and red, 16 at purple. Longer fights reshuffle more often, and a bigger deck gives class cards room.

**Every dungeon takes exactly four citizens** (decided). **A typical fight** has three creatures at every colour; what changes is what they are. Green: three regulars, one fight with a heavy, and a boss with two regulars beside it. Yellow: regulars and heavies. Orange and red: 3–4, with heavies in most fights. Purple: 3–4, mostly heavies. The boss always has one or two companions.

### 6.2 Clear rates

300 runs each. The bot drafts its deck, plays sensibly but without foresight, carries no supplies and cannot stand a downed citizen up in battle. Real players with supplies and revives should do better, so read these as a floor.

| Skull | Four citizens, starter cards only | + unlocked cards | + class cards | One level under | Three citizens (not allowed; shown for the reason) |
|---|---|---|---|---|---|
| 🟢 Green (villagers) | 95% | 93% | 94% | — | 18% |
| 🟡 Yellow (novices) | 78% | 78% | 75% | 58% | 4% |
| 🟠 Orange (trained) | 52% | 52% | 69% | 18% | 3% |
| 🔴 Deep red (trained) | 20% | 30% | 40% | 2% | 1% |
| 🟣 Purple (veterans) | 3% | 9% | 24% | 1% | 0% |

Levels used: **villager** (all stats 8, combat 1, no armour), **novice** (main stat 10, combat 2, leather), **trained** (main 11, second 10, combat 4, leather: about class level 10), **veteran** (main 13, second 11, combat 7, chainmail: class level 20). The class party is Guard, Archer, Hearthkeeper, Wizard.

Reading it:

- Green is a safe first dungeon but not a certain one (decided: about 90% for a player who makes no deliberately poor choices). Four villagers with starter cards clear it 19 times in 20, and one or two of them are usually knocked down on the way and roll for injury. Yellow is the first real test: about one run in four is lost.
- Classes are worth 10 to 20 points from orange upward. Red and purple are built to need them.
- Purple without class cards is close to impossible, by design.
- An over-levelled party helps less than a complete one: four veterans in an orange dungeon clear 86%.

### 6.3 Wear and time

| Skull | Health lost per fight (share of the party's total) | Citizens downed per run | Citizen turns per run (with a full card collection) | Fighting time at about 15 s a turn |
|---|---|---|---|---|
| 🟢 Green | 18–20% | 1.4–1.5 | about 30 | 7 minutes |
| 🟡 Yellow | 16–19% | 1.9–2.1 | about 40 | 10 minutes |
| 🟠 Orange | 16–20% | 2.2–2.7 | about 60 | 15 minutes |
| 🔴 Deep red | 16–20% | 2.9–3.5 | about 66 | 17 minutes |
| 🟣 Purple | 19–24% | 3.4–3.9 | about 74 | 19 minutes |

A party loses roughly a fifth of its total health in each fight and a rest returns 30%, so two fights between rests is the natural rhythm. The path generator should never put three fights in a row before a rest is reachable.

Add a minute for the draft and a few for rooms and choices. Green fits one short visit; purple is two or three sittings, with the landings as stopping points.

From orange upward two or three citizens go down in a typical run (lost runs, where everyone falls, are counted). That makes reviving, Hearthkeepers and bandages matter, and it is what the single injury roll at the end is for.

## 7. Events

About twenty to start. Each is written like a moment: a situation, two or three options, a result the player can see. "Check" means the option only appears, or works better, if a party member has that class, trait or stat. Health figures are shares of full health; blessings and curses last to the end of the run and use the existing modifiers.

### Good

| Event | What the party finds | Options |
|---|---|---|
| The Clear Spring | Clean water in a dry place | Drink: everyone heals 20%. Fill the flasks: gain 2 field rations. |
| Glowcap Grove | Mushrooms that light the next rooms | Gather: the next floor's rooms are revealed. Eat: one citizen heals 30%. |
| An Old Campfire | Embers still warm, a pack left behind | Rest a while: heal 15%. Search the pack: one supply item. |
| The Whetstone | A grinding wheel that still turns | Sharpen: blessing, strength +2. |
| A Lost Traveller | A hedgehog pedlar, glad of company | Share food (1 ration): a card for the run, pick one of three. Point the way out: 20 wealth and a chronicle line. |
| The Mossy Shrine | A shrine to the old wood | Leave an offering (15 wealth): blessing, endurance +2. **Hearthkeeper:** tend it for free and heal everyone 10% as well. |
| The Lookout's Notes | A dead scout's map | Read: see the contents of every room on this floor. **Scout or Archer:** also spot a hidden treasure room. |

### Bad

| Event | What goes wrong | Options |
|---|---|---|
| Rockfall | The ceiling gives | Run: everyone loses 8%. Shield the others: one citizen loses 20%. **Guard:** shields them and loses 10%. |
| The Sucking Mire | The path is under water | Wade: curse, agility −2. Go round: the next fight has one more minion. |
| Blight Spores | A grey cloud from a split log | Push through: everyone starts the next fight with poison 3. Burn it out: lose one torch, or 10% health. **Greenspeaker:** clears it, no cost. |
| A Snare | Someone steps in a wire | Cut free: that citizen loses 15%. **Skirmisher:** spots it first, and keeps the wire (a rope). |
| The Cold Draught | Something old breathes on the party | Endure: curse, strength −1. Turn back a room: nothing lost, but the next rest is skipped. |

### A real choice

| Event | Situation | Options |
|---|---|---|
| The Sealed Door | Runes round a stone door | Force it: a fight with an elite, and a treasure room behind. Leave it. **Wizard or Scholar:** reads the runes, opens it without the fight. |
| The Weeping Husk | A Withered that does not attack | End it: a card for the run. Let it be: nothing. **Hearthkeeper:** lays it to rest, blessing endurance +2 and a chronicle line. |
| The Brigands' Toll | Stoats block the passage | Pay 30 wealth. Fight (regular + minion). **Minstrel, or charisma 12:** talks them down to 10. |
| The Gambling Crow | A crow with a cup and three acorns | Wager 20 wealth: half the time doubled, half the time gone. **Skirmisher:** sees the trick, always wins. |
| The Chained Chest | Heavy, locked, and it rattles | Smash it: treasure, and a 40% chance it was a trap (a fight). Leave it. **Strength 12:** opens it clean. Uses a rope: opens it clean. |
| The Altar of Thorns | Offers power for blood | Give blood: one citizen loses 20%, blessing strength +3. Refuse. |
| The Wounded Stranger | A hurt badger, far from home | Use a bandage or heal 15% of one citizen's health into them: they give a rare material and may ask to join the town (a moment at home). Walk on. |
| Whispers in the Dark | A voice offers to show the way | Follow: skip straight to the boss with everyone healed 10%. Ignore it. |

Rules for writing more: a good event still costs a choice (take this *or* that); a bad event always has a cheaper way out for the right citizen; no option is ever an instant loss of the run.

## 8. Treasure

### 8.1 What things are worth today

| Thing | Wealth |
|---|---|
| A tavern quest | 12–30 |
| Wealth from a battle | 8 × each creature's reward weight (a rat 8, an ogre 32) |
| Clearing a Withered camp | about 90–105 |
| Common materials (hide, timber bundle, iron ore) | 5–8 each |
| Uncommon (rare sap, beast horn) | 20–30 |
| Rare (gemstone, ancient heartwood, blightbane herb, luminous scale, ancient coin) | 35–50 |
| Epic (ancient blueprint, dragon tooth) | 80–100 |
| Gear | iron sword 20, chainmail 40, steel sword 55, hunter's cloak 60, dragonscale 120 |
| A card, bought from an Allied village | common 120, uncommon 200, rare 320, epic 520, legendary 800 |

### 8.2 Budget for a full clear

A dungeon is played by hand, once per town, with real risk, so it should pay several times what the same minutes of quests would. Values are in wealth, counting items at their sale value and cards at about a quarter of their village price (a card is only worth its full price if it is new to the town).

| Skull | Total for a clear | From fights | Treasure rooms and elites | Clear reward (boss chest) | Chance of a new card |
|---|---|---|---|---|---|
| 🟢 Green | about 120 | 40 | 30 | 50: 1 uncommon material, wealth | 15%, common |
| 🟡 Yellow | about 250 | 80 | 60 | 110: 1 rare material, wealth | 30%, common or uncommon |
| 🟠 Orange | about 500 | 150 | 130 | 220: 2 rare materials, a piece of uncommon gear | 60%, uncommon; 15% a class ★ card |
| 🔴 Deep red | about 900 | 230 | 250 | 420: 1 epic material, rare gear, a boss trophy | 1 card for certain; 35% a class ★ card |
| 🟣 Purple | about 1,600 | 350 | 450 | 800: 2 epic materials, named gear, a boss trophy, a title | 1 rare or better for certain; 60% a class ★ card |

Counting the clear rate of a class party (§6.2), the *expected* take per attempt is about 115 at green, 190 at yellow, 345 at orange, 360 at red and 385 at purple. Red and purple are barely better wealth per attempt than orange: what they offer is the things that only drop there.

How it is split inside a run:

- **Fights:** wealth as now (8 × reward weight), multiplied by the skull's health modifier, plus each creature's own drops.
- **Treasure rooms:** one material of the dungeon's level, and wealth.
- **Elites:** always one rare material or a piece of gear, and the first chance at a class ★ card.
- **Boss chest:** the clear reward above. This is the part a party risks by pressing on, and it is at least 40% of the total at every colour.
- A party that turns back after the first floor of an orange dungeon keeps roughly 150. That is the "bank it or risk it" number the player sees.

### 8.3 What suits as a reward

Already in the game (nothing new is needed for the first release):

- **By land:** forest gives rare sap and ancient heartwood; hills and mountain give iron ore, gemstones and beast horn; river and marsh give luminous scale and blightbane herb; ruins give ancient coins and ancient blueprints; plains give hide and wealth.
- **Gear:** leather armour and iron sword (yellow), chainmail and hunter's dagger (orange), steel sword and hunter's cloak (red), dragonscale armour (purple, rare).
- **Cards:** the ten unlockable cards, by rarity.

New, and only from dungeons:

- **Boss trophies**, one for each boss (Greyfeather's Pinion, Redtooth's Cutlass, Grum's Tusk, the Matriarch's Feather, Snapjaw's Tooth, the Bog Mother's Pearl, the Hollow Crown). A trophy goes on show in the town and is the key ingredient for the best supplies and for one named piece of gear each. These are items, not resources.
- **Named gear** at purple: a weapon or armour with the boss's name, good enough to become an heirloom. This only means something once weapons count in card battles (§2, row 2).
- **Class ★ cards** (§3.2).
- **Titles:** "Greyfeather's Bane" and so on, for each citizen in the party on a red or purple clear, written to the chronicle.
- **Supply recipes:** a first clear of each kind of land teaches one supply recipe (`docs/DUNGEONS.md` §8.1).

What should not be a dungeon reward: the five basic resources in bulk (dungeons should not replace farms and mines), and anything that raises a citizen's stats for good.

## 9. Decisions and open questions

Decided 2026-11-15:

| Question | Decision |
|---|---|
| Party size | **Required, and four** for every dungeon to start with. |
| First classes | **Guard, Archer, Wizard, Hearthkeeper.** The other four later. |
| Boss resistance to control | **Depends on the boss** (§4): Open, Wary or Steadfast. |
| Where classes train | **New buildings:** the Hearth Shrine from **Village** tier and the Wizard's Tower from **Town** tier; Guards and Archers at the Watchtower. Upgrading and researching the building is the most direct way to unlock that class's cards; other ways exist (§3.2). |
| A new town and the party of four | A town always has four free adults, so green dungeons need no tier gate. |
| Green | About a 90% clear rate for a player making sensible choices, not a certain win (§6.2: 93–95% in simulation). |

Decided 2026-11-18:

| Question | Decision |
|---|---|
| The scaling | **One creature list, a multiplier per skull**, tunable from Dev Tools (Life → Dungeons) and frozen on each battle. Built. |
| Weak, vulnerable and Focus (§2, rows 5 and 6) | **Change them everywhere, for new battles.** Battles already stored replay under the old rules (a rules version stamped on the battle, as `party_v` is). Not built yet. |
| Event checks (§7) | **The right citizen is certain.** Without them the option is still offered where it makes sense, with its chance shown. No hidden rolls. |

Still open:

1. **Costs** of the Wizard's Tower and Hearth Shrine and of their research lines.
2. **Wealth from fights** (§8.2): the rule "usual wealth times the skull's health modifier" gives about five times the budget at green. The build uses a share per skull instead (`docs/DUNGEONS.md` §12).
