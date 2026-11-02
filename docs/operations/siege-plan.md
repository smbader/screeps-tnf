# Quad Siege Replacement Plan

**Status: Proposal updated with review decisions. No code has been changed.**

## Decisions from review

1. **Boosts:** MOVE and HEAL parts must be boosted. Tier 3 (XZHO2, XLHO2) is preferred and can be bought from the market; RANGED_ATTACK (XKHO2) is optional but preferred. The operation does not spawn until the required boosts are stocked.
2. **No WORK parts** in the first version. Structures are broken by ranged attack only.
3. **Single-file travel is allowed** until the quad enters the attack room. Inside the attack room the quad must be a 2x2 block.
4. **Safe mode:** the quad retreats outside the room, kills anything hostile it can reach, and waits (no recycling) (see "Safe-mode handling").
5. **Scope:** owned rooms only; one quad per siege; the closest rooms spawn the quad, with more than one room allowed when needed.

## Goal

Replace the current three-creep `SquadSiegeOperation` with a structured quad (four creeps in a 2x2 block) that:

1. Evaluates an observer-scanned target room and chooses the safest approach (lowest tower exposure).
2. Moves as one 2x2 block, all four creeps stepping on the same tick.
3. Breaks ramparts and walls along a route to the hostile spawns, re-planning as the room changes.
4. Aborts or retreats when the plan stops being feasible.

## Current code review

Everything siege-related is in [`SquadSiegeOperation.ts`](../../src/operations/SquadSiegeOperation.ts) (1,017 lines). Other references are:

- [`OperationHelper.ts`](../../src/utils/OperationHelper.ts): the operation is imported, but every instantiation is commented out. Target room, source room, and waypoints were hard-coded per shard.
- [`main.ts`](../../src/main.ts): `Memory.squadSiege?: any` and the `squadId` creep-memory field.
- `room.memory.data.labs.boosts` ([`RoomConfig.ts`](../../src/roomconfigs/RoomConfig.ts)): the existing boost-request mechanism that the old code writes to.

Findings:

| Area | Current behavior | Problem |
|---|---|---|
| Squad | 3 creeps (melee + 2 healers), TOUGH/ATTACK/HEAL bodies | Does not match the requested quad or body profiles. |
| Movement | Leader uses `travelTo`; followers `travelTo(leader.pos)` | No formation or lockstep. Fatigue desyncs the squad and members get stuck behind each other. |
| Tower safety | `findSafeStagingPos` flees from towers at a hard-coded 22 tiles and returns only the first path step. Then it waits for towers to run out of energy. | Not a real exposure model. Towers do not run dry against an active owner, so the squad waits indefinitely. |
| No vision | `areTowersDepleted()` returns `true` when the room is not visible | Treats "unknown" as "safe". |
| Breach | `findBestBreachWall` pathfinds with an empty cost matrix (structures ignored), then picks the single lowest-hit wall on any spawn path | Ignores tower exposure, total hits along the route, and 2-wide passage. The call is commented out in `actions()`. |
| Targeting | `attackStructures` picks `structures[0]`, ignoring the ranged attack range of 3 | No priority or path logic. Melee alternates attack and heal. |
| Planning | None. Reacts per tick | No scan data, no feasibility check, no abort condition. |
| State | One global `Memory.squadSiege`, hard-coded squad names | Only one siege at a time. State is a flat boolean set. |
| Spawning | Spawns whenever members are missing; boosts via a 50-tick window | No energy-capacity check, no boost-availability check. |

Reusable ideas: the lab boost approach (`findBoostLab` / `boostCreep` / `room.memory.data.labs.boosts`) and the retreat-and-heal concept. The code is a candidate for deletion once the replacement is in place; the structure should be rewritten rather than refactored.

## Quad composition

Both bodies are exactly 50 parts.

| Role | Count | Body | Energy |
|---|---|---|---|
| Attacker | 2 | 10 MOVE + 40 RANGED_ATTACK | 6,500 |
| Support | 2 | 10 MOVE + 16 RANGED_ATTACK + 24 HEAL | 8,900 |

Constraints that follow from these bodies:

- **Spawn size:** the support body needs 8,900 energy in a single spawn, so only RCL8 rooms (12,900 capacity) can source a quad. Total cost is 30,800 energy. Each creep takes 150 ticks to spawn, so a quad needs about 300 ticks with three spawns or 600 ticks with one. This is well within the 1,500-tick lifetime but must be included in the lifetime budget.
- **Mobility:** with 40 non-MOVE parts per 10 MOVE, unboosted creeps move one tile per 4 ticks on plain terrain and one per 20 ticks on swamp. **MOVE and HEAL boosts are required** (decision 1). Boosted MOVE (XZHO2) restores one tile per tick on plain and about 5 ticks on swamp. The planner computes ticks-per-tile from each creep's actual body and boosts, and refuses a plan whose travel time exceeds the lifetime budget. A quad is not spawned until stock covers both required boosts.
- **Boosts (approximate compounds):** XZHO2 on 40 MOVE parts needs 1,200. XKHO2 on 40 + 40 + 16 + 16 RANGED_ATTACK parts needs 3,360. XLHO2 on 48 HEAL parts needs 1,440. These use only three lab compounds, so the existing `labs.boosts` mechanism fits. The operation should check stock in storage/terminal/labs before it starts spawning.
- **Output:** boosted XKHO2 gives about 1,600 damage per attacker per tick (rangedAttack is 10 per part, 4x boosted). The two supports add roughly 640 each. Supports can `heal()` and `rangedAttack()` on the same tick; `rangedHeal` conflicts with `rangedAttack`, so the supports use adjacent `heal()` only (every quad member is adjacent, including diagonals).
- **Structure damage:** ranged attacks deal 10 per part to structures. This is much weaker than `dismantle` (50 per WORK part), so a 300M-hit RCL8 rampart is unrealistic. The feasibility gate below exists for this reason. Per decision 2 there is no WORK breacher in the first version; a dismantler can be reconsidered after live results.

## Architecture

Replace the monolith with focused modules (names are proposals):

| Module | Responsibility |
|---|---|
| `SiegeOperation` | Registers a siege, owns the state machine, spawns the quad, handles lifecycle and abort. One instance per siege. |
| `SiegeTypes` | Typed memory and config (`SiegeMemory`, `RoomSnapshot`, `SiegePlan`, `SIEGE_POLICY`). |
| `SiegeScanner` | Records observer scans into a persistent room snapshot (see below). |
| `SiegePlanner` | Pure functions: exposure map, 2x2 pathing, breach route, feasibility. No `Game` calls, so it is unit-testable. |
| `QuadController` | Formation and lockstep movement; applies attack/heal; no knowledge of why the plan exists. |
| `SiegeOperator` (per creep) | Thin creep wrapper holding role, slot, and boost state. |

State lives in `Memory.sieges[siegeId]` instead of the global `Memory.squadSiege`, so multiple sieges can coexist. Operations are recreated every tick, so everything needed across ticks (plan, phase, member names) is persisted.

## 1. Scanning and room snapshot

- Use an owned observer in range (`StructureObserver`, range 10) to call `observeRoom(target)`; vision arrives next tick. Reuse the DepositFarmer pattern of a persisted pending-observation record, and do not compete for observers that DepositFarmer or PowerHarvest are using (coordinate through the existing global scan timestamps).
- On a visible tick, store a compact `RoomSnapshot`: owner, RCL, safe-mode status/cooldown, towers (position, energy, hits), spawns, ramparts and walls (position, hits), other structures that block movement, hostile creeps with attack/ranged/heal part counts, controller position, tick. Terrain is available without vision through `Game.map.getRoomTerrain`.
- Snapshots expire (for example after 500 ticks). The planner refuses stale snapshots and requests a rescan. Once the quad is inside the room, live vision replaces the snapshot every tick.
- Preconditions before planning: the target room is owned by a hostile player, no active safe mode, and none of our rooms are claimed or reserved by the target.

## 2. Tower exposure model

Tower damage in Screeps scales linearly from 600 at range ≤5 to 150 at range ≥20. A tower always deals at least 150 damage inside the room, so "farthest from towers" means *lowest total expected damage*, not zero.

- For each tile, `exposure(tile) = Σ towerDamage(range)` over towers with at least 10 energy. This produces a 50x50 heat map.
- For each tile in a 2x2 footprint, take the worst member (they are all in the same block, so use the sum of the tiles the quad actually occupies, weighted by 4 targets sharing damage on the focus target).
- **Safety budget:** the plan's per-tick exposure must stay below `healCapacity × SAFETY_FACTOR`. Healing is about 288 per support unboosted, about 1,152 each with XLHO2, and applies to whoever the towers target, so the budget uses a single support pair's heal output with a safety margin (suggest 0.7).
- Include hostile creeps in the heat map: add expected damage in range of their attack or ranged parts, and treat tiles they occupy as blocked.
- Exposure is recalculated each tick from live data as soon as vision exists, and the plan is invalidated if budget is exceeded.

## 3. Choosing the approach (staging and breach)

1. **Candidate entry points:** every exit tile pair (a pair of adjacent edge tiles, since a 2x2 needs width 2). Score each by the lowest-exposure footprint reachable within the room from that entry.
2. **Candidate staging footprint:** among tiles outside the budget-exceeding region, choose the 2x2 anchor that minimizes exposure, ties broken by shorter path to the breach. This is the "safest point" the quad holds at (rendezvous inside the target room or just across the border).
3. **Breach route search:** run Dijkstra over 2x2 **anchor positions**. An anchor is valid when all four tiles are in bounds, not terrain walls, and contain no blocking structure that the plan has not scheduled for breaking. Edge cost for stepping onto an anchor:
   - `ticksToTraverse × exposure` (expected damage), plus
   - for a footprint tile covered by rampart/wall: `hits / quadDps` ticks to remove, multiplied by the exposure at the firing position.
   Goal: any anchor adjacent to a hostile spawn within ranged attack range of 3 (the attackers do not have to touch it).
4. Because a 2x2 cannot pass a one-tile gap, the breach route removes **two tiles wide** along the route. The cost model includes both tiles per step. Wide-open routes that need no breaching win automatically.
5. The output `SiegePlan` is a list of **phases** (see below), each with firing positions, a target structure list, estimated ticks and expected incoming damage. It is persisted and recomputed only when invalidated (new tower, destroyed target, snapshot expired, or a breach completing).

**Feasibility gate (must pass before spawning):**

- `ticksToBreach + travelTicks + spawnTicks ≤ creep lifetime − margin`.
- Route exposure ≤ safety budget at every step.
- Required boost compounds are in stock.
- Spawning room has RCL8 capacity (≥ 8,900 per spawn).

If no route passes, the operation reports why and stays in a `blocked` state rather than spawning a doomed quad.

## 4. Quad formation and movement

- **Formation:** a 2x2 block with attackers in the front pair and supports in the rear pair relative to travel direction. Because all slots are mutually adjacent, any permutation is valid, and the role-to-slot assignment can rotate by simultaneously swapping positions (Screeps resolves position swaps).
- **Lockstep move:** the controller computes one direction for the whole block. The quad moves only when every member is alive, in formation, and has `fatigue === 0`; then all four call `move(direction)` the same tick. Otherwise all hold. This replaces `travelTo(leader)`.
- **Anchor definition:** the top-left tile of the block; the planner's path is a list of anchors. The controller checks that the next anchor's four tiles are still free; an unexpected blocker triggers a short re-plan and, if blocked persistently, a hold-and-attack action.
- **Two formation modes (decision 3):**
  - **File mode** (outside the attack room): the quad travels single file in a snake, each member following the one ahead of it, using the standard room routing. This lets it pass narrow corridors, exits, and swamps without needing a 2-wide path. The leader is the creep with the most MOVE capacity. Members stay within range 1 of the one ahead so healing can reach them, and the leader waits whenever any member is fatigued.
  - **Block mode** (inside the attack room, from the entry onward): the 2x2 lockstep formation described here.
- **Re-forming at the attack-room border:** the quad stops at a **gather anchor** in the last room before the target (or just inside the border if the entry is wide enough), re-forms into a 2x2, and enters as a block. If the entry exit has only a single-tile opening, the quad enters in file mode through the gap and re-forms into the planned staging 2x2 immediately inside the room. This brief file-mode entry happens before tower exposure is a problem only if the chosen entry is outside tower range, so the planner treats the **entry and re-form tiles** as part of the exposure budget. Edge tiles are never used as a resting position.
- **Leaving the room:** retreat reverses the process: block mode to the exit, then file mode.
- **Pathing between rooms:** use route planning over room names (avoiding hostile-owned rooms with towers) to a rally room adjacent to the target, in file mode; the in-room anchor planner takes over inside the target.
- **Unit/formation break:** if one member dies, the quad cannot keep lockstep. It enters `RETREAT` (see below) and the operation decides whether to spawn a replacement or abort.

## 5. Targeting

Every tick the controller selects, in order:

1. **Hostile creeps** within range 3 that can heal or deal damage (rangedMassAttack only if three or more are in range).
2. **Current breach target** from the plan (rampart/wall tile for the active segment).
3. **Plan structure priority** once in range: towers first (reduces exposure), then spawns, then remaining structures that block the route.

**Threat response:** while moving through the room, any hostile creep with attack parts (ATTACK, RANGED_ATTACK, HEAL) that is in range and a threat takes priority over the structure objective. Threat means its expected damage plus tower exposure at the quad's position exceeds the sustainable heal budget, or it is within its own attack range. The quad responds in one of two ways:

- **Kill:** when the quad can out-damage the creep's healing and the position is within the heal budget, all attackers focus it until dead.
- **Kite:** when the position is too costly (in tower range or the creep out-heals the quad), the quad moves in lockstep to the nearest low-exposure tile away from towers, keeping range 3 from the threat, and fires while retreating. It engages again once the creep follows into a safer position, then resumes the planned objective.

**Tower-first rule:** if the planned route to the spawns costs more expected damage than the quad can sustain (route exposure exceeds the heal budget times the 0.7 safety factor), the plan switches to a tower-clearing objective. It destroys the nearest tower first (lowest exposure approach), re-runs the exposure map, and repeats until the spawn route is sustainable. Spawns then become the objective.

**Cleanup rule:** after all hostile spawns are destroyed, the quad keeps clearing every remaining hostile structure and creep (nearest first) until it dies of age. No further quads are spawned once the spawns are cleared.

Attackers aim all fire at the same target to maximize focus; supports `heal()` the most damaged member and use their `RANGED_ATTACK` on the same target when not otherwise needed.

## 6. State machine

```
PLANNING → (feasible?) → PREPARING → ASSEMBLING → TRANSIT → STAGING → BREACHING → ADVANCING → ASSAULT → CLEANUP → COMPLETE
                 ↘ BLOCKED          ↘ ABORTED         (any state) ↘ RETREATING → (healed) → previous phase
                                                      (any state) ↘ PAUSED (safe mode) → (ended) → STAGING
```

| Phase | Behavior |
|---|---|
| `PLANNING` | Scan, snapshot, feasibility. |
| `PREPARING` | Spawn four creeps, request boosts, boost, verify. MOVE and HEAL boosts must succeed on every creep before leaving; a creep missing a required boost is held and reboosted. |
| `ASSEMBLING` | Gather at the spawning room(s) and form the file; members from a second room join at the shared gather anchor. |
| `TRANSIT` | Travel in **file mode** to the gather anchor in the room before the target. |
| `GATHERING` | Re-form into a 2x2 at the gather anchor, then enter the attack room in block mode (or file entry plus immediate re-form for single-tile openings). |
| `STAGING` | Hold at the safe anchor; refresh live vision and replan if anything changed. |
| `BREACHING` | Destroy the planned wall/rampart tiles (both tiles of the 2-wide path) from firing positions. |
| `ADVANCING` | Move the block one anchor at a time through cleared tiles; return to `BREACHING` if the next anchor is blocked. |
| `ASSAULT` | Objective order: nearest towers if the spawn route is unsustainable, then spawns. |
| `CLEANUP` | Entered when all spawns are destroyed. The quad clears every remaining structure and creep until death. No replacement quads are spawned; the siege record closes when the last member dies. |
| `RETREATING` | Triggered when any member is under a configured HP fraction or incoming damage exceeds sustained heal. Fall back along the explored low-exposure path to the staging anchor or the exit; heal; resume or abort. |
| `PAUSED` | Safe mode is active on the target. See "Safe-mode handling". |
| `COMPLETE`/`ABORTED`/`BLOCKED` | Release boosts, free the siege record, and report the reason. |

Abort triggers: a member dies and cannot be replaced within the lifetime budget, route exposure exceeds budget, lifetime margin expires, or stale vision is not restored. Safe mode is **not** an abort trigger (decision 4); it pauses the siege.

## Safe-mode handling

Safe mode lasts 20,000 ticks, far longer than a creep's 1,500-tick lifetime, so "pause until it ends" has to account for the quad aging out. Towers still fire on creeps in a safe-mode room, so the quad does not hold position inside it.

- **Detection:** `room.controller.safeMode` is readable with vision (the live room or an observer scan). The scanner records `safeModeEndsAt` in the snapshot, and the siege checks for it each scan and every tick while the quad has vision.
- **Before spawning:** the siege stays in `PAUSED`. No creeps are spawned and no boosts are requested until safe mode ends and a fresh scan confirms it.
- **After spawning:** the quad retreats to a connecting room (outside tower range), holds position and guards in `PAUSED`, with supports healing as needed. Nothing in a safe-mode room can be attacked, so it only engages hostiles that leave the room, and it does not re-enter. The siege keeps rescanning with the observer.
- **If safe mode outlasts the quad:** the quad does **not** recycle or return home. It stays at the gather anchor, kills what it can, and waits until it dies of age (decision from review). Once the siege sees the quad is dead and safe mode has ended, it returns to `PLANNING` and spawns a fresh quad using the pre-spawn rule. The planner should also skip spawning when `safeModeEndsAt` is later than the lifetime budget, so a quad is only built when it can plausibly act.
- **Resume:** once safe mode has ended and a fresh scan confirms the room, the siege re-runs the planner against the new snapshot (defenders may have rebuilt) and resumes from `STAGING` if still feasible.
- **Safe-mode cooldown:** a room that just exited safe mode cannot immediately re-enter it (cooldown of about 50,000 ticks), so the attack window after resumption is protected from a repeat activation. The planner records the cooldown from the controller when visible.

## 7. Integration and cleanup

- **Registration:** a typed `SiegeOptions` configuration (target room, optional hold/rally hints; spawn rooms are chosen automatically by distance) registered through the existing operation mechanism rather than hard-coded in `OperationHelper.ts`. Keep it disabled by default; enabling requires explicit intent.
- **Spawning:** the operation ranks owned RCL8 rooms by route distance to the target and spawns from the closest one with enough energy capacity. When one room cannot cover all four creeps in time (spawn count or energy), the remaining members spawn from the next-closest room, and the file-mode TRANSIT phase gathers them at the shared gather anchor. Check return codes and reuse existing spawning conventions rather than the ad-hoc 50-tick window.
- **Boost stock:** compounds must be in the room that boosts the creeps. Missing T3 compounds are bought through the market automatically for as long as the siege is active (reusing the Market operation's buy conventions), and shortfalls are reported in the siege debug output. Spawning waits for stock.
- **Boosts:** keep the `room.memory.data.labs.boosts` mechanism but request only the exact compounds needed for the plan and clear them on completion or abort.
- **Memory:** replace `Memory.squadSiege` and `squadId` with typed `Memory.sieges`. Delete `SquadSiegeOperation.ts` and the commented-out siege blocks in `OperationHelper.ts` after the replacement lands.
- **Debug:** a `SIEGE_DEBUG` flag consistent with `MARKET_DEBUG`, a per-tick status line, and `RoomVisual` overlays for the exposure map, planned anchors, and breach tiles.

## 8. Implementation sequence

1. **Types and snapshot:** `SiegeTypes`, `SiegeScanner`, and memory schema.
2. **Planner (pure):** exposure map, 2x2 anchor validity, Dijkstra with breach costs, feasibility gate. Unit tests with synthetic rooms (walled base, towers in the corner and center, one-tile gaps).
3. **Quad controller:** lockstep move, swap/rotation, border crossing, hold-on-fatigue.
4. **Combat:** targeting, healing, focus fire, retreat logic.
5. **Operation:** spawning, boosting, state machine, abort conditions, debug output.
6. **Replacement:** wire up, then remove `SquadSiegeOperation` and its commented references.

## Test plan

- Planner unit tests: avoids high-exposure tiles; chooses lower-hit breach even if longer; refuses 1-wide corridors without breach; reports infeasible when `ticksToBreach` exceeds the lifetime; ignores towers with no energy.
- Controller tests with mock creeps: all four move the same tick; none move if any is fatigued; position swaps; border crossing.
- Policy tests for boosts: ticks-per-tile with/without XZHO2, plain vs swamp vs road.
- Manual validation on a private server or an unowned test room before pointing at a live target.

## Resolved decisions

| Question | Decision |
|---|---|
| Boosts | MOVE and HEAL required; RANGED_ATTACK optional. Tier 3 preferred (XZHO2, XLHO2, XKHO2), purchasable from the market. |
| WORK breacher | None in the first version. |
| Single-file travel | Allowed until the attack room; 2x2 block inside it. |
| Safe mode | Retreat outside the room, wait, engage anything hostile; no recycling (see "Safe-mode handling"). |
| Target scope | Owned (player-controlled) rooms only. Invader cores and reserved-only rooms are out of scope. |
| Quads per siege | One. |
| Source rooms | Closest eligible rooms spawn the quad; more than one room may contribute when needed. |
| After spawns fall | The quad clears everything else until death; no more quads are spawned once the spawns are cleared. |
| Heavy tower damage | If the route to the spawns is not survivable, clear the nearest towers first. |
| Hostile creeps | Armed threats in range are killed, or kited away from towers when the position is too costly. |
| Boost purchases | The siege buys missing T3 boosts through the market as needed for as long as the siege continues. |
| Safe-mode combat | The quad cannot attack anything in a safe-mode room. It retreats to a connecting room, holds position and guards (attacking hostiles that come out to it). |

## Implementation status

Implemented and disabled by default. To run a siege set `SIEGE_POLICY.enabled = true` and add `{ id, targetRoom }` entries to `SIEGE_POLICY.targets` in `src/operations/SiegeTypes.ts` (`debug: true` prints a status line every 10 ticks).

| File | Role |
|------|------|
| `SiegeTypes.ts` | Types, policy and `Memory.sieges` shape |
| `SiegePlanner.ts` | Pure planner, tower exposure, boosts, spawn-room and feasibility logic (unit tested) |
| `SiegeScanner.ts` | Room snapshots and observer scheduling (shares observers through `utils/ObserverClaims.ts`) |
| `QuadController.ts` | 2x2 formation, lockstep block moves and single-file travel |
| `SiegeCombat.ts` | Healing, shared-target selection and focus fire |
| `SiegeOperation.ts` | State machine, spawning, boosting, market purchases, safe-mode pause, retreat and cleanup |
| `GroundSupport.ts` | New `FILL_BOOST_LABS` task loads `labs.boosts` from storage/terminal |

Notes and known limits:
- The per-creep logic lives in `SiegeOperation` rather than a separate operator.
- Only one siege should use a given boost room at a time, because `labs.boosts` is per room.
- A retreat after a mid-room replan walks back along the replanned path, then runs to the gather room.
- Border crossing is by individual travel and re-forming at the entry anchor; it has not been run on a live server.
- `SquadSiegeOperation.ts` has been removed.
- Final objective: after the spawns and other hostile structures are cleared, the planner targets the controller (`CONTROLLER` objective), breaching any remaining walls or ramparts until the quad can stand within range 3 of it with no hostile creeps left. The siege then completes.

## Remaining open questions

None. The plan is ready for implementation approval.
