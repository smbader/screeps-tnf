import { Operator } from "../classes/operator";
import { RoomHelper } from "../utils/RoomHelper";

export class ExpansionWorker extends Operator {
  private targetRoomName: string;
  public sourceId: Id<Source>;

  public constructor(name: string, homeRoom: Room, targetRoomName: string, sourceId: Id<Source>) {
    super(name, homeRoom);
    this.targetRoomName = targetRoomName;
    this.sourceId = sourceId;
  }

  public actions(): void {
    const creep = Game.creeps[this.name];
    if (!creep) return;

    const targetRoom = Game.rooms[this.targetRoomName];
    if (!targetRoom) {
      creep.travelTo(new RoomPosition(25, 25, this.targetRoomName));
      return;
    }
    if (!targetRoom.controller?.my) return;

    const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      const fleePath = PathFinder.search(
        creep.pos,
        hostiles.map(hostile => ({ pos: hostile.pos, range: 6 })),
        { flee: true, maxRooms: 1 }
      );
      if (fleePath.path.length > 0) creep.move(creep.pos.getDirectionTo(fleePath.path[0]));
      return;
    }

    const spawn = targetRoom.find<StructureSpawn>(FIND_MY_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_SPAWN
    })[0];
    if (
      spawn &&
      targetRoom.controller.level >= 2 &&
      creep.ticksToLive !== undefined &&
      Game.creeps[this.name].memory.expansionAssignment
    ) {
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        const destination = creep.pos.findClosestByRange<StructureSpawn | StructureExtension>(FIND_MY_STRUCTURES, {
          filter: structure =>
            (structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        if (destination) {
          const result = creep.transfer(destination, RESOURCE_ENERGY);
          if (result === ERR_NOT_IN_RANGE) creep.travelTo(destination.pos);
          if (result === ERR_NOT_IN_RANGE || result === OK) return;
        }
      }
      creep.suicide();
      return;
    }

    if (
      !spawn &&
      targetRoom.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: site => site.structureType === STRUCTURE_SPAWN
      }).length === 0
    ) {
      this.placeSpawnSite(targetRoom);
    }

    // Harvest until full, then spend everything before harvesting again.
    if (creep.memory.working === undefined || creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.working = true;
    } else if (creep.store.getFreeCapacity() === 0) {
      creep.memory.working = false;
    }
    if (creep.memory.working) {
      const source = Game.getObjectById(this.sourceId) || creep.pos.findClosestByRange(FIND_SOURCES);
      if (!source) return;
      const result = creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) creep.travelTo(source.pos);
      else if (result === ERR_NOT_ENOUGH_RESOURCES && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.memory.working = false;
      }
      return;
    }

    const spawnSite = targetRoom.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: site => site.structureType === STRUCTURE_SPAWN
    })[0];
    const buildTarget = spawnSite || (!spawn ? creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES) : null);
    if (buildTarget) {
      if (creep.build(buildTarget) === ERR_NOT_IN_RANGE) creep.travelTo(buildTarget.pos, { range: 3 });
      return;
    }
    if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.travelTo(spawn.pos);
      return;
    }

    // Nothing to build or fill (for example the spawn site is not placed yet): upgrade instead of idling.
    if (creep.upgradeController(targetRoom.controller) === ERR_NOT_IN_RANGE) {
      creep.travelTo(targetRoom.controller.pos, { range: 3 });
    }
  }

  private placeSpawnSite(room: Room): void {
    const controller = room.controller;
    if (!controller) return;

    const configuredSpawn = RoomHelper.getRoomConfig(room)?.spawns?.[0];
    if (configuredSpawn) {
      const configuredResult = room.createConstructionSite(configuredSpawn.x, configuredSpawn.y, STRUCTURE_SPAWN);
      if (configuredResult !== OK && Game.time % 100 === 0) {
        console.log(`[ExpansionManagement] Could not place configured spawn site in ${room.name}: ${configuredResult}`);
      }
      if (configuredResult === OK || configuredResult === ERR_FULL) return;
    }

    const sources = room.find(FIND_SOURCES);
    const minerals = room.find(FIND_MINERALS);
    const structures = room.find(FIND_STRUCTURES);
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    const positions: RoomPosition[] = [];

    for (let x = 3; x <= 46; x++) {
      for (let y = 3; y <= 46; y++) {
        const position = new RoomPosition(x, y, room.name);
        if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) continue;
        if (position.getRangeTo(controller.pos) < 3 || position.getRangeTo(controller.pos) > 10) continue;
        if (sources.some(source => position.getRangeTo(source.pos) < 3)) continue;
        if (minerals.some(mineral => position.getRangeTo(mineral.pos) < 2)) continue;
        if (structures.some(structure => structure.pos.x === x && structure.pos.y === y)) continue;
        if (sites.some(site => site.pos.x === x && site.pos.y === y)) continue;
        positions.push(position);
      }
    }

    positions.sort(
      (left, right) =>
        left.getRangeTo(controller.pos) - right.getRangeTo(controller.pos) || left.x - right.x || left.y - right.y
    );

    const spawnPosition = positions[0];
    if (!spawnPosition) {
      console.log(`[ExpansionManagement] No valid spawn location in ${room.name}`);
      return;
    }
    const result = room.createConstructionSite(spawnPosition, STRUCTURE_SPAWN);
    if (result !== OK && Game.time % 100 === 0) {
      console.log(`[ExpansionManagement] Could not place spawn site in ${room.name}: ${result}`);
    }
  }
}
