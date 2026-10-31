# Deposit Farmer Improvement Plan

## Goal

Turn DepositFarmer from a single hard-coded room assignment into a safe, observable operation that discovers nearby deposits, evaluates whether they are worth harvesting, and coordinates a miner from a suitable owned room.

**Implementation status: Implemented.** DepositFarmer now scans reachable rooms through owned observers, stores sightings and assignments in memory, coordinates overlapping scan requests with global timestamps, plans at most one miner per home, and runs miners through persisted travel/harvest/return/unload/retire states. The typed [`DEPOSIT_FARMER_POLICY`](../../src/operations/DepositFarmerTypes.ts) currently enables the operation with a 10-room observer range, 4,000 minimum CPU bucket for scans, 100,000 storage-energy reserve, one miner per home, 500-tick maximum sighting age, and conservative travel/lifetime margins. Tune these values from live observations.

## Current behavior and findings

- [`DepositFarmer.ts`](../../src/operations/DepositFarmer.ts) contains one hard-coded target/home/shard tuple (`E30N1`, `E31N1`, `shard1`). It creates one miner operator for that target every tick, rather than discovering deposits across nearby rooms.
- `init()` attempts to observe the configured target whenever it is not visible, but does not check the observer call's result or range, persist scan state, or coordinate scans with other observers. It logs each attempt. The target is consequently observed repeatedly while visibility is unavailable.
- A missing home room does not prevent operator creation. The resulting operator has no valid `room`, but `roleCall()` immediately calls `operationOperator.room.find(...)`; the exception is only contained by the main loop's operation-level catch.
- `roleCall()` embeds a fixed 46-part body and an energy threshold, but does not account for spawn capacity, travel distance, deposit lifetime/cooldown, available spawn time, expected yield, or spawn return codes. Eligibility is based only on seeing at least one deposit.
- [`DepositMiner.ts`](../../src/operator/DepositMiner.ts) always selects the first visible deposit. It does not persist a specific deposit identity or explicitly handle harvest cooldown, depletion/decay, or most action return codes. Its return and mining decisions are implicit rather than represented as a persistent work state.
- The operator transfers cargo to home storage only. If storage is unavailable or cannot accept the resource, it has no alternate unload destination or explicit recovery path. It also contains unused imports and an unused target-memory field.
- Operation instances are recreated each tick, and the main loop runs each operation's `init()`, then `roleCall()`, then `actions()`. Scan scheduling, discovered deposits, and miner assignments therefore need to live in typed `Memory`, not only on the operation instance.
- [`PowerHarvestOperation.ts`](../../src/operations/PowerHarvestOperation.ts) already has an observer round-robin pattern with persistent per-room scan timestamps. It is useful prior art, but DepositFarmer needs deposit-specific discovery and should not maintain a competing, uncoordinated scan schedule.

References: [`main.ts`](../../src/main.ts#L236), [`main.ts`](../../src/main.ts#L246), [`main.ts`](../../src/main.ts#L262), [`PowerHarvestOperation.ts`](../../src/operations/PowerHarvestOperation.ts#L125), [`OperationHelper.ts`](../../src/utils/OperationHelper.ts#L21).

## Desired operation model

Separate the work into four responsibilities:

1. **Configuration and home selection:** define enabled shards, candidate owned homes, observer access, scan bounds, and economic/risk policy in typed configuration.
2. **Survey and memory:** generate nearby candidate rooms, schedule observer requests, and record what was seen and when.
3. **Opportunity planner:** choose deposits worth harvesting and assign a home room and miner based on route, time, yield, risk, and available resources.
4. **Creep operator:** execute an explicit travel, harvest, return, unload, and retire lifecycle for one assigned deposit.

Persist only the data needed across global resets: scan timestamps, pending observations, deposit sightings and identifiers, active assignments, and a small schema version. Reconstruct transient objects from this memory each tick.

## Recommendations

### 1. Make operation configuration explicit and safe

- Replace `any[]` and the inline room tuple with a typed `DepositOperationConfig`. Give each configured home room a shard, enable flag, candidate-room policy, energy reserve, staffing limit, and optional risk exclusions.
- Resolve each configured home to a visible owned room and valid observer before creating a home-specific operator. If the home is unavailable, skip it with a diagnostic rather than constructing an invalid operator.
- Keep target rooms as discovered data, not a second hand-maintained target list. Validate shard and observer-range constraints before scheduling scans.
- Add a typed `DepositFarmerMemory` field to the existing memory declarations (or the subsystem's future focused declarations) and version it before changing its persisted shape.

### 2. Build a shared, budgeted nearby-room scanner

- Generate candidate rooms from map exits or a tested room-coordinate helper within the observer's legal range; exclude the home room and invalid shard/border transitions. Do not assume every coordinate in a rectangular range is an accessible or useful room.
- Maintain a scan queue and `lastScanned` timestamp per room. Prefer never-scanned and stale rooms, then use deterministic round-robin ordering to avoid repeatedly favoring the same coordinates.
- Assign each request to an eligible observer, avoid duplicate requests from multiple owned rooms, and respect one observation request per observer per tick. Check and report `observeRoom()` return codes.
- Persist a pending observation with the request tick. On the following tick, when the requested room is visible, find deposits and store a concise sighting record: room, position/ID, resource type, cooldown/decay information available from the API, last-seen tick, and assignment. Mark empty results as scanned too.
- Coordinate this scheduler with the existing PowerHarvest observer scan policy before enabling PowerHarvestOperation; it is currently not registered as an active operation. Two independently active schedulers could waste observer capacity or overwrite the expected observed-room state.
- Use a configurable scan cadence and CPU gate. Emit diagnostics for changed scan/deposit state or failures, not an unconditional per-tick scan message.

### 3. Evaluate deposits before spawning

- For each sighting, estimate the usable work window after route travel, spawn time, round-trip return, and deposit decay. Revalidate visibility and deposit state immediately before spawning and while mining.
- Rank opportunities by expected recoverable resource, travel cost, deposit cooldown, remaining lifetime, danger/ownership policy, and home-room logistics. Do not send a creep merely because `FIND_DEPOSITS` returned a result.
- Select the best suitable home from configured owned rooms using map route distance and operational readiness: spawn availability, storage/unload capacity, energy above reserve, and existing assignment count.
- Ensure one active assignment per deposit and cap concurrent miners. Expire stale sightings and release assignments when a deposit disappears, becomes uneconomic, or the creep is lost.
- Record why a candidate was accepted or deferred (stale sighting, insufficient lifetime, no suitable home, energy reserve, threat policy, or spawn unavailable).

### 4. Give miners an explicit persisted lifecycle

- Store `homeRoom`, `targetRoom`, stable deposit identity/position, resource type, and state on creep memory. Use states such as `travelling`, `harvesting`, `returning`, `unloading`, and `retiring`; recover or reconcile invalid state after resets.
- Target the assigned deposit rather than `targets[0]`. Handle not-visible, missing, depleted, cooldown, pathing, and action-error outcomes explicitly; refresh or abandon the assignment when appropriate.
- Return based on cargo, remaining lifetime versus round-trip time, deposit lifetime, and a configurable safety margin rather than only full capacity or a fixed 250-tick threshold.
- Unload all carried resources with checked transfer results. Prefer storage, then a configured terminal/container fallback when valid; if no destination can accept cargo, remain in a safe recovery state and report the blocker.
- Remove obsolete imports/fields and replace broad resource-type casts with the project's resource typing where practical.

### 5. Make spawning policy deliberate

- Build a body from the deposit assignment, travel profile, desired harvest rate, available room energy, and 50-part/energy constraints; compare its build and travel cost to expected recovered value.
- Pass the creep memory at spawn time, including role and assignment fields. Use deterministic names with assignment identity so duplicate spawn requests can be detected after resets.
- Check every `spawnCreep` result and distinguish expected contention/energy errors from configuration or invalid-body failures. Avoid retrying the same failed request at every spawn in the same tick.
- Retain the current minimum energy safeguard as a typed policy until tests and live observations justify a change.

## Suggested implementation sequence

1. **Safety and types — complete:** typed operation memory and creep assignment fields; missing homes/observers are ignored safely; observer and spawn results are checked.
2. **Discovery — complete:** breadth-first scan candidates through map exits, per-home candidate queues with globally coordinated scan timestamps, pending observation recovery, CPU-bucket gating, and sighting updates when target rooms are visible.
3. **Planner — complete:** reject stale or infeasible sightings, select the closest eligible owned home, preserve one assignment per deposit, and cap staffing at one miner per home.
4. **Miner lifecycle — implemented:** persisted state drives travel, harvest, return, unloading, and retirement; lost deposits and expiring opportunities trigger safe return. The repository test currently covers the pure scanning/viability policy; add simulator-backed tests for creep and observer API transitions when a Screeps runtime fixture is available.
5. **Tuning and rollout — ongoing:** inspect scan coverage, assignment decisions, CPU cost, spawn load, creep survival, and returned resources before changing scan range, staffing, or reserve thresholds.

## Success criteria

- Each in-range candidate room is scanned on a predictable, persisted schedule, with no duplicate observer requests and no silent API failures.
- A deposit is assigned to at most one live miner, and no creep is spawned for a stale or infeasible opportunity.
- Miners consistently return and unload before their safety deadline, and recover cleanly from missing vision, deposit loss, spawn failure, or a global reset.
- Logs and memory make it possible to explain scan coverage, assignment decisions, and recovered resources without noisy per-tick output.
- Focused tests cover observer candidate generation and opportunity viability; project type-check and build remain clean. Simulator-backed tests should extend coverage to assignment, spawning, and miner state transitions.
