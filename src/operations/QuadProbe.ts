import { QuadController } from "./QuadController";
import { attackWithMembers, chooseCreepFocus, findStructureAt, healMembers } from "./SiegeCombat";
import { getTerrainArray, isSnapshotFresh } from "./SiegeScanner";
import { IMPASSABLE_HITS, SiegeGrid, chebyshev, getFootprint } from "./SiegePlanner";
import { clearProbeAnchor, estimateProbeEscape, planProbe, probeExposure, probeGrid } from "./QuadProbePlanner";
import { recordSiegeEvent, travelSiegeCreep } from "./SiegeDiagnostics";
import { keeperSafeTravel } from "./SiegeRouting";
import { SIEGE_POLICY } from "./SiegeTypes";
import type { SiegeMemory, TilePos } from "./SiegeTypes";

export function probeObstacles(room: Room): TilePos[] {
  return [...room.find(FIND_SOURCES), ...room.find(FIND_MINERALS)].map(object => ({
    x: object.pos.x,
    y: object.pos.y
  }));
}

export class QuadProbe {
  public control(memory: SiegeMemory, quad: QuadController, allowSurvivors = false): void {
    const state = memory.probe;
    healMembers(quad.members);
    this.fire(memory, quad);
    if (!state) {
      const leader = quad.members[0]?.creep;
      memory.status = leader
        ? `regrouping while awaiting a safe probe entrance: ${quad.moveFile(leader.pos, 0)}`
        : "waiting for a wide, survivable probe entrance";
      return;
    }
    const ids = new Set<string>(quad.members.map(member => member.creep.id));
    const inside = quad.members.some(member => member.creep.pos.roomName === memory.targetRoom);
    const room = Game.rooms[memory.targetRoom];
    const attacked = !!room?.getEventLog().some(event => event.event === EVENT_ATTACK && ids.has(event.data.targetId));
    const damaged = quad.members.some(
      ({ creep }) => state.lastHits[creep.name] !== undefined && creep.hits < state.lastHits[creep.name]
    );
    const names = new Set(quad.members.map(member => member.creep.name));
    const lostMember = Object.keys(state.lastHits).some(name => !names.has(name));
    state.lastHits = {};
    for (const { creep } of quad.members) state.lastHits[creep.name] = creep.hits;
    const safeMode = (memory.snapshot?.safeModeEndsAt || 0) > Game.time;
    const fresh = isSnapshotFresh(memory.snapshot, SIEGE_POLICY.snapshotMaxAge);
    const powered = memory.snapshot?.structures.some(structure => structure.type === "tower" && structure.hasEffects);
    if (
      inside &&
      (attacked || damaged || safeMode || !fresh || powered || lostMember || (!quad.isComplete && !allowSurvivors))
    ) {
      const reason = attacked
        ? "incoming attack observed"
        : damaged
        ? "observed damage"
        : safeMode
        ? "safe mode"
        : lostMember || !quad.isComplete
        ? "member lost"
        : powered
        ? "tower effects prevent an escape estimate"
        : "stale intel";
      if (!state.returning) recordSiegeEvent(memory.id, "probe-retreat", { reason });
      state.returning = true;
      state.plan = undefined;
      memory.retreatReason = reason;
    }
    if (safeMode) memory.phase = "PAUSED";
    else if (state.returning) memory.phase = "RETREATING";

    const outsidePosition = new RoomPosition(state.outside.x, state.outside.y, state.outsideRoom);
    if (!inside) {
      const evasion = quad.evadeKeepers(outsidePosition);
      if (evasion) {
        memory.status = `cohesive keeper evasion: ${evasion}`;
        return;
      }
    }
    const allOutside = quad.members.every(member => member.creep.pos.roomName === state.outsideRoom);
    const outsideInterior =
      allOutside &&
      quad.members.every(
        member => member.creep.pos.x > 0 && member.creep.pos.x < 49 && member.creep.pos.y > 0 && member.creep.pos.y < 49
      );
    if (state.returning && outsideInterior) {
      memory.status = "probe reset: healing together outside the room";
      if (!quad.isComplete && !allowSurvivors) {
        state.returning = false;
        memory.phase = "PREPARING";
        memory.status = "probe withdrawn; waiting for replacement members";
      } else if (quad.isFormedAt(state.outside, allowSurvivors) && this.recovered(quad) && !safeMode) {
        state.returning = false;
        state.trail = [];
        state.targetId = undefined;
        memory.phase = "STAGING";
      } else if (!quad.anyFatigued() && !getFootprint(state.outside).some(tile =>
        this.blocked(memory, quad, new RoomPosition(tile.x, tile.y, state.outsideRoom)))) {
        quad.formUp(state.outsideRoom, state.outside, allowSurvivors);
      }
      return;
    }
    const blocked = (pos: RoomPosition): boolean => this.blocked(memory, quad, pos);
    if (state.returning && (!quad.roomName() || allOutside || this.onTargetEdge(memory, quad))) {
      memory.status = `probe border withdrawal: ${quad.crossBorder(
        memory.targetRoom,
        state.outsideRoom,
        state.side,
        false,
        blocked
      )}`;
      return;
    }
    if (!inside) {
      if (!allowSurvivors && (!quad.isComplete || (!allOutside && state.trail.length > 0))) {
        memory.status = "assembling probe quad; no member enters alone";
        for (const member of quad.members) {
          if (member.creep.pos.roomName !== state.outsideRoom) {
            const options = keeperSafeTravel(3);
            const routeCallback = options.routeCallback!;
            const roomCallback = options.roomCallback!;
            options.routeCallback = roomName => (roomName === memory.targetRoom ? Infinity : routeCallback(roomName));
            options.roomCallback = (roomName, matrix) =>
              roomName === memory.targetRoom ? false : roomCallback(roomName, matrix);
            travelSiegeCreep(member.creep, outsidePosition, options);
          }
        }
        return;
      }
      if (!allOutside || quad.members.some(member => member.creep.pos.getRangeTo(outsidePosition) > 4)) {
        memory.phase = "TRANSIT";
        memory.status = `tight-file probe transit: ${quad.moveFile(outsidePosition, 0)}`;
        return;
      }
      if (getFootprint(state.outside).some(tile => blocked(new RoomPosition(tile.x, tile.y, state.outsideRoom)))) {
        memory.status = "probe staging footprint blocked; holding together";
        return;
      }
      if (quad.anyFatigued()) {
        memory.status = "holding all members for fatigue before forming";
        return;
      }
      if (!quad.formUp(state.outsideRoom, state.outside, allowSurvivors)) {
        memory.phase = "GATHERING";
        memory.status = "forming 2x2 before probe entry";
        return;
      }
      if (safeMode || !fresh || powered || !this.recovered(quad)) {
        memory.status = "holding outside for full healing, fresh intel and no safe mode/tower effects";
        return;
      }
      state.estimate = estimateProbeEscape(
        quad.creeps,
        [state.inside],
        probeExposure(memory.snapshot!),
        SIEGE_POLICY.safetyFactor
      );
      if (!state.estimate.safe) {
        memory.status = `probe entry withheld: ${state.estimate.reason}`;
        return;
      }
      memory.phase = "STAGING";
      memory.status = `coordinated probe entry: ${quad.crossBorder(
        memory.targetRoom,
        state.outsideRoom,
        state.side,
        true,
        blocked,
        allowSurvivors
      )}`;
      return;
    }
    if (!state.returning && (!quad.roomName() || this.onTargetEdge(memory, quad))) {
      memory.status = `completing 2x2 probe entry: ${quad.crossBorder(
        memory.targetRoom,
        state.outsideRoom,
        state.side,
        true,
        blocked,
        allowSurvivors
      )}`;
      return;
    }
    const containsSurvivors = (anchor: TilePos): boolean =>
      quad.members.every(member => getFootprint(anchor).some(tile => chebyshev(tile, member.creep.pos) === 0));
    const bounds = {
      x: Math.max(1, Math.min(47, ...quad.members.map(member => member.creep.pos.x))),
      y: Math.max(1, Math.min(47, ...quad.members.map(member => member.creep.pos.y)))
    };
    const actual =
      quad.getAnchor() ||
      (!quad.isComplete ? [...state.trail, state.inside, bounds].find(containsSurvivors) : undefined);
    if (!actual) {
      memory.status = "probe formation disrupted; regrouping locally without advancing";
      const previous = state.trail[state.trail.length - 1] || state.inside;
      if (
        !quad.anyFatigued() &&
        quad.members.every(member => getFootprint(previous).some(tile => chebyshev(tile, member.creep.pos) <= 1)) &&
        !getFootprint(previous).some(tile => blocked(new RoomPosition(tile.x, tile.y, memory.targetRoom)))
      ) {
        quad.formUp(memory.targetRoom, previous);
      }
      return;
    }
    const known = state.trail.findIndex(tile => chebyshev(tile, actual) === 0);
    if (known >= 0) state.trail = state.trail.slice(0, known + 1);
    else if (!state.trail.length && chebyshev(actual, state.inside) === 0) state.trail = [actual];
    else if (state.trail.length && chebyshev(actual, state.trail[state.trail.length - 1]) === 1)
      state.trail.push(actual);
    else {
      state.returning = true;
      memory.status = "probe displaced from recorded route; seeking a block escape";
    }
    const grid = this.grid(memory, quad);
    if (!grid || !memory.snapshot) {
      memory.status = "probe has no live escape map; holding formation";
      return;
    }
    if (!state.returning && !quad.anyFatigued()) {
      state.estimate = estimateProbeEscape(
        quad.creeps,
        [...state.trail].reverse(),
        probeExposure(memory.snapshot),
        SIEGE_POLICY.safetyFactor
      );
      const blockedReturn = state.trail.some(tile => !clearProbeAnchor(grid, tile));
      if (!state.estimate.safe || blockedReturn) {
        state.returning = true;
        memory.retreatReason = blockedReturn ? "recorded escape route blocked" : state.estimate.reason;
        recordSiegeEvent(memory.id, "probe-retreat", { reason: memory.retreatReason, estimate: state.estimate });
      }
    }
    if (state.returning) {
      if (!safeMode) memory.phase = "RETREATING";
      if (chebyshev(actual, state.inside) === 0) {
        memory.status = `probe exiting in pairs: ${quad.crossBorder(
          memory.targetRoom,
          state.outsideRoom,
          state.side,
          false,
          blocked
        )}`;
        return;
      }
      const previous = state.trail[state.trail.length - 2];
      const next =
        previous && clearProbeAnchor(grid, previous)
          ? previous
          : planProbe(memory.snapshot, grid, [actual], quad.creeps, SIEGE_POLICY.safetyFactor, state.inside)?.path[1];
      memory.status = next
        ? `probe lock-step retreat: ${quad.stepTo(actual, next, true)}`
        : "probe retreat blocked; holding together and firing";
      return;
    }
    if (quad.anyFatigued()) {
      memory.status = "probe holding all members for fatigue";
      return;
    }
    const route = planProbe(memory.snapshot, grid, state.trail, quad.creeps, SIEGE_POLICY.safetyFactor);
    state.plan = route?.path;
    state.targetId = route?.targetId;
    if (!route) {
      memory.phase = "STAGING";
      memory.status = "holding lowest-risk probe position; no target with a survivable return";
      return;
    }
    state.estimate = route.estimate;
    if (route.path[1]) {
      memory.phase = "ADVANCING";
      memory.status = `probing safest reachable target: ${quad.stepTo(actual, route.path[1], allowSurvivors)}`;
    } else {
      memory.phase = "ASSAULT";
      memory.status = "firing from safe probe position; watching for tower fire";
    }
  }

  private recovered(quad: QuadController): boolean {
    return !quad.anyFatigued() && quad.members.every(member => member.creep.hits === member.creep.hitsMax);
  }

  private onTargetEdge(memory: SiegeMemory, quad: QuadController): boolean {
    return quad.members.some(
      ({ creep }) =>
        creep.pos.roomName === memory.targetRoom &&
        (creep.pos.x === 0 || creep.pos.y === 0 || creep.pos.x === 49 || creep.pos.y === 49)
    );
  }

  private grid(memory: SiegeMemory, quad: QuadController): SiegeGrid | undefined {
    if (!memory.snapshot) return undefined;
    const grid = probeGrid(memory.snapshot, getTerrainArray(memory.targetRoom));
    const room = Game.rooms[memory.targetRoom];
    const names = new Set(quad.members.map(member => member.creep.name));
    if (room) {
      for (const object of [...room.find(FIND_CREEPS), ...room.find(FIND_POWER_CREEPS)]) {
        if (!names.has(object.name)) grid.blockHits[object.pos.y * 50 + object.pos.x] = IMPASSABLE_HITS;
      }
    }
    return grid;
  }

  private blocked(memory: SiegeMemory, quad: QuadController, pos: RoomPosition): boolean {
    if (Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y) !== 0) return true;
    if (
      pos.roomName === memory.targetRoom &&
      memory.snapshot &&
      (memory.snapshot.obstacles?.some(tile => chebyshev(tile, pos) === 0) ||
        memory.snapshot.structures.some(structure => chebyshev(structure, pos) === 0))
    )
      return true;
    const room = Game.rooms[pos.roomName];
    if (!room) return false;
    if (
      room
        .lookForAt(LOOK_STRUCTURES, pos.x, pos.y)
        .some(
          structure =>
            structure.structureType !== STRUCTURE_ROAD &&
            structure.structureType !== STRUCTURE_CONTAINER &&
            !(
              structure.structureType === STRUCTURE_RAMPART &&
              ((structure as StructureRampart).my || (structure as StructureRampart).isPublic)
            )
        )
    )
      return true;
    if (probeObstacles(room).some(tile => chebyshev(tile, pos) === 0)) return true;
    const names = new Set(quad.members.map(member => member.creep.name));
    return [...room.lookForAt(LOOK_CREEPS, pos.x, pos.y), ...room.lookForAt(LOOK_POWER_CREEPS, pos.x, pos.y)].some(
      creep => !names.has(creep.name)
    );
  }

  private fire(memory: SiegeMemory, quad: QuadController): void {
    for (const roomName of new Set(quad.members.map(member => member.creep.pos.roomName))) {
      const room = Game.rooms[roomName];
      if (!room) continue;
      const members = quad.members.filter(member => member.creep.pos.roomName === roomName);
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      const planned = memory.probe?.targetId
        ? Game.getObjectById(memory.probe.targetId as Id<Creep | Structure>)
        : null;
      const focus =
        planned && "structureType" in planned
          ? findStructureAt(room, planned.pos.x, planned.pos.y) || planned
          : planned;
      const structures =
        roomName === memory.targetRoom
          ? room
              .find(FIND_HOSTILE_STRUCTURES)
              .sort((a, b) => a.hits - b.hits)
              .map(structure => findStructureAt(room, structure.pos.x, structure.pos.y) || structure)
          : [];
      attackWithMembers(members, chooseCreepFocus(hostiles, members) || focus, hostiles, structures);
    }
  }
}
