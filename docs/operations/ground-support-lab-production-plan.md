# GroundSupport Lab Production Plan

**Status: Implemented. Policy helpers have focused unit coverage; validate room behavior in-game before enabling market purchases broadly.**

## Goal

Extend the per-room GroundSupport operator to produce every tier 3 compound, while maintaining a stock target of 2,000 for every reaction compound in tiers 1, 2, and 3. Supply the two input labs, run available product labs, and keep production active whenever any target stock is short and the room has at least 400,000 energy. If no needed reaction can proceed because a raw/base mineral is unavailable, attempt to buy only the missing base reagent from the market. Preserve existing logistics and siege-boost duties, and never run a reaction in a lab reserved for boosting.

## Implementation and operating instructions

- Production runs automatically for owned rooms with storage and at least three configured lab positions in `RoomConfig.lab`. GroundSupport discovers the owned labs at those positions and selects two inputs only if every other configured lab is within range 2 of both inputs. All remaining configured labs are then assigned as product labs; if no such input pair exists, production remains inactive until the lab layout changes.
- The target is 2,000 units of each tier 1-3 reaction compound, counted across storage, terminal, and product labs. GroundSupport selects needed reactions and precursors automatically; no recipe configuration is required.
- Every active product lab is kept supplied with a 1,000-energy buffer from storage/terminal, with energy refills preempting routine GroundSupport tasks and reagent loading. Energy is not shifted between labs to mask an energy shortage.
- Once both input labs contain their selected reagents, the reaction stays locked and the batch is processed without unloading or topping up either input lab. After either input lab is empty, the scheduler chooses the next needed reaction and handles any remaining old reagent as needed. A locked batch can take a product slightly above its 2,000-unit target.
- Production and market purchases pause when storage-plus-terminal energy is below 400,000 and resume at or above that threshold. Other GroundSupport jobs continue.
- Any siege boost assignment pauses room production and takes precedence over the energy gate. GroundSupport prepares the reserved boost labs. Siege releases the reservation after its full quad has left the boost room; production can then resume.
- If no needed reaction can advance because a base mineral is missing, GroundSupport may buy the lowest-priced eligible sell order, bounded to 1,000 units per attempt by credits, terminal capacity, and transaction energy. Attempts are throttled to once per 100 ticks. There is no configured maximum unit price, so ensure market orders are acceptable before leaving automated purchasing enabled.
- Manual emergency pause/resume is available in the Screeps console after the production state has been created:

  ```js
  Game.rooms["ROOM_NAME"].memory.data.labs.production.paused = true;  // pause
  Game.rooms["ROOM_NAME"].memory.data.labs.production.paused = false; // resume
  ```

- GroundSupport reports production state changes in the console, including the active reaction, energy/boost/manual pauses, market waits, and purchase outcomes. Identical status messages are suppressed.
- Roll out to one eligible room first. Confirm the room has the intended lab layout and adequate market orders, then monitor reaction progress, market transactions, energy-gate behavior, and a siege boost handoff before enabling additional rooms.

## Current GroundSupport responsibilities

[`GroundSupport.ts`](../../src/operator/GroundSupport.ts) selects one persistent creep task at a time. When it has no task, it returns to the room's configured chemist parking tile, then selects the first outstanding task in priority order.

| Current priority | Responsibility |
|---|---|
| 00-03 | Balance energy between storage and terminal when storage or terminal energy/capacity crosses fixed thresholds. |
| 04-08 | Fill field links, offload source links, and fill the controller link. |
| 09 | Refill critically low towers. |
| 10 | Fill labs reserved for a siege boost from storage/terminal; lab minerals are not taken from storage below the 30,000 energy floor for energy fills. |
| 11 | Supply power spawn energy and power. |
| 15 | Refill other towers. |
| 16 | Move ordinary resources from storage to terminal; offload deposit resources to terminal. |
| - | Park and wait when there is no task. A nuker-fill comment exists, but no nuker task is implemented. |

[`RoomDefense.ts`](../../src/operations/RoomDefense.ts) creates one GroundSupport operator per qualifying owned room at controller level 4 or higher, with towers and storage. It spawns a CARRY/MOVE creep at the configured chemist spawn. [`RoomHelper.ts`](../../src/utils/RoomHelper.ts) initializes `room.memory.data.labs` with `reagents`, `products`, and `boosts` arrays. Siege currently writes boost reservations to `boosts`, and GroundSupport honors those entries. `LabProcesses` currently processes power spawns only; it does not run lab reactions.

## Design principles

- Keep GroundSupport as the room's lab logistics owner; keep reaction scheduling deterministic and lightweight.
- Continue the existing one-task-at-a-time creep model for hauling. Reaction calls do not require the creep to be standing at a lab, so run eligible product labs each tick while the creep performs its current task.
- Use the room's configured lab coordinates and visible owned lab structures. Do not assume array order identifies a lab's role.
- Persist lab roles and the active recipe; do not infer roles differently from tick to tick.
- Treat siege boost preparation as an exclusive, room-wide production pause. While boost assignments are active, GroundSupport prepares the requested labs and energy for boosting and does not run reactions or select a production recipe. Resume target-driven production only after the siege explicitly releases its boost assignment after boosting and moving on.
- Manufacture continuously against per-compound stock targets. Pause production automatically below the room energy floor or when all targets are met; resume when energy and a needed reaction are available.

## Proposed lab model

### Lab role assignment

1. Match visible owned labs to the positions in `RoomConfig.lab`.
2. Select the input pair ("the two middle labs") only when every other configured lab is within reaction range 2 of both inputs. Use deterministic coordinate ordering to choose between valid pairs. If no pair covers all output labs, keep production inactive rather than silently excluding out-of-range labs.
3. Assign the remaining eligible labs as product labs. Persist the input IDs in `room.memory.data.labs.reagents` and product IDs in `room.memory.data.labs.products`; refresh assignments when labs are destroyed, newly built, or the configured layout changes.
4. Treat an active siege boost request as exclusive priority over compound production. When `room.memory.data.labs.boosts` contains assignments, suspend all production in that room, not merely production in the assigned labs. Stop reactions, clear incompatible production minerals from the labs the siege needs, then stock each assigned lab with its requested boost compound and energy using the existing boost-filling behavior. Do not start production again until the siege has completed boosting and moved on, as indicated by the siege operation releasing/clearing its boost assignments (or an equivalent explicit completed-and-departed state). Never infer completion only from a temporarily empty lab or a creep no longer being visible.
5. If fewer than two input labs and one product lab are available, report why production is inactive and leave all existing GroundSupport duties operational.
6. If siege boost assignments appear, immediately suspend production, release production recipe ownership, and prepare the assigned boost labs. Keep the pause in effect until the siege lifecycle signals boost completion and departure/release.

### Recipe selection and bounded stock

- Use Screeps' reaction catalog as the source of truth for reaction products and inputs. Classify reaction products into tiers 1-3 from their dependency chain; the inventory goal applies to each compound in all three tiers, not to raw base minerals.
- Set a fixed target of **2,000 units per compound**. Count stock in storage, terminal, and labs so products already made or staged are not needlessly duplicated; exclude creep-carried resources. Keep input mineral buffers separate from product stock when calculating target progress.
- Run a global room-energy gate using storage plus terminal energy. Suspend all production and reagent purchasing when their combined energy is **below 400,000**; resume automatically once it reaches 400,000. Existing non-production GroundSupport jobs, especially tower and logistics duties, continue normally while production is suspended.
- Continuously evaluate every under-target compound. Deterministically choose an actionable reaction from its dependency tree: favor a tier 3 deficit when both reagents are available; if a needed tier 3 reaction is blocked by a missing tier 2 precursor, make that precursor; otherwise make an under-target tier 2 or tier 1 compound. Do not produce a compound already at target unless required as an input to close a higher-tier deficit.
- Keep each selected reaction locked while both input labs contain its reagents; do not unload or refill either input during that batch. After one input empties, re-evaluate stock targets and select the next reaction. A loaded batch may finish above the 2,000 target, then production idles if all targets are met.
- Give active siege boosts higher priority than production and the 400,000-energy production gate: suspend production regardless of energy level, clear conflicting minerals from assigned labs, and satisfy the requested boost compound/energy fills. Existing non-lab GroundSupport duties continue. Resume production only once the siege has boosted, moved on, and its reservation has been explicitly released.
- If no needed reaction can advance because a required raw/base mineral (H, O, U, L, K, Z, or X) is missing, attempt a bounded market purchase of the specific missing mineral needed by the most actionable deficit. Do not buy tier 1/2/3 reaction compounds as a substitute for production. Do not buy merely because labs are cooling down, reserved, unavailable, full, missing, or the energy gate is closed.
- Bound each purchase by the amount needed to unblock a reaction chain up to the 2,000 compound target, terminal free capacity, available credits, and transaction-energy availability. Choose the lowest-priced eligible sell order and attempt the largest safe purchase within those bounds. Report no order, insufficient credits, terminal cooldown/capacity, transaction-energy shortage, and failed deals explicitly. Throttle retries to avoid per-tick market scans and repeated logs.
- If every tier 1-3 compound is at target, leave reactions idle. A product below target drives work whenever inputs and capacity allow, subject to the 400,000 energy gate, boost reservations, and physical lab availability.

### Supplying inputs and running reactions

- Add a lab-supply task to GroundSupport's task dispatch. It withdraws the selected reagent from storage or terminal and delivers it to the matching input lab, handling wrong-mineral cleanup through a safe storage/terminal transfer before loading a new reagent.
- Refill the two input labs to bounded 1,000-unit buffers. Once both are loaded, do not withdraw, clear, or replenish either reagent until one input lab is empty; continue running that reaction to consume the loaded batch. Then re-evaluate targets and select the next reaction. Keep each active product lab supplied with a 1,000-energy buffer from storage/terminal, prioritizing those refills over routine hauling and reagent loading.
- Each tick, for each eligible product lab, verify that it is owned, available, in range of both current inputs, not boost-reserved, compatible with the selected product, and has enough free mineral and energy capacity. Call `runReaction(inputA, inputB)` only after those checks.
- Interpret return codes explicitly: retry expected transient conditions (for example cooldown) on a later tick; log and stop/clear or replan on invalid labs, wrong minerals, insufficient resources, or an incompatible recipe. Avoid swallowing unexpected failures in the existing broad task catches.
- When changing recipes, stop reactions first, empty incompatible minerals from input and output labs to storage/terminal, then load the new reagents. Never mix a new recipe with leftover product or previous reagents.
- After either input lab empties, select the next reaction based on stock targets; a fully loaded reaction batch remains locked even if its product reaches 2,000 while that batch is running. Also pause on the 400,000 energy floor or a siege boost request. For a boost request, suspend all lab production and prepare the assigned labs; do not resume until the siege has boosted, moved on, and released its reservation. If another needed compound has an actionable recipe after release, switch to it rather than leaving labs idle.

## Integration sequence

1. **Type and memory contract:** define typed lab roles, active recipe, policy, stock targets, and task data. Preserve and migrate existing `reagents`, `products`, and `boosts` memory safely; do not clear Siege's boost state.
2. **Discover and assign labs:** resolve configured coordinates to owned structures, select the central input pair by reaction coverage, persist IDs, and report missing or changed labs.
3. **Select continuous targets:** implement deterministic dependency traversal across tier 3 targets and all tier 1-3 stock deficits, including precursor production and a stable tie-break.
4. **Add GroundSupport hauling:** add task discovery, dispatch, recovery, resource cleanup, and test coverage for supplying both reagent labs without breaking existing tasks. Add boost preparation that empties conflicting minerals and fills each siege-assigned lab with its requested compound and energy.
5. **Add reaction execution:** process available output labs independently of the creep's hauling task; respect lab cooldowns, range, capacity, energy, and the room-wide siege boost pause. Keep every usable product lab working when the active recipe and inputs allow it outside the boost pause.
6. **Add raw-mineral market fallback:** when no needed reaction is actionable because a raw/base mineral is missing, choose the lowest-priced eligible sell order and buy a bounded shortfall under credit, capacity, and transaction-energy limits. Add persistent retry throttling and explicit purchase outcomes.
7. **Expose controls and telemetry:** document automatic production, the fixed 2,000-per-compound targets, the 400,000 energy suspend/resume gate, and an emergency manual pause if needed. Log recipe, stock deficit, energy-gate state, market fallback state, and actionable blocked reasons without repeating identical idle messages every tick.
8. **Roll out gradually:** enable one owned room with a complete lab cluster, validate continuous tier production, market purchases, the energy gate, and boost isolation, then enable other rooms.

## Validation plan

- Unit-test input-pair selection with different lab geometries, ties, missing labs, and lab replacements.
- Test that an active siege boost assignment suspends all production regardless of room energy, clears conflicting assigned-lab minerals, fills requested boost compound and energy, and does not resume until the siege releases the reservation after moving on.
- Test that boost-reserved labs are never selected for input/output and that changing reservations suspends/replans production safely without disturbing siege assignments.
- Test coverage of the full tier 1-3 product set, the 2,000 target for each compound, dependency traversal, deterministic tie-breaking, stock aggregation, missing inputs, and tier 2 precursor priority for tier 3.
- Test that reaction execution and market purchases suspend below 400,000 combined storage/terminal energy and resume at the threshold; verify non-production GroundSupport duties remain available.
- Test market fallback only for missing raw/base minerals; bound amounts by the 2,000 target and terminal/credit/transaction-energy constraints; verify lowest-priced order selection, missing sell orders, throttling, transaction costs, and failed deals.
- Test that a fully loaded reagent pair remains locked until one side is empty, without unloading or topping up either input lab in the meantime.
- Test that all active product labs request energy from storage/terminal and that an energy-short product lab takes priority over routine GroundSupport tasks.
- Test hauling state transitions for loading each input, incompatible minerals, full creep/labs, unavailable storage/terminal, and interrupted tasks.
- Test reaction eligibility and return-code handling, including cooldown, insufficient reagent/energy, invalid range, full output, and recipe changes.
- Preserve regression coverage for all existing GroundSupport tasks and verify build, focused unit tests, and lint before deployment.

## Requirements fixed for implementation

- Produce every tier 3 compound and maintain **2,000 units of every tier 1, 2, and 3 reaction compound**.
- Keep reactions producing whenever any target is short and a reaction is actionable; automatically move to another needed compound when the current one is blocked or complete.
- When no needed reaction is actionable because a raw/base mineral is missing, attempt to purchase that raw mineral from the market. Do not market-buy reaction compounds as a substitute.
- Suspend production and reagent purchases below **400,000 total room energy**, counted as storage plus terminal energy; resume at or above the threshold.
- An active siege boost need suspends all room lab production regardless of room energy. Prepare the assigned boost labs, and resume production only after the siege has boosted, moved on, and explicitly released its assignments.
- Leave non-lab GroundSupport responsibilities running during production or boost-related lab suspension.
