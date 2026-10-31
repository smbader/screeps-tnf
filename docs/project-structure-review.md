# Project Structure Review

## Scope

Reviewed the main tick loop, operation/operator base classes, operation registration, room configuration loading, and representative energy-management and remote-farming logic. The recommendations below focus on reducing hard-coded policy while keeping Screeps-specific behavior explicit and testable.

## Current shape

- `src/main.ts` owns global memory/type declarations, per-tick setup, operation lifecycle phases, CPU-budget checks, and some room maintenance.
- `OperationHelper` constructs the active operation set from a hand-maintained registry.
- Operations decide which operators are needed and commonly implement their own creep spawning.
- Operators represent individual creep roles and execute role behavior.
- Room-specific setup lives in `src/roomconfigs`, while `RoomHelper` imports and registers configurations and resolves room templates.

## Recommendations

### 1. Make room configuration typed, validated, and single-source

`RoomHelper` has a manually maintained `ROOMS` array, while room configuration modules live separately. The loader currently uses `any` for both `getConfig()` and its template mapper. This makes configuration changes easy to get wrong and pushes errors into runtime behavior.

- Define a shared `RoomConfig` type for shard, room type, template, anchor/rotation, energy sources, spawn positions, and optional room features.
- Type each room configuration against that schema and replace `getConfig(): any`.
- Keep one registry keyed by room name, and derive both the explicit room list and name lookup from it.
- Validate unique room names and required fields at startup or in a small test. Fail visibly on duplicate or invalid entries rather than silently overriding configuration.
- Keep template-coordinate transformation limited to known coordinate-bearing fields instead of recursively treating arbitrary `{x, y}` objects as positions.

**Concrete issue found:** `ROOMS` registers `E33N3` twice; the second entry points to `E33N4`'s config. That likely means `E33N4` is not loaded under its own name and `E33N3` is overwritten. Confirm the intended mapping when correcting the registry.

References: [`RoomHelper.ts`](../src/utils/RoomHelper.ts#L19), [`E31N2.ts`](../src/roomconfigs/E31N2.ts#L1).

### 2. Move staffing policy out of operation implementation

Operations currently mix *what a role does* with *how many to create*, *when to create it*, and *what body to spawn*. For example, `EnergyManagement` creates four upgrader slots per owned room, derives harvester/hauler needs inline, and uses storage thresholds and controller levels to decide whether to spawn. This makes tuning or applying different policies to different rooms require code edits.

- Represent desired roles as a small typed staffing plan: role, count or condition, source/target assignment, and optional priority.
- Put changeable policy values (counts, energy thresholds, level ranges) in room/operation configuration with sensible defaults.
- Keep the operator responsible for role behavior; have a shared planner resolve the plan into desired creeps.
- Start with `EnergyManagement`; migrate one role at a time and verify actual creep names and spawn decisions match current behavior before generalizing.

References: [`EnergyManagement.ts`](../src/operations/EnergyManagement.ts#L49), [`EnergyManagement.ts`](../src/operations/EnergyManagement.ts#L71), [`EnergyManagement.ts`](../src/operations/EnergyManagement.ts#L122).

### 3. Centralize spawning behind a spawn planner/service

Several operations perform spawn discovery, direction selection, body construction, resource checks, and `spawnCreep` calls inside `roleCall()`. This duplicates spawn mechanics and makes it harder to enforce consistent priorities when multiple operations compete for the same spawn.

- Have operations submit spawn requests (name, body strategy, room, priority, and eligibility) rather than calling `spawnCreep` directly.
- Let one spawn service select a spawn, enforce one consistent queue/priority policy, and report the result.
- Move shared body construction and spawn direction selection into that service; keep role-specific body strategies as typed functions or data.
- Preserve operation-specific eligibility conditions until they are explicitly migrated into staffing policy.

References: [`EnergyManagement.ts`](../src/operations/EnergyManagement.ts#L139), [`RemoteFarming.ts`](../src/operations/RemoteFarming.ts#L90).

### 4. Strengthen and simplify the operation registry

`OperationHelper` is the central operation registry, but its class map is typed as `any`, and it also contains commented-out activation code and shard-specific attack setup. That makes it difficult to see which operations are active and what configuration they require.

- Type the map as operation constructors, e.g. constructors returning `Operation`, instead of `{ [key: string]: any }`.
- Give each operation a small configuration entry for enabled state, shard/room scope, and priority where needed.
- Move one-off missions (waypoints, target rooms, launch conditions) into typed mission configuration rather than commented code inside the registry.
- Keep operation creation explicit; avoid automatic filesystem discovery, which can make bundling and Screeps startup less predictable.

References: [`OperationHelper.ts`](../src/utils/OperationHelper.ts#L21), [`OperationHelper.ts`](../src/utils/OperationHelper.ts#L25), [`OperationHelper.ts`](../src/utils/OperationHelper.ts#L49).

### 5. Separate tick orchestration and make CPU scheduling policy explicit

The main loop handles setup, global memory cleanup, operation initialization, spawning, actions, CPU cutoffs, and post-tick room work. It also embeds thresholds such as bucket levels and a fixed “stop after operation five” condition. Because the cutoff occurs during the action phase, registry order affects which operations get to run.

- Extract named helpers for per-tick setup, operation initialization, spawn planning, action scheduling, and diagnostics.
- Move CPU thresholds and reserved CPU margins into a named policy object with explanatory names.
- Give operations explicit priorities or estimated CPU costs, and define a predictable deferral policy when CPU is low rather than relying on array position.
- Record per-operation CPU usage and skipped/deferred operations so tuning can be evidence-based.
- Keep per-operation error isolation, but standardize logs with operation name, phase, and error details.

References: [`main.ts`](../src/main.ts#L183), [`main.ts`](../src/main.ts#L230), [`main.ts`](../src/main.ts#L267), [`main.ts`](../src/main.ts#L278).

### 6. Move shared Screeps memory declarations out of the entry point

`main.ts` currently contains the global `Memory`, `CreepMemory`, `RoomMemory`, and custom Screeps types. As the project adds roles and persistent state, this central declaration block becomes a bottleneck and makes it harder to see which subsystem owns each field.

- Move global interfaces and project-specific memory types into focused declaration/type files (for example, room memory, creep memory, and operation memory).
- Replace `any` fields with specific types as the associated subsystem is touched.
- Document which fields are persisted across global resets and add a memory schema version before making breaking memory changes.

Reference: [`main.ts`](../src/main.ts#L9).

## Suggested implementation order

1. Fix and test the room registry, including duplicate-name validation.
2. Introduce the `RoomConfig` type and migrate room configs without changing runtime policy.
3. Extract staffing policy and spawn requests from `EnergyManagement`, preserving current behavior.
4. Apply the same spawn-request interface to another operation (such as `RemoteFarming`) before migrating the remaining operations.
5. Type and simplify operation registration, then make CPU scheduling priorities explicit.
6. Split global memory declarations and progressively remove `any`.

This order addresses the concrete config issue first, then creates the typed foundations that make policy extraction safer. Each step can be validated independently against current behavior.
