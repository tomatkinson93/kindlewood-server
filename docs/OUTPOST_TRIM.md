# Outposts — what to cut now that goods trickle home

Status: **proposal**, written 2026-11-11. Nothing here is removed yet.
Belongs to Phase 4 (consolidation) of `docs/ROADMAP_1_0.md`.

## Why

Over four rounds outposts grew to about 2,400 lines across six files, with stores, porters, haulers, haul settings, 14 buildings, roads and events. Then decision 3 made goods **trickle home by themselves**: a carter brings 60% of what an outpost makes, 80% along a track and 100% on a paved road.

That is the right call for a cosy game, but it leaves several features with little or no purpose:

- On a paved road everything comes home, so the store never fills and nothing is ever waiting to be carried.
- With no road, 40% waits in the store. One porter trip now and then collects it; nobody needs an automated hauler or rules about what to haul.

Features that do nothing still cost upkeep: every later change has to keep them working and tested.

## Keep

| Feature | Why it still earns its place |
|---|---|
| Outposts, levels, the tile panel, the Outposts tab and window | the core |
| Workers (+25%, +50% for the right trade) | a citizen decision |
| Forts, garrisons and raids on outposts | stakes |
| Crew walking out and home, drawn on the map | makes the world feel alive |
| **Roads** | now the main upgrade: they raise the carter's share and speed crew walks |
| Yield buildings (Granary, Sawpit, Quarry Crane, Ore Sorter, Deep Shaft, Smokehouse, Drying Racks, Dig Tent) | simple, land-specific choices |
| Bunkhouse, Watchfire, Signal Tower | each changes a decision (more workers, defence, clan defence) |
| Outpost events | the template for Phase 2 moments |
| The store and the carter | the store is "what hasn't come home yet"; raiders loot it |
| **Send a porter** (one trip) | a "fetch it now" button for when you need the goods |
| Help carry for a clanmate's outpost | a small social act; uses the same one-trip code |
| The bigger store on clan land | free, no upkeep |

## Cut

| Feature | Why | Where it lives |
|---|---|---|
| **Standing haulers** (the `hauler` crew post) | The carter does this job for free. | `lib/outpost_store.js` (`sendIdleHaulers`, the run-again chain in `resolveDue`, `HAULER_SLOTS`), `lib/outpost_state.js`, the `hauler` branch of `/assign` in `routes/outposts.js`, the hauler picker in `js/outposts.js`, hauler rows in `js/journeys.js` and `citizenAway` |
| **Haul settings** (which goods, how full before leaving) | Only existed to steer haulers. A one-off porter takes a fair share of everything. | `haul_filter` and `haul_threshold` columns, `filterOf`, `wanted`, `readyToHaul`, `PATCH /:id/settings`, `settingsHtml` and `saveSettings` in `js/outposts.js` |
| **Mule Pen** (porters carry 50% more) | Affects only the occasional porter trip. | `lib/outpost_buildings.js`, the `carry` effect in `tripFor` |
| **Waystation** (trips 30% faster) | Roads already do this, and better. | `lib/outpost_buildings.js`, the `trip` effect in `tripFor` |
| **Storehouse** (store +50%) | With the carter, a full store only matters on an unroaded outpost nobody visits. | `lib/outpost_buildings.js`, the `cap` effect in `capOf` |

That leaves 11 buildings (two general, eight land-specific, one for clans), and one fewer crew type.

## Change

| Feature | Change |
|---|---|
| **Outpost Network** clan boon (porters carry 25% more) | Becomes "carters bring 10% more home" (up to 100%). Same price. |
| **Clan hauling goal** ("carry N goods home from outposts") | Counts everything that comes home from outposts, carter included. Today it counts only porter loads. |
| The "store is full" warning | Already reworded in Phase 0 to say what is being lost and suggest a road. No further change. |

## What a player notices

- The outpost window's People tab loses "Make hauler" and "Haul settings"; "Send a porter" stays.
- Three buildings disappear from the build list. Anyone who built one gets its cost back in full.
- Citizens posted as haulers come home.

## How to do it safely

1. **Data first:**
   - bring haulers home: delete `outpost_crew` rows with `post = 'hauler'`;
   - let hauls already on the road finish as one-off trips (`standing = false`);
   - refund and delete the three buildings from `outpost_buildings`.
2. Remove the routes and server code, then the screens.
3. Leave the `haul_filter` and `haul_threshold` columns in the database (unused); dropping columns is not worth the risk.
4. Tests to update:
   - `scripts/outpost_store_test.js`: the "standing hauler" section, and the Storehouse, Waystation and Mule Pen checks;
   - `scripts/outpost_r6c_test.js`: the "Haul filters and thresholds" section and the boon check;
   - `verify/outpost_store_proofs.js`: 2c, 2f, 8d.
5. Help text and the specialisation design (`docs/OUTPOST_SPECIALISATIONS.md`) mention haul filters and the Warehouse; update both.

Rough size: about 350 lines of code and 60 checks removed.

## A bigger option, not recommended yet

Remove the store and porters entirely and have every outpost send 100% home. That would cut a further 400 lines or so, but raids on outposts would have nothing to loot, roads would lose their main purpose, and "fetch it now" would go. I'd play with the trickle for a few weeks first and decide from that.
