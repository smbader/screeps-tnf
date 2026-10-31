import { DEPOSIT_FARMER_POLICY } from "../operations/DepositFarmerTypes";
import type { DepositSightingMemory } from "../operations/DepositFarmerTypes";
import { Operator } from "../classes/operator";

const DEPOSIT_RESOURCE_TYPES: DepositConstant[] = [RESOURCE_MIST, RESOURCE_BIOMASS, RESOURCE_METAL, RESOURCE_SILICON];
export class DepositMiner extends Operator {
  private readonly sighting: DepositSightingMemory;
  private readonly creep: Creep | null;

  public constructor(name: string, homeRoom: Room, sighting: DepositSightingMemory) {
    super(name, homeRoom);
    this.sighting = sighting;
    this.creep = Game.creeps[name] || null;
  }

  public actions(): void {
    const creep = this.creep;
    if (!creep) return;

    const homeDistance = Game.map.getRoomLinearDistance(creep.pos.roomName, this.room.name, false);
    const returnTime = homeDistance * 50 + DEPOSIT_FARMER_POLICY.returnSafetyTicks;
    const homeToTargetDistance = Game.map.getRoomLinearDistance(this.room.name, this.sighting.roomName, false);
    const tripTime = homeToTargetDistance * 100 + DEPOSIT_FARMER_POLICY.returnSafetyTicks;

    if (
      creep.memory.depositState !== "retiring" &&
      (creep.store.getFreeCapacity() === 0 || (creep.ticksToLive || 0) <= returnTime)
    ) {
      creep.memory.depositState = "returning";
    }

    if (creep.memory.depositState === "retiring") {
      this.retireWhenEmpty(creep, tripTime);
      return;
    }

    if (creep.memory.depositState === "returning" || creep.memory.depositState === "unloading") {
      this.returnAndUnload(creep, tripTime);
      return;
    }

    if (creep.pos.roomName !== this.sighting.roomName) {
      creep.memory.depositState = "travelling";
      this.travel(creep, new RoomPosition(25, 25, this.sighting.roomName), 16);
      return;
    }

    const deposit = Game.getObjectById(this.sighting.id);
    if (!deposit || deposit.ticksToDecay <= homeDistance * 50 + DEPOSIT_FARMER_POLICY.returnSafetyTicks) {
      creep.memory.depositState = creep.store.getUsedCapacity() > 0 ? "returning" : "retiring";
      this.retireWhenEmpty(creep, tripTime);
      return;
    }

    creep.memory.depositState = "harvesting";
    const result = creep.harvest(deposit);
    if (result === ERR_NOT_IN_RANGE) {
      this.travel(creep, deposit.pos, 1);
    } else if (result !== OK && result !== ERR_TIRED) {
      creep.memory.depositState = creep.store.getUsedCapacity() > 0 ? "returning" : "retiring";
      console.log(`[DepositFarmer] ${creep.name} cannot harvest ${this.sighting.id}: ${result}`);
    }
  }

  private returnAndUnload(creep: Creep, tripTime: number): void {
    if (creep.pos.roomName !== this.room.name) {
      this.travel(creep, new RoomPosition(25, 25, this.room.name), 16);
      return;
    }

    const resources = DEPOSIT_RESOURCE_TYPES.filter(resourceType => creep.store.getUsedCapacity(resourceType) > 0);
    if (resources.length === 0) {
      this.retireWhenEmpty(creep, tripTime);
      return;
    }

    const resource = resources[0];
    const sinks = [this.room.storage, this.room.terminal].filter(
      (structure): structure is StructureStorage | StructureTerminal =>
        structure !== undefined && (structure.store.getFreeCapacity(resource) || 0) > 0
    );

    for (const sink of sinks) {
      const result = creep.transfer(sink, resource);
      if (result === OK) {
        if (creep.memory.depositState !== "retiring") {
          creep.memory.depositState = "unloading";
        }
        return;
      }
      if (result === ERR_NOT_IN_RANGE) {
        this.travel(creep, sink.pos, 1);
        return;
      }
      if (result !== ERR_FULL && result !== ERR_NOT_ENOUGH_RESOURCES) {
        console.log(`[DepositFarmer] ${creep.name} cannot unload ${resource}: ${result}`);
        return;
      }
    }

    if (Game.time % 100 === 0) {
      console.log(`[DepositFarmer] ${creep.name} has no available storage/terminal capacity for ${resource}`);
    }
  }

  private retireWhenEmpty(creep: Creep, tripTime: number): void {
    const retiring = creep.memory.depositState === "retiring";
    const sightingAge = Math.max(0, Game.time - this.sighting.lastSeen);
    const remainingDepositLifetime = this.sighting.ticksToDecay - sightingAge;
    if (creep.store.getUsedCapacity() > 0) {
      if (!retiring) creep.memory.depositState = "returning";
      this.returnAndUnload(creep, tripTime);
      return;
    }

    if (creep.pos.roomName !== this.room.name) {
      if (!retiring) creep.memory.depositState = "returning";
      this.travel(creep, new RoomPosition(25, 25, this.room.name), 16);
      return;
    }

    if ((creep.ticksToLive || 0) <= tripTime || remainingDepositLifetime <= tripTime || retiring) {
      creep.suicide();
      return;
    }

    creep.memory.depositState = "travelling";
  }

  private travel(creep: Creep, destination: RoomPosition, maxRooms: number): void {
    const result = creep.travelTo(destination, { maxRooms });
    if (
      result !== OK &&
      result !== ERR_TIRED &&
      (result === ERR_NO_PATH || result === ERR_INVALID_TARGET || result === ERR_NOT_FOUND) &&
      Game.time % DEPOSIT_FARMER_POLICY.scanFailureLogInterval === 0
    ) {
      console.log(`[DepositFarmer] ${creep.name} cannot travel to ${destination.roomName}: ${result}`);
    }
  }
}
