import { Operation } from "../classes/operation";
import { Operator } from "../classes/operator";
import { Claimer } from "../operator/Claimer";
import { ExpansionWorker } from "../operator/ExpansionWorker";
import { Scout } from "../operator/Scout";
import { RoomHelper } from "../utils/RoomHelper";
import { getRegisteredRoomConfig } from "../roomconfigs/registry";
import { findBestExpansionLayout } from "./ExpansionLayout";
import {
  EXPANSION_POLICY,
  ExpansionAssignment,
  ExpansionCandidate,
  ExpansionRoomIntel,
  ensureExpansionMemory,
  evaluateExpansionIntel,
  evaluateForcedExpansionIntel,
  getAcceptableExpansionCandidates,
  getExpansionCandidates
} from "./ExpansionManagementTypes";

const PLAYER_USERNAME = "ricane";
const SPAWN_DIRECTIONS: DirectionConstant[] = [
  TOP,
  TOP_LEFT,
  LEFT,
  BOTTOM_LEFT,
  BOTTOM,
  BOTTOM_RIGHT,
  RIGHT,
  TOP_RIGHT
];

export class ExpansionManagement extends Operation {
  private operationOperators: Operator[] = [];

  public init(): void {
    this.operationOperators = [];
    const memory = ensureExpansionMemory();
    if (!memory.enabled) return;
    if (memory.forcedRoom) memory.approvedRoom = memory.forcedRoom;
    const homes = this.getEligibleHomes();
    const candidates = homes.length > 0 ? this.getCandidates(homes) : [];
    this.logAcceptableCandidates(candidates);
    if (Game.cpu.bucket < EXPANSION_POLICY.minimumCpuBucket) return;

    if (homes.length === 0 || !this.hasGclCapacity()) {
      this.logStatus("Waiting for an eligible home room or available GCL capacity.");
      return;
    }

    let assignment = memory.currentTarget ? memory.assignments[memory.currentTarget] : undefined;
    if (memory.currentTarget && !assignment) memory.currentTarget = undefined;

    if (assignment && assignment.phase === "scouting") {
      this.advanceAssignment(assignment);
      if (assignment.phase === "scouting") {
        this.createAssignmentOperators(assignment);
        return;
      }
    }

    if (assignment && (assignment.phase === "active" || assignment.phase === "failed")) {
      memory.currentTarget = undefined;
      assignment = undefined;
    }

    if (assignment && assignment.phase === "bootstrapping") {
      this.advanceAssignment(assignment);
      if (this.isAssignmentActive(assignment)) {
        memory.currentTarget = undefined;
      } else {
        this.createAssignmentOperators(assignment);
        return;
      }
    }

    if (assignment && assignment.phase === "claiming") {
      this.advanceAssignment(assignment);
      if (this.isAssignmentPhase(assignment, "bootstrapping")) {
        this.createAssignmentOperators(assignment);
        return;
      }
      if (this.isAssignmentPhase(assignment, "failed")) {
        memory.currentTarget = undefined;
        assignment = undefined;
      } else {
        this.createAssignmentOperators(assignment);
        return;
      }
    }

    if (assignment && assignment.phase === "ready" && memory.approvedRoom === assignment.targetRoom) {
      const approvalError = this.getApprovalError(assignment.targetRoom, candidates);
      if (approvalError) {
        this.logStatus(`Approval for ${assignment.targetRoom} is waiting: ${approvalError}.`);
        return;
      }
      if (memory.dryRun) {
        assignment.reason = "approved; disable dry-run to begin claiming";
        return;
      }
      assignment.phase = "claiming";
      assignment.updatedAt = Game.time;
      assignment.reason = undefined;
      this.consumeApproval(memory);
      this.createAssignmentOperators(assignment);
      return;
    }

    if (assignment && assignment.phase === "ready") {
      memory.currentTarget = undefined;
      assignment = undefined;
    }

    if (memory.approvedRoom) {
      const approvalError = this.getApprovalError(memory.approvedRoom, candidates);
      if (!approvalError) {
        const approvedCandidate = candidates.find(candidate => candidate.roomName === memory.approvedRoom);
        if (approvedCandidate) {
          assignment = memory.assignments[memory.approvedRoom];
          if (!assignment || assignment.phase === "failed") {
            assignment = {
              targetRoom: approvedCandidate.roomName,
              homeRoom: approvedCandidate.homeRoom,
              phase: "ready",
              createdAt: Game.time,
              updatedAt: Game.time,
              retries: 0
            };
            memory.assignments[approvedCandidate.roomName] = assignment;
          }
          memory.currentTarget = approvedCandidate.roomName;
          if (memory.forcedRoom === approvedCandidate.roomName) assignment.forced = true;
          if (memory.dryRun) {
            assignment.reason = "approved; disable dry-run to begin claiming";
          } else {
            assignment.phase = "claiming";
            assignment.updatedAt = Game.time;
            assignment.reason = undefined;
            this.consumeApproval(memory);
            this.createAssignmentOperators(assignment);
          }
          return;
        }
      } else if (memory.approvedRoom !== memory.currentTarget) {
        this.logStatus(`Approval for ${memory.approvedRoom} is waiting: ${approvalError}.`);
      }
    }

    const selected = this.selectCandidate(candidates);
    if (!selected) {
      this.logStatus("No unassigned expansion candidates are available.");
      return;
    }

    const newAssignment: ExpansionAssignment = {
      targetRoom: selected.roomName,
      homeRoom: selected.homeRoom,
      phase: "scouting",
      createdAt: Game.time,
      updatedAt: Game.time,
      retries: 0,
      forced: memory.forcedRoom === selected.roomName || undefined
    };
    memory.assignments[selected.roomName] = newAssignment;
    memory.currentTarget = selected.roomName;
    this.createAssignmentOperators(newAssignment);
  }

  private logAcceptableCandidates(candidates: ExpansionCandidate[]): void {
    const memory = ensureExpansionMemory();
    if (Game.time % 20 !== 0 || memory.lastCandidateReport === Game.time) return;
    memory.lastCandidateReport = Game.time;

    const acceptable = getAcceptableExpansionCandidates(
      candidates,
      memory.intel,
      Game.time,
      PLAYER_USERNAME,
      EXPANSION_POLICY.minimumSources,
      EXPANSION_POLICY.maximumIntelAge
    );
    if (acceptable.length === 0) {
      console.log("[ExpansionManagement] Acceptable expansion rooms: none found.");
      return;
    }

    const summaries = acceptable.map(({ candidate, intel }) => {
      const approval = memory.approvedRoom === candidate.roomName ? " [APPROVED]" : "";
      return `${candidate.roomName} (sources=${intel.sources}, home=${candidate.homeRoom}, distance=${
        candidate.distance
      }, intelAge=${Game.time - intel.lastSeen}, layout=${intel.layout.anchor.x},${intel.layout.anchor.y}/r${
        intel.layout.rotation
      }, layoutScore=${intel.layout.score.toFixed(1)}, ramparts=${intel.layout.perimeterRamparts}, edgeOpenings=${
        intel.layout.edgeOpeningCount
      }, towerOpeningDistance=${intel.layout.averageTowerOpeningDistance.toFixed(1)})${approval}`;
    });
    console.log(`[ExpansionManagement] Acceptable expansion rooms (${acceptable.length}): ${summaries.join("; ")}`);
    console.log('[ExpansionManagement] Approve one with Memory.expansionManagement.approvedRoom = "ROOM".');
  }

  private getApprovalError(targetRoom: string, candidates: ExpansionCandidate[]): string | null {
    const candidate = candidates.find(entry => entry.roomName === targetRoom);
    if (!candidate) return "room is not reachable from an eligible home or is otherwise excluded";
    const intel = ensureExpansionMemory().intel[targetRoom];
    if (!intel || Game.time - intel.lastSeen > EXPANSION_POLICY.maximumIntelAge)
      return "room intel is missing or stale";
    if (!intel.layout && !this.isForced(targetRoom)) return "no valid default-layout placement was found";
    return this.evaluateIntel(intel);
  }

  // Forced rooms do not need a computed layout; the room config supplies it.
  private isForced(roomName: string): boolean {
    const memory = ensureExpansionMemory();
    return roomName === memory.forcedRoom || !!memory.assignments[roomName]?.forced;
  }

  private consumeApproval(memory: ReturnType<typeof ensureExpansionMemory>): void {
    memory.approvedRoom = undefined;
    memory.forcedRoom = undefined;
  }

  private evaluateIntel(intel: ExpansionRoomIntel): string | null {
    const memory = ensureExpansionMemory();
    if (intel.roomName === memory.forcedRoom || memory.assignments[intel.roomName]?.forced) {
      return evaluateForcedExpansionIntel(intel, PLAYER_USERNAME);
    }
    return evaluateExpansionIntel(intel, PLAYER_USERNAME, EXPANSION_POLICY.minimumSources);
  }

  private isAssignmentActive(assignment: ExpansionAssignment): boolean {
    return this.isAssignmentPhase(assignment, "active");
  }

  private isAssignmentPhase(assignment: ExpansionAssignment, phase: ExpansionAssignment["phase"]): boolean {
    return assignment.phase === phase;
  }

  public roleCall(): void {
    for (const operator of this.operationOperators) {
      if (Game.creeps[operator.name] || !operator.room?.controller?.my) continue;

      const spawn = operator.room.find(FIND_MY_SPAWNS).find(candidate => !candidate.spawning);
      if (!spawn) continue;

      const config = RoomHelper.getRoomConfig(operator.room);
      const spawnConfig = config?.spawns?.find(position => position.x === spawn.pos.x && position.y === spawn.pos.y);
      const directions = spawnConfig?.direction ? [spawnConfig.direction] : SPAWN_DIRECTIONS;
      const result = this.spawnOperator(operator, spawn, directions);
      const assignment = ensureExpansionMemory().assignments[ensureExpansionMemory().currentTarget || ""];
      if (result === OK) {
        if (assignment) {
          assignment.retries = 0;
          assignment.reason = undefined;
          assignment.updatedAt = Game.time;
        }
        continue;
      }
      if (assignment) {
        assignment.retries++;
        assignment.reason =
          result === ERR_NOT_ENOUGH_ENERGY ? "waiting for home energy reserve" : `spawn error ${result}`;
        if (result === ERR_NOT_ENOUGH_ENERGY) assignment.updatedAt = Game.time;
      }
      if (
        result !== ERR_NOT_ENOUGH_ENERGY &&
        result !== ERR_BUSY &&
        Game.time % EXPANSION_POLICY.statusLogInterval === 0
      ) {
        console.log(`[ExpansionManagement] Spawn failed for ${operator.name} in ${operator.room.name}: ${result}`);
      }
    }
  }

  public actions(): void {
    if (!ensureExpansionMemory().enabled) return;
    for (const operator of this.operationOperators) operator.actions();
    this.retireStaleExpansionCreeps();
    this.retireHandedOffWorkers();
  }

  private retireStaleExpansionCreeps(): void {
    const memory = ensureExpansionMemory();
    for (const creep of Object.values(Game.creeps)) {
      if (creep.memory.operation !== "expansionManagement" || !creep.memory.expansionAssignment) continue;
      const assignment = memory.assignments[creep.memory.expansionAssignment];
      if (!assignment) {
        creep.suicide();
      } else if (
        (creep.memory.role === "expansionScout" && assignment.phase !== "scouting") ||
        (creep.memory.role === "claimer" && assignment.phase !== "claiming")
      ) {
        creep.suicide();
      }
    }
  }

  private retireHandedOffWorkers(): void {
    const memory = ensureExpansionMemory();
    for (const creep of Object.values(Game.creeps)) {
      if (creep.memory.role !== "expansionWorker" || !creep.memory.targetRoom) continue;
      const assignment = memory.assignments[creep.memory.targetRoom];
      const room = Game.rooms[creep.memory.targetRoom];
      if (
        assignment?.phase !== "active" ||
        !room?.controller?.my ||
        room.controller.level < EXPANSION_POLICY.handoffControllerLevel ||
        room.find(FIND_MY_SPAWNS).length === 0
      ) {
        continue;
      }

      const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energy > 0) {
        const destination = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
          filter: structure =>
            (structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        if (destination) {
          const result = creep.transfer(destination, RESOURCE_ENERGY);
          if (result === ERR_NOT_IN_RANGE) creep.travelTo(destination.pos);
          if (result === OK || result === ERR_NOT_IN_RANGE) continue;
        }
      }
      creep.suicide();
    }
  }

  private advanceAssignment(assignment: ExpansionAssignment): void {
    const memory = ensureExpansionMemory();
    const targetRoom = Game.rooms[assignment.targetRoom];

    if (memory.dryRun && assignment.phase === "claiming") {
      assignment.phase = "ready";
      assignment.reason = "dry-run enabled; claim paused";
      assignment.updatedAt = Game.time;
    }

    if (
      assignment.phase !== "bootstrapping" &&
      Game.time - assignment.updatedAt > EXPANSION_POLICY.maximumAssignmentAge
    ) {
      this.failAssignment(assignment, "assignment timed out without progress");
      return;
    }

    if (assignment.phase === "scouting") {
      if (targetRoom) {
        const intel = this.captureVisibleIntel(targetRoom);
        const reason = this.evaluateIntel(intel);
        if (reason || (!intel.layout && !this.isForced(assignment.targetRoom))) {
          this.failAssignment(assignment, reason || "no valid default-layout placement was found");
          return;
        }
        assignment.updatedAt = Game.time;
        assignment.reason = undefined;
        assignment.phase = memory.dryRun ? "ready" : "claiming";
        if (memory.dryRun) {
          this.logStatus(`Dry run: ${assignment.targetRoom} is a valid candidate from ${assignment.homeRoom}.`);
        }
      } else {
        const intel = memory.intel[assignment.targetRoom];
        if (intel && Game.time - intel.lastSeen <= EXPANSION_POLICY.maximumIntelAge) {
          assignment.reason = "refreshing candidate intel before claim";
        }
      }
    }

    if (assignment.phase === "ready" && !memory.dryRun) {
      if (targetRoom) {
        const intel = this.captureVisibleIntel(targetRoom);
        const reason = this.evaluateIntel(intel);
        if (reason || (!intel.layout && !this.isForced(assignment.targetRoom))) {
          this.failAssignment(assignment, reason || "no valid default-layout placement was found");
          return;
        }
        assignment.phase = "claiming";
        assignment.updatedAt = Game.time;
      } else {
        assignment.phase = "scouting";
        assignment.updatedAt = Game.time;
      }
    }

    if (assignment.phase === "claiming" && targetRoom) {
      if (targetRoom.controller?.my) {
        assignment.phase = "bootstrapping";
        assignment.updatedAt = Game.time;
      } else if (targetRoom.controller?.owner) {
        this.failAssignment(assignment, `claimed by ${targetRoom.controller.owner.username}`);
        return;
      } else {
        const intel = this.captureVisibleIntel(targetRoom);
        const reason = this.evaluateIntel(intel);
        if (reason || (!intel.layout && !this.isForced(assignment.targetRoom))) {
          this.failAssignment(assignment, reason || "no valid default-layout placement was found");
          return;
        }
      }
    }

    if (assignment.phase === "bootstrapping") {
      const ownedRoom = Game.rooms[assignment.targetRoom];
      if (ownedRoom?.controller?.owner && !ownedRoom.controller.my) {
        this.failAssignment(assignment, `ownership lost to ${ownedRoom.controller.owner.username}`);
        return;
      }
      if (ownedRoom?.controller?.my) {
        let layout = memory.intel[assignment.targetRoom]?.layout;
        if (!layout) {
          const refreshedIntel = this.captureVisibleIntel(ownedRoom);
          layout = refreshedIntel.layout;
        }
        if (!layout && !this.isForced(assignment.targetRoom)) {
          this.logStatus(`Cannot bootstrap ${assignment.targetRoom}: no valid default-layout placement was found.`);
          return;
        }
        RoomHelper.bootstrapOwnedRoom(ownedRoom, assignment.homeRoom, layout);
        if (
          ownedRoom.controller.level >= EXPANSION_POLICY.handoffControllerLevel &&
          ownedRoom.find(FIND_MY_SPAWNS).length > 0
        ) {
          assignment.phase = "active";
          assignment.reason = "colony handed off to normal room operations";
          assignment.updatedAt = Game.time;
          this.logStatus(`Expansion ${assignment.targetRoom} is active; normal room operations now manage it.`);
          return;
        }
      }
    }

    if (
      assignment.phase === "scouting" &&
      !targetRoom &&
      Game.time - assignment.createdAt > EXPANSION_POLICY.maximumAssignmentAge
    ) {
      this.failAssignment(assignment, "scout did not reach target");
    }
  }

  private createAssignmentOperators(assignment: ExpansionAssignment): void {
    const home = Game.rooms[assignment.homeRoom];
    if (!home?.controller?.my) {
      assignment.reason = "sponsoring home is not visible and owned";
      return;
    }

    if (assignment.phase === "scouting") {
      this.operationOperators.push(new Scout(`ExpansionScout_${assignment.targetRoom}`, home, assignment.targetRoom));
    } else if (assignment.phase === "claiming") {
      this.operationOperators.push(
        new Claimer(`ExpansionClaimer_${assignment.targetRoom}`, home, assignment.targetRoom, undefined, "claim")
      );
    } else if (assignment.phase === "bootstrapping") {
      const target = Game.rooms[assignment.targetRoom];
      if (target && !target.controller?.my) return;
      const sourceIds = target
        ? target.find(FIND_SOURCES).map(source => source.id)
        : ensureExpansionMemory().intel[assignment.targetRoom]?.sourceIds || [];
      sourceIds.sort((left, right) => left.localeCompare(right));
      for (let sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex++) {
        for (let workerIndex = 0; workerIndex < EXPANSION_POLICY.workersPerSource; workerIndex++) {
          this.operationOperators.push(
            new ExpansionWorker(
              `ExpansionWorker_${assignment.targetRoom}_${sourceIndex}_${workerIndex}`,
              home,
              assignment.targetRoom,
              sourceIds[sourceIndex]
            )
          );
        }
      }
    }
  }

  private spawnOperator(operator: Operator, spawn: StructureSpawn, directions: DirectionConstant[]): number {
    const memory = ensureExpansionMemory();
    const targetRoom = memory.currentTarget || "";
    const assignment = memory.assignments[targetRoom];

    if (operator instanceof Scout && assignment) {
      return spawn.spawnCreep([MOVE], operator.name, {
        directions,
        memory: {
          role: "expansionScout",
          room: operator.room.name,
          targetRoom,
          operation: "expansionManagement",
          expansionAssignment: targetRoom
        }
      });
    }

    if (operator instanceof Claimer && assignment) {
      if (
        !operator.room.storage ||
        operator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < EXPANSION_POLICY.minimumStorageEnergy ||
        operator.room.energyAvailable < 650
      ) {
        return ERR_NOT_ENOUGH_ENERGY;
      }
      return spawn.spawnCreep([MOVE, CLAIM], operator.name, {
        directions,
        memory: {
          role: "claimer",
          room: operator.room.name,
          targetRoom,
          operation: "expansionManagement",
          expansionAssignment: targetRoom,
          claimMode: "claim"
        }
      });
    }

    if (operator instanceof ExpansionWorker && assignment) {
      if (
        !operator.room.storage ||
        operator.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < EXPANSION_POLICY.minimumStorageEnergy
      ) {
        return ERR_NOT_ENOUGH_ENERGY;
      }
      const units = Math.min(8, Math.floor(operator.room.energyAvailable / 200));
      if (units < 1) return ERR_NOT_ENOUGH_ENERGY;
      const body: BodyPartConstant[] = [];
      for (let index = 0; index < units; index++) body.push(WORK);
      for (let index = 0; index < units; index++) body.push(CARRY);
      for (let index = 0; index < units; index++) body.push(MOVE);
      return spawn.spawnCreep(body, operator.name, {
        directions,
        memory: {
          role: "expansionWorker",
          room: operator.room.name,
          targetRoom,
          operation: "expansionManagement",
          expansionAssignment: targetRoom,
          expansionSourceId: operator.sourceId
        }
      });
    }

    return ERR_INVALID_ARGS;
  }

  private getEligibleHomes(): Room[] {
    return Object.values(Game.rooms)
      .filter(
        room =>
          room.controller &&
          room.controller.my &&
          room.controller.level >= EXPANSION_POLICY.minimumHomeControllerLevel &&
          room.storage &&
          room.storage.store.getUsedCapacity(RESOURCE_ENERGY) >= EXPANSION_POLICY.minimumStorageEnergy &&
          room.find(FIND_MY_SPAWNS).length > 0
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private hasGclCapacity(): boolean {
    const ownedRooms = new Set<string>();
    for (const room of Object.values(Game.rooms)) {
      if (room.controller?.my) ownedRooms.add(room.name);
    }
    for (const [roomName, roomMemory] of Object.entries(Memory.rooms)) {
      if (roomMemory.config?.type === "owned" && roomMemory.config.shard === Game.shard.name) {
        ownedRooms.add(roomName);
      }
    }
    return Game.gcl.level > ownedRooms.size;
  }

  private getCandidates(homes: Room[]): ExpansionCandidate[] {
    const memory = ensureExpansionMemory();
    const homeNames = homes.map(room => room.name);
    const exitsOf = (roomName: string): string[] => {
      const exits = Game.map.describeExits(roomName);
      return exits ? Object.values(exits) : [];
    };
    const candidates = getExpansionCandidates(
      homeNames,
      exitsOf,
      EXPANSION_POLICY.maximumDistance,
      EXPANSION_POLICY.maximumCandidates
    ).filter(candidate => {
      if (homeNames.includes(candidate.roomName)) return false;
      if (candidate.roomName === memory.forcedRoom) return true;
      if (
        memory.assignments[candidate.roomName]?.phase === "failed" &&
        Game.time - memory.assignments[candidate.roomName].updatedAt <= EXPANSION_POLICY.maximumIntelAge
      ) {
        return false;
      }
      const config = getRegisteredRoomConfig(candidate.roomName);
      if (
        config?.type === "owned" ||
        config?.type === "remote" ||
        config?.type === "defend" ||
        config?.type === "keeper-mineral"
      ) {
        return false;
      }
      if (Game.rooms[candidate.roomName]?.controller?.my) return false;
      if (Memory.rooms[candidate.roomName]?.config) return false;
      const status = Game.map.getRoomStatus(candidate.roomName);
      return status.status === "normal";
    });

    const forcedRoom = memory.forcedRoom;
    if (
      forcedRoom &&
      !homeNames.includes(forcedRoom) &&
      !Game.rooms[forcedRoom]?.controller?.my &&
      Game.map.getRoomStatus(forcedRoom).status === "normal"
    ) {
      if (!candidates.some(candidate => candidate.roomName === forcedRoom)) {
        const forced = getExpansionCandidates(homeNames, exitsOf, 10, 10000).find(
          candidate => candidate.roomName === forcedRoom
        );
        if (forced) candidates.push(forced);
      }
    } else if (forcedRoom) {
      this.logStatus(`Forced room ${forcedRoom} cannot be used: closed, already owned, or a home room.`);
      return candidates.filter(candidate => candidate.roomName !== forcedRoom);
    }
    return candidates;
  }

  private selectCandidate(candidates: ExpansionCandidate[]): ExpansionCandidate | undefined {
    const memory = ensureExpansionMemory();
    const availableCandidates = candidates.filter(candidate => {
      const assignment = memory.assignments[candidate.roomName];
      return !assignment || assignment.phase === "failed";
    });
    const forcedCandidate = availableCandidates.find(candidate => candidate.roomName === memory.forcedRoom);
    if (forcedCandidate) {
      const prior = memory.assignments[forcedCandidate.roomName];
      const intel = memory.intel[forcedCandidate.roomName];
      const retryWait = prior?.phase === "failed" && Game.time - prior.updatedAt < 100;
      if (!retryWait && (!intel || Game.time - intel.lastSeen > EXPANSION_POLICY.maximumIntelAge)) {
        return forcedCandidate;
      }
      const reason = prior?.reason || this.getApprovalError(forcedCandidate.roomName, candidates) || "unknown";
      this.logStatus(`Forced room ${forcedCandidate.roomName} is waiting: ${reason}.`);
      return undefined;
    }
    const freshCandidates = getAcceptableExpansionCandidates(
      availableCandidates,
      memory.intel,
      Game.time,
      PLAYER_USERNAME,
      EXPANSION_POLICY.minimumSources,
      EXPANSION_POLICY.maximumIntelAge
    );
    if (freshCandidates.length > 0) {
      const candidate = freshCandidates[0].candidate;
      return {
        roomName: candidate.roomName,
        homeRoom: candidate.homeRoom,
        distance: candidate.distance
      };
    }

    return availableCandidates
      .filter(candidate => {
        const intel = memory.intel[candidate.roomName];
        return !intel || Game.time - intel.lastSeen > EXPANSION_POLICY.maximumIntelAge || !intel.layout;
      })
      .sort((left, right) => left.distance - right.distance || left.roomName.localeCompare(right.roomName))[0];
  }

  private captureVisibleIntel(room: Room) {
    const memory = ensureExpansionMemory();
    const controller = room.controller;
    const intel = {
      roomName: room.name,
      lastSeen: Game.time,
      owner: controller?.owner?.username || null,
      reservation: controller?.reservation?.username || null,
      controller: !!controller,
      sources: room.find(FIND_SOURCES).length,
      sourceIds: room.find(FIND_SOURCES).map(source => source.id),
      keeperLairs:
        room.find(FIND_STRUCTURES, {
          filter: structure => structure.structureType === STRUCTURE_KEEPER_LAIR
        }).length > 0,
      hostileCreeps: room.find(FIND_HOSTILE_CREEPS).length,
      layout: findBestExpansionLayout(room) || undefined
    };
    memory.intel[room.name] = intel;
    return intel;
  }

  private failAssignment(assignment: ExpansionAssignment, reason: string): void {
    assignment.phase = "failed";
    assignment.reason = reason;
    assignment.updatedAt = Game.time;
    console.log(`[ExpansionManagement] Releasing ${assignment.targetRoom}: ${reason}`);
  }

  private logStatus(message: string): void {
    const memory = ensureExpansionMemory();
    if (memory.lastStatusLog !== undefined && Game.time - memory.lastStatusLog < EXPANSION_POLICY.statusLogInterval)
      return;
    memory.lastStatusLog = Game.time;
    console.log(`[ExpansionManagement] ${message}`);
  }
}
