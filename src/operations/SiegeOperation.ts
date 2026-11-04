import { Operation } from "../classes/operation";
import { QuadController, QuadMember, FileAdvanceResult } from "./QuadController";
import { attackWithMembers, chooseCreepFocus, findStructureAt, healMembers, isArmed } from "./SiegeCombat";
import {
  QUAD_BODIES,
  assessThreats,
  assignSpawnRooms,
  buildExposureMap,
  buildGrid,
  chebyshev,
  chooseBoostCompounds,
  computeQuadStats,
  evaluateFeasibility,
  findKiteAnchor,
  getAnchorExposure,
  getHostileSpawns,
  getMissingMembers,
  getQuadBody,
  getSlotCost,
  planSiege,
  BOOST_TIERS
} from "./SiegePlanner";
import { captureSnapshot, getTerrainArray, isSnapshotFresh, scheduleObservation, summarizeCreep } from "./SiegeScanner";
import {
  QUAD_SLOTS,
  QUAD_SLOT_ROLE,
  SIEGE_POLICY,
  QuadPart,
  QuadSlot,
  RoomSide,
  RoomSnapshot,
  SiegeMemory,
  SiegeOptions,
  SiegePhase,
  SiegeRootMemory,
  TilePos
} from "./SiegeTypes";

const BOOST_COMPOUND_PER_PART = 30;
const BOOST_ENERGY_PER_PART = 20;
const SPAWN_TICKS_PER_CREEP = 150;
const TRAVEL_TICKS_PER_ROOM = 55;
const BLOCKED_RETRY_TICKS = 100;
const MAX_HOLD_TICKS = 40;
const STUCK_REPLAN_TICKS = 20;
const LIVE_SNAPSHOT_INTERVAL = 3;
const BOOST_PARTS: QuadPart[] = ["move", "heal", "ranged_attack"];
const ENTRY_DEPTH: Record<RoomSide, number> = { top: 46, bottom: 2, left: 46, right: 2 };
const EXIT_KEYS: Record<RoomSide, string> = { top: "1", right: "3", bottom: "5", left: "7" };

const TERMINAL_PHASES: SiegePhase[] = ["COMPLETE", "ABORTED"];
const IN_ROOM_PHASES: SiegePhase[] = ["BREACHING", "ADVANCING", "ASSAULT", "CLEANUP"];
const PRE_ENTRY_PHASES: SiegePhase[] = ["TRANSIT", "GATHERING", "STAGING"];

const liveSnapshots: Record<string, RoomSnapshot> = {};

// Console helper: siegeDump("E33S1") prints terrain rows and every structure as JSON for offline analysis.
(global as unknown as Record<string, unknown>).siegeDump = (roomName: string): string => {
  const room = Game.rooms[roomName];
  if (!room) return `no vision in ${roomName}`;
  const terrain = room.getTerrain();
  const rows: string[] = [];
  for (let y = 0; y < 50; y++) {
    let row = "";
    for (let x = 0; x < 50; x++) row += terrain.get(x, y);
    rows.push(row);
  }
  const structures = room.find(FIND_STRUCTURES).map(structure => {
    const owned = structure as OwnedStructure;
    const entry: Record<string, unknown> = {
      t: structure.structureType,
      x: structure.pos.x,
      y: structure.pos.y,
      h: structure.hits,
      o: owned.owner ? owned.owner.username : undefined
    };
    if (structure.structureType === STRUCTURE_RAMPART) entry.pub = (structure as StructureRampart).isPublic;
    return entry;
  });
  const creeps = room
    .find(FIND_HOSTILE_CREEPS)
    .map(creep => ({ x: creep.pos.x, y: creep.pos.y, o: creep.owner.username }));
  const json = JSON.stringify({ room: roomName, tick: Game.time, terrain: rows, structures, creeps });
  console.log(json);
  return `dumped ${structures.length} structures`;
};
const parkingSpots: Record<string, { pos: RoomPosition; tick: number }> = {};
const PARKING_CACHE_TICKS = 500;
const WAVE_EXPIRY_TTL = 10;
const terrainCache: Record<string, number[]> = {};

function sameTile(a: TilePos | undefined, b: TilePos | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

export class SiegeOperation extends Operation {
  public init(): void {
    if (!SIEGE_POLICY.enabled) return;
    for (const options of SIEGE_POLICY.targets) {
      if (options.enabled === false) continue;
      const memory = this.getMemory(options);
      try {
        this.update(memory);
      } catch (error) {
        console.log(`[Siege ${memory.id}] update error: ${error}`);
      }
    }
  }

  public roleCall(): void {
    if (!SIEGE_POLICY.enabled) return;
    for (const memory of this.activeSieges()) {
      try {
        if (memory.phase === "PREPARING" || memory.phase === "ASSEMBLING") this.supplyQuad(memory);
      } catch (error) {
        console.log(`[Siege ${memory.id}] spawn error: ${error}`);
      }
    }
  }

  public actions(): void {
    if (!SIEGE_POLICY.enabled) return;
    for (const memory of this.activeSieges()) {
      try {
        this.control(memory);
        this.report(memory);
      } catch (error) {
        console.log(`[Siege ${memory.id}] control error: ${error}`);
      }
    }
  }

  private activeSieges(): SiegeMemory[] {
    return SIEGE_POLICY.targets
      .filter(options => options.enabled !== false)
      .map(options => this.getRoot().sieges[options.id])
      .filter((memory): memory is SiegeMemory => !!memory);
  }

  private getRoot(): SiegeRootMemory {
    if (!Memory.sieges) Memory.sieges = { version: 1, sieges: {} };
    return Memory.sieges;
  }

  private getMemory(options: SiegeOptions): SiegeMemory {
    const root = this.getRoot();
    if (!root.sieges[options.id]) {
      root.sieges[options.id] = {
        id: options.id,
        targetRoom: options.targetRoom,
        phase: "PLANNING",
        phaseSince: Game.time,
        attempt: 0,
        members: {}
      };
    }
    return root.sieges[options.id];
  }

  private setPhase(memory: SiegeMemory, phase: SiegePhase, status?: string): void {
    if (memory.phase !== phase) {
      memory.phase = phase;
      memory.phaseSince = Game.time;
      memory.holdTicks = 0;
    }
    if (status !== undefined) memory.status = status;
  }

  // ---------------------------------------------------------------- state

  private buildQuad(memory: SiegeMemory): QuadController {
    const members: QuadMember[] = [];
    for (const slot of QUAD_SLOTS) {
      const name = memory.members[slot]?.name;
      const creep = name ? Game.creeps[name] : undefined;
      if (creep && !creep.spawning) members.push({ slot, creep });
    }
    return new QuadController(members);
  }

  private aliveCount(memory: SiegeMemory): number {
    return QUAD_SLOTS.length - getMissingMembers(memory.members, name => !!Game.creeps[name]).length;
  }

  private getSnapshot(memory: SiegeMemory): RoomSnapshot | undefined {
    const live = liveSnapshots[memory.id];
    if (live && Game.time - live.tick <= LIVE_SNAPSHOT_INTERVAL + 1) return live;
    return memory.snapshot && (!live || memory.snapshot.tick > live.tick) ? memory.snapshot : live;
  }

  private refreshSnapshot(memory: SiegeMemory, quad: QuadController): RoomSnapshot | undefined {
    const room = Game.rooms[memory.targetRoom];
    if (room) {
      const inside = quad.members.some(member => member.creep.pos.roomName === memory.targetRoom);
      const interval = inside ? LIVE_SNAPSHOT_INTERVAL : SIEGE_POLICY.scanInterval;
      const cached = liveSnapshots[memory.id];
      if (!cached || Game.time - cached.tick >= interval) {
        liveSnapshots[memory.id] = captureSnapshot(room);
      }
      memory.pendingObserver = undefined;
      const live = liveSnapshots[memory.id];
      if (!memory.snapshot || Game.time - (memory.snapshotPersistedAt || 0) >= SIEGE_POLICY.persistSnapshotInterval) {
        memory.snapshot = live;
        memory.snapshotPersistedAt = Game.time;
      }
    }
    return this.getSnapshot(memory);
  }

  private getTerrain(roomName: string): number[] {
    if (!terrainCache[roomName]) terrainCache[roomName] = getTerrainArray(roomName);
    return terrainCache[roomName];
  }

  private getUsername(): string | undefined {
    return Object.values(Game.rooms).find(room => room.controller?.my)?.controller?.owner?.username;
  }

  // Re-links living quad creeps that memory lost track of (e.g. after the siege memory was reset).
  private adoptOrphans(memory: SiegeMemory): void {
    for (const creep of Object.values(Game.creeps)) {
      const creepMemory = creep.memory as { role?: string; siegeId?: string; slot?: QuadSlot };
      if (creepMemory.role !== "siegeQuad" || creepMemory.siegeId !== memory.id || !creepMemory.slot) continue;
      const known = memory.members[creepMemory.slot];
      if (known && Game.creeps[known.name]) continue;
      memory.members[creepMemory.slot] = {
        name: creep.name,
        spawnRoom: creep.memory.room || creep.room.name,
        spawnedAt: Game.time
      };
    }
  }

  private update(memory: SiegeMemory): void {
    if (TERMINAL_PHASES.includes(memory.phase)) {
      this.releaseBoostLabs(memory);
      return;
    }

    this.adoptOrphans(memory);
    const quad = this.buildQuad(memory);
    const alive = this.aliveCount(memory);
    const missing = getMissingMembers(memory.members, name => !!Game.creeps[name]);
    const snapshot = this.refreshSnapshot(memory, quad);
    if (!Game.rooms[memory.targetRoom]) scheduleObservation(memory);

    if (snapshot && snapshot.owner && snapshot.owner === this.getUsername()) {
      this.finish(memory, "ABORTED", "target room is owned by this player");
      return;
    }

    // Safe mode pauses the whole attack; nothing in the room can be hurt until it ends.
    const safeUntil = snapshot?.safeModeEndsAt || 0;
    if (safeUntil > Game.time && memory.phase !== "PAUSED" && memory.phase !== "BLOCKED") {
      memory.safeModeEndsAt = safeUntil;
      this.setPhase(memory, "PAUSED", `safe mode until ${safeUntil}`);
    }

    const wasInField = IN_ROOM_PHASES.includes(memory.phase) || memory.phase === "RETREATING";
    if (quad.members.length) {
      memory.lastMinTtl = Math.min(
        ...quad.members.map(member => member.creep.ticksToLive || SIEGE_POLICY.creepLifetime)
      );
    }
    if (wasInField && alive === 0) {
      this.onWipe(memory);
      return;
    }

    switch (memory.phase) {
      case "PLANNING":
        this.planPhase(memory, snapshot, alive);
        break;
      case "PREPARING":
        if (!missing.length) this.setPhase(memory, "ASSEMBLING", "boosting");
        break;
      case "ASSEMBLING":
        if (missing.length) this.setPhase(memory, "PREPARING", "replacing members");
        else if (quad.isComplete && quad.members.every(member => this.getBoostAction(memory, member) === null)) {
          const inTarget = quad.members.every(member => member.creep.pos.roomName === memory.targetRoom);
          this.setPhase(
            memory,
            inTarget ? "STAGING" : "TRANSIT",
            inTarget ? "already in target room" : "travelling to gather room"
          );
        } else {
          const waiting = quad.members
            .filter(member => this.getBoostAction(memory, member) !== null)
            .map(member => member.slot);
          memory.status = `boosting: ${memory.unboosted ? "unboosted" : "boosted"} mode, boostRoom=${
            memory.boostRoom || "none"
          }, complete=${quad.isComplete}, waiting on ${waiting.join(",") || "none"}`;
        }
        break;
      case "TRANSIT":
      case "GATHERING":
        if (missing.length) this.setPhase(memory, "PREPARING", "member lost before entry");
        else if (quad.isComplete && quad.members.every(member => member.creep.pos.roomName === memory.targetRoom)) {
          this.setPhase(memory, "STAGING", "already in target room");
        }
        break;
      case "STAGING":
        if (missing.length) this.setPhase(memory, "PREPARING", "member lost before entry");
        break;
      case "BREACHING":
      case "ADVANCING":
      case "ASSAULT":
        if (missing.length) this.startRetreat(memory, "member lost");
        break;
      case "RETREATING":
        this.retreatDecision(memory, quad, missing.length);
        break;
      case "PAUSED":
        if (Game.time >= (memory.safeModeEndsAt || 0)) {
          memory.snapshot = undefined;
          delete liveSnapshots[memory.id];
          this.setPhase(memory, "PLANNING", "safe mode ended");
        }
        break;
      case "BLOCKED":
        if (Game.time - memory.phaseSince >= BLOCKED_RETRY_TICKS) this.setPhase(memory, "PLANNING", "retrying");
        break;
      default:
        break;
    }

    this.releaseBoostLabsAfterDeparture(memory, quad);

    if (memory.phase === "CLEANUP" && alive === 0 && memory.spawnsCleared) {
      this.finish(memory, "COMPLETE", "cleanup finished");
    }
  }

  private releaseBoostLabsAfterDeparture(memory: SiegeMemory, quad: QuadController): void {
    const boostRoom = memory.boostRoom;
    if (
      !boostRoom ||
      quad.members.length !== QUAD_SLOTS.length ||
      ["PREPARING", "ASSEMBLING"].includes(memory.phase) ||
      !quad.members.every(member => member.creep.room.name !== boostRoom)
    ) {
      return;
    }
    this.releaseBoostLabs(memory);
  }

  private finish(memory: SiegeMemory, phase: "COMPLETE" | "ABORTED", status: string): void {
    this.setPhase(memory, phase, status);
    this.releaseBoostLabs(memory);
    console.log(`[Siege ${memory.id}] ${phase}: ${status}`);
  }

  private onWipe(memory: SiegeMemory): void {
    memory.members = {};
    memory.boostCompounds = undefined;
    memory.plan = undefined;
    if (memory.spawnsCleared) {
      this.finish(memory, "COMPLETE", "quad lost after spawns were cleared");
      return;
    }
    if (SIEGE_POLICY.allowMultipleWaves && (memory.lastMinTtl ?? Infinity) <= WAVE_EXPIRY_TTL) {
      memory.wave = (memory.wave || 1) + 1;
      memory.lastMinTtl = undefined;
      this.setPhase(memory, "PLANNING", `wave expired, preparing wave ${memory.wave}`);
      return;
    }
    memory.attempt++;
    if (memory.attempt >= SIEGE_POLICY.maxQuadAttempts) {
      this.finish(memory, "ABORTED", `quad lost ${memory.attempt} times`);
      return;
    }
    this.setPhase(memory, "PLANNING", `quad lost (attempt ${memory.attempt})`);
  }

  private startRetreat(memory: SiegeMemory, reason: string): void {
    memory.retreatReason = reason;
    this.setPhase(memory, "RETREATING", `retreating: ${reason}`);
  }

  private retreatDecision(memory: SiegeMemory, quad: QuadController, missingCount: number): void {
    const outside = quad.members.every(member => member.creep.pos.roomName !== memory.targetRoom);
    if (!quad.members.length || !outside) return;

    const minTicks = Math.min(...quad.members.map(member => member.creep.ticksToLive || 0));
    if (missingCount > 0) {
      memory.status =
        minTicks >= SIEGE_POLICY.replacementMinTicksToLive
          ? "retreated: replacing lost member"
          : "retreated: quad spent, guarding until death";
      if (minTicks >= SIEGE_POLICY.replacementMinTicksToLive) this.setPhase(memory, "PREPARING");
      return;
    }
    if (quad.isComplete && quad.minHitsFraction() >= SIEGE_POLICY.resumeHitsFraction) {
      this.setPhase(memory, "PLANNING", "recovered, replanning");
    }
  }

  // ------------------------------------------------------------- planning

  private planPhase(memory: SiegeMemory, snapshot: RoomSnapshot | undefined, alive: number): void {
    if (!isSnapshotFresh(snapshot, SIEGE_POLICY.snapshotMaxAge)) {
      const state = scheduleObservation(memory);
      if (state === "no-observer") this.blocked(memory, "no observer in range of target room");
      else memory.status = "waiting for observer scan";
      return;
    }
    if (!snapshot.controller) {
      this.finish(memory, "ABORTED", "target room has no controller (not ownable)");
      return;
    }
    if (snapshot.safeModeEndsAt > Game.time) return;
    if (Game.cpu.bucket < SIEGE_POLICY.minimumCpuBucket) {
      memory.status = "waiting for cpu bucket";
      return;
    }

    const reasons = this.makePlan(memory, snapshot, alive);
    if (reasons.length) this.blocked(memory, reasons.join("; "));
  }

  private blocked(memory: SiegeMemory, reason: string): void {
    memory.blockedReason = reason;
    this.setPhase(memory, "BLOCKED", `blocked: ${reason}`);
  }

  private makePlan(memory: SiegeMemory, snapshot: RoomSnapshot, alive: number): string[] {
    if (alive === 0) {
      memory.boostCompounds = undefined;
      memory.boostRoom = undefined;
    }

    memory.unboosted = !snapshot.owner;
    if (memory.unboosted) {
      memory.boostCompounds = {};
      memory.boostRoom = undefined;
    } else if (!memory.boostRoom || !memory.boostCompounds) {
      const boostRoom = this.chooseBoostRoom(memory.targetRoom);
      if (!boostRoom) return ["no owned room with spare labs and a terminal to boost in"];
      const selection = chooseBoostCompounds(this.getBoostStock(boostRoom));
      const compounds: Partial<Record<QuadPart, string>> = {};
      for (const part of BOOST_PARTS) {
        const choice = selection.choices[part];
        if (choice) compounds[part] = choice.compound;
      }
      if (!this.assignBoostLabs(boostRoom, compounds)) return [`${boostRoom.name} has too few usable labs`];
      memory.boostRoom = boostRoom.name;
      memory.boostCompounds = compounds;
    }

    const stats = computeQuadStats(memory.boostCompounds, memory.unboosted);
    const result = planSiege({
      snapshot,
      terrain: this.getTerrain(memory.targetRoom),
      stats,
      safetyFactor: SIEGE_POLICY.safetyFactor
    });
    if (!result.feasible) {
      const towers = snapshot.structures.filter(structure => structure.type === "tower" && structure.hostile);
      const active = towers.filter(tower => (tower.energy || 0) >= 10).length;
      return [
        `owner=${snapshot.owner || "none"} mode=${memory.unboosted ? "unboosted" : "boosted"} towers=${active}/${
          towers.length
        } active (snapshot age ${Game.time - snapshot.tick})`,
        ...result.reasons
      ];
    }

    const plan = result.plan;
    if (!plan.entrySide) return ["plan has no entry side"];
    const gather = this.findGatherAnchor(memory.targetRoom, plan.entrySide, plan.file?.[0] || plan.path[0].anchor);
    if (!gather) return ["no walkable gather area outside the entry side"];

    const missing = getMissingMembers(memory.members, name => !!Game.creeps[name]);
    if (missing.length) {
      const assignment = assignSpawnRooms(this.getSpawnCandidates(memory.targetRoom), missing, !!memory.unboosted);
      if (!assignment) return ["not enough spawn capacity in owned rooms"];
      const perRoom: Record<string, number> = {};
      let travel = 0;
      for (const slot of missing) {
        const room = assignment[slot]!;
        perRoom[room] = (perRoom[room] || 0) + 1;
        const legs = memory.boostRoom
          ? Game.map.getRoomLinearDistance(room, memory.boostRoom) +
            Game.map.getRoomLinearDistance(memory.boostRoom, gather.room)
          : Game.map.getRoomLinearDistance(room, gather.room);
        travel = Math.max(travel, legs * TRAVEL_TICKS_PER_ROOM);
      }
      const aliveTtl = QUAD_SLOTS.filter(slot => Game.creeps[memory.members[slot]?.name || ""])
        .map(slot => Game.creeps[memory.members[slot]!.name].ticksToLive || SIEGE_POLICY.creepLifetime)
        .concat(SIEGE_POLICY.creepLifetime);
      const reasons = evaluateFeasibility({
        plan,
        travelTicks: travel,
        spawnTicks: Math.max(...Object.values(perRoom)) * SPAWN_TICKS_PER_CREEP,
        creepLifetime: Math.min(...aliveTtl),
        margin: SIEGE_POLICY.lifetimeMargin,
        multiWave: SIEGE_POLICY.allowMultipleWaves
      });
      if (reasons.length) return reasons;
    } else {
      const ttl = Math.min(
        ...this.buildQuad(memory).members.map(member => member.creep.ticksToLive || SIEGE_POLICY.creepLifetime)
      );
      const reasons = evaluateFeasibility({
        plan,
        travelTicks: TRAVEL_TICKS_PER_ROOM,
        spawnTicks: 0,
        creepLifetime: ttl,
        margin: SIEGE_POLICY.lifetimeMargin,
        multiWave: SIEGE_POLICY.allowMultipleWaves
      });
      if (reasons.length) return reasons;
    }

    memory.plan = plan;
    memory.pathIndex = 0;
    memory.anchor = undefined;
    memory.gatherRoom = gather.room;
    memory.gatherAnchor = gather.anchor;
    memory.blockedReason = undefined;
    this.setPhase(memory, "PREPARING", `plan ready: ${plan.objective}, ${plan.path.length} steps`);
    return [];
  }

  private findGatherAnchor(
    targetRoom: string,
    side: RoomSide,
    entry: TilePos
  ): { room: string; anchor: TilePos } | null {
    const exits = Game.map.describeExits(targetRoom) as Record<string, string> | null;
    const room = exits?.[EXIT_KEYS[side]];
    if (!room) return null;
    const terrain = Game.map.getRoomTerrain(room);
    const horizontal = side === "top" || side === "bottom";
    const along = horizontal ? entry.x : entry.y;

    for (let delta = 0; delta <= 12; delta++) {
      for (const sign of delta === 0 ? [1] : [1, -1]) {
        const offset = Math.min(46, Math.max(2, along + sign * delta));
        const anchor = horizontal ? { x: offset, y: ENTRY_DEPTH[side] } : { x: ENTRY_DEPTH[side], y: offset };
        const open = [0, 1].every(dx =>
          [0, 1].every(dy => terrain.get(anchor.x + dx, anchor.y + dy) !== TERRAIN_MASK_WALL)
        );
        if (open) return { room, anchor };
      }
    }
    return null;
  }

  private getSpawnCandidates(targetRoom: string) {
    return Object.values(Game.rooms)
      .filter(room => room.controller?.my)
      .map(room => ({
        name: room.name,
        distance: Game.map.getRoomLinearDistance(room.name, targetRoom),
        spawnCount: room.find(FIND_MY_SPAWNS).length,
        capacity: room.energyCapacityAvailable
      }))
      .filter(candidate => candidate.spawnCount > 0);
  }

  // ---------------------------------------------------------------- boost

  private chooseBoostRoom(targetRoom: string): Room | null {
    const rooms = Object.values(Game.rooms)
      .filter(room => room.controller?.my && room.terminal && this.getBoostLabCandidates(room).length >= 3)
      .sort(
        (left, right) =>
          Game.map.getRoomLinearDistance(left.name, targetRoom) -
            Game.map.getRoomLinearDistance(right.name, targetRoom) || left.name.localeCompare(right.name)
      );
    return rooms[0] || null;
  }

  private getBoostLabCandidates(room: Room): StructureLab[] {
    const reagents = new Set<string>([
      ...(room.memory.data?.labs?.reagents || []).map(entry => entry.id),
      ...(room.memory.data?.labs?.production?.inputLabIds || [])
    ]);
    return room
      .find<StructureLab>(FIND_MY_STRUCTURES, { filter: structure => structure.structureType === STRUCTURE_LAB })
      .filter(lab => !reagents.has(lab.id));
  }

  private assignBoostLabs(room: Room, compounds: Partial<Record<QuadPart, string>>): boolean {
    const labs = this.getBoostLabCandidates(room);
    const used = new Set<string>();
    const assignments: { id: Id<StructureLab>; component: ResourceConstant }[] = [];

    for (const part of BOOST_PARTS) {
      const compound = compounds[part] as ResourceConstant | undefined;
      if (!compound) continue;
      const lab =
        labs.find(candidate => !used.has(candidate.id) && candidate.mineralType === compound) ||
        labs.find(candidate => !used.has(candidate.id) && !candidate.mineralType);
      if (!lab) return false;
      used.add(lab.id);
      assignments.push({ id: lab.id, component: compound });
    }

    if (!room.memory.data) return false;
    if (!room.memory.data.labs) room.memory.data.labs = { reagents: [], products: [], boosts: [] };
    room.memory.data.labs.boosts = assignments;
    return true;
  }

  private releaseBoostLabs(memory: SiegeMemory): void {
    if (!memory.boostRoom) return;
    const room = Game.rooms[memory.boostRoom];
    if (room?.memory.data?.labs) room.memory.data.labs.boosts = [];
    memory.boostRoom = undefined;
  }

  private getBoostStock(room: Room): Record<string, number> {
    const stock: Record<string, number> = {};
    const compounds: string[] = [];
    for (const part of BOOST_PARTS) for (const tier of BOOST_TIERS[part]) compounds.push(tier.compound);
    for (const compound of compounds) {
      const resource = compound as ResourceConstant;
      let total =
        (room.storage?.store.getUsedCapacity(resource) || 0) + (room.terminal?.store.getUsedCapacity(resource) || 0);
      for (const lab of this.getBoostLabCandidates(room)) {
        if (lab.mineralType === resource) total += lab.store.getUsedCapacity(resource) || 0;
      }
      stock[compound] = total;
    }
    return stock;
  }

  private slotsNeedingBoost(memory: SiegeMemory): QuadSlot[] {
    return QUAD_SLOTS.filter(slot => {
      const creep = Game.creeps[memory.members[slot]?.name || ""];
      return !creep || this.getBoostAction(memory, { slot, creep }) !== null;
    });
  }

  private getRequiredBoostNeeds(memory: SiegeMemory, slots: QuadSlot[]): { compound: string; amount: number }[] {
    const needs: Record<string, number> = {};
    for (const slot of slots) {
      for (const part of ["move", "heal"] as QuadPart[]) {
        const compound = memory.boostCompounds?.[part];
        if (!compound) continue;
        const count = QUAD_BODIES[QUAD_SLOT_ROLE[slot]].filter(bodyPart => bodyPart === part).length;
        needs[compound] = (needs[compound] || 0) + count * BOOST_COMPOUND_PER_PART;
      }
    }
    return Object.keys(needs).map(compound => ({ compound, amount: needs[compound] }));
  }

  // Returns the next lab action for a member, "wait" while stock is missing, or null once boosting is complete.
  private getBoostAction(
    memory: SiegeMemory,
    member: QuadMember
  ): { lab: StructureLab; count: number } | "wait" | null {
    if (memory.unboosted) return null;
    const room = memory.boostRoom ? Game.rooms[memory.boostRoom] : undefined;
    const compounds = memory.boostCompounds;
    if (!room || !compounds) return "wait";
    const entries = room.memory.data?.labs?.boosts || [];
    const spawnedAt = memory.members[member.slot]?.spawnedAt || Game.time;

    for (const part of BOOST_PARTS) {
      const compound = compounds[part];
      if (!compound) continue;
      const unboosted = member.creep.body.filter(bodyPart => bodyPart.type === part && !bodyPart.boost).length;
      if (unboosted === 0) continue;
      const optional = part === "ranged_attack";
      if (optional && Game.time - spawnedAt > SIEGE_POLICY.rangedBoostWaitTicks) continue;

      const entry = entries.find(candidate => candidate.component === compound);
      const lab = entry ? Game.getObjectById(entry.id) : null;
      const minerals = lab?.store.getUsedCapacity(compound as ResourceConstant) || 0;
      const energy = lab?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      const count = Math.min(
        unboosted,
        Math.floor(minerals / BOOST_COMPOUND_PER_PART),
        Math.floor(energy / BOOST_ENERGY_PER_PART)
      );
      if (!lab || count <= 0) {
        if (optional) continue;
        return "wait";
      }
      return { lab, count };
    }
    return null;
  }

  private boostMember(memory: SiegeMemory, member: QuadMember): void {
    const creep = member.creep;
    if (memory.unboosted) {
      this.parkMember(member);
      return;
    }
    const room = memory.boostRoom ? Game.rooms[memory.boostRoom] : undefined;
    if (!room) return;
    const action = this.getBoostAction(memory, member);

    if (action && action !== "wait") {
      if (creep.pos.isNearTo(action.lab)) action.lab.boostCreep(creep, action.count);
      else creep.travelTo(action.lab.pos, { range: 1 });
      return;
    }

    const anchorLab = (room.memory.data?.labs?.boosts || [])
      .map(entry => Game.getObjectById(entry.id))
      .find(lab => !!lab);
    if (creep.room.name !== room.name && anchorLab && action === "wait") creep.travelTo(anchorLab.pos, { range: 3 });
    else this.parkMember(member);
  }

  // Moves a member to an out-of-the-way tile so it never blocks spawns, labs or other structures.
  private parkMember(member: QuadMember): void {
    const creep = member.creep;
    const spot = this.getParkingSpot(creep.room, member.slot);
    if (!spot) return;
    if (creep.pos.x !== spot.x || creep.pos.y !== spot.y) creep.travelTo(spot, { range: 0 });
  }

  private getParkingSpot(room: Room, slot: QuadSlot): RoomPosition | null {
    const key = `${room.name}:${slot}`;
    const cached = parkingSpots[key];
    if (cached && Game.time - cached.tick < PARKING_CACHE_TICKS) return cached.pos;

    const anchors = room.find(FIND_MY_SPAWNS);
    const origin = anchors[0] || room.controller;
    if (!origin) return null;

    const terrain = room.getTerrain();
    const blocked = new Set<string>();
    const near = new Set<string>();
    const mark = (set: Set<string>, x: number, y: number, radius: number): void => {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) set.add(`${x + dx},${y + dy}`);
      }
    };
    for (const structure of room.find(FIND_STRUCTURES)) {
      if (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_RAMPART) continue;
      mark(structure.structureType === STRUCTURE_SPAWN ? near : blocked, structure.pos.x, structure.pos.y, 1);
      if (structure.structureType === STRUCTURE_SPAWN) mark(near, structure.pos.x, structure.pos.y, 3);
    }
    for (const site of room.find(FIND_CONSTRUCTION_SITES)) mark(blocked, site.pos.x, site.pos.y, 1);
    for (const source of room.find(FIND_SOURCES)) mark(blocked, source.pos.x, source.pos.y, 2);

    const taken = new Set<string>(
      Object.keys(parkingSpots)
        .filter(other => other.startsWith(`${room.name}:`) && other !== key)
        .map(other => `${parkingSpots[other].pos.x},${parkingSpots[other].pos.y}`)
    );

    let best: { pos: RoomPosition; score: number } | null = null;
    for (let radius = 4; radius <= 14 && !best; radius++) {
      for (let x = Math.max(2, origin.pos.x - radius); x <= Math.min(47, origin.pos.x + radius); x++) {
        for (let y = Math.max(2, origin.pos.y - radius); y <= Math.min(47, origin.pos.y + radius); y++) {
          const k = `${x},${y}`;
          if (terrain.get(x, y) === TERRAIN_MASK_WALL || blocked.has(k) || near.has(k) || taken.has(k)) continue;
          const score =
            Math.max(Math.abs(x - origin.pos.x), Math.abs(y - origin.pos.y)) * 2 + (terrain.get(x, y) ? 3 : 0);
          if (!best || score < best.score) best = { pos: new RoomPosition(x, y, room.name), score };
        }
      }
    }
    if (!best) return null;
    parkingSpots[key] = { pos: best.pos, tick: Game.time };
    return best.pos;
  }

  private buyBoosts(memory: SiegeMemory, shortfalls: { compound: string; amount: number }[]): void {
    if (Game.time - (memory.lastPurchaseTick || 0) < SIEGE_POLICY.boostPurchaseInterval) return;
    memory.lastPurchaseTick = Game.time;
    const room = memory.boostRoom ? Game.rooms[memory.boostRoom] : undefined;
    const terminal = room?.terminal;
    if (!room || !terminal || terminal.cooldown > 0) return;

    for (const shortfall of shortfalls) {
      const resource = shortfall.compound as ResourceConstant;
      const orders = Game.market
        .getAllOrders(
          order =>
            order.type === ORDER_SELL &&
            order.resourceType === resource &&
            order.amount > 0 &&
            order.price <= SIEGE_POLICY.maxBoostUnitPrice
        )
        .sort((left, right) => left.price - right.price);
      const best = orders[0];
      if (!best || !best.roomName) continue;

      let amount = Math.min(
        shortfall.amount,
        best.amount,
        Math.floor(Game.market.credits / best.price),
        terminal.store.getFreeCapacity() || 0
      );
      if (amount <= 0) continue;
      const cost = Game.market.calcTransactionCost(amount, room.name, best.roomName);
      const energy = terminal.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      if (cost > energy) amount = Math.floor((amount * energy) / cost);
      if (amount <= 0) continue;

      const result = Game.market.deal(best.id, amount, room.name);
      console.log(`[Siege ${memory.id}] bought ${amount} ${shortfall.compound} at ${best.price}: ${result}`);
      if (result === OK) return;
    }
  }

  // ---------------------------------------------------------------- spawn

  private supplyQuad(memory: SiegeMemory): void {
    if (!memory.boostCompounds) return;
    let shortfalls: { compound: string; amount: number }[] = [];
    if (!memory.unboosted) {
      const boostRoom = memory.boostRoom ? Game.rooms[memory.boostRoom] : undefined;
      if (!boostRoom) return;
      if (!this.assignBoostLabs(boostRoom, memory.boostCompounds)) return;

      const needsBoost = this.slotsNeedingBoost(memory);
      const stock = this.getBoostStock(boostRoom);
      shortfalls = this.getRequiredBoostNeeds(memory, needsBoost)
        .map(need => ({ compound: need.compound, amount: need.amount - (stock[need.compound] || 0) }))
        .filter(entry => entry.amount > 0);
      if (shortfalls.length) {
        this.buyBoosts(memory, shortfalls);
      }
    }

    const missing = getMissingMembers(memory.members, name => !!Game.creeps[name]);
    if (!missing.length || memory.phase !== "PREPARING" || shortfalls.length) return;

    const assignment = assignSpawnRooms(this.getSpawnCandidates(memory.targetRoom), missing, !!memory.unboosted);
    if (!assignment) {
      memory.status = `waiting to spawn ${missing.join(",")}: not enough spawn capacity`;
      return;
    }

    for (const slot of missing) {
      const roomName = assignment[slot];
      const room = roomName ? Game.rooms[roomName] : undefined;
      if (!room) continue;
      const body = getQuadBody(slot, memory.unboosted);
      const cost = getSlotCost(slot, memory.unboosted);
      if (room.energyAvailable < cost) {
        memory.status = `waiting to spawn ${slot} in ${room.name}: energy ${room.energyAvailable}/${cost}`;
        continue;
      }
      const spawn = room.find(FIND_MY_SPAWNS).find(candidate => !candidate.spawning);
      if (!spawn) {
        memory.status = `waiting to spawn ${slot} in ${room.name}: all spawns busy`;
        continue;
      }

      const name = `siege_${memory.id}_${slot}_${Game.time}`;
      const result = spawn.spawnCreep(body, name, {
        memory: { role: "siegeQuad", siegeId: memory.id, slot, room: room.name, boostedParts: [] }
      });
      if (result === OK) memory.members[slot] = { name, spawnRoom: room.name, spawnedAt: Game.time };
    }
  }

  // -------------------------------------------------------------- control

  private control(memory: SiegeMemory): void {
    if (TERMINAL_PHASES.includes(memory.phase)) return;
    const quad = this.buildQuad(memory);
    if (!quad.members.length) return;

    switch (memory.phase) {
      case "PREPARING":
      case "ASSEMBLING":
        for (const member of quad.members) this.boostMember(memory, member);
        this.guard(quad);
        break;
      case "TRANSIT":
        this.transit(memory, quad);
        break;
      case "GATHERING":
        if (memory.gatherRoom && memory.gatherAnchor && quad.formUp(memory.gatherRoom, memory.gatherAnchor)) {
          this.setPhase(memory, "STAGING", "entering target room");
        }
        this.guard(quad);
        break;
      case "STAGING":
        this.staging(memory, quad);
        break;
      case "BREACHING":
      case "ADVANCING":
      case "ASSAULT":
      case "CLEANUP":
        this.fight(memory, quad);
        break;
      case "RETREATING":
        this.retreat(memory, quad);
        break;
      case "PAUSED":
        this.pause(memory, quad);
        break;
      default:
        this.guard(quad);
        break;
    }
  }

  private transit(memory: SiegeMemory, quad: QuadController): void {
    if (!memory.gatherRoom || !memory.gatherAnchor || !quad.isComplete) {
      this.guard(quad);
      return;
    }
    const target = new RoomPosition(memory.gatherAnchor.x, memory.gatherAnchor.y, memory.gatherRoom);
    if (quad.moveFile(target, 3) === "ARRIVED") this.setPhase(memory, "GATHERING", "forming up");
    this.guard(quad);
  }

  private staging(memory: SiegeMemory, quad: QuadController): void {
    const plan = memory.plan;
    const entry = plan?.path[0]?.anchor;
    if (!plan || !entry || !quad.isComplete) {
      this.guard(quad);
      return;
    }
    const file = plan.file?.map(tile => new RoomPosition(tile.x, tile.y, memory.targetRoom)) || [];
    const room = Game.rooms[memory.targetRoom];
    const leader = quad.members[0].creep;

    if (file.length && (!room || leader.pos.roomName !== memory.targetRoom)) {
      quad.moveFile(file[0], 1);
      this.guard(quad);
      return;
    }

    let result: FileAdvanceResult = "DONE";
    let blocker: Structure | null = null;
    if (file.length && room) {
      result = quad.advanceFile(file, pos => {
        blocker = this.findBarrierAt(room, pos);
        return !!blocker || room.lookForAt(LOOK_CREEPS, pos.x, pos.y).some(creep => !creep.my);
      });
      if (result === "OFF_PATH") {
        quad.moveFile(file[0], 1);
        this.guard(quad);
        return;
      }
    }

    if (result === "DONE") {
      if (quad.formUp(memory.targetRoom, entry)) {
        memory.pathIndex = 0;
        memory.anchor = entry;
        this.setPhase(memory, "ADVANCING", "inside target room");
        return;
      }
      this.fireAndHeal(quad, memory.targetRoom);
      return;
    }

    if (result === "BLOCKED" && blocker && room) {
      memory.status = "breaking through the entry barrier";
      healMembers(quad.members);
      attackWithMembers(quad.members, blocker, room.find(FIND_HOSTILE_CREEPS), [blocker]);
      this.holdPositions(room, blocker, quad);
      return;
    }
    memory.status = "advancing single file";
    this.fireAndHeal(quad, memory.targetRoom);
  }

  // Creeps cannot hold a border tile, so while breaching each member takes its own open non-border tile within shooting range, attackers closest.
  private holdPositions(room: Room, blocker: Structure, quad: QuadController): void {
    const terrain = room.getTerrain();
    const taken = new Set(room.find(FIND_STRUCTURES).map(structure => `${structure.pos.x},${structure.pos.y}`));
    const candidates: { x: number; y: number; range: number }[] = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const x = blocker.pos.x + dx;
        const y = blocker.pos.y + dy;
        if (x < 1 || y < 1 || x > 48 || y > 48 || terrain.get(x, y) === TERRAIN_MASK_WALL || taken.has(`${x},${y}`))
          continue;
        candidates.push({ x, y, range: Math.max(Math.abs(dx), Math.abs(dy)) });
      }
    }
    candidates.sort((left, right) => left.range - right.range);
    const used = new Set<string>();
    const settled = new Set<string>();
    for (const member of quad.members) {
      const pos = member.creep.pos;
      if (
        pos.roomName === room.name &&
        candidates.some(tile => tile.x === pos.x && tile.y === pos.y) &&
        !used.has(`${pos.x},${pos.y}`)
      ) {
        used.add(`${pos.x},${pos.y}`);
        settled.add(member.creep.name);
      }
    }
    for (const member of quad.members) {
      if (settled.has(member.creep.name)) continue;
      const stand = candidates.find(tile => !used.has(`${tile.x},${tile.y}`));
      if (!stand) continue;
      used.add(`${stand.x},${stand.y}`);
      member.creep.travelTo(new RoomPosition(stand.x, stand.y, room.name), { range: 0, allowHostile: true });
    }
  }

  private findBarrierAt(room: Room, pos: RoomPosition): Structure | null {
    return (
      room
        .lookForAt(LOOK_STRUCTURES, pos.x, pos.y)
        .find(
          structure => structure.structureType === STRUCTURE_RAMPART || structure.structureType === STRUCTURE_WALL
        ) || null
    );
  }

  // Heals the quad and shoots hostile creeps in whatever room each member is standing in.
  private guard(quad: QuadController): void {
    this.fireAndHeal(quad, null);
  }

  private fireAndHeal(quad: QuadController, structureRoom: string | null): void {
    healMembers(quad.members);
    const rooms = new Set(quad.members.map(member => member.creep.room.name));
    for (const roomName of rooms) {
      const room = Game.rooms[roomName];
      if (!room) continue;
      const members = quad.members.filter(member => member.creep.room.name === roomName);
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      const focus = chooseCreepFocus(hostiles, members);
      const structures = structureRoom === roomName ? this.getHostileStructures(room) : [];
      attackWithMembers(members, focus, hostiles, structures);
    }
  }

  private getHostileStructures(room: Room): Structure[] {
    const priority = (structure: Structure): number => {
      if (structure.structureType === STRUCTURE_SPAWN) return 0;
      if (structure.structureType === STRUCTURE_TOWER) return 1;
      if (structure.structureType === STRUCTURE_RAMPART) return 3;
      return 2;
    };
    return room
      .find(FIND_HOSTILE_STRUCTURES)
      .filter(structure => structure.structureType !== STRUCTURE_CONTROLLER)
      .sort((left, right) => priority(left) - priority(right));
  }

  private fight(memory: SiegeMemory, quad: QuadController): void {
    const room = Game.rooms[memory.targetRoom];
    const plan = memory.plan;
    if (!room || !plan) {
      this.guard(quad);
      return;
    }

    const cleanup = memory.phase === "CLEANUP";
    if (!cleanup && quad.minHitsFraction() < SIEGE_POLICY.retreatHitsFraction) {
      this.startRetreat(memory, "low hit points");
      this.retreat(memory, quad);
      return;
    }

    const actual = quad.isComplete && quad.roomName() === memory.targetRoom ? quad.getAnchor() : null;
    if (!actual) {
      const rally = memory.anchor || plan.path[memory.pathIndex || 0]?.anchor;
      if (rally && quad.isComplete) quad.formUp(memory.targetRoom, rally);
      this.fireAndHeal(quad, memory.targetRoom);
      return;
    }

    const pathIndex = this.syncPathIndex(memory, actual);
    if (pathIndex < 0) {
      if (!this.replan(memory, actual)) this.handleNoRoute(memory, quad);
      this.fireAndHeal(quad, memory.targetRoom);
      return;
    }
    memory.anchor = actual;

    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const snapshot = this.getSnapshot(memory);
    const stats = computeQuadStats(memory.boostCompounds || {}, memory.unboosted);

    // Armed creeps near the quad are killed, or kited away from towers when the position is too costly.
    const nearby = hostiles.filter(
      hostile =>
        isArmed(hostile) &&
        quad.members.some(member => member.creep.pos.getRangeTo(hostile) <= SIEGE_POLICY.threatRange)
    );
    let hold = false;
    if (nearby.length && snapshot) {
      const grid = buildGrid(snapshot, this.getTerrain(memory.targetRoom));
      const exposure = buildExposureMap(snapshot);
      const kite = findKiteAnchor(grid, exposure, actual, nearby.map(summarizeCreep), SIEGE_POLICY.kiteSearchSteps);
      const assessment = assessThreats(
        stats,
        SIEGE_POLICY.safetyFactor,
        getAnchorExposure(exposure, actual),
        nearby.map(summarizeCreep),
        !!kite
      );
      if (assessment.action === "RETREAT" && !cleanup) {
        this.startRetreat(memory, "threat too strong");
        this.retreat(memory, quad);
        return;
      }
      if (assessment.action === "KITE" && kite && kite.path.length > 1) {
        const next = kite.path[1];
        quad.stepTo(actual, next);
        memory.status = "kiting armed hostiles";
        this.fireAndHeal(quad, memory.targetRoom);
        return;
      }
      const closest = Math.min(
        ...nearby.map(hostile => Math.min(...quad.members.map(member => member.creep.pos.getRangeTo(hostile))))
      );
      hold = closest <= 3 && (memory.holdTicks || 0) < MAX_HOLD_TICKS;
    }
    memory.holdTicks = hold ? (memory.holdTicks || 0) + 1 : nearby.length ? memory.holdTicks : 0;

    const nextStep = plan.path[pathIndex + 1];
    const breachStructure = nextStep ? this.findBreachStructure(room, nextStep.breach) : null;
    const controllerGoal = plan.objective === "CONTROLLER";
    const objective = controllerGoal ? room.controller : Game.getObjectById(plan.targetId as Id<Structure>);
    const focus: Creep | Structure | null =
      chooseCreepFocus(hostiles, quad.members) ||
      breachStructure ||
      (nextStep || controllerGoal ? null : (objective as Structure | null));

    healMembers(quad.members);
    attackWithMembers(quad.members, focus, hostiles, this.getHostileStructures(room));

    if (controllerGoal && !nextStep) {
      if (!hostiles.length) {
        this.finish(memory, "COMPLETE", "controller is accessible");
      }
      return;
    }
    if (!objective) {
      this.onTargetDestroyed(memory, quad, actual);
      return;
    }
    if (hold) return;

    if (nextStep) {
      if (breachStructure) {
        this.setPhase(memory, cleanup ? "CLEANUP" : "BREACHING", "breaking through defenses");
        return;
      }
      const result = quad.stepTo(actual, nextStep.anchor);
      if (!cleanup) this.setPhase(memory, "ADVANCING");
      if (result === "BLOCKED") {
        memory.holdTicks = (memory.holdTicks || 0) + 1;
        if ((memory.holdTicks || 0) > STUCK_REPLAN_TICKS) {
          memory.holdTicks = 0;
          if (!this.replan(memory, actual)) this.handleNoRoute(memory, quad);
        }
      }
      return;
    }

    if (!cleanup) this.setPhase(memory, "ASSAULT", `attacking ${plan.objective}`);
  }

  private syncPathIndex(memory: SiegeMemory, actual: TilePos): number {
    const path = memory.plan?.path || [];
    const current = memory.pathIndex || 0;
    let best = -1;
    path.forEach((step, index) => {
      if (!sameTile(step.anchor, actual)) return;
      if (best < 0 || Math.abs(index - current) < Math.abs(best - current)) best = index;
    });
    if (best >= 0) memory.pathIndex = best;
    return best;
  }

  private findBreachStructure(room: Room, breach: { x: number; y: number }[]): Structure | null {
    for (const tile of breach) {
      const structure = findStructureAt(room, tile.x, tile.y);
      if (structure) return structure;
    }
    return null;
  }

  private replan(memory: SiegeMemory, start: TilePos): boolean {
    const snapshot = this.getSnapshot(memory);
    if (!snapshot) return false;
    const result = planSiege({
      snapshot,
      terrain: this.getTerrain(memory.targetRoom),
      stats: computeQuadStats(memory.boostCompounds || {}, memory.unboosted),
      safetyFactor: SIEGE_POLICY.safetyFactor,
      startAnchor: start
    });
    if (!result.feasible) {
      memory.status = `no route: ${result.reasons.join("; ")}`;
      return false;
    }
    memory.plan = result.plan;
    memory.pathIndex = 0;
    return true;
  }

  private handleNoRoute(memory: SiegeMemory, quad: QuadController): void {
    if (memory.phase === "CLEANUP") return;
    this.startRetreat(memory, "no safe route");
    this.retreat(memory, quad);
  }

  private onTargetDestroyed(memory: SiegeMemory, quad: QuadController, actual: TilePos): void {
    const room = Game.rooms[memory.targetRoom];
    if (room) liveSnapshots[memory.id] = captureSnapshot(room);
    const snapshot = liveSnapshots[memory.id];

    if (snapshot && !memory.spawnsCleared && getHostileSpawns(snapshot).length === 0) {
      memory.spawnsCleared = true;
      this.setPhase(memory, "CLEANUP", "spawns destroyed; clearing the room");
      console.log(`[Siege ${memory.id}] all spawns destroyed, no further quads will be sent`);
    }
    if (!this.replan(memory, actual)) {
      if (memory.phase !== "CLEANUP") this.handleNoRoute(memory, quad);
      else memory.status = "cleanup: no reachable targets left";
    }
  }

  private retreat(memory: SiegeMemory, quad: QuadController): void {
    const plan = memory.plan;
    const gatherRoom = memory.gatherRoom;
    const gatherAnchor = memory.gatherAnchor;
    healMembers(quad.members);
    this.fireAndHeal(quad, null);
    if (!gatherRoom || !gatherAnchor) return;

    const inTarget = quad.members.some(member => member.creep.pos.roomName === memory.targetRoom);
    if (inTarget && plan && quad.isComplete && quad.roomName() === memory.targetRoom) {
      const actual = quad.getAnchor();
      const index = actual ? this.syncPathIndex(memory, actual) : -1;
      if (actual && index > 0) {
        quad.stepTo(actual, plan.path[index - 1].anchor);
        return;
      }
    }

    const outside = quad.members.every(member => member.creep.pos.roomName === gatherRoom);
    if (outside) {
      quad.formUp(gatherRoom, gatherAnchor);
      return;
    }
    for (const member of quad.members) {
      if (member.creep.pos.roomName === gatherRoom) continue;
      member.creep.travelTo(new RoomPosition(gatherAnchor.x, gatherAnchor.y, gatherRoom), { range: 2 });
    }
  }

  // Safe mode: leave the room, hold position in the neighbouring room and kill anything that comes out.
  private pause(memory: SiegeMemory, quad: QuadController): void {
    this.guard(quad);
    const gatherRoom = memory.gatherRoom;
    const gatherAnchor = memory.gatherAnchor;
    if (!gatherRoom || !gatherAnchor) return;
    const target = new RoomPosition(gatherAnchor.x, gatherAnchor.y, gatherRoom);
    for (const member of quad.members) {
      if (member.creep.pos.roomName === memory.targetRoom) member.creep.travelTo(target, { range: 2 });
    }
    if (quad.members.every(member => member.creep.pos.roomName === gatherRoom) && quad.isComplete) {
      quad.formUp(gatherRoom, gatherAnchor);
    }
  }

  // ---------------------------------------------------------------- debug

  private report(memory: SiegeMemory): void {
    if (!SIEGE_POLICY.debug || Game.time % 10 !== 0) return;
    const alive = this.aliveCount(memory);
    console.log(
      `[Siege ${memory.id}] ${memory.targetRoom} phase=${memory.phase} members=${alive}/4 attempt=${memory.attempt}` +
        ` step=${memory.pathIndex ?? "-"}/${memory.plan ? memory.plan.path.length - 1 : "-"}` +
        ` ${memory.status || ""}`
    );
    if (memory.phase === "TRANSIT" || memory.phase === "GATHERING") {
      const detail = this.buildQuad(memory)
        .members.map(
          member =>
            `${member.slot}@${member.creep.pos.roomName}(${member.creep.pos.x},${member.creep.pos.y})` +
            `${member.creep.spawning ? " spawning" : ""} fat=${
              member.creep.fatigue
            } move=${member.creep.getActiveBodyparts(MOVE)}`
        )
        .join("; ");
      console.log(
        `[Siege ${memory.id}] gather=${memory.gatherRoom}(${memory.gatherAnchor?.x},${memory.gatherAnchor?.y}) ${detail}`
      );
    }
  }
}
