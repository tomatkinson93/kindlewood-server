# Outpost specialisations — design for review (not built yet)

Status: **frozen until after 1.0** (see `docs/ROADMAP_1_0.md`). Nothing here is implemented. When it is picked up, cut it to three or four charters and two new resources, and note that haul filters are due to be removed (`docs/OUTPOST_TRIM.md`).

## 1. The shape of it

- **When:** an outpost can take a specialisation once it reaches **level 3**, which needs a Town.
- **How:** you choose one from the outpost window (a new 🎖 Charter section on Overview). You pay a one-off **charter** from the town's stores, then the outpost spends **12 hours re-tooling**. During that time its yields are halved.
- **Changing it:** pick a different charter later and pay again. Its specialist buildings come down, and a 24-hour re-tool follows.
- **What every specialisation gives:**
  - **Focus:** +50% to its own resource; the outpost's other yields drop by 25%.
  - **A specialist plot:** one extra building plot that only takes that specialisation's buildings (§3).
  - **A bigger store** for its own goods: +100% for that resource only.
  - **Rare finds:** a small hourly yield of the specialisation's rare goods (§4). Its specialist buildings and the right worker class make these finds more common.
  - **A badge on the map:** the outpost's icon gets a coloured banner showing its specialisation.
- **Limits** keep towns from becoming all one thing:
  - The **resource specialisations** (Timber, Farm, Mine, Quarry) are limited only by land and by how many outposts you have.
  - The **civic specialisations** have caps:

    | | Town | City |
    |---|---|---|
    | Trading Post | 1 | 2 |
    | Hamlet | 1 | 2 |
    | Fortress | 1 | 1 |
- **Clans:** a specialised outpost on clan land shares a small bonus with clanmates' outposts within 3 tiles (listed under each specialisation), in the same way clan defence is shared today.

## 2. The eight specialisations

| Charter | Land | Focus | Rare finds | Charter cost (guide) |
|---|---|---|---|---|
| 🪓 **Timberworks** | forest, marsh | timber +50% | Hardwood, Elderwood | 600 timber, 300 stone, 150 wealth |
| 🌾 **Farmstead Estate** | plains, river, marsh | food +50% | Honey, Herbs, Saffron | 500 timber, 200 stone, 150 wealth |
| ⚒️ **Deep Mine** | hills, mountain | iron +50%, every ore ×1.5 | gems and rare metals more often; Geodes | 500 timber, 400 stone, 40 bronze |
| 🏛 **Quarry Works** | hills | stone +50% | Marble | 400 timber, 300 stone, 40 metal |
| ⚖️ **Trading Post** | plains, river, ruins (needs a road) | wealth | trade goods (§2.5) | 400 timber, 200 stone, 400 wealth |
| 🏡 **Hamlet** | plains, forest, river | homes and births | — | 800 timber, 300 stone, 200 wealth |
| 🏰 **Fortress** | hills, mountain, plains | defence and training | special units (§2.7) | 600 timber, 800 stone, 150 metal, 30 steel |

### 2.1 🪓 Timberworks
- **Rare finds:**
  - **Hardwood** (oak and ash): about 0.5 an hour, doubled with a Woodcutter posted.
  - **Elderwood** (ancient heartwood): about 0.05 an hour. Needs the research **Old Growth Lore**.
- **Specialist buildings:**
  - **Seasoning Shed:** Hardwood finds +50%.
  - **Charcoal Kiln:** turns 10 timber an hour from the store into 2 coal.
- **Clan share:** clanmates' forest outposts nearby get +5% timber.

### 2.2 🌾 Farmstead Estate
- **Rare finds:**
  - **Honey:** about 0.4 an hour, more with a Forager.
  - **Herbs:** about 0.3 an hour.
  - **Saffron:** about 0.04 an hour. Needs the research **Spice Lore**.
- **Specialist buildings:**
  - **Apiary:** Honey ×2.
  - **Herb Garden:** Herbs ×2, and Farmers posted here give +10% more.
  - **Mill:** +15% food.
- **Clan share:** nearby clanmates' farm outposts get +5% food.

### 2.3 ⚒️ Deep Mine
- **Rare finds:**
  - every ore here ×1.5;
  - gems and the research-gated metals (gold ore, mithril, moonsilver) ×2 once researched;
  - **Geodes:** about 0.03 an hour. A Jeweller cracks one open for a random gem or a crafting item.
- **Specialist buildings:**
  - **Assay Office:** rare metals +50%.
  - **Smeltery Annexe:** turns ore into bronze or steel at the outpost, so porters carry the lighter finished metal home.
- **Clan share:** nearby clanmates' mines get +5% ore.

### 2.4 🏛 Quarry Works
- **Rare finds:** **Marble**, about 0.3 an hour.
- **Specialist buildings:**
  - **Mason's Yard:** Marble +50%.
  - **Block Sled:** porters carry stone and marble at half weight from here.

### 2.5 ⚖️ Trading Post
- **What it does:** passing traders buy from its store automatically. Each hour it sells up to 30 weight of goods at 1.2× their reference price, for wealth.
- **Choosing what's sold:** this uses the same per-outpost resource filter as haul filters. The wealth itself still needs porters (it's light).
- **Villages:** each friendly NPC village within 6 tiles (trust 40 or more) adds +10% sales.
- **Caravans:** your Market's caravans can start here instead of in town, which shortens routes and saves time.
- **Needs a road** (§2 of the R6c work) to be chartered.
- **Specialist buildings:**
  - **Warehouse:** +50% sold per hour.
  - **Toll Gate:** +1 wealth an hour for every road you own.
- **Clan share:** clanmates' Trading Posts within 6 tiles each add +5% sales.

### 2.6 🏡 Hamlet
- **Homes:** houses up to **6 citizens** (8 with a Cottage Row).
- **Residents:** they are still your citizens, but they live and work at the hamlet. They farm its fields (+2 food an hour each), are counted as "Living at the Hamlet" (not away), and can be moved back to town at any time by walking home.
- **Births:** residents with partners get **+50% birth chance**, and babies are born at the hamlet. Residents get +5 happiness (quiet country life).
- **Food:** each resident eats from the hamlet's store first, then the town's.
- **Raids:** a raid on a hamlet can injure residents. It's a soft target unless it has a Watchfire or a Fortress nearby.
- **Specialist buildings:**
  - **Cottage Row:** +2 homes.
  - **Village Green:** +5 happiness, and partnerships form faster.
  - **Schoolhouse:** children raised here start with +1 to a random skill.
- **Clan share:** none.

### 2.7 🏰 Fortress
- **Forts:** the fort can go up to **level 5** (Keep, then Citadel), and its garrison slots are doubled.
- **Protection:** its defence also covers your town and outposts within 2 tiles, at a 50% share.
- **Training:** Guards and Archers posted here gain **combat XP** each hour (20 an hour), and a career fork opens only here:
  - **Shieldbearer** (Guard): +defence in raids, and absorbs damage for the party in card battles.
  - **Ranger** (Archer and Scout): +damage against Withered camps, and scouts nearby fog.
  - **Hare Rider** (Scout): fast mounted messenger. Calls to arms reach further, and their own trips are 50% faster.
- **Withered:** raiders see a Fortress as a lightning rod. A raid aimed at an outpost within 3 tiles goes for the Fortress instead.
- **Specialist buildings:**
  - **Training Yard:** training XP ×1.5.
  - **Armoury:** garrison +25%.
  - **Stables:** Hare Riders can be trained.
- **Clan share:** clanmates within 3 tiles get +10% of its defence. This stacks with the existing clan share.

## 3. Specialist plot

Each specialisation adds one plot that only its own buildings can use (listed above). These buildings use the same system as other outpost buildings (`lib/outpost_buildings.js`), with a `spec` field.

## 4. New resources

All of these are tradeable in the Market. They show as ?? until first found.

| Resource | Group | Weight | Price | Used for |
|---|---|---|---|---|
| 🪵 Hardwood | rare wood | 1.5 | 4 | stronger bows, shields and tools; Carpenter recipes; higher building levels (level 6+ Lumber Camp, Watchtower) |
| 🌳 Elderwood | rare wood | 1 | 60 | legendary staves and bows; the last stage of the Sky Observatory and Starfall Spire wonders |
| 🍯 Honey | fine food | 0.5 | 3 | festivals (honey cakes: +5 extra happiness), tavern meals, healing salves |
| 🌿 Herbs | fine food | 0.2 | 2 | healing salves (injuries heal faster), cooking recipes |
| 🟧 Saffron | fine food | 0.1 | 50 | high-value trade; a Grand Feast festival (+20 happiness for 24 hours) |
| 🪨 Marble | rare stone | 2 | 10 | City buildings and decorations (+happiness), Wonder stages, statues |
| 🔮 Geode | rare | 0.5 | 20 | cracked open by Jewellers for gems and trinket materials |

Two new research projects would unlock the rarest finds: **Old Growth Lore** (Elderwood) and **Spice Lore** (Saffron).

## 5. Rough build order (once agreed)

1. **Resources:** add them to the registry, with icons, Stores, Market and the ledger.
2. **Charters:** an `outposts.spec` column, routes to charter and re-charter, focus multipliers, specialist plots and buildings, rare-find rates.
3. **The four resource charters**, plus recipes and uses for the new materials.
4. **Trading Post:** auto-sales; caravans starting there.
5. **Hamlet:** residents, housing, births and food.
6. **Fortress:** higher fort levels, area defence, training XP, and the new career forks (this is the largest piece).
7. **Clan shares**, the map badge, Help and Dev Tools.

## 6. Questions for you

1. Should the **civic caps** (Trading Post, Hamlet, Fortress) stay as proposed, or be looser?
2. **Focus penalty:** keep −25% on the outpost's other yields, or drop it?
3. **Hamlet residents:** should they live and work there as proposed, or just add homes and births while still working in town?
4. **Fortress special units:** are Shieldbearer, Ranger and Hare Rider the right three? Should they be career forks (as proposed) or brand-new classes?
5. **New resources:** is the list right (Hardwood, Elderwood, Honey, Herbs, Saffron, Marble, Geode)? Anything to add, such as fish varieties for a river specialisation?
6. Should a **river Fishery** be a fifth resource charter (rare fish for the fishing collection and tavern) instead of folding rivers into the Farmstead Estate?
