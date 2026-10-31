import type { DepositFarmerHomeMemory, DepositSightingMemory } from "./DepositFarmerTypes";
import { getObserverCandidateRooms, isDepositOpportunityViable } from "./DepositFarmerPolicy";
import { DEPOSIT_FARMER_POLICY } from "./DepositFarmerTypes";
import { DepositMiner } from "../operator/DepositMiner";
import { Operation } from "../classes/operation";
import { RoomHelper } from "../utils/RoomHelper";

const DEPOSIT_FARMER_MEMORY_VERSION = 2;

interface DepositFarmerHome {
  room: Room;
  observer: StructureObserver;
}

export class DepositFarmer extends Operation {
  private operationOperators: DepositMiner[] = [];

  public init(): void {
    this.operationOperators = [];
    if (!DEPOSIT_FARMER_POLICY.enabled) return;
    const memory = this.getMemory();
    const homes = this.getObserverHomes();
    const pendingRooms = new Set<string>();
    const observedRooms = new Set<string>();

    for (const home of homes) {
      const homeMemory = this.getHomeMemory(home.room.name);
      if (homeMemory.pendingRoom) {
        pendingRooms.add(homeMemory.pendingRoom);
        if (Game.rooms[homeMemory.pendingRoom]) {
          if (!observedRooms.has(homeMemory.pendingRoom)) {
            this.recordObservation(homeMemory.pendingRoom);
            observedRooms.add(homeMemory.pendingRoom);
          }
          homeMemory.pendingRoom = undefined;
        } else if (Game.time - (memory.scannedRooms[homeMemory.pendingRoom] || 0) > 2) {
          homeMemory.pendingRoom = undefined;
        }
      }

      for (const roomName of homeMemory.scanRooms) {
        if (roomName === home.room.name || !Game.rooms[roomName]) continue;
        if (observedRooms.has(roomName)) continue;
        observedRooms.add(roomName);
        this.recordObservation(roomName);
        memory.scannedRooms[roomName] = Game.time;
      }
    }

    this.removeExpiredSightings();
    this.scheduleObservations(homes, pendingRooms);
    this.planMiners(memory.deposits);
  }

  public roleCall(): void {
    const attemptedHomes = new Set<string>();

    for (const operator of this.operationOperators) {
      if (Game.creeps[operator.name] || attemptedHomes.has(operator.room.name)) continue;
      attemptedHomes.add(operator.room.name);

      const home = operator.room;
      if (
        !home.storage ||
        home.storage.store.getUsedCapacity(RESOURCE_ENERGY) <= DEPOSIT_FARMER_POLICY.minimumStorageEnergy
      ) {
        continue;
      }

      const spawns = home.find(FIND_MY_SPAWNS);
      const spawn = spawns.find(candidate => !candidate.spawning);
      if (!spawn) continue;

      const body = this.getMinerBody(home.energyAvailable);
      if (!body) continue;

      const config = RoomHelper.getRoomConfig(home);
      let directions: DirectionConstant[] = [TOP, TOP_LEFT, LEFT, BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT, RIGHT, TOP_RIGHT];
      const spawnConfig = config?.spawns?.find(position => position.x === spawn.pos.x && position.y === spawn.pos.y);
      if (spawnConfig?.direction) directions = [spawnConfig.direction];

      const sighting = Object.values(this.getMemory().deposits).find(
        candidate => candidate.assignedCreep === operator.name
      );
      if (!sighting) continue;
      const result = spawn.spawnCreep(body, operator.name, {
        directions,
        memory: {
          role: "depositMiner",
          room: home.name,
          targetRoom: sighting.roomName,
          depositId: sighting.id,
          depositPos: sighting.pos,
          depositType: sighting.depositType,
          depositState: "travelling"
        }
      });

      if (result !== OK && Game.time % DEPOSIT_FARMER_POLICY.scanFailureLogInterval === 0) {
        console.log(`[DepositFarmer] Spawn ${operator.name} in ${home.name} failed: ${result}`);
      }
    }
  }

  public actions(): void {
    for (const operator of this.operationOperators) {
      operator.actions();
    }
  }

  private getMemory(): NonNullable<Memory["depositFarmer"]> {
    if (!Memory.depositFarmer || Memory.depositFarmer.version !== DEPOSIT_FARMER_MEMORY_VERSION) {
      Memory.depositFarmer = {
        version: DEPOSIT_FARMER_MEMORY_VERSION,
        homes: {},
        scannedRooms: {},
        deposits: {}
      };
    } else if (!Memory.depositFarmer.scannedRooms) {
      Memory.depositFarmer.scannedRooms = {};
    }
    return Memory.depositFarmer;
  }

  private getHomeMemory(roomName: string): DepositFarmerHomeMemory {
    const memory = this.getMemory();
    let homeMemory = memory.homes[roomName];
    if (!homeMemory) {
      homeMemory = {
        scanRooms: getObserverCandidateRooms(
          roomName,
          name => {
            const exits = Game.map.describeExits(name);
            return exits ? Object.values(exits) : [];
          },
          DEPOSIT_FARMER_POLICY.observerRange
        )
      };
      memory.homes[roomName] = homeMemory;
    }
    return homeMemory;
  }

  private getObserverHomes(): DepositFarmerHome[] {
    const rooms = Object.values(Game.rooms)
      .filter(room => room.controller?.my)
      .sort((left, right) => left.name.localeCompare(right.name));
    const homes: DepositFarmerHome[] = [];

    for (const room of rooms) {
      const observer = room.find<StructureObserver>(FIND_MY_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_OBSERVER
      })[0];
      if (observer) homes.push({ room, observer });
    }
    return homes;
  }

  private scheduleObservations(homes: DepositFarmerHome[], pendingRooms: Set<string>): void {
    if (Game.cpu.bucket < DEPOSIT_FARMER_POLICY.minimumCpuBucket) return;
    const requestsThisTick = new Set<string>();
    const scannedRooms = this.getMemory().scannedRooms;

    for (const home of homes) {
      const homeMemory = this.getHomeMemory(home.room.name);
      if (homeMemory.pendingRoom || !homeMemory.scanRooms.length) continue;
      if (
        homeMemory.lastScanTick !== undefined &&
        Game.time - homeMemory.lastScanTick < DEPOSIT_FARMER_POLICY.scanInterval
      ) {
        continue;
      }

      const candidate = homeMemory.scanRooms
        .filter(roomName => !Game.rooms[roomName] && !pendingRooms.has(roomName) && !requestsThisTick.has(roomName))
        .sort((left, right) => {
          const leftScanned = scannedRooms[left] || 0;
          const rightScanned = scannedRooms[right] || 0;
          return leftScanned - rightScanned || left.localeCompare(right);
        })[0];
      if (!candidate) continue;

      const result = home.observer.observeRoom(candidate);
      homeMemory.lastScanTick = Game.time;
      if (result === OK) {
        homeMemory.pendingRoom = candidate;
        scannedRooms[candidate] = Game.time;
        requestsThisTick.add(candidate);
        pendingRooms.add(candidate);
      } else if (Game.time % DEPOSIT_FARMER_POLICY.scanFailureLogInterval === 0) {
        console.log(`[DepositFarmer] Observer in ${home.room.name} could not scan ${candidate}: ${result}`);
      }
      if (result !== OK) scannedRooms[candidate] = Game.time;
    }
  }

  private recordObservation(roomName: string): void {
    const room = Game.rooms[roomName];
    if (!room) return;

    const memory = this.getMemory();
    const existing = Object.values(memory.deposits).filter(sighting => sighting.roomName === roomName);
    const controllerOwner = room.controller?.owner?.username;
    const ownUsername = Object.values(Game.rooms).find(visibleRoom => visibleRoom.controller?.my)?.controller?.owner
      ?.username;
    const isHostileOwned =
      DEPOSIT_FARMER_POLICY.avoidHostileRooms && !!controllerOwner && controllerOwner !== ownUsername;
    const hasHostiles = DEPOSIT_FARMER_POLICY.avoidHostileRooms && room.find(FIND_HOSTILE_CREEPS).length > 0;
    const deposits = isHostileOwned || hasHostiles ? [] : room.find(FIND_DEPOSITS);
    const observedIds = new Set(deposits.map(deposit => deposit.id));

    for (const sighting of existing) {
      if (observedIds.has(sighting.id)) continue;
      if (sighting.assignedCreep) {
        sighting.lastSeen = Game.time;
        sighting.ticksToDecay = 0;
      } else {
        delete memory.deposits[sighting.id];
      }
    }

    for (const deposit of deposits) {
      const previous = memory.deposits[deposit.id];
      memory.deposits[deposit.id] = {
        id: deposit.id,
        roomName,
        pos: { x: deposit.pos.x, y: deposit.pos.y },
        depositType: deposit.depositType,
        lastSeen: Game.time,
        ticksToDecay: deposit.ticksToDecay,
        cooldown: deposit.cooldown,
        assignedCreep: previous?.assignedCreep,
        homeRoom: previous?.homeRoom
      };
    }
  }

  private removeExpiredSightings(): void {
    const memory = this.getMemory();
    for (const [id, sighting] of Object.entries(memory.deposits)) {
      const age = Game.time - sighting.lastSeen;
      if (sighting.assignedCreep && Game.creeps[sighting.assignedCreep]) continue;

      if (sighting.assignedCreep && this.isSpawnQueued(sighting.assignedCreep)) continue;
      if (age > DEPOSIT_FARMER_POLICY.maxSightingAge || sighting.ticksToDecay <= age) {
        delete memory.deposits[id];
        continue;
      }
      if (sighting.assignedCreep) {
        sighting.assignedCreep = undefined;
        sighting.homeRoom = undefined;
      }
    }
  }

  private isSpawnQueued(creepName: string): boolean {
    for (const room of Object.values(Game.rooms)) {
      if (!room.controller?.my) continue;
      if (room.find(FIND_MY_SPAWNS).some(spawn => spawn.spawning?.name === creepName)) return true;
    }
    return false;
  }

  private planMiners(sightings: Record<string, DepositSightingMemory>): void {
    const memory = this.getMemory();
    const homeRooms = Object.values(Game.rooms)
      .filter(
        room =>
          room.controller?.my &&
          room.storage &&
          room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > DEPOSIT_FARMER_POLICY.minimumStorageEnergy &&
          room.find(FIND_MY_SPAWNS).length > 0
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const activePerHome: Record<string, number> = {};

    for (const sighting of Object.values(sightings)) {
      if (!sighting.assignedCreep) continue;
      const home = sighting.homeRoom ? Game.rooms[sighting.homeRoom] : undefined;
      if (!home || !home.controller?.my) continue;
      activePerHome[home.name] = (activePerHome[home.name] || 0) + 1;
      this.operationOperators.push(new DepositMiner(sighting.assignedCreep, home, sighting));
    }

    const availableSightings = Object.values(sightings)
      .filter(sighting => !sighting.assignedCreep)
      .sort((left, right) => {
        const leftDistance = this.getClosestHomeDistance(left, homeRooms);
        const rightDistance = this.getClosestHomeDistance(right, homeRooms);
        return (
          leftDistance - rightDistance ||
          left.cooldown - right.cooldown ||
          right.ticksToDecay - left.ticksToDecay ||
          right.lastSeen - left.lastSeen
        );
      });

    for (const sighting of availableSightings) {
      const home = homeRooms
        .filter(candidate => (activePerHome[candidate.name] || 0) < DEPOSIT_FARMER_POLICY.maxActiveMinersPerHome)
        .filter(candidate =>
          isDepositOpportunityViable(
            sighting,
            candidate.name,
            Game.time,
            (from, to) => Game.map.getRoomLinearDistance(from, to, false),
            DEPOSIT_FARMER_POLICY.maxSightingAge,
            DEPOSIT_FARMER_POLICY.minimumRemainingLifetime
          )
        )
        .sort(
          (left, right) =>
            Game.map.getRoomLinearDistance(left.name, sighting.roomName, false) -
              Game.map.getRoomLinearDistance(right.name, sighting.roomName, false) ||
            left.name.localeCompare(right.name)
        )[0];
      if (!home) continue;

      const name = this.getMinerName(sighting);
      sighting.assignedCreep = name;
      sighting.homeRoom = home.name;
      activePerHome[home.name] = (activePerHome[home.name] || 0) + 1;
      memory.deposits[sighting.id] = sighting;
      this.operationOperators.push(new DepositMiner(name, home, sighting));
      console.log(
        `[DepositFarmer] Assigned ${sighting.depositType} deposit in ${sighting.roomName} to ${home.name} (${name})`
      );
    }
  }

  private getMinerName(sighting: DepositSightingMemory): string {
    return `DepositMiner_${sighting.roomName}_${sighting.pos.x}_${sighting.pos.y}`;
  }

  private getClosestHomeDistance(sighting: DepositSightingMemory, homes: Room[]): number {
    return homes.reduce(
      (closest, home) => Math.min(closest, Game.map.getRoomLinearDistance(home.name, sighting.roomName, false)),
      Infinity
    );
  }

  private getMinerBody(energyAvailable: number): BodyPartConstant[] | null {
    const carryParts = Math.min(10, Math.floor((energyAvailable - 150) / 100));
    if (carryParts < 1) return null;

    const body: BodyPartConstant[] = [WORK];
    for (let index = 0; index < carryParts; index++) body.push(CARRY);
    for (let index = 0; index < carryParts + 1; index++) body.push(MOVE);
    return body;
  }
}
