import { QuadController, QuadMember } from "./QuadController";
import { QuadProbe, probeObstacles } from "./QuadProbe";
import { chooseProbeEntry, probeGrid } from "./QuadProbePlanner";
import { attackWithMembers, chooseCreepFocus, findStructureAt, healMembers } from "./SiegeCombat";
import {
  buildExposureMap,
  buildGrid,
  findKiteAnchor,
  getAnchorExposure,
  getBodyCost,
  getHostileSpawns,
  getMissingMembers,
  planSiege
} from "./SiegePlanner";
import { captureSnapshot, getTerrainArray, isSnapshotFresh } from "./SiegeScanner";
import { chooseDrainEntry } from "./SmallSiegePlanner";
import { keeperSafeTravel, noteHostileRooms } from "./SiegeRouting";
import { keeperHazards, keeperRisk } from "./KeeperTravel";
import { QUAD_SLOTS, SIEGE_POLICY } from "./SiegeTypes";
import { recordSiegeEvent, travelSiegeCreep } from "./SiegeDiagnostics";
import type { ProbeMemory, QuadStats, RoomSide, SiegeMemory, SiegeOptions } from "./SiegeTypes";

// 1,300 energy: enough healing to nearly offset one tower at maximum range,
// while retaining ranged damage for an assault once the tower runs dry.
export const SMALL_SIEGE_BODY: BodyPartConstant[] = [
  "heal",
  "heal",
  "move",
  "move",
  "move",
  "move",
  "move",
  "ranged_attack",
  "ranged_attack",
  "heal"
];

// Maximum HEAL with ranged fire and one MOVE per non-MOVE part at 2,300 energy.
export const RCL6_SIEGE_BODY: BodyPartConstant[] = [
  "heal",
  "heal",
  "heal",
  "heal",
  "heal",
  "heal",
  "move",
  "move",
  "move",
  "move",
  "move",
  "move",
  "move",
  "move",
  "ranged_attack",
  "heal"
];
const RCL6_ENTRY_BUDGET = 2 * 7 * 12;
export const RCL6_PROBE_BODY = [...RCL6_SIEGE_BODY.slice(8), ...RCL6_SIEGE_BODY.slice(0, 8)];

const SIDES: { side: RoomSide; direction: ExitKey }[] = [
  { side: "top", direction: "1" },
  { side: "right", direction: "3" },
  { side: "bottom", direction: "5" },
  { side: "left", direction: "7" }
];
const REPLAN_INTERVAL = 25;
const BLOCKED_RETRY_TICKS = 100;
const SCOUT_RETRY_TICKS = 100;

export class SmallSiege {
  public update(memory: SiegeMemory, options: SiegeOptions, reservedEntries: ProbeMemory[] = []): void {
    if (memory.phase === "COMPLETE" || memory.phase === "ABORTED") return;
    const rcl6 = options.mode === "rcl6";
    const probe = rcl6 && options.strategy === "probe";
    const hostileRooms = probe ? noteHostileRooms() : new Set<string>();
    if (
      memory.probe &&
      hostileRooms.has(memory.probe.outsideRoom) &&
      !QUAD_SLOTS.some(slot => Game.creeps[memory.members[slot]?.name || ""]?.pos.roomName === memory.targetRoom)
    ) {
      recordSiegeEvent(memory.id, "probe-entry-invalidated", { wave: memory.wave, room: memory.probe.outsideRoom });
      memory.probe = undefined;
      memory.drainAnchor = undefined;
      memory.phase = "PLANNING";
    }
    if (rcl6 && memory.spawnsCleared && getMissingMembers(memory.members, name => !!Game.creeps[name]).length === 4) {
      memory.phase = "COMPLETE";
      memory.status = "cleanup finished; no quad members remain";
      return;
    }
    const body = probe ? RCL6_PROBE_BODY : rcl6 ? RCL6_SIEGE_BODY : SMALL_SIEGE_BODY;
    const cost = getBodyCost(body);
    const home = options.homeRoom ? Game.rooms[options.homeRoom] : undefined;
    if (!home?.controller?.my || !home.find(FIND_MY_SPAWNS).length) {
      memory.status = `waiting for an owned spawn in ${options.homeRoom || "the configured home room"}`;
      return;
    }
    if (home.energyCapacityAvailable < cost) {
      memory.status = `waiting for ${cost} energy capacity in ${home.name}`;
      return;
    }
    const target = Game.rooms[memory.targetRoom];
    if (target) {
      memory.snapshot = captureSnapshot(target);
      if (probe) memory.snapshot.obstacles = probeObstacles(target);
      memory.snapshotPersistedAt = Game.time;
    }
    const snapshot = memory.snapshot;
    if (snapshot?.owner && snapshot.owner === home.controller.owner?.username) {
      memory.phase = "ABORTED";
      memory.status = "target is owned by this player";
      console.log(`[Siege ${memory.id}] ${memory.status}`);
      return;
    }
    if (snapshot && snapshot.safeModeEndsAt > Game.time) {
      memory.phase = "PAUSED";
      memory.safeModeEndsAt = snapshot.safeModeEndsAt;
      memory.status = `safe mode until ${snapshot.safeModeEndsAt}`;
      return;
    }
    if (memory.phase === "PAUSED") {
      memory.assaultPlan = undefined;
      memory.phase = "PLANNING";
    }
    if (!memory.snapshot || (rcl6 && !isSnapshotFresh(memory.snapshot, SIEGE_POLICY.snapshotMaxAge))) {
      memory.status = rcl6 ? "waiting for fresh scout intel before committing quad" : "scouting target; preparing quad";
      return;
    }
    if (!memory.snapshot.controller) {
      memory.phase = "ABORTED";
      memory.status = "target has no controller";
      console.log(`[Siege ${memory.id}] ${memory.status}`);
      return;
    }
    if (
      target &&
      !getHostileSpawns(memory.snapshot).length &&
      (!probe || (!memory.snapshot.structures.some(structure => structure.hostile) && !memory.snapshot.creeps.length))
    ) {
      if (rcl6) memory.spawnsCleared = true;
      else {
        memory.phase = "COMPLETE";
        memory.status = "no hostile spawns remain";
        console.log(`[Siege ${memory.id}] ${memory.status}`);
        return;
      }
    }

    const living = QUAD_SLOTS.map(slot => Game.creeps[memory.members[slot]?.name || ""]).filter(Boolean);
    const alive = living.length > 0;
    if (alive) memory.lastMinTtl = Math.min(...living.map(creep => creep.ticksToLive || 1500));
    if (!alive && Object.keys(memory.members).length) {
      if (rcl6 && (memory.lastMinTtl || 1500) > 10 && ++memory.attempt >= SIEGE_POLICY.maxQuadAttempts) {
        memory.phase = "ABORTED";
        memory.status = `quad lost ${memory.attempt} times; stopping replacements`;
        console.log(`[Siege ${memory.id}] ${memory.status}`);
        return;
      }
      memory.members = {};
      memory.drainAnchor = undefined;
      memory.assaultPlan = undefined;
      memory.smallSiegeEntry = undefined;
      memory.smallSiegeEntryReady = false;
      memory.smallSiegeEntryPath = undefined;
      memory.smallSiegeUnscoutedReady = false;
      memory.probe = undefined;
      memory.wave = (memory.wave || 1) + 1;
    }
    if (rcl6 && memory.phase === "RETREATING" && alive) return;
    if (memory.phase === "BLOCKED" && Game.time - memory.phaseSince < BLOCKED_RETRY_TICKS) return;
    if (probe ? !memory.probe : !memory.drainAnchor || (!memory.smallSiegeEntry && !target)) {
      const exits = Game.map.describeExits(memory.targetRoom);
      const sides = SIDES.filter(({ direction }) => {
        const roomName = exits && exits[direction];
        if (!roomName || hostileRooms.has(roomName)) return false;
        if (roomName === home.name) return true;
        const route = Game.map.findRoute(home.name, roomName, {
          routeCallback: room =>
            probe && (room === memory.targetRoom || hostileRooms.has(room)) ? Infinity : 1
        });
        return Array.isArray(route);
      }).map(candidate => candidate.side);
      const terrain = getTerrainArray(memory.targetRoom);
      const outsideGrids = new Map<string, ReturnType<typeof probeGrid>>();
      const canEnter = (entrySide: RoomSide, i: number): boolean => {
        const sideExit = SIDES.find(candidate => candidate.side === entrySide);
        const roomName = sideExit && exits && exits[sideExit.direction];
        if (!roomName) return false;
        const neighborTerrain = Game.map.getRoomTerrain(roomName);
        const x = entrySide === "left" ? 49 : entrySide === "right" ? 0 : i;
        const y = entrySide === "top" ? 49 : entrySide === "bottom" ? 0 : i;
        const inwardX = Math.max(1, Math.min(48, x));
        const inwardY = Math.max(1, Math.min(48, y));
        if (probe) {
          if (
            reservedEntries.some(reserved => {
              const lane = entrySide === "top" || entrySide === "bottom" ? reserved.outside.x : reserved.outside.y;
              return reserved.outsideRoom === roomName && (i === lane || i === lane + 1);
            })
          )
            return false;
          const room = Game.rooms[roomName];
          if (room?.controller?.owner && !room.controller.my) return false;
          if (room && !outsideGrids.has(roomName)) {
            const outsideSnapshot = captureSnapshot(room);
            outsideSnapshot.obstacles = [
              ...probeObstacles(room),
              ...room.find(FIND_CREEPS).map(creep => ({ x: creep.pos.x, y: creep.pos.y })),
              ...room.find(FIND_POWER_CREEPS).map(creep => ({ x: creep.pos.x, y: creep.pos.y }))
            ];
            outsideGrids.set(roomName, probeGrid(outsideSnapshot, getTerrainArray(roomName)));
          }
          return [0, 1, 2].every(depth => {
            const px = entrySide === "left" ? 49 - depth : entrySide === "right" ? depth : i;
            const py = entrySide === "top" ? 49 - depth : entrySide === "bottom" ? depth : i;
            return neighborTerrain.get(px, py) === 0 && !outsideGrids.get(roomName)?.blockHits[py * 50 + px] &&
              !keeperRisk(new RoomPosition(px, py, roomName), keeperHazards(roomName));
          });
        }
        return (
          neighborTerrain.get(x, y) !== TERRAIN_MASK_WALL &&
          (!rcl6 || neighborTerrain.get(inwardX, inwardY) !== TERRAIN_MASK_WALL)
        );
      };
      if (probe) {
        const members = QUAD_SLOTS.map(() => ({ body: body.map(type => ({ type, hits: 100 })), fatigue: 0 }));
        const probeEntry = chooseProbeEntry(
          memory.snapshot,
          terrain,
          sides,
          canEnter,
          members,
          SIEGE_POLICY.safetyFactor
        );
        const probeExit = probeEntry && SIDES.find(candidate => candidate.side === probeEntry.side);
        const outsideRoom = probeExit && exits && exits[probeExit.direction];
        if (!probeEntry || !outsideRoom) {
          memory.phase = "BLOCKED";
          memory.phaseSince = Game.time;
          memory.status = "no clear two-wide probe entrance with a survivable escape";
          return;
        }
        memory.probe = { ...probeEntry, outsideRoom, trail: [], returning: false, lastHits: {} };
        memory.drainAnchor = probeEntry.inside;
        memory.phase = "PREPARING";
        return;
      }
      const preferred =
        !rcl6 &&
        planSiege({
          snapshot: memory.snapshot,
          terrain,
          stats: { quadDps: 80, healPerTick: 144, plainTicksPerTile: 1, swampTicksPerTile: 5 },
          safetyFactor: SIEGE_POLICY.safetyFactor,
          entrySides: sides
        });
      const fileEntry = preferred && preferred.feasible ? preferred.plan.file?.[0] : undefined;
      const side = preferred && preferred.feasible ? preferred.plan.entrySide : undefined;
      const coordinate =
        fileEntry && side ? (side === "top" || side === "bottom" ? fileEntry.x : fileEntry.y) : undefined;
      const entry =
        preferred &&
        preferred.feasible &&
        (preferred.plan.objective === "SPAWNS" || preferred.plan.objective === "TOWERS") &&
        side &&
        fileEntry &&
        coordinate !== undefined &&
        canEnter(side, coordinate)
          ? { anchor: preferred.plan.path[0].anchor, side, entry: fileEntry }
          : chooseDrainEntry(memory.snapshot, terrain, sides, canEnter, rcl6 ? RCL6_ENTRY_BUDGET : Infinity);
      if (!entry) {
        memory.phase = "BLOCKED";
        memory.phaseSince = Game.time;
        memory.status = rcl6
          ? `no sustainable entry: file exposure must stay at or below ${RCL6_ENTRY_BUDGET}/tick`
          : "no accessible drain position";
        return;
      }
      memory.drainAnchor = entry.anchor;
      memory.smallSiegeEntryPath = "path" in entry ? entry.path : undefined;
      const exit = SIDES.find(candidate => candidate.side === entry.side);
      const neighbor = exit && exits && exits[exit.direction];
      if (neighbor) {
        const x = entry.side === "left" ? 48 : entry.side === "right" ? 1 : entry.entry.x;
        const y = entry.side === "top" ? 48 : entry.side === "bottom" ? 1 : entry.entry.y;
        memory.smallSiegeEntry = { roomName: neighbor, pos: { x, y } };
        memory.smallSiegeEntryReady = false;
      }
    }
    if (memory.phase === "PLANNING" || memory.phase === "BLOCKED") memory.phase = "PREPARING";
  }

  public supply(memory: SiegeMemory, options: SiegeOptions): void {
    if (memory.phase === "COMPLETE" || memory.phase === "ABORTED" || memory.phase === "PAUSED") return;
    const home = options.homeRoom ? Game.rooms[options.homeRoom] : undefined;
    if (!home?.controller?.my) return;
    const spawn = home.find(FIND_MY_SPAWNS).find(candidate => !candidate.spawning);
    if (!spawn) return;
    const rcl6 = options.mode === "rcl6";
    const probe = rcl6 && options.strategy === "probe";
    if (rcl6 && memory.spawnsCleared) return;
    const body = probe ? RCL6_PROBE_BODY : rcl6 ? RCL6_SIEGE_BODY : SMALL_SIEGE_BODY;
    const cost = getBodyCost(body);
    const hasTargets =
      memory.snapshot &&
      (probe
        ? memory.snapshot.structures.some(structure => structure.hostile) || memory.snapshot.creeps.length > 0
        : getHostileSpawns(memory.snapshot).length > 0);
    const needsScout =
      !memory.snapshot ||
      (rcl6 && !isSnapshotFresh(memory.snapshot, SIEGE_POLICY.snapshotMaxAge)) ||
      (!Game.rooms[memory.targetRoom] && !hasTargets);
    if (
      needsScout &&
      !(memory.scoutName && Game.creeps[memory.scoutName]) &&
      (memory.lastScoutSpawnTick === undefined || Game.time - memory.lastScoutSpawnTick >= SCOUT_RETRY_TICKS)
    ) {
      const scoutName = `siege_scout_${memory.id}_${Game.time}`;
      const scoutResult = spawn.spawnCreep([MOVE], scoutName, {
        memory: { role: "siegeScout", siegeId: memory.id, room: home.name }
      });
      recordSiegeEvent(memory.id, "spawn", { name: scoutName, roomName: home.name, body: [MOVE], result: scoutResult });
      if (scoutResult === OK) {
        memory.scoutName = scoutName;
        memory.lastScoutSpawnTick = Game.time;
      } else if (scoutResult !== ERR_NOT_ENOUGH_ENERGY) memory.status = `scout spawn failed: ${scoutResult}`;
      return;
    }
    if (probe && memory.probeLaunched) return;
    const queuedProbe = probe && (memory.wave || 1) > 1 && !!memory.snapshot;
    if (
      rcl6 &&
      (((needsScout || !memory.drainAnchor) && !queuedProbe) ||
        memory.phase === "BLOCKED" ||
        memory.phase === "RETREATING")
    )
      return;
    if (
      probe &&
      QUAD_SLOTS.some(
        memberSlot => Game.creeps[memory.members[memberSlot]?.name || ""]?.pos.roomName === memory.targetRoom
      )
    )
      return;
    if (home.energyCapacityAvailable < cost) return;
    const missing = getMissingMembers(memory.members, creepName => !!Game.creeps[creepName]);
    if (!missing.length) return;
    if (home.energyAvailable < cost) {
      memory.status = `waiting for energy in ${home.name}: ${home.energyAvailable}/${cost}`;
      return;
    }
    const slot = missing[0];
    const name = `siege_${memory.id}_${slot}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
      memory: { role: "siegeQuad", siegeId: memory.id, slot, room: home.name }
    });
    recordSiegeEvent(memory.id, "spawn", { name, slot, roomName: home.name, body, result });
    if (result === OK) memory.members[slot] = { name, spawnRoom: home.name, spawnedAt: Game.time };
    else memory.status = `quad spawn failed: ${result}`;
  }

  public control(memory: SiegeMemory, options: SiegeOptions, allowSurvivors = false): void {
    const scout = memory.scoutName && Game.creeps[memory.scoutName];
    if (
      scout &&
      !scout.spawning &&
      scout.pos.roomName !== memory.targetRoom &&
      memory.phase !== "PAUSED" &&
      memory.phase !== "COMPLETE" &&
      memory.phase !== "ABORTED"
    ) {
      this.travelScout(memory, scout);
    }
    const members: QuadMember[] = [];
    for (const slot of QUAD_SLOTS) {
      const creep = Game.creeps[memory.members[slot]?.name || ""];
      if (creep && !creep.spawning) members.push({ slot, creep });
    }
    if (!members.length) return;
    const probe = options.mode === "rcl6" && options.strategy === "probe";
    const quad = new QuadController(members, probe, probe ? memory.targetRoom : undefined);
    if (memory.phase === "COMPLETE" || memory.phase === "ABORTED") return;
    if (probe) {
      if (
        !allowSurvivors &&
        !quad.isComplete &&
        members.every(
          member =>
            member.creep.pos.roomName !== memory.targetRoom && member.creep.pos.roomName !== memory.probe?.outsideRoom
        )
      ) {
        healMembers(members);
        if (members.every(member => member.creep.pos.roomName === options.homeRoom)) this.parkMembers(members);
        else {
          memory.status = `regrouping incomplete probe wave: ${quad.moveFile(quad.members[0].creep.pos, 0)}`;
        }
        return;
      }
      new QuadProbe().control(memory, quad, allowSurvivors);
      return;
    }
    this.fight(members, memory.targetRoom, this.getPlanFocus(memory, quad));
    if (options.mode === "rcl6" && this.guardRcl6(memory, quad)) return;
    if (memory.phase === "PAUSED") {
      if (options.homeRoom) {
        const home = new RoomPosition(25, 25, options.homeRoom);
        for (const member of members) this.travel(memory, member.creep, home, 20);
      }
      return;
    }
    if (!memory.drainAnchor) {
      if (memory.phase === "BLOCKED") return;
      if (options.mode === "rcl6") {
        memory.status = "waiting for a sustainable scouted entry";
        this.parkMembers(members);
        return;
      }
      const stagingRoom = options.homeRoom && this.findStagingRoom(options.homeRoom, memory.targetRoom);
      if (!stagingRoom) {
        memory.status = "no route to target";
        return;
      }
      if (quad.isComplete) {
        memory.phase = "TRANSIT";
        memory.status = "travelling toward target while scouting";
        const destinationRoom = memory.smallSiegeUnscoutedReady ? memory.targetRoom : stagingRoom;
        const result = quad.moveFile(new RoomPosition(25, 25, destinationRoom), 20);
        if (!memory.smallSiegeUnscoutedReady && result === "ARRIVED") memory.smallSiegeUnscoutedReady = true;
      } else if (members.some(member => member.creep.pos.roomName !== options.homeRoom)) {
        memory.status = "travelling toward target while scouting";
        const staging = new RoomPosition(25, 25, stagingRoom);
        for (const member of members) this.travel(memory, member.creep, staging, 20);
      } else {
        this.parkMembers(members);
      }
      return;
    }
    const destination = new RoomPosition(memory.drainAnchor.x, memory.drainAnchor.y, memory.targetRoom);
    const inTarget = members.some(member => member.creep.pos.roomName === memory.targetRoom);
    if (!inTarget && quad.isComplete) {
      memory.phase = "TRANSIT";
      if (memory.smallSiegeEntry && !memory.smallSiegeEntryReady) {
        const entry = memory.smallSiegeEntry;
        memory.status = "travelling to selected entry";
        if (quad.moveFile(new RoomPosition(entry.pos.x, entry.pos.y, entry.roomName), 1) === "ARRIVED") {
          memory.smallSiegeEntryReady = true;
        }
        return;
      }
      memory.status = "travelling to drain position";
      if (options.mode === "rcl6") this.enterRcl6(memory, quad);
      else quad.moveFile(destination, 1);
      return;
    }
    if (!inTarget && !quad.isComplete) {
      memory.status = "assembling quad";
      if (options.mode === "rcl6" && options.homeRoom) {
        const home = new RoomPosition(25, 25, options.homeRoom);
        for (const member of members) {
          if (member.creep.pos.roomName !== options.homeRoom) this.travel(memory, member.creep, home, 20);
        }
        return;
      }
      if (members.some(member => member.creep.pos.roomName !== options.homeRoom)) {
        for (const member of members) this.travel(memory, member.creep, destination, 1);
      } else {
        this.parkMembers(members);
      }
      return;
    }
    if (!quad.isComplete || members.some(member => member.creep.pos.roomName !== memory.targetRoom)) {
      if (options.mode === "rcl6") {
        this.enterRcl6(memory, quad);
        return;
      }
      memory.status = "replacing quad members";
      for (const member of members) {
        if (member.creep.pos.roomName !== memory.targetRoom) this.travel(memory, member.creep, destination, 1);
      }
      return;
    }
    const actual = quad.getAnchor();
    if (actual && memory.assaultPlan) {
      this.advance(memory, quad, actual, options.mode === "rcl6");
      return;
    }
    if (options.mode === "rcl6" && !quad.isFormedAt(memory.drainAnchor)) {
      this.enterRcl6(memory, quad);
      return;
    }
    if (!quad.formUp(memory.targetRoom, memory.drainAnchor)) {
      memory.phase = "STAGING";
      memory.status = "forming at drain position";
      return;
    }
    this.planAssault(memory, quad, options.mode === "rcl6");
  }

  private guardRcl6(memory: SiegeMemory, quad: QuadController): boolean {
    const inside = quad.members.some(member => member.creep.pos.roomName === memory.targetRoom);
    if (memory.phase === "PAUSED" || memory.phase === "RETREATING" || (inside && !quad.isComplete)) {
      if (memory.phase !== "PAUSED") memory.phase = "RETREATING";
      this.withdrawRcl6(memory, quad);
      return true;
    }
    if (!isSnapshotFresh(memory.snapshot, SIEGE_POLICY.snapshotMaxAge)) {
      memory.status = "holding for fresh scout intel";
      if (inside) {
        memory.phase = "RETREATING";
        this.withdrawRcl6(memory, quad);
      }
      return true;
    }
    if (!inside) return memory.phase === "BLOCKED";

    const exposure = buildExposureMap(memory.snapshot);
    const anchor = quad.getAnchor();
    const budget = anchor
      ? quad.members.reduce((sum, member) => sum + member.creep.getActiveBodyparts(HEAL) * 12, 0) *
        SIEGE_POLICY.safetyFactor
      : RCL6_ENTRY_BUDGET;
    const unsafe = quad.members.some(
      member =>
        member.creep.pos.roomName === memory.targetRoom &&
        exposure[member.creep.pos.y * 50 + member.creep.pos.x] > budget
    );
    if (unsafe || quad.minHitsFraction() < 0.75) {
      memory.phase = "RETREATING";
      memory.status = unsafe ? "retreating: exposure exceeds healing budget" : "retreating: member damaged";
      this.withdrawRcl6(memory, quad);
      return true;
    }
    return false;
  }

  private withdrawRcl6(memory: SiegeMemory, quad: QuadController): void {
    memory.assaultPlan = undefined;
    const inside = quad.members.some(member => member.creep.pos.roomName === memory.targetRoom);
    if (!inside) {
      if (memory.phase !== "PAUSED" && quad.minHitsFraction() >= SIEGE_POLICY.resumeHitsFraction) {
        memory.phase = "PLANNING";
        memory.drainAnchor = undefined;
        memory.smallSiegeEntryReady = false;
        memory.smallSiegeEntryPath = undefined;
        memory.status = "recovered outside; checking entry again";
      }
      return;
    }
    const anchor = quad.getAnchor();
    if (anchor && memory.snapshot && memory.phase !== "PAUSED") {
      const exposure = buildExposureMap(memory.snapshot);
      const budget =
        quad.members.reduce((sum, member) => sum + member.creep.getActiveBodyparts(HEAL) * 12, 0) *
        SIEGE_POLICY.safetyFactor;
      if (getAnchorExposure(exposure, anchor) <= budget) {
        memory.status = "holding safe formation to heal";
        if (quad.minHitsFraction() >= SIEGE_POLICY.resumeHitsFraction) {
          memory.phase = "STAGING";
          memory.drainAnchor = anchor;
          memory.lastScanTick = undefined;
        }
        return;
      }
      const grid = buildGrid(memory.snapshot, getTerrainArray(memory.targetRoom));
      const kite = findKiteAnchor(grid, exposure, anchor, [], SIEGE_POLICY.kiteSearchSteps);
      if (kite?.path[1]) {
        const result = quad.stepTo(anchor, kite.path[1]);
        memory.status = `retreating in lock step: ${result}`;
        if (result !== "BLOCKED") return;
      }
    }
    const exit = memory.smallSiegeEntry;
    if (!exit) {
      memory.status = "retreat blocked: no recorded exit";
      return;
    }
    // At the border (or after a casualty), file travel is necessary to leave the room.
    quad.moveFile(new RoomPosition(exit.pos.x, exit.pos.y, exit.roomName), 0);
    memory.status = "withdrawing through the recorded exit";
  }

  private enterRcl6(memory: SiegeMemory, quad: QuadController): void {
    const entry = memory.smallSiegeEntry;
    const path = memory.smallSiegeEntryPath;
    const anchor = memory.drainAnchor;
    if (!entry || !path?.length || !anchor || !memory.snapshot) {
      memory.phase = "BLOCKED";
      memory.status = "entry path missing; waiting for replanning";
      return;
    }
    const first = path[0];
    const border = {
      x: first.x === 0 ? 49 : first.x === 49 ? 0 : first.x,
      y: first.y === 0 ? 49 : first.y === 49 ? 0 : first.y
    };
    const file = [
      new RoomPosition(entry.pos.x, entry.pos.y, entry.roomName),
      new RoomPosition(border.x, border.y, entry.roomName),
      ...path.map(tile => new RoomPosition(tile.x, tile.y, memory.targetRoom)),
      new RoomPosition(anchor.x + 1, anchor.y, memory.targetRoom),
      new RoomPosition(anchor.x + 1, anchor.y + 1, memory.targetRoom),
      new RoomPosition(anchor.x, anchor.y + 1, memory.targetRoom)
    ];
    const exposure = buildExposureMap(memory.snapshot);
    const names = new Set(quad.members.map(member => member.creep.name));
    const result = quad.advanceFile(file, pos => {
      const room = Game.rooms[pos.roomName];
      if (pos.roomName === memory.targetRoom && exposure[pos.y * 50 + pos.x] > RCL6_ENTRY_BUDGET) return true;
      if (Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y) === TERRAIN_MASK_WALL) return true;
      if (!room) return false;
      const blocking = room
        .lookForAt(LOOK_STRUCTURES, pos.x, pos.y)
        .some(
          structure =>
            structure.structureType !== STRUCTURE_ROAD &&
            structure.structureType !== STRUCTURE_CONTAINER &&
            !(
              structure.structureType === STRUCTURE_RAMPART &&
              ((structure as StructureRampart).my || (structure as StructureRampart).isPublic)
            )
        );
      return blocking || room.lookForAt(LOOK_CREEPS, pos.x, pos.y).some(creep => !names.has(creep.name));
    });
    memory.status = `entering along scouted low-exposure path: ${result}`;
    if (result === "BLOCKED" || result === "OFF_PATH") {
      memory.phase = "RETREATING";
      this.withdrawRcl6(memory, quad);
    }
  }

  private findStagingRoom(home: string, target: string): string | undefined {
    const route = Game.map.findRoute(home, target, {
      routeCallback: () => 1
    });
    if (!Array.isArray(route) || !route.length) return undefined;
    return route.length === 1 ? home : route[route.length - 2].room;
  }

  private travel(memory: SiegeMemory, creep: Creep, target: RoomPosition, range: number): void {
    const result = travelSiegeCreep(creep, target, keeperSafeTravel(range));
    if (result === OK || result === ERR_TIRED || result === ERR_BUSY) return;
    memory.status = `${creep.name} travel to ${target.roomName} failed: ${result}`;
    if (Game.time % 25 === 0) console.log(`[Siege ${memory.id}] ${memory.status}`);
  }

  private travelScout(memory: SiegeMemory, scout: Creep): void {
    const hostile = noteHostileRooms();
    const origin = scout.pos.roomName;
    const target = memory.targetRoom;
    const avoidedRooms = [...hostile].filter(room => room !== origin && room !== target).sort();
    const options = keeperSafeTravel(20);
    const blocked = (roomName: string): boolean =>
      roomName !== origin && roomName !== target && hostile.has(roomName);
    options.routeCallback = roomName => (blocked(roomName) ? Infinity : 2.5);
    const previous = memory.scoutRoute;
    if (
      !previous || !previous.keeperTransit ||
      previous.name !== scout.name ||
      previous.origin !== origin ||
      previous.target !== target ||
      previous.avoidedRooms.join(",") !== avoidedRooms.join(",") ||
      (!previous.rooms.length && Game.time - previous.plannedAt >= SCOUT_RETRY_TICKS)
    ) {
      delete scout.memory._travel;
      const route = Game.map.findRoute(origin, target, { routeCallback: options.routeCallback });
      memory.scoutRoute = {
        name: scout.name,
        origin,
        target,
        avoidedRooms,
        rooms: Array.isArray(route) ? route.map(step => step.room) : [],
        plannedAt: Game.time,
        keeperTransit: true
      };
      recordSiegeEvent(memory.id, "scout-route", { ...memory.scoutRoute, result: Array.isArray(route) ? OK : route });
    }
    const rooms = memory.scoutRoute?.rooms || [];
    if (!rooms.length) {
      memory.status = `scout route blocked: no hostile-transit-free route from ${origin} to ${target}`;
      return;
    }
    const allowed = new Set([origin, ...rooms]);
    options.roomCallback = (roomName, matrix) => (!allowed.has(roomName) || blocked(roomName) ? false : matrix);
    const result = travelSiegeCreep(scout, new RoomPosition(25, 25, target), options);
    if (result === OK || result === ERR_TIRED || result === ERR_BUSY) return;
    delete scout.memory._travel;
    memory.scoutRoute = undefined;
    memory.status = `scout travel from ${origin} to ${target} failed: ${result}`;
    if (Game.time % 25 === 0) console.log(`[Siege ${memory.id}] ${memory.status}`);
  }

  private parkMembers(members: QuadMember[]): void {
    const room = members[0].creep.room;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const terrain = room.getTerrain();
    const structures = room.find(FIND_STRUCTURES);
    const sources = room.find(FIND_SOURCES);
    const candidates: RoomPosition[] = [];
    for (let x = Math.max(1, spawn.pos.x - 10); x <= Math.min(48, spawn.pos.x + 10); x++) {
      for (let y = Math.max(1, spawn.pos.y - 10); y <= Math.min(48, spawn.pos.y + 10); y++) {
        const pos = new RoomPosition(x, y, room.name);
        const range = pos.getRangeTo(spawn);
        if (range < 4 || range > 10 || terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        if (structures.some(structure => pos.getRangeTo(structure) <= 1)) continue;
        if (sources.some(source => pos.getRangeTo(source) <= 2)) continue;
        candidates.push(pos);
      }
    }
    candidates.sort((a, b) => a.getRangeTo(spawn) - b.getRangeTo(spawn) || a.x - b.x || a.y - b.y);
    for (const member of members) {
      const pos = candidates[QUAD_SLOTS.indexOf(member.slot)];
      if (pos && !member.creep.pos.isEqualTo(pos)) travelSiegeCreep(member.creep, pos, keeperSafeTravel(0));
    }
  }

  private getPlanFocus(memory: SiegeMemory, quad: QuadController): Structure | null {
    const room = Game.rooms[memory.targetRoom];
    const plan = memory.assaultPlan;
    const actual = quad.getAnchor();
    if (!room || !plan || !actual) return null;
    const index = plan.path.findIndex(step => step.anchor.x === actual.x && step.anchor.y === actual.y);
    if (index < 0) return null;
    const next = plan.path[index + 1];
    const breach = next?.breach.map(tile => findStructureAt(room, tile.x, tile.y)).find(Boolean);
    if (breach) return breach;
    if (next) return null;
    const target = Game.getObjectById(plan.targetId as Id<Structure>);
    return target ? findStructureAt(room, target.pos.x, target.pos.y) || target : null;
  }

  private fight(members: QuadMember[], targetRoom: string, planFocus: Structure | null): void {
    healMembers(members);
    for (const roomName of new Set(members.map(member => member.creep.pos.roomName))) {
      const room = Game.rooms[roomName];
      if (!room) continue;
      const local = members.filter(member => member.creep.pos.roomName === roomName);
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      const priority = (structure: Structure): number =>
        structure.structureType === STRUCTURE_TOWER ? 0 : structure.structureType === STRUCTURE_SPAWN ? 1 : 2;
      const structures =
        roomName === targetRoom
          ? room
              .find(FIND_HOSTILE_STRUCTURES)
              .sort((a, b) => priority(a) - priority(b))
              .map(structure => findStructureAt(room, structure.pos.x, structure.pos.y) || structure)
          : [];
      attackWithMembers(local, chooseCreepFocus(hostiles, local) || planFocus, hostiles, structures);
    }
  }

  private planAssault(memory: SiegeMemory, quad: QuadController, rcl6: boolean): void {
    const snapshot = memory.snapshot;
    const anchor = quad.getAnchor();
    if (!snapshot || !anchor || Game.time - (memory.lastScanTick || 0) < REPLAN_INTERVAL) return;
    memory.lastScanTick = Game.time;
    const movement = quad.members.map(member => {
      const move = member.creep.getActiveBodyparts(MOVE);
      const weight = member.creep.body.filter(part => part.type !== MOVE).length;
      return move ? { plain: Math.ceil(weight / move), swamp: Math.ceil((weight * 5) / move) } : undefined;
    });
    if (movement.some(ticks => !ticks)) {
      memory.status = "draining: a quad member cannot move";
      return;
    }
    const stats: QuadStats = {
      quadDps: quad.members.reduce((sum, member) => sum + member.creep.getActiveBodyparts(RANGED_ATTACK) * 10, 0),
      healPerTick: quad.members.reduce((sum, member) => sum + member.creep.getActiveBodyparts(HEAL) * 12, 0),
      plainTicksPerTile: Math.max(...movement.map(ticks => ticks!.plain)),
      swampTicksPerTile: Math.max(...movement.map(ticks => ticks!.swamp))
    };
    if (!stats.quadDps) {
      memory.status = "draining: no ranged parts remain";
      return;
    }
    const result = planSiege({
      snapshot,
      terrain: getTerrainArray(memory.targetRoom),
      stats,
      safetyFactor: SIEGE_POLICY.safetyFactor,
      startAnchor: anchor
    });
    if (
      result.feasible &&
      (result.plan.objective === "SPAWNS" ||
        result.plan.objective === "TOWERS" ||
        (rcl6 && result.plan.objective === "CLEANUP"))
    ) {
      memory.assaultPlan = result.plan;
      memory.phase = "ADVANCING";
      memory.status = `safe route to ${result.plan.objective.toLowerCase()} found`;
    } else {
      memory.phase = "STAGING";
      const energy = snapshot.structures
        .filter(structure => structure.hostile && structure.type === "tower")
        .reduce((sum, tower) => sum + (tower.energy || 0), 0);
      memory.status = `draining tower; observed energy ${energy}`;
    }
  }

  private advance(memory: SiegeMemory, quad: QuadController, actual: { x: number; y: number }, rcl6: boolean): void {
    const room = Game.rooms[memory.targetRoom];
    const plan = memory.assaultPlan;
    if (!room || !plan || !memory.snapshot) return;
    const index = plan.path.findIndex(step => step.anchor.x === actual.x && step.anchor.y === actual.y);
    if (index < 0) {
      memory.assaultPlan = undefined;
      return;
    }
    const budget =
      quad.members.reduce((sum, member) => sum + member.creep.getActiveBodyparts(HEAL) * 12, 0) *
      SIEGE_POLICY.safetyFactor;
    const exposure = buildExposureMap(memory.snapshot);
    if (plan.path.slice(index).some(step => getAnchorExposure(exposure, step.anchor) > budget)) {
      memory.assaultPlan = undefined;
      memory.status = "route no longer safe; returning to drain position";
      if (rcl6) {
        memory.phase = "RETREATING";
        this.withdrawRcl6(memory, quad);
      }
      return;
    }
    const next = plan.path[index + 1];
    const target = Game.getObjectById(plan.targetId as Id<Structure>);
    if (!target) {
      memory.assaultPlan = undefined;
      return;
    }
    const breach = next && next.breach.map(tile => findStructureAt(room, tile.x, tile.y)).find(Boolean);
    const targetBarrier = findStructureAt(room, target.pos.x, target.pos.y);
    const focus = breach || (!next ? targetBarrier || target : null);
    if (!focus && next) {
      if (rcl6 && quad.minHitsFraction() < SIEGE_POLICY.resumeHitsFraction) {
        memory.status = "healing before advancing";
        return;
      }
      const result = quad.stepTo(actual, next.anchor);
      if (result === "BLOCKED") {
        memory.assaultPlan = undefined;
        if (rcl6) memory.drainAnchor = actual;
        memory.status = "step blocked; holding formation and replanning";
      }
    }
  }
}
