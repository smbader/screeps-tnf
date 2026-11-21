import type { RoomSnapshot, SiegeMemory, SnapshotCreep, SnapshotStructure } from "./SiegeTypes";
import { SIEGE_POLICY } from "./SiegeTypes";
import { IMPASSABLE_HITS } from "./SiegePlanner";
import { claimObserver } from "../utils/ObserverClaims";

const PASSABLE_TYPES = new Set<string>([STRUCTURE_ROAD, STRUCTURE_CONTAINER]);

function getBoostMultiplier(boost: string | number | undefined): number {
  if (typeof boost !== "string") return 1;
  if (boost.startsWith("X")) return 4;
  return boost.length > 2 ? 3 : 2;
}

export function summarizeCreep(creep: Creep): SnapshotCreep {
  let attackDps = 0;
  let rangedDps = 0;
  let healPerTick = 0;
  for (const part of creep.body) {
    if (part.hits <= 0) continue;
    const multiplier = getBoostMultiplier(part.boost);
    if (part.type === ATTACK) attackDps += 30 * multiplier;
    else if (part.type === RANGED_ATTACK) rangedDps += 10 * multiplier;
    else if (part.type === HEAL) healPerTick += 12 * multiplier;
  }
  return {
    id: creep.id,
    x: creep.pos.x,
    y: creep.pos.y,
    hits: creep.hits,
    hitsMax: creep.hitsMax,
    attackDps,
    rangedDps,
    healPerTick
  };
}

export function captureSnapshot(room: Room): RoomSnapshot {
  const structures: SnapshotStructure[] = [];
  for (const structure of room.find(FIND_STRUCTURES)) {
    if (PASSABLE_TYPES.has(structure.structureType)) continue;
    if (structure.structureType === STRUCTURE_RAMPART && (structure as StructureRampart).isPublic) continue;
    const owned = structure as OwnedStructure;
    const hostile = !!owned.owner && !owned.my;
    const indestructible = structure.structureType === STRUCTURE_CONTROLLER || structure.hits === undefined;
    const entry: SnapshotStructure = {
      id: structure.id,
      x: structure.pos.x,
      y: structure.pos.y,
      type: structure.structureType,
      hits: indestructible ? IMPASSABLE_HITS : structure.hits,
      hostile: hostile && structure.structureType !== STRUCTURE_CONTROLLER
    };
    if (structure.structureType === STRUCTURE_TOWER) {
      entry.energy = (structure as StructureTower).store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      entry.hasEffects = !!structure.effects?.some(effect => effect.ticksRemaining > 0);
    }
    structures.push(entry);
  }

  const controller = room.controller;
  return {
    roomName: room.name,
    tick: Game.time,
    owner: controller?.owner?.username,
    level: controller?.level || 0,
    safeModeEndsAt: controller?.safeMode ? Game.time + controller.safeMode : 0,
    safeModeCooldownEndsAt: controller?.safeModeCooldown ? Game.time + controller.safeModeCooldown : 0,
    controller: controller ? { x: controller.pos.x, y: controller.pos.y } : undefined,
    structures,
    creeps: room.find(FIND_HOSTILE_CREEPS).map(summarizeCreep)
  };
}

export function getTerrainArray(roomName: string): number[] {
  const terrain = Game.map.getRoomTerrain(roomName);
  const result: number[] = [];
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) result.push(terrain.get(x, y));
  }
  return result;
}

export function getObserverHomes(targetRoom: string): { room: Room; observer: StructureObserver }[] {
  const homes: { room: Room; observer: StructureObserver }[] = [];
  for (const room of Object.values(Game.rooms)) {
    if (!room.controller?.my) continue;
    if (Game.map.getRoomLinearDistance(room.name, targetRoom) > SIEGE_POLICY.observerRange) continue;
    const observer = room.find<StructureObserver>(FIND_MY_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_OBSERVER
    })[0];
    if (observer) homes.push({ room, observer });
  }
  return homes.sort(
    (left, right) =>
      Game.map.getRoomLinearDistance(left.room.name, targetRoom) -
        Game.map.getRoomLinearDistance(right.room.name, targetRoom) || left.room.name.localeCompare(right.room.name)
  );
}

export function isSnapshotFresh(snapshot: RoomSnapshot | undefined, maxAge: number): snapshot is RoomSnapshot {
  return !!snapshot && Game.time - snapshot.tick <= maxAge;
}

// Requests an observer scan when no vision exists and the stored snapshot is older than the scan interval.
export function scheduleObservation(memory: SiegeMemory): "scheduled" | "pending" | "no-observer" | "idle" {
  const snapshot = memory.snapshot;
  if (snapshot && Game.time - snapshot.tick < SIEGE_POLICY.scanInterval) return "idle";
  if (memory.pendingObserver && Game.time - memory.pendingObserver.tick <= 1) return "pending";
  if (Game.cpu.bucket < SIEGE_POLICY.minimumCpuBucket) return "idle";

  const homes = getObserverHomes(memory.targetRoom);
  if (!homes.length) return "no-observer";
  for (const home of homes) {
    if (!claimObserver(home.observer.id, Game.time)) continue;
    if (home.observer.observeRoom(memory.targetRoom) === OK) {
      memory.pendingObserver = { homeRoom: home.room.name, tick: Game.time };
      memory.lastScanTick = Game.time;
      return "scheduled";
    }
  }
  return "idle";
}
