import { QuadController, QuadMember } from "./QuadController";
import { attackWithMembers, chooseCreepFocus, findStructureAt, healMembers } from "./SiegeCombat";
import { buildExposureMap, getAnchorExposure, getHostileSpawns, getMissingMembers, planSiege } from "./SiegePlanner";
import { captureSnapshot, getTerrainArray } from "./SiegeScanner";
import { chooseDrainEntry } from "./SmallSiegePlanner";
import { isKeeperRoom, keeperSafeTravel } from "./SiegeRouting";
import { QUAD_SLOTS, SIEGE_POLICY } from "./SiegeTypes";
import type { QuadStats, RoomSide, SiegeMemory, SiegeOptions } from "./SiegeTypes";

// 1,300 energy: enough healing to nearly offset one tower at maximum range,
// while retaining ranged damage for an assault once the tower runs dry.
export const SMALL_SIEGE_BODY: BodyPartConstant[] = [
  "move",
  "move",
  "move",
  "move",
  "move",
  "ranged_attack",
  "ranged_attack",
  "heal",
  "heal",
  "heal"
];

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
  public update(memory: SiegeMemory, options: SiegeOptions): void {
    if (memory.phase === "COMPLETE" || memory.phase === "ABORTED") return;
    const home = options.homeRoom ? Game.rooms[options.homeRoom] : undefined;
    if (!home?.controller?.my || !home.find(FIND_MY_SPAWNS).length) {
      memory.status = `waiting for an owned spawn in ${options.homeRoom || "the configured home room"}`;
      return;
    }
    if (home.energyCapacityAvailable < 1300) {
      memory.status = `waiting for 1300 energy capacity in ${home.name}`;
      return;
    }
    if (isKeeperRoom(home.name) || isKeeperRoom(memory.targetRoom)) {
      memory.status = "home or target is a keeper room; no safe route";
      return;
    }

    const target = Game.rooms[memory.targetRoom];
    if (target) {
      memory.snapshot = captureSnapshot(target);
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
    if (!memory.snapshot) {
      memory.status = "scouting target; preparing quad";
      return;
    }
    if (!memory.snapshot.controller) {
      memory.phase = "ABORTED";
      memory.status = "target has no controller";
      console.log(`[Siege ${memory.id}] ${memory.status}`);
      return;
    }
    if (target && !getHostileSpawns(memory.snapshot).length) {
      memory.phase = "COMPLETE";
      memory.status = "no hostile spawns remain";
      console.log(`[Siege ${memory.id}] ${memory.status}`);
      return;
    }

    const alive = QUAD_SLOTS.some(slot => !!Game.creeps[memory.members[slot]?.name || ""]);
    if (!alive && Object.keys(memory.members).length) {
      memory.members = {};
      memory.drainAnchor = undefined;
      memory.assaultPlan = undefined;
      memory.smallSiegeEntry = undefined;
      memory.smallSiegeEntryReady = false;
      memory.smallSiegeUnscoutedReady = false;
      memory.wave = (memory.wave || 1) + 1;
    }
    if (memory.phase === "BLOCKED" && Game.time - memory.phaseSince < BLOCKED_RETRY_TICKS) return;
    if (!memory.drainAnchor || (!memory.smallSiegeEntry && !target)) {
      const exits = Game.map.describeExits(memory.targetRoom);
      const sides = SIDES.filter(({ direction }) => {
        const roomName = exits && exits[direction];
        if (!roomName || isKeeperRoom(roomName)) return false;
        if (roomName === home.name) return true;
        const route = Game.map.findRoute(home.name, roomName, {
          routeCallback: room => (isKeeperRoom(room) ? Infinity : 1)
        });
        return Array.isArray(route);
      }).map(candidate => candidate.side);
      const terrain = getTerrainArray(memory.targetRoom);
      const canEnter = (entrySide: RoomSide, i: number): boolean => {
        const sideExit = SIDES.find(candidate => candidate.side === entrySide);
        const roomName = sideExit && exits && exits[sideExit.direction];
        if (!roomName) return false;
        const neighborTerrain = Game.map.getRoomTerrain(roomName);
        const x = entrySide === "left" ? 49 : entrySide === "right" ? 0 : i;
        const y = entrySide === "top" ? 49 : entrySide === "bottom" ? 0 : i;
        return neighborTerrain.get(x, y) !== TERRAIN_MASK_WALL;
      };
      const preferred = planSiege({
        snapshot: memory.snapshot,
        terrain,
        stats: { quadDps: 80, healPerTick: 144, plainTicksPerTile: 1, swampTicksPerTile: 5 },
        safetyFactor: SIEGE_POLICY.safetyFactor,
        entrySides: sides
      });
      const fileEntry = preferred.feasible ? preferred.plan.file?.[0] : undefined;
      const side = preferred.feasible ? preferred.plan.entrySide : undefined;
      const coordinate =
        fileEntry && side ? (side === "top" || side === "bottom" ? fileEntry.x : fileEntry.y) : undefined;
      const entry =
        preferred.feasible &&
        (preferred.plan.objective === "SPAWNS" || preferred.plan.objective === "TOWERS") &&
        side &&
        fileEntry &&
        coordinate !== undefined &&
        canEnter(side, coordinate)
          ? { anchor: preferred.plan.path[0].anchor, side, entry: fileEntry }
          : chooseDrainEntry(memory.snapshot, terrain, sides, canEnter);
      if (!entry) {
        memory.phase = "BLOCKED";
        memory.phaseSince = Game.time;
        memory.status = "no accessible drain position via a keeper-free exit";
        return;
      }
      memory.drainAnchor = entry.anchor;
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
    const needsScout =
      !memory.snapshot || (!Game.rooms[memory.targetRoom] && !getHostileSpawns(memory.snapshot).length);
    if (
      needsScout &&
      !(memory.scoutName && Game.creeps[memory.scoutName]) &&
      (memory.lastScoutSpawnTick === undefined || Game.time - memory.lastScoutSpawnTick >= SCOUT_RETRY_TICKS)
    ) {
      const scoutName = `siege_scout_${memory.id}_${Game.time}`;
      const scoutResult = spawn.spawnCreep([MOVE], scoutName, {
        memory: { role: "siegeScout", siegeId: memory.id, room: home.name }
      });
      if (scoutResult === OK) {
        memory.scoutName = scoutName;
        memory.lastScoutSpawnTick = Game.time;
      } else if (scoutResult !== ERR_NOT_ENOUGH_ENERGY) memory.status = `scout spawn failed: ${scoutResult}`;
      return;
    }
    if (home.energyCapacityAvailable < 1300) return;
    const missing = getMissingMembers(memory.members, creepName => !!Game.creeps[creepName]);
    if (!missing.length) return;
    if (home.energyAvailable < 1300) {
      memory.status = `waiting for energy in ${home.name}: ${home.energyAvailable}/1300`;
      return;
    }
    const slot = missing[0];
    const name = `siege_${memory.id}_${slot}_${Game.time}`;
    const result = spawn.spawnCreep(SMALL_SIEGE_BODY, name, {
      memory: { role: "siegeQuad", siegeId: memory.id, slot, room: home.name }
    });
    if (result === OK) memory.members[slot] = { name, spawnRoom: home.name, spawnedAt: Game.time };
    else memory.status = `quad spawn failed: ${result}`;
  }

  public control(memory: SiegeMemory, options: SiegeOptions): void {
    const scout = memory.scoutName && Game.creeps[memory.scoutName];
    if (
      scout &&
      !scout.spawning &&
      scout.pos.roomName !== memory.targetRoom &&
      memory.phase !== "PAUSED" &&
      memory.phase !== "COMPLETE" &&
      memory.phase !== "ABORTED"
    ) {
      this.travel(memory, scout, new RoomPosition(25, 25, memory.targetRoom), 20);
    }
    const members: QuadMember[] = [];
    for (const slot of QUAD_SLOTS) {
      const creep = Game.creeps[memory.members[slot]?.name || ""];
      if (creep && !creep.spawning) members.push({ slot, creep });
    }
    if (!members.length) return;
    const quad = new QuadController(members, true);
    if (memory.phase === "COMPLETE" || memory.phase === "ABORTED") return;
    this.fight(members, memory.targetRoom);
    if (memory.phase === "PAUSED") {
      if (options.homeRoom) {
        const home = new RoomPosition(25, 25, options.homeRoom);
        for (const member of members) this.travel(memory, member.creep, home, 20);
      }
      return;
    }
    if (!memory.drainAnchor) {
      if (memory.phase === "BLOCKED") return;
      const stagingRoom = options.homeRoom && this.findStagingRoom(options.homeRoom, memory.targetRoom);
      if (!stagingRoom) {
        memory.status = "no keeper-free route to target";
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
      quad.moveFile(destination, 1);
      return;
    }
    if (!inTarget && !quad.isComplete) {
      memory.status = "assembling quad";
      if (members.some(member => member.creep.pos.roomName !== options.homeRoom)) {
        for (const member of members) this.travel(memory, member.creep, destination, 1);
      } else {
        this.parkMembers(members);
      }
      return;
    }
    if (!quad.isComplete || members.some(member => member.creep.pos.roomName !== memory.targetRoom)) {
      memory.status = "replacing quad members";
      for (const member of members) {
        if (member.creep.pos.roomName !== memory.targetRoom) this.travel(memory, member.creep, destination, 1);
      }
      return;
    }
    const actual = quad.getAnchor();
    if (actual && memory.assaultPlan) {
      this.advance(memory, quad, actual);
      return;
    }
    if (!quad.formUp(memory.targetRoom, memory.drainAnchor)) {
      memory.phase = "STAGING";
      memory.status = "forming at drain position";
      return;
    }
    this.planAssault(memory, quad);
  }

  private findStagingRoom(home: string, target: string): string | undefined {
    if (isKeeperRoom(home) || isKeeperRoom(target)) return undefined;
    const route = Game.map.findRoute(home, target, {
      routeCallback: room => (isKeeperRoom(room) ? Infinity : 1)
    });
    if (!Array.isArray(route) || !route.length) return undefined;
    return route.length === 1 ? home : route[route.length - 2].room;
  }

  private travel(memory: SiegeMemory, creep: Creep, target: RoomPosition, range: number): void {
    const result = creep.travelTo(target, keeperSafeTravel(range));
    if (result === OK || result === ERR_TIRED || result === ERR_BUSY) return;
    memory.status = `${creep.name} travel to ${target.roomName} failed: ${result}`;
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
      if (pos && !member.creep.pos.isEqualTo(pos)) member.creep.travelTo(pos, keeperSafeTravel(0));
    }
  }

  private fight(members: QuadMember[], targetRoom: string): void {
    healMembers(members);
    for (const roomName of new Set(members.map(member => member.creep.pos.roomName))) {
      const room = Game.rooms[roomName];
      if (!room) continue;
      const local = members.filter(member => member.creep.pos.roomName === roomName);
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      const structures = roomName === targetRoom ? room.find(FIND_HOSTILE_STRUCTURES) : [];
      const spawn = structures.find(
        structure =>
          structure.structureType === STRUCTURE_SPAWN &&
          local.some(member => member.creep.pos.getRangeTo(structure) <= 3)
      );
      const spawnTarget = spawn ? findStructureAt(room, spawn.pos.x, spawn.pos.y) || spawn : null;
      attackWithMembers(local, chooseCreepFocus(hostiles, local) || spawnTarget, hostiles, structures);
    }
  }

  private planAssault(memory: SiegeMemory, quad: QuadController): void {
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
    if (result.feasible && (result.plan.objective === "SPAWNS" || result.plan.objective === "TOWERS")) {
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

  private advance(memory: SiegeMemory, quad: QuadController, actual: { x: number; y: number }): void {
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
    if (focus) {
      attackWithMembers(quad.members, focus, room.find(FIND_HOSTILE_CREEPS), [focus]);
    } else if (next) {
      quad.stepTo(actual, next.anchor);
    }
  }
}
