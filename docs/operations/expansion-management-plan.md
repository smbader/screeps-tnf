# Expansion Management Automation Plan

**Status: Core automation implemented; live rollout not yet validated.** ExpansionManagement keeps versioned state in `Memory`, discovers nearby rooms, scouts and filters candidates, scores a default-layout anchor and rotation, claims one target at a time, bootstraps the new room with that saved layout, and hands it off after it reaches RCL2 with a spawn. Autonomous expansion is opt-in and starts in dry-run mode; see [How to use](#how-to-use).

The implementation deliberately uses creep scouts (no observer integration), one in-progress expansion, and fixed policy constants. Candidate ranking favors source count and room distance after applying safety filters. The default-layout planner is a terrain-based heuristic, not a pathfinding or siege simulation. Live behavior, bootstrap survival, and normal-operation handoff still need validation in the game before expanding the policy or enabling unattended claiming.

## Goal

Turn ExpansionManagement into a safe, mostly hands-off colony expansion pipeline. The operation should discover potential rooms, collect and retain intel, decide when expansion is affordable, claim a suitable target, bootstrap the colony, and hand it off to normal room management. It should explain deferrals and recover from resets, lost creeps, stale intel, and transient spawn or travel failures without requiring a manually edited target list for every expansion.

Automation should be conservative: expansion is an economic commitment, so the system must be able to defer or stop rather than claim a room it cannot support.

## Baseline findings before implementation

- [`ExpansionManagement.ts`](../../src/operations/ExpansionManagement.ts) is registered as an operation, but its `expansionRooms` array contains only commented examples. There are currently no active expansion assignments.
- `init()` constructs a claimer and scout for each configured target and creates three `RemoteWorker`s per visible target source. It does not check whether the home room exists or is owned before constructing operators.
- [`main.ts`](../../src/main.ts) recreates the operation objects and calls `init()`, `roleCall()`, and `actions()` every tick. Durable expansion phase, candidate intel, and assignments must therefore live in typed `Memory`, not only on the operation instance.
- [`Scout.ts`](../../src/operator/Scout.ts) moves to a target room and waits. It does not record room suitability or report a scouting result to the operation.
- [`Claimer.ts`](../../src/operator/Claimer.ts) selects claim versus reserve using the target room's `RoomHelper` config. Rooms without an `owned` or `defend` config are reserved rather than claimed, which is not a suitable implicit policy for a newly selected expansion.
- The operation uses fixed creep bodies and an arbitrary storage-energy threshold. It ignores spawn return codes, does not adapt staffing to home-room capacity or target readiness, and does not define a transition from remote workers to normal colony operations.
- [`RoomHelper.ts`](../../src/utils/RoomHelper.ts) loads registered room configs and initializes data for configured owned rooms. It does not create a new colony's config or bootstrap its layout and memory after a claim.
- [`RemoteFarming.ts`](../../src/operations/RemoteFarming.ts) separately assigns claimers, scouts, and remote workers to configured rooms. Expansion automation must coordinate with it so it does not claim, farm, or duplicate staffing for the same target.
- The codebase already has typed, versioned persistent memory and explicit phases in [`DepositFarmerTypes.ts`](../../src/operations/DepositFarmerTypes.ts) and [`DepositFarmer.ts`](../../src/operations/DepositFarmer.ts). Those are useful patterns, but expansion's state and candidate policy should remain specific to this operation.

References: [`OperationHelper.ts`](../../src/utils/OperationHelper.ts), [`main.ts`](../../src/main.ts), [`ExpansionManagement.ts`](../../src/operations/ExpansionManagement.ts), [`RemoteFarming.ts`](../../src/operations/RemoteFarming.ts), [`RoomHelper.ts`](../../src/utils/RoomHelper.ts).

## Desired operation model

Separate the workflow into five responsibilities:

1. **Home and policy selection:** determine which owned rooms can safely sponsor an expansion under configured limits and resource reserves.
2. **Discovery and intel:** explore nearby reachable rooms, record observations, and refresh stale or incomplete candidate data.
3. **Planning and assignment:** rank valid candidates, select one suitable home, and reserve the target to prevent duplicate work.
4. **Claim and bootstrap:** spawn and direct the required creeps, verify ownership, initialize the colony, and build up a minimal functioning workforce.
5. **Handoff and oversight:** transition the room to regular operations, release expansion-only resources, and report stuck or failed work clearly.

Persist only the data required across ticks and global resets: schema version, expansion policy overrides, candidate intel timestamps and summaries, active assignments, phase/retry data, and the creep assignments needed for recovery. Reconstruct operators and live game objects from memory each tick.

## Recommendations

### 1. Establish typed policy, memory, and lifecycle

- Add typed `ExpansionPolicy`, candidate intel, assignment, and root memory interfaces. Avoid `any[]` for expansion targets and waypoint definitions.
- Define explicit phases such as `discovering`, `scouting`, `evaluating`, `claiming`, `bootstrapping`, `active`, `paused`, and `failed`. Specify which observations or actions permit each transition.
- Persist phase-entry ticks, retry counts, last error/result, and a concise reason for waiting or stopping. Add timeouts for stale assignments and phases that cannot make progress.
- Version the memory schema and write safe initialization/migration logic. Keep defaults disabled or conservative until the rollout gates below are met.
- Make shard ownership explicit and reject cross-shard targets unless cross-shard travel and recovery are deliberately supported.

### 2. Select sponsoring homes and expansion capacity

- Consider only visible, currently owned rooms with a usable spawn. Treat missing vision, ownership loss, and unavailable spawns as explicit ineligibility rather than constructing an operator with an invalid room.
- Gate expansion on configurable reserves: energy/storage, spawn availability, CPU/bucket health, existing expansion count, and any minimum room-development level.
- Prevent simultaneous assignments from consuming the same home beyond a configurable concurrency limit. Select the home based on route cost and available operational capacity, not just geometric closeness.
- Start with a conservative limit of one active expansion globally; increase only after observing successful bootstrap and stable home-room operation.
- Ensure expansion spending cannot undermine emergency services, defense, or existing room maintenance. Reuse shared resource policy if available; otherwise keep the first version's reserve settings explicitly local and documented.

### 3. Discover, scout, and retain candidate intel

- Replace the empty manual target list as the source of truth with a bounded exploration queue. Generate nearby candidate rooms from map exits and route reachability; exclude the home room, invalid rooms, disallowed shards, and candidates already owned, assigned, or managed by another operation.
- Use scouts to visit candidates and persist a compact observation: owner/reservation, controller and sources, room type/risk indicators, last-seen tick, scout assignment, and whether the observation is complete. Do not equate lack of current vision with an empty or safe room.
- Inspect the relevant Screeps API availability before relying on room-intel sources that require vision. Persist only fields the game actually exposes and mark unknown values as unknown.
- Prioritize never-seen and stale candidates, and re-scout before committing to a stale observation. Bound scan work per tick and apply a CPU/bucket gate.
- Use deterministic queue ordering and stable assignments so resets do not cause scouts to oscillate between targets. Record scouting failures and release lost or expired assignments.
- If an observer-based scan is added later, coordinate scheduling with other active observer consumers; do not assume the existing independent schedulers are mutually aware.

### 4. Rank and reserve expansion candidates

- Reject targets that are owned by another player, reserved in a way that prevents a safe claim, too risky under the configured policy, unreachable, already assigned, or too costly for the sponsoring home.
- Rank remaining candidates using explainable inputs such as route cost, source count, nearby owned support, competition/risk, scout freshness, and the home's ability to bootstrap the target.
- Require a fresh scout observation and re-check target eligibility immediately before spawning the claimer. If the room changed since scouting, return it to scouting/evaluation instead of acting on stale data.
- Reserve the chosen candidate in persistent memory before spawning. Ensure neither another home nor RemoteFarming can create a conflicting claim/farm assignment.
- Keep target scoring as pure, testable policy functions where possible; separate the decision from Screeps object lookups and side effects.

### 5. Make claiming an explicit, recoverable action

- Give Claimer an explicit intent (claim expansion vs. reserve remote) rather than deriving intent from a room config that may not yet exist.
- Spawn only when the target is still eligible and the selected home meets policy. Build a body from available energy and intended role while respecting body-part, claim-power, travel, and spawn-time constraints.
- Check and classify every `spawnCreep` result. Avoid retrying every idle spawn for the same failed request in one tick; surface permanent configuration errors distinctly from expected contention or energy shortages.
- Persist the creep's home, target, assignment ID, and lifecycle state at spawn time. Recover assignments when the creep is missing, renamed/replaced, or lost, and release them when the target is no longer viable.
- Advance to `bootstrapping` only after observing that the target controller is owned by this player. Claim success must not depend solely on the claimer's local action result.

### 6. Bootstrap the new colony and hand off cleanly

- Define the minimum viable colony contract before implementation: room config type/shard, room runtime data, source memory, essential construction, initial energy plan, and required defenders/workers.
- Extend or reuse `RoomHelper` initialization through a single idempotent bootstrap entry point. Do not create a separate ad hoc config path that conflicts with registered configs or normal owned-room initialization.
- Start with a minimal safe layout and conservative workforce. Scale workers by available energy, room level, source count, container/build progress, and survivability rather than assigning three fixed workers to every source immediately.
- Verify that the existing operations can manage the new room before marking expansion `active`. Avoid simultaneous ownership of the same workforce by ExpansionManagement and RemoteFarming.
- Once the room is stable, release expansion-specific creep assignments and allow the normal room operations to take over. Keep a small persisted record of the expansion outcome for status and tuning.

### 7. Make operation status and failure visible

- Emit concise logs on meaningful phase transitions, candidate decisions, failed API calls, retries, and completion—not per-tick movement or unchanged status.
- Include a reason for each deferred candidate (for example: stale intel, hostile owner, insufficient reserve, no eligible home, already assigned, or unsafe risk).
- Add an operator-facing status summary via the repository's existing diagnostics/console conventions before enabling autonomous selection broadly.
- Provide explicit pause/disable controls, a maximum active-expansion limit, and safe abort behavior. Aborting must release reservations and recall or retire expansion creeps without abandoning a newly claimed room.

## Implementation sequence and rollout

1. **Safety and types — implemented:** versioned typed state, home eligibility, CPU/GCL gates, checked spawn results, and persistent status/retry details.
2. **Lifecycle and explicit claim intent — implemented:** scout/claim/bootstrap/active/failed phases, claim-versus-reserve intent, ownership verification, and creep cleanup when assignments end.
3. **Scouting and intel — implemented:** bounded BFS discovery, creep scouting, persisted room intel, freshness checks, and source-keeper/hostile/reservation rejection.
4. **Candidate planning — initial implementation:** deterministic source-count/distance ranking, persistent target reservations, one in-progress target, and avoidance of registered rooms plus RemoteFarming conflicts.
5. **Bootstrap and handoff — initial implementation:** idempotent owned-room configuration and source memory; an expansion worker builds a spawn and upgrades until RCL2, then yields to regular room operations.
6. **Controlled rollout — ready for operator validation:** dry-run scouts without claiming. Inspect candidates before turning dry-run off; only one claim can be in progress.
7. **Live tuning — pending:** inspect expansion duration, home-room energy impact, scout coverage, claim success, bootstrap survival, and normal-operation takeover before changing policy constants.

## Success criteria

- No expansion creep is created without a valid, owned sponsoring room and a persisted target assignment.
- Every active assignment has a visible phase, last-progress tick, and actionable reason when deferred or failed.
- Candidate decisions use fresh intel, avoid hostile/unclaimable or conflicting targets, and respect configurable home reserves and concurrency limits.
- Claiming is an explicit action and state advances only after verified ownership.
- A claimed room is initialized idempotently and becomes manageable by the standard room operations without duplicate workforce assignments.
- Spawn errors, lost scouts/claimers, stale intel, global resets, and aborts all recover without silently leaking a target reservation or leaving the home room in a repeated spawn loop.
- Focused tests cover eligibility, ranking, state transitions, target reservation, claim intent, spawn failures, bootstrap idempotence, and recovery. Build and type-check remain clean.
- Dry-run and staged rollout demonstrate that autonomous candidate selection is safe before unattended claiming is enabled.

## Defensive layout recommendation

Fresh candidate intel includes a recommended anchor (`x,y`) and rotation (`r0`–`r3`) for the `ricane` template. The planner rejects placements where template coordinates overlap wall terrain and avoids placing critical structures on the controller, sources, or mineral. It scores the template footprint's estimated non-wall perimeter ramparts, the number of contiguous walkable edge segments, the nearest tower distance to each segment, and spawn-to-controller distance. The 20-tick report includes those values and the combined score.

These are comparative estimates only. Edge segments are derived from the candidate room's terrain and do not prove that adjacent-room terrain makes each segment a traversable entrance; perimeter rampart count is a rectangular-footprint estimate. Review the recommendation and the room in game before approval. A room without a valid placement is not listed as acceptable or claimable. After claiming, bootstrap stores the recommendation as `roomtemplate`, `roomanchor`, and `templaterotation`, so normal room loading resolves the same layout.

## How to use

1. Deploy the code and allow at least one tick for `Memory.expansionManagement` to initialize. Expansion is disabled by default.
2. In the Screeps console, enable discovery in dry-run mode:

   ```js
   Memory.expansionManagement.enabled = true;
   Memory.expansionManagement.dryRun = true;
   ```

   Dry-run still spawns scouts and spends their spawn energy, but never spawns a claimer or claims a room.

3. Every 20 ticks the console prints all currently acceptable, freshly scouted rooms, including source count, selected home, distance, intel age, recommended anchor/rotation, layout score, estimated ramparts, edge openings, and tower distance to openings. Only those listed rooms can be approved.
4. Approve the exact room you validated:

   ```js
   Memory.expansionManagement.approvedRoom = "E25N11";
   Memory.expansionManagement.dryRun = false;
   ```

   Replace the example room with one from the report. Leave `enabled` true. The operation revalidates the room's intel and reachability before claiming; approval is consumed when claiming begins. Only one claim can be active at a time.

5. To inspect rooms without authorizing a claim, keep `dryRun = true`. Approve a room while in dry-run if desired; the approval is retained until dry-run is disabled. To cancel an approval, set `Memory.expansionManagement.approvedRoom = undefined`.
6. To pause spawning and creep control without deleting progress, set `Memory.expansionManagement.enabled = false`. Re-enable it to resume the saved assignment. Setting `dryRun = true` during the claim phase moves the assignment back to `ready` and retires the claimer; approve the room again before disabling dry-run.
7. Monitor the `[ExpansionManagement]` log messages and `Memory.expansionManagement.assignments`. A successful handoff is recorded as `active` after the new room reaches RCL2 and has a spawn. Normal room operations then manage the colony.

The current policy searches up to three rooms from eligible homes, avoids registered owned/remote/defend rooms and non-normal room status, and rejects hostile owners/reservations, source-keeper rooms, visible hostiles, and rooms with fewer than two sources. A failed candidate is not reconsidered until its intel cooldown expires. Review live results before changing the policy constants in `src/operations/ExpansionManagementTypes.ts`.

The bootstrap creates an owned room config using the reported template anchor and rotation, initializes source memory, chooses a spawn construction location, and spawns one expansion worker per source from the sponsoring room. Confirm that the saved layout resolves correctly and standard room operations take over before increasing expansion concurrency.

## Follow-up decisions

- Should observer scanning be coordinated with the other observer-consuming operations?
- Should policy constants become memory-configurable after the first live measurements?
- Should candidate ranking include terrain/route costs, owned-room support, and a more explicit threat/economics score?
- Is RCL2 plus a spawn a sufficient handoff point in live play, or should expansion workers stay until the new room has a stable independent workforce?
- Should automatic claiming remain opt-in per shard/home after dry-run validation?
